#!/usr/bin/env node
// Accessibility checks for every interactive figure and every bench view.
//
//   node tools/a11y/figures.mjs [--only <id>[,<id>...]] [--cond <name>] [--quick] [--json out.json]
//                               [--base <url>] [--jobs N] [--no-views] [--no-figures] [--list]
// --quick is the pull-request subset: every figure at 380px, 700px and 700px-dark, every view
// in the 1440 px window (see QUICK_CONDITIONS and figures-views.mjs). --jobs defaults to two
// pages a core, at most 16.
//
// On its own it builds the game, serves the build and prints what it finds; the suite
// (tools/a11y/run.mjs) calls checkFigures({ baseUrl, browser }) instead.
//
// Every figure is opened alone (<base>?figure=<id>) in these conditions:
//   320px, 380px (a 412 px page), 700px          the column widths a figure lives in
//   larger-1440, larger-390                      the Larger view, on a wide and a narrow window
//   each of those with Text size Normal and Extra large (-xl; the root font size, as the
//   Settings screen sets it)
//   700px-dark                                   the dark theme (colours; layout is the same)
//   motion                                       without reduced motion: what moves, and when
// and walked through its states: as opened, every slider at its minimum and maximum, every
// option of every menu, every tick box and toggle, every button three times, every focusable
// part of a drawing with the arrow keys, then a seeded random walk of 60 steps. After each
// step whose result is new, the page-side probe (figures-probe.mjs) looks at it.
//
// Rules (errors unless marked):
//   layout/text-overlap        two visible texts whose glyph boxes cross by more than 1 px
//   layout/text-cut            text past its drawing, a clipping box, its table cell or button
//   layout/line-through-text   a line or the edge of a shape through a label without a plate
//   layout/off-figure          a shape drawn outside its drawing
//   layout/height-jump         the figure gets shorter on a control that is not a mode switch (what
//                              is below it jumps up)
//   layout/height-grows        (warning) it gets taller on such a control: a longer sentence the first
//                              time it appears; the wrapper keeps the height from then on
//   size/drawing-text          a label under 11 px at 700 px and in the Larger view
//   size/drawing-text-narrow   (warning) the smallest label at 320 and 380 px; the count is the
//                              shortfall in tenths of a pixel, so the baseline keeps it from shrinking
//   size/html-text             HTML text under 11 px, anywhere
//   contrast/text              4.5:1 (3:1 for large text), on the colour really behind the text
//   contrast/text-aaa          (warning) under 7:1
//   contrast/graphic           3:1 for lines, markers and state fills that are not decoration.
//                              Decoration is declared: aria-hidden="true" (or data-decor) on the
//                              element or its group, or a class named ...grid, ...guide, ...glow, ...ghost
//   contrast/control           3:1 for the boundary of a control
//   colour-only/series         two lines of one dash pattern in a drawing that differ only by colour
//                              (under 3:1 apart in lightness) and are not both labelled where they run
//   colour-only/state          a mark (a shape of a drawing, or an HTML cell) that over the walk changes
//                              its colour and nothing else: not its outline, dash, weight or a label on
//                              or beside it, and the two colours are under 3:1 apart
//   cvd/confusable-marks       either of those when the two colours also fall together with
//                              protanopia, deuteranopia or tritanopia (Machado et al. 2009)
//   cvd/confusable-colours     (warning) any two colours of a drawing that do
//   reflow/page-scrolls, reflow/scroll-box-unreachable, reflow/scroll-box-unnamed   at 320 px
//   target/too-small           a control under 24 by 24 px without the spacing of WCAG 2.5.8
//   target/under-44            (warning)
//   keyboard/unreachable, keyboard/inoperable, keyboard/pointer-only
//   focus/invisible, focus/contrast
//   name/missing, name/unclear, name/duplicate, name/slider-value
//   picture/no-name, picture/generic-name, picture/no-role, picture/img-with-controls,
//   picture/static-name, picture/hidden
//   status/missing, status/assertive, status/flood
//   larger/*                   the Larger view: opens and closes by keyboard, is a named dialog,
//                              keeps the focus inside while open and gives it back
//   motion/on-open, motion/reduced, motion/no-stop, motion/stop-fails
//   axe/<rule>                 axe-core on the figure: WCAG A and AA rules are errors, best
//                              practices warnings
//
// The bench views are checked by figures-views.mjs with the same probe.

import { rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { finding, merge, REPO } from "./findings.mjs";
import { probe } from "./figures-probe.mjs";
import { checkViews } from "./figures-views.mjs";
import { addSentinels, fontsReady, keyboardWalk, pool, runAxe, toFindings } from "./figures-walks.mjs";

const ROOT = ".fig-fit";

const XL = 1.3; // Text size "Extra large" in Settings

/** The conditions a figure is opened in. `cond` is the state part of a finding's key. */
export const CONDITIONS = [
  { cond: "320px", vw: 320, layout: true, targets: true, reflow: true },
  { cond: "320px-xl", vw: 320, text: XL, layout: true, reflow: true },
  { cond: "380px", vw: 412, layout: true, targets: true },
  { cond: "380px-xl", vw: 412, text: XL, layout: true },
  { cond: "700px", vw: 700, layout: true, targets: true, names: true, colour: true, keyboard: true, axe: true, flood: true, minSvgPx: 11 },
  { cond: "700px-xl", vw: 700, text: XL, layout: true, minSvgPx: 11 },
  { cond: "700px-dark", vw: 700, dark: true, colour: true, keyboard: true, axe: true },
  { cond: "larger-1440", vw: 1440, big: true, layout: true, dialog: true, minSvgPx: 11 },
  { cond: "larger-1440-xl", vw: 1440, big: true, text: XL, layout: true, minSvgPx: 11 },
  { cond: "larger-390", vw: 390, vh: 800, big: true, layout: true, targets: true, dialog: true, minSvgPx: 11 },
  { cond: "larger-390-xl", vw: 390, vh: 800, big: true, text: XL, layout: true, minSvgPx: 11 },
  { cond: "motion", vw: 700, motion: true },
];

/**
 * The pull-request subset (--quick): every figure in the three conditions that find the most.
 * 380px is the reading pane of a code level, where labels collide first; 700px carries every
 * check that does not depend on the width (names, keyboard, pictures, colours in light, axe);
 * 700px-dark the colours of the dark theme (every control at its ends and every option, without
 * the keyboard walk and the random walk, which are done in light). Left to the whole sweep:
 * 320 px, Extra large text, the Larger view, the motion pass, and the focus ring in dark.
 */
export const QUICK_CONDITIONS = ["380px", "700px", "700px-dark"];

/** A page that has not finished after this long is reported (suite/not-checked) and left. */
const PAGE_LIMIT_MS = 4 * 60_000;

/**
 * How many pages at once. A figure page waits on timers much of the time (the walk lets the page
 * settle after every step), so two pages a core is faster than one: measured on 4 cores, the
 * subset takes 3.1 min with 4 pages at a time and 2.5 min with 8. Capped at 16.
 */
export function defaultJobs() {
  return Math.max(2, Math.min(16, 2 * availableParallelism()));
}

/** Ids of the figures: every file in src/ui/figures that registers one. */
export function figureIds() {
  const dir = join(REPO, "src/ui/figures");
  const ids = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsx") || f === "index.tsx") continue;
    const m = /export const figure\b[^=]*=\s*\{[^}]*?\bid:\s*"([^"]+)"/s.exec(readFileSync(join(dir, f), "utf8"));
    if (m) ids.push(m[1]);
  }
  return ids.sort();
}

/** e. The Larger view by keyboard. Leaves it open. */
async function dialogWalk(page, items) {
  const push = (rule, detail) => items.push({ rule, sig: "", detail, severity: "error", state: "the Larger view" });
  const zoom = page.locator(`${ROOT} > .fig-zoom`);
  if (!(await zoom.count())) {
    push("larger/missing", "the figure has no Larger button");
    return false;
  }
  await zoom.focus();
  await page.keyboard.press("Enter");
  const open = async () => (await page.locator(`${ROOT}.fig-big`).count()) > 0;
  await page.waitForTimeout(60);
  if (!(await open())) {
    push("larger/keyboard-open", "Enter on the Larger button does not open the larger view");
    await zoom.click();
    return open();
  }
  const d = await page.evaluate((sel) => {
    const el = document.querySelector(sel + ".fig-big");
    const dlg = el.closest('[role="dialog"], dialog') ?? el;
    return { role: dlg.getAttribute("role") ?? dlg.tagName.toLowerCase(), name: dlg.getAttribute("aria-label") ?? (dlg.getAttribute("aria-labelledby") ? document.getElementById(dlg.getAttribute("aria-labelledby"))?.textContent : "") ?? "", modal: dlg.getAttribute("aria-modal"), inside: dlg.contains(document.activeElement) };
  }, ROOT);
  if (d.role !== "dialog") push("larger/not-a-dialog", `the larger view is announced as "${d.role}", not as a dialog`);
  if (!d.name || d.name.trim().length < 4) push("larger/no-name", "the larger view's dialog has no name");
  if (!d.inside) push("larger/focus-not-inside", "after opening, the focus is not inside the larger view");
  // While it is open the focus stays inside (it is modal) and Escape always leaves.
  const n = await page.evaluate((sel) => window.__a11y.controlsOf(document.querySelector(sel)).length, ROOT);
  let escaped = "";
  for (let i = 0; i < Math.min(n, 40) + 3 && !escaped; i++) {
    await page.keyboard.press("Tab");
    escaped = await page.evaluate((sel) => {
      const a = document.activeElement;
      return a && a !== document.body && !document.querySelector(sel).contains(a) ? a.id || a.tagName : "";
    }, ROOT);
  }
  if (escaped) push("larger/focus-leaves", `Tab leaves the open larger view for the page behind it (${escaped})`);
  await page.keyboard.press("Shift+Tab");
  const back = await page.evaluate((sel) => {
    const a = document.activeElement;
    return a && a !== document.body && !document.querySelector(sel).contains(a) ? a.id || a.tagName : "";
  }, ROOT);
  if (back && !escaped) push("larger/focus-leaves", `Shift+Tab leaves the open larger view for the page behind it (${back})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(40);
  if (await open()) push("larger/escape", "Escape does not close the larger view");
  else if (!(await page.evaluate((sel) => document.activeElement === document.querySelector(sel + " > .fig-zoom"), ROOT))) push("larger/focus-not-returned", "after Escape the focus is not back on the Larger button");
  if (await open()) await zoom.click();
  // Open again and close with the button itself.
  await zoom.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(40);
  await zoom.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(40);
  if (await open()) {
    push("larger/keyboard-close", "Enter on \"Close larger view\" does not close it");
    await zoom.click();
  } else if (!(await page.evaluate((sel) => document.activeElement === document.querySelector(sel + " > .fig-zoom"), ROOT))) push("larger/focus-not-returned", "after closing with the button the focus is not on it");
  await zoom.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  return open();
}

/** g. Without reduced motion: nothing moves when the figure opens; what a button starts can be stopped or ends. */
async function motionWalk(page, items) {
  const push = (rule, sig, detail) => items.push({ rule, sig, detail, severity: "error", state: "without reduced motion" });
  const m0 = await page.evaluate((sel) => window.__a11y.moving(sel, 5, 120), ROOT);
  if (m0.changed || m0.anims) push("motion/on-open", "", `the figure moves as soon as it opens (${m0.changed ? "its content changes by itself" : `${m0.anims} running animation(s)`})`);
  const buttons = await page.evaluate((sel) => {
    const A = window.__a11y;
    return A.controlsOf(document.querySelector(sel), { skip: ".fig-zoom" })
      .map((el, i) => ({ i, name: A.accName(el), button: el.tagName === "BUTTON" }))
      .filter((b) => b.button && !/^cop(y|ied)/i.test(b.name));
  }, ROOT);
  const likely = (b) => /\b(play|run|animate|start|go|auto|spin|sweep|drive|send|watch|replay)\b/i.test(b.name);
  const order = [...buttons.filter(likely), ...buttons.filter((b) => !likely(b))].slice(0, 14);
  const stopName = /\b(stop|pause|halt|freeze|hold)\b/i;
  for (const b of order) {
    const pressed = await page.evaluate(
      ([sel, i]) => {
        const el = window.__a11y.controlsOf(document.querySelector(sel), { skip: ".fig-zoom" })[i];
        if (!el || el.tagName !== "BUTTON") return false;
        el.click();
        return true;
      },
      [ROOT, b.i],
    );
    if (!pressed) continue;
    const m = await page.evaluate((sel) => window.__a11y.moving(sel, 3, 90), ROOT);
    if (m.changed < 2 && !m.anims) continue;
    const stop = async () =>
      page.evaluate(
        ([sel, src]) => {
          const A = window.__a11y;
          const el = A.controlsOf(document.querySelector(sel), { skip: ".fig-zoom" }).find((e) => e.tagName === "BUTTON" && new RegExp(src, "i").test(A.accName(e)));
          if (!el) return "";
          el.click();
          return A.accName(el);
        },
        [ROOT, stopName.source],
      );
    const hasStop = await page.evaluate(([sel, src]) => window.__a11y.controlsOf(document.querySelector(sel), { skip: ".fig-zoom" }).some((e) => e.tagName === "BUTTON" && new RegExp(src, "i").test(window.__a11y.accName(e))), [ROOT, stopName.source]);
    if (hasStop) {
      const name = await stop();
      const after = await page.evaluate((sel) => window.__a11y.moving(sel, 4, 120), ROOT);
      if (after.changed > 1 || after.anims) push("motion/stop-fails", b.name.replace(/\d+/g, "#"), `"${b.name}" starts motion and "${name}" does not stop it`);
      continue;
    }
    // No way to stop it: it has to end by itself within five seconds (WCAG 2.2.2).
    await page.waitForTimeout(5000);
    const late = await page.evaluate((sel) => window.__a11y.moving(sel, 3, 120), ROOT);
    if (late.changed || late.anims) push("motion/no-stop", b.name.replace(/\d+/g, "#"), `"${b.name}" starts motion that still runs after 5 s and there is no Stop or Pause`);
  }
}

/** One figure in one condition. */
async function checkOne(browser, baseUrl, id, c, axe, limitMs = PAGE_LIMIT_MS, quick = false) {
  // The subset opens the dark theme for its colours only: the keyboard walk and the random walk are done in light.
  const brief = quick && !!c.dark;
  const where = `figure:${id}`;
  const ctx = await browser.newContext({ viewport: { width: c.vw, height: c.vh ?? 900 }, colorScheme: c.dark ? "dark" : "light", reducedMotion: c.motion ? "no-preference" : "reduce" });
  const items = [];
  let stats = { states: 0, looks: 0 };
  // A page that stalls (a figure that never settles, a browser that stops answering) is closed:
  // whatever was waiting on it then fails, and the sweep goes on with the next page.
  let late = false;
  const limit = setTimeout(() => {
    late = true;
    ctx.close().catch(() => {});
  }, limitMs);
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(probe);
    await page.goto(`${baseUrl}?figure=${encodeURIComponent(id)}`);
    await page.waitForSelector(".figure, .fig-missing");
    if (await page.locator(".fig-missing").count()) return { findings: [finding({ where, rule: "figure/missing", state: c.cond, detail: "the figure does not render" })], stats };
    if (c.text) await page.addStyleTag({ content: `html { font-size: ${16 * c.text}px; }` });
    await fontsReady(page);
    await page.waitForTimeout(120);
    await addSentinels(page, ROOT);
    if (c.motion) {
      await motionWalk(page, items);
    } else {
      if (c.big && c.dialog) {
        if (!(await dialogWalk(page, items))) return { findings: toFindings(where, c.cond, items), stats };
      } else if (c.big) {
        await page.locator(`${ROOT} > .fig-zoom`).click();
        await page.waitForSelector(`${ROOT}.fig-big`);
      }
      if (c.big) await page.waitForTimeout(80);
      if (c.keyboard && !brief) await keyboardWalk(page, items, "as opened", ROOT);
      if (c.axe) await runAxe(page, axe, items, "as opened", ROOT);
      if (c.flood) {
        const f = await page.evaluate((sel) => window.__a11y.flood(sel), ROOT);
        if (f && f.changes >= 6 && f.quiet < f.changes) items.push({ rule: "status/flood", sig: "", detail: `dragging a slider changed the announced sentence ${f.changes} times in a row; hold announcements back while it moves (aria-busy)`, severity: "error", state: "dragging the first slider" });
        if (f && f.stuck) items.push({ rule: "status/flood", sig: "stuck", detail: "the announced sentence stays aria-busy after the slider is released", severity: "error", state: "after dragging" });
      }
      const res = await page.evaluate(([sel, cfg]) => window.__a11y.explore({ root: sel, ...cfg }), [ROOT, { layout: !!c.layout, colour: !!c.colour, targets: !!c.targets, names: !!c.names, pointer: !!c.names, reflow: !!c.reflow, minSvgPx: c.minSvgPx ?? 0, height: !!c.layout, reduced: true, walk: brief ? 0 : 60, seed: 7 }]);
      items.push(...res.found);
      stats = res.stats;
      if (!c.minSvgPx && c.layout && res.stats.minSvgPx < 10.95) items.push({ rule: "size/drawing-text-narrow", sig: "", count: Math.round((11 - res.stats.minSvgPx) * 10), detail: `the smallest label in the drawing is ${res.stats.minSvgPx.toFixed(1)} px ("${res.stats.minSvgText.slice(0, 30)}")`, severity: "warning" });
      if (c.keyboard && !brief) {
        // Again with everything unfolded, in the state the walk ended in.
        await page.evaluate((sel) => document.querySelectorAll(`${sel} details:not([open])`).forEach((d) => (d.open = true)), ROOT);
        await keyboardWalk(page, items, "after the walk, all controls shown", ROOT);
      }
      if (c.axe) await runAxe(page, axe, items, "after the walk", ROOT);
    }
    for (const e of new Set(errors)) items.push({ rule: "figure/throws", sig: e.slice(0, 60), detail: `page error: ${e.slice(0, 160)}`, severity: "error" });
  } catch (e) {
    items.push({ rule: "suite/not-checked", sig: "", detail: late ? `no result after ${Math.round(limitMs / 1000)} s: the page was closed and the sweep went on` : `the check itself failed: ${String(e.message ?? e).split("\n")[0].slice(0, 200)}`, severity: "error" });
  } finally {
    clearTimeout(limit);
    await ctx.close().catch(() => {});
  }
  // The same thing found twice (before and after the walk) is one thing.
  const seen = new Set();
  const unique = items.filter((it) => {
    const k = it.rule + "|" + it.sig;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { findings: toFindings(where, c.cond, unique), stats };
}

/**
 * Checks every figure and every bench view.
 * @param {{ baseUrl: string, browser: import("playwright-core").Browser, only?: string[], conds?: string[],
 *           jobs?: number, views?: boolean, figures?: boolean, axe?: { source: string } | null,
 *           levels?: unknown, quick?: boolean, pageLimitMs?: number,
 *           onProgress?: (line: string) => void, onDone?: (what: string) => void }} opts
 * `quick` is the pull-request subset. `onProgress` gets a line now and then (and once a minute,
 * naming any page that is taking long); `onDone` is called each time a page or level run ends.
 * @returns {Promise<import("./findings.mjs").Finding[]>}
 */
export async function checkFigures({ baseUrl, browser, only, conds, quick = false, jobs, views = true, figures = true, axe, levels, onProgress, stats, pageLimitMs, onDone }) {
  if (axe === undefined) {
    try {
      axe = (await import("./game.mjs")).axeSource();
    } catch (e) {
      axe = null;
      onProgress?.(`axe-core is not available (${e.message}): the axe rules are not run`);
    }
  }
  const n = jobs ?? defaultJobs();
  const started = Date.now();
  const mins = () => `${((Date.now() - started) / 60000).toFixed(1)} min`;
  const out = [];
  const total = { states: 0, looks: 0, pages: 0 };
  if (figures) {
    const ids = figureIds().filter((id) => !only || only.includes(id));
    const wanted = conds ?? (quick ? QUICK_CONDITIONS : null);
    const tasks = ids.flatMap((id) => CONDITIONS.filter((c) => !wanted || wanted.includes(c.cond)).map((c) => ({ id, c })));
    onProgress?.(`figures: ${ids.length} figures in ${wanted ? wanted.join(", ") : `${CONDITIONS.length} conditions`}: ${tasks.length} pages, ${n} at a time`);
    let done = 0;
    // What is open now, so that a slow or stalled sweep names the page it is on.
    const open = new Map();
    const beat = setInterval(() => {
      const now = Date.now();
      const slow = [...open].filter(([, t]) => now - t > 45_000).map(([k, t]) => `${k} (${Math.round((now - t) / 1000)} s)`);
      onProgress?.(`figures: ${done} of ${tasks.length} pages after ${mins()}${slow.length ? `; still on ${slow.join(", ")}` : ""}`);
    }, 60_000);
    beat.unref?.();
    try {
      await pool(tasks, n, async ({ id, c }) => {
        const key = `${id} ${c.cond}`;
        open.set(key, Date.now());
        const r = await checkOne(browser, baseUrl, id, c, axe, pageLimitMs, quick);
        open.delete(key);
        onDone?.(key);
        out.push(...r.findings);
        if (r.findings.some((f) => f.rule === "suite/not-checked")) onProgress?.(`figures: ${key} was not checked: ${r.findings.find((f) => f.rule === "suite/not-checked").detail}`);
        total.states += r.stats.states ?? 0;
        total.looks += r.stats.looks ?? 0;
        total.pages++;
        if (++done % 100 === 0 || done === tasks.length) onProgress?.(`figures: ${done} of ${tasks.length} pages after ${mins()}`);
      });
    } finally {
      clearInterval(beat);
    }
    if (!axe) out.push(finding({ where: "figures", rule: "axe/not-run", severity: "error", detail: "axe-core is not installed: npm ci" }));
  }
  if (views && !conds) {
    const v = await checkViews({ baseUrl, browser, only, quick, jobs: Math.min(n, 10), axe, levels, onProgress, onDone });
    out.push(...v.findings);
    total.states += v.states;
    total.pages += v.pages;
  }
  if (stats) Object.assign(stats, total);
  return merge(out);
}

// ---------------------------------------------------------------- on its own
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--list")) {
    console.log(figureIds().join("\n"));
    process.exit(0);
  }
  const { launch, serveGame } = await import("./game.mjs");
  const t0 = Date.now();
  // Its own build folder, so two runs at once (two people, or two agents) do not share one.
  const outDir = join(tmpdir(), `bringup-a11y-figures-${process.pid}`);
  const server = opt("base") ? { baseUrl: opt("base"), close: async () => {} } : await serveGame({ outDir });
  const browser = await launch();
  const stats = {};
  let findings = [];
  try {
    findings = await checkFigures({
      baseUrl: server.baseUrl,
      browser,
      only: opt("only")?.split(","),
      conds: opt("cond")?.split(","),
      quick: args.includes("--quick"),
      jobs: opt("jobs") ? +opt("jobs") : undefined,
      views: !args.includes("--no-views"),
      figures: !args.includes("--no-figures"),
      onProgress: (l) => console.error(l),
      stats,
    });
  } finally {
    await browser.close();
    await server.close();
    if (!opt("base")) rmSync(outDir, { recursive: true, force: true });
  }
  if (opt("json")) writeFileSync(opt("json"), JSON.stringify(findings, null, 1) + "\n");
  const errors = findings.filter((f) => f.severity === "error");
  const byRule = new Map();
  for (const f of findings) {
    const r = byRule.get(f.rule) ?? { severity: f.severity, places: new Set(), keys: 0, count: 0 };
    r.places.add(f.where);
    r.keys++;
    r.count += f.count;
    if (f.severity === "error") r.severity = "error";
    byRule.set(f.rule, r);
  }
  if (!args.includes("--quiet")) for (const f of args.includes("--warnings") ? findings : errors) console.log(`${f.severity.padEnd(7)} ${f.key} x${f.count}: ${f.detail}`);
  console.log("\nrule                           severity  figures/views  keys  count");
  for (const [rule, r] of [...byRule].sort()) console.log(`${rule.padEnd(30)} ${r.severity.padEnd(9)} ${String(r.places.size).padStart(6)} ${String(r.keys).padStart(11)} ${String(r.count).padStart(6)}`);
  console.log(`\n${stats.pages} pages, ${stats.states} states visited (${stats.looks} distinct figure states measured), ${((Date.now() - t0) / 1000).toFixed(0)} s: ${errors.length} error finding(s), ${findings.length - errors.length} warning finding(s)`);
  process.exit(errors.length ? 1 : 0);
}
