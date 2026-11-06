// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
// Each agent reads in two lines: its space's tile, its task and its status; then what
// it runs with (the provider's mark, model and @effort from @wierdbytes/pi-herdr's
// labels, else its program), its sub-agents and terminals, its context size and how
// long it has been like this.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, settings } from "herdr";
import { agentMeta, shortModel, providerOf, tokens, duration, nextTick, effortColor, maxGradient } from "./meta.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// A terminal title that says something: not the program's name, a folder or user@host.
const telling = (live, prog) =>
  Boolean(live) && live !== prog?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== prog?.key;

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
// A child that reports a status is a sub-agent; one that doesn't is a plain terminal.
const isAgent = (k) => k.status != null || k.report != null;
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// The spaces sidebar's tile colors, so a space's tile reads the same in both lists.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The mark of the provider serving the agent's model (Anthropic, OpenCode Go, OpenRouter).
function providerIcon(mark, size, color) {
  return mark ? svg(`mods/wierd-agents/providers/${mark}.svg`).size(size).flex_none().text_color(color) : null;
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    // Folded groups (space or section ids), and agents whose sub-agents are listed.
    this.folded = new Set();
    this.open = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Times read 12s, 5m, 3h: redraw only when one of them would read differently.
    // Render sets `due`; waking up to compare is cheap, a redraw is not.
    cx.timer.every(1000, (cx) => {
      if (this.due == null || Date.now() < this.due) return;
      // A hidden copy may not render: look again in a minute, not every second.
      this.due = Date.now() + 60000;
      cx.notify();
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  // When the agent got into its state. The app stamps each tab when it happens
  // (working_since, changed_at), even while this list isn't running; that speaks
  // for an agent alone in its tab with no sub-agents. This list's own stamp is
  // when it saw the change: never earlier than the truth, except across a
  // done turning idle, which the app may stamp and this list doesn't. So the
  // earlier of the two.
  since(a) {
    const seen = this.changed[a.address]?.at || 0;
    const tab = this.solo?.get(a.address);
    const app = tab && (a.status === "working" ? tab.working_since : tab.changed_at);
    return app && (!seen || app < seen) ? app : seen;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(17)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  // A count chip (⑂ 3, >_ 1); with `toggle` it opens the tree of children under the row.
  badge(t, id, glyph, n, tip, toggle, open) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(18)
      .px(5)
      .gap(4)
      .rounded(5)
      .items_center()
      .bg(open ? t.selected : t.hover)
      .text_size(11)
      .text_color(open ? t.foreground : t.muted)
      .tooltip(tip)
      .when(Boolean(toggle), (el) => el
        .cursor_pointer()
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          toggle(cx);
        }))
      .child(svg(`mods/workspace-chrome/${glyph}.svg`).size(11).flex_none())
      .child(String(n));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const byAddr = new Map(all.map((x) => [x.address, x]));
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const trees = new Map(list.map((a) => [a.address, this.tree(all, a.address)]));
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const perTab = new Map();
    for (const a of list) perTab.set(a.tab, (perTab.get(a.tab) ?? 0) + 1);
    this.solo = new Map(list
      .filter((a) => perTab.get(a.tab) === 1 && !trees.get(a.address).some((s) => isAgent(s.t)))
      .map((a) => [a.address, tabs.get(a.tab)])
      .filter(([, tab]) => tab));
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...trees.get(a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    // The earliest moment a shown time reads differently; the timer redraws then.
    let due = null;
    const clock = (since) => {
      const next = nextTick(since, now);
      if (due == null || next < due) due = next;
      return duration(now - since);
    };

    const colors = shared("space.colors") ?? {};
    const mono = settings().font_family ?? "JetBrains Mono";
    const dark = settings().dark !== false;

    // `@effort` in pi-statusline's colors; max shades letter by letter.
    const effort = (word) => {
      const text = `@${word}`;
      if (word !== "max") return div().flex_none().text_color(effortColor(word, t, dark)).child(text);
      return h_flex().flex_none().children(maxGradient(text).map(([g, c]) => div().when(Boolean(c), (el) => el.text_color(c)).child(g)));
    };

    // What the agent is on: its own word (pi's session name, a question while
    // blocked), else a tab someone named, else a telling terminal title.
    const label = (a) => {
      const msg = clean(byAddr.get(a.address)?.report?.msg);
      if (msg) return msg;
      const tab = tabs.get(a.tab);
      if (tab?.named && tab.name !== a.program?.name) return tab.name;
      const live = clean(a.title);
      if (telling(live, a.program)) return live;
      return a.program?.name || a.tab_name || a.address;
    };

    // The space's tile, as the spaces sidebar draws it.
    const tile = (a) => {
      const c = colors[a.space] ?? "ansi6";
      const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.dim);
      return h_flex()
        .id(`tile-${a.address}`)
        .size(18)
        .flex_none()
        .rounded(5)
        .bg(fill)
        .items_center()
        .justify_center()
        .text_size(10.5)
        .font_bold()
        .text_color("#ffffff")
        .tooltip(a.space_name || "")
        .child([...(a.space_name || "?")][0].toUpperCase());
    };

    const withKids = (a, i) => {
      const subs = collapsed ? [] : trees.get(a.address);
      const r = row(a, i, subs);
      if (!this.open.has(a.address) || subs.length === 0) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    const row = (a, i, subs = []) => {
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const meta = agentMeta(byAddr.get(a.address));
      const when = this.since(a);
      const quiet = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));

      // Children: hc sub-agents and terminals open as a tree; pi's in-process
      // sub-agents (pi-herdr's count) have no terminal, so they only add to the count.
      const kidAgents = subs.filter((s) => isAgent(s.t)).length;
      const kidTerms = subs.length - kidAgents;
      const inner = meta?.subagents ?? 0;
      const open = this.open.has(a.address) && subs.length > 0;
      const toggle = subs.length > 0
        ? (cx) => {
          this.open.has(a.address) ? this.open.delete(a.address) : this.open.add(a.address);
          cx.notify();
        }
        : null;
      const subTip = [kidAgents && plural(kidAgents, "sub-agent"), inner && `${inner} in pi`].filter(Boolean).join(" + ");

      const mark = providerOf(meta);
      const pic = providerIcon(mark, 13, t.muted) ?? icon(a.program, 14, t.muted);
      const model = meta?.model ? shortModel(meta.model, mark) : a.program?.name ?? "";
      const ctx = tokens(meta?.ctx);
      const full = meta?.ctx != null && meta?.ctxMax ? meta.ctx / meta.ctxMax : null;

      return v_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .py(6)
        .gap(2)
        .flex_none()
        .rounded(8)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(h_flex()
          .h(20)
          .gap(9)
          .items_center()
          .child(tile(a))
          .child(div().flex_1().min_w(0).truncate().text_size(13).when(!quiet, (el) => el.font_medium()).text_color(quiet ? t.muted : t.foreground).child(label(a)))
          .child(this.status(t, a, byPriority && !isPinned)))
        .child(h_flex()
          .h(18)
          .gap(9)
          .items_center()
          .text_size(12)
          .child(h_flex()
            .id(`via-${a.address}`)
            .w(18)
            .flex_none()
            .items_center()
            .justify_center()
            .when(Boolean(meta?.provider), (el) => el.tooltip(meta.provider))
            .when(Boolean(pic), (el) => el.child(pic)))
          .child(h_flex().flex_1().min_w(0).gap(4).items_center()
            .child(div().min_w(0).truncate().text_color(quiet ? t.dim : t.muted).child(model))
            .when(Boolean(meta?.effort), (el) => el.child(effort(meta.effort))))
          .child(h_flex().flex_none().gap(7).items_center()
            .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
            .when(kidAgents + inner > 0, (el) => el.child(this.badge(t, `subs-${a.address}`, "git-branch", kidAgents + inner, subTip, kidAgents > 0 ? toggle : null, open)))
            .when(kidTerms > 0, (el) => el.child(this.badge(t, `terms-${a.address}`, "terminal", kidTerms, plural(kidTerms, "terminal"), toggle, open)))
            .when(Boolean(ctx), (el) => el.child(div()
              .id(`ctx-${a.address}`)
              .text_color(full != null && full >= 0.8 ? t.blocked : (t.ansi4 ?? t.accent))
              .tooltip(full != null ? `${ctx} of ${tokens(meta.ctxMax)} context · ${Math.round(full * 100)}%` : `${ctx} context`)
              .child(ctx)))
            .when(this.hovered === a.address, (el) => el.child(pin))
            .when(this.hovered !== a.address && Boolean(when), (el) => el.child(div()
              .min_w(22)
              .text_right()
              .font_family(mono)
              .text_size(11.5)
              .text_color(t.dim)
              .child(clock(when))))));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    this.due = due;

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "wierd-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).gap(1).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
