// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
// Each agent reads in two lines: its status and its task; then what
// it runs with (the provider's mark, model and @effort from @wierdbytes/pi-herdr's
// labels, else its program), its sub-agents and terminals, its context size and how
// long it has been like this. Under that line, a thin bar fills with the share of
// the model's window in use, green, then yellow past 60% and red past 80%; a tick
// on it slides from its right end to its left as the prompt cache runs out, and
// the context size reads green while the cache is warm, yellow in its last 30s.
// The Sessions tab lists pi's sessions per space; one is opened in a peek panel
// (Keep: a tab of its space; closing: that pi ends), or gone to if a pi has it open.
// With props {panel: "spaces"} this mod is the Spaces panel instead (spaces.js):
// mods can't import each other's files, so the panels share kit.js and scroll.js here.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, spaces, panes, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, settings, exec, hc, home, appHome, notify } from "herdr";
import { agentMeta, shortModel, providerOf, tokens, duration, nextTick, effortColor, ctxColor, maxGradient, cacheLeft, cacheState, cacheColor, CACHE_WARN_MS } from "./meta.js";
import { narrow, toggleSidebar, place, foldMark, RANK, kidStatus, isAgent, tree, statusMark } from "./kit.js";
import { scrollList } from "./scroll.js";
import { Spaces } from "./spaces.js";

// The context size's slot ("69.2k" in the mono face); a pi with no context yet
// keeps this much room, so the badges don't jump when the number shows up.
const CTX_W = 34;
// The context bar under a row's second line, in the row's bottom padding: its
// thickness, how far it sits above the row's edge, and the fill's opacity (hex
// alpha over the track): the statusline's colors, toned down for a quiet list.
const BAR_H = 2, BAR_BOTTOM = 3, FILL_ALPHA = "99";
// The cache tick: its width, how far it rises above the bar, and how often the
// list aims it anew (it slides between those aims natively, so the list redraws
// only this often).
const TICK_W = 2, TICK_UP = 4, TICK_STEP = 5000;
// The list's width less the tick's lane: the list's padding (8 + 8), the bar's
// inset in its row (8 + 8) and the tick's own width.
const TICK_LANE_INSET = 32 + TICK_W;
// Row heights in the list (px at zoom 1): the list scrolls itself (scroll.js),
// so it places rows by these.
const H_HEADER = 30, H_ROW = 52, H_SUB = 26, H_RAIL = 26;
// The panel's tabs: the agents running now, and pi's sessions in each space's folder.
const VIEWS = [
  { id: "agents", label: "Agents" },
  { id: "sessions", label: "Sessions" },
];
// Sessions per space at first, and how many more each step brings.
const SESSION_PAGE = 10;
// How often the shown Sessions tab reads the folders again (new sessions, names).
const SESSION_POLL_MS = 10000;
// A session just opened: no second pi for it while its labels are on the way.
const LAUNCH_GRACE_MS = 15000;

// A model id as people say it, as the Agents tab shows names:
// claude-opus-5-5 -> Opus 5.5 (the provider's mark says Claude).
function modelName(id, mark) {
  const short = shortModel(id, mark);
  if (/\s/.test(short) || !short.includes("-")) return short;
  const words = [];
  for (const w of short.split("-")) {
    if (/^\d+$/.test(w) && /^\d+(\.\d+)*$/.test(words.at(-1) ?? "")) words[words.length - 1] += `.${w}`;
    else words.push(w);
  }
  return words.map((w) => (w === "gpt" ? "GPT" : w[0].toUpperCase() + w.slice(1))).join(" ");
}
// A session's id from its file name: <time>_<id>.jsonl.
const idOfFile = (file) => file.split("/").pop().replace(/\.jsonl$/, "").split("_").pop();

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// A terminal title that says something: not the program's name, a folder or user@host.
const telling = (live, prog) =>
  Boolean(live) && live !== prog?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== prog?.key;

const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
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

// The Agents / Sessions panel (and its sort menu and session peek bar).
class Agents {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    if (props()?.peekBar) {
      // The panel takes the keyboard, not its pi: Esc closes it, Enter keeps it.
      // The terminal gets it when clicked. Focus once the overlay is up, and
      // again in case the terminal took it while opening.
      this.keys = cx.focus_handle();
      cx.timer.after(30, () => this.keys.focus());
      cx.timer.after(250, () => this.keys.focus());
      return;
    }
    // Folded groups (space or section ids), and agents whose sub-agents are listed.
    this.folded = new Set();
    this.open = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Each list's own scroll position.
    this.scroll = { agents: {}, sessions: {} };
    // Sessions: what each file said so far (and how far it was read), each
    // folder's newest files, how many each space shows, sessions being opened.
    this.sessInfo = {};
    this.sessDirs = {};
    this.sessLimit = {};
    this.launching = {};
    this.windows = JSON.parse(localStorage.getItem("windows") ?? "null");
    // Each session's prompt cache expiry, as its pi last said (see rememberCaches).
    this.sessCache = JSON.parse(localStorage.getItem("caches") ?? "{}");
    localStorage.removeItem("cache");
    // Where each cache tick was last aimed, to tell a refresh (a jump back to the right).
    this.tickAim = {};
    cx.timer.every(1000, (cx) => {
      if (shared("agents.view") !== "sessions" || narrow()) return;
      if (this.sessWant !== this.sessHave || Date.now() - (this.sessAt ?? 0) > SESSION_POLL_MS) this.refreshSessions(cx);
    });
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

  // A session opened from the Sessions tab runs in a terminal of its own, shown
  // over the window with this bar on top: Keep makes it a tab of its space (and
  // an agent in the list); closing the panel any other way ends that pi.
  // Props: { peekBar, terminal, space, title, overlay }.
  peekBar(t) {
    const { terminal, space, title, overlay } = props();
    const term = terminals().find((x) => x.address === terminal);
    const status = kidStatus(term ?? {}, new Map(agents().map((a) => [a.address, a.status])));
    const meta = agentMeta(term);
    const mark = providerOf(meta);
    const pic = providerIcon(mark, 13, t.muted) ?? icon(term?.program, 14, t.muted);
    const name = spaces().find((s) => s.id === space)?.name;
    const keep = () => {
      this.kept = true;
      if (space) run("space.select", { id: space });
      run("terminal.keep", { terminal });
      closeOverlay(overlay);
    };
    const kbd = (text, color) => div().text_size(10).opacity(0.75).text_color(color).child(text);
    const button = (id, label, tip, onClick, strong = false) => h_flex()
      .id(id)
      .h(24)
      .px(9)
      .gap(6)
      .rounded(6)
      .items_center()
      .flex_none()
      .cursor_pointer()
      .text_color(strong ? t.accent_foreground : t.muted)
      .when(strong, (el) => el.bg(t.accent))
      .hover((s) => (strong ? s.opacity(0.9) : s.bg(t.hover).text_color(t.foreground)))
      .tooltip(tip)
      .on_click(onClick)
      .children(Array.isArray(label) ? label : [label]);
    return h_flex()
      .id("peek-bar")
      .track_focus(this.keys)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(overlay);
        else if (e.key === "enter") keep();
        else return;
        cx.stop_propagation();
      })
      // A press on the bar takes the keyboard back from the terminal.
      .on_mouse_down("left", () => this.keys.focus())
      .size_full()
      .px(12)
      .gap(9)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(12.5)
      .child(h_flex().w(18).flex_none().items_center().justify_center().when(Boolean(status), (el) => el.child(this.status(t, { status }, true))))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(title || terminal || ""))
      .child(div().flex_1())
      .child(button("peek-keep", [div().child("Keep"), kbd("↵", t.accent_foreground)], `Keep it as a tab${name ? ` in ${name}` : ""}`, keep, true))
      .child(button("peek-close", [div().child("✕"), kbd("esc", t.dim)], "Close and end this pi", () => closeOverlay(overlay)));
  }

  // The peek panel going away without Keep ends its pi: the session is saved.
  async close() {
    const p = props();
    if (p?.peekBar && !this.kept && p.terminal) await hc(["kill", p.terminal]);
  }

  openSessionPeek(terminal, space, title) {
    openOverlay({
      kind: "dialog",
      width: 0.82,
      height: 0.82,
      layout: {
        type: "column",
        children: [
          { id: "peek-bar", type: "block", size: { px: 38 }, content: { mod: "wierd-agents", props: { peekBar: true, terminal, space, title } } },
          { id: "peek-term", type: "block", content: { terminal } },
        ],
      },
    });
  }

  // A new pi on the session, in a terminal of no tab (yet), through the login
  // shell so it has the person's environment; shown in the peek panel.
  openSession(cx, { id, space, folder, title }) {
    this.launching[id] = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (!this.shell) this.shell = (await exec("/bin/sh", ["-c", 'printf %s "$SHELL"'])).stdout.trim() || "/bin/zsh";
        const r = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--cwd", folder, "--", this.shell, "-lic", 'exec "$@"', this.shell, "pi", "--session", id]);
        const addr = JSON.parse(r.stdout).address;
        if (!addr) throw new Error(r.stderr || r.stdout);
        this.openSessionPeek(addr, space, title);
      } catch (e) {
        delete this.launching[id];
        notify({ title: "Couldn't open the session", body: String(e?.message ?? e).slice(0, 300), level: "error" });
      }
      cx.notify();
    });
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr) {
    return tree(all, addr);
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
  // (The marks are kit.js's, shared with the Spaces panel.)
  status(t, a, compact = false) {
    return statusMark(t, a.status, compact);
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
      // Room for two digits, so 9 -> 10 doesn't push its neighbours.
      .child(div().min_w(14).text_center().child(String(n)));
  }

  // The context size as plain text in a fixed slot, colored by the prompt cache
  // (`tint`: green while warm, yellow in its last 30s, muted once gone, and what
  // the tooltip adds); the bar under the row says how full the window is.
  ctxText(t, addr, ctx, full, max, mono, tint) {
    const size = full != null ? `${ctx} of ${tokens(max)} context · ${Math.floor(full * 100)}%` : `${ctx} context`;
    return div()
      .id(`ctx-${addr}`)
      .flex_none()
      .w(CTX_W)
      .text_right()
      .font_family(mono)
      .text_size(10.5)
      .text_color(tint?.color ?? t.muted)
      .tooltip(tint?.note ? `${size} · ${tint.note}` : size)
      .child(ctx);
  }

  // Remembers each session's cache ({until, ttl}) while a pi has it open: once
  // that pi ends, nothing refreshes the cache, so the Sessions tab still knows
  // how long it lives. Only caches still warm are kept.
  rememberCaches(all, now) {
    let dirty = false;
    for (const term of all) {
      const id = term.labels?.["agent.session"];
      const meta = id && term.state === "live" ? agentMeta(term) : null;
      if (!meta) continue;
      const warm = meta.cacheUntil > now && meta.cacheTtl > 0;
      const had = this.sessCache[id];
      if (warm ? had?.until === meta.cacheUntil && had?.ttl === meta.cacheTtl : !had) continue;
      if (warm) this.sessCache[id] = { until: meta.cacheUntil, ttl: meta.cacheTtl };
      else delete this.sessCache[id];
      dirty = true;
    }
    if (!dirty) return;
    for (const [id, c] of Object.entries(this.sessCache)) if (!(c?.until > now)) delete this.sessCache[id];
    localStorage.setItem("caches", JSON.stringify(this.sessCache));
  }

  // A thin bar across the row's bottom padding, like the limits mod's: grey track,
  // the used share filled in one color (green, yellow or red as a whole, like
  // pi-statusline's bar), softened. Placed over the row, so the lines above never
  // move. No `full` (the model's window is unknown): the track alone.
  // `tick` ({left, ms}): the prompt cache's tick, at `left` (0..1) of the bar,
  // sliding there over `ms`; null when the cache is gone or not known.
  ctxBar(t, dark, full, key, tick) {
    const color = ctxColor(full, t, dark);
    const soft = /^#[0-9a-f]{6}$/i.test(color) ? `${color}${FILL_ALPHA}` : color;
    return div()
      .absolute()
      .left(8)
      .right(8)
      .bottom(BAR_BOTTOM)
      .h(BAR_H)
      .rounded(1)
      .bg(t.raised)
      .when(full > 0, (el) => el.child(div()
        .absolute()
        .left(0)
        .top(0)
        .bottom(0)
        .min_w(2)
        .w(`${(full * 100).toFixed(1)}%`)
        .rounded(1)
        .bg(soft)))
      // Like the limits mod's tick, but rising from the bar only. Its lane is the
      // bar less its width, so at 100% the tick is still on the bar. In px once the
      // list's width is known: a transition moves px, not %.
      .when(Boolean(tick), (el) => el.child(div()
        .id(`tick-${key}`)
        .absolute()
        .bottom(0)
        .when(this.viewW > 0, (el) => el
          .left(Math.round(tick.left * (this.viewW - TICK_LANE_INSET) * 100) / 100)
          .transition("left", { duration: tick.ms, easing: "linear" }))
        .when(!(this.viewW > 0), (el) => el.left(`${(tick.left * 100).toFixed(2)}%`))
        .w(TICK_W)
        .h(BAR_H + TICK_UP)
        .bg(t.foreground)
        .opacity(0.5)));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.peekBar) return this.peekBar(t);
    const collapsed = narrow();
    const sort = sortOf();
    // The rail has no tabs: it lists agents.
    const view = !collapsed && shared("agents.view") === "sessions" ? "sessions" : "agents";
    // Only the shown space's agents, like Mail's unread filter.
    const spaceOnly = shared("agents.spaceOnly") === true;
    const activeSpace = spaces().find((s) => s.active);
    let list = agents();
    if (spaceOnly) list = list.filter((a) => a.space === activeSpace?.id);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const byAddr = new Map(all.map((x) => [x.address, x]));
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.rememberCaches(all, now);
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
    const wake = (at) => {
      if (due == null || at < due) due = at;
    };
    const clock = (since) => {
      wake(nextTick(since, now));
      return duration(now - since);
    };
    // The prompt cache's tick (pi-herdr's agent.cache_until / agent.cache_ttl):
    // the share of its lifetime left, from the bar's right end (just refreshed)
    // to its left (expiring); gone once it expires. Each render aims it at where
    // it will be at the next TICK_STEP boundary (the last one: the expiry) and it
    // slides there natively; the redraw at that boundary aims it further. Other
    // redraws keep the same aim, so a slide is never retargeted. A refresh, a new
    // lifetime, or a pause in redraws jumps it to where it belongs.
    const cacheTick = (key, cache) => {
      const until = cache?.until, ttl = cache?.ttl;
      if (cacheLeft(until, ttl, now) == null) {
        delete this.tickAim[key];
        return null;
      }
      const next = Math.min(until, (Math.floor(now / TICK_STEP) + 1) * TICK_STEP);
      wake(next);
      const aim = this.tickAim[key];
      if (aim?.next === next && aim.until === until && aim.ttl === ttl) return aim;
      const left = cacheLeft(until, ttl, next) ?? 0;
      const follows = aim?.until === until && aim.ttl === ttl && left <= aim.left && aim.left - left <= (1.5 * TICK_STEP) / ttl;
      return (this.tickAim[key] = { until, ttl, next, left, ms: follows ? Math.max(0, next - now) : 0 });
    };
    // The context size's color by the cache's expiry, and a redraw when it
    // turns yellow and when it goes.
    const two = (n) => String(n).padStart(2, "0");
    const cacheTint = (cache) => {
      const until = cache?.until;
      const state = cacheState(until, now);
      if (state === "warm") wake(until - CACHE_WARN_MS);
      if (state) wake(until);
      const at = until ? new Date(until) : null;
      const note = !until ? null : state ? `cache till ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` : "cache expired";
      return { color: cacheColor(state, t, dark), note };
    };

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

    const withKids = (a, i) => {
      const subs = collapsed ? [] : trees.get(a.address);
      const r = { el: row(a, i, subs), h: collapsed ? H_RAIL : H_ROW, addr: a.address };
      if (!this.open.has(a.address) || subs.length === 0) return [r];
      return [r, ...subs.map((s) => ({ el: this.subRow(t, s, shown, byPriority), h: H_SUB }))];
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
      // No context yet (a fresh pi before its first prompt): no number, an empty bar.
      const ctx = meta?.ctx > 0 ? tokens(meta.ctx) : null;
      const full = ctx && meta?.ctxMax ? Math.min(1, meta.ctx / meta.ctxMax) : null;
      const cache = meta ? { until: meta.cacheUntil, ttl: meta.cacheTtl } : null;

      return v_flex()
        .id(`ag-${a.address}`)
        .relative()
        .h(H_ROW)
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
          // The status sits where the space tile was, in the provider icon's column.
          .child(h_flex().w(18).flex_none().items_center().justify_center().child(this.status(t, a, true)))
          // Every title reads the same; the status and the line below say which are quiet.
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.foreground).child(label(a))))
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
          .child(h_flex().flex_1().min_w(0).gap(4).items_center().font_family(mono).text_size(10.5)
            .child(div().min_w(0).truncate().text_color(quiet ? t.dim : t.muted).child(model))
            .when(Boolean(meta?.effort), (el) => el.child(effort(meta.effort))))
          .child(h_flex().flex_none().gap(7).items_center()
            .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
            .when(kidAgents + inner > 0, (el) => el.child(this.badge(t, `subs-${a.address}`, "git-branch", kidAgents + inner, subTip, kidAgents > 0 ? toggle : null, open)))
            .when(kidTerms > 0, (el) => el.child(this.badge(t, `terms-${a.address}`, "terminal", kidTerms, plural(kidTerms, "terminal"), toggle, open)))
            // A pi keeps the number's place before its first prompt, so the
            // badges don't jump when it shows up.
            .when(Boolean(ctx), (el) => el.child(this.ctxText(t, a.address, ctx, full, meta.ctxMax, mono, cacheTint(cache))))
            .when(!ctx && Boolean(meta), (el) => el.child(div().w(CTX_W).flex_none()))
            // The clock and the pin share one fixed slot: hovering swaps them in place.
            .child(h_flex()
              .w(26)
              .flex_none()
              .justify_end()
              .items_center()
              .when(this.hovered === a.address, (el) => el.child(pin))
              .when(this.hovered !== a.address && Boolean(when), (el) => el.child(div()
                .font_family(mono)
                .text_size(10.5)
                .text_color(t.dim)
                .child(clock(when)))))))
        // Every pi has the bar, filled once it knows its context and window.
        .when(Boolean(meta), (el) => el.child(this.ctxBar(t, dark, full, a.address, cacheTick(a.address, cache))));
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
        .child(div().text_color(t.dim).child(String(g.members.length)))
        .child(foldMark(open))
        .child(div().flex_1())
        .when(!open && !byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)));
    };
    const items = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [{ el: header(g), h: H_HEADER }, ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);
    this.due = due;

    // A new space or a new agent in focus: bring its row into view, animated.
    const current = list.find((a) => a.focused);
    const followKey = `${activeSpace?.id ?? ""}|${current?.address ?? ""}`;
    let followAt = null;
    if (this.viewH && followKey !== this.followKey) {
      this.followKey = followKey;
      const at = current ? items.findIndex((it) => it.addr === current.address) : -1;
      if (at >= 0) followAt = at;
    }

    const listView = view === "sessions"
      ? scrollList(this, t, this.sessionItems(t, { now, clock, cacheTick, cacheTint, mono, dark, effort, spaceOnly, activeSpace, byAddr }), this.scroll.sessions, {
        collapsed,
        // At the end of the list, the last space's next sessions come in.
        onEnd: (cx) => this.moreAtEnd(cx),
      })
      : scrollList(this, t, items, this.scroll.agents, { collapsed, followAt });
    // Session times are on the clock too.
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
            .px(12)
            .h(41)
            .pt(12)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(h_flex().gap(2).items_center().children(VIEWS.map((v) => div()
              .id(`view-${v.id}`)
              .h(22)
              .px(6)
              .rounded(5)
              .flex()
              .items_center()
              .text_size(11.5)
              .font_medium()
              .cursor_pointer()
              .text_color(view === v.id ? t.foreground : t.dim)
              .when(view === v.id, (el) => el.bg(t.hover))
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                setShared("agents.view", v.id);
                if (v.id === "sessions") this.refreshSessions(cx);
              })
              .child(v.label))))
            .child(h_flex().gap(10).pr(4).items_center()
              .when(view === "agents", (el) => el.child(
                div()
                  .id("ag-sort")
                  .text_size(11)
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click(() => openOverlay({ mod: "wierd-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                  .tooltip(`Sort agents: ${sort.label}`)
                  .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
              ))
              .child(
                h_flex()
                  .id("ag-filter")
                  .size(14)
                  .items_center()
                  .justify_center()
                  .text_color(t.dim)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click(() => setShared("agents.spaceOnly", !spaceOnly))
                  .tooltip(spaceOnly ? `Showing ${activeSpace?.name ?? "this space"} only · Show all` : `Show only this space's ${view === "sessions" ? "sessions" : "agents"}`)
                  .when(spaceOnly, (el) => el.child(
                    h_flex().size(12).rounded_full().bg(t.accent).items_center().justify_center()
                      .child(svg("mods/wierd-agents/filter-lines.svg").size(12).text_color(t.accent_foreground))))
                  .when(!spaceOnly, (el) => el.child(svg("mods/wierd-agents/filter.svg").size(14))),
              )),
        ),
      )
      .when(view === "agents" && list.length === 0 && !collapsed && spaceOnly, (el) =>
        el.child(div().px(16).text_size(12).text_color(t.dim).child(`No agents in ${activeSpace?.name ?? "this space"}.`)),
      )
      .when(view === "agents" && list.length === 0 && !collapsed && !spaceOnly, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(listView)
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

  // The folders the Sessions tab shows: local spaces (pi's sessions are on this
  // machine), each with how many sessions it asks for.
  sessionSpaces(spaceOnly, activeSpace) {
    const ps = panes();
    return spaces()
      .filter((s) => !s.machine && (!spaceOnly || s.id === activeSpace?.id))
      .map((s) => ({ space: s, cwd: place(s, ps), limit: this.sessLimit[s.id] ?? SESSION_PAGE }))
      .filter((x) => x.cwd);
  }

  // Reads the folders (sessions.mjs, only what pi appended since last time).
  refreshSessions(cx) {
    if (this.sessBusy) return;
    const want = this.sessWant;
    const wanted = this.sessReq ?? [];
    if (!wanted.length) return;
    this.sessBusy = true;
    if (!this.windowsAsked) {
      this.windowsAsked = true;
      cx.spawn(async (cx) => {
        try {
          if (!this.shell) this.shell = (await exec("/bin/sh", ["-c", 'printf %s "$SHELL"'])).stdout.trim() || "/bin/zsh";
          const r = await exec(this.shell, ["-lic", "pi --list-models"]);
          const unit = { K: 1e3, M: 1e6 };
          const windows = {};
          for (const line of r.stdout.split("\n")) {
            const m = line.match(/^(\S+)\s+(\S+)\s+([\d.]+)([KM]?)\s/);
            if (m) windows[`${m[1]}/${m[2]}`] = Math.round(Number(m[3]) * (unit[m[4]] ?? 1));
          }
          if (Object.keys(windows).length) {
            this.windows = windows;
            localStorage.setItem("windows", JSON.stringify(windows));
            cx.notify();
          }
        } catch {}
      });
    }
    this.sessAt = Date.now();
    const dirs = new Map();
    for (const { cwd, limit } of wanted) dirs.set(cwd, Math.max(limit, dirs.get(cwd) ?? 0));
    const known = Object.fromEntries(Object.entries(this.sessInfo).map(([f, i]) => [f, i.end ?? 0]));
    const req = { root: `${home()}/.pi/agent/sessions`, dirs: [...dirs].map(([cwd, limit]) => ({ cwd, limit })), known };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("node", [`${appHome()}/mods/wierd-agents/sessions.mjs`, JSON.stringify(req)]);
        const out = JSON.parse(r.stdout);
        for (const [file, info] of Object.entries(out.read ?? {})) this.sessInfo[file] = { ...this.sessInfo[file], ...info };
        Object.assign(this.sessDirs, out.dirs ?? {});
        this.sessHave = want;
        this.sessError = null;
      } catch (e) {
        this.sessError = String(e?.message ?? e);
        this.sessHave = want;
      } finally {
        this.sessBusy = false;
      }
      cx.notify();
    });
  }

  // Scrolled to the end: the last space with more sessions shows the next page.
  moreAtEnd(cx) {
    const last = this.sessShown?.at(-1);
    if (!last || this.sessBusy || last.shown >= last.total || this.folded.has(`ss-${last.space}`)) return;
    this.sessLimit[last.space] = last.limit + SESSION_PAGE;
    cx.notify();
  }

  // The Sessions tab's rows: per space a header, its sessions newest first, and
  // a row for more. A session pi has open shows that agent's status and goes to
  // it; one nobody has open starts `pi --session <id>` in a new tab there.
  sessionItems(t, { now, clock, cacheTick, cacheTint, mono, dark, effort, spaceOnly, activeSpace, byAddr }) {
    const groups = this.sessionSpaces(spaceOnly, activeSpace);
    this.sessReq = groups.map(({ cwd, limit }) => ({ cwd, limit }));
    this.sessWant = JSON.stringify(this.sessReq);

    // Which pi has which session open (pi-herdr's agent.session label).
    const byAgent = new Map(agents().map((a) => [a.address, a]));
    const open = new Map();
    for (const term of byAddr.values()) {
      const id = term.labels?.["agent.session"];
      if (id && term.state === "live" && agentMeta(term)) open.set(id, term.address);
    }
    // A pi started before pi-herdr said its session: its folder and the session's
    // name (what it reports) tell, for the newest session of that name.
    const unsaid = new Map();
    for (const term of byAddr.values()) {
      if (term.state !== "live" || term.labels?.["agent.session"] || !agentMeta(term)) continue;
      const name = clean(term.report?.msg);
      const where = term.foreground?.cwd ?? term.cwd;
      if (name && where) unsaid.set(`${where}\n${name}`, term.address);
    }
    const taken = new Set(open.values());
    const ps = panes();

    const items = [];
    this.sessShown = [];
    for (const { space, cwd, limit } of groups) {
      const dir = this.sessDirs[cwd];
      const gid = `ss-${space.id}`;
      const folded = this.folded.has(gid);
      items.push({
        h: H_HEADER,
        el: h_flex()
          .id(gid)
          .px(8)
          .pt(8)
          .h(H_HEADER)
          .flex_none()
          .gap(6)
          .items_center()
          .text_size(11)
          .font_medium()
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            folded ? this.folded.delete(gid) : this.folded.add(gid);
            cx.notify();
          })
          .child(div().truncate().text_color(space.active ? t.muted : t.dim).child(space.name))
          .when(Boolean(dir), (el) => el.child(div().text_color(t.dim).child(String(dir.total))))
          .child(foldMark(!folded))
          .child(div().flex_1()),
      });
      if (folded) continue;
      const note = (key, text) => items.push({
        h: H_SUB,
        el: div().id(`${gid}-${key}`).h(H_SUB).px(8).flex().items_center().text_size(11.5).text_color(t.dim).child(text),
      });
      if (!dir) {
        note("wait", this.sessError ? `Can't read sessions: ${this.sessError}` : "Reading sessions…");
        continue;
      }
      if (dir.total === 0) {
        note("none", "No pi sessions in this folder.");
        continue;
      }
      const files = dir.files.slice(0, limit);
      this.sessShown.push({ space: space.id, limit, shown: files.length, total: dir.total });
      for (const { file, mtime } of files) {
        const info = this.sessInfo[file] ?? {};
        const id = info.id ?? idOfFile(file);
        let addr = open.get(id);
        if (!addr && info.name && info.cwd) {
          const guess = unsaid.get(`${info.cwd}\n${info.name}`);
          if (guess && !taken.has(guess)) addr = guess;
        }
        if (addr) taken.add(addr);
        const term = addr ? byAddr.get(addr) : null;
        // An agent with a pane is in agents(); one in the peek panel only has its terminal.
        const agent = addr ? (byAgent.get(addr) ?? (term?.status ? { status: kidStatus(term, new Map()) } : null)) : null;
        const pane = addr ? (byAgent.get(addr)?.pane ?? ps.find((p) => p.terminal === addr)?.pane) : null;
        if (addr) delete this.launching[id];
        const starting = !addr && now - (this.launching[id] ?? 0) < LAUNCH_GRACE_MS;
        const meta = addr ? agentMeta(byAddr.get(addr)) : null;
        // A pi with the session open says what it runs now; else what the file last said.
        const provider = meta?.provider ?? info.provider;
        const mark = providerOf({ provider });
        const model = meta?.model ? shortModel(meta.model, mark) : info.model ? modelName(info.model, mark) : "";
        const pic = providerIcon(mark, 13, t.muted);
        // Effort and context as the Agents tab shows them: the open pi's, else the
        // file's last reply, against the model's window from `pi --list-models`.
        const level = meta ? meta.effort : info.effort;
        const ctxN = meta?.ctx > 0 ? meta.ctx : !meta && info.ctx > 0 ? info.ctx : null;
        const ctxMax = meta?.ctxMax ?? this.windows?.[`${info.provider}/${info.model}`] ?? null;
        const ctx = ctxN ? tokens(ctxN) : null;
        const full = ctx && ctxMax ? Math.min(1, ctxN / ctxMax) : null;
        // The open pi's cache; a closed session's as its pi last said (rememberCaches).
        const cache = meta ? { until: meta.cacheUntil, ttl: meta.cacheTtl } : this.sessCache[id] ?? null;
        const title = info.name || info.first || "Untitled session";
        const live = Boolean(addr);
        const focusedRow = Boolean(agent?.focused);
        items.push({
          h: H_ROW,
          id,
          el: v_flex()
            .id(`${gid}-${id}`)
            .relative()
            .h(H_ROW)
            .px(8)
            .py(6)
            .gap(2)
            .flex_none()
            .rounded(8)
            .when(focusedRow, (el) => el.bg(t.selected))
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .tooltip(info.name && info.first ? info.first : title)
            .on_click((_e, cx) => {
              if (pane) run("pane.focus", { pane });
              else if (live) this.openSessionPeek(addr, space.id, title);
              else if (!starting) this.openSession(cx, { id, space: space.id, folder: info.cwd || cwd, title });
              cx.notify();
            })
            .child(h_flex()
              .h(20)
              .gap(9)
              .items_center()
              // The open pi's status in the provider icon's column; empty when none.
              .child(h_flex().w(18).flex_none().items_center().justify_center()
                .when(Boolean(agent), (el) => el.child(this.status(t, agent, true)))
                .when(starting, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.dim).spin(900))))
              // Every title reads the same; the status says which pi has it open.
              .child(div().flex_1().min_w(0).truncate().text_size(13)
                .font_medium()
                .text_color(t.foreground)
                .child(title)))
            .child(h_flex()
              .h(18)
              .gap(9)
              .items_center()
              .text_size(12)
              .child(h_flex().w(18).flex_none().items_center().justify_center()
                .when(Boolean(pic), (el) => el.child(pic)))
              .child(h_flex().flex_1().min_w(0).gap(4).items_center().font_family(mono).text_size(10.5)
                .child(div().min_w(0).truncate().text_color(live ? t.muted : t.dim).child(model))
                .when(Boolean(level), (el) => el.child(effort(level))))
              .child(h_flex().flex_none().gap(7).items_center()
                .when(Boolean(ctx), (el) => el.child(this.ctxText(t, `${gid}-${id}`, ctx, full, ctxMax, mono, cacheTint(cache))))
                .child(h_flex().w(26).flex_none().justify_end().items_center()
                  .child(div().font_family(mono).text_size(10.5).text_color(t.dim).child(clock(mtime))))))
            // Every session is a pi's: the bar shows on each, filled when its window is known.
            .child(this.ctxBar(t, dark, full, `${gid}-${id}`, cacheTick(`${gid}-${id}`, cache))),
        });
      }
      if (files.length < dir.total) {
        const left = dir.total - files.length;
        items.push({
          h: H_SUB,
          el: h_flex()
            .id(`${gid}-more`)
            .h(H_SUB)
            .px(8)
            .gap(6)
            .rounded(6)
            .items_center()
            .text_size(11.5)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => {
              this.sessLimit[space.id] = limit + SESSION_PAGE;
              cx.notify();
            })
            .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none())
            .child(`${Math.min(SESSION_PAGE, left)} more · ${left} left`),
        });
      }
    }
    return items;
  }
}

// One folder, two panels: the layout's props pick which this copy is.
export default class WierdAgents extends View {
  init(p, cx) {
    this.panel = props()?.panel === "spaces" ? new Spaces() : new Agents();
    this.panel.init?.(p, cx);
  }

  render(cx) {
    return this.panel.render(cx);
  }

  async close(cx) {
    await this.panel.close?.(cx);
  }
}
