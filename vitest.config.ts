import { defineConfig } from "vitest/config";
import { figureMeta } from "./tools/figure-meta.ts";

// Unit tests and level checks. The browser playthrough has its own config.
export default defineConfig({
  plugins: [figureMeta()],
  test: { include: ["tests/*.test.ts"], testTimeout: 120_000 },
});
