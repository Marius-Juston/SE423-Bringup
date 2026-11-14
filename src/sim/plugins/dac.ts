// Buffered DAC A/B/C. TRM chapter 12 "Buffered Digital-to-Analog Converter
// (DAC)": DACOUT = DACVALA * DACREF / 4096. Code writes the shadow register
// DACVALS; with DACCTL.LOADMODE = 0 it is copied to the active register
// DACVALA on the next SYSCLK. The output pin is driven only while
// DACOUTEN.DACOUTEN = 1.
//
// Course library functions (SE423Lib.h): setDACA(float volts) and
// setDACB(float volts). The course's robot library provides them, and students
// fill in their scaling line in Lab 4 (exercise 1), so the game never prints
// their C source: they are native here. The voltage is limited to 0..3.0 V
// and mapped on a straight line to DACVALS, 3.0 V giving the largest 12-bit
// number; the fraction is cut off, as C does when a float is assigned to the
// register. DACVALS is written as a CPU write, so the diagnostics below see it
// on the line of the call. A call takes the simulated time of the three to
// five C statements such a function has. A student's file may define functions
// of the same names (saved programs from before the library had them do): the
// student's definition then replaces the library's.
//
// This file is also the reference example of a simulator plugin: see
// docs/PLUGINS.md.

import type { SimPlugin } from "../plugin";

/** DACREF with DACREFSEL = 1 (VREFHI) on the LaunchPad: 3.0 V. */
const VREF = 3.0;

export const plugin: SimPlugin = {
  name: "dac",
  prelude: `
void setDACA(float volts);
void setDACB(float volts);
`,
  install(b) {
    // The course's DAC functions: volts to DACVALS, with single-precision arithmetic as on the chip.
    const fr = Math.fround;
    for (const ch of ["a", "b"]) {
      const name = `setDAC${ch.toUpperCase()}`;
      const vals = b.dev.reg(`Dac${ch}Regs.DACVALS`);
      b.compiler.defineNative(name, (args, _types, line) => {
        // One step for each C statement: two tests, one more where a limit applies, one assignment.
        let v = fr(args[0]);
        b.tick(line);
        if (v > VREF) {
          b.tick(line);
          v = VREF;
        }
        b.tick(line);
        if (v < 0) {
          b.tick(line);
          v = 0;
        }
        b.tick(line);
        const counts = Math.trunc(fr(fr(v * 4095) / VREF)) & 0xfff;
        // The 12-bit field is written; the upper bits of the register are kept.
        b.mem.write(vals.addr, 1, (b.mem.read(vals.addr, 1) & 0xf000) | counts);
        return 0;
      });
      b.compiler.fns.get(name)!.replaceable = true;
    }
    for (const ch of ["a", "b", "c"]) {
      const pre = `Dac${ch}Regs`;
      const out = `DAC${ch.toUpperCase()}`;
      const update = () => {
        const dev = b.dev;
        const enabled = dev.get(`${pre}.DACOUTEN`, "DACOUTEN") === 1;
        // Not enabled: the pin is not driven by the DAC; report 0 V.
        if (enabled && dev.get(`${pre}.DACCTL`, "DACREFSEL") === 0)
          b.warn(b.line, `dac-ref-${ch}`, `DAC${ch.toUpperCase()} is using the VDAC pin as its reference (DACREFSEL = 0). The course uses the 3.0 V reference VREFHI: set ${pre}.DACCTL.bit.DACREFSEL = 1. The value shown assumes 3.0 V.`);
        b.publish(out, enabled ? (dev.get(`${pre}.DACVALA`, "DACVALA") * VREF) / 4096 : 0);
      };
      // A value written while the output is off; taken back if DACOUTEN is set later.
      let offKey = "";
      b.dev.reg(`${pre}.DACVALS`).hook.after = (v) => {
        b.dev.set(`${pre}.DACVALA`, v & 0xfff);
        if (v & 0xfff && !b.libDepth && !offKey && b.dev.get(`${pre}.DACOUTEN`, "DACOUTEN") === 0) {
          offKey = `dac-off-${ch}:${b.line}`;
          b.warn(b.line, `dac-off-${ch}`, `${pre}.DACVALS was written, but the output of DAC${ch.toUpperCase()} is switched off (DACOUTEN = 0), so the pin stays at 0 V. Between EALLOW; and EDIS; write ${pre}.DACOUTEN.bit.DACOUTEN = 1;`);
        }
        update();
      };
      // TRM Table 12-2: the value registers are not write-protected (the
      // course writes DACVALS from interrupt functions without EALLOW).
      b.dev.reg(`${pre}.DACVALS`).hook.protect = false;
      b.dev.reg(`${pre}.DACVALA`).hook.protect = false;
      b.dev.reg(`${pre}.DACOUTEN`).hook.after = (v) => {
        if (v & 1 && offKey) {
          b.diagnostics.delete(offKey);
          offKey = "";
        }
        update();
      };
      b.dev.reg(`${pre}.DACCTL`).hook.after = update;
    }
  },
  parts: {
    robot: [
      { kind: "meter", id: "DACA", label: "DACA output", output: "DACA", unit: "V", digits: 3 },
      { kind: "meter", id: "DACB", label: "DACB output", output: "DACB", unit: "V", digits: 3 },
    ],
  },
};
