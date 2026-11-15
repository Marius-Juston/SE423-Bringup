// Builds the game, serves the build, finds Chromium and reads the level data.
import { build, createServer, preview } from "vite";
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { REPO } from "./findings.mjs";

/** Playwright's cached Chromium, or CHROME=<path> (the same rule as tools/shot.mjs). */
export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const sub = readdirSync(join(cache, d)).find((x) => x.startsWith("chrome"));
    if (sub && existsSync(join(cache, d, sub, "chrome"))) return join(cache, d, sub, "chrome");
  }
  throw new Error("No Chromium found: run `npx playwright-core install chromium` or set CHROME.");
}

export const launch = () => chromium.launch({ executablePath: findChrome() });

/**
 * axe-core, from the exact version in package.json. `npm ci` checks the package against the
 * integrity hash in package-lock.json; this checks that what is installed is that version.
 */
export function axeSource() {
  const require = createRequire(join(REPO, "package.json"));
  const want = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).devDependencies["axe-core"];
  const have = require("axe-core/package.json").version;
  if (!/^\d+\.\d+\.\d+$/.test(want)) throw new Error(`axe-core must be pinned to an exact version in package.json (found "${want}")`);
  if (have !== want) throw new Error(`axe-core ${have} is installed but package.json pins ${want}: run npm ci`);
  const source = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  return { source, version: have, sha256: createHash("sha256").update(source).digest("hex") };
}

/** Builds the game into `outDir` (unless it is already there and `reuse`), and serves it. */
export async function serveGame({ outDir, reuse = false }) {
  const dir = resolve(outDir);
  if (!(reuse && existsSync(join(dir, "index.html")))) {
    await build({ root: REPO, logLevel: "warn", build: { outDir: dir, emptyOutDir: true } });
  }
  const server = await preview({ root: REPO, logLevel: "silent", build: { outDir: dir }, preview: { port: 4184, strictPort: false, host: "127.0.0.1" } });
  const baseUrl = server.resolvedUrls.local[0];
  return { baseUrl, close: () => new Promise((r) => server.httpServer.close(() => r())) };
}

/**
 * The level data and the register layout, loaded from the TypeScript sources the way the
 * game loads them (the chapters are found with import.meta.glob, so this goes through Vite).
 */
export async function loadLevels() {
  const vite = await createServer({ root: REPO, logLevel: "error", server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { CHAPTERS } = await vite.ssrLoadModule("/src/levels/index.ts");
    const { layoutOf } = await vite.ssrLoadModule("/src/ui/widgets/RegisterPuzzle.tsx");
    // Plain data: nothing below needs Vite again.
    const chapters = CHAPTERS.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      levels: c.levels.map((l) => {
        const plain = JSON.parse(JSON.stringify(l));
        if (l.kind === "register") {
          const { bits, fields } = layoutOf(l);
          plain.layout = { bits, fields: fields.map((f) => ({ name: f.name, hi: f.hi, lo: f.lo })) };
        }
        return plain;
      }),
    }));
    const { SANDBOX_STARTERS } = await vite.ssrLoadModule("/src/ui/sandbox-starters/index.ts");
    const starters = SANDBOX_STARTERS.map((x) => ({ id: x.id, kit: x.kit }));
    return { chapters, starters };
  } finally {
    await vite.close();
  }
}

export const SAVE_KEY = "bringup-save-v1";
export const PREF_KEY = "bringup-ui-v1";
export const emptySave = (extra = {}) => JSON.stringify({ version: 1, passed: {}, hints: {}, code: {}, unlockAll: true, ...extra });
