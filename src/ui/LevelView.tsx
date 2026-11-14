import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { findLevel, nextLevel } from "../levels/index";
import { KIND_LABEL, chapterLabel, kindOf, tierOf, type Ref } from "../levels/types";
import { starsEarned, store, useSave } from "./store";
import { CodeBlock, Markdown } from "./Markdown";
import { trmRef } from "./device";
import { openExternal } from "./external";
import { sortedCourseLinks } from "../levels/course-links";
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
import { INTERVALS } from "./review";
import type { BestNote } from "./bests";

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

/** One reference as a link: its text, where it goes, and the long form for the tooltip and screen readers. */
interface RefLink {
  label: string;
  title: string;
  href?: string;
}

/** A level's references in reading order: lecture slides, then labs and homeworks, then the manual. */
export function refLinks(refs: Ref[]): RefLink[] {
  const course: RefLink[] = sortedCourseLinks(refs).map((c) => ({ label: c.label, title: c.title, href: c.href }));
  const manual = refs.flatMap((r): RefLink[] => {
    if (!r.trm) return [];
    const t = trmRef(r.trm);
    const label = `TRM §${r.trm}`;
    return [{ label: t ? `${label} ${t.title}, p. ${t.page}` : label, title: t ? `Technical Reference Manual, section ${r.trm}: ${t.title}, page ${t.page}` : label, href: t?.url }];
  });
  return [...course, ...manual];
}

function RefAnchor({ link }: { link: RefLink }) {
  if (!link.href) return <span title={link.title}>{link.label}</span>;
  return (
    <a href={link.href} target="_blank" rel="noreferrer" title={`${link.title}. Opens in your browser.`} aria-label={`${link.title.includes(link.label) ? link.title : `${link.label}: ${link.title}`} (opens in your browser)`} onClick={(e) => openExternal(e, link.href!)}>
      {link.label}
    </a>
  );
}

/** The references as chips, under the brief. */
export function Refs({ refs }: { refs: Ref[] }) {
  return (
    <ul className="refs" aria-label="Where this is taught: course material and manual">
      {refLinks(refs).map((link, i) => (
        <li key={i}>
          <RefAnchor link={link} />
        </li>
      ))}
    </ul>
  );
}

/** The same links as one compact line, shown with the hints: where to read when a hint is not enough. */
export function TaughtLine({ refs }: { refs: Ref[] }) {
  const links = refLinks(refs).filter((l) => l.href);
  if (links.length === 0) return null;
  return (
    <p className="tiny taught">
      <style>{`.taught a { color: var(--info); text-decoration: underline; text-underline-offset: 2px; } .taught { line-height: 1.7; }`}</style>
      <b>Where this is taught:</b>{" "}
      {links.map((link, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <RefAnchor link={link} />
        </span>
      ))}
    </p>
  );
}

/** A level played as one question of a warm-up (spaced review). */
export interface WarmupStep {
  index: number;
  total: number;
  /** Goes to the next question (or back to the map); `right` says whether the first check was right. */
  next: (right: boolean) => void;
  /** Leaves the warm-up. */
  end: () => void;
}

type Tab = "read" | "code" | "board";
const TABS: { id: Tab; label: string }[] = [
  { id: "read", label: "Read" },
  { id: "code", label: "Code" },
  { id: "board", label: "Board" },
];

export function LevelView({ id, go, warmup }: { id: string; go: (v: View) => void; warmup?: WarmupStep }) {
  const { level, chapter, index } = findLevel(id)!;
  const save = useSave();
  const passed = !!save.passed[id];
  const assisted = passed && !!save.assisted[id];
  const [justPassed, setJustPassed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Remembered with the progress: opening the solution, reloading and pasting it must not earn stars.
  const solutionOpened = !!save.peeked[id];
  // A warm-up question starts without the hints that were opened when the level was first played: those open here are not remembered.
  const [warmHints, setWarmHints] = useState(0);
  const shown = warmup ? warmHints : (save.hints[id] ?? 0);
  const hints = level.hints ?? [];
  const next = nextLevel(id);
  const isCode = level.kind === "code";
  const reading = level.kind === "brief" || level.kind === "quiz";
  // A code level passed with the last hint showing or the reference solution open is passed "with help".
  const helped = isCode && ((hints.length > 0 && shown >= hints.length) || solutionOpened);
  const helpedNow = useRef(helped);
  helpedNow.current = helped;
  // In a warm-up the first check decides when the level comes back.
  const firstTry = useRef<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("read");
  const [status, setStatus] = useState<{ kind: string; text: string; detail?: string }>({ kind: "idle", text: "Tests not run yet" });
  const [bests, setBests] = useState<BestNote[]>([]);
  const [confirming, setConfirming] = useState(false);
  const onMiss = () => {
    if (!warmup || firstTry.current !== null) return;
    firstTry.current = false;
    store.review(id, false);
  };
  const onPass = () => {
    store.pass(id, helpedNow.current);
    if (warmup && firstTry.current === null) {
      firstTry.current = true;
      store.review(id, true);
    }
    setJustPassed(true);
    // In a narrow window the "level passed" box is on the Board tab.
    setTab("board");
  };

  // After a pass the next step comes into view, and takes the focus unless the student is typing code.
  const passBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!justPassed) return;
    const box = passBox.current;
    box?.scrollIntoView({ block: "nearest" });
    if (tabbedNow.current || !document.activeElement?.closest(".cm-editor")) box?.querySelector<HTMLElement>("button")?.focus();
  }, [justPassed]);

  const [scale] = usePref<number>("text-scale", 1);
  const winW = useWinWidth();
  // Below these widths (they grow with the text size) the panes stack and the page scrolls.
  const wide = winW >= (isCode ? 1000 : 720) * Math.max(1, num(scale, 1));
  // A code level in a narrow window: one pane at a time, chosen with tabs.
  const tabbed = isCode && !wide;
  const tabbedNow = useRef(tabbed);
  tabbedNow.current = tabbed;
  const [taskPref, setTaskW] = usePref<number | null>(isCode ? "w-task-code" : reading ? "w-task-read" : "w-task", null);
  const [benchPref, setBenchW] = usePref<number | null>("w-bench", null);
  // Briefings and quick checks are for reading: the text gets the larger share.
  const taskDefault = isCode ? clamp(Math.round(winW * 0.27), 340, 520) : reading ? Math.round(winW * 0.56) : 460;
  const taskMax = isCode ? Math.min(520, winW - 2 * SPLIT - EDITOR_MIN - BENCH_MIN) : winW - SPLIT - (reading ? 340 : 440);
  const taskW = clamp(num(taskPref, taskDefault), 240, taskMax);
  const { bench: benchW, max: benchMax } = benchWidth(winW, taskW, benchPref);

  // A button that goes away when it is used hands the focus on, so the keyboard keeps its place:
  // the last hint takes it from "Show another hint", and "Try again without help" takes it back from Cancel.
  const hintsBox = useRef<HTMLDivElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const lostFocus = () => !document.activeElement || document.activeElement === document.body;
  const shownBefore = useRef(shown);
  useEffect(() => {
    if (shown > shownBefore.current && shown >= hints.length && lostFocus()) hintsBox.current?.querySelector<HTMLElement>(".hint:last-of-type")?.focus();
    shownBefore.current = shown;
  }, [shown, hints.length]);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming && lostFocus()) retryButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const retry = () => {
    setConfirming(false);
    store.clearHints(id);
    store.resetCode(id);
    setJustPassed(false);
    setBests([]);
    setAttempt((a) => a + 1);
    setTab("code");
    // The button that was pressed is gone: the fresh editor takes the focus.
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(".level .cm-content")?.focus()));
  };
  const improved = bests.filter((b) => b.improved).slice(0, 3);
  // A level passed without help whose solution was opened afterwards: its remaining stars need a fresh start too.
  const starsLeft = level.kind === "code" && (level.bonus?.length ?? 0) > starsEarned(save, id, level.bonus?.length ?? 0);
  const canRetry = assisted || (helped && starsLeft);

  const done = warmup ? (
    justPassed && (
      <div className="takeaway passed" ref={passBox}>
        <strong className="passed-title">
          <Icon name="check" size={16} /> {firstTry.current ? "Right at the first try." : "Right."}
        </strong>{" "}
        {level.takeaway && <Markdown text={level.takeaway} />}
        <p className="tiny">{firstTry.current ? "This one comes back later, after a longer wait." : `It took more than one try, so it comes back in ${INTERVALS[0]} days.`}</p>
        <div className="actions">
          <button className="btn primary" onClick={() => warmup.next(firstTry.current === true)}>
            {warmup.index + 1 < warmup.total ? "Next question" : "Finish the warm-up"} <Icon name="next" size={14} />
          </button>
        </div>
      </div>
    )
  ) : (
    (passed || justPassed) && (
      <div className={`takeaway passed ${assisted ? "assisted" : ""}`} ref={passBox}>
        <strong className="passed-title">
          <Icon name={assisted ? "help" : "check"} size={16} /> {assisted ? "Level passed with help." : "Level passed."}
        </strong>{" "}
        {level.takeaway && <Markdown text={level.takeaway} />}
        {improved.map((b) => (
          <p className="best-line" key={b.label}>
            <Icon name="star" size={13} /> {b.was ? "New best" : "Your mark to beat"}: <b>{b.now}</b>
            {b.was ? ` (was ${b.was})` : ""} <span className="best-what">{b.label}</span>
          </p>
        ))}
        {assisted && <p className="tiny">It counts for the chapter like any other pass. Stars are for a pass without the last hint or the reference solution.</p>}
        <div className="actions">
          {next ? (
            <button className="btn primary" onClick={() => go({ name: "level", id: next.id })}>
              Next: {next.title} <Icon name="next" size={14} />
            </button>
          ) : (
            <button className="btn primary" onClick={() => go({ name: "map" })}>Back to the map</button>
          )}
          {canRetry && !confirming && <button className="btn ghost" ref={retryButton} onClick={() => setConfirming(true)}>{assisted ? "Try again without help" : "Try for the stars without help"}</button>}
        </div>
        {canRetry && confirming && (
          <div className="confirm" role="group" aria-label="Try again without help">
            <p>The hints are hidden again and the editor goes back to the starting code. Your pass is kept.</p>
            <div className="actions">
              <button className="btn" autoFocus onClick={retry}>Start over without help</button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  );

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const j = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j].id);
    document.getElementById(`tab-${TABS[j].id}`)?.focus();
  };

  const side = (
    <div className="pane brief" {...(tabbed ? { role: "tabpanel", id: "pane-read", "aria-labelledby": "tab-read", hidden: tab !== "read" } : {})}>
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
        <div className="hints" ref={hintsBox}>
          {hints.slice(0, shown).map((h, i) => (
            <div className="hint" key={i} tabIndex={-1}>
              <b>Hint {i + 1} of {hints.length}.</b> <Markdown text={h} />
            </div>
          ))}
          {shown < hints.length && (
            <button className="btn small" onClick={() => (warmup ? setWarmHints(shown + 1) : store.hint(id, shown + 1))}>
              <Icon name="bulb" size={14} /> {shown === 0 ? "Show a hint" : "Show another hint"} ({hints.length - shown} left)
            </button>
          )}
          {isCode && !passed && shown === hints.length - 1 && <p className="tiny">The last hint nearly gives the answer: a pass after it is recorded as passed with help, without stars.</p>}
          {shown > 0 && <TaughtLine refs={level.refs} />}
        </div>
      )}
      {level.kind === "code" && (passed || shown >= hints.length) && hints.length > 0 && (
        <details className="solution" onToggle={(e) => e.currentTarget.open && store.peek(id)}>
          <summary>Reference solution</summary>
          <CodeBlock code={level.solution} />
        </details>
      )}
    </div>
  );

  const tier = tierOf(level);
  const ch = chapterLabel(chapter);
  return (
    <div className="level">
      <div className={`level-head ${warmup ? "warm" : ""}`}>
        {warmup ? (
          <button className="btn ghost small" onClick={warmup.end}>
            <Icon name="back" size={14} /> End warm-up
          </button>
        ) : (
          <button className="btn ghost small" onClick={() => go({ name: "map" })}>
            <Icon name="back" size={14} /> Map
          </button>
        )}
        <div className="crumbs">
          <span className="eyebrow">
            {warmup && <span className="warm-step">Warm-up {warmup.index + 1} of {warmup.total}</span>}
            {warmup ? " · from chapter " : "Chapter "}{ch} · {chapter.title}
          </span>
          <h1>
            {ch}.{index + 1} {level.title}
          </h1>
        </div>
        <span className="badge">{KIND_LABEL[kindOf(level)]}</span>
        {tier !== "core" && !warmup && (
          <span className={`badge tier-${tier}`}>
            {tier === "expert" && <Icon name="diamond" size={11} />} {tier === "expert" ? "Expert" : "Practice"}
          </span>
        )}
        {passed && !warmup && (
          <span className={`badge ok ${assisted ? "assisted" : ""}`}>
            <Icon name={assisted ? "help" : "check"} size={12} /> {assisted ? "Passed with help" : "Passed"}
          </span>
        )}
        <span className="spacer" />
        {warmup ? (
          <>
            <span className="warm-dots" role="img" aria-label={`Question ${warmup.index + 1} of ${warmup.total}`}>
              {Array.from({ length: warmup.total }, (_, i) => (
                <i key={i} className={i < warmup.index ? "done" : i === warmup.index ? "now" : ""} />
              ))}
            </span>
            {!justPassed && (
              <button
                className="btn ghost small"
                title={`Go on without answering: this question comes back in ${INTERVALS[0]} days`}
                onClick={() => {
                  onMiss();
                  warmup.next(false);
                }}
              >
                Skip <Icon name="next" size={14} />
              </button>
            )}
          </>
        ) : (
          <>
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
            {/* One unit, so a narrow header never wraps between the two buttons. */}
            <span className="level-arrows">
              <button className="icon-btn" disabled={index === 0} onClick={() => go({ name: "level", id: chapter.levels[index - 1].id })} aria-label="Previous level" title={index === 0 ? "This is the first level of the chapter" : "Previous level"}>
                <Icon name="back" size={16} />
              </button>
              <button className="icon-btn" disabled={!next} onClick={() => next && go({ name: "level", id: next.id })} aria-label="Next level" title={next ? "Next level" : "This is the last level"}>
                <Icon name="next" size={16} />
              </button>
            </span>
          </>
        )}
      </div>
      <p className="sr-only" role="status">{justPassed ? (warmup ? "Right." : `Level passed${assisted ? " with help" : ""}. ${next ? `Next: ${next.title}.` : ""}`) : ""}</p>
      <div
        className={`level-body ${isCode ? "code" : ""} ${reading ? "reading" : ""} ${wide ? "" : tabbed ? "tabbed" : "stacked"} ${warmup ? "warm" : ""}`}
        style={wide ? { gridTemplateColumns: isCode ? `${taskW}px ${SPLIT}px minmax(0, 1fr) ${SPLIT}px ${benchW}px` : `${taskW}px ${SPLIT}px minmax(0, 1fr)` } : undefined}
      >
        {tabbed && (
          <div className="level-tabs">
            <div role="tablist" aria-label="Parts of this level">
              {TABS.map((t) => (
                <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`pane-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={onTabKey}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className={`tab-verdict state-${status.kind}`} role="status">
              <i aria-hidden="true" />
              <span className="tab-verdict-text">
                <b>{status.text}</b>
                {status.detail ? <span> {status.detail}</span> : null}
              </span>
            </p>
          </div>
        )}
        {side}
        <Splitter value={taskW} onChange={setTaskW} min={240} max={taskMax} side="left" label="Resize the briefing pane" reset={taskDefault} />
        {isCode ? (
          <CodeLevelView
            key={attempt}
            level={level}
            onPass={onPass}
            helped={helped}
            benchTop={done}
            tab={tabbed ? tab : undefined}
            onStatus={setStatus}
            onBests={setBests}
            splitter={<Splitter value={benchW} onChange={setBenchW} min={BENCH_MIN} max={benchMax} side="right" label="Resize the board pane" reset={440} />}
          />
        ) : (
          <div className="pane">
            <div className="activity">
              <h2 className="eyebrow activity-title">{level.kind === "brief" ? "Check your understanding" : "Your turn"}</h2>
              {(level.kind === "brief" || level.kind === "quiz") && <Quiz questions={level.questions} onPass={onPass} onMiss={onMiss} />}
              {level.kind === "calc" && <Calc fields={level.fields} onPass={onPass} onMiss={onMiss} />}
              {level.kind === "order" && <Order steps={level.steps} onPass={onPass} onMiss={onMiss} />}
              {level.kind === "timing" && <Timing level={level} onPass={onPass} onMiss={onMiss} />}
              {level.kind === "wiring" && <Wiring level={level} onPass={onPass} onMiss={onMiss} />}
              {level.kind === "register" && <RegisterPuzzle level={level} onPass={onPass} onMiss={onMiss} solved={warmup ? justPassed : passed || justPassed} />}
              {done}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
