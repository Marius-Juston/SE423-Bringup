import type { Chapter } from "../types";
import type { Stimulus } from "../../sim/runner";
import { tbSampleAt } from "../../sim/plugins/signalgen";

// ---- test bench signals and reference results (computed, not typed in) ----

interface Sig {
  f1?: number;
  a1?: number;
  f2?: number;
  a2?: number;
  noise?: number;
  dc?: number;
  fs?: number;
}

const NAMES: Record<keyof Sig, string> = { f1: "TB_F1_HZ", a1: "TB_A1", f2: "TB_F2_HZ", a2: "TB_A2", noise: "TB_NOISE", dc: "TB_DC", fs: "TB_FS_HZ" };

/** Stimuli that describe a signal to the test bench at time 0. */
const signal = (s: Sig): Stimulus[] =>
  (Object.keys(s) as (keyof Sig)[]).map((k) => ({ at: 0, set: NAMES[k], value: s[k]! }));

/** Sample n of a signal; 0 before the first sample (an empty history). */
const x = (s: Sig, n: number) => (n < 0 ? 0 : tbSampleAt(s, n));
/** y[n] = sum b[k] x[n-k] */
const fir = (b: number[], s: Sig, n: number) => b.reduce((acc, bk, k) => acc + bk * x(s, n - k), 0);
const mean = (s: Sig, from: number, count: number) => Array.from({ length: count }, (_, i) => x(s, from + i)).reduce((a, v) => a + v, 0) / count;
const near = (v: number, tol: number) => ({ min: v - tol, max: v + tol });

// Level signals
const SIG_AVG: Sig = { fs: 10000, f1: 2000, a1: 0.5, dc: 2.0 };
const SIG_FIR: Sig = { fs: 10000, f1: 300, a1: 1.0, f2: 4000, a2: 0.5, dc: 0.5 };
const SIG_BUGS: Sig = { fs: 10000, f1: 2000, a1: 0.8, dc: 1.2 };
const SIG_SLOW: Sig = { fs: 10000, f1: 50, a1: 1.0 };
const SIG_SHORT: Sig = { fs: 10000, f1: 500, a1: 1.0, dc: 1.0 };
const SIG_HUM: Sig = { fs: 10000, f1: 50, a1: 0.5, dc: 1.25, noise: 0.05 };
const SIG_SPIKE: Sig = { fs: 10000, f1: 100, a1: 0.5, dc: 1.0 };

/** A low-pass filter of order 4. */
const B4 = [0.0284, 0.237, 0.4692, 0.237, 0.0284];

/** Low-pass of order M with cutoff `wn` x Nyquist: windowed sinc (Hamming), gain 1 at DC. */
function lowpass(order: number, wn: number): number[] {
  const h: number[] = [];
  for (let n = 0; n <= order; n++) {
    const m = n - order / 2;
    const sinc = m === 0 ? wn : Math.sin(Math.PI * wn * m) / (Math.PI * m);
    h.push(sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / order)));
  }
  const sum = h.reduce((a, v) => a + v, 0);
  return h.map((v) => +(v / sum).toFixed(6));
}
const B21 = lowpass(21, 0.2);
const B21_C = [0, 6, 12, 18].map((i) => "    " + B21.slice(i, i + 6).map((v) => v.toFixed(6)).join(", ")).join(",\n");

/** Median filter reference for the spike level: a glitch of +8 on every sample with n % 17 == 5. */
const spiky = (n: number) => (n < 0 ? 0 : x(SIG_SPIKE, n) + (n % 17 === 5 ? 8 : 0));
const median5 = (n: number) => [0, 1, 2, 3, 4].map((k) => spiky(n - k)).sort((a, b) => a - b)[2];

// ---- shared C fragments ----

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const INIT = `    InitSysCtrl();
    InitGpio();`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

const LED1 = `    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`;

/** Timer 0 interrupt every 0.1 ms: the sampling clock of this chapter. */
const TIMER0 = `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100);   // every 100 us = 0.1 ms
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;`;

const MAIN_TIMER_ONLY = `void main(void)
{
${INIT}

${PIE_INIT}

${TIMER0}

    while (1) {}
}`;

// ---- level sources ----

const avg5 = (body: string) => `${FREQ}

__interrupt void cpu_timer0_isr(void);

float xk[5] = {0, 0, 0, 0, 0};   // xk[0] is the newest sample, xk[4] the oldest
float yk = 0;                    // the filtered value
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

__interrupt void cpu_timer0_isr(void)
{
    int i;
    float sum = 0;

${body}

    tb_output(yk);
    numSamples++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const firWrite = (fn: string) => `${FREQ}

#define NUM_B 5                  // order 4: 5 coefficients

__interrupt void cpu_timer0_isr(void);
float fir_step(float x);

float b[NUM_B] = {${B4.join(", ")}};
float xk[NUM_B] = {0, 0, 0, 0, 0};   // xk[0] is the newest sample
float yk = 0;
float y3 = 0;
float y40 = 0;
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

// One step of the filter: takes the newest sample, returns the filtered value.
float fir_step(float x)
{
${fn}
}

__interrupt void cpu_timer0_isr(void)
{
    yk = fir_step(tb_sample());
    tb_output(yk);

    numSamples++;
    if (numSamples == 3) { y3 = yk; }       // kept for the tests
    if (numSamples == 40) { y40 = yk; }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const avgBugs = (shift: string, average: string) => `${FREQ}

__interrupt void cpu_timer0_isr(void);

float xk[5] = {0, 0, 0, 0, 0};   // xk[0] is the newest sample, xk[4] the oldest
float yk = 0;
float oldest = 0;
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

__interrupt void cpu_timer0_isr(void)
{
    int i;
    float sum = 0;

    // Make room for the new sample
${shift}
    xk[0] = tb_sample();

    for (i = 0; i < 5; i++) {
        sum = sum + xk[i];
    }
${average}

    tb_output(yk);
    numSamples++;
    if (numSamples == 22) { oldest = xk[4]; }   // kept for the tests
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const race = (pick: string) => `${FREQ}

#define N 50

__interrupt void cpu_timer0_isr(void);

float ping[N];
float pong[N];
uint16_t fillPing = 1;       // 1: the interrupt function is filling ping, 0: pong
uint16_t count = 0;          // samples in the buffer being filled
uint16_t bufferFull = 0;     // flag for main

float mean = 0;
float mean1 = 0;
float mean3 = 0;
uint16_t numMeans = 0;

void main(void)
{
    int i;
    float sum;

${INIT}

${PIE_INIT}

${TIMER0}

    while (1) {
        if (bufferFull == 1) {
            bufferFull = 0;
            sum = 0;
${pick}
            mean = sum / N;

            numMeans++;
            if (numMeans == 1) { mean1 = mean; }   // kept for the tests
            if (numMeans == 3) { mean3 = mean; }
        }
    }
}

__interrupt void cpu_timer0_isr(void)
{
    float x = tb_sample();

    if (fillPing == 1) {
        ping[count] = x;
    } else {
        pong[count] = x;
    }
    count++;

    if (count == N) {
        // This buffer is full: continue in the other one and tell main
        count = 0;
        fillPing = 1 - fillPing;
        bufferFull = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const dma = (size: string, step: string, toPong: string, toPing: string) => `${FREQ}

#define N 50                 // samples per buffer (the course uses 1024)

__interrupt void DMA_ISR(void);
void InitDma(void);

uint16_t adcResult = 0;      // test bench: stands in for AdcbResultRegs.ADCRESULT0
uint16_t ping[N];
uint16_t pong[N];
uint16_t iPingPong = 0;      // 0: the next DMA interrupt means "ping has just been started"
uint16_t pingReady = 0;
uint16_t pongReady = 0;
int16_t DMAcount = 0;

float pingMean = 0;
float pongMean = 0;

void main(void)
{
    int i;
    float sum;

${INIT}

${PIE_INIT}

    EALLOW;
    PieVectTable.DMA_CH1_INT = &DMA_ISR;
    EDIS;

    InitDma();

    // The sampling clock. On the robot this is EPWM7 starting ADCB every 0.1 ms.
    // Here CPU timer 0 is the DMA trigger, and the test bench refreshes adcResult.
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100);
    tb_stream(&adcResult);
    CpuTimer0Regs.TCR.all = 0x4000;

    EINT;
    ERTM;

    while (1) {
        if (pingReady == 1) {
            pingReady = 0;
            sum = 0;
            for (i = 0; i < N; i++) {
                sum = sum + ping[i];
            }
            pingMean = sum / N;
        }
        if (pongReady == 1) {
            pongReady = 0;
            sum = 0;
            for (i = 0; i < N; i++) {
                sum = sum + pong[i];
            }
            pongMean = sum / N;
        }
    }
}

void InitDma(void)
{
    EALLOW;

    DmaRegs.DMACTRL.bit.HARDRESET = 1;          // Reset entire DMA module
    asm(" NOP");                                // 1 cycle delay for HARDRESET to take effect

    DmaRegs.CH1.MODE.all = 0x8901;
    // bit 15        1:      CHINTE, 1=interrupt enabled
    // bit 14        0:      DATASIZE, 0=16-bit, 1=32-bit
    // bit 11        1:      CONTINUOUS, 1=re-init after transfer complete
    // bit 10        0:      ONESHOT, 0=one burst on trigger
    // bit 9         0:      CHINTMODE, 0=interrupt at start of transfer
    // bit 8         1:      PERINTE, peripheral interrupt trigger enable
    // bit 4-0       00001:  Set to channel number

    // Trigger source: 68 = TINT0 here. The course writes 6 = ADCBINT1.
    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH1 = 68;

    DmaRegs.CH1.BURST_SIZE.bit.BURSTSIZE = 0;           // 0 means 1 word per burst
${size}

    DmaRegs.CH1.SRC_TRANSFER_STEP = 0;                  // always read the same register
    DmaRegs.CH1.SRC_ADDR_SHADOW = (Uint32)&adcResult;   // SRC start address

${step}
    DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;         // DST start address: ping first

    DmaRegs.CH1.CONTROL.all = 0x0091;
    // bit 7         1:      ERRCLR, clear the overflow flag
    // bit 4         1:      PERINTCLR, clear a pending trigger
    // bit 0         1:      RUN, enable the channel

    EDIS;

    PieCtrlRegs.PIEIER7.bit.INTx1 = 1;  // Enable DMA channel 1 in PIE group 7
    IER |= M_INT7;
}

__interrupt void DMA_ISR(void)          // INT7.1, at the start of every transfer
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP7;

    if (iPingPong == 0) {
        // The DMA has just started to fill ping. The transfer after this one goes to pong.
${toPong}
        if (DMAcount > 0) {
            pongReady = 1;              // pong was completed one sample ago (not the first time)
        }
        iPingPong = 1;
    } else {
        // The DMA has just started to fill pong. The transfer after this one goes to ping.
${toPing}
        pingReady = 1;                  // ping was completed one sample ago
        iPingPong = 0;
    }
    DMAcount += 1;
}
`;

const checkpoint = (setup: string, loop: string, isr: string) => `${FREQ}

#define NUM_B 22             // order 21
#define WINDOW 100           // samples per amplitude measurement (10 ms)

__interrupt void cpu_timer0_isr(void);

float b[NUM_B] = {
${B21_C}};
float xk[NUM_B];             // xk[0] is the newest sample
float yk = 0;
float peak = 0;              // largest |yk| in the window so far
float amplitude = 0;         // result of the last complete window
uint16_t count = 0;
uint16_t newResult = 0;      // flag for main

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

${setup}

    while (1) {
${loop}
    }
}

__interrupt void cpu_timer0_isr(void)
{
${isr}
}
`;

const shortArray = (len: string) => `${FREQ}

#define NUM_B 5              // order 4: 5 coefficients

__interrupt void cpu_timer0_isr(void);

float xk[${len}] = {0, 0, 0, 0};       // history: xk[0] is the newest sample
float b[NUM_B] = {${B4.join(", ")}};
float yk = 0;
float y40 = 0;
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

__interrupt void cpu_timer0_isr(void)
{
    int i;

    for (i = NUM_B - 1; i > 0; i--) {
        xk[i] = xk[i-1];
    }
    xk[0] = tb_sample();

    yk = 0;
    for (i = 0; i < NUM_B; i++) {
        yk = yk + b[i] * xk[i];
    }

    tb_output(yk);
    numSamples++;
    if (numSamples == 40) { y40 = yk; }   // kept for the tests
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const hum = (globals: string, body: string) => `${FREQ}

#define N 200                // 200 samples = 20 ms = one period of the 50 Hz hum

__interrupt void cpu_timer0_isr(void);

${globals}
float yk = 0;
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

__interrupt void cpu_timer0_isr(void)
{
${body}

    tb_output(yk);
    numSamples++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const goertzel = (globals: string, loop: string, isr: string) => `${FREQ}

#define N 100                // samples per block: 10 ms

__interrupt void cpu_timer0_isr(void);

float tone1k = 0;            // amplitude of the 1 kHz part, from the last complete block
uint16_t newResult = 0;
${globals}

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

${TIMER0}

    while (1) {
${loop}
    }
}

__interrupt void cpu_timer0_isr(void)
{
    float x = tb_sample();

${isr}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const spike = (fn: string) => `${FREQ}

__interrupt void cpu_timer0_isr(void);
float despike(float x);

float xk[5] = {0, 0, 0, 0, 0};   // the last 5 samples, xk[0] is the newest
float yk = 0;
float maxOut = 0;
float y60 = 0;
uint32_t numSamples = 0;

${MAIN_TIMER_ONLY}

// Takes the newest sample, returns the median of the last 5.
float despike(float x)
{
${fn}
}

__interrupt void cpu_timer0_isr(void)
{
    float x = tb_sample();

    if (numSamples % 17 == 5) {
        x = x + 8.0;                    // a glitch on the sensor wire
    }

    yk = despike(x);
    tb_output(yk);

    if (yk > maxOut) { maxOut = yk; }   // kept for the tests
    numSamples++;
    if (numSamples == 60) { y60 = yk; }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

/** Mean of a buffer of the 50 Hz sine as 12-bit ADC counts of 1.5 V + x (3.0 V full scale). */
const counts = (from: number) => ((1.5 + mean(SIG_SLOW, from, 50)) * 4096) / 3;
// The first two buffers cover the rising and falling quarter of the positive half wave, the next two the negative one.
const SLOW_HI = (counts(0) + counts(50)) / 2;
const SLOW_LO = (counts(100) + counts(150)) / 2;

export const ch15: Chapter = {
  id: "dma-filters",
  number: 15,
  title: "DMA and filters",
  blurb: "Ping-pong buffers, Nyquist and FIR.",
  requires: ["adc"],
  course: ["L8-9", "Lab 4", "HW3"],
  levels: [
    {
      id: "dmaf-brief",
      kind: "brief",
      title: "Samples by the thousand",
      goal: "Learn how 1024 samples reach a buffer without the CPU touching one of them, and what a filter does with them.",
      refs: [{ course: "L8-9" }, { trm: "5.1" }, { trm: "5.2" }, { trm: "5.4" }],
      brief: `
A microphone signal has to be sampled about 10 000 times a second. You know one way: an interrupt function runs for every sample and stores it. At 10 kHz that is 10 000 interrupts a second, each with its entry, its exit and its acknowledge, just to copy one number. The CPU has better things to do.

## The DMA
**DMA** means direct memory access. The DMA is a peripheral that copies data from one address to another when a trigger arrives, with no CPU instruction involved.

- It has **6 channels**. Each has its own source, destination, trigger and interrupt.
- It moves **16-bit or 32-bit** words.
- It does nothing by itself: every copy needs a **trigger** from a peripheral (or from software).

## The sampling chain
Lecture 8 builds this chain:

1. An **ePWM** module is used as a precise timer. Every 0.1 ms it sends a start-of-conversion pulse.
2. The **ADC** converts the pin voltage and stores the result in \`ADCRESULT0\`. It then raises its interrupt signal.
3. That signal is the **DMA** channel's trigger. The DMA copies \`ADCRESULT0\` into the next free place of a buffer.

After 1024 samples the buffer is full. Only then is the CPU interrupted: once every 1024 x 0.1 ms = **102.4 ms** instead of 10 000 times a second.

## Ping and pong
The samples keep coming while the CPU works on a full buffer. So there are two buffers, called **ping** and **pong**. The DMA fills one while main processes the other, and then they swap. main must only ever read the buffer the DMA is **not** writing.

## What main does with a buffer
- A **Fourier transform** (the course uses TI's FFT library on 1024 points) shows which frequencies are in the signal.
- A **filter** changes the signal sample by sample. The simplest one is the moving average: the output is the mean of the last 5 samples.

\`\`\`c
y[n] = (x[n] + x[n-1] + x[n-2] + x[n-3] + x[n-4]) / 5
\`\`\`
Give every sample its own weight and you have the general **FIR** filter (finite impulse response): \`y[n] = b0 x[n] + b1 x[n-1] + ... + bM x[n-M]\`. The weights \`b\` are the **coefficients**, and M is the **order**. An order M filter has M + 1 coefficients and needs the last M samples stored.

## One rule about sampling
A sampled signal can only show frequencies up to **half the sampling rate**. That limit is the **Nyquist frequency**. A tone above it does not vanish: it shows up as a lower frequency that was never there. This is **aliasing**, and no filter in your code can remove it afterwards.
`,
      questions: [
        {
          prompt: "The ADC is sampled every 0.1 ms and the DMA fills buffers of 1024 samples. How often is the CPU interrupted by the DMA?",
          options: ["Every 0.1 ms", "Every 1 ms", "Every 102.4 ms", "Never"],
          answer: 2,
          why: "The DMA copies each sample without the CPU and interrupts once per buffer: 1024 x 0.1 ms = 102.4 ms.",
        },
        {
          prompt: "What makes a DMA channel copy a word?",
          options: ["A trigger from a peripheral, for example the ADC's interrupt signal", "A line of C in `while(1)`", "A clock inside the DMA", "Reading the destination buffer"],
          answer: 0,
          why: "The DMA is event based. It has no timer of its own: here the ePWM sets the pace, the ADC converts, and the ADC's signal triggers the copy.",
        },
        {
          prompt: "A filter of order 21 is written as `y[n] = b0 x[n] + ... + b21 x[n-21]`. How many coefficients does it have?",
          options: ["20", "21", "22", "42"],
          answer: 2,
          why: "The coefficients are b0 to b21, which is 22 numbers. An order M filter has M + 1 coefficients. MATLAB's `fir1(21, 0.2)` returns 22 values.",
        },
      ],
      takeaway: "ePWM sets the time, the ADC converts, the DMA copies. The CPU only sees full buffers, and it works on one buffer while the other fills.",
    },
    {
      id: "dmaf-chain",
      kind: "order",
      title: "From the timer to your buffer",
      goal: "Put the steps of the sampling chain in order, from the ePWM pulse to main processing a full buffer.",
      refs: [{ course: "L8-9" }, { trm: "5.3.3" }, { trm: "5.4" }, { trm: "11.9" }],
      brief: `
The course's FFT starter project samples a microphone on ADCB with this setup:

- **EPWM7** sends a start-of-conversion pulse (SOCA) every 0.1 ms.
- **ADCB** converts on that pulse. When the result is in \`AdcbResultRegs.ADCRESULT0\` it raises **ADCBINT1**.
- **DMA channel 1** uses ADCBINT1 as its trigger. One trigger copies one word.
- A **transfer** is 1024 copies. The DMA keeps its place in the buffer in an *active* address register. Your code can only write the *shadow* address register. The DMA copies shadow to active **at the start of each transfer**, and only then.
- The channel is set to interrupt the CPU **at the start of each transfer** (interrupt INT7.1, function \`DMA_ISR\`).

Order the steps for one buffer. Follow the data: timer, converter, copy. The CPU appears only at the very end.
`,
      steps: [
        "EPWM7's counter reaches its period and sends a start-of-conversion pulse",
        "ADCB samples the pin and converts the voltage to a 12-bit number",
        "The result is stored in ADCRESULT0 and ADCB raises ADCBINT1",
        "DMA channel 1 is triggered and copies ADCRESULT0 to the next free place in the buffer",
        "The 1024th copy completes the transfer",
        "On the next trigger a new transfer starts: the DMA loads its active destination address from the shadow register",
        "The DMA raises INT7.1 and the CPU runs DMA_ISR, which writes the other buffer's address to the shadow register and sets a flag",
        "main sees the flag and processes the buffer that was just completed",
      ],
      hints: [
        "Three peripherals pass the work along before the CPU does anything: ePWM, then ADC, then DMA.",
        "The first four steps happen for every sample. The last four happen once per buffer.",
        "Pulse, conversion, ADCBINT1, copy, 1024th copy, shadow loaded into active, DMA_ISR, main.",
      ],
      takeaway: "For 1023 samples out of 1024 the CPU is not involved at all. The shadow address your interrupt function writes is used from the next transfer on, never in the middle of one.",
    },
    {
      id: "dmaf-pingpong",
      kind: "quiz",
      title: "Whose turn is it",
      goal: "Decide which buffer main may read, and when a new address takes effect.",
      refs: [{ course: "L8-9" }, { trm: "5.4" }],
      brief: `
Two buffers of 1024 samples, \`ping\` and \`pong\`. The DMA fills one. main reads the other.

The DMA interrupt of the course setup comes **at the start of a transfer**: the DMA has just loaded its destination address and stored the first sample. At that moment:

- the buffer that is now being filled must be left alone for the next 102.4 ms,
- the **other** buffer was completed one sample ago. It is the one main may process,
- the interrupt function writes the address for the transfer **after** this one into \`DmaRegs.CH1.DST_ADDR_SHADOW\`. The DMA reads the shadow register only when a transfer starts.

\`\`\`c
if (iPingPong == 0) {
    // ping has just been started: next transfer goes to pong
    EALLOW;
    DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
    EDIS;
    iPingPong = 1;
} else {
    // pong has just been started: next transfer goes to ping
    ...
\`\`\`

The Technical Reference Manual recommends exactly this interrupt timing for ping-pong buffers in continuous mode.
`,
      questions: [
        {
          prompt: "The DMA interrupt has just told you that the DMA started filling `ping`. Which buffer may main read now?",
          options: ["`ping`", "`pong`", "Both", "Neither, until the next interrupt"],
          answer: 1,
          why: "`pong` was completed one sample ago and will not be written again until the next transfer starts, 102.4 ms from now. `ping` is changing under your feet.",
        },
        {
          prompt: "In that same interrupt, the function writes `DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;`. Where does the very next sample go?",
          options: ["To `pong[0]`", "To `pong[1]`", "To `ping[1]`", "Nowhere, the write stops the DMA"],
          answer: 2,
          why: "The running transfer uses the active address, which already points into `ping`. The shadow register is only read when the next transfer starts.",
        },
        {
          prompt: "Why are two buffers needed? Why not one buffer and a fast main?",
          options: [
            "The DMA cannot write to the same address twice",
            "Two buffers halve the sampling rate",
            "The samples keep arriving while main works, so a single buffer would be overwritten while it is being read",
            "The FFT needs 2048 samples",
          ],
          answer: 2,
          why: "Sampling never pauses. With one buffer, the first samples of the next block would replace data main has not used yet.",
        },
        {
          prompt: "A buffer fills in 102.4 ms. main needs 150 ms to process one. What happens?",
          options: [
            "Nothing, the DMA waits for main",
            "The DMA starts refilling the buffer main is still reading",
            "The ADC slows down",
            "The CPU is interrupted more often",
          ],
          answer: 1,
          why: "The DMA never waits. Processing one buffer has to take less time than filling one, or main ends up reading a buffer that is being overwritten.",
        },
      ],
      takeaway: "Read only the buffer the DMA is not writing, and finish before the DMA comes back to it.",
    },
    {
      id: "dmaf-numbers",
      kind: "calc",
      title: "Buffers, Nyquist and aliases",
      goal: "Work out the numbers behind a sampled signal and a simple filter.",
      refs: [{ course: "L8-9" }, { course: "HW3" }, { trm: "5.4" }],
      brief: `
**Buffer time.** A buffer of N samples taken every T seconds covers N x T seconds.

**Nyquist.** With a sampling rate fs, the highest frequency the samples can show is fs / 2. Turned around: sample at least twice as fast as the highest frequency in the signal.

**Aliasing.** A tone at f between fs / 2 and fs gives the same samples as a tone at **fs - f** would (for a sine, turned upside down). Example: fs = 1000 Hz and a 900 Hz tone. The samples look like a 100 Hz tone.

**Coefficients.** An FIR filter of order M has M + 1 coefficients.

**Gain at DC.** Feed a filter a constant input. The output settles at the input times the **sum of the coefficients**. That factor is the gain at 0 Hz, called DC.

**DMA sizes.** The DMA's size registers hold **one less** than the count: a value of 2 means 3.
`,
      fields: [
        { id: "a", label: "Time to fill a buffer of 1024 samples taken every 0.1 ms", unit: "ms", answer: 102.4, tolPct: 0.1, why: "1024 x 0.1 ms = 102.4 ms. That is also how often the DMA interrupts the CPU." },
        { id: "b", label: "Nyquist frequency when sampling every 0.1 ms", unit: "Hz", answer: 5000, why: "The sampling rate is 1 / 0.1 ms = 10 000 Hz. Half of it is 5000 Hz." },
        { id: "c", label: "A 7 kHz tone sampled at 10 kHz appears at", unit: "Hz", answer: 3000, why: "7 kHz is above the Nyquist frequency of 5 kHz. It aliases to fs - f = 10 000 - 7000 = 3000 Hz." },
        { id: "d", label: "Number of coefficients of an FIR filter of order 21", answer: 22, why: "Order M has M + 1 coefficients, b0 to bM. `fir1(21, 0.2)` returns 22 numbers." },
        { id: "e", label: "DC gain of the 5-point moving average (each coefficient is 1/5)", answer: 1, why: "5 x 1/5 = 1. A constant input comes out unchanged, which is what you want from an average." },
        { id: "f", label: "TRANSFER_SIZE for a transfer of 1024 one-word bursts", answer: 1023, why: "The register holds the count minus one. The course writes `DmaRegs.CH1.TRANSFER_SIZE = RFFT_SIZE-1;` with RFFT_SIZE = 1024." },
      ],
      hints: [
        "Convert 0.1 ms to a rate first: 1 / 0.0001 s = 10 000 samples per second.",
        "For the alias, subtract the tone's frequency from the sampling rate.",
        "102.4, 5000, 3000, 22, 1, 1023.",
      ],
      takeaway: "fs / 2 is the limit. Anything above it must be removed by an analog filter before the ADC, because after sampling it is indistinguishable from a real low tone.",
    },
    {
      id: "dmaf-avg5",
      kind: "code",
      mode: "complete",
      title: "Five-point moving average",
      goal: "Complete an interrupt function that outputs the mean of the last 5 samples.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
Timer 0 calls \`cpu_timer0_isr\` every 0.1 ms. Each call takes one sample and must compute

\`\`\`c
yk = (x[n] + x[n-1] + x[n-2] + x[n-3] + x[n-4]) / 5
\`\`\`

## Where the samples come from
\`tb_sample()\` returns the next sample of a test signal. It belongs to this game's **test bench**, not to the chip: everything starting with \`tb_\` stands in for hardware you are not practising right now. On the robot the line would read the ADC result instead. \`tb_output(yk)\` shows your result to the tests.

## The history array
A filter needs the last few samples, so they are kept in an array: \`xk[0]\` is the newest, \`xk[4]\` the oldest. For every new sample:

1. **Shift**: every stored sample moves one place towards the old end. \`xk[3]\` goes to \`xk[4]\`, \`xk[2]\` to \`xk[3]\`, and so on. The oldest value drops out.
2. **Store** the new sample in \`xk[0]\`.
3. **Sum** the five values and divide by 5.

Shift from the old end: copy into \`xk[4]\` first. In the other direction you would overwrite values before you have moved them.

## The test signal
A constant 2.0 with a 2 kHz tone of amplitude 0.5 on top. At 10 kHz sampling, one period of the tone is exactly 5 samples, and the mean over one full period of a sine is zero. So a correct average shows a steady **2.0**: the tone is gone.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: signal(SIG_AVG),
      starter: avg5(`    // TODO 1: shift the stored samples one place towards xk[4] (start at the old end)

    xk[0] = tb_sample();    // the newest sample (on the robot: the ADC result)

    // TODO 2: add up the 5 samples in sum, then store the mean in yk`),
      solution: avg5(`    // Shift the stored samples one place towards xk[4], oldest first
    for (i = 4; i > 0; i--) {
        xk[i] = xk[i-1];
    }

    xk[0] = tb_sample();    // the newest sample (on the robot: the ADC result)

    for (i = 0; i < 5; i++) {
        sum = sum + xk[i];
    }
    yk = sum / 5.0;`),
      checks: [
        { kind: "var", name: "numSamples", min: 100, label: "A sample is taken every 0.1 ms" },
        { kind: "signal", name: "TB_OUT", at: 3.05, ...near(2.0, 0.005), label: "The output is 2.0 after 3 ms", hint: "If it swings between 1.5 and 2.5 you are passing the samples through. If it is 0, yk is never set." },
        { kind: "signal", name: "TB_OUT", at: 6.33, ...near(2.0, 0.005), label: "The output is still 2.0 after 6 ms", hint: "The sum must contain 5 different samples. Check the direction of your shift loop." },
        { kind: "signal", name: "TB_OUT", at: 11.9, ...near(2.0, 0.005), label: "The output is still 2.0 at the end" },
      ],
      watch: ["yk", "numSamples"],
      hints: [
        "The shift is a loop that counts down: `for (i = 4; i > 0; i--)`.",
        "Inside it: `xk[i] = xk[i-1];`. Then a second loop from 0 to 4 adds `xk[i]` to `sum`.",
        "`for (i = 4; i > 0; i--) { xk[i] = xk[i-1]; }` before the new sample, then `for (i = 0; i < 5; i++) { sum = sum + xk[i]; }` and `yk = sum / 5.0;`",
      ],
      takeaway: "A moving average over exactly one period of a tone removes that tone completely. Averaging is a low-pass filter: slow changes pass, fast ones cancel.",
    },
    {
      id: "dmaf-fir",
      kind: "code",
      mode: "write",
      title: "Any coefficients you like",
      goal: "Write one step of a general FIR filter: y = b[0] x[n] + b[1] x[n-1] + ... with the coefficients from an array.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
The moving average weighs all samples equally. A designed filter gives each one its own weight:

\`\`\`c
y[n] = b[0] x[n] + b[1] x[n-1] + b[2] x[n-2] + b[3] x[n-3] + b[4] x[n-4]
\`\`\`

In MATLAB, \`fir1(order, cutoff)\` computes such weights. Lab 4 has you paste them into an array. Here the array \`b\` holds a low-pass filter of order 4, so \`NUM_B\` is 5.

Write the body of \`fir_step\`. It is called once per sample with the newest sample \`x\` and returns the filtered value. Use the array \`xk\` for the history, with \`xk[0]\` the newest sample, as in the previous level.

- Shift the history, oldest first.
- Store \`x\` in \`xk[0]\`.
- Add up \`b[i] * xk[i]\` for all \`NUM_B\` coefficients.

Write the loops with \`NUM_B\`, not with the number 5. Then a filter of order 21 is only a longer array.

The test signal is a 300 Hz tone, a 4 kHz tone and an offset. The tests compare your output at two moments with the exact values of the formula above.
`,
      kit: "robot",
      durationMs: 6,
      stimuli: signal(SIG_FIR),
      starter: firWrite(`    // TODO: shift xk, store x, return the weighted sum
    return 0;`),
      solution: firWrite(`    int i;
    float y = 0;

    for (i = NUM_B - 1; i > 0; i--) {
        xk[i] = xk[i-1];
    }
    xk[0] = x;

    for (i = 0; i < NUM_B; i++) {
        y = y + b[i] * xk[i];
    }
    return y;`),
      checks: [
        { kind: "var", name: "y3", ...near(fir(B4, SIG_FIR, 2), 0.0005), label: "The third output is right (the history still holds zeros)", hint: "For the third sample: y = b[0] x[2] + b[1] x[1] + b[2] x[0]. The newest sample belongs to b[0]." },
        { kind: "var", name: "y40", ...near(fir(B4, SIG_FIR, 39), 0.0005), label: "The 40th output is right", hint: "Each coefficient must meet its own sample: b[i] with xk[i]. Shift before you store the new sample." },
        { kind: "var", name: "numSamples", min: 50, label: "A sample is processed every 0.1 ms" },
      ],
      bonus: [{ kind: "source", mustMatch: "NUM_B\\s*-\\s*1|<\\s*NUM_B", label: "The loops use NUM_B, so the function works for any filter length" }],
      watch: ["yk", "numSamples"],
      hints: [
        "It is the moving average again, with `b[i] * xk[i]` in the sum and no division at the end.",
        "The shift loop runs from `NUM_B - 1` down to 1. The sum loop runs from 0 to `NUM_B - 1`.",
        "`for (i = NUM_B - 1; i > 0; i--) { xk[i] = xk[i-1]; }` then `xk[0] = x;` then `for (i = 0; i < NUM_B; i++) { y = y + b[i] * xk[i]; }` and `return y;`",
      ],
      takeaway: "Every FIR filter is this loop. Low-pass, high-pass or band-pass differ only in the numbers in b. Symmetric coefficients, like these, delay all frequencies by the same time: the filter has linear phase.",
    },
    {
      id: "dmaf-avg-bugs",
      kind: "code",
      mode: "debug",
      title: "An average that is not",
      goal: "This 5-point average has two bugs. Find and fix both.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
The signal is a constant 1.2 with a 2 kHz tone of amplitude 0.8 on top. A 5-point average at 10 kHz should remove the tone and output a steady **1.2**.

Run the program and look at \`yk\`. Then fix one bug, run again, and look again: the second bug only shows once the first is gone.

Two things to check, both classics:

- **What is in the history?** After a few samples \`xk[0]\` to \`xk[4]\` should hold five *different* samples, the newest first. Work through the shift loop by hand for one pass: which value ends up in \`xk[4]\`?
- **What does the division compute?** Look at the types of the numbers on both sides of the \`/\`.

The tests also read \`xk[4]\` after the 22nd sample to see whether it really is the sample from four steps earlier.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: signal(SIG_BUGS),
      starter: avgBugs(
        `    for (i = 0; i < 4; i++) {
        xk[i+1] = xk[i];
    }`,
        `    yk = (1/5) * sum;`,
      ),
      solution: avgBugs(
        `    for (i = 4; i > 0; i--) {
        xk[i] = xk[i-1];
    }`,
        `    yk = sum / 5.0;`,
      ),
      checks: [
        {
          kind: "var", name: "oldest", ...near(x(SIG_BUGS, 17), 0.001), label: "xk[4] holds the sample from four steps earlier",
          hint: "Going up from i = 0, xk[1] gets xk[0], then xk[2] gets the new xk[1], and so on: one value is smeared over the whole array. Shift from the old end instead.",
        },
        {
          kind: "signal", name: "TB_OUT", at: 6.33, ...near(1.2, 0.005), label: "The output is 1.2 after 6 ms",
          hint: "1/5 divides two integers, and the result is the integer 0. Write sum / 5.0, or 0.2 * sum.",
        },
        { kind: "signal", name: "TB_OUT", at: 11.9, ...near(1.2, 0.005), label: "The output is still 1.2 at the end" },
      ],
      watch: ["yk", "oldest", "numSamples"],
      hints: [
        "With yk stuck at exactly 0, start with the division. An integer divided by a larger integer is 0 in C.",
        "The shift loop copies xk[0] into xk[1], then that same value into xk[2], and on to xk[4]. It has to run the other way.",
        "`for (i = 4; i > 0; i--) { xk[i] = xk[i-1]; }` and `yk = sum / 5.0;`",
      ],
      takeaway: "Shift from the old end so nothing is overwritten before it has been moved, and make sure a float takes part in every division that should give a fraction.",
    },
    {
      id: "dmaf-race",
      kind: "code",
      mode: "debug",
      title: "Reading the wrong buffer",
      goal: "main computes the mean of a buffer the interrupt function is still writing. Make it read the finished one.",
      refs: [{ course: "L8-9" }, { trm: "5.4" }],
      brief: `
This program does ping-pong buffering by hand, without the DMA, so that you can see every step.

- The timer interrupt function takes a sample every 0.1 ms and stores it in \`ping\` or \`pong\`. \`fillPing\` says which one.
- After \`N\` = 50 samples the buffer is full. The function switches to the other buffer and sets the flag \`bufferFull\`.
- main waits for the flag and computes the **mean** of the buffer that has just been completed.

The signal is a slow 50 Hz sine. One buffer is 5 ms, a quarter of its period, so the buffer means should come out as about +0.63, +0.63, -0.63, -0.63, and so on.

They do not. Run it and compare \`mean1\` and \`mean3\` with what you expect.

Think about the moment main sees the flag. The interrupt function has **already switched** \`fillPing\`. So what does \`fillPing == 1\` mean at that moment: is \`ping\` the finished buffer, or the one being written?
`,
      kit: "robot",
      durationMs: 22,
      stimuli: signal(SIG_SLOW),
      starter: race(`            if (fillPing == 1) {
                for (i = 0; i < N; i++) {
                    sum = sum + ping[i];
                }
            } else {
                for (i = 0; i < N; i++) {
                    sum = sum + pong[i];
                }
            }`),
      solution: race(`            if (fillPing == 1) {
                // ping is being filled now, so pong is the finished one
                for (i = 0; i < N; i++) {
                    sum = sum + pong[i];
                }
            } else {
                for (i = 0; i < N; i++) {
                    sum = sum + ping[i];
                }
            }`),
      checks: [
        {
          kind: "var", name: "mean1", ...near(mean(SIG_SLOW, 0, 50), 0.005), label: "The first mean is that of samples 0 to 49 (about +0.63)",
          hint: "It is 0 because main summed pong, which is still empty: the interrupt function had just switched to it.",
        },
        {
          kind: "var", name: "mean3", ...near(mean(SIG_SLOW, 100, 50), 0.005), label: "The third mean is that of samples 100 to 149 (about -0.63)",
          hint: "A positive value here is the mean of an older buffer: main read the buffer that is about to be overwritten instead of the one just completed.",
        },
        { kind: "var", name: "numMeans", min: 4, max: 4, label: "Four buffers were processed in 22 ms" },
      ],
      watch: ["fillPing", "count", "mean", "numMeans"],
      hints: [
        "`fillPing` names the buffer the interrupt function writes to **now**. main wants the other one.",
        "Only main is wrong. The interrupt function is fine.",
        "Swap the two loops: when `fillPing == 1` sum `pong`, otherwise sum `ping`.",
      ],
      takeaway: "The bug gives numbers that look plausible, only old or half new. That is what makes races hard to spot. Decide in words which buffer is finished at the moment the flag is set, and write that in a comment.",
    },
    {
      id: "dmaf-dma",
      kind: "code",
      mode: "complete",
      title: "Let the DMA do the copying",
      goal: "Finish the course's DMA channel 1 setup and swap the two buffers in the DMA interrupt function.",
      refs: [{ course: "L8-9" }, { trm: "5.4" }, { trm: "5.3.3" }, { trm: "5.9.3" }, { trm: "3.4.5" }],
      brief: `
Now the copying is done by the DMA. The interrupt function no longer runs for every sample, only once per buffer.

## What stands in for the ADC
The robot's chain is EPWM7, ADCB, DMA. Here a test bench replaces the first two:

- \`tb_stream(&adcResult);\` makes the test bench put a fresh 12-bit reading into the variable \`adcResult\` every 0.1 ms. \`adcResult\` plays the part of \`AdcbResultRegs.ADCRESULT0\`.
- CPU timer 0 gives the trigger every 0.1 ms. In the DMA's source table it is number 68 (TINT0). The course selects 6 (ADCBINT1).

Everything else is the course's \`InitDma()\` from the FFT starter project.

## What to write
In \`InitDma()\`:

- \`DmaRegs.CH1.TRANSFER_SIZE\`: a transfer is N samples. Size registers hold **one less** than the count.
- \`DmaRegs.CH1.DST_TRANSFER_STEP\`: how far the destination address moves after each sample. The source step is 0 because the source is always the same register. The destination must walk through the buffer.

In \`DMA_ISR()\`: the two lines that write the address of the **other** buffer to \`DmaRegs.CH1.DST_ADDR_SHADOW\`. DMA registers are protected, so each write goes between \`EALLOW;\` and \`EDIS;\`. The address of an array is its name, cast to the register's type:

\`\`\`c
EALLOW;
DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
EDIS;
\`\`\`

## When the interrupt comes
\`MODE.all = 0x8901\` has CHINTMODE = 0: the interrupt comes at the **start** of each transfer. Read the comments in \`DMA_ISR\`: when the DMA has just started on \`ping\`, the buffer that is complete is \`pong\`, and the address you write is used for the transfer after this one.

The course's starter file raises the flag of the buffer that has just been *started*. With this interrupt timing, main then reads old data with a few new samples at the front. This level follows the reference manual: the flag names the buffer that is complete.

The signal is the slow 50 Hz sine again. main computes the mean of each finished buffer in ADC counts: about 2900 for the first two buffers (the positive half of the sine), about 1200 for the next two.
`,
      kit: "robot",
      durationMs: 22,
      stimuli: signal(SIG_SLOW),
      starter: dma(
        `    // TODO 1: DmaRegs.CH1.TRANSFER_SIZE for N one-word bursts per transfer`,
        `    // TODO 2: DmaRegs.CH1.DST_TRANSFER_STEP so that the destination moves on by one word`,
        `        // TODO 3: write the address of pong to DmaRegs.CH1.DST_ADDR_SHADOW (EALLOW / EDIS)`,
        `        // TODO 4: write the address of ping to DmaRegs.CH1.DST_ADDR_SHADOW (EALLOW / EDIS)`,
      ),
      solution: dma(
        `    DmaRegs.CH1.TRANSFER_SIZE = N-1;                    // N bursts per transfer`,
        `    DmaRegs.CH1.DST_TRANSFER_STEP = 1;                  // add 1 to the pointer after each burst`,
        `        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
        EDIS;`,
        `        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;
        EDIS;`,
      ),
      checks: [
        { kind: "reg", reg: "DmaRegs.CH1.TRANSFER_SIZE", equals: 49, label: "A transfer is 50 samples (TRANSFER_SIZE = 49)", hint: "The register holds the count minus one: N-1." },
        { kind: "reg", reg: "DmaRegs.CH1.DST_TRANSFER_STEP", equals: 1, label: "The destination moves on by one word per sample" },
        { kind: "isr", fn: "DMA_ISR", min: 5, max: 5, label: "DMA_ISR runs once per buffer (5 times in 22 ms)", hint: "Hundreds of calls mean TRANSFER_SIZE is still 0: every sample is its own transfer." },
        {
          kind: "var", name: "pingMean", at: 6, ...near(SLOW_HI, 80), label: "After 6 ms: the mean of the first buffer (ping) is about 2900",
          hint: "With TRANSFER_SIZE and the step right, ping holds samples 0 to 49 when the second transfer starts.",
        },
        {
          kind: "var", name: "pongMean", at: 11, ...near(SLOW_HI, 80), label: "After 11 ms: the mean of the second buffer (pong) is about 2900",
          hint: "If pongMean stays 0 the DMA never wrote to pong: the shadow address must change in DMA_ISR.",
        },
        { kind: "var", name: "pingMean", at: 16, ...near(SLOW_LO, 80), label: "After 16 ms: the mean of the third buffer (ping again) is about 1200" },
        { kind: "var", name: "pongMean", at: 21, ...near(SLOW_LO, 80), label: "After 21 ms: the mean of the fourth buffer (pong again) is about 1200" },
        { kind: "no-diagnostic", code: "eallow", label: "Every DMA register write is between EALLOW and EDIS" },
      ],
      watch: ["DMAcount", "iPingPong", "pingMean", "pongMean"],
      inspect: ["DmaRegs.CH1.MODE", "DmaRegs.CH1.CONTROL", "DmaRegs.CH1.TRANSFER_SIZE", "DmaRegs.CH1.TRANSFER_COUNT", "DmaRegs.CH1.DST_ADDR_SHADOW", "DmaRegs.CH1.DST_ADDR_ACTIVE"],
      hints: [
        "N samples per transfer means `TRANSFER_SIZE = N-1`. One word further per sample means a step of 1.",
        "In the branch whose comment says the DMA has just started on ping, the next buffer is pong, so write pong's address. The other branch is the mirror image.",
        "`DmaRegs.CH1.TRANSFER_SIZE = N-1;` `DmaRegs.CH1.DST_TRANSFER_STEP = 1;` and in each branch `EALLOW; DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;` (or `ping`) `EDIS;`",
      ],
      takeaway: "The CPU ran 5 short interrupt functions for 220 samples. On the robot it is one for every 1024. The shadow register lets you choose the next buffer at any time during a transfer without disturbing the one in progress.",
    },
    {
      id: "dmaf-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Slow tone, fast tone",
      goal: "Sample a signal, low-pass filter it with 22 coefficients, measure the amplitude that is left, and show on LED1 whether a slow tone is present.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }, { course: "HW3" }, { course: "Lab 1" }],
      brief: `
A sensor signal contains either a slow tone (200 Hz) or a fast one (3 kHz), both with amplitude 1. Your program must tell them apart: **LED1 on while the slow tone is there**, off otherwise. A low-pass filter does the telling. The slow tone passes it almost unchanged, the fast one is cut down to almost nothing.

The array \`b\` holds a low-pass filter of order 21 with its cutoff at 1 kHz, the kind of filter \`fir1(21, 0.2)\` designs. Its 22 coefficients add up to 1.

## Timer 0, every 0.1 ms: \`cpu_timer0_isr\`
Set up timer 0 for a period of 100 microseconds with its interrupt, as in the interrupts chapter. In the function:

1. Shift the history \`xk\` and store \`tb_sample()\` in \`xk[0]\`.
2. Compute \`yk\`, the sum of \`b[i] * xk[i]\` over all \`NUM_B\` coefficients.
3. Track the largest size of \`yk\` in \`peak\`. \`fabs(yk)\` gives the size without the sign.
4. Count the samples in \`count\`. After \`WINDOW\` = 100 samples: copy \`peak\` to \`amplitude\`, set \`peak\` and \`count\` back to 0, and set the flag \`newResult = 1\`.
5. Acknowledge group 1.

## main
When \`newResult\` is 1: set it back to 0, then switch LED1 (GPIO22) **on if \`amplitude\` is above 0.5**, off if not. Use the SET and CLEAR registers.

## The test
The slow tone plays for the first 50 ms, then the fast tone until 100 ms. The tests read \`amplitude\` and LED1 near the end of each half.

Keep the names of the function and the global variables. The tests read them.
`,
      kit: "robot",
      durationMs: 100,
      stimuli: [...signal({ fs: 10000, f1: 200, a1: 1.0 }), { at: 50, set: "TB_F1_HZ", value: 3000 }],
      starter: checkpoint(
        `    // Vector, timer 0 with a period of 100 us, enables`,
        `        // When there is a new result: clear the flag, set or clear LED1`,
        `    // Shift, sample, filter, track the peak, count, acknowledge`,
      ),
      solution: checkpoint(
        TIMER0,
        `        if (newResult == 1) {
            newResult = 0;
            if (amplitude > 0.5) {
                GpioDataRegs.GPASET.bit.GPIO22 = 1;
            } else {
                GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
            }
        }`,
        `    int i;

    for (i = NUM_B - 1; i > 0; i--) {
        xk[i] = xk[i-1];
    }
    xk[0] = tb_sample();

    yk = 0;
    for (i = 0; i < NUM_B; i++) {
        yk = yk + b[i] * xk[i];
    }

    if (fabs(yk) > peak) {
        peak = fabs(yk);
    }

    count++;
    if (count == WINDOW) {
        amplitude = peak;
        peak = 0;
        count = 0;
        newResult = 1;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;`,
      ),
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 990, max: 1000, label: "cpu_timer0_isr runs every 0.1 ms", hint: "ConfigCpuTimer takes the period in microseconds: 100. Then the vector, TCR, IER, PIEIER1.INTx7 and EINT." },
        {
          kind: "var", name: "amplitude", at: 45, min: 0.95, max: 1.02, label: "The 200 Hz tone passes: amplitude is about 1 after 45 ms",
          hint: "A value near 0 means yk is not the weighted sum, or peak is never updated. A value that keeps growing means peak is not set back to 0 after each window.",
        },
        {
          kind: "var", name: "amplitude", at: 95, max: 0.02, label: "The 3 kHz tone is removed: amplitude is below 0.02 after 95 ms",
          hint: "If it is still near 1, the filter is not applied: check that each b[i] multiplies its own xk[i], and that the history is shifted on every sample.",
        },
        { kind: "led", led: "LED1", at: 45, on: true, label: "LED1 is on while the slow tone plays" },
        { kind: "led", led: "LED1", at: 95, on: false, label: "LED1 is off while the fast tone plays" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 10, label: "The interrupt function needs less than 10% of the sampling period (10 us)" }],
      watch: ["yk", "amplitude", "count"],
      hints: [
        "Build it in three steps and run after each: first the timer interrupt (does `count` move?), then the filter (watch `yk`), then the window and the LED.",
        "The filter is `fir_step` from two levels ago, written into the interrupt function. For the peak: `if (fabs(yk) > peak) { peak = fabs(yk); }`.",
        "End of window: `if (count == WINDOW) { amplitude = peak; peak = 0; count = 0; newResult = 1; }`. In main: `if (amplitude > 0.5) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`",
      ],
      takeaway: "This is Lab 4 in small: a timer sets the sampling rate, the interrupt function filters, main reacts. 22 multiplications and 21 moves per sample took 5 microseconds of every 100.",
    },

    // ---------------- practice ----------------
    {
      id: "dmaf-alias",
      kind: "timing",
      tier: "practice",
      title: "Too slow to see it",
      goal: "Mark what a 1 kHz sampler sees of a 900 Hz square wave.",
      refs: [{ course: "L8-9" }],
      brief: `
A square wave of **900 Hz** is high during the first half of each period and low during the second half. It is sampled at **1 kHz**, which is far too slow: the Nyquist frequency is only 500 Hz.

Between two samples, 1 ms passes. In that time the wave completes 0.9 of a period. So each sample lands 0.9 period later in the wave than the one before.

Sample 0 is taken 0.05 period after a rising edge. Count on from there and keep only the part after the decimal point, because whole periods do not matter:

- sample 0: 0.05, first half, **high**
- sample 1: 0.95, second half, **low**
- sample 2: 1.85, which is 0.85, **low**
- sample 3: 2.75, which is 0.75 ...

Mark every sample that is high. Then look at the pattern you drew: what is the frequency of *that* square wave?
`,
      slots: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
      rows: [
        {
          name: "Sampled level",
          editable: true,
          initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          answer: [1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0],
        },
      ],
      hints: [
        "Add 0.9 for every sample and drop the whole number. Below 0.5 is high.",
        "The positions are 0.05, 0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05, 0.95.",
        "High at samples 0, 6, 7, 8, 9 and 10. Low everywhere else.",
      ],
      takeaway: "The pattern repeats every 10 samples: a 100 Hz square wave, which is 1000 - 900. The 900 Hz wave was never slow, the sampler just looked too rarely. Sample at more than twice the highest frequency, and filter out what is above before the ADC.",
    },
    {
      id: "dmaf-short",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "One element short",
      goal: "The output of this order 4 filter is wrong, although the loops are right. Find the declaration that is too small.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
This is the FIR filter of order 4 from before. The loops are the ones you wrote. The output is still wrong.

Keep the coefficients \`b\` in mind: they are constants, and no line of the program assigns to them. Run the program and compare \`yk\` with what a low-pass of gain 1 should give for a signal around 1.0.

C does not check array bounds. An order M filter uses the samples x[n] to x[n-M]: count them. Then count the elements of the history array.

Writing one element past the end of an array does not fail. It changes whatever variable the linker happened to place next. Here that neighbour is easy to find. On the real chip it can be anything, and the program may even seem to work until you add a variable somewhere else.
`,
      kit: "robot",
      durationMs: 6,
      stimuli: signal(SIG_SHORT),
      starter: shortArray("NUM_B - 1"),
      solution: shortArray("NUM_B"),
      checks: [
        {
          kind: "var", name: "y40", ...near(fir(B4, SIG_SHORT, 39), 0.0005), label: "The 40th output is right",
          hint: "The loops use xk[0] to xk[4], five elements. The array has four, so xk[4] is really the variable behind it: b[0].",
        },
        { kind: "source", mustMatch: "xk\\s*\\[\\s*(NUM_B|5)\\s*\\]\\s*=", label: "The history array has NUM_B elements" },
      ],
      watch: ["yk", "numSamples"],
      hints: [
        "Order 4 means 5 coefficients and 5 samples in the sum.",
        "`float xk[NUM_B - 1]` has 4 elements. The shift loop writes `xk[4]`.",
        "Declare `float xk[NUM_B]`.",
      ],
      takeaway: "Order M needs M + 1 coefficients and M + 1 places if the newest sample lives in the array too. Size both arrays with the same #define and the mistake cannot happen.",
    },

    // ---------------- expert ----------------
    {
      id: "dmaf-running",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "200 samples in 2 microseconds",
      goal: "Make a 200-point moving average fast enough: no shifting, constant work per sample.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }],
      brief: `
A sensor reading of about 1.25 V carries a 50 Hz hum and some noise. Averaging over exactly one period of the hum, 200 samples at 10 kHz, removes the hum.

The program below does that the way you learned it: shift 199 values, add up 200. It gives the right answer and takes 40 of the 100 microseconds between two samples to do it. On the robot that time belongs to the control loop.

**Budget: 2 microseconds per call**, about 40 statements. The output must stay the same.

Two ideas get you there:

- **Do not move the data. Move the index.** Keep the samples where they are and remember where the oldest one is. The new sample replaces the oldest, and the index steps on, wrapping back to 0 at the end. This is a **circular buffer**.
- **Do not add 200 numbers again.** The new sum is the old sum, minus the sample that leaves, plus the sample that arrives.

The buffer starts full of zeros, so the first 20 ms are start-up. The tests look after that.
`,
      kit: "robot",
      durationMs: 45,
      stimuli: signal(SIG_HUM),
      starter: hum(
        `float xk[N];                 // xk[0] is the newest sample`,
        `    int i;
    float sum = 0;

    for (i = N - 1; i > 0; i--) {
        xk[i] = xk[i-1];
    }
    xk[0] = tb_sample();

    for (i = 0; i < N; i++) {
        sum = sum + xk[i];
    }
    yk = sum / N;`,
      ),
      solution: hum(
        `float xk[N];                 // circular buffer
uint16_t oldest = 0;         // index of the oldest sample
float total = 0;             // sum of everything in the buffer`,
        `    float x = tb_sample();

    total = total - xk[oldest] + x;     // the oldest sample leaves, the new one arrives
    xk[oldest] = x;
    oldest++;
    if (oldest == N) {
        oldest = 0;
    }
    yk = total / N;`,
      ),
      checks: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "The interrupt function never takes more than 2 us", hint: "Any loop over the buffer is too slow. The work per sample must not depend on N." },
        { kind: "signal", name: "TB_OUT", at: 25.03, ...near(1.25, 0.01), label: "The output is 1.25 after 25 ms (hum removed)", hint: "Subtract the sample you are about to overwrite before you overwrite it." },
        { kind: "signal", name: "TB_OUT", at: 33.37, ...near(1.25, 0.01), label: "The output is 1.25 after 33 ms" },
        { kind: "signal", name: "TB_OUT", at: 44.9, ...near(1.25, 0.01), label: "The output is 1.25 at the end" },
        { kind: "var", name: "numSamples", min: 440, label: "A sample is processed every 0.1 ms" },
      ],
      watch: ["yk", "numSamples"],
      hints: [
        "You need two new globals: the index of the oldest sample and the running total.",
        "In a full circular buffer the oldest sample sits exactly where the next one has to go.",
        "`total = total - xk[oldest] + x; xk[oldest] = x; oldest++; if (oldest == N) oldest = 0; yk = total / N;`",
      ],
      takeaway: "A circular buffer and a running total turn about 800 statements per sample into 10. The price: the running total collects rounding errors over hours of float additions, so long-running code recomputes the full sum now and then.",
    },
    {
      id: "dmaf-goertzel",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Is there a 1 kHz tone",
      goal: "Detect a weak 1 kHz tone next to a strong 2.5 kHz one by computing a single frequency of the Fourier transform, with no buffer.",
      refs: [{ course: "L8-9" }],
      brief: `
The FFT of Lecture 8 gives the strength of about 512 frequencies from 1024 samples. If you care about **one** frequency, that is a lot of wasted work. The Goertzel algorithm computes a single one, sample by sample, with two stored numbers and no buffer.

For a block of N samples and the frequency that fits k whole periods into the block:

\`\`\`c
c = 2 cos(2 pi k / N)          // once
s  = x + c * s1 - s2           // for every sample x
s2 = s1
s1 = s
\`\`\`

After the Nth sample:

\`\`\`c
power     = s1*s1 + s2*s2 - c*s1*s2
amplitude = 2 * sqrt(power) / N
\`\`\`

Then set \`s1\` and \`s2\` back to 0 for the next block.

## The task
Sampling is at 10 kHz and a block is N = 100 samples. Work out k for 1 kHz yourself.

- In \`cpu_timer0_isr\`: run the recurrence on every sample \`x\`. After each block store the amplitude in \`tone1k\` and set \`newResult = 1\`.
- In main: when \`newResult\` is set, clear it and switch **LED1 on if \`tone1k\` is above 0.15**, off if not.

The signal has a 2.5 kHz tone of amplitude 1 and noise all the time. After 30 ms a 1 kHz tone of amplitude **0.3** joins it. LED1 must be off before and on after, and \`tone1k\` must read about 0.3.
`,
      kit: "robot",
      durationMs: 60,
      stimuli: [...signal({ fs: 10000, f1: 2500, a1: 1.0, f2: 1000, a2: 0, noise: 0.1 }), { at: 30, set: "TB_A2", value: 0.3 }],
      starter: goertzel(
        ``,
        `        // When there is a new result: clear the flag, set or clear LED1`,
        `    // TODO: one Goertzel step; after N samples store the amplitude in tone1k`,
      ),
      solution: goertzel(
        `float s1 = 0;
float s2 = 0;
float coeff = 1.618034;      // 2 cos(2 pi k / N) with k = 10, N = 100
uint16_t count = 0;`,
        `        if (newResult == 1) {
            newResult = 0;
            if (tone1k > 0.15) {
                GpioDataRegs.GPASET.bit.GPIO22 = 1;
            } else {
                GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
            }
        }`,
        `    float s = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s;

    count++;
    if (count == N) {
        tone1k = 2 * sqrt(s1*s1 + s2*s2 - coeff*s1*s2) / N;
        s1 = 0;
        s2 = 0;
        count = 0;
        newResult = 1;
    }`,
      ),
      checks: [
        { kind: "var", name: "tone1k", at: 25, max: 0.05, label: "Before 30 ms: no 1 kHz tone found (below 0.05), despite the 2.5 kHz tone", hint: "A large value means k is wrong. k is the number of whole periods of 1 kHz in one block of 100 samples at 10 kHz." },
        { kind: "var", name: "tone1k", at: 55, min: 0.27, max: 0.33, label: "After 30 ms: the 1 kHz tone is measured at about 0.3", hint: "Check the order of the three recurrence lines, and that s1 and s2 are set back to 0 after each block." },
        { kind: "led", led: "LED1", at: 25, on: false, label: "LED1 is off before the tone starts" },
        { kind: "led", led: "LED1", at: 55, on: true, label: "LED1 is on while the tone is there" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1.5, label: "The interrupt function never takes more than 1.5 us" }],
      watch: ["tone1k"],
      hints: [
        "1 kHz has a period of 1 ms. A block is 10 ms. So k = 10 and c = 2 cos(2 pi 10 / 100) = 1.618034.",
        "Keep `s1`, `s2` and a sample counter as globals. Compute `c` once, not in every call.",
        "`s = x + coeff*s1 - s2; s2 = s1; s1 = s;` and after N samples `tone1k = 2 * sqrt(s1*s1 + s2*s2 - coeff*s1*s2) / N;` then reset `s1`, `s2` and the counter.",
      ],
      takeaway: "The 2.5 kHz tone is three times stronger and leaves no trace, because it also fits a whole number of periods into the block. A tone that does not fit leaks into its neighbours. That is why block length and sampling rate are chosen together.",
    },
    {
      id: "dmaf-median",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Spikes",
      goal: "Remove single-sample glitches with a median-of-5 filter, without disturbing the signal underneath.",
      refs: [{ course: "L8-9" }, { course: "Lab 4" }],
      brief: `
A sensor wire picks up a glitch now and then: one sample is 8 V too high. The signal itself is a 100 Hz sine between 0.5 and 1.5.

A moving average is the wrong tool. It does not remove the spike, it spreads it: averaging 5 samples turns one error of 8 into five errors of 1.6.

The **median** of 5 values is the middle one after sorting. One wild value among five ends up at the edge of the sorted list and never in the middle, so it has no effect at all.

Write \`despike\`. It receives the newest sample and returns the median of the last 5 samples. Use \`xk\` for the history.

Think before you sort: the history has to stay in **time order** for the next call. And five elements do not need a clever algorithm.

The tests check that the output never exceeds the real signal's maximum, and compare one output value with the exact median.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: signal(SIG_SPIKE),
      starter: spike(`    // TODO: keep the last 5 samples in xk, return their median
    return x;`),
      solution: spike(`    float s[5];
    float t;
    int i;
    int j;

    for (i = 4; i > 0; i--) {
        xk[i] = xk[i-1];
    }
    xk[0] = x;

    // Sort a copy, so that the history keeps its time order
    for (i = 0; i < 5; i++) {
        s[i] = xk[i];
    }
    for (i = 1; i < 5; i++) {
        t = s[i];
        j = i - 1;
        while (j >= 0 && s[j] > t) {
            s[j+1] = s[j];
            j--;
        }
        s[j+1] = t;
    }
    return s[2];`),
      checks: [
        { kind: "var", name: "maxOut", max: 1.501, min: 1.4, label: "The output never exceeds 1.5: every spike is gone", hint: "About 9.5 means spikes pass unchanged. About 3 means you are averaging: the spike is smaller but five samples wide." },
        { kind: "var", name: "y60", ...near(median5(59), 0.0005), label: "The 60th output is the median of samples 55 to 59", hint: "If the first outputs are right and later ones are not, you sorted xk itself and lost the time order. Sort a copy." },
        { kind: "var", name: "numSamples", min: 100, label: "A sample is processed every 0.1 ms" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 8, label: "The interrupt function never takes more than 8 us" }],
      watch: ["yk", "maxOut", "numSamples"],
      hints: [
        "Three steps: shift and store as always, copy the 5 values to a local array, sort the copy.",
        "Insertion sort is enough: take each element and move it left past every larger one.",
        "After sorting the copy `s`, the median is `s[2]`.",
      ],
      takeaway: "Linear filters such as the FIR spread an outlier over their whole length. The median is not linear: it ignores an outlier completely, at the price of a sort for every sample.",
    },
  ],
};
