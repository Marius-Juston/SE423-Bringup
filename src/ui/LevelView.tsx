import { useEffect, useState } from "react";
import { findLevel, nextLevel } from "../levels/index";
import { KIND_LABEL, kindOf, tierOf, type Ref } from "../levels/types";
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
import { usePref } from "./prefs";

/** True when the window is wide enough for side-by-side panes. */
function useWide(): boolean {
  const q = "(min-width: 1001px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
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
  const [justPassed, setJustPassed] = useState(false);
  const shown = save.hints[id] ?? 0;
  const hints = level.hints ?? [];
  const next = nextLevel(id);
  const onPass = () => {
    store.pass(id);
    setJustPassed(true);
  };
  const isCode = level.kind === "code";
  const [taskW, setTaskW] = usePref<number>(isCode ? "w-task-code" : "w-task", isCode ? 340 : 460);
  const [benchW, setBenchW] = usePref<number>("w-bench", 440);
  const wide = useWide();

  const side = (
    <div className="pane">
      <div className="goal">
        <strong>Goal.</strong> {level.goal}
      </div>
      <Markdown text={level.brief} />
      <Refs refs={level.refs} />
      {hints.length > 0 && (
        <div className="hints">
          {hints.slice(0, shown).map((h, i) => (
            <div className="hint" key={i}>
              <b>Hint {i + 1}.</b> <Markdown text={h} />
            </div>
          ))}
          {shown < hints.length && (
            <button className="btn small" style={{ marginTop: "0.6rem" }} onClick={() => store.hint(id, shown + 1)}>
              {shown === 0 ? "Show a hint" : "Show another hint"} ({hints.length - shown} left)
            </button>
          )}
        </div>
      )}
      {(passed || justPassed) && (
        <div className="takeaway" role="status">
          <strong>Level passed.</strong> {level.takeaway && <Markdown text={level.takeaway} />}
          <div className="actions" style={{ marginTop: "0.5rem" }}>
            {next ? (
              <button className="btn primary" onClick={() => go({ name: "level", id: next.id })}>Next: {next.title}</button>
            ) : (
              <button className="btn primary" onClick={() => go({ name: "map" })}>Back to the map</button>
            )}
          </div>
        </div>
      )}
      {level.kind === "code" && (passed || shown >= hints.length) && hints.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary>Reference solution</summary>
          <pre><code>{level.solution}</code></pre>
        </details>
      )}
    </div>
  );

  return (
    <div className="level">
      <div className="level-head">
        <button className="btn ghost small" onClick={() => go({ name: "map" })}>← Map</button>
        <span className="badge">{KIND_LABEL[kindOf(level)]}</span>
        {tierOf(level) !== "core" && <span className={`badge tier-${tierOf(level)}`}>{tierOf(level) === "expert" ? "◆ Expert" : "Practice"}</span>}
        <h1 style={{ fontSize: "1.15rem" }}>
          {chapter.number}.{index + 1} {level.title}
        </h1>
        {passed && <span className="badge ok">Passed</span>}
        <span className="spacer" />
        <span style={{ color: "var(--dim)", fontSize: "0.9rem" }}>
          Chapter {chapter.number}: {chapter.title}
        </span>
      </div>
      <div className={`level-body ${isCode ? "code" : ""}`} style={wide ? { gridTemplateColumns: isCode ? `${taskW}px 7px minmax(300px, 1fr) 7px ${benchW}px` : `${taskW}px 7px 1fr` } : undefined}>
        {side}
        <Splitter value={taskW} onChange={setTaskW} min={240} max={760} side="left" label="Resize the task pane" />
        {isCode ? (
          <CodeLevelView level={level} onPass={onPass} splitter={<Splitter value={benchW} onChange={setBenchW} min={300} max={1100} side="right" label="Resize the board pane" />} />
        ) : (
          <div className="pane">
            <div className="activity">
              {(level.kind === "brief" || level.kind === "quiz") && <Quiz questions={level.questions} onPass={onPass} />}
              {level.kind === "calc" && <Calc fields={level.fields} onPass={onPass} />}
              {level.kind === "order" && <Order steps={level.steps} onPass={onPass} />}
              {level.kind === "timing" && <Timing level={level} onPass={onPass} />}
              {level.kind === "wiring" && <Wiring level={level} onPass={onPass} />}
              {level.kind === "register" && <RegisterPuzzle level={level} onPass={onPass} solved={passed || justPassed} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
