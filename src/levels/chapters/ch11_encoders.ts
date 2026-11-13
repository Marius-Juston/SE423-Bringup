import type { Chapter } from "../types";

// Code shared by the levels. The eQEP set-up and the read functions are the
// course's (Lab 3, SE423Lib.c); the comments of the eQEP3 block are corrected.

const DEFS = `#define LAUNCHPAD_CPU_FREQUENCY 200
#define PI          3.1415926535897932384626433832795`;

/** One block of init_eQEPs(), as in Lab 3. */
const qep = (n: number, a: number, b: number, port: "A" | "B", qsel: 1 | 2, mux: number) => `    // setup eQEP${n} pins for input
    EALLOW;
    //Disable internal pull-up for the selected input pins for reduced power consumption
    GpioCtrlRegs.GP${port}PUD.bit.GPIO${a} = 1;    // Disable pull-up on GPIO${a} (EQEP${n}A)
    GpioCtrlRegs.GP${port}PUD.bit.GPIO${b} = 1;    // Disable pull-up on GPIO${b} (EQEP${n}B)
    GpioCtrlRegs.GP${port}QSEL${qsel}.bit.GPIO${a} = 2;   // Qual every 6 samples
    GpioCtrlRegs.GP${port}QSEL${qsel}.bit.GPIO${b} = 2;   // Qual every 6 samples
    EDIS;
    GPIO_SetupPinMux(${a}, GPIO_MUX_CPU1, ${mux}); // set GPIO${a} to eQep${n}A
    GPIO_SetupPinMux(${b}, GPIO_MUX_CPU1, ${mux}); // set GPIO${b} to eQep${n}B
    EQep${n}Regs.QEPCTL.bit.QPEN = 0;    // make sure eqep in reset
    EQep${n}Regs.QDECCTL.bit.QSRC = 0;   // Quadrature count mode
    EQep${n}Regs.QPOSCTL.all = 0x0;      // Disable eQep Position Compare
    EQep${n}Regs.QCAPCTL.all = 0x0;      // Disable eQep Capture
    EQep${n}Regs.QEINT.all = 0x0;        // Disable all eQep interrupts
    EQep${n}Regs.QPOSMAX = 0xFFFFFFFF;   // use full range of the 32 bit count
    EQep${n}Regs.QEPCTL.bit.FREE_SOFT = 2;  // EQep uneffected by emulation suspend
    EQep${n}Regs.QPOSCNT = 0;
    EQep${n}Regs.QEPCTL.bit.QPEN = 1;    // Enable EQep`;

const QEP1 = qep(1, 20, 21, "A", 2, 1);
const QEP2 = qep(2, 54, 55, "B", 2, 5);
const QEP3 = qep(3, 6, 7, "A", 1, 5);

const INIT_WHEELS = `void init_eQEPs(void) {

${QEP1}

${QEP2}
}`;

const INIT_ALL = `void init_eQEPs(void) {

${QEP1}

${QEP2}

${QEP3}
}`;

const READ_LEFT = `float readEncLeft(void) {
    int32_t raw = 0;
    raw = EQep1Regs.QPOSCNT;
    return (raw*(-2*PI/(2000.0*20.0)));
}`;

const READ_RIGHT = `float readEncRight(void) {
    int32_t raw = 0;
    raw = EQep2Regs.QPOSCNT;
    return (raw*(2*PI/(2000.0*20.0)));
}`;

const READ_HAND = `float readEncWheel(void) {
    int32_t raw = 0;
    raw = EQep3Regs.QPOSCNT;
    return (raw*(2*PI/4000.0));
}`;

/** main() with timer 0 calling cpu_timer0_isr every `us` microseconds. */
const mainWith = (us: number, extra = "", loop = "    while (1) {}") => `void main(void)
{
    InitSysCtrl();
    InitGpio();
${extra}
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, ${us});
    CpuTimer0Regs.TCR.all = 0x4000;

    init_eQEPs();

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;

${loop}
}`;

const MAIN_1MS = mainWith(1000);

const isr = (body: string) => `// Runs every 1 ms
__interrupt void cpu_timer0_isr(void)
{
${body}
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;

const PROTOS = `__interrupt void cpu_timer0_isr(void);
void init_eQEPs(void);
float readEncLeft(void);
float readEncRight(void);`;

// ---- enc-init (complete) ----
const INIT_BLANK = `void init_eQEPs(void) {

${QEP1}

    // setup eQEP2 pins for input
    EALLOW;
    //Disable internal pull-up for the selected input pins for reduced power consumption
    GpioCtrlRegs.GPBPUD.bit.GPIO54 = 1;    // Disable pull-up on GPIO54 (EQEP2A)
    GpioCtrlRegs.GPBPUD.bit.GPIO55 = 1;    // Disable pull-up on GPIO55 (EQEP2B)
    GpioCtrlRegs.GPBQSEL2.bit.GPIO54 = 2;   // Qual every 6 samples
    GpioCtrlRegs.GPBQSEL2.bit.GPIO55 = 2;   // Qual every 6 samples
    EDIS;
    GPIO_SetupPinMux(54, GPIO_MUX_CPU1, 0); // ??? mux position of eQep2A
    GPIO_SetupPinMux(55, GPIO_MUX_CPU1, 0); // ??? mux position of eQep2B
    EQep2Regs.QEPCTL.bit.QPEN = 0;    // make sure eqep in reset
    EQep2Regs.QDECCTL.bit.QSRC = 2;   // ??? Quadrature count mode
    EQep2Regs.QPOSCTL.all = 0x0;      // Disable eQep Position Compare
    EQep2Regs.QCAPCTL.all = 0x0;      // Disable eQep Capture
    EQep2Regs.QEINT.all = 0x0;        // Disable all eQep interrupts
    EQep2Regs.QPOSMAX = 0;            // ??? use full range of the 32 bit count
    EQep2Regs.QEPCTL.bit.FREE_SOFT = 2;  // EQep uneffected by emulation suspend
    EQep2Regs.QPOSCNT = 0;
    EQep2Regs.QEPCTL.bit.QPEN = 0;    // ??? Enable EQep
}`;

const ISR_READ = isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();`);

// ---- enc-speed / enc-pold ----
const SPEED_GLOBALS = `float LeftWheel = 0;      // wheel angles, rad
float RightWheel = 0;
float LeftDist = 0;       // distance travelled, ft
float RightDist = 0;
float LeftVel = 0;        // speed, ft/s
float RightVel = 0;`;

const SPEED_CHECKS = [
  { kind: "var" as const, name: "LeftVel", at: 200.5, min: 0.61, max: 0.68, label: "LeftVel is about 0.65 ft/s while the left wheel turns at 6.28 rad/s", hint: "v = (p_current - p_old) / 0.001, and p_old must still hold the angle from 1 ms ago." },
  { kind: "var" as const, name: "RightVel", at: 200.5, min: 0.3, max: 0.345, label: "RightVel is about 0.32 ft/s while the right wheel turns at 3.14 rad/s" },
  { kind: "var" as const, name: "LeftVel", at: 450.5, min: -0.345, max: -0.3, label: "LeftVel is about -0.32 ft/s while the left wheel turns backwards" },
  { kind: "var" as const, name: "RightVel", at: 450.5, min: -0.01, max: 0.01, label: "RightVel is 0 while the right wheel stands still" },
  { kind: "var" as const, name: "LeftDist", min: 0.115, max: 0.118, label: "LeftDist ends at 0.116 ft", hint: "Distance in feet is the wheel angle in radians times (1.235/12.0)." },
  { kind: "var" as const, name: "RightDist", min: 0.0895, max: 0.0915, label: "RightDist ends at 0.091 ft" },
];

const SPEED_STIMULI = [
  { at: 20, set: "LEFT_WHEEL_RADPS", value: 2 * Math.PI },
  { at: 20, set: "RIGHT_WHEEL_RADPS", value: Math.PI },
  { at: 300, set: "LEFT_WHEEL_RADPS", value: -Math.PI },
  { at: 300, set: "RIGHT_WHEEL_RADPS", value: 0 },
];

// ---- angle checks shared by the read levels ----
const ANGLE_STIMULI = [
  { at: 10, set: "LEFT_WHEEL_RADPS", value: 4 },
  { at: 10, set: "RIGHT_WHEEL_RADPS", value: 6 },
  { at: 260, set: "LEFT_WHEEL_RADPS", value: 0 },
  { at: 260, set: "RIGHT_WHEEL_RADPS", value: 0 },
];

export const ch11: Chapter = {
  id: "encoders",
  number: 11,
  title: "Encoders",
  blurb: "Quadrature, the eQEP counter, wheel angle and speed.",
  requires: ["interrupts"],
  course: ["L6-7", "Lab 3"],
  levels: [
    {
      id: "enc-brief",
      kind: "brief",
      title: "Counting light",
      goal: "Learn how an optical encoder turns rotation into two square waves, and what the eQEP does with them.",
      refs: [{ course: "L6-7" }, { course: "Lab 3" }, { trm: "17.1" }, { trm: "17.3.1" }],
      brief: `
A motor command tells the wheel what to do. It does not tell you what the wheel **did**. For that the robot needs a sensor on the shaft: an **optical encoder**.

## How it works
A disc with evenly spaced slits is fixed to the motor shaft. On one side of the disc is an LED, on the other a light sensor. When a slit passes, light reaches the sensor and its output goes high. Between slits the output is low. A turning shaft gives a square wave, and each period means "one slit went by".

The robot's encoders have **500 slits**, so one motor turn gives 500 periods.

## One channel is not enough
With a single sensor you can count slits, but:
- you cannot tell **which way** the shaft turns. Forward and backward give the same square wave.
- a shaft that **vibrates** on the edge of a slit gives pulse after pulse. You count motion that never happened.

## Two channels: quadrature
A second sensor is placed a quarter of a slit period away from the first. The two outputs, **A** and **B**, are the same square wave shifted by 90 degrees. This is called **quadrature**.

- Turning one way, A changes first and B follows (**A leads B**). Turning the other way, B leads A. The order gives the **direction**.
- In one slit period there are four edges: A rises, B rises, A falls, B falls. Counting every edge gives **4 counts per slit**: 4 x 500 = **2000 counts** per motor turn.
- Vibration on one edge now counts +1, -1, +1, -1. The sum stays put.

Only one of the two signals changes at a time. A code with that property is a **Gray code**.

Try it in the figure: turn the disc both ways and watch which channel changes first, then cover sensor B to see why one channel cannot tell the direction.

{{figure:quadrature}}

## Incremental and absolute
This encoder is **incremental**: it reports changes, and something has to add them up. The sum starts at 0 at power-on, wherever the wheel is. Switch the robot off and the position is lost.

An **absolute** encoder has several tracks and reads a different code at every angle, so it knows its position right after power-on. Its tracks use a Gray code as well: from one position to the next exactly one bit changes. With plain binary, going from 3 (\`011\`) to 4 (\`100\`) changes three bits, and since they never change at exactly the same instant, the reader could briefly see any value.

## The eQEP counts for you
At full speed the edges arrive more than a hundred thousand times per second. That is too fast to handle in C, so the chip has hardware for it: the **eQEP** (enhanced quadrature encoder pulse) module. It watches A and B and keeps the count in the 32-bit register \`QPOSCNT\`. Your code just reads it.

The robot has three encoders: left wheel on eQEP1, right wheel on eQEP2, and a hand wheel you turn with your fingers on eQEP3.
`,
      questions: [
        {
          prompt: "Why can a single-channel encoder not be used to measure the position of a wheel that drives both ways?",
          options: [
            "It has too few slits",
            "Its square wave looks the same in both directions",
            "It only works at low speed",
            "It needs an absolute reference",
          ],
          answer: 1,
          why: "One square wave carries no direction. Every pulse would be counted the same way, forward or backward.",
        },
        {
          prompt: "An encoder has 500 slits and is read in quadrature. How many counts does one turn of its shaft give?",
          options: ["500", "1000", "2000", "4000"],
          answer: 2,
          why: "Each slit period has four edges (A up, B up, A down, B down), and every edge is one count: 4 x 500 = 2000.",
        },
        {
          prompt: "The robot is switched off, the wheels are turned by hand, and it is switched on again. What does the wheel encoder count show?",
          options: [
            "0: an incremental encoder only knows what happened since power-on",
            "The angle the wheels were turned by hand",
            "The count from before power-off",
            "A random number",
          ],
          answer: 0,
          why: "An incremental encoder reports changes only. The counter starts again at 0, wherever the wheel happens to be.",
        },
      ],
      takeaway: "Two square waves 90 degrees apart give direction, four counts per slit, and immunity to vibration. The eQEP adds the counts up in QPOSCNT.",
    },
    {
      id: "enc-quadrature",
      kind: "timing",
      title: "Which one leads",
      goal: "Draw channel B for both directions of rotation, given channel A.",
      refs: [{ trm: "17.3.1" }, { trm: "17.4.1" }, { course: "L6-7" }],
      brief: `
Channel A is drawn for you. Each slot is a **quarter** of a slit period, so A is high for two slots and low for two.

Channel B is the same square wave, shifted by one slot:

- **Count going up**: A leads B. B does what A did **one slot earlier**. (The reference manual calls this forward or clockwise rotation.)
- **Count going down**: B leads A. B does now what A will do **one slot later**.

Draw both. Check your drawing with this rule: in every slot exactly **one** of the two signals may differ from the slot before.

Try it in the figure: step the disc forward and backward and read off which signal changes first each way.

{{figure:quadrature}}
`,
      slots: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
      rows: [
        { name: "A", editable: false, initial: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0], answer: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0] },
        { name: "B, count going up (A leads)", editable: true, initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], answer: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1] },
        { name: "B, count going down (B leads)", editable: true, initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], answer: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0] },
      ],
      hints: [
        "A rises at slot 2. When A leads, B rises one slot later, at slot 3.",
        "When B leads, B has already risen one slot before A does: B is high in slots 1 and 2.",
        "Up: B is high in slots 3, 4, 7, 8, 11, 12. Down: B is high in slots 1, 2, 5, 6, 9, 10.",
      ],
      takeaway: "The eQEP looks at who changed and what the other signal is at that moment. A rising while B is low means up; A rising while B is high means down.",
    },
    {
      id: "enc-math",
      kind: "calc",
      title: "Counts, radians, feet",
      goal: "Convert encoder counts to wheel angle, distance and speed with the robot's numbers.",
      refs: [{ course: "Lab 3" }, { trm: "17.4.1" }],
      brief: `
The numbers of the robot (Lab 3):

- The encoder sits on the **motor** shaft and has **500 slits**. In quadrature count mode that is 4 x 500 counts per motor turn.
- A gear head connects motor and wheel with a ratio of **20:1**: the motor turns 20 times for one turn of the wheel.
- One turn is 2 pi radians, so the wheel angle is

\`\`\`c
angle = count * (2*PI / (2000.0*20.0));    // radians
\`\`\`

- The wheel radius is **1.235 inches**. Rolling without slipping, the robot moves one radius for every radian the wheel turns: distance in feet = angle x 1.235 / 12.
- Speed is the change in position divided by the time it took. The course measures it every 1 ms: speed = (new - old) / 0.001.

\`QPOSCNT\` is an unsigned 32-bit register. Counting down from 0 it continues at 0xFFFFFFFF. Store it in a **signed** 32-bit variable (\`int32_t\`) and the same bits read as -1, -2, and so on.

Try it in the figure: roll the wheel and follow one number through the chain, from counts to feet.

{{figure:counts-to-distance}}
`,
      fields: [
        { id: "a", label: "Counts for one turn of the motor shaft", answer: 2000, why: "500 slits x 4 edges per slit = 2000." },
        { id: "b", label: "Counts for one turn of the wheel", answer: 40000, why: "The motor turns 20 times per wheel turn: 2000 x 20 = 40000." },
        { id: "c", label: "Wheel angle for one count", unit: "microradians", answer: 157.08, tolPct: 0.5, why: "2 pi / 40000 = 0.00015708 rad = 157.08 microradians." },
        { id: "d", label: "Wheel angle when the count is 10000", unit: "rad", answer: 1.5708, tolPct: 0.5, why: "10000 of 40000 counts is a quarter turn: pi / 2 = 1.5708 rad." },
        { id: "e", label: "Wheel speed when the count changes by 26 in 1 ms", unit: "rad/s", answer: 4.084, tolPct: 1, why: "26 x 0.00015708 rad = 0.004084 rad in 0.001 s: 4.084 rad/s." },
        { id: "f", label: "Robot speed at that wheel speed", unit: "ft/s", answer: 0.4203, tolPct: 1, why: "4.084 rad/s x 1.235 / 12 ft per rad = 0.4203 ft/s." },
        { id: "g", label: "QPOSCNT reads 0xFFFFFE0C. The count as an int32_t", answer: -500, why: "0xFFFFFE0C is 2^32 - 500. Read as a signed 32-bit number that is -500: the wheel went 500 counts backwards from 0." },
      ],
      hints: [
        "Work from the encoder outwards: slits, x4, gear ratio.",
        "Radians per count is 2 pi divided by the counts per wheel turn.",
        "For the last field: 0xFFFFFFFF is -1, so subtract the value from 0x100000000 and put a minus sign in front.",
      ],
      takeaway: "40000 counts per wheel turn, 157 microradians per count. One count per millisecond is already 0.157 rad/s: that is the resolution of a 1 ms speed measurement.",
    },
    {
      id: "enc-qepctl",
      kind: "register",
      title: "Switch the counter on",
      goal: "Set QEPCTL the way the course's init_eQEPs() leaves it.",
      refs: [{ trm: "17.10.2" }, { trm: "17.5.1" }, { course: "Lab 3" }],
      brief: `
Two registers decide how the eQEP counts.

\`QDECCTL\` (decoder control) chooses **what** is counted with its field \`QSRC\`:
- 0: quadrature count. Every edge of A and B, up or down by their order. This is the reset value and the mode the robot uses.
- 1: direction count. A is a clock, B says up or down.
- 2 and 3: count A's edges up only, or down only, to measure a frequency.

\`QEPCTL\` (control) switches the counter on:
- \`QPEN\` (bit 3): 1 enables the position counter. 0 holds the module in reset, and that is the value after power-on.
- \`FREE_SOFT\` (bits 15-14): what the counter does when the debugger halts the program. 0 stops it at once; 2 lets it keep counting, so the position is still right when you press Resume.
- \`PCRM\` (bits 13-12): when the counter is reset. The modes use an index pulse or a timer that the robot does not have, so the course leaves it at 0.
- \`SWI\` (bit 7): writing 1 loads \`QPOSCNT\` from \`QPOSINIT\`.

\`init_eQEPs()\` writes \`FREE_SOFT = 2\` and then \`QPEN = 1\`. Build the resulting value.
`,
      reg: "EQep1Regs.QEPCTL",
      initial: 0x0000,
      targets: [
        { field: "FREE_SOFT", value: 2 },
        { field: "QPEN", value: 1 },
      ],
      code: "EQep1Regs.QEPCTL.bit.FREE_SOFT = 2;  // keep counting while the debugger halts\nEQep1Regs.QEPCTL.bit.QPEN = 1;       // enable the position counter\n// QEPCTL is now 0x8008",
      hints: [
        "Two fields change: one at the very top of the register, one in the low byte.",
        "FREE_SOFT = 2 is binary 10 in bits 15 and 14: only bit 15 is set.",
        "Set bit 15 and bit 3: 0x8008.",
      ],
      takeaway: "QPEN is the on switch. A counter that always reads 0 usually has QPEN = 0, the wrong pin mux, or QPOSMAX = 0.",
    },
    {
      id: "enc-init",
      kind: "code",
      mode: "complete",
      title: "The second encoder",
      goal: "Complete the eQEP2 set-up and the scale factor so the right wheel angle is read in radians.",
      refs: [{ course: "Lab 3" }, { trm: "17.2" }, { trm: "17.4.1" }, { trm: "17.5.1" }],
      brief: `
Lab 3 gives you \`init_eQEPs()\` and asks for the scale factor in the read functions. Here the eQEP1 block (left wheel) is complete, and the eQEP2 block (right wheel) has five \`???\` comments. Fix those lines, using eQEP1 as the model.

## What each block does
1. **Pins.** The pull-ups are switched off (the encoder drives the lines itself) and the inputs are qualified over 6 samples to reject glitches. Then the mux hands the pins to the eQEP. The mux position is different for every pin:

- EQEP1A, EQEP1B: GPIO20, GPIO21, mux **1**
- EQEP2A, EQEP2B: GPIO54, GPIO55, mux **5**
- EQEP3A, EQEP3B: GPIO6, GPIO7, mux **5**

2. **Counter.** With \`QPEN = 0\` the module is held in reset while it is set up. \`QSRC = 0\` selects quadrature count. \`QPOSMAX\` is the largest count: one step past it the counter starts again at 0, and one step below 0 it continues at \`QPOSMAX\`. Its reset value is 0, which leaves no room to count at all, so the course sets the full 32-bit range. Last, \`QPEN = 1\` starts the counter.

## The scale factor
\`readEncRight()\` returns the wheel angle in radians. One wheel turn is 2000 x 20 counts and 2 pi radians. Write the numbers with a decimal point so the division is done in floating point.

The tests turn the left wheel at 4 rad/s and the right wheel at 6 rad/s for a quarter of a second.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: ANGLE_STIMULI,
      starter: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

${INIT_BLANK}

${READ_LEFT}

float readEncRight(void) {
    int32_t raw = 0;
    raw = EQep2Regs.QPOSCNT;
    return (raw*(0.0));   // ??? radians of wheel per count
}
`,
      solution: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: [
        { kind: "reg", reg: "GpioCtrlRegs.GPBMUX2", field: "GPIO54", equals: 1, label: "GPIO54 is muxed to EQEP2A (mux 5)", hint: "Mux position 5 is GMUX = 1, MUX = 1. GPIO_SetupPinMux(54, GPIO_MUX_CPU1, 5) writes both." },
        { kind: "reg", reg: "EQep2Regs.QDECCTL", field: "QSRC", equals: 0, label: "eQEP2 is in quadrature count mode" },
        { kind: "reg", reg: "EQep2Regs.QPOSMAX", equals: 0xffffffff, label: "eQEP2 uses the full 32-bit range" },
        { kind: "reg", reg: "EQep2Regs.QEPCTL", field: "QPEN", equals: 1, label: "eQEP2 is enabled" },
        { kind: "var", name: "LeftWheel", min: 0.99, max: 1.01, label: "LeftWheel is 1.0 rad after 0.25 s at 4 rad/s" },
        { kind: "var", name: "RightWheel", min: 1.49, max: 1.51, label: "RightWheel is 1.5 rad after 0.25 s at 6 rad/s", hint: "If it is 0, read the messages: they name the setting that stops the counter. If it is a wrong number, check the scale factor." },
      ],
      watch: ["LeftWheel", "RightWheel"],
      inspect: ["EQep2Regs.QPOSCNT", "EQep2Regs.QEPCTL", "EQep2Regs.QDECCTL", "EQep2Regs.QPOSMAX"],
      hints: [
        "Compare the eQEP2 block with the eQEP1 block line by line. Only the mux position is not the same number.",
        "Mux 5 for GPIO54 and GPIO55, QSRC = 0, QPOSMAX = 0xFFFFFFFF, and QPEN = 1 on the last line.",
        "The scale factor is `2*PI/(2000.0*20.0)`. The right wheel counts up when it turns forward, so the factor is positive.",
      ],
      takeaway: "An eQEP needs three things to count: pins muxed to it, a QPOSMAX above 0, and QPEN = 1.",
    },
    {
      id: "enc-read",
      kind: "code",
      mode: "write",
      title: "Read all three",
      goal: "Write the three read functions so each returns its shaft angle in radians, positive when turned forward.",
      refs: [{ course: "Lab 3" }, { trm: "17.5.1" }, { trm: "17.10.2" }],
      brief: `
\`init_eQEPs()\` is complete. Write the bodies of \`readEncLeft()\`, \`readEncRight()\` and \`readEncWheel()\`.

## Each function
1. Reads its counter into a **signed** 32-bit variable: \`int32_t raw = EQep1Regs.QPOSCNT;\`
2. Returns \`raw\` times a scale factor in radians per count.

Why signed: \`QPOSCNT\` is unsigned, and one count below 0 it reads 0xFFFFFFFF. Stored in an \`int32_t\`, the same bits are -1. No extra code is needed for negative angles.

## The numbers
- eQEP1 is the left wheel, eQEP2 the right wheel: 2000 counts per motor turn, 20 motor turns per wheel turn.
- eQEP3 is the hand wheel: 4000 counts per turn, no gears.

## The sign
The two motors are mounted as mirror images of each other. When the robot drives forward, the right encoder counts **up** and the left encoder counts **down**. Lab 3 has you find this on the real robot by turning the wheels by hand. Both functions must return a **positive** angle for forward motion, so one scale factor is negative.

Try it in the figure: switch to the left wheel, roll it forward, and see what the register reads and what the minus sign does.

{{figure:counts-to-distance}}

The course file has one more line in these functions, \`if (raw >= QEP_maxvalue/2) raw -= QEP_maxvalue;\`, with the comment "I don't think this is needed". It is not: leave it out.

The tests turn the left wheel forward at 4 rad/s, the right wheel forward at 6 rad/s and the hand wheel backward at 2 rad/s, for a quarter of a second.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: [...ANGLE_STIMULI, { at: 10, set: "HANDWHEEL_RADPS", value: -2 }, { at: 260, set: "HANDWHEEL_RADPS", value: 0 }],
      starter: `${DEFS}

${PROTOS}
float readEncWheel(void);

float LeftWheel = 0;
float RightWheel = 0;
float Enc3_rad = 0;

${MAIN_1MS}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();
    Enc3_rad = readEncWheel();`)}

// Left wheel, eQEP1: radians, positive when the robot drives forward
float readEncLeft(void) {
    return 0;
}

// Right wheel, eQEP2: radians, positive when the robot drives forward
float readEncRight(void) {
    return 0;
}

// Hand wheel, eQEP3: radians
float readEncWheel(void) {
    return 0;
}

${INIT_ALL}
`,
      solution: `${DEFS}

${PROTOS}
float readEncWheel(void);

float LeftWheel = 0;
float RightWheel = 0;
float Enc3_rad = 0;

${MAIN_1MS}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();
    Enc3_rad = readEncWheel();`)}

// Left wheel, eQEP1: radians, positive when the robot drives forward
${READ_LEFT}

// Right wheel, eQEP2: radians, positive when the robot drives forward
${READ_RIGHT}

// Hand wheel, eQEP3: radians
${READ_HAND}

${INIT_ALL}
`,
      checks: [
        { kind: "var", name: "RightWheel", at: 135.5, min: 0.74, max: 0.76, label: "RightWheel is 0.75 rad halfway through the motion" },
        { kind: "var", name: "RightWheel", min: 1.49, max: 1.51, label: "RightWheel ends at 1.5 rad", hint: "One wheel turn is 2000.0*20.0 counts and 2*PI radians." },
        { kind: "var", name: "LeftWheel", min: 0.99, max: 1.01, label: "LeftWheel ends at +1.0 rad", hint: "If it is -1.0, remember the left encoder counts down when the robot drives forward: negate its factor." },
        { kind: "var", name: "Enc3_rad", min: -0.51, max: -0.49, label: "Enc3_rad ends at -0.5 rad", hint: "The hand wheel has 4000 counts per turn. A negative count must give a negative angle: read QPOSCNT into an int32_t." },
      ],
      watch: ["LeftWheel", "RightWheel", "Enc3_rad"],
      inspect: ["EQep1Regs.QPOSCNT", "EQep2Regs.QPOSCNT", "EQep3Regs.QPOSCNT"],
      hints: [
        "All three functions have the same two lines. Only the register and the factor differ.",
        "Right: `2*PI/(2000.0*20.0)`. Hand wheel: `2*PI/4000.0`. Left: the right wheel's factor with a minus sign.",
        "`int32_t raw = 0; raw = EQep1Regs.QPOSCNT; return (raw*(-2*PI/(2000.0*20.0)));`",
      ],
      takeaway: "Put the sign and the units inside the read function. Everything above it then works in radians, positive forward, and never sees counts.",
    },
    {
      id: "enc-speed",
      kind: "code",
      mode: "write",
      title: "How fast, how far",
      goal: "Compute each wheel's distance in feet and its speed in ft/s every millisecond.",
      refs: [{ course: "Lab 3" }, { course: "L6-7" }],
      brief: `
The read functions work. Now turn angles into distance and speed, inside the 1 ms interrupt function.

## Distance
Lab 3 has you push the robot 3 feet along the floor and read the wheel angle: about 29.2 rad, so about 9.72 radians per foot. One radian is then 1 / 9.72 = 0.103 ft, which is the wheel radius, 1.235 inches. The course code writes the factor as \`(1.235/12.0)\` feet per radian. Use that:

\`\`\`c
LeftDist = LeftWheel * (1.235/12.0);
\`\`\`

## Speed
Speed is the derivative of position. A program cannot take a derivative, but it can compare the position now with the position one sample ago. This is the **backward difference**:

\`\`\`c
v = (p_current - p_old) / 0.001;    // 0.001 s between samples
\`\`\`

Try it in the figure: slow the wheel down and watch the computed speed jump between a few values, because the position only moves in whole counts.

{{figure:speed-from-counts}}

For it to work, \`p_old\` must still hold the previous position when the function runs again 1 ms later. So it is a **global** variable, and the last thing the function does is save the current position into it.

## What to write
In \`cpu_timer0_isr\`, after the two reads:
- \`LeftDist\` and \`RightDist\` in feet
- \`LeftVel\` and \`RightVel\` in ft/s, from the change in distance (or in angle, times the same factor) over 0.001 s
- save the current values for the next call

Add the global variables you need for the old values. The course calls them \`LeftWheel_1\` and \`RightWheel_1\`.
`,
      kit: "robot",
      durationMs: 500,
      stimuli: SPEED_STIMULI,
      starter: `${DEFS}

${PROTOS}

${SPEED_GLOBALS}
// Add globals for the values from 1 ms ago

${MAIN_1MS}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    // Distance in feet

    // Speed in ft/s by backward difference

    // Remember the current values for the next call
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      solution: `${DEFS}

${PROTOS}

${SPEED_GLOBALS}
float LeftWheel_1 = 0;    // wheel angles 1 ms ago
float RightWheel_1 = 0;

${MAIN_1MS}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    // Distance in feet
    LeftDist = LeftWheel * (1.235/12.0);
    RightDist = RightWheel * (1.235/12.0);

    // Speed in ft/s by backward difference
    LeftVel = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;
    RightVel = (1.235/12.0) * (RightWheel - RightWheel_1) / 0.001;

    // Remember the current values for the next call
    LeftWheel_1 = LeftWheel;
    RightWheel_1 = RightWheel;
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: SPEED_CHECKS,
      watch: ["LeftWheel", "RightWheel", "LeftDist", "RightDist", "LeftVel", "RightVel"],
      hints: [
        "Three steps per wheel: distance, speed, save. The save must come after the speed line, or the difference is always 0.",
        "`LeftVel = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;` with `float LeftWheel_1 = 0;` declared outside every function.",
        "End the function with `LeftWheel_1 = LeftWheel;` and `RightWheel_1 = RightWheel;` before the PIEACK line.",
      ],
      takeaway: "Watch LeftVel while the wheel turns steadily: it flickers by a few percent. In 1 ms the count changes by a whole number, so the backward difference can only take steps of one count per millisecond.",
    },
    {
      id: "enc-pold",
      kind: "code",
      mode: "debug",
      title: "Faster and faster",
      goal: "The wheels turn steadily but the measured speed keeps growing. Find the bug.",
      refs: [{ course: "Lab 3" }],
      brief: `
Lab 3 asks you to "explain to your TA why \`p_old\` should be a global variable". This program shows what happens when it is not.

The left wheel turns at a steady 6.28 rad/s, which is about 0.65 ft/s. Run the program and watch \`LeftVel\`: it starts near that value and then climbs to tens and hundreds of ft/s. It looks like the distance, multiplied by 1000.

The distance and the scale factors are right. Look at where the old angle lives, and what value it has each time the function starts.

A local variable is created when its function starts and is gone when it returns. An interrupt function is no exception.
`,
      kit: "robot",
      durationMs: 500,
      stimuli: SPEED_STIMULI,
      starter: `${DEFS}

${PROTOS}

${SPEED_GLOBALS}

${MAIN_1MS}

${isr(`    float LeftWheel_1 = 0;    // wheel angles 1 ms ago
    float RightWheel_1 = 0;

    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    LeftDist = LeftWheel * (1.235/12.0);
    RightDist = RightWheel * (1.235/12.0);

    LeftVel = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;
    RightVel = (1.235/12.0) * (RightWheel - RightWheel_1) / 0.001;

    LeftWheel_1 = LeftWheel;
    RightWheel_1 = RightWheel;
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      solution: `${DEFS}

${PROTOS}

${SPEED_GLOBALS}
float LeftWheel_1 = 0;    // wheel angles 1 ms ago
float RightWheel_1 = 0;

${MAIN_1MS}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    LeftDist = LeftWheel * (1.235/12.0);
    RightDist = RightWheel * (1.235/12.0);

    LeftVel = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;
    RightVel = (1.235/12.0) * (RightWheel - RightWheel_1) / 0.001;

    LeftWheel_1 = LeftWheel;
    RightWheel_1 = RightWheel;
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: SPEED_CHECKS,
      watch: ["LeftWheel", "LeftVel", "RightVel"],
      hints: [
        "Every call starts by setting the old angle to 0. So the difference is the whole angle, not the change in the last millisecond.",
        "The old angle must survive from one call to the next. Where do variables live that survive?",
        "Move `float LeftWheel_1 = 0;` and `float RightWheel_1 = 0;` out of the function, next to the other globals.",
      ],
      takeaway: "Anything an interrupt function must remember between calls is a global (or a static local). The same goes for counters, filter states and the integral of a controller.",
    },
    {
      id: "enc-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Trip computer",
      goal: "Report the distance of both wheels and the average speed every 100 ms, and light LED1 while the robot moves.",
      refs: [{ course: "Lab 3" }, { course: "Lab 1" }, { trm: "17.5.1" }],
      brief: `
Put the chapter together with the timer, interrupt and serial chapters. Lab 3 prints these numbers on the robot's LCD. Here they go to the serial terminal.

## Every 1 ms, in \`cpu_timer0_isr\`
- Read both wheels (the read functions are given).
- Compute \`LeftDist\` and \`RightDist\` in feet, \`LeftVel\` and \`RightVel\` in ft/s, and \`AvgVel\`, the average of the two speeds.
- Switch **LED1** (GPIO22) on while \`AvgVel\` is above 0.25 ft/s, and off otherwise.
- On every 100th call, set \`UARTPrint = 1\`.

## In the \`while (1)\` loop
When \`UARTPrint\` is 1, clear it and print one line:

\`\`\`c
serial_printf(&SerialA, "L %.2f R %.2f V %.2f\\r\\n", LeftDist, RightDist, AvgVel);
\`\`\`

Never print inside the interrupt function: printing is slow, and the next millisecond would be late.

## The test drive
The left wheel turns at 4 rad/s and the right wheel at 6 rad/s from 50 ms to 800 ms, then both stop. Feet per radian is \`(1.235/12.0)\`. The last line must read \`L 0.31 R 0.46 V 0.00\`.
`,
      kit: "robot",
      durationMs: 1050,
      stimuli: [
        { at: 50, set: "LEFT_WHEEL_RADPS", value: 4 },
        { at: 50, set: "RIGHT_WHEEL_RADPS", value: 6 },
        { at: 800, set: "LEFT_WHEEL_RADPS", value: 0 },
        { at: 800, set: "RIGHT_WHEEL_RADPS", value: 0 },
      ],
      starter: `${DEFS}

${PROTOS}

float LeftWheel = 0;      // wheel angles, rad
float RightWheel = 0;
float LeftDist = 0;       // distance travelled, ft
float RightDist = 0;
float LeftVel = 0;        // speed, ft/s
float RightVel = 0;
float AvgVel = 0;
uint16_t UARTPrint = 0;
// Add the globals you need

${mainWith(
  1000,
  `
    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

    init_serialSCIA(&SerialA, 115200);
`,
  `    while (1) {
        // Print one line when the interrupt function asks for it
    }`,
)}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    // Distances, speeds, average speed

    // LED1 on while AvgVel is above 0.25 ft/s

    // Every 100th call: UARTPrint = 1
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      solution: `${DEFS}

${PROTOS}

float LeftWheel = 0;      // wheel angles, rad
float RightWheel = 0;
float LeftDist = 0;       // distance travelled, ft
float RightDist = 0;
float LeftVel = 0;        // speed, ft/s
float RightVel = 0;
float AvgVel = 0;
uint16_t UARTPrint = 0;
float LeftDist_1 = 0;     // distances 1 ms ago
float RightDist_1 = 0;
uint32_t numTimer0calls = 0;

${mainWith(
  1000,
  `
    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

    init_serialSCIA(&SerialA, 115200);
`,
  `    while (1) {
        if (UARTPrint == 1) {
            UARTPrint = 0;
            serial_printf(&SerialA, "L %.2f R %.2f V %.2f\\r\\n", LeftDist, RightDist, AvgVel);
        }
    }`,
)}

${isr(`    LeftWheel = readEncLeft();
    RightWheel = readEncRight();

    LeftDist = LeftWheel * (1.235/12.0);
    RightDist = RightWheel * (1.235/12.0);
    LeftVel = (LeftDist - LeftDist_1) / 0.001;
    RightVel = (RightDist - RightDist_1) / 0.001;
    AvgVel = (LeftVel + RightVel) / 2.0;
    LeftDist_1 = LeftDist;
    RightDist_1 = RightDist;

    if (AvgVel > 0.25) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

    numTimer0calls++;
    if ((numTimer0calls % 100) == 0) {
        UARTPrint = 1;
    }
`)}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: [
        { kind: "serial-period", periodMs: 100, label: "A line is printed every 100 ms" },
        { kind: "serial", matches: "L 0\\.\\d\\d R 0\\.\\d\\d V 0\\.5[0-3]\\r\\n", label: "While driving, the average speed prints as about 0.51 ft/s", hint: "(4 + 6) / 2 = 5 rad/s, times 1.235/12 ft per rad, is 0.51 ft/s." },
        { kind: "serial", matches: "L 0\\.31 R 0\\.46 V 0\\.00\\r\\n$", label: "The last line is L 0.31 R 0.46 V 0.00", hint: "Distance is angle times (1.235/12.0). A speed that is not 0 at rest means the old value is not saved after the speed is computed." },
        { kind: "led", led: "LED1", at: 400, on: true, label: "LED1 is on while the robot drives" },
        { kind: "led", led: "LED1", at: 950, on: false, label: "LED1 is off after the robot stops" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside the interrupt function", hint: "Set UARTPrint in the interrupt function and call serial_printf in the while(1) loop." },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "cpu_timer0_isr never takes more than 2 microseconds", hint: "Two reads, a few lines of arithmetic, one LED write. No loops and no printing." },
      ],
      watch: ["LeftDist", "RightDist", "AvgVel", "numTimer0calls"],
      hints: [
        "Start from your code of the level \"How fast, how far\" and add the average, the LED and a call counter.",
        "`numTimer0calls++; if ((numTimer0calls % 100) == 0) { UARTPrint = 1; }`. In main: `if (UARTPrint == 1) { UARTPrint = 0; serial_printf(...); }`",
        "LED: `if (AvgVel > 0.25) { GpioDataRegs.GPASET.bit.GPIO22 = 1; } else { GpioDataRegs.GPACLEAR.bit.GPIO22 = 1; }`",
      ],
      takeaway: "This is the measuring half of every motor controller in the course: read the encoders at a fixed rate, convert to real units, and leave slow work such as printing to main().",
    },

    // ---------------- practice ----------------
    {
      id: "enc-states",
      kind: "order",
      tier: "practice",
      title: "Four states, one slit",
      goal: "Put the states of A and B in the order the eQEP sees them while it counts up through one slit.",
      refs: [{ trm: "17.4.1" }, { course: "L6-7" }],
      brief: `
Written as a pair, A and B have four possible states: 00, 10, 11 and 01. While the shaft turns, the pair walks through them in a fixed circle. The eQEP adds 1 for every step in one direction around the circle and subtracts 1 for every step in the other.

The count goes **up** when **A leads B**: A changes first, then B follows.

Try it in the figure: step the disc one quarter at a time and follow the highlighted state round the circle.

{{figure:quadrature}}

Start from A = 0, B = 0 with the count at 0, and order the steps for the count going up. Remember that only one signal changes per step. A jump straight from 00 to 11 can never happen on a healthy encoder; the eQEP flags it as a phase error.
`,
      steps: [
        "A = 0, B = 0. The count is 0",
        "A rises: A = 1, B = 0. The count is 1",
        "B rises: A = 1, B = 1. The count is 2",
        "A falls: A = 0, B = 1. The count is 3",
        "B falls: A = 0, B = 0. The count is 4, and one slit has passed",
      ],
      hints: [
        "A leads, so the first signal to change is A.",
        "After A has risen, the next change is B doing the same thing.",
        "00, 10, 11, 01, and back to 00.",
      ],
      takeaway: "00, 10, 11, 01 is a 2-bit Gray code. Read the same list backwards and you have the sequence for counting down.",
    },
    {
      id: "enc-dead",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Stuck at zero",
      goal: "Both wheels turn but both angles stay at 0. Find what is missing in each eQEP block.",
      refs: [{ course: "Lab 3" }, { trm: "17.2" }, { trm: "17.10.2" }],
      brief: `
Someone retyped \`init_eQEPs()\` instead of pasting it. The program builds and runs, the wheels turn, and \`LeftWheel\` and \`RightWheel\` both stay at exactly 0.

On the real robot you would get no hint at all: a counter that is not counting is not an error. Check the three things every eQEP needs:

- its two pins are muxed to it. EQEP1A/B are GPIO20/21 at mux **1**; EQEP2A/B are GPIO54/55 at mux **5**.
- \`QPOSMAX\` is not 0
- \`QPEN\` is 1 at the end

Something is **missing** from the eQEP1 block, and something else is missing from the eQEP2 block. The messages under the code point at the line that reads a dead counter and say what stops it.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: ANGLE_STIMULI,
      starter: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

void init_eQEPs(void) {

${QEP1.replace(/ {4}GPIO_SetupPinMux\(2[01], [^\n]*\n/g, "")}

${QEP2.replace("\n    EQep2Regs.QEPCTL.bit.QPEN = 1;    // Enable EQep", "")}
}

${READ_LEFT}

${READ_RIGHT}
`,
      solution: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: [
        { kind: "no-diagnostic", code: "eqep-mux", label: "The encoder pins are connected to their eQEP", hint: "GPIO20 and GPIO21 are still plain GPIO pins (mux 0). EQEP1A and EQEP1B are mux position 1." },
        { kind: "no-diagnostic", code: "eqep-disabled", label: "No counter is read while it is switched off", hint: "The eQEP2 block clears QPEN to set the module up and never sets it again." },
        { kind: "var", name: "LeftWheel", min: 0.99, max: 1.01, label: "LeftWheel is 1.0 rad after 0.25 s at 4 rad/s" },
        { kind: "var", name: "RightWheel", min: 1.49, max: 1.51, label: "RightWheel is 1.5 rad after 0.25 s at 6 rad/s" },
      ],
      watch: ["LeftWheel", "RightWheel"],
      inspect: ["EQep1Regs.QEPCTL", "EQep2Regs.QEPCTL", "GpioCtrlRegs.GPAMUX2", "GpioCtrlRegs.GPAGMUX2"],
      hints: [
        "Compare the two blocks line by line. Each has lines the other lacks.",
        "eQEP1: nothing hands GPIO20 and GPIO21 to the eQEP. eQEP2: its last line is missing.",
        "Add `GPIO_SetupPinMux(20, GPIO_MUX_CPU1, 1);` and `GPIO_SetupPinMux(21, GPIO_MUX_CPU1, 1);` after the first EDIS, and `EQep2Regs.QEPCTL.bit.QPEN = 1;` at the end of the eQEP2 block.",
      ],
      takeaway: "A silent counter is a set-up problem, not a wiring problem, more often than you would think. Check mux, QPOSMAX and QPEN in the register view before you reach for the oscilloscope.",
    },
    {
      id: "enc-scale",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Wrong way, wrong size",
      goal: "One wheel reads a negative angle and the other reads nothing. Fix both scale factors.",
      refs: [{ course: "Lab 3" }],
      brief: `
The counters count. The angles are still wrong:

- The robot drives **forward**, and \`LeftWheel\` goes **negative**.
- \`RightWheel\` should reach 1.5 rad. It stays at 0, although its counter is counting.

## What Lab 3 says about integers
"An integer divided by an integer gives you back an integer. For example, \`float value = 1/5000\` is always 0. You would need to change the line to \`1.0/5000.0\`."

On this chip there is a second trap. An \`int\` is **16 bits**, so the largest \`int\` is 32767. A product of two \`int\` constants is computed as an \`int\`, even if the result does not fit.

Look at the constants in \`readEncRight()\` with both rules in mind. Then decide which wheel needs the minus sign.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: ANGLE_STIMULI,
      starter: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

${INIT_WHEELS}

float readEncLeft(void) {
    int32_t raw = 0;
    raw = EQep1Regs.QPOSCNT;
    return (raw*(2*PI/(2000.0*20.0)));
}

float readEncRight(void) {
    int32_t raw = 0;
    raw = EQep2Regs.QPOSCNT;
    return ((raw/(2000*20))*2*PI);
}
`,
      solution: `${DEFS}

${PROTOS}

float LeftWheel = 0;
float RightWheel = 0;

${MAIN_1MS}

${ISR_READ}

${INIT_WHEELS}

${READ_LEFT}

${READ_RIGHT}
`,
      checks: [
        { kind: "var", name: "LeftWheel", at: 135.5, min: 0.49, max: 0.51, label: "LeftWheel is +0.5 rad halfway through the motion", hint: "The left encoder counts down when the robot drives forward. Its factor needs a minus sign." },
        { kind: "var", name: "LeftWheel", min: 0.99, max: 1.01, label: "LeftWheel ends at +1.0 rad" },
        { kind: "var", name: "RightWheel", at: 135.5, min: 0.74, max: 0.76, label: "RightWheel is 0.75 rad halfway through the motion", hint: "raw/(2000*20) divides two integers, and 2000*20 does not fit in a 16-bit int. Write 2000.0*20.0 and multiply raw by the whole factor." },
        { kind: "var", name: "RightWheel", min: 1.49, max: 1.51, label: "RightWheel ends at 1.5 rad" },
      ],
      watch: ["LeftWheel", "RightWheel"],
      inspect: ["EQep1Regs.QPOSCNT", "EQep2Regs.QPOSCNT"],
      hints: [
        "Watch the two QPOSCNT registers: the right one counts up, the left one counts down from 0xFFFFFFFF. The counters are fine.",
        "2000*20 is 40000, which is more than 32767. And dividing the integer raw by an integer throws away everything after the decimal point.",
        "Left: `raw*(-2*PI/(2000.0*20.0))`. Right: `raw*(2*PI/(2000.0*20.0))`.",
      ],
      takeaway: "Write physical constants with a decimal point, and keep the whole scale factor in one pair of parentheses so the compiler folds it into a single floating-point number.",
    },

    // ---------------- expert ----------------
    {
      id: "enc-soft",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Be the eQEP",
      goal: "Decode the hand wheel's A and B signals in software, from two GPIO inputs, without the eQEP.",
      refs: [{ trm: "17.4.1" }, { course: "L6-7" }],
      brief: `
The hand wheel's A and B outputs are on **GPIO6** and **GPIO7**. In this level they stay plain GPIO inputs, and your code does the eQEP's job.

## What to build
- A timer 0 interrupt every **100 microseconds** (set up for you) samples A and B.
- A global \`int32_t count\` goes up by 1 for every edge when A leads B, and down by 1 when B leads A, exactly like \`QPOSCNT\` in quadrature count mode.

## How
Keep the previous state of the pair (A, B). On each sample, the old state and the new state together tell you what happened:
- same state: nothing
- one step forward around the circle 00, 10, 11, 01: +1
- one step backward: -1
- both signals changed: you sampled too slowly and missed an edge. Count nothing.

The old and new state together are 4 bits, so there are 16 cases. A 16-entry table indexed by those 4 bits turns the whole decoder into one array read. An if-chain works too.

## The test
The hand wheel turns forward at 1.5 rad/s for 200 ms, then backward at 0.62 rad/s for 200 ms. It has 4000 counts per turn, so edges come about 1 ms apart at most: a 100 microsecond sample period is fast enough. The encoder is at state 00 when the program starts.

Do not use \`EQep3Regs\`.
`,
      kit: "robot",
      durationMs: 420,
      stimuli: [
        { at: 0, set: "HANDWHEEL_RADPS", value: 1.5 },
        { at: 200, set: "HANDWHEEL_RADPS", value: -0.62 },
        { at: 400, set: "HANDWHEEL_RADPS", value: 0 },
      ],
      starter: `${DEFS}

__interrupt void cpu_timer0_isr(void);

int32_t count = 0;        // position in quadrature counts

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Hand wheel channel A on GPIO6, channel B on GPIO7: plain inputs
    GPIO_SetupPinMux(6, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(6, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(7, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(7, GPIO_INPUT, GPIO_PULLUP);

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100);   // every 100 us
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;

    while (1) {}
}

// Runs every 100 us
__interrupt void cpu_timer0_isr(void)
{
    // Sample A and B, compare with the previous state, update count

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${DEFS}

__interrupt void cpu_timer0_isr(void);

int32_t count = 0;        // position in quadrature counts
uint16_t state_old = 0;   // previous (A, B): A in bit 1, B in bit 0

// Index: old state in bits 3-2, new state in bits 1-0.
// Counting up, the states run 00, 10, 11, 01 (as numbers: 0, 2, 3, 1).
int16_t QTABLE[16] = {
     0, -1,  1,  0,     // from 00: to 01 is down, to 10 is up
     1,  0,  0, -1,     // from 01: to 00 is up,   to 11 is down
    -1,  0,  0,  1,     // from 10: to 00 is down, to 11 is up
     0,  1, -1,  0      // from 11: to 01 is up,   to 10 is down
};

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Hand wheel channel A on GPIO6, channel B on GPIO7: plain inputs
    GPIO_SetupPinMux(6, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(6, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(7, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(7, GPIO_INPUT, GPIO_PULLUP);

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100);   // every 100 us
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;

    while (1) {}
}

// Runs every 100 us
__interrupt void cpu_timer0_isr(void)
{
    uint16_t state = 0;

    state = (GpioDataRegs.GPADAT.bit.GPIO6 << 1) | GpioDataRegs.GPADAT.bit.GPIO7;
    count += QTABLE[(state_old << 2) | state];
    state_old = state;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "var", name: "count", at: 100.5, min: 94, max: 97, label: "count is about 95 after 100 ms forward" },
        { kind: "var", name: "count", at: 195.5, min: 185, max: 188, label: "count is about 187 after 195 ms forward", hint: "Twice the expected value: both edges of A and of B count once each, not twice. Half: you are missing the edges of one channel." },
        { kind: "var", name: "count", min: 111, max: 113, label: "count is back down to 112 after 200 ms backward", hint: "If it kept going up, the direction is not decoded: the same edge counts +1 or -1 depending on the other signal." },
        { kind: "source", mustNotMatch: "EQep", label: "The eQEP module is not used" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.4, label: "cpu_timer0_isr never takes more than 0.4 microseconds", hint: "A 16-entry table indexed by (old << 2) | new replaces every if." },
      ],
      watch: ["count", "state_old"],
      hints: [
        "Pack the pair into one number: `(A << 1) | B`. Counting up it runs 0, 2, 3, 1, 0.",
        "The table index is `(state_old << 2) | state`. Write down the eight valid moves: 0-2, 2-3, 3-1, 1-0 are +1; the same pairs reversed are -1; everything else is 0.",
        "`int16_t QTABLE[16] = {0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0};` then `count += QTABLE[(state_old << 2) | state]; state_old = state;`",
      ],
      takeaway: "At 100 microseconds per sample this decoder tops out at 10000 counts per second. The wheel encoders reach more than 100000, and the interrupt would eat the whole CPU: that is why the eQEP exists.",
    },
    {
      id: "enc-wrap",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Round the corner",
      goal: "Measure speed and total angle from a counter that wraps around once per turn.",
      refs: [{ trm: "17.5.1" }, { course: "Lab 3" }],
      brief: `
Here eQEP3 is set up differently from the course: \`QPOSMAX = 3999\`. The hand wheel has 4000 counts per turn, so \`QPOSCNT\` is now the **angle within one turn**: it runs 0 to 3999, and then

- counting up past 3999 it continues at 0 (overflow)
- counting down past 0 it continues at 3999 (underflow)

That is handy for an angle display. It breaks the backward difference: at the wrap, new minus old is suddenly about -4000 or +4000 counts.

## What to write, every 1 ms
- \`HandVel\`: speed of the hand wheel in rad/s
- \`TotalRad\`: the total angle turned since the start in rad, over any number of turns, negative when turned backward

Both must be right across wraps in both directions. Leave \`QPOSMAX\` at 3999.

## The idea
Work with the **change in counts** since the last call. The wheel cannot move anywhere near half a turn in 1 ms. So a change of more than +2000 counts is really a small step backward across the wrap, and a change of less than -2000 is a small step forward. Correct the change by one full turn (4000 counts), then use it for both results.

With the course's setting, \`QPOSMAX = 0xFFFFFFFF\`, the wrap sits at 2^32 and the same correction happens by itself: subtracting two \`int32_t\` values wraps the same way the counter does.

The test turns the wheel forward at 20 rad/s for 400 ms, then backward at 20 rad/s for 600 ms.
`,
      kit: "robot",
      durationMs: 1030,
      stimuli: [
        { at: 5, set: "HANDWHEEL_RADPS", value: 20 },
        { at: 405, set: "HANDWHEEL_RADPS", value: -20 },
        { at: 1005, set: "HANDWHEEL_RADPS", value: 0 },
      ],
      starter: `${DEFS}

__interrupt void cpu_timer0_isr(void);
void init_eQEPs(void);

float HandVel = 0;        // rad/s
float TotalRad = 0;       // total angle since the start, rad
int32_t count_old = 0;    // QPOSCNT 1 ms ago

${MAIN_1MS}

${isr(`    int32_t count = 0;
    int32_t delta = 0;

    count = EQep3Regs.QPOSCNT;
    delta = count - count_old;
    count_old = count;

    // This is wrong whenever the counter wrapped since the last call
    HandVel = delta * (2*PI/4000.0) / 0.001;
    TotalRad = count * (2*PI/4000.0);
`)}

void init_eQEPs(void) {

${QEP3.replace("EQep3Regs.QPOSMAX = 0xFFFFFFFF;   // use full range of the 32 bit count", "EQep3Regs.QPOSMAX = 3999;         // one turn: QPOSCNT runs 0 to 3999")}
}
`,
      solution: `${DEFS}

__interrupt void cpu_timer0_isr(void);
void init_eQEPs(void);

float HandVel = 0;        // rad/s
float TotalRad = 0;       // total angle since the start, rad
int32_t count_old = 0;    // QPOSCNT 1 ms ago

${MAIN_1MS}

${isr(`    int32_t count = 0;
    int32_t delta = 0;

    count = EQep3Regs.QPOSCNT;
    delta = count - count_old;
    count_old = count;

    // More than half a turn in 1 ms is impossible: the counter wrapped
    if (delta > 2000) {
        delta -= 4000;
    }
    if (delta < -2000) {
        delta += 4000;
    }

    HandVel = delta * (2*PI/4000.0) / 0.001;
    TotalRad += delta * (2*PI/4000.0);
`)}

void init_eQEPs(void) {

${QEP3.replace("EQep3Regs.QPOSMAX = 0xFFFFFFFF;   // use full range of the 32 bit count", "EQep3Regs.QPOSMAX = 3999;         // one turn: QPOSCNT runs 0 to 3999")}
}
`,
      checks: [
        { kind: "reg", reg: "EQep3Regs.QPOSMAX", equals: 3999, label: "QPOSMAX is still 3999" },
        { kind: "var", name: "HandVel", at: 200.5, min: 18.5, max: 20.8, label: "HandVel is about 20 rad/s while turning forward" },
        { kind: "var", name: "TotalRad", at: 404.5, min: 7.9, max: 8.1, label: "TotalRad is about 8 rad after 400 ms forward (more than one turn)", hint: "8 rad is 1.27 turns. If you see about 1.7, the angle fell back by 2 pi when the counter passed 3999." },
        { kind: "var", name: "HandVel", at: 700.5, min: -20.8, max: -18.5, label: "HandVel is about -20 rad/s while turning backward" },
        { kind: "var", name: "TotalRad", min: -4.1, max: -3.9, label: "TotalRad ends at -4 rad", hint: "Add up the corrected changes. The counter itself can never show a negative angle or more than one turn." },
      ],
      watch: ["HandVel", "TotalRad", "count_old"],
      inspect: ["EQep3Regs.QPOSCNT", "EQep3Regs.QPOSMAX"],
      hints: [
        "Fix `delta` first. Everything else follows from a correct change in counts.",
        "`if (delta > 2000) delta -= 4000;` and `if (delta < -2000) delta += 4000;`",
        "TotalRad cannot come from `count` any more: accumulate it with `TotalRad += delta * (2*PI/4000.0);`",
      ],
      takeaway: "Never difference two readings of a wrapping counter without thinking about the wrap. The rule works as long as the shaft moves less than half the counter's range between two samples.",
    },
    {
      id: "enc-slow",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Slower than one count",
      goal: "Measure a wheel that turns so slowly that most milliseconds see no count at all, and detect when it has stopped.",
      refs: [{ trm: "17.6" }, { course: "Lab 3" }, { course: "L6-7" }],
      brief: `
The backward difference counts how many counts arrive in a fixed time. One count per millisecond is already 0.157 rad/s. Below that, the 1 ms difference is 0 most of the time and one count now and then: useless.

For slow motion, turn the measurement around: **measure the time between counts**. (The eQEP has an edge capture unit that does this in hardware. Here you do it in the 1 ms interrupt.)

Try it in the figure: set the slowest speed, then compare "difference over 1 ms" with "time between counts".

{{figure:speed-from-counts}}

## What to write, every 1 ms
Keep the count at the last change and the number of milliseconds since then.

- If the count has **changed**: \`SlowVel\` = change in angle / time since the last change, in rad/s (wheel angle, right wheel, 2000 x 20 counts per turn). Remember the count, restart the time, and clear \`Stalled\`.
- If the count has **not changed for 200 ms**: the wheel has stopped. Set \`SlowVel = 0\` and \`Stalled = 1\`.
- Otherwise leave \`SlowVel\` as it is: no news means "still the same speed".

## The test
The right wheel turns at 0.005 rad/s for one second (a count about every 31 ms), then at 0.002 rad/s for one second (a count about every 79 ms), then it is held still. \`FastVel\`, the ordinary backward difference, is computed for you: watch it to see why it cannot be used here.
`,
      kit: "robot",
      durationMs: 2400,
      stimuli: [
        { at: 5, set: "RIGHT_WHEEL_RADPS", value: 0.005 },
        { at: 1005, set: "RIGHT_WHEEL_RADPS", value: 0.002 },
        { at: 2005, set: "RIGHT_WHEEL_RADPS", value: 0 },
      ],
      starter: `${DEFS}
#define RAD_PER_COUNT (2*PI/(2000.0*20.0))

__interrupt void cpu_timer0_isr(void);
void init_eQEPs(void);

float FastVel = 0;        // backward difference over 1 ms, rad/s
float SlowVel = 0;        // from the time between counts, rad/s
uint16_t Stalled = 0;     // 1 when no count arrived for 200 ms
int32_t count_1 = 0;      // count 1 ms ago

${MAIN_1MS}

${isr(`    int32_t count = 0;

    count = EQep2Regs.QPOSCNT;
    FastVel = (count - count_1) * RAD_PER_COUNT / 0.001;
    count_1 = count;

    // SlowVel and Stalled
`)}

void init_eQEPs(void) {

${QEP2}
}
`,
      solution: `${DEFS}
#define RAD_PER_COUNT (2*PI/(2000.0*20.0))

__interrupt void cpu_timer0_isr(void);
void init_eQEPs(void);

float FastVel = 0;        // backward difference over 1 ms, rad/s
float SlowVel = 0;        // from the time between counts, rad/s
uint16_t Stalled = 0;     // 1 when no count arrived for 200 ms
int32_t count_1 = 0;      // count 1 ms ago
int32_t count_last = 0;   // count at the last change
uint32_t msSince = 0;     // milliseconds since the last change

${MAIN_1MS}

${isr(`    int32_t count = 0;

    count = EQep2Regs.QPOSCNT;
    FastVel = (count - count_1) * RAD_PER_COUNT / 0.001;
    count_1 = count;

    msSince++;
    if (count != count_last) {
        SlowVel = (count - count_last) * RAD_PER_COUNT / (msSince * 0.001);
        count_last = count;
        msSince = 0;
        Stalled = 0;
    } else if (msSince >= 200) {
        SlowVel = 0;
        Stalled = 1;
    }
`)}

void init_eQEPs(void) {

${QEP2}
}
`,
      checks: [
        { kind: "var", name: "SlowVel", at: 900.5, min: 0.0046, max: 0.0054, label: "SlowVel is 0.005 rad/s (within 8 percent) during the first second", hint: "Speed = counts moved x radians per count / seconds since the last change. Count the milliseconds in a global." },
        { kind: "var", name: "Stalled", at: 900.5, equals: 0, label: "Stalled is 0 while the wheel turns" },
        { kind: "var", name: "SlowVel", at: 1900.5, min: 0.0018, max: 0.0022, label: "SlowVel is 0.002 rad/s (within 10 percent) during the second second" },
        { kind: "var", name: "Stalled", at: 1900.5, equals: 0, label: "Stalled is still 0 at 0.002 rad/s (a count every 79 ms)", hint: "Only 200 ms without a count means stopped." },
        { kind: "var", name: "SlowVel", min: -0.000001, max: 0.000001, label: "SlowVel is 0 after the wheel has stood still for 200 ms" },
        { kind: "var", name: "Stalled", equals: 1, label: "Stalled is 1 at the end" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1, label: "cpu_timer0_isr never takes more than 1 microsecond" },
      ],
      watch: ["FastVel", "SlowVel", "Stalled"],
      inspect: ["EQep2Regs.QPOSCNT"],
      hints: [
        "You need two more globals: the count at the last change, and a millisecond counter that you increment on every call.",
        "On a change: `SlowVel = (count - count_last) * RAD_PER_COUNT / (msSince * 0.001);` then `count_last = count; msSince = 0; Stalled = 0;`",
        "`else if (msSince >= 200) { SlowVel = 0; Stalled = 1; }`",
      ],
      takeaway: "Counting counts per time is accurate at high speed; timing each count is accurate at low speed. Real drives switch between the two, and a time-out is the only way either method ever reports exactly zero.",
    },
  ],
};
