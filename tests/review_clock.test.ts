// The warm-up schedule at day boundaries and across clock changes, with fixed
// clocks in a zone that has them (the course's own: US Central).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dayKey, dueLevels, firstReview, nextReview, pickSession, type ReviewChapter, type ReviewState } from "../src/ui/review";

const before = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Chicago";
});
afterAll(() => {
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
});

const t = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();
const HOUR = 3_600_000;
const CHAPTERS: ReviewChapter[] = [
  { id: "a", levels: [{ id: "a1", kind: "calc" }, { id: "a2", kind: "quiz" }] },
  { id: "b", levels: [{ id: "b1", kind: "order" }] },
];
const passedAt = (at: Record<string, number>, more: Partial<ReviewState> = {}): ReviewState => ({ passed: Object.fromEntries(Object.keys(at).map((id) => [id, true as const])), passedAt: at, reviews: {}, warmupDay: "", ...more });
const due = (s: ReviewState, now: number) => dueLevels(CHAPTERS, s, now).map((d) => d.id);

describe("review dates on the student's clock", () => {
  it("runs in a zone whose clocks change", () => {
    // 8 March 2026 has 23 hours and 1 November 2026 has 25 in US Central.
    expect(t(2026, 3, 9) - t(2026, 3, 8)).toBe(23 * HOUR);
    expect(t(2026, 11, 2) - t(2026, 11, 1)).toBe(25 * HOUR);
  });

  it("names a day from its first to its last millisecond", () => {
    expect(dayKey(t(2026, 3, 9, 0, 0, 0, 0))).toBe("2026-03-09");
    expect(dayKey(t(2026, 3, 9, 23, 59, 59, 999))).toBe("2026-03-09");
    expect(dayKey(t(2026, 3, 9, 23, 59, 59, 999) + 1)).toBe("2026-03-10");
    expect(dayKey(t(2026, 12, 31, 23, 59, 59, 999) + 1)).toBe("2027-01-01");
    // The hour that happens twice when the clocks go back is one day.
    expect(dayKey(t(2026, 11, 1, 0, 30) + HOUR)).toBe("2026-11-01");
    expect(dayKey(t(2026, 11, 1, 0, 30) + 2 * HOUR)).toBe("2026-11-01");
  });

  it("makes a level due at midnight of its due day, not a moment before", () => {
    const s = passedAt({ a1: t(2026, 4, 1, 23, 59, 59, 999) });
    expect(due(s, t(2026, 4, 2, 23, 59, 59, 999))).toEqual([]);
    expect(due(s, t(2026, 4, 3, 0, 0, 0, 0))).toEqual(["a1"]);
    // Passed a millisecond later, on the next day: due a day later.
    const later = passedAt({ a1: t(2026, 4, 2, 0, 0, 0, 0) });
    expect(due(later, t(2026, 4, 3, 23, 59, 59, 999))).toEqual([]);
    expect(due(later, t(2026, 4, 4, 0, 0, 0, 0))).toEqual(["a1"]);
  });

  it("counts calendar days when the clocks go back (a 25-hour day)", () => {
    // 48 hours after 00:30 on 31 October is 23:30 on 1 November: a day early.
    const at = t(2026, 10, 31, 0, 30);
    expect(dayKey(at + 48 * HOUR)).toBe("2026-11-01");
    expect(dayKey(firstReview(at).due)).toBe("2026-11-02");
    const s = passedAt({ a1: at });
    expect(due(s, t(2026, 11, 1, 23, 59, 59))).toEqual([]);
    expect(due(s, t(2026, 11, 2, 0, 0))).toEqual(["a1"]);
  });

  it("counts calendar days when the clocks go forward (a 23-hour day)", () => {
    // 48 hours after 23:30 on 6 March is 00:30 on 9 March: a day late.
    const at = t(2026, 3, 6, 23, 30);
    expect(dayKey(at + 48 * HOUR)).toBe("2026-03-09");
    expect(dayKey(firstReview(at).due)).toBe("2026-03-08");
    expect(due(passedAt({ a1: at }), t(2026, 3, 8, 0, 0))).toEqual(["a1"]);
    // A time of day that does not exist on the due day (02:30 on 8 March) still lands on that day.
    const odd = t(2026, 3, 6, 2, 30);
    expect(dayKey(addDays(odd, 2))).toBe("2026-03-08");
    expect(dayKey(nextReview(undefined, false, odd).due)).toBe("2026-03-08");
    expect(dayKey(nextReview({ due: odd, interval: 2 }, true, t(2026, 3, 3, 2, 30)).due)).toBe("2026-03-08");
  });

  it("suggests one warm-up a day, and again from the next midnight", () => {
    const at = { a1: t(2026, 10, 20), a2: t(2026, 10, 20), b1: t(2026, 10, 20) };
    const evening = t(2026, 10, 31, 23, 59, 59, 999);
    expect(pickSession(CHAPTERS, passedAt(at), evening)).toHaveLength(3);
    const seen = passedAt(at, { warmupDay: dayKey(evening) });
    expect(pickSession(CHAPTERS, seen, evening)).toEqual([]);
    expect(pickSession(CHAPTERS, seen, evening + 1)).toHaveLength(3);
    // Dismissed in the hour before the clocks go back: hidden for the whole 25-hour day.
    const sunday = passedAt(at, { warmupDay: dayKey(t(2026, 11, 1, 0, 30)) });
    expect(pickSession(CHAPTERS, sunday, t(2026, 11, 1, 0, 30) + 24.4 * HOUR)).toEqual([]);
    expect(pickSession(CHAPTERS, sunday, t(2026, 11, 2, 0, 0))).toHaveLength(3);
  });

  it("ignores dates no clock can show", () => {
    const s = passedAt({ a1: 1e300, a2: 8.64e15, b1: t(2026, 4, 1) }, { reviews: { b1: { due: 1e300, interval: 1e300 } } });
    expect(due(s, t(2026, 6, 1))).toEqual([]);
    expect(nextReview({ due: 1, interval: 1e300 }, true, t(2026, 6, 1)).interval).toBe(30);
  });
});
