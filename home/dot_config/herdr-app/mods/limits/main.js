// Subscription limits (Claude, Codex, Qwen Cloud). Over9k-style look, with pace on top.
//
// Where the numbers come from:
//   Langfuse   pi-langfuse writes every window a provider response reports as a score
//              (rl.<provider>.<account>.<window>, PI_LANGFUSE_RATE_LIMIT_SCORES=true). Read
//              with the keys pi-langfuse already has, every 10 s while an agent works, every
//              minute otherwise (langfuse.js). This is what keeps Claude's and Codex's 5h and
//              7d windows live.
//   ai-usage   ~/bin/ai-usage (the same script and cache as the tmux status line) polls the
//              usage endpoints: the plan's name, per-model weekly limits, extra spend,
//              credits, and everything for Qwen. Every 10 min for a provider Langfuse covers,
//              every 2 min otherwise (and for all of them while Langfuse can't be read).
// reduce.js folds both into one row per account. A provider shows its account's name only when
// it has more than one.
//
// One mod, four roles, by props():
//   {}               the status bar: per account its icon, plan badge, headline limit with
//                    pace chevrons, and when it resets. Click: the account's charts;
//                    right-click: the settings popup, just above the bar.
//   { sidebar: id }  rows above the sidebar's footer (block `id`, resized to fit). A click
//                    opens a row: every limit as a 3px bar with a tick where the window's time
//                    stands; usage past the tick is drawn thicker. A click on a limit pins it
//                    as the row's headline (again: unpins). An open row's chart icon: its charts.
//   { menu: true }   the popup: refresh, where the data comes from, and where each provider
//                    shows: sidebar, both, status bar or nowhere (shared "limits.where";
//                    nowhere isn't polled).
//   { chart: key }   a dialog with one chart per limit of the account `key`: the current window
//                    (stepped area, the even-pace diagonal, a tick at now) or its history (the
//                    highest reading per bucket over the last week or four weeks).
//
// Pace: r = used share / elapsed share of the window. r = 1 hits 100% exactly at the reset, so
// anything above 1 runs out before it. Green r <= 1, yellow above, red from 1.5 or 90% used;
// › and ›› say the same. Early in a window (under 10% of its time and 10% used) r is noise:
// it counts as on pace. The headline is the limit with the worst projection (used / elapsed).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, appHome, theme, settings, shared, setShared, props, run, layout, openOverlay, closeOverlay, nextCommand, focused, agents, terminals, readTextFile } from "herdr";
import { rows as foldRows, emptyLf, seriesPoints } from "./reduce.js";
import { Langfuse, credentialFiles, loadCredentials, sync } from "./langfuse.js";
import { CHART_H, alpha, axis, chartRange, emptyChart, historyChart, polledBar, windowChart } from "./chart.js";

const PROVIDERS = [
  { id: "claude", name: "Claude", apps: ["claude", "claude-code"], pi: [/^anthropic/] },
  { id: "codex", name: "Codex", apps: ["codex"], pi: [/^openai-codex/] },
  { id: "qwen", name: "Qwen", apps: ["qwen", "qwen-code"], pi: [/^qwen/, /^alibaba/] },
];
// Providers whose windows pi-langfuse reports.
const LIVE = ["claude", "codex"];
const POLL = 120000, EXTRAS = 600000, TICK = 60000;
const LF_WORKING = 10000, LF_IDLE = 60000, LF_CHECK = 5000;
const DATA = "limits.data", HIDDEN = "limits.hidden", WHERE = "limits.where", OPEN = "limits.open", PINNED = "limits.pinned", POLLED = "limits.polledAt";
// Langfuse: folded scores (written only when they change) and why the last read failed.
const LF = "limits.lf", LF_ERROR = "limits.lfError", POLLED_BY = "limits.polledAtBy";
// The open settings popup's overlay id, and when the last one closed; the open chart dialog.
const MENU = "limits.menu", MENU_CLOSED = "limits.menuClosedAt", CHART = "limits.chart";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Sidebar sizes (px at zoom 1); height() must match what rows() draws.
const ROW = 28, LIM = 20, LIM_STACKED = 30, NOTE = 18, EXTRA = 20, ERR = 18, PAD = 9;
// An inline bar needs this much room; narrower sidebars put the bar under its numbers.
const INLINE_MIN = 90 + 28 + 52 + 42 + 44 + 18;

const nowS = () => Date.now() / 1000;
// Where a provider shows. Before "where" there was only a hidden list: hidden is "off".
const MODES = [
  { id: "sidebar", label: "Sidebar only" },
  { id: "both", label: "Sidebar and status bar" },
  { id: "bar", label: "Status bar only" },
  { id: "off", label: "Nowhere (not polled)" },
];
const SHORT = { sidebar: "Sidebar", both: "Both", bar: "Status bar", off: "Off" };
const where = id => (shared(WHERE) ?? {})[id] ?? ((shared(HIDDEN) ?? []).includes(id) ? "off" : "both");
const inSidebar = id => ["sidebar", "both"].includes(where(id));
const inBar = id => ["bar", "both"].includes(where(id));

// ---- data: ai-usage ---------------------------------------------------------------------------

async function load(id, force) {
  const bin = `${home()}/bin/ai-usage`;
  // A manual refresh takes data up to 15 s old; ai-usage still honours its backoff and lock.
  const r = force ? await exec("/usr/bin/env", ["USAGE_CACHE_TTL=15", bin, id, "json"]) : await exec(bin, [id, "json"]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `ai-usage exited ${r.code}`);
  return JSON.parse(r.stdout);
}

// Langfuse has this provider's windows: ai-usage is only asked for the extras, less often.
const live = id => LIVE.includes(id) && !shared(LF_ERROR) && Object.values(shared(LF)?.accounts ?? {}).some(a => a.provider === id);

// Reads the shown providers that are due and publishes them in shared state. Several copies
// (bar, sidebar) share one reading: a timed refresh skips if another copy polled moments ago.
function refresh(cx, { force = false, only = null, done = null } = {}) {
  if (!force && !only && Date.now() - (shared(POLLED) ?? 0) < POLL - 5000) { done?.(); return; }
  const now = Date.now(), by = shared(POLLED_BY) ?? {};
  const ids = only ? [only] : PROVIDERS.map(p => p.id).filter(id => where(id) !== "off")
    .filter(id => force || !live(id) || now - (by[id] ?? 0) >= EXTRAS - 5000);
  if (!only) setShared(POLLED, now);
  if (!ids.length) { done?.(); return; }
  setShared(POLLED_BY, { ...by, ...Object.fromEntries(ids.map(id => [id, now])) });
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

// ---- data: Langfuse ---------------------------------------------------------------------------

// One reader for every copy (a copy that has its own module scope reads for itself).
const lf = { client: null, checkedAt: 0, busy: false, lastAt: 0, cursor: 0 };

async function lfClient() {
  if (Date.now() - lf.checkedAt < 60000) return lf.client;
  lf.checkedAt = Date.now();
  const creds = await loadCredentials(p => readTextFile(p), credentialFiles(home(), `${appHome()}/mods/limits`));
  lf.client = creds ? new Langfuse(creds, fetch) : null;
  return lf.client;
}

function setLfError(message) {
  if ((shared(LF_ERROR) ?? null) !== message) setShared(LF_ERROR, message);
}

// Reads what pi-langfuse wrote since the last read. Shared state changes only when a value does.
function syncLf(cx, { force = false, done = null } = {}) {
  const every = agents().some(a => a.status === "working") ? LF_WORKING : LF_IDLE;
  if (lf.busy || (!force && Date.now() - lf.lastAt < every)) { done?.(); return; }
  lf.busy = true;
  lf.lastAt = Date.now();
  cx.spawn(async () => {
    try {
      const client = await lfClient();
      if (!client) { setLfError("no Langfuse keys (pi-langfuse config.json)"); return; }
      const cur = shared(LF) ?? emptyLf();
      const next = await sync(client, { ...cur, cursor: Math.max(lf.cursor, cur.cursor ?? 0) }, Date.now());
      lf.cursor = next.cursor;
      if (JSON.stringify(next.accounts) !== JSON.stringify(cur.accounts)) setShared(LF, next);
      setLfError(null);
    } catch (e) {
      setLfError(String(e?.message ?? e));
    } finally {
      lf.busy = false;
      done?.();
    }
  });
}

// ---- rows -------------------------------------------------------------------------------------

// One row per account with data, in provider order; a shown provider without any yet gets a
// placeholder ({ d: null }) when `placeholders`.
function allRows(now, { placeholders = false, show = () => true } = {}) {
  const folded = foldRows(PROVIDERS, shared(DATA) ?? {}, shared(LF), now);
  const out = [];
  for (const p of PROVIDERS) {
    if (!show(p.id)) continue;
    const mine = folded.filter(r => r.p.id === p.id);
    if (mine.length) out.push(...mine);
    else if (placeholders) out.push({ key: p.id, p, account: null, label: null, multi: false, d: null });
  }
  return out;
}

const findRow = key => allRows(nowS()).find(r => r.key === key) ?? null;

// Series not shown: Claude's "7 days + extra" (7d_oi) repeats the weekly window with overage folded in.
const SKIP_SERIES = new Set(["7d_oi"]);

// Every limit of a row: the main windows, then per-model ones. `sid` names its Langfuse series.
function limits(d) {
  const at = d?.updated_at ?? null, out = [];
  if (d?.five_hour) out.push({ ...d.five_hour, at: d.five_hour.at ?? at, sid: "5h", short: "5h", label: "5 hours", window: d.five_hour.window ?? 18000 });
  if (d?.seven_day) out.push({ ...d.seven_day, at: d.seven_day.at ?? at, sid: "7d", short: "7d", label: "7 days", window: d.seven_day.window ?? 604800 });
  for (const m of d?.models ?? []) if (!SKIP_SERIES.has(m.series)) out.push({ ...m, at: m.at ?? at, sid: m.series ?? null, short: String(m.label).slice(0, 6), label: String(m.label) });
  return out;
}

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
  const e = elapsed(w, now), u = w.utilization;
  if (e === null || e <= 0 || isReset(w, now)) return null;
  const r = u / (e * 100);
  const trusted = e >= 0.1 || u >= 10;
  // Linear projection: at this rate, when does the window hit 100%? Only if before the reset.
  let runsOut = null;
  if (u > 0 && u < 100) {
    const left = (100 - u) * (e * w.window) / u;
    if (left < w.reset_at - now) runsOut = left;
  }
  return { e, r, trusted, runsOut, speed: !trusted ? 0 : r >= 1.5 ? 2 : r > 1 ? 1 : 0 };
}

// Colour and chevrons of a limit, by its pace.
function tone(w, now, t) {
  if (isReset(w, now)) return { color: t.dim, speed: 0, pace: null };
  const p = pace(w, now), speed = p?.speed ?? 0;
  return { color: w.utilization >= 90 || speed === 2 ? t.ansi1 : speed === 1 ? t.ansi3 : t.ansi2, speed, pace: p };
}

// The limit a row shows: the pinned one, or else the worst projection.
function headline(row, now) {
  const ls = limits(row.d);
  if (!ls.length) return null;
  const pinned = (shared(PINNED) ?? {})[row.key];
  const pick = ls.find(l => l.label === pinned);
  if (pick) return pick;
  const score = l => { if (isReset(l, now)) return -1; const pc = pace(l, now); return pc?.trusted ? l.utilization / pc.e : l.utilization; };
  return ls.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function span(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
function clock(unix, now) {
  const d = new Date(unix * 1000), hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return Math.abs(unix - now) < 18 * 3600 ? hm : `${DAYS[d.getDay()]} ${hm}`;
}
// "Fri 13, 13:00": a chart's ends, where a week-long window starts and resets on the same weekday.
function dayClock(unix) {
  const d = new Date(unix * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function ago(unix, now) {
  const s = Math.max(0, now - unix);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

// ---- text ---------------------------------------------------------------------------------------

const pctText = u => u > 0 && u < 1 ? "<1%" : `${Math.round(u)}%`;
const chevrons = s => s === 2 ? "››" : s === 1 ? "›" : "";
const money = (n, cur) => n == null ? "?" : cur === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${cur ?? ""}`.trim();
// Plan names as the providers call them now. ai-usage passes the raw plan: Claude's
// subscriptionType, or "max 5x" / "max 20x" from its rateLimitTier; Codex's plan_type.
//   Claude (renamed): Max 5x is "Max", Max 20x is "Ultra".
//   ChatGPT (renamed): prolite / pro / promax are Pro 100 / 200 / 500; Team is Business.
const PLANS = {
  claude: [[/20x|ultra/, "Ultra"], [/^max/, "Max"], [/^pro/, "Pro"], [/^team/, "Team"], [/^enterprise/, "Enterprise"], [/^free/, "Free"]],
  codex: [[/^prolite$/, "Pro 100"], [/^promax$/, "Pro 500"], [/^pro$/, "Pro 200"], [/^(team|business)$/, "Business"],
    [/^enterprise$/, "Enterprise"], [/^edu$/, "Edu"], [/^go$/, "Go"], [/^plus$/, "Plus"], [/^free$/, "Free"]],
};
function planName(id, raw) {
  const p = String(raw ?? "").trim().toLowerCase().replace(/^(claude|chatgpt|qwen)[\s_]+/, "").replace(/_/g, " ");
  if (!p) return null;
  const hit = (PLANS[id] ?? []).find(([re]) => re.test(p));
  return hit ? hit[1] : p.replace(/\b\w/g, c => c.toUpperCase());
}
// An account's name, short: the part of an email before the @, else the id as is.
const accountName = row => String(row.label ?? row.account ?? "").replace(/@.*/, "");

// The pace part of a limit's note: "×1.4 · runs out in ~2h 10m", or null when unremarkable.
function paceNote(w, now) {
  const p = pace(w, now);
  if (!p?.trusted || p.r <= 1) return null;
  return [`×${p.r.toFixed(1)} pace`, p.runsOut != null ? `runs out in ~${span(p.runsOut)}` : null].filter(Boolean).join(" · ");
}

function extras(d, all = true) {
  const out = [];
  const s = d?.spend, c = d?.credits;
  if (s && (all || s.enabled)) out.push(["Extra", s.enabled
    ? `${money(s.used, s.currency)}${s.limit != null ? ` of ${money(s.limit, s.currency)}` : ""}${s.utilization != null ? ` (${pctText(s.utilization)})` : ""}`
    : "off"]);
  if (c && (all || c.unlimited || c.has_credits || c.balance)) out.push(["Credits", c.unlimited ? "unlimited" : !c.has_credits && !c.balance ? "none"
    : c.balance != null ? `${Math.round(c.balance * 100) / 100}` : "available"]);
  return out;
}

// ---- look ---------------------------------------------------------------------------------------

function icon(id, size) {
  if (id === "qwen") return svg("mods/limits/qwen.svg").size(size).flex_none().text_color("#7c6cf0");
  return image(`icons/${id}.svg`).size(size).flex_none().rounded(id === "codex" ? 3 : 0);
}

const badge = (text, t) => div().flex_none().px(5).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.accent).child(text);

// A 3px track: used share filled in its pace colour, a tick where the window's time stands;
// what's used past the tick is drawn 5px tall, so running ahead shows without numbers.
function bar(w, now, t) {
  const reset = isReset(w, now), u = reset ? 0 : Math.min(100, Math.max(0, w.utilization));
  const { color } = tone(w, now, t), e = reset ? null : elapsed(w, now);
  const tick = e === null ? null : e * 100, under = tick === null ? u : Math.min(u, tick);
  return div().relative().flex_1().min_w(20).h(3).rounded(2).bg(t.raised)
    .when(under > 0, el => el.child(div().absolute().left(0).top(0).h(3).rounded(2).bg(color).w(`${Math.max(2, under)}%`)))
    .when(tick !== null && u > tick, el => el.child(div().absolute().top(-1).h(5).rounded(2).bg(color)
      .left(`${tick}%`).w(`${u - tick}%`)))
    .when(tick !== null, el => el.child(div().absolute().top(-3).h(9).w(1).bg(t.foreground).opacity(0.5).left(`${tick}%`)));
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}
// Is there a sidebar copy of this mod in the layout?
function hasSidebar(node = layout()) {
  if (node?.content?.mod === "limits" && node.content.props?.sidebar && !node.hidden) return true;
  return (node?.children ?? []).some(c => hasSidebar(c));
}
// Is there a status-bar copy of this mod in the layout?
function hasStrip(node = layout()) {
  if (node?.content?.mod === "limits" && !node.content.props?.sidebar && !node.hidden) return true;
  return (node?.children ?? []).some(c => hasStrip(c));
}
// The sidebar's rail (the shipped mods go by its width too).
const narrowSidebar = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// The provider of the agent in the focused pane, if it's one of ours. A pi says which provider
// it runs on in its terminal's labels (@wierdbytes/pi-herdr).
function focusedProvider() {
  const f = focused();
  if (!f?.terminal) return null;
  const a = agents().find(x => x.address === f.terminal);
  if (!a) return null;
  const keys = [a.app, a.program?.key].filter(Boolean).map(s => String(s).toLowerCase());
  const hit = PROVIDERS.find(p => p.apps.some(x => keys.includes(x)));
  if (hit) return hit.id;
  if (!keys.includes("pi")) return null;
  const provider = String(terminals().find(x => x.address === a.address)?.labels?.["agent.provider"] ?? "");
  return PROVIDERS.find(p => p.pi.some(re => re.test(provider)))?.id ?? null;
}

function setOpen(key, open) {
  const cur = shared(OPEN) ?? [];
  setShared(OPEN, open ? [...new Set([...cur, key])] : cur.filter(x => x !== key));
}

const MENU_W = 250, MENU_H = 96 + PROVIDERS.length * 28;
// at: window px for the popup's top left (default: the pointer).
function openMenu(at) {
  setShared(MENU, openOverlay({ mod: "limits", kind: "popup", width: MENU_W, height: MENU_H, props: { menu: true }, ...(at ? { at } : {}) }));
}
// Opens the popup, or closes it when it's open. A press beside an open popup closes it before
// the click lands here: one that closed moments ago was this click's, so it stays closed.
function toggleMenu(at) {
  const open = shared(MENU);
  if (open) { closeOverlay(open); setShared(MENU, null); setShared(MENU_CLOSED, Date.now()); return; }
  if (Date.now() - (shared(MENU_CLOSED) ?? 0) < 500) return;
  openMenu(at);
}
// Just above the status bar, never over it: `bar` is the bar's bounds (window px), `x` the pointer.
// `at` is in window px while the popup's size follows zoom.
function aboveBar(bar, x) {
  const z = Number(settings().zoom) || 1, w = MENU_W * z, h = MENU_H * z;
  const right = bar.x + bar.width - 6;
  return { x: Math.round(Math.max(6, Math.min((x ?? right) - w / 2, right - w))), y: Math.round(Math.max(6, bar.y - h - 6)) };
}

// The charts of one account, in a dialog (one at a time). Sizes (px at zoom 1) must match
// what chartView draws: a charted limit's title, plot and axis; a polled one's title and bar.
const CHART_W = 620, CHART_PAD = 16, CHART_GAP = 16, CHART_HEAD = 26;
const CHART_TITLE = 22, CHART_ROW = CHART_TITLE + 8 + CHART_H + 4 + 14, POLLED_ROW = CHART_TITLE + 8 + 6;
const charted = (row, l) => Boolean(l.sid && row.series?.[l.sid]);
const chartKey = (name, r) => `${name}:${r.kind}:${r.from}`;
function openChart(key) {
  const row = findRow(key);
  if (!row) return;
  const prev = shared(CHART);
  if (prev) closeOverlay(prev);
  const ls = limits(row.d);
  const body = ls.reduce((h, l) => h + CHART_GAP + (charted(row, l) ? CHART_ROW : POLLED_ROW), 0) || CHART_GAP + 20;
  setShared(CHART, openOverlay({ mod: "limits", kind: "dialog", width: CHART_W, height: CHART_PAD * 2 + CHART_HEAD + body, props: { chart: key } }));
}

// Sets where providers show; one that comes back from off is read at once.
function setWhere(ids, mode, cx) {
  const was = Object.fromEntries(PROVIDERS.map(p => [p.id, where(p.id)]));
  setShared(WHERE, { ...was, ...Object.fromEntries(ids.map(id => [id, mode])) });
  for (const id of ids) if (was[id] === "off" && mode !== "off") refresh(cx, { only: id });
}

export default class Limits extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu) return;
    if (p.chart) {
      this.range = "window";
      this.charts = {};
      this.lastKey = {};
      this.loadCharts(cx);
      cx.timer.every(TICK, cx => { this.loadCharts(cx); cx.notify(); });
      // A reset or new data can change what a chart shows between ticks.
      cx.timer.every(LF_CHECK, cx => this.loadCharts(cx, { missing: true }));
      return;
    }
    // Overlay ids left from before a restart name nothing.
    if (shared(MENU)) setShared(MENU, null);
    syncLf(cx, { force: true });
    refresh(cx);
    cx.timer.every(LF_CHECK, cx => syncLf(cx));
    cx.timer.every(POLL, cx => refresh(cx));
    // Countdowns and pace move without new readings.
    cx.timer.every(TICK, cx => cx.notify());
    // keys.json: "limits.refresh", "limits.menu", "limits.chart".
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        // Every shown copy gets the key: the bar's answers, the sidebar's only without one.
        if (props()?.sidebar && hasStrip()) continue;
        if (c === "refresh") { refresh(cx, { force: true }); syncLf(cx, { force: true }); }
        if (c === "menu") props()?.sidebar ? toggleMenu() : this.menuAboveBar();
        if (c === "chart" || c.startsWith("chart:")) {
          const want = c.startsWith("chart:") ? c.slice(6) : focusedProvider();
          const rs = allRows(nowS());
          const row = rs.find(r => r.key === want) ?? rs.find(r => r.p.id === want) ?? rs[0];
          if (row) openChart(row.key);
        }
      }
    });
  }

  render(cx) {
    const t = theme(), p = props() ?? {};
    if (p.menu) return this.menu(t);
    if (p.chart) return this.chartView(t, p.chart);
    if (p.sidebar) return this.sidebar(t, p.sidebar);
    return this.strip(t);
  }

  // ---- status bar -------------------------------------------------------------------------------

  strip(t) {
    const now = nowS();
    const shown = allRows(now, { placeholders: true, show: inBar });
    // Fit the block: the plan goes first, then the countdown, then the window's name.
    const room = (this.width ?? Infinity) - 24 - Math.max(0, shown.length - 1) * 14;
    const n = Math.max(1, shown.length);
    const mode = room >= n * 175 ? 3 : room >= n * 125 ? 2 : room >= n * 85 ? 1 : 0;
    const parts = shown.map(r => {
      const d = r.d, top = d && headline(r, now), many = limits(d).length > 1;
      const reset = top && isReset(top, now), tn = top && tone(top, now, t);
      return h_flex().id(`limits-${r.key}`).gap(6).items_center().flex_none().px(4).h(20).rounded(5).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click(() => d ? openChart(r.key) : this.menuAboveBar())
        .child(icon(r.p.id, 13))
        .when(r.multi && mode >= 1, el => el.child(div().max_w(70).truncate().text_size(10.5).text_color(t.dim).child(accountName(r))))
        .when(mode >= 3 && Boolean(d?.plan), el => el.child(badge(planName(r.p.id, d.plan), t)))
        .when(!top, el => el.child(div().text_color(t.dim).child(d ? "--" : "…")))
        .when(Boolean(top), el => el
          .when(mode >= 1 && many, el => el.child(div().text_size(10).text_color(t.dim).child(top.short)))
          .child(h_flex().gap(2).items_center()
            .when(tn.speed > 0, el => el.child(div().text_color(tn.color).font_semibold().child(chevrons(tn.speed))))
            .child(div().text_color(tn.color).child(reset ? "–" : pctText(top.utilization))))
          .when(mode >= 2 && top.reset_at != null && !reset, el => el.child(div().text_size(11).text_color(t.dim).child(span(top.reset_at - now)))))
        .when(Boolean(d?.error), el => el.child(div().text_size(10.5).font_semibold().text_color(top ? t.working : t.blocked).child("!")));
    });
    return h_flex().id("limits").size_full().px(12).gap(14).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(12).text_color(t.muted)
      .on_size_change((size, cx) => {
        const w = size.width / (Number(settings().zoom) || 1);
        if (w !== this.width) { this.width = w; cx.notify(); }
      })
      // A click carries no position: the press before it says where the bar is.
      .on_mouse_down("left", e => { if (e.bounds) this.press = { bar: e.bounds, x: e.position.x }; })
      .on_mouse_down("right", e => { if (e.bounds) this.press = { bar: e.bounds, x: e.position.x }; this.menuAboveBar(); })
      // Nothing shows anywhere: say where to bring the limits back.
      .when(!parts.length && !(hasSidebar() && PROVIDERS.some(p => inSidebar(p.id))), el => el
        .child(h_flex().id("limits-setup").h(20).px(7).gap(6).items_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.menuAboveBar())
          .child(svg("mods/limits/where-off.svg").size(12))
          .child("Click to set up limits")))
      .children(parts);
  }

  // The settings popup over the status bar, from its last press (else at the pointer).
  menuAboveBar() {
    toggleMenu(this.press ? aboveBar(this.press.bar, this.press.x) : undefined);
  }

  // ---- sidebar ----------------------------------------------------------------------------------

  // What an open row holds below its head.
  body(d, now) {
    const ls = limits(d);
    return { ls, notes: ls.filter(w => !isReset(w, now) && paceNote(w, now)).length, ex: extras(d, false), err: Boolean(d?.error) };
  }

  height(rows, narrow, open, now, lim) {
    if (!rows.length) return this.none ? 0 : ROW + PAD;
    if (narrow) return rows.length * ROW + PAD;
    return PAD + rows.reduce((h, r) => {
      if (!open.includes(r.key) || !r.d) return h + ROW;
      const b = this.body(r.d, now);
      return h + ROW + Math.max(1, b.ls.length) * lim + b.notes * NOTE + b.ex.length * EXTRA + (b.err ? ERR : 0) + 4;
    }, 0);
  }

  sidebar(t, block) {
    const now = nowS();
    const all = allRows(now, { placeholders: true, show: inSidebar });
    const rows = all.filter(r => r.d);
    // Nothing for the sidebar: the block folds away (loading still shows a row).
    const none = !rows.length && all.every(r => r.d);
    const narrow = narrowSidebar(), open = shared(OPEN) ?? [], pinned = shared(PINNED) ?? {};
    const stacked = (this.width ?? 0) < INLINE_MIN;
    this.none = none;
    const h = this.height(rows, narrow, open, now, stacked ? LIM_STACKED : LIM);
    if (h !== this.h && typeof block === "string") { this.h = h; run("layout.resize", { id: block, px: h }); }

    const root = v_flex().id("limits-side").w_full().pt(4).pb(4).px(narrow ? 4 : 10).border_t(1).border_color(t.border)
      .bg(t.chrome).text_size(12.5).on_mouse_down("right", () => toggleMenu())
      .on_size_change((size, cx) => {
        const w = size.width / (Number(settings().zoom) || 1);
        if (w !== this.width) { this.width = w; cx.notify(); }
      });
    if (none) return div().id("limits-side").w_full().h(0);
    if (!rows.length) return root.child(h_flex().h(ROW).px(4).items_center().text_color(t.dim).text_size(11.5).child("Limits…"));

    return root.children(rows.map(r => {
      const d = r.d, top = headline(r, now), isOpen = !narrow && open.includes(r.key);
      const reset = top && isReset(top, now), tn = top && tone(top, now, t);
      const pct = top && h_flex().flex_none().gap(2).items_center().justify_end()
        .when(tn.speed > 0, el => el.child(div().text_color(tn.color).font_semibold().child(chevrons(tn.speed))))
        .child(div().min_w(narrow ? 0 : 32).text_right().text_color(tn.color).child(reset ? "–" : pctText(top.utilization)));

      if (narrow) return h_flex().id(`side-${r.key}`).h(ROW).gap(4).items_center().justify_center().rounded(6)
        .child(icon(r.p.id, 12)).when(Boolean(pct), el => el.child(pct.text_size(10.5)));

      const head = h_flex().id(`side-${r.key}`).h(ROW).px(4).gap(6).items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click(() => setOpen(r.key, !isOpen))
        .child(h_flex().min_w(0).flex_shrink(1).gap(6).items_center().overflow_hidden()
          .child(icon(r.p.id, 13))
          .child(div().min_w(0).truncate().text_color(t.muted).child(r.multi ? `${r.p.name} · ${accountName(r)}` : r.p.name))
          .when(Boolean(d.plan), el => el.child(badge(planName(r.p.id, d.plan), t))))
        // The countdown gives way first when the sidebar is narrow; the % and arrow stay put.
        .child(h_flex().flex_1().min_w(0).justify_end().overflow_hidden()
          .when(Boolean(top) && !isOpen && top.reset_at != null && !reset, el => el
            .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(span(top.reset_at - now)))))
        .when(Boolean(d.error) && !isOpen, el => el.child(div().flex_none().text_size(11).font_semibold().text_color(top ? t.working : t.blocked).child("!")))
        .when(Boolean(pct) && !isOpen, el => el.child(pct))
        .when(!top && !isOpen, el => el.child(div().text_color(t.dim).child("--")))
        .when(isOpen && limits(d).length > 0, el => el.child(div().id(`chart-${r.key}`).flex_none().p(3).rounded(4).cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Charts")
          .on_click((_e, cx) => { cx.stop_propagation(); openChart(r.key); })
          .child(svg("mods/limits/chart.svg").size(11))))
        .child(svg(`mods/workspace-chrome/chevron-${isOpen ? "down" : "right"}.svg`).size(8).flex_none().text_color(t.dim));

      const b = isOpen ? this.body(d, now) : null;
      return v_flex().w_full()
        .child(head)
        .when(isOpen, el => el.child(v_flex().px(4).pb(4)
          .when(Boolean(d.error), el => el.child(div().h(ERR).flex().items_center().text_size(11).truncate().text_color(top ? t.working : t.blocked)
            .child(`${d.error}${d.retry_at && d.retry_at > now ? ` · retry in ${span(d.retry_at - now)}` : ""}`)))
          .when(!b.ls.length, el => el.child(div().h(LIM).flex().items_center().text_size(11.5).text_color(t.dim).child("No limits reported")))
          // In a fixed order (the headline is the bright one), so rows never jump.
          .children(b.ls.map(w => this.limitRow(r, w, now, t, pinned[r.key] === w.label, w.label === top?.label, stacked)))
          .children(b.ex.map(([k, v]) => h_flex().h(EXTRA).items_center().gap(7).text_size(11.5)
            .child(div().w(56).flex_none().text_color(t.muted).child(k))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(v))))));
    }));
  }

  limitRow(r, w, now, t, isPinned, isTop, stacked) {
    const reset = isReset(w, now), tn = tone(w, now, t), note = reset ? null : paceNote(w, now);
    const label = div().flex_none().truncate().text_color(isPinned ? t.accent : isTop ? t.foreground : t.muted)
      .when(isTop, el => el.font_semibold()).child(w.label);
    const pct = h_flex().w(42).flex_none().gap(2).justify_end().items_center()
      .when(tn.speed > 0, el => el.child(div().font_semibold().text_color(tn.color).child(chevrons(tn.speed))))
      .child(div().text_color(tn.color).child(reset ? "–" : pctText(w.utilization)));
    const resets = div().w(44).flex_none().text_right().text_size(10.5).text_color(t.dim)
      .child(!reset && w.reset_at != null ? span(w.reset_at - now) : "");
    const line = stacked
      ? v_flex().h(LIM_STACKED).justify_center().gap(4)
        .child(h_flex().items_center().gap(6).child(label.flex_1().min_w(0)).child(pct).child(resets))
        .child(h_flex().h(9).items_center().child(bar(w, now, t)))
      : h_flex().h(LIM).items_center().gap(6).child(label.w(52)).child(bar(w, now, t)).child(pct).child(resets);
    return v_flex()
      .child(line.id(`limit-${r.key}-${w.label}`).text_size(11.5).rounded(4).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click(() => {
          const cur = { ...(shared(PINNED) ?? {}) };
          if (isPinned) delete cur[r.key]; else cur[r.key] = w.label;
          setShared(PINNED, cur);
        }))
      .when(Boolean(note), el => el.child(div().h(NOTE).pb(3).flex().items_center().pl(stacked ? 0 : 58).text_size(10.5).truncate()
        .text_color(tn.speed === 2 ? t.ansi1 : t.ansi3).child(note)));
  }

  // ---- charts -----------------------------------------------------------------------------------

  // Asks Langfuse for every charted limit's series in the current range. Results land in
  // this.charts by series, range kind and start, so a window that resets (or a history that
  // moves on an hour) asks again instead of drawing what it had under the new title.
  // `missing`: only what isn't there yet.
  loadCharts(cx, { missing = false } = {}) {
    const row = findRow(props()?.chart), now = nowS();
    if (!row?.series) return;
    const wanted = limits(row.d).filter(l => charted(row, l)).map(l => {
      const name = row.series[l.sid], r = chartRange(l, this.range, now);
      return { name, r, key: chartKey(name, r) };
    }).filter(w => w.r.kind !== "none" && !(missing && (this.charts[w.key] || this.loading?.has(w.key))));
    if (!wanted.length) return;
    this.loading ??= new Set();
    for (const w of wanted) this.loading.add(w.key);
    cx.spawn(async cx => {
      const client = await lfClient();
      await Promise.all(wanted.map(async ({ name, r, key }) => {
        try {
          if (!client) throw new Error("no Langfuse keys");
          const data = await client.series([name], r.from * 1000, (r.until + 60) * 1000, r.granularity);
          this.charts[key] = { r, points: seriesPoints(data, name) };
        } catch (e) {
          this.charts[key] = { r, error: String(e?.message ?? e) };
        } finally {
          this.loading.delete(key);
        }
        this.lastKey[`${name}:${r.kind}`] = key;
      }));
      cx.notify();
    });
  }

  chartView(t, key) {
    const now = nowS(), row = findRow(key);
    const close = () => { const id = props()?.overlay; if (id) closeOverlay(id); };
    const root = v_flex().id("limits-chart").size_full().p(CHART_PAD).gap(CHART_GAP).bg(t.popover).text_size(12).text_color(t.muted);
    if (!row?.d) return root.child(div().text_color(t.dim).child("No data for these limits."));
    const d = row.d, ls = limits(d);
    const tab = (id, label) => div().id(`range-${id}`).px(10).py(2).rounded(5).cursor_pointer().text_size(11)
      .when(this.range === id, el => el.bg(t.raised).text_color(t.foreground))
      .when(this.range !== id, el => el.text_color(t.dim).hover(s => s.text_color(t.foreground)))
      .on_click((_e, cx) => { if (this.range !== id) { this.range = id; this.loadCharts(cx); cx.notify(); } })
      .child(label);
    const head = h_flex().h(CHART_HEAD).gap(8).items_center()
      .child(icon(row.p.id, 16))
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(row.p.name))
      .when(row.multi, el => el.child(div().max_w(160).truncate().text_color(t.dim).child(row.label)))
      .when(Boolean(d.plan), el => el.child(badge(planName(row.p.id, d.plan), t)))
      .child(div().flex_1())
      .when(Boolean(d.updated_at), el => el.child(div().text_size(10.5).text_color(t.dim).child(`updated ${ago(d.updated_at, now)}`)))
      .child(h_flex().gap(2).p(2).rounded(7).bg(t.surface).border(1).border_color(t.border).child(tab("window", "Window")).child(tab("history", "History")).child(tab("90d", "90 days")))
      .child(div().id("chart-close").w(22).h(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_size(15).text_color(t.dim)
        .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(close).child("×"));
    return root.child(head).children(ls.map(l => this.chartRow(row, l, now, t)));
  }

  // The pointer over one plot: its time, and the setter the plot reports moves to.
  hoverOf(name) {
    return {
      id: `plot-${name}-${this.range}`,
      ts: this.hover?.name === name ? this.hover.ts : null,
      set: (ts, cx) => {
        if (ts == null ? this.hover?.name !== name : this.hover?.name === name && this.hover.ts === ts) return;
        this.hover = ts == null ? null : { name, ts };
        cx.notify();
      },
    };
  }

  // A limit's headline: name, value, reset; on the right how its pace looks and where it lands.
  chartTitle(l, now, t, tn, side) {
    const reset = isReset(l, now);
    return h_flex().h(CHART_TITLE).gap(8).items_end()
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(l.label))
      .child(div().text_size(16).font_semibold().text_color(tn.color).child(reset ? "–" : pctText(l.utilization)))
      .when(!reset && l.reset_at != null, el => el.child(div().pb(1).text_size(11).text_color(t.dim).child(`resets in ${span(l.reset_at - now)} · ${clock(l.reset_at, now)}`)))
      .child(div().flex_1())
      .children(side);
  }

  chartRow(row, l, now, t) {
    const name = charted(row, l) ? row.series[l.sid] : null;
    const reset = isReset(l, now), tn = tone(l, now, t), pc = reset ? null : pace(l, now);
    const pill = (text, color) => div().px(6).py(1).rounded(4).bg(alpha(color, 0.14)).text_size(10.5).text_color(color).child(text);
    const side = [];
    if (pc?.trusted) {
      side.push(pc.r > 1 ? pill(`×${pc.r.toFixed(1)} pace`, tn.speed === 2 ? t.ansi1 : t.ansi3) : pill("on pace", t.ansi2));
      const atReset = pc.e > 0 ? l.utilization / pc.e : null;
      side.push(div().text_size(10.5).text_color(pc.runsOut != null ? t.ansi1 : t.dim)
        .child(pc.runsOut != null ? `100% in ~${span(pc.runsOut)}` : atReset != null ? `≈${Math.round(atReset)}% at reset` : ""));
    }
    if (!name) {
      side.push(div().text_size(10.5).text_color(t.dim).child("polled, no history"));
      return v_flex().gap(8).child(this.chartTitle(l, now, t, tn, side)).child(polledBar(reset ? 0 : l.utilization, reset ? null : elapsed(l, now), t, tn.color));
    }
    const fresh = chartRange(l, this.range, now);
    // The data for this range, else what this series last showed of the same kind (a history
    // whose hour moved on) while the new one loads.
    const c = this.charts[chartKey(name, fresh)] ?? this.charts[this.lastKey[`${name}:${fresh.kind}`]];
    const r = c?.r ?? fresh;
    const inWindow = r.bars == null;
    const chart = fresh.kind === "none" ? emptyChart("The window starts with the next request", t)
      : !c ? emptyChart("Loading…", t)
      : c.error ? emptyChart(c.error, t)
      : inWindow ? windowChart(l, c.points, r, now, t, tn.color, this.hoverOf(name))
      : c.points.length ? historyChart(c.points, r, now, t, t.accent, this.hoverOf(name)) : emptyChart("No readings in this range yet", t);
    const long = r.to - r.from > 86400;
    const left = inWindow ? (long ? dayClock(r.from) : clock(r.from, now)) : `${Math.round((now - r.from) / 86400)} days ago`;
    const right = inWindow ? `↺ ${long ? dayClock(r.to) : clock(r.to, now)}` : "now";
    return v_flex()
      .child(this.chartTitle(l, now, t, tn, side))
      .child(div().h(8))
      .child(chart)
      .child(div().h(4))
      .child(fresh.kind === "none" ? div().h(14) : axis(r, left, right, t));
  }

  // ---- popup ------------------------------------------------------------------------------------

  // The popup going (a press beside it, Esc, a toggle): say so, for toggleMenu.
  async close() {
    const p = props() ?? {};
    if (p.chart) { if (shared(CHART) === p.overlay) setShared(CHART, null); return; }
    if (!p.menu) return;
    if (shared(MENU) === p.overlay) setShared(MENU, null);
    setShared(MENU_CLOSED, Date.now());
  }

  // Four mini windows, the shown place filled in: sidebar, both, status bar, nowhere.
  // `current` null: none picked (the All row when providers differ).
  picker(key, current, pick, t) {
    // A small pill, like a light/dark/system theme switch: 86 x 22.
    return h_flex().flex_none().h(22).p(1).gap(0).items_center().rounded_full()
      .border(1).border_color(t.border).bg(t.surface)
      .children(MODES.map(m => {
        const on = m.id === current;
        return div().id(`where-${key}-${m.id}`).w(20).h(18).flex().items_center().justify_center().rounded_full().cursor_pointer()
          .when(on, el => el.bg(t.raised).border(1).border_color(t.input))
          .when(!on, el => el.hover(s => s.bg(t.hover)))
          .tooltip(m.label)
          .on_click((_e, cx) => pick(m.id, cx))
          .child(svg(`mods/limits/where-${m.id}.svg`).size(12)
            .text_color(on ? t.foreground : t.dim));
      }));
  }

  menu(t) {
    const now = nowS();
    const newest = Math.max(0, ...allRows(now).map(r => r.d?.updated_at ?? 0));
    const lfError = shared(LF_ERROR), lfAccounts = Object.keys(shared(LF)?.accounts ?? {}).length;
    const source = lfError ? `Langfuse: ${lfError}` : lfAccounts ? "Live from pi via Langfuse, extras from ai-usage" : "Waiting for pi's first reading (ai-usage meanwhile)";
    const modes = PROVIDERS.map(p => where(p.id)), same = modes.every(m => m === modes[0]) ? modes[0] : null;
    const row = (key, lead, name, mode, pick, opts = {}) => h_flex().id(`row-${key}`).h(28).px(8).gap(8).items_center()
      .child(div().w(14).flex_none().flex().justify_center().child(lead))
      .child(div().flex_none().text_color(mode === "off" ? t.muted : t.foreground).when(Boolean(opts.bold), el => el.font_semibold()).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(mode ? SHORT[mode] : "Mixed"))
      .child(this.picker(key, mode, pick, t));
    return v_flex().id("limits-menu").size_full().p(6).bg(t.popover).text_size(12.5)
      .child(h_flex().h(28).px(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(newest ? `Limits · updated ${ago(newest, now)}` : "Limits"))
        .child(div().id("limits-refresh").px(6).py(1).rounded(5).cursor_pointer().text_size(11).text_color(t.muted).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.busy = true; cx.notify();
            let left = 2;
            const done = () => { if (--left === 0) { this.busy = false; cx.notify(); } };
            refresh(cx, { force: true, done });
            syncLf(cx, { force: true, done });
          })
          .child(this.busy ? "Refreshing…" : "Refresh")))
      .child(div().h(20).px(8).flex().items_center().truncate().text_size(10.5).text_color(lfError ? t.working : t.dim).child(source))
      .child(row("all", svg("mods/workspace-chrome/layers.svg").size(13).text_color(t.muted), "All", same,
        (m, cx) => setWhere(PROVIDERS.map(p => p.id), m, cx), { bold: true }))
      .child(div().mx(8).my(3).h(1).bg(t.border))
      .children(PROVIDERS.map(p => row(p.id, icon(p.id, 13).opacity(where(p.id) === "off" ? 0.4 : 1), p.name, where(p.id),
        (m, cx) => setWhere([p.id], m, cx))));
  }
}
