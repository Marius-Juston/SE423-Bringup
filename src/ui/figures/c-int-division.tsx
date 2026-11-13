import { useState } from "react";

// Whole-number division in C (level czero-division): for two int values
// a / b counts how many full groups of b fit into a and drops the rest;
// a % b is what is left over. Shown for a >= 0 and b > 0, where
// a == (a / b) * b + (a % b) (C99 6.5.5).

function CIntDivision() {
  const [a, setA] = useState(17);
  const [b, setB] = useState(5);
  const q = Math.floor(a / b);
  const r = a % b;
  const real = a / b;
  const colW = Math.min(40, 304 / (q + (r ? 1 : 0) || 1));
  const dot = (cx: number, i: number, cls: string, key: string) => <circle key={key} cx={cx} cy={25 + i * 13} r="5" className={cls} />;
  const why =
    q === 0
      ? `${b} does not fit into ${a} even once, so ${a} / ${b} is 0. Everything is left over: ${a} % ${b} is ${r}. A calculator would say ${real.toFixed(2)}, but an int cannot hold a fraction.`
      : r === 0
        ? `${a} splits into ${q} full group${q === 1 ? "" : "s"} of ${b} with nothing left over. So ${a} / ${b} is ${q} and ${a} % ${b} is 0: ${a} is a multiple of ${b}.`
        : `${q} full group${q === 1 ? "" : "s"} of ${b} fit into ${a}, so ${a} / ${b} is ${q}. ${r} ${r === 1 ? "is" : "are"} left over, so ${a} % ${b} is ${r}. A calculator would say ${real.toFixed(2)}: C throws the part after the point away, it does not round.`;
  return (
    <figure className="figure" aria-label="Interactive picture of whole-number division and remainder">
      <style>{`
        .cdv-dot { fill: var(--orange); }
        .cdv-rest { fill: var(--harvest); }
        .cdv-group { fill: none; stroke: var(--dim); stroke-width: 1; }
        .cdv-left { fill: none; stroke: var(--harvest); stroke-width: 1.2; stroke-dasharray: 3 2; }
        .cdv-sum { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; font-family: var(--mono); font-size: 0.95rem; margin: 0.4rem 0; }
        .cdv-sum b { color: var(--harvest); }
        .cdv-ctl label { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.5rem; font-size: 0.85rem; min-width: 0; }
        .cdv-ctl label > span { flex: 0 1 11.5rem; }
        .cdv-ctl input { flex: 1 1 4rem; min-width: 4rem; width: 4rem; }
        .cdv-ctl output { font-family: var(--mono); width: 2rem; text-align: right; }
      `}</style>
      <svg viewBox={`0 0 320 ${b * 13 + 46}`} role="img" aria-label={`${a} dots in groups of ${b}: ${q} full group${q === 1 ? "" : "s"} and ${r} left over.`}>
        {Array.from({ length: q }, (_, g) => {
          const x = 8 + g * colW;
          return (
            <g key={g}>
              <rect x={x} y="16" width={colW - 4} height={b * 13 + 5} rx="4" className="cdv-group" />
              {Array.from({ length: b }, (_, i) => dot(x + (colW - 4) / 2, i, "cdv-dot", `${g}-${i}`))}
              {colW >= 16 && <text x={x + (colW - 4) / 2} y={b * 13 + 36} textAnchor="middle" className="fig-label dim">{g + 1}</text>}
            </g>
          );
        })}
        {r > 0 && (
          <g>
            <rect x={8 + q * colW} y="16" width={colW - 4} height={b * 13 + 5} rx="4" className="cdv-left" />
            {Array.from({ length: r }, (_, i) => dot(8 + q * colW + (colW - 4) / 2, i, "cdv-rest", `r-${i}`))}
            <text x={Math.min(Math.max(8 + q * colW + (colW - 4) / 2, 20), 298)} y={b * 13 + 36} textAnchor="middle" className="fig-label">{colW >= 30 || q === 0 ? "left over" : "rest"}</text>
          </g>
        )}
        {a === 0 && <text x="8" y="40" className="fig-label dim">nothing to share out</text>}
      </svg>
      <div className="cdv-sum" aria-hidden="true">
        <span>{a} / {b} = <b>{q}</b></span>
        <span>{a} % {b} = <b>{r}</b></span>
        <span>check: {q} * {b} + {r} = {a}</span>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls cdv-ctl">
        <label>
          <span>a, the number to share out</span>
          <input type="range" min="0" max="30" value={a} onChange={(e) => setA(+e.target.value)} />
          <output>{a}</output>
        </label>
        <label>
          <span>b, the size of one group</span>
          <input type="range" min="2" max="9" value={b} onChange={(e) => setB(+e.target.value)} />
          <output>{b}</output>
        </label>
      </div>
      <figcaption>With two whole numbers, <code>a / b</code> counts the full groups and <code>a % b</code> is what is left over. Orange dots are in full groups, yellow dots in the dashed box are the remainder.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "c-int-division",
  title: "Whole-number division and remainder",
  description: "Choose two whole numbers and see the dots sorted into full groups and leftovers: the results of / and % in C.",
  Component: CIntDivision,
};
