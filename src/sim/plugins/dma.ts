// Direct Memory Access (DMA) controller, six channels. TRM chapter 5
// "Direct Memory Access (DMA)":
//   5.3.3  trigger sources (Table 5-1, DmaClaSrcSelRegs.DMACHSRCSELx), the
//          PERINTFLG latch, PERINTFRC / PERINTCLR, MODE.PERINTSEL = channel
//          number (Figure 5-3)
//   5.4    burst loop and transfer loop, shadow -> active address copy at
//          the start of every transfer, burst / transfer / wrap steps,
//          ONESHOT, CONTINUOUS, CHINTMODE, Table 5-2 (BURSTSIZE vs DATASIZE),
//          state diagram Figure 5-5
//   5.8    overrun detection (OVRFLG, OVRINTE)
//   5.9    registers: DMACTRL.HARDRESET, CHx.MODE, CHx.CONTROL (write-1-to-set
//          command bits that read 0, read-only status bits), SOFTRESET, HALT
// Channel x interrupts through the PIE as INT7.x (TRM Table 3-2,
// PieVectTable.DMA_CHx_INT).
//
// Simplifications:
// - A burst takes no time (the real DMA needs about 3 SYSCLK cycles per
//   word, section 5.5), and there is no arbitration: a trigger is served at
//   once, so the round-robin / channel 1 priority schemes (5.7) never matter.
// - Data moves with mem.peek / mem.poke: the source is read as stored (an
//   ADC result register), and writing to a peripheral register as the
//   destination does not run that peripheral's hooks.
// - Trigger sources modelled: ADCxINT1..4, EPWMnSOCA/B, TINT0..2. The others
//   in Table 5-1 (ADCxEVT, XINT, McBSP, SD, SPI, CLB, USB) never fire.
// - The "clear" the DMA sends back to the trigger source (5.3.3) is not
//   modelled; the course's ADC setup uses INT1CONT = 1, which does not need it.
// - DEBUGCTRL and PRIORITYCTRL1 are stored only.
//
// One deliberate difference from the TRM text: SRC_WRAP_SIZE and
// DST_WRAP_SIZE start at 0xFFFF (wrapping disabled) here, also after
// HARDRESET. TRM revision I lists their reset value as 0h, but with 0 the
// state diagram of Figure 5-5 would wrap the address back to
// xxx_BEG_ADDR (0) after every burst, and neither the course's InitDma()
// nor TI's F28379D workshop code writes the wrap registers: both rely on
// wrapping being off after reset, and both work on the real chip.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";

/** TRM Table 5-1: DMACHSRCSELx value -> trigger line name used on the board. */
export function dmaTriggerName(sel: number): string | null {
  if (sel >= 1 && sel <= 19 && sel % 5 !== 0) return `ADC${"ABCD"[Math.floor((sel - 1) / 5)]}INT${((sel - 1) % 5) + 1}`;
  if (sel >= 36 && sel <= 59) return `EPWM${Math.floor((sel - 36) / 2) + 1}SOC${(sel - 36) % 2 ? "B" : "A"}`;
  if (sel >= 68 && sel <= 70) return `TINT${sel - 68}`;
  return null;
}

// CONTROL bits
const RUN = 1 << 0;
const HALT = 1 << 1;
const SOFTRESET = 1 << 2;
const PERINTFRC = 1 << 3;
const PERINTCLR = 1 << 4;
const ERRCLR = 1 << 7;
const PERINTFLG = 1 << 8;
const TRANSFERSTS = 1 << 11;
const BURSTSTS = 1 << 12;
const RUNSTS = 1 << 13;
const OVRFLG = 1 << 14;
const STATUS = PERINTFLG | TRANSFERSTS | BURSTSTS | RUNSTS | OVRFLG;

const s16 = (v: number) => (v << 16) >> 16;

function channel(b: Board, ch: number) {
  const dev = b.dev;
  const p = `DmaRegs.CH${ch}`;
  const get = (r: string, f?: string) => dev.get(`${p}.${r}`, f);
  const set = (r: string, v: number) => dev.set(`${p}.${r}`, v >>> 0);
  const ctl = () => get("CONTROL");
  const flag = (bits: number, on: boolean) => set("CONTROL", on ? ctl() | bits : ctl() & ~bits);
  const interrupt = () => {
    if (get("MODE", "CHINTE")) b.pie.raise(7, ch);
  };

  /** One side (SRC or DST) after a burst: transfer step, or the wrap procedure. */
  const advance = (side: "SRC" | "DST") => {
    const count = get(`${side}_WRAP_COUNT`);
    if (count > 0) {
      set(`${side}_WRAP_COUNT`, count - 1);
      set(`${side}_ADDR_ACTIVE`, get(`${side}_ADDR_ACTIVE`) + s16(get(`${side}_TRANSFER_STEP`)));
    } else {
      set(`${side}_WRAP_COUNT`, get(`${side}_WRAP_SIZE`));
      const beg = (get(`${side}_BEG_ADDR_ACTIVE`) + s16(get(`${side}_WRAP_STEP`))) >>> 0;
      set(`${side}_BEG_ADDR_ACTIVE`, beg);
      set(`${side}_ADDR_ACTIVE`, beg);
    }
  };

  /** Serves the pending trigger: one burst, or the whole transfer in one-shot mode. */
  const serve = () => {
    while (ctl() & PERINTFLG && ctl() & RUNSTS) {
      flag(PERINTFLG, false);
      const oneShot = get("MODE", "ONESHOT") === 1;
      for (;;) {
        if (!(ctl() & TRANSFERSTS)) {
          // Start of a transfer: every shadow register is copied to its active register.
          for (const r of ["SRC_BEG_ADDR", "DST_BEG_ADDR", "SRC_ADDR", "DST_ADDR"]) set(`${r}_ACTIVE`, get(`${r}_SHADOW`));
          set("SRC_WRAP_COUNT", get("SRC_WRAP_SIZE"));
          set("DST_WRAP_COUNT", get("DST_WRAP_SIZE"));
          set("TRANSFER_COUNT", get("TRANSFER_SIZE"));
          flag(TRANSFERSTS, true);
          if (get("MODE", "CHINTMODE") === 0) interrupt();
        }
        // Burst loop. Sizes and steps count 16-bit words whatever DATASIZE is (Table 5-2).
        const wide = get("MODE", "DATASIZE") === 1;
        const words = wide ? 2 : 1;
        let left = get("BURST_SIZE", "BURSTSIZE");
        for (;;) {
          b.mem.poke(get("DST_ADDR_ACTIVE"), words, b.mem.peek(get("SRC_ADDR_ACTIVE"), words));
          if (left < words) break;
          left -= words;
          set("SRC_ADDR_ACTIVE", get("SRC_ADDR_ACTIVE") + s16(get("SRC_BURST_STEP")));
          set("DST_ADDR_ACTIVE", get("DST_ADDR_ACTIVE") + s16(get("DST_BURST_STEP")));
        }
        set("BURST_COUNT", 0);
        const remaining = get("TRANSFER_COUNT");
        if (remaining > 0) {
          set("TRANSFER_COUNT", remaining - 1);
          advance("SRC");
          advance("DST");
          if (oneShot) continue;
          break;
        }
        // End of the transfer.
        flag(TRANSFERSTS, false);
        if (get("MODE", "CHINTMODE") === 1) interrupt();
        if (!get("MODE", "CONTINUOUS")) flag(RUNSTS, false);
        break;
      }
    }
  };

  /** A trigger event (peripheral or forced) reaches the channel's latch (Figure 5-4). */
  const event = () => {
    if (ctl() & PERINTFLG) {
      // The previous trigger has not been served yet: this one is lost.
      flag(OVRFLG, true);
      if (get("MODE", "OVRINTE")) interrupt();
      return;
    }
    flag(PERINTFLG, true);
    serve();
  };

  const reset = () => {
    for (const r of ["BURST_COUNT", "TRANSFER_COUNT", "SRC_WRAP_COUNT", "DST_WRAP_COUNT"]) set(r, 0);
    flag(RUNSTS | TRANSFERSTS | BURSTSTS, false);
  };

  const source = () => dev.get(`DmaClaSrcSelRegs.DMACHSRCSEL${ch <= 4 ? 1 : 2}`, `CH${ch}`);

  const control = dev.reg(`${p}.CONTROL`).hook;
  // Command bits are write-1-to-set and read 0; status bits are read-only.
  control.write = (_v, stored) => stored & STATUS;
  control.after = (v) => {
    if (v & SOFTRESET) reset();
    if (v & ERRCLR) flag(OVRFLG, false);
    if (v & PERINTCLR) flag(PERINTFLG, false);
    if (v & HALT) flag(RUNSTS, false);
    if (v & PERINTFRC && get("MODE", "PERINTE")) event();
    if (v & RUN) {
      const sel = source();
      if (get("MODE", "PERINTE") && get("MODE", "PERINTSEL") !== ch)
        b.warn(
          b.line,
          "dma-perintsel",
          `DMA channel ${ch} was started with MODE.PERINTSEL = ${get("MODE", "PERINTSEL")}. These legacy bits must hold the channel number (${ch}), ` +
            `or the trigger chosen in DMACHSRCSEL never reaches the channel (TRM 5.3.3). The course code writes DmaRegs.CH1.MODE.all = 0x8901; for channel 1.`,
        );
      else if (get("MODE", "PERINTE") && sel !== 0 && !dmaTriggerName(sel))
        b.warn(b.line, "dma-source", `DMA channel ${ch} uses trigger source ${sel}, which this simulator does not model: only ADC interrupts, ePWM SOCA/SOCB and TINT0..2 fire.`);
      if (!get("SRC_ADDR_SHADOW") || !get("DST_ADDR_SHADOW"))
        b.warn(
          b.line,
          "dma-address",
          `DMA channel ${ch} was started while ${!get("SRC_ADDR_SHADOW") ? "SRC_ADDR_SHADOW" : "DST_ADDR_SHADOW"} is 0. ` +
            `Write the source and destination addresses (between EALLOW; and EDIS;) before setting RUN.`,
        );
      flag(RUNSTS, true);
      serve();
    }
  };

  return {
    /** A peripheral trigger line fired. */
    trigger(name: string) {
      if (!get("MODE", "PERINTE") || get("MODE", "PERINTSEL") !== ch) return;
      if (dmaTriggerName(source()) === name) event();
    },
    hardReset() {
      for (const r of dev.regs.keys()) if (r.startsWith(`${p}.`)) dev.set(r, 0);
      set("SRC_WRAP_SIZE", 0xffff);
      set("DST_WRAP_SIZE", 0xffff);
    },
  };
}

export const plugin: SimPlugin = {
  name: "dma",
  install(b) {
    const dev = b.dev;
    const chans = [1, 2, 3, 4, 5, 6].map((ch) => channel(b, ch));
    chans.forEach((c) => c.hardReset());

    const names = new Set<string>();
    for (let sel = 1; sel < 256; sel++) {
      const n = dmaTriggerName(sel);
      if (n) names.add(n);
    }
    for (const n of names) b.onTrigger(n, () => chans.forEach((c) => c.trigger(n)));

    // DMACTRL: both bits are write-1-to-set and read back 0.
    const dmactrl = dev.reg("DmaRegs.DMACTRL").hook;
    dmactrl.write = () => 0;
    dmactrl.after = (v) => {
      if (v & 1) {
        chans.forEach((c) => c.hardReset());
        dev.set("DmaRegs.DEBUGCTRL", 0);
        dev.set("DmaRegs.PRIORITYCTRL1", 0);
      }
    };

    // Trigger source selection can be locked until the next reset.
    const lock = dev.reg("DmaClaSrcSelRegs.DMACHSRCSELLOCK").hook;
    lock.write = (v, stored) => stored | (v & 3);
    for (const n of [1, 2]) {
      dev.reg(`DmaClaSrcSelRegs.DMACHSRCSEL${n}`).hook.write = (v, stored) =>
        dev.get("DmaClaSrcSelRegs.DMACHSRCSELLOCK", `DMACHSRCSEL${n}`) ? stored : v;
    }
  },
};
