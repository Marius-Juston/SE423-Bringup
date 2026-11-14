// The Sandbox's first starting program, offered on every board: the blue
// LED of the LaunchPad blinks. It is not listed with the others (it has no
// board of its own), so it exports its text only.
export const BLINK_SOURCE = String.raw`// Free play: nothing is checked here.
// The blue LED of the LaunchPad changes every 250 ms. Try another pause,
// or start again from an empty main().

uint32_t blinks = 0;   // how many times the LED has changed

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();

    // GPIO31 is the blue LED: a plain output pin.
    GPIO_SetupPinMux(31, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(31, GPIO_OUTPUT, GPIO_PUSHPULL);

    while (1) {
        GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;   // change the LED
        blinks++;
        DELAY_US(250000);                        // wait 250 ms
    }
}
`;

export const BLINK_WATCH = ["blinks"];
