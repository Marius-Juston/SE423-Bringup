// Peripheral Interrupt Expansion (PIE) block. TRM section 3.4 "Peripheral
// Interrupts": 12 groups of 16 channels feed CPU interrupts INT1..INT12.
// A group that was not acknowledged (PIEACK) sends nothing more to the CPU.
// Diagnostics: a request lost because an enable is missing (PIEIER, IER,
// EINT), and a peripheral flag the interrupt function did not clear.

import type { Board } from "../board";

export class Pie {
  /** Vector name per "group.channel", from the TI header's own comments ("12.9 - ..."). */
  private vectors = new Map<string, string>();
  /**
   * Channels ("group.channel") whose PIEIER bit is a blank students fill in for credit, with
   * the library call that sets it. A message about such a missing enable names the call and
   * the manual's table, never the bit.
   */
  libraryEnable = new Map<string, string>();
  /** PIEACK bits written as 1 since the CPU last took an interrupt of that group. */
  acked = 0;

  constructor(private b: Board) {
    const dev = b.dev;
    for (const f of dev.instances.find((i) => i.name === "PieVectTable")!.type.fields) {
      const m = /^(\d+)\.(\d+) - /.exec(f.desc ?? "");
      if (m) this.vectors.set(`${m[1]}.${m[2]}`, f.name);
    }
    const re = () => this.evaluate();
    // PIEACK: writing 1 clears the bit (TRM 3.15.3.2).
    const ack = dev.reg("PieCtrlRegs.PIEACK").hook;
    ack.write = (v, stored) => stored & ~v;
    ack.after = (v) => {
      this.acked |= v;
      this.evaluate();
    };
    dev.reg("PieCtrlRegs.PIECTRL").hook.after = re;
    for (let g = 1; g <= 12; g++) {
      dev.reg(`PieCtrlRegs.PIEIER${g}`).hook.after = re;
      dev.reg(`PieCtrlRegs.PIEIFR${g}`).hook.after = re;
    }
  }

  /** Name of the vector for group x (1..12), channel y (1..16). */
  vectorName(x: number, y: number): string {
    const name = this.vectors.get(`${x}.${y}`);
    if (!name) throw new Error(`no PIE vector for INT${x}.${y}`);
    return name;
  }

  /** A peripheral requests interrupt INTx.y (step 1: latched in PIEIFRx.y). */
  raise(x: number, y: number): void {
    this.b.mem.writes++;
    const name = `PieCtrlRegs.PIEIFR${x}`;
    const flags = this.b.dev.get(name);
    const bit = 1 << (y - 1);
    // Still waiting from the last request: this one is lost.
    if (flags & bit) this.lost(x, y);
    this.b.dev.set(name, flags | bit);
    this.evaluate();
  }

  /** A request for INTx.y found the previous one still waiting. Says why if an enable is missing. */
  private lost(x: number, y: number): void {
    const dev = this.b.dev;
    let reason: string | null = null;
    if (!dev.get("PieCtrlRegs.PIECTRL", "ENPIE")) reason = "the PIE is not enabled. InitPieVectTable() sets ENPIE.";
    else if (!(dev.get(`PieCtrlRegs.PIEIER${x}`) & (1 << (y - 1)))) {
      const lib = this.libraryEnable.get(`${x}.${y}`);
      reason = lib
        ? `${this.pieBit(x, y)} is 0. Call ${lib} or set the bit that Table 3-2 of the reference manual gives for ${this.vectorName(x, y)}.`
        : `PieCtrlRegs.PIEIER${x}.bit.INTx${y} is 0. Add PieCtrlRegs.PIEIER${x}.bit.INTx${y} = 1;`;
    }
    this.b.blocked(this.vectorName(x, y), x, reason);
  }

  /**
   * A peripheral could not request INTx.y because its own interrupt flag is
   * still set. If the student's function already ran and returned, it forgot
   * to clear the flag: say so on that function.
   */
  uncleared(x: number, y: number, flag: string, fix: string): void {
    const b = this.b;
    if (b.isrDepth) return;
    // The first request never reached the CPU: the flag is not the problem.
    if (b.dev.get(`PieCtrlRegs.PIEIFR${x}`) & (1 << (y - 1))) {
      this.lost(x, y);
      return;
    }
    const vector = this.vectorName(x, y);
    const fn = b.isrFor(vector);
    if (!fn || !b.served.has(vector)) return;
    b.warn(
      fn.line,
      `irq-flag-${vector}`,
      `'${fn.name}' returned without clearing ${flag}, so the ${vector} interrupt cannot be requested again and the function does not run a second time. Add ${fix} to the function.`,
    );
  }

  /** Steps 2-4: enabled and unacknowledged requests reach the CPU's IFR. */
  evaluate(): void {
    const dev = this.b.dev;
    if (dev.get("PieCtrlRegs.PIECTRL", "ENPIE")) {
      let ack = dev.get("PieCtrlRegs.PIEACK");
      for (let g = 1; g <= 12; g++) {
        const bit = 1 << (g - 1);
        if (ack & bit) continue;
        if (dev.get(`PieCtrlRegs.PIEIFR${g}`) & dev.get(`PieCtrlRegs.PIEIER${g}`)) {
          ack |= bit;
          this.b.ifr |= bit;
        }
      }
      dev.set("PieCtrlRegs.PIEACK", ack);
    }
    this.b.updateIrq();
  }

  /** Step 10: the CPU fetches the vector; the highest-priority channel's flag is cleared. */
  take(x: number): string | null {
    const dev = this.b.dev;
    const ifr = dev.get(`PieCtrlRegs.PIEIFR${x}`);
    const pending = ifr & dev.get(`PieCtrlRegs.PIEIER${x}`);
    if (!pending) return null;
    let y = 1;
    while (!(pending & (1 << (y - 1)))) y++;
    dev.set(`PieCtrlRegs.PIEIFR${x}`, ifr & ~(1 << (y - 1)));
    return this.vectorName(x, y);
  }

  /** The enable bit of INTx.y as a message names it. */
  private pieBit(x: number, y: number): string {
    return this.libraryEnable.has(`${x}.${y}`) ? `the enable bit of ${this.vectorName(x, y)} in PieCtrlRegs.PIEIER${x}` : `PieCtrlRegs.PIEIER${x}.bit.INTx${y}`;
  }

  /** Whether INTx.y would reach the CPU right now, and if not, why. */
  explain(x: number, y: number): string | null {
    const dev = this.b.dev;
    if (!dev.get("PieCtrlRegs.PIECTRL", "ENPIE")) return "the PIE is not enabled (InitPieVectTable() sets ENPIE)";
    if (!(dev.get(`PieCtrlRegs.PIEIER${x}`) & (1 << (y - 1)))) return `${this.pieBit(x, y)} is 0`;
    if (!(this.b.ier & (1 << (x - 1)))) return `IER does not have M_INT${x} set`;
    if (this.b.intm) return "interrupts are globally disabled (EINT has not run)";
    if (dev.get("PieCtrlRegs.PIEACK") & (1 << (x - 1))) return `group ${x} was never acknowledged (PieCtrlRegs.PIEACK.all = PIEACK_GROUP${x};)`;
    return null;
  }
}
