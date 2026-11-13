import { useState } from "react";

// The two ways an LED hangs on a GPIO pin (course L3, Lab 1). Robot board
// LEDs (LED1 on GPIO22): pin -> resistor -> LED -> ground, lit by a high
// pin. LaunchPad LEDs (blue on GPIO31, red on GPIO34): 3.3 V -> resistor ->
// LED -> pin, lit by a low pin. Pin levels are driven with GPxSET / GPxCLEAR
// (TRM section 8.3).

const CSS = `
.lw-glow { fill: var(--orange); opacity: 0.28; }
.lw-led { fill: var(--surface); stroke: var(--text); stroke-width: 1.6; stroke-linejoin: round; }
.lw-led.lit { fill: var(--orange); stroke: var(--orange); }
.lw-flow { fill: none; stroke: var(--harvest); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.lw-panel { fill: none; stroke: var(--border-strong, var(--dim)); stroke-dasharray: 4 3; }
.lw-code { display: block; margin: 0.4rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-size: 0.76rem; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

const TOP = 44;
const BOT = 150;

/** One LED circuit drawn top to bottom: top node, resistor, LED, bottom node. */
function Circuit({ cx, topV, botV }: { cx: number; topV: 0 | 1; botV: 0 | 1 }) {
  const lit = topV === 1 && botV === 0;
  const col = (v: 0 | 1) => (v ? "var(--orange)" : "var(--arches)");
  return (
    <g>
      <line x1={cx} y1={TOP} x2={cx} y2="62" className="fig-wire thick" style={{ stroke: col(topV) }} />
      <rect x={cx - 6} y="62" width="12" height="24" className="fig-box active" />
      <text x={cx - 12} y="77" textAnchor="end" className="fig-label dim">resistor</text>
      <line x1={cx} y1="86" x2={cx} y2="100" className="fig-wire thick" style={{ stroke: col(topV) }} />
      {lit && <circle cx={cx} cy="109" r="19" className="lw-glow" />}
      <polygon points={`${cx - 10},100 ${cx + 10},100 ${cx},117`} className={`lw-led ${lit ? "lit" : ""}`} />
      <line x1={cx - 10} y1="117" x2={cx + 10} y2="117" className="fig-wire thick" style={{ stroke: lit ? "var(--orange)" : undefined }} />
      <text x={cx - 24} y="112" textAnchor="end" className="fig-label dim">LED</text>
      {lit && (
        <>
          <path d={`M${cx + 16},103 l10,-7 m-5,0 h5 v5 M${cx + 18},113 l10,-7 m-5,0 h5 v5`} className="lw-flow" style={{ stroke: "var(--orange)", strokeWidth: 1.5 }} />
          {/* current arrows, top to bottom */}
          <path d={`M${cx + 12},50 v9 m-3.5,-4 l3.5,4.5 l3.5,-4.5 M${cx + 12},128 v9 m-3.5,-4 l3.5,4.5 l3.5,-4.5`} className="lw-flow" />
          <text x={cx + 20} y="58" className="fig-label">current</text>
        </>
      )}
      <line x1={cx} y1="117" x2={cx} y2={BOT} className="fig-wire thick" style={{ stroke: col(botV) }} />
      <text x={cx + 34} y="112" className="fig-value" style={{ fill: lit ? "var(--orange)" : "var(--dim)" }}>{lit ? "LIT" : "dark"}</text>
    </g>
  );
}

function LedWiring() {
  const [high, setHigh] = useState(true);
  const v: 0 | 1 = high ? 1 : 0;
  const col = high ? "var(--orange)" : "var(--arches)";
  const volts = high ? "3.3 V" : "0 V";
  const why = high
    ? "Pin high. Robot board: 3.3 V above the LED and 0 V below it, so current flows down through it and it lights. LaunchPad: 3.3 V on both sides of the LED, no difference, no current, dark."
    : "Pin low. Robot board: 0 V on both sides of the LED, no difference, no current, dark. LaunchPad: 3.3 V above the LED and 0 V at the pin below it, so current flows into the pin and the LED lights.";
  return (
    <figure className="figure" aria-label="Interactive: an LED lit by a high pin and an LED lit by a low pin">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 190" role="img" aria-label={`Both pins are ${high ? "high" : "low"}. The robot board LED is ${high ? "lit" : "dark"}. The LaunchPad LED is ${high ? "dark" : "lit"}.`}>
        <rect x="4" y="4" width="192" height="182" rx="6" className="lw-panel" />
        <rect x="204" y="4" width="192" height="182" rx="6" className="lw-panel" />
        <text x="100" y="17" textAnchor="middle" className="fig-label">Robot board LED1: lit by a HIGH pin</text>
        <text x="300" y="17" textAnchor="middle" className="fig-label">LaunchPad red LED: lit by a LOW pin</text>
        {/* left: pin on top, ground below */}
        <rect x="76" y={TOP - 16} width="28" height="16" className="fig-pin" />
        <text x="70" y={TOP - 5} textAnchor="end" className="fig-label">GPIO22 pin</text>
        <text x="110" y={TOP - 4} className="fig-value" style={{ fill: col }}>{volts}</text>
        <Circuit cx={90} topV={v} botV={0} />
        <line x1="78" y1={BOT} x2="102" y2={BOT} className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <line x1="83" y1={BOT + 4} x2="97" y2={BOT + 4} className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <line x1="87" y1={BOT + 8} x2="93" y2={BOT + 8} className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <text x="90" y={BOT + 22} textAnchor="middle" className="fig-label">ground, always 0 V</text>
        {/* right: 3.3 V on top, pin below */}
        <line x1="266" y1={TOP} x2="314" y2={TOP} className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <text x="290" y={TOP - 6} textAnchor="middle" className="fig-label">supply, always 3.3 V</text>
        <Circuit cx={290} topV={1} botV={v} />
        <rect x="276" y={BOT} width="28" height="16" className="fig-pin" />
        <text x="270" y={BOT + 12} textAnchor="end" className="fig-label">GPIO34 pin</text>
        <text x="310" y={BOT + 13} className="fig-value" style={{ fill: col }}>{volts}</text>
      </svg>
      <code className="lw-code">
        {high
          ? "// LED1 on\nGpioDataRegs.GPASET.bit.GPIO22 = 1;\n// red LED off\nGpioDataRegs.GPBSET.bit.GPIO34 = 1;"
          : "// LED1 off\nGpioDataRegs.GPACLEAR.bit.GPIO22 = 1;\n// red LED on\nGpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;"}
      </code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Both pins</span>
          <button className="fig-opt" aria-pressed={high} onClick={() => setHigh(true)}>drive high</button>
          <button className="fig-opt" aria-pressed={!high} onClick={() => setHigh(false)}>drive low</button>
        </div>
      </div>
      <figcaption>An LED lights only when current flows through it, from a higher voltage to a lower one. The pin is one end of the circuit; what the other end is tied to decides whether a 1 or a 0 turns the LED on. The LaunchPad's blue LED on GPIO31 is wired like its red one.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "led-wiring",
  title: "LED lit by a high pin or a low pin",
  description: "Drive both pins high or low to see why one LED lights on a 1 and the other on a 0.",
  Component: LedWiring,
};
