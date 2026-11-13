import { useState } from "react";

// The data frame of the CAN protocol (ISO 11898-1, which TRM 22.1.2
// refers to): start of frame, arbitration field, control field with DLC,
// data field, CRC, ACK, end of frame; 29-bit identifiers in extended
// frames (TRM 22.14.1: Xtd, ID[28:0], DLC, Data 0-7 of a message object).
// An extended frame with 8 data bytes is 1 + 32 + 6 + 64 + 16 + 2 + 7 = 128
// bits before stuffing. The frame filled in is the
// "measured distance" message of the course's SEN-36005 sensors (final
// project starter): identifier 0x060B01ss, 8 data bytes, bytes 0-1 the
// distance in mm, least significant byte first: 256 * raw[1] + raw[0].

const CSS = `
.cf-field { fill: var(--surface); stroke: var(--border-strong); stroke-width: 1; cursor: pointer; }
.cf-field.sel { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; }
.cf-byte { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.cf-byte.dist { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.6; }
.cf-mono { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--value); }
`;

const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

interface Field {
  id: string;
  name: string;
  bits: number;
  w: number;
  text: (c: { id: string; dist: number }) => string;
}
const FIELDS: Field[] = [
  { id: "sof", name: "start", bits: 1, w: 34, text: () => "Start of frame: one dominant (0) bit. The idle bus is recessive (1), so this falling edge tells every node that a frame begins, and all of them line up their bit timing on it." },
  { id: "id", name: "identifier", bits: 32, w: 96, text: (c) => `Identifier ${c.id}: what the message IS, not who it is for. Sent most significant bit first, it also decides who wins when two nodes start together (the lower identifier). 29 identifier bits in an extended frame, plus 3 housekeeping bits that say "extended" and "data frame".` },
  { id: "ctl", name: "control", bits: 6, w: 50, text: () => "Control field: 6 bits. The last four are the DLC, the data length code: 8 here, so 8 data bytes follow. A frame can carry 0 to 8 bytes." },
  { id: "data", name: "data", bits: 64, w: 112, text: (c) => `Data field: the 8 bytes below, byte 0 first. What they mean is up to the sender's documentation. For this sensor bytes 0 and 1 are the distance, ${c.dist} mm, least significant byte first.` },
  { id: "crc", name: "CRC", bits: 16, w: 46, text: () => "CRC: a 15-bit checksum over everything before it, plus one recessive delimiter bit. Every receiver computes the same checksum and compares. A frame damaged by noise is rejected by all of them, and the sender repeats it." },
  { id: "ack", name: "ACK", bits: 2, w: 36, text: () => "ACK slot: the sender lets go of the bus, and every node that received the frame correctly pulls it dominant. One bit is enough for the sender to know somebody heard it. If nobody does, it sends the frame again." },
  { id: "eof", name: "end", bits: 7, w: 38, text: () => "End of frame: seven recessive bits. After a short gap the bus is idle and any node may start the next frame." },
];

/** A CAN data frame, field by field, carrying the course's distance message. */
function CanFrame() {
  const [sel, setSel] = useState("data");
  const [dist, setDist] = useState(1234);
  const [sensor, setSensor] = useState(1);
  const id = `0x060B010${sensor}`;
  const bytes = [dist & 0xff, dist >> 8, 0x00, 0x00, 0x00, 0x80, 0x02, 0x00];
  const swapped = 256 * bytes[0] + bytes[1];
  const f = FIELDS.find((q) => q.id === sel)!;
  let fx = 4;
  const BX = 56;
  const BW = 44;
  return (
    <figure className="figure" aria-label="Interactive diagram of a CAN data frame carrying a distance measurement">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 170" role="img" aria-label={`CAN frame with identifier ${id} and 8 data bytes. Bytes 0 and 1 are ${h2(bytes[0])} and ${h2(bytes[1])} hexadecimal: ${dist} millimetres.`}>
        <text x={4} y={10} className="fig-label dim">sent first</text>
        <text x={416} y={10} textAnchor="end" className="fig-label dim">128 bits in all (plus stuff bits)</text>
        {FIELDS.map((q) => {
          const x0 = fx;
          fx += q.w;
          return (
            <g key={q.id} onClick={() => setSel(q.id)}>
              <rect x={x0} y={15} width={q.w - 2} height={36} rx="3" className={`cf-field ${sel === q.id ? "sel" : ""}`} />
              <text x={x0 + (q.w - 2) / 2} y={29} textAnchor="middle" className="fig-label">{q.name}</text>
              <text x={x0 + (q.w - 2) / 2} y={44} textAnchor="middle" className={q.id === "id" || q.id === "ctl" ? "fig-value small" : "fig-label dim"}>
                {q.id === "id" ? id : q.id === "ctl" ? "DLC = 8" : q.id === "data" ? "8 bytes" : `${q.bits} bit${q.bits > 1 ? "s" : ""}`}
              </text>
            </g>
          );
        })}
        {/* the data field, opened up */}
        <path d={`M${4 + 34 + 96 + 50},51 L${BX},74 M${4 + 34 + 96 + 50 + 110},51 L${BX + 8 * BW - 2},74`} className="fig-wire" style={{ strokeDasharray: "3 2", strokeWidth: 1 }} />
        <text x={4} y={88} className="fig-label">data</text>
        <text x={4} y={99} className="fig-label dim">byte</text>
        {bytes.map((v, i) => (
          <g key={i}>
            <rect x={BX + i * BW} y={74} width={BW - 2} height={20} rx="2" className={`cf-byte ${i < 2 ? "dist" : ""}`} />
            <text x={BX + i * BW + (BW - 2) / 2} y={88} textAnchor="middle" className="cf-mono">0x{h2(v)}</text>
            <text x={BX + i * BW + (BW - 2) / 2} y={104} textAnchor="middle" className="fig-label dim">{i}</text>
          </g>
        ))}
        <path d={`M${BX + 1},108 v4 h${2 * BW - 4} v-4`} className="fig-wire" style={{ stroke: "var(--accent)" }} />
        <text x={BX} y={122} className="fig-label">distance: low byte, then high byte</text>
        <path d={`M${BX + 2 * BW + 1},108 v4 h${BW - 4} v-4`} className="fig-wire" />
        <text x={BX + 2.5 * BW} y={133} textAnchor="middle" className="fig-label dim">status: 0 = valid</text>
        <path d={`M${BX + 4 * BW + 1},108 v4 h${4 * BW - 4} v-4`} className="fig-wire" />
        <text x={BX + 6 * BW} y={122} textAnchor="middle" className="fig-label dim">signal strength (32 bits)</text>
        <text x={4} y={150} className="fig-value small">dis_{sensor} = 256 * dis_raw_{sensor}[1] + dis_raw_{sensor}[0];  // 256 * {bytes[1]} + {bytes[0]} = {dist} mm</text>
        <text x={4} y={164} className="fig-label" style={{ fill: "var(--bad)" }}>bytes the wrong way round: 256 * {bytes[0]} + {bytes[1]} = {swapped} mm</text>
      </svg>
      <p className="fig-why" role="status">{f.text({ id, dist })}</p>
      <div className="fig-controls">
        <div>
          <span>Field</span>
          {FIELDS.map((q) => (
            <button key={q.id} className="fig-opt" aria-pressed={sel === q.id} onClick={() => setSel(q.id)}>{q.name}</button>
          ))}
        </div>
        <div>
          <span>Distance</span>
          <input type="range" min={0} max={4000} step={1} value={dist} aria-label="Distance the sensor measures, millimetres" onChange={(e) => setDist(+e.target.value)} />
          <code>{dist} mm = 0x{h2(bytes[1])}{h2(bytes[0])}</code>
          <button className="fig-opt" onClick={() => setDist(255)}>255</button>
          <button className="fig-opt" onClick={() => setDist(256)}>256</button>
        </div>
        <div>
          <span>Sender</span>
          <button className="fig-opt" aria-pressed={sensor === 1} onClick={() => setSensor(1)}>sensor 1</button>
          <button className="fig-opt" aria-pressed={sensor === 2} onClick={() => setSensor(2)}>sensor 2</button>
          <code>identifier 0x060B01ss, ss = {sensor}</code>
        </div>
      </div>
      <figcaption>One CAN data frame in the order it is sent (field widths are not to scale). Choose a field to see what it is for. Move the distance through 255 to 256 mm and watch byte 0 wrap to 0x00 while byte 1 becomes 0x01: the low byte comes first.</figcaption>
    </figure>
  );
}

export const figure = { id: "can-frame", Component: CanFrame };
