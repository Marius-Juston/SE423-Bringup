import { describe, expect, it } from "vitest";
import { autoWindowMs, WINDOW_DEFAULT_MS } from "../src/ui/code/window";

const MS = 1e6;
const isr = (periodMs: number, n = 100, name = "f") => Array.from({ length: n }, (_, i) => ({ t: i * periodMs * MS, name }));
const pin = (halfMs: number, n = 20) => Array.from({ length: n }, (_, i) => ({ t: i * halfMs * MS }));

describe("the time a live run shows", () => {
  it("holds about thirty runs of the fastest interrupt function, on a round size", () => {
    expect(autoWindowMs({ isrLog: isr(1), pins: [] })).toBe(50);
    expect(autoWindowMs({ isrLog: isr(0.1), pins: [] })).toBe(5);
    expect(autoWindowMs({ isrLog: isr(100, 20), pins: [] })).toBe(5000);
    // The fastest function decides when several run.
    const mixed = [...isr(100, 10, "slow"), ...isr(1, 100, "fast")].sort((a, b) => a.t - b.t);
    expect(autoWindowMs({ isrLog: mixed, pins: [] })).toBe(50);
  });
  it("uses the fastest pin when no interrupt function runs, and a default when nothing happens", () => {
    expect(autoWindowMs({ isrLog: [], pins: [pin(500)] })).toBe(10000);
    expect(autoWindowMs({ isrLog: [], pins: [pin(0.025)] })).toBe(1);
    expect(autoWindowMs({ isrLog: [], pins: [] })).toBe(WINDOW_DEFAULT_MS);
    expect(autoWindowMs({ isrLog: [{ t: 0, name: "once" }], pins: [[{ t: 0 }]] })).toBe(WINDOW_DEFAULT_MS);
  });
  it("keeps its size while the rate changes a little, and follows a large change", () => {
    const at = autoWindowMs({ isrLog: isr(1), pins: [] });
    expect(autoWindowMs({ isrLog: isr(1.5), pins: [] }, at)).toBe(at);
    expect(autoWindowMs({ isrLog: isr(0.7), pins: [] }, at)).toBe(at);
    expect(autoWindowMs({ isrLog: isr(20), pins: [] }, at)).toBe(1000);
    expect(autoWindowMs({ isrLog: isr(0.05), pins: [] }, at)).toBe(2);
    // Nothing periodic any more: the window stays as it was.
    expect(autoWindowMs({ isrLog: [], pins: [] }, at)).toBe(at);
  });
});
