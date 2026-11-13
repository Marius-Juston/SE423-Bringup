/** SYSCLK period: 200 MHz. */
export const SYSCLK_NS = 5;
export const SYSCLK_HZ = 200_000_000;
/** Low-speed peripheral clock (SCI, SPI): SYSCLK / 4. */
export const LSPCLK_HZ = 50_000_000;
/** ePWM clock: SYSCLK / 2 (EPWMCLKDIV = 1, the reset default). */
export const EPWMCLK_HZ = 100_000_000;
