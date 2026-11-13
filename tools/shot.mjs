#!/usr/bin/env node
// Screenshots one figure, one level, the map or the handbook, for checking visuals.
//   node tools/shot.mjs figure <figure-id> <out.png> [--click "button text"]... [--width 700]
//   node tools/shot.mjs level <level-id> <out.png> [--code file.c] [--run 1500 | --tests] [--tab Read|Code|Board] [--width 1500] [--height 950]
//   node tools/shot.mjs map <out.png> [--chapter <chapter-id>] [--full]
//   node tools/shot.mjs handbook <out.png> [--section "Key diagrams"] [--search text] [--figure <figure-id>] [--full]
// --tests does nothing on a level without code. --save <file.json> starts
// from that progress file (as exported in Settings) instead of an empty one.
// Add --dark to any form for the dark theme.
// Starts its own dev server on a free port. Needs Playwright's Chromium
// (~/.cache/ms-playwright) or CHROME=<path to a Chromium binary>.
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const sub = readdirSync(join(cache, d)).find((x) => x.startsWith("chrome"));
    if (sub && existsSync(join(cache, d, sub, "chrome"))) return join(cache, d, sub, "chrome");
  }
  throw new Error("No Chromium found: run `npx playwright install chromium` or set CHROME.");
}

const argv = process.argv.slice(2);
const kind = argv[0];
// The map and the handbook take no id.
const whole = kind === "map" || kind === "handbook";
const [id, out, ...rest] = whole ? ["", ...argv.slice(1)] : argv.slice(1);
if (!["figure", "level", "map", "handbook"].includes(kind) || (!whole && !id) || !out || out.startsWith("--")) {
  console.error("usage: shot.mjs figure|level <id> <out.png> [options]\n       shot.mjs map|handbook <out.png> [options]");
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const clicks = rest.flatMap((a, i) => (a === "--click" ? [rest[i + 1]] : []));

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: findChrome() });
const errors = [];
try {
  const page = await browser.newPage({ colorScheme: rest.includes("--dark") ? "dark" : "light", viewport: { width: +opt("width", kind === "figure" ? 700 : 1500), height: +opt("height", 950) }, deviceScaleFactor: kind === "figure" ? 2 : 1 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (kind === "figure") {
    await page.goto(`${url}?figure=${encodeURIComponent(id)}`);
    await page.waitForSelector(".figure, .fig-missing");
    for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
    await page.locator(".figure, .fig-missing").first().screenshot({ path: out });
  } else {
    await page.goto(url);
    const save = opt("save") ? readFileSync(opt("save"), "utf8") : JSON.stringify({ version: 1, passed: {}, stars: {}, hints: {}, code: {}, unlockAll: true });
    await page.evaluate((text) => localStorage.setItem("bringup-save-v1", text), save);
    await page.reload();
    await page.waitForSelector(".map-cols");
    const fullPage = rest.includes("--full");
    if (kind === "map") {
      if (opt("chapter")) await page.locator(`button[data-chapter="${opt("chapter")}"]`).click();
      for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
      // The map scrolls inside <main>: a full shot needs a window as tall as the page.
      if (fullPage) await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(8000, (await page.evaluate(() => document.querySelector("main").scrollHeight)) + 60) });
      await page.screenshot({ path: out });
    } else if (kind === "handbook") {
      await page.locator(".topnav").getByRole("button", { name: "Handbook" }).click();
      await page.waitForSelector(".hb-content");
      if (opt("section") || opt("figure")) await page.locator(".hb-sections").getByRole("button", { name: opt("figure") ? "Key diagrams" : opt("section") }).click();
      if (opt("figure")) {
        await page.locator(`.hb-card[data-figure="${opt("figure")}"]`).click();
        await page.waitForSelector(".hb-figure .figure, .hb-figure .fig-missing");
      }
      if (opt("search")) await page.fill("#hb-search", opt("search"));
      for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
      if (fullPage) await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(8000, (await page.evaluate(() => document.querySelector(".hb-content").scrollHeight)) + 120) });
      await page.screenshot({ path: out });
    } else {
      // Levels are listed per chapter: try each chapter until the level shows.
      for (const tile of await page.locator("button[data-chapter]").all()) {
        await tile.click();
        if (await page.locator(`button[data-level="${id}"]`).count()) break;
      }
      await page.locator(`button[data-level="${id}"]`).click();
      await page.waitForSelector(".level-head");
      const isCode = (await page.locator(".cm-content").count()) > 0;
      // In a narrow window the editor is behind the Code tab.
      const codeTab = page.getByRole("tab", { name: "Code" });
      if (isCode && (await codeTab.count()) && (opt("code") || rest.includes("--tests") || opt("run"))) await codeTab.click();
      const code = opt("code");
      if (code && isCode) {
        await page.locator(".cm-content").click();
        await page.keyboard.press("Control+A");
        await page.keyboard.insertText(readFileSync(code, "utf8"));
      }
      // Only code levels have tests or a board to run.
      if (rest.includes("--tests") && isCode) {
        await page.getByRole("button", { name: /^Run tests/ }).click();
        await page.waitForSelector(".bench .result", { state: "attached" });
      } else if (opt("run") && isCode) {
        await page.getByRole("button", { name: "Run", exact: true }).click();
        await page.waitForTimeout(+opt("run"));
      }
      for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
      const tab = opt("tab");
      if (tab && (await page.getByRole("tab", { name: tab }).count())) await page.getByRole("tab", { name: tab }).click();
      await page.screenshot({ path: out });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : `saved ${out}`);
process.exit(errors.length ? 1 : 0);
