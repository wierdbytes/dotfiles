// The sidebar's list (Wierdr's SpacesList), drawn bottom up for the hand on the mouse
// as Wierdr's is for the thumb: this computer's spaces lowest, the first space at the
// bottom, each added machine's group over them, a group's header under its cards; a
// card's header under its rows (rows.js), the newest and pinned agents lowest.
//
// The list rests at its bottom: cards short of its height sit there, and anything that
// grows, comes or goes (a card folding, an agent coming, a sub-agents' tree) keeps what's
// under it in place and moves only what's over it, in the same animation. Its content
// is anchored by its bottom; folds are native height springs (FOLD).
//
// A card's header: a click folds it (as on the iPhone; its rows show the space), its menu is a
// right-click (menu.js), and dragging it moves the card among its machine's: it lifts
// and follows the pointer while the others part where it would land.

import { div, Background, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, focused, run, exec, hc, theme, settings, shared, setShared, setAgentOrder, watchFolder, window, checking } from "herdr";
import { M, px, mono, icon, alpha, statusColor } from "./look.js";
import { snapshot, sum, ageTick, age, kidStatus, wantedStamps, setStamp, phaseOf, isAgent, chipOwners, termTally, shownKids, termOwners } from "./model.js";
import { rowChrome, agentContent, kidContent, paneContent } from "./rows.js";
import { openMenu, openKid, focusPane, KEEP } from "./actions.js";
import { Sessions } from "./sessions.js";

// Folding: Wierdr's critically damped 0.35-s spring; rows of a folded card or agent
// stay drawn until it has closed over them.
const FOLD = { response: 350, damping: 1 };
const FOLD_KEEP_MS = 650;
// Scrolling to a row, and the room kept around it.
const SCROLL_MS = 280, FOLLOW_MARGIN = 8;
// The scrollbar's thumb, in the list's right padding.
const THUMB_W = 3, THUMB_RIGHT = 2, THUMB_HIT = 7;
// The fades where rows scroll out of sight (Telegram's edge effect, short).
const FADE = px(16);
// Dragging a card: held HOLD_MS or moved SLOP px, it lifts; the others part (PART_MS);
// released, it glides into its slot (SETTLE_MS). Within EDGE px of the list's ends it
// scrolls, up to EDGE_SPEED px a tick.
const HOLD_MS = 220, SLOP = 4, PART_MS = 160, SETTLE_MS = 180, EDGE = 32, EDGE_SPEED = 12;
// Changes made outside Herdr (an editor's save, a commit): looked for this often.
const GIT_FALLBACK = 60000;
// Kept across restarts: folded cards, machines and agents' trees.
const CLOSED = "wierdr.closed", FOLDED_MACHINES = "wierdr.machines.folded", FOLDED_AGENTS = "wierdr.agents.folded";
const KEEP_WAIT_MS = 20000;

// A stored color name on an avatar: one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();

export class List {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {};
    this.ready = {};
    this.at = {};
    this.watching = new Set();
    this.machines = [];
    this.closed = new Set(shared(CLOSED) ?? []);
    this.foldedMachines = new Set(shared(FOLDED_MACHINES) ?? []);
    this.foldedAgents = new Set(shared(FOLDED_AGENTS) ?? []);
    this.foldUntil = {};
    // The agents whose `>_` chip is open (their terminals show); the others' come folded.
    // Not kept: one left with no terminals drops out (`foldEndedTerms`), so the next ones
    // it starts come folded again.
    this.openTerms = new Set();
    this.termsUntil = {};
    this.scroll = { off: 0, animateUntil: 0 };
    this.measured = {};
    this.sessScroll = { off: 0, animateUntil: 0 };
    this.followKey = null;
    this.dnd = null;
    this.dndSeq = 0;
    this.sessions = new Sessions((space) => (space && !space.machine ? place(space, panes()) || null : null));
    if (checking()) return;
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    cx.timer.every(250, (cx) => this.checkGit(cx));
    cx.timer.every(300, (cx) => this.sessions.tick(cx));
    // When each agent got into its status: asked of the core (model.js since).
    this.stampWant = [];
    this.stampAsk = new Map(); // address -> { s: phase, tries, busy }
    cx.timer.every(500, (cx) => this.askStamps(cx));
    // Ages read 12s, 5m, 3h: a redraw only when one would read differently (render sets `due`).
    cx.timer.every(1000, (cx) => {
      if (this.due == null || Date.now() < this.due) return;
      this.due = Date.now() + 60000;
      cx.notify();
    });
  }

  // ---- machines and git (the desktop's wierd-agents) ------------------------------------------

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {}
      cx.notify();
    });
  }

  // `hc get` for each terminal render found without the core's stamp for its phase
  // (model.js wantedStamps); a redraw when one is in. Each new phase is asked anew; if
  // the core already says another one (terminals() is behind), again, 3 tries at most.
  askStamps(cx) {
    const want = new Map(this.stampWant);
    for (const k of this.stampAsk.keys()) if (!want.has(k)) this.stampAsk.delete(k);
    for (const [address, s] of want) {
      let ask = this.stampAsk.get(address);
      if (!ask || ask.s !== s) this.stampAsk.set(address, (ask = { s, tries: 0, busy: false }));
      if (ask.busy || ask.tries >= 3) continue;
      ask.busy = true;
      ask.tries++;
      cx.spawn(async (cx) => {
        let got = null;
        try {
          const r = await hc(["get", address, "--json"]);
          const k = JSON.parse(r.stdout);
          got = phaseOf(k);
          if (got && k.status_ms > 0) {
            setStamp(address, got, k.status_ms);
            cx.notify();
          }
        } catch {}
        ask.busy = false;
        if (got === s) ask.tries = 3;
      });
    }
  }

  checkGit(cx) {
    const due = this.dueGit(Date.now(), spaces(), panes());
    if (due.size) this.refreshGit(due, cx);
  }

  // Places whose git could have changed: new ones, where a command or an agent's turn
  // just ended, on a machine that's back, and those whose fallback is due.
  dueGit(now, sp, ps) {
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
        if (asks && now - (this.checked[k] ?? 0) > GIT_FALLBACK) due.add(k);
      }
    }
    return due;
  }

  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.checkPlace(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  async checkPlace(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
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

  // ---- folding ----------------------------------------------------------------------------------

  toggle(set, key, saveKey, cx) {
    if (set.has(key)) set.delete(key);
    else {
      set.add(key);
      this.foldUntil[key] = Date.now() + FOLD_KEEP_MS;
      cx.timer.after(FOLD_KEEP_MS + 20, (cx) => cx.notify());
    }
    setShared(saveKey, [...set]);
    cx.notify();
  }

  // Shown, or still closing over its rows.
  drawn(set, key) {
    return !set.has(key) || Date.now() < (this.foldUntil[key] ?? 0);
  }

  // Shows or hides the terminals an agent or sub-agent started (its `>_` chip).
  toggleTerms(address, cx) {
    if (this.openTerms.has(address)) {
      this.openTerms.delete(address);
      this.termsUntil[address] = Date.now() + FOLD_KEEP_MS;
      cx.timer.after(FOLD_KEEP_MS + 20, (cx) => cx.notify());
    } else this.openTerms.add(address);
    cx.notify();
  }

  // Its terminals shown, or still closing over them.
  termsDrawn(address) {
    return this.openTerms.has(address) || Date.now() < (this.termsUntil[address] ?? 0);
  }

  // Agents left without terminals fold theirs again.
  foldEndedTerms(all) {
    if (!this.openTerms.size) return;
    const owners = termOwners(all);
    for (const a of this.openTerms) if (!owners.has(a)) this.openTerms.delete(a);
  }

  // ---- pieces -----------------------------------------------------------------------------------

  avatar(s, t, size) {
    const color = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : MARK[color] ?? t[color];
    return h_flex().size(size).flex_none().rounded(size * 5 / 18).bg(fill).items_center().justify_center()
      .text_size(size * 10.5 / 18).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?");
  }

  // A folded card's (or machine's) agents: a round badge per status but idle, most urgent first.
  badges(t, c) {
    const on = ["blocked", "done", "working"].filter((s) => c?.[s] > 0);
    if (!on.length) return null;
    return h_flex().flex_none().gap(px(4)).items_center().children(on.map((s) => div()
      .h(px(20))
      .min_w(px(20))
      .px(px(5))
      .rounded_full()
      .bg(statusColor(t, s))
      .flex()
      .items_center()
      .justify_center()
      .text_size(px(13))
      .font_semibold()
      .text_color(t.background)
      .child(String(c[s]))));
  }

  // `repo · branch`, each only where unusual, and ↑ahead ↓behind.
  gitTail(t, s, g) {
    if (!g) return div().flex_1();
    const same = (x) => x.toLowerCase() === s.name.toLowerCase();
    const raw = g.branch ?? "detached";
    const branch = same(raw) || raw === "main" || raw === "master" ? "" : raw;
    const repo = g.linked || same(g.name) ? "" : g.name;
    const tail = [repo, branch].filter(Boolean).join(" · ");
    return h_flex().flex_1().min_w(0).overflow_hidden().gap(px(5)).justify_end().items_center().text_size(px(13))
      .when(Boolean(tail), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(tail)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)));
  }

  // A small square button in a card's or machine's header; its press is its own.
  button(t, id, glyph, size, frame, tip, action) {
    return h_flex()
      .id(id)
      .size(frame)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(px(6))
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(glyph);
  }

  // A card's header (Wierdr's SpaceHeaderBar), at the card's bottom.
  header(t, s, g, count, { hasRows, closed, bodyShown }) {
    const active = s.active;
    const fill = active ? alpha(t.accent, 0.15) : t.hover;
    const lit = active ? alpha(t.accent, 0.2) : t.selected;
    const sessions = !s.machine && place(s, panes());
    const chevron = icon(closed ? "chevron-right" : "chevron-up", px(14), t.dim);
    return div().bg(t.surface).child(h_flex()
      .id(`space-${s.id}`)
      .h(M.header)
      .pl(M.inset - px(2))
      .pr(px(8))
      .gap(px(10))
      .items_center()
      .bg(fill)
      // The hairline over it while rows show; always there (clear when folded), so the
      // line's text doesn't move as it comes and goes.
      .border_t(1)
      .border_color(bodyShown ? t.border : alpha(t.border, 0))
      .cursor_pointer()
      .hover((st) => st.bg(lit))
      .on_mouse_down("left", (e, cx) => this.press(s, e, cx, hasRows))
      .on_mouse_down("right", (e) => {
        const at = e.position ? { x: Math.round(e.position.x), y: Math.round(e.position.y) } : undefined;
        openMenu({ kind: "space", space: s.id, at, width: 220 }, { at, width: 220, height: 3 * 31 + 20 });
      })
      .child(this.avatar(s, t, M.avatar))
      .child(div().flex_none().max_w(px(220)).truncate().text_size(px(16)).font_semibold().text_color(t.foreground).child(s.name))
      .child(this.gitTail(t, s, g))
      .when(closed, (el) => el.child(this.badges(t, count) ?? div()))
      .child(h_flex().flex_none().mr(-px(4)).gap(px(2)).items_center()
        .when(Boolean(sessions), (el) => el.child(this.button(t, `sessions-${s.id}`, icon("history", px(13), t.dim), px(13), px(32), "pi sessions", (cx) => {
          this.sessScroll = { off: 0, animateUntil: 0 };
          this.sessions.show(s, cx);
        })))
        .child(hasRows
          ? this.button(t, `fold-${s.id}`, chevron, px(14), px(32), closed ? "Show tabs" : "Hide tabs", (cx) => this.toggle(this.closed, s.id, CLOSED, cx))
          : div().w(px(32)).flex_none())));
  }

  // A card's lines, top to bottom as drawn (Wierdr's PhoneListLine.lines): its other panes
  // on top, then its agents bottom up, each with its sub-agents over it, the first (the
  // newest pin, or the latest change) lowest. Separators: none inside an agent's block,
  // inset between blocks, full over the pinned block and under the panes, none under the
  // lowest. -> { els, h, panes: [pane in drawn order], agents: [address], rowAt: Map(pane ->
  // [distance from the body's bottom, height]) }
  lines(R, page) {
    const out = [];
    const { others, agents: rows } = page;
    const sel = R.focusedPane;
    for (let i = others.length - 1; i >= 0; i--) {
      const r = others[i];
      const sep = i > 0 ? M.paneText : rows.length ? "full" : null;
      out.push({ kind: "pane", r, h: M.paneH, sep, selected: r.pane === sel, pane: r.pane });
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const pinned = r.a.pinned;
      const below = i > 0 ? rows[i - 1] : null;
      const sep = !below ? null : !pinned && below.a.pinned ? "full" : M.inset;
      out.push({ kind: "agent", r, pinned, sep, selected: r.pane === sel, pane: r.pane });
    }
    // Each line's separator hides while it or the one under it is lit.
    for (let i = 0; i < out.length; i++) if (out[i + 1]?.selected) out[i].sep = null;

    const els = [];
    let h = 0;
    const order = [];
    const agentOrder = [];
    const spans = [];
    for (const l of out) {
      if (l.kind === "pane") {
        els.push(rowChrome(R, {
          id: l.r.key, h: M.paneH, selected: l.selected, sep: l.sep,
          click: () => focusPane(l.r.pane),
          right: () => openMenu({ kind: "row", pane: l.r.pane, terminal: l.r.p.terminal }, { width: 210, height: 2 * 31 + 10 }),
          child: paneContent(R, l.r),
        }));
        spans.push([l.pane, h, M.paneH]);
        h += M.paneH;
        order.push(l.pane);
        continue;
      }
      const r = l.r;
      const addr = r.a.address;
      const agentsOpen = !this.foldedAgents.has(addr);
      // What shows (heights, order) and what's drawn (with rows still folding away).
      const shown = shownKids(r.kids, agentsOpen, (a) => this.openTerms.has(a));
      const drawnKids = shownKids(r.kids, this.drawn(this.foldedAgents, addr), (a) => this.termsDrawn(a));
      const shownSet = new Set(shown.map((k) => k.t.address));
      const owners = chipOwners(r.kids);
      const kidH = (k) => (isAgent(k.t) ? M.kidH : M.kidTermH);
      const kidsH = shown.reduce((n, k) => n + kidH(k), 0);
      const drawn = [...drawnKids].reverse();
      const toggleAgents = (cx) => this.toggle(this.foldedAgents, addr, FOLDED_AGENTS, cx);
      const termsOf = (a) => ({
        terms: termTally(a, r.kids, owners),
        termsOpen: this.openTerms.has(a),
        toggleTerms: (cx) => this.toggleTerms(a, cx),
      });
      const box = div()
        .id(`kids-${r.pane}`)
        .w_full()
        .flex_none()
        .h(kidsH)
        .overflow_hidden()
        .spring("height", FOLD)
        .when(drawn.length > 0, (el) => el.child(v_flex().w_full().flex_none().children(drawn.map((k) => rowChrome(R, {
          id: `kid-${k.t.address}`,
          h: kidH(k),
          pinned: l.pinned,
          selected: Boolean(k.pane) && k.pane === sel,
          click: () => openKid(k.t.address),
          right: () => openMenu({ kind: "kid", terminal: k.t.address }, { width: 210, height: 3 * 31 + 20 }),
          child: kidContent(R, k, isAgent(k.t) ? termsOf(k.t.address) : {}),
        })))));
      els.push(box);
      let y = h;
      for (const k of [...r.kids].reverse()) {
        if (k.pane) order.push(k.pane);
        if (!shownSet.has(k.t.address)) continue;
        if (k.pane) spans.push([k.pane, y, kidH(k)]);
        y += kidH(k);
      }
      h += kidsH;
      els.push(rowChrome(R, {
        id: r.key,
        h: M.agentH,
        pinned: l.pinned,
        selected: l.selected,
        sep: l.sep,
        click: () => focusPane(r.pane),
        right: () => openMenu({ kind: "row", pane: r.pane, terminal: r.a.address }, { width: 210, height: 5 * 31 + 20 }),
        child: agentContent(R, r, { agentsOpen, toggleAgents, ...termsOf(addr) }),
      }));
      spans.push([r.pane, h, M.agentH]);
      h += M.agentH;
      order.push(r.pane);
      agentOrder.push(r.a.address);
      for (const k of [...r.kids].reverse()) if (k.pane && R.agentBy.has(k.t.address)) agentOrder.push(k.t.address);
    }
    const rowAt = new Map(spans.map(([pane, top, rh]) => [pane, [h - top - rh, rh]]));
    return { els, h, order, agentOrder, rowAt };
  }

  // A space's card: its rows (folding into its header) over its header.
  card(R, s, g) {
    const { t } = R;
    const page = R.pages.get(s.id) ?? { agents: [], others: [] };
    const empty = !page.agents.length && !page.others.length;
    const closed = this.closed.has(s.id);
    const bodyShown = !closed && !empty;
    const lines = this.lines(R, page);
    const drawRows = !empty && this.drawn(this.closed, s.id);
    const bodyH = bodyShown ? lines.h : 0;
    const lifted = this.isLifted(s.id);
    const el = v_flex()
      .id(`card-${s.id}`)
      .w_full()
      .flex_none()
      .rounded(M.cardR)
      .border(1)
      .border_color(lifted ? alpha(t.accent, 0.6) : t.border)
      .bg(t.surface)
      .overflow_hidden()
      .child(div()
        .id(`body-${s.id}`)
        .w_full()
        .flex_none()
        .h(bodyH)
        .overflow_hidden()
        .spring("height", FOLD)
        .when(drawRows, (el) => el.child(v_flex().w_full().flex_none().children(lines.els))))
      .child(this.header(t, s, g, R.counts.get(s.id), { hasRows: !empty, closed, bodyShown }));
    return { el, h: 2 + M.header + bodyH, lines, bodyH };
  }

  // A machine's header under its cards (Wierdr's MachineHeader).
  machineHeader(t, name, folded, counts) {
    const key = name ?? "";
    const m = this.machines.find((k) => k.name === name);
    const layout = machines().find((k) => k.name === name)?.layout;
    const connected = !name || m?.state === "connected";
    const why = !connected ? (m?.state ?? (layout === "unavailable" ? "unavailable" : "asleep")).replace(/_/g, " ") : null;
    return h_flex()
      .id(`machine-${key || "local"}`)
      .h(M.machineH)
      .px(px(8))
      .gap(px(8))
      .items_center()
      .rounded(px(8))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(this.foldedMachines, key, FOLDED_MACHINES, cx))
      .child(icon(name ? "server" : "monitor", px(14), t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(px(13)).text_color(t.muted).child(name ?? "This computer"))
      .when(folded, (el) => el.child(this.badges(t, counts) ?? div()))
      .when(Boolean(why), (el) => el.child(div().flex_none().text_size(px(12)).text_color(t.dim).child(why)))
      .child(this.button(t, `machine-add-${key || "local"}`, icon("plus", px(14), t.muted), px(14), px(30), `New space on ${name ?? "this computer"}`,
        () => run("space.new", { machine: key })))
      .child(div().size(px(7)).rounded_full().flex_none().bg(connected ? t.ansi2 : t.dim))
      .child(h_flex().w(px(20)).flex_none().justify_center().child(icon(folded ? "chevron-right" : "chevron-up", px(13), t.dim)));
  }

  note(t, id, text, glyph = null, action = null) {
    return h_flex()
      .id(id)
      .h(M.noteH)
      .px(px(12))
      .gap(px(8))
      .items_center()
      .text_size(px(14))
      .text_color(t.dim)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => action()))
      .when(Boolean(glyph), (el) => el.child(icon(glyph, px(13), t.dim)))
      .child(text);
  }

  // ---- the list -----------------------------------------------------------------------------

  // The list's items top to bottom: [{ el, h, unit?, lane?, card? }], each with the room
  // under it in its h.
  build(R, t) {
    const sp = spaces();
    const ps = panes();
    const remote = [...new Set([...sp.map((s) => s.machine).filter(Boolean), ...this.machines.map((m) => m.name)])].sort();
    const items = [];
    const paneOrder = [];
    const agentOrder = [];
    const cards = (list, lane) => {
      // Drawn bottom up: the first space lowest.
      for (const s of [...list].reverse()) {
        const g = this.git[where(s, ps)] ?? null;
        const c = this.card(R, s, g);
        // `again`: the card drawn afresh, for the drag (an element has one parent).
        items.push({ el: div().w_full().flex_none().pb(M.gap).child(c.el), h: c.h + M.gap, unit: s.id, lane, card: c, space: s, again: () => this.card(R, s, g).el });
        paneOrder.push(...c.lines.order);
        agentOrder.push(...c.lines.agentOrder);
      }
    };
    if (!remote.length) {
      cards(sp, "");
      return { items, paneOrder, agentOrder };
    }
    for (const name of [...remote].reverse().concat([null])) {
      const key = name ?? "";
      const mine = sp.filter((s) => (s.machine ?? null) === name);
      const folded = this.foldedMachines.has(key);
      if (!folded) {
        cards(mine, key);
        const layout = machines().find((k) => k.name === name)?.layout;
        if (layout === "loading") items.push({ el: this.note(t, `loading-${key}`, "Loading…"), h: M.noteH });
        else if (!mine.length && name) items.push({ el: div().pb(M.gap).child(this.note(t, `empty-${key}`, "New space there", "plus", () => run("space.new", { machine: key }))), h: M.noteH + M.gap });
      }
      const counts = sum(mine.map((s) => R.counts.get(s.id)));
      items.push({ el: div().w_full().pb(M.machineAfter).child(this.machineHeader(t, name, folded, counts)), h: M.machineH + M.machineAfter });
    }
    return { items, paneOrder, agentOrder };
  }

  // Bottom-anchored scrolling: `st.off` is how far the list is scrolled up from its bottom.
  // The content sits at the viewport's bottom (so growing pushes up), in a wrapper moved
  // down by `off` (animated only when following a row).
  scroller(t, items, st, { id, overlay = null, onTop = null, follow = null }) {
    const zoom = Number(settings().zoom) || 1;
    // The fades lie over the content's padding at rest: rows go under them only scrolled.
    const total = this.measured[id] ?? items.reduce((n, it) => n + it.h, 0) + FADE + (FADE - M.gap);
    const viewH = this.viewH ?? 0;
    const maxOff = Math.max(0, total - viewH);
    const clamp = (v) => Math.max(0, Math.min(v, maxOff));
    const now = Date.now();
    if (follow && viewH > 0) {
      // [distance of its bottom from the content's bottom, its height]
      const [b, h] = follow;
      if (b < st.off + FOLLOW_MARGIN || b + h > st.off + viewH - FOLLOW_MARGIN) {
        st.off = clamp(h + 2 * FOLLOW_MARGIN <= viewH ? b - (viewH - h) / 2 : b + h - viewH + FOLLOW_MARGIN);
        st.animateUntil = now + SCROLL_MS + 50;
      }
    }
    st.off = clamp(st.off ?? 0);
    const motion = now < (st.animateUntil ?? 0) ? { duration: SCROLL_MS, easing: "ease-out" } : { duration: 0 };
    const scrollTo = (v, cx) => {
      const next = clamp(v);
      st.animateUntil = 0;
      if (onTop && maxOff > 0 && next >= maxOff - 2) onTop(cx);
      if (next === st.off) return;
      st.off = next;
      cx.notify();
    };
    this.maxOff = maxOff;
    this.listTotal = total;
    // The scrollbar: its thumb as much of the track as shows, at the bottom at rest.
    const thumbH = total > 0 ? Math.max(24, (viewH * viewH) / total) : 0;
    const thumbTop = maxOff > 0 ? (1 - st.off / maxOff) * (viewH - thumbH) : 0;
    // A gradient can only be painted: a filled box in it.
    const fade = (top) => div().absolute().left(0).right(0).h(FADE).when(top, (el) => el.top(0)).when(!top, (el) => el.bottom(0))
      .child(globalThis.window.paint_path(
        PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build(),
        Background.linear_gradient(top ? 180 : 0, Background.stop(t.chrome, 0), Background.stop(alpha(t.chrome, 0), 100)),
      ).absolute().top(0).left(0).size_full());
    return div()
      .id(id)
      .relative()
      .flex_1()
      .min_h(0)
      .w_full()
      .overflow_hidden()
      .on_size_change((size, cx) => {
        this.viewH = size.height / zoom;
        this.viewW = size.width / zoom;
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => scrollTo(st.off + e.delta.y / zoom, cx))
      .on_mouse_move((e, cx) => {
        this.dragMove(e, cx);
        if (!this.thumbDrag) return;
        const track = viewH - thumbH;
        if (track > 0) scrollTo(this.thumbDrag.off - ((e.position.y - this.thumbDrag.y) / zoom) * (maxOff / track), cx);
      })
      .on_mouse_up("left", (_e, cx) => {
        this.thumbDrag = null;
        this.dragRelease(cx);
      })
      .on_hover((on, cx) => {
        if (on) return;
        this.thumbDrag = null;
        this.dragLeave(cx);
      })
      .child(div()
        .absolute()
        .left(0)
        .right(0)
        .top(st.off)
        .transition("top", motion)
        .h(viewH)
        .child(v_flex()
          .id(`${id}-content`)
          .absolute()
          .left(0)
          .right(0)
          .bottom(0)
          // The real height (sizes round to the screen's pixels): how far it can scroll.
          .on_size_change((size, cx) => {
            this.measured[id] = size.height / zoom;
            if (st.off > Math.max(0, this.measured[id] - viewH) + 0.5) cx.notify();
          })
          .px(M.side)
          .pt(FADE)
          .pb(FADE - M.gap)
          .children(items.map((it) => it.el))))
      .child(fade(true))
      .child(fade(false))
      .when(Boolean(overlay), (el) => el.child(overlay))
      .when(maxOff > 0, (el) => el.child(div()
        .id(`${id}-thumb`)
        .absolute()
        .right(0)
        .top(thumbTop)
        .transition("top", motion)
        .w(THUMB_HIT)
        .h(thumbH)
        .flex()
        .justify_end()
        .pr(THUMB_RIGHT)
        .on_hover((on, cx) => { this.thumbHover = on; cx.notify(); })
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.thumbDrag = { y: e.position.y, off: st.off };
          st.animateUntil = 0;
          cx.notify();
        })
        .child(div().w(THUMB_W).h_full().rounded(THUMB_W / 2).bg(this.thumbDrag || this.thumbHover ? alpha(t.muted, 0.6) : alpha(t.dim, 0.4)))));
  }

  // ---- render -------------------------------------------------------------------------------

  // New spaces get the least used color (the desktop's spaces mods do the same).
  colors() {
    const sp = spaces();
    const ids = new Set(sp.map((s) => s.id));
    const all = shared("space.colors") ?? {};
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(all).length;
    for (const s of sp) {
      if (kept[s.id] || s.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[s.id] = PALETTE.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
  }

  context(t) {
    const now = Date.now();
    const snap = snapshot(now);
    this.stampWant = wantedStamps(snap.byAddr.values());
    this.foldEndedTerms(snap.byAddr.values());
    const f = focused();
    const R = { ...snap, t, dark: settings().dark !== false, focusedPane: f?.pane ?? null, viewW: this.viewW, due: null };
    R.age = (ms) => {
      if (!ms) return null;
      const at = ageTick(ms, now);
      if (R.due == null || at < R.due) R.due = at;
      return age(ms, now);
    };
    return R;
  }

  render() {
    const t = theme();
    this.colors();
    const R = this.context(t);
    this.placeKept(R);
    this.sessions.remember(R.byAddr.values(), R.now);

    const sessionsOf = this.sessions.space ? spaces().find((s) => s.id === this.sessions.space) : null;
    if (this.sessions.space && !sessionsOf) this.sessions.hide();
    if (sessionsOf) {
      const view = this.sessionsView(t, R, sessionsOf);
      this.due = R.due;
      return view;
    }

    const { items, paneOrder, agentOrder } = this.build(R, t);
    this.paneOrder = paneOrder;
    setAgentOrder(agentOrder);
    this.due = R.due;

    // The pane in front (or the shown space) changed: its row comes into view.
    const active = spaces().find((s) => s.active)?.id ?? null;
    const followKey = `${active ?? ""}|${R.focusedPane ?? ""}`;
    const dragging = this.dnd != null && this.dnd.phase !== "press";
    let follow = null;
    if (this.viewH && followKey !== this.followKey && !dragging) {
      // [its bottom's distance from the content's bottom, its height]: the focused row,
      // else the shown space's card.
      let b = FADE - M.gap, card = null;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.card) {
          const bottom = b + M.gap;
          const row = it.card.bodyH > 0 ? it.card.lines.rowAt.get(R.focusedPane) : null;
          if (row) { follow = [bottom + 1 + M.header + row[0], row[1]]; break; }
          if (it.space.id === active && !card) card = [bottom, it.card.h];
        }
        b += it.h;
      }
      follow ??= card;
      if (follow || !active) this.followKey = followKey;
    }

    const { items: shown, overlay } = this.dragLayout(t, items);
    const empty = !spaces().length;
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(px(14))
      .child(this.scroller(t, shown, this.scroll, { id: "wl-list", overlay, follow }))
      .when(empty, (el) => el.child(v_flex().absolute().top(0).left(0).size_full().items_center().justify_center().gap(px(8)).px(px(32))
        .child(div().text_size(px(17)).font_semibold().text_color(t.foreground).child("No spaces"))
        .child(div().text_size(px(15)).text_color(t.muted).child("Start one with + below."))));
  }

  // A space's sessions over a bar with Back, drawn bottom up.
  sessionsView(t, R, space) {
    const items = this.sessions.items(R, space);
    const total = items.reduce((n, it) => n + it.h, 0);
    this.sessions.short = this.viewH > 0 && total < this.viewH;
    const count = this.sessions.count(space);
    const list = div().w_full().flex_none().rounded(M.cardR).border(1).border_color(t.border).bg(t.surface).overflow_hidden()
      .child(v_flex().w_full().children(items.map((it) => it.el)));
    const back = h_flex()
      .h(M.header)
      .flex_none()
      .mx(M.side)
      .mb(M.gap)
      .px(px(8))
      .gap(px(8))
      .items_center()
      .rounded(M.cardR)
      .border(1)
      .border_color(t.border)
      .bg(t.surface)
      .child(h_flex()
        .id("sessions-back")
        .h(px(32))
        .pl(px(4))
        .pr(px(10))
        .gap(px(4))
        .flex_none()
        .items_center()
        .rounded(px(8))
        .cursor_pointer()
        .text_size(px(14))
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.sessions.hide(); cx.notify(); })
        .child(icon("chevron-left", px(14), t.muted))
        .child("Back"))
      .child(div().flex_1())
      .child(this.avatar(space, t, px(18)))
      .child(div().min_w(0).truncate().text_size(px(14)).text_color(t.muted).child(space.name))
      .when(count != null, (el) => el.child(div().flex_none().text_size(px(13)).text_color(t.dim).child(String(count))))
      .child(icon("history", px(13), t.dim));
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(this.scroller(t, [{ el: div().w_full().pb(M.gap).child(list), h: total + 2 + M.gap }], this.sessScroll, {
        id: "wl-sessions",
        onTop: (cx) => this.sessions.more(cx),
      }))
      .child(back);
  }

  // The shown space's pi sessions, or back from them.
  toggleSessions(cx) {
    if (this.sessions.space) this.sessions.hide();
    else {
      const s = spaces().find((x) => x.active);
      if (!s || s.machine) return;
      this.sessScroll = { off: 0, animateUntil: 0 };
      this.sessions.show(s, cx);
    }
    cx.notify();
  }

  // ⌘] / ⌘[: the next or previous row as drawn (top to bottom), wrapping around.
  step(dir) {
    const list = this.paneOrder ?? [];
    if (!list.length) return;
    const at = list.indexOf(focused()?.pane ?? null);
    const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    if (list[next] !== list[at]) run("pane.focus", { pane: list[next] });
  }

  // Sub-agents kept from their peek whose tab has shown up: each moves right after its
  // ancestor's tab (past that ancestor's other kept children's), once.
  placeKept(R) {
    const want = shared(KEEP);
    if (!want || !Object.keys(want).length) return;
    const now = Date.now();
    const left = { ...want };
    const ps = panes();
    const kinOf = (root) => {
      const out = new Set();
      const walk = (a) => { for (const k of R.byAddr.values()) if (k.parent === a && k.state === "live" && !out.has(k.address)) { out.add(k.address); walk(k.address); } };
      walk(root);
      return out;
    };
    for (const [addr, w] of Object.entries(want)) {
      const pane = ps.find((p) => p.terminal === addr);
      if (!pane) {
        if (now - (w.at ?? 0) > KEEP_WAIT_MS) delete left[addr];
        continue;
      }
      delete left[addr];
      const space = spaces().find((s) => (s.tabs ?? []).some((tab) => tab.id === pane.tab));
      if (!space) continue;
      const ids = space.tabs.map((tab) => tab.id);
      const rest = ids.filter((id) => id !== pane.tab);
      let at = rest.indexOf(w.after);
      if (at < 0) continue;
      const kin = kinOf(w.root);
      const kinTab = (id) => {
        const its = ps.filter((p) => p.tab === id);
        return its.length > 0 && its.every((p) => p.terminal && kin.has(p.terminal));
      };
      while (at + 1 < rest.length && kinTab(rest[at + 1])) at++;
      if (ids.indexOf(pane.tab) !== at + 1) run("tab.move", { id: pane.tab, index: at + 2 });
    }
    if (Object.keys(left).length !== Object.keys(want).length) setShared(KEEP, left);
  }

  // ---- dragging a card by its header ----------------------------------------------------------
  // `this.dnd`: { id, seq, phase: "press" | "lift" | "drop", grab: where in its card the
  // pointer holds it (from the card's top), pointer: the pointer's y in the list, from /
  // target: the slot it came from and the one it would land in, index: space.move's }.

  isLifted(id) {
    return this.dnd?.phase === "lift" && this.dnd.id === id;
  }

  // `foldable`: the card has rows, so a click folds or unfolds it.
  press(s, e, cx, foldable = false) {
    const zoom = Number(settings().zoom) || 1;
    this.dnd?.hold?.cancel();
    this.dnd?.scroller?.cancel();
    const d = {
      id: s.id,
      seq: ++this.dndSeq,
      phase: "press",
      x0: e.position.x,
      y0: e.position.y,
      // Within its header, at the card's bottom: from the card's top later (dragLayout).
      grabInHeader: e.local_position ? e.local_position.y / zoom : M.header / 2,
      pointer: null,
      moved: false,
      foldable,
    };
    this.dnd = d;
    d.hold = cx.timer.after(HOLD_MS, (cx) => {
      if (this.dnd !== d || d.phase !== "press") return;
      d.phase = "lift";
      cx.notify();
    });
  }

  dragMove(e, cx) {
    const d = this.dnd;
    if (!d || d.phase === "drop") return;
    const zoom = Number(settings().zoom) || 1;
    const far = Math.hypot(e.position.x - d.x0, e.position.y - d.y0) >= SLOP * zoom;
    if (d.phase === "press") {
      if (!far) return;
      d.hold?.cancel();
      d.phase = "lift";
      this.scroll.animateUntil = 0;
    }
    d.moved ||= far;
    const y = e.local_position.y / zoom;
    if (y === d.pointer) return;
    d.pointer = y;
    if (d.moved) this.autoScroll(cx);
    cx.notify();
  }

  dragRelease(cx) {
    const d = this.dnd;
    if (!d) return;
    d.hold?.cancel();
    if (d.phase === "press") {
      this.dnd = null;
      if (d.foldable) this.toggle(this.closed, d.id, CLOSED, cx);
      cx.notify();
      return;
    }
    if (d.phase !== "lift") return;
    if (!d.moved) {
      // Held still and let go: a click too (it lifted, so it settles back first).
      d.target = d.from;
      if (d.foldable) this.toggle(this.closed, d.id, CLOSED, cx);
    } else if (d.target !== d.from && d.index) run("space.move", { id: d.id, index: d.index });
    this.settle(d, cx);
  }

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

  edgeSpeed() {
    const d = this.dnd;
    const h = this.viewH ?? 0;
    if (d?.phase !== "lift" || !d.moved || d.pointer == null || !h) return 0;
    // Near the top: further up the list (off grows); near the bottom: back down.
    if (d.pointer < EDGE) return EDGE_SPEED * Math.min(1, (EDGE - d.pointer) / EDGE);
    if (d.pointer > h - EDGE) return -EDGE_SPEED * Math.min(1, (d.pointer - h + EDGE) / EDGE);
    return 0;
  }

  autoScroll(cx) {
    const d = this.dnd;
    if (!d || d.scroller || !this.edgeSpeed()) return;
    d.scroller = cx.timer.every(16, (cx) => {
      const v = this.dnd === d ? this.edgeSpeed() : 0;
      const st = this.scroll;
      const next = Math.max(0, Math.min(this.maxOff ?? 0, (st.off ?? 0) + v));
      if (!v || next === st.off) {
        d.scroller?.cancel();
        d.scroller = null;
        return;
      }
      st.off = next;
      st.animateUntil = 0;
      cx.notify();
    });
  }

  // While a card is lifted or settling: it leaves the list and is drawn over it where the
  // pointer holds it; a slot opens (as tall as the card) where it would land among its
  // machine's cards, the others closed, so the cards between part. Bottom up: the slot
  // whose bottom is nearest the card's bottom, measured with every slot closed (the cards
  // under a slot don't move when it opens). -> { items, overlay }
  dragLayout(t, items) {
    const d = this.dnd;
    if (!d || d.phase === "press") return { items, overlay: null };
    const at = items.findIndex((it) => it.unit === d.id);
    if (at < 0) {
      d.scroller?.cancel();
      this.dnd = null;
      return { items, overlay: null };
    }
    const src = items[at];
    const lane = src.lane;
    const H = src.h;
    const rest = [...items.slice(0, at), ...items.slice(at + 1)];
    // Slots: over each card of its lane, and under the lowest. Each at its distance from the
    // content's bottom (`b`), with every slot closed. `key`: the space it goes after
    // (over it, drawn), or "first" under the lowest.
    const below = [];
    let b = FADE - M.gap;
    for (let i = rest.length - 1; i >= 0; i--) { below[i] = b; b += rest[i].h; }
    const lanes = rest.map((it, i) => ({ it, i })).filter(({ it }) => it.unit != null && it.lane === lane);
    const slots = lanes.map(({ it, i }) => ({ key: it.unit, at: i, b: below[i] + it.h }));
    if (lanes.length) {
      const low = lanes[lanes.length - 1];
      slots.push({ key: "first", at: low.i + 1, b: below[low.i] });
    } else slots.push({ key: "first", at, b: at < rest.length ? below[at] + rest[at].h : FADE - M.gap });
    // Where it came from: the slot just over the card under it, or the lowest.
    const fromSlot = slots.find((s) => s.at === at) ?? slots[slots.length - 1];
    const viewH = this.viewH ?? 0;
    const off = this.scroll.off ?? 0;
    // Viewport y of a content-bottom distance.
    const yOf = (bb) => viewH + off - bb;
    d.grab ??= H - M.gap - M.header + d.grabInHeader;
    d.pointer ??= yOf(fromSlot.b + H) + d.grab;
    const cardTop = d.pointer - d.grab;
    let target;
    if (d.phase === "lift") {
      d.from = fromSlot.key;
      const cardB = viewH + off - (cardTop + H);
      target = slots.reduce((best, s) => (Math.abs(s.b - cardB) < Math.abs(best.b - cardB) ? s : best));
      d.target = target.key;
      const order = spaces().map((s) => s.id).filter((id) => id !== d.id);
      if (target.key === "first") {
        const firstOfLane = spaces().find((s) => (s.machine ?? "") === lane && s.id !== d.id);
        d.index = firstOfLane ? order.indexOf(firstOfLane.id) + 1 : null;
      } else d.index = order.indexOf(target.key) + 2;
    } else target = slots.find((s) => s.key === d.target) ?? fromSlot;
    // Landed: spaces() has it where the slot is.
    d.landed = d.from === d.target || (() => {
      const order = spaces().map((s) => s.id);
      const i = order.indexOf(d.id);
      return d.target === "first" ? !spaces().some((s, j) => j < i && (s.machine ?? "") === lane) : order[i - 1] === d.target;
    })();

    const slot = (s) => {
      const open = s.key === target.key;
      return {
        h: open ? H : 0,
        el: div()
          .id(`dnd-${d.seq}-${s.key}`)
          .w_full()
          .flex_none()
          .h(open ? H : 0)
          .overflow_hidden()
          .transition("height", { duration: PART_MS, easing: "ease-out" })
          .child(div()
            .h(H - M.gap)
            .rounded(M.cardR)
            .border(1)
            .border_dashed()
            .border_color(alpha(t.accent, 0.35))
            .bg(alpha(t.accent, 0.05))),
      };
    };
    const out = [];
    rest.forEach((it, i) => {
      for (const s of slots) if (s.at === i) out.push(slot(s));
      out.push(it);
    });
    for (const s of slots) if (s.at === rest.length) out.push(slot(s));

    const up = d.phase === "lift";
    const overlay = div()
      .id(`dnd-card-${d.seq}`)
      .absolute()
      .left(M.side)
      .right(M.side)
      .top(up ? cardTop : yOf(target.b + H))
      .transition("top", up ? { duration: 0 } : { duration: SETTLE_MS, easing: "ease-out" })
      .when(up, (el) => el.cursor_grabbing())
      .child(div().rounded(M.cardR).when(up, (el) => el.shadow_2xl()).child(src.again()));
    return { items: out, overlay };
  }
}

