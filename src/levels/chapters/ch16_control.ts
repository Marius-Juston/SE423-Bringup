import type { Chapter } from "../types";

// Chapter 16 runs on the test bench robot of src/sim/plugins/plant.ts:
// each wheel is a first-order system (time constant 60 ms, 0.25 ft/s per
// unit of effort) with Coulomb friction (0.8 effort) and effort limits of
// +-10. The numbers in the briefs and checks follow from those constants.

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const LED1 = `    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
`;

/** A complete program whose 1 ms timer 0 interrupt runs `isr`. */
const prog = (globals: string, isr: string, opts: { setup?: string; functions?: string } = {}) => `${FREQ}

__interrupt void cpu_timer0_isr(void);

${globals.trim()}
${opts.functions ? `\n${opts.functions.trim()}\n` : ""}
void main(void)
{
    InitSysCtrl();
    InitGpio();
${opts.setup ? `\n${opts.setup}` : ""}
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    // Timer 0 interrupts every 1 ms (1000 microseconds)
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

// Runs every 1 ms
__interrupt void cpu_timer0_isr(void)
{
${isr.replace(/^\n+|\s+$/g, "")}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

/** Two-line reminder for the levels after the briefing, which describes the bench in full. */
const BENCH_NOTE = `
**Bench reminder:** \`tb_left_speed()\` and \`tb_right_speed()\` return ft/s. \`tb_set_effort(uLeft, uRight)\` takes efforts from -10 to 10.
`;

const PI_GLOBALS = `float vref = 1.0;    // reference speed, ft/s
float Kp = 8.0;
float Ki = 100.0;
float vLeft = 0;     // measured speed, ft/s
float eLeft = 0;     // error
float ILeft = 0;     // integral of the error
float uLeft = 0;     // control effort, -10 to 10`;

const SAT = `    if (uLeft > 10.0) uLeft = 10.0;
    if (uLeft < -10.0) uLeft = -10.0;`;

const WINDUP_GLOBALS = `${PI_GLOBALS}
float INew = 0;      // tentative integral, stored in ILeft only if anti-windup allows it
uint32_t numTimer0calls = 0;`;

const WINDUP_REF = `    // The reference: 3 ft/s for 2 seconds (faster than the robot can go), then 1 ft/s
    numTimer0calls++;
    if (numTimer0calls < 2000) {
        vref = 3.0;
    } else {
        vref = 1.0;
    }
`;

const TWO_WHEEL_GLOBALS = `float vref = 1.0;    // reference speed of both wheels, ft/s
float turn = 0.0;    // turn command: asks for vLeft - vRight, ft/s (0: straight)
float Kp = 8.0;
float Ki = 100.0;
float Kturn = 3.0;
float vLeft = 0;
float vRight = 0;
float eSteer = 0;
float eLeft = 0;
float eRight = 0;
float ILeft = 0;
float IRight = 0;
float INew = 0;      // tentative integral
float uLeft = 0;
float uRight = 0;
uint32_t numTimer0calls = 0;`;

const TWO_WHEEL_REF = `    // The test: straight at 1 ft/s, then from 4 s on slower and turning right
    numTimer0calls++;
    if (numTimer0calls >= 4000) {
        vref = 0.6;
        turn = 0.35;
    }
`;

/** Lecture 11's anti-windup for one wheel: keep the new integral unless it pushes further into the limit. */
const clampedPI = (w: "Left" | "Right") => `    INew = I${w} + e${w} * 0.001;
    u${w} = Kp * e${w} + Ki * INew;
    if (u${w} > 10.0) {
        u${w} = 10.0;
        if (e${w} < 0.0) I${w} = INew;
    } else if (u${w} < -10.0) {
        u${w} = -10.0;
        if (e${w} > 0.0) I${w} = INew;
    } else {
        I${w} = INew;
    }`;

export const ch16: Chapter = {
  id: "control",
  number: 16,
  title: "Feedback control",
  blurb: "Measure, compare, correct: PI speed control, anti-windup, friction compensation and steering.",
  requires: ["interrupts"],
  course: ["L11", "Lab 5"],
  levels: [
    {
      id: "ctl-brief",
      kind: "brief",
      title: "Closing the loop",
      goal: "Learn what feedback is, what the P, I and D terms do, and meet the test bench robot.",
      refs: [{ course: "L11" }, { course: "Lab 5" }, { course: "Lab 3" }],
      brief: `
In Lab 3 you sent a control effort to a motor and the wheel turned at some speed. Which speed depends on the battery, the friction and the floor. Sending a command and hoping is **open loop** control.

**Closed loop** control (feedback) measures what happened and corrects the command, again and again:

- **Reference** \`r\`: what you want (a wheel speed of 1 ft/s).
- **Measurement** \`y\`: what you have (the speed from the encoder).
- **Error** \`e = r - y\`: how far off you are. Positive means "too slow".
- **Control effort** \`u\`: what you send to the motor. In this course it is a number from **-10 to 10**.

In the figure, put a load on the wheel in open loop, then in closed loop.

{{figure:feedback-loop}}

## PID
The most common controller adds up to three terms: **u = Kp e + Ki (integral of e) + Kd (de/dt)**

- **P** (proportional): push harder the further you are off. Fast, but on its own it leaves an error.
- **I** (integral): add up the error over time. While any error is left the sum keeps growing, so the effort grows until the error is gone.
- **D** (derivative): react to how fast the error changes. It damps overshoot but amplifies measurement noise.

The robot's wheel speeds are controlled with **PI**: no D term.

## In C
The controller runs in a timer interrupt every 1 ms: **measure, compare, compute, saturate, actuate**.

\`\`\`c
vLeft = tb_left_speed();              // measure
eLeft = vref - vLeft;                 // compare
ILeft = ILeft + eLeft * 0.001;        // integral: add error x time step (s)
uLeft = Kp * eLeft + Ki * ILeft;      // compute
if (uLeft > 10.0) uLeft = 10.0;       // saturate
if (uLeft < -10.0) uLeft = -10.0;
tb_set_effort(uLeft, uLeft);          // actuate
\`\`\`

\`ILeft\` must be a **global** variable: it has to survive from one interrupt to the next.

## The test bench
The \`tb_\` functions belong to a test bench robot built into the simulator. On the real robot your encoder code and \`setEPWM1A\` / \`setEPWM2A\` from Lab 3 do these jobs.

- \`tb_left_speed()\`, \`tb_right_speed()\`: wheel speeds in ft/s.
- \`tb_set_effort(uLeft, uRight)\`: the two efforts. Anything beyond -10 ... 10 is cut off, as in \`setEPWM1A\`.

Each wheel needs an effort of **0.8** just to start turning (friction). Every unit above that adds **0.25 ft/s**: steady speed = 0.25 x (u - 0.8). It gets there with a time constant of 60 ms, not at once.
`,
      questions: [
        {
          prompt: "The reference is 1.0 ft/s and the wheel turns at 1.2 ft/s. What is the error e = r - y?",
          options: ["0.2 ft/s", "2.2 ft/s", "-0.2 ft/s", "1.2 ft/s"],
          answer: 2,
          why: "e = 1.0 - 1.2 = -0.2. A negative error means the wheel is too fast, so the controller lowers the effort.",
        },
        {
          prompt: "Why must the integral be kept in a global variable?",
          options: [
            "Global variables are computed faster",
            "It has to keep its value between two runs of the interrupt function",
            "Local variables cannot be float",
            "The timer resets local variables to the reference",
          ],
          answer: 1,
          why: "A local variable is created again on every call. The integral is a running sum over all the past calls, so it must live outside the function (or be a static local).",
        },
        {
          prompt: "Which term makes the effort keep growing for as long as a small error remains?",
          options: ["The proportional term", "The derivative term", "The saturation", "The integral term"],
          answer: 3,
          why: "The integral adds the error up. A small constant error gives a steadily growing sum, so the effort rises until the error reaches zero.",
        },
      ],
      takeaway: "Feedback is a loop: measure, compare with the reference, compute an effort, limit it, send it. Every 1 ms.",
    },
    {
      id: "ctl-pcalc",
      kind: "calc",
      title: "What P alone can do",
      goal: "Compute the error and effort of a P controller, the error it leaves, and what the integrator must hold.",
      refs: [{ course: "L11" }],
      brief: `
A **P controller** is one line: \`u = Kp * e\`.

On the bench, a wheel settles at **v = 0.25 x (u - 0.8)** ft/s. Turned around: to hold a speed v the wheel needs an effort of **u = 4 v + 0.8**.

## The error P leaves
Suppose the wheel reached the reference exactly. Then e = 0, so u = Kp x 0 = 0, and with no effort the wheel slows down. So it cannot stay there. A P controller settles **below** the reference, at the speed where the effort it produces is exactly the effort that speed needs:

Kp (r - v) = 4 v + 0.8

Solve for v: **v = (Kp r - 0.8) / (Kp + 4)**. What is left, r - v, is the **steady-state error**. A larger Kp makes it smaller, but never zero.

## What the integrator does about it
With a PI controller the wheel does reach the reference. Then e = 0 and the P term gives nothing: the whole effort comes from the integral term, \`Ki * ILeft\`. The integral has "remembered" how much effort the wheel needs.
`,
      fields: [
        { id: "e", label: "Error when r = 1.0 ft/s and the wheel turns at 0.4 ft/s", unit: "ft/s", answer: 0.6, tolPct: 1, why: "e = r - y = 1.0 - 0.4 = 0.6 ft/s." },
        { id: "u", label: "Effort of a P controller with Kp = 4 for that error", answer: 2.4, tolPct: 1, why: "u = Kp e = 4 x 0.6 = 2.4. And 0.25 x (2.4 - 0.8) = 0.4 ft/s: this wheel is already in steady state, 0.6 ft/s too slow." },
        { id: "v", label: "Steady speed with Kp = 12 and r = 1.0 ft/s", unit: "ft/s", answer: 0.7, tolPct: 1, why: "v = (12 x 1.0 - 0.8) / (12 + 4) = 11.2 / 16 = 0.7 ft/s. Check: u = 12 x 0.3 = 3.6 and 0.25 x (3.6 - 0.8) = 0.7." },
        { id: "ess", label: "Steady-state error with Kp = 12 and r = 1.0 ft/s", unit: "ft/s", answer: 0.3, tolPct: 2, why: "1.0 - 0.7 = 0.3 ft/s. Three times the gain of the previous case, and still 30 % too slow." },
        { id: "ui", label: "PI control holding exactly 1.0 ft/s: effort that comes from the integral term", answer: 4.8, tolPct: 1, why: "At 1.0 ft/s the wheel needs 4 x 1.0 + 0.8 = 4.8. The error is zero, so all 4.8 is Ki times the integral." },
        { id: "i", label: "Value of the integral then, with Ki = 100", answer: 0.048, tolPct: 1, why: "Ki x I = 4.8, so I = 4.8 / 100 = 0.048. You will see this number in the next coding levels." },
      ],
      hints: [
        "Error first: reference minus measurement. Then multiply by Kp.",
        "Steady speed of P control: v = (Kp r - 0.8) / (Kp + 4).",
        "For the last two: the effort needed at 1.0 ft/s is 4 x 1.0 + 0.8. Divide it by Ki to get the integral.",
      ],
      takeaway: "P control always leaves an error, because zero error would mean zero effort. The integral supplies the effort that holds the speed when the error is zero.",
    },
    {
      id: "ctl-p",
      kind: "code",
      mode: "complete",
      title: "A P speed controller",
      goal: "Complete a proportional speed controller in the 1 ms timer interrupt.",
      refs: [{ course: "L11" }, { course: "Lab 5" }, { trm: "3.8" }],
      brief: `
Timer 0 already interrupts every 1 ms, and the function measures the left wheel speed. Complete the pass:

1. **Compare**: \`eLeft\` is the reference \`vref\` minus the measured speed \`vLeft\`.
2. **Compute**: \`uLeft\` is \`Kp\` times the error.
3. **Saturate**: limit \`uLeft\` to -10 ... 10 with two \`if\` statements, as in \`setEPWM1A\` of Lab 3.

The last line sends \`uLeft\` to both motors, so the robot drives straight. Keep the variable names: the tests read them.

With \`Kp = 12\` and \`vref = 1.0\` you computed the result in the previous level: the wheel settles at 0.7 ft/s. Watch \`vLeft\` and \`eLeft\`.

After 0.5 s the test adds a load: the wheel needs 1.6 more effort than before. A P controller can only get that effort from a larger error.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 1000,
      stimuli: [{ at: 500, set: "TB_LOAD_LEFT", value: 1.6 }, { at: 500, set: "TB_LOAD_RIGHT", value: 1.6 }],
      starter: prog(
        `float vref = 1.0;    // reference speed, ft/s
float Kp = 12.0;
float vLeft = 0;     // measured speed, ft/s
float eLeft = 0;     // error
float uLeft = 0;     // control effort, -10 to 10`,
        `
    // Measure
    vLeft = tb_left_speed();

    // Compare: the error

    // Compute: the P controller

    // Saturate: keep uLeft between -10 and 10

    // Actuate
    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        `float vref = 1.0;    // reference speed, ft/s
float Kp = 12.0;
float vLeft = 0;     // measured speed, ft/s
float eLeft = 0;     // error
float uLeft = 0;     // control effort, -10 to 10`,
        `
    // Measure
    vLeft = tb_left_speed();

    // Compare: the error
    eLeft = vref - vLeft;

    // Compute: the P controller
    uLeft = Kp * eLeft;

    // Saturate: keep uLeft between -10 and 10
${SAT}

    // Actuate
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "var", name: "uLeft", at: 1.5, min: 9.99, max: 10.01, label: "At the start the effort is limited to 10 (12 x 1.0 would be 12)", hint: "Add `if (uLeft > 10.0) uLeft = 10.0;` and the same for -10." },
        { kind: "signal", name: "TB_VLEFT", at: 490, equals: 0.7, tol: 0.01, label: "The wheel settles at 0.7 ft/s, the speed you computed for Kp = 12", hint: "Much faster or running backwards: check the sign, e = vref - vLeft." },
        { kind: "var", name: "eLeft", at: 490, min: 0.29, max: 0.31, label: "eLeft holds the steady-state error, 0.3 ft/s" },
        { kind: "var", name: "uLeft", at: 490, min: 3.5, max: 3.7, label: "uLeft settles at 12 x 0.3 = 3.6" },
        { kind: "signal", name: "TB_VLEFT", equals: 0.6, tol: 0.01, label: "With the load the wheel drops to 0.6 ft/s", hint: "The effort must come from Kp times the measured error, on every pass." },
        { kind: "var", name: "uLeft", min: 4.7, max: 4.9, label: "The larger error, 0.4, now gives an effort of 4.8" },
      ],
      watch: ["vref", "vLeft", "eLeft", "uLeft"],
      hints: [
        "Three steps are missing between the measurement and tb_set_effort. The briefing of this chapter shows a complete pass.",
        "`eLeft = vref - vLeft;` then `uLeft = Kp * eLeft;`",
        "After those two lines: `if (uLeft > 10.0) uLeft = 10.0;` and `if (uLeft < -10.0) uLeft = -10.0;`",
      ],
      takeaway: "The wheel stops 0.3 ft/s short, exactly as computed, and a load makes it worse. Raising Kp shrinks the error but cannot remove it. That is the integral's job.",
    },
    {
      id: "ctl-pi",
      kind: "code",
      mode: "write",
      title: "PI: no error left",
      goal: "Write a PI speed controller that brings the wheel exactly to the reference.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
Add the integral term to the P controller, and write the whole pass yourself this time:

1. Measure \`vLeft\` and compute \`eLeft\`.
2. Add this pass's error times the time step to the integral \`ILeft\`. The interrupt runs every 1 ms, so the time step is 0.001 s.
3. The effort \`uLeft\` is the P term plus \`Ki\` times the integral.
4. Saturate \`uLeft\` to -10 ... 10.
5. Send it to both motors.

The gains are given: \`Kp = 12\` as before, and \`Ki = 100\`. Keep the variable names.

With P alone this wheel stopped at 0.7 ft/s. Now watch \`eLeft\` go to zero while \`ILeft\` climbs to 0.048: the integral term alone supplies the 4.8 the wheel needs at 1 ft/s.

After 0.8 s the test adds a load of 2. The wheel must come back to 1 ft/s on its own.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 2000,
      stimuli: [{ at: 800, set: "TB_LOAD_LEFT", value: 2 }, { at: 800, set: "TB_LOAD_RIGHT", value: 2 }],
      starter: prog(
        PI_GLOBALS.replace("Kp = 8.0;", "Kp = 12.0;"),
        `
    // Measure, compare, integrate, compute, saturate, actuate
`,
      ),
      solution: prog(
        PI_GLOBALS.replace("Kp = 8.0;", "Kp = 12.0;"),
        `
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    ILeft = ILeft + eLeft * 0.001;
    uLeft = Kp * eLeft + Ki * ILeft;
${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "var", name: "uLeft", at: 1.5, min: 9.99, max: 10.01, label: "At the start the effort is limited to 10 (12 x 1.0 would be 12)", hint: "Limit uLeft to -10 ... 10 after computing it and before tb_set_effort." },
        { kind: "signal", name: "TB_VLEFT", at: 790, equals: 1.0, tol: 0.005, label: "The wheel settles at the reference, 1.0 ft/s", hint: "Stuck below 1.0: the integral term is missing. Racing away: check the sign of the error." },
        { kind: "signal", name: "TB_VRIGHT", at: 790, equals: 1.0, tol: 0.005, label: "The right wheel gets the same effort" },
        { kind: "var", name: "ILeft", at: 790, min: 0.0475, max: 0.0485, label: "ILeft settles at 0.048 (4.8 / Ki)", hint: "The integral is a sum of error x 0.001 s. Without the 0.001 it is 1000 times too large and the loop oscillates." },
        { kind: "signal", name: "TB_VLEFT_PEAK", max: 1.02, label: "The speed does not overshoot", hint: "The integral grows too fast: each pass adds error x 0.001 s." },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.005, label: "With the load of 2 the wheel is back at 1.0 ft/s", hint: "ILeft must be a global that keeps summing the error on every pass." },
        { kind: "var", name: "ILeft", min: 0.0675, max: 0.0685, label: "ILeft has grown to 0.068: the integral found the extra effort (6.8 / Ki)" },
      ],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "Start from the P controller of the previous level and add two things: a line that sums the error, and the Ki term in the effort.",
        "`ILeft = ILeft + eLeft * 0.001;` comes after the error and before the effort.",
        "`uLeft = Kp * eLeft + Ki * ILeft;` then the two saturation ifs, then `tb_set_effort(uLeft, uLeft);`",
      ],
      takeaway: "With an integral term the steady-state error is zero, whatever the friction or the load: the integral grows until the effort is exactly what the wheel needs.",
    },
    {
      id: "ctl-problems",
      kind: "quiz",
      title: "Two real problems",
      goal: "Understand integrator windup and derivative noise before you meet them.",
      refs: [{ course: "L11" }],
      brief: `
On paper PID is one formula. On a real robot two things go wrong.

## Integrator windup
The effort is limited to -10 ... 10. Suppose the reference asks for more than the motor can give: the effort sits at 10, the error stays, and the integral **keeps adding it up**. It "winds up" to a huge value that does nothing useful, because the effort is already at its limit.

The trouble comes later. When the reference becomes reachable again, the huge integral keeps the effort at 10. It only shrinks while the error is negative, so the wheel must stay **too fast for a long time** to unwind it.

The cure is **anti-windup**. The simplest kind is **clamping**: do not add to the integral while the effort is saturated.

See it in the figure: choose "3 ft/s for 2 s (too fast), then 1" and switch the clamping on and off. Then go back to the step and try your own gains.

{{figure:pi-tuner}}

## Derivative noise
The D term uses the slope of the error. A measurement that jitters by 0.01 ft/s from one millisecond to the next has a slope of 0.01 / 0.001 = 10 ft/s per second. The D term multiplies this noise and sends it to the motor.

The cure is to filter the derivative, or to leave the D term out. The robot's speed loops are PI for this reason.
`,
      questions: [
        {
          prompt: "A wheel is held still by hand for 5 s while its PI controller asks for 1 ft/s. What happens to the integral?",
          options: [
            "It stays at zero because the wheel does not move",
            "It stops at 10 because the effort is limited to 10",
            "It grows the whole time, far beyond what the effort limit can use",
            "It becomes negative",
          ],
          answer: 2,
          why: "The error is 1 ft/s for 5 s, so the integral reaches 5. With Ki = 100 that asks for an effort of 500. The limit applies to the effort, not to the integral, unless you add anti-windup.",
        },
        {
          prompt: "The hand lets go. What does the wheel do without anti-windup?",
          options: [
            "It goes straight to 1 ft/s",
            "It runs at full speed for a long time before it comes back to 1 ft/s",
            "It stays still",
            "It turns backwards first",
          ],
          answer: 1,
          why: "The integral only shrinks while the error is negative, that is while the wheel is too fast. It takes seconds of overshoot to bring the integral back down.",
        },
        {
          prompt: "What does clamping anti-windup do?",
          options: [
            "It sets Ki to zero for good",
            "It limits the reference to reachable values",
            "It filters the measurement",
            "It stops adding to the integral while the effort is at its limit",
          ],
          answer: 3,
          why: "While the effort is saturated, integrating more cannot change anything now and only causes trouble later. So the integral is frozen until the effort comes off the limit.",
        },
        {
          prompt: "Why do the robot's speed controllers have no D term?",
          options: [
            "The speed measurement is noisy, and a derivative amplifies noise",
            "A D term would make the steady-state error larger",
            "The processor is too slow to compute a derivative",
            "A D term needs a second encoder",
          ],
          answer: 0,
          why: "Speed from encoder counts jitters from sample to sample. The slope of a jittery signal is large, so the D term would mostly send noise to the motors.",
        },
      ],
      takeaway: "Windup: the integral grows while the effort is stuck at its limit, and you pay for it later. Derivative noise: slopes of jittery signals are large.",
    },
    {
      id: "ctl-windup",
      kind: "code",
      mode: "debug",
      title: "The wheel that would not slow down",
      goal: "Fix integrator windup with clamping: stop integrating while the effort is saturated.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
For the first 2 seconds this program asks for **3 ft/s**. The wheel cannot go faster than 2.3 ft/s, so the effort sits at 10. Then the reference drops to 1 ft/s. (At 2.6 s the test adds a small load, to check that the integral still does its job.)

Run it and watch \`ILeft\` and \`vLeft\`. The wheel should slow down at 2 s. It stays at full speed for almost another second: the integral wound up to about 1.5 (it only needs 0.048) and has to unwind first.

## The fix, as in Lecture 11
The lecture's \`PIControl\` function first computes a **tentative** integral and the effort it would give:

\`\`\`c
INew = ILeft + eLeft * 0.001;         // tentative integral
uLeft = Kp * eLeft + Ki * INew;
\`\`\`

Then it limits \`uLeft\` and decides whether \`INew\` is stored in \`ILeft\`:

- Effort inside the limits: store it.
- Effort beyond a limit, and the error pushes it **further out** (effort and error have the same sign): do not store it. This is the clamping.
- Effort beyond a limit, but the error pulls it **back** (opposite signs): store it, so an integral that is too large can always unwind.

\`INew\` is already declared for you. Change the pass so it follows these rules.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 3600,
      stimuli: [{ at: 2600, set: "TB_LOAD_LEFT", value: 2 }, { at: 2600, set: "TB_LOAD_RIGHT", value: 2 }],
      starter: prog(
        WINDUP_GLOBALS,
        `
${WINDUP_REF}
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    ILeft = ILeft + eLeft * 0.001;
    uLeft = Kp * eLeft + Ki * ILeft;
${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        WINDUP_GLOBALS,
        `
${WINDUP_REF}
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
${clampedPI("Left")}
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT", at: 1990, min: 2.25, label: "While 3 ft/s is asked for, the wheel runs at its top speed (2.3 ft/s)", hint: "The wheel must still try as hard as it can: keep the effort at 10 while the error is large." },
        { kind: "var", name: "ILeft", at: 1990, max: 0.2, label: "The integral has not wound up (ILeft stays below 0.2)", hint: "ILeft reaches 1.5 here. Do not store the new integral while the effort is beyond the limit and the error pushes it further out." },
        { kind: "signal", name: "TB_VLEFT", at: 2300, equals: 1.0, tol: 0.05, label: "0.3 s after the reference drops, the wheel is at 1 ft/s", hint: "Still at full speed: the integral is unwinding. That is windup." },
        { kind: "signal", name: "TB_VLEFT", at: 2590, equals: 1.0, tol: 0.01, label: "The wheel settles at 1.0 ft/s" },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.01, label: "A load of 2 arrives at 2.6 s: the wheel comes back to 1.0 ft/s", hint: "The integral must still work when the effort is inside the limits." },
      ],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "The line `ILeft = ILeft + eLeft * 0.001;` runs on every pass, saturated or not. That is the bug.",
        "Replace it by the two tentative lines of the brief. Then use if / else if / else: above 10, below -10, inside.",
        "`if (uLeft > 10.0) { uLeft = 10.0; if (eLeft < 0.0) ILeft = INew; } else if (uLeft < -10.0) { uLeft = -10.0; if (eLeft > 0.0) ILeft = INew; } else { ILeft = INew; }`",
      ],
      takeaway: "An integrator must know the limits of its actuator. The plain rule \"never integrate while saturated\" (the figure's clamping) passes this test too. The robot library's PIcontrol uses a cruder cure: while the effort is beyond 10 it shrinks its error sum by 1 % every millisecond.",
    },
    {
      id: "ctl-friction",
      kind: "code",
      mode: "complete",
      title: "Friction compensation",
      goal: "Identify the wheel's friction from measurements and add Lab 3's friction compensation to a P controller.",
      refs: [{ course: "Lab 3" }, { course: "L11" }],
      brief: `
A feedback controller waits for an error before it acts. If you already **know** what the motor needs, you can add it to the effort right away. That is **feed-forward**. Lab 3 uses it against friction.

## Identify the friction
Lab 3 has you record the effort the motor needs at several steady speeds and fit a line for each direction. The bench gave these points:

- 0.5 ft/s needs 2.8, 1.0 ft/s needs 4.8, 1.5 ft/s needs 6.8
- -0.5 ft/s needs -2.8, -1.0 ft/s needs -4.8

The **slope** of the line is the viscous friction (it grows with speed): \`Vpos\` forwards, \`Vneg\` backwards. The **intercept**, where the line meets zero speed, is the Coulomb friction (constant, it only depends on the direction): \`Cpos\` and \`Cneg\`. \`Cneg\` is a negative number.

## Compensate
\`\`\`c
if (vLeft > 0.0) {
    uLeft = uLeft + Vpos * vLeft + Cpos;
} else {
    uLeft = uLeft + Vneg * vLeft + Cneg;
}
\`\`\`
This is Lab 3's code. Later labs use only 60 to 80 % of the identified values: friction is never known exactly, and compensating more than 100 % makes the wheel speed up by itself.

## What to do
1. Set \`Vpos\`, \`Cpos\`, \`Vneg\` and \`Cneg\` from the measurements.
2. After the P controller line, add **70 %** of the compensation: multiply both friction terms by 0.7 in that line, not in the four variables.

The reference is 1 ft/s for the first second, then -1 ft/s, so both branches are used. With \`Kp = 12\` alone the wheel reached 0.70 ft/s. With the compensation it reaches 0.89 ft/s: most of the effort no longer has to come from an error. From 0.5 s to 1 s the test adds a load of 1.32, which no friction table knows about: the speed drops to 0.79 ft/s.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 2000,
      stimuli: [{ at: 500, set: "TB_LOAD_LEFT", value: 1.32 }, { at: 500, set: "TB_LOAD_RIGHT", value: 1.32 }, { at: 1000, set: "TB_LOAD_LEFT", value: 0 }, { at: 1000, set: "TB_LOAD_RIGHT", value: 0 }],
      starter: prog(
        `float vref = 1.0;    // reference speed, ft/s
float Kp = 12.0;
float Vpos = 0.0;    // viscous friction, forwards: effort per ft/s
float Cpos = 0.0;    // Coulomb friction, forwards: effort
float Vneg = 0.0;    // viscous friction, backwards
float Cneg = 0.0;    // Coulomb friction, backwards (negative)
float vLeft = 0;
float eLeft = 0;
float uLeft = 0;
uint32_t numTimer0calls = 0;`,
        `
    numTimer0calls++;
    if (numTimer0calls > 1000) {
        vref = -1.0;
    }

    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    uLeft = Kp * eLeft;

    // Friction compensation, 70 %

${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        `float vref = 1.0;    // reference speed, ft/s
float Kp = 12.0;
float Vpos = 4.0;    // viscous friction, forwards: effort per ft/s
float Cpos = 0.8;    // Coulomb friction, forwards: effort
float Vneg = 4.0;    // viscous friction, backwards
float Cneg = -0.8;   // Coulomb friction, backwards (negative)
float vLeft = 0;
float eLeft = 0;
float uLeft = 0;
uint32_t numTimer0calls = 0;`,
        `
    numTimer0calls++;
    if (numTimer0calls > 1000) {
        vref = -1.0;
    }

    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    uLeft = Kp * eLeft;

    // Friction compensation, 70 %
    if (vLeft > 0.0) {
        uLeft = uLeft + 0.7 * (Vpos * vLeft + Cpos);
    } else {
        uLeft = uLeft + 0.7 * (Vneg * vLeft + Cneg);
    }

${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "var", name: "Vpos", min: 3.9, max: 4.1, label: "Vpos is the slope of the forward line: 4 effort per ft/s", hint: "From 0.5 to 1.0 ft/s the effort rises from 2.8 to 4.8: slope = 2.0 / 0.5. Keep the full value in the variable and apply the 0.7 in the compensation line." },
        { kind: "var", name: "Cpos", min: 0.75, max: 0.85, label: "Cpos is the intercept of the forward line: 0.8", hint: "Follow the line back to zero speed: 2.8 - 4 x 0.5." },
        { kind: "var", name: "Cneg", min: -0.85, max: -0.75, label: "Cneg is -0.8" },
        { kind: "signal", name: "TB_VLEFT", at: 490, equals: 0.891, tol: 0.01, label: "Forwards the wheel reaches 0.89 ft/s (0.70 without compensation)", hint: "1.0 ft/s exactly means 100 % compensation: use 70 %. 0.70 means the compensation is not added." },
        { kind: "signal", name: "TB_VLEFT", at: 990, equals: 0.791, tol: 0.01, label: "With the extra load it holds 0.79 ft/s", hint: "The compensation uses the measured speed vLeft, and the P term still does its part." },
        { kind: "signal", name: "TB_VLEFT", equals: -0.891, tol: 0.01, label: "Backwards the wheel reaches -0.89 ft/s", hint: "The backward branch uses Vneg and Cneg, and Cneg is negative." },
      ],
      watch: ["vref", "vLeft", "eLeft", "uLeft"],
      hints: [
        "Slope: effort difference divided by speed difference. Intercept: the effort the line gives at zero speed.",
        "Forward line: slope (4.8 - 2.8) / (1.0 - 0.5), intercept 2.8 - slope x 0.5. The backward line has the same slope and the opposite intercept.",
        "Vpos = 4, Cpos = 0.8, Vneg = 4, Cneg = -0.8. Then `if (vLeft > 0.0) { uLeft = uLeft + 0.7 * (Vpos * vLeft + Cpos); } else { uLeft = uLeft + 0.7 * (Vneg * vLeft + Cneg); }`",
      ],
      takeaway: "Feed-forward supplies what you already know the motor needs; feedback only has to correct the rest. The course's PIcontrol function does both.",
    },
    {
      id: "ctl-steer",
      kind: "calc",
      title: "Speed and steering",
      goal: "Compute the steering error and the two wheel errors of the course's coupled controller, and what a turn command does.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
One PI loop per wheel does not make a robot drive straight. If the right wheel is slowed for a moment, its loop restores the **speed**, but the distance lost is never made up: the robot now points somewhere else. You also want to turn on purpose.

Lab 5 does both with one extra term, the **steering error**. These are the lines of the course's \`PIcontrol\` function (\`SE423Lib.c\`), with this chapter's names:

\`\`\`c
eSteer = vRight - vLeft + turn;
eLeft  = vref - vLeft  + Kturn * eSteer;
eRight = vref - vRight - Kturn * eSteer;
\`\`\`

Each wheel error then goes into that wheel's own PI controller.

- With \`turn = 0\`, \`eSteer\` says how much faster the right wheel is. It is added to the left error and subtracted from the right one, so the slower wheel is pushed and the faster one is held back.
- \`eSteer\` is zero when \`vLeft - vRight = turn\`. So a **positive** \`turn\` asks the left wheel to be faster, and the robot turns to its **right** (clockwise). Slide 22 of Lecture 11 words this the other way round; the code is what runs.

## How much it really turns
A PI loop settles when its error is zero. Set \`eLeft = 0\` and \`eRight = 0\`:

- Add the two lines: the steering terms cancel and **vLeft + vRight = 2 vref**. The average speed is \`vref\`.
- Subtract them: **vLeft - vRight = turn x 2 Kturn / (2 Kturn + 1)**. With \`Kturn = 3\` the wheels differ by 6/7 of \`turn\`.

The bench's wheels are 0.6 ft apart, so the turn rate in rad/s is (vRight - vLeft) / 0.6, counter-clockwise positive.
`,
      fields: [
        { id: "es", label: "vref = 1.0, turn = 0, Kturn = 3. The wheels turn at vLeft = 1.0 and vRight = 0.9 ft/s. eSteer", unit: "ft/s", answer: -0.1, tolPct: 1, why: "eSteer = vRight - vLeft + turn = 0.9 - 1.0 + 0 = -0.1. Negative: the right wheel is behind." },
        { id: "el", label: "eLeft for the same speeds", unit: "ft/s", answer: -0.3, tolPct: 1, why: "eLeft = 1.0 - 1.0 + 3 x (-0.1) = -0.3. The left wheel is at its reference and is still told to slow down, to wait for the right wheel." },
        { id: "er", label: "eRight for the same speeds", unit: "ft/s", answer: 0.4, tolPct: 1, why: "eRight = 1.0 - 0.9 - 3 x (-0.1) = 0.4: four times the error the right wheel's own loop would see." },
        { id: "d", label: "Now turn = 0.7 with vref = 1.0. Settled difference vLeft - vRight", unit: "ft/s", answer: 0.6, tolPct: 1, why: "0.7 x 6 / 7 = 0.6 ft/s." },
        { id: "vl", label: "Settled speed of the left wheel", unit: "ft/s", answer: 1.3, tolPct: 1, why: "The average stays 1.0 and the difference is 0.6: vLeft = 1.3 and vRight = 0.7 ft/s." },
        { id: "w", label: "Turn rate of the robot (counter-clockwise positive)", unit: "rad/s", answer: -1, tolPct: 1, why: "(vRight - vLeft) / 0.6 = -0.6 / 0.6 = -1 rad/s. Negative: clockwise, a turn to the right." },
      ],
      hints: [
        "Put the numbers into the three lines of code, in order. Mind the signs.",
        "For the turn: the difference is turn x 6 / 7, and the two speeds are vref plus and minus half of it.",
        "eSteer = 0.9 - 1.0. Difference = 0.6, so the wheels run at 1.3 and 0.7. Turn rate = (0.7 - 1.3) / 0.6.",
      ],
      takeaway: "One steering error, added to one wheel and subtracted from the other: the average speed follows vref, the difference follows turn. Everything above this controller (wall following, driving to a point) only sets vref and turn.",
    },
    {
      id: "ctl-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: speed and steering",
      goal: "Control both wheels with PI, anti-windup and the steering coupling of Lab 5: straight under load, then a commanded turn.",
      refs: [{ course: "Lab 5" }, { course: "L11" }, { course: "Lab 3" }],
      brief: `
Build the structure of the course's \`PIcontrol\` function. In the 1 ms interrupt, after the lines that are given:

1. Compute \`eSteer\`, \`eLeft\` and \`eRight\` as in the previous level.
2. Two PI controllers with \`Kp\` and \`Ki\`, one per wheel, each with its own integral (\`ILeft\`, \`IRight\`), saturation to -10 ... 10 and anti-windup as in the windup level. \`INew\` is declared for you.
3. \`tb_set_effort(uLeft, uRight);\`
4. **LED1** (GPIO22) shows "at speed": on while **both** wheels are within 0.05 ft/s of \`vref\` (above or below), off otherwise. Use \`GPASET\` and \`GPACLEAR\`. The pin is already set up.

## The test
- **0 to 1 s**: the robot is held back by hand. Both efforts sit at the limit. When it is let go it must not shoot past 1.5 ft/s: that is what the anti-windup is for.
- **1 to 4 s**: straight at 1 ft/s. At 2.5 s the right wheel suddenly needs 4 more units of effort (a cable, a carpet edge). The heading must change by less than 0.02 rad. Without the coupling it changes by 0.07 rad.
- **From 4 s**: the given code sets \`vref = 0.6\` and \`turn = 0.35\`. The wheels must settle 0.3 ft/s apart (6/7 of 0.35) around 0.6 ft/s.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 5500,
      stimuli: [
        { at: 0, set: "TB_LOAD_LEFT", value: 9.5 },
        { at: 0, set: "TB_LOAD_RIGHT", value: 9.5 },
        { at: 1000, set: "TB_LOAD_LEFT", value: 0 },
        { at: 1000, set: "TB_LOAD_RIGHT", value: 0 },
        { at: 2500, set: "TB_LOAD_RIGHT", value: 4 },
      ],
      starter: prog(
        TWO_WHEEL_GLOBALS,
        `
${TWO_WHEEL_REF}
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Steering error and the two wheel errors

    // Left wheel: paste your PI with anti-windup from the windup level here

    // Right wheel: the same block with every Left changed to Right

    tb_set_effort(uLeft, uRight);

    // LED1 on while both wheels are within 0.05 ft/s of vref
`,
        { setup: LED1 },
      ),
      solution: prog(
        TWO_WHEEL_GLOBALS,
        `
${TWO_WHEEL_REF}
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Steering error and the two wheel errors
    eSteer = vRight - vLeft + turn;
    eLeft = vref - vLeft + Kturn * eSteer;
    eRight = vref - vRight - Kturn * eSteer;

    // Left wheel: PI with anti-windup
${clampedPI("Left")}

    // Right wheel: PI with anti-windup
${clampedPI("Right")}

    tb_set_effort(uLeft, uRight);

    // LED1 on while both wheels are within 0.05 ft/s of vref
    if (fabs(vref - vLeft) < 0.05 && fabs(vref - vRight) < 0.05) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }`,
        { setup: LED1 },
      ),
      checks: [
        { kind: "led", led: "LED1", at: 900, on: false, label: "LED1 is off while the robot is held" },
        { kind: "signal", name: "TB_VLEFT_PEAK", at: 2400, max: 1.5, label: "Let go after 1 s, the robot never exceeds 1.5 ft/s", hint: "It shoots up to 2.3 ft/s: the integrals wound up while the robot was held. Add the anti-windup of the windup level to both wheels." },
        { kind: "signal", name: "TB_VLEFT", at: 2400, equals: 1.0, tol: 0.01, label: "Left wheel at 1 ft/s before the load" },
        { kind: "signal", name: "TB_VRIGHT", at: 2400, equals: 1.0, tol: 0.01, label: "Right wheel at 1 ft/s before the load" },
        { kind: "led", led: "LED1", at: 2400, on: true, label: "LED1 is on when both wheels are at speed" },
        { kind: "led", led: "LED1", at: 2507.5, on: false, label: "LED1 goes off when the load slows the right wheel", hint: "The LED needs both wheels: test vLeft and vRight." },
        { kind: "signal", name: "TB_VLEFT", at: 3900, equals: 1.0, tol: 0.01, label: "Left wheel back at 1 ft/s with the load" },
        { kind: "signal", name: "TB_VRIGHT", at: 3900, equals: 1.0, tol: 0.01, label: "Right wheel back at 1 ft/s with the load", hint: "The right wheel now needs 8.8. Its integral has to supply that: each wheel needs its own integral." },
        { kind: "var", name: "IRight", at: 3900, min: 0.085, max: 0.091, label: "IRight holds the effort of the loaded wheel (8.8 / Ki)", hint: "IRight is the integral of eRight: the sum of eRight x 0.001." },
        { kind: "signal", name: "TB_THETA_RAD", at: 3900, min: -0.02, max: 0.02, label: "The heading changed by less than 0.02 rad", hint: "About -0.07 rad: the steering coupling is missing. Wheels running away in opposite directions: check its signs, + Kturn for the left wheel, - Kturn for the right." },
        { kind: "led", led: "LED1", at: 4005.5, on: false, label: "LED1 goes off when vref drops to 0.6 and the wheels are still too fast", hint: "Too fast counts as well: compare the size of the error, fabs(vref - vLeft), with 0.05." },
        { kind: "signal", name: "TB_VLEFT", equals: 0.75, tol: 0.01, label: "In the turn the left wheel settles at 0.75 ft/s", hint: "Both wheels at 0.6: turn is not used in eSteer. Left slower than right: the sign of turn is wrong." },
        { kind: "signal", name: "TB_VRIGHT", equals: 0.45, tol: 0.01, label: "In the turn the right wheel settles at 0.45 ft/s" },
        { kind: "no-dat-write", label: "LED1 is changed through GPASET and GPACLEAR" },
      ],
      bonus: [
        { kind: "signal", name: "TB_VLEFT_PEAK", at: 2400, max: 1.05, label: "No overshoot at all when the robot is let go (at most 1.05 ft/s)", hint: "The library's 1 % leak still overshoots to about 1.25 ft/s. Lecture 11's rule does not." },
      ],
      watch: ["vLeft", "vRight", "eSteer", "ILeft", "IRight", "uLeft", "uRight"],
      hints: [
        "Write one wheel completely, run it, then copy the block for the other wheel and change every Left to Right. The errors the PI blocks use are eLeft and eRight, which already include the steering term.",
        "If you do not have your windup block at hand: `INew = ILeft + eLeft * 0.001; uLeft = Kp * eLeft + Ki * INew;` then `if (uLeft > 10.0) { uLeft = 10.0; if (eLeft < 0.0) ILeft = INew; } else if (uLeft < -10.0) { uLeft = -10.0; if (eLeft > 0.0) ILeft = INew; } else { ILeft = INew; }`",
        "LED: `if (fabs(vref - vLeft) < 0.05 && fabs(vref - vRight) < 0.05) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`",
      ],
      takeaway: "This is the structure of the robot's PIcontrol function: two PI loops, a steering coupling, saturation, anti-windup (the library also adds the friction compensation). Its integral is stored as a plain sum of errors and multiplied by Ki x 0.001, which is the same thing.",
    },
    {
      id: "ctl-loop",
      kind: "order",
      tier: "practice",
      title: "Practice: one pass of the loop",
      goal: "Put the steps of one pass through a PI speed controller in order.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
Timer 0 interrupts every 1 ms and your function runs one pass of the speed controller.

Think about what each step needs:

- You cannot compare before you have measured.
- The integral uses this pass's error.
- The effort is limited **after** it is computed and **before** it is sent: the amplifier only accepts -10 to 10, and your code should know what was really sent.
- The interrupt is acknowledged at the very end, as in every timer 0 function.

Order the steps.
`,
      steps: [
        "Timer 0 reaches zero and cpu_timer0_isr starts",
        "Measure: read the wheel speed",
        "Compare: e = reference - measured speed",
        "Add e x 0.001 to the integral",
        "Compute: u = Kp e + Ki integral",
        "Saturate: limit u to -10 ... 10",
        "Actuate: send u to the motor",
        "Acknowledge the interrupt (PIEACK) and return",
      ],
      hints: [
        "Ask of each step what it needs that another step produces.",
        "The integral needs the error, and the effort needs the integral.",
        "Start, measure, compare, integrate, compute, saturate, actuate, acknowledge.",
      ],
      takeaway: "Measure, compare, compute, saturate, actuate. If you can say it, you can write it.",
    },
    {
      id: "ctl-bugs",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Practice: three slips",
      goal: "Find three classic mistakes in a PI controller: a sign, a time step, and a missing limit.",
      refs: [{ course: "L11" }, { course: "Lab 3" }, { course: "Lab 5" }],
      brief: `
This PI controller should bring the wheel to 1.5 ft/s. Run it: the wheel runs **backwards** at full speed.

There are three mistakes. Fix one, run again, and read what the tests say.

- **A sign.** With the error upside down, a wheel that is too slow gets less effort, so it gets slower, so it gets even less effort. Feedback with the wrong sign does not correct, it runs away. This is called positive feedback, and it is unstable.
- **A time step.** This code was copied from a project whose timer ran every 10 ms. Here the function runs every **1 ms**. The integral adds error x time step, so the wrong time step makes the integral term 10 times stronger than \`Ki\` says. The wheel overshoots and rings.
- **A limit.** The amplifier accepts -10 to 10. \`setEPWM1A\` cuts off anything larger, and so does the bench. But then \`uLeft\` no longer tells you what was really sent. Saturate it in your own code.
`,
      kit: "robot",
      durationMs: 1500,
      starter: prog(
        PI_GLOBALS.replace("vref = 1.0; ", "vref = 1.5; "),
        `
    vLeft = tb_left_speed();
    eLeft = vLeft - vref;
    ILeft = ILeft + eLeft * 0.01;
    uLeft = Kp * eLeft + Ki * ILeft;
    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        PI_GLOBALS.replace("vref = 1.0; ", "vref = 1.5; "),
        `
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    ILeft = ILeft + eLeft * 0.001;
    uLeft = Kp * eLeft + Ki * ILeft;
${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT", equals: 1.5, tol: 0.01, label: "The wheel settles at 1.5 ft/s", hint: "Running backwards at -2.3 ft/s: the error has the wrong sign. It is reference minus measurement." },
        { kind: "var", name: "uLeft", at: 1.5, min: 9.99, max: 10.01, label: "uLeft is limited to 10 at the start (8 x 1.5 would be 12)", hint: "Add the two if statements that keep uLeft between -10 and 10, before tb_set_effort." },
        { kind: "signal", name: "TB_VLEFT_PEAK", max: 1.6, label: "The speed never goes above 1.6 ft/s on the way", hint: "A large overshoot: the integral grows too fast. The function runs every 1 ms, so the time step is 0.001 s." },
        { kind: "var", name: "ILeft", min: 0.067, max: 0.069, label: "ILeft settles at 0.068 (6.8 / Ki)", hint: "Negative: the error is still measurement minus reference, with a second minus sign hiding it somewhere else." },
      ],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "Start with the sign: which way round is the subtraction in the error?",
        "The timer period is 1 ms. Which number in the integral line is the time step in seconds?",
        "`eLeft = vref - vLeft;`, `eLeft * 0.001`, and the two saturation ifs before tb_set_effort.",
      ],
      takeaway: "Wrong sign: the loop runs away. Wrong time step: the gains mean something else than you think. No limit: your variable and the motor disagree.",
    },
    {
      id: "ctl-pcalc2",
      kind: "calc",
      tier: "practice",
      title: "Practice: another gain, another speed",
      goal: "Repeat the steady-state calculations for a faster reference and a higher gain.",
      refs: [{ course: "L11" }],
      brief: `
Same wheel: it settles at v = 0.25 x (u - 0.8), so holding a speed v needs **u = 4 v + 0.8**.

A P controller settles where its effort equals the effort the speed needs:

Kp (r - v) = 4 v + 0.8, so **v = (Kp r - 0.8) / (Kp + 4)**

Now the reference is **1.5 ft/s**.
`,
      fields: [
        { id: "v", label: "Steady speed with Kp = 20 and r = 1.5 ft/s", unit: "ft/s", answer: 1.2167, tolPct: 0.5, why: "v = (20 x 1.5 - 0.8) / (20 + 4) = 29.2 / 24 = 1.2167 ft/s." },
        { id: "u", label: "Effort of the P controller at that speed", answer: 5.667, tolPct: 0.5, why: "u = 20 x (1.5 - 1.2167) = 5.667, which is also 4 x 1.2167 + 0.8." },
        { id: "kp", label: "Kp that leaves an error of exactly 0.1 ft/s at r = 1.5 ft/s", answer: 64, tolPct: 1, why: "At 1.4 ft/s the wheel needs 4 x 1.4 + 0.8 = 6.4. With an error of 0.1 that takes Kp = 6.4 / 0.1 = 64. A gain that high amplifies every bit of measurement noise 64 times." },
        { id: "i", label: "PI control at 1.5 ft/s with Ki = 100: value of the integral", answer: 0.068, tolPct: 1, why: "The wheel needs 4 x 1.5 + 0.8 = 6.8, all of it from the integral term: 6.8 / 100 = 0.068." },
        { id: "max", label: "Fastest speed the wheel can reach (effort 10)", unit: "ft/s", answer: 2.3, tolPct: 1, why: "0.25 x (10 - 0.8) = 2.3 ft/s. A reference above this can never be reached: that is where windup starts." },
      ],
      hints: [
        "Put the numbers into v = (Kp r - 0.8) / (Kp + 4).",
        "For the gain: find the effort needed at 1.4 ft/s, then divide by the error 0.1.",
        "Integral = needed effort / Ki. Top speed = 0.25 x (10 - 0.8).",
      ],
      takeaway: "Shrinking the error with gain alone gets expensive quickly. An integral term does it for free.",
    },
    {
      id: "ctl-turnrate",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: hold a turn rate",
      goal: "Write a PI controller that spins the robot in place at 1 rad/s, measured by the gyro.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
The same controller works for any quantity you can measure and influence. Here it is the robot's **turn rate**.

- Measurement: \`tb_gyro_z()\`, the turn rate in rad/s, counter-clockwise positive.
- Reference: \`wref = 1.0\` rad/s.
- Actuation: to spin in place, the wheels get opposite efforts. Counter-clockwise means right wheel forwards, left wheel backwards: \`tb_set_effort(-uTurn, uTurn)\`.

Write the PI controller with the given gains (\`Kp = 3\`, \`Ki = 40\`), saturation to -10 ... 10 and anti-windup. Use the variables \`wGyro\`, \`eTurn\`, \`ITurn\` and \`uTurn\`.

The wheels are 0.6 ft apart, so at 1 rad/s each wheel runs at 0.3 ft/s, in opposite directions. After 0.8 s the floor gets stickier (each wheel needs 1 more unit of effort): the turn rate must stay at 1 rad/s.
`,
      kit: "robot",
      durationMs: 2000,
      stimuli: [{ at: 800, set: "TB_LOAD_LEFT", value: -1 }, { at: 800, set: "TB_LOAD_RIGHT", value: 1 }],
      starter: prog(
        `float wref = 1.0;    // reference turn rate, rad/s
float Kp = 3.0;
float Ki = 40.0;
float wGyro = 0;     // measured turn rate, rad/s
float eTurn = 0;
float ITurn = 0;
float uTurn = 0;`,
        `
    // PI control of the turn rate
`,
      ),
      solution: prog(
        `float wref = 1.0;    // reference turn rate, rad/s
float Kp = 3.0;
float Ki = 40.0;
float wGyro = 0;     // measured turn rate, rad/s
float eTurn = 0;
float ITurn = 0;
float uTurn = 0;`,
        `
    wGyro = tb_gyro_z();
    eTurn = wref - wGyro;
    uTurn = Kp * eTurn + Ki * (ITurn + eTurn * 0.001);
    if (uTurn > 10.0) {
        uTurn = 10.0;
    } else if (uTurn < -10.0) {
        uTurn = -10.0;
    } else {
        ITurn = ITurn + eTurn * 0.001;
    }
    tb_set_effort(-uTurn, uTurn);`,
      ),
      checks: [
        { kind: "var", name: "wGyro", min: 0.99, max: 1.01, label: "The gyro reads 1 rad/s", hint: "Negative and growing: the efforts are the wrong way round. The right wheel gets +uTurn." },
        { kind: "signal", name: "TB_VRIGHT", equals: 0.3, tol: 0.005, label: "The right wheel runs forwards at 0.3 ft/s" },
        { kind: "signal", name: "TB_VLEFT", equals: -0.3, tol: 0.005, label: "The left wheel runs backwards at 0.3 ft/s" },
        { kind: "signal", name: "TB_X_FT", min: -0.01, max: 0.01, label: "The robot turns on the spot" },
        { kind: "var", name: "uTurn", at: 790, min: 1.95, max: 2.05, label: "uTurn settles at 2.0 (4 x 0.3 + 0.8)" },
        { kind: "var", name: "uTurn", min: 2.95, max: 3.05, label: "On the sticky floor uTurn rises to 3.0 and the turn rate holds" },
      ],
      watch: ["wref", "wGyro", "eTurn", "ITurn", "uTurn"],
      hints: [
        "It is the clamped PI of the windup level with new names: wGyro for the measurement, wref for the reference.",
        "Measure with `wGyro = tb_gyro_z();` and send `tb_set_effort(-uTurn, uTurn);`",
        "`uTurn = Kp * eTurn + Ki * (ITurn + eTurn * 0.001);` then if / else if / else as before, storing the new ITurn only in the else.",
      ],
      takeaway: "A PI controller does not care what it controls. Change the measurement and the actuator, keep the loop.",
    },
    {
      id: "ctl-tune",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: tune to a specification",
      goal: "Choose Kp and Ki so a step to 1 ft/s meets a rise-time, overshoot and settling specification.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
The controller below is complete and correct, but its gains are far too low. Tune it. Change only \`Kp\` and \`Ki\`.

## Specification, for a step from 0 to 1 ft/s
- **Rise**: at least 0.9 ft/s after 60 ms.
- **Overshoot**: the speed never exceeds 1.05 ft/s.
- **Settling**: within 0.02 ft/s of the reference from 250 ms on.

## Manual tuning (Lecture 11)
1. Set \`Ki = 0\`. Raise \`Kp\` until the response is fast. On a real robot you raise it until the wheel starts to oscillate or growl, then halve it.
2. Add \`Ki\` and raise it until the remaining error disappears quickly. Too much \`Ki\` brings overshoot.

## What limits you
- The effort is limited to 10, so the wheel cannot rise faster than its own 60 ms time constant allows at full effort. No gain changes that.
- A large \`Ki\` with a small \`Kp\` overshoots: the integral is still large when the wheel arrives.
- Think about the ratio \`Ki / Kp\`. It sets how quickly the integral takes over from the proportional term. The wheel's time constant is 0.06 s.

The figure runs the same wheel and the same controller: try gains there, then prove them here.

{{figure:pi-tuner}}
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 1000,
      starter: prog(
        PI_GLOBALS.replace("Kp = 8.0;", "Kp = 1.0;").replace("Ki = 100.0;", "Ki = 5.0;"),
        `
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    uLeft = Kp * eLeft + Ki * (ILeft + eLeft * 0.001);
    if (uLeft > 10.0) {
        uLeft = 10.0;
    } else if (uLeft < -10.0) {
        uLeft = -10.0;
    } else {
        ILeft = ILeft + eLeft * 0.001;
    }
    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        PI_GLOBALS.replace("Kp = 8.0;", "Kp = 40.0;").replace("Ki = 100.0;", "Ki = 660.0;"),
        `
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    uLeft = Kp * eLeft + Ki * (ILeft + eLeft * 0.001);
    if (uLeft > 10.0) {
        uLeft = 10.0;
    } else if (uLeft < -10.0) {
        uLeft = -10.0;
    } else {
        ILeft = ILeft + eLeft * 0.001;
    }
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT", at: 60, min: 0.9, label: "Rise: at least 0.9 ft/s after 60 ms", hint: "Too slow: raise Kp. The first milliseconds are all proportional action." },
        { kind: "signal", name: "TB_VLEFT_PEAK", max: 1.05, label: "Overshoot: the speed never exceeds 1.05 ft/s", hint: "Too much Ki for this Kp. Lower Ki or raise Kp." },
        { kind: "signal", name: "TB_VLEFT", at: 250, equals: 1.0, tol: 0.02, label: "Settling: within 0.02 ft/s at 250 ms", hint: "Still creeping up: Ki is too low." },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.005, label: "No steady-state error" },
        { kind: "source", mustMatch: "ILeft\\s*=\\s*ILeft\\s*\\+\\s*eLeft\\s*\\*\\s*0\\.001", label: "The controller itself is unchanged" },
      ],
      bonus: [
        { kind: "signal", name: "TB_VLEFT", at: 45, min: 0.9, label: "0.9 ft/s after only 45 ms" },
        { kind: "signal", name: "TB_VLEFT_PEAK", max: 1.01, label: "Less than 1 % overshoot" },
      ],
      watch: ["vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "With Ki = 0, find a Kp that passes the rise test. The wheel will settle too low: that is expected.",
        "Now add Ki. If Ki / Kp is about 1 / 0.06, the integral takes over at the same pace the wheel responds, and the step looks like a clean first-order rise.",
        "Kp = 40 with Ki around 660 meets every line, including the stars. Kp = 20 with Ki = 330 meets the specification.",
      ],
      takeaway: "Choosing Ki / Kp equal to one over the plant's time constant makes the PI controller cancel the wheel's lag. The loop then responds like a faster first-order system with no overshoot.",
    },
    {
      id: "ctl-backcalc",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: back-calculation anti-windup",
      goal: "Replace clamping by back-calculation: feed the amount of saturation back into the integrator.",
      refs: [{ course: "L11" }],
      brief: `
Clamping freezes the integral while the effort is saturated. **Back-calculation** does something smoother: it measures **how far** the effort is beyond the limit and uses that to pull the integral back.

\`\`\`c
uRaw = Kp * eLeft + Ki * ILeft;      // what the controller wants
uLeft = uRaw limited to -10 ... 10   // what the motor gets
ILeft = ILeft + (eLeft + Kt * (uLeft - uRaw)) * 0.001;
\`\`\`

While the effort is inside the limits, \`uLeft - uRaw\` is zero and this is the ordinary integral. While it is saturated, the extra term is negative (at the upper limit) and works against the error. The integral settles where the two balance:

eLeft + Kt (uLeft - uRaw) = 0

so the controller asks for only a little more than the limit, and comes off the limit quickly when the error changes sign. \`Kt\` is the tracking gain: the larger it is, the tighter the integral is held.

## What to build
The same test as the windup level: 3 ft/s for 2 s (unreachable), then 1 ft/s, and a load of 2 at 2.6 s. Write the pass with back-calculation, using the globals \`uRaw\`, \`uLeft\`, \`ILeft\` and \`Kt = 0.5\`. Do not freeze the integral: no clamping.

## Check your understanding
Before you run it, predict \`ILeft\` during the saturation. The wheel runs at 2.3 ft/s, so the error is 0.7. Balance: 0.7 + 0.5 x (10 - uRaw) = 0 gives uRaw = 11.4. And uRaw = 8 x 0.7 + 100 x ILeft. The test checks this value.
${BENCH_NOTE}`,
      kit: "robot",
      durationMs: 3600,
      stimuli: [{ at: 2600, set: "TB_LOAD_LEFT", value: 2 }, { at: 2600, set: "TB_LOAD_RIGHT", value: 2 }],
      starter: prog(
        `${PI_GLOBALS}
uint32_t numTimer0calls = 0;
float Kt = 0.5;      // tracking gain of the anti-windup
float uRaw = 0;      // effort before the limit`,
        `
${WINDUP_REF}
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;

    // PI with back-calculation anti-windup

    tb_set_effort(uLeft, uLeft);`,
      ),
      solution: prog(
        `${PI_GLOBALS}
uint32_t numTimer0calls = 0;
float Kt = 0.5;      // tracking gain of the anti-windup
float uRaw = 0;      // effort before the limit`,
        `
${WINDUP_REF}
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;

    // PI with back-calculation anti-windup
    uRaw = Kp * eLeft + Ki * ILeft;
    uLeft = uRaw;
${SAT}
    ILeft = ILeft + (eLeft + Kt * (uLeft - uRaw)) * 0.001;

    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT", at: 1990, min: 2.25, label: "While 3 ft/s is asked for, the wheel runs at its top speed" },
        { kind: "var", name: "uRaw", at: 1990, min: 11.3, max: 11.5, label: "During saturation the controller asks for 11.4: error and tracking term balance", hint: "10 exactly: uRaw must be the effort before the limit. Far above: the tracking term Kt * (uLeft - uRaw) is missing from the integral." },
        { kind: "var", name: "ILeft", at: 1990, min: 0.057, max: 0.059, label: "ILeft sits at 0.058 during saturation", hint: "A frozen integral (clamping) stops somewhere else. Let the tracking term find the balance." },
        { kind: "signal", name: "TB_VLEFT", at: 2300, equals: 1.0, tol: 0.05, label: "0.3 s after the reference drops, the wheel is at 1 ft/s" },
        { kind: "signal", name: "TB_VLEFT", at: 2590, equals: 1.0, tol: 0.01, label: "The wheel settles at 1.0 ft/s" },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.01, label: "A load of 2 arrives at 2.6 s: the wheel comes back to 1.0 ft/s", hint: "The integral must still work when the effort is inside the limits." },
      ],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uRaw", "uLeft"],
      hints: [
        "Three lines: the raw effort, the limited copy of it, and the integral update that uses both.",
        "Copy `uRaw` into `uLeft` and apply the two limits to `uLeft` only.",
        "`ILeft = ILeft + (eLeft + Kt * (uLeft - uRaw)) * 0.001;` after the limits.",
      ],
      takeaway: "Clamping is a switch: integrate or not. Back-calculation is a second, small feedback loop around the integrator. It needs one more gain, but it also works when the limit is not in your own code, as long as you can measure what the actuator really did.",
    },
  ],
};
