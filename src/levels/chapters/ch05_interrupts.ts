import type { Chapter } from "../types";

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const INIT = `    InitSysCtrl();
    InitGpio();`;

const out = (pin: number, port: string, level: "SET" | "CLEAR", note: string) => `    // ${note}
    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GP${port}${level}.bit.GPIO${pin} = 1;`;

const LED1 = out(22, "A", "CLEAR", "LED1, off");
const LED2 = out(94, "C", "CLEAR", "LED2, off");
const BLUE = out(31, "A", "SET", "Blue LaunchPad LED, off (it lights when the pin is low)");

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

// Timer 0 through the PIE, as in the course starter.
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

const PB1 = `    // PB1: input with pull-up, reads 0 while pressed
    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);`;

const SLOW_SENSOR = `// Stands for reading a slow sensor. Takes about 2.5 ms. Do not change it.
void read_slow_sensor(void)
{
    uint16_t i;
    for (i = 0; i < 25000; i++) {
        sensorSum += i;
    }
    readings++;
}`;

const JOBS = `// Stands for a control calculation. Takes about 5 ms. Do not change it.
void filter_job(void)
{
    uint16_t i;
    for (i = 0; i < 50000; i++) {
        filterSum += i;
    }
}

// Stands for writing a log entry. Takes about 3 ms. Do not change it.
void log_job(void)
{
    uint16_t i;
    for (i = 0; i < 30000; i++) {
        logSum += i;
    }
}`;

const PRIORITY_MAIN = `void main(void)
{
${INIT}

${LED1}
${LED2}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER2_INT = &cpu_timer2_isr;
    PieVectTable.EMIF_ERROR_INT = &SWI_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 1000);
    ConfigCpuTimer(&CpuTimer2, LAUNCHPAD_CPU_FREQUENCY, 23000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer2Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    IER |= M_INT12;
    IER |= M_INT14;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    PieCtrlRegs.PIEIER12.bit.INTx9 = 1;
    EINT;
    ERTM;

    while (1) {}
}

// Every 1 ms: toggles LED1 and posts the software interrupt on every 20th call
__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    if ((numTimer0calls % 20) == 0) {
        PieCtrlRegs.PIEIFR12.bit.INTx9 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;

const PRIORITY_GLOBALS = `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer2_isr(void);
__interrupt void SWI_isr(void);

uint32_t numTimer0calls = 0;
uint32_t numTimer2calls = 0;
uint32_t numSWIcalls = 0;
uint32_t filterSum = 0;
uint32_t logSum = 0;

${JOBS}`;

export const ch05: Chapter = {
  id: "interrupts",
  number: 5,
  title: "Interrupts",
  blurb: "From a timer flag to your function: PIE, IER, EINT and PIEACK.",
  requires: ["timers", "inputs"],
  course: ["L4", "Lab 1", "Lab 2", "HW2"],
  levels: [
    {
      id: "int-brief",
      kind: "brief",
      title: "Let the hardware call you",
      goal: "Learn what an interrupt is and the path a request takes to reach your function.",
      refs: [{ course: "L4" }, { trm: "3.4.1" }, { trm: "3.4.2" }, { trm: "3.4.3" }, { trm: "3.4.4" }],
      brief: `
So far your code asked the hardware the same question over and over: "has the time passed yet?" That is **polling**. The CPU is busy asking and can do nothing else.

With an **interrupt** the hardware tells the CPU. When the event happens, the CPU pauses what it is doing, runs a function you wrote, and then continues exactly where it stopped. \`main()\` does not call that function. The hardware does.

{{figure:polling-vs-interrupt}}

Try it in the figure: give \`main()\` more work per loop pass and compare how late each version reacts.

## The interrupt function
\`\`\`c
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
\`\`\`
- It takes no parameters and returns nothing: nobody calls it, so nobody can pass or receive a value. It talks to the rest of the program through global variables.
- \`__interrupt\` tells the compiler to save the CPU registers on entry, restore them on exit, and return with the special return-from-interrupt instruction.
- Keep it **short**. While it runs, other interrupts wait.

It is also called an interrupt service routine, **ISR**.

## The path of a request
Many more peripheral signals want the CPU's attention than the CPU has interrupt lines. The **PIE** (Peripheral Interrupt Expansion) block collects the peripheral signals into 12 **groups** of up to 16 **channels**. Group x feeds CPU interrupt INTx. Timer 0 is group 1, channel 7, written **INT1.7**.

A request must pass every gate in this chain:

1. The peripheral raises its request, and the flag bit \`PIEIFRx.y\` is set.
2. \`PIEIERx.y\`, the enable bit for that one channel, must be 1.
3. The group's \`PIEACK\` bit must be 0. When the request passes, the PIE sets this bit to 1, which blocks the whole group until your function clears it.
4. The request sets the CPU flag bit \`IFR.x\`.
5. The CPU enable bit \`IER.x\` must be 1.
6. The global mask \`INTM\` must be 0. \`EINT;\` clears it, \`DINT;\` sets it.
7. The CPU looks up the address of your function in the **vector table** (\`PieVectTable\`) and jumps to it.

Miss one gate and nothing happens. There is no error message, your function just never runs. Most of this chapter is about finding the closed gate.

{{figure:interrupt-path}}

Try it in the figure: let the timer reach zero, see where the request stops, and open that gate with the line of C shown next to it. When the function has run once, let the timer reach zero again.

## What the CPU does on the way in
It saves its state on the stack, clears \`IFR.x\` and \`IER.x\`, **sets INTM** and clears EALLOW. Because INTM is set, an interrupt function is not interrupted by another one unless you allow it. When the function returns, the old state comes back.
`,
      questions: [
        {
          prompt: "Who calls an interrupt function?",
          options: ["`main()`, inside `while(1)`", "The CPU, when the hardware requests it", "`InitPieVectTable()`", "The function calls itself"],
          answer: 1,
          why: "The hardware raises a request, and the CPU pauses the running code and jumps to the function. Your code never calls it.",
        },
        {
          prompt: "Timer 0 requests an interrupt. `IER` has `M_INT1` set and `EINT;` has run, but `PieCtrlRegs.PIEIER1.bit.INTx7` is 0. What happens?",
          options: [
            "The function runs once",
            "The function runs, but late",
            "The flag PIEIFR1.7 is set, and the request stops there",
            "The program stops with an error",
          ],
          answer: 2,
          why: "The flag is latched, but the channel's enable bit is the next gate. It is closed, so the request never reaches the CPU.",
        },
        {
          prompt: "Why must a group 1 interrupt function end with `PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`?",
          options: [
            "To clear the timer's counter",
            "To set INTM again",
            "To return from the function",
            "To let the next group 1 request through",
          ],
          answer: 3,
          why: "The PIE set the group's PIEACK bit when it passed the request on. Until you clear it, group 1 stays blocked.",
        },
      ],
      takeaway: "A request passes PIEIFR, PIEIER, PIEACK, IFR, IER and INTM, then the CPU fetches your function's address from the vector table.",
    },
    {
      id: "int-path",
      kind: "order",
      title: "Follow the request",
      goal: "Put the steps of one timer 0 interrupt in order, from the timer to your function.",
      refs: [{ trm: "3.4.3" }, { course: "L4" }],
      brief: `
Timer 0 has just counted down to zero. Its interrupt is fully enabled and \`cpu_timer0_isr\` is in the vector table.

Timer 0 is PIE group 1, channel 7 (**INT1.7**), so the registers involved are \`PIEIFR1\`, \`PIEIER1\`, bit 1 of \`PIEACK\`, and the INT1 bits of \`IFR\` and \`IER\`.

Order the steps. Think of the signal moving from the peripheral, through the PIE, to the CPU. Only after the CPU has accepted the interrupt does it save its state and look up where to jump.
`,
      steps: [
        "Timer 0 reaches zero and raises its interrupt request",
        "The request is latched in the flag bit PIEIFR1.7",
        "PIEIER1.7 is 1 and the group 1 PIEACK bit is 0: the request passes, and the PIE sets the PIEACK bit",
        "The request is latched in the CPU flag IFR, bit INT1",
        "The IER bit INT1 is 1 and INTM is 0: the CPU accepts the interrupt",
        "The CPU saves its state on the stack, clears the IFR and IER bits for INT1 and sets INTM",
        "The CPU fetches the address stored in PieVectTable.TIMER0_INT, and PIEIFR1.7 is cleared",
        "cpu_timer0_isr runs and ends by clearing the group 1 PIEACK bit",
      ],
      hints: [
        "There are three stages: peripheral, then PIE (names starting with PIE), then CPU (IFR, IER, INTM).",
        "In each stage the flag is set first, then the enables are checked. The CPU saves its state before it fetches the vector.",
        "Timer, PIEIFR1.7, PIEIER1.7 and PIEACK, IFR, IER and INTM, save state, fetch vector, run the function.",
      ],
      takeaway: "Flags remember a request, enables decide if it may pass. When an interrupt does not fire, walk this path and look for the first gate that is closed.",
    },
    {
      id: "int-enable-order",
      kind: "order",
      title: "Switching it on",
      goal: "Put the steps that enable a timer 0 interrupt in the order the reference manual gives.",
      refs: [{ trm: "3.4.4" }, { course: "L4" }, { course: "HW2" }],
      brief: `
After reset no interrupt is enabled: every \`PIEIER\` bit and \`IER\` are 0 and \`INTM\` is set. Your code has to open each gate.

The reference manual (section 3.4.4.1) lists the steps. The idea behind the order:

- First make sure nothing can fire while you are half done.
- Then prepare the PIE: switch it on and tell it **where** to jump.
- Then open the gates from the PIE towards the CPU.
- Then let the peripheral start making requests.
- Open the global gate last, when everything else is ready.

In the course starter code, \`InitPieCtrl()\` and \`InitPieVectTable()\` do the "switch the PIE on" step: the second one fills the table with default handlers and sets the \`ENPIE\` bit.

The starter code does the three middle steps in a slightly different order (timer first, then \`IER\`, then \`PIEIER\`). That is safe too, because nothing can reach the CPU until \`EINT;\`. What must not move: \`DINT;\` first, the vector before the enables, \`EINT;\` last.

Order the steps the way the manual lists them.
`,
      steps: [
        "DINT;  (disable interrupts globally)",
        "InitPieCtrl(); InitPieVectTable();  (clean PIE, default vectors, PIE switched on)",
        "EALLOW; PieVectTable.TIMER0_INT = &cpu_timer0_isr; EDIS;  (write the vector)",
        "PieCtrlRegs.PIEIER1.bit.INTx7 = 1;  (enable the channel in the PIE)",
        "IER |= M_INT1;  (enable the group in the CPU)",
        "CpuTimer0Regs.TCR.all = 0x4000;  (enable the interrupt in the peripheral)",
        "EINT;  (enable interrupts globally)",
      ],
      hints: [
        "The first and the last step are the global switch: off at the start, on at the end.",
        "The vector must be in the table before any enable bit is set. InitPieVectTable() overwrites the whole table, so it comes before your own vector.",
        "After the vector, follow the path of a request backwards from the PIE: PIEIER, then IER, then the peripheral, then EINT.",
      ],
      takeaway: "Both HW2 and the manual insist on it: a PIE interrupt needs its PIEIER bit **and** its IER bit. Then the peripheral's own enable, and EINT last.",
    },
    {
      id: "int-table",
      kind: "quiz",
      title: "Reading the PIE table",
      goal: "Use the PIE channel table to find the group, channel, IER mask and PIEACK constant of an interrupt.",
      refs: [{ trm: "3.4.5" }, { trm: "3.4.6" }, { trm: "3.4.4" }, { course: "L4" }],
      brief: `
Table 3-2 of the reference manual lists every PIE interrupt. Each row is a group, each column a channel. A few rows, shortened:

- **INT1.y**: 1 ADCA1, 2 ADCB1, 3 ADCC1, 4 XINT1, 5 XINT2, 6 ADCD1, **7 TIMER0**, 8 WAKE
- **INT3.y**: 1 EPWM1, 2 EPWM2, 3 EPWM3 and so on up to 12 EPWM12
- **INT6.y**: 1 SPIA_RX, 2 SPIA_TX, 3 SPIB_RX, 4 SPIB_TX
- **INT9.y**: 1 SCIA_RX, 2 SCIA_TX, 3 SCIB_RX, 4 SCIB_TX
- **INT12.y**: 1 XINT3, 2 XINT4, 3 XINT5, ... 9 EMIF_ERROR

The group number x gives you three things at once:

- the enable register: \`PieCtrlRegs.PIEIERx.bit.INTxy\` (y is the channel)
- the CPU mask: \`IER |= M_INTx;\`
- the acknowledge at the end of the function: \`PieCtrlRegs.PIEACK.all = PIEACK_GROUPx;\`

The vector is named after the table entry: \`PieVectTable.TIMER0_INT\`, \`PieVectTable.SCIA_RX_INT\`.

## Two timers skip the PIE
Timer 1 is wired straight to CPU interrupt **INT13** and timer 2 to **INT14**. They have no \`PIEIER\` bit and need no \`PIEACK\`. They still need a vector (\`TIMER1_INT\`, \`TIMER2_INT\`), their \`IER\` bit (\`M_INT13\`, \`M_INT14\`) and \`EINT;\`.

## Priority
When several requests wait at the same time, the **lowest number wins**: the lowest group first, and inside a group the lowest channel. INT1.1 is the highest priority in the table. INT13 and INT14 come after all twelve PIE groups.
`,
      questions: [
        {
          prompt: "Which line enables timer 0's channel in the PIE?",
          options: [
            "`PieCtrlRegs.PIEIER7.bit.INTx1 = 1;`",
            "`PieCtrlRegs.PIEIER1.bit.INTx7 = 1;`",
            "`PieCtrlRegs.PIEIER1.bit.INTx1 = 1;`",
            "`PieCtrlRegs.PIEIFR1.bit.INTx7 = 1;`",
          ],
          answer: 1,
          why: "TIMER0 is INT1.7: group 1, channel 7. PIEIFR is the flag register, not the enable.",
        },
        {
          prompt: "You use the SCIA receive interrupt (SCIA_RX, INT9.1). Which pair do you need?",
          options: [
            "`IER |= M_INT1;` and `PIEACK_GROUP9`",
            "`IER |= M_INT9;` and `PIEACK_GROUP1`",
            "`IER |= M_INT9;` and `PIEACK_GROUP9`",
            "`IER |= M_INT1;` and `PIEACK_GROUP1`",
          ],
          answer: 2,
          why: "Both come from the group number, 9. The channel number, 1, is only used in PIEIER9.bit.INTx1.",
        },
        {
          prompt: "Which of these does the **timer 1** interrupt need?",
          options: [
            "`IER |= M_INT13;`",
            "`PieCtrlRegs.PIEIER1.bit.INTx8 = 1;`",
            "`PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`",
            "`PieCtrlRegs.PIEIER13.bit.INTx1 = 1;`",
          ],
          answer: 0,
          why: "Timer 1 goes straight to CPU interrupt INT13. It has no PIE channel, so no PIEIER bit and no PIEACK. There is no PIEIER13 register at all.",
        },
        {
          prompt: "ADCA1 (INT1.1), TIMER0 (INT1.7) and EPWM1 (INT3.1) are all enabled and request at the same moment. Which function runs first?",
          options: ["TIMER0", "EPWM1", "ADCA1", "Whichever was enabled first"],
          answer: 2,
          why: "Lowest group first, then lowest channel. Group 1 beats group 3, and inside group 1 channel 1 beats channel 7.",
        },
        {
          prompt: "The starter code uses the EMIF_ERROR entry (INT12.9) as a software interrupt. Which line makes its function end correctly?",
          options: [
            "`PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;`",
            "`PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`",
            "`PieCtrlRegs.PIEACK.all = M_INT12;`",
            "`PieCtrlRegs.PIEACK.all = PIEACK_GROUP12;`",
          ],
          answer: 3,
          why: "INT12.9 is group 12. M_INT12 is the name of the IER mask. Keep the two families of names apart: M_INTx for IER, PIEACK_GROUPx for PIEACK.",
        },
      ],
      hints: [
        "INTx.y: x is the group, y is the channel.",
        "M_INTx and PIEACK_GROUPx use the group. Only PIEIERx.bit.INTxy uses the channel.",
      ],
      takeaway: "Find the interrupt in the table once, and the group number gives you PIEIERx, M_INTx and PIEACK_GROUPx.",
    },
    {
      id: "int-first-isr",
      kind: "code",
      mode: "complete",
      title: "Your first interrupt",
      goal: "Connect cpu_timer0_isr to timer 0 and open the gates so LED1 blinks.",
      refs: [{ course: "Lab 1" }, { course: "L4" }, { trm: "3.4.4" }],
      brief: `
This program is nearly the course starter code. Timer 0 is set up to request an interrupt every **100 ms**, and \`cpu_timer0_isr\` toggles LED1 and acknowledges group 1. The \`while(1)\` loop is empty: the blinking will happen entirely in the interrupt function.

Four lines are missing, so the function never runs.

1. **The vector.** Tell the PIE where to jump. The vector table is protected, so the write goes between \`EALLOW;\` and \`EDIS;\`:
\`\`\`c
PieVectTable.TIMER0_INT = &cpu_timer0_isr;
\`\`\`
2. **The CPU enable** for group 1: \`IER |= M_INT1;\`
3. **The PIE enable** for channel 7 of group 1: \`PieCtrlRegs.PIEIER1.bit.INTx7 = 1;\`
4. **The global enable**: \`EINT;\`

\`IER |= ...\` uses OR so that bits already set for other interrupts stay set.

Press **Run** first and watch: nothing blinks, and nothing complains. Then add the lines.
`,
      kit: "robot",
      durationMs: 1050,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    EALLOW;
    // TODO 1: put the address of cpu_timer0_isr in the vector table

    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;

    // TODO 2: enable CPU interrupt 1 in IER

    // TODO 3: enable timer 0 in the PIE (group 1, channel 7)

    // TODO 4: enable interrupts globally

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;

    // Acknowledge this interrupt to receive more interrupts from group 1
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;

    // Acknowledge this interrupt to receive more interrupts from group 1
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 9, max: 11, label: "cpu_timer0_isr runs every 100 ms", hint: "If it ran 0 times, one of the gates is still closed: IER, PIEIER1.INTx7 or EINT." },
        { kind: "blink", led: "LED1", periodMs: 200, label: "LED1 blinks with a 200 ms period" },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER1", field: "INTx7", equals: 1, label: "Timer 0 is enabled in the PIE" },
      ],
      watch: [],
      inspect: ["PieCtrlRegs.PIEIER1", "PieCtrlRegs.PIEIFR1", "PieCtrlRegs.PIEACK", "CpuTimer0Regs.TCR"],
      hints: [
        "All four lines are in the briefing. Each goes under its TODO.",
        "If the run stops with a message about PieVectTable.TIMER0_INT, the gates are open but the vector is missing or not between EALLOW and EDIS.",
        "`PieVectTable.TIMER0_INT = &cpu_timer0_isr;` then `IER |= M_INT1;`, `PieCtrlRegs.PIEIER1.bit.INTx7 = 1;` and `EINT;`",
      ],
      takeaway: "The loop in main is empty and the LED still blinks. From now on, timing lives in interrupt functions and main is free for slow work.",
    },
    {
      id: "int-pieack",
      kind: "code",
      mode: "debug",
      title: "Once and never again",
      goal: "LED1 changes once and then stays that way. Find out why and fix it.",
      refs: [{ trm: "3.4.4" }, { trm: "3.4.3" }, { course: "L4" }],
      brief: `
Timer 0 should toggle LED1 every 50 ms. Run the program: the LED comes on after 50 ms and then never changes. The test report says how many times the function ran.

All the enable lines are there, and the first interrupt proves it. So something stops the **second** request.

Walk the path from the briefing. The timer keeps requesting, so \`PIEIFR1.7\` is set again. \`PIEIER1.7\` is still 1. What is the next gate, and who is supposed to open it again?

Look at the registers in the inspector after a run. They show the request waiting.
`,
      kit: "robot",
      durationMs: 520,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint32_t numTimer0calls = 0;

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 50000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint32_t numTimer0calls = 0;

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 50000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;

    // Acknowledge this interrupt to receive more interrupts from group 1
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 9, max: 11, label: "cpu_timer0_isr runs every 50 ms", hint: "It ran once: group 1 was never acknowledged, so the PIE holds back every later request." },
        { kind: "blink", led: "LED1", periodMs: 100, label: "LED1 blinks with a 100 ms period" },
        { kind: "reg", reg: "PieCtrlRegs.PIEACK", equals: 0, label: "No PIE group is left blocked at the end" },
      ],
      bonus: [
        { kind: "max-lines", max: 33, label: "Minimal fix: one line added, nothing else changed", hint: "The whole fix is one line at the end of cpu_timer0_isr." },
      ],
      watch: ["numTimer0calls"],
      inspect: ["PieCtrlRegs.PIEACK", "PieCtrlRegs.PIEIFR1", "PieCtrlRegs.PIEIER1"],
      hints: [
        "After the run, PIEIFR1 shows INTx7 = 1 (a request is waiting) and PIEACK shows bit 0 = 1 (group 1 is blocked).",
        "The PIE sets the group's PIEACK bit when it passes a request to the CPU. Only your code clears it, by writing a 1 to that bit.",
        "Add `PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;` as the last line of cpu_timer0_isr.",
      ],
      takeaway: "Every PIE interrupt function ends with its PIEACK line. Forget it and the function runs exactly once, which looks like it works if you only check that it ran.",
    },
    {
      id: "int-missing-enable",
      kind: "code",
      mode: "debug",
      title: "One works, one does not",
      goal: "The blue LED blinks but LED1 stays dark. Find the closed gate.",
      refs: [{ course: "HW2" }, { course: "Lab 1" }, { trm: "3.4.4" }, { trm: "3.4.5" }],
      brief: `
Two timers, two interrupt functions:

- Timer 1 (every 100 ms) toggles the **blue** LaunchPad LED. This works.
- Timer 0 (every 25 ms) should toggle **LED1**. It never does.

Nothing reports an error, because a closed gate is not an error: the request simply waits.

Check timer 0 against the list. It is a PIE interrupt, INT1.7, so it needs:

- its vector in \`PieVectTable\`
- its own enable in the peripheral (\`TCR\`)
- its channel enabled in the PIE
- its **group** enabled in the CPU
- \`EINT;\`

Timer 1 skips the PIE and goes straight to CPU interrupt INT13, which is why its setup is shorter.
`,
      kit: "robot",
      durationMs: 520,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

${LED1}
${BLUE}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 25000);
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer1Regs.TCR.all = 0x4000;

    IER |= M_INT13;
    // Enable TINT0 in the PIE: Group 1 interrupt 7
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void cpu_timer1_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer1_isr(void);

void main(void)
{
${INIT}

${LED1}
${BLUE}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 25000);
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer1Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    IER |= M_INT13;
    // Enable TINT0 in the PIE: Group 1 interrupt 7
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void cpu_timer1_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 19, max: 21, label: "cpu_timer0_isr runs every 25 ms", hint: "The PIE has passed the request on, but the CPU is not listening to group 1." },
        { kind: "blink", led: "LED1", periodMs: 50, label: "LED1 blinks with a 50 ms period" },
        { kind: "isr", fn: "cpu_timer1_isr", min: 4, max: 6, label: "cpu_timer1_isr still runs every 100 ms", hint: "Keep M_INT13 set. Use |= so one enable does not erase the other." },
        { kind: "blink", led: "BLUE", periodMs: 200, label: "The blue LED still blinks with a 200 ms period" },
      ],
      bonus: [
        { kind: "max-lines", max: 43, label: "Minimal fix: one line added, nothing else changed", hint: "One IER line is enough. The rest of the program is correct." },
      ],
      inspect: ["PieCtrlRegs.PIEIER1", "PieCtrlRegs.PIEIFR1", "PieCtrlRegs.PIEACK"],
      hints: [
        "The PIE side is complete. After a run, PIEACK shows group 1 already passed a request on to the CPU.",
        "A PIE interrupt needs two enables: its channel in PIEIERx and its group in IER. Which IER bits does this program set?",
        "Add `IER |= M_INT1;` next to `IER |= M_INT13;`.",
      ],
      takeaway: "PIEIER selects the channel, IER selects the group. A PIE interrupt needs both. Timers 1 and 2 need only IER.",
    },
    {
      id: "int-vector-eallow",
      kind: "code",
      mode: "debug",
      title: "The jump to nowhere",
      goal: "The program stops at the first interrupt. Read the messages and fix the vector.",
      refs: [{ trm: "3.4.6" }, { trm: "3.4.4" }, { course: "L4" }, { course: "Lab 2" }],
      brief: `
This time every gate is open, and that is the problem: the interrupt fires, and the CPU jumps to the wrong place.

Run it. You get two messages:

- an **error** on the line that writes the vector
- the run **stops** 20 ms in, when timer 0 fires for the first time

\`PieVectTable\` is a protected register block, like the pin mux registers. A write to it outside \`EALLOW;\` ... \`EDIS;\` is silently ignored by the chip. So the table still holds the default handler that \`InitPieVectTable()\` put there, and that is where the CPU goes. On the real board the default handler stops the program in the debugger. It looks like a crash, 20 ms after start.

Once that works, the test also asks for LED1 to blink with a 40 ms period.
`,
      kit: "robot",
      durationMs: 420,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    PieVectTable.TIMER0_INT = &cpu_timer0_isr;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 20000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    EALLOW;  // This is needed to write to EALLOW protected registers
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;    // This is needed to disable write to EALLOW protected registers

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 20000);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "no-diagnostic", code: "eallow", label: "No write to a protected register is ignored" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 19, max: 22, label: "cpu_timer0_isr runs every 20 ms" },
        { kind: "blink", led: "LED1", periodMs: 40, label: "LED1 blinks with a 40 ms period" },
      ],
      hints: [
        "The error message names the register and the reason.",
        "The vector write needs the same protection switch as the pin mux registers.",
        "Put `EALLOW;` on the line before `PieVectTable.TIMER0_INT = &cpu_timer0_isr;` and `EDIS;` on the line after.",
      ],
      takeaway: "A program that dies a fixed time after start often has an enabled interrupt with no valid vector. Check the PieVectTable line and its EALLOW first.",
    },
    {
      id: "int-two-timers",
      kind: "code",
      mode: "write",
      title: "Two timers, two rhythms",
      goal: "Blink the blue LED from timer 2 and toggle LED1 on every 3rd timer 0 interrupt.",
      refs: [{ course: "Lab 1" }, { course: "HW2" }, { trm: "3.4.4" }],
      brief: `
Lab 1 asks for exactly this kind of code.

## What to build
- **Timer 2** interrupts every **100 ms**. \`cpu_timer2_isr\` toggles the blue LaunchPad LED (GPIO31) on every call.
- **Timer 0** interrupts every **10 ms**. \`cpu_timer0_isr\` toggles LED1 (GPIO22) only on **every 3rd** call, so LED1 changes every 30 ms.

The pins, the PIE initialisation and the two empty functions are already there. Keep the function names.

## Every 3rd call
Count the calls in a global variable, and use the remainder of a division:
\`\`\`c
numTimer0calls++;
if ((numTimer0calls % 3) == 0) {
    // runs on call 3, 6, 9, ...
}
\`\`\`
Give each interrupt function **its own** counter. A counter shared by two functions counts neither of them.

## Reminders
- Timer 0 goes through the PIE: vector \`TIMER0_INT\`, \`PIEIER1.bit.INTx7\`, \`M_INT1\`, and \`PIEACK_GROUP1\` at the end of the function.
- Timer 2 goes straight to the CPU: vector \`TIMER2_INT\`, \`M_INT14\`. No PIEIER, no PIEACK.
- Each timer needs \`ConfigCpuTimer(&CpuTimerN, LAUNCHPAD_CPU_FREQUENCY, microseconds);\` and \`CpuTimerNRegs.TCR.all = 0x4000;\`
`,
      kit: "robot",
      durationMs: 1020,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer2_isr(void);

uint32_t numTimer0calls = 0;

void main(void)
{
${INIT}

${LED1}
${BLUE}

${PIE_INIT}

    EALLOW;
    // Vectors for timer 0 and timer 2

    EDIS;

    InitCpuTimers();
    // Periods, then start the timers with their interrupt enabled

    // Enables: IER for both, PIEIER for the one that needs it, then EINT

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    // Count this call. Toggle LED1 on every 3rd call. Acknowledge.
}

__interrupt void cpu_timer2_isr(void)
{
    // Toggle the blue LED
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer2_isr(void);

uint32_t numTimer0calls = 0;

void main(void)
{
${INIT}

${LED1}
${BLUE}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER2_INT = &cpu_timer2_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 10000);
    ConfigCpuTimer(&CpuTimer2, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer2Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    IER |= M_INT14;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    if ((numTimer0calls % 3) == 0) {
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void cpu_timer2_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 100, max: 103, label: "cpu_timer0_isr runs every 10 ms", hint: "Ran once: PIEACK is missing. Never ran: check IER, PIEIER1.INTx7, EINT and TCR." },
        { kind: "isr", fn: "cpu_timer2_isr", min: 9, max: 11, label: "cpu_timer2_isr runs every 100 ms", hint: "Timer 2 needs its vector (TIMER2_INT), its TCR line and IER |= M_INT14." },
        { kind: "blink", led: "LED1", periodMs: 60, label: "LED1 changes on every 3rd timer 0 interrupt (60 ms period)" },
        { kind: "blink", led: "BLUE", periodMs: 200, label: "The blue LED blinks with a 200 ms period" },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timers do the timing: no DELAY_US" },
        { kind: "no-dat-write", label: "Outputs are changed through TOGGLE" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.5, label: "cpu_timer0_isr never takes more than 0.5 microseconds", hint: "Count, compare, toggle, acknowledge. No loops and no waiting in an interrupt function." },
        { kind: "isr-time", fn: "cpu_timer2_isr", maxUs: 0.2, label: "cpu_timer2_isr never takes more than 0.2 microseconds", hint: "One TOGGLE write is all it needs." },
      ],
      watch: ["numTimer0calls"],
      hints: [
        "Work down the list for each timer: vector, ConfigCpuTimer, TCR, IER. Timer 0 also needs PIEIER1.bit.INTx7. Finish with EINT.",
        "10 ms is 10000 microseconds, 100 ms is 100000. The masks are M_INT1 and M_INT14.",
        "In cpu_timer0_isr: `numTimer0calls++;`, then `if ((numTimer0calls % 3) == 0)` around the GPATOGGLE line, then the PIEACK line outside the if.",
      ],
      takeaway: "One fast timer plus a counter gives you as many slower rhythms as you need. The acknowledge stays outside the if: it must run on every call.",
    },
    {
      id: "int-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Three functions and a flag",
      goal: "Run two timers, post a software interrupt from one of them, and hand a job to main with a flag.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { course: "L4" }, { trm: "3.4.4" }, { trm: "3.4.5" }],
      brief: `
This is the structure of the starter code you will use all semester, built by you.

## Timer 0, every 1 ms: \`cpu_timer0_isr\`
- Count the call in \`numTimer0calls\`.
- On every **50th** call, post the software interrupt:
\`\`\`c
PieCtrlRegs.PIEIFR12.bit.INTx9 = 1;
\`\`\`
- Acknowledge group 1.

## The software interrupt: \`SWI_isr\`
Setting a PIE flag yourself has the same effect as a peripheral setting it. The course borrows an entry it does not otherwise use, **INT12.9**, named \`EMIF_ERROR_INT\` in the vector table. It needs what any PIE interrupt needs: a vector, \`PIEIER12.bit.INTx9\`, \`M_INT12\` and \`PIEACK_GROUP12\`.

- Count the call in \`numSWIcalls\`.
- Toggle **LED2** (GPIO94, port C).

Group 12 has the lowest priority of the PIE groups. That makes it the place for work that is too long for the timer function but should not wait for main.

## Timer 1, every 25 ms: \`cpu_timer1_isr\`
- Count the call in \`numTimer1calls\`.
- Toggle **LED1** (GPIO22) on every call.
- On every **4th** call, set the flag \`UARTPrint = 1;\`

## The flag, in main
In the starter code, slow work such as printing is never done inside an interrupt function. The function only raises a flag, and \`while(1)\` does the work:
\`\`\`c
if (UARTPrint == 1) {
    UARTPrint = 0;
    handled++;      // stands for the slow work
}
\`\`\`
Setting the flag back to 0 matters: without it the work would repeat as fast as the loop can spin.

Keep the names of the functions and the global variables. The tests read them.
`,
      kit: "robot",
      durationMs: 510,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer1_isr(void);
__interrupt void SWI_isr(void);

uint32_t numTimer0calls = 0;
uint32_t numTimer1calls = 0;
uint32_t numSWIcalls = 0;
uint16_t UARTPrint = 0;
uint32_t handled = 0;

void main(void)
{
${INIT}

${LED1}
${LED2}

${PIE_INIT}

    // Vectors, timers, enables

    while (1) {
        // Do the work when the flag is set
    }
}

__interrupt void SWI_isr(void)
{
}

__interrupt void cpu_timer0_isr(void)
{
}

__interrupt void cpu_timer1_isr(void)
{
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer1_isr(void);
__interrupt void SWI_isr(void);

uint32_t numTimer0calls = 0;
uint32_t numTimer1calls = 0;
uint32_t numSWIcalls = 0;
uint16_t UARTPrint = 0;
uint32_t handled = 0;

void main(void)
{
${INIT}

${LED1}
${LED2}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.EMIF_ERROR_INT = &SWI_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 1000);
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 25000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer1Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    IER |= M_INT12;
    IER |= M_INT13;
    // Enable TINT0 in the PIE: Group 1 interrupt 7
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    // Enable SWI in the PIE: Group 12 interrupt 9
    PieCtrlRegs.PIEIER12.bit.INTx9 = 1;
    EINT;
    ERTM;

    while (1) {
        if (UARTPrint == 1) {
            UARTPrint = 0;
            handled++;
        }
    }
}

__interrupt void SWI_isr(void)
{
    numSWIcalls++;
    GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP12;
}

__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    if ((numTimer0calls % 50) == 0) {
        PieCtrlRegs.PIEIFR12.bit.INTx9 = 1;  // Manually cause the interrupt for the SWI
    }
    // Acknowledge this interrupt to receive more interrupts from group 1
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void cpu_timer1_isr(void)
{
    numTimer1calls++;
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    if ((numTimer1calls % 4) == 0) {
        UARTPrint = 1;
    }
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 505, max: 511, label: "cpu_timer0_isr runs every 1 ms", hint: "Ran once: PIEACK_GROUP1 is missing. Never: check the vector, TCR, M_INT1, PIEIER1.INTx7 and EINT." },
        { kind: "isr", fn: "cpu_timer1_isr", min: 20, max: 20, label: "cpu_timer1_isr runs every 25 ms", hint: "Timer 1 needs the TIMER1_INT vector, its TCR line and IER |= M_INT13." },
        { kind: "isr", fn: "SWI_isr", min: 10, max: 10, label: "SWI_isr runs on every 50th timer 0 interrupt", hint: "Ran once: PIEACK_GROUP12 is missing. Never: check EMIF_ERROR_INT, PIEIER12.INTx9 and M_INT12." },
        { kind: "var", name: "numTimer0calls", min: 505, max: 511, label: "numTimer0calls counts the timer 0 interrupts", hint: "Each function increments only its own counter." },
        { kind: "var", name: "numTimer1calls", equals: 20, label: "numTimer1calls counts the timer 1 interrupts", hint: "Each function increments only its own counter." },
        { kind: "var", name: "numSWIcalls", equals: 10, label: "numSWIcalls counts the software interrupts" },
        { kind: "blink", led: "LED2", periodMs: 100, label: "LED2 blinks with a 100 ms period (from SWI_isr)" },
        { kind: "blink", led: "LED1", periodMs: 50, label: "LED1 blinks with a 50 ms period (from cpu_timer1_isr)" },
        { kind: "var", name: "handled", equals: 5, label: "main did the work once for every 4th timer 1 interrupt", hint: "A huge number means the flag is never set back to 0. Zero means it is never set, or main never looks." },
        { kind: "var", name: "UARTPrint", equals: 0, label: "The flag is back at 0 after main used it" },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timers do the timing: no DELAY_US" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.5, label: "cpu_timer0_isr never takes more than 0.5 microseconds", hint: "It runs 1000 times a second: count, post on every 50th call, acknowledge, nothing else." },
        { kind: "isr-time", fn: "cpu_timer1_isr", maxUs: 0.5, label: "cpu_timer1_isr never takes more than 0.5 microseconds" },
        { kind: "max-lines", max: 72, label: "Done in 72 lines of code or fewer", hint: "Blank lines and comments do not count. One statement per line is enough: nothing needs to be repeated." },
      ],
      watch: ["numTimer0calls", "numTimer1calls", "numSWIcalls", "UARTPrint", "handled"],
      inspect: ["PieCtrlRegs.PIEIER1", "PieCtrlRegs.PIEIER12", "PieCtrlRegs.PIEACK"],
      hints: [
        "Three vectors (TIMER0_INT, TIMER1_INT, EMIF_ERROR_INT), three IER bits (M_INT1, M_INT12, M_INT13), two PIEIER bits (PIEIER1.INTx7, PIEIER12.INTx9). Timer 1 has no PIEIER bit.",
        "Two functions need an acknowledge: PIEACK_GROUP1 in cpu_timer0_isr and PIEACK_GROUP12 in SWI_isr. cpu_timer1_isr needs none.",
        "Timer 0: `if ((numTimer0calls % 50) == 0) { PieCtrlRegs.PIEIFR12.bit.INTx9 = 1; }`. Timer 1: `if ((numTimer1calls % 4) == 0) { UARTPrint = 1; }`. Periods are 1000 and 25000 microseconds.",
      ],
      takeaway: "Fast and exact work goes in a timer function, longer work in the software interrupt, slow work in main behind a flag. Every lab from here on has this shape.",
    },
    {
      id: "int-lost-ticks",
      tier: "practice",
      kind: "code",
      mode: "debug",
      title: "The clock that runs slow",
      goal: "This millisecond clock loses time. Find where the ticks go and get all of them back.",
      refs: [{ course: "L4" }, { course: "Lab 1" }, { trm: "3.4.2" }, { trm: "3.4.3" }],
      brief: `
Timer 0 interrupts every 1 ms and \`cpu_timer0_isr\` counts the milliseconds in \`ms\`. LED1 toggles every 50 counts, so it should blink with a 100 ms period. Every 10th call the function also reads a slow sensor. \`read_slow_sensor()\` stands for that: it takes about 2.5 ms.

Run it. LED1 blinks too slowly, and after 200 ms \`ms\` has not reached 200. Nothing reports an error.

## Where ticks go
While an interrupt function runs, INTM is set and no other interrupt is taken. The timer does not wait. It keeps reaching zero every 1 ms:

- The **first** request during the function sets the flag \`PIEIFR1.7\`. It waits and is served the moment the function returns: late, but not lost.
- The **second** request finds the flag already at 1. A flag cannot count. That tick is gone for good.

So a function that runs longer than **two** timer periods loses interrupts, and a function that runs longer than one period makes the next one late.

## The fix
Use the pattern from the last level. The interrupt function only decides **when**: it raises a flag. The \`while (1)\` loop in \`main()\` does the slow work and can be interrupted while it does.

The sensor must still be read once every 10 ms. Do not change \`read_slow_sensor()\`.
`,
      kit: "robot",
      durationMs: 200.5,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint32_t ms = 0;          // milliseconds since start
uint32_t readings = 0;    // sensor readings taken
uint32_t sensorSum = 0;

${SLOW_SENSOR}

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    ms++;
    if ((ms % 10) == 0) {
        read_slow_sensor();
    }
    if ((ms % 50) == 0) {
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint32_t ms = 0;          // milliseconds since start
uint32_t readings = 0;    // sensor readings taken
uint32_t sensorSum = 0;
uint16_t readNow = 0;     // set every 10 ms by the interrupt function

${SLOW_SENSOR}

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {
        if (readNow == 1) {
            readNow = 0;
            read_slow_sensor();
        }
    }
}

__interrupt void cpu_timer0_isr(void)
{
    ms++;
    if ((ms % 10) == 0) {
        readNow = 1;
    }
    if ((ms % 50) == 0) {
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 200, max: 201, label: "cpu_timer0_isr runs 200 times in 200 ms: no tick is lost", hint: "Fewer than 200: the function was still running when the timer asked a second time." },
        { kind: "var", name: "ms", min: 200, max: 201, label: "ms shows 200 after 200 ms" },
        { kind: "blink", led: "LED1", periodMs: 100, label: "LED1 blinks with a 100 ms period" },
        { kind: "var", name: "readings", min: 19, max: 20, label: "The sensor is still read every 10 ms", hint: "Call read_slow_sensor() from the while(1) loop each time the flag is set, and clear the flag." },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1, label: "cpu_timer0_isr never takes more than 1 microsecond", hint: "The test report shows the longest run. Anything slow belongs in main()." },
      ],
      watch: ["ms", "readings"],
      inspect: ["PieCtrlRegs.PIEIFR1", "PieCtrlRegs.PIEACK"],
      hints: [
        "Compare the numbers in the test report: how often did cpu_timer0_isr run, and how long did its longest run take?",
        "Add a global flag, for example `uint16_t readNow = 0;`. In the interrupt function replace the call with `readNow = 1;`.",
        "In main: `while (1) { if (readNow == 1) { readNow = 0; read_slow_sensor(); } }`",
      ],
      takeaway: "A pending flag holds one request, not a count. Keep every interrupt function much shorter than the period of the fastest interrupt, and count calls to prove that none was lost.",
    },
    {
      id: "int-soft-pwm",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "Dimming by hand",
      goal: "Dim LED1 with a timer interrupt: 30 % brightness normally, 80 % while PB1 is held.",
      refs: [{ course: "L4" }, { course: "Lab 1" }, { trm: "3.8" }, { trm: "3.4.4" }],
      brief: `
An LED that is switched on and off faster than the eye can follow looks dimmer. The share of the time it is on is the **duty cycle**. Later in the course the ePWM peripheral does this in hardware. Here you do it with a timer interrupt, which shows what the hardware will do for you.

## What to build
Timer 0 interrupts every **1 ms** (already set up). Cut time into periods of **10 interrupts**, numbered 0 to 9 in \`slot\`:

- LED1 is **on** in the slots below \`onSlots\` and **off** in the others.
- \`onSlots\` is **3** normally (30 %) and **8** while **PB1** is held down (80 %).

PB1 is on GPIO157 (port E) and reads **0** while pressed. The tests hold it from 100 ms to 200 ms.

## One period
\`\`\`c
slot++;
if (slot >= 10) {
    slot = 0;
}
\`\`\`
Then compare: \`slot < onSlots\` means on. Use \`GPASET\` and \`GPACLEAR\`, so the LED is driven to the right level on every call.
`,
      kit: "robot",
      durationMs: 300,
      stimuli: [
        { at: 100.3, press: "PB1" },
        { at: 200.3, release: "PB1" },
      ],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint16_t slot = 0;       // position in the PWM period, 0 to 9
uint16_t onSlots = 3;    // slots in which LED1 is on

void main(void)
{
${INIT}

${LED1}
${PB1}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    // Next slot (0 to 9). Read PB1 to choose onSlots. Switch LED1 on or off.

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint16_t slot = 0;       // position in the PWM period, 0 to 9
uint16_t onSlots = 3;    // slots in which LED1 is on

void main(void)
{
${INIT}

${LED1}
${PB1}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    slot++;
    if (slot >= 10) {
        slot = 0;
    }

    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
        onSlots = 8;    // PB1 pressed
    } else {
        onSlots = 3;
    }

    if (slot < onSlots) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "duty", led: "LED1", pct: 30, from: 10, to: 90, label: "LED1 is on 30 % of the time while PB1 is released", hint: "On in slots 0, 1 and 2 of every 10. If it is 0 % or 100 %, check the comparison and that slot goes back to 0." },
        { kind: "duty", led: "LED1", pct: 80, from: 110, to: 190, label: "LED1 is on 80 % of the time while PB1 is held", hint: "PB1 reads 0 while pressed: GpioDataRegs.GPEDAT.bit.GPIO157 == 0." },
        { kind: "duty", led: "LED1", pct: 30, from: 210, to: 290, label: "LED1 is back at 30 % after PB1 is released" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 299, max: 301, label: "cpu_timer0_isr runs every 1 ms" },
        { kind: "no-dat-write", label: "LED1 is changed through SET and CLEAR" },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timer does the timing: no DELAY_US" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.6, label: "cpu_timer0_isr never takes more than 0.6 microseconds", hint: "No loops are needed: one step of the period per call." },
      ],
      watch: ["slot", "onSlots"],
      hints: [
        "Three steps in the interrupt function: advance slot, choose onSlots from the button, then set or clear the LED.",
        "`if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) { onSlots = 8; } else { onSlots = 3; }`",
        "`if (slot < onSlots) { GpioDataRegs.GPASET.bit.GPIO22 = 1; } else { GpioDataRegs.GPACLEAR.bit.GPIO22 = 1; }` and keep the PIEACK line last.",
      ],
      takeaway: "PWM is a counter and a compare value. This version costs 1000 interrupts a second for 10 brightness steps at 100 Hz. The ePWM peripheral does the same counting in hardware, thousands of times finer and with no CPU time.",
    },
    {
      id: "int-debounce",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "One press, one count",
      goal: "Count the presses of a bouncing button exactly, and toggle LED1 once per press.",
      refs: [{ course: "Lab 1" }, { course: "L4" }, { trm: "8.4" }, { trm: "3.8" }],
      brief: `
A push button is two pieces of metal. When they meet they **bounce**: the contact closes, opens and closes again a few times before it settles. The same happens when they part. Code that reacts to every change of the pin counts one press as several.

{{figure:button-bounce}}

Try it in the figure: find how far apart the reads of the pin must be before one press counts as one.

## The button in this level
- **PB1**, GPIO157 (port E), reads 0 while the contact is closed. It needs the pull-up.
- After the first contact, and after the first opening, the pin may flip for up to **5 ms**.
- A real press holds the contact closed for at least 10 ms, and two presses are at least 20 ms apart.

The tests press PB1 **three times**, each with a different bounce.

## What to build
- \`presses\` (a global \`uint32_t\`) goes up by exactly **1** per press.
- **LED1** toggles exactly once per press: on after the first, off after the second, on after the third.
- Nothing may happen on a release, however much it bounces.
- Take the samples of the pin in a CPU timer interrupt function. No \`DELAY_US\`.

You choose the timer period and the method. Decide first what your code should believe when two samples in a row disagree.

## The star
React within **2 ms of the first contact**. Waiting until the pin has been quiet for a while is safe but slow. Think about which of the two edges of a press needs the waiting.
`,
      kit: "robot",
      durationMs: 230,
      stimuli: [
        { at: 20.4, press: "PB1" }, { at: 21.4, release: "PB1" }, { at: 22.6, press: "PB1" },
        { at: 60.2, release: "PB1" }, { at: 61.5, press: "PB1" }, { at: 62.4, release: "PB1" },
        { at: 100.7, press: "PB1" }, { at: 100.9, release: "PB1" }, { at: 101.6, press: "PB1" }, { at: 102.2, release: "PB1" }, { at: 102.5, press: "PB1" },
        { at: 130.1, release: "PB1" }, { at: 130.8, press: "PB1" }, { at: 131.9, release: "PB1" }, { at: 132.6, press: "PB1" }, { at: 133.4, release: "PB1" },
        { at: 170.2, press: "PB1" }, { at: 171.3, release: "PB1" }, { at: 171.6, press: "PB1" },
        { at: 185.3, release: "PB1" }, { at: 186.1, press: "PB1" }, { at: 187.4, release: "PB1" },
      ],
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint32_t presses = 0;

void main(void)
{
${INIT}

${LED1}

    // PB1 (GPIO157)

${PIE_INIT}

    // Vector, timer, enables

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
}
`,
      solution: `${FREQ}

// Samples in a row that must read "released" before the next press counts.
// 8 samples of 1 ms is longer than the 5 ms of bounce.
#define RELEASE_SAMPLES 8

__interrupt void cpu_timer0_isr(void);

uint32_t presses = 0;
uint16_t armed = 1;        // 1: the next closed contact is a new press
uint16_t highCount = 0;    // samples in a row with the contact open

void main(void)
{
${INIT}

${LED1}

${PB1}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
        // Contact closed. A bounce cannot close an open button, so the
        // first closed sample is already proof of a press: act at once.
        highCount = 0;
        if (armed == 1) {
            armed = 0;
            presses++;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    } else {
        // Contact open: bounce or a real release? Only a long quiet
        // stretch is a release.
        if (highCount < RELEASE_SAMPLES) {
            highCount++;
        } else {
            armed = 1;
        }
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "var", name: "presses", at: 90, equals: 1, label: "presses is 1 after the first press and its release", hint: "More than 1: bounce was counted, on the press or on the release. 0: check the pull-up, the pin and the timer interrupt." },
        { kind: "var", name: "presses", at: 160, equals: 2, label: "presses is 2 after the second press" },
        { kind: "var", name: "presses", equals: 3, label: "presses is 3 at the end" },
        { kind: "steady", led: "LED1", from: 35, to: 95, on: true, label: "LED1 is on after the first press and ignores the bouncing release", hint: "A release also bounces: the pin reads 0 again for a moment after it first opened." },
        { kind: "steady", led: "LED1", from: 115, to: 165, on: false, label: "LED1 is off after the second press" },
        { kind: "steady", led: "LED1", from: 195, to: 229, on: true, label: "LED1 is on after the third press" },
        { kind: "no-diagnostic", code: "floating", label: "PB1 has its pull-up", hint: "GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);" },
        { kind: "source", mustMatch: "__interrupt", mustNotMatch: "DELAY_US", label: "The samples are taken in a timer interrupt function: no DELAY_US" },
      ],
      bonus: [
        { kind: "latency", led: "LED1", after: 100.7, withinUs: 2000, label: "LED1 reacts within 2 ms of the first contact (second press)", hint: "An open button cannot read closed by accident. React to the first closed sample, then refuse new presses until the pin has stayed open for longer than the bounce time." },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.6, label: "The sampling function never takes more than 0.6 microseconds" },
      ],
      watch: ["presses"],
      hints: [
        "Sample the pin every 1 ms. Bounce shows up as samples that disagree for a few milliseconds. A real change is a long run of equal samples.",
        "Keep a counter of samples in a row with the contact open. Only when it passes the bounce time (say 8 samples) is the button really released, and only then may the next closed sample count as a press.",
        "Two globals: `armed` and `highCount`. Closed sample: `highCount = 0;` and, if armed, count, toggle and clear `armed`. Open sample: count up `highCount`, and set `armed = 1;` once it reaches 8.",
      ],
      takeaway: "Debouncing is deciding what you trust. A closed contact is trustworthy at once, an open one only after it has stayed open longer than the bounce time. Sampling in a timer interrupt gives you that clock for free. The chip can also filter a pin in hardware: see input qualification, section 8.4 of the reference manual.",
    },
    {
      id: "int-priorities",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Three jobs, three priorities",
      goal: "Make a 1 ms tick, a 5 ms calculation and a 3 ms log job share the CPU so that each one runs when it must.",
      refs: [{ trm: "3.4.3" }, { trm: "3.4.4" }, { trm: "3.4.5" }, { course: "L4" }, { course: "Lab 1" }],
      brief: `
The program has three interrupt functions. Each one works alone. Together they fail: run it and compare the call counts with the list below.

- \`cpu_timer0_isr\` (INT1.7), every 1 ms: toggles LED1 and posts the software interrupt on every 20th call. **Highest priority.** It must never be late.
- \`SWI_isr\` (INT12.9), every 20 ms: toggles LED2, then \`filter_job()\`, which takes 5 ms. **Middle priority.** It may be interrupted by timer 0 only, and must start at once even if the log job is running.
- \`cpu_timer2_isr\` (INT14), every 23 ms: \`log_job()\`, which takes 3 ms. **Lowest priority.** It may be interrupted by both others, and must wait while the filter job runs.

Make it so. Change only the two slow interrupt functions. The jobs, \`main()\` and \`cpu_timer0_isr\` stay as they are.

## What the CPU does for you, and what it does not
On the way into any interrupt function the CPU (section 3.4.3 of the reference manual):

- sets **INTM**, so nothing else is taken until the function returns or runs \`EINT;\`
- clears the function's own bit in **IER**, so it cannot interrupt itself
- puts the old IER and INTM back when the function returns

The priority order in the PIE table only decides who goes first when several requests are **waiting at the same time**. Once a function has run \`EINT;\`, any request whose IER bit is set gets in, whatever its place in the table. Which interrupts may enter a function is therefore yours to decide, with IER, before you open INTM.

Two more facts:

- A PIE group stays blocked until its \`PIEACK\` bit is cleared. The course starter clears it at the top of \`SWI_isr\`, before \`EINT;\`.
- End a function that ran \`EINT;\` with \`DINT;\`, so that nothing sneaks in between its last statement and the return.
`,
      kit: "robot",
      durationMs: 215,
      starter: `${PRIORITY_GLOBALS}

${PRIORITY_MAIN}

// Every 20 ms, posted by cpu_timer0_isr
__interrupt void SWI_isr(void)
{
    GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;

    filter_job();
    numSWIcalls++;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP12;
}

// Every 23 ms
__interrupt void cpu_timer2_isr(void)
{
    log_job();
    numTimer2calls++;
}
`,
      solution: `${PRIORITY_GLOBALS}

${PRIORITY_MAIN}

// Every 20 ms, posted by cpu_timer0_isr
__interrupt void SWI_isr(void)
{
    GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;

    // Timer 2 has a lower priority: keep it out. The CPU puts IER back
    // when this function returns.
    IER &= ~M_INT14;
    // Let other interrupts in: unblock the group, then clear INTM
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP12;
    EINT;

    filter_job();
    numSWIcalls++;

    DINT;
}

// Every 23 ms
__interrupt void cpu_timer2_isr(void)
{
    // Lowest priority: everything else may interrupt. The CPU has already
    // cleared this function's own IER bit, and timer 2 has no PIEACK.
    EINT;

    log_job();
    numTimer2calls++;

    DINT;
}
`,
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 214, max: 216, label: "cpu_timer0_isr runs every 1 ms: no tick is lost", hint: "Ticks are lost while a slow function runs with INTM set. Both slow functions must let timer 0 in." },
        { kind: "var", name: "numSWIcalls", equals: 10, label: "The filter job ran 10 times", hint: "The software interrupt is posted by cpu_timer0_isr. If timer 0 loses ticks, the SWI comes late too." },
        { kind: "var", name: "numTimer2calls", equals: 9, label: "The log job ran 9 times" },
        { kind: "isr-time", fn: "SWI_isr", maxUs: 5100, label: "The filter job is never interrupted by the log job (SWI_isr takes at most 5.1 ms)", hint: "After EINT every interrupt with its IER bit set can enter. Clear M_INT14 in IER before EINT." },
        { kind: "latency", led: "LED2", after: 140, withinUs: 200, label: "SWI_isr starts on time at 140 ms, while the log job is running", hint: "cpu_timer2_isr must run EINT too. Its own IER bit is already cleared, so only timer 0 and the SWI can enter." },
        { kind: "var", name: "filterSum", equals: 3909815408, label: "filter_job is unchanged and finished every time" },
        { kind: "var", name: "logSum", equals: 4049865000, label: "log_job is unchanged and finished every time" },
        { kind: "reg", reg: "PieCtrlRegs.PIEACK", equals: 0, label: "No PIE group is left blocked at the end" },
      ],
      bonus: [
        { kind: "max-lines", max: 84, label: "Done with six added lines or fewer", hint: "SWI_isr needs an IER line, EINT and DINT, and its PIEACK line moved up. cpu_timer2_isr needs EINT and DINT." },
      ],
      watch: ["numTimer0calls", "numSWIcalls", "numTimer2calls"],
      inspect: ["PieCtrlRegs.PIEACK", "PieCtrlRegs.PIEIFR1", "PieCtrlRegs.PIEIFR12"],
      hints: [
        "Start with SWI_isr as the course starter has it: acknowledge group 12 first, then `EINT;`, the work, and `DINT;` at the end. Run it and read which check fails next.",
        "After `EINT;` in SWI_isr, timer 2 can enter as well, because its IER bit is set. Put `IER &= ~M_INT14;` before the `EINT;`. You do not have to restore it: the return does.",
        "cpu_timer2_isr: `EINT;` as its first line and `DINT;` as its last. Nothing else: no PIEACK (timer 2 is not in the PIE) and no IER line (INT14's own bit is already cleared).",
      ],
      takeaway: "Interrupts do not nest until a function says so with EINT, and from then on IER, not the PIE table, decides who may enter. That is how the course starter turns INT12.9 into a low-priority task that every hardware interrupt can interrupt.",
    },
    {
      id: "int-soft-uart",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "A serial port made of one pin",
      goal: "Send text at 9600 baud on GPIO0 with nothing but a timer interrupt: one bit per interrupt.",
      refs: [{ course: "HW1" }, { course: "L4" }, { trm: "19.6" }, { trm: "3.8" }, { trm: "3.4.4" }],
      brief: `
The chip has four serial ports, and they are all in use. You need a fifth, on **GPIO0**. Build the transmitter yourself. A logic analyser on the pin decodes what you send.

## The signal
At 9600 baud every bit lasts 1/9600 s. One character is 10 bits (HW1, and chapter 6 in detail):

- the line **idles high**
- one **start bit**, low
- **8 data bits**, bit 0 first
- one **stop bit**, high

## What to build
- A timer 0 interrupt every bit time. Each call of \`cpu_timer0_isr\` puts **one bit** on the pin and nothing more.
- The first line is \`Hi 0\` followed by \`\\r\\n\`. Its start bit goes out on the first timer interrupt.
- A new line starts every **192 bit times** (20 ms): \`Hi 1\`, \`Hi 2\` and so on. After \`Hi 9\` comes \`Hi 0\` again.
- Between lines the pin stays high.

No SCI registers, no serial library, no \`DELAY_US\`.

## Things to work out
- The bit time is not a whole number of microseconds. How many SYSCLK cycles (200 MHz) is it, and what does that make \`PRD\`?
- What the interrupt function has to remember between two calls.
- The level of the pin at the moment it becomes an output. A line that dips low, however briefly, has sent a start bit.
`,
      kit: "launchpad",
      durationMs: 70,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

char line[] = "Hi 0\\r\\n";

void main(void)
{
${INIT}

    // GPIO0: the transmit pin

${PIE_INIT}

    // Vector, timer (one interrupt per bit), enables

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
}
`,
      solution: `${FREQ}

#define LINE_PERIOD 192   // bit times from the start of one line to the next

__interrupt void cpu_timer0_isr(void);

char line[] = "Hi 0\\r\\n";
uint16_t sending = 1;     // 1 while a line is going out
uint16_t charIndex = 0;   // character being sent
uint16_t bitIndex = 0;    // 0 = start bit, 1 to 8 = data bits 0 to 7, 9 = stop bit
uint16_t bitTime = 0;     // bit times since the line started

void main(void)
{
${INIT}

    // GPIO0: the transmit pin. Set the idle level first, then make it an output.
    GpioDataRegs.GPASET.bit.GPIO0 = 1;
    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(0, GPIO_OUTPUT, GPIO_PUSHPULL);

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    // One bit: 200 MHz / 9600 = 20833 clock cycles, so PRD = 20832
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 104.1667);
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    if (sending == 1) {
        if (bitIndex == 0) {
            GpioDataRegs.GPACLEAR.bit.GPIO0 = 1;    // start bit
        } else if (bitIndex == 9) {
            GpioDataRegs.GPASET.bit.GPIO0 = 1;      // stop bit
        } else if ((line[charIndex] >> (bitIndex - 1)) & 1) {
            GpioDataRegs.GPASET.bit.GPIO0 = 1;      // data bit is 1
        } else {
            GpioDataRegs.GPACLEAR.bit.GPIO0 = 1;    // data bit is 0
        }

        bitIndex++;
        if (bitIndex == 10) {
            bitIndex = 0;
            charIndex++;
            if (line[charIndex] == 0) {
                sending = 0;    // end of the string: the pin stays high
            }
        }
    }

    bitTime++;
    if (bitTime == LINE_PERIOD) {
        bitTime = 0;
        // Next line. Nothing is being sent now, so the text may change.
        if (line[3] == '9') {
            line[3] = '0';
        } else {
            line[3]++;
        }
        charIndex = 0;
        sending = 1;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "uart", pin: 0, baud: 9600, includes: "Hi 0\r\n", label: "A 9600 baud receiver on GPIO0 reads the line Hi 0", hint: "The report shows what the receiver decoded. Wrong letters: check the bit order (bit 0 first) and the bit time. Nothing: check the start bit (low) and the stop bit (high)." },
        { kind: "uart", pin: 0, baud: 9600, includes: "Hi 0\r\nHi 1\r\nHi 2\r\nHi 3\r\n", label: "The lines Hi 1, Hi 2 and Hi 3 follow", hint: "Change the digit only while no line is being sent." },
        { kind: "latency", pin: 0, after: 19.9, withinUs: 400, label: "The second line starts 20 ms (192 bit times) after the first", hint: "Count bit times in the interrupt function. The first start bit goes out on the first interrupt." },
        { kind: "pin", pin: 0, at: 12, level: 1, label: "The line idles high after the first line" },
        { kind: "pin", pin: 0, at: 39.5, level: 1, label: "The line idles high before the third line" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 665, max: 678, label: "One interrupt per bit time: 9600 a second", hint: "70 ms at 9600 baud is 672 bit times." },
        { kind: "source", mustNotMatch: "DELAY_US|SciaRegs|ScibRegs|ScicRegs|ScidRegs|serial_", label: "No SCI, no serial library, no DELAY_US" },
        { kind: "no-dat-write", label: "The pin is changed through SET and CLEAR" },
      ],
      bonus: [
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 20832, label: "The bit time is exact to one clock cycle: PRD is 20832", hint: "200 MHz / 9600 = 20833.3 cycles per bit. ConfigCpuTimer takes a float, so 104.1667 microseconds works, or write CpuTimer0Regs.PRD.all yourself." },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1, label: "cpu_timer0_isr never takes more than 1 microsecond", hint: "One bit per call. No loop over the bits or the characters." },
      ],
      watch: ["charIndex", "bitIndex"],
      hints: [
        "Keep three things between calls: whether a line is going out, which character, and which of its 10 bits. Each call sends the bit they point to, then moves them on.",
        "Bit k of a character is `(line[charIndex] >> k) & 1`. With bitIndex 0 for the start bit and 9 for the stop bit, the data bit is number `bitIndex - 1`. The string ends where `line[charIndex] == 0`.",
        "Count every call in a second variable. When it reaches 192: set it to 0, step the digit `line[3]` (after '9' comes '0'), and start again at character 0, bit 0. For the timer: `ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 104.1667);`",
      ],
      takeaway: "A UART is a state machine clocked at the baud rate. The SCI does exactly this in hardware, with a shift register in place of your index. The receiver only needs each edge to be within a fraction of a bit, which is why a timer interrupt is good enough at 9600 baud.",
    },
  ],
};
