// The Sandbox's "External interrupt" starting program for the homework red
// board: one push button, one interrupt. Written for this game.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "xint",
  label: "A push button raises an interrupt (XINT)",
  kit: "redboard",
  about:
    "Each press of PB1 runs an interrupt function that counts the press and changes the blue LED. The LED display shows the count as one hexadecimal digit and the terminal prints it: press PB1 a few times, then try POLARITY 1.",
  watch: ["presses", "shown"],
  source: String.raw`// One external interrupt on the homework red board.
// A push button pulls its pin low while it is held. XINT1 watches the pin of
// PB1 (GPIO4): when the pin falls, the chip stops what it is doing and runs
// xint1_isr(). main() never reads the button.

__interrupt void xint1_isr(void);

// Changed in the interrupt function and read in main(), so volatile.
volatile uint32_t presses = 0;
uint32_t shown = 0;   // the count main() has already shown

// The 15 LEDs of the display, LED1 to LED15.
uint16_t ledPins[15] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159};

void main(void)
{
    uint16_t i = 0;

    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Blue LED on the LaunchPad: an output, off (it lights when its pin is 0).
    GPIO_SetupPinMux(31, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(31, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO31 = 1;

    // The LEDs of the display: outputs, off.
    for (i = 0; i < 15; i++) {
        GPIO_SetupPinMux(ledPins[i], GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(ledPins[i], GPIO_OUTPUT, GPIO_PUSHPULL);
        GPIO_WritePin(ledPins[i], 0);
    }

    // PB1 on GPIO4: an input with the pull-up resistor, so it reads 1 until pressed.
    GPIO_SetupPinMux(4, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(4, GPIO_INPUT, GPIO_PULLUP);

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // Tell the chip which function runs for XINT1.
    EALLOW;
    PieVectTable.XINT1_INT = &xint1_isr;
    EDIS;

    init_serialSCIA(&SerialA, 115200);   // the terminal

    GPIO_SetupXINT1Gpio(4);              // GPIO4 is what XINT1 watches
    XintRegs.XINT1CR.bit.POLARITY = 0;   // 0: falling edge (press). 1: rising edge (release)
    XintRegs.XINT1CR.bit.ENABLE = 1;

    // XINT1 is channel 4 of PIE group 1, and group 1 goes to CPU interrupt INT1.
    PieCtrlRegs.PIEIER1.bit.INTx4 = 1;
    IER |= M_INT1;
    IER |= M_INT9;   // SCIA, the terminal

    EINT;   // interrupts on

    displayLEDletter(0);

    while (1) {
        if (shown != presses) {
            shown = presses;
            displayLEDletter(shown);   // the low four bits, as 0 to F
            // %ld prints a 32-bit integer.
            serial_printf(&SerialA, "PB1 pressed %ld times\r\n", shown);
        }
    }
}

// PB1 was pressed.
__interrupt void xint1_isr(void)
{
    presses++;
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;    // change the blue LED
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;   // let PIE group 1 send its next interrupt
}
`,
};
