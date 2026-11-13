import { useState } from "react";
import type { Question } from "../../levels/types";
import { Markdown } from "../Markdown";

export function Quiz({ questions, onPass }: { questions: Question[]; onPass: () => void }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
  /** Wrong checks per question: the explanation appears after the second. */
  const [misses, setMisses] = useState<number[]>(() => questions.map(() => 0));
  const open = picked.filter((p) => p === null).length;
  const allRight = picked.every((p, i) => p === questions[i].answer);
  return (
    <div>
      {questions.map((q, qi) => {
        const p = picked[qi];
        const right = p === q.answer;
        return (
          <fieldset className="question" key={qi}>
            <legend>Question {qi + 1}</legend>
            <Markdown text={q.prompt} />
            {q.options.map((o, oi) => (
              <label className="option" key={oi}>
                <input
                  type="radio"
                  name={`q${qi}`}
                  checked={p === oi}
                  onChange={() => {
                    setPicked(picked.map((x, i) => (i === qi ? oi : x)));
                    setChecked(false);
                  }}
                />
                <span><Markdown text={o} /></span>
              </label>
            ))}
            {checked && p !== null && (
              <p className={`why ${right ? "ok" : "bad"}`} role="status">
                {right ? "Correct. " : "Not quite. "}
                {right ? q.why : misses[qi] >= 2 ? `Here is the reasoning: ${q.why}` : "Read the question once more and try another answer."}
              </p>
            )}
          </fieldset>
        );
      })}
      <div className="actions">
        <button
          className="btn primary"
          disabled={picked.some((p) => p === null)}
          onClick={() => {
            setChecked(true);
            setMisses(misses.map((m, i) => (picked[i] === questions[i].answer ? m : m + 1)));
            if (allRight) onPass();
          }}
        >
          Check answers
        </button>
        {open > 0 && <span className="hint-text">{open === questions.length ? "Answer every question, then check." : `${open} question${open === 1 ? "" : "s"} still to answer.`}</span>}
      </div>
    </div>
  );
}
