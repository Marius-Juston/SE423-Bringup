import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { preview, type PreviewServer } from "vite";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHAPTERS } from "../../src/levels/index";
import { kindOf, type Level } from "../../src/levels/types";
import { layoutOf } from "../../src/ui/widgets/RegisterPuzzle";

// Solves every level the way a student would: clicking, typing, pressing
// "Check". Fails on any page error, on a level that does not report
// "Level passed", and on horizontal overflow of the page.
//   SHOTS=<dir>   also saves a screenshot of every level
//   CHROME=<path> browser to use (default: Playwright's cached Chromium)

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    const sub = readdirSync(join(cache, d)).find((x) => x.startsWith("chrome"));
    if (sub && existsSync(join(cache, d, sub, "chrome"))) return join(cache, d, sub, "chrome");
  }
  throw new Error("No Chromium found. Run `npx playwright install chromium` or set CHROME.");
}

const shots = process.env.SHOTS;
let server: PreviewServer;
let browser: Browser;
let page: Page;
let url = "";
const errors: string[] = [];

beforeAll(async () => {
  server = await preview({ preview: { port: 4174, strictPort: false }, logLevel: "silent" });
  url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ executablePath: findChrome() });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  if (shots) mkdirSync(shots, { recursive: true });
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem("bringup-save-v1", JSON.stringify({ version: 1, passed: {}, hints: {}, code: {}, unlockAll: true })));
  await page.reload();
  await page.waitForSelector(".map-cols");
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

async function solve(l: Level): Promise<void> {
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
      const { bits, fields } = layoutOf(l);
      let target = l.value ?? l.initial;
      if (l.value === undefined)
        for (const t of l.targets!) {
          const f = fields.find((x) => x.name === t.field)!;
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
    case "order":
      // Bubble sort with the move buttons.
      for (let pass = 0; pass < l.steps.length; pass++) {
        const cur = await page.locator("ol.order > li").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.step)));
        let moved = false;
        for (let i = 0; i < cur.length - 1; i++) {
          if (cur[i] > cur[i + 1]) {
            await page.getByRole("button", { name: `Move step ${i + 1} down` }).click();
            moved = true;
            break;
          }
        }
        if (!moved) break;
        pass = -1 + pass; // keep going until sorted (bounded by the outer evaluate)
        if ((await page.locator("ol.order > li").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.step)))).every((v, i, a) => i === 0 || a[i - 1] < v)) break;
        pass = 0;
      }
      await page.getByRole("button", { name: "Check order" }).click();
      break;
    case "timing":
      for (let r = 0; r < l.rows.length; r++)
        for (let i = 0; i < l.slots.length; i++)
          if (l.rows[r].editable && l.rows[r].initial[i] !== l.rows[r].answer[i])
            await page.locator(".timing tbody tr").nth(r).locator("td button").nth(i).click();
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
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText(l.solution);
      await page.getByRole("button", { name: /^Run tests/ }).click();
      await page.waitForSelector(".bench .result");
      break;
  }
}

// E2E_FROM=<chapter number> plays only that chapter and the ones after it.
const FROM = Number(process.env.E2E_FROM ?? -99);

describe("playthrough", () => {
  for (const c of CHAPTERS.filter((x) => x.number >= FROM)) {
    for (const [i, l] of c.levels.entries()) {
      it(`${c.number}.${i + 1} ${l.title} (${kindOf(l)})`, async () => {
        errors.length = 0;
        // Start from the map whatever the previous level left behind.
        if (!(await page.locator(".map-cols").count())) await page.locator(".brand").click();
        await page.locator(`button[data-chapter="${c.id}"]`).click();
        await page.locator(`button[data-level="${l.id}"]`).click();
        await page.waitForSelector(".level-head");
        if (l.kind === "code") {
          // The untouched starter must not pass, and must show why: what was seen, but no pointer to the cause on the first failed run.
          await page.getByRole("button", { name: /^Run tests/ }).click();
          await page.waitForSelector(".bench .result.bad");
          expect(await page.locator(".bench .checks .hintline").count()).toBe(0);
          if (shots) await page.screenshot({ path: join(shots, `${c.number}-${i + 1}-${l.id}-starter.png`) });
        }
        await solve(l);
        await expect.poll(() => page.locator(".takeaway.passed").count(), { timeout: 10_000 }).toBeGreaterThan(0);
        expect(await page.locator(".takeaway.passed").innerText()).toContain("Level passed");
        // A pass without the last hint or the reference solution is a plain pass.
        expect(await page.locator(".takeaway.passed.assisted").count()).toBe(0);
        // The next step is in view and, outside the code editor, has the focus.
        expect(await page.locator(".takeaway.passed .btn.primary").isVisible()).toBe(true);
        // Nothing may spill sideways out of the window.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
        if (shots) await page.screenshot({ path: join(shots, `${c.number}-${i + 1}-${l.id}.png`) });
        expect(errors).toEqual([]);
        await page.locator(".level-head").getByRole("button", { name: "Map", exact: true }).click();
        await page.waitForSelector(".map-cols");
      });
    }
  }

  it("runs a program live and reacts to a held button", async () => {
    errors.length = 0;
    await page.locator(".topnav").getByRole("button", { name: "Sandbox" }).click();
    await page.waitForSelector(".cm-content");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForFunction(() => /t = \d{3}/.test(document.querySelector(".simstate")?.textContent ?? ""));
    const pb = page.getByRole("button", { name: /Push button PB1/ });
    await pb.dispatchEvent("pointerdown");
    await expect.poll(() => pb.getAttribute("aria-pressed")).toBe("true");
    await pb.dispatchEvent("pointerup");
    // Board and registers are visible together.
    await page.waitForSelector(".reglog");
    await page.waitForSelector(".parts");
    if (shots) await page.screenshot({ path: join(shots, "sandbox.png") });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    expect(errors).toEqual([]);
  });

  it("shows the handbook and settings", async () => {
    errors.length = 0;
    await page.locator(".topnav").getByRole("button", { name: "Handbook" }).click();
    // One search box covers every section; a result opens the right one.
    await page.fill("#hb-search", "TBCTL");
    await page.getByRole("button", { name: /^EPwm1Regs\.TBCTL\b/ }).first().click();
    await page.waitForSelector(".hb-reg-detail table.fields");
    // Only one peripheral's registers are in the page at a time.
    expect(await page.locator(".hb-col button").count()).toBeLessThan(400);
    if (shots) await page.screenshot({ path: join(shots, "handbook.png") });
    await page.locator(".topnav").getByRole("button", { name: "Settings" }).click();
    await page.waitForSelector("text=Text size");
    if (shots) await page.screenshot({ path: join(shots, "settings.png") });
    await page.locator(".topnav").getByRole("button", { name: "Map" }).click();
    await page.waitForSelector(".map-cols");
    if (shots) await page.screenshot({ path: join(shots, "map-after.png"), fullPage: true });
    expect(errors).toEqual([]);
  });

  // Opens a level from the map with this progress stored.
  async function openWith(save: Record<string, unknown>, chapter?: string, level?: string): Promise<void> {
    if (!(await page.locator(".map-cols").count())) await page.locator(".brand").click();
    await page.evaluate((text) => localStorage.setItem("bringup-save-v1", text), JSON.stringify({ version: 1, passed: {}, hints: {}, code: {}, unlockAll: true, ...save }));
    await page.reload();
    await page.waitForSelector(".map-cols");
    if (!chapter || !level) return;
    await page.locator(`button[data-chapter="${chapter}"]`).click();
    await page.locator(`button[data-level="${level}"]`).click();
    await page.waitForSelector(".level-head");
  }
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("bringup-save-v1")!));

  it("suggests a warm-up of due puzzles, plays it from clean widgets and reschedules them", async () => {
    errors.length = 0;
    const calcs = CHAPTERS.flatMap((c) => c.levels.filter((l) => l.kind === "calc").slice(0, 1).map((l) => ({ c, l }))).slice(0, 3);
    expect(calcs).toHaveLength(3);
    const day = 86_400_000;
    const passed = Object.fromEntries(calcs.map((x) => [x.l.id, true]));
    // Passed yesterday: nothing is due.
    await openWith({ passed, passedAt: Object.fromEntries(calcs.map((x) => [x.l.id, Date.now() - day])) });
    expect(await page.locator(".warmup").count()).toBe(0);
    // Passed nine days ago: three questions from three chapters.
    await openWith({ passed, passedAt: Object.fromEntries(calcs.map((x, i) => [x.l.id, Date.now() - (9 - i) * day])) });
    expect(await page.locator(".warmup h2").innerText()).toContain("3 quick questions");
    await page.getByRole("button", { name: "Start the warm-up" }).click();
    for (const [i, { l }] of calcs.entries()) {
      await page.waitForSelector(".level-head.warm");
      expect(await page.locator(".level-head .eyebrow").innerText()).toMatch(new RegExp(`warm-up ${i + 1} of 3`, "i"));
      expect(await page.locator(".level-head h1").innerText()).toContain(l.title);
      // A passed level shows no answers and no "passed" box until it is answered again.
      expect(await page.locator(".calc-field input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(""))).toBe("");
      expect(await page.locator(".takeaway.passed").count()).toBe(0);
      if (l.kind !== "calc") throw new Error("not a calc level");
      if (i === 1) {
        // A wrong first answer is a miss, even when the next try is right.
        for (const f of l.fields) await page.fill(`#calc-${f.id}`, String(f.answer + 7));
        await page.getByRole("button", { name: "Check", exact: true }).click();
      }
      await solve(l);
      await page.waitForSelector(".takeaway.passed");
      await page.getByRole("button", { name: i < 2 ? "Next question" : "Finish the warm-up" }).click();
    }
    await page.waitForSelector(".map-cols");
    expect(await page.locator(".warm-note").innerText()).toContain("2 of 3 right at the first try");
    // One warm-up a day: the card is gone, also after a reload.
    expect(await page.locator(".warmup").count()).toBe(0);
    const s = await stored();
    expect(calcs.map((x) => s.reviews[x.l.id].interval)).toEqual([5, 2, 5]);
    await page.reload();
    await page.waitForSelector(".map-cols");
    expect(await page.locator(".warmup").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("hides the warm-up until tomorrow when it is dismissed", async () => {
    errors.length = 0;
    const quick = CHAPTERS.flatMap((c) => c.levels.filter((l) => l.kind === "calc" || l.kind === "register").slice(0, 1)).slice(0, 3);
    await openWith({ passed: Object.fromEntries(quick.map((l) => [l.id, true])), passedAt: Object.fromEntries(quick.map((l) => [l.id, Date.now() - 5 * 86_400_000])) });
    await page.getByRole("button", { name: "Not today" }).click();
    expect(await page.locator(".warmup").count()).toBe(0);
    expect((await stored()).reviews).toEqual({});
    expect(errors).toEqual([]);
  });

  const timed = CHAPTERS.flatMap((c) => c.levels.map((l) => ({ c, l }))).find((x) => x.l.kind === "code" && (x.l.bonus ?? []).some((b) => b.kind === "isr-time"));

  it("keeps a personal best for a measured star and says when it improves", async () => {
    errors.length = 0;
    if (!timed || timed.l.kind !== "code") throw new Error("no code level with a timed star");
    const label = timed.l.bonus!.find((b) => b.kind === "isr-time")!.label;
    // A slow earlier best: the reference solution beats it.
    await openWith({ passed: { [timed.l.id]: true }, bests: { [timed.l.id]: { [label]: 500 } } }, timed.c.id, timed.l.id);
    expect(await page.locator(".bench .checks.bonus .best").first().innerText()).toContain("Best: 500 us");
    await solve(timed.l);
    await page.waitForSelector(".bench .result.ok");
    expect(await page.locator(".takeaway.passed .best-line").innerText()).toMatch(/New best: [\d.]+ us \(was 500 us\)/);
    expect(await page.locator(".bench .checks.bonus .best-new").count()).toBe(1);
    const best = (await stored()).bests[timed.l.id][label];
    expect(best).toBeLessThan(500);
    // The same program again: the best stays, and nothing claims to be new.
    await page.getByRole("button", { name: /^Run tests/ }).click();
    await expect.poll(() => page.locator(".bench .checks.bonus .best-new").count()).toBe(0);
    expect((await stored()).bests[timed.l.id][label]).toBe(best);
    expect(errors).toEqual([]);
  });

  it("shows a code level as three tabs in a narrow window, with the test result always in view", async () => {
    errors.length = 0;
    if (!timed || timed.l.kind !== "code") throw new Error("no code level");
    await page.setViewportSize({ width: 480, height: 900 });
    try {
      await openWith({}, timed.c.id, timed.l.id);
      const selected = () => page.locator('[role="tab"][aria-selected="true"]').innerText();
      expect(await page.getByRole("tab").count()).toBe(3);
      expect(await selected()).toBe("Read");
      expect(await page.locator(".pane.brief").isVisible()).toBe(true);
      expect(await page.locator(".cm-content").isVisible()).toBe(false);
      // The arrow keys move along the tabs; each tab names its panel.
      await page.getByRole("tab", { name: "Read" }).focus();
      await page.keyboard.press("ArrowRight");
      expect(await selected()).toBe("Code");
      expect(await page.getByRole("tabpanel", { name: "Code" }).isVisible()).toBe(true);
      expect(await page.locator(".cm-content").isVisible()).toBe(true);
      // A failed run: the verdict and the first thing to fix show without leaving the editor.
      await page.getByRole("button", { name: /^Run tests/ }).click();
      await expect.poll(() => page.locator(".tab-verdict").innerText()).toMatch(/tests passed|compile|error/i);
      expect(await page.locator(".tab-verdict").isVisible()).toBe(true);
      expect(await selected()).toBe("Code");
      // A pass opens the Board tab, where the next step is.
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText(timed.l.solution);
      await page.getByRole("button", { name: /^Run tests/ }).click();
      await page.waitForSelector(".takeaway.passed");
      expect(await selected()).toBe("Board");
      expect(await page.locator(".tab-verdict").innerText()).toContain("All tests passed");
      expect(await page.locator(".takeaway.passed .btn.primary").isVisible()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "horizontal overflow").toBeLessThanOrEqual(1);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    // Wide again: three panes side by side, no tabs.
    await expect.poll(() => page.getByRole("tab").count()).toBe(0);
    expect(await page.locator(".cm-content").isVisible()).toBe(true);
    expect(await page.locator(".pane.brief").isVisible()).toBe(true);
    await page.locator(".level-head").getByRole("button", { name: "Map", exact: true }).click();
    await page.waitForSelector(".map-cols");
    expect(errors).toEqual([]);
  });

  it("marks finished chapters and parts on the map", async () => {
    errors.length = 0;
    const part = CHAPTERS.filter((c) => c.number < 0);
    await openWith({ passed: Object.fromEntries(part.flatMap((c) => c.levels).map((l) => [l.id, true])) });
    for (const c of part) expect(await page.locator(`button[data-chapter="${c.id}"]`).getAttribute("class")).toContain("done");
    expect(await page.locator(".part-done").count()).toBe(1);
    await page.locator(`button[data-chapter="${part[0].id}"]`).click();
    expect(await page.locator(".chapter-finished").innerText()).toContain("Chapter finished");
    expect(await page.locator(".stats").innerText()).toMatch(new RegExp(`chapters finished\\s*${part.length}\\s*/${CHAPTERS.length}`, "i"));
    await openWith({});
    expect(errors).toEqual([]);
  });

  it("keeps the handbook's scroll position", async () => {
    errors.length = 0;
    await page.locator(".topnav").getByRole("button", { name: "Handbook" }).click();
    await page.fill("#hb-search", "");
    await page.locator(".hb-sections").getByRole("button", { name: "Key diagrams" }).click();
    await page.waitForSelector(".hb-grid .hb-card");
    // The diagrams are cards, not ninety live figures in one page.
    expect(await page.locator(".hb-content .figure").count()).toBe(0);
    const top = () => page.evaluate(() => document.querySelector(".hb-content")!.scrollTop);
    // Scrolling down in steps never jumps back up.
    await page.locator(".hb-content").hover();
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(40);
      const t = await top();
      expect(t, `scroll step ${i}`).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(prev).toBeGreaterThan(0);
    // Open the last card: one figure, and using it does not move the page.
    const last = page.locator(".hb-card").last();
    const id = await last.getAttribute("data-figure");
    await last.click();
    await page.waitForSelector(".hb-figure .figure, .hb-figure .fig-missing");
    expect(await page.locator(".hb-content .figure").count()).toBeLessThanOrEqual(1);
    const control = page.locator(".hb-figure .figure button:enabled, .hb-figure .figure input:enabled").last();
    if (await control.count()) {
      await control.scrollIntoViewIfNeeded();
      const before = await top();
      if ((await control.evaluate((e) => e.tagName)) === "BUTTON") await control.click();
      else await control.focus().then(() => page.keyboard.press("ArrowRight"));
      await page.waitForTimeout(150);
      expect(Math.abs((await top()) - before), "scroll after using a figure").toBeLessThanOrEqual(2);
    }
    // Back: the grid is where it was left and the card has the focus again.
    await page.getByRole("button", { name: "All diagrams" }).click();
    await page.waitForSelector(".hb-grid");
    expect(Math.abs((await top()) - prev), "grid scroll restored").toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-figure"))).toBe(id);
    // Leaving for another screen and coming back keeps the section and the position.
    await page.locator(".topnav").getByRole("button", { name: "Settings" }).click();
    await page.locator(".topnav").getByRole("button", { name: "Handbook" }).click();
    await page.waitForSelector(".hb-grid");
    expect(Math.abs((await top()) - prev), "scroll kept across screens").toBeLessThanOrEqual(2);
    await page.locator(".topnav").getByRole("button", { name: "Map" }).click();
    await page.waitForSelector(".map-cols");
    expect(errors).toEqual([]);
  });
});
