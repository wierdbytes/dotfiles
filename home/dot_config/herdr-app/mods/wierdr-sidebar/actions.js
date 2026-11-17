// What the sidebar's rows, menus and header do.

import { run, hc, panes, spaces, terminals, openOverlay, settings, shared, setShared, notify } from "herdr";

// A sub-agent kept from its peek waits for its tab, which then moves next to its
// ancestor's (List.placeKept): terminal -> { after: that tab, root: that ancestor, at }.
export const KEEP = "wierdr.keepBeside";

// Labels on a terminal (on its machine: `vps/t7` works as is).
function label(address, ...pairs) {
  hc(["label", address, ...pairs]).then((r) => {
    if (r.code !== 0) notify({ title: "Couldn't change the agent", body: (r.stderr || r.stdout).trim().slice(0, 300), level: "error" });
  });
}

// Pinned with its time (Wierdr's): the newest pin lowest. Herdr reads any value as pinned.
export const setPinned = (address, on) => label(address, `herdr.pinned=${on ? Math.floor(Date.now() / 1000) : ""}`);
// Done again (seen one turn back), or idle (seen this turn): what herdr.seen means to Herdr.
export const markUnread = (term) => label(term.address, `herdr.seen=${Math.max(0, (term.turn ?? 1) - 1)}`);
export const markIdle = (term) => label(term.address, `herdr.seen=${term.turn ?? 0}`);

export const focusPane = (pane) => run("pane.focus", { pane });

// Where a child of an agent goes when kept: a tab next to its nearest ancestor with a
// pane (through live terminals). -> { addr, space, tab, pane } or null.
export function homeOf(addr, all = terminals()) {
  const byAddr = new Map(all.map((k) => [k.address, k]));
  const ps = panes();
  const spaceOf = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, s.id])));
  let up = byAddr.get(addr)?.parent;
  const seen = new Set();
  while (up && !seen.has(up)) {
    seen.add(up);
    const p = byAddr.get(up);
    if (p?.state !== "live") return null;
    const pane = ps.find((x) => x.terminal === up);
    if (pane && spaceOf.has(pane.tab)) return { addr: up, space: spaceOf.get(pane.tab), tab: pane.tab, pane: pane.pane, parent: p };
    up = p.parent;
  }
  return null;
}

// A child of an agent: its pane when it has one (kept), else a look at it over the
// window with Keep and Close (peek.js).
export function openKid(addr) {
  const pane = panes().find((p) => p.terminal === addr)?.pane;
  if (pane) return focusPane(pane);
  openOverlay({
    kind: "dialog",
    width: 0.82,
    height: 0.82,
    layout: {
      type: "column",
      children: [
        { id: "peek-bar", type: "block", size: { px: 38 }, content: { mod: "wierdr-sidebar", props: { peekBar: true, sub: true, terminal: addr } } },
        { id: "peek-term", type: "block", content: { terminal: addr } },
      ],
    },
  });
}

// Keeps a sub-agent as a tab right after its parent's (and its other kept ones').
export function keepKid(addr) {
  const home = homeOf(addr);
  if (home) {
    setShared(KEEP, { ...(shared(KEEP) ?? {}), [addr]: { after: home.tab, root: home.addr, at: Date.now() } });
    run("space.select", { id: home.space });
    run("tab.select", { id: home.tab });
  }
  run("terminal.keep", { terminal: addr });
}

// Closes a sub-agent: its pane when kept, else it ends, with its own children not kept.
export function closeKid(addr) {
  const ps = panes();
  const pane = ps.find((p) => p.terminal === addr)?.pane;
  if (pane) return run("pane.close", { pane });
  const all = terminals();
  const kept = new Set(ps.map((p) => p.terminal).filter(Boolean));
  const down = (a) => all.filter((k) => k.parent === a && k.state === "live" && !kept.has(k.address)).flatMap((k) => [...down(k.address), k.address]);
  for (const k of [...down(addr), addr]) run("terminal.kill", { terminal: k });
}

// Opens one of the counted agents (model.counted): a sub-agent as its row does.
export function openCounted(x) {
  if (x.kid) openKid(x.address);
  else focusPane(x.rowPane);
}

// A popup over (or under) the element pressed: `bounds` from the press (window px), the
// popup's size at zoom 1. `side`: "above" or "below"; `align`: "start" or "end".
export function popupAt(bounds, w, h, { side = "above", align = "start", gap = 6 } = {}) {
  const z = Number(settings().zoom) || 1;
  const x = align === "end" ? bounds.x + bounds.width - w * z : bounds.x;
  const y = side === "above" ? bounds.y - h * z - gap : bounds.y + bounds.height + gap;
  return { x: Math.max(6, Math.round(x)), y: Math.max(6, Math.round(y)) };
}

export function openMenu(props, { at, width = 230, height = 300 } = {}) {
  return openOverlay({ mod: "wierdr-sidebar", kind: "popup", width, height, props: { menu: true, ...props }, ...(at ? { at } : {}) });
}
