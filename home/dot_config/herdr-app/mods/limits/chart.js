// Drawing a limit's history.
//   windowChart   the current window: what was read so far as a smooth area (a window's usage
//                 only grows, so a monotone curve never invents a dip), the stretch before the
//                 first reading hatched, the even pace dashed corner to corner, where today's
//                 rate lands by the reset dashed from now, and a dot on the latest value.
//   historyChart  days of windows: the highest reading per bucket as a skyline; buckets
//                 without readings leave gaps.
//   polledBar     a limit only ai-usage knows: no series, just where it stands.
// Coordinates are percentages of the plot, so the paths follow the dialog's size.
import { div, PathBuilder, Background } from "gpui-kit";
import { buckets } from "./reduce.js";

export const CHART_H = 96;
const HOUR = 3600, DAY = 86400;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// What to ask Langfuse for. `kind` says what it shows:
//   window    the current window [start, reset) by the minute (by the hour for long windows)
//   previous  the window that just ended, while the next one hasn't started (no reset yet)
//   none      no window known at all: nothing to ask
//   history   the last week (a short window) / four weeks (a weekly one) by the hour
//   90d       the last 90 days by the (UTC) day
// The window kinds never fall back to history: that is its own tab.
export function chartRange(l, range, now) {
  const length = l.window ?? l.last_window ?? null;
  const short = (length ?? DAY * 7) <= 6 * HOUR;
  if (range === "90d") {
    const to = Math.ceil(now / DAY) * DAY;
    return { kind: "90d", from: to - 90 * DAY, to, until: now, granularity: "day", bars: 90 };
  }
  if (range === "window") {
    const running = l.reset_at != null && l.reset_at > now;
    const end = running ? l.reset_at : l.reset_at ?? l.last_reset_at ?? null;
    if (end == null || !length) return { kind: "none", from: now, to: now + (length ?? 5 * HOUR), until: now, granularity: "minute" };
    return { kind: running ? "window" : "previous", from: end - length, to: end, until: Math.min(now, end), granularity: short ? "minute" : "hour" };
  }
  // Buckets on whole local hours (a short window) or quarter days (a weekly one).
  const days = short ? 7 : 28, size = (short ? 1 : 6) * HOUR;
  const tz = new Date(now * 1000).getTimezoneOffset() * 60;
  const to = Math.ceil((now - tz) / size) * size + tz;
  return { kind: "history", from: to - days * DAY, to, until: now, granularity: "hour", bars: (days * DAY) / size };
}

// ---- small helpers ------------------------------------------------------------------------------

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = n => `${Math.round(clamp(n, 0, 100) * 100) / 100}%`;

// A theme colour with this opacity (themes give #rrggbb or #rrggbbaa).
export function alpha(color, a) {
  const c = String(color);
  const hex = n => Math.round(clamp(n, 0, 1) * 255).toString(16).padStart(2, "0");
  if (/^#[0-9a-f]{6}$/i.test(c)) return c + hex(a);
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7) + hex((parseInt(c.slice(7), 16) / 255) * a);
  return c;
}

const paint = (builder, background) =>
  globalThis.window.paint_path(builder.build(), background).absolute().top(0).left(0).size_full();

// Fritsch–Carlson: tangents for a monotone cubic through (x, y) points with increasing x.
function monotoneTangents(p) {
  const n = p.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1e-9));
  if (n < 2) return m;
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return m;
}

// Appends a monotone curve through `p` (already started at p[0]) to every builder given.
function curve(builders, p) {
  const m = monotoneTangents(p);
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[i + 1], h = (x1 - x0) / 3;
    for (const b of builders) b.cubic_bezier_to(pct(x1), pct(y1), pct(x0 + h), pct(y0 + m[i] * h), pct(x1 - h), pct(y1 - m[i + 1] * h));
  }
}

// A dashed straight line as short subpaths.
function dashed(b, x0, y0, x1, y1, dash = 1.4, gap = 1.1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= 0) return b;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash);
    b.move_to(pct(x0 + ((x1 - x0) * s) / len), pct(y0 + ((y1 - y0) * s) / len))
      .line_to(pct(x0 + ((x1 - x0) * e) / len), pct(y0 + ((y1 - y0) * e) / len));
  }
  return b;
}

// The plot's frame: faint quarter lines, a firmer baseline, the 90–100% band tinted, labels.
function frame(t, vticks) {
  const root = div().relative().w_full().h(CHART_H);
  root.child(div().absolute().left(0).top(0).w_full().h("10%").bg(alpha(t.ansi1, 0.06)));
  for (const q of [25, 50, 75]) root.child(div().absolute().left(0).top(pct(100 - q)).w_full().h(1).bg(alpha(t.border, q === 50 ? 1 : 0.55)));
  root.child(div().absolute().left(0).top(0).w_full().h(1).bg(alpha(t.ansi1, 0.25)));
  root.child(div().absolute().left(0).bottom(0).w_full().h(1).bg(t.border));
  for (const x of vticks) root.child(div().absolute().top(0).h(CHART_H).w(1).left(pct(x)).bg(alpha(t.border, 0.55)));
  for (const [v, top] of [[100, 1], [50, CHART_H / 2 - 12]]) {
    root.child(div().absolute().right(3).top(top).text_size(9).text_color(alpha(t.dim, 0.9)).child(`${v}%`));
  }
  return root;
}

// Tick times between `from` and `to`: whole hours, days, weeks or months, whichever gives a handful.
export function ticks(from, to) {
  const span = to - from, out = [];
  if (span > 45 * DAY) {
    const d = new Date(from * 1000);
    d.setDate(1); d.setHours(0, 0, 0, 0);
    for (d.setMonth(d.getMonth() + 1); d.getTime() / 1000 < to; d.setMonth(d.getMonth() + 1)) {
      out.push({ ts: d.getTime() / 1000, label: MONTHS[d.getMonth()] });
    }
    return out;
  }
  const step = span <= 8 * HOUR ? HOUR : span <= 2 * DAY ? 6 * HOUR : span <= 10 * DAY ? DAY : 7 * DAY;
  const start = new Date(from * 1000);
  if (step < DAY) start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  for (let ts = start.getTime() / 1000; ts < to; ts += step) {
    // Local midnights move with DST: snap each one back to 00:00.
    const d = new Date(ts * 1000);
    if (step >= DAY && d.getHours() !== 0) { d.setHours(0, 0, 0, 0); if (d.getTime() / 1000 < ts - HOUR) d.setDate(d.getDate() + 1); ts = d.getTime() / 1000; }
    if (ts > from) out.push(ts);
  }
  const label = ts => {
    const d = new Date(ts * 1000);
    if (step < DAY) return `${String(d.getHours()).padStart(2, "0")}:00`;
    if (step === DAY) return `${DAYS[d.getDay()]} ${d.getDate()}`;
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };
  return out.map(ts => ({ ts, label: label(ts) }));
}

// The labels under a plot: its ends, and the ticks between them away from the ends.
export function axis(r, left, right, t) {
  const span = r.to - r.from;
  const row = div().relative().w_full().h(14).text_size(10).text_color(t.dim)
    .child(div().absolute().left(0).top(0).child(left))
    .child(div().absolute().right(0).top(0).child(right));
  for (const tk of ticks(r.from, r.to)) {
    const x = ((tk.ts - r.from) / span) * 100;
    if (x < 9 || x > 88) continue;
    row.child(div().absolute().top(0).left(pct(x)).ml(-30).w(60).flex().justify_center().child(tk.label));
  }
  return row;
}

const tickXs = r => ticks(r.from, r.to).map(tk => ((tk.ts - r.from) / (r.to - r.from)) * 100);

const hm = ts => { const d = new Date(ts * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const dayHm = ts => { const d = new Date(ts * 1000); return `${DAYS[d.getDay()]} ${d.getDate()}, ${hm(ts)}`; };

// The pointer over a plot, as a time snapped to `step` seconds: `hover(ts | null, cx)` is
// called only when that time changes, so moving within one step redraws nothing.
function track(el, r, step, hover) {
  if (!hover?.set) return el;
  const report = (ts, cx) => { if (ts !== hover.ts) hover.set(ts, cx); };
  return el.id(hover.id)
    .on_mouse_move((e, cx) => {
      const w = e.bounds?.width;
      if (!w) return;
      const f = clamp(e.local_position.x / w, 0, 1);
      report(Math.round((r.from + f * (r.to - r.from)) / step) * step, cx);
    })
    .on_hover((inside, cx) => { if (!inside) report(null, cx); });
}

// A cursor line and a label at `ts` (percent `x`), the label on whichever side has room.
function cursor(root, x, lines, t) {
  root.child(div().absolute().top(0).h(CHART_H).w(1).left(pct(x)).bg(alpha(t.foreground, 0.45)));
  const box = div().absolute().top(6).px(6).py(3).rounded(5).bg(t.raised).border(1).border_color(t.border)
    .text_size(10.5).text_color(t.foreground)
    .children(lines.map(([text, color]) => div().text_color(color ?? t.foreground).child(text)));
  root.child(x > 62 ? box.right(pct(100 - x)).mr(8) : box.left(pct(x)).ml(8));
}

// ---- charts -------------------------------------------------------------------------------------

// The same rule as the title's pace: early in a window (under 10% of its time and 10% used) a
// rate says nothing yet, so there is no forecast to draw.
const trusted = (e, u) => e > 0 && u > 0 && (e >= 0.1 || u >= 10);

// The window so far. `l`: the limit (utilization, reset_at, window); `points`: { t, v } readings.
// `hover`: { id, ts, set(ts | null, cx) } — the plot's element id, where the pointer is, and
// how to say it moved.
export function windowChart(l, points, r, now, t, color, hover) {
  const span = r.to - r.from;
  const X = ts => clamp(((ts - r.from) / span) * 100, 0, 100);
  const Y = v => 100 - clamp(v, 0, 100);
  const pts = points.filter(p => p.t >= r.from - 60 && p.t <= r.to).map(p => ({ ...p }));
  // The latest value known (it may come from ai-usage) closes the series at now.
  // The latest value known (from Langfuse or ai-usage) is a reading too, at the time it was read.
  if (r.kind === "window" && l.utilization != null && r.until > r.from) {
    const last = pts.at(-1), at = clamp(l.at ?? r.until, r.from, r.until);
    if (!last || l.utilization > last.v || (l.utilization === last.v && at > last.t)) {
      pts.push({ t: Math.max(at, last?.t ?? at), v: Math.max(l.utilization, last?.v ?? 0) });
    }
  }
  // One point per x: readings in the same minute collapse to their highest.
  const xy = [];
  for (const p of pts) {
    const x = X(p.t), y = Y(p.v), prev = xy.at(-1);
    if (prev && x - prev[0] < 0.05) prev[1] = Math.min(prev[1], y);
    else xy.push([x, y, p.t]);
  }
  // Readings further apart than this left a stretch unknown (no pi talking to the provider, or
  // a pi without rate-limit scores): drawn straight and dashed, not as a made-up curve.
  const gap = span <= 6 * HOUR ? 20 * 60 : 3 * HOUR;
  const runs = [];
  for (const p of xy) {
    const run = runs.at(-1);
    if (run && p[2] - run.at(-1)[2] <= gap) run.push(p);
    else runs.push([p]);
  }

  const root = track(frame(t, tickXs(r)), r, span <= 6 * HOUR ? 60 : 900, hover);
  // Even pace: 0% at the window's start, 100% at its reset.
  root.child(paint(dashed(PathBuilder.stroke(1), 0, 100, 100, 0), alpha(t.dim, 0.8)));

  if (xy.length) {
    const [fx, fy] = xy[0];
    // Before the first reading nothing is known but the start at 0%: hatch that stretch.
    if (fx > 1.5) {
      root.child(paint(PathBuilder.fill().move_to("0%", "100%").line_to(pct(fx), pct(fy)).line_to(pct(fx), "100%").close(),
        Background.pattern_slash(alpha(color, 0.22), 1, 5)));
      root.child(paint(dashed(PathBuilder.stroke(1), 0, 100, fx, fy, 0.9, 0.9), alpha(color, 0.5)));
    }
    const [lx, ly, lt] = xy.at(-1);
    // Since the last reading the value is at least that: flat on to now.
    const nx = now < r.to && r.until > lt ? X(r.until) : lx;
    const fill = PathBuilder.fill().move_to(pct(fx), "100%").line_to(pct(fx), pct(fy));
    const line = PathBuilder.stroke(2);
    const unknown = PathBuilder.stroke(1.5);
    runs.forEach((run, i) => {
      if (i > 0) {
        const [px, py] = runs[i - 1].at(-1);
        fill.line_to(pct(run[0][0]), pct(run[0][1]));
        dashed(unknown, px, py, run[0][0], run[0][1], 1.2, 1.2);
      }
      line.move_to(pct(run[0][0]), pct(run[0][1]));
      curve([fill, line], run);
    });
    if (nx - lx > 0.3) dashed(unknown, lx, ly, nx, ly, 1.2, 1.2);
    fill.line_to(pct(nx), pct(ly)).line_to(pct(nx), "100%").close();
    root.child(paint(fill, Background.linear_gradient(180, Background.stop(alpha(color, 0.5), 0), Background.stop(alpha(color, 0.03), 1))))
      .child(paint(line, color))
      .child(paint(unknown, alpha(color, 0.6)));

    // Where today's rate lands: on to the reset, or up to 100% before it.
    const e = (r.until - r.from) / span, u = l.utilization ?? 0;
    if (now < r.to && trusted(e, u)) {
      const atReset = u / e;
      const end = atReset <= 100 ? [100, Y(atReset)] : [X(r.from + (100 / u) * (r.until - r.from)), 0];
      root.child(paint(dashed(PathBuilder.stroke(1.5), nx, ly, end[0], end[1], 1.6, 1.2), alpha(color, 0.7)));
    }
    // Now: a faint line and a dot on the latest value.
    if (now < r.to) root.child(div().absolute().top(0).h(CHART_H).w(1).left(pct(nx)).bg(alpha(t.foreground, 0.25)));
    root.child(div().absolute().left(pct(nx)).top(pct(ly)).ml(-6).mt(-6).size(12).rounded_full().bg(alpha(color, 0.25)))
      .child(div().absolute().left(pct(nx)).top(pct(ly)).ml(-3.5).mt(-3.5).size(7).rounded_full().bg(color).border(1.5).border_color(t.popover));
  }
  if (r.kind === "previous") {
    root.child(div().absolute().left(6).top(5).px(5).py(1).rounded(4).bg(alpha(t.popover, 0.85)).text_size(10).text_color(t.dim)
      .child(`previous window · ended ${span > DAY ? dayHm(r.to) : hm(r.to)}`));
  }
  if (hover?.ts != null && hover.ts >= r.from && hover.ts <= r.to) {
    const time = ts => (span > DAY ? dayHm(ts) : hm(ts));
    const known = pts.filter(p => p.t <= hover.ts).at(-1), next = pts.find(p => p.t > hover.ts);
    const e = (r.until - r.from) / span, u = l.utilization ?? 0;
    let lines;
    if (hover.ts > r.until) {
      lines = [[time(hover.ts), t.dim], [trusted(e, u) ? `≈${Math.round(Math.min(999, (u / e) * ((hover.ts - r.from) / span)))}% at this rate` : "too early for a forecast", t.dim]];
    } else if (!known) {
      lines = [[time(hover.ts), t.dim], ["no readings yet", t.dim]];
    } else {
      // The value is the last reading at or before the pointer; across a stretch without
      // readings, what came next.
      lines = [[time(hover.ts), t.dim], [`${Math.round(known.v * 10) / 10}%`, color]];
      if (next && next.t - known.t > gap) lines.push([`then ${Math.round(next.v * 10) / 10}% at ${time(next.t)}`, t.dim]);
    }
    cursor(root, X(hover.ts), lines, t);
  }
  return root;
}

// Several days: the highest reading per bucket as steps; gaps where nothing was read.
export function historyChart(points, r, now, t, color, hover) {
  const vals = buckets(points, r.from, r.to, r.bars), n = vals.length, size = (r.to - r.from) / n;
  const root = track(frame(t, tickXs(r)), r, size, hover);
  const fill = PathBuilder.fill(), line = PathBuilder.stroke(1.5);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (vals[i] == null) continue;
    // A run of buckets with readings: one stepped shape.
    let j = i;
    while (j + 1 < n && vals[j + 1] != null) j++;
    const x = k => (k / n) * 100, y = v => 100 - clamp(v, 0, 100);
    fill.move_to(pct(x(i)), "100%");
    line.move_to(pct(x(i)), pct(y(vals[i])));
    for (let k = i; k <= j; k++) {
      fill.line_to(pct(x(k)), pct(y(vals[k]))).line_to(pct(x(k + 1)), pct(y(vals[k])));
      if (k > i) line.line_to(pct(x(k)), pct(y(vals[k])));
      line.line_to(pct(x(k + 1)), pct(y(vals[k])));
    }
    fill.line_to(pct(x(j + 1)), "100%").close();
    any = true;
    i = j;
  }
  if (any) {
    root.child(paint(fill, Background.linear_gradient(180, Background.stop(alpha(color, 0.45), 0), Background.stop(alpha(color, 0.04), 1))))
      .child(paint(line, color));
  }
  if (hover?.ts != null) {
    const i = clamp(Math.floor((hover.ts - r.from) / size), 0, n - 1), v = vals[i], start = r.from + i * size;
    const day = new Date(start * 1000);
    const when = size < DAY ? `${dayHm(start)}–${hm(start + size)}` : `${DAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
    cursor(root, ((i + 0.5) / n) * 100, [[when, t.dim], [v == null ? "no readings" : `max ${Math.round(v * 10) / 10}%`, v == null ? t.dim : color]], t);
  }
  return root;
}

// Where a limit stands when there is no series: a 6px track, the window's time as a tick.
export function polledBar(u, elapsed, t, color) {
  const used = clamp(u ?? 0, 0, 100);
  return div().relative().w_full().h(6).rounded(3).bg(t.raised)
    .when(used > 0, el => el.child(div().absolute().left(0).top(0).h(6).rounded(3).w(pct(Math.max(1.5, used)))
      .bg(color)))
    .when(elapsed != null, el => el.child(div().absolute().top(-3).h(12).w(1).left(pct(elapsed * 100)).bg(alpha(t.foreground, 0.6))));
}

// The chart's empty state.
export function emptyChart(text, t) {
  return div().h(CHART_H).w_full().rounded(6).border(1).border_color(t.border).flex().items_center().justify_center()
    .text_size(11).text_color(t.dim).child(text);
}

