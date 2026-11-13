import type { Chapter } from "../types";

const SERIAL_SETUP = `    InitSysCtrl();
    InitGpio();
    init_serialSCIA(&SerialA, 115200);`;

export const ch00: Chapter = {
  id: "bits",
  number: 0,
  title: "Bits and numbers",
  blurb: "Hex, binary, masks and the 16-bit surprises of this chip.",
  requires: [],
  course: ["L2", "L4", "Lab 2", "HW1"],
  levels: [
    {
      id: "bits-first-light",
      kind: "code",
      mode: "complete",
      title: "First light",
      goal: "Change one character of a finished program so that LED1 lights.",
      refs: [{ course: "Lab 1" }, { course: "L3" }],
      brief: `
Every level works the same way. Read the short text on this side. Try things with **Run** and watch the board. Press **Run tests** to check your work, and open a **hint** if you are stuck.

This program is complete. It starts the chip and gets one LED ready. You do not need to understand those lines yet: chapters 1 and 2 teach them.

One line decides if **LED1** lights. It writes a number to a piece of the chip's hardware. A **1** switches the LED on. Right now the program writes a **0**, which does nothing.

Change the 0 to a 1. Press **Run** and look at LED1 on the board, then press **Run tests**.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
    // Start the chip (chapters 1 and 2 explain these lines)
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);

    // LED1: a 1 switches it on. Change the 0 to a 1.
    GpioDataRegs.GPASET.bit.GPIO22 = 0;

    while (1) {}
}
`,
      solution: `void main(void)
{
    // Start the chip (chapters 1 and 2 explain these lines)
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);

    // LED1: a 1 switches it on. Change the 0 to a 1.
    GpioDataRegs.GPASET.bit.GPIO22 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on", hint: "Find the line that ends in `= 0;` and make it `= 1;`." },
      ],
      hints: [
        "Only one line needs to change, and only one character in it.",
        "It is the line under the comment that starts with LED1.",
        "`GpioDataRegs.GPASET.bit.GPIO22 = 1;`",
      ],
      takeaway: "You just wrote a 1 into a register, and a pin of the chip went to 3.3 V. The rest of this chapter is about the numbers you write. Chapters 1 and 2 are about where you write them.",
    },
    {
      id: "bits-brief",
      kind: "brief",
      title: "Why bits matter here",
      goal: "Learn to read numbers written in binary and in hex, then answer three questions.",
      refs: [{ course: "L2" }, { course: "L4" }],
      brief: `
A **bit** is one binary digit: a 0 or a 1. Inside the chip a bit is one memory cell that is either low (0) or high (1). Chapter C showed that a **register** is a variable at a fixed address whose bits are wired to the chip's hardware: one bit turns an LED on, three bits pick a speed. To set the right bits you must read numbers the way the chip stores them.

## Binary: each place is worth double
In decimal each place is worth ten times the one to its right: 1, 10, 100. In **binary** each place is worth two times the one to its right: 1, 2, 4, 8, 16 and so on. The places are numbered from 0 on the right. **Bit n** is worth 2 multiplied by itself n times, written 2^n: bit 0 is worth 1, bit 3 is worth 8, bit 5 is worth 32.

To read a binary number, add the worth of every place that holds a 1: \`1010\` is 8 + 2 = 10, and \`0101\` is 4 + 1 = 5.

## Hex: one digit for four bits
Sixteen bits in a row are hard to read, so programmers group them in fours. Four bits hold 0 to 15, and **hex** (hexadecimal) has one digit for each of those values: 0 to 9, then A, B, C, D, E, F for ten to fifteen. In C a hex number starts with \`0x\`.

So \`0xA5\` is the digit A (ten, \`1010\`) followed by the digit 5 (\`0101\`): \`1010 0101\`, which is 128 + 32 + 4 + 1 = 165.

{{figure:bit-explorer}}

Try it in the figure: click bits and watch each hex digit follow its own four bits, and the decimal value add up from the weights (what each bit is worth).
`,
      questions: [
        {
          prompt: "What is binary `0000 1101` in decimal?",
          options: ["11", "13", "14", "25"],
          answer: 1,
          why: "The 1s are in bits 3, 2 and 0: 8 + 4 + 1 = 13. In hex that is the single digit D.",
        },
        {
          prompt: "What is `0x20` in binary (8 bits)?",
          options: ["`0010 0000`", "`0000 0010`", "`0001 0100`", "`0010 0010`"],
          answer: 0,
          why: "Hex 2 is 0010 and hex 0 is 0000. Only bit 5 is set, and bit 5 is worth 32.",
        },
        {
          prompt: "Which bit is set in `0x0400`?",
          options: ["Bit 4", "Bit 8", "Bit 10", "Bit 12"],
          answer: 2,
          why: "Each hex digit covers four bits: from the right, bits 3 to 0, 7 to 4, 11 to 8, 15 to 12. The digit 4 (0100) sits in bits 11 to 8, and its single 1 is the third bit of that group: bit 10, worth 1024.",
        },
      ],
      takeaway: "Bit n is worth 2^n. One hex digit is 4 bits, so translate hex to binary one digit at a time.",
    },
    {
      id: "bits-a5",
      kind: "register",
      title: "Light the bits of 0x00A5",
      goal: "Switch bits on until the value reads 0x00A5.",
      refs: [{ course: "L2" }, { course: "HW1" }],
      brief: `
Click a bit to flip it. The hex and decimal readouts update as you go.

This is a 16-bit value: bit 15 on the left, bit 0 on the right, in four groups of four bits. Each group is one hex digit.

Split the hex number into digits first: \`0x00A5\` is the digits 0, 0, A, 5. Then build each digit from the worths 8, 4, 2, 1: A is ten, which is 8 + 2. 5 is 4 + 1.
`,
      custom: { bits: 16 },
      initial: 0,
      value: 0x00a5,
      hints: [
        "Work one hex digit at a time, from the right. The rightmost digit, 5, uses bits 3 to 0.",
        "5 is 0101, so bits 2 and 0. A (ten) is 1010, in bits 7 to 4: that is bits 7 and 5.",
        "Turn on bits 7, 5, 2 and 0.",
      ],
      takeaway: "0x00A5 = 1010 0101 = 128 + 32 + 4 + 1 = 165. Reading hex digit by digit is faster than converting through decimal.",
    },
    {
      id: "bits-ops",
      kind: "calc",
      title: "The bit operators",
      goal: "Work out by hand what OR, AND, XOR, NOT and the two shifts do to a number.",
      refs: [{ course: "L2" }, { course: "HW1" }],
      brief: `
C has operators that work on each bit of a number separately. Write the two numbers in binary, one above the other, and look at one column at a time:

- \`a | b\` (**OR**): the result bit is 1 if it is 1 in \`a\` or in \`b\` (or in both).
- \`a & b\` (**AND**): the result bit is 1 only if it is 1 in both.
- \`a ^ b\` (**XOR**): the result bit is 1 if the two bits differ.
- \`~a\` (**NOT**): every bit is flipped.

Worked example with \`0xC\` (1100) and \`0xA\` (1010):

\`\`\`c
  1100        1100        1100
| 1010      & 1010      ^ 1010
= 1110      = 1000      = 0110
  (0xE)       (0x8)       (0x6)
\`\`\`

NOT flips all 16 bits of a 16-bit value: \`~0x00F0\` is \`0xFF0F\`.

## Shifts
\`a << n\` moves every bit n places to the left. Zeros come in on the right, and bits pushed off the top are lost. \`a >> n\` moves every bit n places to the right.

- \`1 << 3\` is binary \`1000\`: 8.
- \`0x0F00 >> 8\` is \`0x000F\`. A shift by 4 moves the number by one hex digit.

These are not the \`&&\`, \`||\` and \`!\` of chapter B. Those treat a whole number as true or false. The bit operators work on every bit.

Answers may be typed in hex (\`0x...\`) or in decimal.
`,
      fields: [
        { id: "or", label: "0x0F | 0x30", format: "hex", answer: 0x3f, why: "0000 1111 OR 0011 0000 = 0011 1111. Every bit that is 1 in either number is 1." },
        { id: "and", label: "0x3C & 0x0F", format: "hex", answer: 0x0c, why: "0011 1100 AND 0000 1111 = 0000 1100. Only bits 3 and 2 are 1 in both." },
        { id: "xor", label: "0xFF ^ 0x0F", format: "hex", answer: 0xf0, why: "1111 1111 XOR 0000 1111 = 1111 0000. The low four bits are equal, so they give 0." },
        { id: "shl", label: "1 << 5", format: "hex", answer: 0x20, why: "A single 1 moved five places left is bit 5: 0010 0000 = 0x20 = 32." },
        { id: "shr", label: "0x0A50 >> 4", format: "hex", answer: 0xa5, why: "Four places right is one hex digit: the last digit falls off, and 0x0A50 becomes 0x00A5." },
        { id: "not", label: "~0x00FF, as a 16-bit value", format: "hex", answer: 0xff00, why: "Every 0 becomes 1 and every 1 becomes 0: 0000 0000 1111 1111 becomes 1111 1111 0000 0000." },
      ],
      hints: [
        "Write both numbers in binary first: each hex digit is four bits.",
        "Do one column at a time, as in the worked example, then turn each group of four bits back into a hex digit.",
        "0x0F is 0000 1111 and 0x30 is 0011 0000. OR them column by column: 0011 1111, which is 0x3F. The others work the same way.",
      ],
      takeaway: "OR, AND, XOR and NOT work column by column on the bits. A shift slides the whole pattern left or right, and a shift by 4 is one hex digit.",
    },
    {
      id: "bits-mask",
      kind: "register",
      title: "Set one bit, clear another",
      goal: "Starting from 0x00A5, apply `v |= (1 << 9);` and then `v &= ~0x0004;` by hand.",
      refs: [{ course: "L2" }, { course: "Lab 2" }],
      brief: `
A register holds many settings side by side. To change one of them you must change its bits and leave all the others alone. The bit operators do that with a **mask**: a number whose 1 bits mark the bits you want to work on. \`1 << n\` is a mask with a single 1 in position n.

## The four mask moves
- **set** the marked bits (make them 1): \`x = x | mask;\`
- **clear** them (make them 0): \`x = x & ~mask;\`
- **toggle** them (flip them): \`x = x ^ mask;\`
- **test** them: \`if (x & mask)\` is true when a marked bit is 1

C has a short form, like the \`+=\` of chapter B: \`x |= mask;\` means \`x = x | mask;\`. In the same way \`x &= ~mask;\` clears and \`x ^= mask;\` toggles.

Worked example with \`x = 0x0F\` (0000 1111):

- \`x |= (1 << 5);\` gives 0010 1111 = \`0x2F\`. OR with 0 keeps a bit, OR with 1 makes it 1.
- \`x &= ~0x01;\` gives 0000 1110 = \`0x0E\`. \`~0x01\` is all ones except bit 0. AND with 1 keeps a bit, AND with 0 makes it 0.

{{figure:mask-ops}}

Try it in the figure: pick an operation, click bits of the mask, and see which bits of \`x\` change and which C statement does it.

## Your task
Two C statements change a 16-bit variable \`v\` that starts at \`0x00A5\`:

\`\`\`c
v |= (1 << 9);    // set bit 9
v &= ~0x0004;     // clear the bit that 0x0004 names
\`\`\`

Make the bits show what \`v\` holds afterwards. Every bit that the two lines do not mention must stay as it is.
`,
      custom: { bits: 16 },
      initial: 0x00a5,
      value: 0x02a1,
      hints: [
        "`1 << 9` is a single 1 in bit 9. OR turns that bit on and changes nothing else.",
        "`0x0004` is bit 2. `~0x0004` is every bit except bit 2, so the AND clears only bit 2.",
        "Turn bit 9 on and bit 2 off. The result is 0x02A1.",
      ],
      takeaway: "OR sets, AND with the inverted mask clears, XOR toggles, AND tests. This is how one bit of a register is changed without disturbing its neighbours.",
    },
    {
      id: "bits-mask-c",
      kind: "code",
      mode: "complete",
      title: "The mask moves in C",
      goal: "Finish three one-line functions that set, clear and test bit n of a value.",
      refs: [{ course: "L2" }, { course: "Lab 2" }],
      brief: `
Now write the mask moves yourself. Each function gets a 16-bit value \`v\` and a bit number \`n\`:

- \`setBit(v, n)\` returns \`v\` with bit n made 1.
- \`clearBit(v, n)\` returns \`v\` with bit n made 0.
- \`isSet(v, n)\` returns 1 if bit n of \`v\` is 1, and 0 if it is not.

The mask for bit n is \`1 << n\`. Example: \`setBit(0x00A5, 9)\` must return \`0x02A5\`, the first half of the puzzle you just solved.

The starter returns \`v\` unchanged. Replace each \`return\` line. \`main\` calls the functions and stores the results in **global variables**. The tests read those, and the **Watch** list next to the board shows them after a run.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["s1", "s2", "c1", "c2", "t1", "t2"],
      starter: `uint16_t s1, s2, c1, c2, t1, t2;

// Return v with bit n set to 1.
uint16_t setBit(uint16_t v, uint16_t n)
{
    return v;   // TODO: OR with the mask (1 << n)
}

// Return v with bit n cleared to 0.
uint16_t clearBit(uint16_t v, uint16_t n)
{
    return v;   // TODO: AND with the inverted mask
}

// Return 1 if bit n of v is 1, else 0.
uint16_t isSet(uint16_t v, uint16_t n)
{
    return v;   // TODO: move bit n down to bit 0, then keep only bit 0
}

void main(void)
{
    s1 = setBit(0x00A5, 9);
    s2 = setBit(0x00A5, 0);     // bit 0 is already 1: nothing changes
    c1 = clearBit(0x00A5, 2);
    c2 = clearBit(0xFFFF, 4);
    t1 = isSet(0x00A5, 7);
    t2 = isSet(0x00A5, 6);
    while (1) {}
}
`,
      solution: `uint16_t s1, s2, c1, c2, t1, t2;

// Return v with bit n set to 1.
uint16_t setBit(uint16_t v, uint16_t n)
{
    return v | (1 << n);
}

// Return v with bit n cleared to 0.
uint16_t clearBit(uint16_t v, uint16_t n)
{
    return v & ~(1 << n);
}

// Return 1 if bit n of v is 1, else 0.
uint16_t isSet(uint16_t v, uint16_t n)
{
    return (v >> n) & 1;
}

void main(void)
{
    s1 = setBit(0x00A5, 9);
    s2 = setBit(0x00A5, 0);     // bit 0 is already 1: nothing changes
    c1 = clearBit(0x00A5, 2);
    c2 = clearBit(0xFFFF, 4);
    t1 = isSet(0x00A5, 7);
    t2 = isSet(0x00A5, 6);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "s1", equals: 0x02a5, label: "setBit(0x00A5, 9) returns 0x02A5 (677)", hint: "`return v | (1 << n);`. If you got 512 (0x0200), you returned the mask alone: OR it with v. If you got 1, you wrote `||` (true or false) where `|` (bit by bit) is meant." },
        { kind: "var", name: "s2", equals: 0x00a5, label: "setBit(0x00A5, 0) returns 0x00A5 (165)", hint: "Setting a bit that is already 1 changes nothing. Adding the mask (`v + (1 << n)`) gets this case wrong: use `|`." },
        { kind: "var", name: "c1", equals: 0x00a1, label: "clearBit(0x00A5, 2) returns 0x00A1 (161)", hint: "`v & (1 << n)` keeps only bit n. You want everything except bit n: `v & ~(1 << n)`." },
        { kind: "var", name: "c2", equals: 0xffef, label: "clearBit(0xFFFF, 4) returns 0xFFEF (65519)" },
        { kind: "var", name: "t1", equals: 1, label: "isSet(0x00A5, 7) returns 1", hint: "`v & (1 << n)` is not 0 when the bit is set, but it is 128 here, not 1. Shift first: `(v >> n) & 1`." },
        { kind: "var", name: "t2", equals: 0, label: "isSet(0x00A5, 6) returns 0" },
      ],
      hints: [
        "The mask is `(1 << n)`. Set: OR. Clear: AND with `~` in front of the mask.",
        "`return v | (1 << n);` and `return v & ~(1 << n);`",
        "isSet: `return (v >> n) & 1;` slides bit n down to position 0 and throws the other bits away.",
      ],
      takeaway: "`v | mask` sets, `v & ~mask` clears, `(v >> n) & 1` reads one bit. Every register write in this course is one of these three.",
    },
    {
      id: "bits-twos",
      kind: "calc",
      title: "Two's complement",
      goal: "Convert between negative numbers and their bit patterns.",
      refs: [{ course: "L4" }, { course: "Lab 2" }],
      brief: `
So far every pattern was a number from 0 up: **unsigned**. A **signed** type must also hold negative numbers, and bits have no minus sign. The chip uses **two's complement**: the top bit is worth the same as before, but negative. In 16 bits, bit 15 is worth -32768 instead of +32768.

So a signed N-bit number covers -2^(N-1) up to 2^(N-1) - 1. With 8 bits that is -128 to 127. With 16 bits it is -32768 to 32767.

To negate a value: flip all bits, then add 1.

Example in 16 bits: 1 is \`0x0001\`. Flipped: \`0xFFFE\`. Plus one: \`0xFFFF\`. So -1 is \`0xFFFF\`.

To read a 16-bit pattern whose top bit is 1, subtract 2^16 = 65536 from its unsigned value: \`0xFFFF\` is 65535 - 65536 = -1.

{{figure:bit-explorer}}

Try it in the figure: switch it to two's complement and turn bit 15 on. Its weight becomes -32768, and that is the whole difference between signed and unsigned.

Answers may be typed in decimal or in hex (\`0x...\`).
`,
      fields: [
        { id: "a", label: "The 16-bit pattern 0xFFFE read as an int16_t", answer: -2, why: "0xFFFE = 65534, and 65534 - 65536 = -2." },
        { id: "b", label: "-5 stored in 16 bits, as hex", format: "hex", answer: 0xfffb, why: "5 = 0x0005, flipped 0xFFFA, plus 1 = 0xFFFB." },
        { id: "c", label: "Smallest value a 20-bit signed integer can hold", answer: -524288, why: "-2^19 = -524288. Lab 2 opens with a question of this kind." },
        { id: "d", label: "Largest value a 20-bit signed integer can hold", answer: 524287, why: "2^19 - 1 = 524287." },
      ],
      hints: [
        "For a pattern with the top bit set, subtract 2^16 = 65536 from its unsigned value. 0xFFFE is one less than 0xFFFF = 65535.",
        "For -5: write 5 in hex with four digits, invert every digit (F minus the digit), then add 1.",
        "For 20 bits, put N = 20 in the range rule: -2^19 to 2^19 - 1, and 2^19 = 524288.",
      ],
    },
    {
      id: "bits-int16",
      kind: "brief",
      title: "An int is 16 bits here",
      goal: "Learn what happens when a result is too big for its type, then answer three questions.",
      refs: [{ course: "L4" }, { course: "HW1" }, { course: "Lab 1" }],
      brief: `
On a PC an \`int\` has 32 bits. On this chip it has **16**. In two's complement that is -32768 to 32767, and nothing larger.

## When a result does not fit
The chip keeps the lowest 16 bits of the result and drops the rest, with no warning. This is called **overflow**. The value **wraps around**: it comes out wrong by 65536 (2^16), or by a multiple of it.

- \`30000 + 10000\` should be 40000. As a 16-bit signed value that reads 40000 - 65536 = -25536.
- \`200 * 1000\` should be 200000. Take 65536 off three times: 200000 - 196608 = 3392.

## Say the size you need
This is why the course code uses the fixed-width types of chapter C and almost never a plain \`int\`:

- \`int16_t\`: -32768 to 32767. \`uint16_t\`: 0 to 65535 (the \`u\` means unsigned).
- \`int32_t\`: about -2 billion to +2 billion. \`uint32_t\`: 0 to about 4 billion.

A plain number in the code, such as \`1000\`, is an \`int\`, so it is 16 bits too. Write \`1000L\` to make it 32 bits. The \`L\` stands for \`long\`, C's older name for a 32-bit integer on this chip. \`UL\` makes it unsigned as well: \`1UL\`.

The smallest piece of memory this CPU can reach is 16 bits, called a **word**. Even a \`char\` is 16 bits here.
`,
      questions: [
        {
          prompt: "On this chip, what does `int16_t n = 30000 + 10000;` store in `n`?",
          options: ["40000", "32767", "-25536", "It does not compile"],
          answer: 2,
          why: "40000 is larger than 32767, the largest 16-bit signed value, so it wraps around: 40000 - 65536 = -25536. In bits, 40000 is 0x9C40: the top bit is set, and in two's complement that bit is negative.",
        },
        {
          prompt: "A count can reach 200000. Which type holds it?",
          options: ["`uint32_t`", "`uint16_t`", "`int16_t`", "`int`"],
          answer: 0,
          why: "The 16-bit types stop at 32767 (signed) or 65535 (unsigned), and `int` is 16 bits on this chip. Only a 32-bit type is large enough.",
        },
        {
          prompt: "A `uint16_t` holds 65535 (`0xFFFF`) and the program adds 1. What does it hold now?",
          options: ["65536", "0", "-1", "32767"],
          answer: 1,
          why: "65536 is 0x10000: it needs 17 bits. The lowest 16 bits are all 0, so the variable wraps around to 0.",
        },
      ],
      takeaway: "An `int` is 16 bits on this chip. A result that does not fit wraps around without a warning, so say the size you need: int16_t, uint16_t, int32_t, uint32_t.",
    },
    {
      id: "bits-bytes",
      kind: "code",
      mode: "complete",
      title: "Split and join bytes",
      goal: "Finish three small functions that take a 16-bit value apart and put it back together.",
      refs: [{ course: "HW1" }, { course: "L2" }],
      brief: `
A **byte** is 8 bits. Sensors often send a 16-bit reading as two bytes, one after the other. You will do this for real with the motion sensor (IMU) and the laser scanner (LIDAR) later, so build the tools now.

For \`0x7E2B\` the high byte is \`0x7E\` and the low byte is \`0x2B\`.

- Shifting right by 8 moves the high byte down: \`0x7E2B >> 8\` is \`0x007E\`.
- AND with \`0x00FF\` keeps only the low 8 bits: \`0x7E2B & 0x00FF\` is \`0x002B\`.
- Shifting left by 8 moves a byte up, and OR joins two pieces: \`(0x7E << 8) | 0x2B\` is \`0x7E00 | 0x002B\` = \`0x7E2B\`.

Complete the three functions: replace each \`return 0;\` with one line. \`main\` already calls each of them twice and stores the results in global variables the tests read. Press **Run tests** to check your work.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["hi", "lo", "joined", "hi2", "lo2", "joined2"],
      starter: `uint16_t hi, lo, joined;
uint16_t hi2, lo2, joined2;

// Return the upper 8 bits of v (for 0x7E2B: 0x7E).
uint16_t highByte(uint16_t v)
{
    return 0;   // TODO
}

// Return the lower 8 bits of v (for 0x7E2B: 0x2B).
uint16_t lowByte(uint16_t v)
{
    return 0;   // TODO
}

// Build a 16-bit value from two bytes (0x3C and 0xD1 give 0x3CD1).
uint16_t combine(uint16_t high, uint16_t low)
{
    return 0;   // TODO
}

void main(void)
{
    hi = highByte(0x7E2B);
    lo = lowByte(0x7E2B);
    joined = combine(0x3C, 0xD1);
    hi2 = highByte(0x90F4);
    lo2 = lowByte(0x90F4);
    joined2 = combine(0x81, 0x07);
    while (1) {}
}
`,
      solution: `uint16_t hi, lo, joined;
uint16_t hi2, lo2, joined2;

uint16_t highByte(uint16_t v)
{
    return (v >> 8) & 0x00FF;
}

uint16_t lowByte(uint16_t v)
{
    return v & 0x00FF;
}

uint16_t combine(uint16_t high, uint16_t low)
{
    return (high << 8) | (low & 0x00FF);
}

void main(void)
{
    hi = highByte(0x7E2B);
    lo = lowByte(0x7E2B);
    joined = combine(0x3C, 0xD1);
    hi2 = highByte(0x90F4);
    lo2 = lowByte(0x90F4);
    joined2 = combine(0x81, 0x07);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "hi", equals: 0x7e, label: "highByte(0x7E2B) returns 0x7E (126)", hint: "Shift v right by 8 places: `return v >> 8;`. A shift to the left, or a shift by 4, moves the wrong way or only one hex digit." },
        { kind: "var", name: "hi2", equals: 0x90, label: "highByte(0x90F4) returns 0x90 (144)", hint: "The function must work on its argument v, not return a fixed number." },
        { kind: "var", name: "lo", equals: 0x2b, label: "lowByte(0x7E2B) returns 0x2B (43)", hint: "Keep the low 8 bits with AND: `return v & 0x00FF;`. `v & 0xFF00` keeps the high byte instead." },
        { kind: "var", name: "lo2", equals: 0xf4, label: "lowByte(0x90F4) returns 0xF4 (244)" },
        { kind: "var", name: "joined", equals: 0x3cd1, label: "combine(0x3C, 0xD1) returns 0x3CD1 (15569)", hint: "Move `high` up by 8 bits, then OR `low` in: `(high << 8) | low`. Without the brackets, or with `high | low` alone, the two bytes land on top of each other." },
        { kind: "var", name: "joined2", equals: 0x8107, label: "combine(0x81, 0x07) returns 0x8107 (33031)" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "[*/%]", label: "Shifts and masks only: no multiply, divide or remainder", hint: "Multiplying by 256 works, but `<< 8` says what you mean and costs the CPU less." },
      ],
      hints: [
        "Each function is one line using `>>`, `<<`, `&` or `|`.",
        "High byte: shift right by 8. Low byte: AND with 0x00FF.",
        "combine: `return (high << 8) | low;`",
      ],
      takeaway: "Shift to move bits into place, AND to keep the ones you want, OR to join. You will reuse exactly this for SPI and LIDAR data.",
    },
    {
      id: "bits-overflow",
      kind: "code",
      mode: "debug",
      title: "The count that came out wrong",
      goal: "Find the two bugs that make this program print the wrong number.",
      refs: [{ course: "HW1" }, { course: "Lab 1" }, { course: "L4" }],
      brief: `
A **timer** is a counter inside the chip that counts up at a steady rate, here 200 times per microsecond (us). \`toCounts(microseconds)\` works out how many counts a time takes. \`main\` calls it for 1000 us (it should give 200000) and for 500 us (100000), and prints both on the **serial terminal**, the text window next to the board.

The first three lines of \`main\` start the chip and its serial port. They are given: leave them as they are. \`serial_printf(&SerialA, ...)\` works like \`printf\`, but sends the text to the serial terminal, and \`\\r\\n\` at the end starts a new line. Chapter 6 explains all of this.

Run it and look at the terminal and at the messages under the editor. There are **two** separate bugs, and both come from \`int\` being 16 bits on this chip:

- arithmetic between two \`int\` values is done in 16 bits, even if the result is stored in a 32-bit variable. The cure is a **cast** (chapter C): \`(uint32_t)a * b\` makes \`a\` 32 bits wide first, and then the whole multiplication is done in 32 bits;
- \`%d\` prints a 16-bit value. A 32-bit value needs \`%ld\`.

{{figure:int16-overflow}}

Try it in the figure: press the example \`200 * 1000\`, see where the result lands, then make the second operand a long.

Fix the program so that it prints \`200000 and 100000\`.
`,
      kit: "launchpad",
      durationMs: 20,
      starter: `uint32_t counts = 0;
uint32_t half = 0;

// Timer counts in a time given in microseconds
uint32_t toCounts(int microseconds)
{
    int countsPerMicrosecond = 200;

    return countsPerMicrosecond * microseconds;
}

void main(void)
{
    // Given: start the chip and its serial port (chapter 6)
${SERIAL_SETUP}

    counts = toCounts(1000);
    half = toCounts(500);

    serial_printf(&SerialA, "%d and %d\\r\\n", counts, half);

    while (1) {}
}
`,
      solution: `uint32_t counts = 0;
uint32_t half = 0;

// Timer counts in a time given in microseconds
uint32_t toCounts(int microseconds)
{
    int countsPerMicrosecond = 200;

    return (uint32_t)countsPerMicrosecond * microseconds;
}

void main(void)
{
    // Given: start the chip and its serial port (chapter 6)
${SERIAL_SETUP}

    counts = toCounts(1000);
    half = toCounts(500);

    serial_printf(&SerialA, "%ld and %ld\\r\\n", counts, half);

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "counts", equals: 200000, label: "toCounts(1000) returns 200000", hint: "The multiplication itself overflows. Make one operand 32 bits wide before multiplying." },
        { kind: "var", name: "half", equals: 100000, label: "toCounts(500) returns 100000", hint: "The function must compute the result from its argument." },
        { kind: "serial", includes: "200000 and 100000\r\n", label: "The terminal shows: 200000 and 100000", hint: "%d prints 16 bits. Both values are uint32_t: write `%ld` twice in the text between the quotes." },
        { kind: "no-diagnostic", code: "int16-overflow", label: "No 16-bit overflow", hint: "Look at the `return` line of toCounts: both operands are `int`. Write `(uint32_t)` in front of the first one." },
        { kind: "no-diagnostic", code: "printf-type", label: "The format matches the value's size", hint: "A uint32_t is printed with `%ld`, not `%d`." },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "\\(\\s*int\\s+microseconds\\s*\\)[\\s\\S]*\\bint\\s+countsPerMicrosecond\\b",
          label: "Both inputs are still `int`: the multiplication itself is fixed",
          hint: "Leave the two declarations alone and widen one operand where the multiplication happens.",
        },
      ],
      hints: [
        "Run the program and read the two warnings under the editor: each names a line and what went wrong.",
        "Storing into a uint32_t does not help if the multiplication already happened in 16 bits. Cast one operand: `(uint32_t)countsPerMicrosecond * microseconds`, or declare the variables as int32_t.",
        "Change both `%d` to `%ld` in the format string.",
      ],
      takeaway: "The type of a calculation is decided by its operands, not by where the result goes. And on this chip `%d` is for 16-bit values, `%ld` for 32-bit ones.",
    },
    {
      id: "bits-pack",
      kind: "code",
      mode: "checkpoint",
      title: "Pack a control word",
      goal: "Write functions that place three settings into one 16-bit word, and read one back.",
      refs: [{ course: "L2" }, { course: "Lab 3" }],
      brief: `
A register packs several settings into one word. Each setting has its own group of bits, called a **field**. This word is modelled on a control register you will meet in chapter 9:

- **mode** uses bits 1 to 0 (values 0 to 3)
- **divider** uses bits 12 to 10 (values 0 to 7)
- **enable** uses bit 15 (0 or 1)

All other bits are 0.

Worked example for another field, a 3-bit value in bits 6 to 4:

- to put 5 there: \`(5 & 0x7) << 4\` = \`0x0050\`. The mask \`0x7\` (binary 111) keeps 3 bits, and the shift moves them up to the field's lowest bit.
- to read it back: \`(word >> 4) & 0x7\`. Shift the field down to bit 0, then keep 3 bits.

Write:
- \`pack(mode, divider, enable)\`: returns the 16-bit word. Mask each argument so a value that is too large cannot spill into another field, shift it into place, and OR the three pieces together.
- \`getDivider(word)\`: returns the divider stored in a word.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["w1", "w2", "w3", "d1", "d2"],
      starter: `uint16_t w1, w2, w3, d1, d2;

uint16_t pack(uint16_t mode, uint16_t divider, uint16_t enable)
{
    // TODO: mode in bits 1:0, divider in bits 12:10, enable in bit 15
    return 0;
}

uint16_t getDivider(uint16_t word)
{
    // TODO
    return 0;
}

void main(void)
{
    w1 = pack(2, 3, 1);
    w2 = pack(0, 7, 0);
    w3 = pack(7, 9, 1);     // too large on purpose: must be masked
    d1 = getDivider(0x8C02);
    d2 = getDivider(0xFFFF);
    while (1) {}
}
`,
      solution: `uint16_t w1, w2, w3, d1, d2;

uint16_t pack(uint16_t mode, uint16_t divider, uint16_t enable)
{
    return (mode & 0x3) | ((divider & 0x7) << 10) | ((enable & 0x1) << 15);
}

uint16_t getDivider(uint16_t word)
{
    return (word >> 10) & 0x7;
}

void main(void)
{
    w1 = pack(2, 3, 1);
    w2 = pack(0, 7, 0);
    w3 = pack(7, 9, 1);
    d1 = getDivider(0x8C02);
    d2 = getDivider(0xFFFF);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "w1", equals: 0x8c02, label: "pack(2, 3, 1) is 0x8C02 (35842)", hint: "Three pieces joined with `|`: mode stays at bit 0, divider is shifted left by 10, enable by 15. 0x8C02 = 0x8000 | 0x0C00 | 0x0002." },
        { kind: "var", name: "w2", equals: 0x1c00, label: "pack(0, 7, 0) is 0x1C00 (7168)" },
        { kind: "var", name: "w3", equals: 0x8403, label: "pack(7, 9, 1) is masked to 0x8403 (33795)", hint: "7 does not fit in 2 bits and 9 does not fit in 3: AND each argument with its field's mask first." },
        { kind: "var", name: "d1", equals: 3, label: "getDivider(0x8C02) is 3", hint: "Shift the word right by 10 so the divider starts at bit 0, then AND with 0x7 to keep its 3 bits." },
        { kind: "var", name: "d2", equals: 7, label: "getDivider(0xFFFF) is 7", hint: "After the shift, bits from the enable field are still above the divider. `& 0x7` removes them." },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?", label: "No `if` and no `?:`: masks do all the limiting" },
      ],
      hints: [
        "For each field: mask the value to the field's width, then shift it to the field's lowest bit. OR the three results.",
        "Masks: 2 bits is 0x3, 3 bits is 0x7, 1 bit is 0x1. Shifts: 0, 10 and 15.",
        "getDivider: `return (word >> 10) & 0x7;`",
      ],
      takeaway: "This is exactly what the compiler does for you when you write `EPwm1Regs.TBCTL.bit.CLKDIV = 3;`. The `.bit` names are shifts and masks with nicer spelling.",
    },
    {
      id: "bits-sign12",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "A 12-bit reading in a 16-bit word",
      goal: "Turn a 12-bit two's complement sensor reading into a correct int16_t.",
      refs: [{ course: "L4" }, { course: "Lab 2" }],
      brief: `
Many sensors send fewer than 16 bits. This one packs each sample into a 16-bit word:

- bits 11 to 0: the reading, a **12-bit two's complement** number (-2048 to 2047)
- bits 15 to 12: status **flags** (a flag is one bit that means yes or no) that are not part of the value

Bit 11 is the sign bit of the reading. Masking off the flags is not enough: \`0x0FFF\` is -1 in 12 bits, but as a 16-bit value it reads 4095. The sign bit has to be copied into bits 15 to 12. This is called **sign extension**.

Finish \`reading(raw)\` so that it ignores the flags and returns the signed value.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["r1", "r2", "r3", "r4", "r5", "r6"],
      starter: `int16_t r1, r2, r3, r4, r5, r6;

// raw: flags in bits 15:12, a 12-bit two's complement reading in bits 11:0
int16_t reading(uint16_t raw)
{
    return raw & 0x0FFF;   // TODO: negative readings come out wrong
}

void main(void)
{
    r1 = reading(0x0123);
    r2 = reading(0x07FF);
    r3 = reading(0x0800);
    r4 = reading(0x0FFF);
    r5 = reading(0xA7FF);
    r6 = reading(0x5F00);
    while (1) {}
}
`,
      solution: `int16_t r1, r2, r3, r4, r5, r6;

// raw: flags in bits 15:12, a 12-bit two's complement reading in bits 11:0
int16_t reading(uint16_t raw)
{
    // Move bit 11 up to bit 15. The four flag bits fall off the top.
    int16_t up = (int16_t)(raw << 4);
    // Shifting a signed value right copies its sign bit into the gap.
    return up >> 4;
}

void main(void)
{
    r1 = reading(0x0123);
    r2 = reading(0x07FF);
    r3 = reading(0x0800);
    r4 = reading(0x0FFF);
    r5 = reading(0xA7FF);
    r6 = reading(0x5F00);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "r1", equals: 291, label: "reading(0x0123) is 291" },
        { kind: "var", name: "r2", equals: 2047, label: "reading(0x07FF) is 2047, the largest reading" },
        { kind: "var", name: "r3", equals: -2048, label: "reading(0x0800) is -2048, the smallest reading", hint: "Bit 11 is set, so the value is negative: bits 15 to 12 of the result must all be 1." },
        { kind: "var", name: "r4", equals: -1, label: "reading(0x0FFF) is -1" },
        { kind: "var", name: "r5", equals: 2047, label: "reading(0xA7FF) is 2047: the flags are ignored", hint: "Bits 15 to 12 of raw are flags. They must not reach the result." },
        { kind: "var", name: "r6", equals: -256, label: "reading(0x5F00) is -256" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?", label: "No `if` and no `?:`", hint: "Shift the reading left until its sign bit is bit 15 of an int16_t, then shift it back." },
      ],
      hints: [
        "Keep bits 11 to 0, then look at bit 11 (`0x0800`). If it is set, the reading is negative.",
        "For a negative reading, set bits 15 to 12 (`| 0xF000`), or subtract 4096.",
        "Without an if: `int16_t up = (int16_t)(raw << 4); return up >> 4;`. A right shift of a signed value keeps the sign.",
      ],
      takeaway: "A value narrower than its container needs sign extension before you do arithmetic with it. The 12-bit analog readings (chapter 8) and the IMU readings later in the course rely on this.",
    },
    {
      id: "bits-range-mask",
      tier: "practice",
      kind: "code",
      mode: "debug",
      title: "A mask from two bit numbers",
      goal: "Fix a function that should build the mask for bits hi down to lo of a 32-bit register.",
      refs: [{ course: "L2" }, { course: "HW1" }],
      brief: `
Register fields are described by bit numbers: "bits 12 to 10". \`fieldMask(hi, lo)\` should return a 32-bit value with exactly those bits set, so \`fieldMask(12, 10)\` is \`0x00001C00\`.

The function below was tested with two small fields and passed. Used on a 32-bit register it fails. Remember that a plain \`1\` is a 16-bit \`int\` on this chip, and \`1UL\` is a 32-bit unsigned 1.

Run it and read the message under the editor. Then make all five results right.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["m1", "m2", "m3", "m4", "m5"],
      starter: `uint32_t m1, m2, m3, m4, m5;

// Mask with bits hi..lo set (31 >= hi >= lo >= 0)
uint32_t fieldMask(uint16_t hi, uint16_t lo)
{
    return ((1 << (hi - lo + 1)) - 1) << lo;
}

void main(void)
{
    m1 = fieldMask(3, 0);
    m2 = fieldMask(12, 10);
    m3 = fieldMask(22, 22);
    m4 = fieldMask(31, 16);
    m5 = fieldMask(31, 0);
    while (1) {}
}
`,
      solution: `uint32_t m1, m2, m3, m4, m5;

// Mask with bits hi..lo set (31 >= hi >= lo >= 0)
uint32_t fieldMask(uint16_t hi, uint16_t lo)
{
    // Start from 32 ones, keep (hi - lo + 1) of them, then move them up to lo.
    return (0xFFFFFFFFUL >> (31 - hi + lo)) << lo;
}

void main(void)
{
    m1 = fieldMask(3, 0);
    m2 = fieldMask(12, 10);
    m3 = fieldMask(22, 22);
    m4 = fieldMask(31, 16);
    m5 = fieldMask(31, 0);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "m1", equals: 0xf, label: "fieldMask(3, 0) is 0x0000000F" },
        { kind: "var", name: "m2", equals: 0x1c00, label: "fieldMask(12, 10) is 0x00001C00" },
        { kind: "var", name: "m3", equals: 0x400000, label: "fieldMask(22, 22) is 0x00400000", hint: "The constant 1 is a 16-bit int. Shifted left by 22 nothing is left of it." },
        { kind: "var", name: "m4", equals: 0xffff0000, label: "fieldMask(31, 16) is 0xFFFF0000" },
        { kind: "var", name: "m5", equals: 0xffffffff, label: "fieldMask(31, 0) is 0xFFFFFFFF" },
        { kind: "no-diagnostic", code: "shift-16", label: "No shift that overflows a 16-bit int" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?", label: "One expression: no special case for the full register" },
      ],
      hints: [
        "A plain `1` is an `int`, and an int is 16 bits here. Every shift in the expression is done in 16 bits.",
        "`1UL` is a 32-bit constant. That fixes fields that reach above bit 15.",
        "For the whole register the width is 32, and C does not define a shift by 32. Avoid it: `(0xFFFFFFFFUL >> (31 - hi + lo)) << lo`.",
      ],
      takeaway: "Write `1UL << n` whenever n can be 16 or more. And a shift count equal to the width of the type is undefined, so build wide masks by shifting ones out, not in.",
    },
    {
      id: "bits-reverse",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Mirror a word",
      goal: "Reverse the bit order of a 16-bit value.",
      refs: [{ course: "L2" }, { course: "HW1" }],
      brief: `
Some devices send the **least significant bit** (bit 0, worth the least) first while your code expects the **most significant bit** (the top bit) first. The fix is to mirror the word: bit 0 becomes bit 15, bit 1 becomes bit 14, and so on.

- \`0x0001\` becomes \`0x8000\`
- \`0xB3C1\` becomes \`0x83CD\`

Write \`reverse16(v)\`.

A loop over the 16 bits passes the tests. The star asks for more: no loop at all, in a handful of statements.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["a", "b", "c", "d", "e"],
      starter: `uint16_t a, b, c, d, e;

// Returns v with its bit order reversed (bit 0 <-> bit 15, bit 1 <-> bit 14, ...)
uint16_t reverse16(uint16_t v)
{
    // TODO
    return v;
}

void main(void)
{
    a = reverse16(0x0001);
    b = reverse16(0x00A5);
    c = reverse16(0xB3C1);
    d = reverse16(0x1234);
    e = reverse16(0xFFFE);
    while (1) {}
}
`,
      solution: `uint16_t a, b, c, d, e;

// Returns v with its bit order reversed (bit 0 <-> bit 15, bit 1 <-> bit 14, ...)
uint16_t reverse16(uint16_t v)
{
    v = ((v >> 1) & 0x5555) | ((v & 0x5555) << 1);   // swap neighbouring bits
    v = ((v >> 2) & 0x3333) | ((v & 0x3333) << 2);   // swap neighbouring pairs
    v = ((v >> 4) & 0x0F0F) | ((v & 0x0F0F) << 4);   // swap the halves of each byte
    return (v >> 8) | (v << 8);                      // swap the two bytes
}

void main(void)
{
    a = reverse16(0x0001);
    b = reverse16(0x00A5);
    c = reverse16(0xB3C1);
    d = reverse16(0x1234);
    e = reverse16(0xFFFE);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "a", equals: 0x8000, label: "reverse16(0x0001) is 0x8000" },
        { kind: "var", name: "b", equals: 0xa500, label: "reverse16(0x00A5) is 0xA500" },
        { kind: "var", name: "c", equals: 0x83cd, label: "reverse16(0xB3C1) is 0x83CD" },
        { kind: "var", name: "d", equals: 0x2c48, label: "reverse16(0x1234) is 0x2C48" },
        { kind: "var", name: "e", equals: 0x7fff, label: "reverse16(0xFFFE) is 0x7FFF" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bfor\\b|\\bdo\\b|while\\s*\\(\\s*[^1\\s]", label: "No loop inside reverse16" },
        { kind: "max-steps", max: 40, label: "The whole program executes 40 statements or fewer", hint: "Swapping the two bytes moves 8 bits at once. What is left to do inside each byte?" },
      ],
      hints: [
        "With a loop: 16 times, shift the result left by one, OR in the lowest bit of v, and shift v right by one.",
        "Without a loop: a mirror image can be built from swaps. Swap the two bytes, then the two 4-bit halves of each byte, then the 2-bit pairs, then single bits. The order of the four steps does not matter.",
        "One swap step: `v = ((v >> 4) & 0x0F0F) | ((v & 0x0F0F) << 4);`. The masks for the other steps are 0x3333 (shift 2) and 0x5555 (shift 1).",
      ],
      takeaway: "Four swaps do the work of sixteen loop passes. A mask picks every second bit, pair or 4-bit group (a nibble), so one shift moves all of them at the same time.",
    },
    {
      id: "bits-q15",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Fractions without float",
      goal: "Multiply two Q15 fixed-point numbers with rounding and without ever wrapping around.",
      refs: [{ course: "L4" }, { course: "HW1" }],
      brief: `
A **Q15** number is an \`int16_t\` that stands for its value divided by 32768. So 16384 means 0.5, -8192 means -0.25, and the range is -1.0 to just under +1.0. Controllers use this format when float is too slow or not available.

Write \`q15mul(a, b)\`, the product of two Q15 numbers as a Q15 number:

- The raw product of the two integers is 32768 times too large, and it does not fit in 16 bits.
- Round to the nearest value: add half of the last bit you keep before you drop the extra bits.
- Exactly one pair of inputs has a product that is not a valid Q15 number. Find it and return the largest Q15 value (32767) for it. Stopping at the end of the range instead of wrapping around is called **saturating**. HW1's \`saturate()\` has the same purpose.

No float.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["p1", "p2", "p3", "p4", "p5", "p6"],
      starter: `int16_t p1, p2, p3, p4, p5, p6;

// Q15 product of two Q15 numbers, rounded to nearest, saturated
int16_t q15mul(int16_t a, int16_t b)
{
    // TODO
    return 0;
}

void main(void)
{
    p1 = q15mul(16384, 16384);      //  0.5 *  0.5
    p2 = q15mul(-16384, 16384);     // -0.5 *  0.5
    p3 = q15mul(3, 16384);          // 1.5 steps: rounds up to 2
    p4 = q15mul(-3, 10923);         // just below -1 step: rounds to -1
    p5 = q15mul(-32768, 32767);     // -1.0 * 0.99997
    p6 = q15mul(-32768, -32768);    // -1.0 * -1.0
    while (1) {}
}
`,
      solution: `int16_t p1, p2, p3, p4, p5, p6;

// Q15 product of two Q15 numbers, rounded to nearest, saturated
int16_t q15mul(int16_t a, int16_t b)
{
    int32_t p = (int32_t)a * b;     // 32-bit product with 30 fraction bits
    p = (p + 0x4000) >> 15;         // add half a step, then drop 15 fraction bits
    if (p > 32767) {                // only -1.0 * -1.0 gets here: +1.0 does not exist
        p = 32767;
    }
    return (int16_t)p;
}

void main(void)
{
    p1 = q15mul(16384, 16384);      //  0.5 *  0.5
    p2 = q15mul(-16384, 16384);     // -0.5 *  0.5
    p3 = q15mul(3, 16384);          // 1.5 steps: rounds up to 2
    p4 = q15mul(-3, 10923);         // just below -1 step: rounds to -1
    p5 = q15mul(-32768, 32767);     // -1.0 * 0.99997
    p6 = q15mul(-32768, -32768);    // -1.0 * -1.0
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "p1", equals: 8192, label: "0.5 * 0.5 is 0.25 (8192)", hint: "Do the multiplication in 32 bits: cast one operand to int32_t first." },
        { kind: "var", name: "p2", equals: -8192, label: "-0.5 * 0.5 is -0.25 (-8192)" },
        { kind: "var", name: "p3", equals: 2, label: "q15mul(3, 16384) rounds 1.5 up to 2", hint: "Add 0x4000 to the 32-bit product before shifting right by 15." },
        { kind: "var", name: "p4", equals: -1, label: "q15mul(-3, 10923) rounds to -1", hint: "Dividing by 32768 rounds negative numbers towards zero. An arithmetic right shift does not." },
        { kind: "var", name: "p5", equals: -32767, label: "q15mul(-32768, 32767) is -32767" },
        { kind: "var", name: "p6", equals: 32767, label: "-1.0 * -1.0 saturates at 32767", hint: "The exact answer, +1.0, would be 32768. Stored in an int16_t that reads -32768." },
        { kind: "no-diagnostic", code: "int16-overflow", label: "No 16-bit overflow" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "float|double|/", label: "Integers only: no float and no division" },
      ],
      hints: [
        "`(int32_t)a * b` gives the full product. It is the Q15 answer times 32768, so it has to come down by 15 bits.",
        "Rounding: `(p + 0x4000) >> 15`. 0x4000 is half of 32768, so anything at or above half a step carries into the bits you keep.",
        "-32768 * -32768 is 2^30. After the shift that is 32768, one more than an int16_t can hold. Test for it before the final cast and return 32767.",
      ],
      takeaway: "Fixed point is integer arithmetic with the binary point kept in your head: widen before multiplying, round before shifting, and saturate where the range ends. Wrapping from +1.0 to -1.0 in a motor command is the kind of bug that breaks hardware.",
    },
    {
      id: "bits-itoa",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Print a number without %ld",
      goal: "Convert an int32_t to decimal text yourself, digit by digit.",
      refs: [{ course: "L4" }, { course: "HW1" }, { course: "Lab 1" }],
      brief: `
\`serial_printf\` is convenient, but it is large and slow. Do its job by hand once and you will know what \`%ld\` costs.

Write \`toDecimal(value, out)\`. It stores \`value\` as decimal text in \`out\`, ending with a 0 character, as every C string does. \`main\` prints the buffer with \`%s\`.

- Characters are numbers: \`'0' + 7\` is the character \`'7'\`.
- A new loop form helps: \`do { ... } while (condition);\` runs its body once before it tests the condition.
- No leading zeros, and a \`-\` in front of negative values.
- It must work for **every** int32_t. Two values deserve a second look: 0, and the most negative one.
- No \`%d\`, \`%ld\`, \`%u\` or \`sprintf\`: the only format in the program is the \`%s\` already there.
`,
      kit: "launchpad",
      durationMs: 30,
      starter: `char text[12];    // 10 digits, a sign and the closing 0

// Store value as decimal text in out
void toDecimal(int32_t value, char *out)
{
    // TODO
    out[0] = '?';
    out[1] = 0;
}

void show(int32_t value)
{
    toDecimal(value, text);
    serial_printf(&SerialA, "[%s]\\r\\n", text);
}

void main(void)
{
${SERIAL_SETUP}

    show(7);
    show(0);
    show(-45);
    show(200000);
    show(1000000007);
    show(-2147483647L - 1);     // the most negative int32_t
    while (1) {}
}
`,
      solution: `char text[12];    // 10 digits, a sign and the closing 0

// Store value as decimal text in out
void toDecimal(int32_t value, char *out)
{
    char digits[10];
    int16_t n = 0;
    uint32_t rest = value;

    if (value < 0) {
        *out++ = '-';
        rest = 0 - rest;        // unsigned: correct even for -2147483648
    }
    do {                        // do-while: 0 still produces one digit
        digits[n++] = '0' + (rest % 10);
        rest /= 10;
    } while (rest != 0);
    while (n > 0) {             // the digits came out last one first
        *out++ = digits[--n];
    }
    *out = 0;
}

void show(int32_t value)
{
    toDecimal(value, text);
    serial_printf(&SerialA, "[%s]\\r\\n", text);
}

void main(void)
{
${SERIAL_SETUP}

    show(7);
    show(0);
    show(-45);
    show(200000);
    show(1000000007);
    show(-2147483647L - 1);     // the most negative int32_t
    while (1) {}
}
`,
      checks: [
        { kind: "serial", includes: "[7]\r\n", label: "7 prints as [7]" },
        { kind: "serial", includes: "[0]\r\n", label: "0 prints as [0]", hint: "A loop that runs while the value is not 0 produces no digit at all for 0." },
        { kind: "serial", includes: "[-45]\r\n", label: "-45 prints as [-45]" },
        { kind: "serial", includes: "[200000]\r\n", label: "200000 prints as [200000]", hint: "Digits come out of `% 10` lowest first. They must be stored highest first." },
        { kind: "serial", includes: "[1000000007]\r\n", label: "1000000007 prints as [1000000007]" },
        { kind: "serial", includes: "[-2147483648]\r\n", label: "The most negative value prints as [-2147483648]", hint: "+2147483648 does not exist as an int32_t, so `value = -value` cannot work. It does fit in a uint32_t." },
        { kind: "source", mustNotMatch: "\"[^\"\\n]*%[-0-9]*l?[dux]|sprintf", label: "No %d, %ld, %u or sprintf" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "2147483648|0x80000000", label: "No special case for the most negative value", hint: "Take the magnitude as a uint32_t: `rest = 0 - rest;` is well defined for unsigned numbers." },
      ],
      hints: [
        "`rest % 10` is the last digit and `rest / 10` removes it. Adding '0' turns a digit 0 to 9 into its character.",
        "The digits arrive in reverse. Collect them in a small local array, then copy them to `out` backwards. Use do ... while so that 0 gives one digit.",
        "For the sign: copy value into a `uint32_t rest`. If value is negative, store '-' and do `rest = 0 - rest;`. Unsigned arithmetic wraps by definition, which gives the right magnitude even for -2147483648.",
      ],
      takeaway: "A signed type has one more negative value than positive ones, so negating can overflow. Every digit costs a 32-bit division, which is why you should not print from fast interrupt code.",
    },
  ],
};
