// Accessibility checks for the bench views (src/ui/views): the panels beside a running program.
//
// A view only shows when a program uses its peripheral, so each one is brought on screen by a
// level whose reference solution uses it. The solution is put in the save (the editor opens with
// it), then:
//   tests   Run tests: the view shows the finished test run
//   live    Run, a second of simulated program, Pause: the view shows a running board
// Each state is looked at with the probe of the figures (figures-probe.mjs), with the panel as
// its root, at the panel's sizes (normal, "Fill the column", "Large view"), on a 1440 px and a
// 390 px window, light and dark, Text size Normal and Extra large. The view's own controls
// (the arena's replay slider, its play buttons) are walked like a figure's.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { finding, REPO } from "./findings.mjs";
import { probe } from "./figures-probe.mjs";
import { fontsReady, keyboardWalk, pool, runAxe, toFindings, addSentinels } from "./figures-walks.mjs";

/** The level that shows each view. A view without an entry is reported, so a new view cannot go unchecked. */
export const VIEW_LEVELS = {
  "actuator-view": "act-servo",
  "adc-monitor": "adc-single",
  "analog-plot": "dac-setdaca",
  "array-grid": "loc-kf3-predict",
  "bus-log": "spi-loopback",
  "filter-scope": "dmaf-avg5",
  "imu-view": "spi-bitbang",
  "interrupt-log": "int-first-isr",
  "lidar-view": "sens-poll",
  "pwm-monitor": "pwm-init",
  "robot-arena": "ctl-p",
  wheels: "ctl-p",
};

const XL = 1.3;
const WINDOWS = [
  { cond: "1440", vw: 1440, vh: 1000, sizes: ["normal", "wide", "large"], layout: true, colour: true, names: true, targets: true, axe: true, keyboard: true, live: true },
  { cond: "1440-dark", vw: 1440, vh: 1000, dark: true, sizes: ["normal"], colour: true, axe: true, live: true },
  { cond: "1440-xl", vw: 1440, vh: 1000, text: XL, sizes: ["normal", "large"], layout: true, live: true },
  { cond: "390", vw: 390, vh: 800, sizes: ["normal", "large"], layout: true, targets: true, reflow: true, live: true },
  { cond: "390-xl", vw: 390, vh: 800, text: XL, sizes: ["normal"], layout: true, reflow: true },
];

export function viewIds() {
  return readdirSync(join(REPO, "src/ui/views"))
    .filter((f) => f.endsWith(".tsx") && !/-(play|model|context)\.tsx$/.test(f))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();
}

const panelSel = (id) => `.panel[data-panel="view-${id}"]`;
// What is checked is the view itself: the panel's title and size buttons belong to the level screen.
const bodySel = (id) => `${panelSel(id)} > .panel-body`;

async function setSize(page, id, size) {
  const sel = panelSel(id);
  const now = await page.locator(sel).getAttribute("data-size");
  if (now === size) return;
  if (now === "large") await page.locator(`${sel} [data-size-button="large"]`).click();
  const cur = await page.locator(sel).getAttribute("data-size");
  if (size === "large") await page.locator(`${sel} [data-size-button="large"]`).click();
  else if (cur !== size) await page.locator(`${sel} [data-size-button="wide"]`).click();
  await page.waitForTimeout(120);
}

async function tab(page, name) {
  const t = page.getByRole("tab", { name, exact: true });
  if (await t.count()) await t.click();
}

/** One level in one window: every view it is the level for, in both states. */
async function checkLevel(browser, baseUrl, levelId, solution, ids, w, axe) {
  const out = [];
  let states = 0;
  const ctx = await browser.newContext({ viewport: { width: w.vw, height: w.vh }, colorScheme: w.dark ? "dark" : "light", reducedMotion: "reduce" });
  const fail = (id, state, e) => out.push(finding({ where: `view:${id}`, rule: "view/not-checked", state: `${state}-${w.cond}`, detail: `the check itself failed: ${String(e.message ?? e).split("\n")[0].slice(0, 200)}` }));
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(probe);
    await page.goto(baseUrl);
    await page.evaluate(
      ([save, prefs]) => {
        localStorage.setItem("bringup-save-v1", save);
        localStorage.setItem("bringup-ui-v1", prefs);
      },
      [JSON.stringify({ version: 1, passed: {}, stars: {}, hints: {}, code: { [levelId]: solution }, unlockAll: true }), JSON.stringify(w.text ? { "text-scale": w.text } : {})],
    );
    await page.goto(`${baseUrl}#/level/${levelId}`);
    await page.reload();
    await page.waitForSelector(".level-head");
    await fontsReady(page);
    const look = async (id, state, size) => {
      const sel = bodySel(id);
      const cond = `${state}-${size}-${w.cond}`;
      const items = [];
      try {
        await page.locator(sel).scrollIntoViewIfNeeded();
        await addSentinels(page, sel);
        const first = size === "normal";
        if (w.keyboard && first) await keyboardWalk(page, items, state, sel);
        if (w.axe && first) await runAxe(page, axe, items, state, sel);
        const big = size !== "normal";
        const res = await page.evaluate(([s, cfg]) => window.__a11y.explore({ root: s, ...cfg }), [
          sel,
          { layout: !!w.layout, colour: !!w.colour && first, targets: !!w.targets, names: !!w.names && first, pointer: !!w.names && first, reflow: !!w.reflow, minSvgPx: big && w.vw > 600 ? 11 : 0, height: false, reduced: true, walk: first ? 24 : 6, systematic: first ? 80 : 24, seed: 7, skip: ".panel-bar" },
        ]);
        items.push(...res.found);
        states += res.stats.states;
        if (!(big && w.vw > 600) && w.layout && res.stats.minSvgPx < 10.95) items.push({ rule: "size/drawing-text-narrow", sig: "", count: Math.round((11 - res.stats.minSvgPx) * 10), detail: `the smallest label in the drawing is ${res.stats.minSvgPx.toFixed(1)} px ("${res.stats.minSvgText.slice(0, 30)}")`, severity: "warning" });
      } catch (e) {
        fail(id, cond, e);
      }
      out.push(...toFindings(`view:${id}`, cond, items));
    };
    // ---- the finished test run
    await tab(page, "Code");
    await page.getByRole("button", { name: /^Run tests/ }).click();
    await page.waitForSelector(".bench .result", { state: "attached", timeout: 120000 });
    await tab(page, "Board");
    for (const id of ids) {
      if (!(await page.locator(panelSel(id)).count())) {
        out.push(finding({ where: `view:${id}`, rule: "view/not-shown", state: `tests-${w.cond}`, detail: `the level ${levelId} no longer shows this view after Run tests: choose another level in VIEW_LEVELS` }));
        continue;
      }
      for (const size of w.sizes) {
        await setSize(page, id, size);
        await look(id, "tests", size);
      }
      await setSize(page, id, "normal");
    }
    // ---- a running board, paused
    if (w.live) {
      await tab(page, "Code");
      await page.locator(".toolbar").getByRole("button", { name: "Run", exact: true }).click();
      await page.waitForTimeout(1500);
      await page.locator(".toolbar").getByRole("button", { name: "Pause" }).click();
      await tab(page, "Board");
      for (const id of ids) {
        if (!(await page.locator(panelSel(id)).count())) continue;
        await setSize(page, id, "normal");
        await look(id, "live", "normal");
      }
    }
    for (const e of new Set(errors)) out.push(finding({ where: `view:${ids[0]}`, rule: "view/throws", state: w.cond, detail: `page error on ${levelId}: ${e.slice(0, 160)}` }));
  } catch (e) {
    for (const id of ids) fail(id, "level", e);
  } finally {
    await ctx.close();
  }
  return { findings: out, states };
}

export async function checkViews({ baseUrl, browser, only, jobs = 8, axe, levels, onProgress }) {
  const ids = viewIds().filter((id) => !only || only.includes(id));
  if (!ids.length) return { findings: [], states: 0, pages: 0 };
  const data = levels ?? (await (await import("./game.mjs")).loadLevels());
  const chapters = Array.isArray(data) ? data : data.chapters;
  const solutions = new Map(chapters.flatMap((c) => c.levels).filter((l) => typeof l.solution === "string").map((l) => [l.id, l.solution]));
  const findings = [];
  const byLevel = new Map();
  for (const id of ids) {
    const level = VIEW_LEVELS[id];
    if (!level || !solutions.has(level)) {
      findings.push(finding({ where: `view:${id}`, rule: "view/not-checked", detail: level ? `the level ${level} is gone: choose another in VIEW_LEVELS (tools/a11y/figures-views.mjs)` : "no level is listed for this view in VIEW_LEVELS (tools/a11y/figures-views.mjs)" }));
      continue;
    }
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(id);
  }
  const tasks = [...byLevel].flatMap(([level, vs]) => WINDOWS.map((w) => ({ level, vs, w })));
  let states = 0;
  await pool(tasks, jobs, async ({ level, vs, w }) => {
    const r = await checkLevel(browser, baseUrl, level, solutions.get(level), vs, w, axe);
    findings.push(...r.findings);
    states += r.states;
  });
  onProgress?.(`views: ${tasks.length} level runs`);
  return { findings, states, pages: tasks.length };
}
