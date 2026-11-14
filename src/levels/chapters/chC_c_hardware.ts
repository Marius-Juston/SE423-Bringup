import type { Chapter } from "../types";

// Primer C: the C that register-level code depends on. It assumes primer B
// only (statements, printf, int and float, if, loops, functions, globals,
// #define) and stops where chapter 0 (bits, hex, masks) and chapter 1
// (registers in practice) begin. Every program was run in the simulator.

export const chC: Chapter = {
  id: "primer-c-hardware",
  number: -1,
  label: "C",
  title: "C for hardware",
  blurb: "Memory, arrays, pointers and structs: how C reaches a register.",
  requires: [],
  course: [],
  levels: [
    {
      id: "chw-memory",
      kind: "brief",
      title: "Memory is a row of numbered boxes",
      goal: "See where a variable lives, then answer three questions.",
      refs: [{ course: "L2", slide: 8 }],
      brief: `
A variable has a name and a value. It also has a **place**. This chapter is about that place, because hardware is controlled through places in memory.

## Boxes with numbers on them
**Memory** is where a running program keeps its values. Picture a very long row of boxes. Each box holds one number. Each box also has a number of its own, its **address**. The address says **where**, the value says **what**. Values change all the time. Addresses never do.

When you write \`int count = 3;\` the compiler picks a free box for \`count\` and remembers its address. From then on, \`count\` in your code means "that box".

{{figure:mem-cells}}

Try it in the figure: run the four lines one at a time. Watch which box each line writes to.

## How addresses are written
Addresses are written in a form called hex, which starts with \`0x\`. Chapter 0 teaches it. Until then, treat an address as a label. The ones in this chapter's figures run from \`0x0100\` to \`0x0107\`: read them as the numbers 100 to 107.

## Why you need this
On the robot, an LED, a timer or a motor is controlled by storing a number in one particular box. By the end of this chapter you will be able to read a line such as \`GpioDataRegs.GPASET.bit.GPIO31 = 1;\` and say what every part of it means.
`,
      questions: [
        {
          prompt: "`int a = 7;` and `int b = 2;` are followed by `a = a + b;`. What do the two boxes hold afterwards?",
          options: ["a holds 9, b holds 2", "a holds 9, b holds 0", "a holds 7, b holds 9", "a holds 2, b holds 7"],
          answer: 0,
          why: "The line reads both boxes (7 and 2) and stores the sum in the box of a. Reading a box does not change it, so b still holds 2.",
        },
        {
          prompt: "`count` lives in the box at address `0x0100`. The line `count = count + 1;` runs. Where does `count` live now?",
          options: ["At `0x0101`", "Still at `0x0100`", "At a new free box", "It depends on the new value"],
          answer: 1,
          why: "A variable keeps its box for as long as it exists. Assigning changes the value in the box, never the address.",
        },
        {
          prompt: "`x` is the box at `0x0102` and `y` is the box at `0x0103`. Both hold 5. Then `x = 8;` runs. What is in box `0x0103`?",
          options: ["8", "5", "13", "Nothing"],
          answer: 1,
          why: "The line names x, so only the box at 0x0102 is written. The box next to it keeps its 5.",
        },
      ],
      hints: [
        "Use the figure: each line names the box it writes to on the left of the = sign.",
        "A line changes exactly one box, the one named on the left of =. Every other box keeps its value.",
        "Addresses are fixed. Only values change.",
      ],
      takeaway: "Every variable is a box in memory. Its address says where it is and never changes; its value is what the box holds right now.",
    },
    {
      id: "chw-array",
      kind: "code",
      mode: "complete",
      title: "Arrays: many boxes, one name",
      goal: "Finish a loop that adds up five readings and finds the largest one.",
      refs: [{ course: "HW1" }],
      brief: `
A robot rarely has one reading. It has the last five distances, or 228 points from a laser scanner. One variable per value does not work. An **array** is a row of boxes under one name.

\`\`\`c
int level[4] = {10, 20, 30, 40};   // 4 boxes, filled in order
level[2] = 35;                     // store 35 in one of them
int first = level[0];              // read one of them
\`\`\`

The number in the brackets is the **index**: it says which box. Each box is called an **element**. The index starts at **0**, so the four elements are \`level[0]\` to \`level[3]\`. There is no \`level[4]\`.

{{figure:mem-array}}

Try it in the figure: pick the indexes 0 to 3 and see which box each one means. Keep index 4 for the next level.

## Arrays and loops belong together
The index can be a variable. A \`for\` loop that counts from 0 visits every element:

\`\`\`c
int i;
for (i = 0; i < 4; i++) {    // i++ adds 1 to i
    level[i] = 0;            // level[0], then level[1], ...
}
\`\`\`

## Your task
\`reading\` holds five distances. Fill in the two TODO lines in the loop so that:

- \`total\` ends as the sum of all five readings,
- \`biggest\` ends as the largest reading.

Press **Run** to see what the program prints, then **Run tests**.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["total", "biggest"],
      starter: `int reading[5] = {12, 7, 30, 18, 3};
int total = 0;      // sum of the five readings
int biggest = 0;    // the largest reading

void main(void)
{
    int i;

    for (i = 0; i < 5; i++) {
        // TODO: add reading[i] to total

        // TODO: if reading[i] is larger than biggest, store it in biggest

    }

    printf("total %d, biggest %d\\n", total, biggest);
    while (1) {}
}
`,
      solution: `int reading[5] = {12, 7, 30, 18, 3};
int total = 0;      // sum of the five readings
int biggest = 0;    // the largest reading

void main(void)
{
    int i;

    for (i = 0; i < 5; i++) {
        total = total + reading[i];

        if (reading[i] > biggest) {
            biggest = reading[i];
        }
    }

    printf("total %d, biggest %d\\n", total, biggest);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "total", equals: 70, label: "total is 70", hint: "Inside the loop: `total = total + reading[i];`. The loop runs it once for each index." },
        { kind: "var", name: "biggest", equals: 30, label: "biggest is 30", hint: "Compare `reading[i]` with `biggest`, and copy it over only when it is larger." },
        { kind: "console", includes: "total 70, biggest 30", label: "The program prints: total 70, biggest 30" },
        { kind: "source", mustMatch: "reading\\s*\\[\\s*i\\s*\\]", label: "The loop uses reading[i]", hint: "Do not type the five numbers again. `reading[i]` is the element the loop is at." },
      ],
      hints: [
        "Inside the loop, `reading[i]` is one reading. The loop gives you each of the five in turn.",
        "Sum: `total = total + reading[i];`",
        "Largest: `if (reading[i] > biggest) { biggest = reading[i]; }`",
      ],
      takeaway: "An array is a row of boxes with one name. `name[i]` is the box i places after the first, and i starts at 0. A loop from 0 to length - 1 visits them all.",
    },
    {
      id: "chw-bounds",
      kind: "code",
      mode: "debug",
      title: "One box too far",
      goal: "Find the two loops that leave their array, and fix them.",
      refs: [{ course: "HW1" }],
      brief: `
An array of 4 elements has the indexes 0, 1, 2 and 3. What does C do with \`mark[4]\`?

It does **not** stop you. C never checks an index. It simply goes 4 boxes past the start of the array and uses whatever box is there. That box belongs to something else: usually the next variable.

{{figure:mem-array}}

Try it in the figure: choose index 4 and press **store 0**. Watch \`limit\`.

This is called going **out of range** (or out of bounds). It is one of the most common bugs in C, and a nasty one: no error, no warning, and the damage shows up in a variable that the faulty line never names.

## The usual cause
A loop that runs one step too many. With \`<=\` the index goes 0, 1, 2, 3, 4. With \`<\` it stops at 3:

\`\`\`c
for (i = 0; i <= 4; i++)    // wrong
for (i = 0; i < 4; i++)     // right
\`\`\`

## Your task
This program should store 5 in every element of \`mark\`, then add the four elements up. It should print \`sum 20, limit 100\`.

Run it. \`limit\` is never assigned anywhere, yet it changes, and the sum is wrong too. **Both** loops leave the array. Fix them.

This game is kinder than the chip: it reports the bad index under the editor. On the real board you would get the wrong numbers and nothing else.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["sum", "limit"],
      starter: `int mark[4] = {0, 0, 0, 0};
int limit = 100;    // nothing in this program changes limit on purpose
int sum = 0;

void main(void)
{
    int i;

    // Store 5 in every element of mark
    for (i = 0; i <= 4; i++) {
        mark[i] = 5;
    }

    // Add up the four elements
    for (i = 0; i <= 4; i++) {
        sum = sum + mark[i];
    }

    printf("sum %d, limit %d\\n", sum, limit);
    while (1) {}
}
`,
      solution: `int mark[4] = {0, 0, 0, 0};
int limit = 100;    // nothing in this program changes limit on purpose
int sum = 0;

void main(void)
{
    int i;

    // Store 5 in every element of mark
    for (i = 0; i < 4; i++) {
        mark[i] = 5;
    }

    // Add up the four elements
    for (i = 0; i < 4; i++) {
        sum = sum + mark[i];
    }

    printf("sum %d, limit %d\\n", sum, limit);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "limit", equals: 100, label: "limit is still 100", hint: "The first loop also runs with i = 4. `mark[4]` is the box right after the array, and that box is limit." },
        { kind: "var", name: "sum", equals: 20, label: "sum is 20", hint: "The second loop also reads mark[4], which is the box of limit, and adds it to the sum. It must run over 0, 1, 2, 3 only." },
        { kind: "console", includes: "sum 20, limit 100", label: "The program prints: sum 20, limit 100" },
        { kind: "no-diagnostic", code: "array-bounds", label: "No index leaves the array" },
        { kind: "source", mustNotMatch: "limit\\s*=\\s*100\\s*;[\\s\\S]*limit\\s*=", label: "limit is not patched afterwards", hint: "Do not repair limit after the damage. Stop the loops from leaving the array." },
      ],
      hints: [
        "Write down the values i takes in each loop. Which of them are valid indexes of a 4-element array?",
        "Both loops run i = 0, 1, 2, 3, 4. The first one writes to `mark[4]`, the second one reads it. There is no `mark[4]`.",
        "Both loops should read `for (i = 0; i < 4; i++)`.",
      ],
      takeaway: "C does not check an index. Out of range, you read or overwrite a neighbour, silently. For an array of N elements, loop with `i = 0; i < N`.",
    },
    {
      id: "chw-string",
      kind: "code",
      mode: "complete",
      title: "Characters and strings",
      goal: "Count the characters of a word by looking for the 0 that ends it.",
      refs: [{ course: "L4", slide: 10 }, { course: "Lab 1" }],
      brief: `
Memory holds numbers only. So how does it hold text?

## A character is a small number
Every letter, digit and sign has a number. A \`char\` is a variable type for one such number. Single quotes give you the number of a character without looking it up:

\`\`\`c
char c = 'A';          // the same as: char c = 65;
printf("%c %d\\n", c, c);    // prints: A 65
\`\`\`

\`%c\` prints the value as a character, \`%d\` prints the same value as a number. The table of these numbers is called ASCII; chapter 6 covers it.

## A string is an array of characters that ends in 0
Text is called a **string**. It is an array of \`char\`, one character per box, with one extra box at the end that holds the number 0. The 0 is how every piece of C code knows where the text stops.

\`\`\`c
char word[6] = "robot";     // 5 letters + the closing 0 = 6 boxes
printf("%s\\n", word);       // %s prints characters until it meets the 0
\`\`\`

Double quotes make a string and add the 0 for you. With empty brackets, \`char word[] = "robot";\`, the compiler counts the boxes itself.

{{figure:mem-string}}

Try it in the figure: step the loop through the boxes. Then overwrite the closing 0 and step again.

## Your task
The loop should walk along \`word\` until it reaches the closing 0. Fill in its test and one line of its body so that:

- \`length\` ends as the number of characters in \`word\` (the closing 0 is not counted),
- \`letterC\` ends as how many of them are the letter \`'c'\`.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["length", "letterC"],
      starter: `char word[] = "mechatronics";
int length = 0;     // number of characters, without the closing 0
int letterC = 0;    // how many of them are 'c'

void main(void)
{
    // TODO: replace the 0 in the brackets with the test
    //       "the character word[length] is not the closing 0"
    while (0) {
        // TODO: if this character is 'c', add 1 to letterC

        length = length + 1;    // go on to the next character
    }

    printf("%s: %d characters, %d times c\\n", word, length, letterC);
    while (1) {}
}
`,
      solution: `char word[] = "mechatronics";
int length = 0;     // number of characters, without the closing 0
int letterC = 0;    // how many of them are 'c'

void main(void)
{
    // Runs until it reaches the box that holds 0
    while (word[length] != 0) {
        if (word[length] == 'c') {
            letterC = letterC + 1;
        }
        length = length + 1;
    }

    printf("%s: %d characters, %d times c\\n", word, length, letterC);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "length", equals: 12, label: "length is 12", hint: "`while (0)` never runs. The loop must go on as long as `word[length] != 0`." },
        { kind: "var", name: "letterC", equals: 2, label: "letterC is 2", hint: "Compare with single quotes: `word[length] == 'c'`. Double quotes would be a string, not one character." },
        { kind: "console", includes: "mechatronics: 12 characters, 2 times c", label: "The program prints: mechatronics: 12 characters, 2 times c" },
        { kind: "source", mustMatch: "word\\s*\\[", label: "The program looks at the characters of word" },
      ],
      hints: [
        "`word[length]` is the character the loop is looking at. The loop should go on while that character is not 0.",
        "The loop test is `word[length] != 0`. One character is tested with `if (word[length] == 'c')`. Mind the single quotes.",
        "`while (word[length] != 0) {` and inside it, above the given line: `if (word[length] == 'c') { letterC = letterC + 1; }`",
      ],
      takeaway: "A char is a small number that stands for a character. A string is an array of them closed by a 0, so text of 5 letters needs 6 boxes.",
    },
    {
      id: "chw-sizes",
      kind: "brief",
      title: "How big is a box? Types and their sizes",
      goal: "Learn the fixed-width type names and how much memory each takes on this chip.",
      refs: [{ course: "L4", slide: 5 }, { course: "HW1" }],
      brief: `
A box cannot hold any number you like. On this chip one box is **16 bits**. A bit is a tiny switch that is 0 or 1; chapter 0 is about them. All you need here: 16 bits give 65536 different values, and the **type** of a variable says how many boxes it gets and how those values are used.

- \`int16_t\`: 1 box, whole numbers from -32768 to 32767
- \`uint16_t\`: 1 box, from 0 to 65535. The \`u\` means **unsigned**: no negative numbers, so all 65536 values go to positive ones. Types without the \`u\` are **signed**.
- \`int32_t\`: 2 boxes, about -2 billion to 2 billion
- \`uint32_t\`: 2 boxes, 0 to about 4 billion
- \`float\`: 2 boxes, numbers with a fraction

A value that does not fit is not rejected. A wrong number is stored instead (chapter 0 shows which).

## Why not just int?
On this chip \`int\` is 16 bits. On a PC it is 32 bits. (\`long\` is a second plain name: 32 bits here.) The names above say their size on every machine, so the course code uses them. TI's own files spell them \`Uint16\`, \`int16\`, \`Uint32\`, \`int32\`.

## Two surprises of this chip
- A \`char\` takes a whole 16-bit box here. On a PC it is 8 bits.
- \`sizeof(x)\` gives the size of \`x\` counted in **boxes**: \`sizeof(char)\` is 1 and \`sizeof(int32_t)\` is 2.

## Printing
The placeholder in \`printf\` must match the size: \`%d\` for a 16-bit value, \`%u\` for an unsigned 16-bit value, \`%ld\` for a 32-bit value (the l is a small L, for long).

\`\`\`c
int32_t steps = 100000;
printf("%ld\\n", steps);     // %d would print a wrong number
\`\`\`
`,
      questions: [
        {
          prompt: "A program declares `int32_t a;`, `float b;` and `char c;`. How many boxes of memory do the three take together on this chip?",
          options: ["3", "4", "5", "9"],
          answer: 2,
          why: "An int32_t takes 2 boxes, a float takes 2, and a char takes 1 whole box on this chip: 2 + 2 + 1 = 5.",
        },
        {
          prompt: "A counter goes from 0 up to 50000 and is never negative. Which type holds it in a single box?",
          options: ["`int16_t`", "`uint16_t`", "`char`", "`float`"],
          answer: 1,
          why: "An int16_t ends at 32767. A uint16_t gives up the negative numbers and reaches 65535, still in one box.",
        },
        {
          prompt: "`int32_t distance = 250000;` Which line prints it correctly on this chip?",
          options: ['`printf("%d\\n", distance);`', '`printf("%ld\\n", distance);`', '`printf("%c\\n", distance);`', '`printf("%s\\n", distance);`'],
          answer: 1,
          why: "A 32-bit value needs %ld. With %d, printf looks at only one of its two boxes and prints a wrong number.",
        },
        {
          prompt: "What is `sizeof(float)` on this chip?",
          options: ["1", "2", "4", "32"],
          answer: 1,
          why: "A float is 32 bits, which is two 16-bit boxes, and sizeof counts boxes here. On a PC the answer would be 4, because a PC counts 8-bit pieces.",
        },
      ],
      hints: [
        "Count boxes: 16-bit types take one, 32-bit types and float take two.",
        "The `u` in front of a type name removes the negative half and doubles the positive range.",
        "16-bit value: `%d`. 32-bit value: `%ld`. sizeof counts 16-bit boxes on this chip.",
      ],
      takeaway: "One box is 16 bits. int16_t, uint16_t and char take one box; int32_t, uint32_t and float take two. Print 16-bit values with %d and 32-bit values with %ld.",
    },
    {
      id: "chw-pointer",
      kind: "brief",
      title: "Pointers: a variable that holds an address",
      goal: "Follow a pointer step by step, then trace three short programs.",
      refs: [{ course: "HW1" }],
      brief: `
Sometimes code must work on a variable it cannot name: a function that should change a variable of yours, or a line that should reach whatever box sits at a given address (a hardware register). C does this with addresses.

## Two new operators
- \`&x\` is **the address of x**: where x lives.
- \`*p\` is **the box that p points to**.

## A pointer
A **pointer** is a variable whose value is an address. You declare one with a star:

\`\`\`c
int x = 5;
int *p;      // p can hold the address of an int
p = &x;      // p now holds the address of x: "p points to x"
\`\`\`

Now \`*p\` and \`x\` are two ways to reach the same box:

\`\`\`c
int y = *p;  // read the box p points to: y becomes 5
*p = 9;      // write to the box p points to: x becomes 9
\`\`\`

The star has two jobs. In a declaration (\`int *p;\`) it says "p is a pointer". Everywhere else (\`*p\`) it says "follow p to the box it points to".

{{figure:mem-pointer}}

Try it in the figure: run the program line by line. Before each line, guess which box will change. The arrow is only a picture: what p really holds is a number, the address.

A pointer that was never given an address points nowhere useful. Using \`*p\` then reads or overwrites some unknown box.
`,
      questions: [
        {
          prompt: "`int a = 4; int b = 6; int *p = &a;` Then `*p = b;` runs. What do a and b hold?",
          options: ["a = 4, b = 6", "a = 6, b = 6", "a = 6, b = 4", "a = 4, b = 4"],
          answer: 1,
          why: "p points to a, so `*p = b;` stores the value of b (6) in the box of a. b is only read.",
        },
        {
          prompt: "`int a = 1; int b = 2; int *p = &a; p = &b; *p = 10;` What do a and b hold at the end?",
          options: ["a = 10, b = 2", "a = 10, b = 10", "a = 1, b = 10", "a = 1, b = 2"],
          answer: 2,
          why: "`p = &b;` makes p point to b before anything is written. `*p = 10;` therefore writes to b. a was never touched.",
        },
        {
          prompt: "p points to x. Which line changes where p points, and leaves x alone?",
          options: ["`*p = 0;`", "`p = &y;`", "`x = *p;`", "`*p = y;`"],
          answer: 1,
          why: "Without a star, `p = ...` assigns to p itself: a new address. With a star, `*p = ...` writes to the box p points to, which is x.",
        },
      ],
      hints: [
        "Draw the boxes, or use the figure. For every line, ask: is there a star in front of p on the left of the = sign?",
        "`p = &b;` changes the arrow. `*p = 10;` follows the arrow and changes the box at its end.",
        "A line changes one box: p's own box when it starts with `p =`, the pointed-to box when it starts with `*p =`.",
      ],
      takeaway: "`&x` is where x lives. A pointer holds such an address. `*p` is the box p points to: reading it reads that box, assigning to it writes that box.",
    },
    {
      id: "chw-pointer-param",
      kind: "code",
      mode: "write",
      title: "A function that changes your variable",
      goal: "Write a function that adds points to whichever score it is pointed at.",
      refs: [{ course: "HW1" }],
      brief: `
Here is why pointers exist. When you call a function, each parameter is a **copy** of the value you passed. The function can change its copy as much as it likes. Your variable never notices.

\`\`\`c
void reset(int count)
{
    count = 0;          // changes the copy only
}

int laps = 12;
reset(laps);            // laps is still 12
\`\`\`

To let a function change your variable, pass it the **address** of the variable. The function receives a pointer and writes through it:

\`\`\`c
void resetAt(int *count)    // count is a pointer to an int
{
    *count = 0;             // writes to the caller's variable
}

int laps = 12;
resetAt(&laps);             // pass where laps lives: laps is now 0
\`\`\`

The address is still passed as a copy. But a copy of an address leads to the same box.

You will meet this pattern all through the course code. For example \`init_serialSCIA(&SerialA, 115200);\` hands a function the address of the variable \`SerialA\`, so that the function can fill it in.

## Your task
Write the body of \`addBonus\`. It gets a pointer to a score and a number of points, and adds the points to that score.

\`main\` is given. It calls your function three times, on two different variables.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["red", "blue"],
      starter: `int red = 10;
int blue = 40;

// Adds bonus to the variable that score points to
void addBonus(int *score, int bonus)
{
    // TODO
}

void main(void)
{
    addBonus(&red, 5);
    addBonus(&blue, 20);
    addBonus(&red, 1);

    printf("red %d, blue %d\\n", red, blue);
    while (1) {}
}
`,
      solution: `int red = 10;
int blue = 40;

// Adds bonus to the variable that score points to
void addBonus(int *score, int bonus)
{
    *score = *score + bonus;
}

void main(void)
{
    addBonus(&red, 5);
    addBonus(&blue, 20);
    addBonus(&red, 1);

    printf("red %d, blue %d\\n", red, blue);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "red", equals: 16, label: "red is 16 (10 + 5 + 1)", hint: "Write through the pointer: `*score = ...`. Without the star you only change the function's own copy of the address." },
        { kind: "var", name: "blue", equals: 60, label: "blue is 60 (40 + 20)", hint: "The function must not name red or blue. It works on whatever `score` points to." },
        { kind: "console", includes: "red 16, blue 60", label: "The program prints: red 16, blue 60" },
        { kind: "source", mustMatch: "\\*\\s*score\\s*(\\+=|=)", label: "addBonus writes through the pointer score" },
      ],
      hints: [
        "Inside the function, `*score` is the caller's variable: red in the first call, blue in the second.",
        "Read it and write it back: the new value is the old value plus `bonus`.",
        "`*score = *score + bonus;`",
      ],
      takeaway: "Parameters are copies. To let a function change a variable of its caller, pass `&variable` and let the function write to `*parameter`.",
    },
    {
      id: "chw-array-param",
      kind: "code",
      mode: "write",
      title: "Passing an array to a function",
      goal: "Write a function that finds the largest element of any int array.",
      refs: [{ course: "HW1" }],
      brief: `
Arrays and pointers are close relatives. The name of an array, used without brackets, **is the address of its first element**. So when you pass an array to a function, no boxes are copied. The function receives a pointer to the first box.

Brackets work on a pointer exactly as they do on an array: \`v[i]\` is the box i places after the one \`v\` points to.

\`\`\`c
// Stores 0 in the first n elements that v points to
void clear(int *v, int n)
{
    int i;
    for (i = 0; i < n; i++) {
        v[i] = 0;
    }
}

int level[4] = {10, 20, 30, 40};
clear(level, 4);        // no & needed: level already is an address
\`\`\`

Two things follow:

- The function works on the **caller's** array, not on a copy. \`clear\` really clears \`level\`.
- A pointer says where the array starts, not where it ends. The function cannot find out the length, so you pass it as a second parameter. Pass the wrong length and the loop runs out of range.

## Your task
Write \`largest(v, n)\`. It returns the largest of the first \`n\` elements that \`v\` points to.

\`main\` is given. It tries your function on two arrays of different lengths. Look at the second one before you choose a starting value.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["bigDay", "bigNight"],
      starter: `int day[5] = {21, 19, 30, 24, 26};
int night[3] = {-4, -9, -2};
int bigDay;
int bigNight;

// Returns the largest of the n elements that v points to
int largest(int *v, int n)
{
    // TODO
    return 0;
}

void main(void)
{
    bigDay = largest(day, 5);
    bigNight = largest(night, 3);

    printf("day %d, night %d\\n", bigDay, bigNight);
    while (1) {}
}
`,
      solution: `int day[5] = {21, 19, 30, 24, 26};
int night[3] = {-4, -9, -2};
int bigDay;
int bigNight;

// Returns the largest of the n elements that v points to
int largest(int *v, int n)
{
    int i;
    int best = v[0];

    for (i = 1; i < n; i++) {
        if (v[i] > best) {
            best = v[i];
        }
    }
    return best;
}

void main(void)
{
    bigDay = largest(day, 5);
    bigNight = largest(night, 3);

    printf("day %d, night %d\\n", bigDay, bigNight);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "bigDay", equals: 30, label: "largest(day, 5) returns 30", hint: "Loop i from 0 to n - 1 and compare `v[i]` with the best value found so far." },
        { kind: "var", name: "bigNight", equals: -2, label: "largest(night, 3) returns -2", hint: "All three values are negative. If your best value starts at 0, nothing beats it. Start with `v[0]`." },
        { kind: "console", includes: "day 30, night -2", label: "The program prints: day 30, night -2" },
        { kind: "source", mustNotMatch: "<\\s*[35]\\b", label: "The loop runs to n, not to a fixed length", hint: "The function is used on arrays of 5 and of 3 elements. Its loop must stop at `n`." },
      ],
      hints: [
        "Keep the best value so far in a local variable, and loop over the elements with `v[i]`.",
        "Start with `int best = v[0];` so that the function also works when every element is negative.",
        "`for (i = 1; i < n; i++) { if (v[i] > best) { best = v[i]; } }` and then `return best;`",
      ],
      takeaway: "An array's name is the address of its first element. A function gets that address plus the length, and `v[i]` reaches the caller's own boxes.",
    },
    {
      id: "chw-struct",
      kind: "code",
      mode: "complete",
      title: "Structs: several values in one variable",
      goal: "Read and change the members of two struct variables.",
      refs: [{ course: "Lab 1" }],
      brief: `
An array groups values of the same kind and numbers them. Often you want the opposite: a few **different** values that belong together, each with a name. A motor has a speed, a turn count and an on/off state. That is a **struct**.

First you describe the new type. This creates no variable yet:

\`\`\`c
struct Motor {
    int speed;
    int turns;
    int on;
};              // the ; after the brace is required
\`\`\`

Then you make variables of that type. Each one gets a box per **member** (the named parts), side by side. A dot picks a member:

\`\`\`c
struct Motor left;                  // three boxes
struct Motor right = {50, 7, 0};    // filled in the order of the members

left.speed = 20;
left.turns = left.turns + 1;
\`\`\`

\`left.speed\` is an ordinary \`int\` variable. You can use it wherever you could use one.

{{figure:mem-struct}}

Try it in the figure: reach the members through \`left.\` and \`right.\`. Leave \`p->\` for the next level.

## Your task
A \`struct Tank\` describes a tank: how much is in it (\`level\`) and how much fits (\`capacity\`). Two tanks exist: \`fuel\` and \`water\`. In \`main\`:

1. Store in \`fuelRoom\` how much more fits into \`fuel\`.
2. Store in \`waterRoom\` how much more fits into \`water\`.
3. Fill \`water\` to the top: set its \`level\` to its \`capacity\`.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["fuelRoom", "waterRoom"],
      starter: `struct Tank {
    int level;       // how much is in the tank
    int capacity;    // how much fits
};

struct Tank fuel = {30, 80};
struct Tank water = {55, 60};
int fuelRoom;     // how much more fits into fuel
int waterRoom;    // how much more fits into water

void main(void)
{
    // TODO 1: fuelRoom = capacity of fuel minus level of fuel

    // TODO 2: the same for water

    // TODO 3: fill water to the top

    printf("room: fuel %d, water %d\\n", fuelRoom, waterRoom);
    printf("water is at %d of %d\\n", water.level, water.capacity);
    while (1) {}
}
`,
      solution: `struct Tank {
    int level;       // how much is in the tank
    int capacity;    // how much fits
};

struct Tank fuel = {30, 80};
struct Tank water = {55, 60};
int fuelRoom;     // how much more fits into fuel
int waterRoom;    // how much more fits into water

void main(void)
{
    fuelRoom = fuel.capacity - fuel.level;

    waterRoom = water.capacity - water.level;

    water.level = water.capacity;

    printf("room: fuel %d, water %d\\n", fuelRoom, waterRoom);
    printf("water is at %d of %d\\n", water.level, water.capacity);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "fuelRoom", equals: 50, label: "fuelRoom is 50", hint: "`fuel.capacity - fuel.level`. The variable name comes first, then a dot, then the member." },
        { kind: "var", name: "waterRoom", equals: 5, label: "waterRoom is 5", hint: "Work it out before you fill the tank, from `water.capacity` and `water.level`." },
        { kind: "console", includes: "water is at 60 of 60", label: "The program prints: water is at 60 of 60", hint: "Assign to the member: `water.level = water.capacity;`" },
        { kind: "source", mustMatch: "fuel\\s*\\.\\s*capacity[\\s\\S]*water\\s*\\.\\s*capacity", label: "The values come from the struct members, not from typed numbers" },
      ],
      hints: [
        "A member is written `variable.member`, for example `fuel.level`.",
        "`fuelRoom = fuel.capacity - fuel.level;` and the same line with `water` for the second task.",
        "Task 3: `water.level = water.capacity;`",
      ],
      takeaway: "A struct type describes a group of named members. Every variable of that type has its own boxes for them, and `variable.member` reaches one.",
    },
    {
      id: "chw-arrow",
      kind: "code",
      mode: "write",
      title: "Pointer to a struct: the arrow",
      goal: "Write a function that fills any tank, given a pointer to it.",
      refs: [{ course: "Lab 1" }],
      brief: `
A function that works on any motor or any tank needs to be told which one. As with \`addBonus\`, you pass an address, and the function gets a pointer: this time a pointer to a struct.

\`\`\`c
struct Motor *m;     // m can hold the address of a struct Motor
m = &left;           // m points to left
\`\`\`

To reach a member through the pointer you would have to write \`(*m).speed\`: follow the pointer, then take the member. That is clumsy, so C has a shorter spelling for exactly this, the **arrow**:

\`\`\`c
m->speed = 0;        // the same as (*m).speed = 0;
\`\`\`

The rule: a **dot** after a struct variable, an **arrow** after a pointer to a struct.

\`\`\`c
void stop(struct Motor *m)
{
    m->speed = 0;
    m->on = 0;
}

stop(&left);         // stops left
stop(&right);        // the same code stops right
\`\`\`

{{figure:mem-struct}}

Try it in the figure: choose \`p->\`, then point p at the other motor and run the same line again.

## Your task
Write the body of \`fill(t, amount)\`. It adds \`amount\` to the \`level\` of the tank that \`t\` points to. A tank cannot hold more than its \`capacity\`: if the level would go above it, set the level to the capacity.

\`main\` is given. It fills two tanks and copies the results into the variables the tests read.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["fuelLevel", "waterLevel"],
      starter: `struct Tank {
    int level;       // how much is in the tank
    int capacity;    // how much fits
};

struct Tank fuel = {30, 80};
struct Tank water = {55, 60};
int fuelLevel;
int waterLevel;

// Adds amount to the tank t points to, but never above its capacity
void fill(struct Tank *t, int amount)
{
    // TODO
}

void main(void)
{
    fill(&fuel, 40);     // 30 + 40 fits
    fill(&water, 25);    // 55 + 25 does not fit: stops at 60

    fuelLevel = fuel.level;
    waterLevel = water.level;
    printf("fuel %d, water %d\\n", fuelLevel, waterLevel);
    while (1) {}
}
`,
      solution: `struct Tank {
    int level;       // how much is in the tank
    int capacity;    // how much fits
};

struct Tank fuel = {30, 80};
struct Tank water = {55, 60};
int fuelLevel;
int waterLevel;

// Adds amount to the tank t points to, but never above its capacity
void fill(struct Tank *t, int amount)
{
    t->level = t->level + amount;
    if (t->level > t->capacity) {
        t->level = t->capacity;
    }
}

void main(void)
{
    fill(&fuel, 40);     // 30 + 40 fits
    fill(&water, 25);    // 55 + 25 does not fit: stops at 60

    fuelLevel = fuel.level;
    waterLevel = water.level;
    printf("fuel %d, water %d\\n", fuelLevel, waterLevel);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "fuelLevel", equals: 70, label: "fuel ends at 70", hint: "`t->level = t->level + amount;`. t is a pointer, so the members are reached with `->`. 60 means the limit is a typed number: use `t->capacity`." },
        { kind: "var", name: "waterLevel", equals: 60, label: "water stops at its capacity, 60", hint: "After adding, compare `t->level` with `t->capacity` and cut it back if it is larger." },
        { kind: "console", includes: "fuel 70, water 60", label: "The program prints: fuel 70, water 60" },
        { kind: "source", mustMatch: "t\\s*->\\s*level|\\(\\s*\\*\\s*t\\s*\\)\\s*\\.\\s*level", label: "fill reaches the tank through its pointer t", hint: "Do not name fuel or water inside fill. Use `t->level` and `t->capacity`." },
      ],
      hints: [
        "Inside `fill`, the tank's members are `t->level` and `t->capacity`.",
        "First add: `t->level = t->level + amount;`",
        "Then limit: `if (t->level > t->capacity) { t->level = t->capacity; }`",
      ],
      takeaway: "Use a dot after a struct variable and an arrow after a pointer to a struct. `p->member` means: go to the struct p points to, then take that member.",
    },
    {
      id: "chw-register",
      kind: "brief",
      title: "A register is a variable the hardware shares",
      goal: "See how a struct placed at a fixed address becomes the handle on a piece of hardware.",
      refs: [{ course: "L2", slide: [8, 10] }, { trm: "3.6.1" }, { trm: "8.9" }],
      brief: `
Everything so far was about your own variables. Now the step to hardware, and it is a small one.

A **peripheral** is a block of hardware built into the chip: the pins, a timer, a serial port. A **register** is a memory box that is wired to a peripheral. It differs from your variables in two ways:

- Its **address is fixed** by the people who designed the chip. Your variables go wherever the compiler finds room.
- The **hardware uses the box too**. Store a number in it and the hardware does something. Or the hardware stores a number, and you read what happened.

C has no special feature for registers. TI describes the registers of each peripheral as a struct and places one struct variable exactly on those boxes. Here is a made-up lamp peripheral:

\`\`\`c
struct LAMP_REGS {
    uint16_t ON;         // 1 switches the lamp on
    uint16_t LEVEL;      // brightness, 1 to 3
    uint16_t PRESSES;    // how often its button was pressed
};
\`\`\`

\`LampRegs\` is a variable of this type, placed at address 0x7000. So \`LampRegs.ON = 1;\` is a plain assignment to a struct member, and the lamp lights.

{{figure:mem-register}}

Try it in the figure: write the registers as the program, then press the push button as the hardware and watch a box change by itself.

## The real thing
\`GpioDataRegs\` is a struct variable placed at address 0x7F00, on the registers that drive the chip's pins. \`GPASET\` is one of its members. \`CpuTimer0Regs\` is another such variable, placed on a timer, with a member \`TIM\` that the timer changes all the time.
`,
      questions: [
        {
          prompt: "To the C compiler, what kind of line is `LampRegs.LEVEL = 3;`?",
          options: ["A call of a function named LampRegs", "An assignment to a member of a struct variable", "A special hardware command", "A comparison"],
          answer: 1,
          why: "It is the same dot and the same = as in `water.level = 60;`. It reaches hardware only because of where the struct variable is placed in memory.",
        },
        {
          prompt: "A program reads `LampRegs.PRESSES` twice in a row and stores nothing in between. Can the two values differ?",
          options: ["No, a variable only changes when the program assigns to it", "Yes, the hardware may have changed the box in between", "Yes, but only if the lamp is on", "No, registers are constants"],
          answer: 1,
          why: "A register is shared with the hardware. The button's circuit writes PRESSES whenever a press happens, whatever the program is doing.",
        },
        {
          prompt: "In `CpuTimer0Regs.TIM`, what are the two names?",
          options: [
            "`CpuTimer0Regs` is a function and `TIM` is its parameter",
            "`CpuTimer0Regs` is an array and `TIM` is an index",
            "`CpuTimer0Regs` is a struct variable placed on the timer's registers and `TIM` is one of its members",
            "`CpuTimer0Regs` is a type and `TIM` is a variable of that type",
          ],
          answer: 2,
          why: "A dot after a name means: a struct variable, then one of its members. The member's box is one of the timer's registers.",
        },
      ],
      hints: [
        "Compare with the tank levels: `water.level = 60;` and `LampRegs.LEVEL = 3;` have the same shape.",
        "In the figure, press the push button and see which box changes without any program line running.",
        "A register is a memory box at a fixed address that the hardware also reads or writes. The struct only gives the boxes names.",
      ],
      takeaway: "A register is a memory box at a fixed address that hardware reads or changes. A struct placed on those boxes names them, so `GpioDataRegs.GPASET` is simply variable.member.",
    },
    {
      id: "chw-union",
      kind: "quiz",
      title: "One box, many settings: .bit and .all",
      goal: "Read the real register line from the start of the chapter, part by part.",
      refs: [{ course: "L2", slide: [10, 13] }, { trm: "3.6.1" }, { trm: "8.9" }],
      brief: `
One line is still unexplained: the \`.bit.GPIO31\` in \`GpioDataRegs.GPASET.bit.GPIO31 = 1;\`.

Hardware packs several small settings into one box. An on/off setting needs only 1 of the box's 16 bits. Two C features deal with that.

## Bit fields
A struct member can be given a width in bits. Such a member is a **bit field**:

\`\`\`c
struct CTRL_BITS {
    uint16_t ON:1;       // 1 bit: 0 or 1
    uint16_t MODE:2;     // 2 bits: 0 to 3
    uint16_t LEVEL:4;    // 4 bits: 0 to 15
    uint16_t rsvd:9;     // the rest: reserved, not used
};
\`\`\`

All four share **one** box. Assigning to \`MODE\` changes its 2 bits and nothing else.

## Unions
A **union** looks like a struct, but its members do not sit side by side. They all lie on the **same** boxes: two descriptions of one piece of memory.

\`\`\`c
union CTRL_REG {
    uint16_t all;             // the whole box as one number
    struct CTRL_BITS bit;     // the same box, as named fields
};
\`\`\`

If \`LampRegs\` has a member \`CTRL\` of this type, then \`LampRegs.CTRL.bit.MODE = 2;\` sets one field and \`LampRegs.CTRL.all = 0;\` sets the whole box at once.

{{figure:mem-union}}

Try it in the figure: change one field and watch \`.all\` follow.

TI declares every register this way. So read the real line from left to right: the struct variable \`GpioDataRegs\`, its member \`GPASET\` (a union), the view \`bit\`, the field \`GPIO31\`. Chapter 1 practises it.
`,
      questions: [
        {
          prompt: "In `GpioDataRegs.GPASET.bit.GPIO31 = 1;`, what is `GPIO31`?",
          options: ["A struct variable at a fixed address", "A bit field, one bit wide, inside the register GPASET", "A function that switches a pin", "An index into an array of pins"],
          answer: 1,
          why: "Reading from the left: variable, member (the register, a union), the view called bit, and finally one named bit field of that view.",
        },
        {
          prompt: "How many boxes does a variable of type `union CTRL_REG` take?",
          options: ["1: `all` and `bit` lie on the same box", "2: one for `all` and one for `bit`", "5: one per name", "16: one per bit"],
          answer: 0,
          why: "The members of a union share their memory. `all` is 16 bits and the four bit fields add up to 16 bits: the same single box.",
        },
        {
          prompt: "`LampRegs.CTRL.bit.ON = 0;` runs. No other line touches the register. Does `LampRegs.CTRL.all` change?",
          options: ["No, `.all` is a separate variable", "Yes, `.all` is the same bits read as one number", "Only if `.all` is assigned too", "It becomes 0"],
          answer: 1,
          why: "There is one box. Changing a field changes bits of that box, and `.all` reads those same bits.",
        },
        {
          prompt: "Which line sets every setting of the register in a single write?",
          options: ["`LampRegs.CTRL.bit.MODE = 2;`", "`LampRegs.CTRL.all = 45;`", "`LampRegs.CTRL = MODE;`", "`LampRegs.bit.all = 2;`"],
          answer: 1,
          why: "`.all` is the whole box. `.bit.NAME` changes one field and leaves the others as they are.",
        },
      ],
      hints: [
        "Read a dotted name from left to right. Each dot goes one step further inside.",
        "A union does not add boxes: its members are different views of the same memory.",
        "`.all` is the whole register as one number, `.bit.NAME` is one named group of its bits.",
      ],
      takeaway: "`GpioDataRegs.GPASET.bit.GPIO31` is: struct variable, member (a union), the bit-field view, one field. `.all` and `.bit` are two views of the same box.",
    },
    {
      id: "chw-qualifiers",
      kind: "quiz",
      title: "Two promises: const and volatile",
      goal: "Decide which variables need the word const, the word volatile, or neither.",
      refs: [{ course: "L3", slide: 22, note: "volatile in the pin mux code" }, { course: "Lab 1" }],
      brief: `
Two words can stand in front of a type. Each one tells the compiler a fact about the variable that it cannot see by itself.

## const: the program will not change this
\`\`\`c
const float WHEEL_RADIUS = 0.03;
\`\`\`
The value is set once, where the variable is declared. A real compiler then refuses any line that assigns to it. Use it for values that must stay fixed, such as a table of settings.

## volatile: something else may change this
The compiler assumes that a variable only changes when your code assigns to it. It uses that to save work. Look at this loop, which waits for an event:

\`\`\`c
int done = 0;

while (done == 0) {
    // nothing
}
\`\`\`

Nothing inside the loop changes \`done\`. So the compiler may read the box **once**, find 0, and then loop forever without looking again.

But \`done\` might be changed from outside the loop:

- by **hardware**, if the box is a register,
- by an **interrupt function**: a function that the hardware calls by itself, in the middle of your program, when something happens (chapter 5).

\`volatile\` tells the compiler exactly that:

\`\`\`c
volatile int done = 0;      // really read the box every single time
\`\`\`

TI's files declare every register struct \`volatile\`. You must add it yourself to any global variable that an interrupt function writes and the main program reads.

It makes no promise in the other direction: a \`volatile\` variable can still be assigned by your code.
`,
      questions: [
        {
          prompt: "A timer's interrupt function sets a global `tick` to 1. The main loop waits with `while (tick == 0) { }`. How should `tick` be declared?",
          options: ["`const int tick = 0;`", "`volatile int tick = 0;`", "`int tick = 0;` inside main", "`float tick = 0;`"],
          answer: 1,
          why: "It changes behind the main loop's back. Without volatile the compiler may read it once and never notice the 1.",
        },
        {
          prompt: "`const int LIMIT = 100;` Which line does a real compiler refuse?",
          options: ["`x = LIMIT + 1;`", "`if (x > LIMIT) { x = LIMIT; }`", "`LIMIT = 200;`", '`printf("%d\\n", LIMIT);`'],
          answer: 2,
          why: "Reading a const variable is always fine. Assigning to it breaks the promise, so the compiler stops with an error.",
        },
        {
          prompt: "Why are register structs such as `GpioDataRegs` declared volatile?",
          options: ["So that the program cannot write them", "Because the hardware can change them at any time, so every read must really happen", "To make them take less memory", "Because they are 32 bits wide"],
          answer: 1,
          why: "A register is shared with hardware. A value read a moment ago may already be out of date.",
        },
        {
          prompt: "Which variable needs neither word?",
          options: [
            "A loop counter `i` that only its own function uses",
            "A flag that an interrupt function sets",
            "A table of fixed motor settings",
            "A struct placed on a peripheral's registers",
          ],
          answer: 0,
          why: "Only the function's own code changes i, and it does change, so neither promise applies. Most variables are like this.",
        },
      ],
      hints: [
        "Ask two questions about the variable. Does my code ever change it? Can something other than the code in front of me change it?",
        "Never changed by anyone: const. Changed by hardware or by an interrupt function: volatile.",
        "volatile is for variables that change behind the program's back. const is for values that never change.",
      ],
      takeaway: "const: the program will not change this. volatile: something else may change this, so read it for real every time. Registers and flags set by interrupt functions are volatile.",
    },
    {
      id: "chw-static",
      kind: "code",
      mode: "debug",
      title: "A local variable that remembers",
      goal: "Find out why a counter inside a function never gets past 1, and fix it.",
      refs: [{ course: "Lab 1" }],
      brief: `
A local variable is created when its function starts and thrown away when the function returns. At the next call it starts again from scratch. Usually that is what you want. A counter is the exception:

\`\`\`c
int nextTicket(void)
{
    int number = 0;       // set to 0 at EVERY call
    number = number + 1;
    return number;        // always 1
}
\`\`\`

Put the word \`static\` in front and the variable keeps its box, and its value, from one call to the next. The \`= 0\` is then done only **once**, before the program starts:

\`\`\`c
int nextTicket(void)
{
    static int number = 0;    // set to 0 once
    number = number + 1;
    return number;            // 1, then 2, then 3, ...
}
\`\`\`

A global variable would remember too, but every function could change it. A \`static\` local is still private to its function.

On the robot this matters for interrupt functions (chapter 5). A timer calls such a function, say, 1000 times a second, and the function counts its own calls to do something every 250th time.

## Your task
\`everyThird()\` stands in for such a function. It should return 1 on every third call and 0 otherwise. \`main\` calls it 9 times and adds up the results, so \`flashes\` should end as 3.

Run it: \`flashes\` stays 0. Fix \`everyThird\`. Its counter must stay inside the function.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["flashes"],
      starter: `int flashes = 0;    // how many times the function said "now"

// Returns 1 on every third call, otherwise 0
int everyThird(void)
{
    int calls = 0;

    calls = calls + 1;
    if (calls == 3) {
        calls = 0;
        return 1;
    }
    return 0;
}

void main(void)
{
    int tick;

    for (tick = 0; tick < 9; tick++) {
        flashes = flashes + everyThird();
    }

    printf("flashes: %d\\n", flashes);
    while (1) {}
}
`,
      solution: `int flashes = 0;    // how many times the function said "now"

// Returns 1 on every third call, otherwise 0
int everyThird(void)
{
    static int calls = 0;

    calls = calls + 1;
    if (calls == 3) {
        calls = 0;
        return 1;
    }
    return 0;
}

void main(void)
{
    int tick;

    for (tick = 0; tick < 9; tick++) {
        flashes = flashes + everyThird();
    }

    printf("flashes: %d\\n", flashes);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "flashes", equals: 3, label: "flashes is 3", hint: "`int calls = 0;` runs at every call, so calls is 1 each time and never reaches 3." },
        { kind: "console", includes: "flashes: 3", label: "The program prints: flashes: 3" },
        { kind: "source", mustMatch: "tick\\s*<\\s*9[\\s\\S]*everyThird\\s*\\(\\s*\\)", label: "main still calls everyThird 9 times" },
      ],
      bonus: [
        { kind: "source", mustMatch: "\\{[^}]*static\\s+int\\s+calls", label: "The counter is a static local: no other function can touch it", hint: "Moving `calls` out of the function makes it a global, which works but lets any code change it. Add `static` instead." },
      ],
      hints: [
        "Follow `calls` through two calls of the function. What value does it have at the start of the second call?",
        "The line `int calls = 0;` runs every time. The variable must keep its value between calls.",
        "`static int calls = 0;`",
      ],
      takeaway: "A static local keeps its value between calls and is initialised once. It is the private memory of a function: ideal for a counter inside an interrupt function.",
    },
    {
      id: "chw-casts",
      kind: "code",
      mode: "debug",
      title: "When 1/2 is 0: mixing int and float",
      goal: "Fix two formulas that lose their fraction before the float ever sees it.",
      refs: [{ course: "HW1" }],
      brief: `
You know that dividing two \`int\` values drops the fraction: \`7 / 2\` is 3. The trap is that this also happens **inside** a formula whose result is a float.

C works out a formula one operation at a time. For each operation it looks only at the two values involved:

- int with int gives an int (a division drops the fraction),
- if either one is a float, the other is converted to float first and the result is a float.

Where the result will be stored plays no part.

\`\`\`c
float x = 3.0;
float a = 1 / 2 * x;      // 1 / 2 is done first, in int: 0. Then 0 * x = 0.0
float b = 1.0 / 2 * x;    // 1.0 / 2 is 0.5. Then 0.5 * x = 1.5
float c = x / 2;          // x is a float: 1.5
\`\`\`

A number written with a decimal point, such as \`1.0\`, is a float. For a variable you use a **cast**: a type in round brackets in front of a value converts it for that one use.

\`\`\`c
int sum = 7;
int count = 2;
float mean = (float)sum / count;    // 7.0 / 2 = 3.5
\`\`\`

The other direction loses information: storing a float in an int drops the fraction. \`int n = 3.9;\` stores 3.

## Your task
Two functions return wrong results:

- \`toVolts(raw)\` turns a sensor reading from 0 to 4095 into 0.0 to 3.0 volts.
- \`mean(sum, count)\` divides a sum by a count.

Run the program and compare with the expected values in the comments. Fix both formulas. Do not change the parameter types.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["v1", "v2", "m1", "m2"],
      starter: `float v1, v2;
float m1, m2;

// raw goes from 0 to 4095. 4095 means 3.0 volts.
float toVolts(int raw)
{
    return raw / 4095 * 3.0;
}

float mean(int sum, int count)
{
    return sum / count;
}

void main(void)
{
    v1 = toVolts(1365);    // expected 1.0
    v2 = toVolts(2730);    // expected 2.0
    m1 = mean(7, 2);       // expected 3.5
    m2 = mean(10, 4);      // expected 2.5

    // %.2f prints a float with two digits after the point
    printf("%.2f %.2f %.2f %.2f\\n", v1, v2, m1, m2);
    while (1) {}
}
`,
      solution: `float v1, v2;
float m1, m2;

// raw goes from 0 to 4095. 4095 means 3.0 volts.
float toVolts(int raw)
{
    return raw * 3.0 / 4095;
}

float mean(int sum, int count)
{
    return (float)sum / count;
}

void main(void)
{
    v1 = toVolts(1365);    // expected 1.0
    v2 = toVolts(2730);    // expected 2.0
    m1 = mean(7, 2);       // expected 3.5
    m2 = mean(10, 4);      // expected 2.5

    // %.2f prints a float with two digits after the point
    printf("%.2f %.2f %.2f %.2f\\n", v1, v2, m1, m2);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "v1", min: 0.999, max: 1.001, label: "toVolts(1365) is 1.0", hint: "`raw / 4095` is int divided by int: 0 for every raw below 4095. Make the first operation a float one." },
        { kind: "var", name: "v2", min: 1.999, max: 2.001, label: "toVolts(2730) is 2.0" },
        { kind: "var", name: "m1", min: 3.499, max: 3.501, label: "mean(7, 2) is 3.5", hint: "Both operands are int. Cast one of them: `(float)sum / count`." },
        { kind: "var", name: "m2", min: 2.499, max: 2.501, label: "mean(10, 4) is 2.5" },
        { kind: "console", includes: "1.00 2.00 3.50 2.50", label: "The program prints: 1.00 2.00 3.50 2.50" },
        { kind: "source", mustMatch: "toVolts\\s*\\(\\s*int\\s+raw\\s*\\)[\\s\\S]*mean\\s*\\(\\s*int\\s+sum\\s*,\\s*int\\s+count\\s*\\)", label: "The parameters are still int" },
      ],
      hints: [
        "In each formula, find the first operation that is carried out and look at the types of its two values.",
        "toVolts: `raw / 4095` is int by int. Multiply by 3.0 first, or divide by 4095.0, or cast raw.",
        "`return raw * 3.0 / 4095;` and `return (float)sum / count;`",
      ],
      takeaway: "The type of each operation is decided by its own two operands, not by where the result goes. Put a float (a decimal point or a cast) into the first operation.",
    },
    {
      id: "chw-fnptr",
      kind: "code",
      mode: "complete",
      title: "Function pointers: which function to call",
      goal: "Make one variable choose which function a loop calls.",
      refs: [{ course: "L4", slide: 26, note: "the table of interrupt function addresses" }, { course: "Lab 1" }],
      brief: `
A function sits in memory too, so it has an address. A **function pointer** is a variable that holds the address of a function. In plain words: a variable that stores **which function to call**.

\`\`\`c
void beep(void)  { printf("beep\\n"); }
void blink(void) { printf("blink\\n"); }

void (*action)(void);    // action can point to a function like these

action = &beep;
action();                // calls beep

action = &blink;
action();                // the same line now calls blink
\`\`\`

The declaration reads from the middle: \`(*action)\` says action is a pointer. The \`(void)\` after it says it points to a function without parameters. The \`void\` in front says that function returns nothing. It is the heading of \`beep\` with \`(*action)\` in place of the name.

Calling through the pointer looks like any call: the name, then round brackets.

## Why you need this
The chip has a table with one function pointer for each hardware event: a timer ran out, a character arrived. When the event happens, the hardware calls whatever function that entry points to. You will write lines like this one in chapter 5:

\`\`\`c
PieVectTable.TIMER0_INT = &cpu_timer0_isr;    // "when timer 0 runs out, call my function"
\`\`\`

## Your task
\`onTick\` is a function pointer. It starts out pointing to \`doNothing\`. Fill in the two TODO lines so that the first loop counts up five times and the second loop counts down twice. Do not change the loops.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["count"],
      starter: `int count = 0;

void doNothing(void)
{
}

void countUp(void)
{
    count = count + 1;
}

void countDown(void)
{
    count = count - 1;
}

// Which function a tick calls
void (*onTick)(void) = &doNothing;

void main(void)
{
    int i;

    // TODO: make onTick point to countUp

    for (i = 0; i < 5; i++) {
        onTick();
    }

    // TODO: make onTick point to countDown

    for (i = 0; i < 2; i++) {
        onTick();
    }

    printf("count %d\\n", count);
    while (1) {}
}
`,
      solution: `int count = 0;

void doNothing(void)
{
}

void countUp(void)
{
    count = count + 1;
}

void countDown(void)
{
    count = count - 1;
}

// Which function a tick calls
void (*onTick)(void) = &doNothing;

void main(void)
{
    int i;

    onTick = &countUp;

    for (i = 0; i < 5; i++) {
        onTick();
    }

    onTick = &countDown;

    for (i = 0; i < 2; i++) {
        onTick();
    }

    printf("count %d\\n", count);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "count", equals: 3, label: "count is 3 (five up, two down)", hint: "Assign the address of a function to the pointer: `onTick = &countUp;`. No brackets after the function name: brackets would call it." },
        { kind: "console", includes: "count 3", label: "The program prints: count 3" },
        { kind: "source", mustMatch: "onTick\\s*=\\s*&?\\s*countUp\\s*;[\\s\\S]*onTick\\s*=\\s*&?\\s*countDown\\s*;", label: "onTick is pointed at countUp, then at countDown" },
        { kind: "source", mustMatch: "i\\s*<\\s*5[^}]*onTick\\s*\\(\\s*\\)[\\s\\S]*i\\s*<\\s*2[^}]*onTick\\s*\\(\\s*\\)", label: "Both loops still call onTick()" },
      ],
      hints: [
        "A function pointer is assigned like any pointer: `pointer = &thing;`",
        "Before the first loop: `onTick = &countUp;`",
        "Before the second loop: `onTick = &countDown;`",
      ],
      takeaway: "A function pointer stores which function to call. The chip's interrupt table in chapter 5 is a struct full of them: you store the address of your function, and the hardware calls it.",
    },
    {
      id: "chw-include",
      kind: "quiz",
      title: "Where the names come from: #include and headers",
      goal: "Tell a declaration from a definition, and say what #include does.",
      refs: [{ course: "Lab 1" }],
      brief: `
You never wrote \`struct GPIO_DATA_REGS\`, and you never created \`GpioDataRegs\`. So why does the compiler accept the name?

## Declaration and definition
The compiler reads a file from top to bottom. Before it meets a name in use, it must have been told what the name is.

- A **declaration** tells the compiler that something exists and what its type is.
- A **definition** is the thing itself: the body of a function, or the boxes of a variable.

For a function, the declaration is its heading followed by a semicolon. It is called a **prototype**:

\`\`\`c
int add(int a, int b);        // prototype: a declaration, no body

void main(void)
{
    int r = add(2, 3);        // fine: the compiler knows add
}

int add(int a, int b)         // the definition, further down
{
    return a + b;
}
\`\`\`

For a variable that is created in another file, the declaration starts with \`extern\`: \`extern int total;\` means "a variable total exists somewhere else".

## Header files
A **header file** (its name ends in \`.h\`) is a file full of declarations: struct types, prototypes, \`#define\` lines. The line

\`\`\`c
#include "F28x_Project.h"
\`\`\`

pastes the whole text of that file in at this spot, before the compiler starts. This header comes from TI. It declares the struct type of every peripheral and then, for example:

\`\`\`c
extern volatile struct GPIO_DATA_REGS GpioDataRegs;
\`\`\`

You can now read every word of that. The definition is in another TI file, and a build setting places it at address 0x7F00.

In this game the course's headers are already included for you.
`,
      questions: [
        {
          prompt: "What does `#include \"F28x_Project.h\"` do?",
          options: [
            "It runs the program stored in that file",
            "It pastes the text of that file in at this line before compiling",
            "It copies the file onto the chip",
            "It creates a variable named F28x_Project",
          ],
          answer: 1,
          why: "#include is plain text insertion. After it, the compiler has seen every declaration in the header.",
        },
        {
          prompt: "Which line is a prototype?",
          options: ["`int add(int a, int b) { return a + b; }`", "`int add(int a, int b);`", "`r = add(2, 3);`", "`#define ADD 3`"],
          answer: 1,
          why: "A heading with a semicolon instead of a body declares the function. The first option has a body, so it is the definition. The third is a call.",
        },
        {
          prompt: "`extern volatile struct GPIO_DATA_REGS GpioDataRegs;` Which part says that hardware may change the variable?",
          options: ["`extern`", "`volatile`", "`struct`", "`GpioDataRegs`"],
          answer: 1,
          why: "extern: it is defined in another file. volatile: something else may change it. struct GPIO_DATA_REGS: its type. GpioDataRegs: its name.",
        },
        {
          prompt: "`main` calls `blink(3);` and `blink` is defined below `main` in the same file. What should stand above `main`?",
          options: ["Nothing: order does not matter in C", "`void blink(int times);`", "`#include \"blink\"`", "`extern blink;`"],
          answer: 1,
          why: "The compiler reads from the top and must know blink before the call. A prototype above main tells it the parameter and return types.",
        },
      ],
      hints: [
        "A declaration announces a name and its type. A definition creates the thing.",
        "A function heading that ends in a semicolon has no body, so it only declares.",
        "#include inserts a file's text. Headers hold declarations; `extern` marks a variable that is defined elsewhere.",
      ],
      takeaway: "Names such as GpioDataRegs are declared in header files that #include pastes into your program. A declaration says what a name is; the definition, somewhere else, is the thing itself.",
    },
    {
      id: "chw-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: measure a row of readings",
      goal: "Write a function that fills a struct with the smallest, largest and mean value of any array.",
      refs: [{ course: "HW1" }],
      brief: `
This level uses the chapter's main tools together: an array, a struct, a pointer parameter and a function. There is nothing new in it.

The program has two rows of temperature readings, \`morning\` (5 values) and \`night\` (4 values). The type \`struct Stats\` holds three results: \`min\`, \`max\` and \`mean\`. Two variables of that type exist, \`m\` and \`n\`.

## What to write
First, the body of \`measure(v, count, out)\`:

- \`v\` points to the first reading and \`count\` says how many there are.
- \`out\` points to a \`struct Stats\`. Store the smallest reading in its \`min\`, the largest in its \`max\`, and the mean (the sum divided by the count) in its \`mean\`.

Second, two calls in \`main\`: one that measures \`morning\` into \`m\`, and one that measures \`night\` into \`n\`.

The rest of \`main\` is given. It copies the results into plain variables for the tests and prints them.

## Things to remember
- The function must not name \`morning\`, \`night\`, \`m\` or \`n\`. It works on whatever it is pointed at.
- \`out\` is a pointer to a struct.
- An array is passed by its name. A struct variable is passed by its address.
- The mean of whole numbers is rarely a whole number. The mean of the night readings is -4.5.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["mMin", "mMax", "mMean", "nMin", "nMax", "nMean"],
      starter: `struct Stats {
    int min;
    int max;
    float mean;
};

int morning[5] = {21, 19, 24, 30, 26};
int night[4] = {-3, -8, -1, -6};
struct Stats m;
struct Stats n;
int mMin, mMax, nMin, nMax;
float mMean, nMean;

// Fills *out with the smallest, largest and mean of the count readings at v
void measure(int *v, int count, struct Stats *out)
{
    // TODO
}

void main(void)
{
    // TODO: measure morning into m, and night into n

    mMin = m.min;
    mMax = m.max;
    mMean = m.mean;
    nMin = n.min;
    nMax = n.max;
    nMean = n.mean;
    // %.1f prints a float with one digit after the point
    printf("morning %d to %d, mean %.1f\\n", mMin, mMax, mMean);
    printf("night %d to %d, mean %.1f\\n", nMin, nMax, nMean);
    while (1) {}
}
`,
      solution: `struct Stats {
    int min;
    int max;
    float mean;
};

int morning[5] = {21, 19, 24, 30, 26};
int night[4] = {-3, -8, -1, -6};
struct Stats m;
struct Stats n;
int mMin, mMax, nMin, nMax;
float mMean, nMean;

// Fills *out with the smallest, largest and mean of the count readings at v
void measure(int *v, int count, struct Stats *out)
{
    int i;
    int sum = 0;

    out->min = v[0];
    out->max = v[0];
    for (i = 0; i < count; i++) {
        if (v[i] < out->min) {
            out->min = v[i];
        }
        if (v[i] > out->max) {
            out->max = v[i];
        }
        sum = sum + v[i];
    }
    out->mean = (float)sum / count;
}

void main(void)
{
    measure(morning, 5, &m);
    measure(night, 4, &n);

    mMin = m.min;
    mMax = m.max;
    mMean = m.mean;
    nMin = n.min;
    nMax = n.max;
    nMean = n.mean;
    // %.1f prints a float with one digit after the point
    printf("morning %d to %d, mean %.1f\\n", mMin, mMax, mMean);
    printf("night %d to %d, mean %.1f\\n", nMin, nMax, nMean);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "mMin", equals: 19, label: "morning: min is 19", hint: "Call `measure(morning, 5, &m);` in main. The array goes by name, the struct by address." },
        { kind: "var", name: "mMax", equals: 30, label: "morning: max is 30" },
        { kind: "var", name: "mMean", min: 23.99, max: 24.01, label: "morning: mean is 24.0" },
        { kind: "var", name: "nMin", equals: -8, label: "night: min is -8" },
        { kind: "var", name: "nMax", equals: -1, label: "night: max is -1", hint: "Every night reading is negative. Start min and max from `v[0]`, not from 0." },
        { kind: "var", name: "nMean", min: -4.51, max: -4.49, label: "night: mean is -4.5", hint: "-18 / 4 in int arithmetic is -4. Cast before dividing: `(float)sum / count`." },
        { kind: "console", includes: "night -8 to -1, mean -4.5", label: "The program prints: night -8 to -1, mean -4.5" },
        { kind: "source", mustMatch: "out\\s*->\\s*mean|\\(\\s*\\*\\s*out\\s*\\)\\s*\\.\\s*mean", label: "measure stores its results through the pointer out" },
      ],
      bonus: [
        { kind: "max-steps", max: 72, label: "One pass over each array: 72 statements or fewer", hint: "Find min, max and the sum in the same loop instead of three loops." },
      ],
      hints: [
        "Start with `out->min = v[0];` and `out->max = v[0];`, and a local `int sum = 0;`. Then one loop over `v[i]`.",
        "In the loop: update `out->min` and `out->max` with two ifs, and add `v[i]` to `sum`. After it: `out->mean = (float)sum / count;`",
        "The calls: `measure(morning, 5, &m);` and `measure(night, 4, &n);`",
      ],
      takeaway: "Data in arrays and structs, functions that receive addresses and work on whatever they are pointed at: the course's driver code is built from exactly these pieces.",
    },
    {
      id: "chw-types-fix",
      tier: "practice",
      kind: "code",
      mode: "debug",
      title: "The right box for the number",
      goal: "Give two variables a type that fits their value, and print them with the matching placeholder.",
      refs: [{ course: "L4", slide: [5, 14] }, { course: "HW1" }],
      brief: `
A wheel sensor counts 50000 ticks per run, and the robot drives 120000 millimetres in a day. This program stores both and prints them. Both come out wrong.

Nothing is wrong with the numbers. The **types** are too small for them:

- an \`int16_t\` holds -32768 to 32767,
- a \`uint16_t\` holds 0 to 65535,
- an \`int32_t\` holds about -2 billion to 2 billion.

And the placeholder in \`printf\` has to match what it is given: \`%d\` for a signed 16-bit value, \`%u\` for an unsigned 16-bit value, \`%ld\` for a 32-bit value.

A tiny example of both steps:

\`\`\`c
int32_t population = 90000;         // too big for 16 bits
printf("%ld people\\n", population);
\`\`\`

## Your task
Run the program and read what it prints. Then:

1. Give \`ticks\` the smallest type that holds 50000. It is never negative.
2. Give \`distance\` a type that holds 120000.
3. Fix the two placeholders in the \`printf\` line to match.

It should print \`ticks 50000, distance 120000\`.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["ticks", "distance"],
      starter: `int16_t ticks = 50000;         // sensor ticks in one run, never negative
int16_t distance = 120000;     // millimetres driven in a day

void main(void)
{
    printf("ticks %d, distance %d\\n", ticks, distance);
    while (1) {}
}
`,
      solution: `uint16_t ticks = 50000;        // sensor ticks in one run, never negative
int32_t distance = 120000;     // millimetres driven in a day

void main(void)
{
    printf("ticks %u, distance %ld\\n", ticks, distance);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "ticks", equals: 50000, label: "ticks holds 50000", hint: "50000 is above 32767. Without negative numbers one box reaches 65535: `uint16_t`." },
        { kind: "var", name: "distance", equals: 120000, label: "distance holds 120000", hint: "120000 does not fit in one box at all. Use a 32-bit type: `int32_t`." },
        { kind: "console", includes: "ticks 50000, distance 120000", label: "The program prints: ticks 50000, distance 120000", hint: "`%u` for the unsigned 16-bit value and `%ld` for the 32-bit one." },
        { kind: "no-diagnostic", code: "printf-type", label: "Each placeholder matches the size of its value" },
      ],
      bonus: [
        { kind: "source", mustMatch: "uint16_t\\s+ticks", label: "ticks takes one box only: uint16_t", hint: "An int32_t works, but it spends two boxes on a value that fits in one." },
      ],
      hints: [
        "Compare each value with the ranges listed in the brief.",
        "`uint16_t ticks` and `int32_t distance`.",
        'The print line becomes `printf("ticks %u, distance %ld\\n", ticks, distance);`',
      ],
      takeaway: "Pick the type from the range of the value, and the printf code from the type: %d and %u for one box, %ld for two.",
    },
    {
      id: "chw-pointer-order",
      tier: "practice",
      kind: "order",
      title: "Put the pointer program in order",
      goal: "Arrange five lines so that the program prints 9 4.",
      refs: [{ course: "HW1" }],
      brief: `
The five lines of a small program were shuffled. In the right order it prints \`9 4\`.

A tiny reminder of the three pointer moves:

\`\`\`c
int a = 1;
int *q = &a;     // q points to a
int b = *q;      // read through q: b is 1
*q = 7;          // write through q: a is 7
\`\`\`

Only one order works. Each line needs something that an earlier line has created:

- a variable must be declared before any line uses it,
- a pointer must point somewhere before a line reads or writes through it,
- the print comes last.

Work out what each line needs, then drag the lines into place. If two lines seem to fit the same spot, check which one uses a name that the other one declares.
`,
      steps: ["int x = 4;", "int *p = &x;", "int y = *p;", "*p = y + 5;", 'printf("%d %d\\n", x, y);'],
      hints: [
        "Start with the only line that uses no other variable.",
        "`int y = *p;` needs p, and `*p = y + 5;` needs y.",
        "x is created, p is pointed at x, y gets a copy of x through p, x is changed through p, both are printed.",
      ],
      takeaway: "y received a copy of the value, so it stayed 4. p held the address, so writing through it changed x itself to 9.",
    },
    {
      id: "chw-trace",
      tier: "practice",
      kind: "calc",
      title: "What is in the box?",
      goal: "Run a short program in your head and say what four boxes hold at the end.",
      refs: [{ course: "HW1" }],
      brief: `
Reading code means running it in your head, one line at a time, and keeping track of the boxes. Do that for this program.

The variables sit in memory in the order they are declared: \`a[0]\` is the box at \`0x0100\`, \`a[1]\` at \`0x0101\`, \`a[2]\` at \`0x0102\`, and \`n\` at \`0x0103\`. The pointer \`p\` comes after them.

One thing is new, and it follows from what you know: \`&\` works on any box, so \`&a[1]\` is the address of the element \`a[1]\`.

\`\`\`c
int a[3] = {5, 10, 15};
int n = 2;
int *p = &a[1];

*p = *p + n;       // line 1
p = &n;            // line 2
*p = a[0];         // line 3
a[2] = *p * 2;     // line 4
\`\`\`

A worked start: before line 1, \`p\` holds \`0x0101\`. So line 1 reads box \`0x0101\` (10), adds \`n\` (2) and stores the result back in box \`0x0101\`.

Draw the four boxes on paper and update them line by line. Then fill in the fields. The last answer is an address: type it as it is written here, starting with \`0x\`.
`,
      fields: [
        { id: "b1", label: "Value in box 0x0101 at the end", answer: 12, why: "Line 1 writes through p, which points to a[1]: 10 + 2 = 12. No later line touches that box." },
        { id: "b3", label: "Value in box 0x0103 (n) after line 3", answer: 5, why: "Line 2 makes p point to n. Line 3 then stores a[0], which is 5, in the box p points to: n." },
        { id: "b2", label: "Value in box 0x0102 at the end", answer: 10, why: "In line 4, *p is n, which is now 5. 5 * 2 = 10 goes into a[2]." },
        { id: "p", label: "Address that p holds at the end", format: "hex", answer: 0x0103, why: "Line 2 stored the address of n in p, and nothing changed p afterwards. Lines 3 and 4 only use it." },
      ],
      hints: [
        "For each line, first decide which box is written: the one named on the left of the = sign, or the one p points to if the left side is *p.",
        "After line 2, p no longer points into the array. From then on *p is n.",
        "Line 1: a[1] = 12. Line 3: n = 5. Line 4: a[2] = 5 * 2.",
      ],
      takeaway: "To trace pointer code, keep two things apart: the address the pointer holds, and the value in the box at that address.",
    },
    {
      id: "chw-reverse",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Reverse an array in place",
      goal: "Write a function that reverses the order of any int array without a second array.",
      refs: [{ course: "HW1" }],
      brief: `
Some sensors deliver their samples newest first, and the code that uses them wants oldest first. Write \`reverse(v, n)\`: it reverses the order of the \`n\` elements that \`v\` points to.

- \`{1, 2, 3, 4, 5, 6}\` becomes \`{6, 5, 4, 3, 2, 1}\`
- \`{10, 20, 30}\` becomes \`{30, 20, 10}\`

The function works **in place**: it rearranges the caller's own boxes and uses no second array. Exchanging two boxes needs one extra variable, because the first store destroys a value you still need:

\`\`\`c
int keep = x;
x = y;
y = keep;
\`\`\`

\`main\` is given. It reverses an array with an even number of elements and one with an odd number, and prints both.

The star asks you to do no more work than necessary.
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `int even[6] = {1, 2, 3, 4, 5, 6};
int odd[3] = {10, 20, 30};

// Reverses the order of the n elements that v points to
void reverse(int *v, int n)
{
    // TODO
}

void main(void)
{
    reverse(even, 6);
    reverse(odd, 3);

    printf("%d %d %d %d %d %d\\n", even[0], even[1], even[2], even[3], even[4], even[5]);
    printf("%d %d %d\\n", odd[0], odd[1], odd[2]);
    while (1) {}
}
`,
      solution: `int even[6] = {1, 2, 3, 4, 5, 6};
int odd[3] = {10, 20, 30};

// Reverses the order of the n elements that v points to
void reverse(int *v, int n)
{
    int i;
    int keep;

    // Exchange the first with the last, the second with the second last, ...
    // and stop in the middle.
    for (i = 0; i < n / 2; i++) {
        keep = v[i];
        v[i] = v[n - 1 - i];
        v[n - 1 - i] = keep;
    }
}

void main(void)
{
    reverse(even, 6);
    reverse(odd, 3);

    printf("%d %d %d %d %d %d\\n", even[0], even[1], even[2], even[3], even[4], even[5]);
    printf("%d %d %d\\n", odd[0], odd[1], odd[2]);
    while (1) {}
}
`,
      checks: [
        { kind: "console", includes: "6 5 4 3 2 1\n", label: "The six elements print as 6 5 4 3 2 1", hint: "If the array comes out unchanged, your loop runs over all n elements and exchanges every pair twice." },
        { kind: "console", includes: "30 20 10\n", label: "The three elements print as 30 20 10", hint: "With an odd length the middle element stays where it is." },
        { kind: "source", mustNotMatch: "reverse[^{]*\\{[^}]*\\bint\\s+\\w+\\s*\\[", label: "No second array inside reverse" },
      ],
      bonus: [
        { kind: "max-steps", max: 40, label: "Stops in the middle: the program runs 40 statements or fewer", hint: "The partner of v[i] is v[n - 1 - i]. After n / 2 exchanges everything is in place." },
      ],
      hints: [
        "The first element changes places with the last, the second with the second last. Which index is the partner of index i?",
        "The partner of `v[i]` is `v[n - 1 - i]`. Exchange them with a third variable.",
        "Loop only to the middle: `for (i = 0; i < n / 2; i++)`. Going all the way to n exchanges every pair twice and undoes the work.",
      ],
      takeaway: "A pointer and a length are enough to rearrange the caller's memory. Stopping at n / 2 is the whole trick: every exchange fixes two elements.",
    },
    {
      id: "chw-dispatch",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "A table of functions",
      goal: "Build an array of function pointers and call the right entry for each command number.",
      refs: [{ course: "L4", slide: 26, note: "the table of interrupt function addresses" }, { course: "Lab 1" }],
      brief: `
The chip's interrupt table is a row of function pointers. The hardware uses an event number to pick an entry and calls it. Build the same thing yourself.

A robot understands three commands, numbered 0, 1 and 2:

- 0: \`forward\` adds 10 to \`position\`
- 1: \`back\` subtracts 10 from \`position\`
- 2: \`home\` sets \`position\` to 0

## What to write
1. \`table\`: an array of three function pointers that holds the three functions in that order. An array of function pointers is declared like one function pointer, with the brackets right after the name: \`void (*table[3])(void)\`. It can be filled with braces like any array.
2. \`run(command)\`: calls the entry of \`table\` that belongs to \`command\`.

Command numbers arrive from outside, and some of them are wrong. A wrong number must be ignored and counted in \`rejected\`. Think about what would happen otherwise: you know what C does with an index that is out of range, and here the box it finds would be used as the address of a function.

\`main\` is given.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["position", "rejected"],
      starter: `int position = 5;
int rejected = 0;    // how many command numbers were not valid

void forward(void)
{
    position = position + 10;
}

void back(void)
{
    position = position - 10;
}

void home(void)
{
    position = 0;
}

// TODO: declare table, an array of three function pointers: forward, back, home

void run(int command)
{
    // TODO: call the function that belongs to command, or count it as rejected
}

void main(void)
{
    run(2);     // home:     0
    run(0);     // forward: 10
    run(0);     // forward: 20
    run(3);     // not a command
    run(1);     // back:    10
    run(-1);    // not a command
    run(0);     // forward: 20
    run(0);     // forward: 30

    printf("position %d, rejected %d\\n", position, rejected);
    while (1) {}
}
`,
      solution: `int position = 5;
int rejected = 0;    // how many command numbers were not valid

void forward(void)
{
    position = position + 10;
}

void back(void)
{
    position = position - 10;
}

void home(void)
{
    position = 0;
}

void (*table[3])(void) = {&forward, &back, &home};

void run(int command)
{
    if (command < 0 || command > 2) {
        rejected = rejected + 1;
        return;
    }
    table[command]();
}

void main(void)
{
    run(2);     // home:     0
    run(0);     // forward: 10
    run(0);     // forward: 20
    run(3);     // not a command
    run(1);     // back:    10
    run(-1);    // not a command
    run(0);     // forward: 20
    run(0);     // forward: 30

    printf("position %d, rejected %d\\n", position, rejected);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "position", equals: 30, label: "position ends at 30", hint: "The order in the table decides which number means what: forward, back, home." },
        { kind: "var", name: "rejected", equals: 2, label: "Two wrong command numbers were rejected", hint: "Valid indexes are 0 to 2. Test for a number below 0 as well as one above 2." },
        { kind: "console", includes: "position 30, rejected 2", label: "The program prints: position 30, rejected 2" },
        { kind: "source", mustMatch: "\\(\\s*\\*\\s*table\\s*\\[", label: "table is an array of function pointers" },
        { kind: "source", mustMatch: "table\\s*\\[\\s*command\\s*\\]\\s*\\(\\s*\\)|\\(\\s*\\*\\s*table\\s*\\[\\s*command\\s*\\]\\s*\\)\\s*\\(\\s*\\)", label: "run calls through table[command]" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bswitch\\b|else", label: "No switch and no else chain: the table does the choosing" },
      ],
      hints: [
        "`void (*table[3])(void) = {&forward, &back, &home};` declares and fills the table.",
        "An element of the table is a function pointer, so it is called with round brackets after it: `table[command]();`",
        "First reject bad numbers: `if (command < 0 || command > 2) { rejected = rejected + 1; return; }`",
      ],
      takeaway: "A table of function pointers turns a number into an action without any if chain. It also turns an unchecked number into a jump to a random address, so check the index first.",
    },
    {
      id: "chw-overlay",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Lay a struct over raw memory",
      goal: "Read sensor packets out of a plain array of boxes by treating the memory as an array of structs.",
      refs: [{ course: "L2", slide: 10, note: "TI's structs laid over register addresses" }, { trm: "3.6.1" }],
      brief: `
TI places a struct over the boxes of a peripheral. You can do the same with any memory, and drivers do it all the time.

A weather sensor fills an array of plain 16-bit boxes. It writes **packets** back to back, and each packet is three boxes:

1. the number of the station that measured,
2. a temperature, which can be negative,
3. a humidity.

\`struct Packet\` describes exactly these three boxes. Nothing in memory says "packet": the boxes are only numbers. The struct is your description of them.

## What to write
\`hottest(raw, packets)\` gets a pointer to the first box and the number of packets. It returns the **station number** of the packet with the highest temperature.

Three facts you need, and nothing more:

- A cast works on pointers too: \`(struct Packet *)raw\` is the same address, now treated as the address of a \`struct Packet\`.
- Brackets on a pointer count in whole elements. If \`p\` points to a \`struct Packet\`, then \`p[1]\` is the next packet, three boxes further on, and \`p[1].temperature\` is its temperature.
- The temperatures in the second buffer are all below zero.

\`main\` is given. It runs your function on two buffers.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["hotA", "hotB"],
      starter: `struct Packet {
    uint16_t station;
    int16_t temperature;
    uint16_t humidity;
};

// Raw boxes as the sensor wrote them: station, temperature, humidity, station, ...
uint16_t bufferA[12] = {7, 18, 40,   3, 25, 55,   9, 21, 60,   4, 12, 35};
uint16_t bufferB[6] = {11, -20, 80,   12, -5, 70};
uint16_t hotA;
uint16_t hotB;

// Returns the station number of the packet with the highest temperature
uint16_t hottest(uint16_t *raw, int packets)
{
    // TODO
    return 0;
}

void main(void)
{
    hotA = hottest(bufferA, 4);
    hotB = hottest(bufferB, 2);

    printf("hottest: station %u and station %u\\n", hotA, hotB);
    while (1) {}
}
`,
      solution: `struct Packet {
    uint16_t station;
    int16_t temperature;
    uint16_t humidity;
};

// Raw boxes as the sensor wrote them: station, temperature, humidity, station, ...
uint16_t bufferA[12] = {7, 18, 40,   3, 25, 55,   9, 21, 60,   4, 12, 35};
uint16_t bufferB[6] = {11, -20, 80,   12, -5, 70};
uint16_t hotA;
uint16_t hotB;

// Returns the station number of the packet with the highest temperature
uint16_t hottest(uint16_t *raw, int packets)
{
    struct Packet *p = (struct Packet *)raw;    // the same boxes, seen as packets
    int best = 0;                               // index of the hottest packet so far
    int i;

    for (i = 1; i < packets; i++) {
        if (p[i].temperature > p[best].temperature) {
            best = i;
        }
    }
    return p[best].station;
}

void main(void)
{
    hotA = hottest(bufferA, 4);
    hotB = hottest(bufferB, 2);

    printf("hottest: station %u and station %u\\n", hotA, hotB);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "hotA", equals: 3, label: "Buffer A: station 3 is the hottest (25)", hint: "Return the station of the hottest packet, not its temperature and not its index." },
        { kind: "var", name: "hotB", equals: 12, label: "Buffer B: station 12 is the hottest (-5)", hint: "Both temperatures are negative. Read them through the int16_t member of the struct, and do not start your best value at 0." },
        { kind: "console", includes: "hottest: station 3 and station 12", label: "The program prints: hottest: station 3 and station 12" },
        { kind: "source", mustMatch: "\\(\\s*struct\\s+Packet\\s*\\*\\s*\\)", label: "The raw boxes are read through a struct Packet pointer", hint: "Counting boxes by hand (raw[i * 3 + 1]) works, but this level asks for the cast: `struct Packet *p = (struct Packet *)raw;`" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\*\\s*3|3\\s*\\*|\\+\\s*3|\\+=\\s*3", label: "No hand-counted box numbers: the struct does the arithmetic", hint: "With `struct Packet *p`, `p[i]` already skips three boxes per packet." },
      ],
      hints: [
        "Make a packet pointer first: `struct Packet *p = (struct Packet *)raw;`. Then `p[i]` is packet number i.",
        "Remember the index of the best packet so far, starting with 0, and compare `p[i].temperature` with `p[best].temperature`.",
        "After the loop: `return p[best].station;`",
      ],
      takeaway: "A struct is a description that can be laid over any memory. Laid over a sensor's buffer it names the fields of a packet; laid over address 0x7F00 it names the registers of the chip's pins.",
    },
  ],
};
