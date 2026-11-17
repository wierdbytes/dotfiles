// Sizes, fonts and drawing pieces shared by the sidebar's parts.
//
// The sidebar is Wierdr's (the iPad and iPhone app, ~/me/dev/wierdr), whose sizes are
// made for a thumb: everything here is Wierdr's points scaled by S, so the whole look
// can be made bigger or smaller with one number.

import { div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings } from "herdr";

export const S = 0.85;
// Wierdr's points in px at zoom 1.
export const px = (n) => Math.round(n * S * 100) / 100;

// Row and card sizes (Wierdr's PhoneRowMetrics, SpaceHeader, SpacesList, MachineHeader).
export const M = {
  // The list's sides, and between cards.
  side: px(8),
  gap: px(8),
  cardR: px(12),
  // A card's header, at its bottom.
  header: px(44),
  avatar: px(22),
  // Rows: side inset (the text and separators start here) and heights.
  inset: px(16),
  agentH: px(56),
  kidH: px(50),
  kidTermH: px(36),
  paneH: px(60),
  paneIcon: px(22),
  // Where a sub-agent's tree starts.
  treeLeading: px(22),
  // A machine's header under its cards, and the room under it.
  machineH: px(34),
  machineAfter: px(10),
  noteH: px(40),
  // The sidebar's header row (limits, the status ring, +).
  bar: px(44),
  barSide: px(16),
};

// The pane row's text (and its separator) starts after its icon.
M.paneText = M.inset + M.paneIcon + px(12);

// Wierdr's fonts: Geist for the words (the app's UI face), the terminal's face for
// models, @effort, ages and folders.
export const mono = () => settings().font_family ?? "JetBrains Mono";

// A theme color with this opacity (themes give #rrggbb or #rrggbbaa).
export function alpha(color, a) {
  const c = String(color ?? "");
  const hex = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  if (/^#[0-9a-f]{6}$/i.test(c)) return c + hex(a);
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7) + hex((parseInt(c.slice(7), 16) / 255) * a);
  return c;
}

// A status's color. Unread (done) is green, as in Wierdr, whatever the theme calls done.
export const statusColor = (t, s) => (s === "done" ? t.ansi2 ?? t.done : t[s] ?? t.dim);

export const icon = (name, size, color) => svg(`mods/wierdr-sidebar/icons/${name}.svg`).size(size).flex_none().text_color(color);

// A program's icon from the app's table: a one-color glyph (tinted) or a picture.
export function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// ---- rings -----------------------------------------------------------------------------------

const pct = (n) => `${Math.round(n * 1000) / 1000}%`;
// A point on a circle of radius `r` (% of the box) at `f` of a turn from 12 o'clock, clockwise.
const at = (r, f) => [pct(50 + r * Math.sin(2 * Math.PI * f)), pct(50 - r * Math.cos(2 * Math.PI * f))];

// Adds an arc from `from` to `to` (shares of a turn, clockwise from the top) to `b`.
function arc(b, r, from, to) {
  const span = to - from;
  if (span <= 0) return b;
  if (span >= 0.999) {
    // A whole circle: two halves.
    b.move_to(...at(r, 0)).arc_to(pct(r), pct(r), 0, false, true, ...at(r, 0.5)).arc_to(pct(r), pct(r), 0, false, true, ...at(r, 0.999999));
    return b;
  }
  return b.move_to(...at(r, from)).arc_to(pct(r), pct(r), 0, span > 0.5, true, ...at(r, to));
}

const paint = (builder, color) =>
  globalThis.window.paint_path(builder.build(), color).absolute().top(0).left(0).size_full();

// A box `size` px square with rings drawn in it. `strokes`: [{ r, w, color, arcs: [[from, to]] }]
// (r: the ring's middle as a share of the box, w: its line in px); `lines`: [{ from: [x, y],
// to: [x, y], w, color }] in shares of the box; `child`: drawn in the middle.
export function rings(size, strokes, { lines = [], child = null } = {}) {
  const box = div().relative().size(size).flex_none();
  for (const s of strokes) {
    if (!s.arcs.length) continue;
    const b = PathBuilder.stroke(s.w);
    for (const [from, to] of s.arcs) arc(b, s.r * 100, from, to);
    box.child(paint(b, s.color));
  }
  for (const l of lines) {
    const b = PathBuilder.stroke(l.w).move_to(pct(l.from[0] * 100), pct(l.from[1] * 100)).line_to(pct(l.to[0] * 100), pct(l.to[1] * 100));
    box.child(paint(b, l.color));
  }
  if (child) box.child(h_flex().absolute().top(0).left(0).size_full().items_center().justify_center().child(child));
  return box;
}
