// Subscription limits (Claude, Codex, Qwen Cloud) in the status bar, read from ~/bin/ai-usage,
// the same script (and cache) as the tmux status line. Click for details.
// No props: the bar. props().menu: the details popup (the same mod).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, settings, shared, setShared, props, openOverlay, nextCommand, focused, agents } from "herdr";

const PROVIDERS = [
  { id: "claude", name: "Claude", apps: ["claude", "claude-code"] },
  { id: "codex", name: "Codex", apps: ["codex"] },
  { id: "qwen", name: "Qwen", apps: ["qwen", "qwen-code"] },
];
const POLL = 120000, TICK = 60000, STALE = 10 * 60;
const DATA = "limits.data", HIDDEN = "limits.hidden";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const nowS = () => Date.now() / 1000;
const hiddenIds = () => shared(HIDDEN) ?? [];

// ---- data -------------------------------------------------------------------------------------

async function load(id, force) {
  const bin = `${home()}/bin/ai-usage`;
  // A manual refresh takes data up to 15 s old; ai-usage still honours its backoff and lock.
  const r = force ? await exec("/usr/bin/env", ["USAGE_CACHE_TTL=15", bin, id, "json"]) : await exec(bin, [id, "json"]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `ai-usage exited ${r.code}`);
  return JSON.parse(r.stdout);
}

// Reads every shown provider (hidden ones aren't polled) and publishes them in shared state.
function refresh(cx, { force = false, only = null, done = null } = {}) {
  const ids = only ? [only] : PROVIDERS.map(p => p.id).filter(id => !hiddenIds().includes(id));
  cx.spawn(async cx => {
    const results = await Promise.all(ids.map(id => load(id, force)
      .catch(e => ({ provider: id, failed: true, error: String(e?.message ?? e) }))));
    const data = { ...(shared(DATA) ?? {}) };
    // A failed run keeps the last reading and only says why.
    for (const r of results) data[r.provider] = r.failed ? { ...(data[r.provider] ?? {}), error: r.error } : r;
    setShared(DATA, data);
    done?.();
    cx.notify();
  });
}

function windows(d) {
  const out = [];
  const at = d?.updated_at ?? null;
  if (d?.five_hour) out.push({ ...d.five_hour, at, short: "5h", label: "5 hours", window: 18000 });
  if (d?.seven_day) out.push({ ...d.seven_day, at, short: "7d", label: "7 days", window: 604800 });
  return out;
}
const models = d => (d?.models ?? []).map(m => ({ ...m, at: d.updated_at ?? null, short: String(m.label).slice(0, 6), label: String(m.label) }));

// ---- time and pace ------------------------------------------------------------------------------

// The share of the window already gone, 0..1 (null without a reset time).
function elapsed(w, now) {
  if (w.reset_at == null || !w.window) return null;
  return Math.min(1, Math.max(0, 1 - (w.reset_at - now) / w.window));
}
// The reset time has passed (or, without one, the reading is older than the window itself):
// the reading belongs to a previous window.
const isReset = (w, now) => w.reset_at != null ? w.reset_at <= now : w.at != null && w.window != null && now - w.at > w.window;

function pace(w, now) {
  const e = elapsed(w, now);
  if (e === null || e < 0.02 || isReset(w, now)) return null;
  const diff = Math.round(w.utilization - e * 100);
  // Linear projection: at this rate, when does the window hit 100%? Only if before the reset.
  let runsOut = null;
  if (w.utilization > 0 && w.utilization < 100) {
    const left = (100 - w.utilization) * (e * w.window) / w.utilization;
    if (left < w.reset_at - now) runsOut = left;
  }
  return { diff, ahead: w.utilization >= 20 && diff >= 10, runsOut };
}

function span(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}
function clock(unix, now) {
  const d = new Date(unix * 1000), hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return unix - now < 18 * 3600 ? hm : `${DAYS[d.getDay()]} ${hm}`;
}
function ago(unix, now) {
  const s = Math.max(0, now - unix);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

// ---- look ---------------------------------------------------------------------------------------

// Quiet until it matters, like the tmux widget: muted, then working (>60%), then blocked (>80%).
const level = (pct, t) => pct > 80 ? t.blocked : pct > 60 ? t.working : null;
const pctText = u => u > 0 && u < 1 ? "<1%" : `${Math.round(u)}%`;
const money = (n, cur) => n == null ? "?" : cur === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${cur ?? ""}`.trim();

function icon(id, size) {
  if (id === "qwen") return svg("mods/limits/qwen.svg").size(size).flex_none().text_color("#7c6cf0");
  return image(`icons/${id}.svg`).size(size).flex_none().rounded(id === "codex" ? 3 : 0);
}

// A track with the used share filled and a tick where the window's time stands.
function meter(w, width, height, now, t) {
  const reset = isReset(w, now), pct = Math.min(100, Math.max(0, w.utilization)), e = elapsed(w, now);
  return div().relative().w(width).h(height).flex_none().rounded(height / 2).bg(t.input)
    .when(pct > 0 && !reset, el => el.child(div().absolute().left(0).top(0).h(height)
      .w(Math.max(height, width * pct / 100)).rounded(height / 2).bg(level(w.utilization, t) ?? t.muted)))
    .when(e !== null && !reset, el => el.child(div().absolute().top(-2).h(height + 4).w(1)
      .left(Math.min(width - 1, Math.round(width * e))).bg(t.foreground).opacity(0.55)));
}

// The provider of the agent in the focused pane, if it's one of ours.
function focusedProvider() {
  const f = focused();
  if (!f?.terminal) return null;
  const a = agents().find(x => x.address === f.terminal);
  if (!a) return null;
  const keys = [a.app, a.program?.key].filter(Boolean).map(s => String(s).toLowerCase());
  return PROVIDERS.find(p => p.apps.some(x => keys.includes(x)))?.id ?? null;
}

function summary(p, d, now) {
  const lines = [`${p.name}${d?.plan ? ` ${d.plan}` : ""}`];
  for (const w of windows(d)) lines.push(isReset(w, now) ? `${w.short} reset since last reading`
    : `${w.short} ${pctText(w.utilization)} used${w.reset_at != null ? `, resets in ${span(w.reset_at - now)} (${clock(w.reset_at, now)})` : ""}`);
  if (d?.updated_at) lines.push(`updated ${ago(d.updated_at, now)}`);
  if (d?.error) lines.push(`! ${d.error}`);
  return lines.join("\n");
}

export default class Limits extends View {
  init(_props, cx) {
    if (props()?.menu) return;
    refresh(cx);
    cx.timer.every(POLL, cx => refresh(cx));
    // Countdowns and pace move without new readings.
    cx.timer.every(TICK, cx => cx.notify());
    // keys.json: "limits.refresh", "limits.menu".
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") refresh(cx, { force: true });
        if (c === "menu") this.openMenu();
      }
    });
  }

  openMenu() {
    const data = shared(DATA) ?? {};
    const body = PROVIDERS.filter(p => data[p.id]).reduce((n, p) => {
      const d = data[p.id];
      return n + 42 + (windows(d).length + models(d).length) * 46 + (d.error ? 22 : 0) + (d.spend ? 24 : 0) + (d.credits ? 24 : 0);
    }, 0);
    openOverlay({ mod: "limits", kind: "popup", width: 380, height: Math.min(700, 46 + body + 52 + PROVIDERS.length * 30), props: { menu: true } });
  }

  cell(w, mode, now, t) {
    const reset = isReset(w, now), pc = pace(w, now), col = reset ? null : level(w.utilization, t);
    return h_flex().gap(5).items_center().flex_none()
      .when(mode >= 1, el => el.child(div().text_size(10).text_color(t.dim).child(w.short)))
      .when(mode >= 3, el => el.child(meter(w, 40, 7, now, t)))
      .child(div().min_w(24).text_color(col ?? t.muted).child(reset ? "–" : pctText(w.utilization)))
      .when(Boolean(pc?.ahead), el => el.child(div().ml(-4).text_size(8).text_color(col ?? t.working).child("▲")))
      .when(mode >= 2 && w.reset_at != null && !reset, el => el.child(div().min_w(36).text_size(10.5).text_color(t.dim).child(span(w.reset_at - now))));
  }

  render(cx) {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    const data = shared(DATA) ?? {}, hidden = hiddenIds(), now = nowS(), focus = focusedProvider();
    const shown = PROVIDERS.filter(p => !hidden.includes(p.id));
    // Fit the block: bars go first, then countdowns, then labels.
    const cells = shown.reduce((n, p) => n + Math.max(1, windows(data[p.id]).length), 0);
    const room = (this.width ?? Infinity) - 24 - shown.length * 40;
    const mode = room >= cells * 140 ? 3 : room >= cells * 100 ? 2 : room >= cells * 58 ? 1 : 0;
    const parts = [];
    shown.forEach((p, i) => {
      const d = data[p.id], ws = windows(d);
      if (i > 0) parts.push(div().w(1).h(12).flex_none().bg(t.border));
      const stale = !d?.updated_at || now - d.updated_at > STALE;
      parts.push(h_flex().id(`limits-${p.id}`).gap(9).items_center().flex_none()
        .opacity(focus && focus !== p.id ? 0.4 : stale ? 0.6 : 1)
        .tooltip(d ? summary(p, d, now) : `${p.name}: loading…`)
        .child(icon(p.id, 12))
        .when(ws.length === 0, el => el.child(div().text_color(t.dim).child(d ? "--" : "…")))
        .children(ws.map(w => this.cell(w, mode, now, t)))
        .when(Boolean(d?.error), el => el.child(div().ml(-4).text_size(10.5).font_semibold().text_color(ws.length ? t.working : t.blocked).child("!"))));
    });
    return h_flex().id("limits").size_full().px(12).gap(12).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
      .on_size_change((size, cx) => {
        const w = size.width / (Number(settings().zoom) || 1);
        if (w !== this.width) { this.width = w; cx.notify(); }
      })
      .on_click(() => this.openMenu())
      .on_mouse_down("right", () => this.openMenu())
      .when(parts.length === 0, el => el.child(div().text_color(t.dim).child("Limits hidden")))
      .children(parts);
  }

  // ---- popup ------------------------------------------------------------------------------------

  row(w, now, t) {
    const reset = isReset(w, now), pc = pace(w, now), col = reset ? null : level(w.utilization, t);
    const notes = reset ? ["reset since the last reading"] : [
      w.reset_at != null ? `resets in ${span(w.reset_at - now)} · ${clock(w.reset_at, now)}` : null,
      pc ? (Math.abs(pc.diff) < 5 ? "on pace" : pc.diff > 0 ? `${pc.diff}% ahead of pace` : `${-pc.diff}% under pace`) : null,
    ].filter(Boolean);
    return v_flex().gap(3)
      .child(h_flex().gap(10).items_center()
        .child(div().w(64).flex_none().truncate().text_color(t.muted).child(w.label))
        .child(meter(w, 180, 8, now, t))
        .child(div().flex_1().text_right().text_color(col ?? t.foreground).child(reset ? "–" : pctText(w.utilization))))
      .child(h_flex().pl(74).gap(6).text_size(10.5).text_color(t.dim)
        .child(notes.join(" · "))
        .when(pc?.runsOut != null, el => el.child(div().text_color(t.blocked).child(`· runs out in ~${span(pc.runsOut)}`))));
  }

  extra(label, value, t) {
    return h_flex().gap(10).items_center().text_size(11.5)
      .child(div().w(64).flex_none().text_color(t.muted).child(label))
      .child(div().text_color(t.foreground).child(value));
  }

  section(p, d, now, t) {
    const ws = [...windows(d), ...models(d)];
    const spend = d.spend, credits = d.credits;
    return v_flex().px(10).py(8).gap(8)
      .child(h_flex().gap(7).items_center()
        .child(icon(p.id, 14))
        .child(div().font_semibold().text_color(t.foreground).child(p.name))
        .child(div().text_size(11).text_color(t.dim).child(d.plan ?? ""))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child(d.updated_at ? ago(d.updated_at, now) : "")))
      .when(Boolean(d.error), el => el.child(div().text_size(11).text_color(ws.length ? t.working : t.blocked)
        .child(`${d.error}${d.retry_at && d.retry_at > now ? ` · retry in ${span(d.retry_at - now)}` : ""}`)))
      .children(ws.map(w => this.row(w, now, t)))
      .when(Boolean(spend), el => el.child(this.extra("Extra", spend.enabled
        ? `${money(spend.used, spend.currency)}${spend.limit != null ? ` of ${money(spend.limit, spend.currency)}` : ""}${spend.utilization != null ? ` (${pctText(spend.utilization)})` : ""}`
        : "off", t)))
      .when(Boolean(credits), el => el.child(this.extra("Credits", credits.unlimited ? "unlimited"
        : !credits.has_credits && !credits.balance ? "none"
        : credits.balance != null ? `${Math.round(credits.balance * 100) / 100}` : "available", t)));
  }

  menu(t) {
    const data = shared(DATA) ?? {}, hidden = hiddenIds(), now = nowS();
    const newest = Math.max(0, ...PROVIDERS.map(p => data[p.id]?.updated_at ?? 0));
    const toggle = p => {
      const on = !hidden.includes(p.id);
      return h_flex().id(`show-${p.id}`).h(28).px(10).gap(9).rounded(6).items_center().cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          setShared(HIDDEN, on ? [...hidden, p.id] : hidden.filter(x => x !== p.id));
          if (!on) refresh(cx, { only: p.id });
        })
        .child(icon(p.id, 13).opacity(on ? 1 : 0.4))
        .child(div().flex_1().text_color(on ? t.foreground : t.muted).child(p.name))
        .child(div().size(14).flex_none().when(on, el => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.accent))));
    };
    return v_flex().id("limits-menu").size_full().p(6).bg(t.popover).text_size(12.5).overflow_y_scrollbar()
      .child(h_flex().px(10).pt(4).pb(2).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(newest ? `Subscription limits · updated ${ago(newest, now)}` : "Subscription limits"))
        .child(div().id("limits-refresh").px(6).py(1).rounded(5).cursor_pointer().text_size(11).text_color(t.muted).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.busy = true; cx.notify(); refresh(cx, { force: true, done: () => { this.busy = false; } }); })
          .child(this.busy ? "Refreshing…" : "Refresh")))
      .children(PROVIDERS.filter(p => data[p.id]).map(p => this.section(p, data[p.id], now, t)))
      .child(div().mx(10).my(4).h(1).bg(t.border))
      .child(div().px(10).pt(2).pb(2).text_size(10.5).text_color(t.dim).child("Show in the status bar (hidden ones aren't polled)"))
      .children(PROVIDERS.map(toggle));
  }
}
