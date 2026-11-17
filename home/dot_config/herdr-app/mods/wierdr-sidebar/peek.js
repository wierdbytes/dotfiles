// The bar over a terminal shown over the window (props { peekBar, sub?, terminal, space?,
// title?, overlay }): a sub-agent from its row (Keep makes it a tab right after its
// parent's; closing leaves it running), or a pi session from the sessions list (Keep makes
// it a tab of its space; closing any other way ends that pi).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, theme, terminals, agents, spaces, run, closeOverlay, hc } from "herdr";
import { px } from "./look.js";
import { kidStatus, kidTitle } from "./model.js";
import { homeOf, keepKid } from "./actions.js";
import { statusDot } from "./rows.js";

export class PeekBar {
  init(_props, cx) {
    // The bar takes the keyboard, not its terminal: Esc closes it, Enter keeps it.
    this.keys = cx.focus_handle();
    cx.timer.after(30, () => this.keys.focus());
    cx.timer.after(250, () => this.keys.focus());
  }

  keep() {
    const { terminal, space, overlay, sub } = props();
    this.kept = true;
    if (sub) keepKid(terminal);
    else {
      if (space) run("space.select", { id: space });
      run("terminal.keep", { terminal });
    }
    closeOverlay(overlay);
  }

  render() {
    const t = theme();
    const { terminal, space, overlay, sub } = props();
    const all = terminals();
    const term = all.find((x) => x.address === terminal);
    const status = term ? kidStatus(term, new Map(agents().map((a) => [a.address, a.status]))) : null;
    const name = spaces().find((s) => s.id === space)?.name;
    const home = sub ? homeOf(terminal, all) : null;
    const parent = sub && term?.parent ? all.find((x) => x.address === term.parent) : null;
    const title = sub ? (term ? kidTitle(term) : terminal) : props().title;
    const keepTip = sub ? (home ? `Keep it in a tab next to ${kidTitle(home.parent)}` : "Keep it as a tab") : `Keep it as a tab${name ? ` in ${name}` : ""}`;
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
      .children(label);
    return h_flex()
      .id("peek-bar")
      .track_focus(this.keys)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(overlay);
        else if (e.key === "enter") this.keep();
        else return;
        cx.stop_propagation();
      })
      .on_mouse_down("left", () => this.keys.focus())
      .size_full()
      .px(12)
      .gap(9)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(12.5)
      .when(Boolean(status), (el) => el.child(h_flex().w(14).flex_none().justify_center().child(statusDot({ t }, status, px(8)))))
      .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(title || terminal || ""))
      .when(Boolean(parent), (el) => el.child(div().flex_none().max_w(260).truncate().text_color(t.dim).child(`from ${kidTitle(parent)}`)))
      .child(div().flex_1())
      .child(button("peek-keep", [div().child("Keep"), kbd("↵", t.accent_foreground)], keepTip, () => this.keep(), true))
      .child(button("peek-close", [div().child("✕"), kbd("esc", t.dim)], sub ? "Close (it keeps running)" : "Close and end this pi", () => closeOverlay(overlay)));
  }

  // A session's pi ends with its peek unless kept; a sub-agent works for its parent.
  async close() {
    const p = props();
    if (!p?.sub && !this.kept && p?.terminal) await hc(["kill", p.terminal]);
  }
}
