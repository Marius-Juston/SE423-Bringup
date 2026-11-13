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

// ---------------------------------------------------------------- pair
const pairProgram = (read: string) => `__interrupt void cpu_timer0_isr(void);

// The robot's position. The robot drives along a straight line on which
// y is always twice x. The interrupt changes both, so pos_y == 2 * pos_x.
int32_t pos_x = 0;
int32_t pos_y = 0;

uint32_t reads = 0;       // how many times main read the position
uint32_t mixed = 0;       // reads whose x and y do not belong together

void main(void)
{
    int32_t x;
    int32_t y;
    uint32_t i;

${setup(20)}

    for (i = 0; i < 20000; i++) {
${read}
        if (y != 2 * x) {
            mixed++;
        }
        reads++;
    }

    DINT;
    while (1) {}
}

// Every 20 us: the robot has moved one step along its line
__interrupt void cpu_timer0_isr(void)
{
    pos_x = pos_x + 1;
    pos_y = pos_y + 2;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

// ---------------------------------------------------------------- torn read
const tornProgram = (read: string) => `__interrupt void cpu_timer0_isr(void);

// One 64-bit time stamp, kept as two 32-bit halves
uint32_t time_lo = 0;
uint32_t time_hi = 0;

uint32_t last_lo = 0;
uint32_t last_hi = 0;
uint32_t reads = 0;
uint32_t torn = 0;        // times the clock seemed to run backwards

void main(void)
{
    uint32_t lo;
    uint32_t hi;
    uint32_t i;

${setup(20)}

    for (i = 0; i < 30000; i++) {
${read}
        if (hi < last_hi || (hi == last_hi && lo < last_lo)) {
            torn++;
        }
        last_lo = lo;
        last_hi = hi;
        reads++;
    }

    DINT;
    while (1) {}
}

// Every 20 us: add 0x20000000 to the 64-bit time, one half at a time
__interrupt void cpu_timer0_isr(void)
{
    time_lo += 0x20000000;
    if (time_lo == 0) {
        time_hi++;        // carry into the high half
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

const ringChecks = (minReceived: number, lockFree = false) => [
  { kind: "var" as const, name: "produced", equals: 60, label: "The interrupt produced 60 samples", hint: "If this is far below 60, interrupts were left disabled somewhere." },
  { kind: "var" as const, name: "order_errors", equals: 0, label: "No sample arrives twice or out of order", hint: "Three usual causes. An index that does not wrap: both need `% BUF_SIZE`, not `% (BUF_SIZE - 1)` and not a plain `++`. A full buffer that is not refused: `if (count == BUF_SIZE) return 0;` comes first in buf_put. Or the wrong order: store in `buf[head]` first, then move head." },
  { kind: "var" as const, name: "missing", equals: 0, label: "Every sample is either received or counted as dropped", hint: lockFree ? "The indexes do not match what is in the buffer. buf_put moves head only when it stored a sample, buf_get moves tail only when it handed one out, and both wrap with `% BUF_SIZE`." : "count does not match what is in the buffer. buf_put adds 1 to count for every sample it stores, buf_get subtracts 1 for every sample it hands out, and neither changes count when it returns 0." },
  { kind: "var" as const, name: "dropped", min: 1, max: 60 - minReceived, label: "The full case happens and is reported (a few samples dropped while main was busy)", hint: "buf_put must return 0 when the buffer is full, and only then." },
  { kind: "var" as const, name: "received", min: minReceived, label: `Main received at least ${minReceived} samples`, hint: "If it is 0, buf_get always reports empty: check that buf_put really stores the sample and counts it, and that buf_get returns 1 after it filled *v." },
  { kind: "var" as const, name: "received", at: 15.5, min: 11, max: 15, label: "After 15 ms main has received 11 to 15 samples: they flow through the buffer as they are made" },
];

// The simulator runs one C statement as one step, so an unprotected count--
// cannot actually fail here. The source is checked instead.
const RING_LOCK_CHECK = {
  kind: "source" as const,
  mustMatch: "buf_get\\s*\\([^)]*\\)\\s*\\{(?:(?!\\n\\})[\\s\\S])*DINT(?:(?!\\n\\})[\\s\\S])*EINT",
  label: "buf_get changes count inside a critical section (DINT ... EINT)",
  hint: "count-- in main is a read-modify-write of a variable the interrupt also writes. Keep DINT; before it and EINT; after it, on every path.",
};

const RING_PUT_CHECK = {
  kind: "source" as const,
  mustNotMatch: "buf_put\\s*\\([^)]*\\)\\s*\\{(?:(?!\\n\\})[\\s\\S])*(DINT|EINT)",
  label: "buf_put has no DINT or EINT: it runs inside the interrupt function",
  hint: "Interrupts are already off while the interrupt function runs. EINT; in buf_put would switch them on again in the middle of it.",
};

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
  title: "Threads and processes",
  blurb: "Shared data, races, locks, producer-consumer buffers, and what must run in real time.",
  requires: ["interrupts"],
  course: ["L13"],
  levels: [
    {
      id: "thr-brief",
      kind: "brief",
      title: "Two things at once",
      goal: "Learn what processes and threads are, what they share, and how a shared counter loses an update.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
Your robot has two computers. The F28379D runs your C code and nothing else. The second is a **Raspberry Pi**, a small computer that runs **Linux**. Linux is an **operating system**: a program that starts other programs and shares the processor among them, so that many run at the same time.

## Program, process, thread
- A **program** is a file on disk: instructions, nothing running.
- A **process** is a program that is running. Linux gives it its own memory: the code, the global variables, the **heap** (memory the program asks for while it runs) and a **stack** (the local variables of the functions that are running now). One process cannot see another's memory.
- A **thread** is one path through the code of a process: one "you are here". A process can have several. Each thread has its **own stack** and its **own CPU registers**: not the hardware registers of chapter 1, but the few working slots inside the processor that hold the numbers it is calculating with. All threads of a process **share** the code, the global variables and the heap.

The part of Linux called the **scheduler** decides which thread runs. It can pause a thread between any two **machine instructions**, the small steps the compiler turns your C into. The Pi has four **cores** (four processors in one chip), so four threads can also run at the same instant.

## And on the microcontroller?
The F28379D has no threads, but it has **interrupts**: \`main()\` is paused at a point you do not choose, an interrupt function runs, and \`main()\` continues. The two take turns, they **interleave**, and they share every global variable. For shared data that is the same problem as two threads.

## The race
\`counter += 1;\` looks like one step. The machine may do three: **read** the value from memory into a CPU register, **add** 1 there, **write** the result back. If another thread, or an interrupt, changes \`counter\` in between, that change is overwritten and lost. The result depends on timing: a **race condition**.

In the figure you are the scheduler. Step A once, run B to its end, then finish A.

{{figure:lost-update}}

The cure is to keep the three steps together. The next levels show how.
`,
      questions: [
        {
          prompt: "Two threads of the same process: which of these does each thread have for itself?",
          options: ["The global variables", "The heap", "The stack and the CPU registers", "The program code"],
          answer: 2,
          why: "Each thread needs its own CPU registers and its own stack to keep its place in the code and its local variables. Code, globals and heap are shared.",
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
            "It can be three machine steps (read, add, write), and the other thread can run between them",
            "The compiler removes it",
            "Global variables cannot be changed by threads",
          ],
          answer: 1,
          why: "Both threads can read the same old value, and both write old + 1. One of the two additions is lost.",
        },
      ],
      takeaway: "Threads share globals and heap, and main() and interrupt functions share globals. A change of shared data that takes more than one machine step can lose an update.",
    },
    {
      id: "thr-shared",
      kind: "quiz",
      title: "Whose memory is it?",
      goal: "Decide what processes, threads and interrupt functions share.",
      refs: [{ course: "L13" }],
      brief: `
Before you can protect shared data you have to know what is shared.

- **Two processes**: nothing is shared, unless they ask Linux for **shared memory**, a block both can see. The gain of sharing nothing is isolation: a process that crashes cannot damage the memory of another.
- **Two threads of one process**: code, global variables and heap are shared, so passing data is free. Local variables are not shared, because they live on each thread's own stack.
- **main() and an interrupt function** on the microcontroller: global variables are shared. The local variables of the interrupt function exist only during that one call.

A variable needs protection when **all three** are true:

1. two paths can reach it (two threads, or main and an interrupt),
2. at least one of them writes it,
3. the access takes more than one machine step, or several variables must change together.

A local variable never needs protection. Neither does a constant: nobody writes it.

## How it looks on the Pi (to read, not to write)
A process starts with one thread, \`main\`. The \`pthread\` library starts more:

\`\`\`c
pthread_create(&tid, NULL, job, NULL);   // start a thread that runs the function job
pthread_join(tid, NULL);                 // wait until that thread has ended
\`\`\`

\`tid\` is a variable that identifies the new thread. \`NULL\` is a pointer to nothing and means "no special options" here.

The course runs two processes on the Pi. \`serial_COMandOpti\` talks to the F28379D and to OptiTrack, the camera system that tells the robot where it is in the room. \`AstarApp\` plans a path through the room (A*, chapter 19). They pass the robot's position and the path through shared memory, together with a **semaphore**: a counter that one side raises to say "new data is ready". You will build one later in this chapter.
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
          why: "Each process has its own memory. To share a value they must ask Linux for shared memory.",
        },
        {
          prompt: "`main()` of a pthread program calls `pthread_create(&tid, NULL, job, NULL);` and later `pthread_join(tid, NULL);`. What does the second call do?",
          options: [
            "It starts `job` a second time",
            "It waits until the thread that runs `job` has ended",
            "It locks a mutex",
            "It copies the thread's local variables into main",
          ],
          answer: 1,
          why: "pthread_create starts the thread, pthread_join waits for it to end. Without the join, main can return, and the whole process ends, while the thread is still working.",
        },
        {
          prompt: "`AstarApp` crashes because it used a pointer to the wrong address. `serial_COMandOpti` is a separate process. What happens to it?",
          options: [
            "It crashes too: they share the heap",
            "It keeps running: its memory is its own, so the crash cannot corrupt it",
            "Linux restarts both",
            "Its global variables are reset to 0",
          ],
          answer: 1,
          why: "Each process has its own memory. This fault isolation is a main reason to split a system into processes. Had the two been threads of one process, the crash would have ended both.",
        },
        {
          prompt: "The Pi's path planner and the program that talks to the F28379D are two processes. How does the course code pass the robot's position between them?",
          options: [
            "Through a global variable",
            "Through the stack",
            "Through shared memory, guarded by a semaphore",
            "It cannot: processes are isolated",
          ],
          answer: 2,
          why: "AstarApp.c opens shared memory and a semaphore. The writer raises the semaphore when a complete new set of values is in the shared memory, and the reader takes it before reading.",
        },
      ],
      hints: ["Global or heap: shared between threads. Local: private.", "Two processes: private, unless they set up shared memory."],
      takeaway: "Globals are shared, locals are private, processes share only what they explicitly set up.",
    },
    {
      id: "thr-race",
      kind: "code",
      mode: "complete",
      title: "Catch the race, then close it",
      goal: "Watch a counter lose updates between main and a timer interrupt, then protect it with DINT and EINT.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }, { trm: "3.4.4" }],
      brief: `
\`shared\` is a counter. \`main()\` adds 1 to it 20000 times. The timer 0 interrupt function also adds 1 to it, every 50 microseconds. Each side counts its own additions in \`main_adds\` and \`isr_adds\`, so at the end

\`\`\`c
lost = (main_adds + isr_adds) - shared;
\`\`\`

should be 0.

## Why the loop has three lines
The compiler may turn \`shared++;\` into three machine instructions: read, add, write. You cannot tell from the C source whether it does. This simulator runs one C statement as one step, so the program writes the three steps as three statements:

\`\`\`c
tmp = shared;       // read
tmp = tmp + 1;      // add
shared = tmp;       // write
\`\`\`

Treat every \`x++\`, \`x += n\` and \`x = x + n\` on shared data as these three steps.

Try it in the figure: choose "main and an interrupt", step main() once and fire the interrupt. Then turn on DINT / EINT and fire it at the same moment.

{{figure:lost-update}}

## What to do
1. Press **Run** as it is. Look at \`lost\` in the watch list: it is not 0. Each lost update is one interrupt that landed between the read and the write.
2. Make the three statements a **critical section**: a stretch of code that the other side must not interrupt. Put \`DINT;\` on the line before them and \`EINT;\` on the line after them. You know both from chapter 5: \`DINT;\` closes the last gate (INTM), so no interrupt can start, and \`EINT;\` opens it again. A request that arrives in between is not lost. Its flag stays set, and the function runs right after \`EINT;\`.

Keep a critical section short. The interrupt waits for as long as it lasts.

## The same idea on Linux (to read)
One thread cannot switch another thread off. Threads use a **mutex** instead, a lock that only one thread can hold at a time. A second thread that asks for it waits until the first gives it back:

\`\`\`c
pthread_mutex_lock(&lock);
shared = shared + 1;
pthread_mutex_unlock(&lock);
\`\`\`
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
        { kind: "var", name: "lost", equals: 0, label: "No update is lost: shared equals main_adds + isr_adds", hint: "A positive number is the count of interrupts that landed between the read and the write. So DINT; must be on the line before `tmp = shared;` and EINT; on the line after `shared = tmp;`, in that order. -1 means the loop did not finish." },
        { kind: "var", name: "main_adds", equals: 20000, label: "main added 1 exactly 20000 times" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 60, label: "The timer interrupt keeps running during the loop", hint: "Interrupts stayed off. Every pass of the loop needs both lines: DINT; before the read and EINT; after the write, inside the braces of the for loop." },
        {
          kind: "source",
          mustMatch: "for\\s*\\(\\s*i\\s*=\\s*0[\\s\\S]*?DINT\\s*;[\\s\\S]*?EINT\\s*;",
          label: "The update of shared inside the loop is between DINT; and EINT;",
          hint: "Both lines go inside the braces of the for loop: DINT; before the read, EINT; after the write. Around the whole loop they would switch the interrupt off for the entire run. Writing shared++; on one line hides the three steps in this simulator, but not on the chip.",
        },
        {
          kind: "source",
          mustMatch: "lost\\s*=\\s*\\(\\s*main_adds\\s*\\+\\s*isr_adds\\s*\\)\\s*-\\s*shared\\s*;[\\s\\S]*shared\\+\\+;\\s*isr_adds\\+\\+;",
          label: "The bookkeeping is unchanged: lost is still computed from the three counters, and the interrupt still adds to shared",
        },
        { kind: "var", name: "main_adds", at: 2, min: 500, max: 19999, label: "After 2 ms the loop is under way and not yet finished" },
      ],
      watch: ["shared", "main_adds", "isr_adds", "lost"],
      hints: [
        "Run it unchanged first and read `lost`.",
        "The critical section is the read, the add and the write. `main_adds++` is only used by main, so it can stay outside.",
        "`DINT;` on the line before `tmp = shared;` and `EINT;` on the line after `shared = tmp;`.",
      ],
      takeaway: "A read-modify-write of shared data is a critical section. On the microcontroller DINT/EINT guard it, on Linux a mutex does.",
    },
    {
      id: "thr-copy",
      kind: "code",
      mode: "complete",
      title: "Two values that belong together",
      goal: "Copy a position (x and y) that the interrupt keeps changing, so that the two numbers always come from the same moment.",
      refs: [{ course: "L13" }, { course: "Lab 1" }, { trm: "3.4.3" }],
      brief: `
In the last level main **changed** shared data. Here main only **reads** it, and there is still a race.

The interrupt keeps the robot's position in two variables, \`pos_x\` and \`pos_y\`. The robot drives along a line on which y is always twice x, and the interrupt moves both, one after the other. So whenever main looks, \`pos_y == 2 * pos_x\` should hold.

main copies them with two statements:

\`\`\`c
x = pos_x;
y = pos_y;
\`\`\`

Suppose \`pos_x\` is 10 and \`pos_y\` is 20. main copies x = 10. Now the interrupt runs and moves the robot to (11, 22). main continues and copies y = 22. It holds (10, 22): a place where the robot never was. Each number is right on its own. Together they are wrong.

## What to do
1. Press **Run**. \`mixed\` counts the reads where y was not twice x. It is not 0.
2. Make the two copies a critical section: \`DINT;\` before them, \`EINT;\` after them.

## Copy first, then use
Put **only the two copies** between \`DINT;\` and \`EINT;\`. The test and the counting work on main's own \`x\` and \`y\`, which the interrupt cannot touch, so they belong after \`EINT;\`.

This is the pattern for printing as well. Printing takes milliseconds, and the values could change in the middle of a line. So: \`DINT;\`, copy the shared values into local variables, \`EINT;\`, then print the copies. Never print inside a critical section: every interrupt would wait for those milliseconds.
`,
      kit: "robot",
      durationMs: 20,
      starter: pairProgram(`        // TODO: make these two copies a critical section
        x = pos_x;
        y = pos_y;`),
      solution: pairProgram(`        DINT;
        x = pos_x;
        y = pos_y;
        EINT;`),
      checks: [
        { kind: "var", name: "mixed", equals: 0, label: "x and y always belong together: mixed is 0", hint: "A positive number counts the interrupts that landed between the two copies. DINT; goes on the line before `x = pos_x;` and EINT; on the line after `y = pos_y;`." },
        { kind: "var", name: "reads", equals: 20000, label: "main read the position 20000 times", hint: "Fewer: the loop did not finish in time. Keep the loop as it is and only add the two lines." },
        { kind: "isr", fn: "cpu_timer0_isr", min: 150, label: "The interrupt keeps moving the robot during the loop", hint: "Interrupts stayed off. EINT; must come after the second copy, inside the braces of the for loop, on every pass." },
        {
          kind: "source",
          mustMatch: "for\\s*\\(\\s*i\\s*=\\s*0[\\s\\S]*?DINT\\s*;[\\s\\S]*?pos_x[\\s\\S]*?pos_y[\\s\\S]*?EINT\\s*;",
          label: "Inside the loop, both copies are between DINT; and EINT;",
          hint: "Both lines go inside the for loop: DINT; x = pos_x; y = pos_y; EINT;",
        },
        {
          kind: "source",
          mustMatch: "pos_x = pos_x \\+ 1;\\s*pos_y = pos_y \\+ 2;",
          label: "The interrupt function is unchanged",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "EINT\\s*;\\s*if\\s*\\(\\s*y\\s*!=",
          label: "Short critical section: only the two copies are inside, the test comes after EINT;",
          hint: "The test uses main's own x and y. Move EINT; up, to the line right after `y = pos_y;`.",
        },
      ],
      watch: ["pos_x", "pos_y", "reads", "mixed"],
      hints: [
        "Run it unchanged first and read `mixed`.",
        "The interrupt must not run between `x = pos_x;` and `y = pos_y;`. Which two lines from the last level keep it out?",
        "`DINT;` on the line before `x = pos_x;` and `EINT;` on the line after `y = pos_y;`.",
      ],
      takeaway: "Reading can race too. Values that belong together are copied inside one short critical section, and then you work on (or print) the copies.",
    },
    {
      id: "thr-deadlock",
      kind: "quiz",
      title: "Deadlock",
      goal: "Recognise a deadlock from two locks, and learn the rule that prevents it.",
      refs: [{ course: "L13" }],
      brief: `
Locks fix races and bring a new problem. This one belongs to the Pi, where threads use a mutex: \`pthread_mutex_lock(&m);\` takes the lock \`m\`, or waits until the thread that holds it gives it back.

Thread A and thread B both need two mutexes, \`m1\` and \`m2\`, and take them in opposite orders:

\`\`\`c
// thread A                      // thread B
pthread_mutex_lock(&m1);         pthread_mutex_lock(&m2);
pthread_mutex_lock(&m2);         pthread_mutex_lock(&m1);
\`\`\`

Follow one unlucky schedule:

1. A takes \`m1\`.
2. The scheduler pauses A and runs B. B takes \`m2\`.
3. B asks for \`m1\`. A holds it, so B waits.
4. A runs again and asks for \`m2\`. B holds it, so A waits.

Each waits for a lock that the other will only give back after it has continued. Neither ever continues. That is a **deadlock**. Nothing crashes and no error is printed. The two threads simply stop.

Like a race, it depends on timing. If A happens to take both locks before B starts, all is well. So most runs work, and one run in a thousand hangs.

## The cure
Every thread takes the locks **in the same order**: always \`m1\` first, then \`m2\`. Then a thread that holds \`m2\` already holds \`m1\`, and nobody else can be holding \`m1\` and waiting for \`m2\`.

## On the microcontroller
There is only one "lock", \`DINT;\`, so this deadlock cannot happen. A relative of it can: code that leaves a critical section without \`EINT;\`. Then the interrupt waits forever. You will repair one in "The lock that was never opened".
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
          prompt: "The program with the two opposite lock orders ran 500 times in testing without a hang. What does that tell you?",
          options: [
            "The program is correct",
            "Very little: the deadlock needs one particular timing, which may not have occurred yet",
            "Deadlocks only happen on the first run",
            "The mutexes are not being used",
          ],
          answer: 1,
          why: "The hang needs B to run exactly between A's two lock calls. That is rare, not impossible. Timing bugs are found by reasoning about the code, not by counting good runs.",
        },
      ],
      hints: ["Draw who holds which lock and who waits for which.", "Which thread would have to continue for the other one's lock to be released?"],
      takeaway: "A deadlock is two threads that each wait for a lock the other holds. Take locks in one fixed order, everywhere.",
    },
    {
      id: "thr-sem",
      kind: "code",
      mode: "write",
      title: "A semaphore made of a counter",
      goal: "Write post and wait so that the interrupt can hand jobs to main without losing any.",
      refs: [{ course: "L13" }, { course: "Lab 1" }, { trm: "3.4.3" }],
      brief: `
You know the flag pattern from chapter 5: the interrupt sets \`UARTPrint = 1;\` and \`main()\` does the slow work. A flag has a weakness. If the interrupt fires three times while main is still busy, the flag is still just 1, and two jobs are forgotten.

A **semaphore** is a flag that can count. It has two operations:

- **post**: add 1. "One more job is waiting."
- **wait**: if the count is above 0, take 1 away and go on.

Try both in the figure: ask for three jobs before main takes one.

{{figure:sem-counter}}

On Linux, \`sem_wait\` **blocks** while the count is 0: the scheduler puts the thread to sleep until somebody posts. A microcontroller's main loop must not stop, so you will write the form that never blocks, like Linux's \`sem_trywait\`: take one if there is one, and say whether you got it.

## The program
The timer interrupt runs every 1 ms and posts 40 jobs in total. \`main()\` calls \`sem_trywait()\` in its loop and runs \`do_job()\` each time it returns 1. Most jobs take 0.2 ms, but every 8th takes 3.5 ms, so several posts arrive while main is busy. \`slow_work()\` is given: it only uses up time.

## Write
- \`void sem_post(void)\`: called from the interrupt function. Add 1 to \`sem\`.
- \`int sem_trywait(void)\`: called from main. If \`sem\` is above 0, subtract 1 and return 1. Otherwise return 0.

The subtraction in main is a read, a subtract and a write of data the interrupt also writes. So "test, then subtract" is a critical section: \`DINT;\` before the test, \`EINT;\` after the subtraction, on **every** path out of the function. A \`return\` between \`DINT;\` and \`EINT;\` would leave interrupts off for good.

\`sem_post\` needs neither. While an interrupt function runs, the CPU has already switched interrupts off (chapter 5), and main cannot run. An \`EINT;\` there would switch them back on in the middle of the interrupt function.

The course's Pi programs use the same pair: \`serial_COMandOpti\` calls \`sem_post\` when new data is in the shared memory, and \`AstarApp\` calls \`sem_trywait\` in its loop.
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
        { kind: "var", name: "posted", equals: 40, label: "The interrupt posted 40 jobs", hint: "Stuck far below 40: interrupts were left off. Look for a `return` in sem_trywait that is reached after DINT; but before EINT;." },
        { kind: "var", name: "jobs", equals: 40, label: "main did all 40 jobs", hint: "Fewer than 40: posts that arrived during a long job were forgotten. sem must count them (sem++), not just be set to 1. More than 40: sem_trywait returned 1 when nothing was waiting. Subtract and return 1 only if sem is above 0." },
        { kind: "var", name: "sem", equals: 0, label: "No job is left waiting at the end", hint: "A huge number such as 65535 means sem went below 0 and wrapped around: test `sem > 0` before you subtract." },
        {
          kind: "source",
          mustNotMatch: "sem_post\\s*\\(\\s*void\\s*\\)\\s*\\{[^}]*(DINT|EINT)",
          label: "sem_post has no DINT or EINT: it runs inside the interrupt function",
          hint: "Interrupts are already off while an interrupt function runs. EINT; in sem_post would switch them on again in the middle of it. sem_post is one statement.",
        },
        { kind: "var", name: "jobs", at: 20.5, min: 16, max: 20, label: "After 20 ms main has done 16 to 20 jobs: it keeps up, and does not run ahead of the posts", hint: "Each job must be taken when it is posted, not counted up at the end." },
        { kind: "var", name: "jobs", at: 10.5, min: 6, max: 10, label: "After 10 ms main has done 6 to 10 jobs" },
        {
          kind: "source",
          mustMatch: "sem_trywait\\s*\\(\\s*void\\s*\\)\\s*\\{[^}]*DINT[\\s\\S]*EINT",
          label: "sem_trywait protects its test-and-subtract with DINT and EINT",
          hint: "Put DINT; before the test of sem and EINT; before every return.",
        },
      ],
      watch: ["sem", "posted", "jobs"],
      hints: [
        "sem_post is one statement: add 1 to `sem`.",
        "In sem_trywait keep the answer in a local variable (`int got = 0;`) and set it to 1 inside the `if`. Then there is a single `EINT;` and a single `return got;` at the end.",
        "`int got = 0; DINT; if (sem > 0) { sem--; got = 1; } EINT; return got;`",
      ],
      takeaway: "A flag remembers that something happened, a semaphore remembers how many times. post adds one, wait takes one.",
    },
    {
      id: "thr-wrap",
      kind: "calc",
      title: "An array that goes round",
      goal: "Work out where a ring buffer's two indexes point after some puts and gets.",
      refs: [{ course: "L13" }],
      brief: `
A semaphore says how many jobs wait. Usually a job carries **data**: a sensor reading, a received character. The interrupt makes the data (it is the **producer**) and main uses it (the **consumer**), often a little later. In between, the data needs a place to wait, in order: first in, first out.

That place is a **ring buffer**: an ordinary array plus two indexes and a count.

\`\`\`c
uint16_t buf[8];
uint16_t head;    // where the producer writes next
uint16_t tail;    // where the consumer reads next
uint16_t count;   // how many values are waiting
\`\`\`

- **put**: store the value in \`buf[head]\`, move \`head\` one slot on, add 1 to \`count\`.
- **get**: take the value from \`buf[tail]\`, move \`tail\` one slot on, subtract 1 from \`count\`.

Both indexes only move forward. After slot 7, the last one, comes slot 0 again: the array is used as a ring. The remainder operator \`%\` from chapter 5 does that in one line:

\`\`\`c
head = (head + 1) % 8;
\`\`\`

Worked example: \`head\` is 3. Then 3 + 1 = 4, and 4 divided by 8 is 0 remainder **4**. \`head\` is 7: 7 + 1 = 8, and 8 divided by 8 is 1 remainder **0**. For every index below 7 the \`%\` changes nothing. At 7 it sends the index back to 0.

Press Put and Get in the figure and watch \`head\` and \`tail\` chase each other round. Fill it completely, then empty it.

{{figure:ring-buffer}}

Two cases need care. With \`count\` at 0 the buffer is **empty**: there is nothing to get. With \`count\` at 8 it is **full**: a put would overwrite the oldest value, which nobody has read yet.

For the fields below the buffer has 8 slots and starts empty, with \`head\`, \`tail\` and \`count\` all 0.
`,
      fields: [
        { id: "next", label: "head is 5. Value of (head + 1) % 8", answer: 6, why: "6 divided by 8 is 0 remainder 6. Below the last slot the index simply goes up by one." },
        { id: "wrap", label: "head is 7. Value of (head + 1) % 8", answer: 0, why: "8 divided by 8 is 1 remainder 0. After the last slot comes slot 0." },
        { id: "head", label: "From empty: 6 puts, then 4 gets, then 4 more puts. Where is head now?", answer: 2, why: "head moved forward 10 times: 0, 1, ... 7, 0, 1, and it now points at slot 2. That is 10 % 8." },
        { id: "tail", label: "Same sequence: where is tail?", answer: 4, why: "tail moved once per get: 4 times, from 0 to 4." },
        { id: "count", label: "Same sequence: what is count?", answer: 6, why: "10 values went in and 4 came out: 6 are waiting, in slots 4, 5, 6, 7, 0 and 1." },
        { id: "room", label: "How many more puts fit before the buffer is full?", answer: 2, why: "Full is count == 8, and 8 - 6 = 2. The third put would overwrite slot 4, the oldest value that is still waiting." },
      ],
      hints: [
        "Play the sequence in the figure: 6 times Put, 4 times Get, 4 times Put.",
        "An index moves one slot per call and goes from 7 back to 0. Count the moves and take the remainder of a division by 8.",
        "10 puts: head = 10 % 8 = 2. 4 gets: tail = 4. count = 10 - 4.",
      ],
      takeaway: "A ring buffer is an array, two indexes that wrap with `% size`, and a count. head belongs to the producer, tail to the consumer.",
    },
    {
      id: "thr-ring",
      kind: "code",
      mode: "write",
      title: "Producer and consumer",
      goal: "Write the put and get functions of a ring buffer that carries samples from the timer interrupt to main, with the full and empty cases.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
Now write the ring buffer of the last level. The array \`buf\`, the indexes \`head\` and \`tail\`, and \`count\` are declared for you. \`BUF_SIZE\` is 8.

## Write
\`int buf_put(uint16_t v)\`, called by the interrupt:

1. If the buffer is full (\`count == BUF_SIZE\`), return 0 and store nothing.
2. Store \`v\` in \`buf[head]\`.
3. Move \`head\` on: \`head = (head + 1) % BUF_SIZE;\`
4. Add 1 to \`count\` and return 1.

\`int buf_get(uint16_t *v)\`, called by main:

1. If the buffer is empty (\`count == 0\`), return 0.
2. Copy \`buf[tail]\` into \`*v\`. \`v\` is a pointer to main's variable, so \`*v = buf[tail];\` writes the sample straight into it.
3. Move \`tail\` on, with the same wrap.
4. Subtract 1 from \`count\` and return 1.

## Where the critical section is
\`count\` is written by both sides. In \`buf_get\`, which runs in main, everything from the test of \`count\` to \`count--\` is a critical section: \`DINT;\` first, \`EINT;\` before **each** \`return\`, the early one for the empty case too.

\`buf_put\` runs inside the interrupt function, where interrupts are already off. It needs no \`DINT\` and must not contain \`EINT\`.

## The test
The interrupt produces the samples 1, 2, 3 ... 60, one per millisecond, and counts a sample in \`dropped\` when \`buf_put\` returns 0. \`process()\` in main is given. It normally takes 0.2 ms. On sample 20 it takes 15 ms, so the 8 slots fill up and some samples must be dropped. That is acceptable. Losing a sample **without knowing**, or receiving one twice, is not.
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
      checks: [...ringChecks(45), RING_LOCK_CHECK, RING_PUT_CHECK],
      watch: ["head", "tail", "count", "produced", "received", "dropped", "missing"],
      hints: [
        "Write buf_put first, one line per step of the briefing: `if (count == BUF_SIZE) { return 0; }`, `buf[head] = v;`, the wrap line, `count++;`, `return 1;`.",
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
This is the ring buffer from the last level, written by someone in a hurry. Run it: \`produced\` stays at 0 and main receives nothing. The timer is set up correctly, and its interrupt worked in the last level.

A critical section has one rule that is easy to break: **every way out must unlock**. A function with an early \`return\` has more than one way out.

Read \`buf_get\` and follow it the first time main calls it, when the buffer is still empty. Deleting \`DINT\` and \`EINT\` is not the fix: \`count--\` still needs its critical section.

On Linux the same mistake is a thread that returns without calling \`pthread_mutex_unlock\`. Every other thread that wants the mutex then waits forever.
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
      checks: [...ringChecks(45), RING_LOCK_CHECK, RING_PUT_CHECK],
      watch: ["count", "produced", "received", "dropped"],
      hints: [
        "The first call of buf_get finds count == 0. Which statements run on that path?",
        "DINT; runs, then `return 0;`. EINT; is never reached, so interrupts stay disabled for good.",
        "Add `EINT;` before `return 0;` inside the `if (count == 0)` block.",
      ],
      takeaway: "Every path out of a critical section must re-enable interrupts (or unlock the mutex). Early returns are where this goes wrong.",
    },
    {
      id: "thr-realtime",
      kind: "quiz",
      title: "Real time or not",
      goal: "Decide which jobs belong on the F28379D and which on the Raspberry Pi, and why.",
      refs: [{ course: "L13" }],
      brief: `
A job is **real time** when a late answer is a wrong answer. Real time does not mean fast. It means **on time, every time**.

Two words describe timing:

- **Latency**: the delay between an event (a timer tick, a new sensor value) and the code that reacts to it.
- **Jitter**: how much that delay changes from one time to the next.

## The F28379D
Nothing runs on it but your code. A timer interrupt function starts a fraction of a microsecond after the tick. The worst case is known: the longest interrupt function or critical section in its way. That is why you keep both short.

## Linux on the Pi
The scheduler shares four cores among hundreds of threads, and Linux has work of its own (the network, the SD card). A thread that asks to sleep 1 ms usually wakes after about 1.1 ms, and once in a while after 10 ms or more. The average is good. The **worst case is not guaranteed**: ordinary Linux is not a real-time system.

## Why a control loop cares
Speed is distance divided by time. The robot's code measures how far a wheel has turned (\`pos\`, in feet) once per millisecond and divides the change by that millisecond:

\`\`\`c
v = (pos - pos_old) / 0.001;     // feet per second, if exactly 1 ms passed
\`\`\`

Worked example: the wheel moved 0.002 ft since the last pass. 0.002 / 0.001 = 2 ft/s. If the pass came late and 3 ms really passed, the wheel moved three times as far, and \`v\` comes out three times too large.

## So the robot splits the work
- **F28379D** (real time): driving the motors, measuring the wheels, the loop that holds speed and steering (the **control loop**), reading sensors at a fixed rate.
- **Pi** (not real time): planning a path through the room (A*, chapter 19), the network link to the PC and to the OptiTrack cameras, anything large or slow that may be 50 ms late without harm.

The two talk over a serial line. When the Pi is late, the F28379D keeps driving on the last command it received.
`,
      questions: [
        {
          prompt: "What makes a job a real-time job?",
          options: [
            "It needs a fast processor",
            "Its result is only correct if it arrives before a deadline, every time",
            "It runs on Linux",
            "It uses interrupts",
          ],
          answer: 1,
          why: "Real time is about a guaranteed worst case, not about average speed. A slow chip that never misses its deadline is real time. A fast one that sometimes does is not.",
        },
        {
          prompt: "A loop on the Pi sleeps 1 ms per pass. You measure the time of each pass: 1.1 ms nearly always, 12 ms once every few seconds. What is this, and what causes it?",
          options: [
            "A race condition in your code",
            "Jitter: the scheduler ran something else when your thread was due",
            "A deadlock",
            "The Pi's clock is wrong",
          ],
          answer: 1,
          why: "Ordinary Linux promises that your thread runs soon, not when. The spread between 1.1 ms and 12 ms is the jitter.",
        },
        {
          prompt: "The speed is computed as `(pos - pos_old) / 0.001`. One pass comes late: 4 ms passed, and the robot drove at a constant 1 ft/s. What speed does that pass compute?",
          options: ["0.25 ft/s", "1 ft/s", "4 ft/s", "0 ft/s"],
          answer: 2,
          why: "In 4 ms the robot moves 0.004 ft. Divided by the assumed 0.001 s that is 4 ft/s. The controller then brakes hard for an error that never existed.",
        },
        {
          prompt: "Where does the wheel speed controller belong?",
          options: [
            "In a thread on the Pi, because the Pi is faster",
            "In a timer interrupt function on the F28379D, because its period must be exact",
            "In the path-planning process",
            "It does not matter",
          ],
          answer: 1,
          why: "The control loop needs a fixed period with almost no jitter. The F28379D gives that. The Pi's extra speed does not help a job that takes microseconds.",
        },
        {
          prompt: "Path planning (A*) on the Pi usually takes 80 ms and sometimes 300 ms. Why is that acceptable?",
          options: [
            "It is not: A* must move to the F28379D",
            "The robot stops and waits for every plan",
            "A new path that arrives a little late is still a good path, and meanwhile the F28379D keeps following the old one",
            "Linux guarantees 80 ms",
          ],
          answer: 2,
          why: "Planning has no hard deadline at this time scale. Jobs like that go to the Pi, which has the memory and the speed for them.",
        },
      ],
      hints: ["Ask of each job: what happens if it runs 20 ms late, once?", "Latency is the delay. Jitter is how much the delay varies."],
      takeaway: "Hard deadlines go to the microcontroller, heavy and tolerant work goes to Linux. Real time means a guaranteed worst case, not a good average.",
    },
    {
      id: "thr-logger",
      kind: "code",
      mode: "checkpoint",
      title: "Data logger",
      goal: "Build a logger: the timer interrupt samples a sensor, main sums and prints, and no sample is lost or used twice.",
      refs: [{ course: "L13" }, { course: "Lab 1" }, { course: "Lab 2" }, { trm: "3.4.3" }],
      brief: `
Put the chapter together. The start-up code, the serial port and the "sensor" are given. The rest is yours. Copy \`buf\`, \`head\`, \`tail\`, \`count\`, \`buf_put\` and \`buf_get\` from your "Producer and consumer" into the marked places. The figure is a reminder of how the buffer works.

{{figure:ring-buffer}}

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

\`serial_printf\` works like \`printf\`, but sends the text over the board's serial port to a terminal on the PC (given here, explained in chapter 6). Copy the line as it is: \`logged\` is 16 bits (\`%d\`) and \`sum\` is 32 bits (\`%ld\`). "After every 10th" is the remainder test from chapter 5: \`if ((logged % 10) == 0)\`.

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
// Paste the ring buffer variables from "Producer and consumer" here:
// buf, head, tail, count`,
        fns: `// Paste your buf_put and buf_get from "Producer and consumer" here`,
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
        { kind: "var", name: "produced", equals: LOG_N, label: "The interrupt produced 100 samples", hint: "Stuck at a small number: interrupts were left disabled on one path of your buffer code. More than 100: wrap the interrupt's work in `if (produced < N_SAMPLES) { ... }`." },
        { kind: "var", name: "logged", equals: LOG_N, label: "main logged 100 samples", hint: "main adds 1 to logged for every sample that buf_get hands it. If samples were dropped, repair that first." },
        { kind: "var", name: "dropped", equals: 0, label: "No sample was dropped", hint: "The buffer filled up, so main was too slow. The print and slow_work(30000) belong inside `if ((logged % 10) == 0) { ... }`, not on every sample." },
        { kind: "var", name: "sum", equals: LOG_SUM, label: `sum is the sum of all 100 readings (${LOG_SUM})`, hint: "Too small: samples were lost or overwritten. Too large: a sample was read twice. Call read_sensor() after produced++." },
        { kind: "serial", includes: `100 ${LOG_SUM}\r\n`, label: "The last progress line shows 100 samples and the total" },
        { kind: "serial", matches: "^10 \\d+\\r\\n20 \\d+\\r\\n", label: "A progress line is printed after every 10th sample", hint: "The first line must be the one for 10 samples. Test `(logged % 10) == 0` only right after `logged++`, inside the `if (buf_get(&v))` block. Outside it, the test is also true while logged is still 0." },
        { kind: "source", mustMatch: "cpu_timer0_isr\\(void\\)\\s*\\{[\\s\\S]*buf_put\\s*\\(", label: "The interrupt function hands each reading to buf_put", hint: "The interrupt only reads the sensor and puts the reading into the buffer. The sum is main's job." },
        { kind: "source", mustMatch: "while\\s*\\(\\s*1\\s*\\)\\s*\\{[\\s\\S]*buf_get\\s*\\(\\s*&[\\s\\S]*__interrupt void cpu_timer0_isr\\(void\\)\\s*\\{", label: "main takes the samples out with buf_get", hint: "In while(1): `if (buf_get(&v)) { ... }`. `&v` gives buf_get the address of main's variable v to fill." },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed from the interrupt function" },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 10, label: "The interrupt function takes less than 10 microseconds" },
        { kind: "var", name: "logged", at: 30.5, min: 24, max: 30, label: "After 30 ms, 24 to 30 samples are logged: main follows the sensor through the buffer" },
        { kind: "var", name: "logged", at: 60.5, min: 54, max: 60, label: "After 60 ms, 54 to 60 samples are logged", hint: "Samples must be logged as they arrive, one per millisecond, not computed in one go." },
        { kind: "source", mustMatch: "return \\(produced \\* 37\\) % 1000;[\\s\\S]*cpu_timer0_isr\\(void\\)\\s*\\{[\\s\\S]*read_sensor\\s*\\(", label: "The sensor is unchanged and is read in the interrupt function" },
        { kind: "source", mustNotMatch: "37[\\s\\S]*37", label: "Readings come from read_sensor() only: its formula is not repeated elsewhere" },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 0.75, label: "Lean interrupt: it never runs longer than 0.75 microseconds (about 15 statements)", hint: "Read, put, count a drop: nothing else belongs in the interrupt function. No sum, no loop, no DINT or EINT." },
      ],
      watch: ["produced", "logged", "dropped", "sum"],
      hints: [
        "Copy `buf`, `head`, `tail`, `count`, `buf_put` and `buf_get` from \"Producer and consumer\". Then the interrupt is a put, and main is a get followed by the sum. If the compiler says a name is not declared, the four variables are missing.",
        "If you no longer have the buffer. Put: `if (count == BUF_SIZE) return 0; buf[head] = v; head = (head + 1) % BUF_SIZE; count++; return 1;` Get: `DINT; if (count == 0) { EINT; return 0; } *v = buf[tail]; tail = (tail + 1) % BUF_SIZE; count--; EINT; return 1;`",
        "Interrupt: `if (produced < N_SAMPLES) { produced++; if (buf_put(read_sensor()) == 0) dropped++; }` main: `if (buf_get(&v)) { sum += v; logged++; if ((logged % 10) == 0) { serial_printf(...); slow_work(30000); } }`",
      ],
      takeaway: "Sample in the interrupt at a steady rate, do the slow work in main, and put a buffer with a short critical section between them. Most embedded data paths look like this.",
    },
    {
      id: "thr-lost-update",
      kind: "order",
      tier: "practice",
      title: "Practice: the lost update, step by step",
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
      id: "thr-interleave",
      kind: "calc",
      tier: "practice",
      title: "Counting interleavings",
      goal: "Work out the result of unprotected increments for given schedules, and count how many schedules there are.",
      refs: [{ course: "L13" }],
      brief: `
Two threads, A and B, run \`counter += 1;\` with **no** protection. Each increment is three machine steps: read, add, write. The add happens in the thread's own CPU register, so only the order of the reads and writes of \`counter\` matters.

An increment is lost whenever a thread writes a value that it worked out from a read made **before** the other thread's write.

For each case, write down three numbers after every step: \`counter\`, A's register, B's register.

## Counting the orders
The last two fields ask in how many different orders the scheduler can run the steps. An order is called an **interleaving**. Each thread keeps its own order (read, add, write). The scheduler only chooses whose turn it is.

Worked example with **two** steps per thread (A1 A2 and B1 B2): the possible orders are

- A1 A2 B1 B2
- A1 B1 A2 B2
- A1 B1 B2 A2
- B1 A1 A2 B2
- B1 A1 B2 A2
- B1 B2 A1 A2

Six orders. There is a shortcut. The four steps fill four positions in a row, and an order is fixed once you say which two positions are A's. The first can be chosen in 4 ways, the second in 3, and each pair was counted twice (once in each order): 4 x 3 / 2 = **6**.

With three steps per thread there are six positions and three of them are A's: 6 x 5 x 4 ways to pick them one after the other, and each set of three was counted 3 x 2 x 1 = 6 times.
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
          why: "(6 x 5 x 4) / (3 x 2 x 1) = 120 / 6 = 20. Mathematicians call this number \"6 choose 3\".",
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
        "For the number of orders: (6 x 5 x 4) / (3 x 2 x 1).",
      ],
      takeaway: "Only 2 of the 20 orders are correct, yet in practice the program is right nearly every time, because the three steps are so short. That is what makes races hard to find by testing.",
    },
    {
      id: "thr-torn",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The clock that ran backwards",
      goal: "main reads a 64-bit time stamp in two halves and sometimes gets nonsense. Make the read consistent.",
      refs: [{ course: "L13" }, { trm: "3.4.3" }],
      brief: `
The F28379D reads or writes a 16-bit or a 32-bit variable (\`int\`, \`long\`, \`float\`) with one machine instruction, and an interrupt cannot split one instruction. An operation that cannot be split is called **atomic**. Reading one such variable is atomic.

Anything larger is read in pieces: a 64-bit number, a struct, or two variables that belong together, like \`pos_x\` and \`pos_y\` in "Two values that belong together". If an interrupt changes the value between the pieces, main gets one old piece and one new piece: a **torn read**.

Here the interrupt keeps a 64-bit time stamp. The simulator has no 64-bit type, so the program keeps the two 32-bit halves in two variables, which is also how the chip stores it. Main reads them one after the other:

\`\`\`c
lo = time_lo;       // first instruction
hi = time_hi;       // second instruction
\`\`\`

The interrupt adds 0x20000000 to the time every 20 microseconds. Eight of those make 0x100000000, one more than 32 bits can hold. So every 8th time the low half wraps to 0, and the interrupt adds 1 to the high half: a **carry**, as when 99 + 1 turns two digits to 0 and carries 1 to the left. If that happens between main's two reads, main combines the old low half (0xE0000000) with the new high half, and sees a time that is far too large. On the next pass the time seems to jump **backwards**. The loop counts those jumps in \`torn\`.

Run it: \`torn\` is not 0. Nothing is wrong with the time stamp itself. Only the read is broken.

Fix the read so that \`lo\` and \`hi\` always belong to the same value. Keep the rest of the loop and the interrupt function as they are. A critical section passes. The star is for a read that never disables interrupts.
`,
      kit: "robot",
      durationMs: 60,
      starter: tornProgram(`        lo = time_lo;
        hi = time_hi;`),
      solution: tornProgram(`        do {
            hi = time_hi;
            lo = time_lo;
        } while (hi != time_hi);    // a carry came in between: read again`),
      checks: [
        { kind: "var", name: "torn", equals: 0, label: "The time never jumps backwards (no torn read)", hint: "The interrupt must not run between the two reads. Either put DINT; before them and EINT; after them, or read again when the high half changed meanwhile." },
        { kind: "var", name: "reads", min: 2000, label: "main keeps reading the time" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 300, label: "The tick interrupt keeps running", hint: "Interrupts must be enabled again right after the two reads." },
        { kind: "var", name: "time_hi", min: 16, label: "The clock keeps counting" },
        {
          kind: "source",
          mustMatch: "lo\\s*<\\s*last_lo\\s*\\)\\s*\\)\\s*\\{\\s*torn\\+\\+;[\\s\\S]*time_lo\\s*\\+=\\s*0x20000000;",
          label: "The backwards-jump counter and the interrupt function are unchanged",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "DINT[\\s\\S]*DINT[\\s\\S]*DINT",
          label: "No added interrupt delay: the read is made consistent without DINT",
          hint: "Read the high half, the low half, and the high half again. If the two high halves differ, an interrupt carried in between: read again.",
        },
      ],
      watch: ["time_lo", "time_hi", "torn", "reads"],
      hints: [
        "The two reads together are the critical section.",
        "`DINT;` before `lo = time_lo;` and `EINT;` after `hi = time_hi;` passes the tests.",
        "For the star, without disabling interrupts: `do { hi = time_hi; lo = time_lo; } while (hi != time_hi);`. If the high half is the same before and after, no carry happened in between.",
      ],
      takeaway: "One 16-bit or 32-bit variable is read in one instruction. Anything read in several pieces (64-bit values, structs, variables that belong together) must be copied inside a short critical section, or read again until two readings agree.",
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
2. **One writer per index.** Only the producer writes \`head\`. Only the consumer writes \`tail\`. Each side may read the other's index: loading or storing one 16-bit index is a single machine instruction, so the reader sees the old value or the new one, never a mixture.
3. **Data first, index last.** The producer stores the sample and only then advances \`head\`. The consumer copies the sample out and only then advances \`tail\`. The index update is the moment the slot changes hands.

## Full and empty without a counter
With only two indexes, \`head == tail\` could mean empty or full. The usual answer is to keep **one slot always free**:

- empty: \`head == tail\`
- full: the slot after \`head\` is \`tail\`

So a buffer of \`BUF_SIZE\` 8 holds at most 7 samples.

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
        ...ringChecks(45, true),
        { kind: "source", mustNotMatch: "DINT[\\s\\S]*DINT|EINT[\\s\\S]*EINT", label: "No critical section: DINT and EINT appear only in the start-up code" },
        { kind: "source", mustNotMatch: "\\bcount\\b", label: "No shared counter named count" },
      ],
      watch: ["head", "tail", "produced", "received", "dropped", "missing"],
      hints: [
        "Compute the index after head once: `next = (head + 1) % BUF_SIZE;`. The buffer is full when `next == tail`.",
        "In buf_put write `buf[head] = v;` before `head = next;`. If you advanced head first, main could read a slot that holds no sample yet.",
        "buf_get: `if (tail == head) return 0; *v = buf[tail]; tail = (tail + 1) % BUF_SIZE; return 1;`",
      ],
      takeaway: "One writer per variable, indexes that load and store in one instruction, data before index: with those rules a single-producer, single-consumer queue needs no lock. Add a second producer and the argument falls apart.",
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
A **priority** is a rank the programmer gives a thread. Take three threads with priorities **high**, **medium** and **low**. This scheduler always runs the highest-priority thread that is ready. If a higher one becomes ready, it takes the processor away from the one that is running: it **preempts** it.

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
