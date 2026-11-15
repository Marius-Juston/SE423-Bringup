// The MPU-9250 breakout of homework 3 on its ten-pin socket. The chip
// itself is simulated by src/sim/plugins/spi_devices.ts and answers on SPIB
// with GPIO66 as its chip select. The bench adds what the board can get
// wrong: the breakout not plugged in, or one of the four jumpers that take
// SPIB's pins to the socket missing.
// With such a fault the chip is taken off the bus (the input MPU_ABSENT of
// plugins/spi_devices.ts): it hears nothing and answers nothing, so every
// word the program reads is all 1s, and the bench reports the cause on the
// line that selects the chip.
// Simplification: every fault gives all 1s. On the real board a missing
// MOSI or SCLK jumper alone can also leave the chip sending zeros.
import { fitted } from "../bench";
import type { BenchView, Inst, PartDef } from "../types";
import { empty, rect, text } from "./_draw";

/** "" when SPIB reaches the chip, else what is missing. */
function broken(i: Inst, b: BenchView): string {
  if (!fitted(i)) return `${i.label} is not plugged into its socket.`;
  const off = b.all().filter((j) => j.kind === "imu-jumper" && (!fitted(j) || j.opts.pos !== "on"));
  return off.length ? `${off.map((j) => j.label).join(" and ")} ${off.length > 1 ? "are" : "is"} missing, so ${off.map((j) => j.conn.a).join(" and ")} ${off.length > 1 ? "do" : "does"} not reach the IMU.` : "";
}

export const part: PartDef = {
  kind: "imu",
  name: "MPU-9250 IMU",
  description: "The accelerometer and gyro board that answers on SPIB.",
  terminals: [
    { id: "ncs", name: "chip select (NCS)", role: "in" },
    { id: "sclk", name: "clock (SCLK)", role: "in" },
    { id: "mosi", name: "data in (MOSI)", role: "in" },
    { id: "miso", name: "data out (MISO)", role: "out" },
  ],
  onBoard: () => ({ ncs: "GPIO66", sclk: "GPIO65", mosi: "GPIO63", miso: "GPIO64" }),
  works: (i, b) => broken(i, b) === "",
  edge(i, r, t, level) {
    if (t !== i.conn.ncs || level !== 0) return;
    const why = broken(i, r);
    if (why) r.warn(i, "imu-unreachable", `${t} went low to talk to the IMU, and the IMU cannot answer: ${why} Every word read is all 1s (0xFFFF). Fix the board (Wiring bench).`, "error");
  },
  status(i, b) {
    const why = broken(i, b);
    return why ? { text: "cannot be reached", level: 0, why } : { text: "connected to SPIB", level: 1 };
  },
  draw(i, _s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    return [rect(x, y, w, h, "part"), text(x + w / 2, y + h / 2, "IMU", 2.2)];
  },
};

/** Also checked on the jumper parts: a jumper that is not on reports through the IMU. */
export const imuBroken = broken;
