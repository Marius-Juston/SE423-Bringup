import { useState } from "react";

// TRM 20.1.3 (open-drain SDA and SCL with pull-ups: wired-AND), 20.3.2
// (data changes only while SCL is low), 20.3.4 (START:
// SDA falls while SCL is high; STOP: SDA rises while SCL is high), 20.3.5.1
// (7-bit address, then R/W: 0 = write), 20.3.6 (the receiver acknowledges
// by pulling SDA low in the ninth clock; a master-receiver answers its last
// byte with a NACK). Devices as in this game's simulator: a temperature
// sensor at 0x48 and a clock chip at 0x68.

const CSS = `
.ib-res { fill: var(--surface); stroke: var(--text); stroke-width: 1.2; }
.ib-now { fill: var(--accent-soft); }
.ib-who { font-family: var(--mono); font-size: 8.5px; font-weight: 700; }
`;

const DEVS = [
  { name: "F28379D, the master", short: "the master" },
  { name: "sensor, address 0x48", short: "the sensor (0x48)" },
  { name: "clock chip, address 0x68", short: "the clock chip (0x68)" },
];
const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

interface Item {
  kind: "idle" | "start" | "bit" | "ack" | "stop" | "end";
  label: string;
  t0: number;
  t1: number;
  sda: 0 | 1;
  /** Who decides SDA in this slot: master, slave, or nobody. */
  who: "M" | "S" | "-";
  text: string;
}

function build(addr: number, read: boolean): { items: Item[]; groups: { t0: number; t1: number; label: string }[]; slave: number } {
  const slave = addr === 0x48 ? 1 : addr === 0x68 ? 2 : 0;
  const items: Item[] = [];
  const groups: { t0: number; t1: number; label: string }[] = [];
  let t = 0;
  const push = (kind: Item["kind"], label: string, len: number, sda: 0 | 1, who: Item["who"], text: string) => {
    items.push({ kind, label, t0: t, t1: t + len, sda, who, text });
    t += len;
  };
  push("idle", "", 1.5, 1, "-", "Idle: nobody pulls, so the two resistors hold SDA and SCL high. Any device may start now.");
  push("start", "S", 1.5, 0, "M", "START: the master pulls SDA low while SCL is still high. Data never changes while SCL is high, so every device recognises this as the start of a transfer and listens.");
  const g0 = t;
  for (let i = 6; i >= 0; i--) {
    const b = ((addr >> i) & 1) as 0 | 1;
    push("bit", String(b), 2, b, "M", `Address bit ${i} is ${b}: the master ${b ? "lets go of SDA and the resistor pulls it high" : "pulls SDA low"} while SCL is low, then raises SCL. Every device reads SDA while SCL is high.`);
  }
  groups.push({ t0: g0, t1: t, label: `address 0x${h2(addr)}` });
  groups.push({ t0: t, t1: t + 2, label: read ? "R" : "W" });
  push("bit", read ? "1" : "0", 2, read ? 1 : 0, "M", `R/W bit: ${read ? "1, the master wants to read. After the ACK the slave will drive SDA." : "0, the master wants to write. It keeps driving SDA after the ACK."} The byte on the bus is (0x${h2(addr)} << 1) | ${read ? 1 : 0} = 0x${h2(((addr << 1) | (read ? 1 : 0)) & 0xff)}.`);
  groups.push({ t0: t, t1: t + 2, label: slave ? "ACK" : "NACK" });
  if (!slave) {
    push("ack", "N", 2, 1, "-", `Ninth clock: the master lets go of SDA and listens. No device has address 0x${h2(addr)}, so nobody pulls: SDA stays high. That is a NACK. The I2C module sets I2CSTR.NACK and waits, holding SCL low.`);
  } else {
    push("ack", "A", 2, 0, "S", `Ninth clock: the master lets go of SDA and ${DEVS[slave].short} pulls it low: ACK, "I am here". Only a low line proves somebody answered.`);
    const data = read ? (slave === 1 ? 0x19 : 0x56) : 0x03;
    const d0 = t;
    for (let i = 7; i >= 0; i--) {
      const b = ((data >> i) & 1) as 0 | 1;
      push("bit", String(b), 2, b, read ? "S" : "M", read
        ? `Data bit ${i} is ${b}, sent by ${DEVS[slave].short}: it ${b ? "lets go of" : "pulls down"} SDA. The master still makes the clock, but only listens on SDA.`
        : `Data bit ${i} is ${b}, sent by the master: here the number of the register it wants to talk to.`);
    }
    groups.push({ t0: d0, t1: t, label: `data 0x${h2(data)}` });
    groups.push({ t0: t, t1: t + 2, label: read ? "NACK" : "ACK" });
    if (read) push("ack", "N", 2, 1, "M", "Ninth clock: now the master is the receiver, so the acknowledge is the master's. It leaves SDA high on purpose: a NACK after the last byte it wants tells the slave to stop sending.");
    else push("ack", "A", 2, 0, "S", `Ninth clock: ${DEVS[slave].short} was receiving, so it acknowledges the byte by pulling SDA low.`);
  }
  push("stop", "P", 3, 1, "M", `STOP: with SCL low the master pulls SDA low, raises SCL, then lets SDA rise while SCL is high. The bus is free again.${slave ? "" : " After a NACK your program must ask for this STOP itself (I2CMDR.bit.STP = 1), or the bus stays busy."}`);
  push("end", "", 1.5, 1, "-", "Idle again: both lines high, nobody pulling.");
  return { items, groups, slave };
}

/** The I2C bus: open-drain devices on two pulled-up lines, and one transfer step by step. */
function I2cBus() {
  const [mode, setMode] = useState<"hand" | "xfer">("hand");
  const [pull, setPull] = useState<boolean[][]>([[false, false], [false, false], [false, false]]);
  const [addr, setAddr] = useState(0x48);
  const [read, setRead] = useState(false);
  const [step, setStep] = useState(0);
  const { items, groups, slave } = build(addr, read);
  const s = Math.min(step, items.length - 1);
  const it = items[s];
  // Who pulls what at the moment shown.
  const pulls: boolean[][] = mode === "hand"
    ? pull
    : DEVS.map((_, d) => [
        (it.kind === "start" && d === 0) || ((it.kind === "bit" || it.kind === "ack") && it.sda === 0 && ((it.who === "M" && d === 0) || (it.who === "S" && d === slave))),
        false,
      ]);
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
  const sdaPts: [number, number][] = [];
  const sclPts: [number, number][] = [];
  for (const q of items) {
    if (q.kind === "start") sdaPts.push([q.t0 + 0.75, 0]);
    else if (q.kind === "bit" || q.kind === "ack") {
      sclPts.push([q.t0, 0], [q.t0 + 1, 1]);
      sdaPts.push([q.t0 + 0.3, q.sda]);
    } else if (q.kind === "stop") {
      sclPts.push([q.t0, 0], [q.t0 + 1, 1]);
      sdaPts.push([q.t0 + 0.3, 0], [q.t0 + 2, 1]);
    }
  }
  const trace = (pts: [number, number][], yHi: number) => {
    const y = (v: number) => yHi + (v ? 0 : 16);
    let d = `M${x(0)},${y(1)}`;
    let lv = 1;
    for (const [t, v] of pts) {
      if (t > tEnd) break;
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
            <text x={C[i]} y="117" textAnchor="middle" className="fig-label">{d.name}</text>
            {[0, 1].map((line) => {
              const sx = C[i] + (line ? 20 : -30);
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
        <svg viewBox="0 0 420 104" role="img" aria-label={`Waveforms of the transfer up to step ${s + 1} of ${items.length}.`}>
          <rect x={x(it.t0)} y="14" width={x(it.t1) - x(it.t0)} height="78" className="ib-now" />
          {groups.filter((g) => g.t0 < tEnd).map((g, i) => (
            <g key={i}>
              <path d={`M${x(g.t0) + 1.5},12 v-3 H${x(Math.min(g.t1, tEnd)) - 1.5}${g.t1 <= tEnd ? " v3" : ""}`} className="fig-wire" style={{ strokeWidth: 1 }} />
              <text x={(x(g.t0) + x(g.t1)) / 2} y="7" textAnchor="middle" className="fig-label">{g.t1 - g.t0 > 2 || g.label.length < 2 ? g.label : g.label === "ACK" ? "A" : "N"}</text>
            </g>
          ))}
          <text x="4" y="38" className="fig-label">SCL</text>
          <text x="4" y="66" className="fig-label">SDA</text>
          <text x="4" y="86" className="fig-label dim">sent by</text>
          <path d={trace(sclPts, 28)} className="fig-trace" />
          <path d={trace(sdaPts, 56)} className="fig-trace data" />
          {items.slice(0, s + 1).map((q, i) => (q.label ? (
            <g key={i}>
              <text x={q.kind === "bit" || q.kind === "ack" ? x(q.t0 + 1.5) : (x(q.t0) + x(q.t1)) / 2} y="23" textAnchor="middle" className="fig-value small">{q.label}</text>
              <text x={q.kind === "bit" || q.kind === "ack" ? x(q.t0 + 1.5) : (x(q.t0) + x(q.t1)) / 2} y="86" textAnchor="middle" className="ib-who" style={{ fill: whoColor(q.who) }}>{q.who === "S" ? "D" : q.who}</text>
            </g>
          ) : null))}
          <text x={X0} y="100" className="fig-label dim">M = the master sets SDA, D = the addressed device does, - = nobody pulls. S: START, P: STOP.</text>
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
              <button className="fig-opt" disabled={s === 0} onClick={() => setStep(s - 1)}>back</button>
              <button className="fig-opt" disabled={s === items.length - 1} onClick={() => setStep(s + 1)}>next step</button>
              <button className="fig-opt" disabled={s === items.length - 1} onClick={() => setStep(items.length - 1)}>whole transfer</button>
              <button className="fig-opt" disabled={s === 0} onClick={() => setStep(0)}>start again</button>
            </div>
            <div>
              <span>Address</span>
              <button className="fig-opt" aria-pressed={addr === 0x48} onClick={() => setAddr(0x48)}>0x48, the sensor</button>
              <button className="fig-opt" aria-pressed={addr === 0x68} onClick={() => setAddr(0x68)}>0x68, the clock chip</button>
              <button className="fig-opt" aria-pressed={addr === 0x49} onClick={() => { setAddr(0x49); setStep(Math.min(s, 10)); }}>0x49, nobody</button>
              <code>I2cbRegs.I2CSAR.all = 0x{h2(addr)};</code>
            </div>
            <div>
              <span>Direction</span>
              <button className="fig-opt" aria-pressed={!read} onClick={() => setRead(false)}>write</button>
              <button className="fig-opt" aria-pressed={read} onClick={() => setRead(true)}>read</button>
              <code>first byte on the bus = (0x{h2(addr)} &lt;&lt; 1) | {read ? 1 : 0} = 0x{h2(((addr << 1) | (read ? 1 : 0)) & 0xff)}</code>
            </div>
          </>
        )}
      </div>
      <figcaption>Every device connects to the same two lines and can only close a switch to ground or leave it open. Orange lines are high, blue lines low. In the step-through, the switches show who is pulling SDA at the moment each bit is read (SCL high); between bits the master pulls SCL low, and that is when SDA changes.</figcaption>
    </figure>
  );
}

export const figure = { id: "i2c-bus", Component: I2cBus };
