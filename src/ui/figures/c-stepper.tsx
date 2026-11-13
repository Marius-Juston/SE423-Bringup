import { useState } from "react";

// Shared by the "C from zero" figures (c-variable-boxes, c-flow,
// c-function-call): a short C program that is run one line at a time, with
// the variables drawn as named boxes and the printed text below. This file
// is a helper, not a figure: it exports no `figure`.
//
// The traces are built by hand-written scripts (see `trace`), not by the
// simulator, so that every step can carry a sentence written for a beginner.

export interface Box {
  /** Which function the box belongs to (shown as a heading). */
  group: string;
  name: string;
  /** "?" means: declared, nothing stored yet. */
  value: string;
}

export interface Step {
  /** 1-based line that just ran; 0 before the first step. */
  line: number;
  boxes: Box[];
  /** Names ("group.name") whose value this step changed. */
  changed: string[];
  out: string;
  say: string;
}

export interface Program {
  /** Label of the choice pill. */
  name: string;
  code: string[];
  steps: Step[];
}

export interface Tracer {
  /** Creates a box or stores a new value in it. */
  set(group: string, name: string, value: number | string): void;
  /** Throws away every box of a function (it has returned). */
  drop(group: string): void;
  print(text: string): void;
  /** Records one step: `line` has just run, with the effects made in `effects`. */
  run(line: number, say: string, effects?: () => void): void;
}

/** Builds the steps of a program from a script that says what each line does. */
export function trace(start: string, script: (t: Tracer) => void): Step[] {
  let boxes: Box[] = [];
  let out = "";
  const steps: Step[] = [{ line: 0, boxes: [], changed: [], out: "", say: start }];
  const t: Tracer = {
    set(group, name, value) {
      const v = String(value);
      const at = boxes.findIndex((b) => b.group === group && b.name === name);
      if (at >= 0) boxes = boxes.map((b, i) => (i === at ? { ...b, value: v } : b));
      else boxes = [...boxes, { group, name, value: v }];
    },
    drop(group) {
      boxes = boxes.filter((b) => b.group !== group);
    },
    print(text) {
      out += text;
    },
    run(line, say, effects) {
      const before = new Map(boxes.map((b) => [`${b.group}.${b.name}`, b.value]));
      effects?.();
      const changed = boxes.filter((b) => before.get(`${b.group}.${b.name}`) !== b.value).map((b) => `${b.group}.${b.name}`);
      steps.push({ line, boxes, changed, out, say });
    },
  };
  script(t);
  return steps;
}

const CSS = `
.cst-code, .cst-box { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
.cst-code { list-style: none; margin: 0; padding: 0.35rem 0; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; font-family: var(--mono); font-size: 0.82rem; overflow-x: auto; }
.cst-code li { display: flex; white-space: pre; padding: 0.02rem 0.5rem 0.02rem 0; border-left: 3px solid transparent; }
.cst-code li .cst-no { width: 2.1rem; text-align: right; padding-right: 0.6rem; color: var(--dim); flex: none; user-select: none; }
.cst-code li .cst-mark { width: 1.1rem; flex: none; color: var(--orange); font-weight: 700; }
.cst-code li[aria-current="step"] { background: var(--accent-soft); border-left-color: var(--orange); font-weight: 700; }
.cst-mem { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; margin: 0.6rem 0 0; min-height: 4.6rem; align-items: flex-start; }
.cst-group { border: 1px dashed var(--border); border-radius: 6px; padding: 0.25rem 0.5rem 0.45rem; }
.cst-group h5 { margin: 0 0 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--dim); }
.cst-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.cst-box { text-align: center; font-family: var(--mono); }
.cst-box .cst-name { display: block; font-size: 0.78rem; }
.cst-box .cst-val { display: block; min-width: 3.2rem; padding: 0.3rem 0.4rem; border: 2px solid var(--dim); border-radius: 4px; background: var(--surface); color: var(--harvest); font-weight: 700; font-size: 1rem; }
.cst-box.cst-new .cst-val { border-color: var(--orange); background: var(--accent-soft); }
.cst-box .cst-note { display: block; font-size: 0.68rem; font-family: var(--sans); color: var(--dim); min-height: 1em; }
.cst-empty { color: var(--dim); font-size: 0.85rem; margin: 0.4rem 0; }
.cst-out { margin: 0.6rem 0 0; }
.cst-out h5 { margin: 0 0 0.2rem; font-size: 0.75rem; font-weight: 600; color: var(--dim); }
.cst-out pre { margin: 0; min-height: 2.4em; padding: 0.3rem 0.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; font-size: 0.82rem; white-space: pre-wrap; }
.cst-ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.5rem 0; }
.cst-count { color: var(--dim); font-size: 0.82rem; margin-left: auto; }
`;

export function Stepper({ programs, label, caption, showOutput = true }: { programs: Program[]; label: string; caption: string; showOutput?: boolean }) {
  const [which, setWhich] = useState(0);
  const [at, setAt] = useState(0);
  const prog = programs[which];
  const step = prog.steps[Math.min(at, prog.steps.length - 1)];
  const last = at >= prog.steps.length - 1;
  const groups = [...new Set(step.boxes.map((b) => b.group))];
  const describe = step.boxes.length ? step.boxes.map((b) => `${b.name} holds ${b.value === "?" ? "an unknown value" : b.value}`).join(", ") : "no variables yet";
  return (
    <figure className="figure" aria-label={label}>
      <style>{CSS}</style>
      <ol className="cst-code" aria-label={`The program. ${step.line ? `Line ${step.line} has just run` : "Nothing has run yet"}.`}>
        {prog.code.map((text, i) => (
          <li key={i} aria-current={step.line === i + 1 ? "step" : undefined}>
            <span className="cst-no">{i + 1}</span>
            <span className="cst-mark" aria-hidden="true">{step.line === i + 1 ? ">" : ""}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <div className="cst-mem" role="group" aria-label={`Variables: ${describe}.`}>
        {groups.length === 0 && <p className="cst-empty">No variables yet: no box has been made.</p>}
        {groups.map((g) => (
          <div className="cst-group" key={g}>
            <h5>{g}</h5>
            <div className="cst-row">
              {step.boxes.filter((b) => b.group === g).map((b) => {
                const fresh = step.changed.includes(`${b.group}.${b.name}`);
                return (
                  <div className={`cst-box ${fresh ? "cst-new" : ""}`} key={b.name}>
                    <span className="cst-name">{b.name}</span>
                    <span className="cst-val">{b.value}</span>
                    <span className="cst-note">{fresh ? (b.value === "?" ? "new box" : "just stored") : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {showOutput && (
        <div className="cst-out">
          <h5>Printed so far</h5>
          <pre aria-label="Text printed so far">{step.out || "(nothing yet)"}</pre>
        </div>
      )}
      <p className="fig-why" role="status">{step.say}</p>
      <div className="cst-ctl">
        <button className="btn" onClick={() => setAt(Math.max(0, at - 1))} disabled={at === 0}>Back</button>
        <button className="btn primary" onClick={() => setAt(at + 1)} disabled={last}>Step</button>
        <button className="btn" onClick={() => setAt(0)} disabled={at === 0}>Start again</button>
        <span className="cst-count">step {Math.min(at, prog.steps.length - 1)} of {prog.steps.length - 1}</span>
      </div>
      {programs.length > 1 && (
        <div className="fig-controls">
          <div>
            <span>Program</span>
            {programs.map((p, i) => (
              <button key={p.name} className="fig-opt" aria-pressed={i === which} onClick={() => { setWhich(i); setAt(0); }}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
