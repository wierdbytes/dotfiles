// Reads pi's sessions for the Sessions tab: `node sessions.mjs '<request json>'`.
//
// Request: { root, dirs: [{ cwd, limit }], known: { [file]: end } }
//   root   pi's sessions folder (~/.pi/agent/sessions)
//   cwd    a space's folder; its sessions live in root/--<cwd with / as ->--
//   limit  how many of the newest to describe
//   known  how far each file was read before: only what was appended since is
//          read again (pi only appends), so a 100 MB session costs nothing twice.
// Answer: { dirs: { [cwd]: { total, files: [{ file, mtime }] } },
//           read: { [file]: { end, id?, cwd?, name?, provider?, model?, effort?, ctx?, first? } } }
//   effort  the thinking level last used ("" when off); ctx: the context size
//   after the last whole reply (pi's own count: its usage's totalTokens).
//   `end` is where the next read starts (after the last whole line); the other
//   fields are only what this read found, so the caller keeps earlier ones.

import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

const req = JSON.parse(process.argv[2] ?? "{}");
const known = req.known ?? {};
const out = { dirs: {}, read: {} };

const dirOf = (cwd) => `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;

// The first line of what a person typed: the session's subject until it has a name.
function firstText(message) {
  const c = message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.find((p) => p?.type === "text")?.text : null;
  // Skip what isn't words: code fences, quote marks, list bullets.
  const line = String(text ?? "")
    .split("\n")
    .map((s) => s.replace(/^[\s>`#*\-]+/, "").trim())
    .find((s) => /\p{L}/u.test(s));
  return line ? line.slice(0, 160) : null;
}

// A reply's model, effort and usage: they follow its content, so read only the
// tail from its last "api" key (content can't fake what comes after it).
function reply(line, info) {
  const tail = line.slice(line.lastIndexOf('"api":"'));
  const str = (key) => tail.match(new RegExp(`"${key}":"([^"]*)"`))?.[1];
  const stop = str("stopReason");
  if (stop === "aborted" || stop === "error") return;
  const total = tail.match(/"usage":\{[^}]*"totalTokens":(\d+)/)?.[1];
  if (total) info.ctx = Number(total);
  const provider = str("provider");
  const model = str("model");
  if (provider && model) {
    info.provider = provider;
    info.model = model;
  }
  const level = str("providerThinkingLevel") ?? str("thinkingLevel");
  if (level != null) info.effort = level === "off" ? "" : level;
}

function read(file, from) {
  const size = statSync(file).size;
  const info = { end: from };
  if (size <= from) return info;
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    const last = buf.lastIndexOf(10);
    if (last < 0) return info;
    info.end = from + last + 1;
    const text = buf.toString("utf8", 0, last);
    for (const line of text.split("\n")) {
      // Most lines are messages and tool output: look before parsing.
      const head = line.slice(0, 240);
      if (head.includes('"type":"session"')) {
        const e = JSON.parse(line);
        info.id = e.id;
        info.cwd = e.cwd;
      } else if (head.includes('"type":"session_info"')) {
        const e = JSON.parse(line);
        if (e.name) info.name = e.name;
      } else if (head.includes('"type":"model_change"')) {
        const e = JSON.parse(line);
        info.provider = e.provider;
        info.model = e.modelId;
      } else if (head.includes('"type":"thinking_level_change"')) {
        const e = JSON.parse(line);
        info.effort = e.thinkingLevel === "off" ? "" : e.thinkingLevel;
      } else if (head.includes('"type":"message"') && head.includes('"role":"assistant"')) {
        reply(line, info);
      } else if (!info.first && known[file] == null && line.includes('"role":"user"') && head.includes('"type":"message"')) {
        try {
          const e = JSON.parse(line);
          if (e.message?.role === "user") info.first = firstText(e.message);
        } catch {}
      }
    }
  } finally {
    closeSync(fd);
  }
  return info;
}

for (const { cwd, limit } of req.dirs ?? []) {
  const dir = join(req.root, dirOf(cwd));
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const file = join(dir, f);
        try {
          return { file, mtime: statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {}
  const shown = files.slice(0, limit);
  out.dirs[cwd] = { total: files.length, files: shown };
  for (const { file } of shown) {
    if (out.read[file]) continue;
    try {
      out.read[file] = read(file, known[file] ?? 0);
    } catch {}
  }
}

process.stdout.write(JSON.stringify(out));
