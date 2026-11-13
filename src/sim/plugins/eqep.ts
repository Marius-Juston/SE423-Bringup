// eQEP1..3 and the optical encoders wired to them. TRM chapter 17 "Enhanced
// Quadrature Encoder Pulse (eQEP)".
//
// Modelled:
// - 17.3.1 inputs: QEPA / QEPB reach the module only through pins muxed to
//   the eQEP function. The robot's encoders are wired to EQEP1A/B =
//   GPIO20/21 (mux 1), EQEP2A/B = GPIO54/55 (mux 5), EQEP3A/B = GPIO6/7
//   (mux 5), as in the course's init_eQEPs() and the LaunchPad pin mux table.
// - 17.4.1 position counter input modes, QDECCTL.QSRC: 0 quadrature count
//   (Table 17-2: every edge of A and B counts, up when A leads B), 1
//   direction count (QEPA is the clock, QEPB the direction), 2 up count,
//   3 down count. QDECCTL.XCR (both edges or rising edges of the clock in
//   modes 1 to 3), SWAP, QAP and QBP are honoured.
// - 17.5.1 position counter: counts only while QEPCTL.QPEN = 1; reset to 0
//   on overflow (counting up past QPOSMAX) and to QPOSMAX on underflow
//   (counting down past 0). QPOSMAX is 0 after reset, so a counter whose
//   QPOSMAX was never written stays at 0.
// - 17.5.3 software initialisation: writing QEPCTL.SWI = 1 copies QPOSINIT
//   into QPOSCNT.
// - QEPSTS.QDF: direction of the last count (1 = up).
// Not modelled: index and strobe inputs (not connected on the robot, so
// QEPCTL.PCRM never resets the counter), position compare, edge capture,
// unit timer, watchdog and the eQEP interrupts (the course disables them all).
// QPEN = 0 stops the counter and keeps QPOSCNT (TRM Table 17-17 says the
// software reset clears "internal operating flags/read-only registers";
// QPOSCNT is read/write).
//
// The encoders (course numbers, Lab 3 and SE423Lib.c): 500 slits on the
// motor shaft, so 2000 counts per motor turn in quadrature mode, and a 20:1
// gear head, so 40000 counts per wheel turn. The hand wheel gives 4000
// counts per turn. Shaft speeds come from the signal bus in rad/s:
// LEFT_WHEEL_RADPS, RIGHT_WHEEL_RADPS (positive = robot forward) and
// HANDWHEEL_RADPS. The motors are mounted mirrored, so the left encoder
// counts DOWN when the robot drives forward (readEncLeft multiplies by a
// negative factor).
//
// Position is integrated analytically (speed is piecewise constant), so no
// event is needed per count at motor speed. Only when a shaft turns slower
// than SLOW_COUNTS_PER_S are the real A and B waveforms driven on the pins,
// for scope views and for code that decodes them from GPIO inputs.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";

/**
 * Below this count rate (quadrature counts per second) the encoder's A and B
 * outputs are driven edge by edge on its pins. Above it the pins hold their
 * last level and only the counter moves. 2000 counts/s is 0.314 rad/s at a
 * wheel and 3.14 rad/s at the hand wheel.
 */
export const SLOW_COUNTS_PER_S = 2000;

/** How often QPOSCNT's stored copy and the angle meters are refreshed while a shaft turns, ns. */
const REFRESH_NS = 5e6;

interface EncoderDef {
  /** eQEP module number. */
  n: 1 | 2 | 3;
  input: string;
  /** Published shaft angle in rad (forward positive). */
  output: string;
  pinA: number;
  pinB: number;
  mux: number;
  /** Quadrature counts per radian of the shaft named by `input`, with the mounting sign. */
  countsPerRad: number;
}

export const ENCODERS: EncoderDef[] = [
  { n: 1, input: "LEFT_WHEEL_RADPS", output: "LEFT_WHEEL_RAD", pinA: 20, pinB: 21, mux: 1, countsPerRad: -(2000 * 20) / (2 * Math.PI) },
  { n: 2, input: "RIGHT_WHEEL_RADPS", output: "RIGHT_WHEEL_RAD", pinA: 54, pinB: 55, mux: 5, countsPerRad: (2000 * 20) / (2 * Math.PI) },
  { n: 3, input: "HANDWHEEL_RADPS", output: "HANDWHEEL_RAD", pinA: 6, pinB: 7, mux: 5, countsPerRad: 4000 / (2 * Math.PI) },
];

/** (A, B) for each quarter of a slit period: A leads B when the count goes up. */
const STATES: [0 | 1, 0 | 1][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const mod = (a: number, m: number) => ((a % m) + m) % m;
const stateOf = (q: number) => STATES[mod(q, 4)];

class Encoder {
  /**
   * Position in counts at time t0, and count rate in counts per second. The
   * shaft starts in the middle of a quarter-step, not on an edge.
   */
  private pos0 = 0.5;
  private t0 = 0;
  private rate = 0;
  /** The shaft has turned at least once: from then on the pins are driven. */
  private turned = false;
  private edge: ReturnType<Board["at"]> | null = null;
  private refresh: ReturnType<Board["at"]> | null = null;

  // eQEP counter: value `cnt` when the encoder was at quarter-step `q0`.
  private cnt = 0;
  private q0 = 0;
  private lastDir = 0;
  // Configuration in force since the last fold.
  private counting = false;
  private qsrc = 0;
  private xcr = 0;
  private swap = 0;
  private qap = 0;
  private qbp = 0;
  private max = 0;

  private pre: string;

  constructor(private b: Board, private def: EncoderDef) {
    this.pre = `EQep${def.n}Regs`;
    const dev = b.dev;
    const pre = this.pre;

    b.onInput(def.input, (v, t) => this.setRate(v * def.countsPerRad, t));

    const cnt = dev.reg(`${pre}.QPOSCNT`).hook;
    cnt.live = true;
    cnt.read = () => {
      this.diagnose();
      return this.count(b.now);
    };
    cnt.after = (v) => {
      this.fold(b.now);
      this.cnt = mod(v, this.max + 1);
      dev.set(`${pre}.QPOSCNT`, this.cnt);
    };
    for (const r of ["QPOSMAX", "QDECCTL"]) dev.reg(`${pre}.${r}`).hook.after = () => this.fold(b.now);
    dev.reg(`${pre}.QEPCTL`).hook.after = (v) => {
      this.fold(b.now);
      // 17.5.3: SWI = 1 loads QPOSINIT. The bit stays set, and writing 1 again reloads.
      if (v & 0x80) {
        this.cnt = dev.get(`${pre}.QPOSINIT`);
        dev.set(`${pre}.QPOSCNT`, this.cnt);
      }
    };
    const sts = dev.reg(`${pre}.QEPSTS`).hook;
    sts.live = true;
    sts.read = (stored) => {
      this.count(b.now);
      // QDF (bit 5): 1 while the last count was upward.
      return this.lastDir > 0 ? stored | 0x20 : stored & ~0x20;
    };
  }

  // ---------- shaft ----------

  private pos(t: number): number {
    return this.pos0 + this.rate * (t - this.t0) * 1e-9;
  }

  /** Quarter-step the encoder is in at time t. */
  private q(t: number): number {
    return Math.floor(this.pos(t));
  }

  private setRate(rate: number, t: number): void {
    this.fold(t);
    this.pos0 = this.pos(t);
    this.t0 = t;
    this.rate = rate;
    this.q0 = this.q(t);
    if (rate !== 0) this.turned = true;
    this.drivePins(t);
    this.scheduleEdge();
    this.scheduleRefresh(t);
  }

  private drivePins(t: number): void {
    if (!this.turned) return;
    const [a, bLevel] = stateOf(this.q(t));
    this.b.gpio.drive(this.def.pinA, a, t);
    this.b.gpio.drive(this.def.pinB, bLevel, t);
  }

  private scheduleEdge(): void {
    const b = this.b;
    b.cancel(this.edge);
    this.edge = null;
    const rate = this.rate;
    if (rate === 0 || Math.abs(rate) > SLOW_COUNTS_PER_S) return;
    // Next quarter-step boundary in the direction of travel.
    const here = this.pos0;
    const next = rate > 0 ? Math.floor(here) + 1 : Number.isInteger(here) ? here : Math.ceil(here) - 1;
    const at = this.t0 + ((next - here) / rate) * 1e9;
    this.edge = b.at(at, (t) => {
      // Re-anchor on the boundary so rounding never skips or repeats a step.
      // Going down, the encoder is now just below `next`.
      this.pos0 = rate > 0 ? next : next - 1e-9;
      this.t0 = t;
      this.drivePins(t);
      this.scheduleEdge();
    });
  }

  private scheduleRefresh(t: number): void {
    const b = this.b;
    b.cancel(this.refresh);
    this.refresh = null;
    this.show(t);
    if (this.rate === 0) return;
    this.refresh = b.at(t + REFRESH_NS, (at) => this.scheduleRefresh(at));
  }

  /** Keeps the inspector's copy of QPOSCNT and the angle meter up to date. */
  private show(t: number): void {
    this.b.dev.set(`${this.pre}.QPOSCNT`, this.count(t));
    this.b.publish(this.def.output, (this.pos(t) - 0.5) / this.def.countsPerRad, t);
  }

  // ---------- counter ----------

  /** Count change for one encoder step from state s0 to state s1 (Table 17-2 and section 17.4.1). */
  private step(s0: [number, number], s1: [number, number]): number {
    let a0 = s0[0] ^ this.qap;
    let b0 = s0[1] ^ this.qbp;
    let a1 = s1[0] ^ this.qap;
    let b1 = s1[1] ^ this.qbp;
    if (this.swap) [a0, b0, a1, b1] = [b0, a0, b1, a1];
    if (this.qsrc === 0) {
      const idx = (a: number, bb: number) => (a ? (bb ? 2 : 1) : bb ? 3 : 0);
      return mod(idx(a1, b1) - idx(a0, b0), 4) === 1 ? 1 : -1;
    }
    // Modes 1 to 3: QEPA is the clock, on both edges (XCR = 0) or rising edges only (XCR = 1).
    if (a0 === a1 || (this.xcr && a1 === 0)) return 0;
    if (this.qsrc === 1) return b1 ? 1 : -1;
    return this.qsrc === 2 ? 1 : -1;
  }

  /** Count change while the encoder moved from quarter-step q0 to q1 in one direction. */
  private delta(q0: number, q1: number): number {
    if (!this.counting || q0 === q1) return 0;
    const up = q1 > q0;
    if (this.qsrc === 0 && !(this.swap ^ this.qap ^ this.qbp)) return q1 - q0;
    const lo = Math.min(q0, q1);
    const hi = Math.max(q0, q1);
    let d = 0;
    for (let r = 0; r < 4; r++) {
      // Boundaries n in (lo, hi] with n mod 4 = r: the encoder steps between states r-1 and r.
      const n = Math.floor((hi - r) / 4) - Math.floor((lo - r) / 4);
      if (n) d += n * (up ? this.step(stateOf(r - 1), stateOf(r)) : this.step(stateOf(r), stateOf(r - 1)));
    }
    return d;
  }

  /** QPOSCNT at time t. */
  private count(t: number): number {
    const d = this.delta(this.q0, this.q(t));
    if (d !== 0) this.lastDir = d;
    // 17.5.1: overflow resets to 0, underflow to QPOSMAX.
    return mod(this.cnt + d, this.max + 1);
  }

  /** Brings the counter up to time t, then re-reads the configuration. */
  fold(t: number): void {
    const b = this.b;
    const dev = b.dev;
    const pre = this.pre;
    this.cnt = this.count(t);
    this.q0 = this.q(t);
    this.max = dev.get(`${pre}.QPOSMAX`);
    this.qsrc = dev.get(`${pre}.QDECCTL`, "QSRC");
    this.xcr = dev.get(`${pre}.QDECCTL`, "XCR");
    this.swap = dev.get(`${pre}.QDECCTL`, "SWAP");
    this.qap = dev.get(`${pre}.QDECCTL`, "QAP");
    this.qbp = dev.get(`${pre}.QDECCTL`, "QBP");
    // Up and down count modes use QEPA only.
    this.counting = dev.get(`${pre}.QEPCTL`, "QPEN") === 1 && this.muxed(this.def.pinA) && (this.qsrc >= 2 || this.muxed(this.def.pinB));
    this.cnt = mod(this.cnt, this.max + 1);
    dev.set(`${pre}.QPOSCNT`, this.cnt);
    b.mem.writes++;
  }

  private muxed(pin: number): boolean {
    return this.b.gpio.mux(pin) === this.def.mux;
  }

  /** Explains a counter that cannot move when the program reads it. */
  private diagnose(): void {
    const b = this.b;
    const { n, pinA, pinB, mux } = this.def;
    const pre = this.pre;
    if (b.dev.get(`${pre}.QEPCTL`, "QPEN") !== 1) {
      b.warn(b.line, `eqep-disabled-${n}`, `${pre}.QPOSCNT was read while QEPCTL.bit.QPEN is 0: the position counter is switched off, so it never changes. Enable it: ${pre}.QEPCTL.bit.QPEN = 1;`);
      return;
    }
    const bad = [pinA, pinB].filter((p) => !this.muxed(p));
    if (bad.length && !(this.qsrc >= 2 && this.muxed(pinA))) {
      const pin = bad[0];
      b.warn(
        b.line,
        `eqep-mux-${n}`,
        `eQEP${n} is enabled, but GPIO${pin} is not connected to it (its mux is ${b.gpio.mux(pin)}, EQEP${n}${pin === pinA ? "A" : "B"} is mux ${mux}), so the encoder signal never reaches the counter. Write GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, ${mux});`,
      );
      return;
    }
    if (b.dev.get(`${pre}.QPOSMAX`) === 0)
      b.warn(b.line, `eqep-posmax-${n}`, `${pre}.QPOSMAX is 0 (its reset value): the counter goes back to 0 as soon as it counts past QPOSMAX, so it always reads 0. Use the full range: ${pre}.QPOSMAX = 0xFFFFFFFF;`);
  }
}

export const plugin: SimPlugin = {
  name: "eqep",
  install(b) {
    const encoders = ENCODERS.map((d) => new Encoder(b, d));
    b.plugins.set("eqep", encoders);
    // A mux change connects or disconnects the encoder: bring the counters
    // up to date first. The GPIO model owns these hooks, so chain behind it.
    for (const r of ["GPAMUX1", "GPAMUX2", "GPAGMUX1", "GPAGMUX2", "GPBMUX2", "GPBGMUX2"]) {
      const hook = b.dev.reg(`GpioCtrlRegs.${r}`).hook;
      const prev = hook.after;
      hook.after = (v, before) => {
        prev?.(v, before);
        for (const e of encoders) e.fold(b.now);
      };
    }
  },
  parts: {
    robot: [
      { kind: "knob", id: "ENC_LEFT_SPEED", label: "Left wheel speed", input: "LEFT_WHEEL_RADPS", min: -20, max: 20, step: 0.1, initial: 0, unit: "rad/s" },
      { kind: "knob", id: "ENC_RIGHT_SPEED", label: "Right wheel speed", input: "RIGHT_WHEEL_RADPS", min: -20, max: 20, step: 0.1, initial: 0, unit: "rad/s" },
      { kind: "knob", id: "ENC_HAND_SPEED", label: "Hand wheel speed", input: "HANDWHEEL_RADPS", min: -20, max: 20, step: 0.1, initial: 0, unit: "rad/s" },
      { kind: "meter", id: "LEFT_WHEEL_RAD", label: "Left wheel angle", output: "LEFT_WHEEL_RAD", unit: "rad", digits: 3 },
      { kind: "meter", id: "RIGHT_WHEEL_RAD", label: "Right wheel angle", output: "RIGHT_WHEEL_RAD", unit: "rad", digits: 3 },
      { kind: "meter", id: "HANDWHEEL_RAD", label: "Hand wheel angle", output: "HANDWHEEL_RAD", unit: "rad", digits: 3 },
    ],
  },
};
