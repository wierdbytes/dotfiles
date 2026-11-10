// What the sidebar panel's parts share: the spaces list (spaces.js) and the agent
// rows and sessions under it (agents.js). A mod can't import another mod's files,
// so they all live in this one folder.

import { div, svg } from "gpui-kit";
import { layout, run, shared, setShared, theme, window } from "herdr";

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
export const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
export function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
export function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A group header's mark next to its count: v when its rows show, > when folded.
export const foldMark = (open) => svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(theme().dim);

// How urgent a status is: the priority sort's order, and which mark leads.
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
// `listed`: agents() as address -> status.
export const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// A child that reports a status is a sub-agent; one that doesn't is a plain terminal.
export const isAgent = (k) => k.status != null || k.report != null;

// Live children of `addr` (terminals(): hc sub-agents and terminals), depth first,
// each with the tree lines in front of it.
export function tree(all, addr, lead = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lead, last ? "└" : "├"] },
      ...tree(all, k.address, [...lead, last ? "" : "│"]),
    ];
  });
}

// A status's mark: working a still ring with an arc, needs you a red pill ("!"
// when compact, where a header or a count already says it), done a dot, idle a
// ring. Nothing spins: any running animation makes the whole window redraw every
// frame (~20% GPU for as long as an agent works).
export function statusMark(t, status, compact = false) {
  const color = t[status] ?? t.dim;
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working);
  if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(status === "done" ? color : t.dim + "00");
}

// An agent card's background by its status, in its mark's color: working, done,
// needs you; idle (and anything else) none. `hover`: a step stronger.
const TINT = { working: true, done: true, blocked: true };

// The focused row's accent ring: drawn over the row (which must be relative), so
// nothing in it moves. `radius`: the row's own.
export const focusRing = (t, radius = 8) => div().absolute().top(0).left(0).right(0).bottom(0).rounded(radius).border(1).border_color(t.accent);
export function statusTint(t, status, hover = false) {
  const color = TINT[status] ? t[status] : null;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return color + (hover ? "3d" : "26");
}
