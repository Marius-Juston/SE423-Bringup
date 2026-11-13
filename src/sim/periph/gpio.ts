// General-purpose I/O. TRM chapter 8 "General-Purpose Input/Output (GPIO)".
// Each pin has a mux (GPxGMUX:GPxMUX), a direction bit, a pull-up disable
// bit (GPxPUD, 1 = disabled, the reset state), and an output latch written
// through GPxDAT / GPxSET / GPxCLEAR / GPxTOGGLE.

import type { Board } from "../board";

export const PORTS = ["A", "B", "C", "D", "E", "F"] as const;
export const PIN_COUNT = 169;

export type Level = 0 | 1;

export interface PinChange {
  t: number;
  level: Level;
}

/** What an external part does to a pin: drive it, or leave it alone. */
export type Drive = Level | null;

export class Gpio {
  /** Output latch per port. */
  private latch = [0, 0, 0, 0, 0, 0];
  /** External drive per pin (buttons, sensors). */
  private ext: Drive[] = new Array(PIN_COUNT).fill(null);
  /** Level driven by a peripheral when the pin is muxed to it. */
  private periphOut: Drive[] = new Array(PIN_COUNT).fill(null);
  /** Resolved level per pin; -1 = floating. */
  level: Int8Array = new Int8Array(PIN_COUNT).fill(-1);
  /** Level history of every pin that ever changed. */
  trace = new Map<number, PinChange[]>();
  listeners: ((pin: number, level: Level, t: number) => void)[] = [];
  /** Pins written through GPxDAT (the labs ask for SET/CLEAR/TOGGLE instead). */
  datWrites = new Set<string>();
  private rnd = 0x2f6e2b1;

  constructor(private b: Board) {
    const dev = b.dev;
    PORTS.forEach((p, i) => {
      // Reset state: every pin is a GPIO input with its pull-up disabled.
      dev.set(`GpioCtrlRegs.GP${p}PUD`, 0xffffffff);
      const refresh = () => this.refreshPort(i, b.now);
      for (const r of ["PUD", "DIR", "MUX1", "MUX2", "GMUX1", "GMUX2", "ODR", "INV"]) {
        // Port F stops at GPIO168, so it has no MUX2 / GMUX2.
        const reg = dev.regs.get(`GpioCtrlRegs.GP${p}${r}`);
        if (reg) reg.hook.after = refresh;
      }
      const dat = dev.reg(`GpioDataRegs.GP${p}DAT`).hook;
      dat.read = () => this.readPort(i);
      dat.after = (v) => {
        this.latch[i] = v;
        if (!b.libDepth) this.datWrites.add(`GP${p}DAT`);
        refresh();
      };
      // SET / CLEAR / TOGGLE act on the bits written as 1 and always read 0.
      const op = (name: string, f: (latch: number, v: number) => number) => {
        const h = dev.reg(`GpioDataRegs.GP${p}${name}`).hook;
        h.write = () => 0;
        h.after = (v) => {
          this.latch[i] = f(this.latch[i], v) >>> 0;
          refresh();
        };
      };
      op("SET", (l, v) => l | v);
      op("CLEAR", (l, v) => l & ~v);
      op("TOGGLE", (l, v) => l ^ v);
    });
  }

  private bit(reg: string, port: number, n: number): number {
    return (this.b.dev.get(`GpioCtrlRegs.GP${PORTS[port]}${reg}`) >>> n) & 1;
  }

  /** Mux position 0..15 of a pin (GMUX in the upper two bits). */
  mux(pin: number): number {
    const port = pin >> 5;
    const n = pin & 31;
    const half = n < 16 ? "1" : "2";
    const sh = (n & 15) * 2;
    const dev = this.b.dev;
    if (!dev.regs.has(`GpioCtrlRegs.GP${PORTS[port]}MUX${half}`)) return 0;
    const m = (dev.get(`GpioCtrlRegs.GP${PORTS[port]}MUX${half}`) >>> sh) & 3;
    const g = (dev.get(`GpioCtrlRegs.GP${PORTS[port]}GMUX${half}`) >>> sh) & 3;
    return (g << 2) | m;
  }

  isOutput(pin: number): boolean {
    return this.bit("DIR", pin >> 5, pin & 31) === 1;
  }

  pullUpEnabled(pin: number): boolean {
    return this.bit("PUD", pin >> 5, pin & 31) === 0;
  }

  /** Level on the pin: 0, 1, or -1 when nothing defines it. */
  private resolve(pin: number): number {
    const port = pin >> 5;
    const n = pin & 31;
    const ext = this.ext[pin];
    let out: Drive = null;
    if (this.mux(pin) === 0) {
      if (this.isOutput(pin)) {
        const l = ((this.latch[port] >>> n) & 1) as Level;
        // Open-drain outputs only pull low.
        out = this.bit("ODR", port, n) && l === 1 ? null : l;
      }
    } else out = this.periphOut[pin];
    if (out !== null) {
      if (ext !== null && ext !== out)
        this.b.warn(this.b.line, `short-${pin}`, `GPIO${pin} is an output driving ${out ? "high" : "low"} while the circuit outside drives it ${ext ? "high" : "low"}: that is a short circuit. A pin connected to a button or sensor must be an input.`, "error");
      return out;
    }
    if (ext !== null) return ext;
    return this.pullUpEnabled(pin) ? 1 : -1;
  }

  private refreshPort(port: number, t: number): void {
    const last = Math.min(PIN_COUNT, port * 32 + 32);
    for (let pin = port * 32; pin < last; pin++) this.refresh(pin, t);
  }

  refresh(pin: number, t: number): void {
    const lv = this.resolve(pin);
    if (lv === this.level[pin]) return;
    this.level[pin] = lv;
    this.b.mem.writes++;
    if (lv < 0) return;
    let tr = this.trace.get(pin);
    if (!tr) this.trace.set(pin, (tr = []));
    tr.push({ t, level: lv as Level });
    for (const l of this.listeners) l(pin, lv as Level, t);
  }

  /** What GPxDAT reads: the pin levels (inverted where GPxINV is set). */
  private readPort(port: number): number {
    let v = 0;
    const inv = this.b.dev.get(`GpioCtrlRegs.GP${PORTS[port]}INV`);
    const last = Math.min(PIN_COUNT, port * 32 + 32);
    for (let pin = port * 32; pin < last; pin++) {
      let lv = this.level[pin];
      if (lv < 0) {
        // A floating input picks up noise: the value read is unpredictable.
        this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0;
        lv = (this.rnd >>> 16) & 1;
        this.floatingRead.add(pin);
        this.b.mem.liveReads++;
      }
      v |= lv << (pin & 31);
    }
    return (v ^ inv) >>> 0;
  }
  /** Floating pins that were part of a GPxDAT read. */
  floatingRead = new Set<number>();

  /** An external part drives the pin (or releases it with null). */
  drive(pin: number, d: Drive, t = this.b.now): void {
    this.ext[pin] = d;
    this.refresh(pin, t);
  }

  /** A peripheral drives its output signal on the pin. */
  drivePeripheral(pin: number, d: Drive, t = this.b.now): void {
    this.periphOut[pin] = d;
    if (this.mux(pin) !== 0) this.refresh(pin, t);
  }

  /** Level at a past time from the trace (-1 before the first change). */
  levelAt(pin: number, t: number): number {
    const tr = this.trace.get(pin);
    if (!tr) return this.level[pin];
    let lv = -1;
    for (const c of tr) {
      if (c.t > t) break;
      lv = c.level;
    }
    return lv;
  }
}
