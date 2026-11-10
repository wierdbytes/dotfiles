// Pure data: Langfuse rate-limit scores folded into accounts, and accounts merged with what
// ai-usage polls. No herdr imports, so `bun test` runs it as it is.
//
// A score is one reading of one window, written by pi-langfuse:
//   name   rl.<provider>.<account>.<window>   (window may hold dots: "bengalfox.5h")
//   value  share of the window used, in percent
//   metadata  resets_at, window_s, status, label, plan, account_label, binding…
// Readings arrive late and out of order (parallel pi sessions, ingestion lag), so they are
// folded, never replaced: within one window (same reset, give or take two minutes) the used
// share only grows; a reading of a later window replaces it; one of an earlier window is
// dropped. Folding the same score twice changes nothing.

export const PREFIX = "rl.";
// Two readings of one window can disagree on the reset by a little (Codex derives it).
const SAME_WINDOW = 120;

const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const str = v => (v === null || v === undefined || v === "" ? null : String(v));

export function parseName(name) {
  if (typeof name !== "string" || !name.startsWith(PREFIX)) return null;
  const parts = name.split(".");
  if (parts.length < 4 || !parts[1] || !parts[2]) return null;
  return { provider: parts[1], account: parts[2], limit: parts.slice(3).join(".") };
}

export const emptyLf = () => ({ accounts: {}, cursor: 0 });

// A window reading: utilization in percent, reset and time read in unix seconds.
export function readingOf(score) {
  const md = score.metadata ?? {};
  return {
    utilization: num(score.value) ?? 0,
    reset_at: num(md.resets_at),
    window: num(md.window_s),
    status: str(md.status),
    label: str(md.label),
    at: score.at,
  };
}

// Folds reading `b` into window `a` (either may be null). See the rules above. A reading
// without a reset is a window that hasn't started (Anthropic: 0% and no reset until the next
// request): it replaces a window that had ended by the time it was read, which is kept as
// `last_reset_at` / `last_window` so the chart can still show it.
export function foldWindow(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = (b.at ?? 0) >= (a.at ?? 0) ? b : a;
  if ((a.reset_at == null) !== (b.reset_at == null)) {
    const timed = a.reset_at != null ? a : b, open = timed === a ? b : a;
    if ((open.at ?? 0) < timed.reset_at) return timed;
    const last = Math.max(timed.reset_at, open.last_reset_at ?? 0);
    return { ...open, last_reset_at: last, last_window: last === timed.reset_at ? timed.window ?? open.last_window : open.last_window };
  }
  if (a.reset_at != null && b.reset_at != null) {
    if (b.reset_at > a.reset_at + SAME_WINDOW) return b;
    if (b.reset_at < a.reset_at - SAME_WINDOW) return a;
    return {
      ...a, ...newer,
      utilization: Math.max(a.utilization ?? 0, b.utilization ?? 0),
      // The later reset of the two: Codex moves it while a window hasn't started.
      reset_at: Math.max(a.reset_at, b.reset_at),
      at: Math.max(a.at ?? 0, b.at ?? 0),
    };
  }
  return newer;
}

// Scores ({ id, name, value, at (unix s), metadata }) folded into `lf`. Returns a new object.
export function applyScores(lf, scores) {
  const accounts = { ...(lf?.accounts ?? {}) };
  for (const s of scores) {
    const n = parseName(s.name);
    if (!n) continue;
    const key = `${n.provider}.${n.account}`;
    const md = s.metadata ?? {};
    const prev = accounts[key] ?? { provider: n.provider, account: n.account, label: null, plan: null, at: 0, limits: {} };
    const latest = (s.at ?? 0) >= (prev.at ?? 0);
    const r = readingOf(s);
    accounts[key] = {
      ...prev,
      label: latest ? str(md.account_label) ?? prev.label : prev.label ?? str(md.account_label),
      plan: latest ? str(md.plan) ?? prev.plan : prev.plan ?? str(md.plan),
      at: Math.max(prev.at ?? 0, s.at ?? 0),
      limits: { ...prev.limits, [n.limit]: { id: n.limit, ...foldWindow(prev.limits[n.limit], r) } },
    };
  }
  return { ...(lf ?? emptyLf()), accounts };
}

// ---- merged rows ------------------------------------------------------------------------------

const MAIN = { "5h": "five_hour", "7d": "seven_day" };

// An account in the shape ai-usage prints: five_hour, seven_day, models[], plan, updated_at.
export function accountData(acc) {
  const out = { provider: acc.provider, five_hour: null, seven_day: null, models: [], plan: acc.plan, updated_at: acc.at || null, source: "langfuse" };
  const win = l => ({ utilization: l.utilization, reset_at: l.reset_at, at: l.at, window: l.window, last_reset_at: l.last_reset_at, last_window: l.last_window });
  for (const l of Object.values(acc.limits ?? {})) {
    if (MAIN[l.id]) out[MAIN[l.id]] = win(l);
    else out.models.push({ ...win(l), label: l.label ?? l.id, series: l.id });
  }
  out.models.sort((a, b) => (a.window ?? Infinity) - (b.window ?? Infinity) || String(a.label).localeCompare(String(b.label)));
  return out;
}

const withAt = (w, at) => (w ? { ...w, at: w.at ?? at } : null);

// Langfuse data `lf` (accountData) merged with an ai-usage reading `poll`. ai-usage brings
// what headers don't: the plan's name, per-model weekly limits, extra spend, credits.
export function mergeData(lf, poll, now, stale = 600) {
  if (!poll) return lf;
  if (!lf) return poll;
  const pat = poll.updated_at ?? null;
  const models = [...lf.models];
  for (const m of poll.models ?? []) {
    const i = models.findIndex(x => String(x.label).toLowerCase() === String(m.label).toLowerCase());
    if (i < 0) models.push(withAt(m, pat));
    else models[i] = { ...models[i], ...foldWindow(models[i], withAt(m, pat)) };
  }
  const lfFresh = lf.updated_at != null && now - lf.updated_at < stale;
  return {
    ...poll,
    five_hour: foldWindow(lf.five_hour, withAt(poll.five_hour, pat)),
    seven_day: foldWindow(lf.seven_day, withAt(poll.seven_day, pat)),
    models,
    plan: poll.plan ?? lf.plan,
    updated_at: Math.max(lf.updated_at ?? 0, pat ?? 0) || null,
    // A failed poll matters little while pi keeps the windows fresh.
    error: lfFresh ? null : poll.error ?? null,
    retry_at: lfFresh ? null : poll.retry_at ?? null,
    source: "both",
  };
}

// One row per account. `providers`: [{ id }]; `polled`: ai-usage readings by provider id;
// `lf`: folded scores. A provider with one account keeps its id as the row key (so open and
// pinned rows survive), several get `<provider>:<account>`. ai-usage can't tell accounts
// apart: its reading joins the account pi used last.
export function rows(providers, polled, lf, now) {
  const out = [];
  for (const p of providers) {
    const accs = Object.values(lf?.accounts ?? {}).filter(a => a.provider === p.id).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const poll = polled?.[p.id] ?? null;
    if (!accs.length) {
      if (poll) out.push({ key: p.id, p, account: null, label: null, multi: false, d: poll });
      continue;
    }
    accs.forEach((a, i) => {
      out.push({
        key: accs.length > 1 ? `${p.id}:${a.account}` : p.id,
        p, account: a.account, label: a.label ?? a.account, multi: accs.length > 1,
        series: Object.fromEntries(Object.keys(a.limits).map(id => [id, `${PREFIX}${a.provider}.${a.account}.${id}`])),
        d: mergeData(accountData(a), i === 0 ? poll : null, now),
      });
    });
  }
  return out;
}

// ---- charts ---------------------------------------------------------------------------------

// Metrics rows ({ name, time_dimension, max_value, count_count }) of one series as points
// { t (unix s), v }, buckets without readings left out.
export function seriesPoints(data, name) {
  return (data ?? [])
    .filter(r => r.name === name && (num(r.count_count) ?? 1) > 0)
    .map(r => ({ t: Date.parse(r.time_dimension) / 1000, v: num(r.max_value) ?? 0 }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

// Points grouped into `n` equal buckets over [from, to): the highest value in each, or null.
export function buckets(points, from, to, n) {
  const out = new Array(n).fill(null);
  const span = (to - from) / n;
  for (const p of points) {
    const i = Math.floor((p.t - from) / span);
    if (i >= 0 && i < n) out[i] = Math.max(out[i] ?? 0, p.v);
  }
  return out;
}
