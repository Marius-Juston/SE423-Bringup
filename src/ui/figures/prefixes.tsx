import { useState } from "react";

// Unit prefixes from nano to mega (primer A). The examples are numbers the
// game uses later: 20 mA (an LED), 4.7 kΩ (a resistor), 1 ms (a timer
// period), 50 µs (one period of the course's 20 kHz PWM), 5 ns (one tick of
// the chip's 200 MHz clock, TRM 3.7 "Clocking").

interface Prefix {
  sym: string;
  name: string;
  exp: number;
  words: string;
}
const PREFIXES: Prefix[] = [
  { sym: "n", name: "nano", exp: -9, words: "a billionth" },
  { sym: "µ", name: "micro", exp: -6, words: "a millionth" },
  { sym: "m", name: "milli", exp: -3, words: "a thousandth" },
  { sym: "", name: "no prefix", exp: 0, words: "one" },
  { sym: "k", name: "kilo", exp: 3, words: "a thousand" },
  { sym: "M", name: "mega", exp: 6, words: "a million" },
];

interface Example {
  m: number;
  exp: number;
  unit: string;
  what: string;
}
const EXAMPLES: Example[] = [
  { m: 20, exp: -3, unit: "A", what: "the current of a bright LED" },
  { m: 4.7, exp: 3, unit: "Ω", what: "a common resistor" },
  { m: 1, exp: -3, unit: "s", what: "a typical timer period" },
  { m: 50, exp: -6, unit: "s", what: "one period of the motor signal" },
  { m: 5, exp: -9, unit: "s", what: "one tick of the chip's clock" },
  { m: 200, exp: 6, unit: "Hz", what: "the speed of the chip's clock" },
];

/** A number written out in full, without exponent notation, digits grouped in threes. */
function plain(m: number, shift: number): string {
  // Work on the digits as text so that 4.7 x 1000 is 4700 and not 4699.999.
  const [int, frac = ""] = String(m).split(".");
  let digits = int + frac;
  let point = int.length + shift;
  if (point <= 0) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits += "0".repeat(point - digits.length);
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, "");
  const rest = digits.slice(point).replace(/0+$/, "");
  const group = (s: string) => s.replace(/\B(?=(\d{3})+$)/g, " ");
  return rest ? `${group(whole)}.${rest}` : group(whole);
}

const label = (e: Example) => `${e.m} ${PREFIXES.find((p) => p.exp === e.exp)!.sym}${e.unit}`;

const CSS = `
.px-tick { stroke: var(--dim); stroke-width: 1.4; }
.px-tick.sel { stroke: var(--orange); stroke-width: 2.6; }
.px-sym { fill: var(--text); font-size: 13px; font-family: var(--mono); font-weight: 700; }
.px-sym.sel { fill: var(--orange); }
.px-mark { fill: var(--harvest); }
.px-out { fill: var(--harvest); font-size: 13px; font-family: var(--mono); font-weight: 700; }
`;

function Prefixes() {
  const [ei, setEi] = useState(0);
  const [pi, setPi] = useState(3);
  const ex = EXAMPLES[ei];
  const to = PREFIXES[pi];
  const from = PREFIXES.find((p) => p.exp === ex.exp)!;
  const X = (exp: number) => 34 + ((exp + 9) / 15) * 332;
  // Where the value itself sits on the line (a logarithmic scale: each step is x 1000).
  const at = X(ex.exp + Math.log10(ex.m));
  const out = `${plain(ex.m, ex.exp - to.exp)} ${to.sym}${ex.unit}`;
  const base = `${plain(ex.m, ex.exp)} ${ex.unit}`;
  const steps = (from.exp - to.exp) / 3;
  const why =
    steps === 0
      ? `${label(ex)} is ${ex.what}. ${from.exp === 0 ? "" : `"${from.name}" means ${from.words}, so it is ${base}. `}Pick another prefix to rewrite it.`
      : `${label(ex)} = ${out}. ${to.sym || "No prefix"} is ${Math.abs(steps)} step${Math.abs(steps) === 1 ? "" : "s"} ${steps > 0 ? "smaller" : "larger"} than ${from.sym || "no prefix"}, so the number gets ${Math.abs(steps) === 1 ? "1000" : Math.abs(steps) === 2 ? "1 000 000" : "1000 for each step"} times ${steps > 0 ? "larger: a smaller unit needs a bigger number" : "smaller: a larger unit needs a smaller number"} to say the same thing.`;
  return (
    <figure className="figure" aria-label="Interactive number line of unit prefixes from nano to mega">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 132" role="img" aria-label={`Prefixes in order: nano, micro, milli, no prefix, kilo, mega. Each step is a factor of 1000. ${label(ex)} written with ${to.name} is ${out}.`}>
        <line x1="20" y1="62" x2="380" y2="62" className="fig-wire" />
        <text x="20" y="14" className="fig-label dim">smaller</text>
        <text x="380" y="14" textAnchor="end" className="fig-label dim">larger</text>
        {PREFIXES.map((p, k) => (
          <g key={p.name}>
            <line x1={X(p.exp)} y1="52" x2={X(p.exp)} y2="72" className={`px-tick ${k === pi ? "sel" : ""}`} />
            <text x={X(p.exp)} y="32" textAnchor="middle" className={`px-sym ${k === pi ? "sel" : ""}`}>{p.sym || "-"}</text>
            <text x={X(p.exp)} y="45" textAnchor="middle" className="fig-label">{p.name}</text>
            <text x={X(p.exp)} y="84" textAnchor="middle" className="fig-label dim">{p.words}</text>
            {k < PREFIXES.length - 1 && <text x={X(p.exp) + 33} y="58" textAnchor="middle" className="fig-label dim">x 1000</text>}
          </g>
        ))}
        <polygon points={`${at - 5},104 ${at + 5},104 ${at},94`} className="px-mark" />
        <line x1={at} y1="94" x2={at} y2="62" className="fig-sample" />
        <text x={Math.min(Math.max(at, 70), 330)} y="120" textAnchor="middle" className="px-out">{label(ex)} = {out}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Quantity</span>
          {EXAMPLES.map((e, k) => (
            <button key={label(e)} className="fig-opt" aria-pressed={k === ei} onClick={() => setEi(k)}>{label(e)}</button>
          ))}
        </div>
        <div>
          <span>Write it in</span>
          {PREFIXES.map((p, k) => (
            <button key={p.name} className="fig-opt" aria-pressed={k === pi} aria-label={`${p.name}: ${p.sym}${ex.unit}`} onClick={() => setPi(k)}>{p.sym}{ex.unit}</button>
          ))}
        </div>
      </div>
      <figcaption>Each step to the right is 1000 times larger. A prefix replaces a factor of a thousand, a million or a billion, so numbers stay short: 4.7 kΩ instead of 4700 Ω.</figcaption>
    </figure>
  );
}

export const figure = { id: "prefixes", Component: Prefixes };
