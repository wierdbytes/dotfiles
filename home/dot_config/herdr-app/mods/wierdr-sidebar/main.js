// Wierdr's sidebar (~/me/dev/wierdr: the iPad and iPhone app) on the desktop: space
// cards drawn bottom up, Telegram's chat rows for agents, and the header at the bottom
// (the limits' rings, the agents' status ring, +). One mod, several parts, by props():
//   {}            the list (list.js)
//   { ring }      the header's status ring (header.js)
//   { plus }      the header's + (header.js)
//   { top }       the strip over the list, for the window's buttons and drag
//   { menu, kind } a popup menu (menu.js)
//   { peekBar }   the bar over a sub-agent or a pi session shown over the window (peek.js)
// keys.json: "wierdr-sidebar.next" / ".prev" step through the list's rows as drawn;
// "wierdr-sidebar.sessions" shows (or hides) the shown space's pi sessions.

import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { List } from "./list.js";
import { Top, Ring, Plus } from "./header.js";
import { Menu } from "./menu.js";
import { PeekBar } from "./peek.js";

export default class WierdrSidebar extends View {
  init(p, cx) {
    const pr = props() ?? {};
    this.part = pr.menu ? new Menu() : pr.peekBar ? new PeekBar() : pr.ring ? new Ring() : pr.plus ? new Plus() : pr.top ? new Top() : new List();
    this.part.init?.(p, cx);
    if (this.part.step) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "next") this.part.step(1);
        else if (c === "prev") this.part.step(-1);
        else if (c === "sessions") this.part.toggleSessions(cx);
      }
    });
  }

  render(cx) {
    return this.part.render(cx);
  }

  async close(cx) {
    await this.part.close?.(cx);
  }
}
