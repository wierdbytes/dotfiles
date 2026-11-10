// The sidebar's one panel: spaces with their agents nested under them, and each
// space's pi sessions behind a button on its row (spaces.js; the agent rows and
// sessions are agents.js's). With props {peekBar} this mod is the bar over a
// session opened in the peek panel instead.
// Mods can't import each other's files, so everything shares kit.js, scroll.js
// and meta.js here.

import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { Agents } from "./agents.js";
import { Spaces } from "./spaces.js";

export default class WierdAgents extends View {
  init(p, cx) {
    this.panel = props()?.peekBar ? new Agents() : new Spaces();
    this.panel.init?.(p, cx);
    // keys.json: "wierd-agents.next" / "wierd-agents.prev" step through the
    // sidebar's rows (agents and terminals). Only the sidebar copy answers.
    if (this.panel.step) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "next") this.panel.step(1);
        else if (c === "prev") this.panel.step(-1);
      }
    });
  }

  render(cx) {
    return this.panel.render(cx);
  }

  async close(cx) {
    await this.panel.close?.(cx);
  }
}
