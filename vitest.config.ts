import { defineConfig } from "vitest/config";

// Unit tests and level checks. The browser playthrough has its own config.
export default defineConfig({
  test: { include: ["tests/*.test.ts"], testTimeout: 30_000 },
});
