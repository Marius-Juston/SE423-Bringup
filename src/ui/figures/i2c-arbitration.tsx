import { useState } from "react";

// Arbitration on a wired-AND bus. I2C: TRM 20.3.8 "Arbitration" (two
// master-transmitters; the one that sends a high bit while the other sends
// a low bit loses, switches to slave mode and sets ARBL). CAN: the TRM
// (22.1.2) defers to the CAN protocol, ISO 11898-1: a dominant 0
// overwrites a recessive 1; arbitration is bitwise on the identifier, most
// significant bit first, so the lowest identifier wins (TRM 22.4.2 on
// message priority).

const CSS = `
.ia-hex { display: inline-flex; align-items: center; gap: 0.15rem; font-family: var(--mono); font-size: 0.85rem; }
.ia-hex input { width: 3.4em; padding: 0.1em 0.3em; }
.ia-lbl { color: var(--dim); font-size: 0.82rem; }
.ia-now { fill: var(--accent-soft); }
.ia-lost { stroke: var(--bad); stroke-width: 1.6; fill: none; }
`;

const hx = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, "0");

function HexIn({ label, value, digits, max, set }: { label: string; value: number; digits: number; max: number; set: (v: number) => void }) {
  const [txt, setTxt] = useState(hx(value, digits));
  const shown = parseInt(txt || "0", 16) === value ? txt : hx(value, digits);
  return (
    <span className="ia-hex">
      0x
      <input
        value={shown}
        aria-label={label}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, digits).toUpperCase();
          setTxt(t);
          set(Math.min(max, parseInt(t || "0", 16)));
        }}
      />
    </span>
  );
}

/** Two senders start together: the one that sends 1 and reads 0 backs off. */
function I2cArbitration() {
  const [can, setCan] = useState(false);
  const [a, setA] = useState(0x48);
  const [b, setB] = useState(0x68);
  const [step, setStep] = useState(0);
  const n = can ? 11 : 7;
  const max = (1 << n) - 1;
  const A = a & max;
  const B = b & max;
  const bitOf = (v: number, i: number) => (v >> (n - 1 - i)) & 1;
  let lostAt = -1;
  for (let i = 0; i < n; i++)
    if (bitOf(A, i) !== bitOf(B, i)) {
      lostAt = i;
      break;
    }
  const loser = lostAt < 0 ? null : bitOf(A, lostAt) === 1 ? "A" : "B";
  const s = Math.min(step, n);
  const names = can ? ["node A", "node B"] : ["master A", "master B"];
  const word = can ? "identifier" : "address";
  const one = can ? "recessive (1)" : "1 (lets go)";
  const zero = can ? "dominant (0)" : "0 (pulls low)";
  const X0 = 78;
  const CW = (420 - X0 - 8) / n;
  const x = (i: number) => X0 + i * CW;
  const rowY = [30, 70, 110];
  /** Trace of a sender for the bits shown so far; after losing it lets go (level 1, dashed). */
  const trace = (v: number, y: number, who: "A" | "B" | "bus") => {
    const out: JSX.Element[] = [];
    let d = "";
    let prev = 1;
    const upto = who !== "bus" && loser === who ? Math.min(s, lostAt + 1) : s;
    for (let i = 0; i < upto; i++) {
      const lv = who === "bus" ? bitOf(A, i) & bitOf(B, i) : bitOf(v, i);
      const yy = y + (lv ? 0 : 18);
      d += i === 0 ? `M${x(0)},${yy}` : lv !== prev ? ` V${yy}` : "";
      d += ` H${x(i + 1)}`;
      prev = lv;
      out.push(<text key={i} x={x(i) + CW / 2} y={y + 13} textAnchor="middle" className="fig-value small">{lv}</text>);
    }
    return (
      <g>
        {d && <path d={d} className={`fig-trace ${who === "bus" ? "data" : ""}`} />}
        {out}
        {who !== "bus" && loser === who && s > lostAt + 1 && (
          <>
            <path d={`M${x(lostAt + 1)},${y} H${x(s)}`} className="fig-trace dim" strokeDasharray="3 3" />
            <text x={(x(lostAt + 1) + x(Math.max(s, lostAt + 2))) / 2} y={y + 14} textAnchor="middle" className="fig-label dim">{CW * (s - lostAt - 1) > 60 ? "stopped, listening" : ""}</text>
          </>
        )}
      </g>
    );
  };
  const cur = s - 1;
  const why = s === 0
    ? `Both ${can ? "nodes" : "masters"} find the bus idle and start in the same instant. Each sends its ${word}, top bit first, and reads the bus back after every bit. Press "next bit".`
    : lostAt < 0
      ? s < n
        ? `Bit ${n - 1 - cur}: both send ${bitOf(A, cur)}, the bus shows ${bitOf(A, cur)}, and neither notices the other.`
        : `The two ${word}s are identical, so neither sender ever saw a difference. ${can ? "Two nodes must never send the same identifier: the collision would only show up later, in the data." : "Both masters are talking to the same device; arbitration simply continues into the data bytes."}`
      : cur < lostAt
        ? `Bit ${n - 1 - cur}: both send ${bitOf(A, cur)}. The bus shows what each sent, so neither notices the other yet.`
        : cur === lostAt
          ? `Bit ${n - 1 - cur}: ${names[loser === "A" ? 0 : 1]} sends ${one}, ${names[loser === "A" ? 1 : 0]} sends ${zero}. A 0 from anyone wins, so the bus reads 0. ${names[loser === "A" ? 0 : 1]} sent 1 but reads 0: someone else is on the bus. It has lost, stops at once and ${can ? "becomes a receiver; it will try again after this frame" : "tries again later"}.`
          : `${names[loser === "A" ? 1 : 0]} carries on alone and never noticed anything: its bits were on the bus undamaged all along. ${s === n ? `The winner is the lower ${word}, 0x${hx(Math.min(A, B), can ? 3 : 2)}: the first bit that differs is a 0 in the smaller number.${can ? " On CAN the identifier is therefore also the priority of the message." : ""}` : ""}`;
  return (
    <figure className="figure" aria-label="Interactive diagram of bus arbitration on I2C and CAN">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 146" role="img" aria-label={`${names[0]} sends 0x${hx(A, can ? 3 : 2)}, ${names[1]} sends 0x${hx(B, can ? 3 : 2)}. ${s} of ${n} bits shown. ${loser && s > lostAt ? `${names[loser === "A" ? 0 : 1]} lost at bit ${n - 1 - lostAt}.` : "No one has lost yet."}`}>
        {cur >= 0 && <rect x={x(cur)} y={14} width={CW} height={122} className="ia-now" />}
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={x(i) + CW / 2} y={10} textAnchor="middle" className="fig-label dim">{i === 0 ? `bit ${n - 1}` : n - 1 - i}</text>
        ))}
        <text x={4} y={rowY[0] + 8} className="fig-label">{names[0]} sends</text>
        <text x={4} y={rowY[0] + 20} className="fig-value small">0x{hx(A, can ? 3 : 2)}</text>
        <text x={4} y={rowY[1] + 8} className="fig-label">{names[1]} sends</text>
        <text x={4} y={rowY[1] + 20} className="fig-value small">0x{hx(B, can ? 3 : 2)}</text>
        <text x={4} y={rowY[2] + 8} className="fig-label">the bus: 0 if</text>
        <text x={4} y={rowY[2] + 19} className="fig-label">anyone sends 0</text>
        {trace(A, rowY[0], "A")}
        {trace(B, rowY[1], "B")}
        {trace(0, rowY[2], "bus")}
        {loser && s > lostAt && (
          <g>
            <circle cx={x(lostAt) + CW / 2} cy={rowY[loser === "A" ? 0 : 1] + 9.5} r={9} className="ia-lost" />
            <text x={x(lostAt) + CW / 2} y={rowY[loser === "A" ? 0 : 1] + 32} textAnchor="middle" className="fig-label" style={{ fill: "var(--bad)" }}>sent 1, read 0: lost</text>
          </g>
        )}
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Step</span>
          <button className="fig-opt" disabled={s >= n} onClick={() => setStep(s + 1)}>next bit</button>
          <button className="fig-opt" disabled={s >= n} onClick={() => setStep(n)}>all bits</button>
          <button className="fig-opt" disabled={s === 0} onClick={() => setStep(0)}>start again</button>
        </div>
        <div>
          <span>Bus</span>
          <button className="fig-opt" aria-pressed={!can} onClick={() => { setCan(false); setA(0x48); setB(0x68); setStep(0); }}>I2C: 7-bit addresses</button>
          <button className="fig-opt" aria-pressed={can} onClick={() => { setCan(true); setA(0x65a); setB(0x653); setStep(0); }}>CAN: 11-bit identifiers</button>
        </div>
        <div>
          <span>Senders</span>
          <span className="ia-lbl">A sends</span>
          <HexIn key={`a${can}`} label={`${names[0]}'s ${word}, hexadecimal`} value={A} digits={can ? 3 : 2} max={max} set={(v) => { setA(v); setStep(0); }} />
          <span className="ia-lbl">B sends</span>
          <HexIn key={`b${can}`} label={`${names[1]}'s ${word}, hexadecimal`} value={B} digits={can ? 3 : 2} max={max} set={(v) => { setB(v); setStep(0); }} />
          <button className="fig-opt" onClick={() => { setA(B); setB(A); setStep(0); }}>swap them</button>
        </div>
      </div>
      <figcaption>A sender can only pull the bus to 0 or let go, so the bus is the AND of what everyone sends. Each sender compares what it sent with what it reads. The first one to send 1 and read 0 gives way, and the other's message goes through untouched: no collision, no lost time. The lower number always wins.</figcaption>
    </figure>
  );
}

export const figure = { id: "i2c-arbitration", Component: I2cArbitration };
