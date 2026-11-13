import { useState } from "react";

// MPU-9250 Register Map (RM-MPU-9250A-00 rev 1.4) and the course's SPI
// notes (HW3 exercises 4 and 5): the first byte of a transfer is the read
// bit (bit 7: 1 = read) plus the 7-bit register address; every following
// byte is data and the address counts up by itself (burst). With the
// course's 16-bit words (TRM 18.3.4, SPICHAR = 15) the first word is
// address byte + first data byte, every later word two data bytes.
// ACCEL_XOUT_H 0x3B .. GYRO_ZOUT_L 0x48, high byte first; WHO_AM_I 0x75
// reads 0x71.

const CSS = `
.iw-cell { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.iw-cell.rw { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.4; }
.iw-cell.addr { stroke: var(--info); stroke-width: 1.4; }
.iw-cell.data { stroke: var(--value); stroke-width: 1.4; }
.iw-bit { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--text); }
.iw-byte { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.iw-byte.use { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.3; }
.iw-byte.temp { stroke-dasharray: 3 2; }
.iw-byte.none { stroke-dasharray: 1 2; opacity: 0.7; }
.iw-hex { display: inline-flex; align-items: center; gap: 0.15rem; font-family: var(--mono); font-size: 0.85rem; }
.iw-hex input { width: 2.6em; padding: 0.1em 0.3em; }
`;

const NAMES: Record<number, string> = {
  0x19: "SMPLRT_DIV", 0x1a: "CONFIG", 0x1b: "GYRO_CONFIG", 0x1c: "ACCEL_CONFIG", 0x1d: "ACCEL_CONFIG2", 0x1e: "LP_ACCEL_ODR", 0x1f: "WOM_THR",
  0x3a: "INT_STATUS",
  0x3b: "accel X high", 0x3c: "accel X low", 0x3d: "accel Y high", 0x3e: "accel Y low", 0x3f: "accel Z high", 0x40: "accel Z low",
  0x41: "temp. high", 0x42: "temp. low",
  0x43: "gyro X high", 0x44: "gyro X low", 0x45: "gyro Y high", 0x46: "gyro Y low", 0x47: "gyro Z high", 0x48: "gyro Z low",
  0x6b: "PWR_MGMT_1", 0x75: "WHO_AM_I",
};
const REGS: [number, string][] = [
  [0x75, "0x75 WHO_AM_I"],
  [0x47, "0x47 gyro Z high"],
  [0x46, "0x46: one earlier"],
  [0x3b, "0x3B accel X high"],
  [0x3a, "0x3A: one earlier"],
  [0x1c, "0x1C ACCEL_CONFIG"],
];
const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");
const h4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");
const name = (a: number) => NAMES[a & 0x7f] ?? `register 0x${h2(a & 0x7f)}`;
/** A measurement's high byte sits at an odd address from 0x3B to 0x47. */
const isHigh = (a: number) => a >= 0x3b && a <= 0x47 && (a & 1) === 1;
const isTemp = (a: number) => a === 0x41 || a === 0x42;

/** Building MPU-9250 words: read bit, address, data, and what comes back in which word. */
function ImuWord() {
  const [read, setRead] = useState(true);
  const [reg, setReg] = useState(0x75);
  const [data, setData] = useState(0x08);
  const [txt, setTxt] = useState("08");
  const [words, setWords] = useState(1);
  const first = ((read ? 0x80 : 0) | reg) << 8 | (read ? 0 : data);
  const X0 = 62;
  const W = 21.5;
  // Word k (0-based) covers registers reg + 2k - 1 and reg + 2k (word 0: address byte, reg).
  const rows = Array.from({ length: words }, (_, k) => {
    const a = k === 0 ? null : reg + 2 * k - 1;
    const b = reg + 2 * k;
    const whole = a !== null && isHigh(a) && !isTemp(a);
    const split = a !== null && isHigh(b) && !isTemp(b);
    return { k, a, b, whole, split };
  });
  const lastReg = reg + 2 * (words - 1);
  const wholes = rows.filter((r) => r.whole);
  const splits = rows.filter((r) => r.split || (r.k === 0 && isHigh(reg) && !isTemp(reg)));
  const temps = rows.some((r) => (r.a !== null && isTemp(r.a)) || isTemp(r.b));
  const why = !read
    ? `Write: bit 15 is 0, then the address 0x${h2(reg)}, then the value. The MPU-9250 stores 0x${h2(data)} in ${name(reg)}${words > 1 ? ` and the following data bytes in the registers up to 0x${h2(lastReg)}, counting the address up by itself` : ""}. Words still come back while you send (they mean nothing): read them out of the FIFO and throw them away.`
    : words === 1
      ? `Read: bit 15 is 1. While the top byte goes out the device is still listening to the address, so the top byte of the reply means nothing. During the bottom byte it answers: the value of ${name(reg)} is the low byte of the SAME word${reg === 0x75 ? ", 0x0071" : ""}. Keep it with & 0x00FF.`
      : splits.length && !wholes.length
        ? `Each reading is split over two words here: its high byte is the low byte of one word and its low byte the high byte of the next. Start the read one register earlier and every reading fills exactly one word.`
        : wholes.length
          ? `Burst read of ${2 * words - 1} registers, 0x${h2(reg)} to 0x${h2(lastReg)}, in ${words} words. The first word is thrown away. ${wholes.length === 1 ? "The tinted word is" : "The tinted words are"} one complete signed 16-bit reading each, high byte on top.${temps ? " The temperature sits between accelerometer and gyro: its word must be skipped when you index the results." : ""}`
          : `Burst read: after the address byte the master keeps clocking zeros and the device answers with the registers 0x${h2(reg)} to 0x${h2(lastReg)}, counting the address up by itself.`;
  const byteBox = (x: number, y: number, a: number | null, tint: boolean) => (
    <g>
      <rect x={x} y={y} width={126} height={15} rx="2" className={`iw-byte ${a === null ? "none" : tint ? "use" : isTemp(a) ? "temp" : ""}`} />
      <text x={x + 4} y={y + 10.5} className={`fig-label ${a === null || (read && isTemp(a)) ? "dim" : ""}`}>
        {a === null ? (read ? "nothing (address phase)" : "address byte") : `0x${h2(a & 0x7f)} ${name(a)}`}
      </text>
    </g>
  );
  const RY = 86;
  return (
    <figure className="figure" aria-label="Interactive builder for MPU-9250 SPI words">
      <style>{CSS}</style>
      <svg viewBox={`0 0 420 ${RY + 14 + words * 18 + 4}`} role="img" aria-label={`${read ? "Read" : "Write"} register 0x${h2(reg)}: the first word is 0x${h4(first)}, ${words} word${words > 1 ? "s" : ""} in the transfer.`}>
        <text x={4} y={25} className="fig-label">first word</text>
        <text x={4} y={38} className="fig-value">0x{h4(first)}</text>
        {Array.from({ length: 16 }, (_, i) => (
          <g key={i}>
            <rect x={X0 + i * W} y={14} width={W - 1.5} height={18} rx="2" className={`iw-cell ${i === 0 ? "rw" : i < 8 ? "addr" : "data"}`} />
            <text x={X0 + i * W + (W - 1.5) / 2} y={27} textAnchor="middle" className="iw-bit">{(first >> (15 - i)) & 1}</text>
          </g>
        ))}
        <text x={X0} y={10} className="fig-label dim">bit 15</text>
        <text x={X0 + 16 * W - 1.5} y={10} textAnchor="end" className="fig-label dim">bit 0</text>
        <path d={`M${X0 + 1},35 v4 h${W - 3.5} v-4`} className="fig-wire" style={{ stroke: "var(--accent)" }} />
        <path d={`M${X0 + W + 1},35 v4 h${7 * W - 3.5} v-4`} className="fig-wire" style={{ stroke: "var(--info)" }} />
        <path d={`M${X0 + 8 * W + 1},35 v4 h${8 * W - 3.5} v-4`} className="fig-wire" style={{ stroke: "var(--value)" }} />
        <text x={X0} y={50} className="fig-label">{read ? "1 = read" : "0 = write"}</text>
        <text x={X0 + 4.5 * W} y={50} textAnchor="middle" className="fig-label">address 0x{h2(reg)}</text>
        <text x={X0 + 12 * W} y={50} textAnchor="middle" className="fig-label">{read ? "zeros: the reply arrives during these 8 clocks" : `value 0x${h2(data)}`}</text>
        <text x={X0 + 4.5 * W} y={61} textAnchor="middle" className="fig-label dim">{name(reg)}</text>
        {/* the transfer, word by word */}
        <text x={4} y={RY + 8} className="fig-label dim">word</text>
        <text x={34} y={RY + 8} className="fig-label dim">you send</text>
        <text x={86} y={RY + 8} className="fig-label dim">{read ? "reply, high byte" : "high byte goes to"}</text>
        <text x={216} y={RY + 8} className="fig-label dim">{read ? "reply, low byte" : "low byte goes to"}</text>
        {rows.map((r) => {
          const y = RY + 14 + r.k * 18;
          return (
            <g key={r.k}>
              <text x={10} y={y + 10.5} className="fig-label">{r.k + 1}</text>
              <text x={34} y={y + 10.5} className="fig-value small">0x{h4(r.k === 0 ? first : 0)}</text>
              {byteBox(86, y, r.a, read && r.whole)}
              {byteBox(216, y, r.b, read && (r.whole || (r.k === 0 && words === 1)))}
              {read && r.whole && <text x={348} y={y + 10.5} className="fig-label" style={{ fill: "var(--accent)" }}>= {name(r.a!).replace(" high", "")}</text>}
              {read && r.a !== null && isTemp(r.a) && isTemp(r.b) && <text x={348} y={y + 10.5} className="fig-label dim">skip this word</text>}
              {read && r.k === 0 && words > 1 && <text x={348} y={y + 10.5} className="fig-label dim">throw away</text>}
              {read && r.k === 0 && words === 1 && <text x={348} y={y + 10.5} className="fig-label" style={{ fill: "var(--accent)" }}>& 0x00FF</text>}
            </g>
          );
        })}
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Direction</span>
          <button className="fig-opt" aria-pressed={read} onClick={() => setRead(true)}>read</button>
          <button className="fig-opt" aria-pressed={!read} onClick={() => setRead(false)}>write</button>
          {!read && (
            <span className="iw-hex">
              value 0x
              <input
                value={parseInt(txt || "0", 16) === data ? txt : h2(data)}
                aria-label="Value to write, hexadecimal"
                onChange={(e) => {
                  const t = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2).toUpperCase();
                  setTxt(t);
                  setData(parseInt(t || "0", 16));
                }}
              />
            </span>
          )}
        </div>
        <div>
          <span>Register</span>
          {REGS.map(([a, label]) => (
            <button key={a} className="fig-opt" aria-pressed={reg === a} onClick={() => setReg(a)}>{label}</button>
          ))}
        </div>
        <div>
          <span>Words</span>
          <input type="range" min={1} max={8} value={words} aria-label="Number of 16-bit words in the transfer" onChange={(e) => setWords(+e.target.value)} />
          <button className="fig-opt" aria-pressed={reg === 0x46 && words === 2 && read} onClick={() => { setRead(true); setReg(0x46); setWords(2); }}>gyro Z read</button>
          <button className="fig-opt" aria-pressed={reg === 0x3a && words === 8 && read} onClick={() => { setRead(true); setReg(0x3a); setWords(8); }}>the course's full read</button>
        </div>
        <div>
          <span>In C</span>
          <code>
            SpibRegs.SPITXBUF = {read ? `(0x8000 | 0x${h4(reg << 8)})` : `0x${h4(first)}`};{words > 1 ? `  // then ${words - 1} x SPITXBUF = 0x0000;  RXFFIL = ${words}` : "  // RXFFIL = 1"}
          </code>
        </div>
      </div>
      <figcaption>One transfer to the MPU-9250, chip select low throughout. The first byte says read or write and where; every later byte is the next register. The answer to a read is already in the low byte of the first word, and a burst keeps going from there.</figcaption>
    </figure>
  );
}

export const figure = { id: "imu-word", Component: ImuWord };
