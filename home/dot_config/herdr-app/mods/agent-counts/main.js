// Agent counts by status for the status bar, with the same status marks as the agents list:
// working: the spinner, needs you: "!", done: a dot, idle: a ring.
// Working and idle always show; needs you and done only when there are some.
// A click focuses the next agent with that status after the focused one, in the agents
// sidebar's order (see sidebarOrder), wrapping around.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, theme, run, shared, appHome, readTextFile } from "herdr";

const STATUSES = [
  { id: "blocked", label: "needs you", always: false },
  { id: "done", label: "done", always: false },
  { id: "working", label: "working", always: true },
  { id: "idle", label: "idle", always: true },
];

// ---- the agents sidebar's order -----------------------------------------------------------------
// A copy of the shipped `agents` mod's sort (mods/agents/main.js, render): pinned first, then
// (sort "priority") by urgency, then by when the status last changed, then by seq; with sort
// "grouped", model order. Keep in step with it if Herdr changes that mod.

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// Done and idle count as one change: looking at a finished agent isn't the agent doing anything.
const merged = (s) => (s === "done" ? "idle" : s);
// A sub-agent without a pane: its raw word, error counting as blocked, never done.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
function subtree(all, addr) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k) => [k, ...subtree(all, k.address)]);
}

export default class AgentCounts extends View {
  init() {
    // Our own "status changed at" stamps, for agents the agents mod hasn't saved yet.
    this.changed = {};
    this.held = null;
  }

  // As the agents mod: stamp status changes, and remember the focused agent's rank on arrival
  // (a done agent you look at turns idle but stays with Done until you leave it).
  track(list) {
    const now = Date.now();
    for (const a of list) {
      const s = merged(a.status);
      if (this.changed[a.address]?.s !== s) this.changed[a.address] = { s, at: now };
    }
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  // The agents mod's own stamps (its localStorage), which go back further than ours.
  async savedStamps() {
    try {
      const store = JSON.parse((await readTextFile(`${appHome()}/data/agents/store.json`)) ?? "{}");
      return JSON.parse(store.changed ?? "{}");
    } catch {
      return {};
    }
  }

  sidebarOrder(list, saved) {
    const since = (a) => {
      const s = merged(a.status);
      const theirs = saved[a.address], ours = this.changed[a.address];
      if (theirs?.s === s) return theirs.at;
      return ours?.s === s ? ours.at : 0;
    };
    if ((shared("agents.sort") ?? "priority") === "priority") {
      const all = terminals();
      const listed = new Map(list.map((a) => [a.address, a.status]));
      const rank = (a) => {
        const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
        return sawDone ? RANK.done : RANK[a.status] ?? 0;
      };
      const urgency = new Map(list.map((a) => [a.address,
        Math.max(rank(a), ...subtree(all, a.address).map((k) => RANK[kidStatus(k, listed)] ?? 0))]));
      list = [...list].sort((x, y) => urgency.get(y.address) - urgency.get(x.address) || since(y) - since(x) || y.seq - x.seq);
    }
    return [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
  }

  focusNext(status, cx) {
    cx.spawn(async () => {
      const saved = await this.savedStamps();
      const order = this.sidebarOrder(agents(), saved);
      const at = order.findIndex((a) => a.focused);
      // The first agent with this status below the focused one, wrapping to the top.
      for (let i = 1; i <= order.length; i++) {
        const a = order[(at + i) % order.length];
        if (a.status === status) {
          run("agent.focus", { terminal: a.address });
          return;
        }
      }
    });
  }

  render() {
    const t = theme();
    const list = agents();
    this.track(list);
    const count = Object.fromEntries(STATUSES.map((s) => [s.id, list.filter((a) => a.status === s.id).length]));
    return h_flex().id("agent-counts").size_full().px(14).gap(14).items_center().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted)
      .children(STATUSES.filter((s) => s.always || count[s.id] > 0).map((s) => {
        const n = count[s.id];
        return h_flex().id(`count-${s.id}`).gap(6).items_center().flex_none()
          .tooltip(`${n} ${s.label}`)
          .when(n > 0, (el) => el.cursor_pointer().on_click((_e, cx) => this.focusNext(s.id, cx)))
          .child(mark(t, s.id, n > 0))
          .child(div().text_color(n === 0 ? t.dim : s.id === "blocked" ? t.blocked : t.muted).child(String(n)));
      }));
  }
}

// The agents mod's marks, compact form.
function mark(t, status, live) {
  if (status === "working") {
    const s = svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(live ? t.working : t.dim);
    return live ? s.spin(900) : s;
  }
  if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
}
