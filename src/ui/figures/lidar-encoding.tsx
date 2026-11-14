import { useState } from "react";
import { CodePre } from "../CopyButton";
import { MAX_MM, MIN_MM, encode } from "../../sim/plugins/lidar";

// How the Hokuyo URG-04LX sends one distance (lecture 16, SCIP 1.x): 12 bits
// split into two halves of 6 bits, high half first, each with 0x30 added, so
// both are printable characters from '0' (0x30) to 'o' (0x6F). The course's
// parser (RXCINT_recv_ready in F28379dSerial.c) undoes it with
// ((hi - 0x30) << 6) + (lo - 0x30). `encode` is the simulator's own function.
/** A character as it must be written inside '...' in C. */
const esc = (c: string) => (c === "\\" || c === "'" ? `\\${c}` : c);
const hex2 = (v: number) => `0x${v.toString(16).toUpperCase().padStart(2, "0")}`;
const bin6 = (v: number) => v.toString(2).padStart(6, "0");
const PRESETS = [1000, 20, 64, 4095];
// Rows of the picture, top to bottom.
const ROW_MM = 0;
const ROW_BITS = 1;
const ROW_HALF = 2;
const ROW_CHAR = 3;

function LidarEncoding() {
  const [mm, setMm] = useState(1000);
  const [decode, setDecode] = useState(true);
  const [step, setStep] = useState(0);
  const chars = encode(mm);
  const cHi = chars.charCodeAt(0);
  const cLo = chars.charCodeAt(1);
  const hi = cHi - 0x30;
  const lo = cLo - 0x30;
  // Decoding walks up the picture, encoding walks down.
  const row = decode ? ROW_CHAR - step : step;
  const reached = (r: number) => (decode ? r >= row : r <= row);
  const cls = (r: number) => (r === row ? "hot" : reached(r) ? "" : "off");
  const dim = (r: number) => (reached(r) ? undefined : 0.55);
  const STEPS = decode
    ? [
        {
          title: "1. Two characters arrive",
          text: `The sensor sent '${chars[0]}' and '${chars[1]}'. To the chip they are just two numbers, their ASCII codes ${hex2(cHi)} and ${hex2(cLo)}.`,
          code: `char hi = '${esc(chars[0])}';   // ${hex2(cHi)}\nchar lo = '${esc(chars[1])}';   // ${hex2(cLo)}`,
        },
        {
          title: "2. Subtract 0x30 from each",
          text: `That removes the offset the sensor added. What is left are two numbers from 0 to 63, six bits each: ${hi} and ${lo}.`,
          code: `hi - 0x30   // ${hex2(cHi)} - 0x30 = ${hex2(hi)} = ${hi}\nlo - 0x30   // ${hex2(cLo)} - 0x30 = ${hex2(lo)} = ${lo}`,
        },
        {
          title: "3. Put the halves side by side",
          text: `The first character holds the upper 6 bits. Shifting it left by 6 (the same as multiplying by 64) moves it above the lower 6 bits: ${hi} × 64 = ${hi * 64}.`,
          code: `(${hi} << 6) + ${lo}   // ${bin6(hi)} ${bin6(lo)}`,
        },
        {
          title: "4. The distance",
          text: mm < MIN_MM ? `${hi * 64} + ${lo} = ${mm}. Careful: readings below 20 are error codes, not distances. The course code replaces them with its maximum reading.` : `${hi * 64} + ${lo} = ${mm} mm.`,
          code: `distance = ((hi - 0x30) << 6) + (lo - 0x30);   // ${mm}`,
        },
      ]
    : [
        {
          title: "1. A distance",
          text: mm < MIN_MM ? `${mm} is below 20: the sensor uses such values as error codes. They are sent the same way.` : `The sensor measured ${mm} mm. The largest value it can report is 4095.`,
          code: `mm = ${mm};`,
        },
        {
          title: "2. Twelve bits",
          text: `The largest reading, 4095, is 2^12 - 1, so every reading fits in 12 bits. This one is ${bin6(hi)} ${bin6(lo)}.`,
          code: `// ${mm} = 0x${mm.toString(16).toUpperCase().padStart(3, "0")}`,
        },
        {
          title: "3. Split into 6 + 6",
          text: `The upper six bits are ${hi}, the lower six are ${lo}. Each half is a number from 0 to 63.`,
          code: `high = (mm >> 6) & 0x3F;   // ${hi}\nlow  = mm & 0x3F;          // ${lo}`,
        },
        {
          title: "4. Add 0x30 to each half",
          text: `0 to 63 plus 0x30 gives 0x30 to 0x6F: always a printable character, never a line feed (0x0A). So a line feed in the reply can only mean "end of line". This reading goes out as '${chars[0]}' then '${chars[1]}'.`,
          code: `high + 0x30   // ${hex2(cHi)} = '${chars[0]}'\nlow  + 0x30   // ${hex2(cLo)} = '${chars[1]}'`,
        },
      ];
  const s = STEPS[step];
  const HX = 151; // centre of the high half
  const LX = 299; // centre of the low half
  const CELL = 22;
  const bitX = (k: number) => (k < 6 ? HX - 3 * CELL + k * CELL : LX - 3 * CELL + (k - 6) * CELL);
  const bits = Array.from({ length: 12 }, (_, k) => (mm >> (11 - k)) & 1);
  const arrow = (x1: number, y1: number, x2: number, y2: number, r: number) => {
    // r: the lower row of the pair this arrow joins. It is lit while that step is shown.
    const lit = decode ? row === r - 1 : row === r;
    const d = decode ? `M${x2},${y2} L${x1},${y1}` : `M${x1},${y1} L${x2},${y2}`;
    return <path d={d} className={`fig-wire ${lit ? "hot" : ""}`} markerEnd={`url(#${lit ? "lenc-arrow-hot" : "lenc-arrow"})`} opacity={decode ? dim(r - 1) : dim(r)} />;
  };
  return (
    <figure className="figure lenc" aria-label="Interactive diagram: a LIDAR distance as 12 bits, two 6-bit halves and two characters">
      <style>{`
        .lenc-slider { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 12rem; }
        .lenc-slider input { flex: 1; min-width: 6rem; accent-color: var(--orange); }
        .lenc-slider output { font-family: var(--mono); color: var(--harvest); font-weight: 700; min-width: 4.6rem; }
        .lenc-big { font-size: 15px; }
        .lenc-head { fill: var(--dim); }
        .lenc-head-hot { fill: var(--orange); }
      `}</style>
      <svg viewBox="0 0 420 196" role="img" aria-label={`${mm} millimetres is the 12 bits ${bin6(hi)} ${bin6(lo)}: high half ${hi}, low half ${lo}. With 0x30 added they are the characters ${chars[0]} and ${chars[1]}. ${s.title}.`}>
        <defs>
          <marker id="lenc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="lenc-head" />
          </marker>
          <marker id="lenc-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="lenc-head-hot" />
          </marker>
        </defs>
        {/* row labels */}
        <text x="4" y="20" className="fig-label dim">distance</text>
        <text x="4" y="67" className="fig-label dim">12 bits</text>
        <text x="4" y="110" className="fig-label dim">6 + 6 bits</text>
        <text x="4" y="121" className="fig-label dim">(0 to 63)</text>
        <text x="4" y="163" className="fig-label dim">+ 0x30:</text>
        <text x="4" y="174" className="fig-label dim">characters</text>
        {/* distance */}
        <g opacity={dim(ROW_MM)}>
          <rect x="175" y="4" width="100" height="24" rx="4" className={`fig-box ${cls(ROW_MM)}`} />
          <text x="225" y="20" textAnchor="middle" className="fig-value">{mm} mm</text>
        </g>
        {arrow(225, 28, 225, 50, ROW_BITS)}
        {/* bits */}
        <g opacity={dim(ROW_BITS)}>
          <text x={bitX(0)} y="49" className="fig-label dim">bit 11</text>
          <text x={bitX(11) + CELL} y="49" textAnchor="end" className="fig-label dim">bit 0</text>
          {bits.map((b, k) => (
            <g key={k}>
              <rect x={bitX(k)} y="52" width={CELL} height="22" className={`fig-box ${cls(ROW_BITS)}`} />
              <text x={bitX(k) + CELL / 2} y="67" textAnchor="middle" className={b ? "fig-value" : "fig-label dim"}>{b}</text>
            </g>
          ))}
        </g>
        {arrow(HX, 74, HX, 96, ROW_HALF)}
        {arrow(LX, 74, LX, 96, ROW_HALF)}
        {/* halves */}
        <g opacity={dim(ROW_HALF)}>
          <rect x={HX - 62} y="98" width="124" height="26" rx="4" className={`fig-box ${cls(ROW_HALF)}`} />
          <text x={HX} y="109" textAnchor="middle" className="fig-label">high half</text>
          <text x={HX} y="120" textAnchor="middle" className="fig-value small">{bin6(hi)} = {hex2(hi)} = {hi}</text>
          <rect x={LX - 62} y="98" width="124" height="26" rx="4" className={`fig-box ${cls(ROW_HALF)}`} />
          <text x={LX} y="109" textAnchor="middle" className="fig-label">low half</text>
          <text x={LX} y="120" textAnchor="middle" className="fig-value small">{bin6(lo)} = {hex2(lo)} = {lo}</text>
        </g>
        {arrow(HX, 124, HX, 146, ROW_CHAR)}
        {arrow(LX, 124, LX, 146, ROW_CHAR)}
        <text x={HX + 10} y="138" className="fig-label dim" opacity={dim(decode ? ROW_HALF : ROW_CHAR)}>{decode ? "− 0x30" : "+ 0x30"}</text>
        <text x={LX + 10} y="138" className="fig-label dim" opacity={dim(decode ? ROW_HALF : ROW_CHAR)}>{decode ? "− 0x30" : "+ 0x30"}</text>
        {/* characters */}
        <g opacity={dim(ROW_CHAR)}>
          <rect x={HX - 62} y="148" width="124" height="30" rx="4" className={`fig-box ${cls(ROW_CHAR)}`} />
          <text x={HX - 30} y="168" textAnchor="middle" className="fig-value lenc-big">'{chars[0]}'</text>
          <text x={HX + 22} y="167" textAnchor="middle" className="fig-value small">{hex2(cHi)}</text>
          <rect x={LX - 62} y="148" width="124" height="30" rx="4" className={`fig-box ${cls(ROW_CHAR)}`} />
          <text x={LX - 30} y="168" textAnchor="middle" className="fig-value lenc-big">'{chars[1]}'</text>
          <text x={LX + 22} y="167" textAnchor="middle" className="fig-value small">{hex2(cLo)}</text>
          <text x={HX} y="191" textAnchor="middle" className="fig-label dim">sent first</text>
          <text x={LX} y="191" textAnchor="middle" className="fig-label dim">sent second</text>
        </g>
      </svg>
      <div className="fig-step" role="status">
        <strong>{s.title}</strong>
        <p>{s.text}</p>
        <CodePre><code>{s.code}</code></CodePre>
      </div>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
        <button className="btn small primary" onClick={() => setStep(step + 1)} disabled={step === 3}>Next</button>
        <button className="btn small" onClick={() => setStep(0)} disabled={step === 0}>Reset</button>
        <span className="fig-dots" aria-hidden="true">{STEPS.map((_, k) => (<i key={k} className={k === step ? "on" : ""} />))}</span>
      </div>
      <div className="fig-controls">
        <div>
          <span>Distance</span>
          <label className="lenc-slider">
            <input type="range" min={0} max={MAX_MM} step={1} value={mm} onChange={(e) => setMm(+e.target.value)} aria-label="Distance in millimetres, 0 to 4095" />
            <output>{mm} mm</output>
          </label>
        </div>
        <div>
          <span>Try</span>
          {PRESETS.map((p) => (
            <button key={p} className="fig-opt" aria-pressed={mm === p} onClick={() => setMm(p)}>{p} mm</button>
          ))}
        </div>
        <div>
          <span>Direction</span>
          <button className="fig-opt" aria-pressed={decode} onClick={() => { setDecode(true); setStep(0); }}>decode (your code)</button>
          <button className="fig-opt" aria-pressed={!decode} onClick={() => { setDecode(false); setStep(0); }}>encode (the sensor)</button>
        </div>
      </div>
      <figcaption>One reading on the wire is two printable characters. Decoding goes up the picture, encoding goes down. The second character counts millimetres, the first one counts steps of 64 mm.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "lidar-encoding",
  title: "LIDAR distance as two characters",
  description: "Set a distance and step through how its 12 bits are split into two halves and sent as two printable characters, or decoded back.",
  Component: LidarEncoding,
};
