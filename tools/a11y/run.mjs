#!/usr/bin/env node
// The accessibility suite: builds the game, serves the build, checks every screen, every level
// and every figure in headless Chromium, checks the design tokens, and compares the findings
// with a11y-baseline.json. Exits 1 when a finding is not in the baseline. See docs/ACCESSIBILITY.md.
//
//   npm run a11y                              everything (about ten minutes)
//   npm run a11y -- --only tokens             one or more of: screens, levels, figures, tokens
//   npm run a11y -- --from 9                  levels from chapter 9 on
//   npm run a11y -- --level out-blink,adc-soc only these levels
//   npm run a11y -- --quick                   the pull-request subset (see docs/ACCESSIBILITY.md)
//   npm run a11y -- --resume                  continue a run that was interrupted (same --out)
//   npm run a11y -- --update-baseline         after a fix: lower the counts in a11y-baseline.json
//   npm run a11y -- --accept-new              deliberately accept the warnings that are new (give each a reason)
// Other options: --out <dir> (default a11y-out), --workers <n>, --no-build (serve the build already
// in <out>/dist), --report-only (always exit 0), CHROME=<path to Chromium>.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, compare, finding, loadBaseline, merge, reasonFor, saveBaseline, summaryMarkdown, toSarif, updatedBaseline, writeFindings } from "./findings.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const KINDS = ["screens", "levels", "figures", "tokens"];
const only = opt("only", KINDS.join(",")).split(",").map((x) => x.trim());
for (const k of only) if (!KINDS.includes(k)) throw new Error(`--only takes ${KINDS.join(", ")} (got "${k}")`);
const outDir = resolve(REPO, opt("out", "a11y-out"));
const from = Number(opt("from", "-99"));
const levelFilter = opt("level", "")?.split(",").filter(Boolean) ?? [];
const quick = flag("quick");
const resume = flag("resume");
const workers = Math.max(1, Number(opt("workers", String(Math.min(16, Math.max(2, Math.floor(availableParallelism() / 2)))))));
const partsDir = join(outDir, "parts");
const started = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - started) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, " ")}:${String(s % 60).padStart(2, "0")}`;
};
const log = (msg) => console.log(`[${clock()}] ${msg}`);

mkdirSync(outDir, { recursive: true });
if (!resume) rmSync(partsDir, { recursive: true, force: true });
mkdirSync(partsDir, { recursive: true });

let findings = [];
const counts = { screens: 0, levels: 0, states: 0, live: 0, figures: 0 };
const myWheres = new Set(["tokens", "map", "handbook", "settings", "warm-up"]);
const levelIds = new Set();

if (only.includes("tokens")) {
  const { tokenFindings } = await import("./tokens.mjs");
  findings.push(...tokenFindings());
  log("tokens checked");
}

const needBrowser = only.some((k) => k !== "tokens");
if (needBrowser) {
  const { axeSource, launch, loadLevels, serveGame } = await import("./game.mjs");
  const { Collector, PROFILES, Session, levelJob, levelTextFindings, liveJob, screenJobs, titleFindings } = await import("./screens.mjs");
  const { chapters, starters } = await loadLevels();
  const allLevels = chapters.flatMap((c) => c.levels.map((l) => ({ ...l, chapter: c.number })));
  for (const l of allLevels) levelIds.add(l.id);
  const chosen = allLevels.filter((l) => l.chapter >= from && (!levelFilter.length || levelFilter.includes(l.id)));
  // A fixed sample for the combinations that are too many to run on every level: every tenth
  // level in the game's order, and the first level of each kind.
  const sampleIds = new Set(allLevels.filter((_, i) => i % 10 === 0).map((l) => l.id));
  for (const kind of new Set(allLevels.map((l) => l.kind))) sampleIds.add(allLevels.find((l) => l.kind === kind).id);

  log(`building the game${flag("no-build") ? " (skipped: --no-build)" : ""}`);
  const game = await serveGame({ outDir: join(outDir, "dist"), reuse: flag("no-build") });
  const browser = await launch();
  const axe = axeSource();
  log(`axe-core ${axe.version} (sha256 ${axe.sha256.slice(0, 12)}), ${workers} workers, ${chosen.length} of ${allLevels.length} levels, serving ${game.baseUrl}`);
  const titles = new Map();
  const viewsOf = new Map();

  const runJobs = async (jobs, label) => {
    let next = 0;
    let done = 0;
    const total = jobs.length;
    const worker = async () => {
      const sessions = new Map();
      for (;;) {
        const job = jobs[next++];
        if (!job) break;
        const file = join(partsDir, `${job.id.replace(/[^\w@+.-]+/g, "_")}.json`);
        let part = resume && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
        if (!part) {
          const collector = new Collector();
          let views = [];
          try {
            let s = sessions.get(job.profile);
            if (!s) {
              s = new Session({ browser, baseUrl: game.baseUrl, axe, collector, profile: PROFILES[job.profile], log });
              await s.init();
              sessions.set(job.profile, s);
            }
            s.collector = collector;
            views = (await job.run(s)) ?? [];
          } catch (e) {
            const msg = String(e?.message ?? e).split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ").slice(0, 300);
            collector.add({ where: job.where ?? job.id, rule: "suite/not-checked", scheme: "any", profile: PROFILES[job.profile].id, detail: `the check stopped: ${msg}`, pageState: job.id });
            log(`  ${job.id}: stopped: ${msg}`);
            // The window may be in any state: start a new one for the next job.
            await sessions.get(job.profile)?.close().catch(() => {});
            sessions.delete(job.profile);
          }
          part = { id: job.id, findings: collector.findings(), titles: [...collector.titles], states: collector.states, views };
          writeFileSync(file, JSON.stringify(part));
        }
        findings.push(...part.findings);
        for (const [w, t] of part.titles) titles.set(w, t);
        counts.states += part.states;
        if (job.level) viewsOf.set(job.level, [...new Set([...(viewsOf.get(job.level) ?? []), ...part.views])]);
        done++;
        if (done % 25 === 0 || done === total) log(`${label}: ${done}/${total} (${merge(findings).length} findings so far)`);
      }
      for (const s of sessions.values()) await s.close().catch(() => {});
    };
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));
  };

  // The figures are checked by figures.mjs, written beside this file. With cores to spare it
  // runs beside the screens and levels; on a small machine (a 4-core CI runner) it would take
  // the cores the screen workers need and both would crawl, so it runs after them, on as many
  // pages at once as figures.mjs chooses for the machine (two a core).
  const cores = availableParallelism();
  const figuresBeside = cores >= 12 && cores >= workers + 4;
  const figuresFile = join(REPO, "tools/a11y/figures.mjs");
  const startFigures = async () => {
    const { checkFigures } = await import(pathToFileURL(figuresFile).href);
    // A sweep that stops answering is a finding, not a run that never ends. figures.mjs gives
    // every page its own time limit; this catches a sweep in which nothing finishes any more.
    let last = Date.now();
    let stop;
    const stalled = new Promise((_, reject) => {
      stop = setInterval(() => {
        if (Date.now() - last > 15 * 60_000) reject(new Error("no page finished for 15 minutes"));
      }, 30_000);
      stop.unref();
    });
    const run = checkFigures({
      baseUrl: game.baseUrl,
      browser,
      quick,
      jobs: figuresBeside ? Math.min(16, Math.max(2, Math.floor(cores / 2))) : undefined,
      onProgress: (line) => {
        last = Date.now();
        log(`  ${line}`);
      },
      onDone: () => (last = Date.now()),
    });
    return Promise.race([run, stalled])
      .then(
        (list) => list,
        (e) => [finding({ where: "figures", rule: "suite/not-checked", state: "any", detail: `figures.mjs stopped: ${String(e?.message ?? e).split("\n")[0].slice(0, 240)}` })],
      )
      .finally(() => clearInterval(stop));
  };
  let figuresRun = null;
  const wantFigures = only.includes("figures") && existsSync(figuresFile);
  if (only.includes("figures") && !wantFigures) log("tools/a11y/figures.mjs is not there: figures are not checked");
  if (wantFigures && figuresBeside) {
    log(`figures: started beside the screens (${cores} cores)`);
    figuresRun = startFigures();
  }

  const jobs = [];
  if (only.includes("screens") && !levelFilter.length) {
    const sj = screenJobs({ chapters, starters, quick });
    for (const j of sj) {
      const w = j.id.split("@")[0];
      j.where = w.startsWith("sandbox-") ? "sandbox" : w;
    }
    jobs.push(...sj);
    counts.screens = new Set(sj.map((j) => j.id.split("@")[0])).size;
    for (const kit of ["robot", "redboard", "launchpad"]) for (const p of ["blink", ...starters.filter((x) => x.kit === kit).map((x) => x.id)]) myWheres.add(`sandbox:${kit}:${p}`);
  }
  if (only.includes("levels")) {
    findings.push(...levelTextFindings(chapters.filter((c) => c.number >= from)));
    for (const l of chosen) {
      const sample = sampleIds.has(l.id);
      const job = (profile, o) => jobs.push({ id: `${l.id}@${profile}`, where: l.id, level: l.id, profile, run: (s) => levelJob(s, l, o) });
      if (quick) {
        // Pull requests: every level as first opened at 1440 px; the sample in full at both widths.
        job("wide", { depth: sample ? "full" : "open", sample });
        if (sample) job("narrow", { depth: "full", sample });
      } else {
        job("wide", { depth: "full", sample });
        job("narrow", { depth: "full", sample });
        if (sample) for (const p of ["half", "wideXl", "narrowXl"]) job(p, { depth: "full", sample });
      }
    }
    counts.levels = chosen.length;
  }
  // Longest first, so the workers finish together: code levels and screens take the most time.
  await runJobs(jobs, "screens and levels");

  if (only.includes("levels")) {
    // Live runs: the first level (in the game's order) that shows each bench view, then every
    // twelfth code level, at least 25 in all.
    const code = chosen.filter((l) => l.kind === "code" && l.mode !== "debug");
    const live = new Set();
    const seen = new Set();
    for (const l of code) for (const v of viewsOf.get(l.id) ?? []) if (!seen.has(v)) (seen.add(v), live.add(l.id));
    for (let i = 0; i < code.length; i += 12) live.add(code[i].id);
    for (let i = 5; live.size < Math.min(25, code.length) && i < code.length; i += 7) live.add(code[i].id);
    const liveJobs = [];
    for (const l of code.filter((x) => live.has(x.id))) for (const profile of quick ? ["wide"] : ["wide", "narrow"]) liveJobs.push({ id: `live-${l.id}@${profile}`, where: l.id, profile, run: (s) => liveJob(s, l) });
    counts.live = live.size;
    log(`live runs: ${live.size} levels covering ${seen.size} bench views (${[...seen].map((v) => v.replace("view-", "")).join(", ")})`);
    await runJobs(liveJobs, "live runs");
  }
  findings.push(...titleFindings(titles));
  if (wantFigures) {
    if (figuresRun) log("waiting for the figures");
    else log(`figures: started after the screens (${cores} cores)`);
    const list = await (figuresRun ?? startFigures());
    counts.figures = new Set(list.map((f) => f.where)).size;
    findings.push(...list);
    log(`figures checked: ${list.length} findings`);
  }
  await browser.close();
  await game.close();
}

// ---- report ----
findings = merge(findings);
const baseline = loadBaseline();
const mine = (key) => {
  const where = key.split("|")[0];
  return myWheres.has(where) || levelIds.has(where) || /^(chrome|panel|component):/.test(where) || where.startsWith("sandbox:") || where.startsWith("handbook:");
};
const partial = quick || from > -99 || levelFilter.length > 0;
const scope = (key) => {
  if (partial) return false;
  const [where, rule] = key.split("|");
  if (rule.startsWith("tokens/")) return only.includes("tokens");
  if (!needBrowser) return false;
  if (!mine(key)) return only.includes("figures");
  if (/^(chrome|panel|component):/.test(where)) return only.includes("screens") && only.includes("levels");
  return levelIds.has(where) ? only.includes("levels") : only.includes("screens");
};
const { regressions, improved } = compare(findings, baseline, scope);

writeFindings(findings, join(outDir, "findings.json"));
writeFileSync(join(outDir, "findings.sarif"), JSON.stringify(toSarif(findings, baseline), null, 1) + "\n");
const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
const scanned = `Scanned: ${counts.screens} screens, ${counts.levels} levels (${counts.live} with a live run), ${counts.states} page states, ${counts.figures} figures with findings, in ${clock().trim()} min.`;
const summary = summaryMarkdown(findings, regressions, improved) + `\n${scanned}\n`;
writeFileSync(join(outDir, "summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

console.log("");
const byRule = new Map();
for (const f of findings) {
  const r = byRule.get(f.rule) ?? { e: 0, w: 0, places: 0 };
  r[f.severity === "error" ? "e" : "w"] += f.count;
  r.places++;
  byRule.set(f.rule, r);
}
for (const [rule, r] of [...byRule].sort()) console.log(`  ${rule.padEnd(38)} ${String(r.e).padStart(6)} errors ${String(r.w).padStart(7)} warnings in ${r.places} places`);
console.log(`\n${scanned}`);
console.log(`${errors.length} error findings, ${warnings.length} warning findings; ${regressions.length} not in the baseline; ${improved.length} baseline entries improved.`);
console.log(`Written: ${join(outDir, "findings.json")}, findings.sarif, summary.md`);

if (flag("update-baseline") || flag("accept-new")) {
  if (partial) {
    console.error("A partial run (--quick, --from, --level) cannot update the baseline: run the whole suite.");
    process.exit(2);
  }
  const next = updatedBaseline(findings, baseline, { scope, acceptNew: flag("accept-new") });
  saveBaseline(next);
  console.log(`a11y-baseline.json updated: ${Object.keys(next.accepted).length} accepted entries.`);
  if (errors.length) console.log(`${errors.length} error findings are not accepted and still fail the run: fix them.`);
  const noReason = Object.keys(next.accepted).filter((k) => !reasonFor(next, k));
  if (noReason.length) console.log(`${noReason.length} accepted entries have no reason yet: add one under "reasons" (a full key or a rule name).`);
  process.exit(0);
}
if (regressions.length) {
  console.error(`\nNot in a11y-baseline.json (${regressions.length}):`);
  for (const f of regressions.slice(0, 60)) console.error(`  ${f.severity.padEnd(7)} ${f.key} x${f.count}${baseline.accepted[f.key] ? ` (baseline ${baseline.accepted[f.key]})` : ""}\n          ${f.detail.slice(0, 400)}`);
  if (regressions.length > 60) console.error(`  ... and ${regressions.length - 60} more in ${join(outDir, "findings.json")}`);
  console.error("\nFix them. Counts in a11y-baseline.json may only go down.");
  process.exit(flag("report-only") ? 0 : 1);
}
if (improved.length) console.log(`${improved.length} baseline entries improved: run \`npm run a11y -- --update-baseline\` and commit a11y-baseline.json.`);
console.log("Accessibility: nothing new.");
