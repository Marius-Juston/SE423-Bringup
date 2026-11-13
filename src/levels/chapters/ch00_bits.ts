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
      id: "bits-brief",
      kind: "brief",
      title: "Why bits matter here",
      goal: "Read how numbers are stored, then answer three questions.",
      refs: [{ course: "L2" }, { course: "L4" }],
      brief: `
Everything you do with the F28379D ends up as **bits in a register**: one bit turns an LED on, three bits pick a clock divider. So you need to move easily between binary, hex and decimal.

## Hex is binary in groups of four
One hex digit is exactly four bits. \`0xA5\` is \`1010 0101\`. Bit numbers start at 0 on the right, and bit n is worth 2 to the power n, so bit 5 alone is \`0x20\` (32).

## The four mask moves
With \`mask = 1 << n\` (a 1 in position n):
- **set** the bit: \`x |= mask;\`
- **clear** it: \`x &= ~mask;\`
- **toggle** it: \`x ^= mask;\`
- **test** it: \`if (x & mask)\`

## Two things that are different on this chip
- An \`int\` is **16 bits** (-32768 to 32767). \`200 * 1000\` does not fit and silently wraps around. Use \`int32_t\`, \`uint32_t\` or a long constant (\`1000L\`) for bigger numbers.
- A \`char\` is also 16 bits, and \`sizeof(char)\` is 1. The smallest piece of memory this CPU can address is a 16-bit word.

Negative numbers use **two's complement**: to negate, flip every bit and add 1. In 16 bits, -1 is \`0xFFFF\`.
`,
      questions: [
        {
          prompt: "What is `0x20` in binary (8 bits)?",
          options: ["`0010 0000`", "`0000 0010`", "`0001 0100`", "`0010 0010`"],
          answer: 0,
          why: "Hex 2 is 0010 and hex 0 is 0000. Only bit 5 is set, and 2 to the power 5 is 32.",
        },
        {
          prompt: "Which line clears bit 3 of `x` and leaves every other bit alone?",
          options: ["`x = 0 << 3;`", "`x &= ~(1 << 3);`", "`x |= (1 << 3);`", "`x &= (1 << 3);`"],
          answer: 1,
          why: "~(1 << 3) is all ones except bit 3. AND keeps every bit where the mask is 1 and forces bit 3 to 0.",
        },
        {
          prompt: "On this chip, what does `int16_t n = 30000 + 10000;` store in `n`?",
          options: ["40000", "32767", "-25536", "It does not compile"],
          answer: 2,
          why: "40000 is larger than 32767, the largest 16-bit signed value, so it wraps: 40000 - 65536 = -25536.",
        },
      ],
      takeaway: "Hex digit = 4 bits; bit n = 2^n; OR sets, AND-with-NOT clears, XOR toggles, AND tests. And `int` is 16 bits here.",
    },
    {
      id: "bits-a5",
      kind: "register",
      title: "Light the bits of 0x00A5",
      goal: "Switch bits on until the value reads 0x00A5.",
      refs: [{ course: "L2" }, { course: "HW1" }],
      brief: `
Click a bit to flip it. The hex and decimal readouts update as you go.

Split the hex number into digits first: \`0x00A5\` is the digits 0, 0, A, 5. Each digit is four bits: A is 10, which is 8 + 2.
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
      id: "bits-mask",
      kind: "register",
      title: "Set one bit, clear another",
      goal: "Starting from 0x00A5, apply `v |= (1 << 9);` and then `v &= ~0x0004;` by hand.",
      refs: [{ course: "L2" }, { course: "Lab 2" }],
      brief: `
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
      takeaway: "This is how one field of a register is changed without disturbing its neighbours: OR to set, AND with the inverted mask to clear.",
    },
    {
      id: "bits-twos",
      kind: "calc",
      title: "Two's complement",
      goal: "Convert between negative numbers and their bit patterns.",
      refs: [{ course: "L4" }, { course: "Lab 2" }],
      brief: `
A signed N-bit number covers -2^(N-1) up to 2^(N-1) - 1. To negate a value: flip all bits, then add 1.

Example in 16 bits: 1 is \`0x0001\`. Flipped: \`0xFFFE\`. Plus one: \`0xFFFF\`. So -1 is \`0xFFFF\`.

To read a pattern whose top bit is 1, do the same in reverse, or subtract 2^N: \`0xFFFF\` is 65535 - 65536 = -1.

Answers may be typed in decimal or in hex (\`0x...\`).
`,
      fields: [
        { id: "a", label: "The 16-bit pattern 0xFFFE read as an int16_t", answer: -2, why: "0xFFFE = 65534, and 65534 - 65536 = -2." },
        { id: "b", label: "-5 stored in 16 bits, as hex", format: "hex", answer: 0xfffb, why: "5 = 0x0005, flipped 0xFFFA, plus 1 = 0xFFFB." },
        { id: "c", label: "Smallest value a 24-bit signed integer can hold", answer: -8388608, why: "-2^23 = -8388608 (Lab 2 warm-up)." },
        { id: "d", label: "Largest value a 24-bit signed integer can hold", answer: 8388607, why: "2^23 - 1 = 8388607." },
      ],
      hints: [
        "For a pattern with the top bit set, subtract 2^16 = 65536 from its unsigned value.",
        "For -5: write 5 in hex with four digits, invert every digit (F minus the digit), then add 1.",
        "A 24-bit signed range is -2^23 to 2^23 - 1, and 2^23 = 8388608.",
      ],
    },
    {
      id: "bits-bytes",
      kind: "code",
      mode: "complete",
      title: "Split and join bytes",
      goal: "Finish three small functions that take a 16-bit value apart and put it back together.",
      refs: [{ course: "HW1" }, { course: "L2" }],
      brief: `
Sensors often send a 16-bit reading as two 8-bit pieces. You will do this for real with the IMU and the LIDAR later, so build the tools now.

For \`0xC492\` the high byte is \`0xC4\` and the low byte is \`0x92\`.

- Shifting right by 8 moves the high byte down: \`v >> 8\`.
- \`& 0x00FF\` keeps only the low 8 bits.
- Shifting left by 8 moves a byte up, and \`|\` joins two pieces.

Complete the three functions. \`main\` already calls them and stores the results in global variables the tests read.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["hi", "lo", "joined"],
      starter: `uint16_t hi = 0;
uint16_t lo = 0;
uint16_t joined = 0;

// Return the upper 8 bits of v (for 0xC492: 0xC4).
uint16_t highByte(uint16_t v)
{
    return 0;   // TODO
}

// Return the lower 8 bits of v (for 0xC492: 0x92).
uint16_t lowByte(uint16_t v)
{
    return 0;   // TODO
}

// Build a 16-bit value from two bytes (0xA5 and 0x5D give 0xA55D).
uint16_t combine(uint16_t high, uint16_t low)
{
    return 0;   // TODO
}

void main(void)
{
    hi = highByte(0xC492);
    lo = lowByte(0xC492);
    joined = combine(0xA5, 0x5D);
    while (1) {}
}
`,
      solution: `uint16_t hi = 0;
uint16_t lo = 0;
uint16_t joined = 0;

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
    hi = highByte(0xC492);
    lo = lowByte(0xC492);
    joined = combine(0xA5, 0x5D);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "hi", equals: 0xc4, label: "highByte(0xC492) returns 0xC4 (196)" },
        { kind: "var", name: "lo", equals: 0x92, label: "lowByte(0xC492) returns 0x92 (146)" },
        { kind: "var", name: "joined", equals: 0xa55d, label: "combine(0xA5, 0x5D) returns 0xA55D (42333)" },
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
A timer on this chip counts 200 times per microsecond. This program works out how many counts make one millisecond (it should be 200000) and prints it on the serial terminal.

Run it and look at the terminal and at the messages under the editor. There are **two** separate bugs, and both come from \`int\` being 16 bits on this chip:

- arithmetic between two \`int\` values is done in 16 bits, even if the result is stored in a 32-bit variable;
- \`%d\` prints a 16-bit value. A 32-bit value needs \`%ld\`.

Fix the program so that it prints \`counts = 200000\`.
`,
      kit: "launchpad",
      durationMs: 20,
      starter: `uint32_t counts = 0;

void main(void)
{
${SERIAL_SETUP}

    int countsPerMicrosecond = 200;
    int microseconds = 1000;

    counts = countsPerMicrosecond * microseconds;

    serial_printf(&SerialA, "counts = %d\\r\\n", counts);

    while (1) {}
}
`,
      solution: `uint32_t counts = 0;

void main(void)
{
${SERIAL_SETUP}

    int countsPerMicrosecond = 200;
    int microseconds = 1000;

    counts = (uint32_t)countsPerMicrosecond * microseconds;

    serial_printf(&SerialA, "counts = %ld\\r\\n", counts);

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "counts", equals: 200000, label: "counts holds 200000", hint: "The multiplication itself overflows. Make one operand 32 bits wide before multiplying." },
        { kind: "serial", includes: "counts = 200000\r\n", label: "The terminal shows: counts = 200000", hint: "%d prints 16 bits. counts is a uint32_t." },
        { kind: "no-diagnostic", code: "int16-overflow", label: "No 16-bit overflow" },
        { kind: "no-diagnostic", code: "printf-type", label: "The format matches the value's size" },
      ],
      hints: [
        "Read the two warnings under the editor: each names a line and what went wrong.",
        "Storing into a uint32_t does not help if the multiplication already happened in 16 bits. Cast one operand: `(uint32_t)countsPerMicrosecond * microseconds`, or declare the variables as int32_t.",
        "Change `%d` to `%ld` in the format string.",
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
A register packs several settings into one word. This one copies the layout of the PWM control register you will meet later:

- **mode** uses bits 1 to 0 (values 0 to 3)
- **divider** uses bits 12 to 10 (values 0 to 7)
- **enable** uses bit 15 (0 or 1)

All other bits are 0.

Write:
- \`pack(mode, divider, enable)\`: returns the 16-bit word. Mask each argument so a value that is too large cannot spill into another field.
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
        { kind: "var", name: "w1", equals: 0x8c02, label: "pack(2, 3, 1) is 0x8C02" },
        { kind: "var", name: "w2", equals: 0x1c00, label: "pack(0, 7, 0) is 0x1C00" },
        { kind: "var", name: "w3", equals: 0x8403, label: "pack(7, 9, 1) is masked to 0x8403", hint: "7 does not fit in 2 bits and 9 does not fit in 3: AND each argument with its field's mask first." },
        { kind: "var", name: "d1", equals: 3, label: "getDivider(0x8C02) is 3" },
        { kind: "var", name: "d2", equals: 7, label: "getDivider(0xFFFF) is 7" },
      ],
      hints: [
        "For each field: mask the value to the field's width, then shift it to the field's lowest bit. OR the three results.",
        "Masks: 2 bits is 0x3, 3 bits is 0x7, 1 bit is 0x1. Shifts: 0, 10 and 15.",
        "getDivider: `return (word >> 10) & 0x7;`",
      ],
      takeaway: "This is exactly what the compiler does for you when you write `EPwm1Regs.TBCTL.bit.CLKDIV = 3;`. The `.bit` names are shifts and masks with nicer spelling.",
    },
  ],
};
