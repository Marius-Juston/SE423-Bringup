import { describe, expect, it } from "vitest";
import { hashOf, viewOf } from "../src/ui/route";
import { clean } from "../src/ui/store";

describe("screen addresses", () => {
  it("round-trips every screen", () => {
    for (const v of [{ name: "map" }, { name: "level", id: "out-blink" }, { name: "handbook" }, { name: "sandbox" }, { name: "settings" }] as const) expect(viewOf(hashOf(v))).toEqual(v);
  });
  it("falls back to the map for an unknown level or a broken address", () => {
    expect(viewOf("#/level/no-such-level")).toEqual({ name: "map" });
    expect(viewOf("#/level/%E0%A4%A")).toEqual({ name: "map" });
    expect(viewOf("#/nowhere")).toEqual({ name: "map" });
    expect(viewOf("")).toEqual({ name: "map" });
  });
});

describe("saved progress", () => {
  it("keeps which solutions were opened, and loads saves from before that was recorded", () => {
    expect(clean({ version: 1, passed: {}, peeked: { a: true, b: 1 } })!.peeked).toEqual({ a: true });
    expect(clean({ version: 1, passed: {} })!.peeked).toEqual({});
  });
});
