import { useState } from "react";

// The four serial links of the course side by side. UART: TRM chapter 19
// (SCI, asynchronous, two devices). SPI: 18.2.1 (SPICLK, SPISIMO, SPISOMI,
// one chip select per slave). I2C: 20.1.3 (two open-drain lines, 7-bit
// addresses; 20.1.1: 10 to 400 kbit/s). CAN: 22.1.1 (up to 1 Mbit/s,
// identifiers instead of addresses; the pair CANH / CANL is behind the
// transceiver).

const CSS = `
.bc-row { fill: transparent; stroke: none; cursor: pointer; }
.bc-row.sel { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.5; }
.bc-name { font-family: var(--sans); font-size: 11px; font-weight: 700; fill: var(--text); }
.bc-dev { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.bc-w { fill: none; stroke-width: 1.3; }
`;

interface Bus {
  id: string;
  name: string;
  role: string;
  wires: (n: number) => number;
  wiresText: (n: number) => string;
  clock: string;
  select: string;
  speed: string;
  why: string;
}
const BUSES: Bus[] = [
  {
    id: "uart", name: "UART", role: "chip",
    wires: (n) => 2 * n, wiresText: (n) => `${2 * n}: TX and RX for each device`,
    clock: "none: both ends agree on a baud rate",
    select: "no addresses: one port per device",
    speed: "115200 bit/s in the course",
    why: "UART joins exactly two devices, so every device needs a serial port of its own on the chip: two wires each. No clock wire: both ends must be set to the same baud rate beforehand. Both directions at once (full duplex).",
  },
  {
    id: "spi", name: "SPI", role: "master",
    wires: (n) => 3 + n, wiresText: (n) => `${3 + n}: 3 shared + ${n} chip selects`,
    clock: "a clock wire, from the master",
    select: "by its own chip-select wire",
    speed: "1 MHz in the course, up to tens of MHz",
    why: "SPI shares the clock and the two data wires, but each slave needs its own chip-select wire: fast and simple, and it costs one more pin per device. The master makes the clock. Both directions at once (full duplex).",
  },
  {
    id: "i2c", name: "I2C", role: "master",
    wires: () => 2, wiresText: () => "2 for any number: SDA, SCL",
    clock: "a clock wire (SCL), from the master",
    select: "by a 7-bit address in the first byte",
    speed: "100 kbit/s, 400 kbit/s in fast mode",
    why: "I2C needs two wires however many devices there are. The master makes the clock and names the device it wants by a 7-bit address at the start of every transfer. The price: one direction at a time (half duplex) and a modest speed, because resistors, not transistors, pull the lines high.",
  },
  {
    id: "can", name: "CAN", role: "node",
    wires: () => 2, wiresText: () => "2 for any number: CANH, CANL",
    clock: "none: every node times the bits itself",
    select: "no addresses: each frame has an identifier",
    speed: "1 Mbit/s for the course's sensors",
    why: "CAN also needs two wires, a twisted pair carrying one signal as a voltage difference, which resists noise over metres of cable. No master and no clock wire: any node may send, and each frame starts with an identifier that says what it contains. The lower identifier wins when two start together.",
  },
];

/** UART, SPI, I2C and CAN wired to the same three devices. */
function BusCompare() {
  const [sel, setSel] = useState("i2c");
  const [n, setN] = useState(3);
  const H = 68;
  const DX = (k: number) => 76 + k * (n > 3 ? 31 : 40);
  const DW = n > 3 ? 27 : 34;
  const bus = BUSES.find((b) => b.id === sel)!;
  const sketch = (b: Bus, y: number) => {
    const lines: JSX.Element[] = [];
    const ly = (k: number, of: number) => y + 34 + (of <= 2 ? 6 + k * 10 : k * (26 / (of - 1)));
    const endX = DX(n - 1) + DW;
    const w = (key: string, d: string, color: string, dash?: string) => lines.push(<path key={key} d={d} className="bc-w" style={{ stroke: color, strokeDasharray: dash }} />);
    if (b.id === "i2c" || b.id === "can") {
      const colors = b.id === "i2c" ? ["var(--value)", "var(--info)"] : ["var(--hi)", "var(--lo)"];
      for (let k = 0; k < 2; k++) {
        w(`r${k}`, `M52,${ly(k, 2)} H${endX}`, colors[k]);
        for (let d = 0; d < n; d++) w(`t${k}${d}`, `M${DX(d) + DW / 2 + (k ? 5 : -5)},${y + 24} V${ly(k, 2)}`, colors[k]);
      }
    } else if (b.id === "spi") {
      const total = 3 + n;
      for (let k = 0; k < 3; k++) {
        w(`r${k}`, `M52,${ly(k, total)} H${DX(n - 1) + 4 + k * 5}`, "var(--text)");
        for (let d = 0; d < n; d++) w(`t${k}${d}`, `M${DX(d) + 4 + k * 5},${y + 24} V${ly(k, total)}`, "var(--text)");
      }
      for (let d = 0; d < n; d++) w(`c${d}`, `M52,${ly(3 + d, total)} H${DX(d) + DW - 5} V${y + 24}`, "var(--accent)");
    } else {
      const total = 2 * n;
      for (let d = 0; d < n; d++)
        for (let k = 0; k < 2; k++) w(`u${d}${k}`, `M52,${ly(2 * d + k, total)} H${DX(d) + DW / 2 + (k ? 5 : -5)} V${y + 24}`, k ? "var(--info)" : "var(--value)");
    }
    return (
      <g>
        <rect x={8} y={y + 6} width={44} height={H - 12} rx="4" className="bc-dev" />
        <text x={30} y={y + 30} textAnchor="middle" className="bc-name">{b.name}</text>
        <text x={30} y={y + 44} textAnchor="middle" className="fig-label dim">{b.role}</text>
        {lines}
        {Array.from({ length: n }, (_, d) => (
          <g key={d}>
            <rect x={DX(d)} y={y + 6} width={DW} height={18} rx="3" className="bc-dev" />
            <text x={DX(d) + DW / 2} y={y + 18} textAnchor="middle" className="fig-label">{b.id === "i2c" && n <= 3 ? `0x${(0x48 + d).toString(16).toUpperCase()}` : `dev ${d + 1}`}</text>
          </g>
        ))}
      </g>
    );
  };
  return (
    <figure className="figure" aria-label="Comparison of UART, SPI, I2C and CAN wiring for several devices">
      <style>{CSS}</style>
      <svg viewBox={`0 0 420 ${4 * H + 4}`} role="img" aria-label={`${bus.name} selected. For ${n} devices: UART ${BUSES[0].wires(n)} wires, SPI ${BUSES[1].wires(n)}, I2C 2, CAN 2.`}>
        {BUSES.map((b, i) => {
          const y = 2 + i * H;
          return (
            <g key={b.id} onClick={() => setSel(b.id)}>
              <rect x={2} y={y + 1} width={416} height={H - 2} rx="6" className={`bc-row ${sel === b.id ? "sel" : ""}`} />
              {sketch(b, y)}
              <text x={212} y={y + 17} className="fig-label"><tspan className="fig-label dim">wires: </tspan>{b.wiresText(n)}</text>
              <text x={212} y={y + 30} className="fig-label"><tspan className="fig-label dim">clock: </tspan>{b.clock}</text>
              <text x={212} y={y + 43} className="fig-label"><tspan className="fig-label dim">chosen: </tspan>{b.select}</text>
              <text x={212} y={y + 56} className="fig-label"><tspan className="fig-label dim">speed: </tspan>{b.speed}</text>
            </g>
          );
        })}
      </svg>
      <p className="fig-why" role="status">{bus.why}</p>
      <div className="fig-controls">
        <div>
          <span>Bus</span>
          {BUSES.map((b) => (
            <button key={b.id} className="fig-opt" aria-pressed={sel === b.id} onClick={() => setSel(b.id)}>{b.name}</button>
          ))}
        </div>
        <div>
          <span>Devices</span>
          <button className="fig-opt" aria-label="one device fewer" disabled={n <= 1} onClick={() => setN(n - 1)}>-</button>
          <button className="fig-opt" aria-label="one device more" disabled={n >= 4} onClick={() => setN(n + 1)}>+</button>
          <code>{n} device{n > 1 ? "s" : ""}: UART {2 * n} wires, SPI {3 + n}, I2C 2, CAN 2</code>
        </div>
      </div>
      <figcaption>The same devices on each of the four links. Add a device and count: UART and SPI need more pins on the chip every time, the two buses never do. What the buses pay for that is an address or identifier in every message.</figcaption>
    </figure>
  );
}

export const figure = { id: "bus-compare", Component: BusCompare };
