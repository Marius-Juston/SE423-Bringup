// An 8-bit R-2R ladder DAC with a 3.0 V reference: the resistor network of
// the DAC block diagram, TRM section 12.1.2, drawn at 8 bits. Every switch
// connects its 2R leg to the reference or to ground; bit k adds
// 3.0 V / 2^(8 - k), and the output is their sum: code x 3.0 / 256.
import { useState } from "react";

const VREF = 3.0;
const N = 8;
const trim = (v: number) => v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

function R2RLadder() {
  const [code, setCode] = useState(0b10000000);
  const on = (k: number) => ((code >> k) & 1) === 1;
  const weight = (k: number) => VREF / 2 ** (N - k);
  const vout = (code * VREF) / 256;
  const X = (k: number) => 96 + (7 - k) * 37;
  const RAIL = 30;
  const bitsOn = Array.from({ length: N }, (_, i) => 7 - i).filter(on);
  const bin = code.toString(2).padStart(8, "0");
  const binSpaced = `${bin.slice(0, 4)} ${bin.slice(4)}`;
  const why =
    bitsOn.length === 0
      ? "Every switch is on ground, so nothing is added: the output is 0 V."
      : `${bitsOn.length === 1 ? `Only bit ${bitsOn[0]} is` : `Bits ${bitsOn.join(", ").replace(/, (\d)$/, " and $1")} are`} switched to the 3.0 V reference: ${bitsOn.map((k) => trim(weight(k))).join(" + ")}${bitsOn.length > 1 ? ` = ${trim(vout)}` : ""} V. The same result from the number: ${code} x 3.0 / 256 = ${trim(vout)} V.${code === 255 ? " All bits on is still one step short of 3.0 V." : ""}`;

  return (
    <figure className="figure r2r" aria-label="Interactive 8-bit R-2R ladder DAC">
      <style>{`.r2r .r2r-sw { cursor: pointer; } .r2r .r2r-bits { font-family: var(--mono); }`}</style>
      <svg viewBox="0 0 420 168" role="img" aria-label={`Switches ${binSpaced}, number ${code}. Output ${trim(vout)} volts.`}>
        {/* output */}
        <text x="4" y="14" className="fig-label dim">Vout</text>
        <text x="4" y="58" className="fig-value">{trim(vout)} V</text>
        <line x1="6" x2="40" y1={RAIL} y2={RAIL} className="fig-wire thick" style={{ stroke: "var(--harvest)" }} />
        <polygon points={`62,${RAIL - 11} 62,${RAIL + 11} 40,${RAIL}`} className="fig-box active" />
        <text x="51" y="14" textAnchor="middle" className="fig-label dim">buffer</text>
        <line x1="62" x2={X(7)} y1={RAIL} y2={RAIL} className="fig-wire" />
        {/* rail with R between the nodes */}
        {Array.from({ length: N - 1 }, (_, i) => {
          const a = X(7 - i);
          return (
            <g key={i}>
              <line x1={a} x2={a + 10} y1={RAIL} y2={RAIL} className="fig-wire" />
              <rect x={a + 10} y={RAIL - 4} width="17" height="8" className="fig-box" />
              <line x1={a + 27} x2={a + 37} y1={RAIL} y2={RAIL} className="fig-wire" />
              <text x={a + 18.5} y={RAIL - 8} textAnchor="middle" className="fig-label dim">R</text>
            </g>
          );
        })}
        {/* terminating 2R */}
        <line x1={X(0)} x2="398" y1={RAIL} y2={RAIL} className="fig-wire" />
        <line x1="398" x2="398" y1={RAIL} y2="42" className="fig-wire" />
        <rect x="394" y="42" width="8" height="22" className="fig-box" />
        <text x="391" y="56" textAnchor="end" className="fig-label dim">2R</text>
        <line x1="398" x2="398" y1="64" y2="88" className="fig-wire" style={{ stroke: "var(--arches)" }} />
        <line x1="390" x2="406" y1="88" y2="88" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <text x="398" y="104" textAnchor="middle" className="fig-label" style={{ fill: "var(--arches)" }}>0V</text>
        {/* legs */}
        {Array.from({ length: N }, (_, i) => {
          const k = 7 - i;
          const x = X(k);
          const hi = on(k);
          const col = hi ? "var(--orange)" : "var(--arches)";
          return (
            <g key={k}>
              <circle cx={x} cy={RAIL} r="2.2" className="fig-dot" />
              <line x1={x} x2={x} y1={RAIL} y2="42" className="fig-wire" />
              <rect x={x - 4} y="42" width="8" height="22" className={`fig-box ${hi ? "hot" : ""}`} />
              <text x={x + 7} y="56" className="fig-label dim">2R</text>
              <line x1={x} x2={x} y1="64" y2="74" className="fig-wire" style={{ stroke: col }} />
              <line x1={x} x2={hi ? x - 9 : x + 9} y1="74" y2="88" className="fig-wire thick" style={{ stroke: col }} />
              <circle cx={x} cy="74" r="2" className="fig-dot" />
              <circle cx={x - 9} cy="90" r="3" fill="var(--orange)" opacity={hi ? 1 : 0.45} />
              <circle cx={x + 9} cy="90" r="3" fill="var(--arches)" opacity={hi ? 0.45 : 1} />
              <text x={x - 9} y="104" textAnchor="middle" className="fig-label" style={{ fill: "var(--orange)", opacity: hi ? 1 : 0.6 }}>3V</text>
              <text x={x + 9} y="104" textAnchor="middle" className="fig-label" style={{ fill: "var(--arches)", opacity: hi ? 0.6 : 1 }}>0V</text>
              <text x={x} y="122" textAnchor="middle" className={hi ? "fig-value small" : "fig-label dim"}>{hi ? `+${trim(weight(k))}` : "0"}</text>
              <text x={x} y="136" textAnchor="middle" className="fig-label dim">bit {k}</text>
              {/* large invisible click target; the buttons below do the same for keyboards */}
              <rect x={x - 18} y="38" width="36" height="102" fill="transparent" className="r2r-sw" onClick={() => setCode(code ^ (1 << k))} />
            </g>
          );
        })}
        <text x="60" y="122" textAnchor="end" className="fig-label dim">adds (V)</text>
        <text x="150" y="158" textAnchor="end" className="fig-value">{binSpaced} = {code}</text>
        <text x="172" y="158" className="fig-value">{code} x 3.0 / 256 = {trim(vout)} V</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Switches</span>
          {Array.from({ length: N }, (_, i) => {
            const k = 7 - i;
            return (
              <button key={k} className="fig-opt r2r-bits" aria-pressed={on(k)} aria-label={`Bit ${k}, adds ${trim(weight(k))} volts`} onClick={() => setCode(code ^ (1 << k))}>{k}</button>
            );
          })}
          <button className="fig-opt" onClick={() => setCode(0)}>all off</button>
        </div>
      </div>
      <figcaption>An 8-bit R-2R ladder with a 3.0 V reference. Only two resistor values are needed. Each switch puts its leg on 3.0 V (orange, bit = 1) or on ground (blue, bit = 0), and each bit adds half as much as the bit to its left. Click a switch or use the buttons.</figcaption>
    </figure>
  );
}

export const figure = { id: "r2r-ladder", Component: R2RLadder };
