import { useState } from "react";

// The primer's closing schematic: a push button with a pull-up resistor on
// an input pin, and an LED with its resistor on an output pin. This is how
// the course's boards wire their buttons and LEDs (pull-up to 3.3 V, button
// to ground; pin, resistor, LED, ground). The figure only helps to READ the
// drawing: it highlights everything that is joined by wire to one point. It
// shows no voltages, because working those out is the exercise.

type Net = "v33" | "a" | "b" | "c" | "gnd";

const NAME: Record<Net, string> = { v33: "3.3 V", a: "Point A", b: "Point B", c: "Point C", gnd: "Ground" };
const WHY: Record<Net, string> = {
  v33: "The 3.3 V supply touches one thing only: the top end of resistor R1.",
  a: "Point A joins three things: the bottom end of R1, the top contact of the push button, and the input pin. An input pin only measures, so no current flows into it.",
  b: "Point B joins the output pin to the top end of resistor R2. Whatever voltage the output pin drives is the voltage here.",
  c: "Point C joins the bottom end of R2 to the LED's triangle side, the side where current enters the LED.",
  gnd: "Both ground symbols are the same point, 0 V. Ground touches the bottom contact of the push button and the bar side of the LED.",
};
const ORDER: Net[] = ["v33", "a", "b", "c", "gnd"];

const CSS = `
.bl-wire { stroke: var(--text); stroke-width: 1.8; fill: none; stroke-linecap: round; }
.bl-wire.sel { stroke: var(--harvest); stroke-width: 4; }
.bl-led { fill: var(--surface); stroke: var(--text); stroke-width: 1.6; stroke-linejoin: round; }
.bl-pt { fill: var(--text); font-size: 12px; font-family: var(--sans); font-weight: 700; }
.bl-pt.sel { fill: var(--harvest); }
.bl-pin { fill: var(--accent-soft); stroke: var(--dim); stroke-width: 1; }
`;

function ButtonLedSchematic() {
  const [sel, setSel] = useState<Net>("a");
  const w = (n: Net) => `bl-wire ${sel === n ? "sel" : ""}`;
  const pt = (n: Net) => `bl-pt ${sel === n ? "sel" : ""}`;
  const L = 120;
  const R = 300;
  return (
    <figure className="figure" aria-label="Schematic: a push button with a pull-up resistor on an input pin, and an LED with a resistor on an output pin">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 184" role="img" aria-label={`Left: 3.3 volts, resistor R1 of 10 kilohms, point A, a push button drawn released, ground. Point A also goes to the input pin. Right: the output pin at point B, resistor R2 of 330 ohms, point C, an LED pointing down, ground. Highlighted: ${NAME[sel]}. ${WHY[sel]}`}>
        {/* left: pull-up and button */}
        <text x={L} y="13" textAnchor="middle" className={pt("v33")}>3.3 V</text>
        <path d={`M${L - 12},19 H${L + 12} M${L},19 V34`} className={w("v33")} />
        <rect x={L - 7} y="34" width="14" height="34" className="fig-box active" />
        <text x={L + 14} y="48" className="fig-label">R1</text>
        <text x={L + 14} y="60" className="fig-value small">10 kΩ</text>
        <path d={`M${L},68 V104 M${L},86 H62`} className={w("a")} />
        <circle cx={L} cy="86" r="3.4" className="fig-dot" style={{ fill: sel === "a" ? "var(--harvest)" : undefined }} />
        <text x={L + 9} y="91" className={pt("a")}>A</text>
        <rect x="8" y="74" width="54" height="24" rx="4" className="bl-pin" />
        <text x="35" y="89" textAnchor="middle" className="fig-label">input pin</text>
        <circle cx={L} cy="106" r="2.6" className="fig-dot" />
        <circle cx={L} cy="134" r="2.6" className="fig-dot" />
        <path d={`M${L - 12},102 V138 M${L - 12},120 H${L - 24}`} className="bl-wire" />
        <text x={L + 12} y="118" className="fig-label">push button</text>
        <text x={L + 12} y="130" className="fig-label dim">(released)</text>
        <path d={`M${L},136 V156 M${L - 12},156 H${L + 12} M${L - 7},161 H${L + 7} M${L - 3},166 H${L + 3}`} className={w("gnd")} />
        <text x={L} y="180" textAnchor="middle" className={pt("gnd")}>ground</text>
        {/* right: output pin, resistor, LED */}
        <rect x={R - 32} y="4" width="64" height="24" rx="4" className="bl-pin" />
        <text x={R} y="19" textAnchor="middle" className="fig-label">output pin</text>
        <path d={`M${R},28 V52`} className={w("b")} />
        <circle cx={R} cy="40" r="3.4" className="fig-dot" style={{ fill: sel === "b" ? "var(--harvest)" : undefined }} />
        <text x={R + 9} y="45" className={pt("b")}>B</text>
        <rect x={R - 7} y="52" width="14" height="34" className="fig-box active" />
        <text x={R + 14} y="66" className="fig-label">R2</text>
        <text x={R + 14} y="78" className="fig-value small">330 Ω</text>
        <path d={`M${R},86 V112`} className={w("c")} />
        <circle cx={R} cy="99" r="3.4" className="fig-dot" style={{ fill: sel === "c" ? "var(--harvest)" : undefined }} />
        <text x={R + 9} y="104" className={pt("c")}>C</text>
        <polygon points={`${R - 11},112 ${R + 11},112 ${R},131`} className="bl-led" />
        <path d={`M${R - 11},131 H${R + 11}`} className="bl-wire" />
        <path d={`M${R + 16},116 l9,-6 m-4.5,0 h4.5 v4.5 M${R + 18},126 l9,-6 m-4.5,0 h4.5 v4.5`} className="bl-wire" style={{ strokeWidth: 1.3 }} />
        <text x={R - 16} y="120" textAnchor="end" className="fig-label">LED</text>
        <text x={R - 16} y="132" textAnchor="end" className="fig-label dim">2 V when lit</text>
        <path d={`M${R},131 V156 M${R - 12},156 H${R + 12} M${R - 7},161 H${R + 7} M${R - 3},166 H${R + 3}`} className={w("gnd")} />
        <text x={R} y="180" textAnchor="middle" className={pt("gnd")}>ground</text>
      </svg>
      <p className="fig-why" role="status"><strong>{NAME[sel]}.</strong> {WHY[sel]}</p>
      <div className="fig-controls">
        <div>
          <span>Highlight</span>
          {ORDER.map((n) => (
            <button key={n} className="fig-opt" aria-pressed={sel === n} onClick={() => setSel(n)}>{NAME[n]}</button>
          ))}
        </div>
      </div>
      <figcaption>Everything joined by wire to one point is at the same voltage. Highlight a point to see what it touches, then work out its voltage yourself.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "button-led-schematic",
  title: "Reading a button and LED schematic",
  description: "Highlight a point of the button and LED circuit to see everything wired to it.",
  Component: ButtonLedSchematic,
};
