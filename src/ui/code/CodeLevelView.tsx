// A code level: the editor with its toolbar, and the bench.
//
// This component holds the state (the code, the running program, the last
// test result) and steps a running program on every animation frame. It
// does not redraw on a frame: the parts of the bench that show the running
// board do that themselves (BenchPanels.tsx, frame.ts). It redraws when
// something about the run changes that the toolbar or the editor shows:
// running, paused, the line the program stopped on, a new message.
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { frameBus, benchBus, redrawBench, useLive } from "./frame";
import { CopyButton } from "../CopyButton";
import type { CodeLevel } from "../../levels/types";
import type { RunResult } from "../../sim/runner";
import { startTestRun, type TestRun } from "./testrun";
import { LiveSession, type WorldState } from "../../sim/live";
import type { Diagnostic } from "../../sim/board";
import { KITS } from "../../sim/world/kits";
import { store, useSave } from "../store";
import { Editor, type EditorHandle, type Mark } from "./Editor";
import { BenchBarContext, BenchPanels, type BenchBar } from "./BenchPanels";
import { Icon } from "../Icon";
import { setStimuli, worldSetup } from "../views/robot-arena-model";
import { findLevel } from "../../levels/index";
import { compareBests, type BestNote } from "../bests";

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
/** The messages of the running program, or of the last test run. */
function problemsNow(live: LiveSession | null, result: RunResult | null): Problem[] {
  if (live) return problemsOf([...live.board.diagnostics.values()], live.error, live.error?.kind === "compile" ? "Compile error" : "Stopped");
  if (result) return problemsOf(result.diagnostics, result.compileError ?? result.runtimeError, result.compileError ? "Compile error" : "Stopped");
  return [];
}

const SERIAL_CHECKS = new Set(["serial", "serial-period", "uart"]);
/** The program talks over a serial port (serial_printf, the SCI registers, the UART helpers). */
const usesSerial = (src: string) => /serial_|Serial[A-D]\b|Sci[a-d]Regs|UART_/.test(src);
/** The program writes to the robot board's two-line LCD. */
const usesLcd = (src: string) => /\bUART_printfLine\s*\(/.test(src);
/** The program prints with plain printf, which goes to the debugger's console and not to a serial port. */
const usesPrintf = (src: string) => /(^|[^\w.])printf\s*\(/.test(src);
const PIN_CHECKS = new Set(["led", "pin", "blink", "period", "steady", "opposite", "duty", "latency", "uart"]);

/** A function that never changes, calling the newest `fn`: for a part that is not redrawn when only a handler is new. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

/** The messages under the editor. While a program runs it reads them on every bench frame, and redraws when one is new or its count grows. */
const Problems = memo(function Problems({ live, result, onGoto }: { live: LiveSession | null; result: RunResult | null; onGoto: (line: number) => void }) {
  useLive(() => (live ? `${live.board.diagnostics.size}:${[...live.board.diagnostics.values()].reduce((n, d) => n + (d.count ?? 1), 0)}:${live.error?.msg ?? ""}` : ""));
  const problems = problemsNow(live, result);
  return (
    <div className="problems" role="region" aria-label="Compiler messages" aria-live="polite" tabIndex={0}>
      {problems.length === 0 ? (
        <span className="hint-text">{live || result ? "No problems reported." : "Compiler messages and warnings about your program appear here."}</span>
      ) : (
        problems.map((p, i) => (
          <div className={`problem ${p.severity}`} key={i}>
            <span>
              <span className="sev">{p.severity}</span>{" "}
              {p.line > 0 && <button onClick={() => onGoto(p.line)}>line {p.line}</button>}
            </span>
            <span>
              {p.msg}
              {p.count && p.count > 1 ? ` (${p.count} times)` : ""}
            </span>
          </div>
        ))
      )}
    </div>
  );
});

interface ToolbarProps {
  sandbox: boolean;
  testing: boolean;
  running: boolean;
  paused: boolean;
  stateKind: string;
  stateText: string;
  tip: string;
  /** The chip is the page's status line, except in a narrow window, where the summary above the tabs is. */
  chipIsStatus: boolean;
  speed: number;
  onSpeed: (v: number) => void;
  testButton: RefObject<HTMLButtonElement | null>;
  onTest: () => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onStepLine: () => void;
  onStepWrite: () => void;
  getCode: () => string;
  /** The level this one continues, and the student's code for it. */
  earlierTitle?: string;
  earlierCode?: string;
  continued: boolean;
  onDismissContinued: () => void;
  onResetToStarter: () => void;
  onResetToEarlier: () => void;
}

const Toolbar = memo(function Toolbar(p: ToolbarProps) {
  const [resetting, setResetting] = useState(false);
  return (
    <div className="toolbar">
      <div className="tool-row">
        {!p.sandbox && (
          <button className="btn primary" ref={p.testButton} onClick={p.onTest} aria-disabled={p.testing} title="Check your program against the level's tests (Ctrl+Enter)">
            <Icon name="test" size={15} /> Run tests <kbd>Ctrl ↵</kbd>
          </button>
        )}
        {p.running ? (
          <button className="btn" onClick={p.onStop} title="Switch the board off (Ctrl+Shift+Enter)"><Icon name="stop" size={13} /> Stop</button>
        ) : (
          <button className={`btn ${p.sandbox ? "primary" : ""}`} onClick={p.onStart} title="Power the board and run your program (Ctrl+Shift+Enter)"><Icon name="play" size={13} /> Run</button>
        )}
        <button className="btn" disabled={!p.running} onClick={p.onPause} title={p.running ? (p.paused ? "Let the program run on" : "Freeze the program where it is") : "Nothing is running: press Run first"}>
          <Icon name={p.running && p.paused ? "play" : "pause"} size={13} /> <span className="lbl">{p.running && p.paused ? "Resume" : "Pause"}</span>
        </button>
        <button className="btn" onClick={p.onStepLine} title="Run one line of your code, then pause (F10)"><Icon name="step" size={14} /> <span className="lbl">Step line</span></button>
        <button className="btn" onClick={p.onStepWrite} title="Run until the next register write, then pause (F9)"><Icon name="skip" size={13} /> <span className="lbl">Next write</span></button>
      </div>
      <div className="tool-row">
        <span className={`chip state-${p.stateKind}`} role={p.chipIsStatus ? "status" : undefined}>
          <i aria-hidden="true" /> {p.stateText}
        </span>
        <span className="tool-tip" title={p.tip}>{p.tip}</span>
        <label className="speed">
          Speed{" "}
          <select value={p.speed} onChange={(e) => p.onSpeed(+e.target.value)} title="How fast simulated time passes while the program runs">
            <option value={0.0001}>1/10 000</option>
            <option value={0.001}>1/1000</option>
            <option value={0.01}>1/100</option>
            <option value={0.1}>1/10</option>
            <option value={1}>real time</option>
            <option value={10}>10×</option>
          </select>
        </label>
        <CopyButton className="btn ghost small" text={p.getCode} label="Copy code" what="the code in the editor" />
        <button className="btn ghost small" aria-expanded={resetting} onClick={() => setResetting(!resetting)}>
          <Icon name="reset" size={13} /> Reset code
        </button>
      </div>
      {resetting && (
        <div className="tool-note" role="group" aria-label="Reset code">
          <span>Replace everything in the editor with:</span>
          <button className="btn small" onClick={() => { setResetting(false); p.onResetToStarter(); }}>{p.earlierTitle ? "This level's starting code" : "The starting code"}</button>
          {p.earlierTitle && p.earlierCode !== undefined && <button className="btn small" onClick={() => { setResetting(false); p.onResetToEarlier(); }}>Your code from “{p.earlierTitle}”</button>}
          <button className="btn ghost small" onClick={() => setResetting(false)}>Cancel</button>
        </div>
      )}
      {p.continued && p.earlierTitle && !resetting && (
        <div className="tool-note">
          <span>Continuing from your code for {p.earlierTitle}.</span>
          <button className="btn ghost small" onClick={p.onDismissContinued} aria-label="Dismiss this note">Dismiss</button>
        </div>
      )}
    </div>
  );
});

const CodeEditor = memo(Editor);

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
  const [live, setLive] = useState<LiveSession | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  /** The code the shown test result belongs to. */
  const [tested, setTested] = useState("");
  const [speed, setSpeed] = useState(1);
  /** Star values of the last passing run without help. */
  const [bestNotes, setBestNotes] = useState<BestNote[]>([]);
  const editor = useRef<EditorHandle | null>(null);
  const kit = KITS[level.kit];
  const sandbox = level.checks.length === 0;
  const fails = save.fails[level.id] ?? 0;

  // Save the code a moment after the student stops typing, and at once when leaving the level.
  // Code the student never touched is not saved: the level then still opens with its own start
  // (a newer starter, or the code of the level it continues once that one has been written).
  const opened = useRef(code);
  const unsaved = useRef<string | null>(null);
  useEffect(() => {
    if (code === opened.current && store.get().code[level.id] === undefined) {
      unsaved.current = null;
      return;
    }
    unsaved.current = code;
    const t = setTimeout(() => {
      store.setCode(level.id, code);
      unsaved.current = null;
    }, 400);
    return () => clearTimeout(t);
  }, [code, level.id]);
  useEffect(() => {
    const save = () => {
      if (unsaved.current !== null) store.setCode(level.id, unsaved.current);
      unsaved.current = null;
    };
    // Also when the window is closed, reloaded or hidden within that moment.
    const off = store.beforeLeave(save);
    return () => {
      off();
      save();
    };
  }, [level.id]);

  // The live run: stepped on every animation frame. The bench is told, and redraws what shows the board.
  useEffect(() => {
    if (!live || !live.running) return;
    live.speed = speed;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!live.paused) live.step(dt);
      // Views that show motion follow every frame; the rest of the bench redraws less often (see frame.ts).
      frameBus.emit(now, !live.running);
      benchBus.emit(now, !live.running);
      if (live.running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, speed]);

  // What this component shows of the running program. It changes in place, so it is asked on every bench frame,
  // and the component redraws only when the answer is a different one.
  const liveNow = useLive(() =>
    live ? `${live.running}|${live.paused}|${live.running && live.paused ? live.board.line : 0}|${live.error ? `${live.error.kind}:${live.error.line}:${live.error.msg}` : ""}|${live.board.diagnostics.size}` : "",
  );
  const running = !!live?.running;
  const paused = running && live!.paused;
  // A live run begins in the level's world: its room, start pose and goal. Of the test's later stimuli only
  // the poses it puts the LIDAR robot at are used: the live run drives the robot round them.
  const setup = useMemo(() => worldSetup(level.stimuli), [level]);
  const script = useMemo(() => setStimuli(level.stimuli), [level]);
  // What the student changed in the world (terrain, goal, placed objects, where the robot was put down)
  // carries over to the next run of this level, until "Reset world".
  const world = useRef<WorldState | undefined>(undefined);
  useEffect(() => {
    world.current = undefined;
  }, [level]);
  /** The code the live run was started with: an edit made while it runs takes effect at the next Run. */
  const [ran, setRan] = useState(code);
  const edited = running && ran !== code;
  const fresh = () => {
    if (live) world.current = live.worldState;
    setRan(code);
    return new LiveSession(level.kit, code, setup, script, world.current);
  };
  const start = useStable(() => {
    dropTests();
    setLive(fresh());
  });
  const stop = useStable(() => {
    if (live) world.current = live.worldState;
    setLive(null);
  });
  const togglePause = useStable(() => {
    if (!live?.running) return;
    live.paused = !live.paused;
    redrawBench();
  });
  /** Stepping works from a stopped board too: it powers up paused at the first line. */
  const session = (): LiveSession => {
    if (live?.running) return live;
    dropTests();
    const s = fresh();
    s.paused = true;
    setLive(s);
    return s;
  };
  const stepLine = useStable(() => {
    session().stepLine();
    redrawBench();
  });
  const stepWrite = useStable(() => {
    session().stepToWrite();
    redrawBench();
  });
  // A long test run (the capstone drives for many simulated seconds) runs in short turns, so the page
  // keeps drawing and Cancel works (testrun.ts). Leaving the level or starting the board drops it.
  const [testing, setTesting] = useState<TestRun | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const testRun = useRef<TestRun | null>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const dropTests = () => {
    testRun.current?.cancel();
    testRun.current = null;
    setTesting(null);
    setCancelled(false);
  };
  useEffect(() => {
    // A level that was kept while another screen showed comes back with no run in progress.
    setTesting(null);
    return () => {
      testRun.current?.cancel();
      testRun.current = null;
    };
  }, []);
  const cancelTests = useStable(() => {
    if (!testRun.current) return;
    dropTests();
    setCancelled(true);
    // The Cancel button goes away: the focus returns to the button that started the run.
    testButton.current?.focus();
  });
  const test = useStable(() => {
    if (testRun.current) return;
    stop();
    setCancelled(false);
    const source = code;
    const run = startTestRun({ kit: level.kit, source, durationMs: level.durationMs, stimuli: level.stimuli, checks: level.checks, bonus: level.bonus });
    testRun.current = run;
    setTesting(run);
    const mine = () => testRun.current === run;
    run.done.then(
      (r) => {
        if (!mine()) return;
        testRun.current = null;
        // Drawing the result (plots of the whole run, the replay) is work too: as a transition React
        // does it in short pieces, and the progress bar stays until the result replaces it.
        startTransition(() => {
          setTesting(null);
          if (r) showResult(r, source);
        });
      },
      (e) => {
        if (mine()) dropTests();
        throw e;
      },
    );
  });
  // The run may end long after the press: it reports to the level as it is then (a hint opened meanwhile counts).
  const latest = useRef({ onPass, onBests, helped });
  latest.current = { onPass, onBests, helped };
  const showResult = (r: RunResult, source: string) => {
    const { onPass, onBests, helped } = latest.current;
    setResult(r);
    setTested(source);
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
    }
  };
  // The verdict of a failed run must be in view (in a narrow window the board is below the editor).
  // After a pass, LevelView shows the next step instead.
  useEffect(() => {
    if (result && !result.passed) document.querySelector('.bench [data-panel="tests"] .result')?.scrollIntoView({ block: "nearest" });
  }, [result]);

  const stale = !!result && !live && tested !== code;
  // One always-visible statement of what the program is doing.
  const state: { kind: string; text: string } = testing
    ? { kind: "running", text: "Running the tests" }
    : live
    ? live.error
      ? { kind: "bad", text: live.error.kind === "compile" ? "Does not compile" : "Stopped: error" }
      : !live.running
        ? { kind: "idle", text: "Program ended" }
        : live.paused
          ? { kind: "paused", text: `Paused at line ${live.board.line}` }
          : { kind: "running", text: edited ? "Running the code before your edit" : "Running" }
    : cancelled
    ? { kind: "idle", text: "Test run cancelled" }
    : result
      ? result.passed
        ? { kind: "ok", text: "All tests passed" }
        : result.compileError
          ? { kind: "bad", text: "Does not compile" }
          : { kind: "bad", text: `${result.checks.filter((c) => c.pass).length} of ${result.checks.length} tests passed` }
      : { kind: "idle", text: "Not running" };
  const tip = edited
    ? "This run uses the code from before your last edit. Stop, then Run, to try the new code."
    : running
    ? paused
      ? "Step line runs one line. Next write runs to the next register write."
      : "The board is powered: use its buttons, or pause to step."
    : sandbox
      ? "Run powers the board with your program."
      : "Run tests checks the level. Run powers the board so you can try it.";
  // What a failed run needs first, for the summary a narrow window keeps in view.
  const firstFail = result && !result.passed ? result.checks.find((c) => !c.pass) : undefined;
  const statusDetail = testing
    ? "Cancel is on the Board tab."
    : live
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
    onStatus?.({ kind: state.kind, text: !live && !result && !testing && !cancelled ? "Tests not run yet" : state.text, detail: statusDetail || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.text, statusDetail]);
  // Keyboard: Ctrl+Enter tests, Ctrl+Shift+Enter run/stop, F10 step, F9 next write.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) (live?.running ? stop : start)();
        else if (!sandbox) test();
      } else if (e.key === "F10") {
        e.preventDefault();
        stepLine();
      } else if (e.key === "F9") {
        e.preventDefault();
        stepWrite();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [live, sandbox, start, stop, test, stepLine, stepWrite]);
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
  // The lines the editor marks: those with a message, and the one a paused program is on.
  const pausedLine = paused ? live!.board.line : 0;
  const marks: Mark[] = useMemo(
    () => [...problemsNow(live, result).filter((p) => p.line > 0).map((p) => ({ line: p.line, severity: p.severity })), ...(pausedLine ? [{ line: pausedLine, severity: "current" as const }] : [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, result, liveNow, pausedLine],
  );
  // Follow the program in the editor while stepping.
  useEffect(() => {
    if (pausedLine) editor.current?.reveal(pausedLine);
  }, [pausedLine]);

  const replace = (text: string) => {
    setCode(text);
    setContinued(false);
    editor.current?.goto(1);
  };
  const resetToStarter = useStable(() => {
    replace(level.starter);
    if (!earlierCode) store.resetCode(level.id);
  });
  const resetToEarlier = useStable(() => {
    if (earlierCode !== undefined) replace(earlierCode);
  });
  const dismissContinued = useStable(() => setContinued(false));
  const getCode = useStable(() => code);
  const goto = useStable((line: number) => editor.current?.goto(line));
  const bar: BenchBar = useMemo(
    () => ({ running, paused, state: { kind: state.kind, text: state.text }, start, stop, togglePause }),
    [running, paused, state.kind, state.text, start, stop, togglePause],
  );

  return (
    <>
      <div className="pane editor-pane" {...(tab ? { role: "tabpanel", id: "pane-code", "aria-labelledby": "tab-code", hidden: tab !== "code" } : {})}>
        <h2 className="sr-only">Code</h2>
        <Toolbar
          sandbox={sandbox}
          testing={!!testing}
          running={running}
          paused={paused}
          stateKind={state.kind}
          stateText={state.text}
          tip={tip}
          chipIsStatus={!tab}
          speed={speed}
          onSpeed={setSpeed}
          testButton={testButton}
          onTest={test}
          onStart={start}
          onStop={stop}
          onPause={togglePause}
          onStepLine={stepLine}
          onStepWrite={stepWrite}
          getCode={getCode}
          earlierTitle={earlier?.title}
          earlierCode={earlierCode}
          continued={continued}
          onDismissContinued={dismissContinued}
          onResetToStarter={resetToStarter}
          onResetToEarlier={resetToEarlier}
        />
        <CodeEditor value={code} onChange={setCode} marks={marks} handle={editor} kit={level.kit} />
        <Problems live={live} result={result} onGoto={goto} />
      </div>
      {splitter}
      <div className="pane bench" {...(tab ? { role: "tabpanel", id: "pane-board", "aria-labelledby": "tab-board", hidden: tab !== "board" } : {})}>
        <h2 className="sr-only">{sandbox ? "Board" : "Tests and board"}</h2>
        {benchTop}
        <BenchBarContext.Provider value={bar}>
          <BenchPanels
            level={level}
            kit={kit}
            live={live}
            result={result}
            stale={stale}
            testing={testing}
            helped={helped}
            pointers={fails >= 2}
            bestNotes={bestNotes}
            onCancel={cancelTests}
            uses={uses}
            codeSerial={usesSerial(code)}
            codePrintf={usesPrintf(code)}
            codeLcd={usesLcd(code)}
            onGoto={goto}
          />
        </BenchBarContext.Provider>
      </div>
    </>
  );
}
