import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/levels/index";
import trm from "../src/levels/trm-index.json";
import { FIGURES } from "../src/levels/figures";
import { runProgram } from "../src/sim/runner";
import { device } from "../src/ui/device";
import { layoutOf, registerSolved } from "../src/ui/widgets/RegisterPuzzle";
import type { CodeLevel } from "../src/levels/types";

// Content checks: every reference solution passes, every starter fails,
// every citation exists. This is the guard on level accuracy.

const all = CHAPTERS.flatMap((c) => c.levels.map((l) => ({ c, l })));

describe("level catalogue", () => {
  it("has unique ids and valid chapter links", () => {
    const ids = all.map((x) => x.l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHAPTERS) for (const r of c.requires) expect(CHAPTERS.some((x) => x.id === r), `${c.id} requires ${r}`).toBe(true);
  });

  for (const { c, l } of all) {
    describe(`${c.number}. ${c.title} / ${l.title} [${l.id}]`, () => {
      it("has a goal, a brief, sources and at most three hints", () => {
        expect(l.goal.length).toBeGreaterThan(10);
        expect(l.brief.trim().length).toBeGreaterThan(40);
        expect(l.refs.length).toBeGreaterThan(0);
        expect((l.hints ?? []).length).toBeLessThanOrEqual(3);
        for (const r of l.refs) if (r.trm) expect(trm, `TRM section ${r.trm}`).toHaveProperty([r.trm]);
        // Embedded figures must exist.
        for (const m of l.brief.matchAll(/\{\{figure:([a-z0-9-]+)\}\}/g)) expect(FIGURES as readonly string[], `figure ${m[1]}`).toContain(m[1]);
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
