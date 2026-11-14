import type { GlossaryEntry } from "../types";

// Terms of the printf levels in chapter 6 (serial_printf, printf, sprintf and UART_printfLine).
export const glossary: GlossaryEntry[] = [
  {
    term: "format string",
    meaning: "The first text given to printf or serial_printf: what to print, with a conversion such as %d at each place where a value goes. The values follow it in the same order.",
    level: "serial-fmt-brief",
  },
  {
    term: "conversion",
    meaning: "One placeholder in a format string, from the % to its letter, such as %d, %5.2f or %ld. It takes the next value of the list and says how to print it.",
    level: "serial-fmt-brief",
  },
  {
    term: "conversion specifier",
    meaning: "The letter that ends a conversion: d and u for whole numbers, x for hex, f for a float, c for one character, s for a string. It says how the bits of the value are read.",
    level: "serial-fmt-brief",
  },
  {
    term: "length modifier",
    meaning: "A letter in front of the conversion specifier that gives the size of the value. On this chip l (a small L) means 32 bits: %ld, %lu, %lx. Without it the value is 16 bits.",
    level: "serial-fmt-brief",
  },
  {
    term: "field width",
    meaning: "A number in a conversion, as in %6d: the least number of characters the value takes. Shorter values are filled with spaces. Longer ones are printed in full.",
    level: "serial-fmt-width",
  },
  {
    term: "flag",
    meaning: "A sign right after the % of a conversion that changes how the field is filled: - puts the value on the left, 0 fills with zeros, + always prints a sign.",
    level: "serial-fmt-width",
  },
  {
    term: "precision",
    meaning: "A point and a number in a conversion, as in %.2f. For a float it is the number of digits after the decimal point, for a string the most characters printed, for a whole number the least number of digits.",
    level: "serial-fmt-table",
  },
  {
    term: "LCD",
    meaning: "Liquid crystal display: the robot board's text screen with 2 lines of 20 characters. UART_printfLine(line, format, values) prints one line of it.",
    level: "serial-fmt-lcd",
  },
];
