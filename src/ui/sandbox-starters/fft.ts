// The Sandbox's "FFT" starting program for the robot board. Written for
// this game, with the structure of the course's fftDMA starter project: a
// PWM timer starts an ADC conversion of the microphone 10000 times a second,
// the DMA stores 1024 samples without any interrupt, and main() takes the
// FFT of each full buffer and prints the strongest frequency on the LCD.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "fft",
  label: "FFT of the microphone with DMA (fftDMA starter)",
  kit: "robot",
  about:
    "The DMA collects 1024 samples of the microphone (ADCINB4) and the LCD shows the strongest frequency: move the knob \"Tone at the microphone\" and watch Freq follow it, then go above 5000 Hz.",
  watch: ["maxpwrindex", "maxpwr", "DMAcount", "numFFTs"],
  source: String.raw`// FFT of the microphone, sampled by the DMA.
//   EPWM7, 10000 times a second: tells ADCB to convert the microphone (ADCINB4)
//   DMA channel 1: copies each result into a buffer, with no code running
//   DMA_ISR: runs when a buffer of 1024 samples starts; swaps the two buffers
//   main(): takes the FFT of the buffer that is full and prints the peak
// Two buffers ("ping" and "pong") take turns, so the one main() reads is
// never the one the DMA is writing.
// Bin k of the FFT is the frequency k * 10000 / 1024 Hz, and the FFT can
// only tell frequencies up to half the sampling rate (5000 Hz) apart.

#define LAUNCHPAD_CPU_FREQUENCY 200
#define RFFT_STAGES 10
#define RFFT_SIZE (1 << RFFT_STAGES)   // 1024 samples

__interrupt void cpu_timer0_isr(void);
__interrupt void DMA_ISR(void);
void InitDma(void);

float fft_input[RFFT_SIZE];          // samples in volts
float fft_output[RFFT_SIZE];         // real and imaginary parts
float pwrSpec[(RFFT_SIZE/2) + 1];    // size of each frequency, bins 0 to 512
float RFFTF32Coef[RFFT_SIZE];        // sines and cosines the FFT needs
uint16_t AdcPingBufRaw[RFFT_SIZE];   // raw ADC readings, 0 to 4095
uint16_t AdcPongBufRaw[RFFT_SIZE];

RFFT_F32_STRUCT rfft;                        // what the FFT functions work on
RFFT_F32_STRUCT_Handle hnd_rfft = &rfft;

uint16_t pingFFT = 0;     // 1: the ping buffer is full and waits for its FFT
uint16_t pongFFT = 0;
uint16_t iPingPong = 0;   // which buffer the DMA is filling: 0 ping, 1 pong
int16_t DMAcount = 0;
uint32_t numFFTs = 0;
float maxpwr = 0;
int16_t maxpwrindex = 0;
uint32_t numTimer0calls = 0;
int16_t i = 0;

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Red LED of the LaunchPad: an output, off (1 is off).
    GPIO_SetupPinMux(34, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(34, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // Tell the chip which function runs for which interrupt.
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.DMA_CH1_INT = &DMA_ISR;
    EDIS;

    // Timer 0 every 10 ms (the period is in microseconds).
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 10000);
    CpuTimer0Regs.TCR.all = 0x4000;   // start with the interrupt enabled

    init_serialSCIB(&SerialB, 19200);   // the LCD

    // EPWM7 only keeps time here: every 5000 counts of its 50 MHz clock
    // (0.1 ms) it sends a start-of-conversion pulse (SOCA) to the ADC.
    EALLOW;
    EPwm7Regs.ETSEL.bit.SOCAEN = 0;     // no pulses while it is set up
    EPwm7Regs.TBCTL.bit.CTRMODE = 3;    // counter stopped
    EPwm7Regs.ETSEL.bit.SOCASEL = 2;    // pulse when the counter reaches TBPRD
    EPwm7Regs.ETPS.bit.SOCAPRD = 1;     // on every such event
    EPwm7Regs.TBCTR = 0;
    EPwm7Regs.TBPHS.bit.TBPHS = 0;
    EPwm7Regs.TBCTL.bit.PHSEN = 0;
    EPwm7Regs.TBCTL.bit.CLKDIV = 0;
    EPwm7Regs.TBPRD = 5000;
    EPwm7Regs.ETSEL.bit.SOCAEN = 1;
    EPwm7Regs.TBCTL.bit.CTRMODE = 0;    // count up: the pulses start
    EDIS;

    // ADCB: one conversion (SOC0) of channel 4 on every pulse of EPWM7.
    EALLOW;
    AdcbRegs.ADCCTL2.bit.PRESCALE = 6;   // ADC clock = 200 MHz / 4
    AdcSetMode(ADC_ADCB, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcbRegs.ADCCTL1.bit.INTPULSEPOS = 1;   // flag when the result is ready
    AdcbRegs.ADCCTL1.bit.ADCPWDNZ = 1;      // power on
    DELAY_US(1000);                         // the ADC needs 1 ms to wake up
    AdcbRegs.ADCSOC0CTL.bit.CHSEL = 4;      // ADCINB4: the microphone
    AdcbRegs.ADCSOC0CTL.bit.ACQPS = 99;     // sample for 100 clock cycles
    AdcbRegs.ADCSOC0CTL.bit.TRIGSEL = 0x11; // started by EPWM7 SOCA
    AdcbRegs.ADCINTSEL1N2.bit.INT1SEL = 0;  // SOC0 sets the flag ADCB1 ...
    AdcbRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdcbRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    AdcbRegs.ADCINTSEL1N2.bit.INT1CONT = 1; // ... every time, cleared or not
    EDIS;
    // The flag ADCB1 is not used as an interrupt: it triggers the DMA.
    InitDma();

    // Tell the FFT where its arrays are, then let it fill its table.
    hnd_rfft->FFTSize = RFFT_SIZE;
    hnd_rfft->FFTStages = RFFT_STAGES;
    hnd_rfft->InBuf = &fft_input[0];
    hnd_rfft->OutBuf = &fft_output[0];
    hnd_rfft->MagBuf = &pwrSpec[0];
    hnd_rfft->CosSinBuf = &RFFTF32Coef[0];
    RFFT_f32_sincostable(hnd_rfft);

    IER |= M_INT1;                       // Timer 0 is in group 1 ...
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;   // ... channel 7

    EINT;   // interrupts on

    while (1) {
        if ((pingFFT == 1) || (pongFFT == 1)) {
            // Copy the full buffer, as volts (4095 is 3.0 V).
            if (pingFFT == 1) {
                pingFFT = 0;
                for (i = 0; i < RFFT_SIZE; i++) {
                    fft_input[i] = AdcPingBufRaw[i]*3.0/4095.0;
                }
            } else {
                pongFFT = 0;
                for (i = 0; i < RFFT_SIZE; i++) {
                    fft_input[i] = AdcPongBufRaw[i]*3.0/4095.0;
                }
            }

            RFFT_f32(hnd_rfft);       // the FFT: fft_input to fft_output
            RFFT_f32_mag(hnd_rfft);   // fft_output to pwrSpec

            // The largest bin. Bins 0 to 4 are skipped: they hold the
            // steady 1.5 V the microphone signal sits on.
            maxpwr = 0;
            maxpwrindex = 0;
            for (i = 5; i < (RFFT_SIZE/2); i++) {
                if (pwrSpec[i] > maxpwr) {
                    maxpwr = pwrSpec[i];
                    maxpwrindex = i;
                }
            }
            numFFTs++;

            UART_printfLine(1, "Max Pwr %.3f", maxpwr);
            UART_printfLine(2, "Freq %.0f Hz", maxpwrindex*10000.0/1024.0);
        }
    }
}

// Every 10 ms: blink the red LED five times a second.
__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    if ((numTimer0calls % 10) == 0) {
        GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// Runs when the DMA starts a new buffer of 1024 samples: the other buffer
// is then full. It points the DMA's next round at that other buffer.
__interrupt void DMA_ISR(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP7;

    if (iPingPong == 0) {
        // Ping is being filled now; the round after it goes to pong.
        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)AdcPongBufRaw;
        EDIS;
        if (DMAcount > 0) {
            pongFFT = 1;   // pong was filled in the round that just ended
        }
        iPingPong = 1;
    } else {
        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)AdcPingBufRaw;
        EDIS;
        pingFFT = 1;
        iPingPong = 0;
    }
    DMAcount++;
}

// DMA channel 1: on every ADCB1 flag copy one word from the ADC result
// register to the buffer, 1024 times, then start again.
void InitDma(void)
{
    EALLOW;
    DmaRegs.DMACTRL.bit.HARDRESET = 1;   // reset the whole DMA
    __asm(" NOP");

    DmaRegs.CH1.MODE.bit.CHINTE = 1;       // interrupt DMA_CH1 enabled ...
    DmaRegs.CH1.MODE.bit.CHINTMODE = 0;    // ... at the start of each round
    DmaRegs.CH1.MODE.bit.DATASIZE = 0;     // 16-bit words
    DmaRegs.CH1.MODE.bit.CONTINUOUS = 1;   // start again after 1024 words
    DmaRegs.CH1.MODE.bit.ONESHOT = 0;      // one word per trigger
    DmaRegs.CH1.MODE.bit.PERINTE = 1;      // listen to the trigger
    DmaRegs.CH1.MODE.bit.PERINTSEL = 1;    // always the channel's own number

    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH1 = 6;   // the trigger: ADCB1 (source 6)

    DmaRegs.CH1.BURST_SIZE.bit.BURSTSIZE = 0;    // 0 means 1 word per trigger
    DmaRegs.CH1.TRANSFER_SIZE = RFFT_SIZE - 1;   // 1024 triggers per round

    DmaRegs.CH1.SRC_TRANSFER_STEP = 0;   // always read the same register
    DmaRegs.CH1.SRC_ADDR_SHADOW = (Uint32)&AdcbResultRegs.ADCRESULT0;
    DmaRegs.CH1.DST_TRANSFER_STEP = 1;   // write one element further each time
    DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)AdcPingBufRaw;

    DmaRegs.CH1.CONTROL.bit.PERINTCLR = 1;   // forget any old trigger
    DmaRegs.CH1.CONTROL.bit.ERRCLR = 1;
    DmaRegs.CH1.CONTROL.bit.RUN = 1;         // go
    EDIS;

    PieCtrlRegs.PIEIER7.bit.INTx1 = 1;   // DMA channel 1 is group 7, channel 1
    IER |= M_INT7;
}
`,
};
