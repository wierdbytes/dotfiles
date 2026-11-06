// The panels' list, scrolling itself: a native scroll area can't be moved from
// code, and following the shown row needs that. Every row has a fixed height, so
// where each one sits is known without measuring.
//
// scrollList(owner, t, items, st, opts)
//   owner     the panel: keeps viewH / viewW (the list's size, px at zoom 1) and
//             drag (the thumb being dragged) on it.
//   items     [{ el, h }]: each row and its height (px at zoom 1).
//   st        this list's own state: { offset, animateUntil }.
//   collapsed the sidebar's rail: no side padding.
//   followAt  a row to bring into view, animated.
//   onEnd     runs when the wheel or the thumb reaches the bottom.
//   onMouseUp runs on any left release over the list (after the rows' own).
//   gap       the room between rows (GAP unless set; 0 for rows drawn as pieces
//             of one card).

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { settings } from "herdr";

// The gap between rows.
export const GAP = 1;
// The scrollbar: a thin thumb in the list's right padding, clear of the rows
// (THUMB_RIGHT from the edge, so 8 - THUMB_RIGHT - THUMB_W px from them), in a
// wider strip that takes the pointer.
const THUMB_W = 3, THUMB_RIGHT = 2, THUMB_HIT = 7;
// How long scrolling to a row takes, and the room kept around it.
const SCROLL_MS = 280;
const FOLLOW_MARGIN = 8;

export function scrollList(owner, t, items, st, { collapsed, followAt = null, onEnd = null, onMouseUp = null, gap = GAP }) {
  const now = Date.now();
  let y = 0;
  const tops = items.map((it) => {
    const top = y;
    y += it.h + gap;
    return top;
  });
  const total = Math.max(0, y - gap);
  const viewH = owner.viewH ?? 0;
  const maxOff = Math.max(0, total - viewH);
  const clamp = (v) => Math.max(0, Math.min(v, maxOff));
  st.offset = clamp(st.offset ?? 0);

  if (followAt != null) {
    const top = tops[followAt];
    const h = items[followAt].h;
    if (top < st.offset + FOLLOW_MARGIN || top + h > st.offset + viewH - FOLLOW_MARGIN) {
      // To the middle when the row fits; else its top just under the edge.
      st.offset = clamp(h + 2 * FOLLOW_MARGIN <= viewH ? top - (viewH - h) / 2 : top - FOLLOW_MARGIN);
      st.animateUntil = now + SCROLL_MS + 50;
    }
  }
  const motion = now < (st.animateUntil ?? 0) ? { duration: SCROLL_MS, easing: "ease-out" } : { duration: 0 };

  // The scrollbar: a thumb sized by how much of the list shows; drag it to scroll.
  const thumbH = total > 0 ? Math.max(24, (viewH * viewH) / total) : 0;
  const thumbTop = maxOff > 0 ? (st.offset / maxOff) * (viewH - thumbH) : 0;
  const zoom = settings().zoom || 1;
  const scrollTo = (v, cx) => {
    const next = clamp(v);
    st.animateUntil = 0;
    if (onEnd && maxOff > 0 && next >= maxOff - 2) onEnd(cx);
    if (next === st.offset) return;
    st.offset = next;
    cx.notify();
  };
  return v_flex()
    .id("ag-list")
    .relative()
    .flex_1()
    .min_h(0)
    .overflow_hidden()
    .on_size_change((size, cx) => {
      owner.viewH = size.height / zoom;
      // The cache tick slides in px (a transition doesn't move a % value).
      owner.viewW = size.width / zoom;
      cx.notify();
    })
    .on_scroll_wheel((e, cx) => scrollTo(st.offset - e.delta.y / zoom, cx))
    .on_mouse_move((e, cx) => {
      if (!owner.drag) return;
      const track = viewH - thumbH;
      if (track > 0) scrollTo(owner.drag.off + ((e.position.y - owner.drag.y) / zoom) * (maxOff / track), cx);
    })
    .on_mouse_up("left", (_e, cx) => {
      owner.drag = null;
      onMouseUp?.(cx);
    })
    .on_hover((on) => {
      if (!on) owner.drag = null;
    })
    .child(v_flex()
      .id("ag-content")
      .absolute()
      .left(0)
      .right(0)
      .top(-st.offset)
      .transition("top", motion)
      .px(collapsed ? 0 : 8)
      .gap(gap)
      .children(items.map((it) => it.el)))
    .when(maxOff > 0, (el) => el.child(div()
      .id("ag-thumb")
      .absolute()
      .right(0)
      .top(thumbTop)
      .transition("top", motion)
      .w(THUMB_HIT)
      .h(thumbH)
      .flex()
      .justify_end()
      .pr(THUMB_RIGHT)
      .on_hover((on, cx) => {
        owner.thumbHover = on;
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        owner.drag = { y: e.position.y, off: st.offset };
        st.animateUntil = 0;
        cx.notify();
      })
      .child(div()
        .w(THUMB_W)
        .h_full()
        .rounded(THUMB_W / 2)
        .bg(owner.drag || owner.thumbHover ? t.muted + "99" : t.dim + "66"))));
}
