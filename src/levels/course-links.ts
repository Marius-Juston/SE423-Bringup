// Turns a level's course reference ({ course: "L6-7", slide: 23 }) into a
// link to the published material and a label for it.
//
// Lecture decks are published as accessible HTML with one section per slide
// (#s<N>, N counted from 1). Homeworks, LabVIEW assignments and the syllabus
// are PDFs on the same site; lab handouts are on the official course site.
// Slide titles come from slides-index.json (tools/gen-slides-index.py).
import slides from "./slides-index.json";
import type { Ref } from "./types";

export const CLASS_SITE = "https://marius-juston.github.io/SE-423---Class-Material";
export const LAB_SITE = "https://coecsl.ece.illinois.edu/se423";

const INDEX: Record<string, string[]> = slides;

/** Lab handouts on the official course site (file names as published there). */
const LAB_FILES: Record<number, string> = {
  1: "SE423_Lab1.pdf",
  2: "SE423_Lab2.pdf",
  3: "SE423_Lab3.pdf",
  4: "Se423_Lab4.pdf",
  5: "Se423_Lab5.pdf",
  6: "Se423_Lab6.pdf",
  7: "Se423_Lab7.pdf",
};
const HOMEWORKS = 6;
const LABVIEWS = 4;

/** The parts of the game that are not course material, by the name used in `course`. */
const IN_GAME: Record<string, string> = {
  "Primer A": "Primer A: electricity, in this game",
  "Primer B": "Primer B: C from zero, in this game",
  "Primer C": "Primer C: C for hardware, in this game",
};

/** The MPU-9250's three documents on the course site, by the name used in `course`. Give the section in `note`. */
const DOCUMENTS: Record<string, { file: string; title: string }> = {
  "MPU-9250 addendum": { file: "MPU-9250-Addendum.pdf", title: "MPU-9250 addendum: SPI timing diagrams and programming tips (PDF)" },
  "MPU-9250 register map": { file: "MPU-9250-Register-Map.pdf", title: "MPU-9250 register map and descriptions (PDF)" },
  "MPU-9250 specification": { file: "PS-MPU-9250A-01-v1.1.pdf", title: "MPU-9250 product specification (PDF)" },
};

export type CourseKind = "lecture" | "lab" | "homework" | "other";

export interface CourseLink {
  /** Where the link goes. Missing for a reference that has no page (a primer of this game). */
  href?: string;
  /** Short text for the chip: "Lecture 5, slide 31". */
  label: string;
  /** Long text for the tooltip and the accessible name: "Lecture 5, slide 31: SOC (Start-of-Conversion)". */
  title: string;
  kind: CourseKind;
  /** The deck, for a lecture: "L6-7". */
  deck?: string;
}

/** The deck that holds lecture `name`: "L6" and "L7" are both in "L6-7". */
export function deckOf(name: string): string | undefined {
  const m = /^L(\d+)(?:-(\d+))?$/.exec(name.trim());
  if (!m) return undefined;
  if (m[2]) return name.trim() in INDEX ? name.trim() : undefined;
  const n = Number(m[1]);
  for (const deck of Object.keys(INDEX)) {
    const [lo, hi = lo] = deck.slice(1).split("-").map(Number);
    if (n >= lo && n <= hi) return deck;
  }
  return undefined;
}

/** Slide numbers of a reference, in the order given. */
export const slidesOf = (ref: Ref): number[] => (ref.slide === undefined ? [] : Array.isArray(ref.slide) ? ref.slide : [ref.slide]);

/** Title of slide `n` (from 1) of a deck, or undefined when the deck has no such slide. */
export const slideTitle = (deck: string, n: number): string | undefined => (Number.isInteger(n) && n >= 1 ? INDEX[deck]?.[n - 1] : undefined);

const withNote = (title: string, ref: Ref) => (ref.note ? `${title} (${ref.note})` : title);

/**
 * Link and label of one slide of a lecture reference, or of the whole deck
 * when `slide` is undefined.
 */
function lectureLink(ref: Ref, deck: string, slide: number | undefined): CourseLink {
  const name = `Lecture ${deck.slice(1)}`;
  const page = `${CLASS_SITE}/Lectures/Slides/${deck}.html`;
  if (slide === undefined) return { href: page, label: name, title: withNote(`${name}: all slides`, ref), kind: "lecture", deck };
  const title = slideTitle(deck, slide);
  const label = `${name}, slide ${slide}`;
  return { href: `${page}#s${slide}`, label, title: withNote(title ? `${label}: ${title}` : label, ref), kind: "lecture", deck };
}

/**
 * Every link of a course reference: one per slide for a lecture with slides,
 * otherwise one. Empty when `course` is not a name this file knows.
 */
export function courseLinks(ref: Ref): CourseLink[] {
  const course = ref.course?.trim();
  if (!course) return [];
  const deck = deckOf(course);
  if (deck) {
    const nums = slidesOf(ref);
    return nums.length ? nums.map((n) => lectureLink(ref, deck, n)) : [lectureLink(ref, deck, undefined)];
  }
  let m = /^Lab (\d+)$/.exec(course);
  if (m) {
    const file = LAB_FILES[Number(m[1])];
    return file ? [{ href: `${LAB_SITE}/${file}`, label: course, title: withNote(`${course} handout (PDF)`, ref), kind: "lab" }] : [];
  }
  m = /^HW(\d+)$/.exec(course);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > HOMEWORKS) return [];
    return [{ href: `${CLASS_SITE}/Homeworks/HW${n}.pdf`, label: `Homework ${n}`, title: withNote(`Homework ${n} (PDF)`, ref), kind: "homework" }];
  }
  m = /^LabVIEW ?(\d+)$/.exec(course);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > LABVIEWS) return [];
    return [{ href: `${CLASS_SITE}/Homeworks/LabVIEW${n}.pdf`, label: `LabVIEW ${n}`, title: withNote(`LabVIEW assignment ${n} (PDF)`, ref), kind: "homework" }];
  }
  if (course === "Project") return [{ href: `${LAB_SITE}/SE423_Final_Project_Instructions_SP26.pdf`, label: "Final project", title: withNote("Final project instructions (PDF)", ref), kind: "lab" }];
  if (course === "Syllabus") return [{ href: `${CLASS_SITE}/syllabus.pdf`, label: "Syllabus", title: withNote("Course syllabus (PDF)", ref), kind: "other" }];
  if (course in DOCUMENTS) return [{ href: `${LAB_SITE}/${DOCUMENTS[course].file}`, label: course, title: withNote(DOCUMENTS[course].title, ref), kind: "other" }];
  if (course in IN_GAME) return [{ label: course, title: withNote(IN_GAME[course], ref), kind: "other" }];
  return [];
}

/** The first link of a course reference (its first slide), or undefined when it does not resolve. */
export function courseLink(ref: Ref): CourseLink | undefined {
  return courseLinks(ref)[0];
}

const ORDER: Record<CourseKind, number> = { lecture: 0, lab: 1, homework: 2, other: 3 };

/** Course links of a level in display order: lectures, then labs, then homeworks, then the rest. */
export function sortedCourseLinks(refs: Ref[]): CourseLink[] {
  return refs
    .flatMap((r) => courseLinks(r))
    .map((link, i) => ({ link, i }))
    .sort((a, b) => ORDER[a.link.kind] - ORDER[b.link.kind] || a.i - b.i)
    .map((x) => x.link);
}
