import type { Chapter } from "../types";
import type { Stimulus } from "../../sim/runner";

// One example is carried through the whole chapter (it is HW2 exercise 3):
//   EPWM4 SOCA (every 1 ms) -> SOC0 of ADCA (TRIGSEL 11, CHSEL 4, ACQPS 99)
//   -> ADCRESULT0 -> ADCINT1 (INT1SEL 0) -> ADCA1, INT1.1 -> ADCA_ISR

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** EPWM4 as a 1 ms trigger source, as given in HW2 (blanks filled in). */
const EPWM4 = `    EALLOW;
    EPwm4Regs.ETSEL.bit.SOCAEN = 0;      // Disable SOC on A group
    EPwm4Regs.TBCTL.bit.CTRMODE = 3;     // freeze counter
    EPwm4Regs.ETSEL.bit.SOCASEL = 2;     // Select event when counter equal to PRD
    EPwm4Regs.ETPS.bit.SOCAPRD = 1;      // Generate pulse on 1st event
    EPwm4Regs.TBCTR = 0x0;               // Clear counter
    EPwm4Regs.TBPHS.bit.TBPHS = 0x0000;  // Phase is 0
    EPwm4Regs.TBCTL.bit.PHSEN = 0;       // Disable phase loading
    EPwm4Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1, 50 MHz clock
    EPwm4Regs.TBPRD = 50000;             // 1 ms sample period
    EPwm4Regs.ETSEL.bit.SOCAEN = 1;      // enable SOCA
    EPwm4Regs.TBCTL.bit.CTRMODE = 0;     // unfreeze, and enter up count mode
    EDIS;`;

/** ADCA powered up as in HW2. Leaves EALLOW open for the SOC lines that follow. */
const ADC_POWER = `    EALLOW;
    AdcaRegs.ADCCTL2.bit.PRESCALE = 6;     // set ADCCLK divider to /4
    AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcaRegs.ADCCTL1.bit.INTPULSEPOS = 1;  // interrupt pulse at the end of the conversion
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;     // power up the ADC
    DELAY_US(1000);                        // delay for 1 ms to allow ADC time to power up`;

const SOC0 = `    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;     // SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA triggers SOC0`;

const INT1 = (soc: number) => `    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = ${soc};  // the end of SOC${soc} sets the INT1 flag
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;    // enable INT1 flag
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;  // make sure INT1 flag is cleared
    EDIS;`;

const ADC_FULL = `${ADC_POWER}
${SOC0}
${INT1(0)}`;

const VECTOR = `    EALLOW;
    PieVectTable.ADCA1_INT = &ADCA_ISR;
    EDIS;`;

const ENABLE = `    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx1 = 1;   // ADCA1 is INT1.1
    EINT;`;

const LED1 = `    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`;

const ISR_END = `    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;   // clear interrupt flag
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`;

/** A program with the whole chain set up; only globals, extra set-up and the ISR body differ. */
const program = (o: { globals: string; setup?: string; adc?: string; isr: string; vector?: boolean; enable?: boolean }) => `__interrupt void ADCA_ISR(void);

${o.globals}

void main(void)
{
    InitSysCtrl();
    InitGpio();
${o.setup ? `\n${o.setup}\n` : ""}
${PIE_INIT}

${o.vector === false ? "    // TODO: put the address of ADCA_ISR in the vector table (ADCA1_INT)" : VECTOR}

${EPWM4}

${o.adc ?? ADC_FULL}

${o.enable === false ? "    // TODO: enable ADCA1 (INT1.1) in the PIE and in IER\n\n    EINT;" : ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
${o.isr}
}
`;

/** Ripple of +/- 0.2 V around `mid`, changing every millisecond from `from` to `to` ms. */
const ripple = (mid: number, from: number, to: number): Stimulus[] =>
  Array.from({ length: to - from }, (_, i) => ({ at: from + i + 0.5, set: "ADCINA4", value: mid + (i % 2 ? 0.2 : -0.2) }));

export const ch08: Chapter = {
  id: "adc",
  number: 8,
  title: "ADC",
  blurb: "From a voltage to a number: sampling, successive approximation and the SOC chain.",
  requires: ["dac"],
  course: ["L5", "HW2", "Lab 4"],
  levels: [
    {
      id: "adc-brief",
      kind: "brief",
      title: "A voltage becomes a number",
      goal: "Learn what the ADC measures, what 12 bits give you, and the chain from a trigger to your interrupt function.",
      refs: [{ course: "L5" }, { course: "HW2" }, { trm: "11.1" }, { trm: "11.5" }, { trm: "11.9" }],
      brief: `
The DAC turned a number into a voltage. The **ADC** (analog-to-digital converter) goes the other way: it measures the voltage on a pin and gives you a number.

## First, the basics
**A voltage on a pin.** A sensor is a circuit whose output voltage follows something physical. The homework board's photoresistor circuit gives a low voltage in the dark and a higher one in bright light. The wire carries that voltage to the pin **ADCINA4**. At every instant the pin has one voltage, somewhere between 0 V and 3 V, and it changes smoothly as the light changes.

**Sampling.** The CPU cannot follow a smoothly changing voltage. It can only work with numbers, one at a time. So the ADC takes a **sample**: a snapshot of the voltage at one instant. A tiny capacitor is connected to the pin until it has charged to the pin's voltage, then it is disconnected. The capacitor now **holds** that voltage still while it is measured, even if the pin moves on. This is called sample-and-hold.

**What 12 bits buy you.** The measurement gives a 12-bit number, 0 to 4095. The range 0 V to 3.0 V is cut into 2^12 = 4096 equal steps of 3.0 V / 4096 = **0.73 mV**, and the number says which step the voltage is in:

\`\`\`c
ADCRESULT = 4096 * Vin / 3.0      // fraction dropped, limited to 0 ... 4095
\`\`\`

So 0 V gives 0, 1.5 V gives 2048, and anything from 2.99927 V up gives 4095. Rounding a smooth value to the nearest step is called **quantisation**. With 12 bits you cannot see a change smaller than 0.73 mV. With 8 bits the steps would be 11.7 mV.

One sample tells you the voltage at one instant. To follow a changing signal you sample again and again at a steady rate, for example every 1 ms.

## Now the hardware
The chip has four ADCs: ADCA, ADCB, ADCC and ADCD. Each one is **one converter** with several input pins in front of it. ADCA has ADCINA0 to ADCINA5 on the course board. A switch (the multiplexer) connects **one** pin at a time to the converter.

So before every conversion, three questions need an answer: **when** to convert, **which pin**, and **for how long** to sample. You answer them ahead of time by filling in a **SOC**.

A SOC ("start of conversion") is a **configuration slot**: one line of a to-do list. Each ADC has 16 of them, SOC0 to SOC15. One SOC describes one conversion with three settings:

- \`TRIGSEL\`: **when**. Which trigger starts it.
- \`CHSEL\`: **which pin**. The channel number, 4 for ADCINA4.
- \`ACQPS\`: **how long** the capacitor samples the pin.

## The chain
This chapter follows one example from start to finish. It is the one from homework 2: the photoresistor on **ADCINA4**, measured by **SOC0** of ADCA, once every millisecond.

{{figure:adc-chain}}

Follow the figure from left to right:

1. **The trigger.** Something says "now". Here it is the timer of **EPWM4**: every 1 ms it sends a pulse called SOCA. (Other choices: a CPU timer, or your own code.)
2. **SOC0.** Its \`TRIGSEL\` is 11, the number of "EPWM4 SOCA", so SOC0 reacts to that pulse. Its \`CHSEL\` is 4 and its \`ACQPS\` is 99.
3. **The converter.** It connects to ADCINA4, samples for 500 ns, holds, and works out the 12-bit number.
4. **The result.** The number is stored in \`AdcaResultRegs.ADCRESULT0\`. The result register has the **number of the SOC**: SOC0 fills ADCRESULT0, whatever pin it measured.
5. **The interrupt.** When a SOC finishes, that is its "end of conversion". \`ADCINTSEL1N2.INT1SEL\` chooses **which SOC's end** sets the flag ADCINT1. With INT1SEL = 0, the end of SOC0 does.
6. **The CPU.** ADCINT1 goes to the PIE as interrupt **ADCA1** (INT1.1), and the CPU runs your function \`ADCA_ISR\`, which reads ADCRESULT0.

## Three things to keep apart
- **A SOC is not a converter.** It is a slot that holds settings. All 16 SOCs of ADCA share the one converter and take turns.
- **The channel is which pin gets measured.** SOC0 can measure ADCINA4. The SOC number and the channel number have nothing to do with each other.
- **The trigger only says when.** EPWM4 does not measure anything and does not know about pins. It just sends a pulse. Changing the trigger changes the timing and nothing else.

There are also two different things called SOC. "SOCA" is a pulse that an ePWM **sends**. "SOC0" is a slot in the ADC that **listens**. \`TRIGSEL\` is the connection between them.
`,
      questions: [
        {
          prompt: "What is SOC0?",
          options: [
            "The first of 16 converters inside ADCA",
            "The pin ADCINA0",
            "A slot of settings that describes one conversion: when, which pin, how long",
            "The pulse that EPWM4 sends every millisecond",
          ],
          answer: 2,
          why: "ADCA has one converter. Its 16 SOCs are configuration slots that take turns using it.",
        },
        {
          prompt: "SOC0 is set to measure ADCINA4. Where is the result?",
          options: ["`AdcaResultRegs.ADCRESULT4`", "`AdcaResultRegs.ADCRESULT0`", "`AdcaRegs.ADCSOC0CTL`", "`AdcaRegs.ADCINTFLG`"],
          answer: 1,
          why: "The result register has the number of the SOC, not of the pin. SOC0 always fills ADCRESULT0.",
        },
        {
          prompt: "The pin is at 0.75 V. Which 12-bit number does the ADC give?",
          options: ["750", "1024", "2048", "3072"],
          answer: 1,
          why: "0.75 V is a quarter of 3.0 V, and a quarter of 4096 is 1024.",
        },
        {
          prompt: "You change EPWM4 so that it sends its SOCA pulse every 2 ms instead of every 1 ms. What changes?",
          options: [
            "The ADC measures a different pin",
            "The results are half as large",
            "The result moves to ADCRESULT1",
            "Only how often the photoresistor is measured",
          ],
          answer: 3,
          why: "The trigger only says when. Pin, sample time and result register are set in the SOC and stay as they are.",
        },
      ],
      takeaway: "Trigger (when) -> SOCx (TRIGSEL, CHSEL, ACQPS) -> the one converter -> ADCRESULTx -> INTxSEL picks whose end raises ADCINT -> PIE -> your function.",
    },
    {
      id: "adc-quantise",
      kind: "calc",
      title: "Steps of 0.73 mV",
      goal: "Convert between pin voltage and 12-bit result, and see what quantisation does.",
      refs: [{ trm: "11.4.5" }, { trm: "11.4.6" }, { course: "L5" }, { course: "HW2" }],
      brief: `
In the 12-bit mode the course uses, the manual gives:

\`\`\`c
ADCRESULT = 4096 * Vin / 3.0      // fraction dropped; 0 below 0 V, 4095 from 3.0 V up
\`\`\`

and to get back to volts in your code:

\`\`\`c
volts = ADCRESULT * 3.0 / 4096.0;
\`\`\`

Going there and back does not return exactly the voltage you started with: the fraction that was dropped is gone. What comes back is the bottom of the step the voltage was in.

{{figure:quantise}}

Try it in the figure: move the pin voltage and watch which step it lands on and how much is lost. With 3 or 4 bits the steps are easy to see; 12 bits work the same way with steps 256 times finer than 4 bits.

The photoresistor on ADCINA4 is at **1.2 V**. Work out what the ADC reports.
`,
      fields: [
        {
          id: "code",
          label: "ADCRESULT0 for 1.2 V",
          answer: 1638,
          why: "4096 x 1.2 / 3.0 = 1638.4. The fraction is dropped: 1638.",
        },
        {
          id: "back",
          label: "Volts computed from that result",
          unit: "V",
          answer: 1.19971,
          tolPct: 0.01,
          why: "1638 x 3.0 / 4096 = 1.19971 V. The missing 0.29 mV is the quantisation error. It is always less than one step.",
        },
        {
          id: "lsb",
          label: "Size of one step",
          unit: "mV",
          answer: 0.732,
          tolPct: 1,
          why: "3.0 V / 4096 = 0.732 mV. The smallest change the ADC can see.",
        },
        {
          id: "top",
          label: "ADCRESULT0 for 3.3 V on the pin",
          answer: 4095,
          why: "Everything from 3.0 V up reads 4095. The ADC cannot tell 3.0 V from 3.3 V. Never connect more than 3.3 V to a pin.",
        },
      ],
      hints: [
        "Multiply the voltage by 4096 and divide by 3.0, then drop the fraction.",
        "For the way back use the whole number you found, not 1638.4.",
        "1638, 1.19971 V, 0.732 mV, 4095.",
      ],
      takeaway: "The result is the step number: 4096 x Vin / 3.0 without the fraction. Converting back gives the voltage to within 0.73 mV.",
    },
    {
      id: "adc-sar",
      kind: "register",
      title: "Be the converter",
      goal: "Find the 8-bit result for 1.2 V the way the converter does: one bit at a time, from the top.",
      refs: [{ course: "L5" }, { trm: "11.14" }, { trm: "11.1" }],
      brief: `
How does the converter find the number for the voltage it is holding? It has two parts: a **DAC** (the ladder from the last chapter) and a **comparator**, a circuit that only says which of two voltages is higher. With them it plays a guessing game. The method is called **successive approximation** (SAR), and it is a binary search.

For each bit, starting with the top one:

1. **Try it.** Set the bit to 1. The DAC makes the voltage of the number so far.
2. **Compare.** Is the held voltage **at least** as high as the DAC voltage?
3. **Decide.** Yes: the bit stays 1. No: the guess was too high, the bit goes back to 0.

Then the next bit down. Each step halves the range the voltage can still be in. One bit per step, so 12 bits take 12 steps.

{{figure:sar-search}}

Step through the 4-bit search in the figure first, and change the held voltage to see the answers change. Then do the 8-bit one below by hand.

## Your turn
This small converter has **8 bits** and a 3.0 V reference, so the bits are worth 1.5 V, 0.75 V, 0.375 V and so on, as in the ladder puzzle. The held voltage is **1.2 V**.

The first two steps:

- Bit 7: try 1.5 V. Is 1.2 V at least 1.5 V? **No**, so bit 7 = 0.
- Bit 6: try 0.75 V. Is 1.2 V at least 0.75 V? **Yes**, so bit 6 = 1. The number so far is worth 0.75 V.
- Bit 5: try 0.75 + 0.375 = 1.125 V. Is 1.2 V at least that? You continue.

Remember to add the bit you are trying to what you have **kept** so far. Set all eight bits.
`,
      custom: {
        bits: 8,
        fields: [
          { name: "b7", hi: 7, lo: 7, desc: "worth 1.5 V" },
          { name: "b6", hi: 6, lo: 6, desc: "worth 0.75 V" },
          { name: "b5", hi: 5, lo: 5, desc: "worth 0.375 V" },
          { name: "b4", hi: 4, lo: 4, desc: "worth 0.1875 V" },
          { name: "b3", hi: 3, lo: 3, desc: "worth 0.09375 V" },
          { name: "b2", hi: 2, lo: 2, desc: "worth 0.046875 V" },
          { name: "b1", hi: 1, lo: 1, desc: "worth 0.0234375 V" },
          { name: "b0", hi: 0, lo: 0, desc: "worth 0.01171875 V" },
        ],
      },
      initial: 0,
      value: 0x66,
      code: `// 0x66 = 0110 0110 = 102
// Trial voltages: 1.5 no, 0.75 yes, 1.125 yes, 1.3125 no,
//                 1.21875 no, 1.171875 yes, 1.1953125 yes, 1.20703125 no
// Check: 256 * 1.2 / 3.0 = 102.4, fraction dropped: 102`,
      hints: [
        "Bit 5: 1.125 V is below 1.2 V, so it stays 1. Bit 4: 1.125 + 0.1875 = 1.3125 V is too high, so 0.",
        "Bit 3: 1.125 + 0.09375 = 1.21875 V, too high. Bit 2: 1.125 + 0.046875 = 1.171875 V fits.",
        "The result is 0110 0110. You can check it with 256 x 1.2 / 3.0 = 102.4.",
      ],
      takeaway: "Successive approximation is a binary search with a DAC and a comparator: one step per bit, most significant bit first. The bits are worth 1/2, 1/4, 1/8 ... of the reference, which is where the 4096 in the formula comes from.",
    },
    {
      id: "adc-chain",
      kind: "order",
      title: "One sample, start to finish",
      goal: "Put the steps of one photoresistor measurement in order, from the EPWM4 pulse to your interrupt function.",
      refs: [{ trm: "11.5" }, { trm: "11.9" }, { trm: "11.14" }, { course: "HW2" }, { course: "L5" }],
      brief: `
The chapter's example again, with every setting written out:

- EPWM4 sends its **SOCA** pulse every 1 ms.
- SOC0 of ADCA: \`TRIGSEL = 11\` (EPWM4 SOCA), \`CHSEL = 4\` (ADCINA4), \`ACQPS = 99\`.
- \`INT1SEL = 0\` and \`INT1E = 1\`: the end of SOC0 sets the flag ADCINT1.
- ADCINT1 of ADCA is PIE interrupt **ADCA1**, INT1.1, and its vector points to \`ADCA_ISR\`.

One pulse has just left EPWM4. Put what happens next in order.

Think of it as a relay race: the trigger hands over to the SOC, the SOC tells the converter what to do, the converter hands the number to the result register, and the end of the conversion wakes the CPU.
`,
      steps: [
        "EPWM4's counter reaches its period and the ePWM sends an SOCA pulse (the trigger: WHEN)",
        "SOC0 has TRIGSEL = 11, so it reacts to this pulse: its flag in ADCSOCFLG1 is set, a conversion is waiting",
        "The converter is free and takes SOC0: it connects to the pin that SOC0's CHSEL names, ADCINA4 (WHICH PIN)",
        "Sample: the capacitor charges to the pin's voltage for ACQPS + 1 = 100 clock cycles, 500 ns (HOW LONG)",
        "Hold and convert: the capacitor is disconnected and successive approximation finds the 12-bit number",
        "The conversion ends: the number is stored in ADCRESULT0, and because INT1SEL = 0 the flag ADCINT1 is set",
        "ADCINT1 reaches the PIE as ADCA1 (INT1.1) and the CPU jumps to ADCA_ISR",
        "ADCA_ISR reads ADCRESULT0, clears ADCINT1 and acknowledges PIE group 1",
      ],
      hints: [
        "The order is: trigger, SOC, converter, result, interrupt.",
        "Inside the converter: connect to the pin, sample, then hold and convert.",
        "The CPU only gets involved after the conversion has ended. Reading the result is the very last step.",
      ],
      takeaway: "The CPU is not involved until the end. Trigger, SOC and converter are hardware talking to hardware, which is why the sampling is so regular.",
    },
    {
      id: "adc-who",
      kind: "quiz",
      title: "Which setting answers which question",
      goal: "Match the five questions of the chain (when, which pin, how long, where, who tells the CPU) to their registers.",
      refs: [{ trm: "11.5.1" }, { trm: "11.5.2" }, { trm: "11.5.3" }, { trm: "11.5.5" }, { trm: "11.9" }, { course: "HW2" }],
      brief: `
Every link of the chain is one setting. Here is the example with the register lines from homework 2:

\`\`\`c
AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;     // EPWM4 SOCA
AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;        // ADCINA4
AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;       // 100 cycles of 5 ns = 500 ns
AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;    // the end of SOC0 sets ADCINT1
AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;      // ADCINT1 is switched on
adca4result = AdcaResultRegs.ADCRESULT0;  // the result of SOC0
\`\`\`

Each SOC has its own register \`ADCSOCxCTL\` with the three fields. The trigger numbers come from a table in the manual. A few of them:

- 0: software only
- 1, 2, 3: CPU timer 0, 1, 2
- 5: EPWM1 SOCA, 6: EPWM1 SOCB
- 7: EPWM2 SOCA, 8: EPWM2 SOCB
- 9: EPWM3 SOCA, 10: EPWM3 SOCB
- **11: EPWM4 SOCA**, 12: EPWM4 SOCB

Each ADC has four interrupt flags, ADCINT1 to ADCINT4. \`INT1SEL\` is a number from 0 to 15: the SOC whose end sets ADCINT1.

The names are easy to mix up, so say them slowly: **ADCINA4** is a pin. **SOC0** is a slot. **ADCA1** is an interrupt (ADCINT1 of ADCA, as the PIE calls it).
`,
      questions: [
        {
          prompt: "**When?** Which setting decides the moment SOC0's conversion starts?",
          options: ["`ADCSOC0CTL.CHSEL`", "`ADCSOC0CTL.TRIGSEL`", "`ADCSOC0CTL.ACQPS`", "`ADCINTSEL1N2.INT1SEL`"],
          answer: 1,
          why: "TRIGSEL selects the trigger. With 11, SOC0 starts whenever EPWM4 sends SOCA. How often that is, is set in EPWM4, not in the ADC.",
        },
        {
          prompt: "**Which pin?** You move the photoresistor wire from ADCINA4 to ADCINA2. Which line changes?",
          options: [
            "`AdcaRegs.ADCSOC0CTL.bit.CHSEL = 2;`",
            "`AdcaRegs.ADCSOC2CTL.bit.CHSEL = 4;`",
            "`AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 2;`",
            "`adca4result = AdcaResultRegs.ADCRESULT2;`",
          ],
          answer: 0,
          why: "CHSEL is the pin. SOC0 stays SOC0, the trigger stays, and the result is still in ADCRESULT0.",
        },
        {
          prompt: "**How long?** Which setting is the time the capacitor is connected to the pin?",
          options: ["`ADCCTL2.PRESCALE`", "`EPwm4Regs.TBPRD`", "`ADCSOC0CTL.ACQPS`", "`ADCSOC0CTL.TRIGSEL`"],
          answer: 2,
          why: "ACQPS + 1 system clock cycles of 5 ns. TBPRD is the time between two samples, which is a different thing.",
        },
        {
          prompt: "**Where is the result?** SOC3 is set to `CHSEL = 5` and `TRIGSEL = 11`.",
          options: ["`ADCRESULT5`", "`ADCRESULT11`", "`ADCRESULT0`", "`ADCRESULT3`"],
          answer: 3,
          why: "SOC3 fills ADCRESULT3. The result register follows the SOC number, not the pin and not the trigger.",
        },
        {
          prompt: "**Who tells the CPU?** SOC0, SOC1 and SOC2 convert one after the other on each trigger. You want one interrupt when all three are done.",
          options: ["`INT1SEL = 0`", "`INT1SEL = 2`", "`INT1SEL = 3`", "`TRIGSEL = 2` on all three"],
          answer: 1,
          why: "INT1SEL names the SOC whose end sets ADCINT1. SOC2 is the last of the three, so when it ends all three results are ready.",
        },
        {
          prompt: "SOC0 and SOC1 both have `CHSEL = 4` and `TRIGSEL = 11`. What happens on each EPWM4 pulse?",
          options: [
            "An error: two SOCs cannot use the same pin",
            "Two converters measure ADCINA4 at the same instant",
            "The one converter measures ADCINA4 twice, one after the other: ADCRESULT0 and ADCRESULT1",
            "Only SOC0 runs, SOC1 is ignored",
          ],
          answer: 2,
          why: "SOCs are slots, and any number of them may name the same pin and the same trigger. They take turns on the single converter. Measuring a pin several times in a row is called oversampling.",
        },
      ],
      hints: [
        "TRIGSEL: when. CHSEL: which pin. ACQPS: how long. ADCRESULTx: where. INTxSEL: who tells the CPU.",
        "The x in ADCRESULTx is always the SOC number.",
      ],
      takeaway: "When: TRIGSEL. Which pin: CHSEL. How long: ACQPS. Where: ADCRESULT with the SOC's number. Who tells the CPU: INT1SEL (and INT1E).",
    },
    {
      id: "adc-soc0",
      kind: "register",
      title: "Fill in SOC0",
      goal: "Set the three fields of ADCSOC0CTL for the photoresistor example.",
      refs: [{ trm: "11.5.1" }, { trm: "11.16.2" }, { trm: "11.6.1" }, { course: "HW2" }],
      brief: `
This is the real register \`AdcaRegs.ADCSOC0CTL\`: the slot SOC0. It is empty after reset.

Fill in the example:

- **When:** on EPWM4's SOCA pulse. From the trigger table: 9 is EPWM3 SOCA, 10 is EPWM3 SOCB, 11 is EPWM4 SOCA, 12 is EPWM4 SOCB.
- **Which pin:** ADCINA4.
- **How long:** 500 ns. The window is (ACQPS + 1) clock cycles, and one cycle of the 200 MHz system clock is 5 ns.

Note the "+ 1": for 100 cycles the field holds one less.
`,
      reg: "AdcaRegs.ADCSOC0CTL",
      initial: 0,
      targets: [
        { field: "TRIGSEL", value: 11 },
        { field: "CHSEL", value: 4 },
        { field: "ACQPS", value: 99 },
      ],
      code: `EALLOW;
AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;     // SOC0 converts ADCINA4
AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // 100 cycles x 5 ns = 500 ns
AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;  // EPWM4 SOCA
EDIS;`,
      hints: [
        "TRIGSEL = 11 is 01011 in binary. CHSEL = 4 is 0100.",
        "500 ns / 5 ns = 100 cycles, so ACQPS = 99.",
        "99 is 0 0110 0011 in the nine bits of ACQPS.",
      ],
      takeaway: "One register holds the whole slot: TRIGSEL (when), CHSEL (which pin), ACQPS (how long). It is protected, so the writes go between EALLOW and EDIS.",
    },
    {
      id: "adc-single",
      kind: "code",
      mode: "complete",
      title: "One sample by hand",
      goal: "Power up ADCA, set SOC0 to the photoresistor pin, trigger it from software and convert the result to volts.",
      refs: [{ trm: "11.6.4" }, { trm: "11.12" }, { trm: "11.4.6" }, { course: "HW2" }, { course: "L5" }],
      brief: `
Before EPWM4 gets involved, pull the trigger yourself. It is the same chain with a different first link, and it shows that the trigger really is only "when".

## Power up
The ADC is off after reset. The course's set-up is given in the code: clock divider, 12-bit mode, power on (\`ADCPWDNZ = 1\`), then **1 ms of waiting** while the analog circuits settle. \`INTPULSEPOS = 1\` makes the flag come at the end of the conversion, not at the end of sampling.

## Your part
1. **SOC0, which pin:** \`CHSEL\` for ADCINA4.
2. **SOC0, how long:** \`ACQPS\` for 500 ns.
3. **When:** \`TRIGSEL\` stays 0, "software only". Start the conversion by writing 1 to SOC0's bit in the force register:
\`\`\`c
AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
\`\`\`
4. The given loop waits until the flag ADCINT1 says SOC0 has finished. Then read the result and compute the voltage:
\`\`\`c
adcina4volts = adca4result * 3.0 / 4096.0;
\`\`\`

The flag and force registers are not protected, so those lines can be outside \`EALLOW\`.

In the test the photoresistor is at 1.2 V. On the board you can turn its knob.
`,
      kit: "robot",
      durationMs: 3,
      stimuli: [{ at: 0, set: "ADCINA4", value: 1.2 }],
      starter: `uint16_t adca4result = 0;
float adcina4volts = 0;

void main(void)
{
    InitSysCtrl();

${ADC_POWER}

    // TODO 1: SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 0;
    // TODO 2: sample window of 500 ns
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 0;
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // software only
${INT1(0)}

    // TODO 3: start SOC0 from software

    // wait until SOC0 has finished
    while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}

    adca4result = AdcaResultRegs.ADCRESULT0;
    // TODO 4: convert adca4result to volts
    adcina4volts = 0;

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;

    while (1) {}
}
`,
      solution: `uint16_t adca4result = 0;
float adcina4volts = 0;

void main(void)
{
    InitSysCtrl();

${ADC_POWER}

    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // software only
${INT1(0)}

    AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;

    // wait until SOC0 has finished
    while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}

    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 4, label: "SOC0 measures ADCINA4 (CHSEL = 4)" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC0CTL",
          field: "ACQPS",
          equals: 99,
          label: "The sample window is 500 ns (ACQPS = 99)",
          hint: "500 ns is 100 cycles of 5 ns, and the field holds one less.",
        },
        {
          kind: "var",
          name: "adca4result",
          equals: 1638,
          label: "adca4result is 1638, the number for 1.2 V",
          hint: "If it is 0, the conversion never ran (force SOC0) or measured another pin (CHSEL).",
        },
        {
          kind: "var",
          name: "adcina4volts",
          min: 1.199,
          max: 1.201,
          label: "adcina4volts is 1.2 V",
          hint: "adca4result * 3.0 / 4096.0, with the decimal points so that C computes in floating point.",
        },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adca4result", "adcina4volts"],
      inspect: ["AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTFLG", "AdcaResultRegs.ADCRESULT0"],
      hints: [
        "The channel number is the digit at the end of the pin name. The window is (ACQPS + 1) x 5 ns.",
        "`AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;` sets SOC0's flag, exactly as a hardware trigger would.",
        "`AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;` `AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;` and `adcina4volts = adca4result * 3.0 / 4096.0;`",
      ],
      takeaway: "A software trigger, a timer and an ePWM all do the same thing: set the SOC's flag. Everything after that is identical.",
    },
    {
      id: "adc-epwm",
      kind: "code",
      mode: "complete",
      title: "EPWM4 pulls the trigger",
      goal: "Fill in the blanks of homework 2 so that EPWM4 starts SOC0 every millisecond and ADCA_ISR gets each result.",
      refs: [{ course: "HW2" }, { trm: "11.6.1" }, { trm: "15.10" }, { trm: "11.16.2" }, { trm: "3.4.5" }],
      brief: `
Now hand the trigger to hardware. An ePWM module is mostly a counter. You will use it to make motor signals in the next chapter. Here it is only a very regular clock: no pin, no duty cycle, just "now" every millisecond.

## The trigger side: EPWM4
- The counter \`TBCTR\` counts up at 50 MHz from 0 to \`TBPRD\`, then starts again. The period is (TBPRD + 1) / 50 MHz.
- \`ETSEL.SOCASEL\` chooses **which counter event** makes the SOCA pulse: 1 is "counter equals zero", **2 is "counter equals TBPRD"**.
- \`ETPS.SOCAPRD\` chooses **how many** of those events it takes: **1 is every event**, 2 every second one, 3 every third. 0 switches the pulse off.
- \`ETSEL.SOCAEN = 1\` lets the pulse out.
- \`TBCTL.CTRMODE\`: 3 freezes the counter, **0 counts up**.

## The listening side: SOC0
\`TRIGSEL\` connects SOC0 to that pulse. EPWM4 SOCA is number **11** in the trigger table (EPWM3 SOCB is 10, EPWM4 SOCB is 12).

## The blanks
This is the code of homework 2, exercise 3. The \`???\` of the handout are marked TODO:

1. \`SOCASEL\`: pulse when the counter equals the period.
2. \`SOCAPRD\`: on the first event.
3. \`TBPRD\`: a 1 ms period with the 50 MHz clock. The homework uses 50000. (Exactly 1 ms would be 49999, because the period is TBPRD + 1 counts. The 20 ns do not matter here and both pass.)
4. \`CTRMODE\`: up count.
5. \`CHSEL\`: ADCINA4.
6. \`TRIGSEL\`: EPWM4 SOCA.
7. \`INT1SEL\`: the SOC whose end calls \`ADCA_ISR\`. SOC0 is the only one in use.

\`ADCA_ISR\` and the interrupt enables are complete. The photoresistor is at 1.2 V, then at 2.4 V.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 7.5, set: "ADCINA4", value: 2.4 },
      ],
      starter: `__interrupt void ADCA_ISR(void);

int16_t adca4result = 0;
float adcina4volts = 0;
int32_t numADCA = 0;

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

${VECTOR}

    EALLOW;
    EPwm4Regs.ETSEL.bit.SOCAEN = 0;      // Disable SOC on A group
    EPwm4Regs.TBCTL.bit.CTRMODE = 3;     // freeze counter
    EPwm4Regs.ETSEL.bit.SOCASEL = 0;     // TODO 1: Select event when counter equal to PRD
    EPwm4Regs.ETPS.bit.SOCAPRD = 0;      // TODO 2: Generate pulse on 1st event
    EPwm4Regs.TBCTR = 0x0;               // Clear counter
    EPwm4Regs.TBPHS.bit.TBPHS = 0x0000;  // Phase is 0
    EPwm4Regs.TBCTL.bit.PHSEN = 0;       // Disable phase loading
    EPwm4Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1, 50 MHz clock
    EPwm4Regs.TBPRD = 0;                 // TODO 3: Set period to 1 ms sample
    EPwm4Regs.ETSEL.bit.SOCAEN = 1;      // enable SOCA
    EPwm4Regs.TBCTL.bit.CTRMODE = 3;     // TODO 4: unfreeze, and enter up count mode
    EDIS;

${ADC_POWER}
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 0;     // TODO 5: SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // TODO 6: EPWM4 ADCSOCA
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 15; // TODO 7: the SOC whose end sets the INT1 flag
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;    // enable INT1 flag
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;  // make sure INT1 flag is cleared
    EDIS;

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;   // convert ADCINA4 to volts
    numADCA++;

${ISR_END}
}
`,
      solution: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;
int32_t numADCA = 0;`,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;   // convert ADCINA4 to volts
    numADCA++;

${ISR_END}`,
      }),
      checks: [
        {
          kind: "reg",
          reg: "EPwm4Regs.ETSEL",
          field: "SOCASEL",
          equals: 2,
          label: "SOCA is sent when the counter equals the period (SOCASEL = 2)",
          hint: "1 is 'counter equals zero', 2 is 'counter equals TBPRD'.",
        },
        { kind: "reg", reg: "EPwm4Regs.ETPS", field: "SOCAPRD", equals: 1, label: "A pulse on every event (SOCAPRD = 1)", hint: "0 means no pulse at all." },
        { kind: "reg", reg: "EPwm4Regs.TBCTL", field: "CTRMODE", equals: 0, label: "The counter counts up (CTRMODE = 0)", hint: "3 keeps it frozen: no counting, no pulses." },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "TRIGSEL", equals: 11, label: "SOC0 listens to EPWM4 SOCA (TRIGSEL = 11)" },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 4, label: "SOC0 measures ADCINA4 (CHSEL = 4)" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1SEL",
          equals: 0,
          label: "The end of SOC0 sets ADCINT1 (INT1SEL = 0)",
          hint: "INT1SEL is a SOC number. Only SOC0 ever converts here.",
        },
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 9,
          max: 12,
          label: "ADCA_ISR runs once per millisecond",
          hint: "A 1 ms period at 50 MHz is 50000 counts.",
        },
        { kind: "var", name: "adcina4volts", at: 6.5, min: 1.199, max: 1.201, label: "adcina4volts follows the pin: 1.2 V" },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V after the light changes" },
      ],
      watch: ["adca4result", "adcina4volts", "numADCA"],
      inspect: ["EPwm4Regs.ETSEL", "EPwm4Regs.ETPS", "EPwm4Regs.TBPRD", "AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTSEL1N2"],
      hints: [
        "Work down the list of seven. Each blank is one small number from the brief.",
        "EPWM4: SOCASEL = 2, SOCAPRD = 1, TBPRD = 50000, CTRMODE = 0.",
        "ADC: CHSEL = 4, TRIGSEL = 11, INT1SEL = 0.",
      ],
      takeaway: "EPWM4 sends SOCA (ETSEL, ETPS, TBPRD). SOC0 listens with TRIGSEL = 11, measures the pin in CHSEL, and INT1SEL = 0 lets its end call your function.",
    },
    {
      id: "adc-isr",
      kind: "code",
      mode: "write",
      title: "Night light",
      goal: "Write the ADCA1 interrupt function and its enables so that LED1 turns on when the photoresistor is in the dark.",
      refs: [{ course: "HW2" }, { trm: "11.9" }, { trm: "3.4.5" }, { trm: "11.4.6" }],
      brief: `
EPWM4, SOC0 and the ADC interrupt select are set up as before. Three things are missing: the path to the CPU, the interrupt function, and a use for the number.

## The path to the CPU
ADCINT1 of ADCA is called **ADCA1** in the PIE table. It is **INT1.1**: group 1, channel 1. You know the recipe from the interrupts chapter:

- the vector: \`PieVectTable.ADCA1_INT = &ADCA_ISR;\` (between \`EALLOW;\` and \`EDIS;\`)
- the channel: \`PieCtrlRegs.PIEIER1.bit.INTx1 = 1;\`
- the group: \`IER |= M_INT1;\`

## The interrupt function
In \`ADCA_ISR\`:

1. Read \`AdcaResultRegs.ADCRESULT0\` into \`adca4result\`.
2. Convert it to volts in \`adcina4volts\`.
3. The night light: if the voltage is **below 1.0 V** (dark), turn **LED1** on (GPIO22, \`GPASET\`). Otherwise turn it off (\`GPACLEAR\`).
4. Clear the ADC's flag, so that the next conversion can raise a new interrupt:
\`\`\`c
AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
\`\`\`
5. Acknowledge PIE group 1.

Step 4 is new, and it is the one people forget. The ADC has its own flag in front of the PIE. While ADCINT1 is still set, the ADC sends nothing more to the PIE.

The test starts in bright light (2.5 V), goes dark (0.6 V), then back to daylight (1.8 V).
`,
      kit: "robot",
      durationMs: 18,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 2.5 },
        { at: 6.5, set: "ADCINA4", value: 0.6 },
        { at: 12.5, set: "ADCINA4", value: 1.8 },
      ],
      starter: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;`,
        setup: LED1,
        vector: false,
        enable: false,
        isr: `    // TODO: read the result, convert to volts, LED1, clear the flag, acknowledge
`,
      }),
      solution: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;`,
        setup: LED1,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;

    if (adcina4volts < 1.0) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

${ISR_END}`,
      }),
      checks: [
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 14,
          max: 18,
          label: "ADCA_ISR runs once per millisecond",
          hint: "Never: check the vector, PIEIER1.INTx1 and IER. Once: the ADC flag or PIEACK is not cleared at the end.",
        },
        { kind: "var", name: "adcina4volts", at: 5.5, min: 2.498, max: 2.502, label: "adcina4volts shows 2.5 V in bright light" },
        { kind: "led", led: "LED1", at: 5.5, on: false, label: "LED1 is off in bright light" },
        { kind: "led", led: "LED1", at: 9.5, on: true, label: "LED1 turns on in the dark (0.6 V)", hint: "Dark means a low voltage: on when adcina4volts < 1.0." },
        { kind: "led", led: "LED1", at: 15.5, on: false, label: "LED1 turns off again at 1.8 V" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
          hint: "Clear the flag in the interrupt function: AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;",
        },
      ],
      watch: ["adca4result", "adcina4volts"],
      inspect: ["AdcaRegs.ADCINTFLG", "AdcaRegs.ADCINTOVF", "PieCtrlRegs.PIEIER1"],
      hints: [
        "Three enabling lines in main(), five steps in the function.",
        "`adcina4volts = adca4result * 3.0 / 4096.0;` then an `if` on `adcina4volts < 1.0`.",
        "The function ends with `AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;` and `PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`",
      ],
      takeaway: "An ADC interrupt function ends with two lines: clear ADCINT1 in the ADC, acknowledge group 1 in the PIE. Two gates, two keys.",
    },
    {
      id: "adc-debug",
      kind: "code",
      mode: "debug",
      title: "The interrupt that never comes",
      goal: "Find two mistakes in the chain: first ADCA_ISR never runs, then it runs only once.",
      refs: [{ trm: "11.9" }, { trm: "11.9.1" }, { trm: "11.9.2" }, { course: "HW2" }],
      brief: `
Somebody set up the example from memory. The program builds, and \`adcina4volts\` stays at 0. \`numADCA\` shows that \`ADCA_ISR\` **never runs**.

There are **two** mistakes, both in the last links of the chain. You will see them one after the other: fix the first and the function runs, but **exactly once**.

Walk the chain and ask each link its question. The inspector helps:

- \`AdcaResultRegs.ADCRESULT0\`: does it hold a number? Then the trigger, SOC0 and the converter all work, and the problem is after them.
- \`AdcaRegs.ADCINTFLG\`: is ADCINT1 ever set? Which SOC's end is supposed to set it?
- \`AdcaRegs.ADCINTOVF\`: a bit here means a conversion ended while the flag was **still set** from last time. In that case the ADC sends no new interrupt.

The photoresistor is at 1.2 V, then at 2.4 V.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 7.5, set: "ADCINA4", value: 2.4 },
      ],
      starter: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;
int32_t numADCA = 0;`,
        adc: `${ADC_POWER}
${SOC0}
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 1;  // the end of the conversion sets the INT1 flag
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;    // enable INT1 flag
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;  // make sure INT1 flag is cleared
    EDIS;`,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;
    numADCA++;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`,
      }),
      solution: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;
int32_t numADCA = 0;`,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;
    numADCA++;

${ISR_END}`,
      }),
      checks: [
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1SEL",
          equals: 0,
          label: "ADCINT1 is set by the end of SOC0, the SOC that converts",
          hint: "INT1SEL = 1 waits for SOC1, and nothing ever triggers SOC1.",
        },
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 9,
          max: 12,
          label: "ADCA_ISR runs on every sample",
          hint: "If it ran once: ADCINT1 is still set, so the ADC sends no new interrupt. Look at ADCINTOVF.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
          hint: "Add AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; to the interrupt function.",
        },
        { kind: "var", name: "adcina4volts", at: 6.5, min: 1.199, max: 1.201, label: "adcina4volts shows 1.2 V" },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and follows the pin to 2.4 V" },
      ],
      watch: ["adca4result", "adcina4volts", "numADCA"],
      inspect: ["AdcaRegs.ADCINTSEL1N2", "AdcaRegs.ADCINTFLG", "AdcaRegs.ADCINTOVF", "AdcaResultRegs.ADCRESULT0"],
      hints: [
        "ADCRESULT0 holds a number, so SOC0 converts. Which SOC does INT1SEL point at?",
        "After the first fix the function runs once. What does every ADC interrupt function do before the PIE acknowledge?",
        "`INT1SEL = 0`, and add `AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;` in `ADCA_ISR`.",
      ],
      takeaway: "Never: INT1SEL points at a SOC that does not convert (or INT1E is 0). Once: ADCINT1 was not cleared, and ADCINTOVF shows it. The converter keeps working either way.",
    },
    {
      id: "adc-joystick",
      kind: "code",
      mode: "checkpoint",
      title: "Three pins, one trigger",
      goal: "Add the joystick's two axes to the sequence and light the LED for the direction it is pushed.",
      refs: [{ course: "HW2" }, { trm: "11.6.3" }, { trm: "11.7" }, { trm: "11.9" }],
      brief: `
Homework 2, exercise 4. The homework board has a joystick: its **X** axis is on **ADCINA2** and its **Y** axis on **ADCINA3**. Each gives 1.5 V at rest and moves towards 0 V or 3 V when pushed.

One converter, three pins. So use three slots and let them take turns:

- SOC0: ADCINA4, the photoresistor. It stays as it is.
- **SOC1: ADCINA2**, joystick X.
- **SOC2: ADCINA3**, joystick Y.

Give all three the **same trigger**, EPWM4 SOCA. On each pulse all three flags are set, and the converter works through them in order: SOC0, SOC1, SOC2. The three conversions take about 2 us together.

You want **one** interrupt, when all three results are ready. Which SOC finishes last? Point \`INT1SEL\` at it.

## In ADCA_ISR
Read the three results (which result register belongs to which SOC?) and convert them to volts in \`adcina4volts\`, \`joyxvolts\` and \`joyyvolts\`.

Then exactly **one** of five LEDs is on. Check in this order:

1. Y above 2.0 V: **LED6**
2. Y below 1.0 V: **LED10**
3. X above 2.0 V: **LED13**
4. X below 1.0 V: **LED3**
5. otherwise (joystick at rest): **LED8**

The LED pins are set up for you: LED3 is GPIO95, LED6 is GPIO130, LED8 is GPIO25, LED10 is GPIO27, LED13 is GPIO157. GPIO95 is in port C, GPIO130 and GPIO157 are in port E.
`,
      kit: "redboard",
      durationMs: 30,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 0.9 },
        { at: 6.5, set: "ADCINA3", value: 2.6 },
        { at: 10.5, set: "ADCINA3", value: 0.4 },
        { at: 14.5, set: "ADCINA3", value: 1.5 },
        { at: 14.5, set: "ADCINA2", value: 2.8 },
        { at: 18.5, set: "ADCINA2", value: 0.2 },
        { at: 22.5, set: "ADCINA3", value: 2.9 },
        { at: 26.5, set: "ADCINA3", value: 1.6 },
        { at: 26.5, set: "ADCINA2", value: 1.4 },
      ],
      starter: `__interrupt void ADCA_ISR(void);

int16_t adca4result = 0;
float adcina4volts = 0;
float joyxvolts = 0;
float joyyvolts = 0;

void setupLED(uint16_t pin)
{
    GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_PUSHPULL);
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    setupLED(95);    // LED3
    setupLED(130);   // LED6
    setupLED(25);    // LED8
    setupLED(27);    // LED10
    setupLED(157);   // LED13

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    // TODO: SOC1 converts ADCINA2 (joystick X), SOC2 converts ADCINA3 (joystick Y)

    // TODO: which SOC is the last one?
${INT1(0)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;

    // TODO: joystick voltages and the LEDs

${ISR_END}
}
`,
      solution: `__interrupt void ADCA_ISR(void);

int16_t adca4result = 0;
int16_t adca2result = 0;
int16_t adca3result = 0;
float adcina4volts = 0;
float joyxvolts = 0;
float joyyvolts = 0;

void setupLED(uint16_t pin)
{
    GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_PUSHPULL);
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    setupLED(95);    // LED3
    setupLED(130);   // LED6
    setupLED(25);    // LED8
    setupLED(27);    // LED10
    setupLED(157);   // LED13

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 2;     // SOC1 converts ADCINA2
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA
    AdcaRegs.ADCSOC2CTL.bit.CHSEL = 3;     // SOC2 converts ADCINA3
    AdcaRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC2CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA
${INT1(2)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adca4result = AdcaResultRegs.ADCRESULT0;
    adca2result = AdcaResultRegs.ADCRESULT1;
    adca3result = AdcaResultRegs.ADCRESULT2;
    adcina4volts = adca4result * 3.0 / 4096.0;
    joyxvolts = adca2result * 3.0 / 4096.0;
    joyyvolts = adca3result * 3.0 / 4096.0;

    GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    GpioDataRegs.GPECLEAR.bit.GPIO130 = 1;
    GpioDataRegs.GPACLEAR.bit.GPIO25 = 1;
    GpioDataRegs.GPACLEAR.bit.GPIO27 = 1;
    GpioDataRegs.GPECLEAR.bit.GPIO157 = 1;
    if (joyyvolts > 2.0) {
        GpioDataRegs.GPESET.bit.GPIO130 = 1;
    } else if (joyyvolts < 1.0) {
        GpioDataRegs.GPASET.bit.GPIO27 = 1;
    } else if (joyxvolts > 2.0) {
        GpioDataRegs.GPESET.bit.GPIO157 = 1;
    } else if (joyxvolts < 1.0) {
        GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    } else {
        GpioDataRegs.GPASET.bit.GPIO25 = 1;
    }

${ISR_END}
}
`,
      checks: [
        { kind: "reg", reg: "AdcaRegs.ADCSOC1CTL", field: "CHSEL", equals: 2, label: "SOC1 measures ADCINA2 (joystick X)" },
        { kind: "reg", reg: "AdcaRegs.ADCSOC2CTL", field: "CHSEL", equals: 3, label: "SOC2 measures ADCINA3 (joystick Y)" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1SEL",
          equals: 2,
          label: "The interrupt comes after the last SOC (INT1SEL = 2)",
          hint: "With INT1SEL = 0 the function runs while SOC1 and SOC2 are still converting, and reads their results from the previous millisecond.",
        },
        { kind: "var", name: "adcina4volts", at: 5.5, min: 0.899, max: 0.901, label: "The photoresistor still reads 0.9 V" },
        { kind: "led", led: "LED8", at: 5.5, on: true, label: "At rest: LED8" },
        { kind: "var", name: "joyyvolts", at: 9.5, min: 2.598, max: 2.602, label: "joyyvolts shows 2.6 V", hint: "SOC2's result is in ADCRESULT2." },
        { kind: "led", led: "LED6", at: 9.5, on: true, label: "Y high: LED6" },
        { kind: "led", led: "LED8", at: 9.5, on: false, label: "and LED8 is off: only one LED at a time" },
        { kind: "led", led: "LED10", at: 13.5, on: true, label: "Y low: LED10" },
        { kind: "var", name: "joyxvolts", at: 17.5, min: 2.798, max: 2.802, label: "joyxvolts shows 2.8 V", hint: "SOC1's result is in ADCRESULT1." },
        { kind: "led", led: "LED13", at: 17.5, on: true, label: "X high: LED13" },
        { kind: "led", led: "LED3", at: 21.5, on: true, label: "X low: LED3" },
        { kind: "led", led: "LED6", at: 25.5, on: true, label: "X low and Y high: Y is checked first, LED6" },
        { kind: "led", led: "LED3", at: 25.5, on: false, label: "and LED3 is off" },
        { kind: "led", led: "LED8", at: 29.5, on: true, label: "Back near the middle: LED8" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adcina4volts", "joyxvolts", "joyyvolts"],
      inspect: ["AdcaRegs.ADCSOC1CTL", "AdcaRegs.ADCSOC2CTL", "AdcaRegs.ADCINTSEL1N2"],
      hints: [
        "SOC1 and SOC2 each need the same three lines as SOC0, with their own CHSEL. The last SOC to finish is SOC2.",
        "ADCRESULT1 is joystick X (SOC1), ADCRESULT2 is joystick Y (SOC2).",
        "Turn all five LEDs off with CLEAR, then one `if / else if` chain in the order of the list sets the right one.",
      ],
      takeaway: "More pins means more SOCs on the same trigger, and INT1SEL moves to the last one. The converter is shared, so the three samples are taken 0.7 us apart, not at the same instant.",
    },
    {
      id: "adc-sar-steps",
      kind: "calc",
      tier: "practice",
      title: "Four steps of the search",
      goal: "Work out the first four trial voltages of the 12-bit converter for an input of 2.0 V.",
      refs: [{ course: "L5" }, { trm: "11.14" }],
      brief: `
The real converter has 12 bits and a 3.0 V reference. Its bits are worth 1.5 V (bit 11), 0.75 V (bit 10), 0.375 V (bit 9), 0.1875 V (bit 8), and so on.

The held voltage is **2.0 V**.

For each step, the **trial voltage** is the value of all bits kept so far plus the bit being tried. If the held voltage is at least the trial voltage, the bit is kept.

{{figure:sar-search}}

The figure from "Be the converter" is here again: watch how the band the voltage can be in halves with every comparison.

Give the trial voltage of each of the first four steps, then the four bits as one hexadecimal digit.
`,
      fields: [
        { id: "t11", label: "Step 1 (bit 11): trial voltage", unit: "V", answer: 1.5, why: "Nothing is kept yet, so the trial is bit 11 alone: 1.5 V. 2.0 V is higher: bit 11 = 1." },
        {
          id: "t10",
          label: "Step 2 (bit 10): trial voltage",
          unit: "V",
          answer: 2.25,
          why: "Kept 1.5 V plus 0.75 V = 2.25 V. 2.0 V is lower: bit 10 = 0, and 0.75 V is not kept.",
        },
        {
          id: "t9",
          label: "Step 3 (bit 9): trial voltage",
          unit: "V",
          answer: 1.875,
          why: "Kept 1.5 V plus 0.375 V = 1.875 V. 2.0 V is higher: bit 9 = 1.",
        },
        {
          id: "t8",
          label: "Step 4 (bit 8): trial voltage",
          unit: "V",
          answer: 2.0625,
          why: "Kept 1.875 V plus 0.1875 V = 2.0625 V. 2.0 V is lower: bit 8 = 0.",
        },
        {
          id: "nibble",
          label: "Bits 11 to 8 as a hex digit",
          answer: 0xa,
          format: "hex",
          why: "1, 0, 1, 0 is 0xA. The full result is 4096 x 2.0 / 3.0 = 2730 = 0xAAA: the pattern goes on.",
        },
      ],
      hints: [
        "Step 2 adds bit 10 to what was kept in step 1.",
        "A bit that was not kept is not part of later trial voltages: step 3 is 1.5 + 0.375, not 2.25 + 0.375.",
        "1.5, 2.25, 1.875, 2.0625, and the bits are 1010.",
      ],
      takeaway: "After four steps the converter knows the voltage is between 1.875 V and 2.0625 V. Eight more steps narrow that to 0.73 mV.",
    },
    {
      id: "adc-acqps",
      kind: "calc",
      tier: "practice",
      title: "How long is a sample",
      goal: "Calculate acquisition windows, ACQPS values and the time a sequence of conversions takes.",
      refs: [{ trm: "11.5.3" }, { trm: "11.14.1" }, { trm: "11.6.3" }, { trm: "11.15.2" }, { course: "L5" }],
      brief: `
While the capacitor is connected to the pin it has to charge to the pin's voltage. A sensor with a high output resistance charges it slowly, so it needs a longer **acquisition window**. Too short, and the capacitor still carries some of the voltage of the pin measured before: a "ghost" of the other channel.

\`\`\`c
acquisition window = (ACQPS + 1) * 5 ns      // 5 ns is one cycle of the 200 MHz system clock
\`\`\`

{{figure:sample-hold}}

Try it in the figure: shorten the window or raise the sensor's resistance until the capacitor no longer reaches the pin voltage, and see what the converter reports then.

ACQPS has 9 bits, 0 to 511. The window counts **system clock** cycles. The conversion that follows is timed by the slower **ADC clock**, the system clock divided down by \`ADCCTL2.PRESCALE\`. The course sets PRESCALE = 6, which divides by 4.

After the window, with PRESCALE = 6, the manual's timing table says the conversion takes **41 system clock cycles** until the converter is free for the next SOC.
`,
      fields: [
        {
          id: "adcclk",
          label: "ADC clock frequency with PRESCALE = 6 (divide by 4)",
          unit: "MHz",
          answer: 50,
          why: "200 MHz / 4 = 50 MHz. That is the fastest ADC clock this chip allows.",
        },
        {
          id: "acqps",
          label: "ACQPS for a 100 ns window",
          answer: 19,
          why: "100 ns / 5 ns = 20 cycles, and ACQPS is one less: 19. This is the manual's own example.",
        },
        {
          id: "max",
          label: "Longest possible window (ACQPS = 511)",
          unit: "ns",
          answer: 2560,
          why: "(511 + 1) x 5 ns = 2560 ns.",
        },
        {
          id: "one",
          label: "One conversion with ACQPS = 99: window plus 41 cycles",
          unit: "ns",
          answer: 705,
          why: "500 ns + 41 x 5 ns = 705 ns.",
        },
        {
          id: "three",
          label: "SOC0, SOC1 and SOC2 on one trigger, all with ACQPS = 99",
          unit: "us",
          answer: 2.115,
          tolPct: 0.5,
          why: "3 x 705 ns = 2115 ns. Tiny next to the 1 ms between triggers: the ADC rests 99.8% of the time.",
        },
      ],
      hints: [
        "Cycles = time / 5 ns. ACQPS = cycles - 1.",
        "One conversion is the window plus 41 cycles of 5 ns.",
        "50, 19, 2560, 705, 2.115.",
      ],
      takeaway: "Window = (ACQPS + 1) x 5 ns, counted in system clock cycles. One conversion with the course's settings takes about 0.7 us.",
    },
    {
      id: "adc-debug-volts",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Wrong volts",
      goal: "Fix three mistakes that make the photoresistor voltage come out wrong.",
      refs: [{ course: "HW2" }, { trm: "11.5.5" }, { trm: "11.16.2" }, { trm: "11.4.6" }],
      brief: `
The interrupt runs every millisecond, as it should. But \`adcina4volts\` is nonsense: the photoresistor is at 1.2 V and then at 2.4 V, and the variable shows neither.

There are **three** mistakes:

- one is reported by the simulator when you run the program,
- one is a wrong number in a SOC setting (compare each line with its comment),
- one is in the line that converts to volts. Look at the types: what does C do when it divides two integers?

Fix them one at a time and watch \`adca4result\` and \`adcina4volts\` after each fix.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 7.5, set: "ADCINA4", value: 2.4 },
      ],
      starter: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;`,
        adc: `${ADC_POWER}
    EDIS;

    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 0;     // SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA triggers SOC0
    EALLOW;
${INT1(0)}`,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3 / 4096;   // convert ADCINA4 to volts

${ISR_END}`,
      }),
      solution: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;`,
        isr: `    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;   // convert ADCINA4 to volts

${ISR_END}`,
      }),
      checks: [
        {
          kind: "no-diagnostic",
          code: "eallow",
          label: "No write to a protected register is ignored",
          hint: "ADCSOC0CTL is protected. Its three lines must be between EALLOW; and EDIS;.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC0CTL",
          field: "CHSEL",
          equals: 4,
          label: "SOC0 measures ADCINA4",
          hint: "The comment says ADCINA4, the number says ADCINA0.",
        },
        { kind: "var", name: "adca4result", at: 6.5, equals: 1638, label: "adca4result is 1638 at 1.2 V" },
        {
          kind: "var",
          name: "adcina4volts",
          at: 6.5,
          min: 1.199,
          max: 1.201,
          label: "adcina4volts is 1.2 V",
          hint: "1638 * 3 / 4096 in integers is 4914 / 4096 = 1, fraction dropped. Write 3.0 and 4096.0.",
        },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V later" },
      ],
      watch: ["adca4result", "adcina4volts"],
      inspect: ["AdcaRegs.ADCSOC0CTL", "AdcaResultRegs.ADCRESULT0"],
      hints: [
        "The reported problem: three SOC lines sit after an `EDIS;`.",
        "With those lines ignored, or with CHSEL = 0, SOC0 measures ADCINA0, where nothing is connected.",
        "`adca4result * 3 / 4096` is all integers, so the result is 0, 1 or 2. Use `3.0 / 4096.0`.",
      ],
      takeaway: "A wrong reading has three usual suspects: the setting never got written (EALLOW), the wrong pin (CHSEL), or integer arithmetic in the scaling.",
    },
    {
      id: "adc-average",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Average out the ripple",
      goal: "Average blocks of 16 samples so that a 0.4 V ripple on the photoresistor signal disappears.",
      refs: [{ trm: "11.6.2" }, { course: "L5" }, { course: "HW2" }],
      brief: `
The room lights flicker, and the photoresistor sees it: its voltage jumps up and down by 0.2 V around the real level from one sample to the next. A single sample is off by 0.2 V. The average of many is not.

The chain is set up as always (EPWM4, SOC0, ADCINA4, 1 ms). Write \`ADCA_ISR\`:

- Add up **16** consecutive results.
- After the 16th, store the average **in volts** in \`avgvolts\`, add 1 to \`numAvg\`, and start a new block.
- Between blocks \`avgvolts\` keeps its last value.

So \`avgvolts\` gets a new value every 16 ms.

Think about the type of the sum. Sixteen results of at most 4095 add up to at most 65520. Does that fit in an \`int16_t\`? In a \`uint16_t\`?

Do the division once per block, not once per sample: divide the sum, not each result.

The signal is 1.5 V with ripple for the first 40 ms, then 2.2 V with ripple.
`,
      kit: "robot",
      durationMs: 80,
      stimuli: [{ at: 0, set: "ADCINA4", value: 1.3 }, ...ripple(1.5, 0, 40), ...ripple(2.2, 40, 80)],
      starter: program({
        globals: `float avgvolts = 0;
int16_t numAvg = 0;`,
        isr: `    // TODO

${ISR_END}`,
      }),
      solution: program({
        globals: `float avgvolts = 0;
int16_t numAvg = 0;
uint16_t sum = 0;
int16_t count = 0;`,
        isr: `    sum += AdcaResultRegs.ADCRESULT0;
    count++;
    if (count == 16) {
        avgvolts = sum * 3.0 / (16.0 * 4096.0);
        numAvg++;
        sum = 0;
        count = 0;
    }

${ISR_END}`,
      }),
      checks: [
        {
          kind: "var",
          name: "avgvolts",
          at: 38,
          min: 1.49,
          max: 1.51,
          label: "The average is 1.5 V while single samples jump between 1.3 V and 1.7 V",
        },
        {
          kind: "var",
          name: "avgvolts",
          at: 78,
          min: 2.19,
          max: 2.21,
          label: "The average follows the level to 2.2 V",
          hint: "A negative value: the sum overflowed. 16 results of about 3000 need an unsigned 16-bit or a 32-bit variable.",
        },
        { kind: "var", name: "numAvg", min: 4, max: 5, label: "One average per 16 samples", hint: "Start a new block after the 16th sample: sum and counter back to 0." },
        { kind: "isr", fn: "ADCA_ISR", min: 76, max: 80, label: "ADCA_ISR still runs on every sample" },
      ],
      watch: ["avgvolts", "numAvg"],
      hints: [
        "Two more globals: the running sum and a counter.",
        "`uint16_t sum` holds up to 65535, enough for 16 results.",
        "When the counter reaches 16: `avgvolts = sum * 3.0 / (16.0 * 4096.0);` then reset both.",
      ],
      takeaway: "Averaging N samples trades speed for calm: the ripple shrinks, and the answer arrives N times less often. The manual's oversampling example does the same with several SOCs on one pin.",
    },
    {
      id: "adc-hysteresis",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A switch that does not chatter",
      goal: "Turn LED1 on above 2.0 V and off below 1.0 V, hold it in between, and count the times it turns on.",
      refs: [{ course: "HW2" }, { course: "L5" }, { trm: "11.9" }],
      brief: `
A single threshold has a problem. If the light level sits right at the threshold, the smallest ripple pushes the reading above and below it, and the output flickers on and off.

The fix is two thresholds, called **hysteresis**:

- LED1 turns **on** when the voltage rises above **2.0 V**.
- LED1 turns **off** when the voltage falls below **1.0 V**.
- Between 1.0 V and 2.0 V it **stays as it was**.

Also count in \`numOn\` how many times LED1 went from off to on. A reading above 2.0 V while LED1 is already on does not count.

The chain is set up (EPWM4, SOC0, ADCINA4, 1 ms) and LED1 is an output, off. Write \`ADCA_ISR\`. You decide what state to keep.
`,
      kit: "robot",
      durationMs: 38,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 0.5 },
        { at: 4.5, set: "ADCINA4", value: 1.5 },
        { at: 8.5, set: "ADCINA4", value: 2.2 },
        { at: 12.5, set: "ADCINA4", value: 1.9 },
        { at: 16.5, set: "ADCINA4", value: 1.2 },
        { at: 20.5, set: "ADCINA4", value: 2.1 },
        { at: 24.5, set: "ADCINA4", value: 0.8 },
        { at: 28.5, set: "ADCINA4", value: 1.9 },
        { at: 32.5, set: "ADCINA4", value: 2.5 },
      ],
      starter: program({
        globals: `int16_t numOn = 0;`,
        setup: LED1,
        isr: `    // TODO

${ISR_END}`,
      }),
      solution: program({
        globals: `int16_t numOn = 0;
int16_t ledOn = 0;
float volts = 0;`,
        setup: LED1,
        isr: `    volts = AdcaResultRegs.ADCRESULT0 * 3.0 / 4096.0;
    if (ledOn == 0 && volts > 2.0) {
        ledOn = 1;
        numOn++;
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else if (ledOn == 1 && volts < 1.0) {
        ledOn = 0;
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

${ISR_END}`,
      }),
      checks: [
        { kind: "led", led: "LED1", at: 3.5, on: false, label: "0.5 V: off" },
        { kind: "led", led: "LED1", at: 7.5, on: false, label: "1.5 V coming from below: still off", hint: "Between the thresholds nothing changes." },
        { kind: "led", led: "LED1", at: 11.5, on: true, label: "2.2 V: on" },
        { kind: "steady", led: "LED1", from: 11.5, to: 24, on: true, label: "1.9 V, 1.2 V, 2.1 V: stays on without a flicker" },
        { kind: "led", led: "LED1", at: 27.5, on: false, label: "0.8 V: off" },
        { kind: "led", led: "LED1", at: 31.5, on: false, label: "1.9 V coming from below: still off" },
        { kind: "led", led: "LED1", at: 36.5, on: true, label: "2.5 V: on again" },
        {
          kind: "var",
          name: "numOn",
          equals: 2,
          label: "numOn counted the two times LED1 turned on",
          hint: "Count only the change from off to on, not every sample above 2.0 V.",
        },
      ],
      watch: ["numOn"],
      hints: [
        "Remember in a global whether the LED is on. The decision depends on the reading and on that state.",
        "Off and above 2.0 V: turn on and count. On and below 1.0 V: turn off. Every other case: do nothing.",
        "`if (ledOn == 0 && volts > 2.0) { ... } else if (ledOn == 1 && volts < 1.0) { ... }`",
      ],
      takeaway: "Hysteresis gives a threshold a memory. The gap between the two levels must be wider than the noise on the signal.",
    },
    {
      id: "adc-angle",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Joystick angle",
      goal: "Sample both joystick axes on one trigger and compute the direction the stick is pushed, in degrees.",
      refs: [{ course: "HW2" }, { trm: "11.6.3" }, { trm: "11.7" }, { trm: "11.15.3" }],
      brief: `
The joystick's X axis is on ADCINA2 and its Y axis on ADCINA3, both 1.5 V at rest.

EPWM4 and the ADC's power-up are given. SOC0 still measures the photoresistor. The rest is yours: add the SOCs for the two axes on the same trigger, choose the right SOC for the interrupt, and write \`ADCA_ISR\`.

In the interrupt function:

- \`dx\` and \`dy\` are the two voltages minus 1.5 V: how far the stick is from rest.
- If both are within **0.2 V** of rest (\`fabs\` gives the absolute value), the stick counts as released: \`moved = 0\` and \`angle = 0\`.
- Otherwise \`moved = 1\` and \`angle\` is the direction in **degrees**: 0 is +X, 90 is +Y, and it runs from -180 to 180.

\`atan2(dy, dx)\` gives exactly that angle, in radians.

Why must both axes hang on the **same** trigger? If X were sampled now and Y half a millisecond later, a stick that is moving would give a direction it never pointed in.
`,
      kit: "redboard",
      durationMs: 30,
      stimuli: [
        { at: 4.5, set: "ADCINA2", value: 3.0 },
        { at: 8.5, set: "ADCINA2", value: 1.5 },
        { at: 8.5, set: "ADCINA3", value: 3.0 },
        { at: 12.5, set: "ADCINA2", value: 0.3 },
        { at: 12.5, set: "ADCINA3", value: 2.1 },
        { at: 16.5, set: "ADCINA2", value: 1.5 },
        { at: 16.5, set: "ADCINA3", value: 0.0 },
        { at: 20.5, set: "ADCINA2", value: 2.5 },
        { at: 20.5, set: "ADCINA3", value: 2.5 },
        { at: 24.5, set: "ADCINA2", value: 1.6 },
        { at: 24.5, set: "ADCINA3", value: 1.35 },
      ],
      starter: `#define PI 3.14159265

__interrupt void ADCA_ISR(void);

float angle = 0;
int16_t moved = 0;

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    // TODO: the SOCs for the joystick and the interrupt select

    EDIS;

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `#define PI 3.14159265

__interrupt void ADCA_ISR(void);

float angle = 0;
int16_t moved = 0;
float dx = 0;
float dy = 0;

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 2;     // SOC1 converts ADCINA2
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA
    AdcaRegs.ADCSOC2CTL.bit.CHSEL = 3;     // SOC2 converts ADCINA3
    AdcaRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC2CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA
${INT1(2)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    dx = AdcaResultRegs.ADCRESULT1 * 3.0 / 4096.0 - 1.5;
    dy = AdcaResultRegs.ADCRESULT2 * 3.0 / 4096.0 - 1.5;
    if (fabs(dx) < 0.2 && fabs(dy) < 0.2) {
        moved = 0;
        angle = 0;
    } else {
        moved = 1;
        angle = atan2(dy, dx) * 180.0 / PI;
    }

${ISR_END}
}
`,
      checks: [
        { kind: "var", name: "moved", at: 3.5, equals: 0, label: "At rest: moved is 0" },
        { kind: "var", name: "angle", at: 7.5, min: -0.5, max: 0.5, label: "Pushed towards +X: 0 degrees" },
        { kind: "var", name: "moved", at: 7.5, equals: 1, label: "and moved is 1" },
        { kind: "var", name: "angle", at: 11.5, min: 89.5, max: 90.5, label: "Towards +Y: 90 degrees", hint: "atan2 takes y first: atan2(dy, dx). Convert radians to degrees with 180 / PI." },
        { kind: "var", name: "angle", at: 15.5, min: 152.9, max: 153.9, label: "X = 0.3 V, Y = 2.1 V: 153.4 degrees" },
        { kind: "var", name: "angle", at: 19.5, min: -90.5, max: -89.5, label: "Towards -Y: -90 degrees" },
        { kind: "var", name: "angle", at: 23.5, min: 44.5, max: 45.5, label: "Diagonal: 45 degrees" },
        { kind: "var", name: "moved", at: 28.5, equals: 0, label: "Within 0.2 V of rest: released" },
        { kind: "var", name: "angle", at: 28.5, equals: 0, label: "and the angle is 0" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
        },
      ],
      watch: ["angle", "moved"],
      hints: [
        "Same SOC set-up as the three-pin checkpoint: SOC1 for ADCINA2, SOC2 for ADCINA3, INT1SEL = 2.",
        "`dx = AdcaResultRegs.ADCRESULT1 * 3.0 / 4096.0 - 1.5;` and the same for dy with ADCRESULT2.",
        "`angle = atan2(dy, dx) * 180.0 / PI;` unless both `fabs(dx)` and `fabs(dy)` are below 0.2.",
      ],
      takeaway: "Values that belong together are sampled on the same trigger. Here they are still 0.7 us apart, because one converter does both: for truly simultaneous samples you would use two ADCs, for example ADCA and ADCB, on one trigger.",
    },
    {
      id: "adc-loopback",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "ADC to DAC and back",
      goal: "Output 3.0 V minus the photoresistor voltage on DACA and measure that output again with a second SOC.",
      refs: [{ course: "L5" }, { course: "Lab 4" }, { trm: "12.2" }, { trm: "11.6.3" }, { trm: "11.5.5" }],
      brief: `
Put the last two chapters together.

1. **Invert.** On every sample, set DACA to **3.0 V minus the photoresistor voltage**. Bright light gives a low output, darkness a high one. Saturate as always.
2. **Check your own output.** The DACA pin is the same pin as **ADCINA0**. So the ADC can measure what the DAC really puts out, with no wire. Add a second SOC for ADCINA0 on the same trigger and store its voltage in \`readback\`.

Only EPWM4 and the ADC's power-up are given. Bring up the DAC, add the SOC, choose the interrupt select, write \`ADCA_ISR\`.

\`DACVALS\` is not a protected register, so it needs no \`EALLOW\`.

One thing to think about: when \`ADCA_ISR\` runs, the conversions of this millisecond are already finished. So which DAC value did the second SOC see, the one you are about to write or the one from the last interrupt?
`,
      kit: "robot",
      durationMs: 18,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.0 },
        { at: 8.5, set: "ADCINA4", value: 2.6 },
      ],
      starter: `__interrupt void ADCA_ISR(void);

float adcina4volts = 0;
float readback = 0;

void main(void)
{
    InitSysCtrl();

    // TODO: bring up DACA

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    // TODO: a SOC for ADCINA0 and the interrupt select

    EDIS;

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `__interrupt void ADCA_ISR(void);

float adcina4volts = 0;
float readback = 0;

void setDACA(float dacouta0)
{
    if (dacouta0 > 3.0) dacouta0 = 3.0;
    if (dacouta0 < 0.0) dacouta0 = 0.0;

    EALLOW;
    DacaRegs.DACVALS.bit.DACVALS = dacouta0 * 4095.0 / 3.0;
    EDIS;
}

void main(void)
{
    InitSysCtrl();

    EALLOW;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacaRegs.DACVALS.bit.DACVALS = 0;
    EDIS;

${PIE_INIT}

${VECTOR}

${EPWM4}

${ADC_POWER}
${SOC0}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 0;     // SOC1 converts ADCINA0, the DACA pin
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 11;  // EPWM4 ADCSOCA
${INT1(1)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adcina4volts = AdcaResultRegs.ADCRESULT0 * 3.0 / 4096.0;
    readback = AdcaResultRegs.ADCRESULT1 * 3.0 / 4096.0;
    setDACA(3.0 - adcina4volts);

${ISR_END}
}
`,
      checks: [
        { kind: "reg", reg: "DacaRegs.DACOUTEN", field: "DACOUTEN", equals: 1, label: "The DACA output is enabled" },
        { kind: "signal", name: "DACA", at: 6.5, equals: 2.0, tol: 0.005, label: "1.0 V in: DACA at 2.0 V" },
        {
          kind: "var",
          name: "readback",
          at: 6.5,
          min: 1.99,
          max: 2.01,
          label: "readback measures those 2.0 V",
          hint: "A SOC with CHSEL = 0 measures ADCINA0, the DACA pin. Its result is in the register with its SOC number.",
        },
        { kind: "signal", name: "DACA", at: 14.5, equals: 0.4, tol: 0.005, label: "2.6 V in: DACA at 0.4 V" },
        { kind: "var", name: "readback", at: 14.5, min: 0.39, max: 0.41, label: "readback follows to 0.4 V" },
        { kind: "var", name: "adcina4volts", min: 2.598, max: 2.602, label: "adcina4volts shows 2.6 V" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
        },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adcina4volts", "readback"],
      inspect: ["DacaRegs.DACVALA", "AdcaRegs.ADCSOC1CTL", "AdcaResultRegs.ADCRESULT1"],
      hints: [
        "The DAC set-up is the one from the DAC chapter: DACREFSEL, DACOUTEN, between EALLOW and EDIS.",
        "SOC1 with CHSEL = 0 and TRIGSEL = 11, and INT1SEL = 1 because SOC1 now finishes last.",
        "In the function: both results to volts, then `setDACA(3.0 - adcina4volts);`.",
      ],
      takeaway: "readback is always one sample behind: it was measured before this interrupt changed the DAC. Every sampled system has such delays, and control loops have to live with them.",
    },
  ],
};
