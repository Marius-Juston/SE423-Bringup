// Spaced review ("Warm-up"): which passed puzzles are due again, and when a
// reviewed one comes back. Pure functions of the save and a clock, so they can
// be tested with fixed dates.

export const DAY = 86_400_000;
/** Days until the next review after each one answered right at the first try. */
export const INTERVALS = [2, 5, 12, 30] as const;
/** Level kinds that are quick to answer again (briefings and code are not). */
export const REVIEW_KINDS: ReadonlySet<string> = new Set(["quiz", "calc", "register", "timing", "order", "wiring"]);
/** Questions in one warm-up, and how many must be due before one is suggested. */
export const SESSION_SIZE = 3;

export interface Review {
  /** When the level is due again (ms since the epoch). */
  due: number;
  /** Days that were waited for this review: the place on the ladder. */
  interval: number;
}

/** The part of the save the scheduler reads. */
export interface ReviewState {
  passed: Record<string, true>;
  passedAt: Record<string, number>;
  reviews: Record<string, Review>;
  /** The day (see `dayKey`) a warm-up was last started or dismissed. */
  warmupDay: string;
}

export interface ReviewChapter {
  id: string;
  levels: { id: string; kind: string }[];
}

const startOfDay = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The same time of day `days` calendar days later (a day is not always 24 hours: clocks change). */
export function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** The local calendar day of `t`, e.g. "2026-03-09". */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The first review comes two days after the pass. */
export const firstReview = (passedAt: number): Review => ({ due: addDays(passedAt, INTERVALS[0]), interval: INTERVALS[0] });

/**
 * The review after one that was just answered: the next longer wait when it
 * was right at the first try (30 days at most), two days again after a miss.
 */
export function nextReview(prev: Review | undefined, right: boolean, now: number): Review {
  if (!right) return { due: addDays(now, INTERVALS[0]), interval: INTERVALS[0] };
  const at = INTERVALS.findIndex((d) => d >= (prev?.interval ?? INTERVALS[0]));
  const interval = INTERVALS[Math.min(INTERVALS.length - 1, (at < 0 ? INTERVALS.length - 1 : at) + 1)];
  return { due: addDays(now, interval), interval };
}

/** When a passed level is due, or undefined when it is not scheduled. */
export function dueAt(s: ReviewState, id: string): number | undefined {
  if (!s.passed[id]) return undefined;
  return s.reviews[id]?.due ?? (s.passedAt[id] !== undefined ? firstReview(s.passedAt[id]).due : undefined);
}

/** Every puzzle due on the day of `now` (a level is due all day on its due date), longest overdue first. */
export function dueLevels(chapters: ReviewChapter[], s: ReviewState, now: number): { id: string; chapter: string; due: number }[] {
  const today = startOfDay(now);
  const out: { id: string; chapter: string; due: number }[] = [];
  for (const c of chapters)
    for (const l of c.levels) {
      if (!REVIEW_KINDS.has(l.kind)) continue;
      const due = dueAt(s, l.id);
      if (due !== undefined && startOfDay(due) <= today) out.push({ id: l.id, chapter: c.id, due });
    }
  // A stable sort: levels due at the same moment stay in campaign order.
  return out.sort((a, b) => a.due - b.due);
}

/**
 * The levels of today's warm-up: the longest overdue ones, from different
 * chapters where possible. Empty when fewer than `size` are due, or when a
 * warm-up was already started or dismissed today.
 */
export function pickSession(chapters: ReviewChapter[], s: ReviewState, now: number, size = SESSION_SIZE): string[] {
  if (s.warmupDay === dayKey(now)) return [];
  const due = dueLevels(chapters, s, now);
  if (due.length < size) return [];
  const picked: typeof due = [];
  const seen = new Set<string>();
  for (const d of due) {
    if (picked.length === size) break;
    if (seen.has(d.chapter)) continue;
    seen.add(d.chapter);
    picked.push(d);
  }
  // Fewer chapters than questions: fill up with the next oldest.
  for (const d of due) {
    if (picked.length === size) break;
    if (!picked.includes(d)) picked.push(d);
  }
  return picked.sort((a, b) => a.due - b.due).map((d) => d.id);
}

/** The one-line result shown on the map after a warm-up. */
export function sessionSummary(right: number, total: number): string {
  if (total === 0) return "";
  const missed = total - right;
  const head = `Warm-up done: ${right} of ${total} right at the first try.`;
  if (missed === 0) return `${head} They come back later, further apart each time.`;
  return `${head} ${missed === 1 ? "The other one comes" : `The other ${missed} come`} back in ${INTERVALS[0]} days.`;
}
