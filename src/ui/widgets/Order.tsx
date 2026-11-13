import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

/** Deterministic shuffle so the puzzle looks the same every time. */
function shuffled(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = 7 + n * 13;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  if (idx.every((v, i) => v === i) && n > 1) [idx[0], idx[1]] = [idx[1], idx[0]];
  return idx;
}

export function Order({ steps, onPass, onMiss }: { steps: string[]; onPass: () => void; /** Called when a check finds a wrong answer (a warm-up counts the first try). */ onMiss?: () => void }) {
  const [order, setOrder] = useState(() => shuffled(steps.length));
  const [checked, setChecked] = useState(false);
  const [said, setSaid] = useState("");
  const list = useRef<HTMLOListElement>(null);
  /** The button that keeps the focus after a move: it follows its step. */
  const focusOn = useRef<{ step: number; dir: number } | null>(null);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setChecked(false);
    setSaid(`Moved to position ${j + 1} of ${order.length}.`);
    focusOn.current = { step: order[i], dir: d };
  };
  useEffect(() => {
    const f = focusOn.current;
    if (!f) return;
    focusOn.current = null;
    const li = list.current?.querySelector(`li[data-step="${f.step}"]`);
    const btns = li?.querySelectorAll<HTMLButtonElement>("button");
    if (!btns) return;
    // At either end the button that was used no longer applies: the other one takes the focus.
    const want = btns[f.dir < 0 ? 0 : 1];
    (want.getAttribute("aria-disabled") === "true" ? btns[f.dir < 0 ? 1 : 0] : want).focus();
  }, [order]);
  // Steps with identical text are interchangeable.
  const right = (i: number) => steps[order[i]] === steps[i];
  return (
    <div>
      <p className="hint-text">Use the arrow buttons to put the steps in the order they must happen.</p>
      <ol className="order" ref={list}>
        {order.map((s, i) => (
          <li key={s} data-step={s} className={checked ? (right(i) ? "right" : "wrong") : ""}>
            <span>
              <Markdown text={steps[s]} />
              {checked && <span className={`mark ${right(i) ? "ok" : "bad"}`}><Icon name={right(i) ? "check" : "cross"} size={14} /> {right(i) ? "Right place" : "Wrong place"}</span>}
            </span>
            <span className="moves">
              <button className="icon-btn" onClick={() => move(i, -1)} aria-disabled={i === 0} aria-label={`Move step ${i + 1} up`} title="Move up"><Icon name="up" size={16} /></button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-disabled={i === order.length - 1} aria-label={`Move step ${i + 1} down`} title="Move down"><Icon name="down" size={16} /></button>
            </span>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button
          className="btn primary"
          onClick={() => {
            setChecked(true);
            if (order.every((_, i) => right(i))) onPass();
            else onMiss?.();
          }}
        >
          Check order
        </button>
        <span role="status" className="verdict bad">{checked && !order.every((_, i) => right(i)) ? "Steps marked with a cross are in the wrong place." : ""}</span>
      </div>
      <p className="sr-only" role="status">{said}</p>
    </div>
  );
}
