import { useState } from "react";

const BYTE = 0xa5;
const NAMES = [
  ["Rising edge without delay", "mode 1 (CPOL 0, CPHA 1)"],
  ["Rising edge with delay", "mode 0 (CPOL 0, CPHA 0)"],
  ["Falling edge without delay", "mode 3 (CPOL 1, CPHA 1)"],
  ["Falling edge with delay", "mode 2 (CPOL 1, CPHA 0)"],
];

/** The four SPI clocking schemes of TRM section 18.3.6 (Table 18-3, Figure 18-7). */
function SpiModes() {
  const [pol, setPol] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<0 | 1>(1);
  const idle = pol;
  const active = (1 - pol) as 0 | 1;
  // Time in half clock cycles: edge k (1..16) happens at x = k. Odd edges
  // leave the idle level ("first edge"), even edges return to it.
  // With delay (phase 1): data is read on the first edge of each cycle and
  // changes on the second. Without delay (phase 0): the reverse.
  const sampleOnFirst = phase === 1;
  const X0 = 58;
  const W = 19;
  const x = (k: number) => X0 + k * W;
  const y = (row: number, lv: number) => row + (lv ? 0 : 22);
  const CLK = 44;
  const DAT = 96;
  let clk = `M${X0 - 2},${y(CLK, idle)} H${x(1)}`;
  for (let k = 1; k <= 16; k++) clk += ` V${y(CLK, k % 2 ? active : idle)} H${k < 16 ? x(k + 1) : x(17) + 26}`;
  const bits = Array.from({ length: 8 }, (_, i) => (BYTE >> (7 - i)) & 1);
  // Bit i is on the data line from its change edge to the next one.
  const changeAt = (i: number) => (sampleOnFirst ? 2 * i : 2 * i + 1);
  let dat = `M${x(changeAt(0))},${y(DAT, bits[0])}`;
  for (let i = 0; i < 8; i++) dat += ` H${x(changeAt(i) + 2)}${i < 7 ? ` V${y(DAT, bits[i + 1])}` : ""}`;
  const sampleEdges = Array.from({ length: 8 }, (_, i) => (sampleOnFirst ? 2 * i + 1 : 2 * i + 2));
  const firstRises = active === 1;
  const sampleRises = sampleOnFirst ? firstRises : !firstRises;
  const n = pol * 2 + phase;
  return (
    <figure className="figure" aria-label="Interactive SPI clock polarity and phase diagram">
      <svg viewBox="0 0 420 150" role="img" aria-label={`Clock rests ${idle ? "high" : "low"}. Data is read on each ${sampleRises ? "rising" : "falling"} edge and changes on each ${sampleRises ? "falling" : "rising"} edge.`}>
        <text x="4" y="13" className="fig-label">chip select</text>
        <text x="4" y="24" className="fig-label dim">stays low</text>
        <path d={`M${X0 - 2},8 H${X0 + 6} V20 H${x(17) + 8} V8 H${x(17) + 26}`} className="fig-trace dim" />
        <text x="4" y={CLK + 15} className="fig-label">SPICLK</text>
        <text x="4" y={CLK + 26} className="fig-label dim">rests {idle ? "high" : "low"}</text>
        <path d={clk} className="fig-trace" />
        <text x="4" y={DAT + 15} className="fig-label">data</text>
        <path d={dat} className="fig-trace data" />
        {bits.map((b, i) => (
          <text key={i} x={x(changeAt(i) + 1)} y={DAT + 36} textAnchor="middle" className="fig-value small">{b}</text>
        ))}
        {sampleEdges.map((k, i) => (
          <g key={i}>
            <line x1={x(k)} x2={x(k)} y1={CLK - 6} y2={DAT + 24} className="fig-sample" />
            <path d={sampleRises ? `M${x(k) - 4},${CLK + 14} L${x(k)},${CLK + 7} L${x(k) + 4},${CLK + 14}` : `M${x(k) - 4},${CLK + 8} L${x(k)},${CLK + 15} L${x(k) + 4},${CLK + 8}`} className="fig-sample-arrow" />
          </g>
        ))}
        <text x={x(1)} y={CLK - 10} textAnchor="middle" className="fig-label dim">first edge</text>
        <text x={X0} y={146} className="fig-label dim">Dashed lines: when the data line is read. Byte 0xA5, top bit first.</text>
      </svg>
      <div className="fig-step" role="status">
        <p>
          <strong>Two questions settle the mode.</strong> 1. Where does the clock rest while nothing is sent? <strong>{idle ? "High" : "Low"}</strong>, so CLKPOLARITY = {pol}. 2. On which edge is the data read? The <strong>{sampleOnFirst ? "first" : "second"}</strong> edge of each cycle, a <strong>{sampleRises ? "rising" : "falling"}</strong> edge; the data changes on the other edge, where nobody is looking. So CLK_PHASE = {phase}.
        </p>
        <p>
          The manual calls this <strong>{NAMES[n][0]}</strong>. Device datasheets usually call it <strong>{NAMES[n][1]}</strong>. Careful: CLK_PHASE = 1 corresponds to CPHA 0, the two are opposite.{n === 1 ? " This is the setting the course uses for the MPU-9250 and the DAN28027." : ""}
        </p>
      </div>
      <div className="fig-controls">
        <div>
          <span>Polarity</span>
          <button className="fig-opt" aria-pressed={pol === 0} onClick={() => setPol(0)}>clock rests low</button>
          <button className="fig-opt" aria-pressed={pol === 1} onClick={() => setPol(1)}>clock rests high</button>
          <code>SpibRegs.SPICCR.bit.CLKPOLARITY = {pol};</code>
        </div>
        <div>
          <span>Phase</span>
          <button className="fig-opt" aria-pressed={phase === 1} onClick={() => setPhase(1)}>read on the first edge</button>
          <button className="fig-opt" aria-pressed={phase === 0} onClick={() => setPhase(0)}>read on the second edge</button>
          <code>SpibRegs.SPICTL.bit.CLK_PHASE = {phase};</code>
        </div>
      </div>
      <figcaption>The same byte in any of the four clocking schemes: only the relation between clock edges and data moves. To read a diagram, find the clock's resting level first, then see where the data line changes; it is read on the other edge.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "spi-modes",
  title: "SPI clock polarity and phase",
  description: "Pick where the clock rests and on which edge the data is read to see all four clocking schemes on the same byte.",
  Component: SpiModes,
};
