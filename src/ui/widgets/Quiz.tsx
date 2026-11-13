import { useState } from "react";
import type { Question } from "../../levels/types";
import { Markdown } from "../Markdown";

export function Quiz({ questions, onPass }: { questions: Question[]; onPass: () => void }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
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
                {right ? q.why : "Think about it again, or use a hint."}
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
            if (allRight) onPass();
          }}
        >
          Check answers
        </button>
      </div>
    </div>
  );
}
