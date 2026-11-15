// Drives the game in headless Chromium and checks every screen and every level.
// What is checked, and against which success criteria: docs/ACCESSIBILITY.md.
import { finding } from "./findings.mjs";
import { PREF_KEY, SAVE_KEY, emptySave } from "./game.mjs";
import { installChecks } from "./page-checks.mjs";

/**
 * A window size and a Text size setting. 720 px is 1440 px at 200 % (1.4.4); 320 px is 1280 px at
 * 400 % (1.4.10) and also stands for a phone: it has a touch screen, so (any-pointer: coarse) matches.
 */
export const PROFILES = {
  wide: { id: "1440", width: 1440, height: 900, scale: 1 },
  narrow: { id: "320", width: 320, height: 640, scale: 1, touch: true },
  half: { id: "720", width: 720, height: 800, scale: 1 },
  wideXl: { id: "1440+xl", width: 1440, height: 900, scale: 1.3 },
  narrowXl: { id: "320+xl", width: 320, height: 640, scale: 1.3, touch: true },
};

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_FULL = { runOnly: { type: "tag", values: [...WCAG_TAGS, "best-practice"] }, rules: { "color-contrast-enhanced": { enabled: true } } };
// The second colour scheme changes colours only: the rules that look at colour run again.
const AXE_COLOUR = { runOnly: { type: "rule", values: ["color-contrast", "color-contrast-enhanced", "link-in-text-block"] } };

/** Collects findings. The same key seen in several page states keeps its largest count and names the states. */
export class Collector {
  constructor() {
    this.map = new Map();
    this.states = 0;
    this.titles = new Map();
  }
  add({ where, region = "", rule, scheme, profile, severity = "error", count = 1, detail = "", pageState = "" }) {
    if (region === "figure") return;
    const place = /^(chrome|panel|component):/.test(region) ? region : where;
    const f = finding({ where: place, rule, state: `${scheme}@${profile}`, severity, count, detail });
    const seen = this.map.get(f.key);
    const from = place === where ? pageState : `${where} ${pageState}`;
    if (!seen) this.map.set(f.key, { ...f, in: [from] });
    else {
      if (count > seen.count) {
        seen.count = count;
        seen.detail = detail;
      }
      if (severity === "error") seen.severity = "error";
      if (seen.in.length < 4 && !seen.in.includes(from)) seen.in.push(from);
    }
  }
  findings() {
    return [...this.map.values()].map(({ in: states, ...f }) => ({ ...f, detail: `${f.detail} [${states.join("; ")}]` }));
  }
}

const sampleText = (g) => g.sample.join(" | ");

/** One browser window of one profile. */
export class Session {
  constructor({ browser, baseUrl, axe, collector, profile, log }) {
    Object.assign(this, { browser, baseUrl, axe, collector, profile, log });
    this.errors = [];
    this.n = 0;
  }
  async init() {
    const p = this.profile;
    this.context = await this.browser.newContext({ viewport: { width: p.width, height: p.height }, colorScheme: "light", reducedMotion: "no-preference", serviceWorkers: "block", hasTouch: !!p.touch });
    this.context.setDefaultTimeout(20_000);
    await this.context.addInitScript({ content: this.axe.source });
    await this.context.addInitScript(installChecks);
    // What a Copy button hands to the clipboard is recorded instead of written: every window shares one clipboard.
    await this.context.addInitScript(() => {
      window.__a11yCopied = null;
      const record = (text) => {
        window.__a11yCopied = String(text);
        return Promise.resolve();
      };
      try {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: record, readText: () => Promise.resolve(window.__a11yCopied ?? "") } });
      } catch {
        /* the check then reports that nothing was copied */
      }
    });
    this.page = await this.context.newPage();
    this.page.on("pageerror", (e) => this.errors.push(`page error: ${e.message}`));
    this.page.on("console", (m) => m.type() === "error" && this.errors.push(`console error: ${m.text()}`));
    this.page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await this.page.goto(this.baseUrl);
  }
  async close() {
    await this.context?.close();
  }
  add(f) {
    this.collector.add({ profile: this.profile.id, ...f });
  }

  /** Opens an address of the game from a fresh start, with this progress and these preferences. */
  async open(hash, wait, { save = {}, prefs = {}, scheme = "light" } = {}) {
    const page = this.page;
    this.errors.length = 0;
    this.scheme = scheme;
    this.motion = "no-preference";
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "no-preference" });
    await page.evaluate(
      ([sk, sv, pk, pv]) => {
        localStorage.clear();
        localStorage.setItem(sk, sv);
        localStorage.setItem(pk, pv);
      },
      [SAVE_KEY, emptySave(save), PREF_KEY, JSON.stringify({ "text-scale": this.profile.scale, ...prefs })],
    );
    await page.goto(`${this.baseUrl}?n=${++this.n}${hash}`);
    await page.waitForSelector(wait, { state: "attached" });
    await this.settle();
  }
  settle() {
    return this.page.evaluate(() => window.__a11y.settle());
  }
  /**
   * "reduce" from here on. The levels are played with reduced motion: a test run then has to come
   * to rest by itself (a replay may not start), which is what lets the page be checked after it.
   */
  async setMotion(motion) {
    this.motion = motion;
    await this.page.emulateMedia({ reducedMotion: motion });
  }
  async setScheme(scheme) {
    if (this.scheme === scheme) return;
    this.scheme = scheme;
    await this.page.emulateMedia({ colorScheme: scheme });
  }

  async axeRun(where, pageState, scheme, options, label = scheme) {
    await this.setScheme(scheme);
    const res = await this.page.evaluate((o) => window.__a11y.axe(o), options);
    for (const v of res) {
      const wcag = v.tags.some((t) => WCAG_TAGS.includes(t));
      const severity = wcag && (v.impact === "critical" || v.impact === "serious") ? "error" : "warning";
      for (const [region, g] of Object.entries(v.byRegion)) this.add({ where, region, rule: `axe/${v.id}`, scheme: label, severity, count: g.count, detail: `${v.help}: ${sampleText(g)}`, pageState });
    }
  }

  /**
   * Checks the page as it is now.
   *  axe       "both" (all rules in light, the colour rules in dark), "full" (all rules in both), "light", or "none"
   *  spacing   also with the text spacing of 1.4.12
   *  keyboard  walk the page with Tab in these schemes
   *  still     also watch that nothing changes on its own
   *  running   a program is running: movement is expected, reduced motion still has to stop the animations
   *  pinned    the scheme comes from the game's own Theme setting: label findings with it
   */
  async state(where, pageState, { axe = "both", layout = true, spacing = false, keyboard = [], still = false, running = false, pinned = "", title = false } = {}) {
    const page = this.page;
    const idle = await this.settle();
    this.collector.states++;
    const any = { where, pageState, scheme: "any" };
    if (!idle.idle && !running) this.add({ ...any, rule: "motion/never-still", detail: `the page keeps changing with nothing running${this.motion === "reduce" ? ", with prefers-reduced-motion" : ""}` });

    // Motion first: nothing may animate on its own, and reduced motion stops every animation.
    if (this.motion !== "no-preference") await page.emulateMedia({ reducedMotion: "no-preference" });
    const moving = await page.evaluate(() => window.__a11y.motion());
    for (const m of moving) {
      if (m.figure) continue;
      if (m.flashing) this.add({ ...any, region: m.region, rule: "motion/flashing", detail: `${m.el} repeats every ${Math.round(m.duration)} ms` });
      else if (m.endless && !running) this.add({ ...any, region: m.region, rule: "motion/animates-unasked", detail: `${m.el} runs "${m.name}" without end and nothing was started` });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = (await page.evaluate(() => window.__a11y.motion())).filter((m) => !m.figure);
    if (reduced.length) this.add({ ...any, region: reduced[0].region, rule: "motion/reduced-motion-ignored", count: reduced.length, detail: `still animating with prefers-reduced-motion: ${reduced.slice(0, 3).map((m) => `${m.el} (${m.name})`).join(", ")}` });
    await page.emulateMedia({ reducedMotion: this.motion });
    if (still && !running) {
      const changed = await page.evaluate(() => window.__a11y.watchStill(30));
      if (changed.length) this.add({ ...any, rule: "motion/moves-unasked", count: changed.length, detail: `changes on its own: ${changed.join(", ")}` });
    }

    if (axe !== "none") {
      if (pinned) await this.axeRun(where, pageState, this.scheme, AXE_FULL, pinned);
      else {
        await this.axeRun(where, pageState, "light", AXE_FULL);
        if (axe !== "light") await this.axeRun(where, pageState, "dark", axe === "full" ? AXE_FULL : AXE_COLOUR);
        await this.setScheme("light");
      }
    }

    const s = await page.evaluate(() => window.__a11y.structure());
    if (title) this.collector.titles.set(where, s.title);
    if (!s.title.trim()) this.add({ ...any, rule: "names/no-title", detail: "the document has no title" });
    if (!s.lang) this.add({ ...any, rule: "names/no-lang", detail: "<html> has no lang" });
    if (s.h1 !== 1) this.add({ ...any, rule: "structure/h1-count", detail: `${s.h1} visible h1 headings (one is expected)` });
    if (s.headingSkips.length) this.add({ ...any, rule: "structure/heading-skip", count: s.headingSkips.length, detail: `heading levels are skipped: ${s.headingSkips.slice(0, 3).join(" | ")}` });
    if (s.mains !== 1) this.add({ ...any, rule: "structure/landmark-main", detail: `${s.mains} main landmarks (one is expected)` });
    if (s.navs < 1) this.add({ ...any, rule: "structure/landmark-nav", detail: "no navigation landmark" });
    for (const [region, g] of Object.entries(s.graphics)) this.add({ ...any, region, rule: "names/graphic-no-alt", count: g.count, detail: `a picture with no text alternative that is not hidden as decoration: ${sampleText(g)}` });
    for (const [region, g] of Object.entries(s.codeChars)) this.add({ ...any, region, rule: "code/typographic-char", count: g.count, detail: `code holds a character that does not paste as typed: ${sampleText(g)}` });
    // 44 px targets are asked of the windows used with a finger (the 320 px profiles have a touch screen); with a mouse the 24 px of 2.5.8 holds (axe).
    if (this.profile.touch) for (const [region, g] of Object.entries(s.targets)) this.add({ ...any, region, rule: "target/size-44", severity: "warning", count: g.count, detail: `pointer targets under 44 by 44 px (2.5.5 AAA): ${sampleText(g)}` });

    for (const [region, g] of Object.entries(await page.evaluate(() => window.__a11y.colourOnly()))) this.add({ ...any, region, rule: "colour/only-cue", count: g.count, detail: `two states differ by colour alone: ${sampleText(g)}` });

    if (layout) this.layoutFindings(where, pageState, await page.evaluate(() => window.__a11y.layout()), "");
    if (spacing) this.layoutFindings(where, pageState, await page.evaluate(() => window.__a11y.spacing()), "text-spacing");

    for (const scheme of keyboard) await this.keyboardWalk(where, pageState, scheme);
    await this.setScheme("light");

    if (this.errors.length) {
      this.add({ ...any, rule: "page/error", count: this.errors.length, detail: this.errors.slice(0, 2).join(" | ").slice(0, 300) });
      this.errors.length = 0;
    }
  }

  layoutFindings(where, pageState, res, family) {
    const rules = family
      ? { pageScroll: ["text-spacing/page-scrolls", "error"], offScreen: ["text-spacing/off-screen", "error"], spills: ["text-spacing/spills", "error"], clipped: ["text-spacing/clipped", "error"], truncated: ["text-spacing/truncated", "warning"], overlaps: ["text-spacing/overlap", "error"] }
      : { pageScroll: ["reflow/page-scrolls", "error"], offScreen: ["reflow/text-off-screen", "error"], spills: ["reflow/text-spills", "error"], clipped: ["layout/text-clipped", "error"], truncated: ["layout/text-truncated", "warning"], overlaps: ["layout/text-overlap", "error"], scrollers: ["reflow/scroll-box", "error"] };
    const words = {
      pageScroll: "the page scrolls sideways",
      offScreen: "text outside the window that nothing scrolls to",
      spills: "text runs out of its box",
      clipped: "text is cut off",
      truncated: "text is shortened with an ellipsis or a line clamp",
      overlaps: "text is drawn over other text",
      scrollers: "a box that scrolls sideways",
    };
    for (const [kind, byRegion] of Object.entries(res)) {
      if (!rules[kind]) continue;
      const [rule, severity] = rules[kind];
      for (const [region, g] of Object.entries(byRegion)) this.add({ where, region, pageState, scheme: "any", rule, severity, count: g.count, detail: `${family ? "with the text spacing of 1.4.12, " : ""}${words[kind]}: ${sampleText(g)}` });
    }
  }

  /** Tab through the whole page from the top. */
  async keyboardWalk(where, pageState, scheme) {
    const page = this.page;
    await this.setScheme(scheme);
    await page.evaluate(() => window.__a11y.kbInit());
    const base = { where, pageState, scheme };
    const tally = new Map();
    const note = (rule, region, detail, severity = "error") => {
      const k = `${rule}|${region}`;
      const t = tally.get(k) ?? { rule, region, severity, count: 0, sample: [] };
      t.count++;
      if (t.sample.length < 3) t.sample.push(detail);
      tally.set(k, t);
    };
    const look = async () => {
      const info = await page.evaluate(() => window.__a11y.kbStop());
      if (info.end || info.repeat || info.figure) return info;
      const rg = info.region;
      if (info.invisible) note("keyboard/focus-invisible", rg, `${info.desc} takes the focus but is not drawn`);
      else {
        if (!info.indicator) note("keyboard/no-focus-indicator", rg, `${info.desc} shows no outline or other change when focused`);
        else if (info.indicator.ratio !== null && info.indicator.ratio < 3) note("keyboard/focus-indicator-contrast", rg, `${info.desc}: the ${info.indicator.kind} has ${info.indicator.ratio.toFixed(2)}:1 against what is next to it (3:1 is needed)`);
        if (info.offscreen) note("keyboard/focus-off-screen", rg, `${info.desc} is outside the window when focused`);
        if (info.obscured) note("keyboard/focus-obscured", rg, `${info.desc} is covered by ${info.obscured} when focused`);
      }
      if (info.domBack) note("keyboard/focus-order", rg, `${info.desc} comes after ${info.domBack} but is before it in the page`);
      if (info.visualBack) note("keyboard/focus-order-visual", rg, `${info.desc} is above ${info.visualBack}, which is focused before it`);
      if (info.positiveTabindex) note("keyboard/positive-tabindex", rg, `${info.desc} has a tabindex above 0`);
      return info;
    };
    let ended = false;
    for (let i = 0; i < 900 && !ended; i++) {
      await page.keyboard.press("Tab");
      let info = await look();
      if (info.editor && !info.repeat) {
        // The code editor keeps Tab for indenting; Escape then Tab is its documented way out. The editor
        // allows two seconds between the two keys, so the page is at rest before they are pressed.
        await this.settle();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Tab");
        info = await look();
        if (info.editor) {
          note("keyboard/trap", info.region, "Escape then Tab does not leave the code editor");
          break;
        }
      }
      if (info.end || info.loop) ended = true;
      else if (info.repeat) {
        note("keyboard/trap", info.region, info.same ? `Tab does not move the focus on from ${info.desc}` : `Tab goes back to ${info.desc} before the end of the page`);
        ended = true;
      }
    }
    if (!ended) note("keyboard/trap", "", "more than 900 Tab presses without reaching the end of the page");
    const end = await page.evaluate(() => window.__a11y.kbEnd());
    for (const [region, g] of Object.entries(end.missed)) this.add({ ...base, region, rule: "keyboard/unreachable", count: g.count, detail: `not reached with Tab: ${sampleText(g)}` });
    for (const t of tally.values()) this.add({ ...base, region: t.region, rule: t.rule, severity: t.severity, count: t.count, detail: t.sample.join(" | ") });
    await page.evaluate(() => document.activeElement?.blur?.());
  }

  /** Does `act`, then reports whether what appeared was announced (4.1.3). */
  async announce(where, pageState, act, waitFor) {
    const page = this.page;
    await page.evaluate(() => window.__a11y.watchStart());
    await act();
    if (waitFor) await page.waitForSelector(waitFor, { state: "attached" });
    await this.settle();
    const w = await page.evaluate(() => window.__a11y.watchEnd());
    if (w && w.quietCount && !w.live && !w.focusMoved) this.add({ where, pageState, scheme: "any", rule: "status/not-announced", count: w.quietCount, detail: `appeared without a live region and without moving the focus: ${w.quiet.join(" | ")}` });
  }

  /** Every Copy button copies exactly the text shown beside it. */
  async copyButtons(where, pageState) {
    const page = this.page;
    const wraps = page.locator(".code-wrap");
    const n = await wraps.count();
    let bad = 0;
    let detail = "";
    for (let i = 0; i < n; i++) {
      const wrap = wraps.nth(i);
      if (!(await wrap.isVisible()) || (await wrap.evaluate((el) => !!el.closest(".figure")))) continue;
      const shown = await wrap.locator("pre").first().evaluate((el) => el.textContent);
      await page.evaluate(() => (window.__a11yCopied = null));
      await wrap.locator(".copy-btn").first().click();
      const copied = await page.evaluate(() => window.__a11yCopied);
      const trim = (t) => (t ?? "").replace(/\n+$/, "");
      if (copied === null || trim(copied) !== trim(shown)) {
        bad++;
        if (!detail) detail = copied === null ? "the Copy button copied nothing" : `copied ${copied.length} characters, ${shown.length} are shown; first difference at ${[...trim(shown)].findIndex((c, k) => c !== trim(copied)[k])}`;
      }
    }
    if (bad) this.add({ where, pageState, scheme: "any", rule: "code/copy-differs", count: bad, detail });
  }
}

// ---------- playing a level, as tests/e2e/play.e2e.ts does ----------

async function answerWrong(page, l) {
  switch (l.kind) {
    case "brief":
    case "quiz":
      for (let q = 0; q < l.questions.length; q++) await page.locator("fieldset.question").nth(q).locator("input[type=radio]").nth((l.questions[q].answer + 1) % l.questions[q].options.length).check();
      await page.getByRole("button", { name: "Check answers" }).click();
      break;
    case "calc":
      for (const f of l.fields) await page.fill(`#calc-${f.id}`, f.format === "hex" ? `0x${(f.answer + 7).toString(16)}` : String(f.answer + 7));
      await page.getByRole("button", { name: "Check", exact: true }).click();
      break;
    case "register":
      await page.getByRole("button", { name: "Check value" }).click();
      break;
    case "order":
      await page.getByRole("button", { name: "Check order" }).click();
      break;
    case "timing":
      await page.getByRole("button", { name: "Check waveform" }).click();
      break;
    case "wiring":
      await page.getByRole("button", { name: "Check circuit" }).click();
      break;
  }
}

async function typeSolution(page, l) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(l.solution);
  // A fault-finding level on the wiring bench: the reference repair is made on the bench, as a student does.
  if (l.bench && Object.keys(l.bench.repair).length) {
    const board = page.getByRole("tab", { name: "Board" });
    const tabbed = (await board.count()) > 0;
    if (tabbed) await board.click();
    for (const [id, opts] of Object.entries(l.bench.repair)) {
      await page.locator('[data-wb="part"]').selectOption(id);
      for (const [o, v] of Object.entries(opts)) await page.locator(`[data-card="${id}"] [data-option="${o}"]`).selectOption(v);
    }
    if (tabbed) await page.getByRole("tab", { name: "Code" }).click();
  }
}

async function solve(page, l) {
  switch (l.kind) {
    case "brief":
    case "quiz":
      for (let q = 0; q < l.questions.length; q++) await page.locator("fieldset.question").nth(q).locator("input[type=radio]").nth(l.questions[q].answer).check();
      await page.getByRole("button", { name: "Check answers" }).click();
      break;
    case "calc":
      for (const f of l.fields) await page.fill(`#calc-${f.id}`, f.format === "hex" ? `0x${f.answer.toString(16)}` : String(f.answer));
      await page.getByRole("button", { name: "Check", exact: true }).click();
      break;
    case "register": {
      const { bits, fields } = l.layout;
      let target = l.value ?? l.initial;
      if (l.value === undefined)
        for (const t of l.targets) {
          const f = fields.find((x) => x.name === t.field);
          const width = f.hi - f.lo + 1;
          target = target - (Math.floor(target / 2 ** f.lo) % 2 ** width) * 2 ** f.lo + t.value * 2 ** f.lo;
        }
      for (let b = 0; b < bits; b++) {
        const want = Math.floor(target / 2 ** b) % 2;
        const have = Math.floor((l.initial >>> 0) / 2 ** b) % 2;
        if (want !== have) await page.locator(`button.bit[data-bit="${b}"]`).click();
      }
      await page.getByRole("button", { name: "Check value" }).click();
      break;
    }
    case "order": {
      const order = () => page.locator("ol.order > li").evaluateAll((els) => els.map((e) => Number(e.dataset.step)));
      for (let guard = 0; guard < 400; guard++) {
        const cur = await order();
        const i = cur.findIndex((v, k) => k < cur.length - 1 && v > cur[k + 1]);
        if (i < 0) break;
        await page.getByRole("button", { name: `Move step ${i + 1} down` }).click();
      }
      await page.getByRole("button", { name: "Check order" }).click();
      break;
    }
    case "timing":
      for (let r = 0; r < l.rows.length; r++)
        for (let i = 0; i < l.slots.length; i++)
          if (l.rows[r].editable && l.rows[r].initial[i] !== l.rows[r].answer[i]) await page.locator(".timing tbody tr").nth(r).locator("td button").nth(i).click();
      await page.getByRole("button", { name: "Check waveform" }).click();
      break;
    case "wiring":
      for (const [a, b] of l.wires) {
        await page.locator(`g.node[data-node="${a}"] circle.hit`).click();
        await page.locator(`g.node[data-node="${b}"] circle.hit`).click();
      }
      await page.getByRole("button", { name: "Check circuit" }).click();
      break;
    case "code":
      await typeSolution(page, l);
      await page.getByRole("button", { name: /^Run tests/ }).click();
      break;
  }
}

const showTab = async (page, name) => {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.count()) await tab.click();
};

/**
 * One level in one profile: as first opened, after a wrong answer (or the starter's failed tests),
 * and after the pass. `depth`: "open" checks only the first; "full" all of them.
 * Returns the bench views the level showed, for choosing the live-run sample.
 */
export async function levelJob(s, level, { depth = "full", sample = false } = {}) {
  const page = s.page;
  const id = level.id;
  const wide = s.profile.width >= 1000;
  const narrow = s.profile.width < 760 * s.profile.scale;
  const main = s.profile.scale === 1 && (s.profile.id === "1440" || s.profile.id === "320");
  // The keyboard is walked in light at 1440 and in dark at 320, so both schemes and both layouts are covered.
  const kb = !main ? [] : wide ? ["light"] : ["dark"];
  await s.open(`#/level/${encodeURIComponent(id)}`, ".level-head");
  await s.state(id, "open", { spacing: main, keyboard: kb, still: sample, title: s.profile.id === "1440" });
  if (depth === "open") return [];
  await s.setMotion("reduce");

  if (level.kind === "code") {
    if (narrow) {
      await showTab(page, "Code");
      await s.state(id, "code tab", { axe: "light" });
    }
    await s.announce(id, "tests failed", () => page.getByRole("button", { name: /^Run tests/ }).click(), ".bench .result");
    await s.state(id, "tests failed");
    if (narrow) {
      await showTab(page, "Board");
      await s.state(id, "tests failed, board tab", { spacing: main });
      await showTab(page, "Code");
    }
    await typeSolution(page, level);
    await s.announce(id, "passed", () => page.getByRole("button", { name: /^Run tests/ }).click(), ".takeaway.passed");
    await s.state(id, "passed", { spacing: main, keyboard: sample ? kb : [] });
  } else {
    await s.announce(id, "wrong answer", () => answerWrong(page, level));
    const already = await page.locator(".takeaway.passed").count();
    if (!already) await s.state(id, "wrong answer", { spacing: main });
    await s.announce(id, "passed", () => solve(page, level), ".takeaway.passed");
    await s.state(id, "passed", { spacing: main, keyboard: kb });
  }
  const views = await page.locator('[data-panel^="view-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-panel")));

  // Hints, one after the other, and the reference solution.
  if (wide || sample) {
    if (narrow) await showTab(page, "Read");
    for (let k = 0; k < 6; k++) {
      const more = page.getByRole("button", { name: /^Show (a|another) hint/ });
      if (!(await more.count())) break;
      await more.click();
    }
    const sol = page.locator("details.solution > summary");
    if (await sol.count()) await sol.click();
    await s.state(id, "hints open", { axe: "light", spacing: sample });
    if (s.profile.id === "1440") await s.copyButtons(id, "hints open");
  }
  return views;
}

/** A program running live: checked while it runs (motion) and paused (everything else). */
export async function liveJob(s, level) {
  const page = s.page;
  const id = level.id;
  const narrow = s.profile.width < 760 * s.profile.scale;
  await s.open(`#/level/${encodeURIComponent(id)}`, ".level-head", { save: { code: { [id]: level.solution } } });
  if (narrow) await showTab(page, "Code");
  // A level that is only debugged with the tests has no Run button.
  if (!(await page.getByRole("button", { name: "Run", exact: true }).count())) return;
  await runLive(s, id, narrow);
}

async function runLive(s, where, narrow) {
  const page = s.page;
  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  await page.waitForFunction(() => /t = \d{2}/.test(document.querySelector(".simstate")?.textContent ?? ""));
  if (narrow) await showTab(page, "Board");
  await s.state(where, "running", { axe: "none", layout: false, running: true });
  if (narrow) await showTab(page, "Code");
  await page.getByRole("button", { name: "Pause", exact: true }).first().click();
  if (narrow) await showTab(page, "Board");
  await s.state(where, "paused", { spacing: true, keyboard: s.profile.scale === 1 ? [s.profile.width >= 1000 ? "light" : "dark"] : [] });
  // The first panel that can grow, in its large view.
  const large = page.locator('[data-size-button="large"]').first();
  if (await large.count()) {
    await large.click();
    await s.state(where, "large view", { keyboard: s.profile.id === "1440" ? ["light"] : [] });
    await page.keyboard.press("Escape");
  }
  if (narrow) await showTab(page, "Code");
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await s.settle();
}

// ---------- the screens ----------

const FULL = { axe: "full", spacing: true, keyboard: ["light", "dark"], still: true };

async function mapScreen(s, chapters) {
  const page = s.page;
  await s.open("", ".map-cols");
  await s.state("map", "open", { ...FULL, title: s.profile.id === "1440" });
  const ch = chapters[Math.min(3, chapters.length - 1)];
  await s.announce("map", "chapter chosen", () => page.locator(`button[data-chapter="${ch.id}"]`).click(), "#chapter-detail-title");
  await s.state("map", "chapter chosen", FULL);
  const week = page.locator(".week").nth(1);
  if (await week.count()) {
    await s.announce("map", "working-on filter", () => week.click());
    await s.state("map", "working-on filter", { axe: "both" });
  }
  // Progress: the primers finished nine days ago, so a part is done and a warm-up is due.
  const done = chapters.filter((c) => c.number < 0).flatMap((c) => c.levels);
  const passed = Object.fromEntries(done.map((l) => [l.id, true]));
  const day = 86_400_000;
  // The game compares these dates with today, so the test has to use today as well.
  const now = await page.evaluate(() => Date.now());
  const passedAt = Object.fromEntries(done.map((l) => [l.id, now - 9 * day]));
  await s.open("", ".map-cols", { save: { passed, passedAt } });
  const first = chapters.find((c) => c.number < 0);
  if (first) await page.locator(`button[data-chapter="${first.id}"]`).click();
  await s.state("map", "with progress", FULL);
  const start = page.getByRole("button", { name: "Start the warm-up" });
  if (await start.count()) {
    await start.click();
    await page.waitForSelector(".level-head.warm");
    await s.state("warm-up", "question", FULL);
    for (let k = 0; k < 6; k++) {
      const lid = decodeURIComponent((await page.evaluate(() => location.hash)).split("/")[2] ?? "");
      const level = chapters.flatMap((c) => c.levels).find((l) => l.id === lid);
      if (!level || level.kind === "code") break;
      await s.announce("warm-up", "answered", () => solve(page, level), ".takeaway.passed");
      if (k === 0) await s.state("warm-up", "answered", FULL);
      const next = page.getByRole("button", { name: /^(Next question|Finish the warm-up)$/ });
      const last = (await next.innerText()).startsWith("Finish");
      await next.click();
      if (last) break;
      await s.settle();
    }
    if (await page.locator(".warm-note").count()) await s.state("map", "after the warm-up", { axe: "both", keyboard: ["light"] });
  }
}

async function handbookScreen(s) {
  const page = s.page;
  await s.open("#/handbook", ".hb-content");
  const names = await page.locator(".hb-sections button").allInnerTexts();
  for (const [i, name] of names.entries()) {
    await page.locator(".hb-sections button").nth(i).click();
    await s.settle();
    await s.state("handbook", `section ${name.trim()}`, { ...FULL, keyboard: i === 0 ? ["light", "dark"] : [s.profile.width >= 1000 ? "light" : "dark"], title: false });
    s.collector.titles.set(`handbook:${name.trim()}`, await page.title());
  }
  await s.announce("handbook", "search", () => page.fill("#hb-search", "TBCTL"));
  await s.state("handbook", "search results", FULL);
  s.collector.titles.set("handbook:search", await page.title());
  const hit = page.getByRole("button", { name: /^EPwm1Regs\.TBCTL\b/ }).first();
  if (await hit.count()) {
    await hit.click();
    await page.waitForSelector(".hb-reg-detail table.fields");
    await s.state("handbook", "register chosen", { ...FULL, keyboard: ["light"] });
  }
  await s.announce("handbook", "search without results", () => page.fill("#hb-search", "qqqzzz"));
  await s.state("handbook", "search without results", { axe: "both" });
  await page.fill("#hb-search", "");
  await page.locator(".hb-sections").getByRole("button", { name: "Key diagrams" }).click();
  await page.waitForSelector(".hb-grid .hb-card");
  await page.locator(".hb-card").first().click();
  await page.waitForSelector(".hb-figure .figure, .hb-figure .fig-missing");
  await s.state("handbook", "figure opened", FULL);
  s.collector.titles.set("handbook:figure", await page.title());
}

async function settingsScreen(s) {
  const page = s.page;
  await s.open("#/settings", ".settings");
  await s.state("settings", "open", { ...FULL, title: s.profile.id === "1440" });
  await page.locator(".settings details > summary").click();
  await s.state("settings", "paste box open", FULL);
  await page.fill("#save-text", "not progress");
  await s.announce("settings", "load failed", () => page.getByRole("button", { name: "Load", exact: true }).click());
  await s.state("settings", "load failed", { axe: "both" });
}

async function sandboxScreen(s, kit, program) {
  const where = `sandbox:${kit}:${program}`;
  await s.open("#/sandbox", ".cm-content", { prefs: { "sandbox-kit": kit, "sandbox-program": program } });
  const narrow = s.profile.width < 760 * s.profile.scale;
  await s.state(where, "stopped", { ...FULL, title: s.profile.id === "1440" && program === "blink" && kit === "robot" });
  if (narrow) {
    await showTab(s.page, "Code");
    await s.state(where, "stopped, code tab", { axe: "both" });
    await showTab(s.page, "Board");
    await s.state(where, "stopped, board tab", { axe: "both", spacing: true });
    await showTab(s.page, "Code");
  }
  // ---- wiring bench (src/ui/wiring, docs/WIRING.md): begin ----
  if (kit === "redboard" && program === "blink") await wiringBenchStates(s, where, narrow);
  // ---- wiring bench: end ----
  await runLive(s, where, narrow);
}

/**
 * The wiring bench of the homework board with something on it: a fault switched on, a device attached and
 * not yet connected (so its problems are listed), every section open, the picture zoomed in.
 */
async function wiringBenchStates(s, where, narrow) {
  const page = s.page;
  if (narrow) await showTab(page, "Board");
  const bench = page.locator(".wb");
  await bench.locator('[data-wb="part"]').selectOption("JBUZ");
  await bench.locator('[data-option="pos"]').selectOption("off");
  await bench.locator('[data-wb="add"] > summary').click();
  await bench.locator('[data-wb="kind"]').selectOption("servo");
  await s.announce(where, "wiring bench: device added", () => bench.getByRole("button", { name: "Add RC servo" }).click());
  await bench.locator('[data-terminal="sig"]').selectOption("GPIO52");
  for (const name of ["table", "pins", "words", "help"]) await bench.locator(`[data-wb="${name}"] > summary`).click();
  await bench.locator('[data-wb="routes"]').check();
  await bench.getByRole("button", { name: "Zoom in" }).click();
  await s.settle();
  await s.state(where, "wiring bench: fault on, device attached, sections open", FULL);
  // Leave the bench as it was found: the live run that follows is the plain board's.
  await bench.getByRole("button", { name: "Reset the bench" }).click();
  await bench.getByRole("button", { name: "Yes, reset" }).click();
  await bench.getByRole("button", { name: "Zoom out" }).click();
  await bench.locator('[data-wb="routes"]').uncheck();
  for (const name of ["add", "table", "pins", "words", "help"]) await bench.locator(`[data-wb="${name}"] > summary`).click();
  await s.settle();
  if (narrow) await showTab(page, "Code");
}

/** The screens with the scheme pinned by the game's Theme setting against the system's. */
async function pinnedScreens(s) {
  for (const [system, pin] of [["light", "dark"], ["dark", "light"]]) {
    for (const [hash, wait, where] of [["", ".map-cols", "map"], ["#/handbook", ".hb-content", "handbook"], ["#/settings", ".settings", "settings"], ["#/sandbox", ".cm-content", "sandbox:robot:blink"]]) {
      await s.open(hash, wait, { prefs: { theme: pin }, scheme: system });
      await s.state(where, `theme setting ${pin}`, { axe: "full", pinned: `${pin}-setting`, layout: false });
    }
  }
}

/** The jobs for the screens: each is { id, profile, run(session) }. */
export function screenJobs({ chapters, starters, quick }) {
  const jobs = [];
  const profiles = quick ? ["wide", "narrow"] : ["wide", "narrow", "half", "wideXl", "narrowXl"];
  for (const profile of profiles) {
    jobs.push({ id: `map@${profile}`, profile, run: (s) => mapScreen(s, chapters) });
    jobs.push({ id: `handbook@${profile}`, profile, run: (s) => handbookScreen(s) });
    jobs.push({ id: `settings@${profile}`, profile, run: (s) => settingsScreen(s) });
    for (const kit of ["robot", "redboard", "launchpad"]) {
      const programs = ["blink", ...starters.filter((x) => x.kit === kit).map((x) => x.id)];
      // Every starting program at the two main sizes; the blinking LED alone at the others.
      for (const program of profile === "wide" || profile === "narrow" ? programs : ["blink"]) jobs.push({ id: `sandbox-${kit}-${program}@${profile}`, profile, run: (s) => sandboxScreen(s, kit, program) });
    }
  }
  jobs.push({ id: "pinned-theme@wide", profile: "wide", run: (s) => pinnedScreens(s) });
  return jobs;
}

/** Document titles: every screen and level has its own, and none is the bare name of the game. */
export function titleFindings(titles) {
  const out = [];
  const by = new Map();
  for (const [where, title] of titles) by.set(title, [...(by.get(title) ?? []), where]);
  for (const [title, wheres] of by) {
    if (wheres.length < 2) continue;
    for (const where of wheres) out.push(finding({ where, rule: "names/title-not-unique", state: "any@1440", detail: `the document title "${title}" is shared with ${wheres.filter((w) => w !== where).slice(0, 3).join(", ")}` }));
  }
  return out;
}

/**
 * Code as the level files hold it: starters, solutions, and code in briefs, hints and check
 * messages. Nothing in it may be a character that looks like a typed one and is not.
 */
export function levelTextFindings(chapters) {
  const BAD = /[  -​ ‘’‚“”„–—…−‐‑﻿]/g;
  const out = [];
  const codeIn = (md) => {
    if (typeof md !== "string") return [];
    const parts = [];
    for (const m of md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) parts.push(m[1]);
    for (const m of md.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)) parts.push(m[1]);
    return parts;
  };
  for (const c of chapters)
    for (const l of c.levels) {
      const code = [];
      const walk = (v, key) => {
        if (typeof v === "string") {
          if (key === "starter" || key === "solution" || key === "code") code.push(v);
          else code.push(...codeIn(v));
        } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
      };
      walk(l, "");
      const bad = new Set(code.flatMap((t) => t.match(BAD) ?? []));
      const lines = code.reduce((n, t) => n + t.split("\n").filter((line) => line.match(BAD)).length, 0);
      if (bad.size) out.push(finding({ where: l.id, rule: "code/typographic-char", state: "source", count: lines, detail: `code in the level's text holds ${[...bad].map((ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ")}: it does not paste as typed` }));
    }
  return out;
}
