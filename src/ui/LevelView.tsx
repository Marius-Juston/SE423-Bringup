import { useEffect, useRef, useState } from "react";
import { findLevel, nextLevel } from "../levels/index";
import { KIND_LABEL, chapterLabel, kindOf, tierOf, type Ref } from "../levels/types";
import { store, useSave } from "./store";
import { Markdown } from "./Markdown";
import { trmRef } from "./device";
import { openExternal } from "./external";
import { Quiz } from "./widgets/Quiz";
import { Calc } from "./widgets/Calc";
import { Order } from "./widgets/Order";
import { Timing } from "./widgets/Timing";
import { Wiring } from "./widgets/Wiring";
import { RegisterPuzzle } from "./widgets/RegisterPuzzle";
import { CodeLevelView } from "./code/CodeLevelView";
import type { View } from "./App";
import { Splitter } from "./Splitter";
import { Icon } from "./Icon";
import { usePref } from "./prefs";

/** Width of the window in CSS pixels, kept up to date. */
export function useWinWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

const SPLIT = 7;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Pane widths for a window `winW` wide. Whatever was saved or dragged, every
 * pane keeps a usable minimum and the three always add up to the window:
 * the editor never gets narrower than `EDITOR_MIN`.
 */
export const EDITOR_MIN = 380;
export const BENCH_MIN = 300;
export function benchWidth(winW: number, taskW: number, pref: unknown): { bench: number; max: number } {
  const max = winW - (taskW ? taskW + 2 * SPLIT : SPLIT) - EDITOR_MIN;
  return { bench: clamp(num(pref, 440), BENCH_MIN, max), max: Math.max(BENCH_MIN, max) };
}

export function Refs({ refs }: { refs: Ref[] }) {
  return (
    <ul className="refs" aria-label="Sources">
      {refs.map((r, i) => {
        if (r.trm) {
          const t = trmRef(r.trm);
          return (
            <li key={i}>
              <a href={t?.url} target="_blank" rel="noreferrer" title="Opens the Technical Reference Manual at this page" onClick={(e) => t && openExternal(e, t.url)}>
                TRM §{r.trm} {t ? `${t.title}, p. ${t.page}` : ""}
              </a>
            </li>
          );
        }
        return <li key={i}>{r.course}</li>;
      })}
    </ul>
  );
}

export function LevelView({ id, go }: { id: string; go: (v: View) => void }) {
  const { level, chapter, index } = findLevel(id)!;
  const save = useSave();
  const passed = !!save.passed[id];
  const assisted = passed && !!save.assisted[id];
  const [justPassed, setJustPassed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [solutionOpened, setSolutionOpened] = useState(false);
  const shown = save.hints[id] ?? 0;
  const hints = level.hints ?? [];
  const next = nextLevel(id);
  const isCode = level.kind === "code";
  const reading = level.kind === "brief" || level.kind === "quiz";
  // A code level passed with the last hint showing or the reference solution open is passed "with help".
  const helped = isCode && ((hints.length > 0 && shown >= hints.length) || solutionOpened);
  const helpedNow = useRef(helped);
  helpedNow.current = helped;
  const onPass = () => {
    store.pass(id, helpedNow.current);
    setJustPassed(true);
  };

  // After a pass the next step comes into view, and takes the focus unless the student is typing code.
  const passBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!justPassed) return;
    const box = passBox.current;
    box?.scrollIntoView({ block: "nearest" });
    if (!document.activeElement?.closest(".cm-editor")) box?.querySelector<HTMLElement>("button")?.focus();
  }, [justPassed]);

  const [scale] = usePref<number>("text-scale", 1);
  const winW = useWinWidth();
  // Below these widths (they grow with the text size) the panes stack and the page scrolls.
  const wide = winW >= (isCode ? 1000 : 720) * Math.max(1, num(scale, 1));
  const [taskPref, setTaskW] = usePref<number | null>(isCode ? "w-task-code" : reading ? "w-task-read" : "w-task", null);
  const [benchPref, setBenchW] = usePref<number | null>("w-bench", null);
  // Briefings and quick checks are for reading: the text gets the larger share.
  const taskDefault = isCode ? clamp(Math.round(winW * 0.27), 340, 520) : reading ? Math.round(winW * 0.56) : 460;
  const taskMax = isCode ? Math.min(520, winW - 2 * SPLIT - EDITOR_MIN - BENCH_MIN) : winW - SPLIT - (reading ? 340 : 440);
  const taskW = clamp(num(taskPref, taskDefault), 240, taskMax);
  const { bench: benchW, max: benchMax } = benchWidth(winW, taskW, benchPref);

  const retry = () => {
    if (!window.confirm("Try this level again without help? The hints are hidden again and the editor goes back to the starting code. Your pass is kept.")) return;
    store.clearHints(id);
    store.resetCode(id);
    setSolutionOpened(false);
    setJustPassed(false);
    setAttempt((a) => a + 1);
  };

  const done = (passed || justPassed) && (
    <div className={`takeaway passed ${assisted ? "assisted" : ""}`} ref={passBox}>
      <strong className="passed-title">
        <Icon name={assisted ? "help" : "check"} size={16} /> {assisted ? "Level passed with help." : "Level passed."}
      </strong>{" "}
      {level.takeaway && <Markdown text={level.takeaway} />}
      {assisted && <p className="tiny">It counts for the chapter like any other pass. Stars are for a pass without the last hint or the reference solution.</p>}
      <div className="actions">
        {next ? (
          <button className="btn primary" onClick={() => go({ name: "level", id: next.id })}>
            Next: {next.title} <Icon name="next" size={14} />
          </button>
        ) : (
          <button className="btn primary" onClick={() => go({ name: "map" })}>Back to the map</button>
        )}
        {assisted && <button className="btn ghost" onClick={retry}>Try again without help</button>}
      </div>
    </div>
  );

  const side = (
    <div className="pane brief">
      <h2 className="sr-only">Briefing</h2>
      <div className="goal">
        <strong>Goal.</strong> {level.goal}
      </div>
      <Markdown text={level.brief} />
      <Refs refs={level.refs} />
      {level.kind === "register" && level.reg && (
        <p className="tiny">
          <button className="linkish" onClick={() => go({ name: "handbook", reg: level.reg })}>Open {level.reg} in the handbook</button> (your bits here start again when you come back).
        </p>
      )}
      {hints.length > 0 && (
        <div className="hints">
          {hints.slice(0, shown).map((h, i) => (
            <div className="hint" key={i}>
              <b>Hint {i + 1} of {hints.length}.</b> <Markdown text={h} />
            </div>
          ))}
          {shown < hints.length && (
            <button className="btn small" onClick={() => store.hint(id, shown + 1)}>
              <Icon name="bulb" size={14} /> {shown === 0 ? "Show a hint" : "Show another hint"} ({hints.length - shown} left)
            </button>
          )}
          {isCode && !passed && shown === hints.length - 1 && <p className="tiny">The last hint nearly gives the answer: a pass after it is recorded as passed with help, without stars.</p>}
        </div>
      )}
      {level.kind === "code" && (passed || shown >= hints.length) && hints.length > 0 && (
        <details className="solution" onToggle={(e) => e.currentTarget.open && setSolutionOpened(true)}>
          <summary>Reference solution</summary>
          <pre><code>{level.solution}</code></pre>
        </details>
      )}
    </div>
  );

  const tier = tierOf(level);
  const ch = chapterLabel(chapter);
  return (
    <div className="level">
      <div className="level-head">
        <button className="btn ghost small" onClick={() => go({ name: "map" })}>
          <Icon name="back" size={14} /> Map
        </button>
        <div className="crumbs">
          <span className="eyebrow">Chapter {ch} · {chapter.title}</span>
          <h1>
            {ch}.{index + 1} {level.title}
          </h1>
        </div>
        <span className="badge">{KIND_LABEL[kindOf(level)]}</span>
        {tier !== "core" && (
          <span className={`badge tier-${tier}`}>
            {tier === "expert" && <Icon name="diamond" size={11} />} {tier === "expert" ? "Expert" : "Practice"}
          </span>
        )}
        {passed && (
          <span className={`badge ok ${assisted ? "assisted" : ""}`}>
            <Icon name={assisted ? "help" : "check"} size={12} /> {assisted ? "Passed with help" : "Passed"}
          </span>
        )}
        <span className="spacer" />
        <nav className="stepper" aria-label={`Levels of chapter ${ch}`}>
          {chapter.levels.map((l, i) => {
            const t = tierOf(l);
            const p = !!save.passed[l.id];
            const help = p && !!save.assisted[l.id];
            return (
              <button
                key={l.id}
                className={`step tier-${t} ${p ? (help ? "assisted" : "passed") : ""}`}
                aria-current={l.id === id ? "step" : undefined}
                aria-label={`${ch}.${i + 1} ${l.title}${t !== "core" ? `, ${t}` : ""}${p ? (help ? ", passed with help" : ", passed") : ""}`}
                title={`${ch}.${i + 1} ${l.title}`}
                onClick={() => go({ name: "level", id: l.id })}
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
        </nav>
        <button className="icon-btn" disabled={index === 0} onClick={() => go({ name: "level", id: chapter.levels[index - 1].id })} aria-label="Previous level" title={index === 0 ? "This is the first level of the chapter" : "Previous level"}>
          <Icon name="back" size={16} />
        </button>
        <button className="icon-btn" disabled={!next} onClick={() => next && go({ name: "level", id: next.id })} aria-label="Next level" title={next ? "Next level" : "This is the last level"}>
          <Icon name="next" size={16} />
        </button>
      </div>
      <p className="sr-only" role="status">{justPassed ? `Level passed${assisted ? " with help" : ""}. ${next ? `Next: ${next.title}.` : ""}` : ""}</p>
      <div
        className={`level-body ${isCode ? "code" : ""} ${reading ? "reading" : ""} ${wide ? "" : "stacked"}`}
        style={wide ? { gridTemplateColumns: isCode ? `${taskW}px ${SPLIT}px minmax(0, 1fr) ${SPLIT}px ${benchW}px` : `${taskW}px ${SPLIT}px minmax(0, 1fr)` } : undefined}
      >
        {side}
        <Splitter value={taskW} onChange={setTaskW} min={240} max={taskMax} side="left" label="Resize the briefing pane" reset={taskDefault} />
        {isCode ? (
          <CodeLevelView
            key={attempt}
            level={level}
            onPass={onPass}
            helped={helped}
            benchTop={done}
            splitter={<Splitter value={benchW} onChange={setBenchW} min={BENCH_MIN} max={benchMax} side="right" label="Resize the board pane" reset={440} />}
          />
        ) : (
          <div className="pane">
            <div className="activity">
              <h2 className="eyebrow activity-title">{level.kind === "brief" ? "Check your understanding" : "Your turn"}</h2>
              {(level.kind === "brief" || level.kind === "quiz") && <Quiz questions={level.questions} onPass={onPass} />}
              {level.kind === "calc" && <Calc fields={level.fields} onPass={onPass} />}
              {level.kind === "order" && <Order steps={level.steps} onPass={onPass} />}
              {level.kind === "timing" && <Timing level={level} onPass={onPass} />}
              {level.kind === "wiring" && <Wiring level={level} onPass={onPass} />}
              {level.kind === "register" && <RegisterPuzzle level={level} onPass={onPass} solved={passed || justPassed} />}
              {done}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
