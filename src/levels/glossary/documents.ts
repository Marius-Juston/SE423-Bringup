import type { GlossaryEntry } from "../types";

// The documents the course sends you to, and the notation on their pages.
// "Data sheet", "Register map" and "Reset value" are in analog.ts and
// buses.ts already.
export const glossary: GlossaryEntry[] = [
  {
    term: "Technical Reference Manual (TRM)",
    meaning: "The book that describes how every peripheral of the chip works and every bit of every register. You do not read it through: you look up the page you need. The course's condensed references are chapters of it.",
    level: "reg-page",
  },
  {
    term: "register page",
    meaning: "The manual's description of one register: a picture of its bits with the field names, and a table with one row per field (Bit, Field, Type, Reset, Description).",
    level: "reg-page",
  },
  {
    term: "access type (the Type column)",
    meaning: "What your program may do with a field. R is read only, R/W is read and write, R/W1C is read and write 1 to clear, R-0 always reads 0.",
    level: "reg-page",
  },
  { term: "R/W field", meaning: "A field you can read and write. It keeps the value you write, and reading gives it back.", level: "reg-page" },
  {
    term: "W1C (write 1 to clear)",
    meaning: "A flag the hardware sets to 1. Writing 1 to it puts it back to 0, and writing 0 does nothing. Most interrupt flags work this way.",
    level: "reg-page",
  },
  {
    term: "reserved bit",
    meaning: "A bit of a register the chip keeps for itself. It has no field name. Leave it as it is: writing fields with .bit never touches it.",
    level: "reg-page",
  },
  {
    term: "write protection",
    meaning: "A column in the manual's list of a peripheral's registers. EALLOW there means a write only counts between EALLOW; and EDIS;.",
    level: "reg-page",
  },
  {
    term: "PIE channel map (Table 3-2)",
    meaning: "The manual's table of every peripheral interrupt. The row is the group and the column the channel, and from those two numbers come the PIEIER bit, the IER mask and the PIEACK constant.",
    level: "int-table",
  },
  {
    term: "interrupt vector",
    meaning: "One entry of the vector table: the address of the function the CPU runs for one interrupt. Its name is the name in the PIE channel map plus _INT, for example TIMER0_INT.",
    level: "int-table",
  },
  {
    term: "pin mux table",
    meaning: "The course's table of what each pin of the LaunchPad can be. The row is the pin, the column the mux index, and the cell the signal the pin carries at that index.",
    level: "pwm-pinmux",
  },
  {
    term: "mux index (mux position)",
    meaning: "The number from 0 to 15 that selects what a pin is connected to. 0 is plain GPIO. It is the last argument of GPIO_SetupPinMux, which stores its upper two bits in GPyGMUX and its lower two in GPyMUX.",
    level: "pwm-pinmux",
  },
  {
    term: "trigger table (TRIGSEL)",
    meaning: "The list on the manual's page of ADCSOC0CTL that gives the number of every source that can start a conversion. The numbers are in hexadecimal.",
    level: "adc-trigger-table",
  },
];
