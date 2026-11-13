// Word-addressed memory (16-bit words, like the C28x data space) with
// per-register hooks for peripherals.

export interface RegHook {
  /** Full name, e.g. "GpioDataRegs.GPASET". */
  name: string;
  addr: number;
  words: 1 | 2;
  /** Writes are ignored unless EALLOW is active. */
  protect: boolean;
  /** Value changes with time even when nothing writes it (disables idle skipping). */
  live?: boolean;
  /** The hook itself bumps `writes` when a write changes something. */
  quiet?: boolean;
  /** Returns the value a read sees (default: the stored value). */
  read?: (stored: number) => number;
  /** Returns the value to store (default: the written value). */
  write?: (value: number, stored: number) => number;
  /** Called after a write has been stored. */
  after?: (value: number, before: number) => void;
}

const PAGE_BITS = 10;
const PAGE = 1 << PAGE_BITS;

export class Memory {
  private pages = new Map<number, Uint16Array>();
  private regs = new Map<number, RegHook>();
  /**
   * Idle-loop detection. `writes` counts writes with side effects outside
   * memory (hooked registers, library calls, CPU state). `sigA`/`sigB` are a
   * running signature of the memory contents: they return to the same
   * values exactly when memory returns to the same contents, so a loop pass
   * that leaves all three unchanged did nothing.
   */
  writes = 0;
  sigA = 0;
  sigB = 0;
  /** Bits of the register the current read asks for (set for bit-field reads). */
  readMask = 0;
  reqMask = 0xffffffff;
  /** Counts reads of registers that change with time. */
  liveReads = 0;
  eallow = false;
  onProtectedWrite: (reg: RegHook) => void = () => {};
  onWrite: ((reg: RegHook, value: number, before: number) => void) | null = null;

  private page(addr: number): Uint16Array {
    const p = addr >>> PAGE_BITS;
    let a = this.pages.get(p);
    if (!a) this.pages.set(p, (a = new Uint16Array(PAGE)));
    return a;
  }

  hook(h: RegHook): void {
    this.regs.set(h.addr, h);
    if (h.words === 2) this.regs.set(h.addr + 1, h);
  }

  regAt(addr: number): RegHook | undefined {
    return this.regs.get(addr);
  }

  /** Stored value, no hooks (for peripherals and the inspector). */
  peek(addr: number, words: number): number {
    const lo = this.page(addr)[addr & (PAGE - 1)];
    if (words === 1) return lo;
    const hi = this.page(addr + 1)[(addr + 1) & (PAGE - 1)];
    return ((hi << 16) | lo) >>> 0;
  }

  private set16(addr: number, v: number): void {
    const p = this.page(addr);
    const i = addr & (PAGE - 1);
    const old = p[i];
    if (old === v) return;
    // XOR out the old (address, value) pair and XOR in the new one.
    this.sigA ^= Math.imul(Math.imul(addr, 0x9e3779b1) ^ old, 0x85ebca6b) ^ Math.imul(Math.imul(addr, 0x9e3779b1) ^ v, 0x85ebca6b);
    this.sigB ^= Math.imul((addr * 0x10001) ^ Math.imul(old, 0xc2b2ae35), 0x27d4eb2f) ^ Math.imul((addr * 0x10001) ^ Math.imul(v, 0xc2b2ae35), 0x27d4eb2f);
    p[i] = v;
  }

  /** Store without hooks or protection (for peripherals). */
  poke(addr: number, words: number, v: number): void {
    this.set16(addr, v & 0xffff);
    if (words === 2) this.set16(addr + 1, (v >>> 16) & 0xffff);
  }

  /** CPU read of 1 or 2 words; returns an unsigned value. */
  read(addr: number, words: number): number {
    const h = this.regs.get(addr);
    if (!h) return this.peek(addr, words);
    if (h.live) this.liveReads++;
    const stored = this.peek(h.addr, h.words);
    let v = stored;
    if (h.read) {
      const unit = this.readMask || (words === 1 ? 0xffff : 0xffffffff);
      this.reqMask = (unit * 2 ** ((addr - h.addr) * 16)) >>> 0;
      v = h.read(stored) >>> 0;
      this.reqMask = 0xffffffff;
    }
    if (h.words === words && h.addr === addr) return words === 1 ? v & 0xffff : v;
    // Partial access to a 32-bit register (or a 2-word read starting at a 16-bit one).
    const shift = (addr - h.addr) * 16;
    const lo = (v >>> shift) & 0xffff;
    if (words === 1) return lo;
    return ((this.read(addr + 1, 1) << 16) | lo) >>> 0;
  }

  /** CPU write of 1 or 2 words. */
  write(addr: number, words: number, v: number): void {
    const h = this.regs.get(addr);
    if (!h) {
      this.poke(addr, words, v);
      return;
    }
    if (!(h.words === words && h.addr === addr)) {
      if (words === 2 && h.words === 1) {
        this.write(addr, 1, v & 0xffff);
        this.write(addr + 1, 1, (v >>> 16) & 0xffff);
        return;
      }
      // One word of a 32-bit register: merge with the stored value.
      const stored = this.peek(h.addr, 2);
      const shift = (addr - h.addr) * 16;
      v = ((stored & ~(0xffff << shift)) | ((v & 0xffff) << shift)) >>> 0;
    }
    if (h.protect && !this.eallow) {
      this.onProtectedWrite(h);
      return;
    }
    if ((h.write || h.after) && !h.quiet) this.writes++;
    const before = this.peek(h.addr, h.words);
    const mask = h.words === 1 ? 0xffff : 0xffffffff;
    const val = (v & mask) >>> 0;
    const store = h.write ? h.write(val, before) >>> 0 : val;
    this.poke(h.addr, h.words, store);
    this.onWrite?.(h, val, before);
    h.after?.(val, before);
  }
}
