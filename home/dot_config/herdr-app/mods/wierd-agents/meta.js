// What an agent runs with: model, effort, context, in-process sub-agents.
// Pi (with @wierdbytes/pi-herdr) writes them as `agent.*` labels on its terminal;
// other agents don't, and fall back to their program's name and icon.

// Labels a pi left behind (it crashed, the shell came back) name a dead process:
// trust them only while their pid is still the terminal's foreground program.
export function agentMeta(term) {
  const l = term?.labels;
  if (!l?.["agent.app"]) return null;
  const pid = l["agent.pid"];
  const fg = term.foreground?.pid;
  if (pid && fg != null && String(fg) !== pid) return null;
  const num = (k) => {
    const n = Number(l[k]);
    return l[k] !== undefined && l[k] !== "" && Number.isFinite(n) ? n : null;
  };
  return {
    app: l["agent.app"],
    model: l["agent.model"] || null,
    modelId: l["agent.model_id"] || null,
    provider: l["agent.provider"] || null,
    effort: l["agent.effort"] || null,
    ctx: num("agent.ctx"),
    ctxMax: num("agent.ctx_max"),
    subagents: num("agent.subagents") ?? 0,
  };
}

// The model as people say it. The mark in front is the provider's, so a vendor
// word goes only where that mark already says it (Claude under Anthropic, GPT
// under OpenAI); behind a router or a gateway it stays.
const OWN = { anthropic: /^claude[\s-]+(?=\S)/i, openai: /^gpt[\s-]+(?=\S)/i, kimi: /^kimi[\s-]+(?=\S)/i, moonshot: /^kimi[\s-]+(?=\S)/i };
export function shortModel(name, mark) {
  const raw = String(name ?? "").trim();
  const s = raw
    .replace(/^[^:/]{1,40}:\s+/, "") // OpenRouter's "Anthropic: Claude Opus 4.8"
    .replace(/^[\w.-]+\//, ""); // an id as the name: "anthropic/claude-fable-5"
  return (OWN[mark] ? s.replace(OWN[mark], "") : s) || raw;
}

// Who serves the model: the provider the session goes through (a subscription,
// a router, a gateway), not who trained it. pi's provider ids and common custom
// ones, to a mark in providers/.
const PROVIDERS = [
  ["anthropic", /^anthropic/],
  ["openai", /^(openai|chatgpt)/],
  ["azure", /^azure/],
  ["google", /^(google|gemini|vertex)/],
  ["aws", /^(amazon|aws|bedrock)/],
  ["opencode", /^opencode/],
  ["openrouter", /^openrouter/],
  ["github-copilot", /copilot/],
  ["vercel", /^vercel/],
  ["cloudflare", /^cloudflare/],
  ["xai", /^(xai|x-ai|grok)/],
  ["groq", /^groq/],
  ["cerebras", /^cerebras/],
  ["mistral", /^mistral/],
  ["deepseek", /^deepseek/],
  ["zai", /^(zai|z-ai|zhipu|bigmodel)/],
  ["minimax", /^minimax/],
  ["kimi", /^kimi/],
  ["moonshot", /^moonshot/],
  ["qwen", /^(qwen|dashscope|alibaba)/],
  ["xiaomi", /^xiaomi/],
  ["huggingface", /^(huggingface|hf-)/],
  ["fireworks", /^fireworks/],
  ["together", /^together/],
  ["baseten", /^baseten/],
  ["nvidia", /^nvidia/],
  ["meta", /^meta/],
  ["ollama", /^ollama/],
  ["lm-studio", /^lm-?studio/],
];
export function providerOf(meta) {
  const p = String(meta?.provider ?? "").toLowerCase();
  return p ? (PROVIDERS.find(([, re]) => re.test(p))?.[0] ?? null) : null;
}

// 850, 7.2k, 72.1k, 228k, 1.2M.
export function tokens(n) {
  if (n == null) return null;
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

// 12s, 5m, 3h, 2d: the largest unit that fits, so the column stays short.
const UNITS = [[1000, "s", 60], [60000, "m", 60], [3600000, "h", 24], [86400000, "d", Infinity]];
export function duration(ms) {
  const e = Math.max(0, ms);
  for (const [size, suffix, max] of UNITS) {
    const n = Math.floor(e / size);
    if (n < max) return `${n}${suffix}`;
  }
  return "";
}

// When duration(now - since) next reads differently.
export function nextTick(since, now) {
  const e = Math.max(0, now - since);
  for (const [size, , max] of UNITS) {
    if (Math.floor(e / size) < max) return since + (Math.floor(e / size) + 1) * size;
  }
  return now + 86400000;
}

// pi-statusline's effort ladder (Tokyo Night), so this list and pi's footer agree:
// purple (minimal) up to red (xhigh); max gets a gradient across its letters.
const EFFORT = {
  off: { hex: "#565f89", ansi: "dim" },
  minimal: { hex: "#bb9af7", ansi: "ansi5" },
  low: { hex: "#7aa2f7", ansi: "ansi4" },
  medium: { hex: "#7dcfff", ansi: "ansi6" },
  high: { hex: "#ff9e64", ansi: "ansi3" },
  xhigh: { hex: "#f7768e", ansi: "ansi1" },
  max: { hex: "#f7768e", ansi: "ansi1" },
};
const MAX_GRADIENT = [
  [255, 158, 100], // orange
  [247, 118, 142], // red
  [215, 135, 175], // pink
  [187, 154, 247], // purple
];

// The color for an effort word. Dark themes take the statusline's own colors;
// light ones the theme's matching ANSI color, which is made to read on white.
// A word the ladder doesn't know (a model's token budget) stays muted.
export function effortColor(effort, t, dark) {
  const e = EFFORT[effort];
  if (!e) return t.muted;
  return dark ? e.hex : (t[e.ansi] ?? e.hex);
}

// Each glyph of `text` with its color along the max gradient; spaces take no stop.
export function maxGradient(text) {
  const glyphs = Array.from(text);
  const count = glyphs.filter((g) => g.trim().length > 0).length;
  let i = 0;
  return glyphs.map((g) => {
    if (g.trim().length === 0) return [g, null];
    const scaled = (count > 1 ? i / (count - 1) : 0) * (MAX_GRADIENT.length - 1);
    const lo = Math.floor(scaled);
    const hi = Math.min(lo + 1, MAX_GRADIENT.length - 1);
    const mix = scaled - lo;
    const hex = MAX_GRADIENT[lo]
      .map((c, k) => Math.round(c + (MAX_GRADIENT[hi][k] - c) * mix).toString(16).padStart(2, "0"))
      .join("");
    i += 1;
    return [g, `#${hex}`];
  });
}
