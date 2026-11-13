// Peripheral Interrupt Expansion (PIE) block. TRM section 3.4 "Peripheral
// Interrupts": 12 groups of 16 channels feed CPU interrupts INT1..INT12.

import type { Board } from "../board";

export class Pie {
  /** Vector name per "group.channel", from the TI header's own comments ("12.9 - ..."). */
  private vectors = new Map<string, string>();

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
    ack.after = re;
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
    this.b.dev.set(name, this.b.dev.get(name) | (1 << (y - 1)));
    this.evaluate();
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

  /** Whether INTx.y would reach the CPU right now, and if not, why. */
  explain(x: number, y: number): string | null {
    const dev = this.b.dev;
    if (!dev.get("PieCtrlRegs.PIECTRL", "ENPIE")) return "the PIE is not enabled (InitPieVectTable() sets ENPIE)";
    if (!(dev.get(`PieCtrlRegs.PIEIER${x}`) & (1 << (y - 1)))) return `PieCtrlRegs.PIEIER${x}.bit.INTx${y} is 0`;
    if (!(this.b.ier & (1 << (x - 1)))) return `IER does not have M_INT${x} set`;
    if (this.b.intm) return "interrupts are globally disabled (EINT has not run)";
    if (dev.get("PieCtrlRegs.PIEACK") & (1 << (x - 1))) return `group ${x} was never acknowledged (PieCtrlRegs.PIEACK.all = PIEACK_GROUP${x};)`;
    return null;
  }
}
