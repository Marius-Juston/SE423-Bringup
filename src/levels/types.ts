// Level data format. Levels are plain data: adding one never touches the
// engine. Text fields use a small Markdown subset (paragraphs, **bold**,
// `code`, "- " lists and ```c blocks), rendered by src/ui/Markdown.tsx.

import type { Check, Stimulus } from "../sim/runner";

/** Where the material comes from. Shown on every level, as a link. */
export interface Ref {
  /** Section number in the Technical Reference Manual (SPRUHM8I), e.g. "3.4.3". */
  trm?: string;
  /**
   * Course lecture, lab or homework: "L3", "L6-7", "Lab 2", "HW1", "LabVIEW2",
   * "Project", "Syllabus" (see src/levels/course-links.ts for every form).
   */
  course?: string;
  /**
   * Slide number(s) in the deck named by `course`, counted from 1 as in
   * src/levels/slides-index.json. Only for lectures. The first one is the
   * slide the link opens.
   */
  slide?: number | number[];
  /** A few words on what to look for there, shown in the tooltip. */
  note?: string;
}

interface Base {
  id: string;
  title: string;
  /** One sentence: what the student will do. */
  goal: string;
  /** The background needed for this level. */
  brief: string;
  refs: Ref[];
  /** Up to three hints, from a nudge to nearly the answer. */
  hints?: string[];
  /** Shown after the level is passed: why the answer is the answer. */
  takeaway?: string;
  /**
   * "core" levels (the default) unlock the next chapter. "practice" levels
   * repeat a skill on a new case. "expert" levels are hard, optional
   * challenges for students who want to go to the bottom of a topic.
   */
  tier?: Tier;
}

export type Tier = "core" | "practice" | "expert";
export const tierOf = (l: { tier?: Tier }): Tier => l.tier ?? "core";

/** Reading level: ends with a few questions to check understanding. */
export interface BriefLevel extends Base {
  kind: "brief";
  questions: Question[];
}

export interface Question {
  prompt: string;
  options: string[];
  /** Index of the correct option. */
  answer: number;
  /** Explanation shown after answering. */
  why: string;
}

export interface QuizLevel extends Base {
  kind: "quiz";
  questions: Question[];
}

/** Compute one or more numbers. */
export interface CalcLevel extends Base {
  kind: "calc";
  fields: CalcField[];
}

export interface CalcField {
  id: string;
  label: string;
  unit?: string;
  answer: number;
  /** Accepted relative error in percent (default: exact). */
  tolPct?: number;
  /** "hex" accepts 0x.. input and shows the answer in hex. */
  format?: "dec" | "hex";
  why: string;
}

/** Set bits of a register (or of a plain number) to reach a target. */
export interface RegisterLevel extends Base {
  kind: "register";
  /** A real register from the device map, e.g. "CpuTimer0Regs.TCR"... */
  reg?: string;
  /** ...or a plain value of this many bits with optional named fields. */
  custom?: { bits: 8 | 16 | 32; fields?: { name: string; hi: number; lo: number; desc?: string }[] };
  /** Value shown at the start. */
  initial: number;
  /** Field values that must be reached; every other bit must stay as in `initial`. */
  targets?: { field: string; value: number }[];
  /** Or the whole value that must be reached. */
  value?: number;
  /** The C line(s) that would do this, shown once solved. */
  code?: string;
}

/** Draw digital waveforms cell by cell. */
export interface TimingLevel extends Base {
  kind: "timing";
  /** Label of each time slot, e.g. ["idle", "start", "b0", ...]. */
  slots: string[];
  rows: { name: string; editable: boolean; initial: (0 | 1)[]; answer: (0 | 1)[] }[];
}

/** Put steps in the right order. */
export interface OrderLevel extends Base {
  kind: "order";
  /** Steps in the correct order (shown shuffled). */
  steps: string[];
}

/** Connect parts with wires. */
export interface WiringLevel extends Base {
  kind: "wiring";
  /** Terminals placed on a 100 x 60 grid; `side` says where the label goes (default "top"). */
  nodes: { id: string; label: string; x: number; y: number; side?: "top" | "bottom" | "left" | "right" }[];
  /** Component symbols drawn between two terminals (not editable). */
  parts?: { kind: "resistor" | "button"; a: string; b: string; label?: string }[];
  /** Fixed connections drawn but not editable. */
  fixed?: [string, string][];
  /** Wires the student must place (in either direction). */
  wires: [string, string][];
  /** Wrong wires that deserve a specific explanation. */
  mistakes?: { wire: [string, string]; why: string }[];
}

/** Write or fix C code that runs on the simulated board. */
export interface CodeLevel extends Base {
  kind: "code";
  /** How the level presents itself. */
  mode: "complete" | "write" | "debug" | "checkpoint";
  kit: "launchpad" | "robot" | "redboard";
  starter: string;
  solution: string;
  /** Simulated time the tests run for, ms. */
  durationMs: number;
  stimuli?: Stimulus[];
  checks: Check[];
  /**
   * Optional extra objectives, each worth a star: tighter, faster or
   * lower-level versions of the same task. The reference solution earns all
   * of them.
   */
  bonus?: Check[];
  /**
   * Id of an earlier code level this one builds on. If the student has
   * code saved for that level (and none yet for this one), this level
   * opens with THEIR code instead of `starter`, so they keep building on
   * their own work. `starter` must then be that earlier level's reference
   * solution plus the new TODOs, for students who arrive without it.
   */
  continues?: string;
  /** Global variables shown live next to the board. */
  watch?: string[];
  /** Registers shown in the inspector by default. */
  inspect?: string[];
}

export type Level = BriefLevel | QuizLevel | CalcLevel | RegisterLevel | TimingLevel | OrderLevel | WiringLevel | CodeLevel;

export interface Chapter {
  id: string;
  /** Order on the map. Primer chapters use negative numbers. */
  number: number;
  /** Shown instead of the number (primer chapters are "A", "B", "C"). */
  label?: string;
  title: string;
  /** One line shown on the map. */
  blurb: string;
  /** Chapters that must be finished first. */
  requires: string[];
  /** Course material this chapter practises. */
  course: string[];
  levels: Level[];
}

export const KIND_LABEL: Record<string, string> = {
  brief: "Briefing",
  quiz: "Quick check",
  calc: "Calculate",
  register: "Register puzzle",
  timing: "Timing diagram",
  order: "Sequence",
  wiring: "Wiring",
  complete: "Code: complete",
  write: "Code: write",
  debug: "Debug",
  checkpoint: "Checkpoint",
};

export const kindOf = (l: Level): string => (l.kind === "code" ? l.mode : l.kind);

/** What to show as a chapter's number. */
export const chapterLabel = (c: { number: number; label?: string }): string => c.label ?? String(c.number);

/** A term explained in plain words, for the Handbook glossary. */
export interface GlossaryEntry {
  term: string;
  /** One or two plain sentences a complete beginner can follow. */
  meaning: string;
  /** Level id where the term is first taught, if any. */
  level?: string;
}
