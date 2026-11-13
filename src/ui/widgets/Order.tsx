import { useState } from "react";
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

export function Order({ steps, onPass }: { steps: string[]; onPass: () => void }) {
  const [order, setOrder] = useState(() => shuffled(steps.length));
  const [checked, setChecked] = useState(false);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setChecked(false);
  };
  // Steps with identical text are interchangeable.
  const right = (i: number) => steps[order[i]] === steps[i];
  return (
    <div>
      <ol className="order">
        {order.map((s, i) => (
          <li key={s} className={checked ? (right(i) ? "right" : "wrong") : ""}>
            <span><Markdown text={steps[s]} /></span>
            <span className="moves">
              <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>↑</button>
              <button className="btn small" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move step ${i + 1} down`}>↓</button>
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
          }}
        >
          Check order
        </button>
        {checked && !order.every((_, i) => right(i)) && <span role="status" style={{ color: "var(--bad)" }}>Steps outlined in red are in the wrong place.</span>}
      </div>
    </div>
  );
}
