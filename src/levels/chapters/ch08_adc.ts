import type { Chapter } from "../types";
import type { Stimulus } from "../../sim/runner";

// One example is carried through the code levels of the chapter. It is the
// pattern of HW2 exercise 3 with different numbers, so that the game does
// not hand out the homework's blanks (HW2: EPWM4, 1 ms, period event):
//   EPWM5 SOCA (counter = 0, every 0.5 ms) -> SOC0 of ADCA (TRIGSEL 13,
//   CHSEL 4, ACQPS 99) -> ADCRESULT0 -> ADCINT1 (INT1SEL 0) -> ADCA1,
//   INT1.1 -> ADCA_ISR
// Samples are taken at 1.5, 2.0, 2.5 ... ms, so stimuli sit at x.25 and
// checks at x.75.

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** EPWM5 as a 0.5 ms trigger source (the structure HW2 gives for EPWM4). */
const EPWM5 = `    EALLOW;
    EPwm5Regs.ETSEL.bit.SOCAEN = 0;      // Disable SOC on A group
    EPwm5Regs.TBCTL.bit.CTRMODE = 3;     // freeze counter
    EPwm5Regs.ETSEL.bit.SOCASEL = 1;     // Select event when counter equal to zero
    EPwm5Regs.ETPS.bit.SOCAPRD = 1;      // Generate pulse on 1st event
    EPwm5Regs.TBCTR = 0x0;               // Clear counter
    EPwm5Regs.TBPHS.bit.TBPHS = 0x0000;  // Phase is 0
    EPwm5Regs.TBCTL.bit.PHSEN = 0;       // Disable phase loading
    EPwm5Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1, 50 MHz clock
    EPwm5Regs.TBPRD = 24999;             // 25000 counts of 20 ns: 0.5 ms sample period
    EPwm5Regs.ETSEL.bit.SOCAEN = 1;      // enable SOCA
    EPwm5Regs.TBCTL.bit.CTRMODE = 0;     // unfreeze, and enter up count mode
    EDIS;`;

/** One ADC powered up as the course does it. Leaves EALLOW open for the SOC lines that follow. */
const adcPower = (L: "a" | "c") => `    EALLOW;
    Adc${L}Regs.ADCCTL2.bit.PRESCALE = 6;     // set ADCCLK divider to /4
    AdcSetMode(ADC_ADC${L.toUpperCase()}, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    Adc${L}Regs.ADCCTL1.bit.INTPULSEPOS = 1;  // interrupt pulse at the end of the conversion
    Adc${L}Regs.ADCCTL1.bit.ADCPWDNZ = 1;     // power up the ADC
    DELAY_US(1000);                        // delay for 1 ms to allow ADC time to power up`;

const ADC_POWER = adcPower("a");

const SOC0 = `    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;     // SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA triggers SOC0`;

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

${EPWM5}

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
  Array.from({ length: to - from }, (_, i) => ({ at: from + i + 0.25, set: "ADCINA4", value: mid + (i % 2 ? 0.2 : -0.2) }));

// ---- adc-single ----
const single = (chsel: number, acqps: number, force: string, volts: string) => `uint16_t adca4result = 0;
float adcina4volts = 0;
int32_t numSamples = 0;

void main(void)
{
    InitSysCtrl();

${ADC_POWER}

    AdcaRegs.ADCSOC0CTL.bit.CHSEL = ${chsel};${chsel === 4 ? "" : "     // TODO 1: SOC0 converts ADCINA4"}
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = ${acqps};${acqps === 99 ? "" : "     // TODO 2: sample window of 500 ns"}
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // software only
${INT1(0)}

    while (1) {
${force}

        // wait until SOC0 has finished
        while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}

        adca4result = AdcaResultRegs.ADCRESULT0;
${volts}

        AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;   // clear the flag: write 1
        numSamples++;
        DELAY_US(1000);                    // one sample per millisecond
    }
}
`;

// ---- adc-adcc, adc-gyro: an analog rate gyro on ADCC ----
// Lab 4 (exercise 3) grades this chain on the robot's LPR510. What the handout states in
// words is printed here (which SOC converts which pin, the interrupt after SOC3). What it
// leaves blank is not: the PIE enable of ADCC1 comes from the library (enableAdccInterrupt(),
// plugins/adc.ts), the trigger is this chapter's EPWM5, and the simulated gyro has another
// range than the LPR510 (250 deg/s per volt), so the scaling line is not the lab's.
const GYRO_MAIN = `void main(void)
{
    InitSysCtrl();

${PIE_INIT}

    EALLOW;
    PieVectTable.ADCC1_INT = &ADCC_ISR;
    EDIS;

${EPWM5}

${adcPower("c")}
    AdccRegs.ADCSOC0CTL.bit.CHSEL = 2;     // SOC0 converts ADCINC2
    AdccRegs.ADCSOC0CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC0CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
    AdccRegs.ADCSOC1CTL.bit.CHSEL = 3;     // SOC1 converts ADCINC3
    AdccRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC1CTL.bit.TRIGSEL = 13;
    AdccRegs.ADCSOC2CTL.bit.CHSEL = 4;     // SOC2 converts ADCINC4
    AdccRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC2CTL.bit.TRIGSEL = 13;
    AdccRegs.ADCSOC3CTL.bit.CHSEL = 5;     // SOC3 converts ADCINC5, the rate gyro
    AdccRegs.ADCSOC3CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC3CTL.bit.TRIGSEL = 13;
    AdccRegs.ADCINTSEL1N2.bit.INT1SEL = 3;  // the end of SOC3, the last one, sets the INT1 flag
    AdccRegs.ADCINTSEL1N2.bit.INT1E = 1;    // enable INT1 flag
    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;  // make sure INT1 flag is cleared
    EDIS;

    enableAdccInterrupt();   // board library: the PIE and IER enables of ADCC1
    EINT;

    while (1) {}
}`;

const GYRO_GLOBALS_VOLT = `__interrupt void ADCC_ISR(void);

float adcC5Volt = 0;           // gyro voltage, V
int32_t numADCCcalls = 0;`;

const GYRO_GLOBALS = `__interrupt void ADCC_ISR(void);

float adcC5Volt = 0;           // gyro voltage, V
float gyro_offset = 0;         // gyro voltage at rest, V
float gyrorate = 0;            // turn rate, deg/s
float gyroangle = 0;           // angle turned since calibration, deg
int32_t numADCCcalls = 0;`;

/** The simulated gyro: 0.43 V at -200 deg/s, 1.23 V at rest, 2.03 V at +200 deg/s. */
const GYRO_DPS_PER_V = 250;

const gyroStimuli: Stimulus[] = [
  { at: 0, set: "ADCINC5", value: 1.33 }, // still settling after power-on
  { at: 1.75, set: "ADCINC5", value: 1.23 }, // at rest
  { at: 150.25, set: "ADCINC5", value: 1.23 + 90 / GYRO_DPS_PER_V }, // +90 deg/s
  { at: 650.25, set: "ADCINC5", value: 1.23 },
  { at: 800.25, set: "ADCINC5", value: 1.23 - 60 / GYRO_DPS_PER_V }, // -60 deg/s
  { at: 1050.25, set: "ADCINC5", value: 1.23 },
];

// adc-gyro: samples 2 to 200 (taken at 2.0, 2.5 ... 101.0 ms) carry +/- 0.02 V of noise around the
// rest voltage, so that one sample alone is not a usable offset. Only the average is.
const gyroNoise: Stimulus[] = Array.from({ length: 199 }, (_, i) => ({ at: 1.75 + 0.5 * i, set: "ADCINC5", value: 1.23 + (i % 2 ? 0.02 : -0.02) }));
const gyroCalStimuli: Stimulus[] = [gyroStimuli[0], ...gyroNoise, { at: 101.25, set: "ADCINC5", value: 1.23 }, ...gyroStimuli.slice(2)];

// ---- adc-joystick ----
const JOY_HEAD = `void setupLED(uint16_t pin)
{
    GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_PUSHPULL);
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    setupLED(22);    // LED1
    setupLED(94);    // LED2
    setupLED(95);    // LED3
    setupLED(97);    // LED4
    setupLED(111);   // LED5

${PIE_INIT}

${VECTOR}

${EPWM5}

${ADC_POWER}
${SOC0}`;

// ---- the set-up ladder: adc-setup-own -> adc-trigger-own -> adc-x-scratch ----
const OWN_GLOBALS = `uint16_t adca4result = 0;
float adcina4volts = 0;
int32_t numSamples = 0;`;

const OWN_SETUP = `// Powers up ADCA and sets up SOC0 for the photoresistor on ADCINA4
void setupADCA(void)
{
${ADC_POWER}
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;     // SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = TRIG;
${INT1(0)}
}`;

const OWN_POLL = `    while (1) {
        AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;        // start SOC0 from software

        // wait until SOC0 has finished
        while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}

        adca4result = AdcaResultRegs.ADCRESULT0;
        adcina4volts = adca4result * 3.0 / 4096.0;

        AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;   // clear the flag: write 1
        numSamples++;
        DELAY_US(1000);                    // one sample per millisecond
    }`;

/** adc-setup-own: the student writes the body of setupADCA(); main() polls. */
const setupOwn = (fn: string) => `${OWN_GLOBALS}

${fn}

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

    setupADCA();

${OWN_POLL}
}
`;

const OWN_SETUP_SW = OWN_SETUP.replace("TRIG;", "0;   // software only");

const TRIGGER_OWN_STARTER = `${OWN_GLOBALS}

${OWN_SETUP_SW}

// TODO 1: write setupEPWM5() here: SOCA every 0.5 ms

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

    // TODO 2: the vector for ADCA_ISR, and call setupEPWM5()

    setupADCA();     // TODO 3: inside it, SOC0 must listen to EPWM5 SOCA

    // TODO 4: enable ADCA1 (INT1.1) in the PIE and in IER, then EINT

    // TODO 5: empty this loop, and move its middle part into ADCA_ISR
${OWN_POLL}
}

// TODO 6: write ADCA_ISR (and its prototype at the top of the file)
`;

const TRIGGER_OWN_SOLUTION = `__interrupt void ADCA_ISR(void);

${OWN_GLOBALS}

${OWN_SETUP.replace("TRIG;", "13;  // EPWM5 ADCSOCA triggers SOC0")}

// EPWM5 as the sample clock: SOCA every 0.5 ms
void setupEPWM5(void)
{
${EPWM5}
}

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

${VECTOR}

    setupEPWM5();
    setupADCA();

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adca4result = AdcaResultRegs.ADCRESULT0;
    adcina4volts = adca4result * 3.0 / 4096.0;
    numSamples++;

${ISR_END}
}
`;

const SCRATCH_STARTER = `__interrupt void ADCA_ISR(void);

float joyXvolts = 0;     // joystick X, volts
int32_t numADCA = 0;     // calls of ADCA_ISR

void main(void)
{
    InitSysCtrl();

    // everything from here on is yours

    while (1) {}
}

__interrupt void ADCA_ISR(void)
{
}
`;

const SCRATCH_SOLUTION = `__interrupt void ADCA_ISR(void);

float joyXvolts = 0;     // joystick X, volts
int32_t numADCA = 0;     // calls of ADCA_ISR

void main(void)
{
    InitSysCtrl();

${PIE_INIT}

${VECTOR}

    EALLOW;
    EPwm2Regs.ETSEL.bit.SOCAEN = 0;      // no pulses while it is set up
    EPwm2Regs.TBCTL.bit.CTRMODE = 3;     // freeze counter
    EPwm2Regs.ETSEL.bit.SOCASEL = 1;     // event: counter equal to zero
    EPwm2Regs.ETPS.bit.SOCAPRD = 1;      // pulse on every event
    EPwm2Regs.TBCTR = 0x0;
    EPwm2Regs.TBPHS.bit.TBPHS = 0x0000;
    EPwm2Regs.TBCTL.bit.PHSEN = 0;
    EPwm2Regs.TBCTL.bit.CLKDIV = 0;      // 50 MHz
    EPwm2Regs.TBPRD = 12499;             // 12500 counts of 20 ns: 0.25 ms
    EPwm2Regs.ETSEL.bit.SOCAEN = 1;      // enable SOCA
    EPwm2Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EDIS;

${ADC_POWER}
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 2;     // SOC0 converts ADCINA2
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 39;    // 40 SYSCLK cycles = 200 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 7;   // EPWM2 ADCSOCA
${INT1(0)}

${ENABLE}

    while (1) {}
}

__interrupt void ADCA_ISR(void)
{
    joyXvolts = AdcaResultRegs.ADCRESULT0 * 3.0 / 4096.0;
    numADCA++;

${ISR_END}
}
`;

export const ch08: Chapter = {
  id: "adc",
  number: 8,
  title: "ADC",
  blurb: "From a voltage to a number: sampling, successive approximation and the SOC chain.",
  requires: ["interrupts"],
  course: ["L5", "HW2", "Lab 4"],
  levels: [
    {
      id: "adc-brief",
      kind: "brief",
      title: "A voltage becomes a number",
      goal: "Learn what the ADC measures, what a sample is and what 12 bits give you.",
      refs: [{ course: "L5", slide: [13, 14, 18] }, { course: "HW2" }, { trm: "11.1" }, { trm: "11.4.5" }],
      brief: `
A digital input only tells high from low. An **analog** signal is a voltage that can take any value in a range, and its exact value is the information. The **ADC** (analog-to-digital converter) measures the voltage on a pin and gives you a number. It is how the robot reads a light sensor, a joystick or its turn-rate sensor.

## A voltage on a pin
A **photoresistor** is a resistor whose resistance changes with light. In a voltage divider on the homework board it gives a low voltage in the dark and a higher one in bright light. A wire carries that voltage to the pin **ADCINA4**.

The ADC compares the pin with a fixed **reference voltage**, 3.0 V on this board. That is the top of its range: it measures from 0 V to 3.0 V, not to 3.3 V.

## Sampling
The ADC takes a **sample**: a snapshot of the voltage at one instant. A tiny capacitor is connected to the pin until it has charged to the pin's voltage, then it is disconnected. The capacitor **holds** that voltage still while it is measured, even if the pin moves on. This is called **sample-and-hold**. To follow a changing signal you sample again and again at a steady rate.

## What 12 bits give you
The measurement is a 12-bit number, 0 to 4095. The range 0 V to 3.0 V is cut into 2^12 = 4096 equal steps of 3.0 V / 4096 = **0.732 mV**. The number of bits, and the step size it gives, is the ADC's **resolution**: the smallest change it can tell apart. The number says which step the voltage is in:

\`\`\`c
ADCRESULT = 4096 * Vin / 3.0       // fraction dropped, limited to 0 ... 4095
volts = ADCRESULT * 3.0 / 4096.0;  // and back to volts, in your code
\`\`\`

So 0 V gives 0, 1.5 V gives 4096 x 1.5 / 3.0 = 2048, and anything from 2.99927 V up gives 4095. Turning a smooth value into a step number is called **quantisation**. The dropped fraction is gone.

{{figure:quantise}}

Try it in the figure: move the pin voltage and watch which step it lands on and how much is lost. Start with 3 or 4 bits.
`,
      questions: [
        {
          prompt: "The pin is at 0.75 V. Which 12-bit number does the ADC give?",
          options: ["750", "1024", "2048", "3072"],
          answer: 1,
          why: "0.75 V is a quarter of 3.0 V, and a quarter of 4096 is 1024.",
        },
        {
          prompt: "The pin voltage changes while the converter is still working out the number. What gets measured?",
          options: [
            "The average of the old and the new voltage",
            "The new voltage",
            "The voltage the capacitor held when it was disconnected from the pin",
            "Nothing: the conversion fails",
          ],
          answer: 2,
          why: "That is the point of sample-and-hold: once the capacitor is disconnected, the pin can do what it likes.",
        },
        {
          prompt: "A sensor's output rises by 0.2 mV. What does a 12-bit ADC with a 3.0 V range report?",
          options: [
            "A result that is 1 higher, always",
            "Usually the same result: the change is smaller than one step of 0.73 mV",
            "A result that is 0.2 higher",
            "An error",
          ],
          answer: 1,
          why: "The result is a whole step number. A change smaller than one step only shows if it happens to cross a step boundary.",
        },
      ],
      takeaway: "Sample, hold, quantise. ADCRESULT = 4096 x Vin / 3.0 with the fraction dropped: 4096 steps of 0.732 mV from 0 V to the 3.0 V reference.",
    },
    {
      id: "adc-sar",
      kind: "register",
      title: "Be the converter",
      goal: "Find the 8-bit result for 1.2 V the way the converter does: one bit at a time, from the top.",
      refs: [{ course: "L5", slide: [19, 20] }, { trm: "11.14" }, { trm: "11.1" }],
      brief: `
How does the converter find the number for the voltage it is holding? Inside it are a small **DAC**, which makes a voltage from a number, and a **comparator**, a circuit that only says which of two voltages is higher. With them it plays a guessing game called **successive approximation** (SAR). It is a **binary search**: the way you find a number between 1 and 100 by always asking "is it at least the middle?". Every answer throws away half of what was left.

In the DAC every bit is worth half of the bit above it. With the 3.0 V reference the top bit is worth 1.5 V, the next 0.75 V, then 0.375 V, and so on.

For each bit, starting with the top one:

1. **Try it.** Set the bit to 1. The DAC makes the voltage of the number so far.
2. **Compare.** Is the held voltage **at least** as high as the DAC voltage?
3. **Decide.** Yes: the bit stays 1. No: the guess was too high, the bit goes back to 0.

Each step halves the range the voltage can still be in. One bit per step, so 12 bits take 12 steps.

{{figure:sar-search}}

Step through the 4-bit search in the figure first with **Next**, and change the held voltage to see the answers change.

## Your turn
This small converter has **8 bits**. The held voltage is **1.2 V**. The first two steps:

- Bit 7: try 1.5 V. Is 1.2 V at least 1.5 V? **No**, so bit 7 = 0.
- Bit 6: try 0.75 V. Is 1.2 V at least 0.75 V? **Yes**, so bit 6 = 1.
- Bit 5: try 0.75 + 0.375 = 1.125 V. You continue.

Add the bit you are trying to what you have **kept** so far. Set all eight bits.
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
        "Bit 5: 1.125 V is below 1.2 V, so it stays 1. What do you have to add for bit 4?",
        "Bit 4: 1.125 + 0.1875 = 1.3125 V, too high. Bit 3: 1.125 + 0.09375 = 1.21875 V, too high. Bit 2: 1.171875 V fits.",
        "The result is 0110 0110. You can check it with 256 x 1.2 / 3.0 = 102.4.",
      ],
      takeaway: "Successive approximation is a binary search with a DAC and a comparator: one step per bit, top bit first. The bits are worth 1/2, 1/4, 1/8 ... of the reference, which is where the 4096 in the formula comes from.",
    },
    {
      id: "adc-soc",
      kind: "brief",
      title: "Trigger, SOC, converter, result",
      goal: "Learn the chain from a trigger to your interrupt function, and what a SOC is.",
      refs: [{ course: "L5", slide: [22, 23, 26] }, { course: "HW2" }, { trm: "11.5" }, { trm: "11.5.1" }, { trm: "11.9" }],
      brief: `
## One converter, many pins
The chip has four ADCs: ADCA, ADCB, ADCC and ADCD. Each is **one converter** with several input pins in front of it and a selector switch (a multiplexer) that connects **one** pin at a time. ADCA has the pins ADCINA0 to ADCINA5.

So every conversion needs three answers: **when** to convert, **which pin**, and **for how long** to sample.

## A SOC is a slot
A SOC ("start of conversion") is a **configuration slot** that holds those answers: one line of a to-do list. Each ADC has 16 of them, SOC0 to SOC15, each with three settings:

- \`TRIGSEL\`: **when**. Which trigger starts it.
- \`CHSEL\`: **which pin**. The channel number, 4 for ADCINA4.
- \`ACQPS\`: **how long** the capacitor samples the pin.

## The chain
{{figure:adc-chain}}

Step through the figure with **Next**. It shows the example this chapter builds: the photoresistor on ADCINA4, SOC0, and EPWM5 as the trigger. An **ePWM** is a peripheral built around a counter that runs round and round. The PWM chapter uses it to make motor signals. Here it is only a steady clock.

1. **The trigger** says "now". EPWM5's counter sends a pulse called SOCA once per round.
2. **SOC0** listens for that pulse (\`TRIGSEL\`) and names the pin (\`CHSEL\`) and the sample time (\`ACQPS\`).
3. **The converter** connects to that pin, samples, holds and works out the 12-bit number.
4. **The result** goes to \`AdcaResultRegs.ADCRESULT0\`. The result register has the **number of the SOC**, whatever pin it measured.
5. **The interrupt.** \`ADCINTSEL1N2.INT1SEL\` chooses **which SOC's end** sets the flag ADCINT1, and \`INT1E = 1\` switches that flag on. It reaches the PIE as interrupt **ADCA1** (INT1.1), and the CPU runs your function.

## Keep apart
- **A SOC is not a converter.** All 16 SOCs of ADCA share the one converter and take turns.
- **The SOC number is not the pin number.** SOC0 can measure ADCINA4.
- **The trigger only says when.** EPWM5 measures nothing and knows no pins.
- "SOCA" is a pulse an ePWM **sends**. "SOC0" is a slot that **listens**. \`TRIGSEL\` connects them.
`,
      questions: [
        {
          prompt: "What is SOC0?",
          options: [
            "The first of 16 converters inside ADCA",
            "The pin ADCINA0",
            "A slot of settings that describes one conversion: when, which pin, how long",
            "The pulse that an ePWM sends",
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
          prompt: "You change the ePWM so that it sends its SOCA pulse half as often. What changes?",
          options: [
            "The ADC measures a different pin",
            "The results are half as large",
            "The result moves to ADCRESULT1",
            "Only how often the photoresistor is measured",
          ],
          answer: 3,
          why: "The trigger only says when. Pin, sample time and result register are set in the SOC and stay as they are.",
        },
        {
          prompt: "SOC0, SOC1 and SOC2 share one trigger and convert one after the other. You want one interrupt when all three results are ready. Which SOC should `INT1SEL` name?",
          options: ["SOC0, the first", "SOC2, the last", "Any of them", "None: three SOCs need three interrupts"],
          answer: 1,
          why: "INT1SEL names the SOC whose end sets ADCINT1. When the last one ends, all three results are in their registers.",
        },
      ],
      takeaway: "Trigger (when) -> SOCx (TRIGSEL, CHSEL, ACQPS) -> the one converter -> ADCRESULTx -> INTxSEL picks whose end raises ADCINT -> PIE -> your function.",
    },
    {
      id: "adc-single",
      kind: "code",
      mode: "complete",
      title: "One sample by hand",
      goal: "Set SOC0 to the photoresistor pin, trigger it from software once per millisecond and convert each result to volts.",
      refs: [{ trm: "11.6.4" }, { trm: "11.12" }, { trm: "11.4.6" }, { course: "HW2" }, { course: "L5", slide: [27, 25, 18] }],
      brief: `
Before an ePWM gets involved, pull the trigger yourself. It is the same chain with a different first link, and it shows that the trigger really is only "when".

## Power up
The ADC is off after reset. The first block of the code is the course's set-up, **given**: you will copy it unchanged into every ADC program. Line by line: \`PRESCALE = 6\` divides the 200 MHz clock by 4 for the converter, \`AdcSetMode\` chooses 12-bit results, \`INTPULSEPOS = 1\` makes the flag come at the end of the conversion, \`ADCPWDNZ = 1\` switches the power on. Then **1 ms of waiting** while the converter's circuits settle (the data sheet asks for 500 us). The three \`INT1\` lines make the end of SOC0 set the flag ADCINT1.

## Your part
1. **SOC0, which pin:** \`CHSEL\` for ADCINA4.
2. **SOC0, how long:** \`ACQPS\` for a sample window of 500 ns, the course's value. The window is (ACQPS + 1) cycles of the 200 MHz system clock, 5 ns each. Example: \`ACQPS = 19\` gives 20 x 5 ns = 100 ns.
3. **When:** \`TRIGSEL\` stays 0, "software only". In the loop, start the conversion by writing 1 to SOC0's bit in the force register:
\`\`\`c
AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
\`\`\`
4. The given inner loop waits until the flag ADCINT1 says SOC0 has finished. Then compute the voltage:
\`\`\`c
adcina4volts = adca4result * 3.0 / 4096.0;
\`\`\`
Keep the decimal points. With \`3 / 4096\` C divides whole numbers and drops the fraction: 1.2 V would read 1.

The SOC registers are protected (\`EALLOW\`). The flag and force registers are not.

In the test the photoresistor is at 1.2 V, then at 2.4 V. On the board you can turn its knob.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 6.25, set: "ADCINA4", value: 2.4 },
      ],
      starter: single(0, 0, "        // TODO 3: start SOC0 from software", "        // TODO 4: convert adca4result to volts\n        adcina4volts = 0;"),
      solution: single(4, 99, "        AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;", "        adcina4volts = adca4result * 3.0 / 4096.0;"),
      checks: [
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 4, label: "SOC0 measures ADCINA4", hint: "The channel number is the digit at the end of the pin name." },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC0CTL",
          field: "ACQPS",
          equals: 99,
          label: "The sample window is 500 ns",
          hint: "500 ns is 100 cycles of 5 ns, and the field holds one less.",
        },
        {
          kind: "var",
          name: "adca4result",
          at: 5,
          equals: 1638,
          label: "adca4result is 1638, the number for 1.2 V",
          hint: "If it is 0, the conversion never ran (force SOC0) or measured another pin (CHSEL).",
        },
        {
          kind: "var",
          name: "adcina4volts",
          at: 5,
          min: 1.199,
          max: 1.201,
          label: "adcina4volts is 1.2 V",
          hint: "A whole number such as 1 means integer division: write 3.0 and 4096.0. The range is 3.0 V, not 3.3 V.",
        },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V after the light changes" },
        {
          kind: "var",
          name: "numSamples",
          min: 9,
          max: 12,
          label: "One sample per millisecond",
          hint: "0 means the loop is stuck waiting for ADCINT1: nothing started SOC0. Force it at the top of the loop.",
        },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adca4result", "adcina4volts", "numSamples"],
      inspect: ["AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTFLG", "AdcaResultRegs.ADCRESULT0"],
      hints: [
        "The channel number is the digit at the end of the pin name. The window is (ACQPS + 1) x 5 ns.",
        "`AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;` sets SOC0's flag, exactly as a hardware trigger would.",
        "`CHSEL = 4`, `ACQPS = 99`, and `adcina4volts = adca4result * 3.0 / 4096.0;`",
      ],
      takeaway: "A software trigger, a timer and an ePWM all do the same thing: set the SOC's flag. Everything after that is identical.",
    },
    {
      id: "adc-epwm",
      kind: "code",
      mode: "complete",
      title: "An ePWM pulls the trigger",
      goal: "Fill in the blanks so that EPWM5 starts SOC0 every half millisecond and ADCA_ISR gets each result.",
      refs: [{ course: "L8-9", slide: 20, note: "an ePWM used as the ADC's sample clock" }, { course: "L5", slide: 27 }, { course: "HW2" }, { trm: "11.6.1" }, { trm: "15.10" }, { trm: "11.16.2" }, { trm: "3.4.5" }],
      brief: `
Now hand the trigger to hardware: an ePWM, used only as a very regular clock. Homework 2 does this with EPWM4 and its own numbers. Here it is **EPWM5**, with a different event and rate.

## The trigger side: EPWM5
- The counter \`TBCTR\` counts up from 0 to \`TBPRD\`, then starts again at 0. The ePWM clock is the system clock divided by 4: 50 MHz, so one count lasts 20 ns. One round is TBPRD + 1 counts. Example: a round of 0.2 ms is 0.2 ms / 20 ns = 10000 counts, so \`TBPRD = 9999\`. \`TBPRD\` has 16 bits: 65535 at most.
- \`ETSEL.SOCASEL\` chooses **which counter event** makes the SOCA pulse: 1 is "counter equals zero", 2 is "counter equals TBPRD".
- \`ETPS.SOCAPRD\` chooses **how many** of those events it takes: 1 is every event, 2 every second one, 3 every third. 0 switches the pulse off.
- \`TBCTL.CTRMODE\`: 3 freezes the counter, 0 counts up.

## The listening side: SOC0
\`TRIGSEL\` holds the number of the trigger. From the manual's table: 0 is software only, 1 to 3 are CPU timers 0 to 2, 4 is a pin. Then come two numbers per ePWM, SOCA first: 5 and 6 for EPWM1, 7 and 8 for EPWM2, and so on.

## The blanks
1. \`SOCASEL\`: pulse when the counter equals **zero**.
2. \`SOCAPRD\`: on every event.
3. \`TBPRD\`: a round of **0.5 ms**. Counting the "+ 1" earns a star. Without it the round is 20 ns too long, which passes.
4. \`CTRMODE\`: up count.
5. \`CHSEL\`: ADCINA4.
6. \`TRIGSEL\`: EPWM5 SOCA.
7. \`INT1SEL\`: the SOC whose end calls \`ADCA_ISR\`. SOC0 is the only one in use.

\`ADCA_ISR\` and the interrupt enables are complete. The other EPWM5 lines (\`TBPHS\`, \`PHSEN\`, \`CLKDIV\`, \`SOCAEN\`) are given, and the PWM chapter explains them. The photoresistor is at 1.2 V, then at 2.4 V.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 7.25, set: "ADCINA4", value: 2.4 },
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
    EPwm5Regs.ETSEL.bit.SOCAEN = 0;      // Disable SOC on A group
    EPwm5Regs.TBCTL.bit.CTRMODE = 3;     // freeze counter
    EPwm5Regs.ETSEL.bit.SOCASEL = 0;     // TODO 1: Select event when counter equal to zero
    EPwm5Regs.ETPS.bit.SOCAPRD = 0;      // TODO 2: Generate pulse on 1st event
    EPwm5Regs.TBCTR = 0x0;               // Clear counter
    EPwm5Regs.TBPHS.bit.TBPHS = 0x0000;  // Phase is 0
    EPwm5Regs.TBCTL.bit.PHSEN = 0;       // Disable phase loading
    EPwm5Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1, 50 MHz clock
    EPwm5Regs.TBPRD = 0;                 // TODO 3: Set period to 0.5 ms
    EPwm5Regs.ETSEL.bit.SOCAEN = 1;      // enable SOCA
    EPwm5Regs.TBCTL.bit.CTRMODE = 3;     // TODO 4: unfreeze, and enter up count mode
    EDIS;

${ADC_POWER}
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 0;     // TODO 5: SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // TODO 6: EPWM5 ADCSOCA
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
          reg: "EPwm5Regs.ETSEL",
          field: "SOCASEL",
          equals: 1,
          label: "SOCA is sent when the counter equals zero",
          hint: "1 is 'counter equals zero', 2 is 'counter equals TBPRD'.",
        },
        { kind: "reg", reg: "EPwm5Regs.ETPS", field: "SOCAPRD", equals: 1, label: "A pulse on every event", hint: "0 means no pulse at all." },
        { kind: "reg", reg: "EPwm5Regs.TBCTL", field: "CTRMODE", equals: 0, label: "The counter counts up", hint: "3 keeps it frozen: no counting, no pulses." },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC0CTL",
          field: "TRIGSEL",
          equals: 13,
          label: "SOC0 listens to EPWM5 SOCA",
          hint: "Two numbers per ePWM, SOCA first, starting with 5 for EPWM1 SOCA. Count up to EPWM5.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 4, label: "SOC0 measures ADCINA4", hint: "The channel number is the digit at the end of the pin name." },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1SEL",
          equals: 0,
          label: "The end of SOC0 sets ADCINT1",
          hint: "INT1SEL is a SOC number. Only SOC0 ever converts here.",
        },
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 20,
          max: 25,
          label: "ADCA_ISR runs once per half millisecond",
          hint: "0 times: a link before the function is broken, so fix the failing lines above first. Too few: check TBPRD. 0.5 ms is 500 us / 20 ns counts, and a value above 65535 does not fit in TBPRD.",
        },
        { kind: "var", name: "adcina4volts", at: 6.75, min: 1.199, max: 1.201, label: "adcina4volts follows the pin: 1.2 V" },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V after the light changes" },
      ],
      bonus: [
        {
          kind: "reg",
          reg: "EPwm5Regs.TBPRD",
          equals: 24999,
          label: "The sample period is exactly 0.5 ms",
          hint: "One round of the counter is TBPRD + 1 counts, because 0 is a count too.",
        },
      ],
      watch: ["adca4result", "adcina4volts", "numADCA"],
      inspect: ["EPwm5Regs.ETSEL", "EPwm5Regs.ETPS", "EPwm5Regs.TBPRD", "AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTSEL1N2"],
      hints: [
        "Work down the list of seven. Each blank is one small number from the brief.",
        "0.5 ms / 20 ns = 25000 counts. The trigger numbers go 5, 6 for EPWM1, then 7, 8, and so on: SOCA of EPWM5 is the ninth in that row.",
        "EPWM5: SOCASEL = 1, SOCAPRD = 1, TBPRD = 24999, CTRMODE = 0. ADC: CHSEL = 4, TRIGSEL = 13, INT1SEL = 0.",
      ],
      takeaway: "The ePWM sends SOCA (ETSEL, ETPS, TBPRD). SOC0 listens with TRIGSEL, measures the pin in CHSEL, and INT1SEL lets its end call your function.",
    },
    {
      id: "adc-isr",
      kind: "code",
      mode: "write",
      title: "Night light",
      goal: "Write the ADCA1 interrupt function and its enables so that LED1 turns on when the photoresistor is in the dark.",
      refs: [{ course: "L5", slide: 26 }, { course: "L4", slide: [28, 29] }, { course: "HW2" }, { trm: "11.9" }, { trm: "3.4.5" }, { trm: "11.4.6" }],
      brief: `
EPWM5, SOC0 and the ADC interrupt select are set up as before. Three things are missing: the path to the CPU, the interrupt function, and a use for the number.

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

The test starts in bright light (2.5 V), goes dark (0.9 V), then just bright enough (1.1 V).
`,
      kit: "robot",
      durationMs: 18,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 2.5 },
        { at: 6.25, set: "ADCINA4", value: 0.9 },
        { at: 12.25, set: "ADCINA4", value: 1.1 },
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
          min: 30,
          max: 36,
          label: "ADCA_ISR runs on every sample, twice per millisecond",
          hint: "Never: check the vector, PIEIER1.INTx1 and IER. Once: the ADC flag or PIEACK is not cleared at the end.",
        },
        {
          kind: "var",
          name: "adcina4volts",
          at: 5.75,
          min: 2.498,
          max: 2.502,
          label: "adcina4volts shows 2.5 V in bright light",
          hint: "Read AdcaResultRegs.ADCRESULT0 into adca4result, then adcina4volts = adca4result * 3.0 / 4096.0;",
        },
        { kind: "led", led: "LED1", at: 5.75, on: false, label: "LED1 is off in bright light" },
        { kind: "led", led: "LED1", at: 9.75, on: true, label: "LED1 turns on in the dark (0.9 V)", hint: "Dark means a low voltage: on when adcina4volts < 1.0. If you compare the raw result instead: 1.0 V is 1365, not 1000." },
        { kind: "led", led: "LED1", at: 15.75, on: false, label: "LED1 turns off again at 1.1 V", hint: "The threshold is 1.0 V. In counts that is 1365, not 1000." },
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
        "Start in main(): the vector at the first TODO, PIEIER1 and IER at the second. Then the five steps in the function, in the order of the list.",
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
      refs: [{ course: "L5", slide: [26, 28] }, { trm: "11.9" }, { trm: "11.9.1" }, { trm: "11.9.2" }, { course: "HW2" }],
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
        { at: 7.25, set: "ADCINA4", value: 2.4 },
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
          min: 20,
          max: 25,
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
        { kind: "var", name: "adcina4volts", at: 6.75, min: 1.199, max: 1.201, label: "adcina4volts shows 1.2 V" },
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
      id: "adc-adcc",
      kind: "code",
      mode: "complete",
      title: "Another ADC, another letter",
      goal: "Read the robot's turn-rate sensor on ADCC: find its result register and clear the right flag.",
      refs: [{ course: "Lab 4" }, { course: "L5", slide: [16, 26] }, { trm: "11.5.5" }, { trm: "11.9" }, { trm: "3.4.5" }],
      brief: `
The robot carries a **rate gyro**. It is a sensor whose output voltage follows how fast the robot **turns**. At rest it gives about 1.2 V. Turning one way raises the voltage, turning the other way lowers it.

## Where it is connected
The gyro is on pin **ADCINC5**: a pin of **ADCC**, not ADCA. Everything you know carries over with a new letter: \`AdccRegs\`, \`AdccResultRegs\`, and the interrupt **ADCC1**, which is in PIE group 1 like ADCA1.

The set-up in \`main()\` is given: **four** SOCs of ADCC on one trigger, for the pins ADCINC2 to ADCINC5, with the interrupt after the last one. Each SOC has the three lines you know. One line is new: \`enableAdccInterrupt()\` comes from the board's library and sets the PIE and IER enables of ADCC1. Finding that PIE channel in Table 3-2 is part of Lab 4.

## Your part, in ADCC_ISR
1. Find in \`main()\` the SOC whose \`CHSEL\` is 5. The result register has **that SOC's number**, not the pin's. Convert it to volts in \`adcC5Volt\`:
\`\`\`c
adcC5Volt = AdccResultRegs.ADCRESULT?? * 3.0 / 4096.0;
\`\`\`
2. Clear ADCINT1 **of ADCC**. It is the line you know with the new letter.

The PIE acknowledge is given: ADCC1 is in group 1 as well.

In the test the robot stands still (1.23 V), then turns.

The robot's own code divides by 4095 here. The manual's 4096 is exact, the difference is 0.02 %, and both pass.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: gyroStimuli.slice(0, 3),
      starter: `${GYRO_GLOBALS_VOLT}

${GYRO_MAIN}

// adcc1 pie interrupt, every 0.5 ms
__interrupt void ADCC_ISR(void)
{
    numADCCcalls++;

    // TODO 1: adcC5Volt from the right result register

    // TODO 2: clear the ADCC flag
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${GYRO_GLOBALS_VOLT}

${GYRO_MAIN}

// adcc1 pie interrupt, every 0.5 ms
__interrupt void ADCC_ISR(void)
{
    numADCCcalls++;

    adcC5Volt = AdccResultRegs.ADCRESULT3 * 3.0 / 4096.0;   // SOC3 converts ADCINC5

    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        {
          kind: "isr",
          fn: "ADCC_ISR",
          min: 590,
          max: 600,
          label: "ADCC_ISR runs on every sample",
          hint: "If it ran once: the flag of ADCC is still set. AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; (Adcc, not Adca).",
        },
        {
          kind: "var",
          name: "adcC5Volt",
          at: 50.75,
          min: 1.228,
          max: 1.232,
          label: "adcC5Volt shows the gyro's 1.23 V at rest",
          hint: "ADCINC5 is measured by SOC3, so its number is in AdccResultRegs.ADCRESULT3. Nothing converts into ADCRESULT5, and AdcaResultRegs belongs to another ADC. Exactly 1: integer division, write 3.0 and 4096.0.",
        },
        { kind: "var", name: "adcC5Volt", min: 1.588, max: 1.592, label: "and 1.59 V while the robot turns" },
        {
          kind: "no-diagnostic",
          code: "adc",
          label: "The ADC reports no problem",
          hint: "A result register that no SOC fills stays at 0. Use the register with the number of the SOC that measures ADCINC5.",
        },
      ],
      watch: ["adcC5Volt", "numADCCcalls"],
      inspect: ["AdccRegs.ADCSOC3CTL", "AdccResultRegs.ADCRESULT3", "AdccRegs.ADCINTFLG"],
      hints: [
        "Read the comments of the SOC lines in main(): which SOC converts ADCINC5?",
        "SOC3 does, so the number is in `AdccResultRegs.ADCRESULT3`.",
        "`adcC5Volt = AdccResultRegs.ADCRESULT3 * 3.0 / 4096.0;` and `AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;` before the PIE acknowledge.",
      ],
      takeaway: "Another ADC is the same chain with another letter: AdccRegs, AdccResultRegs, its own ADCINT1 flag and its own PIE channel. The result register still follows the SOC number.",
    },
    {
      id: "adc-gyro",
      kind: "code",
      mode: "write",
      title: "How fast is the robot turning",
      goal: "Remove the gyro's offset, then turn its voltage into a turn rate and an angle.",
      refs: [{ course: "Lab 4" }, { course: "L15", slide: [33, 32], note: "gyro bias calibration, then rate to angle" }, { trm: "11.5.5" }, { trm: "11.9" }],
      continues: "adc-adcc",
      brief: `
\`adcC5Volt\` from the last level is a voltage. The robot wants to know how fast it turns, and how far it has turned.

## Offset
At rest the gyro outputs a constant voltage, its **offset**, about 1.2 V. The exact value differs from gyro to gyro, so the program measures it at start-up while the robot stands still. That is a **calibration**.

One sample is not a safe offset. Right after power-on the gyro has not settled, and every sample carries **noise**: a small random error. The **average** of many samples is much steadier. To average 200 samples, add them up and divide the sum by 200.

## Rate and angle
A gyro's data sheet gives its range as two points. For the gyro of this simulated robot: **0.43 V at -200 deg/s** and **2.03 V at +200 deg/s**, with 1.23 V at rest. So 0.8 V away from rest is 200 deg/s, and one volt is 200 / 0.8 = **250 degrees per second**. Example: 1.43 V with an offset of 1.23 V is 0.2 V x 250 = 50 deg/s.

The gyro on the lab robot (an LPR510) has another range. Lab 4 gives it in the same form, and you work out its scale the same way.

A rate times a time is an angle. \`ADCC_ISR\` runs every 0.5 ms = 0.0005 s. At 50 deg/s the robot turns 50 x 0.0005 = 0.025 degrees in that time. Add up these small pieces on every call and you have the angle turned so far.

## Add to ADCC_ISR, after the adcC5Volt line
1. **Calls 1 to 200:** add \`adcC5Volt\` to a sum. Make a new global \`float\` for it. On call 200, \`gyro_offset\` = the sum divided by \`200.0\`.
2. **After call 200:**
\`\`\`c
gyrorate = (adcC5Volt - gyro_offset) * 250.0;   // deg/s
gyroangle = gyroangle + gyrorate * 0.0005;      // deg
\`\`\`

\`numADCCcalls\` already counts the calls. On the real robot you wait longer and average more samples.

In the test the robot stands still during the calibration, and its samples jump between 1.21 V and 1.25 V: that is the noise.
`,
      kit: "robot",
      durationMs: 1200,
      stimuli: gyroCalStimuli,
      starter: `${GYRO_GLOBALS}

${GYRO_MAIN}

// adcc1 pie interrupt, every 0.5 ms
__interrupt void ADCC_ISR(void)
{
    numADCCcalls++;

    adcC5Volt = AdccResultRegs.ADCRESULT3 * 3.0 / 4096.0;   // SOC3 converts ADCINC5

    // TODO 1: calls 1 to 200: add up, then set gyro_offset

    // TODO 2: after call 200: gyrorate and gyroangle

    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${GYRO_GLOBALS}
float offsetsum = 0;

${GYRO_MAIN}

// adcc1 pie interrupt, every 0.5 ms
__interrupt void ADCC_ISR(void)
{
    numADCCcalls++;

    adcC5Volt = AdccResultRegs.ADCRESULT3 * 3.0 / 4096.0;   // SOC3 converts ADCINC5

    if (numADCCcalls <= 200) {
        offsetsum = offsetsum + adcC5Volt;
        if (numADCCcalls == 200) {
            gyro_offset = offsetsum / 200.0;
        }
    } else {
        gyrorate = (adcC5Volt - gyro_offset) * 250.0;
        gyroangle = gyroangle + gyrorate * 0.0005;
    }

    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        {
          kind: "isr",
          fn: "ADCC_ISR",
          min: 2380,
          max: 2400,
          label: "ADCC_ISR runs on every sample",
          hint: "If it ran once: clear the flag of ADCC, AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;",
        },
        {
          kind: "var",
          name: "adcC5Volt",
          at: 110.75,
          min: 1.228,
          max: 1.232,
          label: "adcC5Volt shows the gyro's 1.23 V at rest",
          hint: "ADCINC5 is measured by SOC3, so its number is in AdccResultRegs.ADCRESULT3.",
        },
        {
          kind: "var",
          name: "gyro_offset",
          at: 60.75,
          equals: 0,
          label: "During the first 200 samples the offset is not set yet",
          hint: "The offset comes out of the calibration: set it once, on call 200, from the sum.",
        },
        {
          kind: "source",
          mustNotMatch: "gyro_offset\\s*=\\s*[-+]?(?!0(\\.0*)?f?\\s*;)[0-9.]+f?\\s*;",
          label: "The offset is measured, not typed in as a number",
          hint: "Another gyro, or the same one on a warmer day, rests at another voltage. Work the offset out from the samples.",
        },
        {
          kind: "var",
          name: "gyro_offset",
          at: 120.75,
          min: 1.2285,
          max: 1.2325,
          label: "The offset is the average of the first 200 samples",
          hint: "Still 0: set it on call 200. Exactly 1: the sum is an integer, make it a float. 1.33: that is the first sample alone, taken while the gyro settles. 1.21 or 1.25: that is one noisy sample, not the average. Add up 200 and divide by 200.0.",
        },
        {
          kind: "var",
          name: "gyrorate",
          at: 130.75,
          min: -1,
          max: 1,
          label: "At rest the turn rate is 0 deg/s (within 1)",
          hint: "Subtract the offset before you multiply by 250. If the offset check above fails, fix that first.",
        },
        { kind: "var", name: "gyrorate", at: 400.75, min: 89, max: 91, label: "Turning: 90 deg/s", hint: "(adcC5Volt - gyro_offset) * 250.0. About 144: that is the scale of another gyro, this one gives 250 deg/s per volt." },
        {
          kind: "var",
          name: "gyroangle",
          at: 700.75,
          min: 44.3,
          max: 45.7,
          label: "Half a second at 90 deg/s: the angle is 45 degrees",
          hint: "Add gyrorate * 0.0005 on every call after the calibration. 0.0005 s is the time between two samples. An angle in the thousands means the 0.0005 is missing.",
        },
        { kind: "var", name: "gyrorate", at: 900.75, min: -61, max: -59, label: "Turning back: -60 deg/s" },
        { kind: "var", name: "gyroangle", min: 29.3, max: 30.7, label: "A quarter second at -60 deg/s takes the angle back to 30 degrees" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adcC5Volt", "gyro_offset", "gyrorate", "gyroangle", "numADCCcalls"],
      inspect: ["AdccRegs.ADCSOC3CTL", "AdccResultRegs.ADCRESULT3", "AdccRegs.ADCINTFLG"],
      hints: [
        "Add a global such as `float offsetsum = 0;`. The two cases are an `if (numADCCcalls <= 200) { ... } else { ... }`.",
        "Inside the first case: `offsetsum = offsetsum + adcC5Volt;` and, `if (numADCCcalls == 200)`, set the offset to `offsetsum / 200.0`.",
        "The `else` holds the two lines from the brief, unchanged. Both go before the flag clear.",
      ],
      takeaway: "A gyro gives a rate. The angle is the sum of rate x time, so every small offset error adds up: watch gyroangle creep while the robot stands still. That is gyro drift, and a later chapter corrects it with other sensors.",
    },
    {
      id: "adc-joystick",
      kind: "code",
      mode: "checkpoint",
      title: "Three pins, one trigger",
      goal: "Add the joystick's two axes to the sequence and light the LED for the direction it is pushed.",
      refs: [{ course: "L5", slide: [26, 16] }, { course: "HW2" }, { trm: "11.6.3" }, { trm: "11.7" }, { trm: "11.9" }],
      brief: `
A joystick is two sensors: its **X** axis is on **ADCINA2** and its **Y** axis on **ADCINA3**. Each gives 1.5 V at rest and moves towards 0 V or 3 V when pushed. Homework 2 reads the same joystick with its own SOC order and LEDs.

One converter, three pins. So use three slots and let them take turns:

- SOC0: ADCINA4, the photoresistor. It stays as it is.
- **SOC1: ADCINA3**, joystick Y.
- **SOC2: ADCINA2**, joystick X.

Each new SOC needs the same three lines as SOC0: \`CHSEL\`, \`ACQPS\` and \`TRIGSEL\`. Give all three the **same trigger**. On each pulse the converter works through them in order: SOC0, SOC1, SOC2. The three conversions take about 2 us together.

You want **one** interrupt, when all three results are ready. Which SOC finishes last? Point \`INT1SEL\` at it.

## In ADCA_ISR
Read the three results (which result register belongs to which SOC?) and convert them to volts in \`adcina4volts\`, \`joyxvolts\` and \`joyyvolts\`.

Then exactly **one** of the robot board's five LEDs is on. Check in this order:

1. Y above 2.0 V: **LED1** (GPIO22)
2. Y below 1.0 V: **LED2** (GPIO94)
3. X above 2.0 V: **LED3** (GPIO95)
4. X below 1.0 V: **LED4** (GPIO97)
5. otherwise (joystick at rest): **LED5** (GPIO111)

The LED pins are outputs already. GPIO22 is in port A, GPIO94 and GPIO95 in port C, GPIO97 and GPIO111 in port D.
`,
      kit: "robot",
      durationMs: 30,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 0.9 },
        { at: 6.25, set: "ADCINA3", value: 2.2 },
        { at: 10.25, set: "ADCINA3", value: 0.8 },
        { at: 14.25, set: "ADCINA3", value: 1.5 },
        { at: 14.25, set: "ADCINA2", value: 2.2 },
        { at: 18.25, set: "ADCINA2", value: 0.8 },
        { at: 22.25, set: "ADCINA3", value: 2.3 },
        { at: 26.25, set: "ADCINA3", value: 1.9 },
        { at: 26.25, set: "ADCINA2", value: 1.1 },
      ],
      starter: `__interrupt void ADCA_ISR(void);

int16_t adca4result = 0;
float adcina4volts = 0;
float joyxvolts = 0;
float joyyvolts = 0;

${JOY_HEAD}
    // TODO: SOC1 converts ADCINA3 (joystick Y), SOC2 converts ADCINA2 (joystick X)

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
int16_t adca3result = 0;
int16_t adca2result = 0;
float adcina4volts = 0;
float joyxvolts = 0;
float joyyvolts = 0;

${JOY_HEAD}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 3;     // SOC1 converts ADCINA3
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
    AdcaRegs.ADCSOC2CTL.bit.CHSEL = 2;     // SOC2 converts ADCINA2
    AdcaRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC2CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
${INT1(2)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    adca4result = AdcaResultRegs.ADCRESULT0;
    adca3result = AdcaResultRegs.ADCRESULT1;
    adca2result = AdcaResultRegs.ADCRESULT2;
    adcina4volts = adca4result * 3.0 / 4096.0;
    joyyvolts = adca3result * 3.0 / 4096.0;
    joyxvolts = adca2result * 3.0 / 4096.0;

    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    GpioDataRegs.GPDCLEAR.bit.GPIO97 = 1;
    GpioDataRegs.GPDCLEAR.bit.GPIO111 = 1;
    if (joyyvolts > 2.0) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else if (joyyvolts < 1.0) {
        GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    } else if (joyxvolts > 2.0) {
        GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    } else if (joyxvolts < 1.0) {
        GpioDataRegs.GPDSET.bit.GPIO97 = 1;
    } else {
        GpioDataRegs.GPDSET.bit.GPIO111 = 1;
    }

${ISR_END}
}
`,
      checks: [
        { kind: "reg", reg: "AdcaRegs.ADCSOC1CTL", field: "CHSEL", equals: 3, label: "SOC1 measures ADCINA3 (joystick Y)", hint: "AdcaRegs.ADCSOC1CTL.bit.CHSEL = 3;" },
        { kind: "reg", reg: "AdcaRegs.ADCSOC2CTL", field: "CHSEL", equals: 2, label: "SOC2 measures ADCINA2 (joystick X)", hint: "AdcaRegs.ADCSOC2CTL.bit.CHSEL = 2;" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC1CTL",
          field: "TRIGSEL",
          equals: 13,
          label: "SOC1 listens to EPWM5 SOCA, like SOC0",
          hint: "With TRIGSEL = 0 a SOC never starts. Copy SOC0's TRIGSEL line for SOC1.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC2CTL",
          field: "TRIGSEL",
          equals: 13,
          label: "SOC2 listens to EPWM5 SOCA too",
          hint: "With TRIGSEL = 0 SOC2 never starts, and an interrupt that waits for its end never comes.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1SEL",
          equals: 2,
          label: "The interrupt comes after the last SOC",
          hint: "With INT1SEL = 0 the function runs while SOC1 and SOC2 are still converting, and reads their results from the previous sample.",
        },
        { kind: "var", name: "adcina4volts", at: 5.75, min: 0.899, max: 0.901, label: "The photoresistor still reads 0.9 V", hint: "0 means ADCA_ISR never ran: the SOC that INT1SEL names never finishes. Fix the lines above first." },
        { kind: "led", led: "LED5", at: 5.75, on: true, label: "At rest: LED5", hint: "The last else of the chain: GpioDataRegs.GPDSET.bit.GPIO111 = 1;" },
        { kind: "var", name: "joyyvolts", at: 9.75, min: 2.198, max: 2.202, label: "joyyvolts shows 2.2 V", hint: "SOC1's result is in ADCRESULT1." },
        { kind: "led", led: "LED1", at: 9.75, on: true, label: "Y high: LED1" },
        { kind: "led", led: "LED5", at: 9.75, on: false, label: "and LED5 is off: only one LED at a time", hint: "Turn all five LEDs off with CLEAR before the if chain turns one on." },
        { kind: "led", led: "LED2", at: 13.75, on: true, label: "Y low (0.8 V): LED2" },
        { kind: "var", name: "joyxvolts", at: 17.75, min: 2.198, max: 2.202, label: "joyxvolts shows 2.2 V", hint: "SOC2's result is in ADCRESULT2." },
        { kind: "led", led: "LED3", at: 17.75, on: true, label: "X high: LED3" },
        { kind: "led", led: "LED4", at: 21.75, on: true, label: "X low (0.8 V): LED4" },
        { kind: "led", led: "LED1", at: 25.75, on: true, label: "X low and Y high: Y is checked first, LED1" },
        { kind: "led", led: "LED4", at: 25.75, on: false, label: "and LED4 is off", hint: "Use one if / else if chain, so that the first test that is true wins." },
        { kind: "led", led: "LED5", at: 29.75, on: true, label: "Y at 1.9 V and X at 1.1 V count as rest: LED5" },
        {
          kind: "no-diagnostic",
          code: "adc",
          label: "The ADC reports no problem",
          hint: "A result read too early or never filled: ADCRESULTx has the number of the SOC (not of the pin), and INT1SEL must name the last SOC. Too short a window: each SOC needs its own ACQPS = 99.",
        },
      ],
      watch: ["adcina4volts", "joyxvolts", "joyyvolts"],
      inspect: ["AdcaRegs.ADCSOC1CTL", "AdcaRegs.ADCSOC2CTL", "AdcaRegs.ADCINTSEL1N2"],
      hints: [
        "SOC1 and SOC2 each need the same three lines as SOC0, with their own CHSEL. The last SOC to finish is SOC2.",
        "ADCRESULT1 is joystick Y (SOC1), ADCRESULT2 is joystick X (SOC2).",
        "Turn all five LEDs off with CLEAR, then one `if / else if` chain in the order of the list sets the right one.",
      ],
      takeaway: "More pins means more SOCs on the same trigger, and INT1SEL moves to the last one. The converter is shared, so the three samples are taken 0.7 us apart, not at the same instant.",
    },
    {
      id: "adc-quantise",
      kind: "calc",
      tier: "practice",
      title: "Steps of 0.73 mV",
      goal: "Convert between pin voltage and 12-bit result, and see what quantisation does.",
      refs: [{ trm: "11.4.5" }, { trm: "11.4.6" }, { course: "L5", slide: 18 }, { course: "HW2" }],
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

The figure from the briefing is here again. With 3 or 4 bits the steps are easy to see; 12 bits work the same way with steps 256 times finer than 4 bits.

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
      id: "adc-chain",
      kind: "order",
      tier: "practice",
      title: "One sample, start to finish",
      goal: "Put the steps of one photoresistor measurement in order, from the ePWM pulse to your interrupt function.",
      refs: [{ trm: "11.5" }, { trm: "11.9" }, { trm: "11.14" }, { course: "HW2" }, { course: "L5", slide: [22, 26] }],
      brief: `
The example of the code levels, with every setting written out:

- EPWM5 sends its **SOCA** pulse every 0.5 ms.
- SOC0 of ADCA: \`TRIGSEL = 13\` (EPWM5 SOCA), \`CHSEL = 4\` (ADCINA4), \`ACQPS = 99\`.
- \`INT1SEL = 0\` and \`INT1E = 1\`: the end of SOC0 sets the flag ADCINT1.
- ADCINT1 of ADCA is PIE interrupt **ADCA1**, INT1.1, and its vector points to \`ADCA_ISR\`.

One pulse has just left EPWM5. Put what happens next in order.

Think of it as a relay race: the trigger hands over to the SOC, the SOC tells the converter what to do, the converter hands the number to the result register, and the end of the conversion wakes the CPU.
`,
      steps: [
        "EPWM5's counter is at zero and the ePWM sends an SOCA pulse (the trigger: WHEN)",
        "SOC0 has TRIGSEL = 13, so it reacts to this pulse: its flag in ADCSOCFLG1 is set, a conversion is waiting",
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
      tier: "practice",
      title: "Which setting answers which question",
      goal: "Match the five questions of the chain (when, which pin, how long, where, who tells the CPU) to their registers.",
      refs: [{ course: "L5", slide: [22, 27, 28] }, { trm: "11.5.1" }, { trm: "11.5.2" }, { trm: "11.5.3" }, { trm: "11.5.5" }, { trm: "11.9" }, { course: "HW2" }],
      brief: `
Every link of the chain is one setting. Here is the example of the code levels:

\`\`\`c
AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 13;     // EPWM5 SOCA
AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;        // ADCINA4
AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;       // 100 cycles of 5 ns = 500 ns
AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;    // the end of SOC0 sets ADCINT1
AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;      // ADCINT1 is switched on
adca4result = AdcaResultRegs.ADCRESULT0;  // the result of SOC0
\`\`\`

Each SOC has its own register \`ADCSOCxCTL\` with the three fields. The trigger numbers come from a table in the manual: 0 is software only, 1 to 3 are CPU timers 0 to 2, and from 5 on there are two per ePWM, SOCA then SOCB.

Each ADC has four interrupt flags, ADCINT1 to ADCINT4. \`INT1SEL\` is a number from 0 to 15: the SOC whose end sets ADCINT1.

The names are easy to mix up, so say them slowly: **ADCINA4** is a pin. **SOC0** is a slot. **ADCA1** is an interrupt (ADCINT1 of ADCA, as the PIE calls it).
`,
      questions: [
        {
          prompt: "**When?** Which setting decides the moment SOC0's conversion starts?",
          options: ["`ADCSOC0CTL.CHSEL`", "`ADCSOC0CTL.TRIGSEL`", "`ADCSOC0CTL.ACQPS`", "`ADCINTSEL1N2.INT1SEL`"],
          answer: 1,
          why: "TRIGSEL selects the trigger. With 13, SOC0 starts whenever EPWM5 sends SOCA. How often that is, is set in EPWM5, not in the ADC.",
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
          options: ["`ADCCTL2.PRESCALE`", "`EPwm5Regs.TBPRD`", "`ADCSOC0CTL.ACQPS`", "`ADCSOC0CTL.TRIGSEL`"],
          answer: 2,
          why: "ACQPS + 1 system clock cycles of 5 ns. TBPRD is the time between two samples, which is a different thing.",
        },
        {
          prompt: "**Where is the result?** SOC3 is set to `CHSEL = 5` and `TRIGSEL = 13`.",
          options: ["`ADCRESULT5`", "`ADCRESULT13`", "`ADCRESULT0`", "`ADCRESULT3`"],
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
          prompt: "SOC0 and SOC1 both have `CHSEL = 4` and the same `TRIGSEL`. What happens on each trigger pulse?",
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
      tier: "practice",
      title: "Fill in a SOC",
      goal: "Set the three fields of ADCSOC0CTL for a joystick axis on a CPU timer trigger.",
      refs: [{ course: "L5", slide: [27, 25] }, { trm: "11.5.1" }, { trm: "11.16.2" }, { trm: "11.6.3" }, { course: "HW2" }],
      brief: `
This is the real register \`AdcaRegs.ADCSOC0CTL\`: the slot SOC0. It is empty after reset.

Fill it in for a new case:

- **When:** every time **CPU timer 1** times out. From the trigger table: 0 is software only, 1 is CPU timer 0, 2 is CPU timer 1, 3 is CPU timer 2.
- **Which pin:** ADCINA3, the joystick's Y axis.
- **How long:** 300 ns. The window is (ACQPS + 1) clock cycles, and one cycle of the 200 MHz system clock is 5 ns.

Note the "+ 1": for 60 cycles the field holds one less.
`,
      reg: "AdcaRegs.ADCSOC0CTL",
      initial: 0,
      targets: [
        { field: "TRIGSEL", value: 2 },
        { field: "CHSEL", value: 3 },
        { field: "ACQPS", value: 59 },
      ],
      code: `EALLOW;
AdcaRegs.ADCSOC0CTL.bit.CHSEL = 3;     // SOC0 converts ADCINA3
AdcaRegs.ADCSOC0CTL.bit.ACQPS = 59;    // 60 cycles x 5 ns = 300 ns
AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 2;   // CPU timer 1
EDIS;`,
      hints: [
        "TRIGSEL = 2 is 00010 in binary. CHSEL = 3 is 0011.",
        "300 ns / 5 ns = 60 cycles, so ACQPS = 59.",
        "59 is 0 0011 1011 in the nine bits of ACQPS.",
      ],
      takeaway: "One register holds the whole slot: TRIGSEL (when), CHSEL (which pin), ACQPS (how long). It is protected, so the writes go between EALLOW and EDIS.",
    },
    {
      id: "adc-sar-steps",
      kind: "calc",
      tier: "practice",
      title: "Four steps of the search",
      goal: "Work out the first four trial voltages of the 12-bit converter for an input of 2.0 V.",
      refs: [{ course: "L5", slide: [20, 19] }, { trm: "11.14" }],
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
      refs: [{ trm: "11.5.3" }, { trm: "11.14.1" }, { trm: "11.6.3" }, { trm: "11.15.2" }, { course: "L5", slide: [25, 13, 28] }],
      brief: `
While the capacitor is connected to the pin it has to charge to the pin's voltage. A sensor with a large resistance in its output charges it slowly (the RC rule: a capacitor's voltage cannot jump), so it needs a longer **acquisition window**, the time the capacitor stays connected. Too short, and the capacitor still carries some of the voltage of the pin measured before: a "ghost" of the other channel.

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
          why: "3 x 705 ns = 2115 ns. Tiny next to the 0.5 ms between triggers: the ADC rests 99.6% of the time.",
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
      refs: [{ course: "L5", slide: [18, 27] }, { course: "HW2" }, { trm: "11.5.5" }, { trm: "11.16.2" }, { trm: "11.4.6" }],
      brief: `
The interrupt runs on every sample, as it should. But \`adcina4volts\` is nonsense: the photoresistor is at 1.2 V and then at 2.4 V, and the variable shows neither.

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
        { at: 7.25, set: "ADCINA4", value: 2.4 },
      ],
      starter: program({
        globals: `int16_t adca4result = 0;
float adcina4volts = 0;`,
        adc: `${ADC_POWER}
    EDIS;

    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 0;     // SOC0 converts ADCINA4
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window is acqps + 1 SYSCLK cycles = 500 ns
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA triggers SOC0
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
        { kind: "var", name: "adca4result", at: 6.75, equals: 1638, label: "adca4result is 1638 at 1.2 V" },
        {
          kind: "var",
          name: "adcina4volts",
          at: 6.75,
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
      id: "adc-setup-order",
      kind: "order",
      tier: "practice",
      title: "The set-up, line by line",
      goal: "Put the steps of the ADC set-up in the order the course writes them, and know why each comes where it does.",
      refs: [{ course: "L5", slide: 28, note: "the complete ADC set-up, line by line" }, { trm: "11.12" }, { trm: "11.5" }, { trm: "11.9" }, { course: "HW2" }, { course: "Lab 4" }],
      brief: `
So far the ADC set-up was given and you filled in numbers. In the lab you type all of it. The next levels have you write it from an empty function, so first get the order straight.

The manual's power-up sequence has four steps: switch on the ADC's clock, set the clock divider, power up, wait. \`InitSysCtrl()\` already does the first one for every peripheral.

The reasons for the order:

- **\`EALLOW;\` comes first.** The ADC's configuration registers are protected. A write outside \`EALLOW;\` ... \`EDIS;\` is ignored, without an error on the real chip.
- **Clock and mode before power.** The converter should start up with the clock it will run on (\`PRESCALE\`) and in the mode it will use (\`AdcSetMode\`).
- **Power, then wait.** After \`ADCPWDNZ = 1\` the analog circuits need time to settle. A conversion started in that time gives a wrong number. The course waits 1 ms.
- **Then the chain, front to back.** First the SOC: which pin, how long, which trigger. Then the interrupt: which SOC's end sets ADCINT1, the enable, and a clear of the flag so that no old flag is left over.
- **\`EDIS;\`** closes the protected registers.
- **The CPU side comes last.** The PIE channel, the group bit in \`IER\` and \`EINT\` let interrupts through. Open that gate only when everything behind it is ready.
`,
      steps: [
        "`EALLOW;` opens the protected registers",
        "Set the ADC clock divider (`PRESCALE = 6`) and the mode (`AdcSetMode`, 12 bit, single-ended)",
        "Power up the converter: `ADCPWDNZ = 1`",
        "`DELAY_US(1000);` gives the analog circuits time to settle",
        "SOC0: the pin (`CHSEL`), the sample window (`ACQPS`), the trigger (`TRIGSEL`)",
        "The interrupt: `INT1SEL`, `INT1E = 1`, and clear the flag ADCINT1",
        "`EDIS;` closes the protected registers",
        "Enable ADCA1 in the PIE (`PIEIER1.INTx1`) and in `IER`, then `EINT;`",
      ],
      hints: [
        "The first and the seventh step are a pair. Nothing in between works without the first.",
        "Power-up follows the manual: divider, power, wait. Only then the SOC, and after the SOC the interrupt that reports its end.",
        "EALLOW, PRESCALE and mode, ADCPWDNZ, DELAY_US, SOC0, INT1, EDIS, PIE and IER and EINT.",
      ],
      takeaway: "EALLOW, clock, power, wait, SOC, interrupt select, EDIS, and the CPU's enables last. A conversion started during the wait gives a wrong number.",
    },
    {
      id: "adc-setup-own",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Power up, from an empty function",
      goal: "Write the whole body of setupADCA(): power up ADCA, set up SOC0 for the photoresistor and its ADCINT1 flag.",
      refs: [{ course: "L5", slide: 28, note: "the complete ADC set-up, line by line" }, { trm: "11.12" }, { trm: "11.5" }, { trm: "11.9" }, { course: "HW2" }, { course: "Lab 4" }],
      brief: `
\`setupADCA()\` is empty. \`main()\` is given: it is the loop of "One sample by hand". It starts SOC0 from software once per millisecond, waits for the flag ADCINT1, and converts the result to volts. With an empty set-up the ADC is off and the loop waits for ever.

Write the body. Every register belongs to \`AdcaRegs\`. Work down this list, in this order:

1. \`EALLOW;\`
2. \`ADCCTL2.bit.PRESCALE = 6;\` The converter's clock is the 200 MHz system clock divided by 4.
3. \`AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);\` 12-bit results, one pin measured against ground.
4. \`ADCCTL1.bit.INTPULSEPOS = 1;\` The flag comes at the end of the conversion, when the result is ready.
5. \`ADCCTL1.bit.ADCPWDNZ = 1;\` Power on.
6. \`DELAY_US(1000);\` Wait 1 ms.
7. SOC0, in \`ADCSOC0CTL\`: \`CHSEL\` for ADCINA4, \`ACQPS\` for a 500 ns window, \`TRIGSEL = 0\` (software only).
8. The flag, in \`ADCINTSEL1N2\`: \`INT1SEL\` names the SOC whose end sets ADCINT1, and \`INT1E = 1\` enables it.
9. \`ADCINTFLGCLR.bit.ADCINT1 = 1;\` Start with the flag cleared.
10. \`EDIS;\`

The checks are in the order of the list, so the first red one is the next thing to fix. The five lines after \`InitSysCtrl()\` are the PIE start-up from the interrupts chapter. They do nothing yet: the next level needs them.

The photoresistor is at 1.2 V, then at 2.4 V.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 6.25, set: "ADCINA4", value: 2.4 },
      ],
      starter: setupOwn(`// Powers up ADCA and sets up SOC0 for the photoresistor on ADCINA4
void setupADCA(void)
{
}`),
      solution: setupOwn(OWN_SETUP_SW),
      checks: [
        {
          kind: "no-diagnostic",
          code: "eallow",
          label: "1. Every ADC setting is written between EALLOW; and EDIS;",
          hint: "The line named here was ignored by the chip. Put EALLOW; first in the function and EDIS; last.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCCTL2", field: "PRESCALE", equals: 6, label: "2. The converter's clock is SYSCLK / 4", hint: "PRESCALE is a code, not the divisor: 6 means divide by 4." },
        {
          kind: "source",
          mustMatch: "AdcSetMode\\s*\\(\\s*ADC_ADCA\\s*,\\s*ADC_RESOLUTION_12BIT\\s*,\\s*ADC_SIGNALMODE_SINGLE\\s*\\)",
          label: "3. AdcSetMode chooses 12-bit results, single-ended, for ADCA",
          hint: "AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE); It also loads the converter's factory calibration for that mode.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCCTL1",
          field: "INTPULSEPOS",
          equals: 1,
          label: "4. The flag comes at the end of the conversion",
          hint: "With INTPULSEPOS = 0 the flag comes when sampling ends, before the result is in ADCRESULT0.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCCTL1",
          field: "ADCPWDNZ",
          equals: 1,
          label: "5. The converter is powered up",
          hint: "ADCPWDNZ = 1 switches the analog circuits on. Without it every result is meaningless.",
        },
        {
          kind: "no-diagnostic",
          code: "adc-powerup",
          label: "6. The converter had time to settle before its first conversion",
          hint: "DELAY_US(1000); goes right after the ADCPWDNZ line, before the function returns.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 4, label: "7. SOC0 measures ADCINA4", hint: "CHSEL is the digit at the end of the pin name." },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "ACQPS", equals: 99, label: "7. The sample window is 500 ns", hint: "The window is (ACQPS + 1) x 5 ns." },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "TRIGSEL", equals: 0, label: "7. SOC0 is started by software only", hint: "TRIGSEL = 0. main() starts it with ADCSOCFRC1." },
        { kind: "reg", reg: "AdcaRegs.ADCINTSEL1N2", field: "INT1SEL", equals: 0, label: "8. The end of SOC0 sets ADCINT1", hint: "INT1SEL is a SOC number. Only SOC0 converts here." },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTSEL1N2",
          field: "INT1E",
          equals: 1,
          label: "8. The flag ADCINT1 is enabled",
          hint: "With INT1E = 0 the flag never sets, and main() waits for it for ever.",
        },
        {
          kind: "var",
          name: "numSamples",
          min: 9,
          max: 12,
          label: "main() gets one sample per millisecond",
          hint: "0 means main() is stuck waiting for ADCINT1. Fix the first red check above.",
        },
        { kind: "var", name: "adcina4volts", at: 5, min: 1.199, max: 1.201, label: "adcina4volts is 1.2 V", hint: "A wrong voltage with every check above green: look at CHSEL again." },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V after the light changes" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adca4result", "adcina4volts", "numSamples"],
      inspect: ["AdcaRegs.ADCCTL1", "AdcaRegs.ADCCTL2", "AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTSEL1N2", "AdcaRegs.ADCINTFLG"],
      hints: [
        "Ten lines of the list, ten or so lines of code. Every register line starts with `AdcaRegs.` and uses `.bit.`",
        "ADCINA4 is channel 4. 500 ns is 100 cycles of 5 ns, and ACQPS holds one less. INT1SEL is the number of the SOC.",
        "`CHSEL = 4`, `ACQPS = 99`, `TRIGSEL = 0`, `AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;`, `AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;`, `AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;` and the six lines before them as the list spells them.",
      ],
      takeaway: "You have now typed the block every ADC program of the course starts with. Only the letter of the ADC, the SOC lines and INT1SEL ever change.",
    },
    {
      id: "adc-trigger-own",
      kind: "code",
      mode: "write",
      tier: "practice",
      continues: "adc-setup-own",
      title: "Hand the trigger to EPWM5",
      goal: "Add the EPWM5 trigger block and the interrupt path to your own set-up, so that ADCA_ISR gets a sample every half millisecond.",
      refs: [{ course: "L8-9", slide: 20, note: "an ePWM used as the ADC's sample clock" }, { course: "L5", slide: 27 }, { course: "HW2" }, { trm: "15.10" }, { trm: "15.4.3" }, { trm: "11.6.1" }, { trm: "3.4.5" }],
      brief: `
Your program from the last level samples when \`main()\` says so. Now hardware does it: EPWM5 sends SOCA every **0.5 ms**, and the result arrives in an interrupt function. You write the trigger block this time. Your \`setupADCA()\` stays, with one number changed.

## 1. A new function, setupEPWM5()
All in \`EPwm5Regs\`, between \`EALLOW;\` and \`EDIS;\`:

1. \`ETSEL.bit.SOCAEN = 0;\` and \`TBCTL.bit.CTRMODE = 3;\` No pulses and a frozen counter while you set up.
2. \`ETSEL.bit.SOCASEL\`: the event "counter equals zero".
3. \`ETPS.bit.SOCAPRD\`: a pulse on every event.
4. \`TBCTR = 0;\` \`TBPHS.bit.TBPHS = 0;\` \`TBCTL.bit.PHSEN = 0;\` \`TBCTL.bit.CLKDIV = 0;\`
5. \`TBPRD\`: one round of 0.5 ms at 20 ns per count. Count the "+ 1".
6. \`ETSEL.bit.SOCAEN = 1;\` then \`TBCTL.bit.CTRMODE = 0;\` Pulses on, count up.

## 2. In setupADCA()
\`TRIGSEL\`: SOC0 now listens to EPWM5 SOCA.

## 3. In main()
- the vector, between \`EALLOW;\` and \`EDIS;\`: \`PieVectTable.ADCA1_INT = &ADCA_ISR;\`
- call \`setupEPWM5();\`
- after \`setupADCA();\`: \`PIEIER1.INTx1\`, \`IER |= M_INT1;\` and \`EINT;\`
- empty the loop: \`while (1) {}\`. Nothing in \`main()\` may start a conversion any more.

## 4. ADCA_ISR
Declare it at the top: \`__interrupt void ADCA_ISR(void);\`. In it: read the result, convert to volts, count in \`numSamples\`, clear ADCINT1, acknowledge PIE group 1.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 7.25, set: "ADCINA4", value: 2.4 },
      ],
      starter: TRIGGER_OWN_STARTER,
      solution: TRIGGER_OWN_SOLUTION,
      checks: [
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW; and EDIS;", hint: "The line named here was ignored. The vector and the ADC registers are protected." },
        {
          kind: "reg",
          reg: "EPwm5Regs.ETSEL",
          field: "SOCASEL",
          equals: 1,
          label: "1.2 SOCA is sent when the counter equals zero",
          hint: "SOCASEL chooses the event: 1 is 'counter equals zero', 2 is 'counter equals TBPRD'. 0 is no event.",
        },
        { kind: "reg", reg: "EPwm5Regs.ETPS", field: "SOCAPRD", equals: 1, label: "1.3 A pulse on every event", hint: "SOCAPRD counts events per pulse. 0, the reset value, means no pulse at all." },
        {
          kind: "reg",
          reg: "EPwm5Regs.TBPRD",
          equals: 24999,
          label: "1.5 One round of the counter is exactly 0.5 ms",
          hint: "0.5 ms / 20 ns = 25000 counts, and a round is TBPRD + 1 counts. A value above 65535 does not fit.",
        },
        { kind: "reg", reg: "EPwm5Regs.ETSEL", field: "SOCAEN", equals: 1, label: "1.6 The SOCA pulse is enabled", hint: "SOCAEN is the switch for the pulse. With 0 the counter runs and nobody hears it." },
        { kind: "reg", reg: "EPwm5Regs.TBCTL", field: "CTRMODE", equals: 0, label: "1.6 The counter counts up", hint: "After reset CTRMODE is 3, frozen. The last line of the block sets it to 0." },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCSOC0CTL",
          field: "TRIGSEL",
          equals: 13,
          label: "2. SOC0 listens to EPWM5 SOCA",
          hint: "TRIGSEL is still the old value or a miscount. Two numbers per ePWM, SOCA first, starting with 5 for EPWM1.",
        },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER1", field: "INTx1", equals: 1, label: "3. ADCA1 is enabled in the PIE", hint: "PieCtrlRegs.PIEIER1.bit.INTx1 = 1; ADCA1 is INT1.1." },
        {
          kind: "source",
          mustNotMatch: "ADCSOCFRC1",
          label: "3. main() no longer starts conversions itself",
          hint: "Delete the body of the while(1) loop. Its reading and converting lines move into ADCA_ISR.",
        },
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 18,
          max: 25,
          label: "ADCA_ISR runs once per half millisecond",
          hint: "Never: fix the first red check above, then look at the vector, IER and EINT. Once: ADCINT1 or PIEACK is not cleared in the function.",
        },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "4. No conversion ended while ADCINT1 was still set",
          hint: "AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; in ADCA_ISR, before the PIE acknowledge. If the line is there, the function ran only once: see the check above.",
        },
        { kind: "var", name: "adcina4volts", at: 6.75, min: 1.199, max: 1.201, label: "adcina4volts follows the pin: 1.2 V" },
        { kind: "var", name: "adcina4volts", min: 2.399, max: 2.401, label: "and 2.4 V after the light changes" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adca4result", "adcina4volts", "numSamples"],
      inspect: ["EPwm5Regs.ETSEL", "EPwm5Regs.ETPS", "EPwm5Regs.TBPRD", "EPwm5Regs.TBCTL", "AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTOVF"],
      hints: [
        "Do the four parts in order and run after each. The checks carry the numbers of the brief.",
        "SOCASEL = 1, SOCAPRD = 1, TBPRD = 24999. EPWM5 SOCA is trigger number 13: 5 and 6 belong to EPWM1, 7 and 8 to EPWM2, and so on.",
        "ADCA_ISR: `adca4result = AdcaResultRegs.ADCRESULT0;` `adcina4volts = adca4result * 3.0 / 4096.0;` `numSamples++;` `AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;` `PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`",
      ],
      takeaway: "Freeze, choose the event (ETSEL, ETPS), set the period, enable SOCA, unfreeze. That block, your ADC block and five interrupt lines are the whole sampling program of HW2 and Lab 4.",
    },
    {
      id: "adc-x-scratch",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "From a blank page",
      goal: "Write a complete sampling program from its requirements: no given lines, no checklist.",
      refs: [{ course: "L5", slide: [28, 27] }, { course: "L8-9", slide: 20, note: "an ePWM used as the ADC's sample clock" }, { trm: "11.12" }, { trm: "11.5" }, { trm: "11.6.1" }, { trm: "15.10" }, { trm: "3.4.5" }, { course: "HW2" }],
      brief: `
This is what the lab asks of you: a sentence of requirements and an empty \`main()\`. Only \`InitSysCtrl()\`, two variables and the empty interrupt function are there.

## Requirements
- Measure the **joystick's X axis** on pin **ADCINA2** with **SOC0** of ADCA.
- Sample every **0.25 ms**. The sample clock is **EPWM2**: its SOCA pulse, sent when the counter equals zero, on every event. Counter clock 50 MHz.
- Sample window **200 ns**.
- ADCA as the course runs it: converter clock SYSCLK / 4, 12 bit single-ended, flag at the end of the conversion, 1 ms of settling time after power-up.
- The end of SOC0 raises **ADCA1** (INT1.1), served by \`ADCA_ISR\`.
- \`ADCA_ISR\` stores the voltage in \`joyXvolts\` and counts its calls in \`numADCA\`.

## What you need to work out
- \`TBPRD\` for 0.25 ms at 20 ns per count.
- \`ACQPS\` for 200 ns at 5 ns per cycle.
- The \`TRIGSEL\` number of EPWM2 SOCA. The table goes: 0 software, 1 to 3 CPU timers, 4 a pin, then two numbers per ePWM starting with 5 for EPWM1 SOCA.

Nothing is given, so remember the parts that were always there: the five PIE start-up lines after \`InitSysCtrl()\`, the vector, \`EALLOW;\` and \`EDIS;\`, the enables with \`EINT;\`, and the two clearing lines at the end of the interrupt function.

Each check names one decision. The joystick is at 0.9 V, then at 2.1 V.
`,
      kit: "robot",
      durationMs: 12.5,
      stimuli: [
        { at: 0, set: "ADCINA2", value: 0.9 },
        { at: 7.3, set: "ADCINA2", value: 2.1 },
      ],
      starter: SCRATCH_STARTER,
      solution: SCRATCH_SOLUTION,
      checks: [
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW; and EDIS;", hint: "The line named here was ignored: the vector table and the ADC's configuration registers are protected." },
        { kind: "reg", reg: "EPwm2Regs.ETSEL", field: "SOCASEL", equals: 1, label: "EPWM2: SOCA when the counter equals zero", hint: "ETSEL.SOCASEL picks the event: 1 is zero, 2 is TBPRD." },
        { kind: "reg", reg: "EPwm2Regs.ETPS", field: "SOCAPRD", equals: 1, label: "EPWM2: a pulse on every event", hint: "ETPS.SOCAPRD resets to 0, which sends no pulse." },
        { kind: "reg", reg: "EPwm2Regs.ETSEL", field: "SOCAEN", equals: 1, label: "EPWM2: the SOCA pulse is enabled", hint: "ETSEL.SOCAEN switches the pulse on." },
        { kind: "reg", reg: "EPwm2Regs.TBPRD", equals: 12499, label: "EPWM2: one round is exactly 0.25 ms", hint: "0.25 ms / 20 ns counts, and a round is TBPRD + 1 counts." },
        { kind: "reg", reg: "EPwm2Regs.TBCTL", field: "CTRMODE", equals: 0, label: "EPWM2: the counter counts up", hint: "CTRMODE resets to 3, frozen." },
        { kind: "reg", reg: "AdcaRegs.ADCCTL2", field: "PRESCALE", equals: 6, label: "ADCA: converter clock SYSCLK / 4", hint: "ADCCTL2.PRESCALE = 6 is the code for divide by 4." },
        {
          kind: "source",
          mustMatch: "AdcSetMode\\s*\\(\\s*ADC_ADCA\\s*,\\s*ADC_RESOLUTION_12BIT\\s*,\\s*ADC_SIGNALMODE_SINGLE\\s*\\)",
          label: "ADCA: 12 bit, single-ended",
          hint: "AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE); before the power-up line.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCCTL1", field: "INTPULSEPOS", equals: 1, label: "ADCA: flag at the end of the conversion", hint: "ADCCTL1.INTPULSEPOS = 1. With 0 the flag comes before the result." },
        { kind: "reg", reg: "AdcaRegs.ADCCTL1", field: "ADCPWDNZ", equals: 1, label: "ADCA: powered up", hint: "ADCCTL1.ADCPWDNZ = 1, inside EALLOW." },
        {
          kind: "no-diagnostic",
          code: "adc-powerup",
          label: "ADCA: 1 ms of settling time before the first conversion",
          hint: "DELAY_US(1000); after the power-up line. If the delay is there, a trigger reached SOC0 too early: set TRIGSEL after the delay.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "CHSEL", equals: 2, label: "SOC0 measures ADCINA2", hint: "CHSEL is the pin's channel number." },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "ACQPS", equals: 39, label: "SOC0 samples for 200 ns", hint: "(ACQPS + 1) x 5 ns = 200 ns." },
        { kind: "reg", reg: "AdcaRegs.ADCSOC0CTL", field: "TRIGSEL", equals: 7, label: "SOC0 listens to EPWM2 SOCA", hint: "5 is EPWM1 SOCA, 6 is EPWM1 SOCB. The next one is yours." },
        { kind: "reg", reg: "AdcaRegs.ADCINTSEL1N2", field: "INT1SEL", equals: 0, label: "The end of SOC0 sets ADCINT1", hint: "INT1SEL is a SOC number." },
        { kind: "reg", reg: "AdcaRegs.ADCINTSEL1N2", field: "INT1E", equals: 1, label: "ADCINT1 is enabled", hint: "ADCINTSEL1N2.INT1E = 1." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER1", field: "INTx1", equals: 1, label: "ADCA1 is enabled in the PIE", hint: "ADCA1 is INT1.1: PIEIER1.INTx1, and IER |= M_INT1." },
        {
          kind: "isr",
          fn: "ADCA_ISR",
          min: 40,
          max: 50,
          label: "ADCA_ISR runs four times per millisecond",
          hint: "Never, with every check above green: the five PIE start-up lines, the vector, IER or EINT. Once: clear ADCINT1 and acknowledge group 1 at the end of the function.",
        },
        { kind: "reg", reg: "AdcaRegs.ADCINTOVF", field: "ADCINT1", equals: 0, label: "No conversion ended while ADCINT1 was still set", hint: "AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; in ADCA_ISR. If the line is there, the function did not run every time: see the check above." },
        { kind: "var", name: "joyXvolts", at: 6.9, min: 0.899, max: 0.901, label: "joyXvolts is 0.9 V", hint: "Exactly 0: integer division, write 3.0 / 4096.0. Another voltage: CHSEL, or the wrong result register. SOC0 fills ADCRESULT0." },
        { kind: "var", name: "joyXvolts", min: 2.099, max: 2.101, label: "and follows the joystick to 2.1 V" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["joyXvolts", "numADCA"],
      inspect: ["EPwm2Regs.ETSEL", "EPwm2Regs.TBPRD", "AdcaRegs.ADCCTL1", "AdcaRegs.ADCSOC0CTL", "AdcaRegs.ADCINTSEL1N2", "AdcaRegs.ADCINTFLG"],
      hints: [
        "Build it in the order of the chain and run after each part: PIE start-up and vector, EPWM2, ADC power-up, SOC0, INT1, enables, the function.",
        "TBPRD = 12499, ACQPS = 39, TRIGSEL = 7, CHSEL = 2, INT1SEL = 0.",
        "The structure is your program from \"Hand the trigger to EPWM5\" with EPwm2Regs and these numbers. The function ends with ADCINTFLGCLR.bit.ADCINT1 = 1 and PIEACK_GROUP1.",
      ],
      takeaway: "Trigger, SOC, converter, result, interrupt: you can now build the whole chain from a sentence. In the lab only the names and the numbers differ.",
    },
    {
      id: "adc-average",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Average out the ripple",
      goal: "Average blocks of 16 samples so that a 0.4 V ripple on the photoresistor signal disappears.",
      refs: [{ trm: "11.6.2" }, { course: "L8-9", slide: [28, 29], note: "averaging samples to smooth a noisy reading" }, { course: "HW2" }],
      brief: `
The room lights flicker, and the photoresistor sees it: its voltage jumps up and down by 0.2 V around the real level from one millisecond to the next. Such a regular wobble is called **ripple**. A single sample is off by 0.2 V. The average of many is not.

The chain is set up as always (EPWM5, SOC0, ADCINA4, one sample every 0.5 ms). Write \`ADCA_ISR\`:

- Add up **16** consecutive results.
- After the 16th, store the average **in volts** in \`avgvolts\`, add 1 to \`numAvg\`, and start a new block.
- Between blocks \`avgvolts\` keeps its last value.

So \`avgvolts\` gets a new value every 8 ms.

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
        { kind: "var", name: "numAvg", min: 9, max: 10, label: "One average per 16 samples", hint: "Start a new block after the 16th sample: sum and counter back to 0." },
        { kind: "isr", fn: "ADCA_ISR", min: 150, max: 160, label: "ADCA_ISR still runs on every sample" },
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
      refs: [{ course: "HW2" }, { course: "L14", slide: [38, 40], note: "two thresholds against chattering" }, { trm: "11.9" }],
      brief: `
A single threshold has a problem. A **threshold** is the level at which a decision flips. If the light sits right at the threshold, the smallest ripple pushes the reading above and below it, and the output flickers on and off.

The fix is two thresholds, called **hysteresis**:

- LED1 turns **on** when the voltage rises above **2.0 V**.
- LED1 turns **off** when the voltage falls below **1.0 V**.
- Between 1.0 V and 2.0 V it **stays as it was**.

Also count in \`numOn\` how many times LED1 went from off to on. A reading above 2.0 V while LED1 is already on does not count.

The chain is set up (EPWM5, SOC0, ADCINA4, one sample every 0.5 ms) and LED1 is an output, off. Write \`ADCA_ISR\`. You decide what state to keep.

For a star, decide on the raw result: work out the two thresholds as 12-bit numbers once, by hand, and use no floating point anywhere in the program. An interrupt function that only compares integers is the cheapest there is.
`,
      kit: "robot",
      durationMs: 38,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 0.5 },
        { at: 4.25, set: "ADCINA4", value: 1.5 },
        { at: 8.25, set: "ADCINA4", value: 2.2 },
        { at: 12.25, set: "ADCINA4", value: 1.9 },
        { at: 16.25, set: "ADCINA4", value: 1.2 },
        { at: 20.25, set: "ADCINA4", value: 2.1 },
        { at: 24.25, set: "ADCINA4", value: 0.8 },
        { at: 28.25, set: "ADCINA4", value: 1.9 },
        { at: 32.25, set: "ADCINA4", value: 2.5 },
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
uint16_t result = 0;`,
        setup: LED1,
        isr: `    result = AdcaResultRegs.ADCRESULT0;
    if (ledOn == 0 && result > 2730) {       // above 2 V: 4096 * 2 / 3 = 2730 and a fraction
        ledOn = 1;
        numOn++;
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else if (ledOn == 1 && result < 1366) {   // below 1 V: 4096 * 1 / 3 = 1365 and a fraction
        ledOn = 0;
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

${ISR_END}`,
      }),
      checks: [
        { kind: "led", led: "LED1", at: 3.75, on: false, label: "0.5 V: off" },
        { kind: "led", led: "LED1", at: 7.75, on: false, label: "1.5 V coming from below: still off", hint: "Between the thresholds nothing changes." },
        { kind: "led", led: "LED1", at: 11.75, on: true, label: "2.2 V: on" },
        { kind: "steady", led: "LED1", from: 11.75, to: 24, on: true, label: "1.9 V, 1.2 V, 2.1 V: stays on without a flicker" },
        { kind: "led", led: "LED1", at: 27.75, on: false, label: "0.8 V: off" },
        { kind: "led", led: "LED1", at: 31.75, on: false, label: "1.9 V coming from below: still off" },
        { kind: "led", led: "LED1", at: 36.75, on: true, label: "2.5 V: on again" },
        {
          kind: "var",
          name: "numOn",
          equals: 2,
          label: "numOn counted the two times LED1 turned on",
          hint: "Count only the change from off to on, not every sample above 2.0 V.",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "float|\\d\\.\\d",
          label: "No floating point: the thresholds are 12-bit numbers",
          hint: "2.0 V is 4096 x 2 / 3 = 2730.67 and 1.0 V is 1365.33. Compare ADCRESULT0 with whole numbers.",
        },
      ],
      watch: ["numOn"],
      hints: [
        "Remember in a global whether the LED is on. The decision depends on the reading and on that state.",
        "Off and above 2.0 V: turn on and count. On and below 1.0 V: turn off. Every other case: do nothing.",
        "`if (ledOn == 0 && volts > 2.0) { ... } else if (ledOn == 1 && volts < 1.0) { ... }`, or the same with the raw result and the thresholds 2730 and 1366.",
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
      refs: [{ course: "L5", slide: [26, 16] }, { course: "HW2" }, { trm: "11.6.3" }, { trm: "11.7" }, { trm: "11.15.3" }],
      brief: `
The joystick's X axis is on ADCINA2 and its Y axis on ADCINA3, both 1.5 V at rest.

EPWM5 and the ADC's power-up are given. SOC0 still measures the photoresistor. The rest is yours: add the SOCs for the two axes on the same trigger, choose the right SOC for the interrupt, and write \`ADCA_ISR\`.

In the interrupt function:

- \`dx\` and \`dy\` are the two voltages minus 1.5 V: how far the stick is from rest.
- If both are within **0.2 V** of rest (\`fabs\` gives the absolute value), the stick counts as released: \`moved = 0\` and \`angle = 0\`.
- Otherwise \`moved = 1\` and \`angle\` is the direction in **degrees**: 0 is +X, 90 is +Y, and it runs from -180 to 180.

\`atan2(dy, dx)\` gives exactly that angle, in **radians**: another angle unit, in which half a turn (180 degrees) is pi = 3.14159. So degrees = radians x 180.0 / PI.

Why must both axes hang on the **same** trigger? If X were sampled now and Y half a millisecond later, a stick that is moving would give a direction it never pointed in.
`,
      kit: "redboard",
      durationMs: 30,
      stimuli: [
        { at: 4.25, set: "ADCINA2", value: 3.0 },
        { at: 8.25, set: "ADCINA2", value: 1.5 },
        { at: 8.25, set: "ADCINA3", value: 3.0 },
        { at: 12.25, set: "ADCINA2", value: 0.3 },
        { at: 12.25, set: "ADCINA3", value: 2.1 },
        { at: 16.25, set: "ADCINA2", value: 1.5 },
        { at: 16.25, set: "ADCINA3", value: 0.0 },
        { at: 20.25, set: "ADCINA2", value: 2.5 },
        { at: 20.25, set: "ADCINA3", value: 2.5 },
        { at: 24.25, set: "ADCINA2", value: 1.6 },
        { at: 24.25, set: "ADCINA3", value: 1.35 },
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

${EPWM5}

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

${EPWM5}

${ADC_POWER}
${SOC0}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 3;     // SOC1 converts ADCINA3
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
    AdcaRegs.ADCSOC2CTL.bit.CHSEL = 2;     // SOC2 converts ADCINA2
    AdcaRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC2CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
${INT1(2)}

${ENABLE}

    while (1) {}
}

// adca1 pie interrupt
__interrupt void ADCA_ISR(void)
{
    dy = AdcaResultRegs.ADCRESULT1 * 3.0 / 4096.0 - 1.5;
    dx = AdcaResultRegs.ADCRESULT2 * 3.0 / 4096.0 - 1.5;
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
        { kind: "var", name: "moved", at: 3.75, equals: 0, label: "At rest: moved is 0" },
        { kind: "var", name: "angle", at: 7.75, min: -0.5, max: 0.5, label: "Pushed towards +X: 0 degrees" },
        { kind: "var", name: "moved", at: 7.75, equals: 1, label: "and moved is 1" },
        { kind: "var", name: "angle", at: 11.75, min: 89.5, max: 90.5, label: "Towards +Y: 90 degrees", hint: "atan2 takes y first: atan2(dy, dx). Convert radians to degrees with 180 / PI." },
        { kind: "var", name: "angle", at: 15.75, min: 152.9, max: 153.9, label: "X = 0.3 V, Y = 2.1 V: 153.4 degrees" },
        { kind: "var", name: "angle", at: 19.75, min: -90.5, max: -89.5, label: "Towards -Y: -90 degrees" },
        { kind: "var", name: "angle", at: 23.75, min: 44.5, max: 45.5, label: "Diagonal: 45 degrees" },
        { kind: "var", name: "moved", at: 28.75, equals: 0, label: "Within 0.2 V of rest: released" },
        { kind: "var", name: "angle", at: 28.75, equals: 0, label: "and the angle is 0" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
          hint: "The function ran once only: end it with AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; before the PIE acknowledge.",
        },
        {
          kind: "no-diagnostic",
          code: "adc",
          label: "No result is read before its conversion has finished",
          hint: "The interrupt must come after the last of your SOCs: point INT1SEL at it.",
        },
      ],
      watch: ["angle", "moved"],
      hints: [
        "Same SOC set-up as the three-pin checkpoint: one SOC per axis on the same trigger, and INT1SEL names the last one.",
        "With SOC1 on ADCINA3 and SOC2 on ADCINA2: `dy = AdcaResultRegs.ADCRESULT1 * 3.0 / 4096.0 - 1.5;` and the same for dx with ADCRESULT2.",
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
      refs: [{ course: "L5", slide: [16, 11, 26] }, { course: "Lab 4" }, { trm: "12.2" }, { trm: "11.6.3" }, { trm: "11.5.5" }],
      brief: `
This level also needs the DAC chapter: you bring up DACA yourself. \`setDACA(volts)\` comes from the board's library: it limits the voltage to 0 V ... 3 V and scales it. Writing it is part of Lab 4.

1. **Invert.** On every sample, set DACA to **3.0 V minus the photoresistor voltage** with \`setDACA\`. Bright light gives a low output, darkness a high one.
2. **Check your own output.** The DACA pin is the same pin as **ADCINA0**. So the ADC can measure what the DAC really puts out, with no wire. Add a second SOC for ADCINA0 on the same trigger and store its voltage in \`readback\`.

Only EPWM5 and the ADC's power-up are given. Bring up the DAC, add the SOC, choose the interrupt select, write \`ADCA_ISR\`.

One thing to think about: when \`ADCA_ISR\` runs, the conversions of this millisecond are already finished. So which DAC value did the second SOC see, the one you are about to write or the one from the last interrupt?
`,
      kit: "robot",
      durationMs: 18,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.0 },
        { at: 8.25, set: "ADCINA4", value: 2.6 },
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

${EPWM5}

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

void main(void)
{
    InitSysCtrl();

    EALLOW;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacaRegs.DACVALS.bit.DACVALS = 0;
    EDIS;
    DELAY_US(500);                        // buffer power-up time

${PIE_INIT}

${VECTOR}

${EPWM5}

${ADC_POWER}
${SOC0}
    AdcaRegs.ADCSOC1CTL.bit.CHSEL = 0;     // SOC1 converts ADCINA0, the DACA pin
    AdcaRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 13;  // EPWM5 ADCSOCA
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
        { kind: "signal", name: "DACA", at: 6.75, equals: 2.0, tol: 0.005, label: "1.0 V in: DACA at 2.0 V" },
        {
          kind: "var",
          name: "readback",
          at: 6.75,
          min: 1.99,
          max: 2.01,
          label: "readback measures those 2.0 V",
          hint: "A SOC with CHSEL = 0 measures ADCINA0, the DACA pin. Its result is in the register with its SOC number.",
        },
        {
          kind: "var",
          name: "readback",
          at: 8.75,
          min: 1.99,
          max: 2.01,
          label: "On the first sample after the light changes, readback still shows the old 2.0 V",
          hint: "readback must be the measured pin: the result of the SOC with CHSEL = 0, not a value computed from adcina4volts. That SOC sampled the pin before this interrupt changed the DAC.",
        },
        { kind: "signal", name: "DACA", at: 14.75, equals: 0.4, tol: 0.005, label: "2.6 V in: DACA at 0.4 V" },
        { kind: "var", name: "readback", at: 14.75, min: 0.39, max: 0.41, label: "readback follows to 0.4 V" },
        { kind: "var", name: "adcina4volts", min: 2.598, max: 2.602, label: "adcina4volts shows 2.6 V" },
        {
          kind: "reg",
          reg: "AdcaRegs.ADCINTOVF",
          field: "ADCINT1",
          equals: 0,
          label: "No conversion ended while ADCINT1 was still set",
          hint: "The function ran once only: end it with AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1; before the PIE acknowledge.",
        },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["adcina4volts", "readback"],
      inspect: ["DacaRegs.DACVALA", "AdcaRegs.ADCSOC1CTL", "AdcaResultRegs.ADCRESULT1"],
      hints: [
        "The DAC set-up is the one from the DAC chapter: DACREFSEL, DACOUTEN, between EALLOW and EDIS.",
        "SOC1 with CHSEL = 0 and TRIGSEL = 13, and INT1SEL = 1 because SOC1 now finishes last.",
        "In the function: both results to volts, then `setDACA(3.0 - adcina4volts);`.",
      ],
      takeaway: "readback is always one sample behind: it was measured before this interrupt changed the DAC. Every sampled system has such delays, and control loops have to live with them.",
    },
  ],
};
