// External interrupts XINT1 and XINT2 (HW4 uses them on push buttons).
// TRM section 3.4 "Peripheral Interrupts" and the XINT1CR / XINT2CR
// register tables (Table 3-71): a GPIO pin, chosen through the input
// X-BAR (INPUT4SELECT for XINT1, INPUT5SELECT for XINT2), raises the
// interrupt on the edge that POLARITY selects when ENABLE is 1.
//   POLARITY 0 or 2: falling edge, 1: rising edge, 3: both edges.
// XINT1 is PIE INT1.4 and XINT2 is INT1.5 (TRM Table 3-2).
// Not modelled: XINT3 to XINT5, the XINTnCTR counters, input qualification.

import type { SimPlugin } from "../plugin";

export const plugin: SimPlugin = {
  name: "xint",
  // The TI helper functions, as in F2837xD_Gpio.c.
  prelude: `
void GPIO_SetupXINT1Gpio(Uint16 gpioNumber)
{
    EALLOW;
    InputXbarRegs.INPUT4SELECT = gpioNumber;      //Set XINT1 source to GPIO-pin
    EDIS;
}
void GPIO_SetupXINT2Gpio(Uint16 gpioNumber)
{
    EALLOW;
    InputXbarRegs.INPUT5SELECT = gpioNumber;      //Set XINT2 source to GPIO-pin
    EDIS;
}
`,
  install(b) {
    const lines = [
      { cr: "XintRegs.XINT1CR", sel: "InputXbarRegs.INPUT4SELECT", channel: 4 },
      { cr: "XintRegs.XINT2CR", sel: "InputXbarRegs.INPUT5SELECT", channel: 5 },
    ];
    b.gpio.listeners.push((pin, level) => {
      for (const l of lines) {
        if (!b.dev.get(l.cr, "ENABLE") || b.dev.get(l.sel) !== pin) continue;
        const pol = b.dev.get(l.cr, "POLARITY");
        const wanted = pol === 3 || (pol === 1 ? level === 1 : level === 0);
        if (wanted) b.pie.raise(1, l.channel);
      }
    });
  },
};
