// The rows of a space's card, as Wierdr draws them (Telegram's chat rows without the
// avatar, full width, hairline separators):
// - an agent: its title and, where Telegram has the date, its machine and how long it
//   has been in its status on a pill of that status's color (needs you, done, working;
//   idle plain); under that its context's ring, model, @effort, its sub-agents' chip (the
//   whole tree's; a click folds them, open until then), its own terminals' chip (only those
//   it started; a click shows or hides them, folded until then) and, pinned, the pin;
// - a sub-agent over its agent, in a tree drawn upward: its status mark, what it's on,
//   its age; under that its context's ring (first, as an agent's), model, @effort and the
//   small chip of the terminals it started (folded until clicked). A plain terminal an
//   agent started: its program's icon and name;
// - another pane: its program's icon, the process in front and under it its folder.
// The pinned rows sit on a gray ground; the focused pane's row gets an accent ring.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { M, px, mono, icon, programIcon, rings, alpha, statusColor } from "./look.js";
import { agentMeta, shortModel, providerOf, effortColor, maxGradient, ctxColor, tokens } from "./meta.js";
import { agentTitle, kidTitle, kidStatus, isAgent, age, procName, paneWhere, shortPath, since } from "./model.js";

// The tree's columns in front of a sub-agent (Wierdr's TreeLines, upward).
const TREE = { w: px(9), gap: px(4), stroke: 1.5, r: px(6) };

// Wraps a row's content in the chrome its place gives it: its ground (pinned: gray), the
// focused one's accent ring (no fill), the hover, and the separator under it.
// `sep`: null, "full", or the separator's left inset.
export function rowChrome(R, { id, h, pinned = false, selected = false, sep = null, click, right, child, tip = null }) {
  const { t } = R;
  const lit = pinned ? t.hover : null;
  return div()
    .relative()
    .h(h)
    .w_full()
    .flex_none()
    .bg(t.surface)
    .child(div()
      .id(id)
      .size_full()
      .when(Boolean(lit), (el) => el.bg(lit))
      .hover((s) => s.bg(pinned ? alpha(t.selected, 1.6) : t.hover))
      .cursor_pointer()
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => click?.(cx))
      .on_mouse_down("right", (e, cx) => right?.(e, cx))
      .child(child))
    .when(selected, (el) => el.child(div().absolute().top(3).left(3).right(3).bottom(3).rounded(px(8)).border(1).border_color(t.accent)))
    .when(sep != null && !selected, (el) => el.child(div()
      .absolute()
      .bottom(0)
      .h(1)
      .bg(t.border)
      .left(sep === "full" ? 0 : sep)
      .right(sep === "full" ? 0 : M.inset)));
}

// How long it has been in its status, on a pill of the status's color; idle plain.
export function agePill(R, ms, status) {
  const { t } = R;
  const text = ms ? R.age(ms) : "";
  const base = div().flex_none().font_family(mono()).text_size(px(13));
  if (!status || status === "idle") return base.text_color(t.muted).child(text);
  return base
    .h(px(20))
    .min_w(px(20))
    .px(px(6))
    .rounded_full()
    .bg(statusColor(t, status))
    .flex()
    .items_center()
    .justify_center()
    .text_color(t.background)
    .child(text);
}

// The context window's use as a ring: an arc from the top, clockwise, in the context's
// color over a dim track. Nothing without a window.
export function contextRing(R, meta) {
  const { t, dark } = R;
  if (!(meta?.ctx > 0) || !(meta?.ctxMax > 0)) return null;
  const f = Math.min(1, Math.max(0, meta.ctx / meta.ctxMax));
  const line = px(2.5), size = px(16) + line;
  const r = (px(16) / 2) / size;
  return rings(size, [
    { r, w: line, color: t.input, arcs: [[0, 1]] },
    { r, w: line, color: ctxColor(f, t, dark), arcs: [[0, Math.max(0.02, f)]] },
  ]);
}

// `@effort` in pi-statusline's colors; max shades letter by letter.
function effort(R, word) {
  const { t, dark } = R;
  const text = `@${word}`;
  if (word !== "max") return div().flex_none().text_color(effortColor(word, t, dark)).child(text);
  return h_flex().flex_none().children(maxGradient(text).map(([g, c]) => div().when(Boolean(c), (el) => el.text_color(c)).child(g)));
}

// The model, @effort and the context's ring: the model is cut first when room runs out.
// `ringFirst`: an agent's row (its chips follow); else the ring after them.
function modelLine(R, term, a, size, { quiet, ringFirst }) {
  const { t } = R;
  const meta = agentMeta(term);
  const model = meta?.model ? shortModel(meta.model, providerOf(meta)) : (a?.program ?? term?.program)?.name ?? "";
  const ring = contextRing(R, meta);
  const words = h_flex().min_w(0).flex_shrink(1).gap(px(5)).items_center()
    .child(div().min_w(0).truncate().text_color(quiet ? t.dim : t.muted).child(model))
    .when(Boolean(meta?.effort), (el) => el.child(effort(R, meta.effort)));
  return h_flex().min_w(0).flex_shrink(1).gap(px(8)).items_center().font_family(mono()).text_size(size)
    .when(ringFirst && Boolean(ring), (el) => el.child(ring))
    .child(words)
    .when(!ringFirst && Boolean(ring), (el) => el.child(ring));
}

// A count chip (bot 3, >_ 1): a click folds the agent's children in or out.
// `compact`: a sub-agent's, on its smaller second line.
function kidChip(R, id, glyph, n, { open, alert, tip, toggle, compact = false }) {
  const { t } = R;
  const color = alert ? t.blocked : open ? t.foreground : t.muted;
  return h_flex()
    .id(id)
    .flex_none()
    .h(px(compact ? 18 : 22))
    .px(px(compact ? 6 : 7))
    .gap(px(compact ? 3 : 4))
    .rounded_full()
    .items_center()
    .bg(open ? t.selected : t.hover)
    .tooltip(tip)
    .when(Boolean(toggle), (el) => el
      .cursor_pointer()
      .hover((s) => s.bg(t.raised))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        toggle(cx);
      }))
    .child(icon(glyph, px(compact ? 12 : 13), color))
    .child(div().text_size(px(compact ? 12 : 13)).font_medium().text_color(color).child(String(n)));
}

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// The `>_` chip of an agent or sub-agent: the terminals it started (`termTally`).
function termChip(R, id, n, { open, toggle, compact = false }) {
  return kidChip(R, id, "terminal", n, { open, alert: false, tip: plural(n, "terminal"), toggle, compact });
}

// An agent's two lines (56 pt). `terms`: the terminals it started itself (its `>_` chip; its
// sub-agents' are on their own rows).
export function agentContent(R, r, { agentsOpen, toggleAgents, terms, termsOpen, toggleTerms }) {
  const { t } = R;
  const { a, term } = r;
  const meta = agentMeta(term);
  const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
  const kidAgents = r.kids.filter((k) => isAgent(k.t));
  const inner = meta?.subagents ?? 0;
  const subTip = [kidAgents.length && plural(kidAgents.length, "sub-agent"), inner && `${inner} in pi`].filter(Boolean).join(" + ");
  return v_flex()
    .size_full()
    .pt(px(6))
    .px(M.inset)
    .child(h_flex()
      .h(px(22))
      .gap(px(10))
      .items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(px(16)).font_semibold().text_color(t.foreground).child(agentTitle(a, term, R.tabs.get(a.tab))))
      .child(h_flex().flex_none().gap(px(6)).items_center()
        .when(Boolean(machine), (el) => el.child(div().text_size(px(13)).text_color(t.dim).child(machine)))
        .child(agePill(R, since(term), a.status))))
    .child(h_flex()
      .h(px(22))
      .gap(px(8))
      .items_center()
      .child(modelLine(R, term, a, px(13), { quiet: a.status === "idle", ringFirst: true }))
      .when(kidAgents.length + inner > 0, (el) => el.child(kidChip(R, `subs-${r.pane}`, "bot", kidAgents.length + inner, {
        // In-process sub-agents without rows (pi's) have nothing to fold.
        open: agentsOpen && kidAgents.length > 0, alert: kidAgents.some((k) => kidStatus(k.t, R.listed) === "blocked"), tip: subTip,
        toggle: kidAgents.length ? toggleAgents : null,
      })))
      .when(terms > 0, (el) => el.child(termChip(R, `terms-${r.pane}`, terms, { open: termsOpen, toggle: toggleTerms })))
      .child(div().flex_1())
      .when(a.pinned, (el) => el.child(icon("tg-pin", px(17), t.dim))));
}

// A status's mark: a dot in its color, idle a ring.
export function statusDot(R, status, size = px(7)) {
  const { t } = R;
  const dot = div().size(size).rounded_full().flex_none();
  if (status === "idle") return dot.border(1.5).border_color(t.idle ?? t.dim);
  return dot.bg(statusColor(t, status));
}

// The tree's columns, upside down (the list is drawn bottom up: a child is over its
// parent): ├ and └ come up from the row's bottom into its first line's middle (`mid`),
// ├ and │ go on up to the row's top.
function treeLines(R, lines, h, mid) {
  const { t } = R;
  const stroke = (el) => el.absolute().left(0).w(TREE.w).border_color(t.input).border_l(TREE.stroke);
  return lines.map((l) => div()
    .relative()
    .w(TREE.w)
    .h(h)
    .mr(TREE.gap)
    .flex_none()
    .when(l === "└" || l === "├", (el) => el.child(stroke(div()).top(mid).bottom(0).border_t(TREE.stroke).rounded_tl(TREE.r)))
    .when(l === "├", (el) => el.child(stroke(div()).top(0).h(mid + TREE.r)))
    .when(l === "│", (el) => el.child(stroke(div()).top(0).bottom(0))));
}

// A sub-agent (50 pt) or a terminal an agent started (36 pt). `terms`: the terminals a
// sub-agent started (its small `>_` chip).
export function kidContent(R, k, { terms = 0, termsOpen = false, toggleTerms = null } = {}) {
  const { t } = R;
  const term = k.t;
  if (!isAgent(term)) {
    const h = M.kidTermH;
    const pic = term.program?.key !== "program" ? programIcon(term.program, px(15), t.foreground) : null;
    return h_flex()
      .size_full()
      .pl(M.treeLeading)
      .pr(M.inset)
      .items_center()
      .children(treeLines(R, k.lines, h, h / 2))
      .child(h_flex().w(px(14)).mr(px(8)).flex_none().justify_center().child(pic ?? icon("terminal", px(15), t.muted)))
      .child(div().flex_1().min_w(0).truncate().text_size(px(15)).text_color(t.muted).child(kidTitle(term, true)));
  }
  const h = M.kidH;
  const status = kidStatus(term, R.listed);
  return h_flex()
    .size_full()
    .pl(M.treeLeading)
    .pr(M.inset)
    .items_start()
    .children(treeLines(R, k.lines, h, px(6) + px(11)))
    .child(v_flex()
      .flex_1()
      .min_w(0)
      .pt(px(6))
      .child(h_flex()
        .h(px(22))
        .gap(px(8))
        .items_center()
        .child(h_flex().w(px(14)).flex_none().justify_center().child(statusDot(R, status, px(7))))
        .child(div().flex_1().min_w(0).truncate().text_size(px(15)).text_color(t.foreground).child(kidTitle(term)))
        .child(div().flex_none().font_family(mono()).text_size(px(13)).text_color(t.muted).child(R.age(since(term)) ?? "")))
      .child(h_flex()
        .h(px(18))
        .pl(px(22))
        .gap(px(8))
        .items_center()
        .child(modelLine(R, term, null, px(12.5), { quiet: status === "idle", ringFirst: true }))
        .when(terms > 0, (el) => el.child(termChip(R, `kterms-${term.address}`, terms, { open: termsOpen, toggle: toggleTerms, compact: true })))));
}

// A plain terminal or a mod pane (60 pt): its icon, the process's name and its folder.
export function paneContent(R, r) {
  const { t } = R;
  const p = r.p, term = r.term;
  const name = r.kind === "mod" ? p.title || p.mod || "Panel" : procName(term) || p.terminal;
  const where = r.kind === "mod" ? "Panel" : paneWhere(p, term) ?? "";
  const machine = p.terminal?.includes("/") ? p.terminal.split("/")[0] : null;
  // Room for the folder, about 6.6 px a letter in the mono face at this size.
  const room = (R.viewW > 0 ? R.viewW : 268) - 2 * M.side - M.paneText - M.inset - (machine ? 40 : 0);
  const pic = r.kind === "mod" ? icon("file-text", px(20), t.muted)
    : p.program && p.program.key !== "program" ? programIcon(p.program, M.paneIcon, t.foreground) ?? icon("terminal", px(20), t.muted)
    : icon("terminal", px(20), t.muted);
  return h_flex()
    .size_full()
    .px(M.inset)
    .gap(px(12))
    .items_center()
    .child(h_flex().w(M.paneIcon).flex_none().justify_center().child(pic))
    .child(v_flex().flex_1().min_w(0).gap(px(2))
      .child(div().truncate().text_size(px(16)).font_semibold().text_color(t.foreground).child(name))
      .child(div().id(`cwd-${r.pane}`).truncate().font_family(mono()).text_size(px(13)).text_color(t.muted)
        .when(where.length > 0, (el) => el.tooltip(where))
        .child(shortPath(where, Math.max(8, Math.floor(room / (px(13) * 0.6)))) ?? "")))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(px(13)).text_color(t.dim).child(machine)));
}
