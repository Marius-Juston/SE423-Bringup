import { useState } from "react";

// MPU-9250 Register Map (RM-MPU-9250A-00 rev 1.4), registers 0x1B, 0x1C and
// 0x3B to 0x48: each measurement is a signed 16-bit two's-complement count,
// high byte first; full scale is the range chosen in GYRO_CONFIG /
// ACCEL_CONFIG bits 4:3. The course (HW3 exercise 5) sets +-250 deg/s and
// +-4 g and converts with raw * range / 32767.0.

const CSS = `
.is-cell { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.is-cell.sign { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.4; }
.is-bit { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--text); }
.is-axis { stroke: var(--dim); stroke-width: 1.2; }
.is-bar { stroke-width: 6; stroke-linecap: butt; }
.is-fig input[type=range] { flex: 1 1 7rem; min-width: 6rem; max-width: 12rem; padding: 0; accent-color: var(--accent); }
`;

const RANGES = [
  { id: "gyro", label: "gyro, ±250 deg/s", fs: 250, unit: "deg/s", v: "gyroz", code: "250.0", cfg: "GYRO_CONFIG (0x1B) = 0x00" },
  { id: "a4", label: "accelerometer, ±4 g", fs: 4, unit: "g", v: "accelz", code: "4.0", cfg: "ACCEL_CONFIG (0x1C) = 0x08" },
  { id: "a2", label: "accelerometer, ±2 g (after reset)", fs: 2, unit: "g", v: "accelz", code: "2.0", cfg: "ACCEL_CONFIG (0x1C) = 0x00" },
];
const h = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, "0");

/** A raw signed 16-bit count from the MPU-9250, and the physical value it stands for. */
function ImuScaling() {
  const [ri, setRi] = useState(0);
  const [raw, setRaw] = useState(-11796);
  const [signed, setSigned] = useState(true);
  const r = RANGES[ri];
  const u16 = raw & 0xffff;
  const seen = signed ? raw : u16;
  const value = (seen * r.fs) / 32767;
  const truth = (raw * r.fs) / 32767;
  const digits = r.fs >= 100 ? 1 : 3;
  const X0 = 30;
  const X1 = 390;
  const x = (v: number) => X0 + ((v + 32768) / 65535) * (X1 - X0);
  const AY = 92;
  const neg = raw < 0;
  const why = !signed && neg
    ? `Stored in a uint16_t the same 16 bits read as ${u16}, and the formula gives ${value.toFixed(digits)} ${r.unit}: beyond full scale and with the wrong sign. The sensor's count is signed. Put it in an int16_t and the top bit counts as -32768.`
    : raw === 32767 || raw === -32768
      ? `Full scale: the count cannot go further. A ${raw > 0 ? "larger" : "more negative"} ${r.unit === "g" ? "acceleration" : "turn rate"} than ${raw > 0 ? "+" : "-"}${r.fs} ${r.unit} still reads ${raw}: the sensor saturates. Choose a wider range if that happens.`
      : raw === 0
        ? `Zero count, zero ${r.unit}. One count is ${r.fs} / 32767 = ${(r.fs / 32767).toPrecision(3)} ${r.unit}: a smaller range gives a smaller step.`
        : `${raw} counts out of 32767 is ${((Math.abs(raw) / 32767) * 100).toFixed(1)} % of full scale, ${neg ? "in the negative direction (top bit 1)" : "in the positive direction (top bit 0)"}: ${truth.toFixed(digits)} ${r.unit}.${r.id !== "gyro" && Math.abs(truth - 1) < 0.02 ? " This is 1 g, gravity on an axis that points up." : ""}`;
  return (
    <figure className="figure is-fig" aria-label="Interactive conversion from a raw MPU-9250 count to a physical value">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 150" role="img" aria-label={`Raw count ${raw}, hexadecimal ${h(u16, 4)}, is ${value.toFixed(digits)} ${r.unit} on the ${r.label} range.`}>
        {/* the two bytes as they arrive */}
        <text x={X0} y={10} className="fig-label dim">high byte (first), 0x{h(u16 >> 8, 2)}</text>
        <text x={X1} y={10} textAnchor="end" className="fig-label dim">low byte, 0x{h(u16 & 0xff, 2)}</text>
        {Array.from({ length: 16 }, (_, i) => (
          <g key={i}>
            <rect x={X0 + i * 22.5 + (i >= 8 ? 1.5 : 0)} y={14} width={20.5} height={18} rx="2" className={`is-cell ${i === 0 ? "sign" : ""}`} />
            <text x={X0 + i * 22.5 + (i >= 8 ? 1.5 : 0) + 10.25} y={27} textAnchor="middle" className="is-bit">{(u16 >> (15 - i)) & 1}</text>
          </g>
        ))}
        <text x={X0} y={44} className="fig-label" style={{ fill: "var(--accent)" }}>sign bit: {neg ? "1, negative" : "0, positive"}</text>
        <text x={X1} y={44} textAnchor="end" className="fig-value small">
          0x{h(u16, 4)} = {signed ? `${raw} as int16_t` : `${u16} as uint16_t`}
        </text>
        {/* number line */}
        <line x1={X0} x2={X1} y1={AY} y2={AY} className="is-axis" />
        {[-32768, -16384, 0, 16384, 32767].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={AY - 4} y2={AY + 4} className="is-axis" />
            <text x={x(t)} y={AY + 15} textAnchor={t === -32768 ? "start" : t === 32767 ? "end" : "middle"} className="fig-label dim">{t}</text>
            <text x={x(t)} y={AY + 27} textAnchor={t === -32768 ? "start" : t === 32767 ? "end" : "middle"} className="fig-label">
              {t === 0 ? "0" : `${t > 0 ? "+" : "-"}${((Math.abs(t) > 20000 ? 1 : 0.5) * r.fs).toString()}`} {r.unit}
            </text>
          </g>
        ))}
        <line x1={x(0)} x2={x(raw)} y1={AY} y2={AY} className="is-bar" style={{ stroke: neg ? "var(--lo)" : "var(--hi)" }} />
        <path d={`M${x(raw)},${AY - 4} l-5,-9 h10 z`} style={{ fill: "var(--value)" }} />
        <text x={Math.max(X0 + 52, Math.min(X1 - 40, x(raw)))} y={AY - 18} textAnchor="middle" className="fig-value">
          {signed || !neg ? "" : "really "}{raw === 0 ? "0" : `${truth > 0 ? "+" : ""}${truth.toFixed(digits)}`} {r.unit}
        </text>
        <text x={X0} y={144} className="fig-value small">
          {r.v} = {r.v}_raw * {r.code} / 32767.0;  // {seen} * {r.code} / 32767.0 = {value.toFixed(digits)}
        </text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Raw count</span>
          <input type="range" min={-32768} max={32767} value={raw} aria-label="Raw 16-bit count from the sensor" onChange={(e) => setRaw(+e.target.value)} />
          <button className="fig-opt" onClick={() => setRaw(-32768)}>most negative</button>
          <button className="fig-opt" onClick={() => setRaw(0)}>zero</button>
          <button className="fig-opt" onClick={() => setRaw(32767)}>most positive</button>
          {r.unit === "g" && <button className="fig-opt" onClick={() => setRaw(Math.round(32768 / r.fs))}>1 g</button>}
        </div>
        <div>
          <span>Range</span>
          {RANGES.map((q, i) => (
            <button key={q.id} className="fig-opt" aria-pressed={ri === i} onClick={() => setRi(i)}>{q.label}</button>
          ))}
          <code>{r.cfg}</code>
        </div>
        <div>
          <span>Stored in</span>
          <button className="fig-opt" aria-pressed={signed} onClick={() => setSigned(true)}>int16_t</button>
          <button className="fig-opt" aria-pressed={!signed} onClick={() => setSigned(false)}>uint16_t</button>
          <code>{signed ? "int16_t" : "uint16_t"} {r.v}_raw = SpibRegs.SPIRXBUF;</code>
        </div>
      </div>
      <figcaption>The sensor reports a signed count: -32768 to 32767 stands for minus to plus full scale of the chosen range. The same 1 g is 16384 counts on the ±2 g range and 8192 on ±4 g. The top bit is the sign: the bar points right (orange) for positive values and left (blue) for negative ones.</figcaption>
    </figure>
  );
}

export const figure = { id: "imu-scaling", Component: ImuScaling };
