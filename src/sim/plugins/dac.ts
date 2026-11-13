// Buffered DAC A/B/C. TRM chapter 12 "Buffered Digital-to-Analog Converter
// (DAC)": DACOUT = DACVALA * DACREF / 4096. Code writes the shadow register
// DACVALS; with DACCTL.LOADMODE = 0 it is copied to the active register
// DACVALA on the next SYSCLK. The output pin is driven only while
// DACOUTEN.DACOUTEN = 1.
//
// This file is also the reference example of a simulator plugin: see
// docs/PLUGINS.md.

import type { SimPlugin } from "../plugin";

/** DACREF with DACREFSEL = 1 (VREFHI) on the LaunchPad: 3.0 V. */
const VREF = 3.0;

export const plugin: SimPlugin = {
  name: "dac",
  install(b) {
    for (const ch of ["a", "b", "c"]) {
      const pre = `Dac${ch}Regs`;
      const out = `DAC${ch.toUpperCase()}`;
      const update = () => {
        const dev = b.dev;
        const enabled = dev.get(`${pre}.DACOUTEN`, "DACOUTEN") === 1;
        // Not enabled: the pin is not driven by the DAC; report 0 V.
        b.publish(out, enabled ? (dev.get(`${pre}.DACVALA`, "DACVALA") * VREF) / 4096 : 0);
      };
      b.dev.reg(`${pre}.DACVALS`).hook.after = (v) => {
        b.dev.set(`${pre}.DACVALA`, v & 0xfff);
        update();
      };
      b.dev.reg(`${pre}.DACOUTEN`).hook.after = update;
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
