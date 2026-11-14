import { describe, expect, it } from "vitest";
import { clean, starsEarned } from "../src/ui/store";
import { prefValue, readPrefs } from "../src/ui/prefs";

describe("loading a save that was edited by hand or damaged", () => {
  it("refuses what is not a save", () => {
    for (const bad of [null, 5, "text", [], {}, { version: 2, passed: {} }, { version: "1", passed: {} }, { version: 1 }, { version: 1, passed: [] }, { version: 1, passed: "all" }]) expect(clean(bad)).toBeNull();
  });

  it("keeps each star once, in order, and drops what is not a star index", () => {
    const s = clean({ version: 1, passed: { a: true, b: true, c: true, d: true }, stars: { a: [1, 0, 1, 0, 0], b: [0.5, -1, "0", 2, 1e308, null], c: ["x"], d: "all" } })!;
    expect(s.stars).toEqual({ a: [0, 1], b: [2] });
  });

  it("counts only the stars a level still has", () => {
    const save = { stars: { a: [0, 2, 5], b: [3, 4] } };
    expect(starsEarned(save, "a", 3)).toBe(2);
    expect(starsEarned(save, "a", 1)).toBe(1);
    expect(starsEarned(save, "b", 2)).toBe(0);
    expect(starsEarned(save, "none", 2)).toBe(0);
  });

  it("drops numbers that are not counts and marks without a pass", () => {
    const s = clean({
      version: 1,
      passed: { a: true, b: "true", c: 1 },
      assisted: { a: true, z: true },
      hints: { a: 2, b: -1, c: "NaN", d: null },
      fails: { a: 1e308, b: -3 },
      passedAt: { a: -5, z: 10 },
      reviews: { a: { due: 5, interval: -2 }, z: { due: 5, interval: 2 } },
      code: { a: "int x;", b: 5 },
      warmupDay: 5,
    }, 1234)!;
    expect(s.passed).toEqual({ a: true });
    expect(s.assisted).toEqual({ a: true });
    expect(s.hints).toEqual({ a: 2 });
    expect(s.fails).toEqual({ a: 1e308 });
    expect(s.passedAt).toEqual({ a: 1234 });
    expect(s.reviews).toEqual({});
    expect(s.code).toEqual({ a: "int x;" });
    expect(s.warmupDay).toBe("");
  });

  it("never lets a \"__proto__\" key change what a map inherits", () => {
    const text = '{"version":1,"passed":{"__proto__":true,"a":true},"stars":{"__proto__":[0,1],"a":[0]},"reviews":{"__proto__":{"due":1,"interval":2}},"bests":{"__proto__":{"x":1}},"code":{"__proto__":"x"},"__proto__":{"polluted":true}}';
    const s = clean(JSON.parse(text))!;
    for (const m of [s.passed, s.stars, s.reviews, s.bests, s.code]) expect(Object.getPrototypeOf(m)).toBe(Object.prototype);
    expect(s.stars).toEqual({ a: [0] });
    expect(Object.keys(s.reviews)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("loads a save from before stars, help and dates were recorded", () => {
    const s = clean({ version: 1, passed: { a: true }, hints: { a: 1 }, code: { a: "x" }, unlockAll: true }, 99)!;
    expect(s).toEqual({ version: 1, passed: { a: true }, assisted: {}, stars: {}, hints: { a: 1 }, peeked: {}, fails: {}, code: { a: "x" }, unlockAll: true, passedAt: { a: 99 }, reviews: {}, warmupDay: "", bests: {} });
  });
});

describe("interface preferences", () => {
  it("reads only a map of preferences", () => {
    expect(readPrefs('{"theme":"dark"}')).toEqual({ theme: "dark" });
    for (const bad of [null, "", "not json", '"text"', "5", "[1,2]", "null"]) expect(readPrefs(bad)).toEqual({});
  });

  it("falls back when a stored value has the wrong type", () => {
    const all = { "text-scale": "big", theme: "dark", "hb-q": 5, "w-bench": "wide", n: 1.15, bad: null };
    expect(prefValue(all, "text-scale", 1)).toBe(1);
    expect(prefValue(all, "n", 1)).toBe(1.15);
    expect(prefValue(all, "theme", "system")).toBe("dark");
    expect(prefValue(all, "hb-q", "")).toBe("");
    expect(prefValue(all, "bad", false)).toBe(false);
    expect(prefValue(all, "missing", "x")).toBe("x");
    expect(prefValue(all, "toString", "x")).toBe("x");
    // A preference without a typed fallback (a pane width not chosen yet) is passed on as stored.
    expect(prefValue<number | null>(all, "w-bench", null)).toBe("wide");
  });
});
