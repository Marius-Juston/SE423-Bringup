import { useState } from "react";

// Maths you need (chapter 19): the natural logarithm turns multiplying
// into adding:  ln(a x b) = ln a + ln b,  ln 1 = 0,  ln(1 / a) = -ln a,
// and exp() undoes ln():  exp(ln a) = a.  (e = 2.71828...)
// This is why the occupancy grid of lectures 24-25 stores log-odds: taking
// in a measurement multiplies the odds, which becomes one addition.

const CHOICES = [0.25, 0.5, 1, 2, 3, 4, 9];
const name = (v: number) => (v === 0.25 ? "1/4" : v === 0.5 ? "1/2" : String(v));
const f3 = (v: number) => (Object.is(+v.toFixed(3), -0) ? "0.000" : v.toFixed(3));
const fnum = (v: number) => +v.toFixed(4) + "";

function MathLog() {
  const [a, setA] = useState(2);
  const [b, setB] = useState(3);
  const la = Math.log(a);
  const lb = Math.log(b);
  const prod = a * b;
  const sum = la + lb;

  // Ruler from ln = -3 to +4.5.
  const X0 = 20;
  const X1 = 400;
  const LO = -3;
  const HI = 4.5;
  const x = (l: number) => X0 + ((l - LO) / (HI - LO)) * (X1 - X0);
  const ticks = [0.05, 0.25, 0.5, 1, 2, 4, 9, 27, 81];

  const status =
    `${name(a)} x ${name(b)} = ${fnum(prod)}. On the ruler: ln ${name(a)} = ${f3(la)} and ln ${name(b)} = ${f3(lb)}. ` +
    `Put the two arrows end to end: ${f3(la)} + ${f3(lb)} = ${f3(sum)}, and that is exactly ln ${fnum(prod)}. Multiplying the numbers is adding their logarithms.` +
    (a === 1 || b === 1 ? " Multiplying by 1 changes nothing, and ln 1 = 0 adds nothing." : "") +
    (a < 1 || b < 1 ? " A number below 1 has a negative logarithm: its arrow points left." : "") +
    (a * b === 1 && a !== 1 ? " The two arrows cancel: the product is 1 and the sum is 0." : "");

  const arrow = (from: number, to: number, y: number, cls: string, label: string) => {
    const x0 = x(from);
    const x1 = x(to);
    const dir = x1 >= x0 ? 1 : -1;
    const zero = Math.abs(x1 - x0) < 0.5;
    return (
      <g>
        {zero ? <circle cx={x0} cy={y} r="3.5" className={cls} /> : (
          <>
            <line x1={x0} y1={y} x2={x1 - dir * 6} y2={y} className={`mlog-shaft ${cls}`} />
            <polygon points={`${x1},${y} ${x1 - dir * 8},${y - 4.5} ${x1 - dir * 8},${y + 4.5}`} className={cls} />
          </>
        )}
        <text x={Math.min(Math.max((x0 + x1) / 2, 46), 374)} y={y - 7} textAnchor="middle" className="fig-label">{label}</text>
      </g>
    );
  };

  return (
    <figure className="figure" aria-label="The logarithm turns multiplying into adding">
      <style>{`
        .mlog-axis { stroke: var(--dim); stroke-width: 1.2; }
        .mlog-shaft { stroke-width: 3; }
        .mlog-a { fill: var(--arches); stroke: var(--arches); }
        .mlog-b { fill: var(--orange); stroke: var(--orange); }
        .mlog-sum { fill: var(--harvest); stroke: var(--text); stroke-width: 1; }
        .mlog-zero { stroke: var(--text); stroke-width: 1.2; stroke-dasharray: 3 2; }
        .mlog-svg .fig-label { font-size: 10.5px; }
        .mlog-svg .fig-value.small { font-size: 10px; }
        .mlog-eq { margin: 0.4rem 0 0; font-size: 0.82rem; }
        .mlog-eq b { color: var(--harvest); }
      `}</style>
      <svg className="mlog-svg" viewBox="0 0 420 150" role="img" aria-label={`a is ${name(a)}, b is ${name(b)}. Their product is ${fnum(prod)}. ln a is ${f3(la)}, ln b is ${f3(lb)}, their sum ${f3(sum)} is the logarithm of the product.`}>
        {/* arrows */}
        {arrow(0, la, 30, "mlog-a", `ln ${name(a)} = ${f3(la)}`)}
        {arrow(la, sum, 58, "mlog-b", `+ ln ${name(b)} = ${f3(lb)}`)}
        <line x1={x(0)} y1="64" x2={x(0)} y2="92" className="mlog-zero" />
        <line x1={x(sum)} y1="62" x2={x(sum)} y2="84" className="mlog-zero" />
        <circle cx={x(sum)} cy="88" r="5" className="mlog-sum" />
        {/* ruler: the logarithm below, the number above */}
        <line x1={X0} y1="88" x2={X1} y2="88" className="mlog-axis" />
        {[-3, -2, -1, 0, 1, 2, 3, 4].map((l) => (
          <g key={l}>
            <line x1={x(l)} y1="88" x2={x(l)} y2="95" className="mlog-axis" />
            <text x={x(l)} y="107" textAnchor="middle" className="fig-label dim">{l}</text>
          </g>
        ))}
        <text x={X0} y="119" className="fig-label dim">the logarithm, ln</text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(Math.log(t))} y1="126" x2={x(Math.log(t))} y2="132" className="mlog-axis" />
            <text x={x(Math.log(t))} y="142" textAnchor="middle" className="fig-value small">{t}</text>
          </g>
        ))}
        <line x1={X0} y1="126" x2={X1} y2="126" className="mlog-axis" />
        <text x={X1} y="119" textAnchor="end" className="fig-label dim">below: the number itself</text>
      </svg>
      <pre className="mlog-eq"><code>
        {name(a)} x {name(b)} = <b>{fnum(prod)}</b>{"\n"}
        ln {name(a)} + ln {name(b)} = {f3(la)} + {f3(lb)} = <b>{f3(sum)}</b> = ln {fnum(prod)}{"\n"}
        exp({f3(sum)}) = <b>{fnum(prod)}</b>     // exp() undoes ln()
      </code></pre>
      <p className="fig-why" role="status">{status}</p>
      <div className="fig-controls">
        <div><span>a</span>{CHOICES.map((v) => <button key={v} className="fig-opt" aria-pressed={a === v} aria-label={`a = ${name(v)}`} onClick={() => setA(v)}>{name(v)}</button>)}</div>
        <div><span>times b</span>{CHOICES.map((v) => <button key={v} className="fig-opt" aria-pressed={b === v} aria-label={`b = ${name(v)}`} onClick={() => setB(v)}>{name(v)}</button>)}</div>
      </div>
      <figcaption>The blue arrow is ln a, the orange arrow is ln b, laid end to end from 0. The yellow dot is where they end: ln of the product. The lower scale shows the plain numbers at the place of their logarithm: 1 sits at 0, numbers above 1 to the right, numbers below 1 to the left.</figcaption>
    </figure>
  );
}

export const figure = { id: "math-log", Component: MathLog };
