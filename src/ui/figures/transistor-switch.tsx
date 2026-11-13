import { useState } from "react";

// A transistor as an electrically controlled switch (primer A). The
// microcontroller pin only signals (well under the 4 mA a GPIO pin of the
// F28379D can deliver, datasheet SPRS880); the transistor switches the
// motor's much larger current, which comes from the battery. No transistor
// physics here: chapter 10 (H-bridge) builds on this picture.

const CSS = `
.ts-flow { fill: none; stroke: var(--harvest); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ts-ctl { fill: none; stroke-width: 1.6; stroke-dasharray: 4 3; }
.ts-motor { fill: var(--surface); stroke: var(--text); stroke-width: 1.6; }
.ts-motor.on { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 2.2; }
.ts-m { fill: var(--text); font-size: 13px; font-family: var(--sans); font-weight: 700; }
`;

function TransistorSwitch() {
  const [high, setHigh] = useState(false);
  const pin = high ? "var(--orange)" : "var(--arches)";
  const why = high
    ? "Pin high (3.3 V): the transistor switches on and closes the motor's loop. About 1 A flows from the battery through the motor. The pin itself supplies less than 1 mA: it only gives the order."
    : "Pin low (0 V): the transistor is off, like an open switch. The motor's loop is broken, no current flows, and the motor stands still.";
  return (
    <figure className="figure" aria-label="Interactive circuit: a microcontroller pin switches a motor through a transistor">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 176" role="img" aria-label={`The pin is ${high ? "high" : "low"}. The transistor is ${high ? "on, like a closed switch" : "off, like an open switch"}. The motor is ${high ? "running on about 1 ampere from the battery" : "stopped"}.`}>
        {/* microcontroller */}
        <rect x="8" y="76" width="84" height="56" rx="6" className="fig-chip" />
        <text x="50" y="92" textAnchor="middle" className="fig-label">microcontroller</text>
        <text x="50" y="108" textAnchor="middle" className="fig-label dim">pin is</text>
        <text x="50" y="122" textAnchor="middle" className="fig-value" style={{ fill: pin }}>{high ? "high, 3.3 V" : "low, 0 V"}</text>
        {/* control wire */}
        <line x1="92" y1="104" x2="176" y2="104" className="fig-wire thick" style={{ stroke: pin }} />
        <text x="134" y="98" textAnchor="middle" className="fig-label">control</text>
        <text x="134" y="117" textAnchor="middle" className="fig-label dim">under 1 mA</text>
        {/* transistor box with a switch inside */}
        <rect x="176" y="78" width="72" height="52" rx="5" className={`fig-box ${high ? "hot" : "active"}`} />
        <text x="220" y="143" textAnchor="end" className="fig-label">transistor: {high ? "on" : "off"}</text>
        <path d="M176,104 H196" className="ts-ctl" style={{ stroke: pin }} />
        <polygon points="196,100 203,104 196,108" style={{ fill: pin }} />
        <circle cx="226" cy="90" r="2.6" className="fig-dot" />
        <circle cx="226" cy="118" r="2.6" className="fig-dot" />
        <line x1="226" y1="118" x2={high ? 226 : 210} y2={high ? 90 : 95} className="fig-wire thick" />
        {/* power loop: battery + -> motor -> transistor -> ground */}
        <text x="330" y="14" textAnchor="middle" className="fig-value">battery +, 12 V</text>
        <path d="M330,20 V30" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <path d="M318,20 H342" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <circle cx="330" cy="48" r="18" className={`ts-motor ${high ? "on" : ""}`} />
        <text x="330" y="53" textAnchor="middle" className="ts-m">M</text>
        <text x="354" y="45" className="fig-label">motor</text>
        <text x="354" y="57" className="fig-value small" style={{ fill: high ? "var(--orange)" : "var(--dim)" }}>{high ? "RUNS" : "stopped"}</text>
        <path d="M330,66 V74 H226 V90" className="fig-wire thick" style={{ stroke: high ? "var(--arches)" : "var(--orange)" }} />
        <path d="M226,118 V152" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <path d="M214,152 H238 M219,157 H233 M223,162 H229" className="fig-wire thick" />
        <text x="244" y="160" className="fig-label">ground, 0 V (battery -)</text>
        {high && (
          <>
            <path d="M342,26 v6 m-3.5,-3 l3.5,4.5 l3.5,-4.5 M284,69 l-6,5 l6,5 M238,136 v6 m-3.5,-3 l3.5,4.5 l3.5,-4.5" className="ts-flow" />
            <text x="290" y="90" className="fig-label">about 1 A</text>
          </>
        )}
        {/* shared ground */}
        <path d="M50,132 V152" className="fig-wire" />
        <path d="M40,152 H60 M44,157 H56 M48,162 H52" className="fig-wire" />
        <text x="66" y="160" className="fig-label dim">same ground</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Pin</span>
          <button className="fig-opt" aria-pressed={!high} onClick={() => setHigh(false)}>low (0 V)</button>
          <button className="fig-opt" aria-pressed={high} onClick={() => setHigh(true)}>high (3.3 V)</button>
        </div>
      </div>
      <figcaption>The pin gives the order; the transistor does the heavy switching. The motor's current comes from the battery and never passes through the microcontroller.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "transistor-switch",
  title: "Transistor as a switch",
  description: "Drive the pin high or low to see the transistor switch a motor whose current the pin could never supply.",
  Component: TransistorSwitch,
};
