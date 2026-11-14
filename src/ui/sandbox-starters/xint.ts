// The Sandbox's "External interrupts" starting program for the homework red
// board. Written for this game, with the structure of the course's XINT
// starter project: PB1 and PB2 each cause an external interrupt.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "xint",
  label: "External interrupts (XINT starter)",
  kit: "redboard",
  about:
    "PB1 and PB2 each run an interrupt function that counts the presses, the terminal prints both counts and the LED display counts in hexadecimal: press the buttons, then try another edge with POLARITY.",
  watch: ["Xint1Count", "Xint2Count", "numTimer0calls", "LEDdisplaynum"],
  source: String.raw`// External interrupts on the homework red board.
// A push button pulls its pin low. XINT1 watches PB1 (GPIO4) and XINT2 watches
// PB2 (GPIO5): each falling edge runs an interrupt function that counts it.
// CPU Timer 0 blinks the red LED, asks for a print and steps the LED display.

#define LAUNCHPAD_CPU_FREQUENCY 200

__interrupt void cpu_timer0_isr(void);
__interrupt void xint1_isr(void);
__interrupt void xint2_isr(void);

// Changed inside interrupt functions and read in main(), so volatile.
volatile uint32_t Xint1Count = 0;
volatile uint32_t Xint2Count = 0;

uint32_t numTimer0calls = 0;
uint16_t UARTPrint = 0;       // set by the timer, cleared by main() after it printed
uint16_t LEDdisplaynum = 0;   // the digit the LED display shows next

// The 15 LEDs of the display, LED1 to LED15, plus LED16.
uint16_t ledPins[16] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159, 160};

// One bit per push button that is held down: PB1 is bit 0, PB4 is bit 3.
uint16_t readbuttons(void)
{
    uint16_t returnvalue = 0;

    if (GpioDataRegs.GPADAT.bit.GPIO4 == 0) {
        returnvalue |= 1;
    }
    if (GpioDataRegs.GPADAT.bit.GPIO5 == 0) {
        returnvalue |= 2;
    }
    if (GpioDataRegs.GPADAT.bit.GPIO6 == 0) {
        returnvalue |= 4;
    }
    if (GpioDataRegs.GPADAT.bit.GPIO7 == 0) {
        returnvalue |= 8;
    }
    return returnvalue;
}

void main(void)
{
    uint16_t i = 0;

    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Red LED on the LaunchPad (it lights when the pin is low).
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
    PieVectTable.XINT1_INT = &xint1_isr;
    PieVectTable.XINT2_INT = &xint2_isr;
    EDIS;

    // CPU Timer 0 every 10 ms (the period is in microseconds).
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 10000);
    CpuTimer0Regs.TCR.all = 0x4000;   // start it with its interrupt enabled

    init_serialSCIA(&SerialA, 115200);

    // A real button bounces: the pin must hold its level for 6 samples
    // before the chip believes it. QUALPRD0 sets how far apart the samples are.
    EALLOW;
    GpioCtrlRegs.GPAQSEL1.bit.GPIO4 = 2;
    GpioCtrlRegs.GPAQSEL1.bit.GPIO5 = 2;
    GpioCtrlRegs.GPACTRL.bit.QUALPRD0 = 0xFF;
    EDIS;

    // GPIO4 is the source of XINT1, GPIO5 of XINT2.
    GPIO_SetupXINT1Gpio(4);
    GPIO_SetupXINT2Gpio(5);

    // POLARITY 0: falling edge (button pressed). 1: rising edge. 3: both.
    XintRegs.XINT1CR.bit.POLARITY = 0;
    XintRegs.XINT2CR.bit.POLARITY = 0;
    XintRegs.XINT1CR.bit.ENABLE = 1;
    XintRegs.XINT2CR.bit.ENABLE = 1;

    // XINT1, XINT2 and Timer 0 are channels 4, 5 and 7 of PIE group 1,
    // and group 1 goes to CPU interrupt INT1.
    PieCtrlRegs.PIEIER1.bit.INTx4 = 1;
    PieCtrlRegs.PIEIER1.bit.INTx5 = 1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    IER |= M_INT1;
    IER |= M_INT9;   // SCIA, the terminal

    EINT;   // interrupts on

    while (1) {
        if (UARTPrint == 1) {
            // %ld prints a 32-bit integer.
            serial_printf(&SerialA, "NumXInt1=%ld,NumXInt2=%ld\r\n", Xint1Count, Xint2Count);
            UARTPrint = 0;
        }
    }
}

// Every 10 ms.
__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;

    // Every 10th call: every 100 ms.
    if ((numTimer0calls % 10) == 0) {
        UARTPrint = 1;
        GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;   // blink the red LED

        if (readbuttons() == 0) {
            // No button held: count 0 to F on the LED display.
            displayLEDletter(LEDdisplaynum);
            LEDdisplaynum++;
        } else {
            // Show which buttons are held, as one hexadecimal digit.
            displayLEDletter(readbuttons());
        }
    }

    // Let PIE group 1 send its next interrupt.
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// PB1 was pressed.
__interrupt void xint1_isr(void)
{
    Xint1Count++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// PB2 was pressed.
__interrupt void xint2_isr(void)
{
    Xint2Count++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
};
