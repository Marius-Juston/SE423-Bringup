import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/levels/index";
import trm from "../src/levels/trm-index.json";
import { existsSync } from "node:fs";
import { runProgram } from "../src/sim/runner";
import { device } from "../src/ui/device";
import { layoutOf, registerSolved } from "../src/ui/widgets/RegisterPuzzle";
import type { CodeLevel } from "../src/levels/types";
import slides from "../src/levels/slides-index.json";
import { courseLink, courseLinks, deckOf, slidesOf, slideTitle } from "../src/levels/course-links";

// Content checks: every reference solution passes, every starter fails,
// every citation exists. This is the guard on level accuracy.

const all = CHAPTERS.flatMap((c) => c.levels.map((l) => ({ c, l })));

describe("level catalogue", () => {
  it("has unique ids and valid chapter links", () => {
    const ids = all.map((x) => x.l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHAPTERS) for (const r of c.requires) expect(CHAPTERS.some((x) => x.id === r), `${c.id} requires ${r}`).toBe(true);
  });

  it("links every level to where it is taught", () => {
    // How the levels are referenced, printed for the record (see docs/AUTHORING.md, "References").
    const count = { slide: 0, lecture: 0, other: 0, manual: 0 };
    for (const { l } of all) {
      const course = l.refs.filter((r) => r.course !== undefined);
      if (course.some((r) => deckOf(r.course!) && slidesOf(r).length > 0)) count.slide++;
      else if (course.some((r) => deckOf(r.course!))) count.lecture++;
      else if (course.length > 0) count.other++;
      else count.manual++;
    }
    console.info(`References of ${all.length} levels: ${count.slide} link to a lecture slide, ${count.lecture} to a whole lecture, ${count.other} to a lab, homework or primer only, ${count.manual} to the manual only.`);
    expect(count.slide + count.lecture + count.other + count.manual).toBe(all.length);
    // Most of the game is lecture material: a drop here means slide numbers were lost.
    expect(count.slide).toBeGreaterThan(all.length * 0.6);
  });

  it("resolves every form of course reference", () => {
    const href = (course: string, slide?: number | number[]) => courseLink({ course, slide })?.href;
    const site = "https://marius-juston.github.io/SE-423---Class-Material";
    expect(href("L5", 21)).toBe(`${site}/Lectures/Slides/L5.html#s21`);
    expect(href("L6-7", [23, 24])).toBe(`${site}/Lectures/Slides/L6-7.html#s23`);
    expect(href("L7")).toBe(`${site}/Lectures/Slides/L6-7.html`);
    expect(href("L21", 3)).toBe(`${site}/Lectures/Slides/L20-21.html#s3`);
    expect(courseLink({ course: "L5", slide: 21 })?.label).toBe("Lecture 5, slide 21");
    expect(courseLink({ course: "L5", slide: 21 })?.title).toBe(`Lecture 5, slide 21: ${(slides as Record<string, string[]>).L5[20]}`);
    expect(courseLinks({ course: "L6-7", slide: [23, 24] }).map((x) => x.label)).toEqual(["Lecture 6-7, slide 23", "Lecture 6-7, slide 24"]);
    expect(href("HW2")).toBe(`${site}/Homeworks/HW2.pdf`);
    expect(href("LabVIEW2")).toBe(`${site}/Homeworks/LabVIEW2.pdf`);
    expect(href("Syllabus")).toBe(`${site}/syllabus.pdf`);
    expect(href("Lab 3")).toBe("https://coecsl.ece.illinois.edu/se423/SE423_Lab3.pdf");
    expect(href("Lab 7")).toBe("https://coecsl.ece.illinois.edu/se423/Se423_Lab7.pdf");
    expect(href("Project")).toMatch(/^https:\/\/coecsl\.ece\.illinois\.edu\/se423\/.+\.pdf$/);
    expect(courseLink({ course: "Primer A" })?.label).toBe("Primer A");
    expect(courseLink({ course: "Primer A" })?.href).toBeUndefined();
    for (const bad of ["L26", "L6-8", "Lab 9", "HW7", "LabVIEW5", "Lecture 5", ""]) expect(courseLink({ course: bad }), bad).toBeUndefined();
    expect(slideTitle("L5", 0)).toBeUndefined();
    expect(slideTitle("L5", (slides as Record<string, string[]>).L5.length + 1)).toBeUndefined();
  });

  for (const { c, l } of all) {
    describe(`${c.number}. ${c.title} / ${l.title} [${l.id}]`, () => {
      it("has a goal, a brief, sources and at most three hints", () => {
        expect(l.goal.length).toBeGreaterThan(10);
        expect(l.brief.trim().length).toBeGreaterThan(40);
        expect(l.refs.length).toBeGreaterThan(0);
        expect((l.hints ?? []).length).toBeLessThanOrEqual(3);
        for (const r of l.refs) if (r.trm) expect(trm, `TRM section ${r.trm}`).toHaveProperty([r.trm]);
        // Course references resolve to a page, and a cited slide exists in its deck.
        for (const r of l.refs) {
          expect(r.trm !== undefined || r.course !== undefined, "a reference names the manual or course material").toBe(true);
          if (r.course === undefined) {
            expect(r.slide, "slide without course").toBeUndefined();
            continue;
          }
          expect(courseLink(r), `course reference "${r.course}"`).toBeDefined();
          const deck = deckOf(r.course);
          const nums = slidesOf(r);
          if (nums.length) expect(deck, `"${r.course}" has slide numbers but is not a lecture`).toBeDefined();
          expect(new Set(nums).size, `${r.course}: a slide is listed twice`).toBe(nums.length);
          for (const n of nums) expect(slideTitle(deck!, n), `${deck} has no slide ${n} (it has ${(slides as Record<string, string[]>)[deck!]?.length})`).toBeDefined();
          expect(courseLinks(r).length).toBe(Math.max(1, nums.length));
        }
        // Embedded figures must exist.
        for (const m of l.brief.matchAll(/\{\{figure:([a-z0-9-]+)\}\}/g)) expect(existsSync(`src/ui/figures/${m[1]}.tsx`), `figure ${m[1]}`).toBe(true);
        // No typographic characters that would break pasted code.
        const code = l.kind === "code" ? l.starter + l.solution : "";
        expect(code).not.toMatch(/[‘’“”–—… ]/);
      });

      if (l.kind === "code") {
        const run = (source: string) => runProgram({ kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
        it("reference solution passes every check with no diagnostics", () => {
          const r = run(l.solution);
          expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
          expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
          for (const ch of r.checks) expect(ch.pass, `${ch.label}: ${ch.detail}`).toBe(true);
          expect(r.diagnostics.map((d) => `${d.line}: ${d.msg}`)).toEqual([]);
          expect(r.passed).toBe(true);
          // The reference solution earns every star, so each one is reachable.
          for (const ch of r.bonus) expect(ch.pass, `bonus ${ch.label}: ${ch.detail}`).toBe(true);
        });
        it("starter code does not pass", () => {
          expect(run(l.starter).passed).toBe(false);
        });
        it("starter code compiles (the student starts from working code)", () => {
          const r = run(l.starter);
          expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
        });
        it("keeps code lines readable (at most 100 characters)", () => {
          for (const line of (l as CodeLevel).starter.split("\n")) expect(line.length, line).toBeLessThanOrEqual(100);
        });
      }
      if (l.kind === "register") {
        it("has a reachable target that differs from the start", () => {
          const { bits, fields } = layoutOf(l);
          if (l.reg) expect(device().regs.has(l.reg)).toBe(true);
          for (const t of l.targets ?? []) expect(fields.some((f) => f.name === t.field), `field ${t.field}`).toBe(true);
          expect(registerSolved(l, l.initial)).toBe(false);
          let solved = l.value ?? l.initial;
          if (l.value === undefined)
            for (const t of l.targets!) {
              const f = fields.find((x) => x.name === t.field)!;
              const mask = (2 ** (f.hi - f.lo + 1) - 1) * 2 ** f.lo;
              solved = solved - (Math.floor(solved / 2 ** f.lo) % 2 ** (f.hi - f.lo + 1)) * 2 ** f.lo + t.value * 2 ** f.lo;
              expect(t.value * 2 ** f.lo).toBeLessThanOrEqual(mask);
            }
          expect(solved).toBeLessThan(2 ** bits);
          expect(registerSolved(l, solved)).toBe(true);
        });
      }
      if (l.kind === "brief" || l.kind === "quiz") {
        it("has answerable questions", () => {
          expect(l.questions.length).toBeGreaterThan(0);
          for (const q of l.questions) {
            expect(q.answer).toBeGreaterThanOrEqual(0);
            expect(q.answer).toBeLessThan(q.options.length);
            expect(new Set(q.options).size).toBe(q.options.length);
            expect(q.why.length).toBeGreaterThan(5);
          }
        });
      }
      if (l.kind === "calc") {
        it("has finite answers", () => {
          for (const f of l.fields) expect(Number.isFinite(f.answer)).toBe(true);
        });
      }
      if (l.kind === "timing") {
        it("has consistent rows", () => {
          for (const r of l.rows) {
            expect(r.initial.length).toBe(l.slots.length);
            expect(r.answer.length).toBe(l.slots.length);
            if (!r.editable) expect(r.initial).toEqual(r.answer);
          }
          expect(l.rows.some((r) => r.editable && r.initial.join() !== r.answer.join())).toBe(true);
        });
      }
      if (l.kind === "wiring") {
        it("only wires existing terminals", () => {
          const ids = new Set(l.nodes.map((n) => n.id));
          for (const [a, b] of [...l.wires, ...(l.fixed ?? []), ...(l.mistakes ?? []).map((m) => m.wire)]) {
            expect(ids.has(a), a).toBe(true);
            expect(ids.has(b), b).toBe(true);
          }
        });
      }
      if (l.kind === "order") {
        it("has at least three steps", () => expect(l.steps.length).toBeGreaterThanOrEqual(3));
      }
    });
  }
});
