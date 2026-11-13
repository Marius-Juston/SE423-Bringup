import { useState } from "react";

type Outside = "nothing" | "released" | "pressed" | "high";

/** One GPIO pin, as TRM chapter 8 draws it: mux, direction, latch, pull-up, input path. */
function GpioPin() {
  const [gpio, setGpio] = useState(true);
  const [output, setOutput] = useState(false);
  const [latch, setLatch] = useState<0 | 1>(0);
  const [pullup, setPullup] = useState(false);
  const [outside, setOutside] = useState<Outside>("nothing");

  const driving = gpio && output;
  const ext: 0 | 1 | null = outside === "pressed" ? 0 : outside === "high" ? 1 : null;
  const short = driving && ext !== null && ext !== latch;
  const level: 0 | 1 | null = driving ? latch : ext !== null ? ext : pullup ? 1 : null;
  const color = level === null ? "var(--dim)" : level ? "var(--orange)" : "var(--arches)";
  const dash = level === null ? "3 2" : undefined;
  const why = !gpio
    ? "The mux has handed this pin to a peripheral (for example a PWM output or the serial port). The GPIO output latch no longer reaches it."
    : short
      ? "The chip drives the pin one way and the outside circuit drives it the other way: a short circuit. A pin wired to a button or sensor must be an input."
      : driving
        ? `Output: the chip drives the pin ${latch ? "high, to about 3.3 V" : "low, to 0 V"}. The outside circuit has no say.`
        : ext !== null
          ? outside === "pressed"
            ? `Input: the pressed button connects the pin to ground, so it is at 0 V${pullup ? " (the pull-up resistor is far too weak to win)" : ""}.`
            : "Input: the outside circuit holds the pin at 3.3 V."
          : pullup
            ? "Input: nothing outside drives the pin, so the pull-up resistor gently holds it at 3.3 V."
            : "Input: nothing drives the pin and the pull-up is off. The pin floats: its voltage drifts with electrical noise, and reads come back as random 0s and 1s.";
  const reads = level === null ? "random 0 or 1" : String(level);

  const Btn = ({ on, set, children }: { on: boolean; set: () => void; children: string }) => (
    <button className="fig-opt" aria-pressed={on} onClick={set}>{children}</button>
  );

  return (
    <figure className="figure" aria-label="Interactive diagram of one GPIO pin">
      <svg viewBox="0 0 400 170" role="img" aria-label={`Pin is ${level === null ? "floating" : level ? "high, 3.3 volts" : "low, 0 volts"}. GPxDAT reads ${reads}.`}>
        {/* chip */}
        <rect x="6" y="14" width="236" height="148" rx="8" className="fig-chip" />
        <text x="14" y="28" className="fig-label dim">inside the chip</text>
        {/* latch */}
        <rect x="18" y="52" width="66" height="34" rx="4" className={`fig-box ${driving ? "active" : ""}`} />
        <text x="51" y="66" textAnchor="middle" className="fig-label">output latch</text>
        <text x="51" y="80" textAnchor="middle" className="fig-value">{latch}</text>
        {/* driver */}
        <line x1="84" y1="69" x2="104" y2="69" className="fig-wire" style={{ stroke: driving ? (latch ? "var(--orange)" : "var(--arches)") : undefined }} />
        <polygon points="104,56 104,82 128,69" className={`fig-box ${driving ? "active" : "off"}`} />
        <text x="116" y="48" textAnchor="middle" className="fig-label dim">{output ? "output: driver on" : "input: driver off"}</text>
        {/* mux */}
        <rect x="140" y="50" width="46" height="38" rx="4" className="fig-box" />
        <text x="163" y="64" textAnchor="middle" className="fig-label">mux</text>
        <text x="163" y="79" textAnchor="middle" className="fig-value small">{gpio ? "GPIO" : "periph."}</text>
        <line x1="128" y1="69" x2="140" y2="69" className="fig-wire" style={{ stroke: driving ? color : undefined }} />
        {/* pin line */}
        <line x1="186" y1="69" x2="262" y2="69" className="fig-wire thick" style={{ stroke: color, strokeDasharray: dash }} />
        <rect x="236" y="60" width="14" height="18" className="fig-pin" />
        <text x="243" y="54" textAnchor="middle" className="fig-label">pin</text>
        {/* pull-up */}
        <text x="210" y="24" textAnchor="middle" className="fig-label">3.3 V</text>
        <line x1="210" y1="27" x2="210" y2="33" className="fig-wire" />
        <rect x="205" y="33" width="10" height="16" className="fig-box" />
        <line x1="210" y1="49" x2="210" y2="56" className="fig-wire" />
        <line x1="210" y1="56" x2={pullup ? 210 : 218} y2={pullup ? 69 : 64} className="fig-wire" style={{ stroke: pullup ? "var(--orange)" : undefined }} />
        <text x="196" y="44" textAnchor="end" className="fig-label dim">pull-up {pullup ? "on" : "off"}</text>
        {/* input path */}
        <line x1="224" y1="69" x2="224" y2="126" className="fig-wire" style={{ stroke: color, strokeDasharray: dash }} />
        <line x1="224" y1="126" x2="116" y2="126" className="fig-wire" style={{ stroke: color, strokeDasharray: dash }} />
        <rect x="18" y="108" width="98" height="36" rx="4" className="fig-box active" />
        <text x="67" y="122" textAnchor="middle" className="fig-label">GPxDAT reads</text>
        <text x="67" y="137" textAnchor="middle" className="fig-value small">{reads}</text>
        {/* outside */}
        <text x="330" y="28" textAnchor="middle" className="fig-label dim">outside the chip</text>
        {outside === "nothing" && <text x="300" y="73" className="fig-label dim">nothing connected</text>}
        {(outside === "released" || outside === "pressed") && (
          <>
            <line x1="262" y1="69" x2="300" y2="69" className="fig-wire thick" style={{ stroke: color, strokeDasharray: dash }} />
            <circle cx="300" cy="69" r="2.5" className="fig-dot" />
            <circle cx="326" cy="69" r="2.5" className="fig-dot" />
            <line x1="298" y1={outside === "pressed" ? 64 : 54} x2="328" y2={outside === "pressed" ? 64 : 54} className="fig-wire thick" />
            <text x="313" y="48" textAnchor="middle" className="fig-label">button {outside === "pressed" ? "pressed" : "released"}</text>
            <line x1="326" y1="69" x2="350" y2="69" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
            <line x1="350" y1="69" x2="350" y2="100" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
            <line x1="340" y1="100" x2="360" y2="100" className="fig-wire thick" />
            <text x="350" y="114" textAnchor="middle" className="fig-label">ground, 0 V</text>
          </>
        )}
        {outside === "high" && (
          <>
            <line x1="262" y1="69" x2="330" y2="69" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
            <text x="334" y="73" className="fig-label">3.3 V source</text>
          </>
        )}
        <text x="262" y="150" className="fig-value" style={{ fill: short ? "var(--bad)" : color }}>
          {short ? "SHORT CIRCUIT" : level === null ? "pin floats: ? V" : level ? "pin = 3.3 V (1)" : "pin = 0 V (0)"}
        </text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div><span>Mux</span><Btn on={gpio} set={() => setGpio(true)}>GPIO</Btn><Btn on={!gpio} set={() => setGpio(false)}>peripheral</Btn><code>GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, {gpio ? 0 : "n"});</code></div>
        <div><span>Direction</span><Btn on={!output} set={() => setOutput(false)}>input</Btn><Btn on={output} set={() => setOutput(true)}>output</Btn><code>GPIO_SetupPinOptions(pin, {output ? "GPIO_OUTPUT, GPIO_PUSHPULL" : pullup ? "GPIO_INPUT, GPIO_PULLUP" : "GPIO_INPUT, 0"});</code></div>
        <div><span>Latch</span><Btn on={false} set={() => setLatch(1)}>SET</Btn><Btn on={false} set={() => setLatch(0)}>CLEAR</Btn><Btn on={false} set={() => setLatch(latch ? 0 : 1)}>TOGGLE</Btn><code>GpioDataRegs.GPxSET.bit.GPIOn = 1;</code></div>
        <div><span>Pull-up</span><Btn on={!pullup} set={() => setPullup(false)}>off</Btn><Btn on={pullup} set={() => setPullup(true)}>on</Btn><code>GPxPUD bit = {pullup ? "0 (enabled)" : "1 (disabled, the reset state)"}</code></div>
        <div><span>Outside</span><Btn on={outside === "nothing"} set={() => setOutside("nothing")}>nothing</Btn><Btn on={outside === "released"} set={() => setOutside("released")}>button, released</Btn><Btn on={outside === "pressed"} set={() => setOutside("pressed")}>button, pressed</Btn><Btn on={outside === "high"} set={() => setOutside("high")}>3.3 V source</Btn></div>
      </div>
      <figcaption>One GPIO pin. The latch always holds a value; it reaches the pin only when the mux says GPIO and the direction is output. GPxDAT always reads the pin itself. Orange is 3.3 V, blue is 0 V, dashed grey is undefined.</figcaption>
    </figure>
  );
}

export const figure = { id: "gpio-pin", Component: GpioPin };
