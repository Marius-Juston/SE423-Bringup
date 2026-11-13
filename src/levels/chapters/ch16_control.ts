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

const BENCH = `
## The test bench
The robot in this chapter is a **test bench** built into the simulator. Its functions start with \`tb_\` so you can tell them from the chip's and the course's own functions. On the real robot the same jobs are done by your encoder code and by \`setEPWM1A\` / \`setEPWM2A\` from Lab 3.

- \`float tb_left_speed(void)\`, \`float tb_right_speed(void)\`: wheel speeds in ft/s.
- \`void tb_set_effort(float uLeft, float uRight)\`: the two control efforts, from -10 to 10. Anything larger is cut off, as in \`setEPWM1A\`.
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
float turn = 0.0;    // wanted vLeft - vRight, ft/s (0: straight)
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
float uLeft = 0;
float uRight = 0;`;

export const ch16: Chapter = {
  id: "control",
  number: 16,
  title: "Feedback control",
  blurb: "Measure, compare, correct: P and PI speed control, saturation and anti-windup.",
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
In Lab 3 you sent a control effort to a motor and the wheel turned at some speed. Which speed? That depends on the battery, the friction and the floor. Sending a command and hoping is **open loop** control.

**Closed loop** control (feedback) measures what actually happened and corrects the command, again and again:

- **Reference** \`r\`: what you want (a wheel speed of 1 ft/s).
- **Measurement** \`y\`: what you have (the speed from the encoder).
- **Error** \`e = r - y\`: how far off you are. Positive means "too slow".
- **Control effort** \`u\`: what you send to the motor. In this course it is always a number from **-10 to 10**.

## PID
The most common controller adds up to three terms:

**u = Kp e + Ki (integral of e) + Kd (de/dt)**

- **P** (proportional): push harder the further you are off. Simple and fast, but on its own it leaves an error (you will compute it).
- **I** (integral): add up the error over time. As long as any error is left, this sum keeps growing, so the effort keeps growing until the error is gone.
- **D** (derivative): react to how fast the error changes. It damps overshoot, but it amplifies measurement noise.

The robot's wheel speeds are controlled with **PI**: no D term.

## In C
The controller runs in a timer interrupt, every 1 ms. Each pass does the same five things: **measure, compare, compute, saturate, actuate**.

\`\`\`c
vLeft = tb_left_speed();              // measure
eLeft = vref - vLeft;                 // compare
ILeft = ILeft + eLeft * 0.001;        // integral: add error x time step
uLeft = Kp * eLeft + Ki * ILeft;      // compute
if (uLeft > 10.0) uLeft = 10.0;       // saturate
if (uLeft < -10.0) uLeft = -10.0;
tb_set_effort(uLeft, uLeft);          // actuate
\`\`\`

The integral is a sum: every 1 ms you add the error times the time step, 0.001 s. \`ILeft\` must be a **global** variable, because it has to survive from one interrupt to the next.
${BENCH}
Each wheel of the bench behaves like a small motor with friction:

- It needs an effort of about **0.8** just to start turning (Coulomb friction).
- Above that, every extra unit of effort adds **0.25 ft/s**: steady speed = 0.25 x (u - 0.8).
- It does not jump to that speed: it gets there with a time constant of 60 ms.
`,
      questions: [
        {
          prompt: "The reference is 1.0 ft/s and the wheel turns at 1.2 ft/s. What is the error e = r - y?",
          options: ["-0.2 ft/s", "0.2 ft/s", "1.2 ft/s", "2.2 ft/s"],
          answer: 0,
          why: "e = 1.0 - 1.2 = -0.2. A negative error means the wheel is too fast, so the controller lowers the effort.",
        },
        {
          prompt: "Why must the integral be kept in a global variable?",
          options: [
            "It has to keep its value between two runs of the interrupt function",
            "Global variables are computed faster",
            "Local variables cannot be float",
            "The timer resets local variables to the reference",
          ],
          answer: 0,
          why: "A local variable is created again on every call. The integral is a running sum over all the past calls, so it must live outside the function (or be a static local).",
        },
        {
          prompt: "Which term makes the effort keep growing for as long as a small error remains?",
          options: ["The integral term", "The proportional term", "The derivative term", "The saturation"],
          answer: 0,
          why: "The integral adds the error up. A small constant error gives a steadily growing sum, so the effort rises until the error reaches zero.",
        },
      ],
      takeaway: "Feedback is a loop: measure, compare with the reference, compute an effort, limit it, send it. Every 1 ms.",
    },
    {
      id: "ctl-loop",
      kind: "order",
      title: "One pass of the loop",
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
        "The five words to remember: measure, compare, compute, saturate, actuate.",
        "The integral needs the error, and the effort needs the integral.",
        "Start, measure, compare, integrate, compute, saturate, actuate, acknowledge.",
      ],
      takeaway: "Measure, compare, compute, saturate, actuate. If you can say it, you can write it.",
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
${BENCH}`,
      kit: "robot",
      durationMs: 500,
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
        { kind: "signal", name: "TB_VLEFT", equals: 0.7, tol: 0.01, label: "The wheel settles at 0.7 ft/s, the speed you computed for Kp = 12", hint: "Much faster or running backwards: check the sign, e = vref - vLeft." },
        { kind: "var", name: "eLeft", min: 0.29, max: 0.31, label: "eLeft holds the steady-state error, 0.3 ft/s" },
        { kind: "var", name: "uLeft", min: 3.5, max: 3.7, label: "uLeft settles at 12 x 0.3 = 3.6" },
      ],
      watch: ["vref", "vLeft", "eLeft", "uLeft"],
      hints: [
        "Three steps are missing between the measurement and tb_set_effort: the error, the effort, the two limits.",
        "`eLeft = vref - vLeft;` then `uLeft = Kp * eLeft;`",
        "After those two lines: `if (uLeft > 10.0) uLeft = 10.0;` and `if (uLeft < -10.0) uLeft = -10.0;`",
      ],
      takeaway: "The wheel stops 0.3 ft/s short, exactly as computed. Raising Kp shrinks the error but cannot remove it. That is the integral's job.",
    },
    {
      id: "ctl-pi",
      kind: "code",
      mode: "write",
      title: "PI: no error left",
      goal: "Write a PI speed controller that brings the wheel exactly to the reference.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
Add the integral term. Write the whole pass yourself this time:

1. Measure \`vLeft\` with \`tb_left_speed()\`.
2. \`eLeft = vref - vLeft\`
3. Add this pass's error times the time step to the integral: \`ILeft = ILeft + eLeft * 0.001\`. The interrupt runs every 1 ms, so the time step is 0.001 s.
4. \`uLeft = Kp * eLeft + Ki * ILeft\`
5. Saturate \`uLeft\` to -10 ... 10.
6. Send it to both motors: \`tb_set_effort(uLeft, uLeft)\`.

The gains are given: \`Kp = 8\`, \`Ki = 100\`. Keep the variable names.

When the wheel has settled, look at the watch list. \`eLeft\` is zero, and \`ILeft\` holds 0.048: the integral term alone supplies the 4.8 the wheel needs at 1 ft/s.
${BENCH}`,
      kit: "robot",
      durationMs: 1500,
      starter: prog(
        PI_GLOBALS,
        `
    // Measure, compare, integrate, compute, saturate, actuate
`,
      ),
      solution: prog(
        PI_GLOBALS,
        `
    vLeft = tb_left_speed();
    eLeft = vref - vLeft;
    ILeft = ILeft + eLeft * 0.001;
    uLeft = Kp * eLeft + Ki * ILeft;
${SAT}
    tb_set_effort(uLeft, uLeft);`,
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.005, label: "The wheel settles at the reference, 1.0 ft/s", hint: "Stuck below 1.0: the integral term is missing. Racing away: check the sign of the error." },
        { kind: "signal", name: "TB_VRIGHT", equals: 1.0, tol: 0.005, label: "The right wheel gets the same effort" },
        { kind: "var", name: "ILeft", min: 0.0475, max: 0.0485, label: "ILeft settles at 0.048 (4.8 / Ki)", hint: "The integral is a sum of error x 0.001 s. Without the 0.001 it is 1000 times too large and the loop oscillates." },
        { kind: "var", name: "uLeft", min: 4.75, max: 4.85, label: "uLeft settles at 4.8, the effort the wheel needs at 1 ft/s" },
        { kind: "var", name: "uLeft", at: 1.5, max: 10.01, label: "The effort is limited to 10" },
        { kind: "signal", name: "TB_VLEFT_PEAK", max: 1.02, label: "The speed does not overshoot", hint: "The integral grows too fast: each pass adds error x 0.001 s." },
      ],
      bonus: [{ kind: "signal", name: "TB_VLEFT", at: 600, equals: 1.0, tol: 0.01, label: "Within 1 % of the reference after 0.6 s" }],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "Start from the P controller of the previous level and add two things: the line that sums the error, and the Ki term in the effort.",
        "`ILeft = ILeft + eLeft * 0.001;` comes after the error and before the effort.",
        "`uLeft = Kp * eLeft + Ki * ILeft;` then the two saturation ifs, then `tb_set_effort(uLeft, uLeft);`",
      ],
      takeaway: "With an integral term the steady-state error is zero, whatever the friction: the integral grows until the effort is exactly what the wheel needs.",
    },
    {
      id: "ctl-bugs",
      kind: "code",
      mode: "debug",
      title: "Three slips",
      goal: "Find three classic mistakes in a PI controller: a sign, a time step, and a missing limit.",
      refs: [{ course: "L11" }, { course: "Lab 3" }, { course: "Lab 5" }],
      brief: `
This PI controller should bring the wheel to 1.5 ft/s. Run it: the wheel runs **backwards** at full speed.

There are three mistakes. Fix one, run again, and read what the tests say.

- **A sign.** With the error upside down, a wheel that is too slow gets less effort, so it gets slower, so it gets even less effort. Feedback with the wrong sign does not correct, it runs away. This is called positive feedback, and it is unstable.
- **A time step.** This code was copied from a project whose timer ran every 10 ms. Here the function runs every **1 ms**. The integral adds error x time step, so the wrong time step makes the integral term 10 times stronger than \`Ki\` says. The wheel overshoots and rings.
- **A limit.** The amplifier accepts -10 to 10. \`setEPWM1A\` cuts off anything larger, and so does the bench. But then \`uLeft\` no longer tells you what was really sent. Saturate it in your own code.
${BENCH}`,
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
        { kind: "var", name: "ILeft", min: 0.067, max: 0.069, label: "ILeft settles at 0.068 (6.8 / Ki)" },
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
      id: "ctl-problems",
      kind: "quiz",
      title: "Two real problems",
      goal: "Understand integrator windup and derivative noise before you meet them.",
      refs: [{ course: "L11" }],
      brief: `
On paper PID is one formula. On a real robot two things go wrong.

## Integrator windup
The effort is limited to -10 ... 10. Suppose the reference asks for more than the motor can give: the effort sits at 10, the error stays, and the integral **keeps adding it up**. It "winds up" to a huge value that does nothing useful, because the effort is already at its limit.

The trouble comes later. When the reference finally becomes reachable, the huge integral keeps the effort at 10. It only shrinks while the error is negative, so the wheel must stay **too fast for a long time** to unwind it. You see a long overshoot.

The simple cure is **clamping**: do not integrate while the effort is saturated.

## Derivative noise
The D term uses the slope of the error. A measurement that jitters by a tiny amount from one millisecond to the next has a huge slope: a jitter of 0.01 ft/s in 0.001 s is a slope of 10 ft/s per second. The D term multiplies this noise and sends it to the motor.

The cure is to filter the derivative, or to leave the D term out. The robot's speed loops are PI for this reason.
`,
      questions: [
        {
          prompt: "A wheel is held still by hand for 5 s while its PI controller asks for 1 ft/s. What happens to the integral?",
          options: [
            "It grows the whole time, far beyond what the effort limit can use",
            "It stays at zero because the wheel does not move",
            "It stops at 10 because the effort is limited to 10",
            "It becomes negative",
          ],
          answer: 0,
          why: "The error is 1 ft/s for 5 s, so the integral reaches 5. With Ki = 100 that asks for an effort of 500. The limit applies to the effort, not to the integral, unless you add anti-windup.",
        },
        {
          prompt: "The hand lets go. What does the wheel do without anti-windup?",
          options: [
            "It runs at full speed for a long time before it comes back to 1 ft/s",
            "It goes straight to 1 ft/s",
            "It stays still",
            "It turns backwards first",
          ],
          answer: 0,
          why: "The integral only shrinks while the error is negative, that is while the wheel is too fast. It takes seconds of overshoot to bring the integral back down.",
        },
        {
          prompt: "What does clamping anti-windup do?",
          options: [
            "It stops adding to the integral while the effort is at its limit",
            "It sets Ki to zero for good",
            "It limits the reference to reachable values",
            "It filters the measurement",
          ],
          answer: 0,
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
For the first 2 seconds this program asks for **3 ft/s**. The wheel cannot go faster than 2.3 ft/s, so the effort sits at 10. Then the reference drops to 1 ft/s.

Run it and look at \`ILeft\` and \`vLeft\`. The wheel should slow down at 2 s. It stays at full speed for almost another second: the integral wound up to 1.5 (it only needs 0.048) and has to unwind first.

## The fix: clamping
Do not add to the integral while the effort is saturated:

\`\`\`c
uLeft = Kp * eLeft + Ki * (ILeft + eLeft * 0.001);   // effort with the new integral
if (uLeft > 10.0) {
    uLeft = 10.0;                    // saturated: ILeft keeps its old value
} else if (uLeft < -10.0) {
    uLeft = -10.0;
} else {
    ILeft = ILeft + eLeft * 0.001;   // not saturated: keep the new integral
}
\`\`\`

The effort is first computed as if the integral had been updated. Only when that effort is inside the limits is the update kept.
${BENCH}`,
      kit: "robot",
      durationMs: 3000,
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
        { kind: "signal", name: "TB_VLEFT", at: 1990, min: 2.25, label: "While 3 ft/s is asked for, the wheel runs at its top speed (2.3 ft/s)", hint: "The wheel must still try as hard as it can: keep the effort at 10 while the error is large." },
        { kind: "var", name: "ILeft", at: 1990, max: 0.2, label: "The integral has not wound up (ILeft stays below 0.2)", hint: "ILeft reaches 1.5 here. Only update it when the effort is inside -10 ... 10." },
        { kind: "signal", name: "TB_VLEFT", at: 2300, equals: 1.0, tol: 0.05, label: "0.3 s after the reference drops, the wheel is at 1 ft/s", hint: "Still at full speed: the integral is unwinding. That is windup." },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.01, label: "The wheel settles at 1.0 ft/s" },
      ],
      watch: ["vref", "vLeft", "eLeft", "ILeft", "uLeft"],
      hints: [
        "The line `ILeft = ILeft + eLeft * 0.001;` runs on every pass, saturated or not. That is the bug.",
        "Compute the effort with the would-be integral, `ILeft + eLeft * 0.001`, without storing it yet.",
        "Use if / else if / else: limit to 10, limit to -10, and only in the final else store `ILeft = ILeft + eLeft * 0.001;`",
      ],
      takeaway: "An integrator must know about the limits of its actuator. Clamping costs three lines and removes a second of runaway.",
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

The **slope** of the line is the viscous friction, \`Vpos\` (forwards) and \`Vneg\` (backwards). The **intercept**, where the line meets zero speed, is the Coulomb friction, \`Cpos\` and \`Cneg\`. \`Cneg\` is a negative number.

## Compensate
\`\`\`c
if (vLeft > 0.0) {
    uLeft = uLeft + Vpos * vLeft + Cpos;
} else {
    uLeft = uLeft + Vneg * vLeft + Cneg;
}
\`\`\`
This is Lab 3's code. The labs after it use only 60 to 80 % of the identified values, because friction is never known exactly and compensating more than 100 % makes the wheel speed up by itself. Use **70 %** here: multiply both friction terms by 0.7.

## What to do
1. Set \`Vpos\`, \`Cpos\`, \`Vneg\` and \`Cneg\` from the measurements.
2. After the P controller line, add 70 % of the friction compensation.

The reference is 1 ft/s for the first second, then -1 ft/s, so both branches are used. With \`Kp = 12\` alone the wheel reached 0.70 ft/s. With the compensation it reaches 0.89 ft/s: most of the effort no longer has to come from an error.
${BENCH}`,
      kit: "robot",
      durationMs: 2000,
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
        { kind: "var", name: "Vpos", min: 3.9, max: 4.1, label: "Vpos is the slope of the forward line: 4 effort per ft/s", hint: "From 0.5 to 1.0 ft/s the effort rises from 2.8 to 4.8: slope = 2.0 / 0.5." },
        { kind: "var", name: "Cpos", min: 0.75, max: 0.85, label: "Cpos is the intercept of the forward line: 0.8", hint: "Follow the line back to zero speed: 2.8 - 4 x 0.5." },
        { kind: "var", name: "Cneg", min: -0.85, max: -0.75, label: "Cneg is -0.8" },
        { kind: "signal", name: "TB_VLEFT", at: 990, equals: 0.891, tol: 0.01, label: "Forwards the wheel reaches 0.89 ft/s (0.70 without compensation)", hint: "1.0 ft/s exactly means 100 % compensation: use 70 %. 0.70 means the compensation is not added." },
        { kind: "signal", name: "TB_VLEFT", equals: -0.891, tol: 0.01, label: "Backwards the wheel reaches -0.89 ft/s", hint: "The backward branch uses Vneg and Cneg, and Cneg is negative." },
      ],
      watch: ["vref", "vLeft", "eLeft", "uLeft"],
      hints: [
        "Slope: effort difference divided by speed difference. Intercept: the effort the line gives at zero speed.",
        "Vpos = 4, Cpos = 0.8, Vneg = 4, Cneg = -0.8.",
        "`if (vLeft > 0.0) { uLeft = uLeft + 0.7 * (Vpos * vLeft + Cpos); } else { uLeft = uLeft + 0.7 * (Vneg * vLeft + Cneg); }`",
      ],
      takeaway: "Feed-forward supplies what you already know the motor needs; feedback only has to correct the rest. The course's PIcontrol function does both.",
    },
    {
      id: "ctl-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: straight ahead, whatever happens",
      goal: "Control both wheels with PI and the steering coupling of Lab 5, so the robot keeps its heading when one wheel is loaded.",
      refs: [{ course: "Lab 5" }, { course: "L11" }, { course: "Lab 3" }],
      brief: `
Two separate speed controllers do not make a robot drive straight. When one wheel meets more resistance it slows down for a moment. Its controller recovers the **speed**, but the distance lost in that moment is never made up, and the robot ends up pointing somewhere else.

Lab 5 couples the two loops with a **steering error**:

\`\`\`c
eSteer = turn + (vRight - vLeft);
eLeft  = vref - vLeft  + Kturn * eSteer;
eRight = vref - vRight - Kturn * eSteer;
\`\`\`

These are the signs of the course's \`PIcontrol\` function. \`turn\` is the wanted difference \`vLeft - vRight\`. With \`turn = 0\`: if the right wheel falls behind, \`eSteer\` is negative, so the left wheel is slowed and the right wheel is pushed. Both wheels now work on the difference.

(A positive \`turn\` makes the left wheel faster, so the robot turns to its right.)

## What to build
In the 1 ms interrupt:

1. Measure both speeds: \`tb_left_speed()\`, \`tb_right_speed()\`.
2. Compute \`eSteer\`, \`eLeft\` and \`eRight\` as above.
3. Two PI controllers with \`Kp\` and \`Ki\`, one per wheel, each with its own integral (\`ILeft\`, \`IRight\`), saturation to -10 ... 10 and **clamping** anti-windup.
4. \`tb_set_effort(uLeft, uRight);\`
5. **LED1** (GPIO22) shows "at speed": on while both wheels are within 0.05 ft/s of \`vref\`, off otherwise. Use \`GPASET\` and \`GPACLEAR\`. The pin is already set up.

## The test
The robot drives at 1 ft/s. After 1.5 s the right wheel suddenly needs 4 more units of effort (a ramp, a cable, a carpet). At the end both wheels must be back at 1 ft/s and the heading must have changed by less than 0.02 rad. Without the coupling it changes by about 0.07 rad.
${BENCH}`,
      kit: "robot",
      durationMs: 3000,
      stimuli: [{ at: 1500, set: "TB_LOAD_RIGHT", value: 4 }],
      starter: prog(
        TWO_WHEEL_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Steering error and the two wheel errors

    // PI with saturation and clamping, left wheel

    // PI with saturation and clamping, right wheel

    tb_set_effort(uLeft, uRight);

    // LED1 on while both wheels are within 0.05 ft/s of vref
`,
        { setup: LED1 },
      ),
      solution: prog(
        TWO_WHEEL_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Steering error and the two wheel errors
    eSteer = turn + (vRight - vLeft);
    eLeft = vref - vLeft + Kturn * eSteer;
    eRight = vref - vRight - Kturn * eSteer;

    // PI with saturation and clamping, left wheel
    uLeft = Kp * eLeft + Ki * (ILeft + eLeft * 0.001);
    if (uLeft > 10.0) {
        uLeft = 10.0;
    } else if (uLeft < -10.0) {
        uLeft = -10.0;
    } else {
        ILeft = ILeft + eLeft * 0.001;
    }

    // PI with saturation and clamping, right wheel
    uRight = Kp * eRight + Ki * (IRight + eRight * 0.001);
    if (uRight > 10.0) {
        uRight = 10.0;
    } else if (uRight < -10.0) {
        uRight = -10.0;
    } else {
        IRight = IRight + eRight * 0.001;
    }

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
        { kind: "led", led: "LED1", at: 5, on: false, label: "LED1 is off while the robot is still speeding up" },
        { kind: "signal", name: "TB_VLEFT", at: 1400, equals: 1.0, tol: 0.01, label: "Left wheel at 1 ft/s before the load" },
        { kind: "signal", name: "TB_VRIGHT", at: 1400, equals: 1.0, tol: 0.01, label: "Right wheel at 1 ft/s before the load" },
        { kind: "led", led: "LED1", at: 1400, on: true, label: "LED1 is on when both wheels are at speed" },
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.01, label: "Left wheel back at 1 ft/s after the load" },
        { kind: "signal", name: "TB_VRIGHT", equals: 1.0, tol: 0.01, label: "Right wheel back at 1 ft/s after the load", hint: "The right wheel now needs 8.8. Its integral has to supply that: each wheel needs its own integral." },
        { kind: "signal", name: "TB_THETA_RAD", min: -0.02, max: 0.02, label: "The heading changed by less than 0.02 rad", hint: "About -0.07 rad: the steering coupling is missing. Larger than before: check its signs, + Kturn for the left wheel, - Kturn for the right." },
        { kind: "var", name: "IRight", min: 0.085, max: 0.091, label: "IRight holds the extra effort (8.8 / Ki)" },
        { kind: "no-dat-write", label: "LED1 is changed through GPASET and GPACLEAR" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 5, label: "One pass of the controller takes less than 5 microseconds" }],
      watch: ["vLeft", "vRight", "eSteer", "ILeft", "IRight", "uLeft", "uRight"],
      hints: [
        "Write one wheel completely (error, clamped PI, limits), test it, then copy it for the other wheel and change every Left to Right.",
        "The clamped PI is the block from the windup level. The errors it uses are eLeft and eRight, which already include the steering term.",
        "LED: `if (fabs(vref - vLeft) < 0.05 && fabs(vref - vRight) < 0.05) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`",
      ],
      takeaway: "This is the structure of the robot's PIcontrol function: two PI loops, a steering coupling, saturation, anti-windup. Everything above it (wall following, navigation) only sets vref and turn.",
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

Write the PI controller with the given gains (\`Kp = 3\`, \`Ki = 40\`), saturation to -10 ... 10 and clamping anti-windup. Use the variables \`wGyro\`, \`eTurn\`, \`ITurn\` and \`uTurn\`.

The wheels are 0.6 ft apart, so at 1 rad/s each wheel runs at 0.3 ft/s, in opposite directions.
`,
      kit: "robot",
      durationMs: 1500,
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
        { kind: "var", name: "uTurn", min: 1.95, max: 2.05, label: "uTurn settles at 2.0 (4 x 0.3 + 0.8)" },
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
${BENCH}`,
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
The same test as the windup level: 3 ft/s for 2 s (unreachable), then 1 ft/s. Write the pass with back-calculation, using the globals \`uRaw\`, \`uLeft\`, \`ILeft\` and \`Kt = 0.5\`. Do not freeze the integral: no clamping.

## Check your understanding
Before you run it, predict \`ILeft\` during the saturation. The wheel runs at 2.3 ft/s, so the error is 0.7. Balance: 0.7 + 0.5 x (10 - uRaw) = 0 gives uRaw = 11.4. And uRaw = 8 x 0.7 + 100 x ILeft. The test checks this value.
${BENCH}`,
      kit: "robot",
      durationMs: 3000,
      starter: prog(
        `${WINDUP_GLOBALS}
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
        `${WINDUP_GLOBALS}
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
        { kind: "signal", name: "TB_VLEFT", equals: 1.0, tol: 0.01, label: "The wheel settles at 1.0 ft/s" },
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
