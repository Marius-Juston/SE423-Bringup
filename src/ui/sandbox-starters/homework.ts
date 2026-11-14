// The Sandbox's "Homework starter" starting program for the homework red
// board. Written for this game, with the structure of the course's homework
// starter project: three CPU timers, the terminal and the LED display.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "homework",
  label: "Homework starter (timers, terminal, LED display)",
  kit: "redboard",
  about:
    "Three CPU timers run interrupt functions: the LEDs blink, the LED display counts in hexadecimal every 2.5 s and the terminal prints two counts every 2 s. Type into the terminal and watch the second count, then change a timer period.",
  watch: ["numTimer0calls", "LEDdisplaynum", "numRXA", "UARTPrint"],
  source: String.raw`// Homework starter for the red board.
// Three CPU timers each run an interrupt function:
//   Timer 0, every 10 ms: toggles the red LED and, every 2.5 s, shows the
//                         next hexadecimal digit on the LED display
//   Timer 1, every 20 ms: only counts
//   Timer 2, every 40 ms: toggles the blue LED and asks for a print every 2 s
// main() prints when asked. Printing is slow, so it never happens inside an
// interrupt function: the function sets a flag and main() does the work.

#define LAUNCHPAD_CPU_FREQUENCY 200

__interrupt void cpu_timer0_isr(void);
__interrupt void cpu_timer1_isr(void);
__interrupt void cpu_timer2_isr(void);

uint32_t numTimer0calls = 0;
uint16_t UARTPrint = 0;       // set by Timer 2, cleared by main() after it printed
uint16_t LEDdisplaynum = 0;   // the digit the LED display shows next

// The 15 LEDs of the display, LED1 to LED15, plus LED16.
uint16_t ledPins[16] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159, 160};

void main(void)
{
    uint16_t i = 0;

    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Blue and red LED on the LaunchPad (they light when the pin is low).
    GPIO_SetupPinMux(31, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(31, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO31 = 1;
    GPIO_SetupPinMux(34, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(34, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;

    // The 16 LEDs of the red board: outputs, off.
    for (i = 0; i < 16; i++) {
        GPIO_SetupPinMux(ledPins[i], GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(ledPins[i], GPIO_OUTPUT, GPIO_PUSHPULL);
        GPIO_WritePin(ledPins[i], 0);
    }

    // Push buttons 1 to 4 on GPIO4 to GPIO7: inputs with the pull-up resistor.
    // A held button reads 0 on its pin.
    for (i = 4; i <= 7; i++) {
        GPIO_SetupPinMux(i, GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(i, GPIO_INPUT, GPIO_PULLUP);
    }

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // Tell the chip which function runs for which interrupt.
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.TIMER2_INT = &cpu_timer2_isr;
    // The board's library receives and sends the terminal's characters.
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;
    PieVectTable.SCIA_TX_INT = &TXAINT_data_sent;
    EDIS;

    // The three timers. The period is in microseconds.
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 10000);
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 20000);
    ConfigCpuTimer(&CpuTimer2, LAUNCHPAD_CPU_FREQUENCY, 40000);
    // Start each one with its interrupt enabled.
    CpuTimer0Regs.TCR.all = 0x4000;
    CpuTimer1Regs.TCR.all = 0x4000;
    CpuTimer2Regs.TCR.all = 0x4000;

    init_serialSCIA(&SerialA, 115200);

    // Timer 0 comes through PIE group 1 (channel 7) to CPU interrupt INT1.
    // Timer 1 is INT13 and Timer 2 is INT14, straight to the CPU.
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    IER |= M_INT1;
    IER |= M_INT9;    // SCIA, the terminal
    IER |= M_INT13;
    IER |= M_INT14;

    EINT;   // interrupts on

    while (1) {
        if (UARTPrint == 1) {
            // %ld prints a 32-bit integer. numRXA counts the characters you typed.
            serial_printf(&SerialA, "Num Timer2:%ld Num SerialRX: %ld\r\n",
                          CpuTimer2.InterruptCount, numRXA);
            UARTPrint = 0;
        }
    }
}

// Every 10 ms.
__interrupt void cpu_timer0_isr(void)
{
    CpuTimer0.InterruptCount++;
    numTimer0calls++;

    // Every 250th call: every 2.5 s.
    if ((numTimer0calls % 250) == 0) {
        displayLEDletter(LEDdisplaynum);   // shows the low four bits as 0 to F
        LEDdisplaynum++;
    }

    GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;   // red LED

    // Let PIE group 1 send its next interrupt.
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// Every 20 ms. Nothing to acknowledge: INT13 does not come through the PIE.
__interrupt void cpu_timer1_isr(void)
{
    CpuTimer1.InterruptCount++;
}

// Every 40 ms.
__interrupt void cpu_timer2_isr(void)
{
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;   // blue LED

    CpuTimer2.InterruptCount++;

    // Every 50th call: every 2 s.
    if ((CpuTimer2.InterruptCount % 50) == 0) {
        UARTPrint = 1;
    }
}
`,
};
