#!/usr/bin/env node
// Screenshots one figure or one level of the game, for checking visuals.
//   node tools/shot.mjs figure <figure-id> <out.png> [--click "button text"]... [--width 700]
//   node tools/shot.mjs level <level-id> <out.png> [--code file.c] [--run 1500 | --tests] [--width 1500] [--height 950]
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

const [kind, id, out, ...rest] = process.argv.slice(2);
if (!kind || !id || !out) {
  console.error("usage: shot.mjs figure|level <id> <out.png> [options]");
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
  const page = await browser.newPage({ viewport: { width: +opt("width", kind === "figure" ? 700 : 1500), height: +opt("height", 950) }, deviceScaleFactor: kind === "figure" ? 2 : 1 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (kind === "figure") {
    await page.goto(`${url}?figure=${encodeURIComponent(id)}`);
    await page.waitForSelector(".figure, .fig-missing");
    for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
    await page.locator(".figure, .fig-missing").first().screenshot({ path: out });
  } else {
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem("bringup-save-v1", JSON.stringify({ version: 1, passed: {}, stars: {}, hints: {}, code: {}, unlockAll: true })));
    await page.reload();
    await page.waitForSelector(".chapters");
    // The level may sit in a folded chapter: open every chapter first.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    await page.locator(`button[data-level="${id}"]`).click();
    await page.waitForSelector(".level-head");
    const code = opt("code");
    if (code) {
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText(readFileSync(code, "utf8"));
    }
    if (rest.includes("--tests")) {
      await page.getByRole("button", { name: "Run tests" }).click();
      await page.waitForSelector(".bench .result");
    } else if (opt("run")) {
      await page.getByRole("button", { name: "▶ Run" }).click();
      await page.waitForTimeout(+opt("run"));
    }
    for (const c of clicks) await page.getByRole("button", { name: c }).first().click();
    await page.screenshot({ path: out });
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : `saved ${out}`);
process.exit(errors.length ? 1 : 0);
