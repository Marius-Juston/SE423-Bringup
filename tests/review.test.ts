import { describe, expect, it } from "vitest";
import { INTERVALS, dayKey, dueAt, dueLevels, firstReview, nextReview, pickSession, sessionSummary, type ReviewChapter, type ReviewState } from "../src/ui/review";
import { clean } from "../src/ui/store";

// Fixed local dates: the scheduler works in calendar days of the student's clock
// (March 2026 also crosses a clock change where there is one).
const at = (day: number, hour = 10) => new Date(2026, 2, day, hour).getTime();

const CHAPTERS: ReviewChapter[] = [
  { id: "bits", levels: [{ id: "b-brief", kind: "brief" }, { id: "b-reg", kind: "register" }, { id: "b-calc", kind: "calc" }, { id: "b-code", kind: "code" }] },
  { id: "timers", levels: [{ id: "t-calc", kind: "calc" }, { id: "t-quiz", kind: "quiz" }] },
  { id: "pwm", levels: [{ id: "p-order", kind: "order" }, { id: "p-timing", kind: "timing" }, { id: "p-wiring", kind: "wiring" }] },
];

function state(passedAt: Record<string, number>, more: Partial<ReviewState> = {}): ReviewState {
  return { passed: Object.fromEntries(Object.keys(passedAt).map((id) => [id, true as const])), passedAt, reviews: {}, warmupDay: "", ...more };
}

describe("spaced review schedule", () => {
  it("waits 2, 5, 12, then 30 days after reviews that were right at the first try", () => {
    const first = firstReview(at(1));
    expect(first).toEqual({ due: at(3), interval: 2 });
    let r = nextReview(first, true, at(3));
    expect(r).toEqual({ due: at(8), interval: 5 });
    r = nextReview(r, true, at(8));
    expect(r).toEqual({ due: at(20), interval: 12 });
    r = nextReview(r, true, at(20));
    expect(r.interval).toBe(30);
    expect(r.due).toBe(at(50));
    // The longest wait stays the longest.
    expect(nextReview(r, true, at(50)).interval).toBe(30);
    expect([...INTERVALS]).toEqual([2, 5, 12, 30]);
  });

  it("starts again at 2 days after a miss, wherever the level was", () => {
    expect(nextReview({ due: at(1), interval: 30 }, false, at(4))).toEqual({ due: at(6), interval: 2 });
    expect(nextReview(undefined, false, at(4))).toEqual({ due: at(6), interval: 2 });
    // The first review of a level that was never reviewed moves it to 5 days.
    expect(nextReview(undefined, true, at(4))).toEqual({ due: at(9), interval: 5 });
  });

  it("makes a passed puzzle due two days after the pass, for the whole of that day", () => {
    const s = state({ "b-reg": at(1, 22) });
    expect(dueAt(s, "b-reg")).toBe(at(3, 22));
    expect(dueLevels(CHAPTERS, s, at(2, 23))).toEqual([]);
    // Passed late in the evening: due from the morning two days later.
    expect(dueLevels(CHAPTERS, s, at(3, 7)).map((d) => d.id)).toEqual(["b-reg"]);
  });

  it("never schedules briefings, code levels or levels that are not passed", () => {
    const s = state({ "b-brief": at(1), "b-code": at(1), "b-reg": at(1) });
    s.passedAt["t-calc"] = at(1); // dated but not passed
    expect(dueLevels(CHAPTERS, s, at(20)).map((d) => d.id)).toEqual(["b-reg"]);
    expect(dueAt(s, "t-calc")).toBeUndefined();
  });

  it("uses a stored review instead of the pass date", () => {
    const s = state({ "b-reg": at(1) }, { reviews: { "b-reg": { due: at(15), interval: 12 } } });
    expect(dueLevels(CHAPTERS, s, at(10))).toEqual([]);
    expect(dueLevels(CHAPTERS, s, at(15)).map((d) => d.id)).toEqual(["b-reg"]);
  });
});

describe("choosing a warm-up", () => {
  it("suggests nothing until three puzzles are due", () => {
    const s = state({ "b-reg": at(1), "b-calc": at(1), "t-calc": at(9) });
    expect(pickSession(CHAPTERS, s, at(5))).toEqual([]);
    expect(pickSession(CHAPTERS, s, at(11))).toHaveLength(3);
  });

  it("takes the longest overdue levels from different chapters", () => {
    const s = state({ "b-reg": at(1), "b-calc": at(2), "t-calc": at(3), "t-quiz": at(4), "p-order": at(5), "p-timing": at(6) });
    // b-calc is older than t-calc, but bits already gives b-reg.
    expect(pickSession(CHAPTERS, s, at(20))).toEqual(["b-reg", "t-calc", "p-order"]);
  });

  it("fills up from the same chapter when too few chapters have something due", () => {
    const s = state({ "b-reg": at(1), "b-calc": at(2), "t-calc": at(3) });
    expect(pickSession(CHAPTERS, s, at(20))).toEqual(["b-reg", "b-calc", "t-calc"]);
    const one = state({ "p-order": at(3), "p-timing": at(2), "p-wiring": at(1) });
    expect(pickSession(CHAPTERS, one, at(20))).toEqual(["p-wiring", "p-timing", "p-order"]);
  });

  it("suggests one warm-up a day at most: started or dismissed, it is gone until tomorrow", () => {
    const s = state({ "b-reg": at(1), "t-calc": at(1), "p-order": at(1) }, { warmupDay: dayKey(at(10, 8)) });
    expect(pickSession(CHAPTERS, s, at(10, 23))).toEqual([]);
    expect(pickSession(CHAPTERS, s, at(11, 0))).toHaveLength(3);
    expect(dayKey(at(9, 23))).toBe("2026-03-09");
  });

  it("a reviewed level leaves the list until it is due again", () => {
    const s = state({ "b-reg": at(1), "t-calc": at(1), "p-order": at(1), "p-timing": at(1) });
    s.reviews["b-reg"] = nextReview(undefined, true, at(10)); // right: 5 days
    s.reviews["t-calc"] = nextReview(undefined, false, at(10)); // miss: 2 days
    expect(dueLevels(CHAPTERS, s, at(11)).map((d) => d.id)).toEqual(["p-order", "p-timing"]);
    expect(dueLevels(CHAPTERS, s, at(12)).map((d) => d.id)).toEqual(["p-order", "p-timing", "t-calc"]);
    expect(dueLevels(CHAPTERS, s, at(15)).map((d) => d.id)).toEqual(["p-order", "p-timing", "t-calc", "b-reg"]);
  });

  it("says how the warm-up went in one line", () => {
    expect(sessionSummary(3, 3)).toMatch(/^Warm-up done: 3 of 3 right at the first try\./);
    expect(sessionSummary(2, 3)).toContain("The other one comes back in 2 days.");
    expect(sessionSummary(0, 3)).toContain("The other 3 come back in 2 days.");
  });
});

describe("saves", () => {
  it("loads a save from before passes were dated: its puzzles are due two days after loading", () => {
    const old = { version: 1, passed: { "b-reg": true, "t-calc": true, "p-order": true }, hints: {}, code: {}, unlockAll: true };
    const s = clean(old, at(5))!;
    expect(s.passedAt).toEqual({ "b-reg": at(5), "t-calc": at(5), "p-order": at(5) });
    expect(s.reviews).toEqual({});
    expect(s.bests).toEqual({});
    expect(s.warmupDay).toBe("");
    expect(pickSession(CHAPTERS, s, at(6))).toEqual([]);
    expect(pickSession(CHAPTERS, s, at(7))).toHaveLength(3);
  });

  it("keeps dates, reviews and bests, and drops what is malformed", () => {
    const s = clean(
      {
        version: 1,
        passed: { a: true, b: true },
        passedAt: { a: 1000, b: "yesterday", gone: 5 },
        reviews: { a: { due: 2000, interval: 5 }, b: { due: "x", interval: 2 }, gone: { due: 1, interval: 2 } },
        bests: { a: { "Fast interrupt": 0.4 }, b: { bad: "fast" } },
        warmupDay: "2026-03-09",
      },
      at(5),
    )!;
    expect(s.passedAt).toEqual({ a: 1000, b: at(5) });
    expect(s.reviews).toEqual({ a: { due: 2000, interval: 5 } });
    expect(s.bests).toEqual({ a: { "Fast interrupt": 0.4 } });
    expect(s.warmupDay).toBe("2026-03-09");
  });
});
