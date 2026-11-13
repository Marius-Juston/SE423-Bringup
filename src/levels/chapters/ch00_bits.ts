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
A **bit** is one binary digit: a 0 or a 1. The F28379D, the microcontroller on the course board, is controlled through **registers**: small pieces of memory inside the chip whose bits are wired to its hardware. Everything you do with the chip ends up as bits in a register: one bit turns an LED on, three bits pick a clock divider. So you need to move easily between binary, hex and decimal.

## Hex is binary in groups of four
**Binary** writes a number with the digits 0 and 1 only. **Hex** (hexadecimal) counts in sixteens: its digits are 0 to 9, then A to F for ten to fifteen. In C a hex number starts with \`0x\`.

One hex digit is exactly four bits. \`0xA5\` is \`1010 0101\`. Bit numbers start at 0 on the right, and bit n is worth 2 to the power n, so bit 5 alone is \`0x20\` (32).

{{figure:bit-explorer}}

Try it in the figure: click bits and watch each hex digit follow its own four bits, and the decimal value add up from the weights.

## The bit operators
C has operators that work on every bit of a number at once:
- \`a | b\` (OR): a result bit is 1 if it is 1 in \`a\` or in \`b\`
- \`a & b\` (AND): a result bit is 1 only if it is 1 in both
- \`a ^ b\` (XOR): a result bit is 1 if the two bits differ
- \`~a\` (NOT): every bit is flipped
- \`a << n\` and \`a >> n\` (shift): all bits move n places to the left or to the right

## The four mask moves
A **mask** is a number whose 1 bits mark the bits you want to work on. With \`mask = 1 << n\` (a single 1 in position n):
- **set** the bit: \`x |= mask;\`
- **clear** it: \`x &= ~mask;\`
- **toggle** it: \`x ^= mask;\`
- **test** it: \`if (x & mask)\`

{{figure:mask-ops}}

Try it in the figure: pick an operation, click bits of the mask, and see which bits of \`x\` change and which C statement does it.

## Two things that are different on this chip
- An \`int\` is **16 bits** (-32768 to 32767). \`200 * 1000\` does not fit and silently wraps around. Use \`int32_t\`, \`uint32_t\` or a long constant (\`1000L\`) for bigger numbers.
- A \`char\` is also 16 bits, and \`sizeof(char)\` is 1. The smallest piece of memory this CPU can reach on its own is 16 bits, called a **word**.

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

{{figure:bit-explorer}}

Try it in the figure: switch it to two's complement and turn bit 15 on. Its weight becomes -32768, and that is the whole difference between signed and unsigned.

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
A **byte** is 8 bits. Sensors often send a 16-bit reading as two bytes, one after the other. You will do this for real with the motion sensor (IMU) and the laser scanner (LIDAR) later, so build the tools now.

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
A timer on this chip counts 200 times per microsecond. This program works out how many counts make one millisecond (it should be 200000) and prints it on the serial terminal, the text window next to the board.

The first three lines of \`main\` start the chip and its serial port. Leave them as they are.

Run it and look at the terminal and at the messages under the editor. There are **two** separate bugs, and both come from \`int\` being 16 bits on this chip:

- arithmetic between two \`int\` values is done in 16 bits, even if the result is stored in a 32-bit variable;
- \`%d\` prints a 16-bit value. A 32-bit value needs \`%ld\`.

{{figure:int16-overflow}}

Try it in the figure: press the example \`200 * 1000\`, see where the result lands, then make the second operand a long.

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
      bonus: [
        {
          kind: "source",
          mustMatch: "\\bint\\s+countsPerMicrosecond\\b[\\s\\S]*\\bint\\s+microseconds\\b",
          label: "Both inputs are still `int`: the multiplication itself is fixed",
          hint: "Leave the two declarations alone and widen one operand where the multiplication happens.",
        },
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
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?", label: "No `if` and no `?:`: masks do all the limiting" },
        { kind: "max-lines", max: 18, label: "In 18 lines or fewer", hint: "Each function can be a single return statement." },
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
- bits 15 to 12: status flags that are not part of the value

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
      takeaway: "A value narrower than its container needs sign extension before you do arithmetic with it. The 12-bit ADC results and the IMU readings later in the course rely on this.",
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

The function below was tested with two small fields and passed. Used on a 32-bit register it fails.

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
Some devices send the least significant bit first while your code expects the most significant bit first. The fix is to mirror the word: bit 0 becomes bit 15, bit 1 becomes bit 14, and so on.

- \`0x0001\` becomes \`0x8000\`
- \`0xC492\` becomes \`0x4923\`

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
    c = reverse16(0xC492);
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
    c = reverse16(0xC492);
    d = reverse16(0x1234);
    e = reverse16(0xFFFE);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "a", equals: 0x8000, label: "reverse16(0x0001) is 0x8000" },
        { kind: "var", name: "b", equals: 0xa500, label: "reverse16(0x00A5) is 0xA500" },
        { kind: "var", name: "c", equals: 0x4923, label: "reverse16(0xC492) is 0x4923" },
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
      takeaway: "Four swaps do the work of sixteen loop passes. A mask picks every second bit, pair or nibble, so one shift moves all of them at the same time.",
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
- Exactly one pair of inputs has a product that is not a valid Q15 number. Find it and return the largest Q15 value (32767) for it. HW1's \`saturate()\` has the same purpose.

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
        { kind: "max-lines", max: 20, label: "In 20 lines or fewer" },
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
        { kind: "max-lines", max: 40, label: "In 40 lines or fewer" },
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
