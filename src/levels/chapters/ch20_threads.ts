import type { Chapter } from "../types";

// Every code level uses the same start-up: timer 0 calls cpu_timer0_isr.
// The only DINT in these programs outside a critical section is the one
// below, which the lock-free level relies on.
const setup = (periodUs: number) => `    InitSysCtrl();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, ${periodUs});
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;`;

// Stands for slow work in main (printing, maths). A real loop, so the timer
// interrupt keeps firing while it runs: about 10000 loops per millisecond.
const SLOW_WORK = `// Slow work in main: about 10000 loops per millisecond
void slow_work(uint32_t loops)
{
    uint32_t i;
    for (i = 0; i < loops; i++) {
        spin++;
    }
}`;

// ---------------------------------------------------------------- race
const raceProgram = (loopBody: string) => `__interrupt void cpu_timer0_isr(void);

uint32_t shared = 0;      // incremented by main AND by the interrupt
uint32_t main_adds = 0;   // how many times main added 1
uint32_t isr_adds = 0;    // how many times the interrupt added 1
int32_t lost = -1;        // updates that disappeared (filled in at the end)

void main(void)
{
    uint32_t tmp;
    uint32_t i;

${setup(50)}

    for (i = 0; i < 20000; i++) {
${loopBody}
        main_adds++;
    }

    DINT;
    lost = (main_adds + isr_adds) - shared;
    while (1) {}
}

// Every 50 us
__interrupt void cpu_timer0_isr(void)
{
    shared++;
    isr_adds++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

// ---------------------------------------------------------------- torn read
const tornProgram = (read: string) => `__interrupt void cpu_timer0_isr(void);

// One 32-bit tick count, stored the way this chip stores it: two 16-bit words
uint16_t ticks_lo = 0;
uint16_t ticks_hi = 0;

uint32_t now = 0;
uint32_t last = 0;
uint32_t reads = 0;
uint32_t torn = 0;        // times the clock seemed to run backwards

void main(void)
{
    uint16_t lo;
    uint16_t hi;
    uint32_t i;

${setup(20)}

    for (i = 0; i < 30000; i++) {
${read}
        now = ((uint32_t)hi << 16) | lo;
        if (now < last) {
            torn++;
        }
        last = now;
        reads++;
    }

    DINT;
    while (1) {}
}

// Every 20 us: add 0x2000 to the 32-bit count, one word at a time
__interrupt void cpu_timer0_isr(void)
{
    ticks_lo += 0x2000;
    if (ticks_lo == 0) {
        ticks_hi++;       // carry into the high word
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

// ---------------------------------------------------------------- semaphore
const semProgram = (fns: string) => `#define N_POSTS 40

__interrupt void cpu_timer0_isr(void);

uint16_t sem = 0;         // the semaphore: number of jobs waiting
uint16_t posted = 0;      // jobs requested by the interrupt
uint16_t jobs = 0;        // jobs done by main
uint32_t spin = 0;

${SLOW_WORK}

${fns}

// A job takes 0.2 ms, but every 8th one takes 3.5 ms
void do_job(void)
{
    jobs++;
    if ((jobs % 8) == 0) {
        slow_work(35000);
    } else {
        slow_work(2000);
    }
}

void main(void)
{
${setup(1000)}

    while (1) {
        if (sem_trywait()) {
            do_job();
        }
    }
}

// Every 1 ms: ask main for one job, 40 times in total
__interrupt void cpu_timer0_isr(void)
{
    if (posted < N_POSTS) {
        posted++;
        sem_post();
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

// ---------------------------------------------------------------- ring buffer
const ringProgram = (o: { fns: string; fill: string; slowAt: number; extraGlobals?: string }) => `#define BUF_SIZE 8
#define N_SAMPLES 60

__interrupt void cpu_timer0_isr(void);

uint16_t buf[BUF_SIZE];
uint16_t head = 0;        // index of the next free slot (producer side)
uint16_t tail = 0;        // index of the oldest sample (consumer side)
${o.extraGlobals ?? ""}
uint16_t produced = 0;    // samples made by the interrupt
uint16_t dropped = 0;     // samples the interrupt could not store (buffer full)
uint16_t received = 0;    // samples main took out
uint16_t order_errors = 0;
uint16_t last = 0;
int16_t missing = -1;     // must end at 0: every sample is received or counted as dropped
uint32_t spin = 0;

${SLOW_WORK}

${o.fns}

// Checks the sample and does some work with it. Do not change.
void process(uint16_t v)
{
    if (v <= last) {
        order_errors++;   // out of order, or the same sample twice
    }
    last = v;
    received++;
    if (v == ${o.slowAt}) {
        slow_work(150000);   // 15 ms: main is busy, the buffer fills up
    } else {
        slow_work(2000);     // 0.2 ms
    }
    missing = produced - dropped - received - ${o.fill};
}

void main(void)
{
    uint16_t v;

${setup(1000)}

    while (1) {
        if (buf_get(&v)) {
            process(v);
        }
    }
}

// Every 1 ms: one new sample (1, 2, 3, ...), 60 in total
__interrupt void cpu_timer0_isr(void)
{
    if (produced < N_SAMPLES) {
        produced++;
        if (buf_put(produced) == 0) {
            dropped++;
        }
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const RING_COUNT_SOLUTION = `// Called by the interrupt. Returns 1 if stored, 0 if the buffer is full.
int buf_put(uint16_t v)
{
    if (count == BUF_SIZE) {
        return 0;
    }
    buf[head] = v;
    head = (head + 1) % BUF_SIZE;
    count++;
    return 1;
}

// Called by main. Returns 1 and fills *v, or 0 if the buffer is empty.
int buf_get(uint16_t *v)
{
    DINT;
    if (count == 0) {
        EINT;
        return 0;
    }
    *v = buf[tail];
    tail = (tail + 1) % BUF_SIZE;
    count--;
    EINT;
    return 1;
}`;

const ringChecks = (minReceived: number) => [
  { kind: "var" as const, name: "produced", equals: 60, label: "The interrupt produced 60 samples", hint: "If this is far below 60, interrupts were left disabled somewhere." },
  { kind: "var" as const, name: "order_errors", equals: 0, label: "No sample arrives twice or out of order", hint: "A full buffer must refuse the new sample. Writing anyway overwrites the oldest one and scrambles the order." },
  { kind: "var" as const, name: "missing", equals: 0, label: "Every sample is either received or counted as dropped" },
  { kind: "var" as const, name: "dropped", min: 1, max: 60 - minReceived, label: "The full case happens and is reported (a few samples dropped while main was busy)", hint: "buf_put must return 0 when the buffer is full, and only then." },
  { kind: "var" as const, name: "received", min: minReceived, label: `Main received at least ${minReceived} samples` },
];

// ---------------------------------------------------------------- logger
const LOG_N = 100;
const logSample = (k: number) => (k * 37) % 1000;
const LOG_SUM = Array.from({ length: LOG_N }, (_, i) => logSample(i + 1)).reduce((a, b) => a + b, 0);

const loggerProgram = (o: { globals: string; fns: string; isr: string; loop: string }) => `#define BUF_SIZE 8
#define N_SAMPLES ${LOG_N}

__interrupt void cpu_timer0_isr(void);

uint16_t produced = 0;    // samples read from the sensor by the interrupt
uint16_t dropped = 0;     // samples lost because the buffer was full
uint16_t logged = 0;      // samples main has taken out and added to sum
uint32_t sum = 0;         // sum of all logged samples
uint32_t spin = 0;
${o.globals}

${SLOW_WORK}

// The "sensor": a different reading for every sample. Do not change.
uint16_t read_sensor(void)
{
    return (produced * 37) % 1000;
}

${o.fns}

void main(void)
{
    uint16_t v;

${setup(1000)}

    init_serialSCIA(&SerialA, 115200);

    while (1) {
${o.loop}
    }
}

// Every 1 ms
__interrupt void cpu_timer0_isr(void)
{
${o.isr}
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

export const ch20: Chapter = {
  id: "threads",
  number: 20,
  title: "Threads",
  blurb: "Shared data, races, critical sections and producer-consumer buffers.",
  requires: ["interrupts"],
  course: ["L13"],
  levels: [
    {
      id: "thr-brief",
      kind: "brief",
      title: "Two things at once",
      goal: "Learn what processes and threads are, what they share, and why shared data needs protection.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
Your robot has two computers. The F28379D runs your C code directly, with nothing underneath it. The Raspberry Pi runs Linux, which runs many programs at the same time.

## Program, process, thread
- A **program** is a file on disk: instructions, nothing running.
- A **process** is a program that is running. Linux gives it its own memory: the **code**, the **data** (global variables), the **heap** (memory asked for while running) and a **stack** (local variables and return addresses). One process cannot see another process's memory.
- A **thread** is one path of execution inside a process. Each thread has its **own registers and its own stack**. All threads of a process **share** the code, the global variables and the heap.

On the Pi, threads are made with the \`pthread\` library. The scheduler of Linux switches between threads whenever it likes, and on a multi-core Pi two threads really run at the same instant.

## Talking between processes
Processes share nothing, so Linux offers ways to pass data. This is called inter-process communication:

- **Shared memory**: a block of memory both processes can see. Fast, but both must agree on who touches it when.
- **Signals**: a short notice sent to a process ("stop", "your child ended").
- **Pipes**: a one-way stream of bytes from one process to another.

The course's A* program on the Pi receives the robot pose through shared memory, guarded by a semaphore.

## And on the microcontroller?
The F28379D core you program runs one instruction at a time. There are no threads. But there are **interrupts**: \`main()\` is paused at an arbitrary instruction, an interrupt function runs, and \`main()\` continues. Nothing is truly parallel, yet the two pieces of code **interleave**, and they share every global variable. For shared data that is the same situation as two threads.

## The race
\`\`\`c
counter += 1;
\`\`\`
looks like one step. The machine does three: **read** the value from memory into a register, **add** 1 in the register, **write** the register back. If another thread, or an interrupt, changes \`counter\` between the read and the write, that change is overwritten and lost. The result depends on timing. This is a **race condition**, and an operation that cannot be split like this is called **atomic**.

Try it in the figure: you are the scheduler. Step A once, run B to its end, then finish A, and look at the counter.

{{figure:lost-update}}

## The fixes
- A **mutex** (mutual exclusion lock): a thread locks it before touching the shared data and unlocks it after. A second thread that wants the lock waits. The code between lock and unlock is the **critical section**.
- A **semaphore**: a counter with two operations. **post** adds 1. **wait** takes 1, and blocks while the count is 0. It lets one thread tell another "there is work for you".
- **Producer-consumer**: one side puts data into a buffer, the other takes it out. The buffer absorbs the difference in speed.

On the microcontroller the mutex is simpler: \`DINT;\` before the critical section and \`EINT;\` after it. With interrupts disabled, nothing can interleave. Switch the figure above to "main and an interrupt" to try both.
`,
      questions: [
        {
          prompt: "Two threads of the same process: which of these does each thread have for itself?",
          options: ["The global variables", "The heap", "The stack and the CPU registers", "The program code"],
          answer: 2,
          why: "Each thread needs its own registers and its own stack to keep its place in the code and its local variables. Code, globals and heap are shared.",
        },
        {
          prompt: "The F28379D core running your code has no threads. Why can a race condition still happen?",
          options: [
            "Because an interrupt function can run between two instructions of main() and both use the same global variables",
            "Because the chip has two cores that run main() twice",
            "Because global variables are copied for each function",
            "It cannot happen on a microcontroller",
          ],
          answer: 0,
          why: "Interrupts interleave with main() at points you do not choose. Shared globals are then exposed exactly as they are between two threads.",
        },
        {
          prompt: "Why is `counter += 1;` not safe when two threads run it?",
          options: [
            "The addition can overflow",
            "It is three machine steps (read, add, write), and the other thread can run between them",
            "The compiler removes it",
            "Global variables cannot be changed by threads",
          ],
          answer: 1,
          why: "Both threads can read the same old value, and both write old + 1. One of the two additions is lost.",
        },
      ],
      takeaway: "Threads share globals and heap, and so do main() and interrupt functions. Anything shared that takes more than one machine step needs a critical section.",
    },
    {
      id: "thr-shared",
      kind: "quiz",
      title: "Whose memory is it?",
      goal: "Decide what processes, threads and interrupt functions share.",
      refs: [{ course: "L13" }],
      brief: `
Before you can protect shared data you have to know what is shared.

- **Two processes**: nothing is shared, unless they ask Linux for a block of shared memory (or use a pipe or a signal).
- **Two threads of one process**: code, global variables and heap are shared. Local variables are not, because they live on each thread's own stack.
- **main() and an interrupt function** on the microcontroller: global variables are shared. Local variables of the interrupt function live on the stack for the duration of that one call.

A variable needs protection when **all three** are true:

1. it is reachable from two execution paths (two threads, or main and an interrupt),
2. at least one of them writes it,
3. the access is not atomic, or several variables must change together.

A local variable never needs protection. A constant never needs protection: nobody writes it.
`,
      questions: [
        {
          prompt: "A pthread program has `int total;` at file level and `int i;` inside the thread function. Two threads run that function. What is shared?",
          options: ["Both `total` and `i`", "Only `total`", "Only `i`", "Neither"],
          answer: 1,
          why: "`total` is a global: one copy for the whole process. `i` is a local: each thread has its own on its own stack.",
        },
        {
          prompt: "Two separate processes on the Pi each have a global `int count;`. Process A sets it to 5. What does process B read?",
          options: ["5", "Whatever B last wrote: each process has its own `count`", "0, always", "The read fails with an error"],
          answer: 1,
          why: "Each process has its own memory. To share a value they must use shared memory, a pipe or another form of inter-process communication.",
        },
        {
          prompt: "On the robot, `main()` only **reads** a `float` that only the timer interrupt writes. Is there anything to worry about?",
          options: [
            "No, reading is always safe",
            "Yes: a float is 32 bits, two words on this chip, so main can read one old half and one new half",
            "Yes: reading it clears it",
            "No, because floats are atomic",
          ],
          answer: 1,
          why: "The CPU's memory is 16 bits wide. A 32-bit value takes two words, and an interrupt between the two reads gives a torn value: half old, half new.",
        },
        {
          prompt: "The Pi's A* program and the program that talks to the F28379D are two processes. How does the course code pass the robot pose between them?",
          options: [
            "Through a global variable",
            "Through the stack",
            "Through shared memory, guarded by a semaphore",
            "It cannot: processes are isolated",
          ],
          answer: 2,
          why: "AstarApp.c opens named shared memory and a named semaphore. The semaphore makes sure one side is not reading while the other is half way through writing.",
        },
      ],
      hints: ["Global or heap: shared between threads. Local: private.", "On this chip, anything wider than 16 bits takes more than one memory access."],
      takeaway: "Globals are shared, locals are private, processes share only what they explicitly set up.",
    },
    {
      id: "thr-lost-update",
      kind: "order",
      title: "The lost update",
      goal: "Order the machine steps of two threads so that one increment is lost.",
      refs: [{ course: "L13" }],
      brief: `
\`counter\` holds **5**. Thread A and thread B each run \`counter += 1;\` once. The result should be 7.

Each thread does three machine steps: **read** \`counter\` into its own register, **add** 1 in the register, **write** the register back to \`counter\`.

Play the schedule in the figure first, then put the steps below in the same order.

{{figure:lost-update}}

The scheduler may pause a thread between any two steps. Build the unlucky schedule in which the result is **6**:

- Thread A starts, and is paused straight after its read.
- Thread B then runs all three of its steps.
- Thread A continues with the copy it read earlier.

Put the steps in that order.
`,
      steps: [
        "A reads counter: A's register holds 5",
        "The scheduler pauses A and runs B",
        "B reads counter: B's register holds 5",
        "B adds 1: B's register holds 6",
        "B writes its register: counter is 6",
        "The scheduler runs A again",
        "A adds 1 to its old copy: A's register holds 6",
        "A writes its register: counter is 6, and B's update is lost",
      ],
      hints: [
        "A read is the first step of each thread, a write is the last.",
        "A is paused after its read, so A's add and write come at the very end.",
        "A reads, switch, B reads, B adds, B writes, switch, A adds, A writes.",
      ],
      takeaway: "Both threads read 5, so both wrote 6. Nothing crashed and no error was reported: a race gives a wrong number, sometimes.",
    },
    {
      id: "thr-race",
      kind: "code",
      mode: "complete",
      title: "Catch the race, then close it",
      goal: "Watch a counter lose updates between main and a timer interrupt, then protect it with DINT and EINT.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }, { trm: "3.4.4" }],
      brief: `
\`shared\` is a 32-bit counter. \`main()\` adds 1 to it 20000 times. The timer 0 interrupt function also adds 1 to it, every 50 microseconds. Each side counts its own additions in \`main_adds\` and \`isr_adds\`, so at the end

\`\`\`c
lost = (main_adds + isr_adds) - shared;
\`\`\`

should be 0.

## Why the loop has three lines
On the real chip the compiler turns \`shared++;\` into separate instructions: load the value (two 16-bit words), add 1, store it back. An interrupt can arrive between any two of them. This simulator runs one C statement as one step, so the program writes the three steps out as three statements:

\`\`\`c
tmp = shared;       // read
tmp = tmp + 1;      // add
shared = tmp;       // write
\`\`\`

This is what your compiled \`shared++\` does. Treat every \`x++\`, \`x += n\` and \`x = x + n\` on shared data as these three steps.

Try it in the figure: choose "main and an interrupt", step main() once and fire the interrupt. Then turn on DINT / EINT and fire it at the same moment.

{{figure:lost-update}}

## What to do
1. Press **Run** as it is. Look at \`lost\` in the watch list: it is not 0. Each lost update is one interrupt that landed between the read and the write.
2. Make the three statements a **critical section**: \`DINT;\` before them, \`EINT;\` after them. \`DINT\` sets the CPU's interrupt mask INTM, so no interrupt can start. A request that arrives meanwhile is not lost: its flag stays set, and the function runs right after \`EINT;\`.

Keep the critical section short. The interrupt waits for as long as it lasts.

## The same idea on Linux
Between threads you cannot switch the other thread off. You use a **mutex** instead:

\`\`\`c
pthread_mutex_lock(&lock);
shared = shared + 1;
pthread_mutex_unlock(&lock);
\`\`\`

\`DINT\` / \`EINT\` play the role of lock / unlock between main and the interrupt functions.
`,
      kit: "robot",
      durationMs: 20,
      starter: raceProgram(`        // TODO: make these three statements a critical section
        tmp = shared;       // read
        tmp = tmp + 1;      // add
        shared = tmp;       // write
`),
      solution: raceProgram(`        DINT;
        tmp = shared;       // read
        tmp = tmp + 1;      // add
        shared = tmp;       // write
        EINT;`),
      checks: [
        { kind: "var", name: "lost", equals: 0, label: "No update is lost: shared equals main_adds + isr_adds", hint: "A positive number is the count of interrupts that landed between the read and the write. -1 means the loop did not finish." },
        { kind: "var", name: "main_adds", equals: 20000, label: "main added 1 exactly 20000 times" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 60, label: "The timer interrupt keeps running during the loop", hint: "EINT; must come after the write, inside the loop, or the interrupt stays switched off." },
      ],
      watch: ["shared", "main_adds", "isr_adds", "lost"],
      hints: [
        "Run it unchanged first and read `lost`.",
        "The critical section is the read, the add and the write. `main_adds++` is not shared and can stay outside.",
        "`DINT;` on the line before `tmp = shared;` and `EINT;` on the line after `shared = tmp;`.",
      ],
      takeaway: "A read-modify-write of shared data is a critical section. On the microcontroller DINT/EINT guard it, on Linux a mutex does.",
    },
    {
      id: "thr-sem",
      kind: "code",
      mode: "write",
      title: "A semaphore made of a counter",
      goal: "Write post and wait so that the interrupt can hand jobs to main without losing any.",
      refs: [{ course: "L13" }, { course: "Lab 1" }, { trm: "3.4.3" }],
      brief: `
You already know the flag pattern from the starter code: the interrupt sets \`UARTPrint = 1;\` and \`main()\` does the slow work. A flag has a weakness. If the interrupt fires three times while main is still busy, the flag is still just 1, and two jobs are forgotten.

A **semaphore** is a flag that can count.

- **post** (also called signal): add 1. "One more job is waiting."
- **wait**: if the count is above 0, take 1 and go on. On Linux, \`sem_wait\` blocks the thread while the count is 0. A microcontroller's main loop must not block, so you will write the non-blocking form, like Linux's \`sem_trywait\`: take one if there is one, and say whether you got it.

## The program
The timer interrupt runs every 1 ms and posts 40 jobs in total. \`main()\` calls \`sem_trywait()\` in its loop and runs \`do_job()\` each time it returns 1. Most jobs take 0.2 ms, but every 8th takes 3.5 ms, so several posts arrive while main is busy.

## Write
- \`void sem_post(void)\`: called from the interrupt function. Add 1 to \`sem\`.
- \`int sem_trywait(void)\`: called from main. If \`sem\` is above 0, subtract 1 and return 1. Otherwise return 0.

"Test, then subtract" in main is a read-modify-write of data the interrupt also writes, so it is a critical section: \`DINT;\` before the test, \`EINT;\` after the subtraction, on **every** path out of the function.

The interrupt function needs no \`DINT\`: while it runs, INTM is already set and main cannot run.
`,
      kit: "robot",
      durationMs: 80,
      starter: semProgram(`// Called from the interrupt function: one more job is waiting
void sem_post(void)
{
}

// Called from main: take one job if there is one. Returns 1 if it took one.
int sem_trywait(void)
{
    return 0;
}`),
      solution: semProgram(`// Called from the interrupt function: one more job is waiting
void sem_post(void)
{
    sem++;
}

// Called from main: take one job if there is one. Returns 1 if it took one.
int sem_trywait(void)
{
    int got = 0;

    DINT;
    if (sem > 0) {
        sem--;
        got = 1;
    }
    EINT;
    return got;
}`),
      checks: [
        { kind: "var", name: "posted", equals: 40, label: "The interrupt posted 40 jobs" },
        { kind: "var", name: "jobs", equals: 40, label: "main did all 40 jobs", hint: "Fewer than 40: posts that arrived during a long job were forgotten. sem must count them (sem++), not just be set to 1." },
        { kind: "var", name: "sem", equals: 0, label: "No job is left waiting at the end" },
        {
          kind: "source",
          mustMatch: "sem_trywait\\s*\\(\\s*void\\s*\\)\\s*\\{[^}]*DINT[\\s\\S]*EINT",
          label: "sem_trywait protects its test-and-subtract with DINT and EINT",
          hint: "Put DINT; before the test of sem and EINT; before every return.",
        },
      ],
      watch: ["sem", "posted", "jobs"],
      hints: [
        "sem_post is one statement.",
        "In sem_trywait use a local variable for the result, so there is a single `EINT;` and a single `return` at the end.",
        "`int got = 0; DINT; if (sem > 0) { sem--; got = 1; } EINT; return got;`",
      ],
      takeaway: "A flag remembers that something happened, a semaphore remembers how many times. post adds one, wait takes one.",
    },
    {
      id: "thr-ring",
      kind: "code",
      mode: "write",
      title: "Producer and consumer",
      goal: "Write a ring buffer that carries samples from the timer interrupt to main, with the full and empty cases.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
A semaphore says how many jobs wait. Usually the jobs carry **data**: a sample, a received character. The interrupt (the **producer**) must store it somewhere until main (the **consumer**) has time. That store is a **ring buffer**: an array used as a queue.

\`\`\`c
uint16_t buf[BUF_SIZE];
uint16_t head;    // where the producer writes next
uint16_t tail;    // where the consumer reads next
uint16_t count;   // how many samples are in the buffer
\`\`\`

Both indexes move forward and wrap from the last slot to slot 0: \`head = (head + 1) % BUF_SIZE;\`

Try it in the figure: press Put until the buffer is full, then Get until it is empty, and watch head and tail wrap from slot 7 to slot 0.

{{figure:ring-buffer}}

## Two special cases
- **Empty** (\`count == 0\`): there is nothing to take. \`buf_get\` returns 0.
- **Full** (\`count == BUF_SIZE\`): there is no room. \`buf_put\` returns 0 and stores nothing. Writing anyway would overwrite the oldest sample, which has not been read yet.

## Write
- \`int buf_put(uint16_t v)\`: called by the interrupt. If full return 0. Otherwise store \`v\` at \`head\`, advance \`head\`, add 1 to \`count\`, return 1.
- \`int buf_get(uint16_t *v)\`: called by main. If empty return 0. Otherwise copy the sample at \`tail\` into \`*v\`, advance \`tail\`, subtract 1 from \`count\`, return 1.

\`count\` is written by both sides, so in \`buf_get\` everything from the test of \`count\` to its decrement is a critical section. Remember \`EINT;\` on the empty path too.

## The test
The interrupt produces samples 1, 2, 3 ... 60, one per millisecond, and counts a sample in \`dropped\` when \`buf_put\` returns 0. \`process()\` in main normally takes 0.2 ms. On sample 20 it takes 15 ms, so the 8-slot buffer fills and some samples must be dropped. That is acceptable. Losing a sample **without knowing**, or receiving one twice, is not.
`,
      kit: "robot",
      durationMs: 100,
      starter: ringProgram({
        extraGlobals: "uint16_t count = 0;       // samples in the buffer",
        fill: "count",
        slowAt: 20,
        fns: `// Called by the interrupt. Returns 1 if stored, 0 if the buffer is full.
int buf_put(uint16_t v)
{
    return 0;
}

// Called by main. Returns 1 and fills *v, or 0 if the buffer is empty.
int buf_get(uint16_t *v)
{
    return 0;
}`,
      }),
      solution: ringProgram({ extraGlobals: "uint16_t count = 0;       // samples in the buffer", fill: "count", slowAt: 20, fns: RING_COUNT_SOLUTION }),
      checks: ringChecks(45),
      watch: ["head", "tail", "count", "produced", "received", "dropped", "missing"],
      hints: [
        "Write buf_put first: full test, store, advance head, count++.",
        "buf_get mirrors it with tail and count--, wrapped in DINT / EINT. The early return for the empty case needs its own EINT.",
        "`DINT; if (count == 0) { EINT; return 0; } *v = buf[tail]; tail = (tail + 1) % BUF_SIZE; count--; EINT; return 1;`",
      ],
      takeaway: "A ring buffer decouples a fast, regular producer from a slow, irregular consumer. Decide what happens when it is full, and count it.",
    },
    {
      id: "thr-unlock",
      kind: "code",
      mode: "debug",
      title: "The lock that was never opened",
      goal: "The interrupt stops producing almost at once. Find the path that leaves the critical section without EINT.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
This is the ring buffer from the last level, written by someone in a hurry. Run it: \`produced\` stays at 0 and main receives nothing. The timer is set up correctly and is still counting.

A critical section has one rule that is easy to break: **every way out must unlock**. A function with an early \`return\` has more than one way out.

Read \`buf_get\` and follow it the first time main calls it, when the buffer is still empty.

On Linux the same mistake is a thread that returns without calling \`pthread_mutex_unlock\`. Every other thread that wants the lock then waits forever.
`,
      kit: "robot",
      durationMs: 100,
      starter: ringProgram({
        extraGlobals: "uint16_t count = 0;       // samples in the buffer",
        fill: "count",
        slowAt: 20,
        fns: `// Called by the interrupt. Returns 1 if stored, 0 if the buffer is full.
int buf_put(uint16_t v)
{
    if (count == BUF_SIZE) {
        return 0;
    }
    buf[head] = v;
    head = (head + 1) % BUF_SIZE;
    count++;
    return 1;
}

// Called by main. Returns 1 and fills *v, or 0 if the buffer is empty.
int buf_get(uint16_t *v)
{
    DINT;
    if (count == 0) {
        return 0;
    }
    *v = buf[tail];
    tail = (tail + 1) % BUF_SIZE;
    count--;
    EINT;
    return 1;
}`,
      }),
      solution: ringProgram({ extraGlobals: "uint16_t count = 0;       // samples in the buffer", fill: "count", slowAt: 20, fns: RING_COUNT_SOLUTION }),
      checks: ringChecks(45),
      watch: ["count", "produced", "received", "dropped"],
      hints: [
        "The first call of buf_get finds count == 0. Which statements run on that path?",
        "DINT; runs, then `return 0;`. EINT; is never reached, so interrupts stay disabled for good.",
        "Add `EINT;` before `return 0;` inside the `if (count == 0)` block.",
      ],
      takeaway: "Every path out of a critical section must re-enable interrupts (or unlock the mutex). Early returns are where this goes wrong.",
    },
    {
      id: "thr-deadlock",
      kind: "quiz",
      title: "Deadlock, and printing with care",
      goal: "Recognise a deadlock from two locks, and see why printing is a shared resource.",
      refs: [{ course: "L13" }, { course: "Lab 1" }],
      brief: `
## Deadlock
Locks fix races and bring a new problem. Thread A and thread B both need two mutexes, \`m1\` and \`m2\`.

\`\`\`c
// thread A                      // thread B
pthread_mutex_lock(&m1);         pthread_mutex_lock(&m2);
pthread_mutex_lock(&m2);         pthread_mutex_lock(&m1);
\`\`\`

A takes \`m1\`. B takes \`m2\`. Now A waits for \`m2\`, which B holds, and B waits for \`m1\`, which A holds. Neither can ever continue. That is a **deadlock**. Like a race, it depends on timing: most runs work, one run in a thousand hangs.

The standard cure: every thread takes the locks **in the same order** (always \`m1\` first, then \`m2\`). Then the situation above cannot arise.

## Printing
A terminal, a serial port and the LCD are shared resources too.

- Two threads that print at the same time can mix their characters into one garbled line, unless a lock makes each line a critical section.
- Printing is **slow**. At 115200 baud one character takes about 87 microseconds, so a 40-character line takes about 3.5 ms. Inside an interrupt function that is 3.5 ms during which every other interrupt waits. This is why the starter code only sets \`UARTPrint = 1;\` in the interrupt and calls \`serial_printf\` from \`while(1)\`.
- The values you print may change while you print them. Copy shared values inside a short critical section, then print the copies.
`,
      questions: [
        {
          prompt: "Thread A locks `m1` then `m2`. Thread B locks `m2` then `m1`. What can happen?",
          options: [
            "Nothing bad: mutexes prevent all problems",
            "A lost update",
            "A deadlock: each thread holds one lock and waits forever for the other",
            "The program runs twice as fast",
          ],
          answer: 2,
          why: "If A gets m1 and B gets m2 before either takes its second lock, each waits for a lock the other will never release.",
        },
        {
          prompt: "What is the usual way to make that deadlock impossible?",
          options: [
            "Use more locks",
            "Have every thread take the locks in the same order",
            "Unlock in a random order",
            "Add a delay before locking",
          ],
          answer: 1,
          why: "With one fixed order, the thread that holds m1 is the only one that can ask for m2. A delay only changes how often the hang shows up.",
        },
        {
          prompt: "Why does the course starter code print from `while(1)` and not from the timer interrupt function?",
          options: [
            "serial_printf does not compile inside an interrupt function",
            "Printing takes milliseconds, and during that time every other interrupt would wait",
            "The serial port is switched off during interrupts",
            "Interrupt functions cannot read global variables",
          ],
          answer: 1,
          why: "An interrupt function runs with interrupts disabled. Milliseconds of printing there delay the control loop and every other handler.",
        },
        {
          prompt: "main prints `x` and `y`, two floats that the timer interrupt updates together. What is the safe way?",
          options: [
            "Print them directly: reading is always safe",
            "DINT; copy both to local variables; EINT; then print the copies",
            "DINT; print both; EINT;",
            "Print each one twice",
          ],
          answer: 1,
          why: "The copy takes microseconds, so interrupts are off only briefly, and the two values belong to the same update. Printing inside the critical section would block interrupts for milliseconds.",
        },
      ],
      hints: ["Draw who holds which lock and who waits for which.", "How long does one character take at 115200 baud, and who has to wait meanwhile?"],
      takeaway: "Take locks in one fixed order. Keep slow work such as printing out of interrupt functions and out of critical sections.",
    },
    {
      id: "thr-logger",
      kind: "code",
      mode: "checkpoint",
      title: "Data logger",
      goal: "Build a logger: the timer interrupt samples a sensor, main sums and prints, and no sample is lost or used twice.",
      refs: [{ course: "L13" }, { course: "Lab 1" }, { course: "Lab 2" }, { trm: "3.4.3" }],
      brief: `
Put the chapter together. The start-up code, the serial port and the "sensor" are given. The rest is yours.

## The interrupt (producer), every 1 ms
While \`produced\` is below \`N_SAMPLES\` (100):

- add 1 to \`produced\`,
- read the sensor with \`read_sensor()\` (call it **after** the increment),
- put the reading into a ring buffer. If the buffer is full, count the sample in \`dropped\`.

Nothing else. No printing in the interrupt function.

## main (consumer)
In \`while(1)\`, whenever a sample is in the buffer:

- take it out, add it to \`sum\` and add 1 to \`logged\`,
- after every 10th sample, print the progress and then store it, which is slow:

\`\`\`c
serial_printf(&SerialA, "%d %ld\\r\\n", logged, sum);
slow_work(30000);     // 3 ms: stands for writing a block to an SD card
\`\`\`

\`logged\` is 16 bits (\`%d\`) and \`sum\` is 32 bits (\`%ld\`).

## What the tests look at
- All 100 samples are logged, none dropped: \`logged\` is 100, \`dropped\` is 0, and \`sum\` is the sum of all 100 readings.
- The last line printed is the total.
- The interrupt function stays short, and nothing is printed from it.

While main is busy for 3 ms, about three samples arrive. \`BUF_SIZE\` is 8, so a correct buffer never fills here. Shared variables that both sides write still need their critical section.
`,
      kit: "robot",
      durationMs: 150,
      starter: loggerProgram({
        globals: `
// Your ring buffer variables go here`,
        fns: `// Your buffer functions go here`,
        isr: `    // Produce one sample (see the briefing)
`,
        loop: `        // Consume: take a sample if there is one, sum it, print every 10th
`,
      }),
      solution: loggerProgram({
        globals: `
uint16_t buf[BUF_SIZE];
uint16_t head = 0;
uint16_t tail = 0;
uint16_t count = 0;`,
        fns: RING_COUNT_SOLUTION,
        isr: `    if (produced < N_SAMPLES) {
        produced++;
        if (buf_put(read_sensor()) == 0) {
            dropped++;
        }
    }`,
        loop: `        if (buf_get(&v)) {
            sum += v;
            logged++;
            if ((logged % 10) == 0) {
                serial_printf(&SerialA, "%d %ld\\r\\n", logged, sum);
                slow_work(30000);
            }
        }`,
      }),
      checks: [
        { kind: "var", name: "produced", equals: LOG_N, label: "The interrupt produced 100 samples", hint: "Stuck at a small number: interrupts were left disabled on one path of your buffer code." },
        { kind: "var", name: "logged", equals: LOG_N, label: "main logged 100 samples" },
        { kind: "var", name: "dropped", equals: 0, label: "No sample was dropped" },
        { kind: "var", name: "sum", equals: LOG_SUM, label: `sum is the sum of all 100 readings (${LOG_SUM})`, hint: "Too small: samples were lost or overwritten. Too large: a sample was read twice. Call read_sensor() after produced++." },
        { kind: "serial", includes: `100 ${LOG_SUM}\r\n`, label: "The last progress line shows 100 samples and the total" },
        { kind: "serial", matches: "^10 \\d+\\r\\n20 \\d+\\r\\n", label: "A progress line is printed after every 10th sample" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed from the interrupt function" },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 10, label: "The interrupt function takes less than 10 microseconds" },
      ],
      watch: ["produced", "logged", "dropped", "sum"],
      hints: [
        "Reuse buf_put and buf_get from the ring buffer level, with head, tail and count.",
        "Interrupt: `if (produced < N_SAMPLES) { produced++; if (buf_put(read_sensor()) == 0) dropped++; }`",
        "main: `if (buf_get(&v)) { sum += v; logged++; if ((logged % 10) == 0) { serial_printf(...); slow_work(30000); } }`",
      ],
      takeaway: "Sample in the interrupt at a steady rate, do the slow work in main, and put a buffer with a short critical section between them. Most embedded data paths look like this.",
    },
    {
      id: "thr-interleave",
      kind: "calc",
      tier: "practice",
      title: "Counting interleavings",
      goal: "Work out the result of unprotected increments for given schedules.",
      refs: [{ course: "L13" }],
      brief: `
Two threads, A and B, run \`counter += 1;\` with **no** protection. Each increment is three machine steps: read (R), add (A), write (W). The add happens in the thread's own register, so only the order of reads and writes of \`counter\` matters for the result.

An increment is lost whenever a thread writes a value that it computed from a read made **before** the other thread's write.

Work out each case by writing down the value in \`counter\` and in each thread's register after every step.

For the last two fields: with one increment per thread there are 6 machine steps. An interleaving is one way of merging A's three steps with B's three steps, keeping each thread's own order. The number of ways to choose which 3 of the 6 positions belong to A is "6 choose 3".
`,
      fields: [
        {
          id: "both",
          label: "counter is 4. A reads, B reads, A adds and writes, B adds and writes. Final counter",
          answer: 5,
          why: "Both read 4, both write 5. One update is lost.",
        },
        {
          id: "three",
          label: "counter is 0. Each thread increments 3 times. A reads 0 and is paused; B does all 3 of its increments; A continues and finishes its 3. Final counter",
          answer: 3,
          why: "B brings the counter to 3. A then writes 0 + 1 = 1, wiping out B's work, and its two further increments give 3.",
        },
        {
          id: "max",
          label: "Same program (3 increments each, from 0): the largest possible final value",
          answer: 6,
          why: "If no increment of one thread overlaps one of the other, none is lost: 3 + 3.",
        },
        {
          id: "ways",
          label: "One increment per thread: number of different interleavings of the 6 machine steps",
          answer: 20,
          why: "6 choose 3 = 6! / (3! x 3!) = 20.",
        },
        {
          id: "good",
          label: "How many of those interleavings give the correct result",
          answer: 2,
          why: "Only when one thread finishes its write before the other starts its read: all of A then all of B, or all of B then all of A.",
        },
      ],
      hints: [
        "Track three numbers per step: counter, A's register, B's register.",
        "A thread that was paused after its read continues with the old value.",
        "For the count of interleavings use 6! / (3! x 3!).",
      ],
      takeaway: "Only 2 of the 20 orders are correct, yet in practice the program is right nearly every time, because the three steps are so short. That is what makes races hard to find by testing.",
    },
    {
      id: "thr-torn",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The clock that ran backwards",
      goal: "main reads a 32-bit tick count in two halves and sometimes gets nonsense. Make the read consistent.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
The CPU's memory is 16 bits wide. A \`uint32_t\` is stored as **two words**, and reading it takes two memory accesses. If an interrupt changes the variable between them, main gets the low half of the old value and the high half of the new one: a **torn read**.

This simulator reads a 32-bit variable in one step, so the program stores the count the way the chip does, as two 16-bit variables, to make the two accesses visible:

\`\`\`c
lo = ticks_lo;      // first memory access
hi = ticks_hi;      // second memory access
\`\`\`

The interrupt adds 0x2000 to the count every 20 microseconds. Every 8th time, the low word wraps to 0 and the high word goes up by one. If that happens between main's two reads, main combines the old low word (0xE000) with the new high word and sees a time that is 0x10000 too large. On the next pass the time seems to jump **backwards**. The loop counts those jumps in \`torn\`.

Run it: \`torn\` is not 0. Nothing is wrong with the counter itself. Only the read is broken.

Fix the read so that \`lo\` and \`hi\` always belong to the same value. Keep the loop and the interrupt function as they are.
`,
      kit: "robot",
      durationMs: 60,
      starter: tornProgram(`        lo = ticks_lo;
        hi = ticks_hi;`),
      solution: tornProgram(`        DINT;
        lo = ticks_lo;
        hi = ticks_hi;
        EINT;`),
      checks: [
        { kind: "var", name: "torn", equals: 0, label: "The time never jumps backwards (no torn read)", hint: "The two reads must not be separated by an interrupt." },
        { kind: "var", name: "reads", min: 2000, label: "main keeps reading the time" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 300, label: "The tick interrupt keeps running", hint: "Interrupts must be enabled again right after the two reads." },
        { kind: "var", name: "now", min: 0x100000, label: "The clock keeps counting" },
      ],
      watch: ["ticks_lo", "ticks_hi", "now", "torn"],
      hints: [
        "The two reads together are the critical section.",
        "`DINT;` before `lo = ticks_lo;` and `EINT;` after `hi = ticks_hi;`.",
        "Another way, without disabling interrupts: read hi, then lo, then hi again, and repeat while the two hi values differ. In this simulator that loop runs more slowly than on the chip, and it still passes.",
      ],
      takeaway: "On a 16-bit machine a 32-bit long or a float is not read atomically. Copy it inside a short critical section before you use it.",
    },
    {
      id: "thr-lockfree",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A buffer without a lock",
      goal: "Write a ring buffer for one producer and one consumer that never disables interrupts.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
Disabling interrupts delays the control loop. With exactly **one producer** (the interrupt) and **one consumer** (main) a ring buffer needs no critical section at all, if you obey three rules.

1. **No shared counter.** \`count\` was the only variable both sides wrote. Remove it. Full and empty are decided from \`head\` and \`tail\` alone.
2. **One writer per index.** Only the producer writes \`head\`. Only the consumer writes \`tail\`. Each side may read the other's index. Both are 16 bits, one memory word, so a read or a write of an index is a single access and cannot be torn.
3. **Data first, index last.** The producer stores the sample and only then advances \`head\`. The consumer copies the sample out and only then advances \`tail\`. The index update is the moment the slot changes hands.

## Full and empty without a counter
With only two indexes, \`head == tail\` could mean empty or full. The usual answer is to keep **one slot always free**:

- empty: \`head == tail\`
- full: the slot after \`head\` is \`tail\`

So a buffer of \`BUF_SIZE\` 8 holds at most 7 samples.

Switch the figure to "lock-free, no count" and fill it: it stops at 7 samples.

{{figure:ring-buffer}}

## Why it is safe
Think about what the other side can do at each point of your code. While the consumer runs, the producer can only move \`head\` forward: a buffer the consumer saw as non-empty stays non-empty, and the slot at \`tail\` is not touched. While the producer runs, the consumer can only move \`tail\` forward: a buffer the producer saw as not full stays not full. A stale index only makes a side **too careful** (it reports full or empty one sample early), never wrong.

## Write
\`buf_put\` (interrupt) and \`buf_get\` (main) with the same interface as before. No \`DINT\`, no \`EINT\`, no \`count\`. The test is the same: 60 samples, a 15 ms stall at sample 30, and every sample must be received or counted as dropped.
`,
      kit: "robot",
      durationMs: 100,
      starter: ringProgram({
        fill: "((head + BUF_SIZE - tail) % BUF_SIZE)",
        slowAt: 30,
        fns: `// Called by the interrupt. Returns 1 if stored, 0 if the buffer is full.
int buf_put(uint16_t v)
{
    return 0;
}

// Called by main. Returns 1 and fills *v, or 0 if the buffer is empty.
int buf_get(uint16_t *v)
{
    return 0;
}`,
      }),
      solution: ringProgram({
        fill: "((head + BUF_SIZE - tail) % BUF_SIZE)",
        slowAt: 30,
        fns: `// Called by the interrupt. Returns 1 if stored, 0 if the buffer is full.
int buf_put(uint16_t v)
{
    uint16_t next = (head + 1) % BUF_SIZE;

    if (next == tail) {
        return 0;           // full: one slot always stays free
    }
    buf[head] = v;          // data first
    head = next;            // then hand the slot over
    return 1;
}

// Called by main. Returns 1 and fills *v, or 0 if the buffer is empty.
int buf_get(uint16_t *v)
{
    if (tail == head) {
        return 0;           // empty
    }
    *v = buf[tail];         // data first
    tail = (tail + 1) % BUF_SIZE;
    return 1;
}`,
      }),
      checks: [
        ...ringChecks(45),
        { kind: "source", mustNotMatch: "DINT[\\s\\S]*DINT|EINT[\\s\\S]*EINT", label: "No critical section: DINT and EINT appear only in the start-up code" },
        { kind: "source", mustNotMatch: "\\bcount\\b", label: "No shared counter named count" },
      ],
      watch: ["head", "tail", "produced", "received", "dropped", "missing"],
      hints: [
        "Compute the index after head once: `next = (head + 1) % BUF_SIZE;`. The buffer is full when `next == tail`.",
        "In buf_put write `buf[head] = v;` before `head = next;`. If you advanced head first, main could read a slot that holds no sample yet.",
        "buf_get: `if (tail == head) return 0; *v = buf[tail]; tail = (tail + 1) % BUF_SIZE; return 1;`",
      ],
      takeaway: "One writer per variable, single-word indexes, data before index: with those rules a single-producer, single-consumer queue needs no lock. Add a second producer and the argument falls apart.",
    },
    {
      id: "thr-inversion",
      kind: "quiz",
      tier: "expert",
      title: "Priority inversion and other traps",
      goal: "Reason about priorities, locks and lock-free code in situations where intuition fails.",
      refs: [{ course: "L13" }, { trm: "3.4.5" }],
      brief: `
## Priority inversion
Three threads with priorities **high**, **medium** and **low**. The scheduler always runs the highest-priority thread that is ready.

1. Low locks a mutex and starts a short critical section.
2. High becomes ready, preempts low, and asks for the same mutex. It must wait for low.
3. Medium becomes ready. It needs no mutex. It has a higher priority than low, so it runs, for as long as it likes.

Low cannot finish its critical section because medium is running. High cannot run because low holds the mutex. So the **high**-priority thread is waiting for the **medium** one, with which it shares nothing. The priorities are effectively turned upside down. A Mars lander kept resetting for this reason in 1997.

The cure is **priority inheritance**: while a thread holds a mutex that a higher-priority thread waits for, it runs at that higher priority. Low then finishes its critical section ahead of medium and releases the lock.

## On the microcontroller
Interrupt functions have priorities too (lowest PIE group and channel first), but an interrupt function can never wait for a lock that main holds: main cannot run until the interrupt function returns. If an interrupt function looped until main released something, the program would hang. That is why the only "lock" between main and interrupts is to disable interrupts, and why interrupt functions never wait.

## Lock-free reasoning
The buffer from the last level is safe because each index has exactly one writer. Check every claim like that against the question "what can the other side do between any two of my steps?".
`,
      questions: [
        {
          prompt: "In the priority inversion scenario, which thread is the high-priority thread really waiting for?",
          options: ["The low-priority thread only", "The medium-priority thread, which keeps the low one from releasing the mutex", "The scheduler", "Itself"],
          answer: 1,
          why: "Low would release the mutex quickly if it could run. Medium, which needs no lock, preempts low and so delays high for an unbounded time.",
        },
        {
          prompt: "How does priority inheritance fix it?",
          options: [
            "The high-priority thread skips the mutex",
            "The medium thread is stopped permanently",
            "The thread holding the mutex temporarily runs at the priority of the highest thread waiting for it",
            "All threads get the same priority forever",
          ],
          answer: 2,
          why: "Low is boosted above medium, finishes its critical section, releases the mutex and drops back to its own priority.",
        },
        {
          prompt: "An interrupt function contains `while (busy) {}` where `busy` is a flag that main sets to 1 during an update and back to 0 afterwards. What happens if the interrupt fires while `busy` is 1?",
          options: [
            "It waits a few microseconds and continues",
            "The program hangs: main cannot run to clear the flag until the interrupt function returns",
            "The CPU switches back to main automatically",
            "The interrupt is cancelled",
          ],
          answer: 1,
          why: "Main is suspended for as long as the interrupt function runs. A wait inside an interrupt function for something only main can do is a deadlock.",
        },
        {
          prompt: "The lock-free ring buffer gets a **second** producer: a second interrupt that can interrupt the first one and also calls `buf_put`. Is it still safe?",
          options: [
            "Yes, the indexes are still 16 bits",
            "No: two producers can read the same `head`, store into the same slot, and one sample is lost",
            "Yes, as long as the buffer is large",
            "No, but only when the buffer is empty",
          ],
          answer: 1,
          why: "The proof needed exactly one writer of `head`. With two, `head` has a read-modify-write race again, just like the counter.",
        },
        {
          prompt: "In the lock-free `buf_put`, what goes wrong if `head` is advanced **before** the sample is stored?",
          options: [
            "Nothing, the order does not matter",
            "The buffer reports full too early",
            "If the consumer could run between the two statements, it would see a non-empty buffer and read a slot that holds no sample yet",
            "The index would be torn",
          ],
          answer: 2,
          why: "Advancing the index hands the slot to the other side. Hand it over only when the data is in place. With a producer in main and a consumer in an interrupt, this order is what keeps it correct.",
        },
      ],
      hints: ["Who holds the mutex, and who is allowed to run?", "For the last two questions, list who writes each variable."],
      takeaway: "Locks interact with scheduling: a bounded critical section can become an unbounded wait. Lock-free code is safe only under the exact conditions of its proof.",
    },
  ],
};
