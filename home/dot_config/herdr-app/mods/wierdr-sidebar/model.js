// What the sidebar shows, read from Herdr's live data once per render: Wierdr's
// WierdrModel (PhoneList, SidebarOrder, SubAgents) on herdr's agents(), terminals(),
// panes() and spaces().
//
// - A space's card: its agents (each with its live sub-agents and terminals, `hc run`,
//   riding along) in Telegram's order: pinned first (the newest pin first), then by
//   their latest status change (theirs or a sub-agent's), newest first; then its other
//   panes (plain terminals, mod panes), tabs with agents first. The card draws it all
//   bottom up (list.js).
// - The counts count each agent with a pane, and each sub-agent as it reads under the
//   agent it shows under (never done: it reports to its parent).

import { agents, terminals, panes, spaces, home } from "herdr";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// Most urgent first: the status ring's order, and the menus'.
export const ORDER = ["blocked", "done", "working", "idle"];

// A sub-agent's status as it reads under its parent: an error is blocked, done is idle.
// `listed`: agents() as address -> status (a kept one has a pane, and that status).
export const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s ?? null;
};

// A child that reports a status is a sub-agent; one that doesn't is a plain terminal.
export const isAgent = (k) => k.status != null || k.report != null;

// When the terminal got into its status (the core's stamp), ms.
export const since = (term) => term?.status_ms ?? null;

// The pin's time: Wierdr writes `herdr.pinned=<unix seconds>`; the desktop's own pin is "1".
export function pinnedAt(term) {
  const n = Number(term?.labels?.["herdr.pinned"]);
  return Number.isFinite(n) && n > 1e8 ? n : null;
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// A terminal title that says something: not the program's name, a folder or user@host.
const telling = (live, prog) =>
  Boolean(live) && live !== prog?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== prog?.key;

// An agent's title: its own word (pi's session name, a question while blocked), else a
// tab someone named, else a telling title, else its program's name.
export function agentTitle(a, term, tab) {
  const msg = clean(term?.report?.msg);
  if (msg) return msg;
  if (tab?.named && tab.name && tab.name.toLowerCase() !== (a.program?.name ?? "").toLowerCase()) return tab.name;
  const live = clean(a.title ?? term?.title);
  if (telling(live, a.program)) return live;
  return a.program?.name || a.tab_name || a.address;
}

// A sub-agent's: its own word, else a telling title, else its name (hc run --name).
// `plain`: a terminal that isn't an agent: its name, template or program.
export function kidTitle(k, plain = false) {
  if (!plain) {
    const msg = clean(k.report?.msg);
    if (msg) return msg;
    const live = clean(k.title);
    if (telling(live, k.program)) return live;
  }
  return k.name || k.template || k.program?.name || k.address;
}

// 56s, 28m, 3h, 2d.
export function age(ms, now) {
  if (!ms) return null;
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// When age() of `ms` next reads differently.
export function ageTick(ms, now) {
  const e = Math.max(0, now - ms);
  for (const [size, max] of [[1000, 60000], [60000, 3600000], [3600000, 86400000], [86400000, Infinity]]) {
    if (e < max) return ms + (Math.floor(e / size) + 1) * size;
  }
  return now + 86400000;
}

// A path as people write it: ~ for home.
export const tilde = (path) => {
  const h = home();
  return path && h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
};
const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || path;
// Where a shell is, as it says itself (user@host:~/x); right on another machine too.
const shellPath = (p) => p.title?.match(/^[^\s@]+@[^\s:]+:\s*(.+)$/)?.[1]?.trim() || null;
// A pane's folder: what its shell says, else where the process in front works.
export const paneWhere = (p, term) => (p.program?.shell ? shellPath(p) : null) ?? tilde(term?.foreground?.cwd ?? p.cwd);
// The process in front by its own name: argv[0], a login shell's "-" dropped.
export const procName = (term) => {
  const fg = term?.foreground;
  const own = (argv) => base(argv?.[0] ?? "").replace(/^-/, "");
  return own(fg?.argv) || fg?.name || own(term?.argv) || null;
};
// A path cut to `max` letters from the middle: ~/…/slides/deck.
export function shortPath(path, max) {
  if (!path || path.length <= max) return path;
  const parts = path.split("/");
  const head = parts[0] === "~" ? "~/…/" : "…/";
  let tail = parts.pop();
  while (parts.length > 1 && head.length + parts.at(-1).length + 1 + tail.length <= max) tail = `${parts.pop()}/${tail}`;
  return head.length + tail.length <= max ? head + tail : `…${tail.slice(-(max - 1))}`;
}

// Everything the list needs this render.
// -> { now, list, listed, agentBy, byAddr, paneOf, tabs, pages: Map(space id -> page),
//      counts: Map(space id -> {blocked, done, working, idle}), all: counted agents (every
//      space, in the list's order) }
// page: { agents: [row], others: [row] }; an agent row: { kind: "agent", key, pane, tab, a,
// term, kids: [{ t, lines, pane }], last }; another: { kind: "pane" | "mod", key, pane, tab, p, term }.
export function snapshot(now = Date.now()) {
  const list = agents();
  const listed = new Map(list.map((a) => [a.address, a.status]));
  const agentBy = new Map(list.map((a) => [a.address, a]));
  const all = terminals();
  const byAddr = new Map(all.map((t) => [t.address, t]));
  const ps = panes();
  const paneOf = new Map();
  for (const p of ps) if (p.terminal && !paneOf.has(p.terminal)) paneOf.set(p.terminal, p.pane);
  const tabs = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, tab])));

  // Live terminals by who started them, oldest first.
  const children = new Map();
  for (const t of all) {
    if (t.state !== "live" || !t.parent || t.parent === t.address) continue;
    if (!children.has(t.parent)) children.set(t.parent, []);
    children.get(t.parent).push(t);
  }
  for (const kids of children.values()) {
    kids.sort((a, b) => (a.created_ms ?? 0) - (b.created_ms ?? 0) || a.address.length - b.address.length || (a.address < b.address ? -1 : 1));
  }
  // Depth first, each with the tree's lines in front of it.
  const subtree = (addr) => {
    const out = [];
    const seen = new Set([addr]);
    const walk = (up, lead) => {
      const kids = (children.get(up) ?? []).filter((k) => !seen.has(k.address) && seen.add(k.address));
      kids.forEach((k, i) => {
        const last = i === kids.length - 1;
        out.push({ t: k, lines: [...lead, last ? "└" : "├"], pane: paneOf.get(k.address) ?? null });
        walk(k.address, [...lead, last ? "" : "│"]);
      });
    };
    walk(addr, []);
    return out;
  };
  // The topmost agent of the list `addr` shows under, up through live terminals.
  const root = (addr) => {
    let up = byAddr.get(addr)?.parent, top = null;
    const seen = new Set([addr]);
    while (up && !seen.has(up)) {
      seen.add(up);
      if (listed.has(up)) top = up;
      const p = byAddr.get(up);
      if (p?.state !== "live") break;
      up = p.parent;
    }
    return top;
  };
  const nested = (addr) => byAddr.get(addr)?.state === "live" && root(addr) != null;

  const lastChange = (r) => Math.max(since(r.term) ?? 0, ...r.kids.filter((k) => isAgent(k.t)).map((k) => since(k.t) ?? 0));
  const byAddress = (x, y) => (x.a.address < y.a.address ? -1 : x.a.address > y.a.address ? 1 : x.pane < y.pane ? -1 : 1);
  // Telegram's chat list: pinned first (the newest pin first; desktop pins after timed
  // ones), then the latest change first.
  const phone = (x, y) => {
    const px = x.a.pinned, py = y.a.pinned;
    if (px !== py) return px ? -1 : 1;
    if (px) {
      const tx = pinnedAt(x.term), ty = pinnedAt(y.term);
      if (tx != null && ty != null && tx !== ty) return ty - tx;
      if ((tx != null) !== (ty != null)) return tx != null ? -1 : 1;
    } else {
      const dx = x.last, dy = y.last;
      if (dx !== dy) return dy - dx;
    }
    return byAddress(x, y);
  };
  // A tab's agents among themselves (which tab comes first): pinned, urgent, recent.
  const urgent = (x, y) => (x.a.pinned !== y.a.pinned ? (x.a.pinned ? -1 : 1) : 0)
    || (y.urgency - x.urgency) || ((since(y.term) ?? 0) - (since(x.term) ?? 0)) || (x.a.address > y.a.address ? -1 : 1);

  const pages = new Map();
  const counts = new Map();
  const everyRow = [];
  for (const s of spaces()) {
    const withAgents = [], without = [];
    for (const tab of s.tabs ?? []) {
      const rows = [], others = [];
      for (const p of ps) {
        if (p.tab !== tab.id) continue;
        if (!p.terminal) { others.push({ kind: "mod", key: `pn-${p.pane}`, pane: p.pane, tab: tab.id, p, term: null }); continue; }
        if (nested(p.terminal)) continue;
        const a = agentBy.get(p.terminal);
        const term = byAddr.get(p.terminal);
        if (a) {
          const kids = subtree(p.terminal);
          const urgency = Math.max(RANK[a.status] ?? 0, ...kids.map((k) => RANK[kidStatus(k.t, listed)] ?? 0));
          const r = { kind: "agent", key: `ag-${p.pane}`, pane: p.pane, tab: tab.id, space: s, a, term, kids, urgency };
          r.last = lastChange(r);
          rows.push(r);
        } else others.push({ kind: "pane", key: `pn-${p.pane}`, pane: p.pane, tab: tab.id, p, term });
      }
      rows.sort(urgent);
      if (rows.length) withAgents.push({ rows, others });
      else if (others.length) without.push({ rows, others });
    }
    withAgents.sort((g, h) => urgent(g.rows[0], h.rows[0]));
    const groups = [...withAgents, ...without];
    const page = { agents: groups.flatMap((g) => g.rows).sort(phone), others: groups.flatMap((g) => g.others) };
    pages.set(s.id, page);
    everyRow.push(...page.agents);
    const c = { blocked: 0, done: 0, working: 0, idle: 0 };
    for (const x of counted(page.agents, listed)) c[x.status] = (c[x.status] ?? 0) + 1;
    counts.set(s.id, c);
  }
  return { now, list, listed, agentBy, byAddr, paneOf, tabs, pages, counts, all: counted(everyRow.sort(phone), listed) };
}

// The agents these rows count, in their order: each row's agent, then its sub-agents
// (as they read under it). A terminal counts once. -> [{ address, status, kid, rowPane }]
export function counted(rows, listed) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!seen.has(r.a.address) && r.a.status) {
      seen.add(r.a.address);
      out.push({ address: r.a.address, status: r.a.status, kid: null, rowPane: r.pane });
    }
    for (const k of r.kids) {
      if (!isAgent(k.t) || seen.has(k.t.address)) continue;
      const s = kidStatus(k.t, listed);
      if (!s) continue;
      seen.add(k.t.address);
      out.push({ address: k.t.address, status: s, kid: k, rowPane: r.pane });
    }
  }
  return out;
}

// Counts by status, adding up several.
export function sum(list) {
  const out = { blocked: 0, done: 0, working: 0, idle: 0 };
  for (const c of list) for (const s of ORDER) out[s] += c?.[s] ?? 0;
  return out;
}
