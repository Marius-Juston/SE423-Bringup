// Register description pages of the Technical Reference Manual (SPRUHM8I),
// transcribed for the registers whose pages the game shows: the heading,
// the bit-field figure (name, access type and reset value of every field)
// and the field description table (Bit, Field, Type, Reset, Description).
// The course's condensed references (EPWM_Peripheral.pdf, ADC_Peripheral.pdf,
// SPICondensed_TechRef.pdf) are these same pages.
//
// The register map (registers.json, from TI's headers) has the fields and
// their bits but not the Type and Reset columns, so those and the
// descriptions are typed in here from the manual. tests/doc_tables.test.ts
// checks every field's bits against the register map, and the write
// protection against the simulator's.
//
//   TCR         3.15.2.3    Figure 3-27   Table 3-22   (summary: Table 3-18)
//   XINT1CR     3.15.6.1    Figure 3-68   Table 3-71   (summary: Table 3-69)
//   GPAMUX1     8.9.2.4     Figure 8-7    Table 8-17   (summary: Table 8-12)
//   ADCSOC0CTL  11.16.2.17  Figure 11-42  Table 11-32  (summary: Table 11-14)
//
// Not transcribed: "Reset type: SYSRSn" (the same on every field here) and
// the differential-mode half of CHSEL, which the course never uses.

export interface PageField {
  /** Field name as the manual prints it; reserved fields are "RESERVED". */
  name: string;
  hi: number;
  lo: number;
  /** The Type column: "R", "R/W", "R/W1C", "R-0". */
  type: string;
  /** The Reset column: "0h", "1h". */
  reset: string;
  /** The Description column, one printed line per entry. */
  desc: string[];
}

export interface RegisterPage {
  /** Name in the register map: "CpuTimer0Regs.TCR". */
  reg: string;
  /** The manual's short name: "TCR". */
  acronym: string;
  /** The page's heading line. */
  heading: string;
  /** One line under the heading: the register's full name. */
  name: string;
  /** Lines the manual prints between the name and the figure, if any. */
  notes?: string[];
  figure: string;
  table: string;
  /** Section key of src/levels/trm-index.json for the link, and the page of the PDF. */
  section: string;
  page: number;
  /** The "Write Protection" column of the peripheral's register summary table. */
  protection: { table: string; value: "EALLOW" | "" };
  /** Fields from the highest bit down, reserved ones included, as the table lists them. */
  fields: PageField[];
}

const mux = (pin: number): PageField => ({ name: `GPIO${pin}`, hi: 2 * pin + 1, lo: 2 * pin, type: "R/W", reset: "0h", desc: ["Defines pin-muxing selection for GPIO"] });

const TRIGGERS = [
  "Software only", "CPU1 Timer 0, TINT0n", "CPU1 Timer 1, TINT1n", "CPU1 Timer 2, TINT2n", "GPIO, ADCEXTSOC",
  ...Array.from({ length: 24 }, (_, i) => `ePWM${(i >> 1) + 1}, ADCSOC${i & 1 ? "B" : "A"}`),
  "CPU2 Timer 0, TINT0n", "CPU2 Timer 1, TINT1n", "CPU2 Timer 2, TINT2n",
];
const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, "0") + "h";

/** One row of the TRIGSEL list of Table 11-32: value, the manual's text. */
export const ADC_TRIGGERS: { value: number; text: string }[] = TRIGGERS.map((t, i) => ({ value: i, text: `${hex(i, 2)} ADCTRIG${i} - ${t}` }));

export const REGISTER_PAGES: RegisterPage[] = [
  {
    reg: "CpuTimer0Regs.TCR",
    acronym: "TCR",
    heading: "3.15.2.3 TCR Register (Offset = 4h) [reset = 1h]",
    name: "CPU-Timer, Control Register",
    figure: "Figure 3-27. TCR Register",
    table: "Table 3-22. TCR Register Field Descriptions",
    section: "3.15.2",
    page: 170,
    protection: { table: "Table 3-18", value: "" },
    fields: [
      {
        name: "TIF", hi: 15, lo: 15, type: "R/W1C", reset: "0h",
        desc: [
          "CPU-Timer Overflow Flag.",
          "TIF indicates whether a timer overflow has happened since TIF was last cleared. TIF is not cleared automatically and does not need to be cleared to enable the next timer interrupt.",
          "0h (R/W) = The CPU-Timer has not decremented to zero. Writes of 0 are ignored.",
          "1h (R/W) = This flag gets set when the CPU-timer decrements to zero. Writing a 1 to this bit clears the flag.",
        ],
      },
      {
        name: "TIE", hi: 14, lo: 14, type: "R/W", reset: "0h",
        desc: [
          "CPU-Timer Interrupt Enable.",
          "0h (R/W) = The CPU-Timer interrupt is disabled.",
          "1h (R/W) = The CPU-Timer interrupt is enabled. If the timer decrements to zero, and TIE is set, the timer asserts its interrupt request.",
        ],
      },
      { name: "RESERVED", hi: 13, lo: 12, type: "R", reset: "0h", desc: ["Reserved"] },
      {
        name: "FREE", hi: 11, lo: 11, type: "R/W", reset: "0h",
        desc: [
          "If the FREE bit is set to 1, then, upon a software breakpoint, the timer continues to run. If FREE is 0, then the SOFT bit controls the emulation behavior.",
          "0h (R/W) = Stop after the next decrement of the TIMH:TIM (hard stop) (SOFT bit controls the emulation behavior)",
          "1h (R/W) = Free Run (SOFT bit is don't care, counter is free running)",
        ],
      },
      {
        name: "SOFT", hi: 10, lo: 10, type: "R/W", reset: "0h",
        desc: [
          "If the FREE bit is set to 1, then, upon a software breakpoint, the timer continues to run (that is, free runs). In this case, SOFT is a don't care. But if FREE is 0, then SOFT takes effect.",
          "0h (R/W) = Stop after the next decrement of the TIMH:TIM (hard stop). (ONLY if FREE=0, if FREE=1 this bit is don't care)",
          "1h (R/W) = Stop after the TIMH:TIM decrements to 0 (soft stop) In the SOFT STOP mode, the timer generates an interrupt before shutting down (since reaching 0 is the interrupt causing condition). (ONLY if FREE=0, if FREE=1 this bit is don't care)",
        ],
      },
      { name: "RESERVED", hi: 9, lo: 6, type: "R", reset: "0h", desc: ["Reserved"] },
      {
        name: "TRB", hi: 5, lo: 5, type: "R/W", reset: "0h",
        desc: [
          "Timer reload",
          "0h (R/W) = The TRB bit is always read as zero. Writes of 0 are ignored.",
          "1h (R/W) = When you write a 1 to TRB, the TIMH:TIM is loaded with the value in the PRDH:PRD, and the prescaler counter (PSCH:PSC) is loaded with the value in the timer dividedown register (TDDRH:TDDR).",
        ],
      },
      {
        name: "TSS", hi: 4, lo: 4, type: "R/W", reset: "0h",
        desc: [
          "CPU-Timer stop status bit.",
          "TSS is a 1-bit flag that stops or starts the CPU-timer.",
          "0h (R/W) = Reads of 0 indicate the CPU-timer is running. To start or restart the CPU-timer, set TSS to 0. At reset, TSS is cleared to 0 and the CPU-timer immediately starts.",
          "1h (R/W) = Reads of 1 indicate that the CPU-timer is stopped. To stop the CPU-timer, set TSS to 1.",
        ],
      },
      { name: "RESERVED", hi: 3, lo: 0, type: "R", reset: "1h", desc: ["Reserved"] },
    ],
  },
  {
    reg: "XintRegs.XINT1CR",
    acronym: "XINT1CR",
    heading: "3.15.6.1 XINT1CR Register (Offset = 0h) [reset = 0h]",
    name: "XINT1 configuration register",
    figure: "Figure 3-68. XINT1CR Register",
    table: "Table 3-71. XINT1CR Register Field Descriptions",
    section: "3.15.6",
    page: 247,
    protection: { table: "Table 3-69", value: "" },
    fields: [
      { name: "RESERVED", hi: 15, lo: 4, type: "R-0", reset: "0h", desc: ["Reserved"] },
      {
        name: "POLARITY", hi: 3, lo: 2, type: "R/W", reset: "0h",
        desc: [
          "00: Interrupt is selected as negative edge triggered",
          "01: Interrupt is selected as positive edge triggered",
          "10: Interrupt is selected as negative edge triggered",
          "11: Interrupt is selected as positive or negative edge triggered",
        ],
      },
      { name: "RESERVED", hi: 1, lo: 1, type: "R-0", reset: "0h", desc: ["Reserved"] },
      { name: "ENABLE", hi: 0, lo: 0, type: "R/W", reset: "0h", desc: ["0: Interrupt Disabled", "1: Interrupt Enabled"] },
    ],
  },
  {
    reg: "GpioCtrlRegs.GPAMUX1",
    acronym: "GPAMUX1",
    heading: "8.9.2.4 GPAMUX1 Register (Offset = 6h) [reset = 0h]",
    name: "GPIO A Mux 1 Register (GPIO0 to 15)",
    notes: [
      "Defines pin-muxing selection for GPIO.",
      "Notes: The respective GPyGMUXn.GPIOz must be configured prior to this register to avoid intermediate peripheral selects being mapped to the GPIO.",
    ],
    figure: "Figure 8-7. GPAMUX1 Register",
    table: "Table 8-17. GPAMUX1 Register Field Descriptions",
    section: "8.9.2",
    page: 975,
    protection: { table: "Table 8-12", value: "EALLOW" },
    fields: Array.from({ length: 16 }, (_, i) => mux(15 - i)),
  },
  {
    reg: "AdcaRegs.ADCSOC0CTL",
    acronym: "ADCSOC0CTL",
    heading: "11.16.2.17 ADCSOC0CTL Register (Offset = 10h) [reset = 0h]",
    name: "ADC SOC0 Control Register",
    figure: "Figure 11-42. ADCSOC0CTL Register",
    table: "Table 11-32. ADCSOC0CTL Register Field Descriptions",
    section: "11.16.2",
    page: 1636,
    protection: { table: "Table 11-14", value: "EALLOW" },
    fields: [
      { name: "RESERVED", hi: 31, lo: 25, type: "R", reset: "0h", desc: ["Reserved"] },
      {
        name: "TRIGSEL", hi: 24, lo: 20, type: "R/W", reset: "0h",
        desc: [
          "SOC0 Trigger Source Select. Along with the SOC0 field in the ADCINTSOCSEL1 register, this bit field configures which trigger will set the SOC0 flag in the ADCSOCFLG1 register to initiate a conversion to start once priority is given to it.",
          ...ADC_TRIGGERS.map((t) => t.text),
        ],
      },
      { name: "RESERVED", hi: 19, lo: 19, type: "R", reset: "0h", desc: ["Reserved"] },
      {
        name: "CHSEL", hi: 18, lo: 15, type: "R/W", reset: "0h",
        desc: [
          "SOC0 Channel Select. Selects the channel to be converted when SOC0 is received by the ADC.",
          "Single-ended Signaling Mode (SIGNALMODE = 0):",
          ...Array.from({ length: 16 }, (_, i) => `${hex(i, 1)} ADCIN${i}`),
        ],
      },
      { name: "RESERVED", hi: 14, lo: 9, type: "R", reset: "0h", desc: ["Reserved"] },
      {
        name: "ACQPS", hi: 8, lo: 0, type: "R/W", reset: "0h",
        desc: [
          "SOC0 Acquisition Prescale. Controls the sample and hold window for this SOC. The configured acquisition time must be at least as long as one ADCCLK cycle for correct ADC operation. The device datasheet will also specify a minimum sample and hold window duration.",
          "000h Sample window is 1 system clock cycle wide",
          "001h Sample window is 2 system clock cycles wide",
          "002h Sample window is 3 system clock cycles wide",
          "...",
          "1FFh Sample window is 512 system clock cycles wide",
        ],
      },
    ],
  },
];

export const registerPage = (reg: string): RegisterPage | undefined => REGISTER_PAGES.find((p) => p.reg === reg);

/** What a Type entry of the manual means, in plain words. */
export function typeMeaning(type: string): string {
  switch (type) {
    case "R":
      return "R: read only. Your program can read it. A write changes nothing.";
    case "R-0":
      return "R-0: reads always give 0. A write changes nothing.";
    case "R/W":
      return "R/W: read and write. It keeps the value you write, and reading gives it back.";
    case "R/W1C":
      return "R/W1C: read, and write 1 to clear. The hardware sets the bit. Writing 1 puts it back to 0. Writing 0 does nothing.";
    case "R-0/W1S":
      return "R-0/W1S: reads always give 0, and writing 1 sets it (starts the action). Writing 0 does nothing.";
    default:
      return `${type}: see the manual's register legend.`;
  }
}

/** What a Reset entry means: the value the field holds after the chip is reset. */
export function resetMeaning(f: PageField): string {
  const bits = f.hi - f.lo + 1;
  const v = parseInt(f.reset, 16);
  return `Reset ${f.reset}: after a reset ${bits === 1 ? "this bit reads" : `these ${bits} bits read`} ${v} (h marks a hexadecimal number).`;
}
