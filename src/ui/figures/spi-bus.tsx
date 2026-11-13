import { useState } from "react";

// TRM 18.2.1 (signals) and 18.3.3: a slave whose chip select (SPISTE) is
// high ignores the clock and puts its SPISOMI pin in high impedance. The
// course wires the chip selects as plain GPIO outputs: GPIO66 for the
// MPU-9250 and GPIO29 for the DAN28027 (HW3). With nobody driving SOMI the
// simulated board's pull-up holds it high, so the master reads all 1s.

const CSS = `
.sb-note { font-size: max(8.5px, calc(9px / var(--fig-k, 1))); font-family: var(--sans); }
`;

const SLAVES = [
  { name: "MPU-9250", cs: "GPIO66", reply: 0x0071, what: "its WHO_AM_I answer" },
  { name: "DAN28027", cs: "GPIO29", reply: 0x0800, what: "its ADC reading" },
  { name: "third slave", cs: "its GPIO", reply: 0x1234, what: "its data" },
];
const hex4 = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");

/** One SPI master, several slaves: shared clock and data, one chip select each. */
function SpiBus() {
  const [count, setCount] = useState(2);
  const [low, setLow] = useState([false, false, false]);
  const sel = SLAVES.slice(0, count).filter((_, i) => low[i]);
  const conflict = sel.length > 1;
  const none = sel.length === 0;
  const read = none ? 0xffff : sel.reduce((a, s) => a & s.reply, 0xffff);
  const HI = "var(--hi)";
  const LO = "var(--lo)";
  const somiColor = conflict ? "var(--bad)" : none ? "var(--dim)" : "var(--value)";
  const SY = (i: number) => 8 + i * 66;
  const RAIL = { clk: 132, simo: 152, somi: 172 };
  const MPIN = { clk: 36, simo: 56, somi: 76 };
  const csY = (i: number) => 116 + i * 22;
  const csX = (i: number) => 238 - i * 18;
  const masterH = csY(count - 1) + 12 - 14;
  const why = conflict
    ? `Bus conflict: the ${sel.map((s) => s.name).join(" and the ")} are selected together, so ${sel.length === 2 ? "both" : "all"} drive SOMI. Where one sends 1 and another 0 the outputs fight, and the word the master reads is garbage. Only one chip select may be low at a time.`
    : none
      ? "No chip select is low. Every slave ignores the clock and lets go of SOMI. Nothing drives the line, the pull-up holds it high, and a transfer reads all 1s: 0xFFFF. Seeing 0xFFFF usually means the chip select is not low."
      : `Only the ${sel[0].name} is selected (${sel[0].cs} low). It alone follows the clock and drives SOMI, so the master reads ${sel[0].what}, ${hex4(read)}. The other${count > 2 ? "s have" : " has"} let go of SOMI. Keep the chip select low until the last word of the transfer has arrived, then set it high again.`;
  return (
    <figure className="figure" aria-label="Interactive wiring diagram of one SPI master and several slaves">
      <style>{CSS}</style>
      <svg viewBox={`0 0 420 ${Math.max(SY(count - 1) + 62, 14 + masterH + 6)}`} role="img" aria-label={`${count} slaves. ${none ? "No chip select is low, the master reads 0xFFFF." : conflict ? "Several chip selects are low: bus conflict." : `${sel[0].name} is selected and drives SOMI.`}`}>
        {/* master */}
        <rect x="6" y="14" width="84" height={masterH} rx="6" className="fig-box active" />
        <text x="12" y="27" className="fig-label dim">master: F28379D</text>
        <text x="84" y={MPIN.clk + 3} textAnchor="end" className="fig-label">SPICLK</text>
        <text x="84" y={MPIN.simo + 3} textAnchor="end" className="fig-label">SIMO, out</text>
        <text x="84" y={MPIN.somi + 3} textAnchor="end" className="fig-label">SOMI, in</text>
        {/* shared rails */}
        {(["clk", "simo", "somi"] as const).map((k, j) => (
          <path key={k} d={`M90,${MPIN[k]} H${RAIL[k]} M${RAIL[k]},${SY(0) + 10 + j * 12} V${SY(count - 1) + 10 + j * 12}`} className="fig-wire" style={k === "somi" ? { stroke: somiColor, strokeDasharray: none ? "3 2" : undefined, strokeWidth: 2 } : { stroke: "var(--text)" }} />
        ))}
        {SLAVES.slice(0, count).map((s, i) => {
          const y = SY(i);
          const on = low[i];
          const drives = on;
          return (
            <g key={s.name}>
              <rect x="296" y={y} width="118" height="56" rx="6" className={`fig-box ${on ? "hot" : ""}`} />
              <text x="408" y={y + 13} textAnchor="end" className="fig-label">{s.name}</text>
              <text x="408" y={y + 27} textAnchor="end" className="fig-label dim">{on ? "selected:" : "not selected:"}</text>
              <text x="408" y={y + 38} textAnchor="end" className="fig-label dim">{on ? "drives SOMI" : "lets go of SOMI"}</text>
              <text x="301" y={y + 13} className="fig-label">clock</text>
              <text x="301" y={y + 25} className="fig-label">in</text>
              <text x="301" y={y + 37} className="fig-label">out</text>
              <text x="301" y={y + 50} className="fig-label">CS: {on ? "low" : "high"}</text>
              <line x1={RAIL.clk} y1={y + 10} x2="296" y2={y + 10} className="fig-wire" style={{ stroke: "var(--text)" }} />
              <circle cx={RAIL.clk} cy={y + 10} r="2.2" className="fig-dot" />
              <line x1={RAIL.simo} y1={y + 22} x2="296" y2={y + 22} className="fig-wire" style={{ stroke: "var(--text)" }} />
              <circle cx={RAIL.simo} cy={y + 22} r="2.2" className="fig-dot" />
              <line x1={RAIL.somi} y1={y + 34} x2="296" y2={y + 34} className="fig-wire" style={{ stroke: drives ? (conflict ? "var(--bad)" : "var(--value)") : "var(--dim)", strokeDasharray: drives ? undefined : "3 2", strokeWidth: drives ? 2 : 1.2 }} />
              <circle cx={RAIL.somi} cy={y + 34} r="2.2" style={{ fill: somiColor }} />
              {drives && <polygon points={`${RAIL.somi + 8},${y + 34} ${RAIL.somi + 15},${y + 30} ${RAIL.somi + 15},${y + 38}`} style={{ fill: conflict ? "var(--bad)" : "var(--value)" }} />}
              {/* chip select */}
              <text x="84" y={csY(i) + 3} textAnchor="end" className="fig-label">{i < 2 ? s.cs : "GPIO"}</text>
              <path d={`M90,${csY(i)} H${csX(i)} V${y + 47} H296`} className="fig-wire" style={{ stroke: on ? LO : HI, strokeWidth: on ? 2.2 : 1.4 }} />
            </g>
          );
        })}
        <text x={RAIL.clk + 3} y={10} textAnchor="middle" className="fig-label dim">shared by all</text>
        <text x={csX(0) + 4} y={SY(0) + 56} className="sb-note" style={{ fill: "var(--dim)" }}>one each</text>
        <text x="12" y={MPIN.somi + 19} className="fig-label dim">master reads</text>
        <text x="12" y={MPIN.somi + 32} className="fig-value" style={{ fill: conflict ? "var(--bad)" : undefined }}>{conflict ? "garbage" : hex4(read)}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Chip select</span>
          {SLAVES.slice(0, count).map((s, i) => (
            <button key={s.name} className="fig-opt" aria-pressed={low[i]} onClick={() => setLow(low.map((v, k) => (k === i ? !v : v)))}>
              {s.name}: pull {i < 2 ? s.cs : "its CS"} low
            </button>
          ))}
        </div>
        <div>
          <span>Slaves</span>
          <button className="fig-opt" aria-pressed={count === 2} onClick={() => setCount(2)}>2 slaves</button>
          <button className="fig-opt" aria-pressed={count === 3} onClick={() => setCount(3)}>3 slaves</button>
          <code>pins on the master = 3 shared + {count} chip selects = {3 + count}</code>
        </div>
        <div>
          <span>In C</span>
          <code>{low[0] ? "GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;  // select the MPU-9250" : "GpioDataRegs.GPCSET.bit.GPIO66 = 1;    // MPU-9250 not selected"}</code>
        </div>
      </div>
      <figcaption>Clock, SIMO and SOMI go to every slave. The chip-select wires are what tell them apart: a blue chip-select line is low (selected), an orange one is high. A dashed grey SOMI is driven by nobody. Every extra slave costs one more pin on the master.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "spi-bus",
  title: "SPI bus wiring and chip selects",
  description: "Add slaves and pull their chip-select lines low to see who answers on the shared data line, and what goes wrong with none or several selected.",
  Component: SpiBus,
};
