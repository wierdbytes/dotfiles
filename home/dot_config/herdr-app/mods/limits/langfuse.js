// Langfuse's public API, read with the keys pi-langfuse already has. No herdr imports: the mod
// hands in `fetch` and a file reader, `bun test` hands in fakes.
//
//   current values  GET /api/public/v3/scores   newest first, `fromTimestamp`, cursor pages
//   series names    GET /api/public/v2/metrics  scores-numeric, count by name, name starts with "rl."
//   charts          GET /api/public/v2/metrics  scores-numeric, max(value) by name per minute/hour
//
// (The v1 scores and metrics routes are off on Langfuse v4 servers in events_only mode.)
import { PREFIX, applyScores } from "./reduce.js";

// Where pi-langfuse keeps its keys; the mod's own langfuse.json, when present, comes first.
export const credentialFiles = (home, modDir) => [
  `${modDir}/langfuse.json`,
  `${home}/.pi/agent/pi-langfuse/config.json`,
  `${home}/.pi/agent/langfuse.json`,
];

export async function loadCredentials(readText, files) {
  for (const file of files) {
    const text = await readText(file).catch(() => null);
    if (!text) continue;
    let c;
    try { c = JSON.parse(text); } catch { continue; }
    const host = c?.host ?? c?.baseUrl ?? c?.baseURL;
    if (c?.publicKey && c?.secretKey && host) return { host: String(host).replace(/\/+$/, ""), publicKey: c.publicKey, secretKey: c.secretKey, file };
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// The keys are ASCII; no Buffer/btoa needed.
export function base64(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i) & 255, b = text.charCodeAt(i + 1) & 255, c = text.charCodeAt(i + 2) & 255;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < text.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < text.length ? B64[n & 63] : "=");
  }
  return out;
}

const iso = ms => new Date(ms).toISOString();

export function normalizeScore(s) {
  return { id: s.id, name: s.name, value: s.value, at: Date.parse(s.timestamp) / 1000, metadata: s.metadata ?? {} };
}

export class Langfuse {
  constructor(creds, fetchFn) {
    this.host = creds.host;
    this.auth = `Basic ${base64(`${creds.publicKey}:${creds.secretKey}`)}`;
    this.fetch = fetchFn;
  }

  // The answer's JSON. Throws an Error with `status`; `offline` when the server wasn't reached.
  async get(path, params = {}) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`)
      .join("&");
    let res;
    try {
      res = await this.fetch(`${this.host}/api/public${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: this.auth, Accept: "application/json" } });
    } catch (e) {
      const err = new Error(`Langfuse unreachable: ${String(e?.message ?? e)}`);
      err.offline = true;
      throw err;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* a proxy's page: the status says enough */ }
    if (!res.ok) {
      const err = new Error(res.status === 401 ? "Langfuse rejected the keys (401)" : `Langfuse: ${data?.message ?? `HTTP ${res.status}`}`.slice(0, 200));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Rate-limit scores written since `fromMs`, every page (other scores share the endpoint).
  async scoresSince(fromMs, pages = 5) {
    const out = [];
    let cursor = null;
    for (let i = 0; i < pages; i++) {
      const r = await this.get("/v3/scores", { fromTimestamp: iso(fromMs), limit: "100", fields: "core,details", cursor });
      for (const s of r?.data ?? []) if (String(s.name).startsWith(PREFIX)) out.push(normalizeScore(s));
      cursor = r?.meta?.cursor;
      if (!cursor || (r?.data?.length ?? 0) < 100) break;
    }
    return out;
  }

  // The newest score of one series, or null.
  async latest(name) {
    const r = await this.get("/v3/scores", { name, limit: "1", fields: "core,details" });
    const s = r?.data?.[0];
    return s ? normalizeScore(s) : null;
  }

  metrics(query) {
    return this.get("/v2/metrics", { query: JSON.stringify({ orderBy: null, config: { row_limit: 1000 }, ...query }) });
  }

  // Every rate-limit series with a reading in [fromMs, toMs).
  async names(fromMs, toMs) {
    const r = await this.metrics({
      view: "scores-numeric",
      dimensions: [{ field: "name" }],
      metrics: [{ measure: "count", aggregation: "count" }],
      filters: [{ column: "name", type: "string", operator: "starts with", value: PREFIX }],
      timeDimension: null,
      fromTimestamp: iso(fromMs),
      toTimestamp: iso(toMs),
    });
    return [...new Set((r?.data ?? []).map(x => x.name).filter(n => typeof n === "string" && n.startsWith(PREFIX)))];
  }

  // max(value) per `granularity` bucket ("minute" | "hour" | "day") for these series.
  async series(names, fromMs, toMs, granularity) {
    const r = await this.metrics({
      view: "scores-numeric",
      dimensions: [{ field: "name" }],
      metrics: [{ measure: "value", aggregation: "max" }, { measure: "count", aggregation: "count" }],
      filters: [{ column: "name", type: "stringOptions", operator: "any of", value: names }],
      timeDimension: { granularity },
      fromTimestamp: iso(fromMs),
      toTimestamp: iso(toMs),
    });
    return r?.data ?? [];
  }
}

// Readings arrive up to ~20 s after they happened (the ingestion queue): read that far back.
export const OVERLAP_MS = 90_000;
// Away longer than this (a sleep, a long offline spell): start over from each series' newest.
const RESTART_MS = 30 * 60_000;

// One sync: `lf` with what was written since its cursor folded in.
export async function sync(client, lf, nowMs) {
  let scores;
  if (!lf?.cursor || nowMs - lf.cursor > RESTART_MS) {
    const names = await client.names(nowMs - 8 * 86_400_000, nowMs + 60_000);
    scores = (await Promise.all(names.map(n => client.latest(n).catch(() => null)))).filter(Boolean);
    // What came in while the newest ones were being asked for.
    scores.push(...await client.scoresSince(nowMs - OVERLAP_MS));
  } else {
    scores = await client.scoresSince(lf.cursor - OVERLAP_MS);
  }
  return { ...applyScores(lf, scores), cursor: nowMs };
}
