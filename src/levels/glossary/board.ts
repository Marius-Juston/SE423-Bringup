import type { GlossaryEntry } from "../types";

// Terms first taught in primer D (the homework board).
// `level` is the level that explains the term.
export const glossary: GlossaryEntry[] = [
  { term: "breakout board", meaning: "The board you solder in the homeworks. It has places for LEDs, buttons, a buzzer and more, and the LaunchPad plugs into its middle.", level: "brd-tour" },
  { term: "header", meaning: "A row of metal pins, or of sockets for pins. The LaunchPad's 80 pins sit in four double headers, J1 to J8.", level: "brd-tour" },
  { term: "trace", meaning: "A thin line of copper on a board that joins two points, for example a part and its pin.", level: "brd-follow" },
  { term: "inverter", meaning: "A small part of a chip whose output is the opposite of its input, and which can carry more current than a pin. On the homework board one sits between each pin and its LED, so the LED is on when the pin is high.", level: "brd-follow" },
  { term: "jumper", meaning: "A removable cap that joins two neighbouring pins. It is a connection you can move, take off, or forget.", level: "brd-jumpers" },
];
