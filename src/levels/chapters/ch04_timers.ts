import type { Chapter } from "../types";

const INIT = `    InitSysCtrl();
    InitGpio();`;

const out = (pin: number) => `    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);`;

export const ch04: Chapter = {
  id: "timers",
  number: 4,
  title: "CPU timers",
  blurb: "Period, prescaler and the control register. Blink at an exact rate without DELAY_US.",
  requires: ["outputs"],
  course: ["L2", "Lab 1", "Lab 2"],
  levels: [
    {
      id: "tmr-brief",
      kind: "brief",
      title: "A counter that keeps time",
      goal: "Learn how a CPU timer turns the 200 MHz clock into a period you choose.",
      refs: [{ trm: "3.8" }, { trm: "3.7" }, { course: "L2" }, { course: "Lab 1" }],
      brief: `
A timer is a **counter driven by a clock**. The chip's system clock, SYSCLK, runs at 200 MHz, so one clock cycle lasts **5 ns**. Counting cycles is measuring time.

## How a CPU timer counts
The chip has three identical 32-bit timers. Each has a counter \`TIM\` and a period register \`PRD\`:

1. \`TIM\` is loaded with the value in \`PRD\`.
2. \`TIM\` counts **down** by one on every tick.
3. When \`TIM\` reaches 0, the timer sets its flag \`TIF\`, asks for an interrupt if that is enabled, and loads \`TIM\` from \`PRD\` again.

Counting from \`PRD\` down to 0 and reloading takes \`PRD + 1\` ticks.

## Two stages
Before the 32-bit counter sits a 16-bit **prescaler**. Its divide-down value is split over two 8-bit fields, \`TDDRH\` (high half, in register \`TPRH\`) and \`TDDR\` (low half, in \`TPR\`). The counter gets one tick every \`TDDRH:TDDR + 1\` clock cycles.

- The prescaler sets **how long one tick is**.
- \`PRD\` sets **how many ticks** make a period.

**Period = (PRD + 1) x (TDDRH:TDDR + 1) x 5 ns**

With the prescaler at 0, a tick is one clock cycle, and the period is simply (PRD + 1) x 5 ns.

## Three timers
\`CpuTimer0Regs\`, \`CpuTimer1Regs\` and \`CpuTimer2Regs\` have the same registers. Timer 2 is reserved for a real-time operating system when one is used. The course projects do not use one, so all three are yours.

## The helper function
You rarely write \`PRD\` yourself. TI's function does the arithmetic:
\`\`\`c
InitCpuTimers();                          // once, before any ConfigCpuTimer
ConfigCpuTimer(&CpuTimer0, 200, 10000);   // 200 MHz clock, 10000 microseconds
CpuTimer0Regs.TCR.all = 0x4000;           // start the timer
\`\`\`
The second argument is the clock frequency in **MHz**, the third is the period in **microseconds**. The function sets \`PRD\` = frequency x period - 1 (here 200 x 10000 - 1 = 1999999), sets the prescaler to 0, and leaves the timer **stopped**. The last line starts it.
`,
      questions: [
        {
          prompt: "What does the prescaler (`TDDRH:TDDR`) decide?",
          options: [
            "How many ticks make one period",
            "How many clock cycles make one tick of the counter",
            "Whether the timer counts up or down",
            "Which of the three timers is used",
          ],
          answer: 1,
          why: "The counter moves once every TDDRH:TDDR + 1 clock cycles. The number of ticks per period comes from PRD.",
        },
        {
          prompt: "The prescaler is 0 and `PRD` = 9. How long is one period?",
          options: ["9 clock cycles (45 ns)", "10 clock cycles (50 ns)", "11 clock cycles (55 ns)", "5 ns"],
          answer: 1,
          why: "The counter goes 9, 8, ... 1, 0 and then reloads: PRD + 1 = 10 cycles of 5 ns.",
        },
        {
          prompt: "Which call gives CPU Timer 1 a period of 20 ms?",
          options: [
            "`ConfigCpuTimer(&CpuTimer1, 200, 20);`",
            "`ConfigCpuTimer(&CpuTimer1, 20000, 200);`",
            "`ConfigCpuTimer(&CpuTimer1, 200, 20000);`",
            "`ConfigCpuTimer(&CpuTimer1, 5, 20000);`",
          ],
          answer: 2,
          why: "Frequency in MHz (200), then the period in microseconds: 20 ms = 20000 us. This is the line in the Lab 1 starter code.",
        },
      ],
      takeaway: "Period = (PRD + 1) x (prescaler + 1) x 5 ns. ConfigCpuTimer takes MHz and microseconds and leaves the timer stopped.",
    },
    {
      id: "tmr-period",
      kind: "calc",
      title: "Period and PRD",
      goal: "Convert between a period in time and the value in the period register.",
      refs: [{ trm: "3.8" }, { course: "Lab 1" }, { course: "Lab 2" }],
      brief: `
In this level the prescaler is 0, so the counter ticks on every clock cycle of **5 ns** (200 MHz).

- Period = (PRD + 1) x 5 ns
- PRD = period x 200 000 000 - 1, with the period in seconds
- \`ConfigCpuTimer(&CpuTimer0, 200, us)\` writes PRD = 200 x us - 1

Lab 2 asks for the longest period a CPU timer can have. \`PRD\` is a 32-bit unsigned number, so its largest value is 2^32 - 1 = 4294967295.
`,
      fields: [
        { id: "a", label: "PRD for a period of 1 ms", answer: 199999, why: "1 ms is 200000 clock cycles of 5 ns. PRD is one less: 199999." },
        {
          id: "b",
          label: "PRD after ConfigCpuTimer(&CpuTimer0, 200, 10000);",
          answer: 1999999,
          why: "200 x 10000 - 1 = 1999999. That is a period of 10 ms, the timer 0 setting of the Lab 1 starter code.",
        },
        { id: "c", label: "Period when PRD = 49999", unit: "ms", answer: 0.25, tolPct: 0.5, why: "(49999 + 1) x 5 ns = 250000 ns = 0.25 ms." },
        {
          id: "d",
          label: "Longest possible period (PRD = 4294967295)",
          unit: "s",
          answer: 21.47,
          tolPct: 1,
          why: "2^32 x 5 ns = 21.47 s. For anything longer, use the prescaler or count periods in a variable.",
        },
      ],
      hints: [
        "First find the number of 5 ns clock cycles in the period, then subtract 1 to get PRD.",
        "1 ms = 1 000 000 ns, and 1 000 000 / 5 = 200000 cycles.",
        "For the longest period: 4294967296 cycles x 5 ns. Divide 4294967296 by 200 000 000.",
      ],
      takeaway: "At 200 MHz with no prescaler, a CPU timer can time anything from 5 ns to about 21.5 s.",
    },
    {
      id: "tmr-prescale",
      kind: "calc",
      title: "Stretch the tick",
      goal: "Use the prescaler to make the counter tick in convenient units.",
      refs: [{ trm: "3.8" }, { course: "L2" }],
      brief: `
The counter ticks once every \`TDDRH:TDDR + 1\` clock cycles. To make a tick N clock cycles long, write **N - 1** to the prescaler.

\`TDDRH:TDDR\` is one 16-bit number stored in two places: the low 8 bits in \`CpuTimer0Regs.TPR.bit.TDDR\`, the high 8 bits in \`CpuTimer0Regs.TPRH.bit.TDDRH\`.

**Period = (PRD + 1) x (TDDRH:TDDR + 1) x 5 ns**

Example: with the prescaler at 199, a tick is 200 clock cycles. \`PRD\` then counts in round numbers instead of in units of 5 ns.

\`ConfigCpuTimer\` always sets the prescaler to 0. To use it, write \`TPR\` and \`TPRH\` yourself after the call.
`,
      fields: [
        { id: "a", label: "Length of one tick when TDDRH:TDDR = 199", unit: "us", answer: 1, why: "200 clock cycles x 5 ns = 1000 ns = 1 microsecond." },
        {
          id: "b",
          label: "PRD for a period of 1 s with that 1 us tick",
          answer: 999999,
          why: "1 s is 1 000 000 ticks of 1 us, and PRD is one less. PRD now reads directly as microseconds minus 1.",
        },
        {
          id: "c",
          label: "TDDRH:TDDR for a tick of 0.1 ms, as hex",
          format: "hex",
          answer: 0x4e1f,
          why: "0.1 ms is 20000 clock cycles, so the prescaler is 19999 = 0x4E1F: TDDRH = 0x4E and TDDR = 0x1F.",
        },
        {
          id: "d",
          label: "Longest period with the largest prescaler (0xFFFF) and the largest PRD",
          unit: "days",
          answer: 16.29,
          tolPct: 2,
          why: "2^32 x 65536 x 5 ns = 1 407 375 s, a little over 16 days.",
        },
      ],
      hints: [
        "A tick lasts (prescaler + 1) x 5 ns.",
        "For a 0.1 ms tick: 100 000 ns / 5 ns = 20000 cycles, so write 19999. Convert that to hex.",
        "Longest: 4294967296 x 65536 x 5 ns = 1 407 375 s. Divide by 86400 s per day.",
      ],
      takeaway: "The prescaler trades resolution for range: a longer tick gives longer periods, in coarser steps.",
    },
    {
      id: "tmr-tcr",
      kind: "register",
      title: "Stop and reload",
      goal: "Set the timer control register so the timer stops and starts again from a full period.",
      refs: [{ trm: "3.8" }, { course: "L2" }],
      brief: `
\`TCR\` is the control register of a CPU timer. Its fields:

- \`TSS\` (bit 4), timer stop status: 1 stops the timer, 0 lets it run. After reset it is 0, so the timers run from power-up.
- \`TRB\` (bit 5), timer reload: writing 1 loads \`TIM\` from \`PRD\` (and restarts the prescaler). It always reads back as 0.
- \`TIE\` (bit 14): 1 enables the timer's interrupt request.
- \`TIF\` (bit 15): the flag. The timer sets it when the counter reaches 0. You clear it by **writing 1** to it. Writing 0 does nothing.
- \`FREE\` and \`SOFT\` (bits 11 and 10) only matter while debugging: they choose whether the timer keeps running when the program halts at a breakpoint.

Right now the timer is **running** with its interrupt enabled (\`0x4000\`). You are about to change its period, so build the value to write that:

- **stops** the timer
- **reloads** the counter from \`PRD\`
- keeps \`TIE\` at 1 and leaves the flag alone
`,
      reg: "CpuTimer0Regs.TCR",
      initial: 0x4000,
      targets: [
        { field: "TSS", value: 1 },
        { field: "TRB", value: 1 },
      ],
      code: "CpuTimer0Regs.TCR.bit.TSS = 1;   // stop\nCpuTimer0Regs.TCR.bit.TRB = 1;   // reload TIM from PRD\n// or in one write: CpuTimer0Regs.TCR.all = 0x4030;\n// ConfigCpuTimer does exactly this after it writes PRD.",
      hints: [
        "Two bits change. The table under the bits shows where each field is.",
        "TSS is bit 4 and TRB is bit 5. Switch both on.",
        "The value is 0x4030.",
      ],
      takeaway: "A new PRD only reaches the counter at the next reload. Stop, write PRD, set TRB, then start again with TSS = 0.",
    },
    {
      id: "tmr-poll",
      kind: "code",
      mode: "complete",
      title: "Watch the flag",
      goal: "Toggle LED1 every 100 ms by checking the timer's flag instead of waiting with DELAY_US.",
      refs: [{ trm: "3.8" }, { course: "Lab 1" }, { course: "L2" }],
      brief: `
Each time the counter reaches 0, the timer sets its flag: \`CpuTimer0Regs.TCR.bit.TIF\` becomes 1. The flag **stays** 1 until your code clears it, and you clear it by **writing 1** to it:
\`\`\`c
if (CpuTimer0Regs.TCR.bit.TIF == 1) {
    CpuTimer0Regs.TCR.bit.TIF = 1;   // clear the flag: ready for the next period
    // the work to do once per period
}
\`\`\`
Checking a flag over and over like this is called **polling**.

Compare this with \`DELAY_US\`. A delay holds the CPU inside the wait, and the time your own code takes is added on top, so the rate drifts. Here the timer keeps counting on its own. The loop only glances at the flag, and is free to do other work between two flags.

## Your task
1. Give CPU Timer 0 a period of **100 ms** with \`ConfigCpuTimer\` (frequency in MHz, period in microseconds).
2. Start the timer: \`CpuTimer0Regs.TCR.all = 0x4000;\`
3. In the loop, when the flag is set: clear it and toggle LED1 (GPIO22).

LED1 changes every 100 ms, so it blinks with a period of 200 ms.

\`ConfigCpuTimer\` and \`0x4000\` also set \`TIE\`, the interrupt enable. That does nothing yet: interrupts are switched off globally until the next chapter.
`,
      kit: "robot",
      durationMs: 1000,
      starter: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    // TODO 1: configure CPU Timer 0 for a period of 100 ms

    // TODO 2: start the timer

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            // TODO 3: clear the flag by writing 1 to it, then toggle LED1

        }
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 100000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    }
}
`,
      checks: [
        {
          kind: "blink",
          led: "LED1",
          periodMs: 200,
          label: "LED1 blinks with a 200 ms period",
          hint: "If the LED changes far too fast, the flag is not being cleared. If it never changes, check that the timer was started.",
        },
        {
          kind: "reg",
          reg: "CpuTimer0Regs.PRD",
          equals: 19999999,
          label: "Timer 0 is set to 100 ms (PRD = 19999999)",
          hint: "100 ms is 100000 microseconds, and the clock is 200 MHz.",
        },
        { kind: "reg", reg: "CpuTimer0Regs.TCR", field: "TSS", equals: 0, label: "Timer 0 is running" },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timer does the waiting, not DELAY_US" },
      ],
      inspect: ["CpuTimer0Regs.TIM", "CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR"],
      hints: [
        "100 ms is 100000 microseconds. The first argument is the address of the timer's variable: `&CpuTimer0`.",
        "`ConfigCpuTimer(&CpuTimer0, 200, 100000);` then `CpuTimer0Regs.TCR.all = 0x4000;`",
        "Inside the if: `CpuTimer0Regs.TCR.bit.TIF = 1;` and `GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;`",
      ],
      takeaway: "The timer sets TIF once per period and your code clears it by writing 1. The timing no longer depends on how long your loop takes.",
    },
    {
      id: "tmr-units",
      kind: "code",
      mode: "debug",
      title: "A thousand times too fast",
      goal: "LED1 should change every 250 ms. It looks permanently half lit. Fix the timer setup.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { trm: "3.8" }],
      brief: `
The author wanted LED1 to change every **250 ms**, which is a blink period of 500 ms. On the board the LED just glows dimly, and the scope shows it switching thousands of times a second.

The polling loop is correct. The problem is in the timer setup. Check each argument of \`ConfigCpuTimer\` against what the function expects:

- the timer: \`&CpuTimer0\`
- the clock frequency in **MHz**
- the period in **microseconds**

Lab 2 asks for the same period, 0.25 seconds, for CPU Timer 2.
`,
      kit: "robot",
      durationMs: 2000,
      starter: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 250);   // 250 ms
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 250000);   // 250 ms = 250000 us
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    }
}
`,
      checks: [
        {
          kind: "blink",
          led: "LED1",
          periodMs: 500,
          label: "LED1 blinks with a 500 ms period",
          hint: "Compare the measured period with 500 ms. The ratio tells you which unit is wrong.",
        },
        {
          kind: "reg",
          reg: "CpuTimer0Regs.PRD",
          equals: 49999999,
          label: "Timer 0 is set to 250 ms (PRD = 49999999)",
          hint: "PRD = 200 x (period in microseconds) - 1.",
        },
      ],
      inspect: ["CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR"],
      hints: [
        "The LED blinks exactly 1000 times too fast. Which unit conversion is a factor of 1000?",
        "The third argument is in microseconds, not milliseconds.",
        "`ConfigCpuTimer(&CpuTimer0, 200, 250000);`",
      ],
      takeaway: "ConfigCpuTimer takes MHz and microseconds. When a rate is off by a round factor such as 1000, look for a unit mistake first.",
    },
    {
      id: "tmr-flag",
      kind: "code",
      mode: "debug",
      title: "The flag that would not clear",
      goal: "GPIO22 should switch every 1 ms, but after the first period it switches on every pass of the loop. Fix it.",
      refs: [{ trm: "3.8" }, { course: "L2" }],
      brief: `
This program should produce a **500 Hz** square wave on GPIO22 (LED1): the pin switches every **1 ms**, a period of 2 ms. That is too fast to see, so use the scope. Run it and look at the trace: nothing happens for the first 1 ms, and then the pin switches as fast as the loop can run.

So the timer period is right, and the flag does get set. Look at what happens to the flag afterwards.

\`TIF\` is a **write-1-to-clear** bit. The reference manual lists it as "Writes of 0 are ignored" and "Writing a 1 to this bit clears the flag". Many flags on this chip work this way, so a write that only means to touch other bits of the register cannot wipe out an event by accident.
`,
      kit: "robot",
      durationMs: 8,
      starter: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 0;   // clear the flag
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;   // clear the flag: write 1
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
    }
}
`,
      checks: [
        {
          kind: "blink",
          led: "LED1",
          periodMs: 2,
          label: "GPIO22 switches every 1 ms (a 2 ms period)",
          hint: "A period shown as 0 ms means the pin switches on every pass of the loop: the if is always true, so the flag is still 1.",
        },
        { kind: "pin", pin: 22, at: 0.9, level: 0, label: "GPIO22 is still low just before the first period ends" },
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 199999, label: "Timer 0 is still set to 1 ms (PRD = 199999)" },
      ],
      inspect: ["CpuTimer0Regs.TCR", "CpuTimer0Regs.TIM"],
      hints: [
        "The flag is set once after 1 ms and then stays set. Which line is supposed to clear it?",
        "Writing 0 to TIF is ignored. The flag is cleared by writing 1.",
        "`CpuTimer0Regs.TCR.bit.TIF = 1;`",
      ],
      takeaway: "Status flags are usually cleared by writing 1, not 0. If an event seems to fire non-stop, check how its flag is cleared.",
    },
    {
      id: "tmr-two",
      kind: "code",
      mode: "checkpoint",
      title: "Two rates, one loop",
      goal: "Blink LED1 from CPU Timer 0 and the red LaunchPad LED from CPU Timer 1, each at its own rate.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { trm: "3.8" }],
      brief: `
With \`DELAY_US\`, two different blink rates in one loop is awkward. With timers it is two flags.

- **LED1** (GPIO22): change every **100 ms**, timed by **CPU Timer 0**. Blink period 200 ms.
- **Red LaunchPad LED** (GPIO34): change every **250 ms**, timed by **CPU Timer 1**. Blink period 500 ms.

Poll both flags in the same \`while (1)\` loop. Each timer has its own registers: \`CpuTimer0Regs\` and \`CpuTimer1Regs\`.

Set the timers up either way:
- with \`InitCpuTimers();\`, \`ConfigCpuTimer(...)\` and \`TCR.all = 0x4000;\`, or
- directly: stop the timer (\`TCR.bit.TSS = 1\`), write \`PRD.all\`, clear \`TPR.all\` and \`TPRH.all\`, reload (\`TCR.bit.TRB = 1\`), start (\`TCR.bit.TSS = 0\`).

Do not use \`DELAY_US\`.
`,
      kit: "robot",
      durationMs: 2000,
      starter: `void main(void)
{
${INIT}

${out(22)}
${out(34)}

    // Set up CPU Timer 0 (100 ms) and CPU Timer 1 (250 ms), then start both

    while (1) {
        // Timer 0 flag: clear it and toggle LED1

        // Timer 1 flag: clear it and toggle the red LED
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}
${out(34)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 100000);
    ConfigCpuTimer(&CpuTimer1, 200, 250000);
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer1Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
        if (CpuTimer1Regs.TCR.bit.TIF == 1) {
            CpuTimer1Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;
        }
    }
}
`,
      checks: [
        {
          kind: "blink",
          led: "LED1",
          periodMs: 200,
          label: "LED1 blinks with a 200 ms period",
          hint: "LED1 follows CPU Timer 0, which needs a period of 100 ms.",
        },
        {
          kind: "blink",
          led: "RED",
          periodMs: 500,
          label: "The red LED blinks with a 500 ms period",
          hint: "The red LED follows CPU Timer 1, which needs a period of 250 ms. GPIO34 is in port B.",
        },
        {
          kind: "reg",
          reg: "CpuTimer0Regs.PRD",
          equals: 19999999,
          label: "Timer 0 has a 100 ms period (PRD = 19999999)",
          hint: "PRD = 100 ms / 5 ns - 1, or let ConfigCpuTimer compute it from 100000 microseconds.",
        },
        {
          kind: "reg",
          reg: "CpuTimer1Regs.PRD",
          equals: 49999999,
          label: "Timer 1 has a 250 ms period (PRD = 49999999)",
          hint: "PRD = 250 ms / 5 ns - 1, or let ConfigCpuTimer compute it from 250000 microseconds.",
        },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timers do the waiting, not DELAY_US" },
        { kind: "no-dat-write", label: "Outputs are changed through SET, CLEAR or TOGGLE" },
      ],
      inspect: ["CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR", "CpuTimer1Regs.PRD", "CpuTimer1Regs.TCR"],
      hints: [
        "Write the timer 0 part first, exactly as in the earlier levels, and test it. Then copy it for timer 1 and change the names.",
        "`ConfigCpuTimer(&CpuTimer0, 200, 100000);` and `ConfigCpuTimer(&CpuTimer1, 200, 250000);`, then write 0x4000 to each TCR.",
        "Two separate ifs in the loop: one tests and clears `CpuTimer0Regs.TCR.bit.TIF`, the other `CpuTimer1Regs.TCR.bit.TIF`. The red LED toggles through `GPBTOGGLE`.",
      ],
      takeaway: "Each timer keeps its own time, so one loop can serve several rates. Interrupts, next, remove even the polling.",
    },
  ],
};
