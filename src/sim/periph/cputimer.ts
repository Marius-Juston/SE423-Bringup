// CPU timers 0-2. TRM section 3.8 "32-Bit CPU Timers 0/1/2": a 16-bit
// prescaler (TDDRH:TDDR) divides SYSCLK, the 32-bit counter TIM counts down
// from PRD, and reaching zero sets TIF and reloads.
//   period = (PRD + 1) * (TDDRH:TDDR + 1) SYSCLK cycles
// Not modelled: a period below 50 SYSCLK cycles (250 ns, less than an
// interrupt takes). Such a timer gets a diagnostic and stops expiring.

import { SYSCLK_NS } from "../consts";
import type { Board } from "../board";

/** Shortest period that is simulated, ns. */
const MIN_PERIOD_NS = 250;

interface Timer {
  n: number;
  prefix: string;
  running: boolean;
  /** Time at which TIM held `count` (ns). */
  t0: number;
  /** Prescale divider in force since t0 (TDDRH:TDDR + 1). */
  div: number;
  count: number;
  ev: ReturnType<Board["at"]> | null;
}

export class CpuTimers {
  private timers: Timer[] = [];
  /** Times at which each timer expired (for checks and the scope). */
  expiries: number[][] = [[], [], []];

  constructor(private b: Board) {
    for (let n = 0; n < 3; n++) {
      const prefix = `CpuTimer${n}Regs`;
      const t: Timer = { n, prefix, running: true, t0: 0, div: 1, count: 0xffffffff, ev: null };
      this.timers.push(t);
      const dev = b.dev;
      // Reset state (TRM register tables): PRD = TIM = FFFFFFFFh, timer running.
      dev.set(`${prefix}.PRD`, 0xffffffff);
      dev.set(`${prefix}.TIM`, 0xffffffff);
      const tim = dev.reg(`${prefix}.TIM`).hook;
      tim.live = true;
      tim.read = () => this.current(t);
      tim.after = (v) => {
        t.count = v;
        t.t0 = b.now;
        this.schedule(t);
      };
      const tcr = dev.reg(`${prefix}.TCR`).hook;
      tcr.write = (v, stored) => {
        // TIF (bit 15) is cleared by writing 1; TRB (bit 5) always reads 0.
        let next = v & ~0x8020;
        if (stored & 0x8000 && !(v & 0x8000)) next |= 0x8000;
        return next;
      };
      tcr.after = (v) => {
        const stop = (v & 0x10) !== 0;
        if (v & 0x20) {
          t.count = dev.get(`${prefix}.PRD`);
          t.t0 = b.now;
        } else if (stop && t.running) {
          t.count = this.current(t);
        } else if (!stop && !t.running) t.t0 = b.now;
        t.running = !stop;
        this.schedule(t);
      };
      const tpr = () => {
        // The time so far was counted with the old divider.
        t.count = this.current(t);
        t.t0 = b.now;
        t.div = this.divider(t);
        this.schedule(t);
      };
      dev.reg(`${prefix}.TPR`).hook.after = tpr;
      dev.reg(`${prefix}.TPRH`).hook.after = tpr;
      this.schedule(t);
    }
  }

  private divider(t: Timer): number {
    const dev = this.b.dev;
    return ((dev.get(`${t.prefix}.TPRH`, "TDDRH") << 8) | dev.get(`${t.prefix}.TPR`, "TDDR")) + 1;
  }

  private current(t: Timer): number {
    if (!t.running) return t.count;
    const ticks = Math.floor((this.b.now - t.t0) / (SYSCLK_NS * t.div));
    return Math.max(0, t.count - ticks);
  }

  private schedule(t: Timer): void {
    const b = this.b;
    b.cancel(t.ev);
    t.ev = null;
    if (!t.running) return;
    const tickNs = SYSCLK_NS * t.div;
    // Expiring every few clock cycles would only flood the event queue.
    const period = (b.dev.get(`${t.prefix}.PRD`) + 1) * tickNs;
    if (period < MIN_PERIOD_NS) {
      b.warn(
        b.line,
        `timer-too-fast-${t.n}`,
        `CpuTimer${t.n} is set to a period of ${period} ns (PRD = ${b.dev.get(`${t.prefix}.PRD`)}). That is shorter than one interrupt takes, so it is not simulated and the timer does not expire. ` +
          `Check the period: ConfigCpuTimer(&CpuTimer${t.n}, 200, 1000); gives 1000 microseconds.`,
        "error",
      );
      return;
    }
    // TIM reaches 0 after `count` ticks; the interrupt and reload happen on the next one.
    t.ev = b.at(t.t0 + (t.count + 1) * tickNs, (at) => this.expire(t, at));
  }

  private expire(t: Timer, at: number): void {
    const b = this.b;
    const dev = b.dev;
    const log = this.expiries[t.n];
    log.push(at);
    // A live run can go on for minutes: keep the recent expiries only.
    if (b.historyLimit && log.length > b.historyLimit) log.splice(0, log.length - (b.historyLimit >> 1));
    b.fireTrigger(`TINT${t.n}`, at);
    dev.set(`${t.prefix}.TCR`, 1, "TIF");
    t.count = dev.get(`${t.prefix}.PRD`);
    t.t0 = at;
    if (dev.get(`${t.prefix}.TCR`, "TIE")) {
      // Timer 0 goes through the PIE (INT1.7); timers 1 and 2 are wired to INT13 and INT14.
      if (t.n === 0) b.pie.raise(1, 7);
      else b.raiseCpu(t.n === 1 ? 12 : 13);
    }
    this.schedule(t);
  }

  /** Period in ns the timer is currently configured for. */
  periodNs(n: number): number {
    const t = this.timers[n];
    return (this.b.dev.get(`${t.prefix}.PRD`) + 1) * this.divider(t) * SYSCLK_NS;
  }

  isRunning(n: number): boolean {
    return this.timers[n].running;
  }
}
