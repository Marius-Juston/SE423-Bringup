// The panels of the bench: the tests, the board, the views, pins, consoles
// and registers.
//
// While a program runs its board changes in place, about 20 times a second
// as far as the bench is concerned. Only what shows the board redraws then:
// each panel's content is a component of its own that subscribes to the
// bench frame (frame.ts). The panels' frames, the tests and everything
// above the bench do not redraw on a frame. Which panels there are can
// change while the program runs (a view appears when the program first uses
// what it shows): that is asked on every frame and redraws the list only
// when the answer changes.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { CodeLevel } from "../../levels/types";
import type { RunResult } from "../../sim/runner";
import type { LiveSession } from "../../sim/live";
import type { Kit } from "../../sim/world/kits";
import { useSave } from "../store";
import { Parts, Scope } from "./Bench";
import { Registers } from "./Registers";
import { Panel } from "../Panel";
import { Icon } from "../Icon";
import { VIEWS } from "../views";
import { ArenaContext, type ArenaInfo } from "../views/robot-arena-context";
import { ArenaPreview } from "../views/robot-arena";
import { worldSetup } from "../views/robot-arena-model";
import { Guard } from "../Markdown";
import { measure, type BestNote } from "../bests";
import { usePref } from "../prefs";
import { autoWindowMs, windowName, WINDOW_DEFAULT_MS, WINDOW_STEPS_MS } from "./window";
import { benchBus, redrawBench, useBenchFrame, useLive } from "./frame";
import { useTestProgress, type TestRun } from "./testrun";

type View = (typeof VIEWS)[number];
/** The window the live panels have chosen by themselves, kept between frames so it does not change size at every small change of rate. */
type AutoWindow = RefObject<{ frame: number; ms: number | undefined }>;

/** Where the bench is in time: now, and the stretch of time its panels draw. */
function benchTime(live: LiveSession | null, result: RunResult | null, windowPref: number, auto: AutoWindow): { nowMs: number; span: [number, number] } {
  const nowMs = live ? live.timeMs : (result?.endMs ?? 0);
  // A live run shows a window that moves with time: sized from what the program does, or fixed by hand.
  // A test run is finite, and shows all of it.
  // Every panel asks on every frame: the answer is worked out once per frame.
  const frame = benchBus.get();
  if (!live) auto.current = { frame, ms: undefined };
  else if (auto.current.frame !== frame || auto.current.ms === undefined) auto.current = { frame, ms: autoWindowMs({ isrLog: live.board.isrLog, pins: live.board.gpio.trace.values() }, auto.current.ms) };
  const chosenMs = WINDOW_STEPS_MS.includes(windowPref) ? windowPref : (auto.current.ms ?? WINDOW_DEFAULT_MS);
  const windowMs = live ? Math.min(Math.max(nowMs, 1), chosenMs) : Math.max(nowMs, 1);
  return { nowMs, span: [Math.max(0, nowMs - windowMs), Math.max(nowMs, 1)] };
}

/** A scrolling text output that follows new text only while it is scrolled to the end, so earlier output can be read. */
function Term({ text, label, live }: { text: string; label: string; live: "off" | "polite" }) {
  const el = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Only when the text changed: reading the height makes the browser lay the page out there and then.
  useEffect(() => {
    if (el.current && follow.current) el.current.scrollTop = el.current.scrollHeight;
  }, [text]);
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

/** How far a test run is: a bar that only moves when its value does. */
function TestProgress({ run, durationMs }: { run: TestRun; durationMs: number }) {
  const pct = useTestProgress(run);
  return (
    <div className="test-progress" role="progressbar" aria-label="Test run" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} % of ${durationMs} ms`}>
      <i style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

interface TestsProps {
  level: CodeLevel;
  result: RunResult | null;
  /** The result is for code the student has since changed. */
  stale: boolean;
  testing: TestRun | null;
  helped: boolean;
  /** A failed check also shows its pointer to the likely cause (from the second failed run on). */
  pointers: boolean;
  bestNotes: BestNote[];
  onCancel: () => void;
}

const TestsPanel = memo(function TestsPanel({ level, result, stale, testing, helped, pointers, bestNotes, onCancel }: TestsProps) {
  const save = useSave();
  const nPass = result ? result.checks.filter((c) => c.pass).length : 0;
  // A failed check says what was seen; its pointer to the cause waits for the second failed run.
  const held = !!result && !result.passed && !pointers && result.checks.some((c) => !c.pass && c.hint);
  // Each test run draws its rows anew (they arrive one after the other, see "motion" in styles.css).
  const run = useRef({ of: result, n: 0 });
  if (run.current.of !== result) run.current = { of: result, n: run.current.n + 1 };
  const ran = result ? "ran" : "";
  return (
    <Panel id="tests" title="Tests" note={result ? `${nPass} of ${result.checks.length} passed${stale ? ", before your last edit" : ""}` : undefined}>
      {testing ? (
        <div className="test-run">
          <p className="hint-text" role="status">Running the tests: {level.durationMs} ms of simulated time.</p>
          <TestProgress run={testing} durationMs={level.durationMs} />
          <button className="btn small" onClick={onCancel}>Cancel</button>
        </div>
      ) : !result ? (
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
      <ul className={`checks ${ran}`} key={run.current.n}>
        {(result?.checks ?? level.checks.map((c) => ({ label: c.label, pass: null as boolean | null, detail: "", hint: undefined }))).map((c, i) => (
          <li key={i} style={{ "--i": i } as CSSProperties}>
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
          <ul className={`checks bonus ${ran}`} key={run.current.n}>
            {level.bonus.map((b, i) => {
              const r = result?.bonus[i];
              const kept = save.stars[level.id]?.includes(i) ?? false;
              const now = !!r?.pass && !!result?.passed && !helped;
              const stored = save.bests[level.id]?.[b.label];
              const best = stored !== undefined ? measure(b, stored) : null;
              const fresh = bestNotes.find((n) => n.label === b.label)?.improved && !stale;
              return (
                <li key={i} style={{ "--i": (result?.checks.length ?? 0) + i } as CSSProperties}>
                  <span className={now || kept ? "star on" : "star"} aria-hidden="true"><Icon name={now || kept ? "star" : "star-open"} size={14} /></span>
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
  );
});

/** What the buttons of a view's large panel need: in a narrow window the editor's toolbar is on another tab. */
export interface BenchBar {
  running: boolean;
  paused: boolean;
  state: { kind: string; text: string };
  start(): void;
  stop(): void;
  togglePause(): void;
}
export const BenchBarContext = createContext<BenchBar | null>(null);

function ViewBar() {
  const bar = useContext(BenchBarContext);
  if (!bar) return null;
  return (
    <div className="tool-row">
      {bar.running ? (
        <button className="btn small" onClick={bar.stop} aria-label="Stop the program">Stop</button>
      ) : (
        <button className="btn small" onClick={bar.start} aria-label="Run the program">Run</button>
      )}
      <button className="btn small" disabled={!bar.running} onClick={bar.togglePause} aria-label={bar.running && bar.paused ? "Resume the program" : "Pause the program"}>{bar.running && bar.paused ? "Resume" : "Pause"}</button>
      <span className={`chip state-${bar.state.kind}`}><i aria-hidden="true" /> {bar.state.text}</span>
    </div>
  );
}
const VIEW_BAR = <ViewBar />;

/** What every part that shows the board is given. `live` and the board inside it change in place: read them, never compare them. */
interface Shown {
  live: LiveSession | null;
  result: RunResult | null;
  kit: Kit;
  auto: AutoWindow;
}
const boardOf = (live: LiveSession | null, result: RunResult | null) => live?.board ?? result?.board ?? null;
const useWindowPref = () => usePref<number>("bench-window", 0);

const BoardBody = memo(function BoardBody({ live, result, kit, auto, level, codeLcd }: Shown & { level: CodeLevel; codeLcd: boolean }) {
  useBenchFrame();
  const [windowPref, setWindowPref] = useWindowPref();
  const board = boardOf(live, result);
  const { nowMs } = benchTime(live, result, windowPref, auto);
  // Signals this level is about: the ones its tests set or check.
  const focus = useMemo(() => {
    const names = new Set<string>();
    for (const c of [...level.checks, ...(level.bonus ?? [])]) if (c.kind === "signal") names.add(c.name);
    for (const st of level.stimuli ?? []) if ("set" in st) names.add(st.set);
    return names;
  }, [level]);
  return (
    <>
      <Parts kit={kit} board={board} pressed={live ? (id) => live.isPressed(id) : undefined} onButton={live?.running ? (id, d) => live.setButton(id, d) : undefined} onKnob={live?.running ? (id, v) => live.setKnob(id, v) : undefined} focus={focus} />
      <p className="simstate" aria-live="off">
        {live ? (live.running ? `${live.paused ? `paused at line ${live.board.line}` : "running"} · t = ${nowMs.toFixed(nowMs < 100 ? 4 : 1)} ms${live.load < 0.9 ? ` · ${Math.round(live.load * 100)}% of requested speed` : ""}` : `stopped at ${nowMs.toFixed(3)} ms`) : result ? `test run · ${nowMs.toFixed(1)} ms` : "Press Run to power the board."}
        {board?.mainReturned ? " · main() has returned" : ""}
      </p>
      {live && (
        <label className="speed bench-window">
          Time shown{" "}
          <select value={WINDOW_STEPS_MS.includes(windowPref) ? windowPref : 0} onChange={(e) => setWindowPref(+e.target.value)} title="How much of the recent past the interrupt, pin and signal panels show while the program runs">
            <option value={0}>automatic: last {windowName(auto.current.ms ?? WINDOW_DEFAULT_MS)}</option>
            {WINDOW_STEPS_MS.map((ms) => (
              <option key={ms} value={ms}>last {windowName(ms)}</option>
            ))}
          </select>
        </label>
      )}
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
      {/* The robot board's LCD: two lines of 20 characters, written with UART_printfLine. It shows as soon as the program uses it. */}
      {level.kit === "robot" && board && (board.lcd[0] || board.lcd[1] || codeLcd) ? (
        <figure className="lcd-wrap">
          <div className="lcd" role="img" aria-label={board.lcd[0] || board.lcd[1] ? `LCD, line 1: ${board.lcd[0] || "empty"}. Line 2: ${board.lcd[1] || "empty"}.` : "LCD: nothing printed yet"}>{board.lcd[0].padEnd(20)}{"\n"}{board.lcd[1].padEnd(20)}</div>
          <figcaption>The robot's LCD: 2 lines of 20 characters. <code>UART_printfLine(1, ...)</code> writes the top line, <code>UART_printfLine(2, ...)</code> the bottom one.</figcaption>
        </figure>
      ) : null}
    </>
  );
});

const ViewBody = memo(function ViewBody({ live, result, kit, auto, view }: Shown & { view: View }) {
  useBenchFrame();
  const [windowPref] = useWindowPref();
  const board = boardOf(live, result);
  const { nowMs, span } = benchTime(live, result, windowPref, auto);
  // Before any run the arena shows the level's world from its stimuli.
  return <Guard what="This view">{board && view.relevant(board, kit) ? <view.Component board={board} kit={kit} nowMs={nowMs} window={span} live={!!live} /> : <ArenaPreview />}</Guard>;
});

const PinsBody = memo(function PinsBody({ live, result, kit, auto, level }: Shown & { level: CodeLevel }) {
  useBenchFrame();
  const [windowPref] = useWindowPref();
  const board = boardOf(live, result);
  const { span } = benchTime(live, result, windowPref, auto);
  const tested = !live && !!result;
  const marks = useMemo(
    () => (tested ? (level.stimuli ?? []).map((s) => ({ tMs: s.at, label: "press" in s ? `${s.press}↓` : "release" in s ? `${s.release}↑` : "set" in s ? `${s.set}=${s.value}` : `'${s.type}'` })) : []),
    [tested, level],
  );
  return board ? <Scope kit={kit} traces={board.gpio.trace} fromMs={span[0]} toMs={span[1]} marks={marks} /> : <p className="hint-text">Run the program to see its pins.</p>;
});

const ConsoleBody = memo(function ConsoleBody({ live, result }: Pick<Shown, "live" | "result">) {
  useBenchFrame();
  const board = boardOf(live, result);
  return board?.console ? <Term text={board.console} label="printf output" live="off" /> : <p className="hint-text">Run the program to see what it prints.</p>;
});

const SerialBody = memo(function SerialBody({ live, result }: Pick<Shown, "live" | "result">) {
  useBenchFrame();
  const [typed, setTyped] = useState("");
  const running = !!live?.running;
  const serial = live ? live.board.sci.text(0) : (result?.serial[0] ?? "");
  return (
    <>
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
    </>
  );
});

const RegistersBody = memo(function RegistersBody({ live, result, onGoto }: Pick<Shown, "live" | "result"> & { onGoto: (line: number) => void }) {
  useBenchFrame();
  const board = boardOf(live, result);
  return board ? <Registers board={board} onGoto={onGoto} /> : <p className="hint-text">Run the program to see the registers it writes.</p>;
});

export interface BenchProps extends Omit<TestsProps, "level"> {
  level: CodeLevel;
  kit: Kit;
  live: LiveSession | null;
  /** The level's own code talks over a serial port, prints with printf, uses the pins: those panels show before any run. */
  uses: { serial: boolean; console: boolean; pins: boolean };
  /** The same, for the code in the editor now. */
  codeSerial: boolean;
  codePrintf: boolean;
  codeLcd: boolean;
  onGoto: (line: number) => void;
}

/** The panels that show the board. Redraws when the set of panels changes; their contents redraw themselves. */
const BoardPanels = memo(function BoardPanels({ level, kit, live, result, uses, codeSerial, codePrintf, codeLcd, onGoto }: Omit<BenchProps, keyof Omit<TestsProps, "level" | "result">>) {
  const sandbox = level.checks.length === 0;
  const auto = useRef<{ frame: number; ms: number | undefined }>({ frame: -1, ms: undefined });
  // Asked on every frame, drawn again only when the answer changes: the views the board has a use for, and whether
  // a pin has changed, printf has printed and the serial port has sent.
  const panels = useLive(() => {
    const b = boardOf(live, result);
    const views = b ? VIEWS.filter((v) => v.relevant(b, kit)).map((v) => v.id).join(",") : "";
    const sent = live ? live.board.sci.tx[0].length > 0 : (result?.serial[0] ?? "") !== "";
    return `${views}|${(b?.gpio.trace.size ?? 0) > 0}|${!!b?.console}|${sent}`;
  });
  const [viewIds, pinsMoved, printed, sent] = panels.split("|");
  const relevant = new Set(viewIds ? viewIds.split(",") : []);
  const board = boardOf(live, result);
  // The serial terminal is for programs that use a serial port; plain printf has its own console.
  const showSerial = sandbox || uses.serial || sent === "true" || codeSerial;
  const showConsole = uses.console || printed === "true" || codePrintf;
  const showPins = sandbox || uses.pins || pinsMoved === "true";
  // The robot arena leads the bench on levels where the robot drives through a world or reports where it thinks it is.
  const hasWorld = useMemo(() => worldSetup(level.stimuli).some((x) => x.set === "ROBOT_WORLD" && x.value === 1), [level]);
  const arenaLeads = useMemo(() => hasWorld || /tb_report_pose\s*\(/.test(level.starter + level.solution), [hasWorld, level]);
  const arenaView = VIEWS.find((v) => v.id === "robot-arena");
  // Shown first: when it leads and there is something to show (before a run, the level's world from its stimuli).
  const arenaFirst = !!arenaView && arenaLeads && ((!!board && relevant.has(arenaView.id)) || hasWorld);
  const arena: ArenaInfo = useMemo(
    () => ({
      stimuli: level.stimuli ?? [],
      checks: [...level.checks, ...(level.bonus ?? [])],
      results: !live && result && !result.compileError ? [...result.checks, ...result.bonus] : undefined,
      watch: level.watch ?? [],
      session: live,
      redraw: redrawBench,
      durationMs: level.durationMs,
    }),
    [level, live, result],
  );
  const shown = { live, result, kit, auto };
  const viewPanel = (v: View, lead: boolean) => (
    <Panel key={v.id} id={`view-${v.id}`} title={v.title} expand={{ sizeKey: `view-${v.id}${lead ? "-lead" : ""}`, defaultSize: lead ? "wide" : "normal", bar: VIEW_BAR }}>
      <ViewBody {...shown} view={v} />
    </Panel>
  );
  return (
    <ArenaContext.Provider value={arena}>
      {arenaFirst && viewPanel(arenaView!, true)}
      <Panel id="board" title={kit.name}>
        <BoardBody {...shown} level={level} codeLcd={codeLcd} />
      </Panel>
      {VIEWS.filter((v) => relevant.has(v.id) && !(arenaFirst && v === arenaView)).map((v) => viewPanel(v, false))}
      {showPins && (
        <Panel id="signals" title="Pins over time">
          <PinsBody {...shown} level={level} />
        </Panel>
      )}
      {showConsole && (
        <Panel id="console" title="printf console" note="what printf prints">
          <ConsoleBody live={live} result={result} />
        </Panel>
      )}
      {showSerial && (
        <Panel id="serial" title="Serial terminal" note="SCIA, 115200 baud">
          <SerialBody live={live} result={result} />
        </Panel>
      )}
      <Panel id="registers" title="Registers" note="what changed, and when">
        <RegistersBody live={live} result={result} onGoto={onGoto} />
      </Panel>
    </ArenaContext.Provider>
  );
});

/** Everything under the bench's heading: the tests, then the board and what it shows. */
export const BenchPanels = memo(function BenchPanels({ level, kit, live, result, stale, testing, helped, pointers, bestNotes, onCancel, uses, codeSerial, codePrintf, codeLcd, onGoto }: BenchProps) {
  const sandbox = level.checks.length === 0;
  return (
    <div className="bench-panels">
      {!sandbox && <TestsPanel level={level} result={result} stale={stale} testing={testing} helped={helped} pointers={pointers} bestNotes={bestNotes} onCancel={onCancel} />}
      <BoardPanels level={level} kit={kit} live={live} result={result} uses={uses} codeSerial={codeSerial} codePrintf={codePrintf} codeLcd={codeLcd} onGoto={onGoto} />
    </div>
  );
});
