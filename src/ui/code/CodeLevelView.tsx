import { BENCH_FRAME_MS, frameBus } from "./frame";
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
import { Icon } from "../Icon";
import { VIEWS } from "../views";
import { ArenaContext, type ArenaInfo } from "../views/robot-arena-context";
import { ArenaPreview } from "../views/robot-arena";
import { setStimuli, worldSetup } from "../views/robot-arena-model";
import { Guard } from "../Markdown";
import { findLevel } from "../../levels/index";
import { compareBests, measure, type BestNote } from "../bests";

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

const SERIAL_CHECKS = new Set(["serial", "serial-period", "uart"]);
/** The program talks over a serial port (serial_printf, the SCI registers, the UART helpers). */
const usesSerial = (src: string) => /serial_|Serial[A-D]\b|Sci[a-d]Regs|UART_/.test(src);
/** The program prints with plain printf, which goes to the debugger's console and not to a serial port. */
const usesPrintf = (src: string) => /(^|[^\w.])printf\s*\(/.test(src);

/** A scrolling text output that follows new text only while it is scrolled to the end, so earlier output can be read. */
function Term({ text, label, live }: { text: string; label: string; live: "off" | "polite" }) {
  const el = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (el.current && follow.current) el.current.scrollTop = el.current.scrollHeight;
  });
  return (
    <div
      className="term"
      ref={el}
      role="log"
      aria-live={live}
      aria-label={label}
      tabIndex={0}
      onScroll={(e) => {
        const t = e.currentTarget;
        follow.current = t.scrollHeight - t.scrollTop - t.clientHeight < 8;
      }}
    >
      {text}
    </div>
  );
}
const PIN_CHECKS = new Set(["led", "pin", "blink", "steady", "opposite", "duty", "latency", "uart"]);

export function CodeLevelView({
  level,
  onPass,
  helped = false,
  splitter,
  benchTop,
  tab,
  onStatus,
  onBests,
}: {
  level: CodeLevel;
  onPass: () => void;
  /** The student has seen the last hint or the solution: no stars. */
  helped?: boolean;
  splitter?: ReactNode;
  /** Shown above the bench panels (the "level passed" box). */
  benchTop?: ReactNode;
  /** In a narrow window the panes are tab panels: the one that is showing (undefined on a wide window: both show). */
  tab?: "read" | "code" | "board";
  /** Told what the program or the last test run is doing, for a summary outside the panes. */
  onStatus?: (s: { kind: string; text: string; detail?: string }) => void;
  /** Told the measured star values of a passing run without help, compared with the stored bests. */
  onBests?: (notes: BestNote[]) => void;
}) {
  const save = useSave();
  // A level that continues an earlier one opens with the student's code for that level.
  const earlier = level.continues ? findLevel(level.continues)?.level : undefined;
  const earlierCode = earlier ? save.code[earlier.id] : undefined;
  const [code, setCode] = useState(() => save.code[level.id] ?? earlierCode ?? level.starter);
  const [continued, setContinued] = useState(() => save.code[level.id] === undefined && earlierCode !== undefined);
  const [resetting, setResetting] = useState(false);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [, setFrame] = useState(0);
  const bump = () => setFrame((f) => f + 1);
  const [result, setResult] = useState<RunResult | null>(null);
  /** The code the shown test result belongs to. */
  const [tested, setTested] = useState("");
  const [speed, setSpeed] = useState(1);
  const [typed, setTyped] = useState("");
  /** Star values of the last passing run without help. */
  const [bestNotes, setBestNotes] = useState<BestNote[]>([]);
  const editor = useRef<EditorHandle | null>(null);
  const kit = KITS[level.kit];
  const sandbox = level.checks.length === 0;
  const fails = save.fails[level.id] ?? 0;

  // Save the code a moment after the student stops typing, and at once when leaving the level.
  const unsaved = useRef<string | null>(null);
  useEffect(() => {
    unsaved.current = code;
    const t = setTimeout(() => {
      store.setCode(level.id, code);
      unsaved.current = null;
    }, 400);
    return () => clearTimeout(t);
  }, [code, level.id]);
  useEffect(
    () => () => {
      if (unsaved.current !== null) store.setCode(level.id, unsaved.current);
    },
    [level.id],
  );

  // Animation loop for the live run.
  useEffect(() => {
    if (!live || !live.running) return;
    live.speed = speed;
    let raf = 0;
    let last = performance.now();
    let drawn = 0;
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!live.paused) live.step(dt);
      // Views that show motion follow every frame; the bench as a whole redraws less often (see frame.ts).
      frameBus.emit(now, !live.running);
      if (now - drawn >= BENCH_FRAME_MS || !live.running) {
        drawn = now;
        setFrame((f) => f + 1);
      }
      if (live.running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, speed]);

  const running = !!live?.running;
  // A live run begins in the level's world: its room, start pose and goal. Of the test's later stimuli only
  // the poses it puts the LIDAR robot at are used: the live run drives the robot round them.
  const setup = useMemo(() => worldSetup(level.stimuli), [level]);
  const script = useMemo(() => setStimuli(level.stimuli), [level]);
  const start = () => setLive(new LiveSession(level.kit, code, setup, script));
  const stop = () => setLive(null);
  /** Stepping works from a stopped board too: it powers up paused at the first line. */
  const session = (): LiveSession => {
    if (live?.running) return live;
    const s = new LiveSession(level.kit, code, setup, script);
    s.paused = true;
    setLive(s);
    return s;
  };
  const stepLine = () => {
    session().stepLine();
    bump();
  };
  const stepWrite = () => {
    session().stepToWrite();
    bump();
  };
  const test = () => {
    setLive(null);
    const r = runProgram({ kit: level.kit, source: code, durationMs: level.durationMs, stimuli: level.stimuli, checks: level.checks, bonus: level.bonus });
    setResult(r);
    setTested(code);
    if (r.passed) {
      onPass();
      // Stars count only on a solution that passes the level without the last hint or the reference solution.
      const earned = r.bonus.map((b, i) => (b.pass ? i : -1)).filter((i) => i >= 0);
      if (earned.length && !helped) store.star(level.id, earned);
      // Personal bests count on the same terms as stars: a pass without help.
      const best = helped ? { store: {}, notes: [] } : compareBests(level.bonus ?? [], r.bonus, store.get().bests[level.id]);
      store.best(level.id, best.store);
      setBestNotes(best.notes);
      onBests?.(best.notes);
    } else {
      store.fail(level.id);
      setBestNotes([]);
      // The verdict must be in view (in a narrow window the board is below the editor). After a pass, LevelView shows the next step instead.
      requestAnimationFrame(() => document.querySelector('.bench [data-panel="tests"] .result')?.scrollIntoView({ block: "nearest" }));
    }
  };

  const board = live?.board ?? result?.board ?? null;
  const stale = !!result && !live && tested !== code;
  // One always-visible statement of what the program is doing.
  const state: { kind: string; text: string } = live
    ? live.error
      ? { kind: "bad", text: live.error.kind === "compile" ? "Does not compile" : "Stopped: error" }
      : !live.running
        ? { kind: "idle", text: "Program ended" }
        : live.paused
          ? { kind: "paused", text: `Paused at line ${live.board.line}` }
          : { kind: "running", text: "Running" }
    : result
      ? result.passed
        ? { kind: "ok", text: "All tests passed" }
        : result.compileError
          ? { kind: "bad", text: "Does not compile" }
          : { kind: "bad", text: `${result.checks.filter((c) => c.pass).length} of ${result.checks.length} tests passed` }
      : { kind: "idle", text: "Not running" };
  const tip = running
    ? live!.paused
      ? "Step line runs one line. Next write runs to the next register write."
      : "The board is powered: use its buttons, or pause to step."
    : sandbox
      ? "Run powers the board with your program."
      : "Run tests checks the level. Run powers the board so you can try it.";
  // What a failed run needs first, for the summary a narrow window keeps in view.
  const firstFail = result && !result.passed ? result.checks.find((c) => !c.pass) : undefined;
  const statusDetail = live
    ? ""
    : result && !result.passed
      ? result.compileError
        ? `Line ${result.compileError.line}: ${result.compileError.msg}`
        : result.runtimeError
          ? `Line ${result.runtimeError.line}: ${result.runtimeError.msg}`
          : firstFail
            ? `First to fix: ${firstFail.label}`
            : "An error was reported under the editor."
      : result && tested !== code
        ? "Before your last edit."
        : "";
  useEffect(() => {
    onStatus?.({ kind: state.kind, text: !live && !result ? "Tests not run yet" : state.text, detail: statusDetail || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.text, statusDetail]);
  // Keyboard: Ctrl+Enter tests, Ctrl+Shift+Enter run/stop, F10 step, F9 next write.
  const keys = useRef({ start, stop, test, stepLine, stepWrite });
  keys.current = { start, stop, test, stepLine, stepWrite };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) (live?.running ? keys.current.stop : keys.current.start)();
        else if (!sandbox) keys.current.test();
      } else if (e.key === "F10") {
        e.preventDefault();
        keys.current.stepLine();
      } else if (e.key === "F9") {
        e.preventDefault();
        keys.current.stepWrite();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [live, sandbox]);
  // Signals this level is about: the ones its tests set or check.
  const focus = useMemo(() => {
    const names = new Set<string>();
    for (const c of [...level.checks, ...(level.bonus ?? [])]) if (c.kind === "signal") names.add(c.name);
    for (const st of level.stimuli ?? []) if ("set" in st) names.add(st.set);
    return names;
  }, [level]);
  // Panels a level has no use for stay away until the program itself uses them.
  const uses = useMemo(() => {
    const checks = [...level.checks, ...(level.bonus ?? [])];
    const stim = level.stimuli ?? [];
    return {
      serial: checks.some((c) => SERIAL_CHECKS.has(c.kind)) || stim.some((s) => "type" in s) || usesSerial(level.starter + level.solution),
      console: checks.some((c) => c.kind === "console") || usesPrintf(level.starter + level.solution),
      pins: checks.some((c) => PIN_CHECKS.has(c.kind)) || stim.some((s) => "press" in s || "release" in s),
    };
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
  // The serial terminal is for programs that use a serial port; plain printf has its own console.
  const showSerial = sandbox || uses.serial || serial !== "" || usesSerial(code);
  const showConsole = uses.console || !!board?.console || usesPrintf(code);
  const showPins = sandbox || uses.pins || (board?.gpio.trace.size ?? 0) > 0;
  const nPass = result ? result.checks.filter((c) => c.pass).length : 0;
  // A failed check says what was seen; its pointer to the cause waits for the second failed run.
  const pointers = fails >= 2;
  const held = !!result && !result.passed && !pointers && result.checks.some((c) => !c.pass && c.hint);
  // The robot arena leads the bench on levels where the robot drives through a world or reports where it thinks it is.
  const arenaLeads = useMemo(() => setup.some((x) => x.set === "ROBOT_WORLD" && x.value === 1) || /tb_report_pose\s*\(/.test(level.starter + level.solution), [setup, level]);
  const hasWorld = setup.some((x) => x.set === "ROBOT_WORLD" && x.value === 1);
  const allChecks = useMemo(() => [...level.checks, ...(level.bonus ?? [])], [level]);
  const arena: ArenaInfo = { stimuli: level.stimuli ?? [], checks: allChecks, results: !live && result && !result.compileError ? [...result.checks, ...result.bonus] : undefined, watch: level.watch ?? [], session: live, redraw: bump, durationMs: level.durationMs };
  const span: [number, number] = [Math.max(0, nowMs - windowMs), Math.max(nowMs, 1)];
  // In the large view of a narrow window the editor's toolbar is on another tab: the panel carries the two buttons that matter.
  const viewBar = (
    <div className="tool-row">
      {running ? (
        <button className="btn small" onClick={stop} aria-label="Stop the program">Stop</button>
      ) : (
        <button className="btn small" onClick={start} aria-label="Run the program">Run</button>
      )}
      <button className="btn small" disabled={!running} onClick={() => { live!.paused = !live!.paused; bump(); }} aria-label={running && live!.paused ? "Resume the program" : "Pause the program"}>{running && live!.paused ? "Resume" : "Pause"}</button>
      <span className={`chip state-${state.kind}`}><i aria-hidden="true" /> {state.text}</span>
    </div>
  );
  const viewPanel = (v: (typeof VIEWS)[number], lead: boolean) => (
    <Panel key={v.id} id={`view-${v.id}`} title={v.title} expand={{ sizeKey: `view-${v.id}${lead ? "-lead" : ""}`, defaultSize: lead ? "wide" : "normal", bar: viewBar }}>
      <Guard what="This view">
        {board && v.relevant(board, kit) ? <v.Component board={board} kit={kit} nowMs={nowMs} window={span} live={!!live} /> : <ArenaPreview />}
      </Guard>
    </Panel>
  );
  const arenaView = VIEWS.find((v) => v.id === "robot-arena");
  // Shown first: when it leads and there is something to show (before a run, the level's world from its stimuli).
  const arenaFirst = !!arenaView && arenaLeads && ((!!board && arenaView.relevant(board, kit)) || hasWorld);
  const replace = (text: string) => {
    setCode(text);
    setContinued(false);
    setResetting(false);
    editor.current?.goto(1);
  };

  return (
    <>
      <div className="pane editor-pane" {...(tab ? { role: "tabpanel", id: "pane-code", "aria-labelledby": "tab-code", hidden: tab !== "code" } : {})}>
        <h2 className="sr-only">Code</h2>
        <div className="toolbar">
          <div className="tool-row">
            {!sandbox && (
              <button className="btn primary" onClick={test} title="Check your program against the level's tests (Ctrl+Enter)">
                <Icon name="test" size={15} /> Run tests <kbd>Ctrl ↵</kbd>
              </button>
            )}
            {running ? (
              <button className="btn" onClick={stop} title="Switch the board off (Ctrl+Shift+Enter)"><Icon name="stop" size={13} /> Stop</button>
            ) : (
              <button className={`btn ${sandbox ? "primary" : ""}`} onClick={start} title="Power the board and run your program (Ctrl+Shift+Enter)"><Icon name="play" size={13} /> Run</button>
            )}
            <button className="btn" disabled={!running} onClick={() => { live!.paused = !live!.paused; bump(); }} title={running ? (live!.paused ? "Let the program run on" : "Freeze the program where it is") : "Nothing is running: press Run first"}>
              <Icon name={running && live!.paused ? "play" : "pause"} size={13} /> <span className="lbl">{running && live!.paused ? "Resume" : "Pause"}</span>
            </button>
            <button className="btn" onClick={stepLine} title="Run one line of your code, then pause (F10)"><Icon name="step" size={14} /> <span className="lbl">Step line</span></button>
            <button className="btn" onClick={stepWrite} title="Run until the next register write, then pause (F9)"><Icon name="skip" size={13} /> <span className="lbl">Next write</span></button>
          </div>
          <div className="tool-row">
            <span className={`chip state-${state.kind}`} role={tab ? undefined : "status"}>
              <i aria-hidden="true" /> {state.text}
            </span>
            <span className="tool-tip" title={tip}>{tip}</span>
            <label className="speed">
              Speed{" "}
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="How fast simulated time passes while the program runs">
                <option value={0.0001}>1/10 000</option>
                <option value={0.001}>1/1000</option>
                <option value={0.01}>1/100</option>
                <option value={0.1}>1/10</option>
                <option value={1}>real time</option>
                <option value={10}>10×</option>
              </select>
            </label>
            <button className="btn ghost small" aria-expanded={resetting} onClick={() => setResetting(!resetting)}>
              <Icon name="reset" size={13} /> Reset code
            </button>
          </div>
          {resetting && (
            <div className="tool-note" role="group" aria-label="Reset code">
              <span>Replace everything in the editor with:</span>
              <button className="btn small" onClick={() => { replace(level.starter); if (!earlierCode) store.resetCode(level.id); }}>{earlier ? "This level's starting code" : "The starting code"}</button>
              {earlier && earlierCode !== undefined && <button className="btn small" onClick={() => replace(earlierCode)}>Your code from “{earlier.title}”</button>}
              <button className="btn ghost small" onClick={() => setResetting(false)}>Cancel</button>
            </div>
          )}
          {continued && earlier && !resetting && (
            <div className="tool-note">
              <span>Continuing from your code for {earlier.title}.</span>
              <button className="btn ghost small" onClick={() => setContinued(false)} aria-label="Dismiss this note">Dismiss</button>
            </div>
          )}
        </div>
        <Editor value={code} onChange={setCode} marks={marks} handle={editor} />
        <div className="problems" aria-live="polite">
          {problems.length === 0 ? (
            <span className="hint-text">{live || result ? "No problems reported." : "Compiler messages and warnings about your program appear here."}</span>
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
      <div className="pane bench" {...(tab ? { role: "tabpanel", id: "pane-board", "aria-labelledby": "tab-board", hidden: tab !== "board" } : {})}>
        <h2 className="sr-only">{sandbox ? "Board" : "Tests and board"}</h2>
        {benchTop}
        <ArenaContext.Provider value={arena}>
        <div className="bench-panels">
          {!sandbox && (
            <Panel id="tests" title="Tests" note={result ? `${nPass} of ${result.checks.length} passed${stale ? ", before your last edit" : ""}` : undefined}>
              {!result ? (
                <p className="hint-text">Press <strong>Run tests</strong>. The tests run your program for {level.durationMs} ms of simulated time{level.stimuli?.length ? ", pressing buttons, turning knobs or typing at fixed times," : ""} and check the points below.</p>
              ) : (
                <div className={`result ${result.passed ? "ok" : "bad"}`}>
                  <Icon name={result.passed ? "check" : "cross"} size={16} />{" "}
                  {result.passed
                    ? "All checks passed."
                    : result.compileError
                      ? "The code does not compile yet. See the message under the editor."
                      : result.runtimeError
                        ? "The program stopped with an error. See the message under the editor."
                        : result.checks.every((c) => c.pass)
                          ? "The checks pass, but an error was reported under the editor. Fix it to finish the level."
                          : `${result.checks.length - nPass} of ${result.checks.length} checks failed. Each one says what was seen.`}
                  {stale && <span className="tiny"> This is the result for the code before your last edit: run the tests again.</span>}
                </div>
              )}
              <ul className="checks">
                {(result?.checks ?? level.checks.map((c) => ({ label: c.label, pass: null as boolean | null, detail: "", hint: undefined }))).map((c, i) => (
                  <li key={i}>
                    <span className={c.pass === null ? "todo" : c.pass ? "pass" : "fail"} aria-hidden="true"><Icon name={c.pass === null ? "dot" : c.pass ? "check" : "cross"} size={15} /></span>
                    <span>
                      <span className="sr-only">{c.pass === null ? "Not run: " : c.pass ? "Passed: " : "Failed: "}</span>
                      {c.label}
                    </span>
                    {c.detail && <span className="detail">{c.detail}</span>}
                    {c.hint && pointers && <span className="hintline">{c.hint}</span>}
                  </li>
                ))}
              </ul>
              {held && <p className="tiny">Work from what was seen first. If a run fails again, each failed check adds a pointer to the likely cause.</p>}
              {level.bonus && level.bonus.length > 0 && (
                <>
                  <h4 className="sub">Stars (optional)</h4>
                  <ul className="checks bonus">
                    {level.bonus.map((b, i) => {
                      const r = result?.bonus[i];
                      const kept = save.stars[level.id]?.includes(i) ?? false;
                      const now = !!r?.pass && !!result?.passed && !helped;
                      const stored = save.bests[level.id]?.[b.label];
                      const best = stored !== undefined ? measure(b, stored) : null;
                      const fresh = bestNotes.find((n) => n.label === b.label)?.improved && !stale;
                      return (
                        <li key={i}>
                          <span className={now || kept ? "star on" : "star"} aria-hidden="true"><Icon name="star" size={14} /></span>
                          <span>
                            <span className="sr-only">{now || kept ? "Earned: " : "Not earned: "}</span>
                            {b.label}
                            {kept && !now && result ? " (earned earlier)" : ""}
                          </span>
                          {r?.detail && <span className="detail">{r.detail}</span>}
                          {best && (
                            <span className="best">
                              <span>Best: <b>{best.text}</b></span>
                              {fresh && <span className="best-new">New best</span>}
                            </span>
                          )}
                          {r && !r.pass && r.hint && pointers && <span className="hintline">{r.hint}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {helped && <p className="tiny">Stars are for a pass without the last hint or the reference solution.</p>}
                </>
              )}
            </Panel>
          )}
          {arenaFirst && viewPanel(arenaView!, true)}
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
                    <div key={w}>
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
          {board && VIEWS.filter((v) => v.relevant(board, kit) && !(arenaFirst && v === arenaView)).map((v) => viewPanel(v, false))}
          {showPins && (
            <Panel id="signals" title="Pins over time">
              {board ? <Scope kit={kit} traces={board.gpio.trace} fromMs={Math.max(0, nowMs - windowMs)} toMs={Math.max(nowMs, 1)} marks={stimMarks} /> : <p className="hint-text">Run the program to see its pins.</p>}
            </Panel>
          )}
          {showConsole && (
            <Panel id="console" title="printf console" note="what printf prints">
              {board?.console ? <Term text={board.console} label="printf output" live="off" /> : <p className="hint-text">Run the program to see what it prints.</p>}
            </Panel>
          )}
          {showSerial && (
            <Panel id="serial" title="Serial terminal" note="SCIA, 115200 baud">
              <Term text={serial} label="Serial terminal output" live={running && !live!.paused ? "off" : "polite"} />
              <form
                className="term-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (live?.running && typed) live.type(typed);
                  setTyped("");
                }}
              >
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={running ? "Type characters to send" : "Press Run to type to the board"} aria-label="Characters to send to the board" disabled={!running} />
                <button className="btn small" disabled={!running}>Send</button>
              </form>
            </Panel>
          )}
          <Panel id="registers" title="Registers" note="what changed, and when">
            {board ? <Registers board={board} onGoto={(line) => editor.current?.goto(line)} /> : <p className="hint-text">Run the program to see the registers it writes.</p>}
          </Panel>
        </div>
        </ArenaContext.Provider>
      </div>
    </>
  );
}
