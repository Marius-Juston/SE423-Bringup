// Interactive figures a brief can embed with a line of its own:
//   {{figure:gpio-pin}}
// The components live in src/ui/figures/.
export const FIGURES = ["gpio-pin", "adc-chain", "spi-modes"] as const;
export type FigureId = (typeof FIGURES)[number];
