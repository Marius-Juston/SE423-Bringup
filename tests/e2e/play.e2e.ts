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
        if (want !== have) await page.locator(`button.bit[aria-label^="Bit ${b}:"], button.bit[aria-label^="Bit ${b},"]`).click();
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

describe("playthrough", () => {
  for (const c of CHAPTERS) {
    for (const [i, l] of c.levels.entries()) {
      it(`${c.number}.${i + 1} ${l.title} (${kindOf(l)})`, async () => {
        errors.length = 0;
        await page.locator(`button[data-chapter="${c.id}"]`).click();
        await page.locator(`button[data-level="${l.id}"]`).click();
        await page.waitForSelector(".level-head");
        if (l.kind === "code") {
          // The untouched starter must not pass, and must show why.
          await page.getByRole("button", { name: /^Run tests/ }).click();
          await page.waitForSelector(".bench .result.bad");
          if (shots) await page.screenshot({ path: join(shots, `${c.number}-${i + 1}-${l.id}-starter.png`) });
        }
        await solve(l);
        await expect.poll(() => page.locator(".takeaway").count(), { timeout: 10_000 }).toBeGreaterThan(0);
        expect(await page.locator(".takeaway").first().innerText()).toContain("Level passed");
        // Nothing may spill sideways out of the window.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
        if (shots) await page.screenshot({ path: join(shots, `${c.number}-${i + 1}-${l.id}.png`) });
        expect(errors).toEqual([]);
        await page.locator(".level-head").getByRole("button", { name: "Map" }).click();
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
    await page.waitForSelector(".reg-row");
    await page.waitForSelector(".parts");
    if (shots) await page.screenshot({ path: join(shots, "sandbox.png") });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    expect(errors).toEqual([]);
  });

  it("shows the handbook and settings", async () => {
    errors.length = 0;
    await page.locator(".topnav").getByRole("button", { name: "Handbook" }).click();
    await page.fill("#regsearch", "TBCTL");
    await page.getByRole("button", { name: "EPwm1Regs.TBCTL", exact: true }).click();
    await page.waitForSelector("table.fields");
    if (shots) await page.screenshot({ path: join(shots, "handbook.png") });
    await page.locator(".topnav").getByRole("button", { name: "Settings" }).click();
    await page.waitForSelector("text=Unlock every chapter");
    if (shots) await page.screenshot({ path: join(shots, "settings.png") });
    await page.locator(".topnav").getByRole("button", { name: "Map" }).click();
    await page.waitForSelector(".map-cols");
    if (shots) await page.screenshot({ path: join(shots, "map-after.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
});
