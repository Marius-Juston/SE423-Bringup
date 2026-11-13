import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CodeLevel } from "../../levels/types";
import { runProgram, type RunResult } from "../../sim/runner";
import { LiveSession } from "../../sim/live";
import type { Diagnostic } from "../../sim/board";
import { KITS } from "../../sim/world/kits";
import { store, useSave } from "../store";
import { Editor, type EditorHandle, type Mark } from "./Editor";
import { Parts, Scope } from "./Bench";
import { Registers } from "./Registers";
import { Panel } from "../Panel";
import { VIEWS } from "../views";

interface Problem {
  line: number;
  severity: "error" | "warning" | "info";
  msg: string;
  count?: number;
}

function problemsOf(diags: Diagnostic[], err?: { line: number; msg: string } | null, kind = "Error"): Problem[] {
  const out: Problem[] = [];
  if (err) out.push({ line: err.line, severity: "error", msg: `${kind}: ${err.msg}` });
  for (const d of diags) out.push({ line: d.line, severity: d.severity, msg: d.msg, count: d.count });
  return out;
}

export function CodeLevelView({ level, onPass, splitter }: { level: CodeLevel; onPass: () => void; splitter?: ReactNode }) {
  const save = useSave();
  const [code, setCode] = useState(() => save.code[level.id] ?? level.starter);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [, setFrame] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [speed, setSpeed] = useState(1);
  const [typed, setTyped] = useState("");
  const editor = useRef<EditorHandle | null>(null);
  const term = useRef<HTMLDivElement>(null);
  const kit = KITS[level.kit];
  const sandbox = level.checks.length === 0;

  // Save the code a moment after the student stops typing.
  useEffect(() => {
    const t = setTimeout(() => store.setCode(level.id, code), 400);
    return () => clearTimeout(t);
  }, [code, level.id]);

  // Animation loop for the live run.
  useEffect(() => {
    if (!live || !live.running) return;
    live.speed = speed;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!live.paused) live.step(dt);
      setFrame((f) => f + 1);
      if (live.running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, speed]);

  useEffect(() => {
    const el = term.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const start = () => {
    setResult(null);
    setLive(new LiveSession(level.kit, code));
  };
  const stop = () => setLive(null);
  const test = () => {
    setLive(null);
    const r = runProgram({ kit: level.kit, source: code, durationMs: level.durationMs, stimuli: level.stimuli, checks: level.checks, bonus: level.bonus });
    setResult(r);
    if (r.passed) {
      onPass();
      // Stars count only on a solution that passes the level.
      const earned = r.bonus.map((b, i) => (b.pass ? i : -1)).filter((i) => i >= 0);
      if (earned.length) store.star(level.id, earned);
    }
  };

  const board = live?.board ?? result?.board ?? null;
  // Signals this level is about: the ones its tests set or check.
  const focus = useMemo(() => {
    const names = new Set<string>();
    for (const c of [...level.checks, ...(level.bonus ?? [])]) if (c.kind === "signal") names.add(c.name);
    for (const st of level.stimuli ?? []) if ("set" in st) names.add(st.set);
    return names;
  }, [level]);
  const problems = useMemo(() => {
    if (live) return problemsOf([...live.board.diagnostics.values()], live.error, live.error?.kind === "compile" ? "Compile error" : "Stopped");
    if (result) return problemsOf(result.diagnostics, result.compileError ?? result.runtimeError, result.compileError ? "Compile error" : "Stopped");
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, result, live?.board.diagnostics.size, live?.error]);
  const pausedLine = live?.running && live.paused ? live.board.line : 0;
  const marks: Mark[] = useMemo(
    () => [...problems.filter((p) => p.line > 0).map((p) => ({ line: p.line, severity: p.severity })), ...(pausedLine ? [{ line: pausedLine, severity: "current" as const }] : [])],
    [problems, pausedLine],
  );
  // Follow the program in the editor while stepping.
  useEffect(() => {
    if (pausedLine) editor.current?.reveal(pausedLine);
  }, [pausedLine]);

  const nowMs = live ? live.timeMs : (result?.endMs ?? 0);
  const serial = live ? live.board.sci.text(0) : (result?.serial[0] ?? "");
  const windowMs = live ? Math.min(Math.max(nowMs, 1), 400) : Math.max(nowMs, 1);
  const stimMarks = !live && result ? (level.stimuli ?? []).map((s) => ({ tMs: s.at, label: "press" in s ? `${s.press}↓` : "release" in s ? `${s.release}↑` : "set" in s ? `${s.set}=${s.value}` : `'${s.type}'` })) : [];

  return (
    <>
      <div className="pane editor-pane">
        <div className="toolbar">
          {live?.running ? (
            <button className="btn" onClick={stop}>■ Stop</button>
          ) : (
            <button className="btn" onClick={start}>▶ Run</button>
          )}
          {live?.running && (
            <>
              <button className="btn" aria-pressed={live.paused} onClick={() => { live.paused = !live.paused; setFrame((f) => f + 1); }}>{live.paused ? "▶ Resume" : "❙❙ Pause"}</button>
              <button className="btn" onClick={() => { live.stepLine(); setFrame((f) => f + 1); }} title="Run one line of your code, then pause">Step line</button>
              <button className="btn" onClick={() => { live.stepToWrite(); setFrame((f) => f + 1); }} title="Run until the next register write, then pause">Next register write</button>
            </>
          )}
          {!sandbox && <button className="btn primary" onClick={test}>Run tests</button>}
          <label style={{ fontSize: "0.85rem", color: "var(--dim)" }}>
            Speed{" "}
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              <option value={0.0001}>1/10 000</option>
              <option value={0.001}>1/1000</option>
              <option value={0.01}>1/100</option>
              <option value={0.1}>1/10</option>
              <option value={1}>real time</option>
              <option value={10}>10×</option>
            </select>
          </label>
          <span className="spacer" />
          <button
            className="btn ghost small"
            onClick={() => {
              if (code === level.starter || window.confirm("Replace your code with the starting code for this level?")) {
                setCode(level.starter);
                store.resetCode(level.id);
              }
            }}
          >
            Reset code
          </button>
        </div>
        <Editor value={code} onChange={setCode} marks={marks} handle={editor} />
        <div className="problems" aria-live="polite">
          {problems.length === 0 ? (
            <span style={{ color: "var(--dim)" }}>{live || result ? "No problems reported." : "Run the program to try it, or run the tests to check it."}</span>
          ) : (
            problems.map((p, i) => (
              <div className={`problem ${p.severity}`} key={i}>
                <span>
                  <span className="sev">{p.severity}</span>{" "}
                  {p.line > 0 && <button onClick={() => editor.current?.goto(p.line)}>line {p.line}</button>}
                </span>
                <span>
                  {p.msg}
                  {p.count && p.count > 1 ? ` (${p.count} times)` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      {splitter}
      <div className="pane bench">
        <div className="bench-panels">
          {!sandbox && (
            <Panel id="tests" title={result ? `Tests: ${result.checks.filter((c) => c.pass).length} of ${result.checks.length} passed` : "Tests"}>
              {!result ? (
                <p className="hint-text">Press <strong>Run tests</strong>. The tests run your program for {level.durationMs} ms of simulated time{level.stimuli?.length ? ", pressing buttons, turning knobs or typing at fixed times," : ""} and check the points below.</p>
              ) : (
                <div className={`result ${result.passed ? "ok" : "bad"}`} role="status" style={{ marginTop: 0, marginBottom: "0.6rem" }}>
                  {result.passed
                    ? "All checks passed."
                    : result.compileError
                      ? "The code does not compile yet. See the message under the editor."
                      : result.runtimeError
                        ? "The program stopped with an error. See the message under the editor."
                        : result.checks.every((c) => c.pass)
                          ? "The checks pass, but an error was reported under the editor. Fix it to finish the level."
                          : "Some checks failed."}
                </div>
              )}
              <ul className="checks">
                {(result?.checks ?? level.checks.map((c) => ({ label: c.label, pass: null as boolean | null, detail: "", hint: undefined }))).map((c, i) => (
                  <li key={i}>
                    <span className={c.pass === null ? "" : c.pass ? "pass" : "fail"} aria-hidden="true">{c.pass === null ? "○" : c.pass ? "✓" : "✗"}</span>
                    <span>
                      <span className="sr-only">{c.pass === null ? "Not run: " : c.pass ? "Passed: " : "Failed: "}</span>
                      {c.label}
                    </span>
                    {c.detail && <span className="detail">{c.detail}</span>}
                    {c.hint && <span className="hintline">{c.hint}</span>}
                  </li>
                ))}
              </ul>
              {level.bonus && level.bonus.length > 0 && (
                <>
                  <h4 className="sub">Stars (optional)</h4>
                  <ul className="checks bonus">
                    {level.bonus.map((b, i) => {
                      const r = result?.bonus[i];
                      const kept = save.stars[level.id]?.includes(i) ?? false;
                      const now = !!r?.pass && !!result?.passed;
                      return (
                        <li key={i}>
                          <span className={now || kept ? "star on" : "star"} aria-hidden="true">★</span>
                          <span>
                            <span className="sr-only">{now || kept ? "Earned: " : "Not earned: "}</span>
                            {b.label}
                            {kept && !now && result ? " (earned earlier)" : ""}
                          </span>
                          {r?.detail && <span className="detail">{r.detail}</span>}
                          {r && !r.pass && r.hint && <span className="hintline">{r.hint}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Panel>
          )}
          <Panel id="board" title={kit.name}>
            <Parts kit={kit} board={board} pressed={live ? (id) => live.isPressed(id) : undefined} onButton={live?.running ? (id, d) => live.setButton(id, d) : undefined} onKnob={live?.running ? (id, v) => live.setKnob(id, v) : undefined} focus={focus} />
            <p className="simstate" aria-live="off">
              {live ? (live.running ? `${live.paused ? `paused at line ${live.board.line}` : "running"} · t = ${nowMs.toFixed(nowMs < 100 ? 4 : 1)} ms${live.load < 0.9 ? ` · ${Math.round(live.load * 100)}% of requested speed` : ""}` : `stopped at ${nowMs.toFixed(3)} ms`) : result ? `test run · ${nowMs.toFixed(1)} ms` : "Press Run to power the board."}
              {board?.mainReturned ? " · main() has returned" : ""}
            </p>
            {level.watch && level.watch.length > 0 && board && (
              <dl className="watch">
                {level.watch.map((w) => {
                  const v = board.readVar(w);
                  return (
                    <div key={w} style={{ display: "contents" }}>
                      <dt>{w}</dt>
                      <dd>{v === undefined ? "?" : Number.isInteger(v) ? v : v.toPrecision(6)}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
            {level.kit !== "launchpad" && board && (board.lcd[0] || board.lcd[1]) ? (
              <div className="lcd" role="img" aria-label={`LCD: ${board.lcd[0]} / ${board.lcd[1]}`}>{board.lcd[0].padEnd(20)}{"\n"}{board.lcd[1].padEnd(20)}</div>
            ) : null}
          </Panel>
          {board &&
            VIEWS.filter((v) => v.relevant(board, kit)).map((v) => (
              <Panel key={v.id} id={`view-${v.id}`} title={v.title}>
                <v.Component board={board} kit={kit} nowMs={nowMs} window={[Math.max(0, nowMs - windowMs), Math.max(nowMs, 1)]} live={!!live} />
              </Panel>
            ))}
          <Panel id="signals" title="Pins over time">
            {board ? <Scope kit={kit} traces={board.gpio.trace} fromMs={Math.max(0, nowMs - windowMs)} toMs={Math.max(nowMs, 1)} marks={stimMarks} /> : <p className="hint-text">Run the program to see its pins.</p>}
          </Panel>
          <Panel id="serial" title="Serial terminal (SCIA, 115200 baud)">
            <div className="term" ref={term} role="log" aria-label="Serial terminal output" tabIndex={0}>{serial}</div>
            <form
              className="term-input"
              onSubmit={(e) => {
                e.preventDefault();
                if (live?.running && typed) live.type(typed);
                setTyped("");
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type characters to send" aria-label="Characters to send to the board" disabled={!live?.running} />
              <button className="btn small" disabled={!live?.running}>Send</button>
            </form>
            {board?.console ? (
              <>
                <h4 className="sub">printf console</h4>
                <div className="term" role="log" aria-label="printf output" tabIndex={0}>{board.console}</div>
              </>
            ) : null}
          </Panel>
          <Panel id="registers" title="Registers: what changed, and when">
            {board ? <Registers board={board} onGoto={(line) => editor.current?.goto(line)} /> : <p className="hint-text">Run the program to see the registers it writes.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
