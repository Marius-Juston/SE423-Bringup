import type { Chapter } from "../types";

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const INIT = `    InitSysCtrl();
    InitGpio();`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

const TIMER0 = (periodUs: number) => `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, ${periodUs});
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;`;

// Timer 1 is wired straight to CPU interrupt INT13: no PIE enable, no PIEACK.
const TIMER1 = (periodUs: number) => `    // Given: timer 1 goes straight to CPU interrupt 13, not through the PIE
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, ${periodUs});
    CpuTimer1Regs.TCR.all = 0x4000;

    IER |= M_INT13;
    EINT;
    ERTM;`;

/** One motor PWM channel as SE423Lib.c sets it up. */
const motorPwm = (n: number, tbprd: number, cmpa: number) => `    EPwm${n}Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm${n}Regs.TBCTL.bit.FREE_SOFT = 3;   // free run
    EPwm${n}Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1
    EPwm${n}Regs.TBCTL.bit.PHSEN = 0;
    EPwm${n}Regs.TBCTR = 0;
    EPwm${n}Regs.TBPRD = ${tbprd};
    EPwm${n}Regs.CMPA.bit.CMPA = ${cmpa};      // 50 %: motor stopped
    EPwm${n}Regs.AQCTLA.bit.CAU = 1;        // clear at the compare match
    EPwm${n}Regs.AQCTLA.bit.ZRO = 2;        // set at zero
    EPwm${n}Regs.TBPHS.bit.TBPHS = 0;`;

const INIT_MOTORS = (tbprd = 2500, note = "20 kHz") => `// Given: the chapter 9 set-up, once per motor. ${note}.
// EPWM1A on GPIO0 is the left motor, EPWM2A on GPIO2 the right motor.
void init_EPWM1and2(void)
{
${motorPwm(1, tbprd, tbprd / 2)}

${motorPwm(2, tbprd, tbprd / 2)}

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1;   // pull-ups off on the PWM pins
    GpioCtrlRegs.GPAPUD.bit.GPIO2 = 1;
    EDIS;

    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);  // EPWM1A
    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);  // EPWM2A
}`;

/** setEPWM1A / setEPWM2A as in SE423Lib.c. */
const setEpwm = (n: number) => `void setEPWM${n}A(float controleffort)
{
    if (controleffort < -10) {
        controleffort = -10;
    }
    if (controleffort > 10) {
        controleffort = 10;
    }
    uint16_t period = EPwm${n}Regs.TBPRD;
    float value = (controleffort + 10) * period / 20.0;
    EPwm${n}Regs.CMPA.bit.CMPA = value;
}`;

const SERVO_A_INIT = `    EPwm8Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm8Regs.TBCTL.bit.FREE_SOFT = 3;   // free run
    EPwm8Regs.TBCTL.bit.CLKDIV = 5;      // divide by 32: 1.5625 MHz
    EPwm8Regs.TBCTL.bit.PHSEN = 0;
    EPwm8Regs.TBCTR = 0;
    EPwm8Regs.TBPRD = 31250;             // 20 ms: 50 Hz
    EPwm8Regs.CMPA.bit.CMPA = 2500;      // 8 %: 0 degrees
    EPwm8Regs.AQCTLA.bit.CAU = 1;        // clear at CMPA
    EPwm8Regs.AQCTLA.bit.ZRO = 2;        // set at zero
    EPwm8Regs.TBPHS.bit.TBPHS = 0;`;

const SET_SERVO_A = `void setEPWM8A_RCServo(float angle)
{
    if (angle > 90) {
        angle = 90;
    }
    if (angle < -90) {
        angle = -90;
    }
    EPwm8Regs.CMPA.bit.CMPA = 2500 + angle * 1250.0 / 90.0;
}`;

const NOTES = `#define C4NOTE ((uint16_t)(((50000000/4)/2)/261.63))
#define D4NOTE ((uint16_t)(((50000000/4)/2)/293.66))
#define E4NOTE ((uint16_t)(((50000000/4)/2)/329.63))
#define F4NOTE ((uint16_t)(((50000000/4)/2)/349.23))
#define G4NOTE ((uint16_t)(((50000000/4)/2)/392.00))
#define A4NOTE ((uint16_t)(((50000000/4)/2)/440.00))
#define B4NOTE ((uint16_t)(((50000000/4)/2)/493.88))
#define C5NOTE ((uint16_t)(((50000000/4)/2)/523.25))
#define OFFNOTE 0`;

const BUTTONS = `    // PB1 and PB2: inputs with pull-ups, they read 0 while pressed
    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(158, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(158, GPIO_INPUT, GPIO_PULLUP);`;

const PWM12 = `    // EPWM12A on LED1: 10 kHz, starts dark
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBPRD = 5000;
    EPwm12Regs.CMPA.bit.CMPA = 0;
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    EPwm12Regs.AQCTLA.bit.ZRO = 2;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);`;

export const actuators: Chapter = {
  id: "actuators",
  number: 10,
  title: "Motors and actuators",
  blurb: "H-bridge, RC servo and buzzer.",
  requires: ["pwm", "interrupts"],
  course: ["L6-7", "Lab 3", "HW3", "HW4"],
  levels: [
    {
      id: "act-brief",
      kind: "brief",
      title: "Three things a PWM pin can move",
      goal: "See how one PWM signal becomes a motor speed with a direction, a servo angle, or a tone.",
      refs: [{ course: "L6-7", slide: [77, 80, 82] }, { course: "Lab 3" }, { course: "HW3" }, { course: "HW4" }],
      brief: `
A PWM pin gives a few milliamps at 3.3 V. That moves nothing by itself. Each actuator on the course boards reads the PWM signal in its own way.

## DC motor: the duty cycle is a signed command
A DC motor turns one way when current flows through it in one direction, and the other way when the current is reversed. The robot's motors need amps. So an **amplifier** sits between the chip and each motor: a circuit that takes the weak signal of a pin and switches the strong battery current. This one is an **H-bridge**: four switches that can connect the motor to the battery either way round. Try it in the figure with "switches by hand": close S1 and S4, then S3 and S2.

{{figure:h-bridge}}

On the robot, the PWM pin is the amplifier's **direction** input: high connects the battery one way round, low the other way round. The motor feels the average:

- **50 %** duty: forward and backward for equal times. The average is zero and the motor **stands still**.
- **100 %**: full power in the positive direction.
- **0 %**: full power in the negative direction.

So "motor off" is not a quiet pin. It is a 20 kHz signal at exactly 50 %.

## RC servo: the pulse width is an angle
An **RC servo** is a small motor with gears and its own electronics in one box. It turns an arm to an angle and holds it there. It expects one pulse every 20 ms (**50 Hz**), and the **width** of that pulse is the angle: 4 % of the period means -90 degrees, 8 % means 0 degrees and 12 % means +90 degrees.

## Buzzer: the frequency is the note
A **piezo buzzer** is a small disc that clicks each time its voltage changes. Feed it a **square wave** (high for half of each period, low for the other half) and the clicks blend into a tone: 440 periods a second sound as the note A. The duty cycle stays at 50 % and you change the **period**.

`,
      questions: [
        {
          prompt: "EPWM2A drives a motor amplifier's direction input at a 50 % duty cycle. What does the motor do?",
          options: ["It runs at half speed", "It stands still", "It runs at full speed", "It alternates between forward and backward once a second"],
          answer: 1,
          why: "Forward and backward voltage are applied for equal times, 20 000 times a second. The average is zero.",
        },
        {
          prompt: "You want an RC servo to move from 0 degrees to +90 degrees. What do you change?",
          options: ["The carrier frequency, from 50 Hz to 75 Hz", "The pulse width, from about 8 % to about 12 % of the 20 ms period", "The duty cycle, from 50 % to 100 %", "The voltage of the pulse"],
          answer: 1,
          why: "The servo measures the width of the pulse. The 50 Hz repetition rate stays fixed.",
        },
        {
          prompt: "The buzzer plays a note that is too low. What do you change to make it sound higher?",
          options: ["Raise the duty cycle", "Shorten the period of the square wave", "Lengthen the period of the square wave", "Raise CMPA"],
          answer: 1,
          why: "How high a note sounds (its pitch) is its frequency. A shorter period (a smaller TBPRD) is a higher frequency.",
        },
      ],
      takeaway: "Motor: duty cycle around 50 %. Servo: pulse width at 50 Hz. Buzzer: frequency at 50 % duty.",
    },
    {
      id: "act-hbridge",
      kind: "wiring",
      title: "Build the H",
      goal: "Wire four switches so the motor can be connected to the battery in either direction.",
      refs: [{ course: "L6-7", slide: [75, 78] }, { course: "Lab 3" }, { trm: "15.13.5" }],
      brief: `
A DC motor turns one way when current flows from terminal A to terminal B, and the other way when it flows from B to A. To reverse it without unplugging anything you need four switches.

In the diagram the motor sits between its terminals **A** and **B**. Four switches are in place, drawn as push-button symbols (in the real amplifier they are transistors):

- **S1** from "S1 top" down to A, **S2** from A down to "S2 bottom"
- **S3** from "S3 top" down to B, **S4** from B down to "S4 bottom"

Add the four wires that turn this into an H-bridge:

- With **S1 and S4** closed, current flows battery +, A, motor, B, ground: forward.
- With **S3 and S2** closed, current flows battery +, B, motor, A, ground: backward.

Wire each switch end straight to the battery terminal or to ground.

The amplifier's direction input chooses between those two pairs, and never closes S1 and S2 (or S3 and S4) together: that would connect the battery straight to ground through two switches.
`,
      nodes: [
        { id: "vp", label: "Battery +", x: 50, y: 5 },
        { id: "s1t", label: "S1 top", x: 26, y: 15, side: "left" },
        { id: "s3t", label: "S3 top", x: 74, y: 15, side: "right" },
        { id: "a", label: "Motor A", x: 26, y: 31, side: "left" },
        { id: "b", label: "Motor B", x: 74, y: 31, side: "right" },
        { id: "s2b", label: "S2 bottom", x: 26, y: 47, side: "left" },
        { id: "s4b", label: "S4 bottom", x: 74, y: 47, side: "right" },
        { id: "gnd", label: "GND", x: 50, y: 56, side: "bottom" },
      ],
      parts: [
        { kind: "button", a: "s1t", b: "a", label: "S1" },
        { kind: "button", a: "a", b: "s2b", label: "S2" },
        { kind: "button", a: "s3t", b: "b", label: "S3" },
        { kind: "button", a: "b", b: "s4b", label: "S4" },
        { kind: "resistor", a: "a", b: "b", label: "motor" },
      ],
      fixed: [["a", "b"]],
      wires: [
        ["vp", "s1t"],
        ["vp", "s3t"],
        ["s2b", "gnd"],
        ["s4b", "gnd"],
      ],
      mistakes: [
        { wire: ["vp", "gnd"], why: "That wire connects the battery straight to ground: a short circuit, with no switch to stop it." },
        { wire: ["vp", "a"], why: "This bypasses S1: terminal A would always be at battery voltage, and closing S2 would short the battery." },
        { wire: ["vp", "b"], why: "This bypasses S3: terminal B would always be at battery voltage, and closing S4 would short the battery." },
        { wire: ["a", "gnd"], why: "This bypasses S2: terminal A would always be at ground, so current could only ever flow from B to A." },
        { wire: ["b", "gnd"], why: "This bypasses S4: terminal B would always be at ground, so current could only ever flow from A to B." },
        { wire: ["s1t", "gnd"], why: "S1 is a high-side switch: its top goes to the battery. With both S1 and S2 leading to ground, terminal A could never be made positive." },
        { wire: ["s3t", "gnd"], why: "S3 is a high-side switch: its top goes to the battery. With both S3 and S4 leading to ground, terminal B could never be made positive." },
        { wire: ["vp", "s2b"], why: "S2 is a low-side switch: its bottom goes to ground. With both S1 and S2 leading to the battery, terminal A could never be pulled low." },
        { wire: ["vp", "s4b"], why: "S4 is a low-side switch: its bottom goes to ground. With both S3 and S4 leading to the battery, terminal B could never be pulled low." },
      ],
      hints: [
        "The two upper switches are the high side, the two lower ones the low side.",
        "Both tops go to the battery. Both bottoms go to ground.",
        "Battery + to S1 top, Battery + to S3 top, S2 bottom to GND, S4 bottom to GND.",
      ],
      takeaway:
        "The two diagonals of the H are the two directions. Driving the direction input with PWM flips between the diagonals 20 000 times a second, and the duty cycle sets how much time each one gets.",
    },
    {
      id: "act-numbers",
      kind: "calc",
      title: "From a command to counts",
      goal: "Convert motor commands from -10 to 10 into duty cycles and compare values.",
      refs: [{ course: "L6-7", slide: 77 }, { course: "Lab 3" }, { trm: "15.5" }],
      brief: `
Your control code should not have to think in counts. Lab 3 has you write every motor command as a **control effort** \`u\`: a number from **-10** (full power backward) through **0** (stop) to **10** (full power forward). One function, \`setEPWM2A(float u)\`, turns it into a duty cycle on a straight line:

- u = -10 is 0 %
- u = 0 is 50 %
- u = 10 is 100 %

Two steps:

1. \`duty = (u + 10) / 20\`. Adding 10 moves the range -10..10 to 0..20, and dividing by 20 makes it a fraction from 0 to 1.
2. \`CMPA = duty x TBPRD\`, as in chapter 9.

The motor PWMs run at 20 kHz, so \`TBPRD = 2500\` (50 MHz / 20 kHz).

**Worked example**, u = 2: duty = (2 + 10) / 20 = 0.60, so CMPA = 0.60 x 2500 = 1500.

A value outside -10..10 is first **saturated**: cut back to the nearest limit. A command of 14 is treated as 10. Without that step, 14 would ask for a duty of 120 %, and a \`CMPA\` above \`TBPRD\` is never reached by the counter.
`,
      fields: [
        { id: "duty5", label: "Duty cycle for u = 5", unit: "%", answer: 75, why: "(5 + 10) / 20 = 0.75." },
        { id: "cmpa0", label: "CMPA for u = 0 (motor stopped)", answer: 1250, why: "50 % of 2500." },
        { id: "cmpam4", label: "CMPA for u = -4", answer: 750, why: "(-4 + 10) / 20 = 0.30, and 0.30 x 2500 = 750. Below 50 %, so the motor turns in the negative direction." },
        { id: "cmpa14", label: "CMPA for u = 14", answer: 2500, why: "14 is saturated to 10 first. That is 100 %: CMPA = TBPRD." },
        { id: "uback", label: "Control effort u that gives CMPA = 1875", answer: 5, why: "1875 / 2500 = 0.75, and 0.75 x 20 - 10 = 5. Going backwards through the line is how you check a value you see in the register view." },
      ],
      hints: [
        "Saturate u to -10..10 first. Then duty = (u + 10) / 20.",
        "CMPA = duty x 2500. For the last field go backwards: duty = CMPA / 2500, then u = duty x 20 - 10.",
        "75, 1250, 750, 2500, 5.",
      ],
      takeaway: "A motor command ends as a number of counts. Write the straight line once, in one function, and saturate before you scale.",
    },
    {
      id: "act-setepwm",
      kind: "code",
      mode: "complete",
      title: "setEPWM1A and setEPWM2A",
      goal: "Complete the two functions that turn a control effort of -10 to 10 into a motor duty cycle.",
      refs: [{ course: "L6-7", slide: 77 }, { course: "Lab 3" }, { trm: "15.5" }],
      brief: `
Lab 3, exercise 2. EPWM1A (GPIO0) drives the left motor and EPWM2A (GPIO2) the right motor, both at 20 kHz. \`init_EPWM1and2()\`, at the bottom of the file, is given: it is the chapter 9 set-up written once per motor, and it leaves both at 50 %: stopped.

Write the missing parts of

\`\`\`c
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);
\`\`\`

1. **Saturate**: above 10 becomes 10, below -10 becomes -10. These two ifs are written in \`setEPWM1A\`.
2. **Scale**: -10 is 0 % duty, 0 is 50 %, 10 is 100 %. This is the line of the last level: \`(u + 10) / 20\`, times the period.
3. **Write CMPA**. Read the period from the register (\`EPwm1Regs.TBPRD\`) instead of typing 2500 again.

\`CMPA\` is an integer and your value is a \`float\`. C converts by cutting off the fraction: 345.67 becomes 345. That is fine here.

## The test
A timer function (written, do not change it) steps through the efforts 0, 5, 12, -12 and -3, one every 100 ms. It calls \`setEPWM1A(u)\` and \`setEPWM2A(-u)\`.

The minus sign is there because the two motors are mounted mirrored: for the robot to drive forward the right motor needs the opposite command. Lab 3's advice is to put that sign **at the call**, as here, and never to write \`uRight = -uRight;\`, which would also flip the variable your controller keeps using.
`,
      kit: "robot",
      durationMs: 600,
      watch: ["step"],
      inspect: ["EPwm1Regs.CMPA", "EPwm2Regs.CMPA", "EPwm1Regs.TBPRD"],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float test[5] = {0.0, 5.0, 12.0, -12.0, -3.0};
uint16_t step = 0;

void main(void)
{
${INIT}

    init_EPWM1and2();

${PIE_INIT}

${TIMER0(100000)}

    while (1) {
    }
}

void setEPWM1A(float controleffort)
{
    if (controleffort < -10) {
        controleffort = -10;
    }
    if (controleffort > 10) {
        controleffort = 10;
    }
    // Scale -10..10 to 0..TBPRD and write CMPA

}

void setEPWM2A(float controleffort)
{
    // The same for EPWM2

}

// Called every 100 ms. Do not change it.
__interrupt void cpu_timer0_isr(void)
{
    if (step < 5) {
        setEPWM1A(test[step]);
        setEPWM2A(-test[step]);
        step++;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${INIT_MOTORS()}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float test[5] = {0.0, 5.0, 12.0, -12.0, -3.0};
uint16_t step = 0;

void main(void)
{
${INIT}

    init_EPWM1and2();

${PIE_INIT}

${TIMER0(100000)}

    while (1) {
    }
}

${setEpwm(1)}

${setEpwm(2)}

// Called every 100 ms. Do not change it.
__interrupt void cpu_timer0_isr(void)
{
    if (step < 5) {
        setEPWM1A(test[step]);
        setEPWM2A(-test[step]);
        step++;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${INIT_MOTORS()}
`,
      checks: [
        { kind: "duty", pin: 0, pct: 50, tolPct: 0.5, from: 110, to: 190, label: "u = 0: EPWM1A at 50 %", hint: "At 0 %: CMPA is 0 or 1. A fraction such as 0.5 is not counts yet: multiply it by TBPRD. Or the + 10 is missing." },
        { kind: "duty", pin: 0, pct: 75, tolPct: 0.5, from: 210, to: 290, label: "u = 5: EPWM1A at 75 %", hint: "Still at 50 %: setEPWM1A does not write CMPA yet. Otherwise check the line: duty = (u + 10) / 20, and CMPA = duty x TBPRD. For u = 5 that is 1875." },
        { kind: "duty", pin: 2, pct: 25, tolPct: 0.5, from: 210, to: 290, label: "u = -5 on the right motor: EPWM2A at 25 %", hint: "At 50 %: setEPWM2A is still empty, or it writes EPwm1Regs. At 75 %: the sign was flipped twice. The timer function already passes -u, so setEPWM2A must be the same code as setEPWM1A." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 295, min: 10, label: "The left wheel turns forward", hint: "The wheel follows the duty cycle of EPWM1A. Fix the duty checks above and this one follows." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 295, min: 10, label: "The right wheel turns forward too", hint: "The right motor is mirrored: it drives forward for a duty cycle below 50 %. Fix the EPWM2A check above and this one follows." },
        { kind: "duty", pin: 0, pct: 100, tolPct: 0.5, from: 310, to: 390, label: "u = 12 is saturated: EPWM1A at 100 %", hint: "Saturate before scaling. Without it CMPA goes above TBPRD." },
        { kind: "duty", pin: 0, pct: 0, tolPct: 0.5, from: 410, to: 490, label: "u = -12 is saturated: EPWM1A at 0 %", hint: "Without the lower limit, -12 gives a negative count. CMPA has no sign, so it wraps around to a huge number. Keep the if for -10." },
        { kind: "duty", pin: 2, pct: 65, tolPct: 0.5, from: 510, to: 590, label: "u = 3 on the right motor: EPWM2A at 65 %", hint: "setEPWM2A needs its own two saturation ifs and its own scaling line, with EPwm2Regs." },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD", hint: "The message names the line. A value above TBPRD means the command was not limited to -10..10 before it was scaled." },
      ],
      hints: [
        "Add 10 to move -10..10 to 0..20, then divide by 20 for a fraction between 0 and 1.",
        "float value = (controleffort + 10) * EPwm1Regs.TBPRD / 20.0; then assign value to CMPA.",
        "setEPWM2A is the same function with EPwm2Regs, including the two saturation ifs.",
      ],
      takeaway: "One function per motor is the only place that knows about TBPRD and 50 %. Everything above it thinks in -10 to 10.",
    },
    {
      id: "act-debug-creep",
      kind: "code",
      mode: "debug",
      title: "The robot that will not stand still",
      goal: "Find out why both motors turn slowly when the command is zero, and fix it.",
      refs: [{ course: "L6-7", slide: 77, note: "50 % duty is a stopped motor" }, { course: "Lab 3" }, { trm: "15.5" }, { trm: "15.6.3" }],
      brief: `
Your lab partner raised the motor PWM from 20 kHz to **25 kHz**, so \`TBPRD\` is now 2000. Since then the robot slowly turns on the spot with a command of zero, and a command of 10 no longer gives full power.

A motor only stands still at **exactly** 50 % duty. A duty cycle of 62.5 % is a real command: a quarter of full power.

\`main\` commands 0 for 200 ms, then 10, then 4. Look at the duty cycle of GPIO0 in each phase and compare it with what the command should give. Then look at how \`setEPWM1A\` and \`setEPWM2A\` get from the command to counts.

The figure shows what the robot should do at 20 kHz. Choose "one PWM pin" and move the control effort: zero sits at exactly half of the period, and 10 at all of it.

{{figure:h-bridge}}

Keep the carrier at 25 kHz.
`,
      kit: "robot",
      durationMs: 420,
      inspect: ["EPwm1Regs.TBPRD", "EPwm1Regs.CMPA", "EPwm2Regs.CMPA"],
      starter: `void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

void main(void)
{
${INIT}

    init_EPWM1and2();

    setEPWM1A(0.0);
    setEPWM2A(0.0);
    DELAY_US(200000);
    setEPWM1A(10.0);
    setEPWM2A(-10.0);
    DELAY_US(100000);
    setEPWM1A(4.0);
    setEPWM2A(-4.0);

    while (1) {
    }
}

void setEPWM1A(float controleffort)
{
    if (controleffort < -10) {
        controleffort = -10;
    }
    if (controleffort > 10) {
        controleffort = 10;
    }
    EPwm1Regs.CMPA.bit.CMPA = 1250 + controleffort * 125;
}

void setEPWM2A(float controleffort)
{
    if (controleffort < -10) {
        controleffort = -10;
    }
    if (controleffort > 10) {
        controleffort = 10;
    }
    EPwm2Regs.CMPA.bit.CMPA = 1250 + controleffort * 125;
}

${INIT_MOTORS(2000, "25 kHz")}
`,
      solution: `void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

void main(void)
{
${INIT}

    init_EPWM1and2();

    setEPWM1A(0.0);
    setEPWM2A(0.0);
    DELAY_US(200000);
    setEPWM1A(10.0);
    setEPWM2A(-10.0);
    DELAY_US(100000);
    setEPWM1A(4.0);
    setEPWM2A(-4.0);

    while (1) {
    }
}

${setEpwm(1)}

${setEpwm(2)}

${INIT_MOTORS(2000, "25 kHz")}
`,
      checks: [
        { kind: "reg", reg: "EPwm1Regs.TBPRD", equals: 2000, label: "The carrier is still 25 kHz (TBPRD = 2000)", hint: "Do not change init_EPWM1and2. The bug is in the two set functions." },
        { kind: "duty", pin: 0, pct: 50, tolPct: 0.5, from: 20, to: 180, label: "Command 0: EPWM1A at 50 %", hint: "1250 is half of 2500, not half of the TBPRD in use now." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 190, equals: 0, label: "The left wheel stands still at command 0", hint: "It stands still only at exactly 50 %. Fix the check above." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 190, equals: 0, label: "The right wheel stands still at command 0", hint: "setEPWM2A has the same bug as setEPWM1A." },
        { kind: "duty", pin: 0, pct: 100, tolPct: 0.5, from: 220, to: 290, label: "Command 10: EPWM1A at 100 %", hint: "100 % is CMPA = TBPRD = 2000. The old numbers give 2500." },
        { kind: "duty", pin: 0, pct: 70, tolPct: 0.5, from: 320, to: 400, label: "Command 4: EPWM1A at 70 %", hint: "The slope is wrong too: 125 counts per unit of command is a twentieth of 2500, not of the TBPRD in use now." },
        { kind: "duty", pin: 2, pct: 30, tolPct: 0.5, from: 320, to: 400, label: "Command -4: EPWM2A at 30 %", hint: "Both numbers in setEPWM2A must come from EPwm2Regs.TBPRD as well." },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD", hint: "1250 + 10 x 125 = 2500 counts, but the counter now turns back at 2000." },
      ],
      hints: [
        "The two numbers in the last line of each function were right for one particular TBPRD.",
        "Half of the period and a twentieth of the period should come from the register, not from constants.",
        "uint16_t period = EPwm1Regs.TBPRD; float value = (controleffort + 10) * period / 20.0; EPwm1Regs.CMPA.bit.CMPA = value;",
      ],
      takeaway:
        "Zero effort must be half of whatever TBPRD is. Read the period from the register, as the course's setEPWM functions do, and a change of carrier frequency cannot move the zero point.",
    },
    {
      id: "act-servo-numbers",
      kind: "calc",
      title: "A slow clock for a servo",
      goal: "Work out the clock divider, TBPRD and CMPA values that make a 20 ms servo pulse.",
      refs: [{ course: "L6-7", slide: [80, 81] }, { course: "HW4" }, { trm: "15.4.3" }, { trm: "15.15.2" }],
      brief: `
A servo wants a pulse every **20 ms**. At the 50 MHz counter clock of chapter 9 that is 20 ms / 20 ns = 1 000 000 counts. \`TBPRD\` is a 16-bit register: its largest value is 65535. A million does not fit.

## Slow the counter down
The field \`CLKDIV\` in \`TBCTL\` divides the counter clock. It does not hold the divider itself. It holds a 3-bit **code**, and the clock is divided by 2 to the power of that code:

- \`CLKDIV = 0\`: divide by 1 (50 MHz, as in chapter 9)
- \`CLKDIV = 1\`: divide by 2
- \`CLKDIV = 2\`: divide by 4
- ... up to \`CLKDIV = 7\`: divide by 128

**Worked example**, \`CLKDIV = 4\`: divide by 16, so the counter clock is 50 MHz / 16 = 3.125 MHz. In 20 ms it counts 0.020 s x 3 125 000 = 62 500 counts. That fits. It is what the robot's library uses.

Homework 4 has you choose the divider. This chapter uses \`CLKDIV = 5\`, so its counts are not the homework's.

## The angle is a share of the period
\`TBPRD\` is 100 % of the period. The pulse is **8 %** of it for 0 degrees, **4 %** for -90 degrees and **12 %** for +90 degrees, on a straight line in between. So 90 degrees is worth 4 % of \`TBPRD\`, and

\`CMPA = (8 % of TBPRD) + angle / 90 x (4 % of TBPRD)\`

**Worked example** with the robot's 62 500: 0 degrees is 8 % = 5000 counts, and 90 degrees is worth 4 % = 2500 counts. For -90 degrees: 5000 - 2500 = 2500 counts.
`,
      fields: [
        { id: "div", label: "Divider for CLKDIV = 5", answer: 32, why: "2 to the power 5 = 32." },
        { id: "tbclk", label: "Counter clock with CLKDIV = 5", unit: "Hz", answer: 1562500, why: "50 MHz / 32 = 1.5625 MHz, one count every 640 ns." },
        { id: "tbprd", label: "TBPRD for a 20 ms period at that clock (round number)", answer: 31250, why: "0.020 s x 1 562 500 counts per second = 31 250 counts. It fits in 16 bits." },
        { id: "servo0", label: "CMPA for 0 degrees", answer: 2500, why: "8 % of 31250 = 2500 counts, a pulse of 1.6 ms." },
        { id: "per90", label: "Counts that 90 degrees is worth", answer: 1250, why: "4 % of 31250 = 1250 counts." },
        { id: "servo45", label: "CMPA for +45 degrees", answer: 3125, why: "45 degrees is half of 90, so 625 counts above the centre: 2500 + 625." },
      ],
      hints: [
        "Divider = 2 to the power CLKDIV. Clock = 50 000 000 / divider. Counts in 20 ms = 0.020 x clock.",
        "The counts in 20 ms are 100 %. 8 % is the centre, and 90 degrees is worth 4 %.",
        "32, 1 562 500, 31 250, 2500, 1250, 3125.",
      ],
      takeaway: "CLKDIV is a code for a power of two. Pick the smallest one that makes the period fit in 16 bits, then every servo number is a percentage of TBPRD.",
    },
    {
      id: "act-servo",
      kind: "code",
      mode: "write",
      title: "An angle on EPWM8A",
      goal: "Set up EPWM8A for an RC servo and write the function that commands an angle.",
      refs: [{ course: "L6-7", slide: [80, 81] }, { course: "HW4" }, { trm: "15.4.3" }, { trm: "15.15.2" }],
      brief: `
Homework 4 connects an RC servo to **GPIO14** of the red homework board. In the pin mux table GPIO14 is **EPWM8A** at index 1. This is the first ePWM you set up from an empty function. The comments in the starter name each register, in the order chapter 9 used for EPWM12.

## init_servo()
- **Clock and period**: \`CLKDIV = 5\` and the \`TBPRD\` for 20 ms from the last level. (The homework lets you choose the divider. Any divider that fits passes here.)
- **Start at 0 degrees**: \`CMPA\` at 8 % of \`TBPRD\`.
- **Actions**: set at zero, clear at \`CMPA\`, as for the LED and the motors.
- **Pin**: pull-up off, then the mux.

## setEPWM8A_RCServo(float angle)
- Saturate \`angle\` to -90..90, with two ifs as in \`setEPWM1A\`.
- Scale: -90 degrees is 4 % of \`TBPRD\`, 0 is 8 %, +90 is 12 %, on a straight line. In counts that is the centre value plus \`angle\` times the counts per degree.

\`main\` is written. It commands 0, 60, -45, 200 and then -200 degrees, 100 ms apart. The meter "RC servo 1" shows where the arm points.
`,
      kit: "redboard",
      durationMs: 500,
      inspect: ["EPwm8Regs.TBCTL", "EPwm8Regs.TBPRD", "EPwm8Regs.CMPA"],
      starter: `void init_servo(void);
void setEPWM8A_RCServo(float angle);

void main(void)
{
${INIT}

    init_servo();

    setEPWM8A_RCServo(0.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(60.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(-45.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(200.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(-200.0);

    while (1) {
    }
}

// EPWM8A on GPIO14: 50 Hz, 0 degrees
void init_servo(void)
{
    // 1. TBCTL fields: CTRMODE (count up), FREE_SOFT (free run),
    //    PHSEN = 0, CLKDIV

    // 2. TBCTR = 0, then TBPRD: the counts in 20 ms

    // 3. CMPA.bit.CMPA: 8 % of TBPRD

    // 4. AQCTLA fields: ZRO (set) and CAU (clear)

    // 5. Pull-up of GPIO14 off (GPAPUD, inside EALLOW ... EDIS),
    //    then the pin mux

}

// angle in degrees, -90 to 90
void setEPWM8A_RCServo(float angle)
{
    // Saturate angle, then write CMPA

}
`,
      solution: `void init_servo(void);
void setEPWM8A_RCServo(float angle);

void main(void)
{
${INIT}

    init_servo();

    setEPWM8A_RCServo(0.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(60.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(-45.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(200.0);
    DELAY_US(100000);
    setEPWM8A_RCServo(-200.0);

    while (1) {
    }
}

// EPWM8A on GPIO14: 50 Hz, 0 degrees
void init_servo(void)
{
${SERVO_A_INIT}

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO14 = 1;  // pull-up off on a PWM pin
    EDIS;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);  // EPWM8A
}

// angle in degrees, -90 to 90
${SET_SERVO_A}
`,
      checks: [
        { kind: "reg", reg: "EPwm8Regs.TBCTL", field: "CTRMODE", equals: 0, label: "The counter of EPWM8 is running (count up)", hint: "After reset the counter is frozen. EPwm8Regs.TBCTL.bit.CTRMODE = 0; starts it." },
        { kind: "reg", reg: "EPwm8Regs.AQCTLA", field: "ZRO", equals: 2, label: "The pin is set when the counter is zero", hint: "EPwm8Regs.AQCTLA.bit.ZRO = 2;" },
        { kind: "reg", reg: "EPwm8Regs.AQCTLA", field: "CAU", equals: 1, label: "The pin is cleared when the counter reaches CMPA", hint: "EPwm8Regs.AQCTLA.bit.CAU = 1;" },
        { kind: "no-diagnostic", code: "pwm-mux", label: "EPWM8A is connected to GPIO14", hint: "GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);" },
        { kind: "signal", name: "SERVO1_DEG", at: 95, equals: 0, tol: 0.1, label: "The servo starts at 0 degrees", hint: "No value at all: the servo saw no pulse that repeats every 20 ms. With CLKDIV = 5 (the code 5, not 32), TBPRD is 31250. A million does not fit in TBPRD: only its low 16 bits are kept. At -90 degrees: CMPA is far too small. It is a count, 8 % of TBPRD, not the number 8." },
        { kind: "signal", name: "SERVO1_DEG", at: 195, equals: 60, tol: 0.1, label: "60 degrees", hint: "90 degrees is worth 4 % of TBPRD, 1250 counts. Write 1250.0 / 90.0: with whole numbers, 1250 / 90 is cut off to 13 and every angle comes out too small." },
        { kind: "signal", name: "SERVO1_DEG", at: 295, equals: -45, tol: 0.1, label: "-45 degrees", hint: "A negative angle must give fewer counts than the centre: centre + angle x counts per degree." },
        { kind: "signal", name: "SERVO1_DEG", at: 395, equals: 90, tol: 0.1, label: "200 degrees is saturated to 90", hint: "Limit angle to -90..90 before you scale it." },
        {
          kind: "duty",
          pin: 14,
          pct: 12,
          tolPct: 0.2,
          from: 320,
          to: 400,
          label: "and the pulse itself stops at 12 %",
          hint: "The servo's arm stops at its mechanical end, but a pulse wider than 12 % pushes against it. Saturate angle in the function.",
        },
        { kind: "signal", name: "SERVO1_DEG", at: 495, equals: -90, tol: 0.1, label: "-200 degrees is saturated to -90", hint: "The lower limit needs its own if: below -90 becomes -90." },
        {
          kind: "duty",
          pin: 14,
          pct: 4,
          tolPct: 0.2,
          from: 420,
          to: 500,
          label: "and the pulse stops at 4 %",
          hint: "Without the lower limit, -200 degrees gives a negative count. CMPA has no sign, so it wraps around to a huge number.",
        },
      ],
      hints: [
        "Each line is EPwm8Regs. and a register from the comments. The given init_EPWM1and2 function of the motor levels is the same list for EPWM1: copy its shape and change the numbers.",
        "20 ms at 1.5625 MHz is 31250 counts. 8 % of that is 2500 counts. 4 % is 1250 counts, and that is what 90 degrees is worth.",
        "EPwm8Regs.CMPA.bit.CMPA = 2500 + angle * 1250.0 / 90.0; after the two saturation ifs.",
      ],
      takeaway: "Same peripheral, different numbers: a slow clock for the 20 ms period, and a compare value that only ever moves between 4 % and 12 %.",
    },
    {
      id: "act-toggle",
      kind: "timing",
      title: "A square wave without CMPA",
      goal: "Draw the buzzer output when the action qualifier toggles the pin once per tooth of the counter.",
      refs: [{ course: "L6-7", slide: 82 }, { course: "HW3" }, { trm: "15.6.2" }, { trm: "15.6.5" }],
      brief: `
For the buzzer you want a square wave whose **frequency** changes, always at 50 % duty. \`CMPA\` is not needed for that. The action qualifier gets one action only: **toggle** the pin (flip it to the other level) at one event that happens once per tooth of the counter. In an \`AQCTLA\` field, 0 is "do nothing", 1 is clear, 2 is set and 3 is toggle.

Here the event is "counter = TBPRD", the top of the tooth. Its field in \`AQCTLA\` is called \`PRD\`:

- \`AQCTLA.PRD = 3\`: toggle
- every other field 0: do nothing

Draw the result. Here \`TBPRD = 3\`, so one tooth of the counter is four counts. The grey row marks where the counter equals \`TBPRD\`. The pin starts low, and it changes **in** the marked slot.

Homework 3 asks which values of \`CAU\` and \`ZRO\` give a square wave. The idea is the same, with another event.
`,
      slots: ["0", "1", "2", "3", "0", "1", "2", "3", "0", "1", "2", "3", "0", "1", "2", "3"],
      rows: [
        {
          name: "counter = TBPRD",
          editable: false,
          initial: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
          answer: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
        {
          name: "EPWM9A (GPIO16)",
          editable: true,
          initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          answer: [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0],
        },
      ],
      hints: [
        "Toggle means: change to the other level, and keep it until the next toggle.",
        "The first marked slot takes the pin high. It stays high for four slots, until the next marked slot takes it low.",
        "Low, low, low, then high for four slots, low for four, high for four, and low in the last slot.",
      ],
      takeaway:
        "One period of the square wave takes two teeth of the counter. That is why a note's TBPRD is the counter clock divided by two and by the frequency. By the reference manual a tooth is TBPRD + 1 counts, so each note is flat by a few thousandths of a percent, which nobody hears.",
    },
    {
      id: "act-buzzer",
      kind: "code",
      mode: "complete",
      title: "A scale on the buzzer",
      goal: "Complete the EPWM9A set-up for the buzzer and play a scale by changing TBPRD from a timer interrupt.",
      refs: [{ course: "L6-7", slide: [82, 83] }, { course: "HW3" }, { trm: "15.6.2" }, { trm: "15.4.3" }],
      brief: `
The piezo buzzer is on **EPWM9A**, **GPIO16** (mux index 5), as in homework 3. The set-up is the one for EPWM12 with three changes:

- \`CLKDIV\` must divide by **4**. \`CLKDIV\` holds a code, not the divider: the code for divide by 4 is 2. The note values below are computed for that clock. (The homework's table is for another divider.)
- \`AQCTLA\`: **toggle** at the period event and nothing else, as in the timing puzzle. That gives a square wave whose half period is one tooth of the counter.
- \`CMPA\` is not used at all.

A note is then one number in \`TBPRD\`:

\`\`\`c
#define A4NOTE ((uint16_t)(((50000000/4)/2)/440.00))
\`\`\`

Read it from the inside out: 50 MHz, divided by 4 by \`CLKDIV\`, divided by 2 because a full square wave takes two teeth, divided by the frequency. For A4 that is 14204.5. The cast \`(uint16_t)\` cuts it to the whole number 14204 that \`TBPRD\` can hold.

\`OFFNOTE\` is 0: with \`TBPRD = 0\` the pin toggles far above anything the buzzer or your ear can follow, which is silence.

## Task
1. Fix the four \`???\` lines.
2. In \`cpu_timer1_isr\`, which runs every **50 ms**, write the next entry of \`song\` to \`TBPRD\` and advance \`noteIndex\`. Stop advancing at the end of the array.

CPU timer 1 is set up for you. It goes straight to the CPU and not through the PIE, so its function needs no \`PIEACK\` line.

Homework 3 plays its song at 125 ms per note. 50 ms keeps this test short.
`,
      kit: "redboard",
      durationMs: 620,
      watch: ["noteIndex"],
      inspect: ["EPwm9Regs.TBCTL", "EPwm9Regs.TBPRD", "EPwm9Regs.AQCTLA"],
      starter: `${FREQ}

${NOTES}

#define SONG_LENGTH 9
uint16_t song[SONG_LENGTH] = {
    C4NOTE, D4NOTE, E4NOTE, F4NOTE, G4NOTE, A4NOTE, B4NOTE, C5NOTE, OFFNOTE
};
uint16_t noteIndex = 0;

__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

    EPwm9Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm9Regs.TBCTL.bit.FREE_SOFT = 2;   // free run
    EPwm9Regs.TBCTL.bit.PHSEN = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 0;      // ??? divide by 4
    EPwm9Regs.TBCTR = 0;
    EPwm9Regs.TBPRD = OFFNOTE;
    EPwm9Regs.AQCTLA.bit.CAU = 1;        // ??? what to do when CMPA is reached
    EPwm9Regs.AQCTLA.bit.PRD = 0;        // ??? what to do when the counter equals TBPRD
    EPwm9Regs.TBPHS.bit.TBPHS = 0;

    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 0);  // ??? EPWM9A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO16 = 1;
    EDIS;

${PIE_INIT}

${TIMER1(50000)}

    while (1) {
    }
}

// Called every 50 ms. Timer 1 needs no PIEACK line.
__interrupt void cpu_timer1_isr(void)
{
    // Write song[noteIndex] to TBPRD and move on, until the song is over

}
`,
      solution: `${FREQ}

${NOTES}

#define SONG_LENGTH 9
uint16_t song[SONG_LENGTH] = {
    C4NOTE, D4NOTE, E4NOTE, F4NOTE, G4NOTE, A4NOTE, B4NOTE, C5NOTE, OFFNOTE
};
uint16_t noteIndex = 0;

__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

    EPwm9Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm9Regs.TBCTL.bit.FREE_SOFT = 2;   // free run
    EPwm9Regs.TBCTL.bit.PHSEN = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 2;      // divide by 4
    EPwm9Regs.TBCTR = 0;
    EPwm9Regs.TBPRD = OFFNOTE;
    EPwm9Regs.AQCTLA.bit.CAU = 0;        // nothing when CMPA is reached
    EPwm9Regs.AQCTLA.bit.PRD = 3;        // toggle when the counter equals TBPRD
    EPwm9Regs.TBPHS.bit.TBPHS = 0;

    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 5);  // EPWM9A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO16 = 1;
    EDIS;

${PIE_INIT}

${TIMER1(50000)}

    while (1) {
    }
}

// Called every 50 ms
__interrupt void cpu_timer1_isr(void)
{
    if (noteIndex < SONG_LENGTH) {
        EPwm9Regs.TBPRD = song[noteIndex];
        noteIndex++;
    }
}
`,
      checks: [
        { kind: "signal", name: "BUZZER_HZ", at: 95, equals: 261.63, tol: 0.5, label: "The first note is C4, 261.6 Hz", hint: "0 Hz: the toggle action (PRD = 3) or the pin mux is missing, or the timer function writes nothing yet. Four times too high: CLKDIV still divides by 1. Four times too low: CLKDIV is a code, and the code for divide by 4 is 2. Twice too high: CAU still has an action, so the pin changes twice per tooth." },
        { kind: "signal", name: "BUZZER_HZ", at: 195, equals: 329.63, tol: 0.5, label: "The third note is E4, 329.6 Hz", hint: "Write song[noteIndex] to TBPRD and add 1 to noteIndex on every call." },
        { kind: "signal", name: "BUZZER_HZ", at: 445, equals: 523.25, tol: 0.5, label: "The eighth note is C5, 523.3 Hz", hint: "If the first note is right and this one is not, noteIndex does not go up by exactly 1 per call." },
        { kind: "signal", name: "BUZZER_HZ", at: 610, equals: 0, label: "The buzzer is silent after the scale", hint: "The last entry of song is OFFNOTE. It must be written too, and nothing after it." },
        { kind: "var", name: "noteIndex", equals: 9, label: "noteIndex stops at the end of the song", hint: "Only write and advance while noteIndex is less than SONG_LENGTH." },
        { kind: "duty", pin: 16, pct: 50, tolPct: 1, from: 60, to: 95, label: "The tone is a square wave with 50 % duty", hint: "One toggle per tooth always gives 50 %. Anything else means a second action is still set: CAU must be 0." },
        { kind: "no-diagnostic", code: "array-bounds", label: "Nothing is read past the end of song", hint: "song[noteIndex] must be inside the if that tests noteIndex < SONG_LENGTH." },
      ],
      hints: [
        "CLKDIV is a code for a power of two: 0 is /1, 1 is /2, 2 is /4. Toggle is action 3. GPIO16 carries EPWM9A at mux index 5.",
        "CAU = 0 and PRD = 3. The function needs two lines inside an if.",
        "if (noteIndex < SONG_LENGTH) { EPwm9Regs.TBPRD = song[noteIndex]; noteIndex++; }",
      ],
      takeaway: "For a tone the duty cycle is fixed and the period carries the information: the mirror image of the LED and the motor.",
    },
    {
      id: "act-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Bench test",
      goal: "Ramp both motors back and forth from a timer interrupt, show the power on LED1, and stop while PB1 is held.",
      refs: [{ course: "L6-7", slide: 77 }, { course: "Lab 3" }, { course: "Lab 2" }, { trm: "15.5" }],
      brief: `
Lab 3 ends its PWM part with the robot on the bench stand, wheels in the air, both motors sweeping slowly from full forward to full reverse. Build that, with a stop button and a power light.

\`cpu_timer0_isr\` runs every **1 ms**. In it:

1. **Ramp.** Keep the command in the global \`float u\`. Add **0.1** per call until it reaches 10, then subtract 0.1 per call until it reaches -10, and repeat. Limit \`u\` to -10..10. Keep the direction in \`updown\` (1: going up, 0: going down), as in the breathing LED of chapter 9. (Lab 3 uses 0.005 per call. 0.1 keeps the test short.)
2. **Stop button.** While **PB1** (GPIO157, reads 0 when pressed) is held, send a command of **0** to both motors and **do not change** \`u\`. When PB1 is released the ramp continues from where it was.
3. **Motors.** Send the command to both motors so that both wheels drive the robot **forward** for a positive command. The right motor is mounted mirrored. Put the sign at the call.
4. **Power light.** Set LED1's brightness to the size of the command being sent: 0 % at 0, 100 % at 10 or -10. \`fabs(x)\` gives the size of a float without its sign: \`fabs(-3.5)\` is 3.5. \`TBPRD\` of EPWM12 is 5000, so a size of 10 must give 5000 counts.
5. Acknowledge the interrupt.

Also write \`setEPWM1A\` and \`setEPWM2A\`. All set-up code is written.
`,
      kit: "robot",
      durationMs: 652,
      watch: ["u", "updown"],
      inspect: ["EPwm1Regs.CMPA", "EPwm2Regs.CMPA", "EPwm12Regs.CMPA"],
      stimuli: [
        { at: 420.5, press: "PB1" },
        { at: 600.5, release: "PB1" },
      ],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float u = 0;          // motor command, -10 to 10
int16_t updown = 1;   // 1: u going up, 0: going down

void main(void)
{
${INIT}

    init_EPWM1and2();

${PWM12}

${BUTTONS}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {
    }
}

void setEPWM1A(float controleffort)
{
}

void setEPWM2A(float controleffort)
{
}

// Called every 1 ms
__interrupt void cpu_timer0_isr(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${INIT_MOTORS()}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float u = 0;          // motor command, -10 to 10
int16_t updown = 1;   // 1: u going up, 0: going down

void main(void)
{
${INIT}

    init_EPWM1and2();

${PWM12}

${BUTTONS}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {
    }
}

${setEpwm(1)}

${setEpwm(2)}

// Called every 1 ms
__interrupt void cpu_timer0_isr(void)
{
    float command = 0;

    if (GpioDataRegs.GPEDAT.bit.GPIO157 != 0) {
        // PB1 is not pressed: move the ramp
        if (updown == 1) {
            u = u + 0.1;
            if (u >= 10.0) {
                u = 10.0;
                updown = 0;
            }
        } else {
            u = u - 0.1;
            if (u <= -10.0) {
                u = -10.0;
                updown = 1;
            }
        }
        command = u;
    }

    setEPWM1A(command);
    setEPWM2A(-command);   // the right motor is mounted mirrored
    EPwm12Regs.CMPA.bit.CMPA = fabs(command) * 500.0;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${INIT_MOTORS()}
`,
      checks: [
        { kind: "var", name: "u", at: 50.5, min: 4.9, max: 5.1, label: "After 50 ms u is 5", hint: "Add 0.1 to u on every call while updown is 1. If u stops at 0.1, the function ran only once: keep the PIEACK line at its end." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 105, min: 8, label: "The left wheel drives forward on the way up", hint: "Write setEPWM1A (it is empty in the starter) and call it with the command on every pass." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 105, min: 8, label: "The right wheel drives forward too", hint: "The right motor needs the opposite sign: setEPWM2A(-command)." },
        { kind: "duty", led: "LED1", pct: 98, tolPct: 3, from: 96, to: 104, label: "LED1 is brightest when u is near 10", hint: "EPwm12Regs.CMPA.bit.CMPA must be 5000 when the size of the command is 10: size x 500." },
        { kind: "var", name: "u", at: 150.5, min: 4.8, max: 5.2, label: "After 150 ms u is on its way down, at 5" },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 320, max: -12, label: "The left wheel drives backward around u = -10", hint: "After reaching 10, u must come down by 0.1 per call until -10, and updown must flip at both ends." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 320, max: -12, label: "The right wheel drives backward too" },
        { kind: "duty", pin: 0, pct: 50, tolPct: 0.5, from: 440, to: 590, label: "PB1 held: EPWM1A at 50 %", hint: "While GPIO157 reads 0, send 0 to both motors." },
        { kind: "duty", pin: 2, pct: 50, tolPct: 0.5, from: 440, to: 590, label: "PB1 held: EPWM2A at 50 %" },
        { kind: "duty", led: "LED1", pct: 0, tolPct: 1, from: 440, to: 590, label: "PB1 held: LED1 is dark", hint: "The light shows the command you send, which is 0 while PB1 is held, not u." },
        { kind: "var", name: "u", at: 590, min: 1.5, max: 2.5, label: "u is frozen while PB1 is held", hint: "Do not move the ramp while the button is pressed." },
        { kind: "var", name: "u", at: 650.5, min: 6.5, max: 7.5, label: "The ramp continues after PB1 is released" },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "No compare value goes above its period", hint: "A negative brightness wraps around to a huge count. Take fabs() of the command before scaling it for LED1." },
      ],
      hints: [
        "Use a local float for the command that is actually sent. It is u normally and 0 while PB1 is held.",
        "Only run the ramp code when GpioDataRegs.GPEDAT.bit.GPIO157 is not 0. Clamp u to exactly 10 or -10 when it gets there.",
        "setEPWM1A(command); setEPWM2A(-command); EPwm12Regs.CMPA.bit.CMPA = fabs(command) * 500.0;",
      ],
      takeaway:
        "A timer interrupt that computes a command and hands it to setEPWM functions is the skeleton of every controller you will write for the robot. Later labs replace the ramp with a control law.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "act-servo-pair",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Two servos, one time base",
      goal: "Add EPWM8B for a second servo and sweep the two servos in opposite directions.",
      refs: [{ course: "L6-7", slide: [67, 80] }, { course: "HW4" }, { trm: "15.5.2" }, { trm: "15.6.2" }],
      brief: `
HW4's second servo is on **GPIO15**, which is **EPWM8B** at mux index 1. A and B are two outputs of the same module:

- They share the counter, so there is **one** \`TBPRD\` and one clock divider for both. Nothing to add there.
- B has its own compare register, \`CMPB\` (\`EPwm8Regs.CMPB.bit.CMPB\`), and its own action register, \`AQCTLB\`.
- In \`AQCTLB\`, the compare event for \`CMPB\` is **CBU**, not CAU. If you write \`AQCTLB.bit.CAU\`, output B is cleared when the counter reaches \`CMPA\`, and both servos get the same pulse.

The figure shows output A as you set it up in the servo level: drag the pulse and watch the arm. Output B gets the same numbers in its own registers.

{{figure:servo-pulse}}

EPWM8A is set up. Add:

1. The EPWM8B lines in \`init_servos()\`: start at 0 degrees, set at zero, clear at \`CMPB\`, pin mux and pull-up for GPIO15.
2. \`setEPWM8B_RCServo(float angle)\`.
3. The sweep in \`cpu_timer0_isr\`, which runs every **20 ms**: add **5** degrees to \`angle\` per call until it reaches 90, then subtract 5 per call until it reaches -90, and repeat. Send \`angle\` to servo A and \`-angle\` to servo B.
`,
      kit: "redboard",
      durationMs: 1200,
      watch: ["angle", "updown"],
      inspect: ["EPwm8Regs.CMPA", "EPwm8Regs.CMPB", "EPwm8Regs.AQCTLB"],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_servos(void);
void setEPWM8A_RCServo(float angle);
void setEPWM8B_RCServo(float angle);

float angle = 0;      // degrees
int16_t updown = 1;   // 1: angle going up, 0: going down

void main(void)
{
${INIT}

    init_servos();

${PIE_INIT}

${TIMER0(20000)}

    while (1) {
    }
}

void init_servos(void)
{
${SERVO_A_INIT}

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO14 = 1;
    EDIS;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);  // EPWM8A

    // EPWM8B on GPIO15

}

${SET_SERVO_A}

void setEPWM8B_RCServo(float angle)
{
}

// Called every 20 ms
__interrupt void cpu_timer0_isr(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_servos(void);
void setEPWM8A_RCServo(float angle);
void setEPWM8B_RCServo(float angle);

float angle = 0;      // degrees
int16_t updown = 1;   // 1: angle going up, 0: going down

void main(void)
{
${INIT}

    init_servos();

${PIE_INIT}

${TIMER0(20000)}

    while (1) {
    }
}

void init_servos(void)
{
${SERVO_A_INIT}

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO14 = 1;
    EDIS;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);  // EPWM8A

    // EPWM8B on GPIO15
    EPwm8Regs.CMPB.bit.CMPB = 2500;      // 8 %: 0 degrees
    EPwm8Regs.AQCTLB.bit.CBU = 1;        // clear at CMPB
    EPwm8Regs.AQCTLB.bit.ZRO = 2;        // set at zero
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO15 = 1;
    EDIS;
    GPIO_SetupPinMux(15, GPIO_MUX_CPU1, 1);  // EPWM8B
}

${SET_SERVO_A}

void setEPWM8B_RCServo(float angle)
{
    if (angle > 90) {
        angle = 90;
    }
    if (angle < -90) {
        angle = -90;
    }
    EPwm8Regs.CMPB.bit.CMPB = 2500 + angle * 1250.0 / 90.0;
}

// Called every 20 ms
__interrupt void cpu_timer0_isr(void)
{
    if (updown == 1) {
        angle = angle + 5;
        if (angle >= 90) {
            updown = 0;
        }
    } else {
        angle = angle - 5;
        if (angle <= -90) {
            updown = 1;
        }
    }
    setEPWM8A_RCServo(angle);
    setEPWM8B_RCServo(-angle);
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "signal", name: "SERVO1_DEG", at: 215, min: 44, max: 51, label: "Servo 1 is near 50 degrees after 210 ms", hint: "Add 5 to angle on every call and pass it to setEPWM8A_RCServo." },
        { kind: "signal", name: "SERVO2_DEG", at: 215, min: -51, max: -44, label: "Servo 2 is near -50 degrees", hint: "Servo 2 needs CMPB, AQCTLB with CBU and ZRO, and GPIO15 at mux index 1." },
        { kind: "signal", name: "SERVO1_DEG", at: 395, min: 84, max: 90.1, label: "Servo 1 has turned around near 90 degrees" },
        { kind: "signal", name: "SERVO1_DEG", at: 595, min: 34, max: 41, label: "Servo 1 is on its way back, near 35 degrees" },
        { kind: "signal", name: "SERVO2_DEG", at: 595, min: -41, max: -34, label: "Servo 2 mirrors it, near -35 degrees" },
        { kind: "signal", name: "SERVO1_DEG", at: 1195, min: -72, max: -58, label: "Servo 1 has turned around again at -90 degrees and is coming back, near -65", hint: "When angle reaches -90, set updown back to 1 and start adding." },
        { kind: "signal", name: "SERVO2_DEG", at: 1195, min: 58, max: 72, label: "Servo 2 mirrors it, near 65 degrees" },
        { kind: "reg", reg: "EPwm8Regs.AQCTLB", field: "CBU", equals: 1, label: "Output B is cleared at CMPB" },
        { kind: "reg", reg: "EPwm8Regs.TBPRD", equals: 31250, label: "The shared period is still 20 ms" },
      ],
      hints: [
        "For B you write CMPB, two AQCTLB fields, the pull-up bit and the pin mux. Do not write TBPRD or TBCTL again.",
        "EPwm8Regs.AQCTLB.bit.CBU = 1; EPwm8Regs.AQCTLB.bit.ZRO = 2; and setEPWM8B_RCServo is setEPWM8A_RCServo with CMPB.",
        "The sweep is the brightness ramp again: add 5 while updown is 1, switch at 90, subtract 5, switch at -90.",
      ],
      takeaway: "One module, one period, two compare values, two pins. Two servos can share a module because they want the same 50 Hz.",
    },
    {
      id: "act-debug-shared",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The second servo broke the first",
      goal: "Fix a set-up in which adding EPWM8B stopped both servos.",
      refs: [{ course: "L6-7", slide: [67, 80] }, { course: "HW4" }, { trm: "15.5.2" }, { trm: "15.4.3" }, { trm: "15.6.3" }],
      brief: `
Servo 1 on EPWM8A worked. Then a second servo was added on EPWM8B by pasting a block from the LED code and changing the names. Now **neither** servo moves.

Servo 1 should be at **0 degrees** and servo 2 at **+45 degrees**.

Things to remember from HW4:

- EPWM8A and EPWM8B must use the same carrier frequency, because there is only **one** \`TBPRD\` (and one \`TBCTL\`) per module. A second write replaces the first.
- A compare value above the period never matches.
- In \`AQCTLB\` the compare event for \`CMPB\` is \`CBU\`.

There are two bugs. The message under the code points at the first.
`,
      kit: "redboard",
      durationMs: 90,
      inspect: ["EPwm8Regs.TBCTL", "EPwm8Regs.TBPRD", "EPwm8Regs.CMPA", "EPwm8Regs.CMPB", "EPwm8Regs.AQCTLB"],
      starter: `void main(void)
{
${INIT}

    // RC servo 1 on EPWM8A (GPIO14): 50 Hz, 0 degrees
${SERVO_A_INIT}

    // RC servo 2 on EPWM8B (GPIO15): pasted from the LED set-up
    EPwm8Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1
    EPwm8Regs.TBPRD = 5000;
    EPwm8Regs.CMPB.bit.CMPB = 500;       // 10 %: +45 degrees
    EPwm8Regs.AQCTLB.bit.CAU = 1;        // clear at the compare match
    EPwm8Regs.AQCTLB.bit.ZRO = 2;        // set at zero

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO14 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO15 = 1;
    EDIS;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);  // EPWM8A
    GPIO_SetupPinMux(15, GPIO_MUX_CPU1, 1);  // EPWM8B

    while (1) {
    }
}
`,
      solution: `void main(void)
{
${INIT}

    // RC servo 1 on EPWM8A (GPIO14): 50 Hz, 0 degrees
${SERVO_A_INIT}

    // RC servo 2 on EPWM8B (GPIO15): same time base, its own compare
    EPwm8Regs.CMPB.bit.CMPB = 3125;      // 10 % of 31250: +45 degrees
    EPwm8Regs.AQCTLB.bit.CBU = 1;        // clear at CMPB
    EPwm8Regs.AQCTLB.bit.ZRO = 2;        // set at zero

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO14 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO15 = 1;
    EDIS;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);  // EPWM8A
    GPIO_SetupPinMux(15, GPIO_MUX_CPU1, 1);  // EPWM8B

    while (1) {
    }
}
`,
      checks: [
        { kind: "signal", name: "SERVO1_DEG", equals: 0, tol: 0.1, label: "Servo 1 is at 0 degrees", hint: "Both outputs share TBPRD and CLKDIV. The pasted block changed them for servo 1 as well." },
        { kind: "signal", name: "SERVO2_DEG", equals: 45, tol: 0.1, label: "Servo 2 is at +45 degrees", hint: "10 % of the shared period of 31250 counts, and the event for CMPB in AQCTLB is CBU." },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "No compare value is above the period" },
      ],
      hints: [
        "Delete what the pasted block has no business setting: the clock divider and the period belong to the whole module.",
        "With the period back at 31250, 10 % is 3125 counts, not 500.",
        "EPwm8Regs.CMPB.bit.CMPB = 3125; EPwm8Regs.AQCTLB.bit.CBU = 1; EPwm8Regs.AQCTLB.bit.ZRO = 2;",
      ],
      takeaway:
        "A and B of one module can differ in duty cycle, never in frequency. Two signals with different frequencies need two modules, which is why the buzzer has EPWM9 to itself.",
    },

    // ---------------------------------------------------------------- expert
    {
      id: "act-x-melody",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Play it, then be quiet",
      goal: "Play a melody on the buzzer from a timer interrupt, and hand the pin back to GPIO when it ends.",
      refs: [{ course: "L6-7", slide: [82, 83] }, { course: "HW3" }, { trm: "15.6.2" }, { trm: "15.4.2" }, { trm: "8.7" }],
      brief: `
A whole song player from an empty \`main\`, as homework 3 asks for with its own song and clock. The note values and the song are given.

The figure is the set-up you completed in the buzzer level. Pick a note and press "Hear it".

{{figure:buzzer-tone}}

## Requirements
- The buzzer is on GPIO16, EPWM9A. The note values assume a clock divider of 4, as in the buzzer level.
- CPU Timer 1 interrupts every **40 ms**. Its function must be called \`cpu_timer1_isr\`.
- The first call starts \`songarray[0]\`. Every call after that starts the next note. Before the first call the buzzer is silent.
- On the call after the last note, do what HW3 asks for at the end of the song: make GPIO16 a plain **GPIO output** again and drive it **low**, so the buzzer cannot make random noise.

## Things that will bite
- Timer 1 does not go through the PIE.
- \`TBPRD\` is loaded from its shadow register when the counter is next at zero. You do not have to do anything about that, but it is why a note never starts with a cut-off first cycle.
- After the song the function keeps being called unless you stop it.
`,
      kit: "redboard",
      durationMs: 580,
      watch: ["noteIndex"],
      inspect: ["EPwm9Regs.TBPRD", "EPwm9Regs.TBCTL", "GpioCtrlRegs.GPAGMUX2", "GpioCtrlRegs.GPAMUX2"],
      starter: `${FREQ}

${NOTES}

#define SONG_LENGTH 12
uint16_t songarray[SONG_LENGTH] = {
    E4NOTE, OFFNOTE, E4NOTE, F4NOTE, G4NOTE, OFFNOTE,
    G4NOTE, F4NOTE, E4NOTE, D4NOTE, C4NOTE, C5NOTE
};
uint16_t noteIndex = 0;

__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

    while (1) {
    }
}

__interrupt void cpu_timer1_isr(void)
{
}
`,
      solution: `${FREQ}

${NOTES}

#define SONG_LENGTH 12
uint16_t songarray[SONG_LENGTH] = {
    E4NOTE, OFFNOTE, E4NOTE, F4NOTE, G4NOTE, OFFNOTE,
    G4NOTE, F4NOTE, E4NOTE, D4NOTE, C4NOTE, C5NOTE
};
uint16_t noteIndex = 0;

__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

    EPwm9Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm9Regs.TBCTL.bit.FREE_SOFT = 2;   // free run
    EPwm9Regs.TBCTL.bit.PHSEN = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 2;      // divide by 4
    EPwm9Regs.TBCTR = 0;
    EPwm9Regs.TBPRD = OFFNOTE;
    EPwm9Regs.AQCTLA.bit.CAU = 0;        // CMPA is not used
    EPwm9Regs.AQCTLA.bit.PRD = 3;        // toggle at the period event
    EPwm9Regs.TBPHS.bit.TBPHS = 0;

    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 5);  // EPWM9A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO16 = 1;
    EDIS;

${PIE_INIT}

${TIMER1(40000)}

    while (1) {
    }
}

__interrupt void cpu_timer1_isr(void)
{
    if (noteIndex < SONG_LENGTH) {
        EPwm9Regs.TBPRD = songarray[noteIndex];
        noteIndex++;
    } else {
        // Song over: GPIO16 is a GPIO again, driven low
        GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(16, GPIO_OUTPUT, GPIO_PUSHPULL);
        GpioDataRegs.GPACLEAR.bit.GPIO16 = 1;
        CpuTimer1Regs.TCR.bit.TSS = 1;   // stop the timer
    }
}
`,
      checks: [
        { kind: "signal", name: "BUZZER_HZ", at: 30, equals: 0, label: "Silent before the first note" },
        { kind: "signal", name: "BUZZER_HZ", at: 75, equals: 329.63, tol: 0.5, label: "Note 1 is E4, 329.6 Hz", hint: "The clock divider and toggle action of the buzzer level, GPIO16 at mux index 5, and TBPRD = songarray[noteIndex] in the timer function." },
        { kind: "signal", name: "BUZZER_HZ", at: 118, equals: 0, label: "Note 2 is a rest" },
        { kind: "signal", name: "BUZZER_HZ", at: 235, equals: 392.0, tol: 0.5, label: "Note 5 is G4, 392 Hz" },
        { kind: "signal", name: "BUZZER_HZ", at: 475, equals: 261.63, tol: 0.5, label: "Note 11 is C4, 261.6 Hz" },
        { kind: "signal", name: "BUZZER_HZ", at: 515, equals: 523.25, tol: 0.5, label: "Note 12 is C5, 523.3 Hz" },
        { kind: "signal", name: "BUZZER_HZ", at: 579, equals: 0, label: "Silent after the song" },
        { kind: "pin", pin: 16, at: 575, level: 0, label: "GPIO16 is low after the song" },
        { kind: "reg", reg: "GpioCtrlRegs.GPAGMUX2", field: "GPIO16", equals: 0, label: "GPIO16 is a GPIO again", hint: "GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 0); then make it an output and clear it." },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", field: "GPIO16", equals: 1, label: "GPIO16 is an output" },
        { kind: "no-diagnostic", code: "array-bounds", label: "Nothing is read past the end of songarray", hint: "Read songarray[noteIndex] only while noteIndex is below SONG_LENGTH." },
      ],
      bonus: [{ kind: "isr", fn: "cpu_timer1_isr", max: 13, label: "The timer is stopped once the song is over", hint: "CpuTimer1Regs.TCR.bit.TSS = 1; stops the timer." }],
      hints: [
        "Three parts: the EPWM9 set-up from the buzzer level, Timer 1 on INT13 (vector, ConfigCpuTimer, TCR, IER, EINT), and the function.",
        "In the function: while noteIndex is below SONG_LENGTH write the note and advance. Otherwise give the pin back.",
        "GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(16, GPIO_OUTPUT, GPIO_PUSHPULL); GpioDataRegs.GPACLEAR.bit.GPIO16 = 1;",
      ],
      takeaway: "The pin mux can change while the program runs. Taking a pin away from a peripheral and driving it yourself is the sure way to make an output quiet.",
    },
    {
      id: "act-x-slew",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "No sudden moves",
      goal: "Write a ramp limiter so the motor command changes by at most 0.05 per millisecond and lands exactly on its target.",
      refs: [{ course: "Lab 3" }, { trm: "15.5" }],
      brief: `
Jumping a motor from stop to full power draws a large current and jerks the gears. A **ramp limiter** (also called a slew-rate limiter) sits between the command you want and the command you send, and lets the sent command change only so fast.

## Requirements
\`cpu_timer0_isr\` runs every **1 ms**. In it:

- Choose the **target**: **8** while PB1 (GPIO157) is held, **-8** while PB2 (GPIO158) is held, **0** otherwise. If both are held, PB1 wins.
- Move the global \`float u\` towards the target by **at most 0.05** per call.
- \`u\` must **land exactly on the target** and stay there. It must not step past it and it must not hover around it. Floats do not add up exactly, so "is u equal to the target" is not the test to use. Ask whether the remaining distance is smaller than one step.
- Send \`u\` to both motors so both wheels drive forward for positive \`u\`.

\`setEPWM1A\`, \`setEPWM2A\` and the set-up are written.
`,
      kit: "robot",
      durationMs: 770,
      watch: ["u"],
      inspect: ["EPwm1Regs.CMPA", "EPwm2Regs.CMPA"],
      stimuli: [
        { at: 20.5, press: "PB1" },
        { at: 255.5, press: "PB2" },
        { at: 285.5, release: "PB2" },
        { at: 300.5, release: "PB1" },
        { at: 400.5, press: "PB2" },
        { at: 600.5, release: "PB2" },
      ],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float u = 0;   // command sent to the motors, -10 to 10

void main(void)
{
${INIT}

    init_EPWM1and2();

${BUTTONS}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {
    }
}

// Called every 1 ms
__interrupt void cpu_timer0_isr(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${setEpwm(1)}

${setEpwm(2)}

${INIT_MOTORS()}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);

float u = 0;   // command sent to the motors, -10 to 10

void main(void)
{
${INIT}

    init_EPWM1and2();

${BUTTONS}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {
    }
}

// Called every 1 ms
__interrupt void cpu_timer0_isr(void)
{
    float target = 0;
    float error;

    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
        target = 8.0;
    } else if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0) {
        target = -8.0;
    }

    error = target - u;
    if (error > 0.05) {
        u = u + 0.05;
    } else if (error < -0.05) {
        u = u - 0.05;
    } else {
        u = target;   // closer than one step: land on it
    }

    setEPWM1A(u);
    setEPWM2A(-u);   // the right motor is mounted mirrored

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

${setEpwm(1)}

${setEpwm(2)}

${INIT_MOTORS()}
`,
      checks: [
        { kind: "var", name: "u", at: 21.6, min: 0.04, max: 0.06, label: "The first step after PB1 is pressed is 0.05", hint: "u may change by at most 0.05 per call." },
        { kind: "var", name: "u", at: 100.6, min: 3.9, max: 4.1, label: "After 80 ms u has ramped to 4" },
        { kind: "var", name: "u", at: 250, equals: 8, label: "u lands exactly on 8 and stays", hint: "When the distance to the target is at most one step, set u = target." },
        { kind: "var", name: "u", at: 284, equals: 8, label: "PB2 pressed as well: PB1 wins and u stays at 8", hint: "Test PB1 first, and PB2 in the else branch." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 295, min: 22, label: "The left wheel runs forward" },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 295, min: 22, label: "The right wheel runs forward" },
        { kind: "var", name: "u", at: 380.6, min: 3.9, max: 4.1, label: "After release u ramps down, not to 0 at once" },
        { kind: "var", name: "u", at: 600.4, min: -7.1, max: -6.9, label: "PB2 takes u through zero towards -8 at the same rate" },
        { kind: "var", name: "u", at: 700.6, min: -2.1, max: -1.9, label: "After release u ramps back up" },
        { kind: "var", name: "u", at: 765, equals: 0, label: "u lands exactly on 0", hint: "If u ends at a tiny value like 1e-7 or keeps flipping between 0.05 and 0, the landing test is missing." },
        { kind: "duty", pin: 0, pct: 50, tolPct: 0.1, from: 750, to: 770, label: "EPWM1A is back at exactly 50 %" },
      ],
      hints: [
        "Compute error = target - u once. Its sign tells you the direction, its size whether a full step still fits.",
        "Three cases: error above 0.05, error below -0.05, and everything in between.",
        "if (error > 0.05) u = u + 0.05; else if (error < -0.05) u = u - 0.05; else u = target;",
      ],
      takeaway: "Limit the rate, then clamp onto the target. The same three-way test is how you saturate anything that moves in steps without overshooting.",
    },
    {
      id: "act-x-tone",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Any frequency",
      goal: "Write tone(hz), which picks the clock divider and period itself so that low notes fit in 16 bits and high notes keep their resolution.",
      refs: [{ course: "L6-7", slide: [82, 83] }, { course: "HW3" }, { trm: "15.4.3" }, { trm: "15.15.2" }, { trm: "15.4.2" }],
      brief: `
A note table works for one clock divider. With a divide by 4 the lowest note that fits in the 16-bit \`TBPRD\` is about 95 Hz, and the higher the divider, the coarser the pitch. Write a function that plays **any** frequency.

\`\`\`c
void tone(float hz);
\`\`\`

- \`hz\` of 0 (or less) is silence. Follow the course: \`TBPRD = 0\`.
- Otherwise the buzzer on EPWM9A (GPIO16) must sound at \`hz\`. The output toggles once per tooth of the counter, so one period of the tone is two teeth.
- Use the **smallest** \`CLKDIV\` for which the period fits in \`TBPRD\`. A smaller divider means more counts per period and a more accurate pitch.

## What you need
- The counter clock is 50 MHz divided by 2 to the power \`CLKDIV\`, for \`CLKDIV\` = 0 to 7: 50, 25, 12.5 ... 0.39 MHz.
- One tooth is TBPRD + 1 counts. Do it exactly this time.
- \`TBPRD\` is at most 65535.

\`main\` is written. It also sets up nothing: the EPWM9 set-up is yours, in \`init_buzzer()\`.
`,
      kit: "redboard",
      durationMs: 230,
      inspect: ["EPwm9Regs.TBCTL", "EPwm9Regs.TBPRD"],
      starter: `void init_buzzer(void);
void tone(float hz);

void main(void)
{
${INIT}

    init_buzzer();

    tone(440.0);
    DELAY_US(60000);
    tone(55.0);
    DELAY_US(100000);
    tone(4000.0);
    DELAY_US(40000);
    tone(0.0);

    while (1) {
    }
}

// EPWM9A on GPIO16, silent
void init_buzzer(void)
{
}

void tone(float hz)
{
}
`,
      solution: `void init_buzzer(void);
void tone(float hz);

void main(void)
{
${INIT}

    init_buzzer();

    tone(440.0);
    DELAY_US(60000);
    tone(55.0);
    DELAY_US(100000);
    tone(4000.0);
    DELAY_US(40000);
    tone(0.0);

    while (1) {
    }
}

// EPWM9A on GPIO16, silent
void init_buzzer(void)
{
    EPwm9Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm9Regs.TBCTL.bit.FREE_SOFT = 2;   // free run
    EPwm9Regs.TBCTL.bit.PHSEN = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 0;
    EPwm9Regs.TBCTR = 0;
    EPwm9Regs.TBPRD = 0;                 // silent
    EPwm9Regs.AQCTLA.bit.PRD = 3;        // toggle at the period event
    EPwm9Regs.TBPHS.bit.TBPHS = 0;

    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 5);  // EPWM9A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO16 = 1;
    EDIS;
}

void tone(float hz)
{
    uint16_t div = 0;
    float counts;

    if (hz <= 0) {
        EPwm9Regs.TBPRD = 0;
    } else {
        // Counts of the 50 MHz clock in half a period of the tone
        counts = 25000000.0 / hz;
        // Halve the clock until one tooth fits in 16 bits
        while (counts > 65536.0 && div < 7) {
            counts = counts / 2.0;
            div++;
        }
        EPwm9Regs.TBCTL.bit.CLKDIV = div;
        EPwm9Regs.TBPRD = counts - 1.0;
    }
}
`,
      checks: [
        { kind: "signal", name: "BUZZER_HZ", at: 55, equals: 440, tol: 0.2, label: "440 Hz", hint: "Half a period is 25 000 000 / hz counts at 50 MHz, and TBPRD is one less." },
        { kind: "reg", reg: "EPwm9Regs.TBCTL", field: "CLKDIV", at: 55, equals: 0, label: "440 Hz fits without a divider: CLKDIV = 0" },
        { kind: "signal", name: "BUZZER_HZ", at: 155, equals: 55, tol: 0.1, label: "55 Hz", hint: "25 000 000 / 55 is 454 545 counts: too many for TBPRD. Halve the clock until it fits." },
        { kind: "reg", reg: "EPwm9Regs.TBCTL", field: "CLKDIV", at: 155, equals: 3, label: "55 Hz needs a divide by 8: CLKDIV = 3" },
        { kind: "signal", name: "BUZZER_HZ", at: 195, equals: 4000, tol: 0.3, label: "4000 Hz, exactly", hint: "3999.4 Hz: one tooth is TBPRD + 1 counts, so TBPRD is the count minus 1." },
        { kind: "reg", reg: "EPwm9Regs.TBCTL", field: "CLKDIV", at: 195, equals: 0, label: "Back to CLKDIV = 0 for a high note" },
        { kind: "signal", name: "BUZZER_HZ", at: 229, equals: 0, label: "tone(0) is silence" },
      ],
      hints: [
        "Start with the number of 50 MHz counts in half a period. If it is more than 65536, halve it and add 1 to the divider code. Repeat.",
        "A loop: while (counts > 65536.0 && div < 7) { counts = counts / 2.0; div++; }",
        "Then EPwm9Regs.TBCTL.bit.CLKDIV = div; and EPwm9Regs.TBPRD = counts - 1.0;",
      ],
      takeaway:
        "CLKDIV trades range for resolution. Choosing it at run time gives you both: any note from a few hertz up, each with as many counts as 16 bits allow.",
    },
  ],
};
