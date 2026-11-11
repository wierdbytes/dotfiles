// Agent rows and pi's sessions for the sidebar's one panel (spaces.js), and the
// session peek bar (props {peekBar}).
//
// Each agent is a card tinted by its status (working, done, needs you, in its
// mark's color; idle plain; the focused one ringed in accent), nothing animated
// but its move when the order changes (spaces.js slides it).
// It reads in two lines: its status and its task; then what it runs with
// (the provider's mark, model and @effort from @wierdbytes/pi-herdr's labels, else
// its program), its sub-agents and terminals, its context size and how long it has
// been like this. Under that line, a thin bar fills with the share of the model's
// window in use, green, then yellow past 60% and red past 80%; a tick on it steps
// from its right end to its left as the prompt cache runs out, and the context
// size reads green while the cache is warm, yellow in its last 30s. Parents take
// their most urgent sub-agent's place; a viewed done agent stays with Done until left.
//
// Its sub-agents (hc run) show under it, unfolded unless its bot chip folds them,
// joined to it by a tree line. Each reads in two lines like its parent: its status
// and what it's on (its own word, else a telling title, else its name); then its
// model and @effort on the left, its context size and how long it has been in its
// state on the right, in the parent's columns. Plain terminals it started get one
// line: their program's icon and name. A click peeks at one over the window (the
// session peek's bar: Keep makes it a tab right after its parent's, in the parent's
// space); one kept that way is still its parent's child: it stays under it in the
// list (and counts in its space), not a row of its own tab, and a click goes to it.
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
import { agents, terminals, focused, spaces, panes, run, theme, openOverlay, closeOverlay, props, settings, exec, hc, home, appHome, notify, shared, setShared } from "herdr";
import { agentMeta, shortModel, providerOf, tokens, duration, nextTick, effortColor, ctxColor, maxGradient, cacheLeft, cacheState, cacheColor, CACHE_WARN_MS } from "./meta.js";
import { narrow, place, RANK, kidStatus, isAgent, tree, statusMark, statusTint, focusRing } from "./kit.js";

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
// The cache tick: its width, how far it rises above the bar, and the least time
// between its steps. It steps a pixel at a time with no transition: a transition
// lasting the cache's whole life keeps the window redrawing every frame (~25% GPU
// for as long as any cache is warm). One redraw per pixel is ~1/s for a 5m cache.
const TICK_W = 2, TICK_UP = 4, TICK_MIN_STEP = 1000;
// The list's width less the tick's lane: the list's padding (8 + 8), the bar's
// inset in its row (8 + 8) and the tick's own width; plus what the panel puts
// around a row (`owner.rowInset`: a card's sides).
const TICK_LANE_INSET = 32 + TICK_W;
// Row heights in the list (px at zoom 1): the list scrolls itself (scroll.js),
// so it places rows by these.
const H_ROW = 52, H_SUB = 26, H_PANE = 28;
// A sub-agent's row: two lines (20 + 16) and a little room above and below. Its
// first line's middle is a plain sub-row's (13), so the tree's elbows line up.
const H_KID = 42, KID_PAD = 3, KID_MID = 13;
// A tree line's column: its width, the room after it, its stroke and how far it
// reaches up into the room between rows (a card's CARD_PAD).
const TREE_W = 9, TREE_GAP = 4, TREE_STROKE = 1.5, TREE_UP = 4;
// The room between an agent's row and each of its children's (spaces.js's
// CARD_PAD, the room between rows in a card), and how long they take to fold in
// or out.
const ROW_GAP = 4, FOLD_MS = 200;
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

// What a sub-agent is on, as an agent's row says it: its own word (pi's session
// name), else a telling title, else its name (hc run --name), else its program's.
function kidLabel(k) {
  const msg = clean(k.report?.msg);
  if (msg) return msg;
  const live = clean(k.title);
  if (telling(live, k.program)) return live;
  return k.name || k.template || k.program?.name || k.address;
}

// Where a child of an agent goes when kept: a tab next to its nearest ancestor
// with a pane (through live terminals). -> { addr, space, tab, pane, label } or null.
// What's been kept and waits for its tab to show up, to be moved next to its
// ancestor's (placeKept): terminal -> { after: that tab, root: that ancestor, at }.
const KEEP = "wierd.agents.keepBeside";
const KEEP_WAIT_MS = 20000;
function homeOf(addr, all = terminals()) {
  const byAddr = new Map(all.map((k) => [k.address, k]));
  const ps = panes();
  const spaceOf = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, s.id])));
  let up = byAddr.get(addr)?.parent;
  const seen = new Set();
  while (up && !seen.has(up)) {
    seen.add(up);
    const p = byAddr.get(up);
    if (p?.state !== "live") return null;
    const pane = ps.find((x) => x.terminal === up);
    if (pane && spaceOf.has(pane.tab)) return { addr: up, space: spaceOf.get(pane.tab), tab: pane.tab, pane: pane.pane, label: kidLabel(p) };
    up = p.parent;
  }
  return null;
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
    // Agents whose sub-agents are hidden (their bot chip folded them); the rest
    // show theirs.
    this.folded = new Set();
    // Agents folded a moment ago: until when their sub-agents' rows stay, while
    // the box closes over them.
    this.foldUntil = {};
    // Sub-agents' state changes as the core stamped them: address -> { s, at },
    // and the (address, state)s already asked about.
    this.kidStamps = {};
    this.stampAsked = new Set();
    cx.timer.every(500, (cx) => this.askStamps(cx));
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

  // A sub-agent's: the core stamps each status change (`hc get`'s status_ms;
  // terminals() leaves it out, see askStamps); this list's own stamp is when it
  // saw it. The earlier of the two, as since() does. `s`: its status as it reads.
  kidSince(k, s) {
    const seen = this.changed[k.address]?.at || 0;
    const core = this.kidStamps[k.address];
    const app = core?.s === s ? core.at : 0;
    return app && (!seen || app < seen) ? app : seen;
  }

  // Asks the core when each listed sub-agent got into its state, once per state
  // (`this.kidWant`: prepare()'s [{ address, status }]); a redraw when one is in.
  askStamps(cx) {
    for (const { address, status } of this.kidWant ?? []) {
      const key = `${address}\n${status}`;
      if (this.kidStamps[address]?.s === status || this.stampAsked.has(key)) continue;
      this.stampAsked.add(key);
      cx.spawn(async (cx) => {
        try {
          const r = await hc(["get", address, "--json"]);
          const k = JSON.parse(r.stdout);
          const s = kidStatus({ address, status: k.status?.state ?? k.status }, new Map());
          if (k.status_ms > 0 && s) {
            this.kidStamps[address] = { s, at: k.status_ms };
            cx.notify();
          }
        } catch {}
      });
    }
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
  // A sub-agent peeked at from its row (`sub`) gets the same bar: Keep makes it a
  // tab of its parent's space (the nearest ancestor with a pane), right after the
  // parent's tab (and its other kept children's there); the list still shows it
  // under its parent. Closing leaves it running.
  // Props: { peekBar, sub?, terminal, space, title, overlay }.
  peekBar(t) {
    const { terminal, space, overlay, sub } = props();
    const all = terminals();
    const term = all.find((x) => x.address === terminal);
    const status = kidStatus(term ?? {}, new Map(agents().map((a) => [a.address, a.status])));
    const meta = agentMeta(term);
    const mark = providerOf(meta);
    const pic = providerIcon(mark, 13, t.muted) ?? icon(term?.program, 14, t.muted);
    const name = spaces().find((s) => s.id === space)?.name;
    const home = sub ? homeOf(terminal, all) : null;
    const parent = sub && term?.parent ? all.find((x) => x.address === term.parent) : null;
    const title = sub ? (term ? kidLabel(term) : terminal) : props().title;
    const keep = () => {
      this.kept = true;
      if (home) {
        // A tab of the parent's space; the sidebar moves it next to the parent's
        // once it's there (placeKept): the tab's id isn't known before.
        setShared(KEEP, { ...(shared(KEEP) ?? {}), [terminal]: { after: home.tab, root: home.addr, at: Date.now() } });
        run("space.select", { id: home.space });
        run("tab.select", { id: home.tab });
        run("terminal.keep", { terminal });
      } else {
        if (space) run("space.select", { id: space });
        run("terminal.keep", { terminal });
      }
      closeOverlay(overlay);
    };
    const keepTip = sub
      ? (home ? `Keep it in a tab next to ${home.label}` : "Keep it as a tab")
      : `Keep it as a tab${name ? ` in ${name}` : ""}`;
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
      .when(Boolean(parent), (el) => el.child(div().flex_none().max_w(260).truncate().text_color(t.dim).child(`from ${kidLabel(parent)}`)))
      .child(div().flex_1())
      .child(button("peek-keep", [div().child("Keep"), kbd("↵", t.accent_foreground)], keepTip, keep, true))
      .child(button("peek-close", [div().child("✕"), kbd("esc", t.dim)], sub ? "Close (it keeps running)" : "Close and end this pi", () => closeOverlay(overlay)));
  }

  // This class draws on its own only as the peek bar.
  render() {
    return this.peekBar(theme());
  }

  // The peek panel going away without Keep ends its pi: the session is saved.
  // Not a sub-agent's: it works for its parent.
  async close() {
    const p = props();
    if (p?.peekBar && !p.sub && !this.kept && p.terminal) await hc(["kill", p.terminal]);
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

  // A child of an agent, from its row: its pane when it has one (kept), else a
  // look at it over the window, with Keep and Close (peekBar's `sub`).
  peek(addr) {
    const pane = panes().find((p) => p.terminal === addr)?.pane;
    if (pane) {
      run("pane.focus", { pane });
      return;
    }
    openOverlay({
      kind: "dialog",
      width: 0.82,
      height: 0.82,
      layout: {
        type: "column",
        children: [
          { id: "peek-bar", type: "block", size: { px: 38 }, content: { mod: "wierd-agents", props: { peekBar: true, sub: true, terminal: addr } } },
          { id: "peek-term", type: "block", content: { terminal: addr } },
        ],
      },
    });
  }

  // The tree lines in front of a child's row, one column per level, as tall as
  // the row: ├ and └ an elbow into its first line's middle (`mid`); ├ and │ go on
  // down to the row's end, and every line reaches up into the room above, so
  // siblings join into one line.
  treeLines(t, lines, h, mid) {
    // As wide as the column: a box only as wide as its border doesn't draw it.
    const stroke = (el) => el.absolute().left(0).w(TREE_W).border_color(t.input).border_l(TREE_STROKE);
    return lines.map((l) => div()
      .relative()
      .w(TREE_W)
      .h(h)
      .mr(TREE_GAP)
      .flex_none()
      .when(l === "└" || l === "├", (el) => el.child(stroke(div())
        .top(-TREE_UP)
        .h(mid + TREE_UP)
        .border_b(TREE_STROKE)
        .rounded_bl(6)))
      .when(l === "├" || l === "│", (el) => el.child(stroke(div())
        .top(l === "│" ? -TREE_UP : mid - 6)
        .bottom(0))));
  }

  // Kept children (peekBar's Keep) whose tab has shown up: each moves right after
  // its ancestor's tab, past that ancestor's other kept children's tabs already
  // there, once. Called by the sidebar on render (`R`: prepare()'s).
  placeKept(R) {
    const want = shared(KEEP);
    if (!want || !Object.keys(want).length) return;
    const now = Date.now();
    const left = { ...want };
    const ps = panes();
    for (const [addr, w] of Object.entries(want)) {
      const pane = ps.find((p) => p.terminal === addr);
      if (!pane) {
        // Not there yet; given up on after a while (the keep failed).
        if (now - (w.at ?? 0) > KEEP_WAIT_MS) delete left[addr];
        continue;
      }
      delete left[addr];
      const space = spaces().find((s) => (s.tabs ?? []).some((tab) => tab.id === pane.tab));
      if (!space) continue;
      const ids = space.tabs.map((tab) => tab.id);
      const rest = ids.filter((id) => id !== pane.tab);
      let at = rest.indexOf(w.after);
      // In another space, or the parent's tab is gone: it stays where it is.
      if (at < 0) continue;
      const kin = new Set((R.trees.get(w.root) ?? []).map((s) => s.t.address));
      const kinTab = (id) => {
        const its = ps.filter((p) => p.tab === id);
        return its.length > 0 && its.every((p) => p.terminal && kin.has(p.terminal));
      };
      while (at + 1 < rest.length && kinTab(rest[at + 1])) at++;
      if (ids.indexOf(pane.tab) !== at + 1) run("tab.move", { id: pane.tab, index: at + 2 });
    }
    // Only when something went: a write redraws every copy, this one too.
    if (Object.keys(left).length !== Object.keys(want).length) setShared(KEEP, left);
  }

  // A child's row is lit while it's shown: peeked at, or its pane (kept) focused.
  kidOn(R, k) {
    const pane = R.paneOf.get(k.address);
    return k.address === R.shown || (pane != null && pane === R.focusedPane);
  }

  // A child of an agent: a sub-agent in two lines, a plain terminal in one.
  subRow(R, s) {
    return isAgent(s.t) ? this.kidRow(R, s) : this.termRow(R, s);
  }

  // A terminal an agent started: its program's icon and name.
  termRow(R, s) {
    const { t } = R;
    const k = s.t;
    const pic = icon(k.program, 14, t.foreground) ?? svg("mods/workspace-chrome/terminal.svg").size(14).flex_none().text_color(t.muted);
    const on = this.kidOn(R, k);
    return {
      h: H_SUB,
      el: h_flex()
        .id(`sub-${k.address}`)
        .pl(17)
        .pr(8)
        .rounded(8)
        .h(H_SUB)
        .flex_none()
        .items_center()
        .text_size(12.5)
        .when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.peek(k.address))
        .children(this.treeLines(t, s.lines, H_SUB, H_SUB / 2))
        .child(h_flex().w(14).mr(8).flex_none().justify_center().child(pic))
        .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address)),
    };
  }

  // A sub-agent, read like its parent: its status where its program's icon was
  // and what it's on; under that its model and @effort, and on the right its
  // context size and how long it has been in its state, in its parent's columns.
  kidRow(R, s) {
    const { t, mono } = R;
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = this.kidOn(R, k);
    const quiet = st === "idle" && !on;
    const meta = agentMeta(k);
    const mark = providerOf(meta);
    const model = meta?.model ? shortModel(meta.model, mark) : k.program?.name ?? "";
    const ctx = meta?.ctx > 0 ? tokens(meta.ctx) : null;
    const full = ctx && meta?.ctxMax ? Math.min(1, meta.ctx / meta.ctxMax) : null;
    const cache = meta ? { until: meta.cacheUntil, ttl: meta.cacheTtl } : null;
    const when = this.kidSince(k, st);
    const name = k.name || k.template || k.address;
    // The status's column and the room after it; the second line keeps it empty,
    // so the model starts under the title.
    const lead = (child) => h_flex().w(14).mr(8).flex_none().items_center().justify_center().when(Boolean(child), (el) => el.child(child));
    return {
      h: H_KID,
      el: h_flex()
        .id(`sub-${k.address}`)
        .pl(17)
        .pr(8)
        .rounded(8)
        .h(H_KID)
        .flex_none()
        .items_start()
        .when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.peek(k.address))
        .children(this.treeLines(t, s.lines, H_KID, KID_MID))
        .child(v_flex()
          .flex_1()
          .min_w(0)
          .pt(KID_PAD)
          .child(h_flex()
            .h(20)
            .items_center()
            .child(lead(this.status(t, { status: st }, true)))
            .child(div()
              .id(`sub-title-${k.address}`)
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(12.5)
              .text_color(t.foreground)
              .tooltip(`${name} · ${k.address}`)
              .child(R.kidLabel(k))))
          .child(h_flex()
            .h(16)
            .gap(7)
            .items_center()
            .child(h_flex().flex_1().min_w(0).items_center()
              .child(lead(null))
              .child(h_flex().flex_1().min_w(0).gap(4).items_center().font_family(mono).text_size(10.5)
                .child(div().min_w(0).truncate().text_color(quiet ? t.dim : t.muted).child(model))
                .when(Boolean(meta?.effort), (el) => el.child(R.effort(meta.effort)))))
            .when(Boolean(ctx), (el) => el.child(this.ctxText(t, k.address, ctx, full, meta.ctxMax, mono, R.cacheTint(cache))))
            .child(h_flex()
              .w(26)
              .flex_none()
              .justify_end()
              .items_center()
              .when(Boolean(when), (el) => el.child(div()
                .font_family(mono)
                .text_size(10.5)
                .text_color(t.dim)
                .child(R.clock(when))))))),
    };
  }

  // compact: a ! for blocked instead of the "Needs you" pill (kit.js's marks).
  status(t, a, compact = false) {
    return statusMark(t, a.status, compact);
  }

  // A count chip (bot 3, >_ 1); with `toggle` it opens the tree of children under the row.
  // `glyph`: an icon's path under the home folder.
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
      .child(svg(glyph).size(11).flex_none())
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
  // `tick` ({left}): the prompt cache's tick, at `left` (0..1) of the bar; null
  // when the cache is gone or not known.
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
      // bar less its width, so at 100% the tick is still on the bar. In whole px
      // once the list's width is known (see cacheTick), so it moves a pixel a step.
      .when(Boolean(tick), (el) => el.child(div()
        .id(`tick-${key}`)
        .absolute()
        .bottom(0)
        .when(this.viewW > 0, (el) => el.left(Math.round(tick.left * (this.viewW - TICK_LANE_INSET))))
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
    const trees = new Map(list.map((a) => [a.address, tree(all, a.address)]));
    // Sub-agents are stamped too (their rows' clocks), as they read: done is idle.
    const kids = [...trees.values()].flat().filter((s) => isAgent(s.t)).map((s) => ({ address: s.t.address, status: kidStatus(s.t, this.listed) }));
    this.track([...list, ...kids], now);
    this.kidWant = kids;
    this.hold(list);
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
    const ps = panes();
    for (const p of ps) {
      if (!panesOf.has(p.tab)) panesOf.set(p.tab, []);
      panesOf.get(p.tab).push(p);
    }
    // Children of an agent someone kept (they have a pane now) are still its
    // children: they show under it, not as rows of their own tab.
    const nested = new Set([...trees.values()].flat().map((s) => s.t.address));
    const groups = new Map();
    for (const s of spaces()) {
      const busy = [], quiet = [];
      for (const tab of s.tabs ?? []) {
        const here = agentsOf.get(tab.id) ?? [];
        const mine = here.filter((a) => !nested.has(a.address));
        const theirs = new Set(here.map((a) => a.pane));
        const others = (panesOf.get(tab.id) ?? []).filter((p) => !theirs.has(p.pane) && !(p.terminal && nested.has(p.terminal)));
        const g = { tab, agents: mine, others, panes: mine.length + others.length };
        if (g.panes) (mine.length ? busy : quiet).push(g);
      }
      busy.sort((g, h) => order(g.agents[0], h.agents[0]));
      groups.set(s.id, [...busy, ...quiet]);
    }

    const mono = settings().font_family ?? "JetBrains Mono";
    const dark = settings().dark !== false;
    const f = focused();
    const R = {
      t, now, list, groups, byAddr, tabs, trees, mono, dark, due: null,
      shown: f?.agent, focusedPane: f?.pane ?? null,
      // Each kept terminal's pane, and the agents by address.
      paneOf: new Map(ps.filter((p) => p.terminal).map((p) => [p.terminal, p.pane])),
      agentBy: new Map(list.map((a) => [a.address, a])),
    };

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
    // to its left (expiring); gone once it expires. Placed where it is now, with
    // no transition; the list redraws when it would move by a pixel (at least
    // TICK_MIN_STEP apart, and at the expiry, which removes it).
    R.cacheTick = (_key, cache) => {
      const until = cache?.until, ttl = cache?.ttl;
      const left = cacheLeft(until, ttl, now);
      if (left == null) return null;
      // The lane as ctxBar sizes it (asked per row: the panel sets its inset after prepare).
      const lane = this.viewW > 0 ? this.viewW - TICK_LANE_INSET : 0;
      if (lane > 0) {
        // The next moment its whole-px position changes: when the time left
        // crosses the next lower half-pixel (Math.round's boundary).
        const px = Math.round(left * lane);
        const at = until - ((px - 0.5) / lane) * ttl;
        R.wake(Math.min(until, Math.max(now + TICK_MIN_STEP, Math.ceil(at))));
      } else R.wake(Math.min(until, now + TICK_MIN_STEP));
      return { left };
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
    // A sub-agent's, the same way.
    R.kidLabel = kidLabel;
    return R;
  }

  // A tab's rows: its agents (each with its open sub-agents), then a line for each
  // of its other panes. [{ el, h, key, pane?, addr? }] (`key`: the row's own, for
  // the list to see it move).
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
      key: `pn-${p.pane}`,
      pane: p.pane,
      h: H_PANE,
      el: h_flex()
        .id(`pn-${p.pane}`)
        .relative()
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
          .child(shown ?? ""))
        // Focused: the same accent ring as an agent's card.
        .when(p.focused, (el) => el.child(focusRing(t))),
    };
  }

  // An agent's row with its sub-agents and terminals under it, in one item:
  // [{ el, h, key, addr, pane, auto, flipH }]. They sit in a box that folds: its
  // height slides between none and theirs natively (FOLD_MS), clipping them, and
  // the card and everything under it follow it frame by frame (`auto`: the
  // card's piece sizes itself). The box is there with none too, so one coming or
  // going slides as well. `h` is where it's going; `flipH` the row alone.
  agentItems(R, a) {
    const subs = R.trees.get(a.address) ?? [];
    const open = !this.folded.has(a.address);
    // Each child CARD_PAD under the one above it, as rows in a card are.
    const full = subs.reduce((sum, s) => sum + ROW_GAP + (isAgent(s.t) ? H_KID : H_SUB), 0);
    // Folding, they stay in the box until it has closed; folded, they're gone.
    const shown = subs.length > 0 && (open || Date.now() < (this.foldUntil[a.address] ?? 0));
    const box = div()
      .id(`kids-${a.address}`)
      .flex_none()
      .h(open ? full : 0)
      .overflow_hidden()
      .transition("height", { duration: FOLD_MS, easing: "ease-out" })
      .when(shown, (el) => el.child(v_flex()
        .flex_none()
        .pt(ROW_GAP)
        .gap(ROW_GAP)
        .children(subs.map((s) => this.subRow(R, s).el))));
    return [{
      el: v_flex().flex_none().child(this.row(R, a, subs)).child(box),
      h: H_ROW + (open ? full : 0),
      flipH: H_ROW,
      auto: true,
      key: `ag-${a.address}`,
      addr: a.address,
      pane: a.pane,
    }];
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
    const open = !this.folded.has(a.address) && subs.length > 0;
    const toggle = subs.length > 0
      ? (cx) => {
        const now = Date.now();
        if (this.folded.has(a.address)) this.folded.delete(a.address);
        else {
          this.folded.add(a.address);
          // Its rows stay while the box closes over them, then go.
          this.foldUntil[a.address] = now + FOLD_MS + 40;
          cx.timer.after(FOLD_MS + 60, (cx) => cx.notify());
        }
        // Should the list scroll (folding at its end), it slides along.
        const list = this.owner?.scroll?.list;
        if (list) list.animateUntil = now + FOLD_MS + 100;
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
    // The card's background says what it's doing, in its mark's color (working,
    // done, needs you; idle plain). The focused one gets an accent ring on top.
    const tint = statusTint(t, a.status);

    return v_flex()
      .id(`ag-${a.address}`)
      .relative()
      .h(H_ROW)
      .px(8)
      .py(6)
      .gap(2)
      .flex_none()
      .rounded(8)
      .when(Boolean(tint), (el) => el.bg(tint))
      .when(!tint && a.focused, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(tint ? statusTint(t, a.status, true) : t.hover))
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
          .when(kidAgents + inner > 0, (el) => el.child(this.badge(t, `subs-${a.address}`, "mods/wierd-agents/bot.svg", kidAgents + inner, subTip, kidAgents > 0 ? toggle : null, open)))
          .when(kidTerms > 0, (el) => el.child(this.badge(t, `terms-${a.address}`, "mods/workspace-chrome/terminal.svg", kidTerms, plural(kidTerms, "terminal"), toggle, open)))
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
      .when(Boolean(meta), (el) => el.child(this.ctxBar(t, dark, full, a.address, R.cacheTick(a.address, cache))))
      // The focus ring: drawn over the card, so nothing in it moves.
      .when(a.focused, (el) => el.child(focusRing(t)));
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
