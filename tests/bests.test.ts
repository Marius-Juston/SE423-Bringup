import { describe, expect, it } from "vitest";
import { compareBests, fmt, improves, measure, unitOf } from "../src/ui/bests";
import type { Check } from "../src/sim/runner";

const isr: Check = { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1, label: "Fast interrupt" };
const odo: Check = { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 6.6, label: "Short path" };
const fast: Check = { kind: "signal", name: "TB_VLEFT", at: 45, min: 0.9, label: "Quick start" };
const line: Check = { kind: "signal", name: "ROBOT_ODOMETER_FT", equals: 3, tol: 0.02, label: "On the line" };
const band: Check = { kind: "signal", name: "LIDAR_FRONT_FT", min: 0.9, max: 1.2, label: "Near the wall" };
const led: Check = { kind: "led", led: "LED1", at: 10, on: true, label: "LED on" };

describe("personal bests", () => {
  it("reads units from the signal name", () => {
    expect(unitOf("ROBOT_ODOMETER_FT")).toBe("ft");
    expect(unitOf("LEFT_WHEEL_RADPS")).toBe("rad/s");
    expect(unitOf("ROBOT_THETA_RAD")).toBe("rad");
    expect(unitOf("TB_VLEFT_PEAK")).toBe("ft/s");
    expect(unitOf("SPIB_WORDS")).toBe("");
  });

  it("formats values briefly", () => {
    expect(fmt(8.3)).toBe("8.3");
    expect(fmt(0.4236)).toBe("0.424");
    expect(fmt(11.26)).toBe("11.3");
    expect(fmt(1234.56)).toBe("1235");
    expect(fmt(0)).toBe("0");
  });

  it("counts lower as better for times and limits", () => {
    expect(measure(isr, 0.42)!.text).toBe("0.42 us");
    expect(improves(isr, 0.42, 0.61)).toBe(true);
    expect(improves(isr, 0.61, 0.42)).toBe(false);
    expect(improves(isr, 0.42, 0.42)).toBe(false);
    expect(improves(isr, 0.42, undefined)).toBe(true);
    expect(measure(odo, 5.31)!.text).toBe("5.31 ft");
    expect(improves(odo, 5.3, 6.1)).toBe(true);
  });

  it("counts higher as better for a check with only a minimum", () => {
    expect(measure(fast, 0.95)!.text).toBe("0.95 ft/s");
    expect(improves(fast, 0.97, 0.95)).toBe(true);
    expect(improves(fast, 0.93, 0.95)).toBe(false);
  });

  it("counts the distance from a target or from the middle of a range", () => {
    expect(measure(line, 3.004)!.text).toBe("0.004 ft off target");
    expect(improves(line, 2.999, 3.004)).toBe(true);
    expect(improves(line, 3.01, 2.999)).toBe(false);
    expect(measure(band, 1.0)!.text).toBe("0.05 ft from the middle");
    expect(improves(band, 1.06, 1.0)).toBe(true);
  });

  it("measures nothing for checks without a number", () => {
    expect(measure(led, 1)).toBeNull();
    expect(improves(led, 1, undefined)).toBe(false);
    expect(measure(isr, NaN)).toBeNull();
  });

  it("compares a run with the stored bests and stores only improvements", () => {
    const bonus = [isr, odo, led];
    const first = compareBests(bonus, [{ value: 0.6 }, { value: 6.0 }, {}], undefined);
    expect(first.store).toEqual({ "Fast interrupt": 0.6, "Short path": 6.0 });
    expect(first.notes).toEqual([
      { label: "Fast interrupt", now: "0.6 us", was: undefined, improved: true },
      { label: "Short path", now: "6 ft", was: undefined, improved: true },
    ]);
    const second = compareBests(bonus, [{ value: 0.45 }, { value: 6.2 }, {}], first.store);
    expect(second.store).toEqual({ "Fast interrupt": 0.45 });
    expect(second.notes).toEqual([
      { label: "Fast interrupt", now: "0.45 us", was: "0.6 us", improved: true },
      { label: "Short path", now: "6.2 ft", was: "6 ft", improved: false },
    ]);
  });
});
