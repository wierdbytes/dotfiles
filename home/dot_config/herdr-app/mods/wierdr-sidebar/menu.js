// The sidebar's menus (Wierdr's, in Herdr's popup): a popup with props
// { menu: true, kind, ... }:
//   space   Rename…, New Tab › (a terminal or an installed agent), Close Space
//   row     an agent: Pin / Unpin, Mark Unread / Mark Idle; any pane: Split Right, Close Pane
//   kid     a sub-agent: Show, Keep as Tab (kept: Go to Its Tab); Close
//   plus    Settings, Hide Sidebar; New space in <folder>: a terminal or an installed agent
//   status  each status with its count, the most urgent lowest: its first agent
// ↑/↓ move, Enter runs, Esc closes (in a submenu: back).

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, terminals, agents, panes, knownAgents, shared, setShared, keys, window } from "herdr";
import { icon, alpha, statusColor } from "./look.js";
import { snapshot, ORDER } from "./model.js";
import { setPinned, markUnread, markIdle, openKid, keepKid, closeKid, focusPane, openCounted, openMenu } from "./actions.js";
import { KNOWN } from "./header.js";
import { tilde } from "./model.js";

const ROW = 31;

// A key bound to a command, as the menu bar spells it.
function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super" };
  const parts = k.keys.trim().split("-");
  const key = parts.pop() || "-";
  return [...Object.keys(names).filter((m) => parts.includes(m)).map((m) => names[m]), key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)].join(mac ? "" : "+");
}

const agentIcon = (a, t) => (a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14));

export class Menu {
  init(_props, cx) {
    this.at = -1;
    this.sub = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props() ?? {};
    // The agents a new tab or space can start, for its machine.
    const machine = p.kind === "space" ? spaces().find((s) => s.id === p.space)?.machine ?? null
      : p.kind === "plus" ? spaces().find((s) => s.active)?.machine ?? null : undefined;
    if (machine !== undefined) {
      this.machine = machine ?? "";
      cx.spawn(async (cx) => {
        try {
          const list = await knownAgents({ on: machine });
          setShared(KNOWN, { ...(shared(KNOWN) ?? {}), [this.machine]: list });
        } catch { this.failed = true; }
        // A submenu opened before the agents were known: fit it to them now.
        const q = props() ?? {};
        if (this.sub && q.at && q.h && this.height([[{}], this.sub.children()]) !== q.h) { this.reopen(this.sub); return; }
        cx.notify();
      });
    }
  }

  // The agents installed on the menu's machine, as items starting each with `start(argv, name)`.
  launchers(t, start) {
    const list = shared(KNOWN)?.[this.machine] ?? null;
    const items = [{ icon: svg("icons/shell.svg").size(14).text_color(t.foreground), title: "Terminal", run: () => start(null, null) }];
    if (!list) items.push({ title: this.failed ? "Couldn't check installed agents" : "Checking installed agents…", disabled: true });
    for (const a of (list ?? []).filter((a) => a.installed)) items.push({ icon: agentIcon(a, t), title: a.name, run: () => start(a.run, a.name) });
    return items;
  }

  // Sections of items: { title, icon, run, destructive, disabled, children, hint }.
  sections(t) {
    const p = props() ?? {};
    switch (p.kind) {
      case "space": {
        const s = spaces().find((x) => x.id === p.space);
        if (!s) return [];
        return [
          [
            { icon: icon("square-pen", 14, t.muted), title: "Rename…", run: () => run("space.rename", { id: s.id }), hint: shortcut("space.rename") },
            { icon: icon("plus", 14, t.muted), title: "New Tab", children: () => this.launchers(t, (argv, name) => run("tab.new", { space: s.id, ...(argv ? { argv, name } : {}) })) },
          ],
          [{ icon: icon("x", 14, t.blocked), title: "Close Space", destructive: true, run: () => run("space.close", { id: s.id }) }],
        ];
      }
      case "row": {
        const term = terminals().find((x) => x.address === p.terminal);
        const a = agents().find((x) => x.address === p.terminal);
        const agent = [];
        if (a) {
          agent.push({ icon: icon(a.pinned ? "pin-off" : "pin", 14, t.muted), title: a.pinned ? "Unpin" : "Pin", run: () => setPinned(a.address, !a.pinned) });
          if (a.status === "idle" && term) agent.push({ icon: div().size(8).mx(3).rounded_full().bg(statusColor(t, "done")), title: "Mark Unread", run: () => markUnread(term) });
          if (a.status === "done" && term) agent.push({ icon: div().size(8).mx(3).rounded_full().border(1.5).border_color(t.idle ?? t.dim), title: "Mark Idle", run: () => markIdle(term) });
        }
        const pane = [
          { icon: icon("split-right", 14, t.muted), title: "Split Right", run: () => { focusPane(p.pane); run("pane.split", { direction: "right", pane: p.pane }); }, hint: shortcut("pane.split:right") },
          { icon: icon("x", 14, t.blocked), title: "Close Pane", destructive: true, run: () => run("pane.close", { pane: p.pane }) },
        ];
        return agent.length ? [agent, pane] : [pane];
      }
      case "kid": {
        const pane = panes().find((x) => x.terminal === p.terminal)?.pane;
        const open = pane
          ? [{ icon: icon("terminal", 14, t.muted), title: "Go to Its Tab", run: () => focusPane(pane) }]
          : [
            { icon: icon("terminal", 14, t.muted), title: "Show", run: () => openKid(p.terminal) },
            { icon: icon("plus", 14, t.muted), title: "Keep as Tab", run: () => keepKid(p.terminal) },
          ];
        return [open, [{ icon: icon("x", 14, t.blocked), title: "Close", destructive: true, run: () => closeKid(p.terminal) }]];
      }
      case "plus": {
        const s = spaces().find((x) => x.active);
        const folder = p.folder ?? null;
        const machine = s?.machine ?? "";
        const start = (argv, name) => run("space.new", { ...(folder ? { folder } : {}), machine, ...(argv ? { argv, name } : {}) });
        return [
          [
            { icon: icon("settings", 14, t.muted), title: "Settings", run: () => run("app.settings"), hint: shortcut("app.settings") },
            { icon: icon("sidebar", 14, t.muted), title: "Hide Sidebar", run: () => run("layout.toggle", { id: "sidebar" }), hint: shortcut("layout.toggle:sidebar") },
          ],
          { header: folder ? `New space in ${tilde(folder)}` : "New space" },
          this.launchers(t, start),
        ];
      }
      case "status": {
        const all = snapshot().all;
        const counts = { blocked: 0, done: 0, working: 0, idle: 0 };
        for (const x of all) counts[x.status] += 1;
        const title = (s, n) => s === "blocked" ? `${n} ${n === 1 ? "Needs" : "Need"} You` : `${n} ${s[0].toUpperCase()}${s.slice(1)}`;
        const dot = (s) => s === "idle" ? div().size(9).mx(2.5).rounded_full().border(1.5).border_color(t.idle ?? t.dim) : div().size(9).mx(2.5).rounded_full().bg(statusColor(t, s));
        return [[...ORDER].reverse().filter((s) => counts[s] > 0).map((s) => ({
          icon: dot(s), title: title(s, counts[s]), run: () => { const first = all.find((x) => x.status === s); if (first) openCounted(first); },
        }))];
      }
    }
    return [];
  }

  // The flat list of what's shown: a submenu's items with Back on top, else every section.
  shown(t) {
    // Reopened straight into a submenu (props().sub: its title).
    const subTitle = props()?.sub;
    if (!this.sub && subTitle && !this.leftSub) {
      this.sub = this.sections(t).flatMap((s) => (Array.isArray(s) ? s : [s])).find((it) => it.title === subTitle && it.children) ?? null;
    }
    if (this.sub) return [[{ icon: icon("chevron-left", 14, t.muted), title: "Back", back: true }], this.sub.children()];
    return this.sections(t);
  }

  // The popup's height (zoom 1) for these sections, as render() draws them.
  height(sections) {
    let h = 10;
    sections.forEach((s, si) => {
      if (si > 0 && Array.isArray(s) && Array.isArray(sections[si - 1])) h += 9;
      for (const it of Array.isArray(s) ? s : [s]) h += it.header ? (si > 0 ? 32 : 27) : ROW;
    });
    return h;
  }

  // A popup can't change its size: open the same menu again, in its place, sized for `sub`.
  reopen(sub) {
    const p = props() ?? {};
    if (!p.at) return false;
    const t = theme();
    const { overlay, sub: _old, ...rest } = p;
    const sections = sub ? [[{ title: "Back" }], sub.children()] : this.sections(t);
    closeOverlay(overlay);
    const h = this.height(sections);
    openMenu({ ...rest, h, ...(sub ? { sub: sub.title } : {}) }, { at: p.at, width: p.width ?? 230, height: h });
    return true;
  }

  choose(it, cx) {
    if (!it || it.disabled || it.header) return;
    if (it.back) { if (this.reopen(null)) return; this.sub = null; this.leftSub = true; this.at = -1; cx.notify(); return; }
    if (it.children) { if (this.reopen(it)) return; this.sub = it; this.at = -1; cx.notify(); return; }
    closeOverlay(props()?.overlay);
    it.run?.();
  }

  render() {
    const t = theme();
    const sections = this.shown(t);
    const items = sections.flatMap((s) => (Array.isArray(s) ? s : [s]));
    const live = items.map((it, i) => (it.header || it.disabled ? -1 : i)).filter((i) => i >= 0);
    const move = (d) => {
      if (!live.length) return;
      const at = live.indexOf(this.at);
      this.at = live[at < 0 ? (d > 0 ? 0 : live.length - 1) : (at + d + live.length) % live.length];
    };
    let n = 0;
    return v_flex()
      .id("wierdr-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") move(1);
        else if (e.key === "up") move(-1);
        else if (e.key === "enter" || e.key === "right" && items[this.at]?.children) this.choose(items[this.at], cx);
        else if (e.key === "escape" || e.key === "left") {
          if (this.sub) { if (!this.reopen(null)) { this.sub = null; this.leftSub = true; } }
          else if (e.key === "escape") closeOverlay(props().overlay);
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(sections.flatMap((s, si) => {
        const list = Array.isArray(s) ? s : [s];
        const out = [];
        if (si > 0 && Array.isArray(s) && Array.isArray(sections[si - 1])) out.push(div().mx(7).my(4).h(1).bg(t.border));
        for (const it of list) {
          const i = n++;
          if (it.header) {
            out.push(div().mt(si > 0 ? 4 : 0).border_t(si > 0 ? 1 : 0).border_color(t.border).px(9).pt(8).pb(4).text_size(11).text_color(t.dim).truncate().child(it.header));
            continue;
          }
          const color = it.disabled ? t.dim : it.destructive ? t.blocked : t.foreground;
          out.push(h_flex()
            .id(`mi-${i}`)
            .h(ROW)
            .px(8)
            .gap(9)
            .rounded(7)
            .flex_none()
            .items_center()
            .text_color(color)
            .when(i === this.at, (el) => el.bg(t.selected))
            .when(!it.disabled, (el) => el.cursor_pointer().hover((st) => st.bg(it.destructive ? alpha(t.blocked, 0.12) : t.hover)))
            .on_hover((on, cx) => { if (on && !it.disabled) { this.at = i; cx.notify(); } })
            .on_click((_e, cx) => this.choose(it, cx))
            .child(h_flex().w(14).flex_none().justify_center().when(Boolean(it.icon), (el) => el.child(it.icon)))
            .child(div().flex_1().min_w(0).truncate().child(it.title))
            .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint)))
            .when(Boolean(it.children), (el) => el.child(icon("chevron-right", 12, t.dim))));
        }
        return out;
      }));
  }
}
