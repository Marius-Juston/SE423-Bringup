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
/** A range around v, rounded so that a failed check shows readable limits. */
const near = (v: number, tol: number) => ({ min: +(v - tol).toPrecision(6), max: +(v + tol).toPrecision(6) });

// Level signals
const SIG_SWING: Sig = { fs: 10000, f1: 200, a1: 0.5, dc: 2.0 };
/** The same after the test lowers the offset by 1 V. */
const SIG_SWING_LOW: Sig = { ...SIG_SWING, dc: 1.0 };
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

const collect = (body: string) => `${FREQ}

#define N 50                 // samples per buffer

__interrupt void cpu_timer0_isr(void);

uint16_t count = 0;          // how many samples are in buf so far
uint16_t bufferFull = 0;     // flag for main: buf holds N fresh samples
float buf[N];                // the signal as the chip has it: a list of numbers
float biggest = 0;           // largest sample of the last full buffer
float smallest = 0;          // smallest sample of the last full buffer
uint16_t numBuffers = 0;

void main(void)
{
    int i;

${INIT}

${PIE_INIT}

${TIMER0}

    while (1) {
        if (bufferFull == 1) {
            bufferFull = 0;
            // Given: look through the list for its largest and smallest number
            biggest = buf[0];
            smallest = buf[0];
            for (i = 1; i < N; i++) {
                if (buf[i] > biggest) { biggest = buf[i]; }
                if (buf[i] < smallest) { smallest = buf[i]; }
            }
            numBuffers++;
        }
    }
}

// Every 0.1 ms: one sample
__interrupt void cpu_timer0_isr(void)
{
${body}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

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

// ---- the DMA set-up ladder: dmaf-setup-own (checklist) and dmaf-x-adc (requirements only) ----
const DMA_SOLVED = dma(
  `    DmaRegs.CH1.TRANSFER_SIZE = N-1;                    // N bursts per transfer`,
  `    DmaRegs.CH1.DST_TRANSFER_STEP = 1;                  // add 1 to the pointer after each burst`,
  `        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
        EDIS;`,
  `        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;
        EDIS;`,
);
/** The same program with an empty InitDma(). */
const DMA_EMPTY = (() => {
  const from = DMA_SOLVED.indexOf("void InitDma(void)\n{\n") + "void InitDma(void)\n{\n".length;
  const to = DMA_SOLVED.indexOf("}\n\n__interrupt void DMA_ISR(void)");
  return `${DMA_SOLVED.slice(0, from)}    // TODO: steps 1 to 10 of the brief\n${DMA_SOLVED.slice(to)}`;
})();

const xAdc = (o: { vector: string; init: string; isr: string }) => `${FREQ}

#define N 40                 // samples per buffer

__interrupt void DMA_ISR(void);
void InitDma(void);
void setupSampling(void);

uint16_t samples[N];
uint16_t bufferReady = 0;
int16_t DMAcount = 0;
float meanVolts = 0;

void main(void)
{
    int i;
    float sum;

${INIT}

${PIE_INIT}

${o.vector}

    InitDma();
    setupSampling();        // given: one sample of ADCINA4 every 0.1 ms

    EINT;
    ERTM;

    while (1) {
        if (bufferReady == 1) {
            bufferReady = 0;
            sum = 0;
            for (i = 0; i < N; i++) {
                sum = sum + samples[i];
            }
            meanVolts = (sum / N) * 3.0 / 4096.0;
        }
    }
}

void InitDma(void)
{
${o.init}
}

__interrupt void DMA_ISR(void)
{
${o.isr}
}

// Given (the ADC chapter): EPWM5 sends SOCA every 0.1 ms, SOC0 of ADCA converts
// ADCINA4. INT1CONT = 1 makes ADCA raise ADCAINT1 after every conversion even
// though nobody clears its flag: the DMA is the only listener.
void setupSampling(void)
{
    EALLOW;
    EPwm5Regs.ETSEL.bit.SOCAEN = 0;
    EPwm5Regs.TBCTL.bit.CTRMODE = 3;
    EPwm5Regs.ETSEL.bit.SOCASEL = 1;
    EPwm5Regs.ETPS.bit.SOCAPRD = 1;
    EPwm5Regs.TBCTR = 0x0;
    EPwm5Regs.TBPHS.bit.TBPHS = 0x0000;
    EPwm5Regs.TBCTL.bit.PHSEN = 0;
    EPwm5Regs.TBCTL.bit.CLKDIV = 0;
    EPwm5Regs.TBPRD = 4999;                  // 5000 counts of 20 ns: 0.1 ms
    EPwm5Regs.ETSEL.bit.SOCAEN = 1;
    EPwm5Regs.TBCTL.bit.CTRMODE = 0;

    AdcaRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcaRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
    AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4;
    AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99;
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 13;    // EPWM5 SOCA
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdcaRegs.ADCINTSEL1N2.bit.INT1CONT = 1;
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    EDIS;
}
`;

const X_ADC_INIT = `    EALLOW;

    DmaRegs.DMACTRL.bit.HARDRESET = 1;          // Reset entire DMA module
    asm(" NOP");                                // 1 cycle delay for HARDRESET to take effect

    DmaRegs.CH2.MODE.all = 0x8B02;
    // bit 15        1:      CHINTE, interrupt enabled
    // bit 11        1:      CONTINUOUS
    // bit 9         1:      CHINTMODE, interrupt at the end of the transfer
    // bit 8         1:      PERINTE, trigger enabled
    // bit 4-0       00010:  channel number

    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH2 = 1;          // trigger: ADCAINT1

    DmaRegs.CH2.BURST_SIZE.bit.BURSTSIZE = 0;           // 1 word per burst
    DmaRegs.CH2.TRANSFER_SIZE = N-1;                    // N bursts per transfer

    DmaRegs.CH2.SRC_TRANSFER_STEP = 0;                  // always read the same register
    DmaRegs.CH2.SRC_ADDR_SHADOW = (Uint32)&AdcaResultRegs.ADCRESULT0;

    DmaRegs.CH2.DST_TRANSFER_STEP = 1;                  // walk through the buffer
    DmaRegs.CH2.DST_ADDR_SHADOW = (Uint32)samples;

    DmaRegs.CH2.CONTROL.all = 0x0091;                   // ERRCLR, PERINTCLR, RUN

    EDIS;

    PieCtrlRegs.PIEIER7.bit.INTx2 = 1;  // DMA channel 2 is INT7.2
    IER |= M_INT7;`;

// "How loud is it?": the robot board's microphone on ADCINB4, sampled from the timer interrupt.
const mic = (isr: string) => `${FREQ}
#define BLOCK 1000               // samples per measurement: 0.1 s

__interrupt void cpu_timer0_isr(void);

float micVolts = 0;              // the newest sample, volts
float vmax = 0;                  // highest and lowest sample of the block so far
float vmin = 3.0;
int16_t count = 0;               // samples in the block so far
float mic_pp = 0;                // peak to peak of the last whole block, volts
float mic_mid = 0;               // middle of the last whole block, volts

void main(void)
{
${INIT}

${LED1}

${PIE_INIT}

    // ADCB: clock, 12-bit mode, power, and the 1 ms the data sheet asks for
    EALLOW;
    AdcbRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcSetMode(ADC_ADCB, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcbRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
    AdcbRegs.ADCSOC0CTL.bit.CHSEL = 4;     // SOC0 converts ADCINB4, the microphone
    AdcbRegs.ADCSOC0CTL.bit.ACQPS = 99;    // sample window of 500 ns
    AdcbRegs.ADCSOC0CTL.bit.TRIGSEL = 0;   // started by software only
    EDIS;
    AdcbRegs.ADCSOCFRC1.bit.SOC0 = 1;      // the first conversion

${TIMER0}

    while (1) {
    }
}

// Every 0.1 ms: one sample of the microphone
__interrupt void cpu_timer0_isr(void)
{
    // the conversion started 0.1 ms ago is long finished
    micVolts = AdcbResultRegs.ADCRESULT0 * 3.0 / 4096.0;
    AdcbRegs.ADCSOCFRC1.bit.SOC0 = 1;      // start the next one

${isr}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const MIC_ISR = `    if (micVolts > vmax) vmax = micVolts;
    if (micVolts < vmin) vmin = micVolts;
    count++;
    if (count == BLOCK) {
        mic_pp = vmax - vmin;
        mic_mid = (vmax + vmin) / 2;
        if (mic_pp > 1.0) GpioDataRegs.GPASET.bit.GPIO22 = 1;
        else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
        vmax = 0;
        vmin = 3.0;
        count = 0;
    }`;

export const ch15: Chapter = {
  id: "dma-filters",
  number: 15,
  title: "DMA and filters",
  blurb: "Ping-pong buffers, Nyquist and FIR.",
  requires: ["interrupts"],
  course: ["L8-9", "Lab 4", "HW3"],
  levels: [
    {
      id: "dmaf-signal",
      kind: "code",
      mode: "complete",
      title: "A signal is a list",
      goal: "Take a sample every 0.1 ms and collect 50 of them in an array.",
      refs: [{ course: "L8-9", slide: [26, 17] }, { course: "L5", slide: 18, note: "voltage to ADC number" }, { course: "Lab 4" }],
      brief: `
A sensor turns something physical (sound, light, distance) into a voltage that changes with time. That changing voltage is a **signal**. This chapter is about what a program can do with one.

## From a voltage to a number
The chip cannot store a curve. It can measure the voltage at one instant and keep the result as a number. The peripheral that measures is the **ADC** (analog-to-digital converter): 0 V gives 0, 3.0 V gives 4095. One measurement is a **sample**.

## Sampling
Taking samples at a steady pace is **sampling**. The pace has two names, and each is 1 divided by the other:

- the **sampling period** T: the time between two samples. The course uses 0.1 ms.
- the **sampling rate** fs: samples per second, in Hz. 1 / 0.0001 s = 10 000 Hz.

What the voltage did between two samples, the chip never knows.

The curve is the voltage. The dots are the samples: all the chip has.

{{figure:sampling-alias}}

## A list of numbers
After sampling, a signal is an array of numbers, oldest first: \`buf[0]\`, \`buf[1]\`, \`buf[2]\` ... An array that collects samples is called a **buffer**. N samples cover N x T: 50 samples x 0.1 ms = 5 ms of signal.

## Your part
Timer 0 calls \`cpu_timer0_isr\` every 0.1 ms: that is the sampling rate. \`tb_sample()\` returns the newest sample as a \`float\`, in volts. Everything that starts with \`tb_\` belongs to this game's **test bench**, which stands in for the sensor and the ADC. The ADC has its own chapter.

- TODO 1: store the sample in \`buf[count]\`, then add 1 to \`count\`.
- TODO 2: when \`count\` reaches \`N\` the buffer is full: set \`count\` back to 0 and set \`bufferFull = 1\`.

\`main()\` is given. When the flag is set it looks through the 50 numbers for the largest and the smallest. The test signal swings smoothly between 1.5 V and 2.5 V, 200 times a second. After 10 ms the test lowers it by 1 V, and the numbers main finds must follow.
`,
      kit: "robot",
      durationMs: 22,
      stimuli: [...signal(SIG_SWING), { at: 10.05, set: "TB_DC", value: 1.0 }],
      starter: collect(`    // TODO 1: store tb_sample() in the next free place of buf, then count it

    // TODO 2: when buf holds N samples, start again at place 0 and set bufferFull`),
      solution: collect(`    buf[count] = tb_sample();
    count++;

    if (count == N) {
        count = 0;
        bufferFull = 1;
    }`),
      checks: [
        {
          kind: "var", name: "numBuffers", min: 4, max: 4, label: "Four buffers of 50 samples are filled in 22 ms",
          hint: "0 means bufferFull is never set: count must go up by 1 on every call, and be compared with N. 1 means count is not set back to 0 when the buffer is full. Far more than 4 means the flag is set on every call, not only when count reaches N.",
        },
        { kind: "var", name: "numBuffers", at: 20.2, equals: 4, label: "The fourth buffer is full after exactly 200 samples (20 ms)", hint: "A buffer of N samples is full when count == N: by then the places 0 to N - 1 are written. Testing count > N writes one place past the end of the array." },
        { kind: "var", name: "count", max: 49, label: "count stays inside the buffer (0 to 49)", hint: "buf has the places 0 to N - 1. Set count back to 0 when it reaches N." },
        {
          kind: "var", name: "biggest", at: 6, ...near(Math.max(...Array.from({ length: 50 }, (_, i) => x(SIG_SWING, i))), 0.005), label: "After 6 ms: the largest sample in the first buffer is about 2.5 V",
          hint: "The buffer must hold 50 different samples, one per call: buf[count] = tb_sample();",
        },
        {
          kind: "var", name: "smallest", at: 6, ...near(Math.min(...Array.from({ length: 50 }, (_, i) => x(SIG_SWING, i))), 0.005), label: "After 6 ms: the smallest sample in the first buffer is about 1.5 V",
          hint: "0 means some places of buf were never written. Store each sample in buf[count], not always in buf[0], and add 1 to count after storing, not before.",
        },
        {
          kind: "var", name: "biggest", ...near(Math.max(...Array.from({ length: 50 }, (_, i) => x(SIG_SWING_LOW, 150 + i))), 0.005), label: "At the end: the largest sample has followed the signal down to about 1.5 V",
          hint: "The numbers in buf must come from tb_sample(), one per call, not from constants.",
        },
        {
          kind: "var", name: "smallest", ...near(Math.min(...Array.from({ length: 50 }, (_, i) => x(SIG_SWING_LOW, 150 + i))), 0.005), label: "At the end: the smallest sample is about 0.5 V",
          hint: "0 means some places of buf were never written. Store each sample in buf[count], not always in buf[0], and add 1 to count after storing, not before.",
        },
      ],
      watch: ["count", "biggest", "smallest", "numBuffers"],
      hints: [
        "`count` is the number of samples already stored, so `buf[count]` is the next free place.",
        "`buf[count] = tb_sample();` then `count++;`. After that, test `if (count == N)`.",
        "`buf[count] = tb_sample(); count++; if (count == N) { count = 0; bufferFull = 1; }`",
      ],
      takeaway: "To a program a signal is an array, filled at a steady pace. This way cost one interrupt per sample, and main had to finish before the next samples overwrote the buffer. The DMA and a second buffer fix both.",
    },
    {
      id: "dmaf-sine",
      kind: "calc",
      title: "A wave has a frequency",
      goal: "Describe a sine wave with three numbers, and count how many samples fall into one period.",
      refs: [{ course: "L8-9", slide: [37, 36], note: "samples per period" }],
      brief: `
The smoothest signal there is goes up and down like a swing: a **sine wave**. A whistle, the hum of a motor and the voltage of a wall socket are sine waves. In this chapter a sine wave is also called a **tone**.

The figure opens on a Signal of 100 Hz sampled at 2000 Hz.

{{figure:sampling-alias}}

Three numbers describe a sine wave:

- **Frequency** f: how many full swings it makes per second, in Hz. One swing is a **period**, and it lasts 1 / f. A 100 Hz tone has a period of 1 / 100 s = 10 ms.
- **Amplitude**: how far it goes away from its middle, up and down alike.
- **Offset**: where the middle is. The offset is the part of the signal that does not change. Engineers call it **DC**.

Example: offset 2.0 V and amplitude 0.5 V. The wave swings between 2.0 - 0.5 = 1.5 V and 2.0 + 0.5 = 2.5 V. That was the signal of the previous level.

## Samples per period
How well do the samples show a tone? Count how many fall into one period:

**samples per period = fs / f**

Example: fs = 2000 Hz and f = 100 Hz give 20 samples per period. In the figure that is 20 dots per swing, and the shape is easy to see. Now raise the signal to 500 Hz: 4 dots per swing, and the shape is nearly lost.

A slow tone gets many samples per period, a fast one few. The next level asks how few are enough.
`,
      fields: [
        { id: "per", label: "Period of a 50 Hz tone", unit: "ms", answer: 20, why: "1 / 50 s = 0.02 s = 20 ms." },
        { id: "freq", label: "Frequency of a tone whose period is 0.5 ms", unit: "Hz", answer: 2000, why: "1 / 0.0005 s = 2000 Hz. Period and frequency are each 1 divided by the other." },
        { id: "top", label: "Highest value of a wave with offset 1.2 and amplitude 0.8", answer: 2, tolPct: 0.1, why: "Offset plus amplitude: 1.2 + 0.8 = 2.0." },
        { id: "bottom", label: "Lowest value of the same wave", answer: 0.4, tolPct: 0.1, why: "Offset minus amplitude: 1.2 - 0.8 = 0.4." },
        { id: "spp", label: "Samples in one period of a 2 kHz tone, sampled at 10 kHz", answer: 5, why: "fs / f = 10 000 / 2000 = 5. You will meet this tone again in the moving average." },
        { id: "spp50", label: "Samples in one period of a 50 Hz tone, sampled at 10 kHz", answer: 200, why: "10 000 / 50 = 200. One period lasts 20 ms, and a sample is taken every 0.1 ms." },
      ],
      hints: [
        "Period = 1 / frequency, and frequency = 1 / period. Work in seconds, then convert to ms.",
        "The wave reaches offset + amplitude at the top and offset - amplitude at the bottom.",
        "Samples per period = sampling rate / tone frequency: 10 000 / 2000 and 10 000 / 50.",
      ],
      takeaway: "A sine wave is three numbers: frequency, amplitude and offset. At a sampling rate fs, one period of a tone at f holds fs / f samples.",
    },
    {
      id: "dmaf-numbers",
      kind: "calc",
      title: "Nyquist and aliases",
      goal: "Find out how few samples per period are enough, and what the samples show when there are fewer.",
      refs: [{ course: "L8-9", slide: [33, 35, 34] }, { course: "HW3" }, { trm: "5.4" }],
      brief: `
How few samples per period are enough? Try it. In the figure, set Sampling to 1000 Hz, leave Signal at 100 Hz and then raise it slowly.

{{figure:sampling-alias}}

- Up to 500 Hz the dots still go up and down as often as the curve. 500 Hz is 2 samples per period.
- Above 500 Hz there are fewer than 2 samples per period. The dots now trace a **slower** wave that is not in the signal at all.

**Nyquist.** With a sampling rate fs, the highest frequency the samples can show is **fs / 2**, the **Nyquist frequency**. Turned around: sample more than twice as fast as the highest frequency in the signal.

**Aliasing.** A tone at f between fs / 2 and fs gives the same samples as a tone at **fs - f** would (turned upside down). The false tone is an **alias**. Example: fs = 1000 Hz and a 900 Hz tone. The samples look like a 100 Hz tone: 1000 - 900.

Nothing in your code can tell an alias from a real tone afterwards. The samples are the same numbers.

**Buffer time.** A buffer of N samples taken every T seconds covers N x T seconds.
`,
      fields: [
        { id: "a", label: "Time to fill a buffer of 1024 samples taken every 0.1 ms", unit: "ms", answer: 102.4, tolPct: 0.1, why: "1024 x 0.1 ms = 102.4 ms. That is also how often the DMA interrupts the CPU." },
        { id: "b", label: "Nyquist frequency when sampling every 0.1 ms", unit: "Hz", answer: 5000, why: "The sampling rate is 1 / 0.1 ms = 10 000 Hz. Half of it is 5000 Hz." },
        { id: "c", label: "A 7 kHz tone sampled at 10 kHz appears at", unit: "Hz", answer: 3000, why: "7 kHz is above the Nyquist frequency of 5 kHz. It aliases to fs - f = 10 000 - 7000 = 3000 Hz." },
        { id: "d", label: "Samples per period of a tone exactly at the Nyquist frequency", answer: 2, why: "fs / f with f = fs / 2 is 2: one sample on the way up, one on the way down. Fewer than that and the swing is missed." },
        { id: "e", label: "A signal holds tones up to 3 kHz. The sampling rate must be above", unit: "Hz", answer: 6000, why: "More than twice the highest frequency: 2 x 3000 Hz. The course samples at 10 000 Hz, so tones up to 5000 Hz are safe." },
        { id: "f", label: "A 9900 Hz tone sampled at 10 kHz appears at", unit: "Hz", answer: 100, why: "fs - f = 10 000 - 9900 = 100 Hz. A very fast tone looks like a very slow one: the same thing as a spinning wheel that seems to turn slowly in a film." },
      ],
      hints: [
        "Convert 0.1 ms to a rate first: 1 / 0.0001 s = 10 000 samples per second. The Nyquist frequency is half of that.",
        "For an alias, subtract the tone's frequency from the sampling rate.",
        "102.4, 5000, 3000, 2, 6000, 100.",
      ],
      takeaway: "fs / 2 is the limit. Anything above it must be removed by a circuit in front of the ADC (a resistor and a capacitor, as in the electricity primer), because after sampling it cannot be told from a real low tone.",
    },
    {
      id: "dmaf-brief",
      kind: "brief",
      title: "Samples by the thousand",
      goal: "Learn how 1024 samples reach a buffer without the CPU touching one of them.",
      refs: [{ course: "L8-9", slide: [12, 23, 18] }, { trm: "5.1" }, { trm: "5.2" }, { trm: "5.4" }],
      brief: `
In "A signal is a list" an interrupt function ran for every sample and stored it. A microphone sampled 10 000 times a second would cost 10 000 interrupts a second, each with its entry, its exit and its acknowledge, just to copy one number.

## The DMA
**DMA** means direct memory access. The DMA is a peripheral that copies a word from one address to another when a **trigger** arrives: a signal from another peripheral. No CPU instruction is involved. It has 6 channels, each with its own source, destination, trigger and interrupt. It does nothing by itself: every copy needs a trigger.

## The sampling chain
On the robot three peripherals pass the work along (Lecture 8):

1. An **ePWM** module sets the pace. It is a timer peripheral with its own chapter later. Here it only sends a pulse every 0.1 ms that tells the ADC "measure now" (a start of conversion).
2. The **ADC** turns the pin voltage into a number, stores it in its result register \`ADCRESULT0\` and raises its interrupt signal.
3. That signal triggers the **DMA** channel, which copies \`ADCRESULT0\` into the next free place of a buffer.

After 1024 samples the buffer is full. Only then is the CPU interrupted: once every 1024 x 0.1 ms = **102.4 ms**.

## Ping and pong
The samples keep coming while main works on a full buffer. With one buffer, as in the first level, main has to finish before new samples overwrite it. So there are two buffers, **ping** and **pong**. The DMA fills one while main processes the other, and then they swap. The next level steps through a swap.

What main does with a full buffer, the FFT and filters, comes after the DMA levels.
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
          prompt: "What is the ePWM module's job in this chain?",
          options: [
            "It converts the voltage to a number",
            "It sets the pace: every 0.1 ms it sends the pulse that starts one conversion",
            "It copies the result into the buffer",
            "It interrupts the CPU for every sample",
          ],
          answer: 1,
          why: "The ePWM is used as a clock. The ADC converts, the DMA copies, and the CPU is interrupted only when a buffer is full.",
        },
      ],
      takeaway: "ePWM sets the time, the ADC converts, the DMA copies. The CPU only sees full buffers, and it works on one buffer while the other fills.",
    },
    {
      id: "dmaf-pingpong",
      kind: "quiz",
      title: "Whose turn is it",
      goal: "Decide which buffer main may read, and when a new address takes effect.",
      refs: [{ course: "L8-9", slide: [18, 15] }, { trm: "5.4" }],
      brief: `
Two buffers of 1024 samples, \`ping\` and \`pong\`. The DMA fills one. main reads the other. Filling one buffer is one **transfer**: 1024 copies.

The DMA interrupt of the course setup comes **at the start of a transfer**: the DMA has just loaded its destination address and stored the first sample. At that moment:

- the buffer that is now being filled must be left alone for the next 102.4 ms,
- the **other** buffer was completed one sample ago. It is the one main may process,
- the interrupt function writes the address for the transfer **after** this one into \`DmaRegs.CH1.DST_ADDR_SHADOW\`. Your code cannot change the address the DMA is working with. It writes this **shadow** register, a waiting copy, which the DMA takes over only when a transfer starts.

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

{{figure:ping-pong}}

Step through the figure, one sample per press, with buffers of 8 samples instead of 1024. Watch what happens at each swap: where the next sample goes, which address waits in the shadow register, and which buffer main is given.
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
      id: "dmaf-dma",
      kind: "code",
      mode: "complete",
      title: "Let the DMA do the copying",
      goal: "Finish the course's DMA channel 1 setup and swap the two buffers in the DMA interrupt function.",
      refs: [{ course: "L8-9", slide: [22, 15] }, { trm: "5.4" }, { trm: "5.3.3" }, { trm: "5.9.3" }, { trm: "3.4.5" }],
      brief: `
Now the DMA does the copying. The interrupt function runs once per buffer, not once per sample.

## What stands in for the ADC
The robot's chain is EPWM7, ADCB, DMA. Here the game's **test bench** replaces the first two. Everything starting with \`tb_\` belongs to it and stands in for hardware you are not practising right now:

- \`tb_stream(&adcResult);\` makes the test bench put a fresh ADC reading (a count from 0 to 4095) into the variable \`adcResult\` every 0.1 ms. \`adcResult\` plays the part of \`AdcbResultRegs.ADCRESULT0\`.
- CPU timer 0 gives the trigger every 0.1 ms. In the DMA's source table it is number 68 (TINT0). The course selects 6 (ADCBINT1).

Everything else is the course's \`InitDma()\` from the FFT starter project. It is **given**: its comments say what each line sets, and you change four places only. One trigger makes the DMA copy one **burst**, here a single word. \`Uint32\` is TI's older name for \`uint32_t\`.

## What to write
In \`InitDma()\`:

- \`DmaRegs.CH1.TRANSFER_SIZE\`: a transfer is N samples. Size registers hold **one less** than the count: a value of 2 means 3.
- \`DmaRegs.CH1.DST_TRANSFER_STEP\`: how far the destination address moves after each sample. The source step is 0 because the source is always the same register. The destination must walk through the buffer.

In \`DMA_ISR()\`: the two lines that write the address of the **other** buffer to \`DmaRegs.CH1.DST_ADDR_SHADOW\`. DMA registers are protected, so each write goes between \`EALLOW;\` and \`EDIS;\`. The address of an array is its name, cast to the register's type:

\`\`\`c
EALLOW;
DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
EDIS;
\`\`\`

## When the interrupt comes
\`MODE.all = 0x8901\` has CHINTMODE = 0: the interrupt comes at the **start** of each transfer, as in the last level. When the DMA has just started on \`ping\`, the complete buffer is \`pong\`, and the address you write is used for the transfer after this one. (The course's starter file flags the buffer just *started*. This level follows the reference manual and flags the complete one.)

The signal is a slow 50 Hz sine around 1.5 V. main computes the mean of each finished buffer in ADC counts: about 2900 for the first two buffers (the upper half of the sine), about 1200 for the next two.
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
          hint: "With TRANSFER_SIZE and the step right, ping holds samples 0 to 49 when the second transfer starts. A value below 100 means only one place of ping was ever written: the destination step is still 0.",
        },
        {
          kind: "var", name: "pongMean", at: 11, ...near(SLOW_HI, 80), label: "After 11 ms: the mean of the second buffer (pong) is about 2900",
          hint: "If pongMean stays 0 the DMA never wrote to pong: the shadow address must change in DMA_ISR. A small value such as 40 means pong got only a sample or two: check the step, and that the two branches do not write the same address.",
        },
        { kind: "var", name: "pingMean", at: 16, ...near(SLOW_LO, 80), label: "After 16 ms: the mean of the third buffer (ping again) is about 1200", hint: "Still about 2900: ping was not filled a second time. In the branch that says the DMA has just started on pong, the address to write is ping's." },
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
      id: "dmaf-fft",
      kind: "calc",
      title: "What the FFT tells you",
      goal: "Read the output of the course's 1024-point FFT: which bin stands for which frequency.",
      refs: [{ course: "L8-9", slide: [26, 25], note: "bin width fs / N" }],
      brief: `
Real signals are several tones added together: a motor's hum plus a whistle plus a voice. Added sines make a bumpy curve, and looking at the samples you cannot tell which tones are in it.

The **FFT** (fast Fourier transform) can. It takes a whole buffer and answers: **which frequencies are in these samples, and how strong is each?**

The course's FFT starter project runs these two calls of TI's library on every full ping or pong buffer (given code: \`hnd_rfft\` is a handle the starter sets up, \`pwrSpec\` an array of floats):

\`\`\`c
RFFT_f32(hnd_rfft);        // the transform: 1024 samples in
RFFT_f32_mag(hnd_rfft);    // strengths out: pwrSpec[0] to pwrSpec[512]
\`\`\`

Read the output like this, with N samples taken at the rate fs:

- \`pwrSpec[k]\` is the strength of the part of the signal that fits **k whole periods** into the buffer. Each k is called a **bin**.
- The buffer lasts N / fs seconds, so bin k stands for the frequency **k x fs / N**. The step from one bin to the next, fs / N, is the **resolution**. Example: bin 10 is 10 x 10 000 / 1024 = 97.66 Hz.
- Bin 0 is the average of the samples: the offset, 0 Hz, DC. The last bin, N / 2, is the Nyquist frequency. There is nothing above it to show.
- A pure tone gives one tall bin, with small neighbours if it does not fit a whole number of periods into the buffer.

To find the loudest tone, the starter looks for the largest \`pwrSpec[k]\` and prints its frequency:

\`\`\`c
maxpwrindex * 10000.0 / 1024.0     // bin number x fs / N, in Hz
\`\`\`

It starts the search at bin 5, so that the offset and very slow changes do not win.

In the course fs = 10 000 Hz and N = 1024.
`,
      fields: [
        { id: "res", label: "Resolution: the frequency step between two bins", unit: "Hz", answer: 9.766, tolPct: 0.5, why: "fs / N = 10 000 / 1024 = 9.766 Hz. Two tones closer together than this land in the same bin." },
        { id: "f256", label: "Frequency of bin 256", unit: "Hz", answer: 2500, why: "256 x 10 000 / 1024 = 2500 Hz. Bin 256 is a quarter of the way to bin 1024, and 2500 Hz is a quarter of the sampling rate." },
        { id: "last", label: "Frequency of the last bin, 512", unit: "Hz", answer: 5000, why: "512 x 10 000 / 1024 = 5000 Hz: the Nyquist frequency." },
        { id: "bin", label: "Someone whistles at 1000 Hz. Number of the tallest bin", answer: 102, why: "1000 / 9.766 = 102.4, and the nearest whole bin is 102. The tone does not fit a whole number of periods into the buffer, so bin 103 gets a share too." },
        { id: "shown", label: "Frequency the starter prints for that whistle", unit: "Hz", answer: 996.1, tolPct: 0.2, why: "102 x 10 000 / 1024 = 996.1 Hz. The answer can only be a multiple of the resolution." },
        { id: "long", label: "Resolution with a buffer of 2048 samples", unit: "Hz", answer: 4.883, tolPct: 0.5, why: "10 000 / 2048 = 4.883 Hz. Twice the samples, twice as fine. The price: the buffer takes 204.8 ms to fill." },
      ],
      hints: [
        "The resolution is the sampling rate divided by the number of samples.",
        "Bin k is at k x 9.766 Hz. To find the bin of a tone, divide its frequency by 9.766 and round to the nearest whole number.",
        "9.766, 2500, 5000, 102, 996.1, 4.883.",
      ],
      takeaway: "The FFT turns 1024 samples into 513 strengths, one every 9.77 Hz from 0 to 5 kHz. Finer resolution needs a longer buffer, and a longer wait for the answer.",
    },
    {
      id: "dmaf-avg5",
      kind: "code",
      mode: "complete",
      title: "Five-point moving average",
      goal: "Complete an interrupt function that outputs the mean of the last 5 samples.",
      refs: [{ course: "L8-9", slide: [28, 29] }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
Real samples are never clean. Wires pick up **noise**: small random errors that push each sample a little up or down.

**Averaging smooths.** Replace each sample by the mean of itself and the few before it. Errors that go up and down cancel, and what the samples have in common stays. Code that makes a new signal out of the samples is a **filter**. This one is the **moving average**.

{{figure:moving-average}}

Drag the window along the noisy signal. The lower part shows the five stored samples, newest first.

## In symbols
Samples are numbered: x[n] is the newest, x[n-1] the one before it, x[n-4] four steps back. Each time a sample arrives, compute

\`\`\`c
yk = (x[n] + x[n-1] + x[n-2] + x[n-3] + x[n-4]) / 5
\`\`\`

Example: the last five samples are 2, 4, 3, 5, 1. Their sum is 15, so yk is 3.

## The history array
Timer 0 calls \`cpu_timer0_isr\` every 0.1 ms. \`tb_sample()\` returns the new sample, and \`tb_output(yk)\` shows your result to the tests. The last five samples are kept in an array: \`xk[0]\` is the newest, \`xk[4]\` the oldest. For every new sample:

1. **Shift**: every stored sample moves one place towards the old end. \`xk[3]\` goes to \`xk[4]\`, \`xk[2]\` to \`xk[3]\`, and so on. The oldest value drops out.
2. **Store** the new sample in \`xk[0]\`.
3. **Sum** the five values and divide by 5.

Shift from the old end: copy into \`xk[4]\` first. In the other direction you would overwrite values before you have moved them.

## The test signal
An offset of 2.0 with a 2 kHz tone of amplitude 0.5 on top. At 10 kHz sampling one period of the tone is exactly 5 samples, and a sine is as much above its middle as below it, so its mean over one full period is zero. A correct average shows a steady **2.0**: the tone is gone. After 7 ms the test lowers the offset to 1.0, and your output must follow.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [...signal(SIG_AVG), { at: 7, set: "TB_DC", value: 1.0 }],
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
        { kind: "signal", name: "TB_OUT", at: 3.05, ...near(2.0, 0.005), label: "The output is 2.0 after 3 ms", hint: "Swinging between 1.5 and 2.5: the samples are passed through unaveraged. A steady 0: yk is never set, or you wrote 1/5, which is a whole-number division and gives 0 (write 5.0). A steady value other than 2.0, such as 2.5: the sum has too many or too few terms. Small and changing: the history is not shifted." },
        { kind: "signal", name: "TB_OUT", at: 6.33, ...near(2.0, 0.005), label: "The output is still 2.0 after 6 ms", hint: "The sum must contain 5 different samples. Check the direction of your shift loop." },
        { kind: "signal", name: "TB_OUT", at: 11.9, ...near(1.0, 0.005), label: "The output follows the signal down to 1.0", hint: "The output must be computed from the samples, not written as a constant." },
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
      id: "dmaf-avg-bugs",
      kind: "code",
      mode: "debug",
      title: "An average that is not",
      goal: "This 5-point average has two bugs. Find and fix both.",
      refs: [{ course: "L8-9", slide: [29, 44] }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
The signal is a constant 1.2 with a 2 kHz tone of amplitude 0.8 on top. A 5-point average at 10 kHz should remove the tone and output a steady **1.2**. After 8 ms the test lowers the constant to 0.6, and the output should follow.

Run the program and look at \`yk\`. Then fix one bug, run again, and look again: the second bug only shows once the first is gone.

Two things to check, both classics:

- **What is in the history?** After a few samples \`xk[0]\` to \`xk[4]\` should hold five *different* samples, the newest first. Work through the shift loop by hand for one pass: which value ends up in \`xk[4]\`?
- **What does the division compute?** Look at the types of the numbers on both sides of the \`/\`.

The tests also read \`xk[4]\` after the 22nd sample to see whether it really is the sample from four steps earlier.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [...signal(SIG_BUGS), { at: 8, set: "TB_DC", value: 0.6 }],
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
        { kind: "signal", name: "TB_OUT", at: 11.9, ...near(0.6, 0.005), label: "The output follows the signal down to 0.6", hint: "The output must be the mean of the five stored samples, not a constant." },
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
      id: "dmaf-fir",
      kind: "code",
      mode: "write",
      title: "Any coefficients you like",
      goal: "Write one step of a general FIR filter: y = b[0] x[n] + b[1] x[n-1] + ... with the coefficients from an array.",
      refs: [{ course: "L8-9", slide: [30, 44, 31] }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
The moving average multiplies every sample by the same weight, 1/5. A designed filter gives each sample its own weight. This is the general **FIR** filter (the letters stand for finite impulse response). The weights \`b\` are its **coefficients**. A filter of **order** M uses the newest sample and the M before it, so it has M + 1 coefficients:

\`\`\`c
y[n] = b[0] x[n] + b[1] x[n-1] + b[2] x[n-2] + b[3] x[n-3] + b[4] x[n-4]
\`\`\`

Example with two weights, b = {0.75, 0.25}, newest sample 4 and the one before 8: y = 0.75 x 4 + 0.25 x 8 = 5.

{{figure:moving-average}}

In the figure, switch the weights from "all equal" to "your own": the code is the same loop, only the numbers in \`b\` change.

A **low-pass** filter lets slow changes (low frequencies) through and removes fast ones. You do not work out its weights by hand: in MATLAB, the maths program the course uses, \`fir1(order, cutoff)\` computes them, and Lab 4 has you paste them into an array. Here the array \`b\` holds a low-pass filter of order 4, so \`NUM_B\` is 5.

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
        { kind: "var", name: "y3", ...near(fir(B4, SIG_FIR, 2), 0.0005), label: "The third output is right (the history still holds zeros)", hint: "For the third sample: y = b[0] x[2] + b[1] x[1] + b[2] x[0]. The newest sample belongs to b[0]. A value 5 times too small: do not divide at the end, the weights already add up to 1." },
        { kind: "var", name: "y40", ...near(fir(B4, SIG_FIR, 39), 0.0005), label: "The 40th output is right", hint: "Each coefficient must meet its own sample: b[i] with xk[i]. Shift before you store the new sample. A value that grows from call to call: start the sum at 0 on every call." },
        { kind: "var", name: "numSamples", min: 50, label: "A sample is processed every 0.1 ms" },
      ],
      watch: ["yk", "numSamples"],
      hints: [
        "It is the moving average again, with `b[i] * xk[i]` in the sum and no division at the end.",
        "The shift loop runs from `NUM_B - 1` down to 1. The sum loop runs from 0 to `NUM_B - 1`.",
        "`for (i = NUM_B - 1; i > 0; i--) { xk[i] = xk[i-1]; }` then `xk[0] = x;` then `for (i = 0; i < NUM_B; i++) { y = y + b[i] * xk[i]; }` and `return y;`",
      ],
      takeaway: "Every FIR filter is this loop. Low-pass, high-pass or band-pass differ only in the numbers in b. Symmetric coefficients, like these, delay all frequencies by the same time (the course calls this linear phase).",
    },
    {
      id: "dmaf-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Slow tone, fast tone",
      goal: "Sample a signal, low-pass filter it with 22 coefficients, measure the amplitude that is left, and show on LED1 whether a slow tone is present.",
      refs: [{ course: "L8-9", slide: [38, 40, 44] }, { course: "Lab 4" }, { course: "HW3" }, { course: "Lab 1" }],
      brief: `
A sensor signal contains either a slow tone (200 Hz) or a fast one (3 kHz), both with amplitude 1. Your program must tell them apart: **LED1 on while the slow tone is there**, off otherwise. A low-pass filter does the telling. The slow tone passes it almost unchanged, the fast one is cut down to almost nothing.

The array \`b\` holds a low-pass filter of order 21 with its **cutoff** at 1 kHz: tones well below 1 kHz pass, tones well above are removed. It is the kind of filter \`fir1(21, 0.2)\` designs. Its 22 coefficients add up to 1, so a constant input comes out unchanged.

## Timer 0, every 0.1 ms: \`cpu_timer0_isr\`
Set up timer 0 for a period of 100 microseconds with its interrupt. These are the lines that stood in \`main()\` of every code level of this chapter: vector, \`InitCpuTimers\`, \`ConfigCpuTimer\`, \`TCR\`, \`IER\`, \`PIEIER1\`, \`EINT\`. In the function:

1. Shift the history \`xk\` and store \`tb_sample()\` in \`xk[0]\`.
2. Compute \`yk\`, the sum of \`b[i] * xk[i]\` over all \`NUM_B\` coefficients.
3. Track the largest size of \`yk\` in \`peak\`: if \`fabs(yk)\` is larger than \`peak\`, it becomes the new \`peak\`. \`fabs(x)\` is x without its sign, so \`fabs(-0.8)\` is 0.8. The largest size a tone reaches is its amplitude.
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
        { kind: "isr", fn: "cpu_timer0_isr", min: 990, max: 1000, label: "cpu_timer0_isr runs every 0.1 ms", hint: "Ran 0 times: a line of the timer set-up is missing. Compare with main() of \"Five-point moving average\": vector (between EALLOW and EDIS), InitCpuTimers, ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 100), TCR.all = 0x4000, IER |= M_INT1, PIEIER1.bit.INTx7 = 1, EINT. Ran once: the PIEACK line is missing. Too few times: the period is in microseconds, 100." },
        {
          kind: "var", name: "amplitude", at: 45, min: 0.95, max: 1.02, label: "The 200 Hz tone passes: amplitude is about 1 after 45 ms",
          hint: "A value near 0 means yk is not the weighted sum, or peak is never updated. A value far above 1 means yk is not set to 0 before the sum is added up on each call.",
        },
        {
          kind: "var", name: "amplitude", at: 95, max: 0.02, label: "The 3 kHz tone is removed: amplitude is below 0.02 after 95 ms",
          hint: "If it is still near 1: either peak is not set back to 0 at the end of each window, so it keeps the slow tone's value, or the filter is not applied. Check that each b[i] multiplies its own xk[i] and that the history is shifted on every sample.",
        },
        { kind: "led", led: "LED1", at: 45, on: true, label: "LED1 is on while the slow tone plays" },
        { kind: "led", led: "LED1", at: 95, on: false, label: "LED1 is off while the fast tone plays" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 10, label: "The interrupt function needs less than 10% of the sampling period (10 us)" }],
      watch: ["yk", "amplitude", "count"],
      hints: [
        "Build it in three steps and run after each: first the timer interrupt (does `count` move?), then the filter (watch `yk`), then the window and the LED.",
        "The filter is `fir_step` from \"Any coefficients you like\", written into the interrupt function. For the peak: `if (fabs(yk) > peak) { peak = fabs(yk); }`.",
        "End of window: `if (count == WINDOW) { amplitude = peak; peak = 0; count = 0; newResult = 1; }`. In main: `if (amplitude > 0.5) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`",
      ],
      takeaway: "This is Lab 4 in small: a timer sets the sampling rate, the interrupt function filters, main reacts. 22 multiplications and 21 moves per sample took 5 microseconds of every 100.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "dmaf-chain",
      kind: "order",
      tier: "practice",
      title: "From the timer to your buffer",
      goal: "Put the steps of the sampling chain in order, from the ePWM pulse to main processing a full buffer.",
      refs: [{ course: "L8-9", slide: [23, 15, 25] }, { trm: "5.3.3" }, { trm: "5.4" }, { trm: "11.9" }],
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
      id: "dmaf-race",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Reading the wrong buffer",
      goal: "main computes the mean of a buffer the interrupt function is still writing. Make it read the finished one.",
      refs: [{ course: "L8-9", slide: [18, 25] }, { trm: "5.4" }],
      brief: `
This program does ping-pong buffering by hand, without the DMA, so that you can see every step.

- The timer interrupt function takes a sample every 0.1 ms and stores it in \`ping\` or \`pong\`. \`fillPing\` says which one.
- After \`N\` = 50 samples the buffer is full. The function switches to the other buffer and sets the flag \`bufferFull\`.
- main waits for the flag and computes the **mean** of the buffer that has just been completed.

The signal is a slow 50 Hz sine. One buffer is 5 ms, a quarter of its period, so the buffer means should come out as about +0.63, +0.65, -0.63, -0.65, and so on.

They do not. Run it and compare \`mean1\` and \`mean3\` with what you expect.

{{figure:ping-pong}}

The figure shows the same mistake with the DMA doing the filling: choose "the buffer just started" and step to a swap to see what main gets.

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
        {
          kind: "var", name: "mean", at: 12, ...near(mean(SIG_SLOW, 50, 50), 0.005), label: "The second mean is that of samples 50 to 99 (about +0.65)",
          hint: "About +0.63 is the first buffer's mean again: main read ping both times. The second buffer to be completed is pong.",
        },
        {
          kind: "var", name: "mean", ...near(mean(SIG_SLOW, 150, 50), 0.005), label: "The fourth mean is that of samples 150 to 199 (about -0.65)",
          hint: "About -0.63 is the third buffer's mean again. Which buffer main reads must depend on fillPing.",
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
      id: "dmaf-alias",
      kind: "timing",
      tier: "practice",
      title: "Too slow to see it",
      goal: "Mark what a 1 kHz sampler sees of a 900 Hz square wave.",
      refs: [{ course: "L8-9", slide: [35, 33] }],
      brief: `
A square wave of **900 Hz** is high during the first half of each period and low during the second half. It is sampled at **1 kHz**, which is far too slow: the Nyquist frequency is only 500 Hz.

Between two samples, 1 ms passes. In that time the wave completes 0.9 of a period. So each sample lands 0.9 period later in the wave than the one before.

Sample 0 is taken 0.05 period after a rising edge. Count on from there and keep only the part after the decimal point, because whole periods do not matter:

- sample 0: 0.05, first half, **high**
- sample 1: 0.95, second half, **low**
- sample 2: 1.85, which is 0.85, **low**
- sample 3: 2.75, which is 0.75 ...

Mark every sample that is high. Then look at the pattern you drew: what is the frequency of *that* square wave?

In the figure, set Signal to 900 Hz and Sampling to 1000 Hz to see the same thing happen.

{{figure:sampling-alias}}

The figure shows the same situation for a sine: 900 Hz sampled 1000 times a second.
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
      refs: [{ course: "L8-9", slide: [39, 44] }, { course: "Lab 4" }, { course: "HW3" }],
      brief: `
This is the FIR filter of order 4 from before. The loops are the ones you wrote. The output is still wrong.

Keep the coefficients \`b\` in mind: they are constants, and no line of the program assigns to them. Run the program and compare \`yk\` with what a low-pass of gain 1 should give for a signal around 1.0.

C does not check array bounds. An order M filter uses the samples x[n] to x[n-M]: count them. Then count the elements of the history array.

Writing one element past the end of an array does not fail. It changes whatever variable happens to be stored next in memory. Here that neighbour is easy to find. On the real chip it can be anything, and the program may even seem to work until you add a variable somewhere else.
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
    {
      id: "dmaf-setup-own",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "InitDma(), from an empty function",
      goal: "Write the whole DMA channel 1 set-up yourself, building its mode word bit by bit.",
      refs: [{ course: "L8-9", slide: [22, 13] }, { trm: "5.9.3" }, { trm: "5.4" }, { trm: "5.3.3" }, { trm: "5.9.1" }, { trm: "3.4.5" }],
      brief: `
In "Let the DMA do the copying" \`InitDma()\` was given and you changed two lines. Here it is empty. The rest of the program is the one you finished there, with the test bench as the ADC and CPU timer 0 as the trigger.

Write these steps in this order. The channel's registers are \`DmaRegs.CH1.\` plus the name.

1. \`EALLOW;\` Every DMA register is protected.
2. \`DmaRegs.DMACTRL.bit.HARDRESET = 1;\` then \`asm(" NOP");\` Reset the whole DMA and wait one cycle.
3. \`MODE.all\`: one word, the sum of its bits. Bit n is worth 2^n.
   - bit 15, CHINTE = 1: the channel may interrupt the CPU
   - bit 11, CONTINUOUS = 1: start again after each transfer
   - bit 10, ONESHOT = 0: one burst per trigger
   - bit 9, CHINTMODE = 0: interrupt at the start of a transfer
   - bit 8, PERINTE = 1: listen to the trigger
   - bits 4 to 0: the channel's own number
4. \`DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH1 = 68;\` The trigger: 68 is TINT0.
5. \`BURST_SIZE.bit.BURSTSIZE\` and \`TRANSFER_SIZE\`: one word per burst, N bursts per transfer. Both hold **one less** than the count.
6. \`SRC_TRANSFER_STEP = 0;\` and \`SRC_ADDR_SHADOW = (Uint32)&adcResult;\` Always read the same variable.
7. \`DST_TRANSFER_STEP = 1;\` and \`DST_ADDR_SHADOW = (Uint32)ping;\` Walk through \`ping\` first.
8. \`CONTROL.all = 0x0091;\` Bit 7 clears an old error, bit 4 an old trigger, bit 0 is **RUN**. This line comes after the addresses: RUN starts the channel with what is set.
9. \`EDIS;\`
10. DMA channel 1 is **INT7.1**: its \`PIEIER7\` bit, and group 7 in \`IER\`.
`,
      kit: "robot",
      durationMs: 22,
      stimuli: signal(SIG_SLOW),
      starter: DMA_EMPTY,
      solution: DMA_SOLVED,
      checks: [
        { kind: "no-diagnostic", code: "eallow", label: "1. Every DMA register write is between EALLOW; and EDIS;", hint: "The line named here was ignored. EALLOW; is the first line of InitDma() and EDIS; comes after the CONTROL line." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "CHINTE", equals: 1, label: "3. MODE: the channel may interrupt (bit 15)", hint: "Bit 15 is worth 0x8000." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "CONTINUOUS", equals: 1, label: "3. MODE: continuous (bit 11)", hint: "Bit 11 is worth 0x0800. Without it the channel stops after the first buffer." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "ONESHOT", equals: 0, label: "3. MODE: one burst per trigger (bit 10 is 0)", hint: "With ONESHOT = 1 a single trigger copies the whole buffer at once: 50 times the same sample." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "CHINTMODE", equals: 0, label: "3. MODE: interrupt at the start of a transfer (bit 9 is 0)", hint: "DMA_ISR is written for an interrupt at the start. Leave bit 9 (0x0200) at 0." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "PERINTE", equals: 1, label: "3. MODE: the trigger is enabled (bit 8)", hint: "Bit 8 is worth 0x0100. Without it no trigger reaches the channel and nothing is copied." },
        { kind: "reg", reg: "DmaRegs.CH1.MODE", field: "PERINTSEL", equals: 1, label: "3. MODE: bits 4 to 0 hold the channel number, 1", hint: "The lowest bits must be the channel's own number, or the trigger chosen in step 4 never arrives." },
        { kind: "reg", reg: "DmaClaSrcSelRegs.DMACHSRCSEL1", field: "CH1", equals: 68, label: "4. The trigger is TINT0 (68)", hint: "DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH1 = 68; Note the other register group: DmaClaSrcSelRegs." },
        { kind: "reg", reg: "DmaRegs.CH1.BURST_SIZE", field: "BURSTSIZE", equals: 0, label: "5. One word per burst (BURSTSIZE = 0)", hint: "The register holds the count minus one." },
        { kind: "reg", reg: "DmaRegs.CH1.TRANSFER_SIZE", equals: 49, label: "5. A transfer is 50 samples (TRANSFER_SIZE = 49)", hint: "N-1. With 0, every sample is its own transfer and DMA_ISR runs hundreds of times." },
        { kind: "reg", reg: "DmaRegs.CH1.SRC_TRANSFER_STEP", equals: 0, label: "6. The source address stays on adcResult", hint: "SRC_TRANSFER_STEP = 0: the source is one variable, not a list." },
        { kind: "reg", reg: "DmaRegs.CH1.DST_TRANSFER_STEP", equals: 1, label: "7. The destination moves on by one word per sample", hint: "With a step of 0 every sample lands in ping[0]." },
        { kind: "no-diagnostic", code: "dma", label: "8. The channel is started with its addresses and trigger in place", hint: "The message says what was not in place when RUN was set. CONTROL.all = 0x0091 comes last: after MODE, the trigger and both SHADOW addresses." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER7", field: "INTx1", equals: 1, label: "10. DMA channel 1 is enabled in the PIE", hint: "PieCtrlRegs.PIEIER7.bit.INTx1 = 1; and IER |= M_INT7;" },
        { kind: "isr", fn: "DMA_ISR", min: 5, max: 5, label: "DMA_ISR runs once per buffer (5 times in 22 ms)", hint: "Never, with every check above green: the RUN bit (CONTROL bit 0) or IER |= M_INT7. Once: CONTINUOUS. Hundreds: TRANSFER_SIZE." },
        { kind: "var", name: "pingMean", at: 6, ...near(SLOW_HI, 80), label: "After 6 ms: the mean of the first buffer (ping) is about 2900", hint: "0: nothing was copied to ping. Check both SHADOW addresses: (Uint32)&adcResult as the source, (Uint32)ping as the destination." },
        { kind: "var", name: "pongMean", at: 21, ...near(SLOW_LO, 80), label: "After 21 ms: the mean of the fourth buffer (pong) is about 1200" },
      ],
      watch: ["DMAcount", "iPingPong", "pingMean", "pongMean"],
      inspect: ["DmaRegs.CH1.MODE", "DmaRegs.CH1.CONTROL", "DmaRegs.CH1.TRANSFER_SIZE", "DmaRegs.CH1.SRC_ADDR_SHADOW", "DmaRegs.CH1.DST_ADDR_SHADOW"],
      hints: [
        "Ten steps, about fifteen lines. Run after each step: the checks carry the step numbers.",
        "The mode word is 0x8000 + 0x0800 + 0x0100 + 1 = 0x8901. BURSTSIZE = 0 and TRANSFER_SIZE = N-1.",
        "The last lines: `DmaRegs.CH1.CONTROL.all = 0x0091;` `EDIS;` `PieCtrlRegs.PIEIER7.bit.INTx1 = 1;` `IER |= M_INT7;`",
      ],
      takeaway: "A DMA channel is six answers: when (trigger and mode), how much (burst and transfer size), from where, to where, both steps, and RUN last.",
    },
    {
      id: "dmaf-x-adc",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "The real chain, on channel 2",
      goal: "Set up DMA channel 2 from its requirements so that it collects real ADC results, with no test bench and no list of lines.",
      refs: [{ course: "L8-9", slide: [20, 21, 22] }, { trm: "5.3.3" }, { trm: "5.4" }, { trm: "5.9.3" }, { trm: "11.9" }, { trm: "3.4.5" }],
      brief: `
No test bench this time. \`setupSampling()\` is given: EPWM5 starts SOC0 of ADCA every 0.1 ms, and ADCA raises **ADCAINT1** after every conversion. The result is in \`AdcaResultRegs.ADCRESULT0\`. Your DMA channel moves it into a buffer.

## Requirements
- Use DMA **channel 2**. Its registers are \`DmaRegs.CH2.\` plus the name.
- Trigger: **ADCAINT1**. In the DMA's source table that is number **1**. Channel 2's field is \`DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH2\`.
- Each trigger copies **one** 16-bit word from \`AdcaResultRegs.ADCRESULT0\` to the next place in \`samples\`.
- A transfer is **N** samples. When one is complete the channel starts again at \`samples[0]\` by itself: one buffer, no ping and pong.
- The channel interrupts the CPU at the **end** of each transfer, when the buffer is complete. Channel 2 is **INT7.2**, and its vector is \`PieVectTable.DMA_CH2_INT\`.
- \`DMA_ISR\` acknowledges PIE group 7, sets \`bufferReady = 1\` and counts in \`DMAcount\`. main() computes the mean.

## What you need to work out
- The **mode word**. The bits are those of the level before, with two changes: the interrupt comes at the end (bit 9, CHINTMODE = 1), and the lowest five bits hold this channel's number.
- The source address. The address of a register is taken like that of a variable: \`(Uint32)&AdcaResultRegs.ADCRESULT0\`.
- Everything in the two size and two step registers.

Three parts are yours: the vector in \`main()\`, \`InitDma()\` and \`DMA_ISR\`. The photoresistor is at 1.2 V, then at 2.4 V.

A star if \`DMA_ISR\` stays under 1 us: it reports, main() calculates.
`,
      kit: "robot",
      durationMs: 22,
      stimuli: [
        { at: 0, set: "ADCINA4", value: 1.2 },
        { at: 10.02, set: "ADCINA4", value: 2.4 },
      ],
      starter: xAdc({ vector: "    // the vector of DMA channel 2: yours", init: "    // yours", isr: "    // yours" }),
      solution: xAdc({
        vector: `    EALLOW;
    PieVectTable.DMA_CH2_INT = &DMA_ISR;
    EDIS;`,
        init: X_ADC_INIT,
        isr: `    PieCtrlRegs.PIEACK.all = PIEACK_GROUP7;
    bufferReady = 1;
    DMAcount += 1;`,
      }),
      checks: [
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW; and EDIS;", hint: "The line named here was ignored. The DMA registers and the vector table are protected." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "PERINTSEL", equals: 2, label: "MODE: the lowest bits hold the channel number, 2", hint: "0x8901 was channel 1's word. For channel 2 the lowest five bits are 00010." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "PERINTE", equals: 1, label: "MODE: the trigger is enabled (bit 8)", hint: "Bit 8, 0x0100." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "CHINTMODE", equals: 1, label: "MODE: interrupt at the end of a transfer (bit 9)", hint: "Bit 9, 0x0200. With 0 the interrupt comes when the buffer has one fresh sample and 39 old ones." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "ONESHOT", equals: 0, label: "MODE: one burst per trigger (bit 10 is 0)", hint: "With ONESHOT = 1 one trigger fills the whole buffer with the same sample." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "CONTINUOUS", equals: 1, label: "MODE: continuous (bit 11)", hint: "Bit 11, 0x0800. Without it the channel stops after the first buffer." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "CHINTE", equals: 1, label: "MODE: the channel may interrupt (bit 15)", hint: "Bit 15, 0x8000." },
        { kind: "reg", reg: "DmaRegs.CH2.MODE", field: "DATASIZE", equals: 0, label: "MODE: 16-bit words (bit 14 is 0)", hint: "An ADC result is one 16-bit word." },
        { kind: "reg", reg: "DmaClaSrcSelRegs.DMACHSRCSEL1", field: "CH2", equals: 1, label: "The trigger of channel 2 is ADCAINT1 (1)", hint: "DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH2 = 1; The field CH1 belongs to the other channel." },
        { kind: "reg", reg: "DmaRegs.CH2.BURST_SIZE", field: "BURSTSIZE", equals: 0, label: "One word per burst", hint: "BURSTSIZE holds the count minus one." },
        { kind: "reg", reg: "DmaRegs.CH2.TRANSFER_SIZE", equals: 39, label: "A transfer is 40 samples", hint: "TRANSFER_SIZE holds N-1." },
        { kind: "reg", reg: "DmaRegs.CH2.SRC_TRANSFER_STEP", equals: 0, label: "The source stays on ADCRESULT0", hint: "A source step of 1 would read ADCRESULT1, ADCRESULT2 and so on." },
        { kind: "reg", reg: "DmaRegs.CH2.DST_TRANSFER_STEP", equals: 1, label: "The destination walks through samples", hint: "With a step of 0 every sample lands in samples[0]." },
        { kind: "no-diagnostic", code: "dma", label: "The channel is started with its addresses and trigger in place", hint: "The message says what was not in place when RUN was set. CONTROL.all = 0x0091 comes last: after MODE, the trigger and both SHADOW addresses." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER7", field: "INTx2", equals: 1, label: "DMA channel 2 is enabled in the PIE", hint: "INT7.2: PieCtrlRegs.PIEIER7.bit.INTx2 = 1; and IER |= M_INT7;" },
        { kind: "isr", fn: "DMA_ISR", min: 4, max: 6, label: "DMA_ISR runs once per buffer, every 4 ms", hint: "Never, with the checks above green: RUN, IER |= M_INT7, or the registers of CH1 were written. Once: PIEACK_GROUP7. Hundreds of times: TRANSFER_SIZE." },
        { kind: "var", name: "meanVolts", at: 9.9, min: 1.19, max: 1.21, label: "meanVolts is 1.2 V after two buffers", hint: "0: bufferReady is never set, or nothing reaches samples. A small value: the destination step is 0, so only samples[0] is written. Check the source address too." },
        { kind: "var", name: "meanVolts", min: 2.39, max: 2.41, label: "and 2.4 V after the light changes" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      bonus: [{ kind: "isr-time", fn: "DMA_ISR", maxUs: 1, label: "DMA_ISR takes less than 1 us", hint: "Set the flag and return. The loop over the buffer belongs in main()." }],
      watch: ["DMAcount", "bufferReady", "meanVolts"],
      inspect: ["DmaRegs.CH2.MODE", "DmaRegs.CH2.CONTROL", "DmaRegs.CH2.TRANSFER_COUNT", "DmaRegs.CH2.SRC_ADDR_SHADOW", "DmaRegs.CH2.DST_ADDR_SHADOW", "AdcaResultRegs.ADCRESULT0"],
      hints: [
        "Write InitDma() in the order of the level before: reset, mode, trigger, sizes, source, destination, CONTROL, then the PIE.",
        "The mode word is 0x8000 + 0x0800 + 0x0200 + 0x0100 + 2 = 0x8B02. TRANSFER_SIZE = N-1.",
        "`DmaRegs.CH2.SRC_ADDR_SHADOW = (Uint32)&AdcaResultRegs.ADCRESULT0;` `DmaRegs.CH2.DST_ADDR_SHADOW = (Uint32)samples;` `DmaRegs.CH2.CONTROL.all = 0x0091;` and in DMA_ISR: `PieCtrlRegs.PIEACK.all = PIEACK_GROUP7;` `bufferReady = 1;` `DMAcount += 1;`",
      ],
      takeaway: "ePWM, ADC and DMA now run the whole sampling chain, and the CPU hears of it once per buffer. On the robot the same block points at ADCB and a microphone.",
    },

    {
      id: "dmaf-mic",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "How loud is it?",
      goal: "Measure how loud the robot board's microphone hears a tone: the peak-to-peak voltage of each 0.1 s block of samples.",
      refs: [{ course: "Lab 4" }, { trm: "11.6.4" }, { trm: "11.4.5" }],
      brief: `
The robot board has a **microphone**. A small amplifier turns the sound into a voltage on the pin **ADCINB4**, channel 4 of ADC B.

## What its voltage looks like
Sound is air pressure that swings up and down, and a pin cannot go below 0 V. So the amplifier puts silence in the middle of the ADC's range, about **1.5 V**, and sound swings around that: between about 0.5 V and 2.5 V for the loudest sound it passes (Lab 4).

One sample therefore says nothing about loudness: a loud tone passes through 1.5 V thousands of times a second. Loudness is how **far** the voltage swings. A simple measure is **peak to peak**: the highest sample minus the lowest in a stretch of time.

Example: the samples of a block range from 0.9 V to 2.1 V. Peak to peak is 2.1 - 0.9 = 1.2 V, and the middle is (2.1 + 0.9) / 2 = 1.5 V.

## What is given
\`main()\` powers up ADC B and sets SOC0 to ADCINB4, started by software. The timer interrupt runs every 0.1 ms, 10000 samples a second: enough for tones up to 5000 Hz. It stores the newest sample in \`micVolts\` and starts the next conversion.

## Your task
In \`cpu_timer0_isr\`, after the given lines:

1. Keep the highest sample of the block in \`vmax\` and the lowest in \`vmin\`, and count the samples in \`count\`.
2. When \`count\` reaches \`BLOCK\` (1000 samples, 0.1 s): set \`mic_pp = vmax - vmin\` and \`mic_mid = (vmax + vmin) / 2\`. Switch LED1 (GPIO22) on when \`mic_pp\` is above 1.0 V, otherwise off. Then start a new block: \`vmax = 0\`, \`vmin = 3.0\`, \`count = 0\`.

The tests play a 440 Hz tone, loud at first and quieter after 0.25 s.
`,
      kit: "robot",
      starter: mic("    // TODO: vmax, vmin and count; at the end of a block mic_pp, mic_mid, LED1, and start again"),
      solution: mic(MIC_ISR),
      durationMs: 520,
      stimuli: [
        { at: 0, set: "MIC_TONE_HZ", value: 440 },
        { at: 0, set: "MIC_AMPL_V", value: 1.0 },
        { at: 250, set: "MIC_AMPL_V", value: 0.3 },
      ],
      checks: [
        { kind: "isr", fn: "cpu_timer0_isr", min: 5000, label: "A sample every 0.1 ms" },
        {
          kind: "var", name: "mic_pp", at: 240, min: 1.95, max: 2.01,
          label: "The loud tone swings 0.5 V to 2.5 V: mic_pp is 2.0 V",
          hint: "In the thousands: the samples are still counts, use micVolts. 2.5: vmin never moved, it must start at 3.0 so the first sample is below it.",
        },
        { kind: "var", name: "mic_mid", at: 240, min: 1.48, max: 1.52, label: "Its middle is 1.5 V" },
        { kind: "led", led: "LED1", at: 240, on: true, label: "Loud: LED1 is on" },
        {
          kind: "var", name: "mic_pp", min: 0.58, max: 0.61,
          label: "The quiet tone swings 1.2 V to 1.8 V: mic_pp is 0.6 V",
          hint: "Still 2.0: vmax and vmin keep the extremes of the loud tone. Start every block afresh: vmax = 0; vmin = 3.0; count = 0;",
        },
        { kind: "var", name: "mic_mid", min: 1.48, max: 1.52, label: "Its middle is still 1.5 V" },
        { kind: "led", led: "LED1", at: 515, on: false, label: "Quiet: LED1 is off", hint: "Switch the LED off as well as on: else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;" },
        { kind: "no-diagnostic", code: "adc", label: "The ADC reports no problem" },
      ],
      watch: ["micVolts", "mic_pp", "mic_mid", "count"],
      hints: [
        "Two comparisons per sample: is it above the highest so far, is it below the lowest so far.",
        "`if (micVolts > vmax) vmax = micVolts;` `if (micVolts < vmin) vmin = micVolts;` `count++;`",
        "`if (count == BLOCK) { mic_pp = vmax - vmin; mic_mid = (vmax + vmin) / 2; if (mic_pp > 1.0) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1; vmax = 0; vmin = 3.0; count = 0; }`",
      ],
      takeaway: "A microphone's signal swings around a middle voltage. Its loudness is the size of the swing over many samples, never one sample.",
    },

    // ------------------------------------------------------------------ expert
    {
      id: "dmaf-running",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "200 samples in 2 microseconds",
      goal: "Make a 200-point moving average fast enough: no shifting, constant work per sample.",
      refs: [{ course: "L8-9", slide: 44, note: "keep only the last M samples" }, { course: "Lab 4" }],
      brief: `
A sensor reading of about 1.25 V carries a 50 Hz hum and some noise. Averaging over exactly one period of the hum, 200 samples at 10 kHz, removes the hum.

The program below does that the way you learned it: shift 199 values, add up 200. It gives the right answer and takes 40 of the 100 microseconds between two samples to do it. On the robot that time belongs to the control loop.

**Budget: 2 microseconds per call**, about 40 statements. The output must stay the same.

Two ideas get you there:

- **Do not move the data. Move the index.** Keep the samples where they are and remember where the oldest one is. The new sample replaces the oldest, and the index steps on, wrapping back to 0 at the end. This is a **circular buffer**.
- **Do not add 200 numbers again.** The new sum is the old sum, minus the sample that leaves, plus the sample that arrives.

The buffer starts full of zeros, so the first 20 ms are start-up. The tests look after that. At 26 ms the reading drops to 0.75 V, and 20 ms later your output must have followed.
`,
      kit: "robot",
      durationMs: 50,
      stimuli: [...signal(SIG_HUM), { at: 26, set: "TB_DC", value: 0.75 }],
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
        { kind: "signal", name: "TB_OUT", at: 49.9, ...near(0.75, 0.01), label: "The output has followed the reading down to 0.75 at the end", hint: "The running total must lose every sample that leaves the buffer, or old values stay in it for ever." },
        { kind: "var", name: "numSamples", min: 490, label: "A sample is processed every 0.1 ms" },
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
      refs: [{ course: "L8-9", slide: 5, note: "what one frequency of the transform measures" }],
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
      refs: [{ course: "Lab 4" }],
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
        {
          kind: "signal", name: "TB_OUT", at: 5.95, ...near(median5(58), 0.0005), label: "The 59th output is right too, with a spike in the middle of the history",
          hint: "The spike is one of the five values here. The median is the third of the sorted five, whatever the position of the spike in time.",
        },
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
