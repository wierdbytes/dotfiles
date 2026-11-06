// Agent rows and pi's sessions for the sidebar's one panel (spaces.js), and the
// session peek bar (props {peekBar}).
//
// Each agent reads in two lines: its status and its task; then what it runs with
// (the provider's mark, model and @effort from @wierdbytes/pi-herdr's labels, else
// its program), its sub-agents and terminals, its context size and how long it has
// been like this. Under that line, a thin bar fills with the share of the model's
// window in use, green, then yellow past 60% and red past 80%; a tick on it slides
// from its right end to its left as the prompt cache runs out, and the context
// size reads green while the cache is warm, yellow in its last 30s. Parents take
// their most urgent sub-agent's place; a viewed done agent stays with Done until left.
//
// Under a space, each tab is a group: its agents (most urgent first), then its
// other panes, one line each: the process in front by its own name (zsh, lazygit,
// ping), and on the right the folder it works in. Tabs with agents come first,
// by their most urgent agent; then the rest in order.
//
// A space's sessions button turns the panel into that space's pi sessions, newest
// first, the next page coming in at the end of the list. One is opened in a peek
// panel (Keep: a tab of its space; closing: that pi ends), or gone to if a pi has it open.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, spaces, panes, run, theme, openOverlay, closeOverlay, props, settings, exec, hc, home, appHome, notify } from "herdr";
import { agentMeta, shortModel, providerOf, tokens, duration, nextTick, effortColor, ctxColor, maxGradient, cacheLeft, cacheState, cacheColor, CACHE_WARN_MS } from "./meta.js";
import { narrow, place, RANK, kidStatus, isAgent, tree, statusMark } from "./kit.js";

// The context size's slot ("69.2k" in the mono face); a pi with no context yet
// keeps this much room, so the badges don't jump when the number shows up.
const CTX_W = 34;
// The context bar under a row's second line, in the row's bottom padding: its
// thickness, how far it sits above the row's edge, and the fill's opacity (hex
// alpha over the track): the statusline's colors, toned down for a quiet list.
const BAR_H = 2, FILL_ALPHA = "99";
// The bar's inset from its row's sides, and how far it sits above the row's
// bottom.
export const BAR_INSET = 8, BAR_BOTTOM = 3;
// The cache tick: its width, how far it rises above the bar, and how often the
// list aims it anew (it slides between those aims natively, so the list redraws
// only this often).
const TICK_W = 2, TICK_UP = 4, TICK_STEP = 5000;
// The list's width less the tick's lane: the list's padding (8 + 8), the bar's
// inset in its row (8 + 8) and the tick's own width; plus what the panel puts
// around a row (`owner.rowInset`: a card's sides).
const TICK_LANE_INSET = 32 + TICK_W;
// Row heights in the list (px at zoom 1): the list scrolls itself (scroll.js),
// so it places rows by these.
const H_ROW = 52, H_SUB = 26, H_PANE = 28;
// Sessions at first, and how many more each step brings.
const SESSION_PAGE = 10;
// How often the shown sessions are read again (new sessions, names).
const SESSION_POLL_MS = 10000;
// A session just opened: no second pi for it while its labels are on the way.
const LAUNCH_GRACE_MS = 15000;

// A model id as people say it, as the agent rows show names:
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

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// A path as people write it: ~ for home.
const tilde = (path) => {
  const h = home();
  return path && h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
};
const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || path;
// Where a shell is, as it says itself (user@host:~/x); right on another machine too.
const shellPath = (p) => p.title?.match(/^[^\s@]+@[^\s:]+:\s*(.+)$/)?.[1]?.trim() || null;
// A pane's folder: what its shell says, else where the process in front works
// (terminals()' foreground), else the pane's live folder.
const paneWhere = (p, term) => (p.program?.shell ? shellPath(p) : null) ?? tilde(term?.foreground?.cwd ?? p.cwd);
// The process in front in a terminal by its own name: argv[0], what a program
// calls itself (pi, not node), a login shell's "-" dropped; else the process's
// name, else what the terminal was started with. Not the program table's names.
const procName = (term) => {
  const fg = term?.foreground;
  const own = (argv) => base(argv?.[0] ?? "").replace(/^-/, "");
  return own(fg?.argv) || fg?.name || own(term?.argv) || null;
};
// A path cut to `max` letters from the middle: ~/…/slides/deck.
function shortPath(path, max) {
  if (!path || path.length <= max) return path;
  const parts = path.split("/");
  const head = parts[0] === "~" ? "~/…/" : "…/";
  let tail = parts.pop();
  while (parts.length > 1 && head.length + parts.at(-1).length + 1 + tail.length <= max) tail = `${parts.pop()}/${tail}`;
  return head.length + tail.length <= max ? head + tail : `…${tail.slice(-(max - 1))}`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The mark of the provider serving the agent's model (Anthropic, OpenCode Go, OpenRouter).
function providerIcon(mark, size, color) {
  return mark ? svg(`mods/wierd-agents/providers/${mark}.svg`).size(size).flex_none().text_color(color) : null;
}

// The agents' and sessions' side of the panel. The panel (spaces.js) owns the
// list (`owner`: its size) and asks for rows: prepare() once per render, then
// agentItems() per agent, or sessionItems() for the space whose sessions show.
export class Agents {
  init(_props, cx) {
    if (props()?.peekBar) {
      // The panel takes the keyboard, not its pi: Esc closes it, Enter keeps it.
      // The terminal gets it when clicked. Focus once the overlay is up, and
      // again in case the terminal took it while opening.
      this.keys = cx.focus_handle();
      cx.timer.after(30, () => this.keys.focus());
      cx.timer.after(250, () => this.keys.focus());
      return;
    }
    // Agents whose sub-agents are listed.
    this.open = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
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
    // The space whose sessions the panel shows; null: the spaces and their agents.
    this.sessionsFor = null;
    cx.timer.every(300, (cx) => {
      if (!this.sessionsFor || narrow()) return;
      // The first pages don't fill the list: the next one comes in, as at its end.
      if (this.sessShort) this.moreAtEnd(cx);
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

  // The list's width, for the cache tick: the panel's (scroll.js measures it).
  get viewW() {
    const w = this.owner?.viewW;
    return w > 0 ? w - (this.owner.rowInset ?? 0) : w;
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

  // A session opened from the sessions list runs in a terminal of its own, shown
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

  // This class draws on its own only as the peek bar.
  render() {
    return this.peekBar(theme());
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

  // compact: a ! for blocked instead of the "Needs you" pill (kit.js's marks).
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
  // that pi ends, nothing refreshes the cache, so the sessions list still knows
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
      .left(BAR_INSET)
      .right(BAR_INSET)
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

  // What every row needs this render: the agents of each space (pinned first,
  // then by urgency: needs you, done, working, idle; then the latest change),
  // and the clock. The panel calls it once per render, then asks for rows;
  // afterwards it hands `R.due` back (the next moment a shown time changes).
  prepare(t) {
    const now = Date.now();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const byAddr = new Map(all.map((x) => [x.address, x]));
    this.migratePins(all);
    this.rememberCaches(all, now);
    this.track(list, now);
    this.hold(list);
    const trees = new Map(list.map((a) => [a.address, tree(all, a.address)]));
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const perTab = new Map();
    for (const a of list) perTab.set(a.tab, (perTab.get(a.tab) ?? 0) + 1);
    this.solo = new Map(list
      .filter((a) => perTab.get(a.tab) === 1 && !trees.get(a.address).some((s) => isAgent(s.t)))
      .map((a) => [a.address, tabs.get(a.tab)])
      .filter(([, tab]) => tab));
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...trees.get(a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const pin = (a) => (a.pinned ? 1 : 0);
    list = [...list].sort((x, y) => pin(y) - pin(x) || urgency.get(y.address) - urgency.get(x.address) || this.since(y) - this.since(x) || y.seq - x.seq);

    // Each space's tabs as groups: { tab, agents (in that order), others (its other
    // panes, in pane order), panes }. Tabs with agents first, by their first agent;
    // the rest in tab order.
    const order = (x, y) => pin(y) - pin(x) || urgency.get(y.address) - urgency.get(x.address) || this.since(y) - this.since(x) || y.seq - x.seq;
    const agentsOf = new Map();
    for (const a of list) {
      if (!agentsOf.has(a.tab)) agentsOf.set(a.tab, []);
      agentsOf.get(a.tab).push(a);
    }
    const panesOf = new Map();
    for (const p of panes()) {
      if (!panesOf.has(p.tab)) panesOf.set(p.tab, []);
      panesOf.get(p.tab).push(p);
    }
    const groups = new Map();
    for (const s of spaces()) {
      const busy = [], quiet = [];
      for (const tab of s.tabs ?? []) {
        const mine = agentsOf.get(tab.id) ?? [];
        const theirs = new Set(mine.map((a) => a.pane));
        const others = (panesOf.get(tab.id) ?? []).filter((p) => !theirs.has(p.pane));
        const g = { tab, agents: mine, others, panes: mine.length + others.length };
        if (g.panes) (mine.length ? busy : quiet).push(g);
      }
      busy.sort((g, h) => order(g.agents[0], h.agents[0]));
      groups.set(s.id, [...busy, ...quiet]);
    }

    const mono = settings().font_family ?? "JetBrains Mono";
    const dark = settings().dark !== false;
    const R = { t, now, list, groups, byAddr, tabs, trees, mono, dark, shown: focused()?.agent, due: null };

    // The earliest moment a shown time reads differently; the timer redraws then.
    R.wake = (at) => {
      if (R.due == null || at < R.due) R.due = at;
    };
    R.clock = (since) => {
      R.wake(nextTick(since, now));
      return duration(now - since);
    };
    // The prompt cache's tick (pi-herdr's agent.cache_until / agent.cache_ttl):
    // the share of its lifetime left, from the bar's right end (just refreshed)
    // to its left (expiring); gone once it expires. Each render aims it at where
    // it will be at the next TICK_STEP boundary (the last one: the expiry) and it
    // slides there natively; the redraw at that boundary aims it further. Other
    // redraws keep the same aim, so a slide is never retargeted. A refresh, a new
    // lifetime, or a pause in redraws jumps it to where it belongs.
    R.cacheTick = (key, cache) => {
      const until = cache?.until, ttl = cache?.ttl;
      if (cacheLeft(until, ttl, now) == null) {
        delete this.tickAim[key];
        return null;
      }
      const next = Math.min(until, (Math.floor(now / TICK_STEP) + 1) * TICK_STEP);
      R.wake(next);
      const aim = this.tickAim[key];
      if (aim?.next === next && aim.until === until && aim.ttl === ttl) return aim;
      const left = cacheLeft(until, ttl, next) ?? 0;
      const follows = aim?.until === until && aim.ttl === ttl && left <= aim.left && aim.left - left <= (1.5 * TICK_STEP) / ttl;
      return (this.tickAim[key] = { until, ttl, next, left, ms: follows ? Math.max(0, next - now) : 0 });
    };
    // The context size's color by the cache's expiry, and a redraw when it
    // turns yellow and when it goes.
    const two = (n) => String(n).padStart(2, "0");
    R.cacheTint = (cache) => {
      const until = cache?.until;
      const state = cacheState(until, now);
      if (state === "warm") R.wake(until - CACHE_WARN_MS);
      if (state) R.wake(until);
      const at = until ? new Date(until) : null;
      const note = !until ? null : state ? `cache till ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` : "cache expired";
      return { color: cacheColor(state, t, dark), note };
    };
    // `@effort` in pi-statusline's colors; max shades letter by letter.
    R.effort = (word) => {
      const text = `@${word}`;
      if (word !== "max") return div().flex_none().text_color(effortColor(word, t, dark)).child(text);
      return h_flex().flex_none().children(maxGradient(text).map(([g, c]) => div().when(Boolean(c), (el) => el.text_color(c)).child(g)));
    };
    // What the agent is on: its own word (pi's session name, a question while
    // blocked), else a tab someone named, else a telling terminal title.
    R.label = (a) => {
      const msg = clean(byAddr.get(a.address)?.report?.msg);
      if (msg) return msg;
      const tab = tabs.get(a.tab);
      if (tab?.named && tab.name !== a.program?.name) return tab.name;
      const live = clean(a.title);
      if (telling(live, a.program)) return live;
      return a.program?.name || a.tab_name || a.address;
    };
    return R;
  }

  // A tab's rows: its agents (each with its open sub-agents), then a line for each
  // of its other panes. [{ el, h, pane?, addr? }]
  groupItems(R, g) {
    return [
      ...g.agents.flatMap((a) => this.agentItems(R, a)),
      ...g.others.map((p) => this.paneLine(R, p)),
    ];
  }

  // The pane's icon: its program's, a terminal for one without, a page for a mod.
  paneIcon(t, p, color) {
    if (!p.terminal) return svg("mods/workspace-chrome/file-text.svg").size(14).flex_none().text_color(color);
    return icon(p.program, 14, color) ?? svg("mods/workspace-chrome/terminal.svg").size(14).flex_none().text_color(color);
  }

  // A pane that isn't an agent, in one line: the process in front by its own
  // name (zsh, lazygit, ping; a mod pane: its title), and on the right the
  // folder it works in, shortened from the middle to fit.
  paneLine(R, p) {
    const { t, mono } = R;
    const term = p.terminal ? R.byAddr.get(p.terminal) : null;
    const name = p.terminal ? procName(term) || p.terminal : p.title || p.mod || "Panel";
    const where = p.terminal ? paneWhere(p, term) : null;
    // Room for the folder: the row less its padding, icon, gaps and the name
    // (about 7px a letter in the UI face, 6.4 in the mono face at these sizes).
    const room = (this.viewW > 0 ? this.viewW : 268) - 16 - 16 - 18 - 9 - Math.min(150, name.length * 7) - 9;
    const shown = where ? shortPath(where, Math.max(8, Math.floor(room / 6.4))) : null;
    return {
      pane: p.pane,
      h: H_PANE,
      el: h_flex()
        .id(`pn-${p.pane}`)
        .h(H_PANE)
        .px(8)
        .gap(9)
        .flex_none()
        .items_center()
        .rounded(8)
        .when(p.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => run("pane.focus", { pane: p.pane }))
        .child(h_flex().w(18).flex_none().items_center().justify_center().child(this.paneIcon(t, p, t.muted)))
        .child(div().flex_none().max_w(150).truncate().text_size(13).text_color(t.foreground).child(name))
        .child(div()
          .id(`pn-cwd-${p.pane}`)
          .flex_1()
          .min_w(0)
          .truncate()
          .text_right()
          .font_family(mono)
          .text_size(10.5)
          .text_color(t.dim)
          .when(Boolean(where), (el) => el.tooltip(where))
          .child(shown ?? "")),
    };
  }

  // An agent's row and, when opened, its sub-agents and terminals: [{ el, h, addr?, pane? }].
  agentItems(R, a) {
    const subs = R.trees.get(a.address) ?? [];
    const r = { el: this.row(R, a, subs), h: H_ROW, addr: a.address, pane: a.pane };
    if (!this.open.has(a.address) || subs.length === 0) return [r];
    return [r, ...subs.map((s) => ({ el: this.subRow(R.t, s, R.shown, false), h: H_SUB }))];
  }

  row(R, a, subs) {
    const { t, byAddr, mono, dark } = R;
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
        // The status sits in the space avatar's column, the provider icon's below.
        .child(h_flex().w(18).flex_none().items_center().justify_center().child(this.status(t, a, true)))
        // Every title reads the same; the status and the line below say which are quiet.
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.foreground).child(R.label(a))))
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
          .when(Boolean(meta?.effort), (el) => el.child(R.effort(meta.effort))))
        .child(h_flex().flex_none().gap(7).items_center()
          .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
          .when(kidAgents + inner > 0, (el) => el.child(this.badge(t, `subs-${a.address}`, "git-branch", kidAgents + inner, subTip, kidAgents > 0 ? toggle : null, open)))
          .when(kidTerms > 0, (el) => el.child(this.badge(t, `terms-${a.address}`, "terminal", kidTerms, plural(kidTerms, "terminal"), toggle, open)))
          // A pi keeps the number's place before its first prompt, so the
          // badges don't jump when it shows up.
          .when(Boolean(ctx), (el) => el.child(this.ctxText(t, a.address, ctx, full, meta.ctxMax, mono, R.cacheTint(cache))))
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
              .child(R.clock(when)))))))
      // Every pi has the bar, filled once it knows its context and window.
      .when(Boolean(meta), (el) => el.child(this.ctxBar(t, dark, full, a.address, R.cacheTick(a.address, cache))));
  }

  // ---- Sessions ------------------------------------------------------------

  // Where a space's sessions are: pi's, on this machine, in the folder the space
  // is in now. Null for a space on another machine (no button there).
  sessionPlace(space, ps = panes()) {
    if (!space || space.machine) return null;
    return place(space, ps) || null;
  }

  // The panel shows a space's sessions from the first page, read at once.
  showSessions(space, cx) {
    this.sessionsFor = space.id;
    delete this.sessLimit[space.id];
    this.sessShort = false;
    this.wantSessions(space);
    this.refreshSessions(cx);
    cx.notify();
  }

  hideSessions() {
    this.sessionsFor = null;
    this.sessShort = false;
  }

  // What the sessions list asks of sessions.mjs: the space's folder and how many.
  wantSessions(space) {
    const cwd = this.sessionPlace(space);
    const limit = this.sessLimit[space.id] ?? SESSION_PAGE;
    this.sessReq = cwd ? [{ cwd, limit }] : [];
    this.sessWant = JSON.stringify(this.sessReq);
    return cwd ? { cwd, limit } : null;
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

  // At the end of the list (or the list doesn't fill the panel): the next page,
  // once the last one is in.
  moreAtEnd(cx) {
    const last = this.sessShown?.at(-1);
    if (!last || this.sessBusy || this.sessHave !== this.sessWant || last.shown >= last.total) return;
    this.sessLimit[last.space] = last.limit + SESSION_PAGE;
    cx.notify();
  }

  // How many sessions a space's folder has, once read.
  sessionCount(space) {
    const cwd = this.sessionPlace(space);
    return cwd ? this.sessDirs[cwd]?.total ?? null : null;
  }

  // A space's sessions, newest first, then a row while the next page comes in.
  // A session pi has open shows that agent's status and goes to it; one nobody
  // has open starts `pi --session <id>` in the peek panel.
  sessionItems(R, space) {
    const { t, now, byAddr, mono, dark } = R;
    const gid = `ss-${space.id}`;
    const want = this.wantSessions(space);
    this.sessShown = [];
    const items = [];
    const note = (key, text) => items.push({
      h: H_SUB,
      el: div().id(`${gid}-${key}`).h(H_SUB).px(8).flex().items_center().text_size(11.5).text_color(t.dim).child(text),
    });
    if (!want) {
      note("nowhere", "This space has no folder on this computer.");
      return items;
    }
    const { cwd, limit } = want;

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

    const dir = this.sessDirs[cwd];
    if (!dir) {
      note("wait", this.sessError ? `Can't read sessions: ${this.sessError}` : "Reading sessions…");
      return items;
    }
    if (dir.total === 0) {
      note("none", "No pi sessions in this folder.");
      return items;
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
      // Effort and context as the agent rows show them: the open pi's, else the
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
              .when(Boolean(level), (el) => el.child(R.effort(level))))
            .child(h_flex().flex_none().gap(7).items_center()
              .when(Boolean(ctx), (el) => el.child(this.ctxText(t, `${gid}-${id}`, ctx, full, ctxMax, mono, R.cacheTint(cache))))
              .child(h_flex().w(26).flex_none().justify_end().items_center()
                .child(div().font_family(mono).text_size(10.5).text_color(t.dim).child(R.clock(mtime))))))
          // Every session is a pi's: the bar shows on each, filled when its window is known.
          .child(this.ctxBar(t, dark, full, `${gid}-${id}`, R.cacheTick(`${gid}-${id}`, cache))),
      });
    }
    // More to come: it comes in by itself at the end of the list; a click asks at once.
    if (files.length < dir.total) {
      const left = dir.total - files.length;
      const loading = this.sessBusy || this.sessHave !== this.sessWant;
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
          .when(loading, (el) => el
            .child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().spin(900))
            .child(`Loading… · ${left} more`))
          .when(!loading, (el) => el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.moreAtEnd(cx))
            .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none())
            .child(`${Math.min(SESSION_PAGE, left)} more · ${left} left`)),
      });
    }
    return items;
  }
}
