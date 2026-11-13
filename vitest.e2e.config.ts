import { defineConfig } from "vitest/config";

// Plays every level through the real interface in a headless browser.
// Run with: npm run e2e   (builds first, then starts a preview server)
export default defineConfig({
  test: { include: ["tests/e2e/*.e2e.ts"], testTimeout: 90_000, hookTimeout: 120_000, fileParallelism: false },
});
