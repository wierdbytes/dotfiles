// A space's pi sessions (its card header's history button), from the desktop's
// wierd-agents: the panel turns into them, drawn bottom up as the list is, the newest
// lowest, over a bar with Back; older pages come in at the top. A session a pi has open
// shows that agent's status and goes to it; one nobody has open starts
// `pi --session <id>` in a peek over the window (Keep: a tab of its space; closing: that
// pi ends).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, exec, hc, home, appHome, notify, openOverlay, run } from "herdr";
import { M, px, mono, icon } from "./look.js";
import { agentMeta, shortModel, providerOf, effortColor, maxGradient } from "./meta.js";
import { kidStatus } from "./model.js";
import { rowChrome, agePill, contextRing, statusDot } from "./rows.js";

// Sessions at first, and how many more each step brings; how often the shown ones are
// read again; a session just opened gets no second pi while its labels are on the way.
const PAGE = 10, POLL_MS = 10000, LAUNCH_GRACE_MS = 15000;

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const idOfFile = (file) => file.split("/").pop().replace(/\.jsonl$/, "").split("_").pop();

// A model id as people say it: claude-opus-5-5 -> Opus 5.5.
function modelName(id, mark) {
  const short = shortModel(id, mark);
  if (/\s/.test(short) || !short.includes("-")) return short;
  const words = [];
  for (const w of short.split("-")) {
    if (/^\d+$/.test(w) && /^\d+(\.\d+)*$/.test(words.at(-1) ?? "")) words[words.length - 1] += `.${w}`;
    else words.push(w);
  }
  return words.map((w) => (w === "gpt" ? "GPT" : w[0].toUpperCase() + w.slice(1))).join(" ");
}

export class Sessions {
  constructor(place) {
    // place(space) -> the folder of a space on this computer, else null.
    this.place = place;
    this.info = {};
    this.dirs = {};
    this.limit = {};
    this.launching = {};
    this.windows = JSON.parse(localStorage.getItem("windows") ?? "null");
    this.caches = JSON.parse(localStorage.getItem("caches") ?? "{}");
    this.space = null;
  }

  tick(cx) {
    if (!this.space) return;
    if (this.short) this.more(cx);
    if (this.want !== this.have || Date.now() - (this.at ?? 0) > POLL_MS) this.refresh(cx);
  }

  // Remembers each session's cache while a pi has it open: once that pi ends nothing
  // refreshes it, so the list still knows how long it lives.
  remember(all, now) {
    let dirty = false;
    for (const term of all) {
      const id = term.labels?.["agent.session"];
      const meta = id && term.state === "live" ? agentMeta(term) : null;
      if (!meta) continue;
      const warm = meta.cacheUntil > now && meta.cacheTtl > 0;
      const had = this.caches[id];
      if (warm ? had?.until === meta.cacheUntil && had?.ttl === meta.cacheTtl : !had) continue;
      if (warm) this.caches[id] = { until: meta.cacheUntil, ttl: meta.cacheTtl };
      else delete this.caches[id];
      dirty = true;
    }
    if (!dirty) return;
    for (const [id, c] of Object.entries(this.caches)) if (!(c?.until > now)) delete this.caches[id];
    localStorage.setItem("caches", JSON.stringify(this.caches));
  }

  show(space, cx) {
    this.space = space.id;
    delete this.limit[space.id];
    this.short = false;
    this.wanted(space);
    this.refresh(cx);
    cx.notify();
  }

  hide() {
    this.space = null;
    this.short = false;
  }

  wanted(space) {
    const cwd = this.place(space);
    const limit = this.limit[space.id] ?? PAGE;
    this.req = cwd ? [{ cwd, limit }] : [];
    this.want = JSON.stringify(this.req);
    return cwd ? { cwd, limit } : null;
  }

  // Reads the folder (sessions.mjs, only what pi appended since last time).
  refresh(cx) {
    if (this.busy || !this.req?.length) return;
    const want = this.want;
    this.busy = true;
    if (!this.windowsAsked) {
      this.windowsAsked = true;
      cx.spawn(async (cx) => {
        try {
          if (!this.shell) this.shell = (await exec("/bin/sh", ["-c", 'printf %s "$SHELL"'])).stdout.trim() || "/bin/zsh";
          const r = await exec(this.shell, ["-lic", "pi --list-models"]);
          const unit = { K: 1e3, M: 1e6 };
          const windows = {};
          for (const line of r.stdout.split("\n")) {
            const m = line.match(/^(\S+)\s+(\S+)\s+([\d.]+)([KM]?)\s/);
            if (m) windows[`${m[1]}/${m[2]}`] = Math.round(Number(m[3]) * (unit[m[4]] ?? 1));
          }
          if (Object.keys(windows).length) {
            this.windows = windows;
            localStorage.setItem("windows", JSON.stringify(windows));
            cx.notify();
          }
        } catch {}
      });
    }
    this.at = Date.now();
    const known = Object.fromEntries(Object.entries(this.info).map(([f, i]) => [f, i.end ?? 0]));
    const req = { root: `${home()}/.pi/agent/sessions`, dirs: this.req, known };
    cx.spawn(async (cx) => {
      try {
        const r = await exec("node", [`${appHome()}/mods/wierdr-sidebar/sessions.mjs`, JSON.stringify(req)]);
        const out = JSON.parse(r.stdout);
        for (const [file, info] of Object.entries(out.read ?? {})) this.info[file] = { ...this.info[file], ...info };
        Object.assign(this.dirs, out.dirs ?? {});
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.have = want;
        this.busy = false;
      }
      cx.notify();
    });
  }

  // At the list's far end (or it doesn't fill the panel): the next page.
  more(cx) {
    const s = this.shown;
    if (!s || this.busy || this.have !== this.want || s.shown >= s.total) return;
    this.limit[s.space] = s.limit + PAGE;
    cx.notify();
  }

  count(space) {
    const cwd = this.place(space);
    return cwd ? this.dirs[cwd]?.total ?? null : null;
  }

  openPeek(terminal, space, title) {
    openOverlay({
      kind: "dialog",
      width: 0.82,
      height: 0.82,
      layout: {
        type: "column",
        children: [
          { id: "peek-bar", type: "block", size: { px: 38 }, content: { mod: "wierdr-sidebar", props: { peekBar: true, terminal, space, title } } },
          { id: "peek-term", type: "block", content: { terminal } },
        ],
      },
    });
  }

  // A new pi on the session, in a terminal of no tab (yet), through the login shell.
  open(cx, { id, space, folder, title }) {
    this.launching[id] = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (!this.shell) this.shell = (await exec("/bin/sh", ["-c", 'printf %s "$SHELL"'])).stdout.trim() || "/bin/zsh";
        const r = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--cwd", folder, "--", this.shell, "-lic", 'exec "$@"', this.shell, "pi", "--session", id]);
        const addr = JSON.parse(r.stdout).address;
        if (!addr) throw new Error(r.stderr || r.stdout);
        this.openPeek(addr, space, title);
      } catch (e) {
        delete this.launching[id];
        notify({ title: "Couldn't open the session", body: String(e?.message ?? e).slice(0, 300), level: "error" });
      }
      cx.notify();
    });
  }

  // The space's sessions, top to bottom as drawn: a note or the next page's row on top,
  // then the oldest shown down to the newest. [{ el, h }]
  items(R, space) {
    const { t, now, byAddr } = R;
    const gid = `ss-${space.id}`;
    const want = this.wanted(space);
    this.shown = null;
    const note = (key, text) => [{
      h: M.noteH,
      el: h_flex().id(`${gid}-${key}`).h(M.noteH).px(M.inset).items_center().text_size(px(14)).text_color(t.dim).child(text),
    }];
    if (!want) return note("nowhere", "This space has no folder on this computer.");
    const { cwd, limit } = want;

    // Which pi has which session open (pi-herdr's agent.session label), or for a pi that
    // didn't say, its folder and name.
    const byAgent = new Map(agents().map((a) => [a.address, a]));
    const open = new Map(), unsaid = new Map();
    for (const term of byAddr.values()) {
      if (term.state !== "live" || !agentMeta(term)) continue;
      const id = term.labels?.["agent.session"];
      if (id) open.set(id, term.address);
      else {
        const name = clean(term.report?.msg), where = term.foreground?.cwd ?? term.cwd;
        if (name && where) unsaid.set(`${where}\n${name}`, term.address);
      }
    }
    const taken = new Set(open.values());
    const ps = panes();
    const dir = this.dirs[cwd];
    if (!dir) return note("wait", this.error ? `Can't read sessions: ${this.error}` : "Reading sessions…");
    if (dir.total === 0) return note("none", "No pi sessions in this folder.");
    const files = dir.files.slice(0, limit);
    this.shown = { space: space.id, limit, shown: files.length, total: dir.total };
    const rows = files.map(({ file, mtime }, i) => {
      const info = this.info[file] ?? {};
      const id = info.id ?? idOfFile(file);
      let addr = open.get(id);
      if (!addr && info.name && info.cwd) {
        const guess = unsaid.get(`${info.cwd}\n${info.name}`);
        if (guess && !taken.has(guess)) addr = guess;
      }
      if (addr) { taken.add(addr); delete this.launching[id]; }
      const term = addr ? byAddr.get(addr) : null;
      const agent = addr ? byAgent.get(addr) : null;
      const status = agent?.status ?? (term?.status ? kidStatus(term, new Map()) : null);
      const pane = agent?.pane ?? (addr ? ps.find((p) => p.terminal === addr)?.pane : null);
      const starting = !addr && now - (this.launching[id] ?? 0) < LAUNCH_GRACE_MS;
      const meta = addr ? agentMeta(term) : null;
      const mark = providerOf({ provider: meta?.provider ?? info.provider });
      const model = meta?.model ? shortModel(meta.model, mark) : info.model ? modelName(info.model, mark) : "";
      const level = meta ? meta.effort : info.effort;
      const ctx = meta?.ctx > 0 ? meta.ctx : !meta && info.ctx > 0 ? info.ctx : null;
      const ctxMax = meta?.ctxMax ?? this.windows?.[`${info.provider}/${info.model}`] ?? null;
      const title = info.name || info.first || "Untitled session";
      const effortEl = !level ? null : level === "max"
        ? h_flex().flex_none().children(maxGradient(`@${level}`).map(([g, c]) => div().when(Boolean(c), (el) => el.text_color(c)).child(g)))
        : div().flex_none().text_color(effortColor(level, t, R.dark)).child(`@${level}`);
      const ring = contextRing(R, { ctx, ctxMax });
      const content = v_flex()
        .size_full()
        .pt(px(6))
        .px(M.inset)
        .child(h_flex().h(px(22)).gap(px(10)).items_center()
          .when(Boolean(status) || starting, (el) => el.child(starting
            ? icon("spinner", px(12), t.dim).spin(900)
            : statusDot(R, status, px(7))))
          .child(div().flex_1().min_w(0).truncate().text_size(px(16)).font_semibold().text_color(addr ? t.foreground : t.muted).child(title))
          .child(agePill(R, mtime, null)))
        .child(h_flex().h(px(22)).gap(px(8)).items_center().font_family(mono()).text_size(px(13))
          .when(Boolean(ring), (el) => el.child(ring))
          .child(h_flex().min_w(0).flex_shrink(1).gap(px(5)).items_center()
            .child(div().min_w(0).truncate().text_color(addr ? t.muted : t.dim).child(model))
            .when(Boolean(effortEl), (el) => el.child(effortEl))));
      return {
        h: M.agentH,
        el: rowChrome(R, {
          id: `${gid}-${id}`,
          h: M.agentH,
          selected: Boolean(agent?.focused),
          sep: i > 0 ? M.inset : null,
          tip: info.name && info.first ? info.first : title,
          click: (cx) => {
            if (pane) run("pane.focus", { pane });
            else if (addr) this.openPeek(addr, space.id, title);
            else if (!starting) this.open(cx, { id, space: space.id, folder: info.cwd || cwd, title });
            cx.notify();
          },
          child: content,
        }),
      };
    });
    const out = rows.reverse();
    if (files.length < dir.total) {
      const left = dir.total - files.length;
      const loading = this.busy || this.have !== this.want;
      out.unshift({
        h: M.noteH,
        el: h_flex().id(`${gid}-more`).h(M.noteH).px(M.inset).gap(px(8)).items_center().text_size(px(13)).text_color(t.dim)
          .when(loading, (el) => el.child(icon("spinner", px(12), t.dim).spin(900)).child(`Loading… · ${left} more`))
          .when(!loading, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => this.more(cx))
            .child(icon("chevron-up", px(12), t.dim))
            .child(`${Math.min(PAGE, left)} more · ${left} left`)),
      });
    }
    return out;
  }
}

