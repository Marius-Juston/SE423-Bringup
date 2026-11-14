// The Sandbox's "FFT" starting program for the robot board: record a short
// piece of the microphone signal and show its strongest frequency, with the
// library's FFT. Written for this game. It samples by asking for one
// conversion at a time from main(): no trigger, no ADC interrupt and no DMA,
// which are what Lab 4 and the levels on the ADC and the DMA have the
// student set up.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "fft",
  label: "Strongest frequency at the microphone (FFT)",
  kit: "robot",
  about:
    "The program records 512 samples of the microphone, takes their FFT and shows the strongest frequency on the LCD, about four times a second: move the knob \"Tone at the microphone\" and watch Freq follow it, then go above 5000 Hz.",
  watch: ["peakBin", "peakSize", "numFFTs"],
  source: String.raw`// The strongest frequency at the microphone.
// Again and again:
//   1. record 512 samples of the microphone, one every 0.1 ms
//   2. RFFT_f32() and RFFT_f32_mag() of the library turn the samples into
//      "bins": bin k says how much of the frequency k * 10000 / 512 Hz is
//      in the signal
//   3. find the largest bin and print its frequency on the LCD
// 10000 samples a second can only tell frequencies up to 5000 Hz apart.

#define FFT_STAGES 9
#define FFT_SIZE (1 << FFT_STAGES)   // 2 to the power 9: 512 samples

float samples[FFT_SIZE];             // the recording, in volts
float fftOut[FFT_SIZE];              // the FFT's own result
float bins[(FFT_SIZE/2) + 1];        // size of each frequency, bins 0 to 256
float fftTable[FFT_SIZE];            // sines and cosines the FFT needs

RFFT_F32_STRUCT rfft;                // tells the FFT where its arrays are

float peakSize = 0;
int16_t peakBin = 0;
uint32_t numFFTs = 0;
int16_t i = 0;

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // The library's functions for the serial port of the LCD.
    EALLOW;
    PieVectTable.SCIB_RX_INT = &RXBINT_recv_ready;
    PieVectTable.SCIB_TX_INT = &TXBINT_data_sent;
    EDIS;
    init_serialSCIB(&SerialB, 19200);
    IER |= M_INT9;

    // The library switches the ADCs on. The microphone is on input 4 of ADCB.
    init_ADCsAndDACs();
    EALLOW;
    AdcbRegs.ADCSOC0CTL.bit.CHSEL = 4;    // conversion 0 measures input 4
    AdcbRegs.ADCSOC0CTL.bit.ACQPS = 99;   // and looks at it for 100 clock cycles
    EDIS;

    // Tell the FFT where its arrays are, then let it fill its table.
    rfft.FFTSize = FFT_SIZE;
    rfft.FFTStages = FFT_STAGES;
    rfft.InBuf = &samples[0];
    rfft.OutBuf = &fftOut[0];
    rfft.MagBuf = &bins[0];
    rfft.CosSinBuf = &fftTable[0];
    RFFT_f32_sincostable(&rfft);

    EINT;   // interrupts on

    while (1) {
        // 1. Record. The ADC result is 0 to 4095 for 0 to 3 V.
        for (i = 0; i < FFT_SIZE; i++) {
            AdcbRegs.ADCSOCFRC1.bit.SOC0 = 1;   // start one conversion
            DELAY_US(100);                      // 0.1 ms: it is long finished
            samples[i] = AdcbResultRegs.ADCRESULT0*3.0/4095.0;
        }

        // 2. The FFT: samples to fftOut, then fftOut to bins.
        RFFT_f32(&rfft);
        RFFT_f32_mag(&rfft);

        // 3. The largest bin. Bins 0 and 1 are skipped: they hold the
        // steady 1.5 V the microphone signal sits on.
        peakSize = 0;
        peakBin = 0;
        for (i = 2; i < (FFT_SIZE/2); i++) {
            if (bins[i] > peakSize) {
                peakSize = bins[i];
                peakBin = i;
            }
        }
        numFFTs++;

        // %.0f prints a float with no decimals.
        UART_printfLine(1, "Size %.1f", peakSize);
        UART_printfLine(2, "Freq %.0f Hz", peakBin*10000.0/FFT_SIZE);

        DELAY_US(200000);   // a pause, so the LCD can be read
    }
}
`,
};
