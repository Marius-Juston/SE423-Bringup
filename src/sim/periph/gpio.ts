// General-purpose I/O. TRM chapter 8 "General-Purpose Input/Output (GPIO)".
// Each pin has a mux (GPxGMUX:GPxMUX), a direction bit, a pull-up disable
// bit (GPxPUD, 1 = disabled, the reset state), and an output latch written
// through GPxDAT / GPxSET / GPxCLEAR / GPxTOGGLE.

import type { Board } from "../board";

export const PORTS = ["A", "B", "C", "D", "E", "F"] as const;
export const PIN_COUNT = 169;

export type Level = 0 | 1;

/**
 * How long GPyDAT keeps showing a pin's previous level after its latch
 * changes: long enough that the very next C statement still reads the old
 * value (the hazard TRM section 8.3 describes), short enough that any later
 * statement reads the new one.
 */
const DAT_LAG_NS = 60;
/** How often the level picked up by a floating input changes. */
const NOISE_NS = 100_000;

export interface PinChange {
  t: number;
  level: Level;
}

/** What an external part does to a pin: drive it, or leave it alone. */
export type Drive = Level | null;

/** Configuration of one port, cached as plain numbers (read on every pin update). */
interface PortCfg {
  dir: number;
  pud: number;
  odr: number;
  inv: number;
  mux: [number, number];
  gmux: [number, number];
}

export class Gpio {
  /** Output latch per port. */
  private latch = [0, 0, 0, 0, 0, 0];
  private cfg: PortCfg[] = [];
  /** External drive per pin (buttons, sensors). */
  private ext: Drive[] = new Array(PIN_COUNT).fill(null);
  /** Level driven by a peripheral when the pin is muxed to it. */
  private periphOut: Drive[] = new Array(PIN_COUNT).fill(null);
  /** Resolved level per pin; -1 = floating. */
  level: Int8Array = new Int8Array(PIN_COUNT).fill(-1);
  /** Per port: bit mask of pins that are high, and of pins that float. */
  private high = [0, 0, 0, 0, 0, 0];
  // Before anything is configured every pin floats (port F has only GPIO160-168).
  private floating = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0x1ff];
  /** When each pin last changed, and its level before that. */
  private changedAt = new Float64Array(PIN_COUNT).fill(-1e9);
  private before = new Int8Array(PIN_COUNT).fill(-1);
  private portChangedAt = [-1e9, -1e9, -1e9, -1e9, -1e9, -1e9];
  /** Level history of every pin that ever changed. */
  trace = new Map<number, PinChange[]>();
  listeners: ((pin: number, level: Level, t: number) => void)[] = [];
  /** Ports written through GPxDAT by the student's code. */
  datWrites = new Set<string>();
  /** Floating pins whose own bit was read. */
  floatingRead = new Set<number>();
  private noiseBucket = -1;
  /** Pins whose latch was written while the latch did not drive them, with the diagnostic's key. */
  private notDriven = new Map<number, string>();

  constructor(private b: Board) {
    const dev = b.dev;
    PORTS.forEach((p, i) => {
      // Reset state: every pin is a GPIO input with its pull-up disabled.
      dev.set(`GpioCtrlRegs.GP${p}PUD`, 0xffffffff);
      this.cfg.push({ dir: 0, pud: 0xffffffff, odr: 0, inv: 0, mux: [0, 0], gmux: [0, 0] });
      const reconfigure = () => {
        this.sync(i);
        this.refreshPort(i, b.now);
        // A latch written before the pin became an output was not a mistake after all.
        for (const [pin, key] of this.notDriven) {
          if (pin >> 5 === i && this.mux(pin) === 0 && this.isOutput(pin)) {
            b.diagnostics.delete(key);
            this.notDriven.delete(pin);
          }
        }
      };
      for (const r of ["PUD", "DIR", "MUX1", "MUX2", "GMUX1", "GMUX2", "ODR", "INV"]) {
        // Port F stops at GPIO168, so it has no MUX2 / GMUX2.
        const reg = dev.regs.get(`GpioCtrlRegs.GP${p}${r}`);
        if (reg) reg.hook.after = reconfigure;
      }
      const dat = dev.reg(`GpioDataRegs.GP${p}DAT`).hook;
      dat.quiet = true;
      dat.read = () => this.readPort(i);
      dat.after = (v) => {
        // TRM 8.3: GPyDAT reads the pins, and a pin takes a moment to follow
        // its latch. A read-modify-write that lands inside that moment
        // writes the old level back and undoes the previous change.
        if (b.now - this.portChangedAt[i] < DAT_LAG_NS) {
          const last = Math.min(PIN_COUNT, i * 32 + 32);
          for (let pin = i * 32; pin < last; pin++) {
            const n = pin & 31;
            const stale = b.now - this.changedAt[pin] < DAT_LAG_NS;
            if (stale && this.mux(pin) === 0 && this.isOutput(pin) && ((v >>> n) & 1) === this.before[pin] && ((this.latch[i] >>> n) & 1) !== this.before[pin]) {
              b.warn(
                b.line,
                "dat-rmw",
                `This write to GP${p}DAT undid the change just made to GPIO${pin}. A .bit write reads the whole register first, and GP${p}DAT still showed GPIO${pin}'s old level. Use GP${p}SET, GP${p}CLEAR or GP${p}TOGGLE, which change only the bits written as 1.`,
                "error",
              );
            }
          }
        }
        if (!b.libDepth) this.datWrites.add(`GP${p}DAT`);
        this.setLatch(i, v >>> 0);
      };
      // SET / CLEAR / TOGGLE act on the bits written as 1 and always read 0.
      const op = (name: string, f: (latch: number, v: number) => number) => {
        const h = dev.reg(`GpioDataRegs.GP${p}${name}`).hook;
        h.quiet = true;
        h.write = () => 0;
        // A .bit write reads the register first, in the same statement.
        let readAt = -1;
        h.read = (stored) => {
          readAt = b.steps;
          return stored;
        };
        h.after = (v) => {
          if (!b.libDepth) {
            // .bit.GPIOn = 0 is the mistake. A computed mask that happens to be 0 is not.
            if (v === 0 && readAt === b.steps)
              b.warn(
                b.line,
                "gpio-write-zero",
                `Writing 0 to GP${p}${name} changes nothing: this register only acts on the bits written as 1. To make a pin high write 1 to its bit in GP${p}SET, to make it low write 1 to its bit in GP${p}CLEAR.`,
              );
            else if (v) this.checkDriven(i, v >>> 0);
          }
          this.setLatch(i, f(this.latch[i], v) >>> 0);
        };
      };
      op("SET", (l, v) => l | v);
      op("CLEAR", (l, v) => l & ~v);
      op("TOGGLE", (l, v) => l ^ v);
    });
  }

  /**
   * The program wrote 1 to SET / CLEAR / TOGGLE bits, and none of them
   * belongs to a pin the latch drives: they are inputs, or pins whose mux
   * selects a peripheral. The lowest such pin is named. The
   * message is taken back if the pin becomes a GPIO output later (setting
   * the latch first avoids a glitch).
   */
  private checkDriven(port: number, bits: number): void {
    const b = this.b;
    const p = PORTS[port];
    // A mask that reaches at least one output pin is a deliberate write to several pins.
    for (let n = 0; n < 32; n++) {
      const pin = port * 32 + n;
      if ((bits >>> n) & 1 && pin < PIN_COUNT && this.mux(pin) === 0 && this.isOutput(pin)) return;
    }
    for (let n = 0; n < 32; n++) {
      if (!((bits >>> n) & 1)) continue;
      const pin = port * 32 + n;
      if (pin >= PIN_COUNT || this.notDriven.has(pin)) return;
      const mux = this.mux(pin);
      const code = `gpio-not-output-${pin}`;
      const key = `${code}:${b.line}`;
      if (b.diagnostics.has(key)) return;
      this.notDriven.set(pin, key);
      b.warn(
        b.line,
        code,
        mux !== 0
          ? `GPIO${pin}'s output latch was written, but the pin's mux is at position ${mux} (a peripheral signal), so the latch does not reach the pin. For a plain GPIO use GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);`
          : `GPIO${pin}'s output latch was written, but the pin is an input (its bit in GP${p}DIR is 0), so the pin does not change. Make it an output: GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);`,
      );
      // One message for the lowest pin of the mask is enough.
      return;
    }
  }

  /** Re-reads a port's configuration registers into the cache. */
  private sync(i: number): void {
    const dev = this.b.dev;
    const p = PORTS[i];
    const get = (r: string) => (dev.regs.has(`GpioCtrlRegs.GP${p}${r}`) ? dev.get(`GpioCtrlRegs.GP${p}${r}`) : 0);
    this.cfg[i] = {
      dir: get("DIR"), pud: get("PUD"), odr: get("ODR"), inv: get("INV"),
      mux: [get("MUX1"), get("MUX2")], gmux: [get("GMUX1"), get("GMUX2")],
    };
    this.b.mem.writes++;
  }

  private setLatch(port: number, next: number): void {
    const changed = (this.latch[port] ^ next) >>> 0;
    if (!changed) return;
    this.latch[port] = next;
    this.b.mem.writes++;
    const t = this.b.now;
    for (let n = 0; n < 32; n++) if ((changed >>> n) & 1 && port * 32 + n < PIN_COUNT) this.refresh(port * 32 + n, t);
  }

  /**
   * The output latch of a port (0 = A .. 5 = F), one bit per pin. It holds
   * what was written through DAT / SET / CLEAR / TOGGLE for every pin, also
   * for inputs and peripheral pins, where it does not reach the pin (TRM 8.3).
   */
  latchOf(port: number): number {
    return this.latch[port] >>> 0;
  }

  /** Mux position 0..15 of a pin (GMUX in the upper two bits). */
  mux(pin: number): number {
    const c = this.cfg[pin >> 5];
    const n = pin & 31;
    const half = n < 16 ? 0 : 1;
    const sh = (n & 15) * 2;
    return (((c.gmux[half] >>> sh) & 3) << 2) | ((c.mux[half] >>> sh) & 3);
  }

  isOutput(pin: number): boolean {
    return ((this.cfg[pin >> 5].dir >>> (pin & 31)) & 1) === 1;
  }

  pullUpEnabled(pin: number): boolean {
    return ((this.cfg[pin >> 5].pud >>> (pin & 31)) & 1) === 0;
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
        out = (this.cfg[port].odr >>> n) & 1 && l === 1 ? null : l;
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
    const port = pin >> 5;
    const bit = (1 << (pin & 31)) >>> 0;
    this.before[pin] = this.level[pin];
    this.changedAt[pin] = t;
    this.portChangedAt[port] = t;
    this.level[pin] = lv;
    this.high[port] = (lv === 1 ? this.high[port] | bit : this.high[port] & ~bit) >>> 0;
    this.floating[port] = (lv < 0 ? this.floating[port] | bit : this.floating[port] & ~bit) >>> 0;
    this.b.mem.writes++;
    if (lv < 0) return;
    let tr = this.trace.get(pin);
    if (!tr) this.trace.set(pin, (tr = []));
    tr.push({ t, level: lv as Level });
    const limit = this.b.historyLimit;
    if (limit && tr.length > limit) tr.splice(0, tr.length - (limit >> 1));
    for (const l of this.listeners) l(pin, lv as Level, t);
  }

  /** What GPxDAT reads: the pin levels (inverted where GPxINV is set). */
  private readPort(port: number): number {
    const b = this.b;
    const want = b.mem.reqMask;
    const inv = this.cfg[port].inv;
    // Fast path: nothing changed recently and no requested pin floats.
    if (b.now - this.portChangedAt[port] >= DAT_LAG_NS && !(this.floating[port] & want)) return (this.high[port] ^ inv) >>> 0;
    let v = 0;
    const last = Math.min(PIN_COUNT, port * 32 + 32);
    // A single-bit read (GPxDAT.bit.GPIOn) names the pin the code cares about.
    const single = (want & (want - 1)) === 0;
    for (let pin = port * 32; pin < last; pin++) {
      const n = pin & 31;
      if (!((want >>> n) & 1)) continue;
      let lv = this.level[pin];
      if (b.now - this.changedAt[pin] < DAT_LAG_NS && this.before[pin] >= 0) lv = this.before[pin];
      if (lv < 0) {
        // A floating input picks up noise: the value read is unpredictable.
        // The noise is modelled as a new random level every 100 us, so a
        // program that only polls can still be skipped ahead between changes.
        const bucket = Math.floor(b.now / NOISE_NS);
        lv = (Math.imul(Math.imul(pin + 1, 0x9e3779b1) ^ bucket, 0x85ebca6b) >>> 15) & 1;
        if (this.noiseBucket !== bucket) {
          this.noiseBucket = bucket;
          b.at((bucket + 1) * NOISE_NS, () => b.mem.writes++);
        }
        if (single) {
          this.floatingRead.add(pin);
          b.warn(
            b.line,
            `floating-${pin}`,
            `GPIO${pin} was read, but nothing sets its level: its pull-up is off and nothing outside is driving it, so the value is random. Enable the pull-up: GPIO_SetupPinOptions(${pin}, GPIO_INPUT, GPIO_PULLUP);`,
          );
        }
      }
      v |= lv << n;
    }
    return (v ^ inv) >>> 0;
  }

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
