// The sidebar's header, at its bottom (Wierdr's SidebarHeader): one row of three blocks,
// the limits' rings at its left (the `limits` mod, props {rings}), the agents' statuses as
// one ring in its middle (props {ring}), + in a circle at its right (props {plus}); and
// the strip at the sidebar's top (props {top}), empty, for the window's buttons and drag.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, spaces, focused, knownAgents, shared, setShared, checking } from "herdr";
import { M, px, icon, rings, alpha, statusColor } from "./look.js";
import { snapshot, ORDER } from "./model.js";
import { openCounted, openMenu, popupAt } from "./actions.js";

// From the header's row to the window's bottom.
export const BAR_BOTTOM = px(8);

export class Top {
  render() {
    return div().size_full().bg(theme().chrome);
  }
}

// The agents' statuses as one ring (Wierdr's StatusRing): a dash per agent from the top,
// clockwise, the most urgent first (needs you, done, working) in their colors and idle
// ones faint, as a track; past DASHES agents an arc per status, each at least LEAST of
// the ring. Inside, how many have the most urgent status, in its color (idle's dim).
const RADIUS = px(14), LINE = px(3.5), GAP = px(1.5), DASHES = 24, LEAST = 0.1;
const SIZE = 2 * RADIUS + LINE;

export function segments(counts) {
  const present = ORDER.filter((s) => counts[s] > 0).map((s) => [s, counts[s]]);
  const total = present.reduce((n, [, c]) => n + c, 0);
  if (!total) return [];
  const gap = GAP / (2 * Math.PI * RADIUS);
  if (total <= DASHES) {
    const share = 1 / total;
    return present.flatMap(([s, n]) => Array(n).fill(s)).map((s, i) => ({ status: s, from: i * share + gap / 2, to: (i + 1) * share - gap / 2 }));
  }
  const weights = present.map(([, n]) => Math.max(n / total, LEAST));
  const sum = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  return present.map(([s], i) => {
    const share = weights[i] / sum;
    const seg = { status: s, from: at + gap / 2, to: at + share - gap / 2 };
    at += share;
    return seg;
  });
}

export function statusRing(t, counts) {
  const segs = segments(counts);
  const top = ORDER.find((s) => counts[s] > 0);
  const color = (s) => (s === "idle" ? alpha(t.idle ?? t.dim, 0.45) : statusColor(t, s));
  const strokes = ORDER.map((s) => ({ r: RADIUS / SIZE, w: LINE, color: color(s), arcs: segs.filter((g) => g.status === s).map((g) => [g.from, g.to]) }));
  if (!segs.length) strokes.push({ r: RADIUS / SIZE, w: LINE, color: alpha(t.idle ?? t.dim, 0.3), arcs: [[0, 1]] });
  const n = top ? counts[top] : null;
  return rings(SIZE, strokes, {
    child: n == null ? null : div().text_size(px(n > 99 ? 11 : 14)).font_semibold().text_color(top === "idle" ? t.dim : statusColor(t, top)).child(String(n)),
  });
}

const WORD = { blocked: "needs you", done: "done", working: "working", idle: "idle" };

export class Ring {
  render() {
    const t = theme();
    const all = snapshot().all;
    const counts = { blocked: 0, done: 0, working: 0, idle: 0 };
    for (const x of all) counts[x.status] += 1;
    const top = ORDER.find((s) => counts[s] > 0);
    const first = top ? all.find((x) => x.status === top) : null;
    const tip = ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${WORD[s]}`).join(" · ") || "No agents";
    return h_flex()
      .size_full()
      .bg(t.chrome)
      .pb(BAR_BOTTOM)
      .items_center()
      .justify_center()
      .child(h_flex()
        .id("status-ring")
        .size(M.bar)
        .flex_none()
        .items_center()
        .justify_center()
        .rounded_full()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(top ? `${tip}\nClick: the first that ${top === "blocked" ? "needs you" : `is ${WORD[top]}`} · Right-click: by status` : tip)
        .on_click(() => { if (first) openCounted(first); })
        .on_mouse_down("right", (e) => {
          const n = ORDER.filter((s) => counts[s] > 0).length;
          if (!n) return;
          const h = 10 + n * 31;
          openMenu({ kind: "status" }, { at: e.bounds ? popupAt(e.bounds, 200, h) : undefined, width: 200, height: h });
        })
        .child(statusRing(t, counts)));
  }
}

// + (Wierdr's SidebarMenu): Settings, Hide Sidebar, then a new space (a terminal or an
// installed agent) in the folder of the pane in front, on its machine, nearest the button.
export const KNOWN = "wierdr.agents";

export class Plus {
  init() {
    if (!checking()) this.refresh();
  }

  refresh() {
    const machine = spaces().find((s) => s.active)?.machine ?? null;
    knownAgents({ on: machine }).then((list) => {
      setShared(KNOWN, { ...(shared(KNOWN) ?? {}), [machine ?? ""]: list });
    }).catch(() => {});
  }

  render() {
    const t = theme();
    return h_flex()
      .size_full()
      .bg(t.chrome)
      .pb(BAR_BOTTOM)
      .pr(M.barSide)
      .items_center()
      .justify_end()
      .child(h_flex()
        .id("plus")
        .size(M.bar)
        .flex_none()
        .items_center()
        .justify_center()
        .rounded_full()
        .bg(t.surface)
        .border(1)
        .border_color(t.border)
        .shadow_sm()
        .cursor_pointer()
        .hover((s) => s.bg(t.raised))
        .tooltip("New space, Settings")
        .on_mouse_down("left", (e) => {
          this.refresh();
          const machine = spaces().find((s) => s.active)?.machine ?? "";
          const agents = (shared(KNOWN)?.[machine] ?? []).filter((a) => a.installed).length;
          const h = 10 + 2 * 31 + 9 + 26 + 31 + Math.max(1, agents) * 31;
          const f = focused();
          openMenu({ kind: "plus", folder: f?.cwd ?? null }, { at: e.bounds ? popupAt(e.bounds, 250, h, { align: "end" }) : undefined, width: 250, height: h });
        })
        .child(icon("plus", px(20), t.accent)));
  }
}
