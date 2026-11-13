import { useState } from "react";
import { findLevel, nextLevel } from "../levels/index";
import { KIND_LABEL, kindOf, type Ref } from "../levels/types";
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
        <h1 style={{ fontSize: "1.15rem" }}>
          {chapter.number}.{index + 1} {level.title}
        </h1>
        {passed && <span className="badge ok">Passed</span>}
        <span className="spacer" />
        <span style={{ color: "var(--dim)", fontSize: "0.9rem" }}>
          Chapter {chapter.number}: {chapter.title}
        </span>
      </div>
      <div className={`level-body ${isCode ? "code" : ""}`}>
        {side}
        {isCode ? (
          <CodeLevelView level={level} onPass={onPass} />
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
