// The LED letter functions of the homework starter projects (HWstarter,
// XINTstarter: LEDPatterns.h declares setLEDLetter and displayLEDletter).
//
// The homework red board has 16 LEDs. The first 15 form a display 3 wide
// and 5 high, numbered down the columns:
//   LED1  LED6  LED11        GPIO22   GPIO130  GPIO60
//   LED2  LED7  LED12        GPIO94   GPIO131  GPIO61
//   LED3  LED8  LED13        GPIO95   GPIO25   GPIO157
//   LED4  LED9  LED14        GPIO97   GPIO26   GPIO158
//   LED5  LED10 LED15        GPIO111  GPIO27   GPIO159
// displayLEDletter(n) shows the hexadecimal digit of the low four bits of n.
// setLEDLetter(p) lights LED i+1 when p[i] is not 0, for i = 0 to 14.
//
// Written for this game (C in the prelude, so the pins change through the
// GPIO data registers exactly as a student's own code would change them):
// the course's file is not copied. The digits are the usual 3 x 5 ones and
// light the same LEDs as on the board.
// Not modelled: nothing. The pins must be outputs already (the starters set
// them up in main), as on the board.

import type { SimPlugin } from "../plugin";

/** The 16 digits, five rows of three, top row first ('#' is a lit LED). */
export const LED_DIGITS: string[] = [
  "### #.# #.# #.# ###", // 0
  ".#. ##. .#. .#. ###", // 1
  "### ..# ### #.. ###", // 2
  "### ..# ### ..# ###", // 3
  "#.# #.# ### ..# ..#", // 4
  "### #.. ### ..# ###", // 5
  "### #.. ### #.# ###", // 6
  "### ..# ..# ..# ..#", // 7
  "### #.# ### #.# ###", // 8
  "### #.# ### ..# ###", // 9
  "### #.# ### #.# #.#", // A
  "##. #.# ##. #.# ##.", // b
  "### #.. #.. #.. ###", // C
  "##. #.# #.# #.# ##.", // d
  "### #.. ### #.. ###", // E
  "### #.. ### #.. #..", // F
];

/** Pins of LED1 to LED15, in the order setLEDLetter reads its array. */
export const LED_LETTER_PINS = [22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159];

/** Bit i is 1 when LED i+1 is lit for this digit (columns first, as the LEDs are numbered). */
export function ledMask(digit: number): number {
  const rows = LED_DIGITS[digit & 0xf].split(" ");
  let mask = 0;
  for (let col = 0; col < 3; col++) for (let row = 0; row < 5; row++) if (rows[row][col] === "#") mask |= 1 << (col * 5 + row);
  return mask;
}

export const plugin: SimPlugin = {
  name: "course_leds",
  prelude: `
Uint16 __led_letter_pins[15] = {${LED_LETTER_PINS.join(", ")}};
Uint16 __led_letter_masks[16] = {${Array.from({ length: 16 }, (_, d) => `0x${ledMask(d).toString(16)}`).join(", ")}};
void setLEDLetter(uint16_t *letter)
{
    Uint16 i;
    for (i = 0; i < 15; i++) {
        GPIO_WritePin(__led_letter_pins[i], letter[i] != 0);
    }
}
void displayLEDletter(uint16_t num)
{
    Uint16 i;
    Uint16 mask = __led_letter_masks[num & 0xF];
    for (i = 0; i < 15; i++) {
        GPIO_WritePin(__led_letter_pins[i], (mask >> i) & 1);
    }
}
`,
};
