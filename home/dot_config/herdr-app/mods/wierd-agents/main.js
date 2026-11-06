// The sidebar's one panel: spaces with their agents nested under them, and each
// space's pi sessions behind a button on its row (spaces.js; the agent rows and
// sessions are agents.js's). With props {peekBar} this mod is the bar over a
// session opened in the peek panel instead.
// Mods can't import each other's files, so everything shares kit.js, scroll.js
// and meta.js here.

import { View } from "gpui-kit";
import { props, setShared, terminals, panes, spaces, agents, nextCommand } from "herdr";
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
    if (!props()?.peekBar) { // DEBUG
      this.st = { n: 0, sum: 0, max: 0, over20: 0, over50: 0 }; // DEBUG
      cx.timer.every(4000, () => { // DEBUG
        const time = (f) => { const a = performance.now(); for (let i = 0; i < 5; i++) f(); return +((performance.now() - a) / 5).toFixed(2); }; // DEBUG
        setShared("wierd.debug.perf", { last: globalThis.__perf, ...this.st, avg: +(this.st.sum / Math.max(1, this.st.n)).toFixed(1), reads: { terminals: time(terminals), panes: time(panes), spaces: time(spaces), agents: time(agents) } }); // DEBUG
      }); // DEBUG
    } // DEBUG
  }

  render(cx) {
    const a = performance.now(); // DEBUG
    const el = this.panel.render(cx);
    const dt = performance.now() - a; // DEBUG
    if (this.st) { if (this.st.n < 3) this.st[`r${this.st.n}`] = +dt.toFixed(1); this.st.n++; this.st.sum += dt; this.st.max = Math.max(this.st.max, +dt.toFixed(1)); if (dt > 20) this.st.over20++; if (dt > 50) this.st.over50++; } // DEBUG
    return el;
  }

  async close(cx) {
    await this.panel.close?.(cx);
  }
}
