import { useState } from "react";

// TRM 20.1.3 (open-drain SDA and SCL with pull-ups: wired-AND), 20.3.2
// (data changes only while SCL is low), 20.3.4 (START:
// SDA falls while SCL is high; STOP: SDA rises while SCL is high), 20.3.5.1
// (7-bit address, then R/W: 0 = write), 20.3.5.4 and Figure 20-11 (repeated
// START: a second START without a STOP in between), 20.3.6 (the receiver
// acknowledges by pulling SDA low in the ninth clock; a master-receiver
// answers its last byte with a NACK). Devices as in this game's simulator
// (src/sim/plugins/i2c.ts): a temperature sensor at 0x48 and a clock chip at
// 0x68, each with a register pointer that a write sets. Reading a register
// is therefore two parts, as chapter 14 teaches: write the register
// number, repeated START, read.

const CSS = `
.ib-res { fill: var(--surface); stroke: var(--text); stroke-width: 1.2; }
.ib-now { fill: var(--accent-soft); }
.ib-who { font-family: var(--mono); font-size: max(8.5px, calc(9px / var(--fig-k, 1))); font-weight: 700; }
.ib-key b { font-family: var(--mono); }
`;

const DEVS = [
  { name: "F28379D, the master", tag: "master (F28379D)", short: "the master" },
  { name: "sensor, address 0x48", tag: "sensor, 0x48", short: "the sensor (0x48)" },
  { name: "clock chip, address 0x68", tag: "clock chip, 0x68", short: "the clock chip (0x68)" },
];
const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

/** One half of a clock period (or the idle bus): who holds which line. */
interface Item {
  kind: "idle" | "start" | "bit" | "ack" | "stop" | "end";
  /** Printed above the waveform, on the half in which the bit is read. */
  label: string;
  t0: number;
  t1: number;
  sda: 0 | 1;
  /** 0 while the master holds the clock low. */
  scl: 0 | 1;
  /** Who decides SDA in this slot: master, slave, or nobody. */
  who: "M" | "S" | "-";
  text: string;
  /** Index of the last item of the byte (or condition) this item belongs to. */
  unitEnd: number;
}

function build(addr: number, read: boolean): { items: Item[]; groups: { t0: number; t1: number; label: string }[]; slave: number } {
  const slave = addr === 0x48 ? 1 : addr === 0x68 ? 2 : 0;
  const items: Item[] = [];
  const groups: { t0: number; t1: number; label: string }[] = [];
  let t = 0;
  let unitFrom = 0;
  const push = (kind: Item["kind"], label: string, len: number, sda: 0 | 1, scl: 0 | 1, who: Item["who"], text: string) => {
    items.push({ kind, label, t0: t, t1: t + len, sda, scl, who, text, unitEnd: 0 });
    t += len;
  };
  /** Everything pushed since the last call is one press of "Next byte". */
  const endUnit = () => {
    for (let i = unitFrom; i < items.length; i++) items[i].unitEnd = items.length - 1;
    unitFrom = items.length;
  };
  const sets = (who: Item["who"], b: 0 | 1) => `${who === "M" ? "the master" : DEVS[slave].short} ${b ? "lets go of SDA, so the resistor pulls it high" : "pulls SDA low"}`;
  /** One bit: SDA is set while SCL is low, and read while SCL is high. */
  const bit = (b: 0 | 1, who: Item["who"], what: string, read1: string) => {
    push("bit", "", 1, b, 0, who, `SCL low: the master holds the clock down. Only now may SDA change, and ${sets(who, b)}: ${what}.`);
    push("bit", String(b), 1, b, 1, who, `SCL high: the master lets go of the clock and every device reads SDA. ${read1}`);
  };
  const byte = (value: number, who: Item["who"], name: (i: number) => string, last: (i: number, b: number) => string) => {
    for (let i = 7; i >= 0; i--) {
      const b = ((value >> i) & 1) as 0 | 1;
      bit(b, who, `${name(i)} is ${b}`, last(i, b));
    }
  };
  /** Address byte: 7 address bits and R/W. Returns false when nobody answers. */
  const address = (rd: boolean): boolean => {
    const g0 = t;
    byte((addr << 1) | (rd ? 1 : 0), "M",
      (i) => (i ? `address bit ${i - 1}` : "the R/W bit"),
      (i, b) => (i ? `It reads ${b}.` : `R/W = ${b}: ${rd ? "the master wants to read. After the ACK the device will set SDA." : "the master wants to write. It keeps setting SDA after the ACK."} The whole byte was (0x${h2(addr)} << 1) | ${b} = 0x${h2(((addr << 1) | b) & 0xff)}.`));
    groups.push({ t0: g0, t1: t - 2, label: `addr 0x${h2(addr)}` }, { t0: t - 2, t1: t, label: rd ? "R" : "W" });
    groups.push({ t0: t, t1: t + 2, label: slave ? "A" : "N" });
    if (!slave) {
      push("ack", "", 1, 1, 0, "-", "Ninth clock, SCL low: the master lets go of SDA and listens for an answer.");
      push("ack", "N", 1, 1, 1, "-", `SCL high, and no device has address 0x${h2(addr)}, so nobody pulls: SDA stays high. That is a NACK. The I2C module sets I2CSTR.NACK and waits, holding SCL low.`);
    } else {
      push("ack", "", 1, 0, 0, "S", `Ninth clock, SCL low: the master lets go of SDA and ${DEVS[slave].short} pulls it low.`);
      push("ack", "A", 1, 0, 1, "S", `SCL high: SDA is low. That is an ACK, "I am here", from ${DEVS[slave].short}. Only a low line proves somebody answered.`);
    }
    endUnit();
    return slave !== 0;
  };
  const reg = read ? 0x00 : 0x03;
  const stop = (after: string) => {
    push("stop", "", 1, 0, 0, "M", "SCL low: the master pulls SDA low, to have something to let go of.");
    push("stop", "P", 2, 1, 1, "M", `STOP: the master raises SCL, then lets SDA rise while SCL is high. The bus is free again.${after}`);
    endUnit();
  };

  push("idle", "", 1.5, 1, 1, "-", "Idle: nobody pulls, so the two resistors hold SDA and SCL high. Any device may start now.");
  push("start", "S", 1.5, 0, 1, "M", "START: the master pulls SDA low while SCL is still high. Data never changes while SCL is high, so every device recognises this as the start of a transfer and listens.");
  endUnit();
  if (!address(false)) {
    stop(" After a NACK your program must ask for this STOP itself (I2CMDR.bit.STP = 1), or the bus stays busy.");
  } else {
    const d0 = t;
    byte(reg, "M", (i) => `bit ${i} of the register number`, (i, b) => `It reads ${b}.${i ? "" : ` The device now points at register ${reg}.`}`);
    groups.push({ t0: d0, t1: t, label: `register 0x${h2(reg)}` }, { t0: t, t1: t + 2, label: "A" });
    push("ack", "", 1, 0, 0, "S", `Ninth clock, SCL low: ${DEVS[slave].short} was receiving, so it pulls SDA low.`);
    push("ack", "A", 1, 0, 1, "S", `SCL high: ACK. ${DEVS[slave].short} has taken the register number.${read ? " A read cannot say which register it wants, which is why this write came first." : ""}`);
    endUnit();
    if (!read) stop("");
    else {
      push("start", "", 1, 1, 0, "-", "SCL low: the master lets SDA rise. It sends no STOP, so no other master can take the bus in between.");
      push("start", "Sr", 1, 0, 1, "M", "Repeated START: SCL is high and the master pulls SDA low again. A new transfer begins on a bus that was never released.");
      endUnit();
      address(true);
      const data = slave === 1 ? 0x19 : 0x56;
      const r0 = t;
      byte(data, "S", (i) => `data bit ${i}`, (_, b) => `The master reads ${b}. It still makes the clock, but only listens on SDA.`);
      groups.push({ t0: r0, t1: t, label: `data 0x${h2(data)}` }, { t0: t, t1: t + 2, label: "N" });
      push("ack", "", 1, 1, 0, "-", `Ninth clock, SCL low: ${DEVS[slave].short} lets go of SDA. Now the master is the receiver, so the answer is the master's.`);
      push("ack", "N", 1, 1, 1, "M", "SCL high: the master leaves SDA high on purpose. A NACK after the last byte it wants tells the device to stop sending.");
      endUnit();
      stop("");
    }
  }
  push("end", "", 1.5, 1, 1, "-", "Idle again: both lines high, nobody pulling.");
  endUnit();
  return { items, groups, slave };
}

/** The I2C bus: open-drain devices on two pulled-up lines, and one transfer step by step. */
function I2cBus() {
  const [mode, setMode] = useState<"hand" | "xfer">("hand");
  const [pull, setPull] = useState<boolean[][]>([[false, false], [false, false], [false, false]]);
  const [addr, setAddr] = useState(0x48);
  // Opens on a write to the sensor, the transfer of level bus-i2c-start.
  const [read, setRead] = useState(false);
  const [step, setStep] = useState(0);
  const { items, groups, slave } = build(addr, read);
  const s = Math.min(step, items.length - 1);
  const it = items[s];
  // Who pulls what at the moment shown.
  const pulls: boolean[][] = mode === "hand"
    ? pull
    : DEVS.map((_, d) => [it.sda === 0 && ((it.who === "M" && d === 0) || (it.who === "S" && d === slave)), it.scl === 0 && d === 0]);
  const sda = pulls.some((p) => p[0]) ? 0 : 1;
  const scl = pulls.some((p) => p[1]) ? 0 : 1;
  const col = (v: number) => (v ? "var(--hi)" : "var(--lo)");
  const pullers = (line: number) => DEVS.filter((_, d) => pulls[d][line]).map((d) => d.short);
  const handWhy = () => {
    const a = pullers(0);
    const b = pullers(1);
    const one = (name: string, who: string[]) => (who.length ? `${name} is low because ${who.join(" and ")} pull${who.length === 1 ? "s" : ""} it to ground` : `${name} is high: nobody pulls, the resistor wins`);
    return `${one("SDA", a)}. ${one("SCL", b)}. A line is 1 only when every device has let go (wired-AND); nobody can force a 1, so two devices can never short the bus.${pulls[1][1] || pulls[2][1] ? " A slave holding SCL low makes the master wait: clock stretching." : ""}`;
  };
  const C = [120, 235, 350];
  const SDA_Y = 40;
  const SCL_Y = 56;
  // ---- waveforms ----
  const HW = 360 / items[items.length - 1].t1;
  const X0 = 44;
  const x = (t: number) => X0 + t * HW;
  const tEnd = it.t1;
  // Every item holds its levels from its start; SDA moves a little after
  // SCL falls, and in the middle of a START or STOP (while SCL is high).
  const sdaPts: [number, number][] = [];
  const sclPts: [number, number][] = [];
  for (const q of items) {
    sclPts.push([q.t0, q.scl]);
    sdaPts.push([q.kind === "start" && q.scl ? (q.t0 + q.t1) / 2 : q.kind === "stop" && q.scl ? q.t0 + 1 : q.scl ? q.t0 : q.t0 + 0.3, q.sda]);
  }
  const trace = (pts: [number, number][], yHi: number) => {
    const y = (v: number) => yHi + (v ? 0 : 16);
    let d = `M${x(0)},${y(1)}`;
    let lv = 1;
    for (const [t, v] of pts) {
      if (t >= tEnd) break;
      if (v === lv) continue;
      d += ` H${x(t)} V${y(v)}`;
      lv = v;
    }
    return d + ` H${x(tEnd)}`;
  };
  const whoColor = (w: Item["who"]) => (w === "M" ? "var(--accent)" : w === "S" ? "var(--info)" : "var(--dim)");
  return (
    <figure className="figure" aria-label="Interactive diagram of the I2C bus: open-drain devices and a transfer step by step">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 126" role="img" aria-label={`SDA is ${sda ? "high" : "low"}${sda ? "" : `, pulled by ${pullers(0).join(" and ")}`}. SCL is ${scl ? "high" : "low"}${scl ? "" : `, pulled by ${pullers(1).join(" and ")}`}.`}>
        <line x1="14" x2="54" y1="8" y2="8" className="fig-wire" style={{ stroke: "var(--hi)" }} />
        <text x="58" y="11" className="fig-label">3.3 V</text>
        <text x="58" y="24" className="fig-label dim">two pull-up resistors, for the whole bus</text>
        <line x1="24" x2="24" y1="8" y2={SDA_Y} className="fig-wire" />
        <rect x="20" y="14" width="8" height="16" className="ib-res" />
        <line x1="44" x2="44" y1="8" y2={SCL_Y} className="fig-wire" />
        <rect x="40" y="14" width="8" height="16" className="ib-res" />
        <line x1="14" x2="410" y1={SDA_Y} y2={SDA_Y} className="fig-wire thick" style={{ stroke: col(sda) }} />
        <line x1="14" x2="410" y1={SCL_Y} y2={SCL_Y} className="fig-wire thick" style={{ stroke: col(scl) }} />
        <circle cx="24" cy={SDA_Y} r="2.2" className="fig-dot" />
        <circle cx="44" cy={SCL_Y} r="2.2" className="fig-dot" />
        <text x="410" y={SDA_Y - 4} textAnchor="end" className="fig-label">SDA (data): {sda ? "high, 1" : "low, 0"}</text>
        <text x="410" y={SCL_Y - 4} textAnchor="end" className="fig-label">SCL (clock): {scl ? "high, 1" : "low, 0"}</text>
        {DEVS.map((d, i) => (
          <g key={d.name}>
            <rect x={C[i] - 54} y="72" width="108" height="50" rx="6" className={`fig-box ${pulls[i][0] || pulls[i][1] ? "hot" : ""}`} />
            <text x={C[i]} y="117" textAnchor="middle" className="fig-label">{d.tag}</text>
            {[0, 1].map((line) => {
              const sx = C[i] + (line ? 10 : -40);
              const on = pulls[i][line];
              return (
                <g key={line}>
                  <line x1={sx} x2={sx} y1={line ? SCL_Y : SDA_Y} y2="80" className="fig-wire" style={{ stroke: col(line ? scl : sda) }} />
                  <circle cx={sx} cy={line ? SCL_Y : SDA_Y} r="2.2" className="fig-dot" />
                  <circle cx={sx} cy="80" r="1.8" className="fig-dot" />
                  <circle cx={sx} cy="94" r="1.8" className="fig-dot" />
                  <line x1={sx} y1="94" x2={on ? sx : sx + 9} y2={on ? 80 : 83} className="fig-wire" style={{ stroke: on ? "var(--lo)" : "var(--text)", strokeWidth: on ? 2.4 : 1.4 }} />
                  <line x1={sx} x2={sx} y1="94" y2="101" className="fig-wire" style={{ stroke: on ? "var(--lo)" : undefined }} />
                  <line x1={sx - 6} x2={sx + 6} y1="101" y2="101" className="fig-wire" style={{ stroke: "var(--text)" }} />
                  <text x={sx + 12} y="97" className="fig-label dim">{on ? "pulls" : "open"}</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {mode === "xfer" && (
        <svg viewBox="0 -5 420 99" role="img" aria-label={`Waveforms of SCL and SDA for the transfer, up to step ${s + 1} of ${items.length}: ${it.kind === "bit" ? `a bit, ${it.sda}` : it.kind === "ack" ? (it.sda ? "NACK" : "ACK") : it.kind === "start" ? "START" : it.kind === "stop" ? "STOP" : "idle"}, SCL ${it.scl ? "high" : "low"}.`}>
          <rect x={x(it.t0)} y="14" width={x(it.t1) - x(it.t0)} height="78" className="ib-now" />
          {groups.filter((g) => g.t0 < tEnd).map((g, i) => (
            <g key={i}>
              <path d={`M${x(g.t0) + 1.5},12 v-3 H${x(Math.min(g.t1, tEnd)) - 1.5}${g.t1 <= tEnd ? " v3" : ""}`} className="fig-wire" style={{ strokeWidth: 1 }} />
              <text x={(x(g.t0) + x(g.t1)) / 2} y="7" textAnchor="middle" className="fig-label">{g.label}</text>
            </g>
          ))}
          <text x="4" y="38" className="fig-label">SCL</text>
          <text x="4" y="66" className="fig-label">SDA</text>
          <text x="4" y="86" className="fig-label dim">sent by</text>
          <path d={trace(sclPts, 28)} className="fig-trace" />
          <path d={trace(sdaPts, 56)} className="fig-trace data" />
          {items.slice(0, s + 1).map((q, i) => (q.label ? (
            <g key={i}>
              <text x={(x(q.t0) + x(q.t1)) / 2} y="23" textAnchor="middle" className="fig-value small">{q.label}</text>
              <text x={(x(q.t0) + x(q.t1)) / 2} y="86" textAnchor="middle" className="ib-who" style={{ fill: whoColor(q.who) }}>{q.who === "S" ? "D" : q.who}</text>
            </g>
          ) : null))}
        </svg>
      )}
      <p className="fig-why" role="status">{mode === "hand" ? handWhy() : it.text}</p>
      <div className="fig-controls">
        <div>
          <span>Show</span>
          <button className="fig-opt" aria-pressed={mode === "hand"} onClick={() => setMode("hand")}>pull the lines by hand</button>
          <button className="fig-opt" aria-pressed={mode === "xfer"} onClick={() => setMode("xfer")}>step through a transfer</button>
        </div>
        {mode === "hand" && DEVS.map((d, i) => (
          <div key={d.name}>
            <span>{i === 0 ? "Master" : i === 1 ? "Sensor" : "Clock chip"}</span>
            {["SDA", "SCL"].map((n, line) => (
              <button key={n} className="fig-opt" aria-pressed={pull[i][line]} aria-label={`${d.name}: pull ${n} low`} onClick={() => setPull(pull.map((p, k) => (k === i ? p.map((v, l) => (l === line ? !v : v)) : p)))}>
                pull {n} low
              </button>
            ))}
          </div>
        ))}
        {mode === "xfer" && (
          <>
            <div>
              <span>Step</span>
              <button className="fig-opt" disabled={s === 0} onClick={() => setStep(s - 1)}>Back</button>
              <button className="fig-opt" disabled={s === items.length - 1} onClick={() => setStep(s + 1)}>Next</button>
              <button className="fig-opt" disabled={s === items.length - 1} onClick={() => setStep(it.unitEnd > s ? it.unitEnd : items[s + 1].unitEnd)}>Next byte</button>
              <button className="fig-opt" disabled={s === 0} onClick={() => setStep(0)}>Reset</button>
            </div>
            <div>
              <span>Address</span>
              <button className="fig-opt" aria-pressed={addr === 0x48} onClick={() => setAddr(0x48)}>0x48, the sensor</button>
              <button className="fig-opt" aria-pressed={addr === 0x68} onClick={() => setAddr(0x68)}>0x68, the clock chip</button>
              <button className="fig-opt" aria-pressed={addr === 0x49} onClick={() => setAddr(0x49)}>0x49, nobody</button>
              <code>I2cbRegs.I2CSAR.all = 0x{h2(addr)};</code>
            </div>
            <div>
              <span>Direction</span>
              <button className="fig-opt" aria-pressed={!read} onClick={() => setRead(false)}>write a register number</button>
              <button className="fig-opt" aria-pressed={read} onClick={() => setRead(true)}>read a register</button>
              <code>address byte = (0x{h2(addr)} &lt;&lt; 1) | R/W: 0x{h2((addr << 1) & 0xff)} to write{read ? `, 0x${h2(((addr << 1) | 1) & 0xff)} to read` : ""}</code>
            </div>
          </>
        )}
      </div>
      <figcaption>Every device connects to the same two lines and can only close a switch to ground or leave it open. Orange lines are high, blue lines are low. {mode === "xfer" && <span className="ib-key"> In the step-through each press of Next is half a clock: SDA changes while the master holds SCL low and is read while SCL is high. Under the waveform, <b>M</b> means the master sets SDA, <b>D</b> the addressed device, <b>-</b> nobody. <b>S</b> is START, <b>Sr</b> a repeated START, <b>P</b> STOP, <b>A</b> ACK, <b>N</b> NACK.</span>}</figcaption>
    </figure>
  );
}

export const figure = {
  id: "i2c-bus",
  title: "I2C bus: who pulls the lines",
  description: "Close the switches of three devices on the two shared I2C lines by hand, or step through a write and a read half a clock at a time and see who holds SDA and SCL low.",
  Component: I2cBus,
};
