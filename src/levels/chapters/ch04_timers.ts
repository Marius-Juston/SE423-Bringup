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
      goal: "Learn how a CPU timer turns the 200 MHz clock into a period you choose, then answer three questions.",
      refs: [{ trm: "3.8" }, { trm: "3.7" }, { course: "L2" }, { course: "Lab 1" }],
      brief: `
\`DELAY_US\` keeps the CPU busy doing nothing, and the time your own code takes is added on top. A **timer** keeps time on its own, in hardware, while your program does other things.

A timer is a **counter driven by a clock**. The chip's system clock, called SYSCLK, beats 200 million times per second (200 MHz). One beat, a **clock cycle**, lasts 1 / 200 000 000 s = **5 ns**. Counting cycles is measuring time.

## How a CPU timer counts
The chip has three identical 32-bit timers: \`CpuTimer0Regs\`, \`CpuTimer1Regs\` and \`CpuTimer2Regs\`. Each has a counter register \`TIM\` and a period register \`PRD\`:

1. \`TIM\` is loaded with the value in \`PRD\`.
2. \`TIM\` counts **down** by one on every clock cycle.
3. When \`TIM\` reaches 0, the timer sets its **flag** \`TIF\`. A flag is one bit that hardware sets to say "this happened". Then it loads \`TIM\` from \`PRD\` again.

Counting from \`PRD\` down to 0 and reloading takes \`PRD + 1\` cycles:

**Period = (PRD + 1) x 5 ns**

Example: \`PRD\` = 1999 gives 2000 cycles x 5 ns = 10 000 ns = 10 us.

{{figure:timer-sawtooth}}

Try it in the figure: change \`PRD\` and watch the period follow the formula. The figure also has a prescaler. Leave it at 0 for now.

## The helper function
You rarely write \`PRD\` yourself. TI's function does the arithmetic:
\`\`\`c
InitCpuTimers();                          // once, before any ConfigCpuTimer
ConfigCpuTimer(&CpuTimer0, 200, 10000);   // 200 MHz clock, 10000 microseconds
CpuTimer0Regs.TCR.all = 0x4000;           // start the timer
\`\`\`
\`CpuTimer0\` is a struct variable in which TI's code keeps notes about timer 0, and \`&CpuTimer0\` passes its address. The second argument is the clock frequency in **MHz**, the third is the period in **microseconds**. The function sets \`PRD\` = frequency x period - 1 (here 200 x 10000 - 1 = 1999999) and leaves the timer **stopped**. The last line starts it. You built that value in chapter 1: bit 14 on, everything else 0.
`,
      questions: [
        {
          prompt: "What happens when the counter `TIM` reaches 0?",
          options: [
            "The timer stops until the program starts it again",
            "`TIM` keeps counting down into negative numbers",
            "The program is restarted",
            "The flag `TIF` is set and `TIM` is loaded from `PRD` again",
          ],
          answer: 3,
          why: "The timer never stops by itself. It marks the end of each period by setting TIF, reloads and keeps counting.",
        },
        {
          prompt: "`PRD` = 9. How long is one period?",
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
      takeaway: "Period = (PRD + 1) x 5 ns. ConfigCpuTimer takes MHz and microseconds and leaves the timer stopped.",
    },
    {
      id: "tmr-period",
      kind: "calc",
      title: "Period and PRD",
      goal: "Convert between a period in time and the value in the period register.",
      refs: [{ trm: "3.8" }, { course: "Lab 1" }, { course: "Lab 2" }],
      brief: `
The counter moves on every clock cycle of **5 ns** (200 MHz). Three ways to say the same thing:

- Period = (PRD + 1) x 5 ns
- PRD = (period / 5 ns) - 1. Example: 10 us is 10 000 ns, and 10 000 / 5 = 2000 cycles, so PRD = 1999.
- \`ConfigCpuTimer(&CpuTimer0, 200, us)\` writes PRD = 200 x us - 1, because 1 us is 200 cycles. Example: 10 us gives 200 x 10 - 1 = 1999, the same number.

Keep the units straight: 1 s = 1000 ms, 1 ms = 1000 us, 1 us = 1000 ns.

How long can a period be? \`PRD\` is a 32-bit unsigned number, so its largest value is 2^32 - 1 = 4294967295.
`,
      fields: [
        { id: "a", label: "PRD for a period of 1 ms", answer: 199999, why: "1 ms is 200000 clock cycles of 5 ns. PRD is one less: 199999." },
        {
          id: "b",
          label: "PRD after ConfigCpuTimer(&CpuTimer0, 200, 10000);",
          answer: 1999999,
          why: "200 x 10000 - 1 = 1999999. That is a period of 10 ms, the timer 0 setting of the course starter code.",
        },
        { id: "c", label: "Period when PRD = 49999", unit: "ms", answer: 0.25, tolPct: 0.5, why: "(49999 + 1) x 5 ns = 250000 ns = 0.25 ms." },
        {
          id: "d",
          label: "Longest possible period (PRD = 4294967295)",
          unit: "s",
          answer: 21.47,
          tolPct: 1,
          why: "2^32 x 5 ns = 21.47 s. For anything longer, count periods in a variable or use the prescaler of the next level.",
        },
      ],
      hints: [
        "First find the number of 5 ns clock cycles in the period, then subtract 1 to get PRD.",
        "1 ms = 1 000 000 ns, and 1 000 000 / 5 = 200000 cycles.",
        "For the longest period: 4294967296 cycles x 5 ns. Divide 4294967296 by 200 000 000.",
      ],
      takeaway: "At 200 MHz a CPU timer can time anything from 5 ns to about 21.5 s.",
    },
    {
      id: "tmr-prescale",
      kind: "calc",
      title: "Stretch the tick",
      goal: "Use the prescaler to make the counter tick in convenient units.",
      refs: [{ trm: "3.8" }, { course: "L2" }],
      brief: `
So far \`TIM\` moved on every clock cycle, and the longest period was about 21 s. In front of the counter sits a second, smaller counter, the **prescaler**. It lets one step of \`TIM\`, called a **tick**, last several clock cycles:

- The prescaler sets **how long one tick is**: its value + 1 clock cycles. To make a tick N cycles long, write **N - 1**.
- \`PRD\` sets **how many ticks** make a period.

The prescaler value is one 16-bit number stored in two 8-bit fields: the low byte in \`CpuTimer0Regs.TPR.bit.TDDR\`, the high byte in \`CpuTimer0Regs.TPRH.bit.TDDRH\`. The manual writes the pair as \`TDDRH:TDDR\`.

{{figure:timer-sawtooth}}

Try it in the figure: raise the prescaler and watch each step of the counter get longer.

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
          label: "TDDRH:TDDR for a tick of 0.1 ms",
          answer: 19999,
          why: "0.1 ms is 100 000 ns, which is 20000 clock cycles, so the prescaler is 19999. In hex that is 0x4E1F: the high byte 0x4E goes in TDDRH and the low byte 0x1F in TDDR.",
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
        "For a 0.1 ms tick: 100 000 ns / 5 ns = 20000 cycles, and the prescaler is one less.",
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
- \`TRB\` (bit 5), timer reload: writing 1 loads \`TIM\` from \`PRD\` at once (and restarts the prescaler). It always reads back as 0.
- \`TIE\` (bit 14): 1 enables the timer's interrupt request.
- \`TIF\` (bit 15): the flag. The timer sets it when the counter reaches 0. You clear it by **writing 1** to it. Writing 0 does nothing.
- \`FREE\` and \`SOFT\` (bits 11 and 10) only matter when a debugger pauses the program. Leave them at 0.

In the figure, open **More controls** to stop the timer (TSS), reload it (TRB) and clear its flag (TIF).

{{figure:timer-sawtooth}}

Try it in the figure: stop the timer with **TSS = 1, stopped**, press **+1 clock cycle** to see that it no longer counts, then press **write TRB = 1** and see where the counter starts again.

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
Checking a flag over and over like this is called **polling**. The course never polls a timer: its programs always use the timer's **interrupt** (chapter 5), and polling is shown here so that you see the flag itself.

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
          hint: "If the LED changes far too fast (a period near 0 ms), the flag is not being cleared: write 1 to TIF, not 0. If it never changes, check that the timer was started and that the toggle line is inside the if.",
        },
        {
          kind: "reg",
          reg: "CpuTimer0Regs.PRD",
          equals: 19999999,
          label: "Timer 0 is set to 100 ms (PRD = 19999999)",
          hint: "`ConfigCpuTimer(&CpuTimer0, 200, 100000);`: 200 for the 200 MHz clock, then 100 ms written in microseconds. `InitCpuTimers();` must stay on the line before it, or ConfigCpuTimer writes nothing.",
        },
        { kind: "reg", reg: "CpuTimer0Regs.TCR", field: "TSS", equals: 0, label: "Timer 0 is running", hint: "ConfigCpuTimer leaves the timer stopped. TODO 2 starts it: `CpuTimer0Regs.TCR.all = 0x4000;`, after the ConfigCpuTimer line." },
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
      goal: "LED1 should change every 400 ms. It looks permanently half lit. Fix the timer setup.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { trm: "3.8" }],
      brief: `
The author wanted LED1 to change every **400 ms**, which is a blink period of 800 ms. On the board the LED just glows dimly, and the scope shows it switching thousands of times a second.

The polling loop is correct. The problem is in the timer setup. Check each argument of \`ConfigCpuTimer\` against what the function expects:

- the timer: \`&CpuTimer0\`
- the clock frequency in **MHz**
- the period in **microseconds**

Lab 2 has you set a period like this for CPU Timer 2.
`,
      kit: "robot",
      durationMs: 3300,
      starter: `void main(void)
{
${INIT}

${out(22)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 400);   // 400 ms
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
    ConfigCpuTimer(&CpuTimer0, 200, 400000);   // 400 ms = 400000 us
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
          periodMs: 800,
          label: "LED1 blinks with an 800 ms period",
          hint: "Compare the measured period with 800 ms. The ratio tells you which unit is wrong.",
        },
        {
          kind: "reg",
          reg: "CpuTimer0Regs.PRD",
          equals: 79999999,
          label: "Timer 0 is set to 400 ms (PRD = 79999999)",
          hint: "PRD = 200 x (period in microseconds) - 1.",
        },
      ],
      inspect: ["CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR"],
      hints: [
        "The LED blinks exactly 1000 times too fast. Which unit conversion is a factor of 1000?",
        "The third argument is in microseconds, not milliseconds.",
        "`ConfigCpuTimer(&CpuTimer0, 200, 400000);`",
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
This program should produce a **500 Hz** square wave on GPIO22 (LED1). A square wave is a signal that switches between low and high at a steady rate. Here the pin switches every **1 ms**, a period of 2 ms. That is too fast to see, so use the scope. Run it and look at the trace: nothing happens for the first 1 ms, and then the pin switches as fast as the loop can run.

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

Set the timers up as before: \`InitCpuTimers();\` once, then for each timer \`ConfigCpuTimer(...)\` and \`TCR.all = 0x4000;\`.

For the two stars, do it without the helpers. For each timer: stop it (\`TCR.bit.TSS = 1\`), write \`PRD.all\`, set the prescaler to 0 (\`TPR.all = 0\` and \`TPRH.all = 0\`), reload (\`TCR.bit.TRB = 1\`), start (\`TCR.bit.TSS = 0\`).

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

    // Timer 0: 100 ms = 20000000 clock cycles of 5 ns
    CpuTimer0Regs.TCR.bit.TSS = 1;     // stop
    CpuTimer0Regs.PRD.all = 19999999;
    CpuTimer0Regs.TPR.all = 0;         // no prescaler
    CpuTimer0Regs.TPRH.all = 0;
    CpuTimer0Regs.TCR.bit.TRB = 1;     // load TIM from PRD

    // Timer 1: 250 ms = 50000000 clock cycles
    CpuTimer1Regs.TCR.bit.TSS = 1;
    CpuTimer1Regs.PRD.all = 49999999;
    CpuTimer1Regs.TPR.all = 0;
    CpuTimer1Regs.TPRH.all = 0;
    CpuTimer1Regs.TCR.bit.TRB = 1;

    // Start both
    CpuTimer0Regs.TCR.bit.TSS = 0;
    CpuTimer1Regs.TCR.bit.TSS = 0;

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
          hint: "LED1 follows CPU Timer 0, which needs a period of 100 ms. Each flag needs its own if, and each if must clear its own timer's TIF.",
        },
        {
          kind: "blink",
          led: "RED",
          periodMs: 500,
          label: "The red LED blinks with a 500 ms period",
          hint: "The red LED follows CPU Timer 1, which needs a period of 250 ms: `ConfigCpuTimer(&CpuTimer1, 200, 250000);` and `CpuTimer1Regs.TCR.all = 0x4000;`. Test and clear `CpuTimer1Regs.TCR.bit.TIF`. GPIO34 is in port B.",
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
      bonus: [
        {
          kind: "source",
          mustNotMatch: "ConfigCpuTimer|InitCpuTimers",
          label: "Registers only: both timers are set up without InitCpuTimers and ConfigCpuTimer",
          hint: "For each timer: TSS = 1, write PRD.all, clear TPR.all and TPRH.all, TRB = 1. Then TSS = 0 to start.",
        },
        {
          kind: "reg",
          reg: "CpuTimer1Regs.TCR",
          field: "TIE",
          equals: 0,
          label: "Timer 1 does not ask for an interrupt (TIE = 0): the loop polls the flags",
          hint: "ConfigCpuTimer and TCR.all = 0x4000 both set TIE. Single-bit writes to TSS and TRB leave it at 0.",
        },
      ],
      inspect: ["CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR", "CpuTimer1Regs.PRD", "CpuTimer1Regs.TCR"],
      hints: [
        "Write the timer 0 part first, exactly as in the earlier levels, and test it. Then copy it for timer 1 and change the names.",
        "`ConfigCpuTimer(&CpuTimer0, 200, 100000);` and `ConfigCpuTimer(&CpuTimer1, 200, 250000);`, then write 0x4000 to each TCR.",
        "Two separate ifs in the loop: one tests and clears `CpuTimer0Regs.TCR.bit.TIF`, the other `CpuTimer1Regs.TCR.bit.TIF`. The red LED toggles through `GPBTOGGLE`.",
      ],
      takeaway: "Each timer keeps its own time, so one loop can serve several rates. Interrupts, next, remove even the polling.",
    },
    {
      id: "tmr-raw",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "By hand, with a prescaler",
      goal: "Set up CPU Timer 1 with register writes only, prescaler included, and toggle LED2 every 50 ms.",
      refs: [{ trm: "3.8" }, { course: "L2" }, { course: "Lab 2" }],
      brief: `
\`ConfigCpuTimer\` always sets the prescaler to 0. This time you write the registers yourself and use the prescaler, so no helper function: no \`InitCpuTimers\`, no \`ConfigCpuTimer\`.

## The target
- One tick of **0.1 ms**: 20000 clock cycles of 5 ns. The prescaler value is one less, 19999 = \`0x4E1F\`.
- A period of **50 ms**: 500 ticks, so \`PRD\` = 499.
- **LED2** (GPIO94) changes on every period: a blink period of 100 ms.

The 16-bit prescaler value is split over two fields: the low byte goes in \`CpuTimer1Regs.TPR.bit.TDDR\`, the high byte in \`CpuTimer1Regs.TPRH.bit.TDDRH\`.

## The order
After reset the timers are already running, with \`PRD\` at its largest value. So:

1. Stop the timer: \`TCR.bit.TSS = 1\`
2. Write the prescaler and \`PRD.all\`
3. Reload: \`TCR.bit.TRB = 1\` loads \`TIM\` from \`PRD\` and restarts the prescaler
4. Start: \`TCR.bit.TSS = 0\`

Then poll the flag of **Timer 1** in the loop, as before.
`,
      kit: "robot",
      durationMs: 500,
      inspect: ["CpuTimer1Regs.TPR", "CpuTimer1Regs.TPRH", "CpuTimer1Regs.PRD", "CpuTimer1Regs.TCR", "CpuTimer1Regs.TIM"],
      starter: `void main(void)
{
${INIT}

${out(94)}

    // CPU Timer 1 by hand: stop, prescaler, PRD, reload, start

    while (1) {
        // Timer 1 flag: clear it and toggle LED2
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(94)}

    CpuTimer1Regs.TCR.bit.TSS = 1;         // stop while the settings change
    CpuTimer1Regs.TPR.bit.TDDR = 0x1F;     // prescaler 19999 = 0x4E1F, low byte
    CpuTimer1Regs.TPRH.bit.TDDRH = 0x4E;   // high byte: one tick is 0.1 ms
    CpuTimer1Regs.PRD.all = 499;           // 500 ticks = 50 ms
    CpuTimer1Regs.TCR.bit.TRB = 1;         // load TIM from PRD
    CpuTimer1Regs.TCR.bit.TSS = 0;         // start

    while (1) {
        if (CpuTimer1Regs.TCR.bit.TIF == 1) {
            CpuTimer1Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;
        }
    }
}
`,
      checks: [
        {
          kind: "blink",
          led: "LED2",
          periodMs: 100,
          label: "LED2 blinks with a 100 ms period",
          hint: "If nothing happens, the counter was not reloaded: without TRB it is still counting down from its reset value.",
        },
        { kind: "reg", reg: "CpuTimer1Regs.TPR", field: "TDDR", equals: 0x1f, label: "TDDR is 0x1F, the low byte of 19999", hint: "19999 is 0x4E1F. The low byte is 0x1F." },
        { kind: "reg", reg: "CpuTimer1Regs.TPRH", field: "TDDRH", equals: 0x4e, label: "TDDRH is 0x4E, the high byte of 19999", hint: "The high byte of 0x4E1F goes in TPRH.bit.TDDRH." },
        { kind: "reg", reg: "CpuTimer1Regs.PRD", equals: 499, label: "PRD is 499: 500 ticks of 0.1 ms", hint: "PRD counts ticks now, not clock cycles." },
        { kind: "reg", reg: "CpuTimer1Regs.TCR", field: "TSS", equals: 0, label: "Timer 1 is running" },
        { kind: "source", mustNotMatch: "ConfigCpuTimer|InitCpuTimers|DELAY_US", label: "No InitCpuTimers, ConfigCpuTimer or DELAY_US" },
      ],
      bonus: [
        {
          kind: "reg",
          reg: "CpuTimer1Regs.TCR",
          field: "TIE",
          equals: 0,
          label: "Timer 1 does not ask for an interrupt (TIE = 0): the loop polls the flag",
          hint: "Change TCR one bit at a time, or write a whole value with bit 14 at 0.",
        },
      ],
      hints: [
        "Split 0x4E1F: `CpuTimer1Regs.TPR.bit.TDDR = 0x1F;` and `CpuTimer1Regs.TPRH.bit.TDDRH = 0x4E;`",
        "Between stopping and starting: the two prescaler writes, `CpuTimer1Regs.PRD.all = 499;` and `CpuTimer1Regs.TCR.bit.TRB = 1;`",
        "The loop is the one you know, with CpuTimer1Regs: test TIF, write 1 to TIF, then `GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;`",
      ],
      takeaway: "Stop, write the prescaler and PRD, reload, start. With a 0.1 ms tick, PRD reads in round numbers and a 32-bit counter reaches 119 hours.",
    },
    {
      id: "tmr-count",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "One tick, two rhythms",
      goal: "From a single 1 ms timer, flash LED1 briefly twice a second and toggle LED2 every 100 ms.",
      refs: [{ trm: "3.8" }, { course: "Lab 1" }, { course: "Lab 2" }],
      brief: `
One timer can serve many rates. Let it tick at the fastest rate you need and **count the ticks**. Every slower rhythm is then a test on the count.

Lab 1 does the same with \`CpuTimer2.InterruptCount\` and the \`%\` operator. \`a % b\` is the remainder of a divided by b, so \`ms % 100 == 0\` is true once every 100 ticks.

## Your task
Use **CPU Timer 0 only**, with a period of **1 ms**.

- \`ms\` (a global \`Uint32\`, TI's older name for \`uint32_t\`) goes up by 1 on every period.
- **LED1** (GPIO22) is a heartbeat: lit while \`ms % 500\` is less than 50, dark otherwise. That is a 50 ms flash every half second.
- **LED2** (GPIO94) changes state every 100 ms, when \`ms % 100\` is 0.

Update the LEDs only when a tick has happened. No \`DELAY_US\`.
`,
      kit: "robot",
      durationMs: 1600,
      watch: ["ms"],
      starter: `Uint32 ms = 0;

void main(void)
{
${INIT}

${out(22)}
${out(94)}

    // Set up and start CPU Timer 0 with a period of 1 ms

    while (1) {
        // On every tick: count it, then update LED1 and LED2
    }
}
`,
      solution: `Uint32 ms = 0;

void main(void)
{
${INIT}

${out(22)}
${out(94)}

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            ms++;

            // Heartbeat: the first 50 ms of every 500 ms
            if (ms % 500 < 50) {
                GpioDataRegs.GPASET.bit.GPIO22 = 1;
            } else {
                GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
            }

            // Every 100 ms
            if (ms % 100 == 0) {
                GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;
            }
        }
    }
}
`,
      checks: [
        { kind: "var", name: "ms", at: 1500.5, min: 1499, max: 1501, label: "ms counts milliseconds: about 1500 after 1.5 s", hint: "Count once per flag, and clear the flag by writing 1 to it." },
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 199999, label: "Timer 0 has a 1 ms period (PRD = 199999)" },
        { kind: "led", led: "LED1", at: 520, on: true, label: "LED1 is lit at 520 ms, inside the flash" },
        { kind: "led", led: "LED1", at: 580, on: false, label: "LED1 is dark at 580 ms", hint: "The flash is 50 ms long: lit while ms % 500 is less than 50." },
        { kind: "led", led: "LED1", at: 1020, on: true, label: "LED1 is lit at 1020 ms, in the next flash" },
        { kind: "led", led: "LED1", at: 1300, on: false, label: "LED1 is dark at 1300 ms" },
        { kind: "duty", led: "LED1", pct: 10, tolPct: 0.5, from: 500, to: 1500, label: "LED1 is lit 10 % of the time" },
        { kind: "blink", led: "LED2", periodMs: 200, label: "LED2 blinks with a 200 ms period", hint: "Toggle LED2 only on the ticks where ms % 100 is 0." },
        { kind: "source", mustNotMatch: "CpuTimer[12]|DELAY_US", label: "Only CPU Timer 0 keeps the time" },
        { kind: "no-dat-write", label: "Outputs are changed through SET, CLEAR or TOGGLE" },
      ],
      hints: [
        "Set-up as before: `InitCpuTimers();`, `ConfigCpuTimer(&CpuTimer0, 200, 1000);`, `CpuTimer0Regs.TCR.all = 0x4000;`",
        "Everything goes inside the flag test: clear the flag, `ms++;`, then the two LED rules.",
        "`if (ms % 500 < 50) { SET LED1 } else { CLEAR LED1 }` and `if (ms % 100 == 0) { TOGGLE LED2 }`.",
      ],
      takeaway: "A tick counter turns one timer into as many rhythms as you like. It is also a clock: ms is the time since start.",
    },
    {
      id: "tmr-stopwatch",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Stopwatch",
      goal: "Measure the time from a press of PB1 to a press of PB2 in microseconds, by reading the counter of a timer that keeps reloading.",
      refs: [{ trm: "3.8" }, { course: "Lab 2" }, { course: "L2" }],
      brief: `
\`CpuTimer0Regs.TIM.all\` is the live counter. Read it twice and the difference is elapsed time, in clock cycles of 5 ns.

The starter runs CPU Timer 0 with a period of **10 ms** and toggles LED1 on every flag. That heartbeat must keep running, exactly as it is.

## Your task
- A press of **push button 1** (GPIO157) starts a measurement.
- The next press of **push button 2** (GPIO158) ends it. Store the time between the two presses in \`elapsed_us\`, in **microseconds**, accurate to 3 us.
- It must work again and again, for times from under 1 ms to over 50 ms.

## Limits
- Use CPU Timer 0 only. Do not stop it, reload it, or write to \`TIM\` or \`PRD\`.
- No \`DELAY_US\`.

Before you write code, answer three questions on paper. Which way does \`TIM\` count? What does it do when it reaches 0? How large can a number of clock cycles get, and which C type holds it on a chip where \`int\` is 16 bits?

The buttons in this level do not bounce.
`,
      kit: "robot",
      durationMs: 100,
      watch: ["elapsed_us"],
      inspect: ["CpuTimer0Regs.TIM", "CpuTimer0Regs.PRD", "CpuTimer0Regs.TCR"],
      starter: `Uint32 elapsed_us = 0;

void main(void)
{
${INIT}

${out(22)}

    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(158, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(158, GPIO_INPUT, GPIO_PULLUP);

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 10000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        // Heartbeat: LED1 changes every 10 ms. Keep it.
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }

        // Stopwatch: PB1 starts, PB2 stops, the result goes in elapsed_us
    }
}
`,
      solution: `Uint32 elapsed_us = 0;

void main(void)
{
    Uint32 start = 0;    // TIM at the press of PB1
    Uint32 stop = 0;     // TIM at the press of PB2
    Uint32 reloads = 0;  // times TIM reloaded since the press of PB1
    int16_t pb1 = 1;
    int16_t pb2 = 1;
    int16_t last1 = 1;
    int16_t last2 = 1;

${INIT}

${out(22)}

    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(158, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(158, GPIO_INPUT, GPIO_PULLUP);

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 10000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        // Heartbeat: LED1 changes every 10 ms. Each flag is also one reload.
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
            reloads++;
        }

        pb1 = GpioDataRegs.GPEDAT.bit.GPIO157;
        pb2 = GpioDataRegs.GPEDAT.bit.GPIO158;
        if (pb1 == 0 && last1 == 1) {
            start = CpuTimer0Regs.TIM.all;
            reloads = 0;
        }
        if (pb2 == 0 && last2 == 1) {
            stop = CpuTimer0Regs.TIM.all;
            // TIM counts down, so time passed is start - stop. Every reload
            // in between jumped TIM up by one period of 2000000 counts.
            // One microsecond is 200 counts.
            elapsed_us = (start + reloads * 2000000 - stop) / 200;
        }
        last1 = pb1;
        last2 = pb2;
    }
}
`,
      stimuli: [
        { at: 3, press: "PB1" },
        { at: 4, release: "PB1" },
        { at: 6.7, press: "PB2" },
        { at: 7.7, release: "PB2" },
        { at: 18.5, press: "PB1" },
        { at: 19.5, release: "PB1" },
        { at: 21.75, press: "PB2" },
        { at: 22.75, release: "PB2" },
        { at: 37.2, press: "PB1" },
        { at: 38.2, release: "PB1" },
        { at: 95.9, press: "PB2" },
        { at: 96.9, release: "PB2" },
      ],
      checks: [
        { kind: "var", name: "elapsed_us", at: 9, min: 3697, max: 3703, label: "3 ms to 6.7 ms, no reload in between: 3700 us", hint: "TIM counts down: the time passed is the first read minus the second, divided by 200 counts per microsecond." },
        {
          kind: "var",
          name: "elapsed_us",
          at: 24,
          min: 3247,
          max: 3253,
          label: "18.5 ms to 21.75 ms, across one reload: 3250 us",
          hint: "The counter reloaded at about 20 ms, so the second read is larger than the first. Add one full period, 2000000 counts, for every reload in between.",
        },
        {
          kind: "var",
          name: "elapsed_us",
          at: 98,
          min: 58697,
          max: 58703,
          label: "37.2 ms to 95.9 ms, across six reloads: 58700 us",
          hint: "Count the reloads between the two presses. Do the arithmetic in Uint32: these numbers do not fit in 16 bits.",
        },
        { kind: "blink", led: "LED1", periodMs: 20, tolPct: 0.5, label: "The heartbeat still changes LED1 every 10 ms" },
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 1999999, label: "Timer 0 still has its 10 ms period (PRD = 1999999)" },
        {
          kind: "source",
          mustNotMatch: "CpuTimer[12]Regs|DELAY_US|\\bTRB\\b|TIM\\.all\\s*=[^=]|PRD\\.all\\s*=[^=]",
          label: "Timer 0 is only read: no second timer, no reload, no write to TIM or PRD, no DELAY_US",
        },
      ],
      bonus: [
        {
          kind: "var",
          name: "elapsed_us",
          at: 6.702,
          min: 3697,
          max: 3703,
          label: "The result is ready within 2 microseconds of the press of PB2",
          hint: "Read TIM as soon as the press is seen, and keep the loop free of anything slow.",
        },
      ],
      hints: [
        "Detect the two presses as falling edges. Read `CpuTimer0Regs.TIM.all` into a Uint32 at each one.",
        "The heartbeat already sees every reload: each flag is one. Count the flags since the press of PB1.",
        "`elapsed_us = (start + reloads * 2000000 - stop) / 200;` with all three variables Uint32. One period is 2000000 counts and one microsecond is 200.",
      ],
      takeaway: "A free-running counter plus a count of its reloads measures any length of time without disturbing the timer. One gap is left: a reload that lands between the flag test and the TIM read is counted late. Hardware capture units close that gap by latching the count at the edge itself.",
    },
    {
      id: "tmr-lost",
      tier: "expert",
      kind: "code",
      mode: "debug",
      title: "The stopwatch that loses time",
      goal: "ms should count milliseconds while push button 1 is not held. It hardly counts at all. Find out why and fix it.",
      refs: [{ trm: "3.8" }, { course: "L2" }, { course: "Lab 2" }],
      brief: `
This stopwatch counts milliseconds in \`ms\` with CPU Timer 0. Holding **push button 1** pauses it: the program stops the timer with \`TSS\`, so the part of a millisecond already counted is kept, and starts it again on release.

The loop also has other things to do. \`OtherWork()\` stands for them: it takes 0.2 ms on every pass. It has to stay, called once per pass.

Run it. After 20 ms, \`ms\` should be 20. It is nowhere near.

Every line looks reasonable on its own. The flag is tested and cleared the right way. The period is right. Nobody is pressing the button.

Open \`TCR\` in the inspector, read how each of its bits behaves when written, and think about what a \`.bit\` write does to the **whole** register.

## What must hold after your fix
- \`ms\` counts every millisecond while the button is released.
- While the button is held, the timer is really stopped (\`TSS\` = 1) and \`ms\` does not move.
- No tick is lost when the button is pressed or released.
`,
      kit: "robot",
      durationMs: 61,
      watch: ["ms"],
      inspect: ["CpuTimer0Regs.TCR", "CpuTimer0Regs.TIM"],
      starter: `Uint32 ms = 0;   // running time in milliseconds

// Stands for the other work of the loop. Takes 0.2 ms.
void OtherWork(void)
{
    DELAY_US(200);
}

void main(void)
{
${INIT}

    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        OtherWork();

        // Hold push button 1 to pause the stopwatch
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            CpuTimer0Regs.TCR.bit.TSS = 1;
        } else {
            CpuTimer0Regs.TCR.bit.TSS = 0;
        }

        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            ms++;
        }
    }
}
`,
      solution: `Uint32 ms = 0;   // running time in milliseconds

// Stands for the other work of the loop. Takes 0.2 ms.
void OtherWork(void)
{
    DELAY_US(200);
}

void main(void)
{
${INIT}

    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        OtherWork();

        // Hold push button 1 to pause the stopwatch.
        // A .bit write reads all of TCR, changes one bit and writes all of
        // it back. If TIF reads 1, a 1 is written back to TIF, and writing
        // 1 clears the flag: the tick is lost. A whole-register write with
        // bit 15 at 0 leaves the flag alone, because writing 0 is ignored.
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            CpuTimer0Regs.TCR.all = 0x4010;   // TIE = 1, TSS = 1: stopped
        } else {
            CpuTimer0Regs.TCR.all = 0x4000;   // TIE = 1, TSS = 0: running
        }

        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            ms++;
        }
    }
}
`,
      stimuli: [
        { at: 22.5, press: "PB1" },
        { at: 42.5, release: "PB1" },
      ],
      checks: [
        { kind: "var", name: "ms", at: 20.5, equals: 20, label: "Running: ms is 20 after 20.5 ms", hint: "Ticks vanish between the moment the timer sets TIF and the moment the loop tests it. Which line in between writes to TCR?" },
        { kind: "var", name: "ms", at: 30, equals: 22, label: "Paused at 22.5 ms: ms stops at 22" },
        { kind: "var", name: "ms", at: 42, equals: 22, label: "Still paused at 42 ms: ms is still 22" },
        { kind: "reg", reg: "CpuTimer0Regs.TCR", field: "TSS", at: 30, equals: 1, label: "While PB1 is held the timer is stopped (TSS = 1)", hint: "Pause by stopping the timer, so the fraction of a millisecond already counted is kept." },
        { kind: "var", name: "ms", at: 60.8, min: 40, max: 42, label: "Running again from 42.5 ms: ms is 41 at the end (40 to 42 accepted)" },
        { kind: "reg", reg: "CpuTimer0Regs.TCR", field: "TSS", equals: 0, label: "After the release the timer runs again" },
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 199999, label: "Timer 0 still has its 1 ms period" },
        {
          kind: "source",
          mustMatch: "DELAY_US\\(200\\)[\\s\\S]*while[\\s\\S]*OtherWork\\(\\)",
          label: "OtherWork() still takes 0.2 ms and is still called in the loop",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "TCR\\.bit\\.(TSS|TRB|TIE|FREE|SOFT)\\s*=[^=]",
          label: "Bulletproof: no .bit write to TCR other than TIF, so no write can ever put a 1 back into TIF",
          hint: "Moving lines around only makes the loss rare. Stop and start with whole-register writes that have bit 15 at 0: 0x4010 and 0x4000.",
        },
      ],
      hints: [
        "The timer sets TIF during OtherWork(). By the time the loop tests TIF, it is 0 again. Only one line in between touches TCR.",
        "`CpuTimer0Regs.TCR.bit.TSS = 0;` is not a one-bit write. The CPU reads all 16 bits of TCR, changes bit 4 and writes all 16 back. TIF was read as 1, so a 1 is written to TIF. What does writing 1 to TIF do?",
        "Write the whole register with bit 15 at 0: `CpuTimer0Regs.TCR.all = 0x4010;` to stop and `CpuTimer0Regs.TCR.all = 0x4000;` to run. A 0 written to TIF is ignored, so a waiting flag survives.",
      ],
      takeaway: "A .bit write is a read, a change and a write of the whole register. In a register with write-1-to-clear flags, that write hands every flag that is set its own 1 back and clears it. Write such registers whole, with 0 in the flag bits you want to keep.",
    },
    {
      id: "tmr-pwm",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Dim it",
      goal: "Dim LED1 to 37 % brightness: switch it at 1 kHz, on for 370 us and off for 630 us, timed by a CPU timer.",
      refs: [{ trm: "3.8" }, { course: "L2" }, { course: "Lab 2" }],
      brief: `
An LED that is switched on and off faster than the eye can follow looks dimmer, in proportion to the share of time it is on. That share is the **duty cycle**. This is pulse width modulation (PWM), done by hand. In chapter 9 a peripheral does it in hardware.

## Your task
Drive **LED1** (GPIO22) with a period of exactly **1 ms**:

- on for **370 us**
- off for **630 us**

The first on time starts when you start the timer, and the pattern repeats from there without drifting.

Time it with the CPU timers and a polling loop. No \`DELAY_US\`.

There is more than one way. A fast tick and a counter works. So does a timer whose period you change while it runs. Before you try the second, read in TRM 3.8 when a new \`PRD\` value reaches the counter.

Check your result on the scope.
`,
      kit: "robot",
      durationMs: 20,
      inspect: ["CpuTimer0Regs.PRD", "CpuTimer0Regs.TIM", "CpuTimer0Regs.TCR"],
      starter: `void main(void)
{
${INIT}

${out(22)}

    // Set up the timing

    while (1) {
        // LED1: on for 370 us, off for 630 us, again and again
    }
}
`,
      solution: `#define ON_COUNTS   74000    // 370 us at 5 ns per count
#define OFF_COUNTS  126000   // 630 us

void main(void)
{
    int16_t on = 1;

${INIT}

${out(22)}

    InitCpuTimers();
    // The first phase is the on time. TIM is loaded with it here.
    ConfigCpuTimer(&CpuTimer0, 200, 370);
    // PRD is only used at the next reload: this is the length of the
    // phase after the one that is running.
    CpuTimer0Regs.PRD.all = OFF_COUNTS - 1;

    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    CpuTimer0Regs.TCR.all = 0x4000;

    while (1) {
        if (CpuTimer0Regs.TCR.bit.TIF == 1) {
            CpuTimer0Regs.TCR.bit.TIF = 1;
            // A phase just ended and TIM already holds the next one.
            // PRD now sets the phase after that.
            if (on == 1) {
                GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
                CpuTimer0Regs.PRD.all = ON_COUNTS - 1;
                on = 0;
            } else {
                GpioDataRegs.GPASET.bit.GPIO22 = 1;
                CpuTimer0Regs.PRD.all = OFF_COUNTS - 1;
                on = 1;
            }
        }
    }
}
`,
      checks: [
        { kind: "duty", led: "LED1", pct: 37, tolPct: 1, from: 2, to: 18, label: "LED1 is on 37 % of the time", hint: "On for 370 us out of every 1000 us." },
        { kind: "pin", pin: 22, at: 1.2, level: 1, label: "GPIO22 is high at 1.2 ms, early in the second period", hint: "Each period starts with the on time, and the first one starts when the timer starts." },
        { kind: "pin", pin: 22, at: 1.7, level: 0, label: "GPIO22 is low at 1.7 ms" },
        { kind: "pin", pin: 22, at: 5.2, level: 1, label: "GPIO22 is high at 5.2 ms" },
        { kind: "pin", pin: 22, at: 5.7, level: 0, label: "GPIO22 is low at 5.7 ms", hint: "If this fails but the duty cycle is right, the period is not 1 ms." },
        { kind: "pin", pin: 22, at: 12.2, level: 1, label: "GPIO22 is high at 12.2 ms" },
        { kind: "pin", pin: 22, at: 12.7, level: 0, label: "GPIO22 is low at 12.7 ms" },
        { kind: "pin", pin: 22, at: 19.2, level: 1, label: "GPIO22 is high at 19.2 ms: no drift", hint: "The on and off times must add up to exactly 1 ms: 200000 clock cycles." },
        { kind: "pin", pin: 22, at: 19.7, level: 0, label: "GPIO22 is low at 19.7 ms" },
        { kind: "source", mustNotMatch: "DELAY_US", label: "The timer does the waiting, not DELAY_US" },
        { kind: "no-dat-write", label: "LED1 is changed through SET, CLEAR or TOGGLE" },
      ],
      bonus: [
        { kind: "duty", led: "LED1", pct: 37, tolPct: 0.1, from: 2, to: 18, label: "Precise: the duty cycle is 37 % to within 0.1 %" },
        {
          kind: "max-steps",
          max: 1500,
          label: "Light on the CPU: the loop does work only twice per period (at most 1500 statements in 20 ms)",
          hint: "A 10 us tick wakes the loop 100 times per period. Two timer events per period are enough: one at the end of the on time, one at the end of the off time.",
        },
      ],
      hints: [
        "The simple way: a 10 us tick and a counter from 0 to 99. LED on while the counter is below 37.",
        "With one timer and two events per period: let the timer run the on time, then the off time, by changing PRD. A value written to PRD is not used at once. It is loaded into TIM at the next reload.",
        "So at every flag the phase that just started is already in TIM, and you write PRD for the phase after it. When the on time ends: LED off, PRD = 74000 - 1. When the off time ends: LED on, PRD = 126000 - 1.",
      ],
      takeaway: "PRD is a waiting room: the value you write now is used from the next reload. Writing it one phase ahead gives edges timed by hardware to the clock cycle, with the CPU needed only twice per period.",
    },
  ],
};
