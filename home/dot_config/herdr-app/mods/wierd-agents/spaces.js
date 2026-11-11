// The sidebar's one panel: spaces, each with its tabs under it (agents.js), from
// Herdr's shipped `spaces` mod: stable colored avatars, worktrees under their
// checkout, grouped by machine when more than one is known. After a space's name,
// the repo its first terminal is in now, only where unusual: branch, ahead/behind.
// At the row's end, two buttons: its pi sessions (the panel turns into them, with
// Back on top) and v / > to show or hide its tabs. Hidden, the row says what its
// agents are up to by status, most urgent first (needs you, done, working), each
// mark with a count; sub-agents without a pane (hc run) count with their parent's
// space, idle ones aren't counted. A folded machine's header adds up its spaces'.
// Under a space its tabs: those with agents first (pinned, then by urgency), each
// agent a row, then the rest; a tab's other panes follow it in short lines, joined
// by a line on the left. Each space is a card: its row is the header (a lighter
// tone, the shown space's in the accent), its tabs the body. The list scrolls
// itself (scroll.js) and brings the focused pane, else the shown space, into view.
// Click a space to switch, right-click for its menu, drag its header to reorder:
// the card lifts and follows the pointer while the others part to make room.
// When rows change places inside a card (an agent that needs you overtakes the
// others, a row comes or goes above), each one that moved slides there (MOVE_MS).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, run, openOverlay, exec, hc, theme, settings, shared, setShared, setAgentOrder, watchFolder, window } from "herdr";
import { narrow, place, statusMark, isAgent, kidStatus, toggleSidebar } from "./kit.js";
import { scrollList, GAP } from "./scroll.js";
import { Agents } from "./agents.js";

// Row heights (px at zoom 1): the list places rows by these. A machine's header,
// a space, a worktree under its repo, a note (Loading…, New space there), a space
// on the rail, and the room after the last row.
const H_MACHINE = 26, H_SPACE = 34, H_TREE = 32, H_NOTE = 28, H_RAIL = 26, H_END = 8;
// A space's card: its corners, the room inside around its agents, the room
// between cards, and how much a row inside is narrower than the list's (the
// card's sides: border and padding).
const CARD_R = 10, CARD_PAD = 4, CARD_GAP = 6;
const CARD_INSET = 2 * (1 + CARD_PAD);
// How far a split tab's joining line stays from its first and last rows' edges.
// The joining line is a bracket, [, traced along the rows' own highlight: from
// the first row's top to the last row's bottom, down their left edge, its
// corners theirs (agents.js rounds every row 8). Its stroke, and how far its
// ends reach in along the rows' top and bottom edges (past the corners).
const ROW_R = 8;
const RAIL_W = 2, RAIL_TICK = 10;
// Dragging a space by its header. Pressed, it waits; held HOLD_MS or moved SLOP px,
// it lifts: its card (with the worktrees under it) leaves the list and follows the
// pointer up and down with a shadow, and the other cards of its machine part
// (PART_MS) where it would land. Released, it glides there (SETTLE_MS) and the
// space moves; released without ever moving, it's a click. Leaving the list puts
// it back. Within EDGE px of the list's top or bottom the list scrolls, up to
// EDGE_SPEED px a tick.
const HOLD_MS = 220, SLOP = 4, PART_MS = 160, SETTLE_MS = 180, EDGE = 32, EDGE_SPEED = 12;
// A row that moved inside its card: while it slides (MOVE_MS), its place in the
// card stays empty and the row is drawn over the list (a ghost), from where it
// was to where it is now. Every row keeps an empty ghost at its place, so the
// ghost knows where the row was. GHOST_X: a row's inset from the list's edge
// (the list's padding, the card's border and padding).
const MOVE_MS = 240, GHOST_X = 8 + 1 + CARD_PAD;
// A color with an alpha, where it's a plain #rrggbb.
const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? `${c}${a}` : c);
// The shown space's header tone (the accent, faint), and a split tab's joining
// line in the same blue, stronger: at 2px the faint one doesn't show.
const activeTint = (t) => alpha(t.accent, "26");
const railColor = (t) => alpha(t.accent, "80");
const rowHeight = ({ tree }) => (tree ? H_TREE : H_SPACE);
// A card piece's height (see piece()): its content, the room under the last row,
// and the card's top and bottom edges.
const pieceHeight = (kind, h) => h
  + (kind === "last" ? CARD_PAD : 0)
  + (kind === "head" || kind === "only" ? 1 : 0)
  + (kind === "end" || kind === "only" || kind === "last" ? 1 : 0);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// This panel's own state, kept across restarts. Shared rather than localStorage:
// the Agents panel is a copy of this mod too, writing its own.
const FOLDED = "wierd.spaces.folded";
const RECONNECTING = "wierd.spaces.reconnecting";
// Spaces whose agents are hidden (their ids).
const CLOSED = "wierd.spaces.closed";

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// The statuses a space shows, in the priority sort's order; idle isn't one.
const SHOWN = [
  { id: "blocked", label: "needs you" },
  { id: "done", label: "done" },
  { id: "working", label: "working" },
];
const urgent = (c) => SHOWN.find((s) => c?.[s.id] > 0)?.id ?? null;

// Each space's agents by status: every agent with a pane where its pane is, and
// each live sub-agent (they read as in the list's tree: an error is blocked, done
// is idle) where its topmost ancestor with a pane is: the agent it shows under.
// A sub-agent someone kept (it has a pane now) still counts there, as it shows.
function countBySpace() {
  const list = agents();
  const listed = new Map(list.map((a) => [a.address, a.status]));
  const spaceOf = new Map(list.map((a) => [a.address, a.space]));
  const all = terminals();
  const byAddr = new Map(all.map((k) => [k.address, k]));
  const out = {};
  const add = (space, status) => {
    const c = (out[space] ??= { blocked: 0, done: 0, working: 0 });
    if (status in c) c[status] += 1;
  };
  // Up through live terminals, as the list's tree goes down them: the last agent
  // with a pane on the way.
  const root = (k) => {
    let up = k.parent, top = null;
    const seen = new Set();
    while (up && !seen.has(up)) {
      seen.add(up);
      if (spaceOf.has(up)) top = up;
      const p = byAddr.get(up);
      up = p?.state === "live" ? p.parent : null;
    }
    return top;
  };
  for (const k of all) {
    if (k.state !== "live" || !(listed.has(k.address) || isAgent(k))) continue;
    const top = root(k);
    if (top) add(spaceOf.get(top), kidStatus(k, listed));
    else if (listed.has(k.address)) add(spaceOf.get(k.address), listed.get(k.address));
  }
  return out;
}

const sum = (list) => {
  const out = { blocked: 0, done: 0, working: 0 };
  for (const c of list) for (const s of SHOWN) out[s.id] += c?.[s.id] ?? 0;
  return out;
};

export class Spaces {
  init(props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    // The space being dragged (see HOLD_MS), and a number per drag: its slots and
    // card are new elements each time, so nothing slides in from the last drag.
    this.dnd = null;
    this.dndSeq = 0;
    // Rows sliding to their new place (see MOVE_MS): key -> { until, d: how far,
    // down positive }; where each row was at the last render; when the last one lands.
    this.flips = new Map();
    this.flipPrev = null;
    this.flipEnd = 0;
    this.machines = [];
    // Each list's scroll position (spaces and agents; a space's sessions), and
    // the space and agent it last brought into view.
    this.scroll = { list: {}, sessions: {} };
    this.followKey = null;
    this.reconnecting = { ...(shared(RECONNECTING) ?? {}) };
    for (const [name, state] of Object.entries(this.reconnecting)) this.reconnecting[name] = { ...state, busy: false };
    this.folded = new Set(shared(FOLDED) ?? []);
    this.closed = new Set(shared(CLOSED) ?? []);
    // The agents under each space, and a space's sessions: their rows, state and timers.
    this.agents = new Agents();
    this.agents.owner = this;
    this.agents.init(props, cx);
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  saveFolded() {
    setShared(FOLDED, [...this.folded]);
  }

  saveReconnecting() {
    setShared(RECONNECTING, this.reconnecting);
  }

  saveClosed() {
    setShared(CLOSED, [...this.closed]);
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    // Sliding rows landed: back into their cards.
    const landed = this.flipEnd > 0 && now >= this.flipEnd;
    if (landed) this.flipEnd = 0;
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now) || landed) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    this.saveReconnecting();
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          this.saveReconnecting();
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        this.saveFolded();
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      this.saveReconnecting();
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // A space's (or a folded machine's) agents: per shown status its mark and count,
  // most urgent first; null when nothing but idle.
  agentMarks(t, c, key) {
    const on = SHOWN.filter((s) => c?.[s.id] > 0);
    if (!on.length) return null;
    return h_flex()
      .id(`agents-${key}`)
      .flex_none()
      .gap(8)
      .items_center()
      .text_size(11)
      .tooltip(on.map((s) => `${c[s.id]} ${s.label}`).join(" · "))
      .children(on.map((s) => h_flex()
        .flex_none()
        .gap(4)
        .items_center()
        .child(statusMark(t, s.id, true))
        .child(div().text_color(s.id === "blocked" ? t.blocked : t.muted).child(String(c[s.id])))));
  }

  // The rows, under a header per machine once one isn't this computer: each space
  // and, unless hidden, its tabs: [{ el, h, id?, pane? }] (`id`: a space's, `pane`:
  // a row's pane, for bringing them into view). `R`: agents.prepare()'s.
  // Sets `this.order`: the agents in the list's order, hidden ones too.
  grouped(t, collapsed, counts, R) {
    const rows = this.ordered();
    const ps = panes();
    // What a drag moves: a space with the worktrees listed under it moves as one,
    // among the others of its machine (its lane); a worktree among its repo's.
    // Sets `this.units`: space id -> { lane, family: the ids that move with it }.
    const units = new Map();
    const mainOf = {};
    for (const r of rows) {
      const main = r.tree && r.g ? mainOf[r.g.repo] : null;
      if (main) {
        units.get(main).family.push(r.w.id);
        units.set(r.w.id, { lane: `t-${main}`, family: [r.w.id] });
        continue;
      }
      units.set(r.w.id, { lane: `m-${r.w.machine ?? ""}`, family: [r.w.id] });
      if (r.g && !r.g.linked) mainOf[r.g.repo] ??= r.w.id;
    }
    this.units = units;
    const order = [];
    this.order = order;
    // Every row's pane in the list's order (agents and plain terminals alike),
    // hidden ones too: what wierd-agents.next / .prev step through.
    const paneOrder = [];
    this.paneOrder = paneOrder;
    const listed = (r) => {
      const groups = R.groups.get(r.w.id) ?? [];
      for (const g of groups) {
        for (const a of g.agents) {
          order.push(a);
          if (a.pane) paneOrder.push(a.pane);
          // Its children someone kept, where they show: under it.
          for (const s of R.trees.get(a.address) ?? []) {
            const kid = R.agentBy.get(s.t.address);
            if (kid) order.push(kid);
            const pane = R.paneOf.get(s.t.address);
            if (pane) paneOrder.push(pane);
          }
        }
        for (const p of g.others) if (p.pane) paneOrder.push(p.pane);
      }
    };
    // Every piece of a space's card says whose it is (`unit`), and the room after
    // the card is marked `spacer`: a drag lifts them together (dragLayout).
    const draw = (r) => card(r).map((it) => ({ ...it, unit: r.w.id }));
    const card = (r) => {
      if (collapsed) return [{ el: this.compact(r, t, counts[r.w.id]), h: H_RAIL, id: r.w.id }];
      const groups = R.groups.get(r.w.id) ?? [];
      const closed = this.closed.has(r.w.id);
      const sessions = Boolean(this.agents.sessionPlace(r.w, ps));
      const open = !closed && groups.length > 0;
      const head = this.row(r, t, counts[r.w.id], { tabs: groups.length, closed, sessions, only: !open });
      const after = { el: div().h(CARD_GAP).flex_none(), h: CARD_GAP, spacer: true };
      const lifted = this.isLifted(r.w.id);
      const piece = (kind, h, child = null, rail = null) => this.piece(t, kind, h, child, rail, lifted);
      // A row's piece (and the joining line's stretch over the room above it,
      // `owner`: the row's key), built once the list knows which rows slide (render).
      // `auto`: the row sizes itself (an agent's sub-agents fold in and out with
      // a native height transition), so its piece follows it frame by frame;
      // `flipH`: its height without them, which is what says it moved (moves()).
      const lazy = (kind, h, child, rail, { auto = false, flipH = null, ...extra } = {}) => ({
        ...extra,
        h: pieceHeight(kind, h),
        flipH: flipH != null ? pieceHeight(kind, flipH) : null,
        row: child,
        rowH: h,
        build: (away) => this.piece(t, kind, h, away ? null : child, away ? null : rail, lifted, auto && !away).el,
      });
      if (!open) return [{ ...piece("only", rowHeight(r), head), id: r.w.id }, after];
      // Every row's highlight stays CARD_PAD from the header, from the next row and
      // from the card's bottom, whatever the row (an agent with its context bar,
      // a terminal): a selected last row sits as tight as any other.
      // The card's last row closes it ("last": the room under it and the bottom
      // edge are its own), so its bottom corners round as fully as the top's.
      let sealed = false;
      const inner = groups.flatMap((g, i) => {
        // A tab split in several panes: a line down the left joins its rows
        // (and the room between them).
        const its = this.agents.groupItems(R, g);
        const joined = g.panes >= 2;
        const rail = (k) => (!joined ? null : k === 0 ? "start" : k === its.length - 1 ? "end" : "mid");
        return [
          ...(i > 0 ? [piece("side", CARD_PAD)] : []),
          ...its.flatMap((it, k) => {
            const last = i === groups.length - 1 && k === its.length - 1;
            sealed ||= last;
            return [
              ...(k > 0 ? [joined ? lazy("side", CARD_PAD, null, "mid", { owner: it.key }) : piece("side", CARD_PAD)] : []),
              lazy(last ? "last" : "side", it.h, it.el, rail(k), { key: it.key, pane: it.pane, rail: rail(k), railUp: joined && k > 0, auto: it.auto, flipH: it.flipH }),
            ];
          }),
        ];
      });
      return [
        { ...piece("head", rowHeight(r), head), id: r.w.id },
        piece("side", CARD_PAD),
        ...inner,
        ...(sealed ? [] : [piece("end", CARD_PAD)]),
        after,
      ];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => ({
      h: H_NOTE,
      el: div().id(`machine-loading-${m ?? "local"}`).h(H_NOTE).flex_none().flex().items_center().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…"),
    });
    if (!remote.length) {
      rows.forEach(listed);
      return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      mine.forEach(listed);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      // Folded, the header speaks for its spaces' agents.
      const marks = folded && !collapsed ? this.agentMarks(t, sum(mine.map((r) => counts[r.w.id])), `machine-${m ?? "local"}`) : null;
      const head = h_flex().id(`machine-${m ?? "local"}`).h(H_MACHINE).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          this.saveFolded();
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(Boolean(marks), el => el.child(marks))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = {
        h: H_NOTE,
        el: h_flex().id(`machine-new-${m ?? "local"}`).h(H_NOTE).flex_none().px(8).gap(7).items_center().rounded(7)
          .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new", { machine: m ?? "" }))
          .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there")),
      };
      const header = { el: head, h: H_MACHINE };
      if (!collapsed && rebuilt) return [header];
      return [header, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. It gives way first when the
  // agents' marks need the room.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .overflow_hidden()
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // The space's colored letter.
  avatar(w, t, size = 18) {
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
      .text_size(10.5 * size / 18).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?");
  }

  // A piece of a space's card. The list places rows one under another, so a card
  // is drawn in pieces that meet edge to edge: its header ("head": the top edge;
  // "only": the whole card, when no tabs show), its rows ("side"), its last row
  // with the room under it and the bottom edge ("last"; a bare "end" only for a
  // card without rows: a piece shorter than CARD_R can't round its corners fully).
  // `h`: the content's height; the piece adds its borders. `rail`: where the row
  // is in a split tab's run ("start", "mid", "end"), for the line that joins them.
  // `lifted`: the card is being dragged, its edge in the accent. `auto`: as tall
  // as its row is at the moment (a row whose height animates), not `h`.
  // -> { el, h }
  piece(t, kind, h, child = null, rail = null, lifted = false, auto = false) {
    const top = kind === "head" || kind === "only";
    const low = kind === "end" || kind === "only" || kind === "last";
    const pad = kind === "last" ? CARD_PAD : 0;
    const total = pieceHeight(kind, h);
    const el = div()
      .when(!auto, (el) => el.h(total))
      .flex_none()
      .bg(lifted ? t.raised : t.surface)
      .border_color(lifted ? alpha(t.accent, "99") : t.border)
      .border_l(1)
      .border_r(1)
      .when(top, (el) => el.border_t(1).rounded_t(CARD_R))
      .when(low, (el) => el.border_b(1).rounded_b(CARD_R))
      .when(kind === "side" || kind === "last", (el) => el.px(CARD_PAD))
      .when(pad > 0, (el) => el.pb(pad))
      .when(Boolean(child), (el) => el.child(child))
      // Drawn after the row, so its ends lie over the row's own padding.
      .when(Boolean(rail), (el) => el.relative().child(div()
        .absolute()
        .left(CARD_PAD)
        .top(0)
        .bottom(pad)
        .border_color(railColor(t))
        // Every piece as wide as the ends: a box only as wide as its border draws
        // that border thinner (at zoom 1.3), so the middle would show a thin step.
        .w(RAIL_TICK)
        .border_l(RAIL_W)
        .when(rail === "start", (el) => el.border_t(RAIL_W).rounded_tl(ROW_R))
        .when(rail === "end", (el) => el.border_b(RAIL_W).rounded_bl(ROW_R))));
    return { el, h: total };
  }

  // A small icon button at a space row's end, in a fixed slot (empty when `on` is
  // false, so the next row's buttons still line up). Its press is its own: no
  // switch, no drag.
  rowButton(id, t, on, tip, glyph, size, action) {
    const slot = h_flex().id(id).size(20).flex_none().items_center().justify_center().rounded(5);
    if (!on) return slot;
    return slot
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(svg(glyph).size(size).flex_none());
  }

  // Its pi sessions: the panel turns into them.
  sessionsButton(w, t, on) {
    return this.rowButton(`sessions-${w.id}`, t, on, "pi sessions", "mods/wierd-agents/history.svg", 13, (cx) => {
      this.scroll.sessions = {};
      this.agents.showSessions(w, cx);
    });
  }

  // v / >: shows or hides its agents (a space with none has nothing to fold).
  foldButton(w, t, on, closed) {
    return this.rowButton(`fold-${w.id}`, t, on, closed ? "Show tabs" : "Hide tabs", `mods/workspace-chrome/chevron-${closed ? "right" : "down"}.svg`, 12, (cx) => {
      closed ? this.closed.delete(w.id) : this.closed.add(w.id);
      this.saveClosed();
      cx.notify();
    });
  }

  // A space's card header. `tabs`: how many it has; `closed`: they're hidden;
  // `sessions`: it has a folder here (pi's sessions are this computer's);
  // `only`: no agents show under it, so it's the whole card.
  row({ w, i, g, tree }, t, count, { tabs = 0, closed = false, sessions = false, only = true } = {}) {
    const on = w.active;
    // Its agents' marks only while they're hidden: shown, they say it themselves.
    const marks = closed ? this.agentMarks(t, count, w.id) : null;
    const h = rowHeight({ tree });
    // The shown space's header in the accent, so it isn't the focused agent's gray.
    const tint = on ? activeTint(t) : t.hover;
    const lit = on ? alpha(t.accent, "34") : t.selected;
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      // Left: the rows' icon column (card pad + row pad), so avatar and name line up
      // with the marks and names under them. Right: the buttons' slots already do.
      .pl(CARD_PAD + 8)
      .pr(10)
      .h(h)
      .flex_none()
      .justify_center()
      .rounded_t(CARD_R - 1)
      .when(only, (el) => el.rounded_b(CARD_R - 1))
      .when(!only, (el) => el.border_b(1).border_color(t.border))
      .bg(tint)
      .hover((s) => s.bg(lit))
      // The press starts a drag (or a click); the list follows it from there.
      .on_mouse_down("left", (e, cx) => this.press(w, e, cx))
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(this.avatar(w, t)))
          // The name keeps its room until the git tail has given all of its own.
          .child(div().min_w(0).max_w(150).truncate().font_semibold().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(Boolean(marks), (el) => el.child(marks))
          .child(h_flex().flex_none().mr(-4).gap(1).items_center()
            .child(this.sessionsButton(w, t, sessions))
            .child(this.foldButton(w, t, tabs > 0, closed))),
      );
  }

  // On the rail: its number and, when its agents need a look, the most urgent mark.
  compact({ w, i }, t, count) {
    const top = urgent(count);
    return h_flex()
      .id(`space-${w.id}`)
      .h(H_RAIL)
      .flex_none()
      .justify_center()
      .items_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .when(Boolean(top), (el) => el.child(statusMark(t, top, true)));
  }

  // Cmd-] / Cmd-[: the next or previous row of the list, agent or terminal,
  // wrapping around; from outside the list, the first or last.
  step(dir) {
    const list = this.paneOrder ?? [];
    if (!list.length) return;
    const at = list.indexOf(focused()?.pane ?? null);
    const next = at < 0
      ? (dir > 0 ? 0 : list.length - 1)
      : (at + dir + list.length) % list.length;
    if (list[next] !== list[at]) run("pane.focus", { pane: list[next] });
  }

  // Dragging a space by its header (see HOLD_MS). `this.dnd`: { id, seq, phase:
  // "press" | "lift" | "drop", grab: where in its card the pointer holds it,
  // pointer: the pointer's y in the list, from / target: the slot it came from and
  // the one it would land in, index: space.move's for that, landed: the list has it
  // there }.

  // Its card is up: drawn with an accent edge (not while it settles).
  isLifted(id) {
    const d = this.dnd;
    return d?.phase === "lift" && Boolean(this.units?.get(d.id)?.family.includes(id));
  }

  press(w, e, cx) {
    if (narrow()) return;
    const zoom = settings().zoom || 1;
    this.dnd?.hold?.cancel();
    this.dnd?.scroller?.cancel();
    const d = {
      id: w.id,
      seq: ++this.dndSeq,
      phase: "press",
      x0: e.position.x,
      y0: e.position.y,
      // The header's own y, under the card's top edge.
      grab: e.local_position ? e.local_position.y / zoom + 1 : H_SPACE / 2,
      pointer: null,
      moved: false,
    };
    this.dnd = d;
    d.hold = cx.timer.after(HOLD_MS, (cx) => {
      if (this.dnd !== d || d.phase !== "press") return;
      this.lift(d);
      cx.notify();
    });
  }

  lift(d) {
    d.hold?.cancel();
    d.phase = "lift";
    this.scroll.list.animateUntil = 0;
  }

  // Any pointer move over the list: past SLOP a press lifts; a lifted card follows.
  dragMove(e, cx) {
    const d = this.dnd;
    if (!d || d.phase === "drop") return;
    const zoom = settings().zoom || 1;
    const far = Math.hypot(e.position.x - d.x0, e.position.y - d.y0) >= SLOP * zoom;
    if (d.phase === "press") {
      if (!far) return;
      this.lift(d);
    }
    d.moved ||= far;
    const y = e.local_position.y / zoom;
    if (y === d.pointer) return;
    d.pointer = y;
    if (d.moved) this.autoScroll(cx);
    cx.notify();
  }

  // A left release over the list: a press that never moved is a click; a moved
  // card lands in its slot.
  dragRelease(cx) {
    const d = this.dnd;
    if (!d) return;
    d.hold?.cancel();
    if (d.phase === "press") {
      this.dnd = null;
      run("space.select", { id: d.id });
      cx.notify();
      return;
    }
    if (d.phase !== "lift") return;
    if (!d.moved) {
      d.target = d.from;
      run("space.select", { id: d.id });
    } else if (d.target !== d.from && d.index) run("space.move", { id: d.id, index: d.index });
    this.settle(d, cx);
  }

  // The pointer left the list (its release can't be heard there): a press is
  // forgotten, a lifted card goes back where it was.
  dragLeave(cx) {
    const d = this.dnd;
    if (!d) return;
    if (d.phase === "press") {
      d.hold?.cancel();
      this.dnd = null;
      cx.notify();
    } else if (d.phase === "lift") {
      d.target = d.from;
      this.settle(d, cx);
    }
  }

  // The card glides into its slot; once the list has the space there (or after a
  // while, should the move not take), the list draws it in place again.
  settle(d, cx) {
    d.phase = "drop";
    d.at = Date.now();
    d.scroller?.cancel();
    d.scroller = null;
    const check = (cx) => {
      if (this.dnd !== d) return;
      if (d.landed || Date.now() - d.at > 1500) {
        this.dnd = null;
        cx.notify();
      } else cx.timer.after(100, check);
    };
    cx.timer.after(SETTLE_MS + 20, check);
    cx.notify();
  }

  // Within EDGE of the list's top or bottom: how far a tick scrolls, faster closer.
  edgeSpeed() {
    const d = this.dnd;
    const h = this.viewH ?? 0;
    if (d?.phase !== "lift" || !d.moved || d.pointer == null || !h) return 0;
    if (d.pointer < EDGE) return -EDGE_SPEED * Math.min(1, (EDGE - d.pointer) / EDGE);
    if (d.pointer > h - EDGE) return EDGE_SPEED * Math.min(1, (d.pointer - h + EDGE) / EDGE);
    return 0;
  }

  // Scrolls the list under a card held near its edge, until it's moved off it or
  // the list can't go further.
  autoScroll(cx) {
    const d = this.dnd;
    if (!d || d.scroller || !this.edgeSpeed()) return;
    d.scroller = cx.timer.every(16, (cx) => {
      const v = this.dnd === d ? this.edgeSpeed() : 0;
      const st = this.scroll.list;
      const max = Math.max(0, (this.listTotal ?? 0) - (this.viewH ?? 0));
      const next = Math.max(0, Math.min(max, (st.offset ?? 0) + v));
      if (!v || next === st.offset) {
        d.scroller?.cancel();
        d.scroller = null;
        return;
      }
      st.offset = next;
      st.animateUntil = 0;
      cx.notify();
    });
  }

  // Where every row is in its card now, against the last render: those that moved
  // in the same card (not the card itself moving) slide from where they were.
  // Whether a row moved goes by the rows' heights without their sub-agents
  // (`flipH`): those fold in and out by themselves, pushing the rows under them
  // along, so a row isn't moved by its neighbour folding. How far it slides goes
  // by the real ones.
  // `still`: false while a space is dragged (its card's rows stay in it).
  // -> the keys of the rows sliding now.
  moves(items, now, still) {
    const pos = new Map();
    const cardTop = new Map();
    let y = 0, ry = 0;
    for (const it of items) {
      if (it.unit != null && !cardTop.has(it.unit)) cardTop.set(it.unit, ry);
      if (it.key) pos.set(it.key, { y, rel: ry - cardTop.get(it.unit), unit: it.unit });
      y += it.h;
      ry += it.flipH ?? it.h;
    }
    const prev = this.flipPrev;
    this.flipPrev = pos;
    if (!still) this.flips.clear();
    else if (prev) {
      for (const [k, p] of pos) {
        const q = prev.get(k);
        if (q && q.unit === p.unit && q.rel !== p.rel) this.flips.set(k, { until: now + MOVE_MS + 40, d: p.y - q.y });
      }
    }
    for (const [k, f] of this.flips) if (f.until <= now || !pos.has(k)) this.flips.delete(k);
    this.flipEnd = this.flips.size ? Math.max(...[...this.flips.values()].map((f) => f.until)) : 0;
    return new Set(this.flips.keys());
  }

  // Every row's ghost at its place in the list: empty, but where the row was, so a
  // row that moved slides from there. A sliding one draws the row (on the card's
  // own color, so rows passing each other don't show through) and its stretch of
  // a split tab's joining line; the ones going up on top.
  ghosts(t, items, moving) {
    const out = [];
    let y = 0;
    for (const it of items) {
      if (it.key) out.push({ it, y, on: moving.has(it.key), d: this.flips.get(it.key)?.d ?? 0 });
      y += it.h;
    }
    out.sort((a, b) => Number(a.on) - Number(b.on) || b.d - a.d);
    const glide = { duration: MOVE_MS, easing: "ease-in-out" };
    return div()
      .absolute()
      .top(0)
      .left(0)
      .right(0)
      .h(0)
      .children(out.map(({ it, y, on }) => div()
        .id(`fl-${it.key}`)
        .absolute()
        .left(GHOST_X)
        .right(GHOST_X)
        .top(y)
        .transition("top", on ? glide : { duration: 0 })
        .h(on ? it.rowH : 0)
        .when(on, (el) => el
          .rounded(ROW_R)
          .bg(t.surface)
          .child(it.row)
          .when(Boolean(it.rail), (el) => el.child(div()
            .absolute()
            .left(0)
            .top(it.railUp ? -CARD_PAD : 0)
            .h(it.rowH + (it.railUp ? CARD_PAD : 0))
            .w(RAIL_TICK)
            .border_color(railColor(t))
            .border_l(RAIL_W)
            .when(it.rail === "start", (el) => el.border_t(RAIL_W).rounded_tl(ROW_R))
            .when(it.rail === "end", (el) => el.border_b(RAIL_W).rounded_bl(ROW_R)))))));
  }

  // While a space is lifted or settling: its card's pieces (its worktrees' too)
  // out of the list, drawn over it where the pointer holds it, and a slot before
  // each other unit of its lane and after the last. All are empty but the one it
  // would land in, as tall as the card: switching, one closes as the other opens,
  // so the cards between slide. That's the slot whose top is nearest the card's
  // (the card's edge has crossed the middle of the one it passes).
  // -> { items, overlay }; sets the drag's from, target, index and landed.
  dragLayout(t, items) {
    const d = this.dnd;
    if (!d || d.phase === "press") return { items, overlay: null };
    const unit = this.units?.get(d.id);
    const family = new Set(unit?.family ?? []);
    const first = items.findIndex((it) => family.has(it.unit));
    if (first < 0) {
      // Gone while dragged (closed, its machine folded).
      d.scroller?.cancel();
      this.dnd = null;
      return { items, overlay: null };
    }
    let last = first;
    while (last + 1 < items.length && family.has(items[last + 1].unit)) last++;
    const src = items.slice(first, last + 1);
    const rest = [...items.slice(0, first), ...items.slice(last + 1)];
    const sumH = (list) => list.reduce((s, it) => s + it.h, 0);
    const H = sumH(src);

    // The slots, where the list is without the card.
    const laneOf = new Map(); // piece's unit -> the lane unit it moves with
    for (const [id, u] of this.units) if (u.lane === unit.lane && id !== d.id) for (const f of u.family) laneOf.set(f, id);
    const slots = [];
    let y = 0, prev = null, end = null, lastUnit = null;
    rest.forEach((it, i) => {
      const owner = laneOf.get(it.unit) ?? null;
      if (owner && owner !== prev) slots.push({ key: owner, at: i, top: y });
      y += it.h;
      if (owner) {
        end = { key: "end", at: i + 1, top: y };
        lastUnit = owner;
      }
      prev = owner;
    });
    slots.push(end ?? { key: "end", at: first, top: sumH(rest.slice(0, first)) });
    const from = laneOf.get(rest[first]?.unit) ?? "end";
    const fromSlot = slots.find((s) => s.key === from) ?? slots[slots.length - 1];

    const st = this.scroll.list;
    const off = Math.max(0, Math.min(st.offset ?? 0, sumH(items) - (this.viewH ?? 0)));
    // Lifted by holding still: held where it is until the pointer moves.
    d.pointer ??= fromSlot.top - off + d.grab;
    const cardTop = d.pointer + off - d.grab;
    let target;
    if (d.phase === "lift") {
      d.from = from;
      target = slots.reduce((best, s) => (Math.abs(s.top - cardTop) < Math.abs(best.top - cardTop) ? s : best));
      d.target = target.key;
      // space.move's position (1 = first): just before the space after the slot,
      // else after the last of the lane's last unit.
      const order = spaces().map((s) => s.id).filter((id) => id !== d.id);
      const pos = target.key !== "end" ? order.indexOf(target.key)
        : lastUnit ? Math.max(...this.units.get(lastUnit).family.map((id) => order.indexOf(id))) + 1 : -1;
      d.index = pos >= 0 ? pos + 1 : null;
    } else target = slots.find((s) => s.key === d.target) ?? fromSlot;
    d.landed = from === d.target;

    const slot = (s) => {
      const open = s.key === target.key;
      return {
        h: open ? H : 0,
        el: div()
          .id(`dnd-${d.seq}-${s.key}`)
          .flex_none()
          .h(open ? H : 0)
          .overflow_hidden()
          .transition("height", { duration: PART_MS, easing: "ease-out" })
          // Where it will land: a faint outline, mostly under the card.
          .child(div()
            .h(H - CARD_GAP)
            .rounded(CARD_R)
            .border(1)
            .border_dashed()
            .border_color(alpha(t.accent, "59"))
            .bg(alpha(t.accent, "0d"))),
      };
    };
    const out = [];
    rest.forEach((it, i) => {
      for (const s of slots) if (s.at === i) out.push(slot(s));
      out.push(it);
    });
    for (const s of slots) if (s.at === rest.length) out.push(slot(s));

    // The card: each space's pieces in one box with the shadow under it (not
    // under the room between cards), the room after each kept.
    const cards = [];
    for (const it of src) {
      const open = cards[cards.length - 1];
      if (it.spacer) cards.push({ room: it.el });
      else if (open?.unit === it.unit) open.els.push(it.el);
      else cards.push({ unit: it.unit, els: [it.el] });
    }
    const up = d.phase === "lift";
    const overlay = v_flex()
      .id(`dnd-card-${d.seq}`)
      .absolute()
      .left(8)
      .right(8)
      .top(up ? cardTop : target.top)
      .transition("top", up ? { duration: 0 } : { duration: SETTLE_MS, easing: "ease-out" })
      .when(up, (el) => el.cursor_grabbing())
      .children(cards.map((c) => c.room ?? v_flex()
        .flex_none()
        .rounded(CARD_R)
        .when(up, (el) => el.shadow_2xl())
        .children(c.els)));
    return { items: out, overlay };
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);

    const R = this.agents.prepare(t);
    // A sub-agent just kept from its peek: its tab next to its parent's.
    this.agents.placeKept(R);

    // A space's sessions instead of the list (not on the rail; gone with its space).
    const sessionsOf = this.agents.sessionsFor ? sp.find((s) => s.id === this.agents.sessionsFor) : null;
    if (this.agents.sessionsFor && !sessionsOf) this.agents.hideSessions();
    if (sessionsOf && !collapsed) {
      // Back from the sessions, the list shows as it is, nothing sliding.
      this.flipPrev = null;
      this.flips.clear();
      return this.sessionsView(t, R, sessionsOf);
    }

    // Agent rows sit inside a card: the cache tick's lane is that much narrower.
    this.rowInset = collapsed ? 0 : CARD_INSET;
    // The rail has no drag: one folded mid-drag ends it.
    if (collapsed && this.dnd) {
      this.dnd.hold?.cancel();
      this.dnd.scroller?.cancel();
      this.dnd = null;
    }
    const counts = countBySpace();
    const laid = this.grouped(t, collapsed, counts, R);
    // After the last machine: add another (an ssh host), drawn like a machine's header.
    laid.push({
      h: H_MACHINE,
      el: h_flex().id("machine-add").h(H_MACHINE).flex_none().px(collapsed ? 2 : 8).gap(7).items_center()
        .when(collapsed, el => el.justify_center().tooltip("Add machine"))
        .text_size(11).text_color(t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("mod.open", { name: "machine-add" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child("Add machine"))),
    });
    laid.push({ el: div().id("spaces-end").h(H_END).flex_none(), h: H_END });
    // Rows that moved in their card slide there: their pieces stay empty meanwhile.
    const dragging = this.dnd != null && this.dnd.phase !== "press";
    const moving = this.moves(laid, Date.now(), !dragging && !collapsed);
    const items = laid.map((it) => (it.build ? { ...it, el: it.build(moving.has(it.key ?? it.owner)) } : it));
    // agent.next / agent.prev go down the list as it reads; agents not listed yet last.
    const inOrder = new Set(this.order.map((a) => a.address));
    setAgentOrder([...this.order, ...R.list.filter((a) => !inOrder.has(a.address))].map((a) => a.address));
    this.agents.due = R.due;

    // Another space shown or another agent focused: bring the agent's row into
    // view, else the space's, animated (once the list's height is known, and once
    // the row is there).
    const active = sp.find((s) => s.active)?.id ?? null;
    const current = focused()?.pane ?? null;
    const followKey = `${active ?? ""}|${current ?? ""}`;
    let followAt = null;
    // Not under a dragged card: once it's down.
    if (this.viewH && followKey !== this.followKey && !dragging) {
      let at = current ? items.findIndex((it) => it.pane === current) : -1;
      if (at < 0) at = items.findIndex((it) => it.id === active);
      if (at >= 0) {
        this.followKey = followKey;
        followAt = at;
      }
    }

    const { items: shown, overlay } = this.dragLayout(t, items);
    this.listTotal = shown.reduce((s, it) => s + it.h, 0);

    // No title row: new spaces come from a machine's + (or space.new).
    return v_flex().size_full().min_h(0).pt(4).bg(t.chrome).text_size(13)
      .child(scrollList(this, t, shown, this.scroll.list, {
        collapsed,
        followAt,
        // A card's pieces meet edge to edge; cards keep their own room between.
        gap: 0,
        // A space's header drag, followed over the whole list; else the rows' ghosts.
        overlay: overlay ?? (collapsed ? null : this.ghosts(t, laid, moving)),
        onMouseMove: (e, cx) => this.dragMove(e, cx),
        onMouseUp: (cx) => this.dragRelease(cx),
        onLeave: (cx) => this.dragLeave(cx),
      }))
      .when(collapsed, (el) => el.child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("collapse").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("»"))));
  }

  // A space's pi sessions: Back on top, then the list, the next page coming in
  // at its end (or at once while the list doesn't fill the panel).
  sessionsView(t, R, space) {
    this.rowInset = 0;
    const items = this.agents.sessionItems(R, space);
    const total = items.reduce((sum, it) => sum + it.h + GAP, 0);
    this.agents.sessShort = this.viewH > 0 && total < this.viewH;
    this.agents.due = R.due;
    const count = this.agents.sessionCount(space);
    const back = (cx) => {
      this.agents.hideSessions();
      cx.notify();
    };
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).flex_none().pl(10).pr(16).gap(8).items_center().text_size(11.5).text_color(t.dim)
        .child(h_flex().id("sessions-back").h(24).pl(4).pr(8).gap(4).flex_none().items_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Back to spaces")
          .on_click((_e, cx) => back(cx))
          .child(svg("mods/workspace-chrome/chevron-left.svg").size(13).flex_none())
          .child("Back"))
        .child(div().flex_1())
        .child(this.avatar(space, t, 16))
        .child(div().min_w(0).truncate().text_color(t.muted).child(space.name))
        .when(count != null, (el) => el.child(div().flex_none().text_color(t.dim).child(String(count)))))
      .child(scrollList(this, t, items, this.scroll.sessions, {
        collapsed: false,
        onEnd: (cx) => this.agents.moreAtEnd(cx),
      }));
  }
}
