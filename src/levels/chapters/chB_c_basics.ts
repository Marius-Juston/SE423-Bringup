import type { Chapter, Ref } from "../types";

// Primer B: C from zero. For a student who has never programmed.
//
// The program frame used in every code level of this chapter:
//
//     void main(void)
//     {
//         ...statements...
//     }
//
// Nothing else is needed by the simulator (no #include, no InitSysCtrl()),
// so nothing is on screen that the student cannot be told about. The frame
// itself is explained in czero-function. From czero-forever on, main ends
// with `while (1) {}` like every later chapter. Up to czero-scope the
// results are checked through what printf printed (variables are local to
// main); from czero-scope on, through global variables.

const REFS: Ref[] = [{ course: "Lab 1" }, { course: "HW1" }];

export const chB: Chapter = {
  id: "primer-c",
  number: -2,
  label: "B",
  title: "C from zero",
  blurb: "Your first programs: variables, decisions, loops and functions.",
  requires: [],
  course: [],
  levels: [
    // ------------------------------------------------------------------ 1
    {
      id: "czero-hello",
      kind: "code",
      mode: "complete",
      title: "Your first program",
      goal: "Run a finished program, then change the text it prints.",
      refs: [{ course: "L4", slide: 12 }, { course: "Lab 1" }, { course: "HW1" }],
      brief: `
A **program** is a list of instructions for a computer. The computer runs them one after another, from the top line to the bottom line. It does exactly what the lines say and nothing else. You will write programs in a language called **C**, the language the robot's chip is programmed in.

## The screen
- The **editor** is the box that holds the program text. You type there.
- **Run** starts the program.
- **Run tests** starts it and checks the result against the goal.
- A **hint** is there whenever you are stuck.

## The program
\`\`\`c
void main(void)
{
    printf("Not ready\\n");
}
\`\`\`

The first line and the two braces \`{\` and \`}\` are a frame. They are given: the level "Write a function" in this chapter explains them. For now, the computer runs the lines between the braces.

\`printf\` prints text. The text is written between double quotes. It appears in the **printf console**, a panel that opens next to the board when the program prints something. The \`\\n\` at the end is explained in the next level. Keep it.

## Your task
Press **Run** and read the console. Then change the text so the program prints \`Ready\` instead of \`Not ready\`, and press **Run tests**.
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    printf("Not ready\\n");
}
`,
      solution: `void main(void)
{
    printf("Ready\\n");
}
`,
      checks: [
        {
          kind: "console",
          matches: "^Ready\\s*$",
          label: "The program prints Ready and nothing else",
          hint: "Change only the words between the double quotes. Keep the quotes, the \\n and the semicolon. Ready starts with a capital R.",
        },
      ],
      hints: [
        "Only the words inside the double quotes need to change.",
        "Delete the word `Not` and the space after it, and make the r a capital R.",
        '`printf("Ready\\n");`',
      ],
      takeaway: "A program is a list of instructions that run from top to bottom. You changed one instruction and the result changed: that loop of edit, run and look is how all programming is done.",
    },
    // ------------------------------------------------------------------ 2
    {
      id: "czero-statements",
      kind: "code",
      mode: "complete",
      title: "One instruction after another",
      goal: "Add two instructions to finish a countdown.",
      refs: REFS,
      brief: `
One instruction in C is called a **statement**. A statement ends with a **semicolon** \`;\` the way a sentence ends with a full stop. Statements run in the order they are written.

\`\`\`c
printf("3\\n");
printf("2\\n");
\`\`\`

This prints

\`\`\`
3
2
\`\`\`

The \`\\n\` means **new line**: what is printed next starts on a fresh line. Without it, the two statements would print \`32\` on one line.

## Notes for people
A **comment** is a note in the program for people to read. Everything after \`//\` on a line is a comment. The computer skips it.

\`\`\`c
// A note. The computer skips it.
printf("3\\n");   // also a note
\`\`\`

## Your task
The program prints 3 and 2. Add two statements so that the whole output is

\`\`\`
3
2
1
Go!
\`\`\`

The comment that starts with TODO ("to do") marks the place.
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    // A countdown. The computer skips this line: it is a comment.
    printf("3\\n");
    printf("2\\n");
    // TODO: print 1, then Go!, each on a line of its own
}
`,
      solution: `void main(void)
{
    // A countdown. The computer skips this line: it is a comment.
    printf("3\\n");
    printf("2\\n");
    printf("1\\n");
    printf("Go!\\n");
}
`,
      checks: [
        {
          kind: "console",
          matches: "^3\\n2\\n1\\nGo!\\n?$",
          label: "The output is 3, 2, 1, Go! on four lines",
          hint: "Each new statement looks like the two above it: printf, the text in double quotes with \\n at the end, and a semicolon. The last line is Go! with a capital G and an exclamation mark.",
        },
      ],
      hints: [
        "You need two more lines that look like the two printf lines already there.",
        "Copy the line that prints 2, paste it twice below, and change the text of each copy.",
        '`printf("1\\n");` and then `printf("Go!\\n");`',
      ],
      takeaway: "Statements end with a semicolon and run top to bottom. `\\n` starts a new line. A `//` comment is for people: the computer skips it.",
    },
    // ------------------------------------------------------------------ 3
    {
      id: "czero-variables",
      kind: "brief",
      title: "Boxes with names",
      goal: "Step through a program that stores numbers, then answer three questions.",
      refs: REFS,
      brief: `
A robot program must remember numbers: a speed, a distance, how many times a button was pressed. It keeps each one in a **variable**: a box in the computer's memory that has a name and holds one number.

You do three things with a variable.

- **Declare** it. This makes the box. \`int apples;\` makes a box named \`apples\`. The word \`int\` says what kind of number it holds: a whole number (an integer).
- **Assign** to it. This stores a number. \`apples = 3;\` stores 3 in the box.
- **Use** it. Writing the name in a calculation reads the number in the box: \`apples + 2\`.

In C the sign \`=\` does not mean "is equal to". It means **store**: work out the right side, then put the result in the box named on the left.

{{figure:c-variable-boxes}}

Try it in the figure: press Step and watch each line change one box. Look closely at what happens to \`total\` on the last line.

## Three rules
- Declare a variable before you use it.
- A new box holds an unknown number until you store one. You can do both at once: \`int apples = 3;\`
- A name is made of letters, digits and \`_\`, with no spaces, and does not start with a digit. Capital letters count: \`Total\` and \`total\` are two different names.
`,
      questions: [
        {
          prompt: "These three lines run in order. What does `a` hold at the end?\n\n```c\nint a;\na = 5;\na = 2;\n```",
          options: ["5", "7", "2", "Both 5 and 2"],
          answer: 2,
          why: "A box holds one number. Storing 2 replaces the 5, which is gone.",
        },
        {
          prompt: "What does `y` hold at the end?\n\n```c\nint x = 4;\nint y = x;\nx = 9;\n```",
          options: ["9", "4", "13", "It is unknown"],
          answer: 1,
          why: "`int y = x;` copies the number that x holds at that moment, 4. Changing x later does not change y: the boxes are not linked.",
        },
        {
          prompt: "A box named `count` exists. Which statement stores 7 in it?",
          options: ["`7 = count;`", "`int = 7;`", "`count 7;`", "`count = 7;`"],
          answer: 3,
          why: "The box goes on the left of `=` and the value on the right. `7 = count;` tries to store something in the number 7, which is not a box.",
        },
      ],
      takeaway: "A variable is a named box for one number. `int name;` makes it, `name = value;` stores into it, and `=` always means store, never \"is equal to\".",
    },
    // ------------------------------------------------------------------ 4
    {
      id: "czero-print-value",
      kind: "code",
      mode: "complete",
      title: "Print what a box holds",
      goal: "Store a new number in a variable and print it.",
      refs: [{ course: "L4", slide: [13, 14] }, { course: "Lab 1" }, { course: "HW1" }],
      brief: `
You cannot see inside a variable. To find out what it holds, print it.

\`printf\` prints the text between the quotes exactly as written, with one exception: \`%d\` is a **placeholder**. It is replaced by the value you write after the text, behind a comma.

\`\`\`c
int laps;

laps = 3;
printf("Laps: %d\\n", laps);
\`\`\`

This prints \`Laps: 3\`. The \`%d\` was swapped for the number in the box \`laps\`.

Two placeholders take two values, in the same order:

\`\`\`c
printf("%d laps, %d to go\\n", laps, 7);
\`\`\`

prints \`3 laps, 7 to go\`.

Printing values is the first tool for understanding any program, on the robot too. Whenever you are not sure what a variable holds, print it.

## Your task
The program below stores 3 in \`laps\` and prints it. Add two statements at the TODO: store 5 in \`laps\`, then print it again with the same printf line. The output must be

\`\`\`
Laps: 3
Laps: 5
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int laps;

    laps = 3;
    printf("Laps: %d\\n", laps);
    // TODO: store 5 in laps, then print it again
}
`,
      solution: `void main(void)
{
    int laps;

    laps = 3;
    printf("Laps: %d\\n", laps);
    laps = 5;
    printf("Laps: %d\\n", laps);
}
`,
      checks: [
        {
          kind: "console",
          matches: "^Laps: 3\\nLaps: 5\\n?$",
          label: "The output is Laps: 3, then Laps: 5",
          hint: "You need two new statements, in this order: one that stores 5 in laps, and one more printf line exactly like the one above it.",
        },
        {
          kind: "source",
          mustMatch: "laps\\s*=\\s*5\\s*;",
          label: "The 5 is stored in the variable laps",
          hint: "Do not type the 5 into the text. Store it with `laps = 5;` and let %d print the box.",
        },
      ],
      hints: [
        "The same printf line prints a different number when the box holds a different number.",
        "First `laps = 5;` on a line of its own. The box is declared already, so do not write `int` again.",
        '`laps = 5;` then `printf("Laps: %d\\n", laps);`',
      ],
      takeaway: "`%d` in a printf text is replaced by the whole number written after the comma. Printing a variable is how you look inside its box.",
    },
    // ------------------------------------------------------------------ 5
    {
      id: "czero-update",
      kind: "calc",
      title: "Follow the boxes by hand",
      goal: "Work out what the variables hold at the end of two short programs.",
      refs: REFS,
      brief: `
A statement can use a variable on both sides of \`=\`:

\`\`\`c
count = count + 1;
\`\`\`

This looks wrong as maths, but \`=\` means store. The right side is worked out first with the old value. If \`count\` holds 4, then 4 + 1 is 5, and 5 is stored back in \`count\`.

Changing a variable like this is so common that C has short forms:

- \`count += 1;\` is short for \`count = count + 1;\` (also \`-=\`, \`*=\`, \`/=\`)
- \`count++;\` adds 1, and \`count--;\` takes 1 away

## Tracing
**Tracing** means running a program in your head: go through it line by line and write down what each variable holds after each line. It is the most useful skill in programming, because it shows what the program really does, not what you hoped it does.

\`\`\`c
int a = 2;      // a: 2
int b = 5;      // a: 2   b: 5
a = a + b;      // a: 7   b: 5
b = a;          // a: 7   b: 7
a++;            // a: 8   b: 7
\`\`\`

## Your task
Trace the two programs below on paper, the same way, and enter the final values.

\`\`\`c
// Program 1
int n = 10;
n -= 4;
n *= 2;
n++;
\`\`\`

\`\`\`c
// Program 2
int x = 1;
int y = 2;
x = y;
y = x;
\`\`\`
`,
      fields: [
        { id: "n", label: "Program 1: what n holds at the end", answer: 13, why: "10 - 4 is 6, then 6 * 2 is 12, then one more is 13." },
        { id: "x", label: "Program 2: what x holds at the end", answer: 2, why: "`x = y;` stores a copy of y's 2 in x. The 1 is gone." },
        { id: "y", label: "Program 2: what y holds at the end", answer: 2, why: "By the time `y = x;` runs, x already holds 2. The two lines do not swap the values: the 1 was lost one line earlier." },
      ],
      hints: [
        "Write one row per line of the program, with a column for each variable.",
        "Work out the right side with the values from the row above, then change only the variable on the left.",
        "Program 1 goes 10, 6, 12, 13. In program 2, x becomes 2 on the third line, so the last line stores 2 in y.",
      ],
      takeaway: "The right side is worked out first, then stored. Trace line by line and write the values down: do not guess from what the program seems to mean.",
    },
    // ------------------------------------------------------------------ 6
    {
      id: "czero-arithmetic",
      kind: "code",
      mode: "write",
      title: "Let the computer calculate",
      goal: "Write two calculations for a rectangle and get the order of operations right.",
      refs: REFS,
      brief: `
C calculates with four **operators** (signs that stand for an operation):

- \`+\` add
- \`-\` subtract
- \`*\` multiply
- \`/\` divide (the next level looks at it closely)

A calculation can go wherever a value can go: \`sum = price + 2;\`

## What is calculated first
As in maths, \`*\` and \`/\` are done before \`+\` and \`-\`. This rule is called **precedence**.

\`\`\`c
// 3 * 4 first: 2 + 12 = 14
a = 2 + 3 * 4;

// brackets first: 5 * 4 = 20
b = (2 + 3) * 4;
\`\`\`

Brackets \`( )\` are always done first. When you are not sure of the order, add brackets: they cost nothing and make the meaning plain.

## Your task
A rectangle is 7 wide and 3 high. The program stores 0 in \`area\` and \`perimeter\` and prints them. Replace the two zeros with calculations that use \`width\` and \`height\`:

- area: width times height
- perimeter (the length all the way round): 2 times the sum of width and height

The output must be

\`\`\`
Area: 21
Perimeter: 20
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int width = 7;
    int height = 3;
    int area;
    int perimeter;

    area = 0;         // TODO: width times height
    perimeter = 0;    // TODO: 2 times the sum of width and height

    printf("Area: %d\\n", area);
    printf("Perimeter: %d\\n", perimeter);
}
`,
      solution: `void main(void)
{
    int width = 7;
    int height = 3;
    int area;
    int perimeter;

    area = width * height;
    perimeter = 2 * (width + height);

    printf("Area: %d\\n", area);
    printf("Perimeter: %d\\n", perimeter);
}
`,
      checks: [
        { kind: "console", includes: "Area: 21", label: "The program prints Area: 21", hint: "Multiply with a star: `width * height`." },
        {
          kind: "console",
          includes: "Perimeter: 20",
          label: "The program prints Perimeter: 20",
          hint: "If you see 17, the multiplication ran first: `2 * width + height` is 14 + 3. Put brackets round the sum.",
        },
        {
          kind: "source",
          mustMatch: "(width\\s*\\*\\s*height|height\\s*\\*\\s*width)",
          label: "The area is calculated from width and height",
          hint: "Do not type 21 yourself. Write the calculation with the two names, so it stays right when the numbers change.",
        },
        {
          kind: "source",
          mustMatch: "perimeter\\s*=[^;]*(width[^;]*height|height[^;]*width)",
          label: "The perimeter is calculated from width and height",
          hint: "Do not type 20 yourself. Write `2 * (width + height)`.",
        },
      ],
      hints: [
        "Replace each 0 with a calculation that uses the names `width` and `height`.",
        "The area is `width * height`. For the perimeter the sum must be done before the multiplication.",
        "`area = width * height;` and `perimeter = 2 * (width + height);`",
      ],
      takeaway: "`*` and `/` run before `+` and `-`, and brackets run first of all. Calculate from the variables, not from numbers you worked out yourself.",
    },
    // ------------------------------------------------------------------ 7
    {
      id: "czero-division",
      kind: "calc",
      title: "Division that throws the rest away",
      goal: "Work out what C gives for divisions of whole numbers and their remainders.",
      refs: REFS,
      brief: `
An \`int\` holds whole numbers only. So when C divides one whole number by another, the answer is a whole number too: it counts how many times the second fits into the first, and **throws the rest away**. It does not round.

\`\`\`c
int q = 17 / 5;     // 3, not 3.4
\`\`\`

5 fits into 17 three times (15), and 2 are left over. The operator \`%\` gives you that left-over part, called the **remainder**:

\`\`\`c
int r = 17 % 5;     // 2
\`\`\`

{{figure:c-int-division}}

Try it in the figure: move the sliders. Find a case where \`a / b\` is 0, and a case where \`a % b\` is 0.

## Why you must know this
This rule causes real faults later in the course. \`1 / 2\` is 0, so a motor told to run at "half" of something can be told to run at nothing. You will meet it again with sensor readings.

The remainder is useful too:

- \`n % 2\` is 0 when n is even, and 1 when n is odd
- \`n % 10\` is the last digit of n
- 200 seconds is \`200 / 60\` whole minutes and \`200 % 60\` seconds

## Your task
Enter what C calculates. All the numbers are whole numbers.
`,
      fields: [
        { id: "a", label: "17 / 5", answer: 3, why: "5 fits into 17 three times. The rest is thrown away." },
        { id: "b", label: "17 % 5", answer: 2, why: "3 * 5 is 15, and 17 - 15 leaves 2." },
        { id: "c", label: "1 / 2", answer: 0, why: "2 does not fit into 1 even once. The result is 0, not 0.5 and not 1." },
        { id: "d", label: "20 % 5", answer: 0, why: "20 is exactly 4 * 5: nothing is left over. A remainder of 0 means \"is a multiple of\"." },
        { id: "e", label: "200 / 60 (the whole minutes in 200 seconds)", answer: 3, why: "3 * 60 is 180, which fits. 4 * 60 is 240, which does not." },
        { id: "f", label: "200 % 60 (the seconds left after those minutes)", answer: 20, why: "200 - 180 = 20. So 200 seconds is 3 minutes and 20 seconds." },
      ],
      hints: [
        "For a / b, count how many full groups of b fit into a. For a % b, count what is left after those groups.",
        "Set the sliders in the figure to 17 and 5, and read off both results.",
        "Check each pair with: (a / b) * b + (a % b) must give a again. For 200 and 60: 3 * 60 + 20 = 200.",
      ],
      takeaway: "With whole numbers, `/` keeps the whole part and drops the rest, and `%` gives the rest. `1 / 2` is 0.",
    },
    // ------------------------------------------------------------------ 8
    {
      id: "czero-float",
      kind: "code",
      mode: "debug",
      title: "Numbers with a fraction",
      goal: "Fix an average that comes out as 3.00 when it should be 3.50.",
      refs: REFS,
      brief: `
An \`int\` cannot hold 3.5. For numbers with a fraction C has another kind of box: \`float\`.

The kind of number a variable holds is called its **type**. You now know two types:

- \`int\`: whole numbers, like 7 or -20
- \`float\`: numbers with a fraction, like 3.5 or 0.01 (written with a point)

\`\`\`c
float half = 0.5;
printf("%f\\n", half);      // 0.500000
printf("%.2f\\n", half);    // 0.50
\`\`\`

A float is printed with \`%f\`, not \`%d\`. \`%.2f\` prints it with 2 digits after the point.

There are more types, for bigger whole numbers and for letters. Primer C teaches them. One fact for now: on the robot's chip an \`int\` only reaches from -32768 to 32767. Chapter 0 shows what happens beyond that.

## The trap
The type of a division is decided by the two numbers being divided, not by the box the result goes into.

\`\`\`c
// two whole numbers: 3, stored as 3.0
float a = 7 / 2;

// one of them has a point: 3.5
float b = 7 / 2.0;
\`\`\`

## Your task
A mistake in a program is called a **bug**. The program below has one. It should print the average of 3 and 4:

\`\`\`
Average: 3.50
\`\`\`

Run it, look at what it prints, and fix the one line that is wrong.
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int first = 3;
    int second = 4;
    float average;

    average = (first + second) / 2;
    printf("Average: %.2f\\n", average);
}
`,
      solution: `void main(void)
{
    int first = 3;
    int second = 4;
    float average;

    average = (first + second) / 2.0;
    printf("Average: %.2f\\n", average);
}
`,
      checks: [
        {
          kind: "console",
          includes: "Average: 3.50",
          label: "The program prints Average: 3.50",
          hint: "3.00 means the division was done with two whole numbers: 7 / 2 is 3. Make one side of the division a number with a point.",
        },
        {
          kind: "source",
          mustMatch: "first\\s*\\+\\s*second",
          label: "The average is still calculated from first and second",
          hint: "Keep the calculation. Only the number you divide by needs to change.",
        },
      ],
      hints: [
        "The box `average` is a float, so the box is not the problem. Look at the numbers in the division.",
        "`(first + second)` is a whole number and `2` is a whole number, so the division throws the rest away before anything is stored.",
        "Divide by `2.0` instead of `2`.",
      ],
      takeaway: "`int` holds whole numbers, `float` holds fractions and is printed with `%f`. A division only keeps its fraction when at least one of the two numbers is a float.",
    },
    // ------------------------------------------------------------------ 9
    {
      id: "czero-errors",
      kind: "code",
      mode: "debug",
      title: "When the computer says no",
      goal: "Switch on two broken lines, read the error messages, and fix them.",
      refs: REFS,
      brief: `
Before a program can run, a tool called the **compiler** translates your C text into the chip's own instructions. This is called **compiling**, and it happens every time you press Run.

C has strict rules of spelling and punctuation. If a line breaks one, the compiler cannot translate it. It stops and shows a **compile error**: a message and a line number. Nothing runs.

This is not a disaster. It happens to every programmer many times a day. The message is help, and reading it calmly is a skill:

1. Read the **line number** and go to that line.
2. Read the **message**. It names what the compiler expected or did not understand.
3. Look at that line, and at the line just above it. Many compilers notice a missing semicolon only when they reach the next line.
4. Fix the **first** error only, then run again. One mistake often causes several messages.

Two errors you will see often:

- \`Missing ; at the end of this line\`: a statement has no semicolon.
- \`'scor' is not declared\`: the compiler knows no variable of that name. The name is misspelled, or it was never declared.

Finding and fixing bugs is called **debugging**.

## Your task
The last two lines of the program are switched off: the \`//\` in front makes them comments. Each has one mistake.

Delete the \`//\` in front of both lines and press **Run**. Read the message under the editor, fix that line, and run again. The output must be

\`\`\`
Score: 10
Bonus score: 15
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int score;

    score = 10;
    printf("Score: %d\\n", score);

    // Delete the two slashes in front of the next two lines.
    // Then fix the lines.
    // score = score + 5
    // printf("Bonus score: %d\\n", scor);
}
`,
      solution: `void main(void)
{
    int score;

    score = 10;
    printf("Score: %d\\n", score);

    // Delete the two slashes in front of the next two lines.
    // Then fix the lines.
    score = score + 5;
    printf("Bonus score: %d\\n", score);
}
`,
      checks: [
        {
          kind: "console",
          matches: "^Score: 10\\nBonus score: 15\\n?$",
          label: "The output is Score: 10, then Bonus score: 15",
          hint: "If nothing new is printed, the two lines are still comments: delete the `//` in front of each. If there is an error message, go to the line it names.",
        },
      ],
      hints: [
        "First remove the `//` from both lines and run. Do not try to spot the mistakes by eye: let the compiler point at them.",
        "The first message is about a missing `;`. After you fix it, a second message names a word the compiler does not know. Compare that word with the variable declared at the top.",
        '`score = score + 5;` and `printf("Bonus score: %d\\n", score);`',
      ],
      takeaway: "A compile error is the compiler asking for help with one line. Read the line number, read the message, fix the first error, run again.",
    },
    // ----------------------------------------------------------------- 10
    {
      id: "czero-if",
      kind: "code",
      mode: "complete",
      title: "Making a decision",
      goal: "Make the program print Stop or Go depending on a distance.",
      refs: REFS,
      brief: `
So far every line ran, every time. A robot must **decide**: stop if a wall is close, carry on if not. C does this with \`if\`.

\`\`\`c
if (temp > 25) {
    printf("Fan on\\n");
} else {
    printf("Fan off\\n");
}
\`\`\`

In the round brackets is a **condition**: a question with the answer yes (**true**) or no (**false**). If it is true, the statements in the first pair of braces run. If it is false, the ones after \`else\` run. Never both. The \`else\` part can be left out when there is nothing to do for "no".

The statements between a pair of braces are called a **block**. Lines inside a block are moved to the right (indented) so you can see what belongs to it.

{{figure:c-flow}}

Try it in the figure: step through "if / else" with temp = 30, then with temp = 20. Watch which line is jumped over.

## Comparing
A condition usually compares two values:

- \`<\` less than, \`>\` greater than
- \`<=\` less than or equal, \`>=\` greater than or equal
- \`==\` equal (two signs), \`!=\` not equal

## Your task
At the TODO, add an if / else: when \`distance\` is less than 20, print \`Stop\`. Otherwise print \`Go\`. The output must be

\`\`\`
Distance: 12
Stop
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int distance = 12;

    printf("Distance: %d\\n", distance);
    // TODO: if distance is less than 20 print Stop,
    //       otherwise print Go
}
`,
      solution: `void main(void)
{
    int distance = 12;

    printf("Distance: %d\\n", distance);
    if (distance < 20) {
        printf("Stop\\n");
    } else {
        printf("Go\\n");
    }
}
`,
      checks: [
        {
          kind: "console",
          matches: "^Distance: 12\\nStop\\n?$",
          label: "With a distance of 12 the program prints Stop, and not Go",
          hint: "If it prints Go, the comparison points the wrong way: you want `distance < 20`. If it prints both, one printf is outside the braces of the if / else.",
        },
        {
          kind: "source",
          mustMatch: "\\bif\\s*\\([^)]*distance[^)]*\\)",
          label: "An if tests the variable distance",
          hint: "The condition goes in round brackets right after `if`, and it must use the name `distance`.",
        },
        {
          kind: "source",
          mustMatch: "\\belse\\b[\\s\\S]*Go",
          label: "The else part prints Go",
          hint: "After the closing brace of the if block, write `else {`, the printf for Go, and `}`.",
        },
      ],
      hints: [
        "Copy the shape of the fan example: `if (...) { ... } else { ... }`.",
        "The condition is `distance < 20`. The first block prints Stop, the block after else prints Go.",
        'if (distance < 20) { printf("Stop\\n"); } else { printf("Go\\n"); }',
      ],
      takeaway: "`if (condition) { ... } else { ... }` runs exactly one of its two blocks. A condition is a question whose answer is true or false.",
    },
    // ----------------------------------------------------------------- 11
    {
      id: "czero-equals",
      kind: "code",
      mode: "debug",
      title: "One sign too few",
      goal: "Find out why checking the lives changes the lives.",
      refs: REFS,
      brief: `
C has two signs that look alike and do different jobs:

- \`=\` **stores** a value: \`lives = 3;\`
- \`==\` **compares** two values: \`if (lives == 3)\`

Writing \`=\` where you meant \`==\` is the most famous bug in C. The compiler accepts it, because it is legal:

\`\`\`c
if (x = 5) {
\`\`\`

This does not ask "is x equal to 5?". It **stores** 5 in x. Then C uses the stored number as the answer, with one rule: **0 counts as false, every other number counts as true**. So this \`if\` is always true, and x has been changed without your noticing.

The simulator helps here. Under the editor it shows a **warning**: a message about a line that is legal C but is probably a mistake. A warning does not stop the program. Read it anyway.

## Your task
The program has 3 lives. It should print

\`\`\`
Keep playing
Lives: 3
\`\`\`

Run it. Look at the second line it prints and at the warning under the editor. Then fix the bug.
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int lives = 3;

    if (lives = 0) {
        printf("Game over\\n");
    } else {
        printf("Keep playing\\n");
    }
    printf("Lives: %d\\n", lives);
}
`,
      solution: `void main(void)
{
    int lives = 3;

    if (lives == 0) {
        printf("Game over\\n");
    } else {
        printf("Keep playing\\n");
    }
    printf("Lives: %d\\n", lives);
}
`,
      checks: [
        {
          kind: "console",
          matches: "^Keep playing\\nLives: 3\\n?$",
          label: "The output is Keep playing, then Lives: 3",
          hint: "Lives: 0 means the if stored a 0 in lives when it should only have compared.",
        },
        {
          kind: "no-diagnostic",
          code: "assign-in-condition",
          label: "No condition uses = where == is meant",
          hint: "In the round brackets of the if, write `==`.",
        },
      ],
      hints: [
        "The program starts with 3 lives and never takes one away on purpose. Which line could have changed `lives`?",
        "Look at the condition of the if. How many `=` signs does a comparison need?",
        "`if (lives == 0) {`",
      ],
      takeaway: "`=` stores, `==` compares. In a condition, 0 is false and any other number is true. Read warnings: they often point at exactly this.",
    },
    // ----------------------------------------------------------------- 12
    {
      id: "czero-logic",
      kind: "quiz",
      title: "And, or, not",
      goal: "Decide whether four combined conditions are true or false.",
      refs: REFS,
      brief: `
One comparison is often not enough. "Drive if the path is clear **and** the battery is charged." C joins conditions with three operators:

- \`a && b\` (**and**) is true only when both sides are true
- \`a || b\` (**or**) is true when at least one side is true
- \`!a\` (**not**) turns true into false and false into true

\`\`\`c
int distance = 50;
int battery = 80;

// true and true: this prints
if (distance > 20 && battery > 30) {
    printf("Drive\\n");
}
// false or false: this is skipped
if (distance < 5 || battery < 10) {
    printf("Stop\\n");
}
// not true is false: this is skipped
if (!(battery > 30)) {
    printf("Charge\\n");
}
\`\`\`

## One trap
Maths lets you write 1 < x < 10. In C you must write two comparisons and join them:

\`\`\`c
if (x > 1 && x < 10) {
\`\`\`

Work out each side by itself first, then combine the two answers.

## Your task
For the questions, \`speed\` holds 8 and \`load\` holds 3.
`,
      questions: [
        {
          prompt: "`speed` is 8 and `load` is 3. Is `speed > 5 && load > 5` true or false?",
          options: ["True", "False"],
          answer: 1,
          why: "`speed > 5` is true, but `load > 5` is false. And needs both sides to be true.",
        },
        {
          prompt: "`speed` is 8 and `load` is 3. Is `speed > 5 || load > 5` true or false?",
          options: ["True", "False"],
          answer: 0,
          why: "Or needs only one true side, and `speed > 5` is true.",
        },
        {
          prompt: "`speed` is 8. Is `!(speed == 8)` true or false?",
          options: ["True", "False"],
          answer: 1,
          why: "`speed == 8` is true, and not turns true into false. The same test can be written `speed != 8`.",
        },
        {
          prompt: "Which condition is true exactly when `load` is from 1 to 5, including 1 and 5?",
          options: ["`load >= 1 || load <= 5`", "`1 <= load <= 5`", "`load >= 1 && load <= 5`", "`load > 1 && load < 5`"],
          answer: 2,
          why: "Both limits must hold at once, so they are joined with and. The or version is true for every number. `1 <= load <= 5` is not a range test in C. The last one leaves out 1 and 5.",
        },
      ],
      hints: [
        "Replace each name with its number, then decide each comparison by itself.",
        "Write T or F under each comparison. And: both must be T. Or: one T is enough. Not: flip it.",
        "With speed 8 and load 3: `speed > 5` is true, `load > 5` is false.",
      ],
      takeaway: "`&&` needs both sides true, `||` needs one, `!` flips. A range is two comparisons joined with `&&`.",
    },
    // ----------------------------------------------------------------- 13
    {
      id: "czero-while",
      kind: "code",
      mode: "complete",
      title: "Do it again",
      goal: "Write a loop that counts down from 5 to 1.",
      refs: REFS,
      brief: `
Computers are good at repeating. A piece of program that runs again and again is called a **loop**. The simplest loop in C is \`while\`:

\`\`\`c
int count = 1;

while (count <= 3) {
    printf("%d\\n", count);
    count = count + 1;
}
printf("Done\\n");
\`\`\`

It looks like an \`if\`, with one difference. After the block has run, the program jumps **back up** and asks the condition again. As long as the answer is true, the block runs once more. When it is false, the program carries on after the block. This prints 1, 2, 3, Done.

{{figure:c-flow}}

Try it in the figure: choose "while" and step through it. Count how many times the condition is asked.

## The line that must not be forgotten
Something inside the block must change the variable in the condition. Without \`count = count + 1;\` the answer stays true and the loop never ends. If your program prints the same line thousands of times, that is what happened: look for the missing change.

## Your task
\`count\` starts at 5. At the TODO, write a while loop that prints \`count\` and then takes 1 away from it, as long as \`count\` is greater than 0. The output must be

\`\`\`
5
4
3
2
1
Liftoff
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int count = 5;

    // TODO: while count is greater than 0:
    //       print count, then take 1 away from it

    printf("Liftoff\\n");
}
`,
      solution: `void main(void)
{
    int count = 5;

    while (count > 0) {
        printf("%d\\n", count);
        count = count - 1;
    }

    printf("Liftoff\\n");
}
`,
      checks: [
        {
          kind: "console",
          matches: "^5\\n4\\n3\\n2\\n1\\nLiftoff\\n?$",
          label: "The output is 5, 4, 3, 2, 1, Liftoff",
          hint: "A 0 before Liftoff means the condition should be `count > 0`, not `count >= 0`. The same number printed over and over means nothing in the block changes count.",
        },
        {
          kind: "source",
          mustMatch: "\\bwhile\\s*\\(",
          label: "The numbers are printed by a while loop",
          hint: "Do not write five printf lines. One printf inside a while loop does the job.",
        },
      ],
      hints: [
        "The loop needs three things: a condition, a printf that prints count, and a line that makes count smaller.",
        'The condition is `count > 0`. The printf is `printf("%d\\n", count);`.',
        'while (count > 0) { printf("%d\\n", count); count = count - 1; }',
      ],
      takeaway: "`while (condition) { ... }` repeats its block as long as the condition is true. Something in the block must change what the condition tests.",
    },
    // ----------------------------------------------------------------- 14
    {
      id: "czero-for",
      kind: "code",
      mode: "write",
      title: "Counting with for",
      goal: "Add up the numbers from 1 to 10 with a for loop.",
      refs: REFS,
      brief: `
Most loops count: start at a number, test, do the work, step to the next number. A counting \`while\` loop spreads those parts over three places. The \`for\` loop puts them on one line:

\`\`\`c
int i;

for (i = 1; i <= 3; i++) {
    printf("%d\\n", i);
}
\`\`\`

Between the round brackets are three parts, separated by semicolons:

1. \`i = 1\` is the **start**. It runs once.
2. \`i <= 3\` is the **test**. It is asked before every pass. When it is false, the loop ends.
3. \`i++\` is the **step**. It runs after every pass.

This prints 1, 2, 3. The counting variable is very often called \`i\`.

{{figure:c-flow}}

Try it in the figure: choose "for" and watch the three parts of line 5 take turns.

## One too few, one too many
The classic loop bug is being wrong by one pass, called an **off-by-one** error. \`i < 3\` stops after 2. \`i <= 3\` includes 3. Each time you write a loop, ask: what is the first value, and what is the last value that must still run?

## Your task
At the TODO, write a for loop that adds every number from 1 to 10 to \`sum\`, 10 included. Inside the loop you need one statement: \`sum += i;\`. The output must be

\`\`\`
Sum: 55
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `void main(void)
{
    int i;
    int sum = 0;

    // TODO: a for loop that adds 1, 2, 3 ... 10 to sum

    printf("Sum: %d\\n", sum);
}
`,
      solution: `void main(void)
{
    int i;
    int sum = 0;

    for (i = 1; i <= 10; i++) {
        sum += i;
    }

    printf("Sum: %d\\n", sum);
}
`,
      checks: [
        {
          kind: "console",
          includes: "Sum: 55",
          label: "The program prints Sum: 55",
          hint: "45 means the loop stopped after 9: use `i <= 10`, not `i < 10`. 66 means it went on to 11.",
        },
        {
          kind: "source",
          mustMatch: "\\bfor\\s*\\(",
          label: "The sum is built by a for loop",
          hint: "Write the loop as `for (start; test; step) { ... }` with semicolons between the three parts.",
        },
      ],
      hints: [
        "Use the example loop. Change where it stops and what its block does.",
        "The first value is 1 and the last value that must still run is 10, so the test is `i <= 10`.",
        "for (i = 1; i <= 10; i++) { sum += i; }",
      ],
      takeaway: "`for (start; test; step)` is a counting loop on one line. Check the first and the last value every time: `<` and `<=` differ by exactly one pass.",
    },
    // ----------------------------------------------------------------- 15
    {
      id: "czero-forever",
      kind: "quiz",
      title: "The loop that never ends",
      goal: "Read why a robot program never finishes, then answer three questions.",
      refs: REFS,
      brief: `
The programs so far ran to their last line and stopped. That is fine on a desk. On a robot it would be a fault: a program that has ended reads no sensors and drives no motors. The chip just sits there until it is switched off and on again.

A **microcontroller** is a small computer on one chip, built into a machine. The robot has one. Its program must keep working for as long as the power is on. So it is built like this:

\`\`\`c
void main(void)
{
    // 1. set things up, once
    printf("Start\\n");

    // 2. then repeat the work for ever
    while (1) {
        // read sensors, decide, drive
    }
}
\`\`\`

You know why \`while (1)\` never ends: a condition is true when it is not 0, and 1 is never 0. A loop that never ends is called an **endless loop**. In the level "Do it again" it was a bug. Here it is on purpose.

You will often see it with an empty block:

\`\`\`c
while (1) {}
\`\`\`

This repeats "do nothing" for ever. It holds the program in place. The real work is then done by special functions that the chip's hardware starts, which chapter 5 teaches.

From now on, every program in this game ends with \`while (1)\`, as every program on the real board does.
`,
      questions: [
        {
          prompt: "How many times does the block of `while (1) { ... }` run?",
          options: ["Exactly once", "Again and again, until the power is switched off", "Never, because 1 is not a comparison", "Until the variable it counts reaches 1"],
          answer: 1,
          why: "The condition is the number 1, which always counts as true. Nothing inside can make it false.",
        },
        {
          prompt: "What does this program print?\n\n```c\nvoid main(void)\n{\n    printf(\"A\\n\");\n    while (1) {}\n    printf(\"B\\n\");\n}\n```",
          options: ["A, then B", "A again and again", "A, and nothing more", "B, then A"],
          answer: 2,
          why: "A is printed once, before the loop. The program then stays in the empty loop for ever, so the line that prints B is never reached.",
        },
        {
          prompt: "Why does a microcontroller program end in an endless loop?",
          options: [
            "Because C does not allow main to end",
            "To make the program run faster",
            "So that the setup lines run again and again",
            "The machine must keep working for as long as it has power, and a program that has ended does nothing",
          ],
          answer: 3,
          why: "The setup lines above the loop run once. The loop keeps the program alive. C would let main end, but the robot would stop responding.",
        },
      ],
      hints: [
        "Remember the rule from \"One sign too few\": which numbers count as true?",
        "Trace the second question line by line. Ask where the program is after it enters the loop.",
        "Lines above `while (1)` run once. Lines inside it run for ever. Lines below it never run.",
      ],
      takeaway: "A microcontroller program sets up once and then loops for ever in `while (1)`. Code after that loop never runs.",
    },
    // ----------------------------------------------------------------- 16
    {
      id: "czero-call",
      kind: "code",
      mode: "complete",
      title: "Use a function",
      goal: "Call a given function a second time with a different input.",
      refs: REFS,
      brief: `
A **function** is a group of statements with a name, written once, that does one job. To get the job done you write the name: this is a **call**. You have called a function in every level: \`printf\`.

\`\`\`c
int twice(int n)
{
    return n * 2;
}
\`\`\`

This function is named \`twice\`. You do not need to write one yet, only to use one:

\`\`\`c
a = twice(4);       // a becomes 8
b = twice(10);      // b becomes 20
\`\`\`

- The value in the brackets of the call is the **argument**: the input you hand over.
- Inside the function it arrives in \`n\`, the function's **parameter**: a variable that receives the argument.
- \`return\` ends the function and sends one value back: the **return value**. The call stands for that value, so it can be stored, printed or used in a calculation.

{{figure:c-function-call}}

Try it in the figure: step through both calls. Watch the 4 travel into \`n\`, and the 8 travel back.

Why bother? The job is written once, has a name that says what it does, and can be used with any input.

## Your task
The function \`square\` is given: it returns its input multiplied by itself. \`main\` stores \`square(3)\` in \`small\`. At the TODO, store the square of 12 in \`big\` by calling the function. The output must be

\`\`\`
9 and 144
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `// Given: returns n multiplied by itself.
int square(int n)
{
    return n * n;
}

void main(void)
{
    int small;
    int big;

    small = square(3);
    big = 0;            // TODO: call square with the argument 12

    printf("%d and %d\\n", small, big);
    while (1) {}
}
`,
      solution: `// Given: returns n multiplied by itself.
int square(int n)
{
    return n * n;
}

void main(void)
{
    int small;
    int big;

    small = square(3);
    big = square(12);

    printf("%d and %d\\n", small, big);
    while (1) {}
}
`,
      checks: [
        { kind: "console", includes: "9 and 144", label: "The program prints 9 and 144", hint: "`big` must receive what `square` returns for 12. Look at how `small` gets its value one line above." },
        {
          kind: "source",
          mustMatch: "square\\s*\\(\\s*12\\s*\\)",
          label: "The function square is called with the argument 12",
          hint: "Do not calculate 144 yourself. Write `square(12)` and let the function do it.",
        },
      ],
      hints: [
        "The line for `small` is the pattern. Only the variable and the argument differ.",
        "A call is the function's name followed by the argument in round brackets.",
        "`big = square(12);`",
      ],
      takeaway: "A call hands an argument to a function and stands for the value the function returns. One function, written once, serves every input.",
    },
    // ----------------------------------------------------------------- 17
    {
      id: "czero-function",
      kind: "code",
      mode: "write",
      title: "Write a function",
      goal: "Write the body of a function that returns the larger of two numbers.",
      refs: REFS,
      brief: `
Now the other side: writing a function. Its first line has three parts.

\`\`\`c
int add(int a, int b)
{
    return a + b;
}
\`\`\`

- \`int\` in front: the type of the value it returns.
- \`add\`: its name.
- \`(int a, int b)\`: its parameters, each with a type, separated by commas. A call must hand over one argument for each: \`add(2, 3)\`.

The block that follows is the **body**: the statements that run on each call. \`return\` ends the function at once and sends its value back. A function can have several returns, for example one in each part of an if / else.

Write a function above the place where it is called, so the compiler has seen it.

## The frame, explained at last
\`void main(void)\` is a function too. Its name is \`main\`, and it is the one function the chip calls by itself when it starts. The word \`void\` means "nothing": the first one says main returns no value, the one in the brackets says it takes no arguments.

## Your task
Complete the function \`larger\`. It takes two whole numbers and returns the bigger one. If both are equal, return either. \`main\` is given: it calls your function three times and prints the results, which must be

\`\`\`
8
9
5
\`\`\`
`,
      kit: "launchpad",
      durationMs: 1,
      starter: `// Returns the larger of a and b.
int larger(int a, int b)
{
    return 0;   // TODO: replace this line with your own statements
}

// Given: calls larger three times.
void main(void)
{
    printf("%d\\n", larger(3, 8));
    printf("%d\\n", larger(9, 2));
    printf("%d\\n", larger(5, 5));
    while (1) {}
}
`,
      solution: `// Returns the larger of a and b.
int larger(int a, int b)
{
    if (a > b) {
        return a;
    } else {
        return b;
    }
}

// Given: calls larger three times.
void main(void)
{
    printf("%d\\n", larger(3, 8));
    printf("%d\\n", larger(9, 2));
    printf("%d\\n", larger(5, 5));
    while (1) {}
}
`,
      checks: [
        { kind: "console", matches: "^8\\n", label: "larger(3, 8) returns 8", hint: "When the second number is the bigger one, the function must return b." },
        { kind: "console", matches: "^-?\\d+\\n9\\n", label: "larger(9, 2) returns 9", hint: "The function must compare its two parameters. Returning always the same one cannot be right for both calls." },
        { kind: "console", matches: "^-?\\d+\\n-?\\d+\\n5\\n", label: "larger(5, 5) returns 5", hint: "When both are equal, returning either a or b gives 5." },
      ],
      hints: [
        "The function has to decide between its two parameters. Which statement makes decisions?",
        "Compare with `a > b`. In one block return a, in the other return b.",
        "if (a > b) { return a; } else { return b; }",
      ],
      takeaway: "A function is `type name(parameters) { body }`. `return` hands one value back to the caller. `main` is the function the chip starts with.",
    },
    // ----------------------------------------------------------------- 18
    {
      id: "czero-void",
      kind: "order",
      title: "A function that returns nothing",
      goal: "Put the lines of a program in order so that it prints Hello twice.",
      refs: REFS,
      brief: `
Not every job produces a value. A function that only **does** something, like printing a line or switching on a light, returns nothing. Its type is \`void\`, and it needs no \`return\`:

\`\`\`c
void beep(void)
{
    printf("Beep\\n");
}
\`\`\`

The second \`void\`, in the brackets, means it takes no arguments either. You call it with empty brackets, as a statement of its own:

\`\`\`c
beep();
\`\`\`

There is nothing to store, so there is no \`=\` in front.

## Who runs when
Remember the order in which things happen:

- The program starts at the first line inside \`main\`, wherever \`main\` is written in the file.
- The lines of another function run only when it is called, and each time it is called.
- When the function ends, the program carries on right after the call.
- A function is written above the function that calls it.

## Your task
Below are the pieces of a small program, shuffled. It has a function \`greet\` that prints Hello, and a \`main\` that calls it two times and then stays in the endless loop. Put the pieces in the order they must be written in the file.
`,
      steps: [
        "```c\nvoid greet(void)\n{\n```",
        '`    printf("Hello\\n");`',
        "`}`",
        "```c\nvoid main(void)\n{\n```",
        "`    greet();`",
        "`    greet();`",
        "`    while (1) {}`",
        "`}`",
      ],
      hints: [
        "Build the function greet first, complete with its closing brace, then main below it.",
        "Inside main, think about which line would stop everything after it from running.",
        "greet's first line, the printf, a closing brace; then main's first line, the two calls, the endless loop, a closing brace.",
      ],
      takeaway: "A `void` function does a job and returns nothing. Functions are written above their callers, and nothing placed after `while (1) {}` ever runs.",
    },
    // ----------------------------------------------------------------- 19
    {
      id: "czero-scope",
      kind: "code",
      mode: "debug",
      title: "Whose box is it",
      goal: "Fix a counter that stays at 0 although its function is called three times.",
      refs: REFS,
      brief: `
Where you declare a variable decides who can use it and how long it lives. This is called its **scope**.

- A **local** variable is declared inside a function. Only that function can use it. It is made when the function starts and thrown away when the function ends. All your variables so far were local to \`main\`. Parameters are local too.
- A **global** variable is declared at the top of the file, outside every function. Every function below can read and change it. It lives for as long as the program runs, and it starts at 0.

\`\`\`c
// global: shared by all functions
int total;

void addTen(void)
{
    // local: lives only during a call
    int step = 10;

    total = total + step;
}
\`\`\`

Use locals for working values: nothing else can disturb them. Use a global when a value must be remembered between calls or shared. This course uses globals for values shared with interrupt functions (functions the chip's hardware calls by itself, chapter 5), because nothing can hand those an argument.

From here on, the tests read your global variables, and the panel next to the board shows them while the program runs.

## The trap
If a function declares a local with the **same name** as a global, the local hides the global inside that function.

## Your task
\`countCall\` should add 1 to the global \`calls\` each time it runs. \`main\` calls it three times, but the program prints \`Calls: 0\`. Find out why and fix it. The global \`calls\` must end at 3.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["calls"],
      starter: `int calls;      // global: how many times countCall has run

void countCall(void)
{
    int calls = 0;
    calls = calls + 1;
}

void main(void)
{
    countCall();
    countCall();
    countCall();
    printf("Calls: %d\\n", calls);
    while (1) {}
}
`,
      solution: `int calls;      // global: how many times countCall has run

void countCall(void)
{
    calls = calls + 1;
}

void main(void)
{
    countCall();
    countCall();
    countCall();
    printf("Calls: %d\\n", calls);
    while (1) {}
}
`,
      checks: [
        {
          kind: "var",
          name: "calls",
          equals: 3,
          label: "The global variable calls holds 3 after three calls",
          hint: "Inside countCall there is a second box named calls. The function adds 1 to that one, and it is thrown away when the function ends.",
        },
        { kind: "console", includes: "Calls: 3", label: "The program prints Calls: 3", hint: "Leave the printf line in main as it is. It prints the global variable." },
      ],
      hints: [
        "There are two declarations of a variable named `calls`. Find both.",
        "The line `int calls = 0;` inside the function makes a new local box on every call. The global one is never touched.",
        "Delete the line `int calls = 0;` inside countCall. Keep `calls = calls + 1;`.",
      ],
      takeaway: "A local variable lives inside one call of one function. A global lives for the whole program and is shared. A local with the same name hides the global.",
    },
    // ----------------------------------------------------------------- 20
    {
      id: "czero-define",
      kind: "code",
      mode: "complete",
      title: "Give numbers a name",
      goal: "Replace a number that is scattered through a program with one named constant.",
      refs: REFS,
      brief: `
Look at this line: \`spare = 40 - 12;\`. What is the 12? A bare number in a program, with no hint of what it stands for, is called a **magic number**. It has two problems: nobody knows what it means, and if it must change, you have to find every copy without missing one.

C lets you give a number a name:

\`\`\`c
#define WHEELS 4
\`\`\`

This line goes at the top of the file. Before compiling, every \`WHEELS\` in the program is replaced by \`4\`. Such a named, fixed value is called a **constant**.

\`\`\`c
// the compiler sees: legs = 4 * 2;
legs = WHEELS * 2;
\`\`\`

Three things differ from a variable:

- There is **no** \`=\` and **no** semicolon on a \`#define\` line.
- The name is written in capital letters, by habit, so you can tell it from a variable.
- It cannot be changed while the program runs. \`WHEELS = 5;\` is an error.

The robot code is full of these: pin numbers, speed limits, timer periods.

## Your task
A crate held 12 bottles. The program uses that 12 in two places. Now the crates hold **24**.

1. At the top, add \`#define PER_CRATE 24\`.
2. Replace both 12s with the name \`PER_CRATE\`.

The global \`bottles\` must end at 72 and \`spare\` at 16.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["bottles", "spare"],
      starter: `// TODO: define PER_CRATE here

int bottles;    // bottles in three full crates
int spare;      // bottles left when 40 arrive and one crate is filled

void main(void)
{
    bottles = 3 * 12;
    spare = 40 - 12;
    printf("%d bottles, %d spare\\n", bottles, spare);
    while (1) {}
}
`,
      solution: `#define PER_CRATE 24

int bottles;    // bottles in three full crates
int spare;      // bottles left when 40 arrive and one crate is filled

void main(void)
{
    bottles = 3 * PER_CRATE;
    spare = 40 - PER_CRATE;
    printf("%d bottles, %d spare\\n", bottles, spare);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "bottles", equals: 72, label: "bottles is 72 (three crates of 24)", hint: "`bottles = 3 * PER_CRATE;` with PER_CRATE defined as 24." },
        { kind: "var", name: "spare", equals: 16, label: "spare is 16 (40 minus one crate of 24)", hint: "The second 12 must become PER_CRATE as well. This is the copy that is easy to miss." },
        {
          kind: "source",
          mustMatch: "#define\\s+PER_CRATE\\s+24\\s*\\n",
          label: "PER_CRATE is defined as 24, with no = and no semicolon",
          hint: "The line is exactly `#define PER_CRATE 24`. If you see the error \"Unexpected '='\" further down, the mistake is an = sign on the #define line.",
        },
        {
          kind: "source",
          mustMatch: "3\\s*\\*\\s*PER_CRATE[\\s\\S]*40\\s*-\\s*PER_CRATE",
          label: "Both calculations use the name PER_CRATE",
          hint: "Write the name where each 12 was. Do not type 24 into the calculations.",
        },
      ],
      hints: [
        "Two kinds of change: one new line at the very top, and two numbers swapped for a name.",
        "The new line has three parts separated by spaces: `#define`, the name, the value.",
        "`#define PER_CRATE 24`, then `bottles = 3 * PER_CRATE;` and `spare = 40 - PER_CRATE;`",
      ],
      takeaway: "`#define NAME value` gives a number a name. The value lives in one place, so a change is one edit and the code says what the number means.",
    },
    // ----------------------------------------------------------------- 21
    {
      id: "czero-trace",
      kind: "calc",
      title: "Predict before you run",
      goal: "Trace three short programs by hand and enter what their variables hold at the end.",
      refs: REFS,
      brief: `
Before you run a program, **predict** what it will do. If the run agrees, you understand the program. If it does not, you have found exactly the spot where your picture of it is wrong. That is how bugs are found.

Trace with a table, one row per step. For a loop, write a new row for every pass, and do not skip the last test: the one that is false.

\`\`\`c
int i;
int total = 0;
for (i = 1; i <= 3; i++) {
    total += i * 10;
}
\`\`\`

- pass 1: i is 1, total becomes 10
- pass 2: i is 2, total becomes 30
- pass 3: i is 3, total becomes 60
- i is 4: the test is false, the loop ends with total 60

## Your task
Trace these on paper, then enter the values.

\`\`\`c
// Program 1
int i;
int total = 0;
for (i = 1; i <= 4; i++) {
    if (i % 2 == 0) {
        total += i;
    }
}
\`\`\`

\`\`\`c
// Program 2
int n = 20;
int steps = 0;
while (n > 1) {
    n = n / 2;
    steps++;
}
\`\`\`

\`\`\`c
// Program 3
int mystery(int a)
{
    if (a > 10) {
        return a - 10;
    }
    return a * 2;
}
// ... and inside main:
x = mystery(7);
y = mystery(x);
\`\`\`
`,
      fields: [
        { id: "total", label: "Program 1: total at the end", answer: 6, why: "`i % 2 == 0` is true for the even values of i: 2 and 4. Only those are added: 2 + 4 = 6." },
        { id: "steps", label: "Program 2: steps at the end", answer: 4, why: "n goes 20, 10, 5, 2, 1. That is four halvings (5 / 2 is 2: the rest is thrown away). Then 1 > 1 is false." },
        { id: "x", label: "Program 3: x", answer: 14, why: "7 is not greater than 10, so the if block is skipped and the function returns 7 * 2 = 14." },
        { id: "y", label: "Program 3: y", answer: 4, why: "x holds 14, which is greater than 10. The first return runs: 14 - 10 = 4. The line after the if is not reached." },
      ],
      hints: [
        "Make a table for each program: one column per variable, one row per pass of the loop.",
        "Program 1: which values of i leave no remainder when divided by 2? Program 2: remember that the division is whole-number division.",
        "Program 2: 20, 10, 5, 2, 1. Program 3: the second call gets the result of the first call as its argument.",
      ],
      takeaway: "Predict, then run. A wrong prediction is not a failure: it points at the line you have not understood yet.",
    },
    // ----------------------------------------------------------------- 22
    {
      id: "czero-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: sort the parcels",
      goal: "Write a function and a loop, from a nearly empty file, that count and add up the even numbers.",
      refs: REFS,
      brief: `
This level uses everything in the chapter. There is no new idea. Take it in the two steps below, and run after each.

A sorting robot handles parcels numbered 1 to \`LAST\`. Every parcel with an **even** number goes into the left bin. The robot must know how many parcels went left, and the sum of their numbers.

## Step 1: the function
Above \`main\`, write a function named \`isEven\`. It takes one \`int\` and returns an \`int\`: **1** if the number is even, **0** if it is odd. (A number is even when dividing it by 2 leaves no remainder.)

## Step 2: the loop
In \`main\`, above the endless loop, write a loop that goes through every number from 1 to \`LAST\`, with \`LAST\` included. For each number, call \`isEven\`. When it returns 1:

- add 1 to the global \`evenCount\`
- add the number itself to the global \`evenSum\`

After the loop, print the result in exactly this form:

\`\`\`
Even: 10, sum 110
\`\`\`

## Names the tests use
\`LAST\`, \`evenCount\` and \`evenSum\` are given. The function must be called \`isEven\`, and your loop must use \`LAST\`, not the number 20.

If you get a compile error, do what you practised: line number, message, first error only.
`,
      kit: "launchpad",
      durationMs: 2,
      watch: ["evenCount", "evenSum"],
      starter: `#define LAST 20

int evenCount;      // how many even numbers there are from 1 to LAST
int evenSum;        // the sum of those even numbers

// TODO 1: write the function isEven here

void main(void)
{
    // TODO 2: write the loop and the printf here

    while (1) {}
}
`,
      solution: `#define LAST 20

int evenCount;      // how many even numbers there are from 1 to LAST
int evenSum;        // the sum of those even numbers

// Returns 1 if n is even, 0 if n is odd.
int isEven(int n)
{
    if (n % 2 == 0) {
        return 1;
    }
    return 0;
}

void main(void)
{
    int i;

    for (i = 1; i <= LAST; i++) {
        if (isEven(i) == 1) {
            evenCount++;
            evenSum += i;
        }
    }
    printf("Even: %d, sum %d\\n", evenCount, evenSum);

    while (1) {}
}
`,
      checks: [
        {
          kind: "var",
          name: "evenCount",
          equals: 10,
          label: "evenCount is 10",
          hint: "9 means the loop stops before LAST: use `<=`. 20 means every number is counted: the if must test what isEven returns.",
        },
        {
          kind: "var",
          name: "evenSum",
          equals: 110,
          label: "evenSum is 110 (2 + 4 + ... + 20)",
          hint: "Add the number itself (the loop variable), not 1. 90 means the loop stops before 20.",
        },
        {
          kind: "console",
          includes: "Even: 10, sum 110",
          label: "The program prints Even: 10, sum 110",
          hint: "The printf needs two %d placeholders and both globals after the text. It must be after the loop and above `while (1) {}`: nothing below the endless loop runs.",
        },
        {
          kind: "source",
          mustMatch: "\\bint\\s+isEven\\s*\\(\\s*int\\s+\\w+\\s*\\)\\s*\\{",
          label: "There is a function int isEven(int ...)",
          hint: "Its first line is `int isEven(int n)`, with no semicolon at the end, followed by the body in braces.",
        },
        {
          kind: "source",
          mustMatch: "isEven\\s*\\([\\s\\S]*\\bmain\\b[\\s\\S]*(for|while)\\s*\\([^\\n]*LAST[\\s\\S]*isEven\\s*\\(",
          label: "main loops up to LAST and calls isEven",
          hint: "The loop in main must use the name LAST in its test and call isEven inside its block.",
        },
      ],
      hints: [
        "Start with the function and nothing else. `n % 2` is the remainder after dividing by 2. What is it for an even number?",
        "The loop is a for loop from 1 to LAST with `<=`. Inside it: `if (isEven(i) == 1) { ... }` with the two additions in the block.",
        "isEven: `if (n % 2 == 0) { return 1; } return 0;`. In main: `for (i = 1; i <= LAST; i++) { if (isEven(i) == 1) { evenCount++; evenSum += i; } }` and then the printf.",
      ],
      takeaway: "You wrote a function, a loop, a decision and a printf from a nearly empty file. That is a complete C program, and everything on the robot is built from these same pieces.",
    },
    // ------------------------------------------------------------ practice
    {
      id: "czero-sum",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: add up 1 to n",
      goal: "Write a function that returns the sum of the whole numbers from 1 to n.",
      refs: REFS,
      brief: `
You added up 1 to 10 inside \`main\`. Now put the same job into a function, so it works for any end value.

A loop that builds up a result needs a variable that starts at 0 and grows on every pass. Here is the pattern, counting how many numbers up to \`n\` are odd:

\`\`\`c
int countOdd(int n)
{
    int i;
    int count = 0;

    for (i = 1; i <= n; i++) {
        if (i % 2 == 1) {
            count++;
        }
    }
    return count;
}
\`\`\`

\`i\` and \`count\` are local: every call gets fresh ones.

## Your task
Complete \`sumTo\`. It takes an \`int n\` and returns 1 + 2 + ... + n. For n = 4 that is 1 + 2 + 3 + 4 = 10.

\`main\` is given. It calls your function three times and stores the results in the globals \`sum4\`, \`sum10\` and \`sum100\`, which the tests read.
`,
      kit: "launchpad",
      durationMs: 2,
      watch: ["sum4", "sum10", "sum100"],
      starter: `int sum4;
int sum10;
int sum100;

// Returns 1 + 2 + ... + n.
int sumTo(int n)
{
    return 0;   // TODO: replace this line with your own statements
}

// Given: the tests read sum4, sum10 and sum100.
void main(void)
{
    sum4 = sumTo(4);
    sum10 = sumTo(10);
    sum100 = sumTo(100);
    while (1) {}
}
`,
      solution: `int sum4;
int sum10;
int sum100;

// Returns 1 + 2 + ... + n.
int sumTo(int n)
{
    int i;
    int sum = 0;

    for (i = 1; i <= n; i++) {
        sum += i;
    }
    return sum;
}

// Given: the tests read sum4, sum10 and sum100.
void main(void)
{
    sum4 = sumTo(4);
    sum10 = sumTo(10);
    sum100 = sumTo(100);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "sum4", equals: 10, label: "sumTo(4) returns 10", hint: "6 means the loop stops one pass early: the last value, n itself, must be added too." },
        { kind: "var", name: "sum10", equals: 55, label: "sumTo(10) returns 55", hint: "The loop must run up to the parameter n, not up to a fixed number." },
        { kind: "var", name: "sum100", equals: 5050, label: "sumTo(100) returns 5050", hint: "Start the local sum at 0 inside the function, so every call begins fresh." },
      ],
      hints: [
        "You need two local variables: one to count with and one to collect the sum, which starts at 0.",
        "The loop goes from 1 to n with `<=`. Its block adds the counter to the sum.",
        "int i; int sum = 0; for (i = 1; i <= n; i++) { sum += i; } return sum;",
      ],
      takeaway: "Start a result at 0, grow it in a loop, return it at the end. Because the limit is a parameter, one function answers every case.",
    },
    {
      id: "czero-largest",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: the largest of three",
      goal: "Write a function that returns the largest of three numbers.",
      refs: REFS,
      brief: `
A robot with three distance sensors often needs the largest or the smallest reading. Two numbers are easy to compare. Three need a plan.

One plan that always works: keep a "best so far".

\`\`\`c
int smallest(int a, int b, int c)
{
    int best = a;       // start with a

    if (b < best) {
        best = b;       // b beats it
    }
    if (c < best) {
        best = c;       // c beats it
    }
    return best;
}
\`\`\`

There is no \`else\` here: each \`if\` stands alone and is asked in turn.

## Your task
Complete \`largest\`. It takes three whole numbers and returns the biggest. If two are equal and biggest, return that value.

\`main\` is given. It calls your function four times and stores the results in the globals \`big1\`, \`big2\`, \`big3\` and \`big4\`, which the tests read. The biggest number is in a different position each time.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["big1", "big2", "big3", "big4"],
      starter: `int big1;
int big2;
int big3;
int big4;

// Returns the largest of a, b and c.
int largest(int a, int b, int c)
{
    return 0;   // TODO: replace this line with your own statements
}

// Given: the tests read big1 to big4.
void main(void)
{
    big1 = largest(9, 3, 4);
    big2 = largest(2, 8, 5);
    big3 = largest(1, 6, 7);
    big4 = largest(4, 4, 2);
    while (1) {}
}
`,
      solution: `int big1;
int big2;
int big3;
int big4;

// Returns the largest of a, b and c.
int largest(int a, int b, int c)
{
    int best = a;

    if (b > best) {
        best = b;
    }
    if (c > best) {
        best = c;
    }
    return best;
}

// Given: the tests read big1 to big4.
void main(void)
{
    big1 = largest(9, 3, 4);
    big2 = largest(2, 8, 5);
    big3 = largest(1, 6, 7);
    big4 = largest(4, 4, 2);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "big1", equals: 9, label: "largest(9, 3, 4) returns 9", hint: "When the first number is the biggest, neither if may replace it." },
        { kind: "var", name: "big2", equals: 8, label: "largest(2, 8, 5) returns 8", hint: "The middle number must be compared too." },
        { kind: "var", name: "big3", equals: 7, label: "largest(1, 6, 7) returns 7", hint: "Compare c with the best so far, not with a." },
        { kind: "var", name: "big4", equals: 4, label: "largest(4, 4, 2) returns 4", hint: "Two equal numbers must not confuse it. Check what happens when a comparison is false for both." },
      ],
      hints: [
        "Use the example as a plan and turn every comparison round.",
        "Start with `int best = a;`. Then two separate ifs: one for b, one for c.",
        "int best = a; if (b > best) { best = b; } if (c > best) { best = c; } return best;",
      ],
      takeaway: "Keep the best value so far in a variable and let each candidate challenge it. The same plan works for 3 values or 3000.",
    },
    {
      id: "czero-multiples",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: count the multiples",
      goal: "Write a function that counts how many numbers up to a limit are multiples of a given number.",
      refs: REFS,
      brief: `
A number is a **multiple** of 5 when 5 divides it with nothing left over: 5, 10, 15 and so on. In C that is a remainder of 0:

\`\`\`c
if (n % 5 == 0) {
    // n is a multiple of 5
}
\`\`\`

Robot code uses this test all the time to do something "every so often". A function that runs 1000 times a second can print once a second by acting only when its call counter is a multiple of 1000.

## Your task
Complete \`countMultiples\`. It takes two whole numbers, \`limit\` and \`step\`, and returns how many of the numbers 1, 2, 3, ... up to \`limit\` (included) are multiples of \`step\`.

Worked by hand: \`countMultiples(10, 3)\` looks at 1 to 10. The multiples of 3 are 3, 6 and 9, so it returns 3.

\`main\` is given. It stores three results in the globals \`m1\`, \`m2\` and \`m3\`, which the tests read.
`,
      kit: "launchpad",
      durationMs: 2,
      watch: ["m1", "m2", "m3"],
      starter: `int m1;
int m2;
int m3;

// Returns how many of the numbers 1 to limit are multiples of step.
int countMultiples(int limit, int step)
{
    return 0;   // TODO: replace this line with your own statements
}

// Given: the tests read m1, m2 and m3.
void main(void)
{
    m1 = countMultiples(10, 3);
    m2 = countMultiples(20, 5);
    m3 = countMultiples(100, 7);
    while (1) {}
}
`,
      solution: `int m1;
int m2;
int m3;

// Returns how many of the numbers 1 to limit are multiples of step.
int countMultiples(int limit, int step)
{
    int i;
    int count = 0;

    for (i = 1; i <= limit; i++) {
        if (i % step == 0) {
            count++;
        }
    }
    return count;
}

// Given: the tests read m1, m2 and m3.
void main(void)
{
    m1 = countMultiples(10, 3);
    m2 = countMultiples(20, 5);
    m3 = countMultiples(100, 7);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "m1", equals: 3, label: "countMultiples(10, 3) returns 3", hint: "Count one for each number whose remainder after dividing by step is 0." },
        { kind: "var", name: "m2", equals: 4, label: "countMultiples(20, 5) returns 4", hint: "3 means the loop stops before 20, which is a multiple of 5 itself: use `<=`." },
        { kind: "var", name: "m3", equals: 14, label: "countMultiples(100, 7) returns 14", hint: "Use the parameters limit and step, not fixed numbers." },
      ],
      hints: [
        "It is a loop with an if inside, and a counter that starts at 0.",
        "Loop i from 1 to limit. The test for a multiple is `i % step == 0`.",
        "int i; int count = 0; for (i = 1; i <= limit; i++) { if (i % step == 0) { count++; } } return count;",
      ],
      takeaway: "`a % b == 0` asks \"is a a multiple of b\". A loop, an if and a counter answer every \"how many\" question.",
    },
    {
      id: "czero-toggle",
      kind: "code",
      mode: "complete",
      tier: "practice",
      title: "Practice: remember on or off",
      goal: "Complete a function that flips a variable between 0 and 1 each time it is called.",
      refs: REFS,
      brief: `
A lamp with one button: press, it goes on. Press again, it goes off. The button does the same thing each time, so the program must **remember** whether the lamp is on. A variable that remembers what a program is doing right now is called a **state variable**.

Here the state is one global, \`lightOn\`: 1 means on, 0 means off. It must be global, because it has to survive from one call to the next. A local would be thrown away each time.

Switching between two values is called **toggling**. In words:

- if the light is on, turn it off
- otherwise, turn it on

On the robot, state variables decide what happens next: which light blinks, whether it is following a wall or turning. Chapter 17 builds whole behaviours from them.

## Your task
Complete the function \`toggle\`. Each call must change \`lightOn\` from 0 to 1, or from 1 to 0. It takes no arguments and returns nothing.

\`main\` is given. It calls \`toggle\` three times and copies the state after each call into the globals \`after1\`, \`after2\` and \`after3\`. The light starts off, so they must end as 1, 0 and 1.
`,
      kit: "launchpad",
      durationMs: 1,
      watch: ["lightOn", "after1", "after2", "after3"],
      starter: `int lightOn;    // the state: 1 = on, 0 = off. It starts at 0.
int after1;
int after2;
int after3;

// Flips lightOn: 0 becomes 1, 1 becomes 0.
void toggle(void)
{
    // TODO
}

// Given: the tests read after1, after2 and after3.
void main(void)
{
    toggle();
    after1 = lightOn;
    toggle();
    after2 = lightOn;
    toggle();
    after3 = lightOn;
    while (1) {}
}
`,
      solution: `int lightOn;    // the state: 1 = on, 0 = off. It starts at 0.
int after1;
int after2;
int after3;

// Flips lightOn: 0 becomes 1, 1 becomes 0.
void toggle(void)
{
    if (lightOn == 1) {
        lightOn = 0;
    } else {
        lightOn = 1;
    }
}

// Given: the tests read after1, after2 and after3.
void main(void)
{
    toggle();
    after1 = lightOn;
    toggle();
    after2 = lightOn;
    toggle();
    after3 = lightOn;
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "after1", equals: 1, label: "After the first call the light is on (1)", hint: "The light starts at 0. The first call must store 1 in lightOn." },
        {
          kind: "var",
          name: "after2",
          equals: 0,
          label: "After the second call the light is off (0)",
          hint: "If it stays at 1, the function always stores 1. It must look at the state first. Two separate ifs can also undo each other: use if / else.",
        },
        { kind: "var", name: "after3", equals: 1, label: "After the third call the light is on again (1)", hint: "The same function must work in both directions." },
        { kind: "no-diagnostic", code: "assign-in-condition", label: "No condition uses = where == is meant", hint: "`if (lightOn = 1)` stores 1. Compare with `==`." },
      ],
      hints: [
        "The function must make a decision based on what lightOn holds now.",
        "Use if / else, not two ifs in a row: with two ifs the second one can undo what the first just did.",
        "if (lightOn == 1) { lightOn = 0; } else { lightOn = 1; }",
      ],
      takeaway: "A state variable remembers something between calls, so it must be global. To toggle, look at the state and store the other value.",
    },
    // -------------------------------------------------------------- expert
    {
      id: "czero-primes",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: prime numbers",
      goal: "Write one function that tests whether a number is prime, and a second that counts the primes up to a limit.",
      refs: REFS,
      brief: `
This level gives you the goal and little else. Plan on paper before you type.

A **prime** number is a whole number greater than 1 that only 1 and itself divide with no remainder. 2, 3, 5 and 7 are prime. 9 is not (3 divides it). 1 is not prime by definition.

## Your task
Write two functions. The first lines are given.

- \`isPrime(n)\` returns 1 if \`n\` is prime, and 0 if it is not. It must give 0 for 1 and for 0.
- \`countPrimes(limit)\` returns how many primes there are from 1 to \`limit\`, with \`limit\` included. It must call \`isPrime\`.

\`main\` is given. It stores results in the globals \`p1\`, \`p2\`, \`p91\`, \`p97\` and \`primes\`, which the tests read.

Things to think about:

- Which numbers do you have to try as dividers of \`n\`?
- A function may return from inside a loop, as soon as the answer is known.
- Trace your \`isPrime\` by hand for n = 2 before you run it.
`,
      kit: "launchpad",
      durationMs: 5,
      watch: ["p1", "p2", "p91", "p97", "primes"],
      starter: `int p1;
int p2;
int p91;
int p97;
int primes;

// Returns 1 if n is a prime number, 0 if not.
int isPrime(int n)
{
    return 0;   // TODO
}

// Returns how many prime numbers there are from 1 to limit.
int countPrimes(int limit)
{
    return 0;   // TODO
}

// Given: the tests read these globals.
void main(void)
{
    p1 = isPrime(1);
    p2 = isPrime(2);
    p91 = isPrime(91);
    p97 = isPrime(97);
    primes = countPrimes(97);
    while (1) {}
}
`,
      solution: `int p1;
int p2;
int p91;
int p97;
int primes;

// Returns 1 if n is a prime number, 0 if not.
int isPrime(int n)
{
    int d;

    if (n < 2) {
        return 0;
    }
    for (d = 2; d < n; d++) {
        if (n % d == 0) {
            return 0;
        }
    }
    return 1;
}

// Returns how many prime numbers there are from 1 to limit.
int countPrimes(int limit)
{
    int i;
    int count = 0;

    for (i = 1; i <= limit; i++) {
        if (isPrime(i) == 1) {
            count++;
        }
    }
    return count;
}

// Given: the tests read these globals.
void main(void)
{
    p1 = isPrime(1);
    p2 = isPrime(2);
    p91 = isPrime(91);
    p97 = isPrime(97);
    primes = countPrimes(97);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "p1", equals: 0, label: "isPrime(1) returns 0", hint: "1 is not prime. Handle numbers below 2 before the loop." },
        { kind: "var", name: "p2", equals: 1, label: "isPrime(2) returns 1", hint: "For n = 2 the divider loop must not run at all, or must not try 2 itself. Check your loop's test." },
        { kind: "var", name: "p91", equals: 0, label: "isPrime(91) returns 0", hint: "91 is 7 * 13. Every divider from 2 up must be tried, not only 2 and 3." },
        { kind: "var", name: "p97", equals: 1, label: "isPrime(97) returns 1", hint: "Return 1 only after the whole loop has found no divider, so after the loop, not inside it." },
        { kind: "var", name: "primes", equals: 25, label: "countPrimes(97) returns 25", hint: "Count the numbers from 1 to limit for which isPrime returns 1. 24 means the loop stops before limit: 97 is prime itself, so use `<=`." },
        { kind: "source", mustMatch: "countPrimes[\\s\\S]*\\{[\\s\\S]*isPrime\\s*\\(", label: "countPrimes calls isPrime", hint: "Do not repeat the prime test inside countPrimes: call the function you already wrote." },
      ],
      hints: [
        "n is not prime as soon as one number between 2 and n - 1 divides it with remainder 0.",
        "In isPrime: return 0 at once for n below 2. Loop d from 2 while d < n, and return 0 inside the loop when `n % d == 0`. After the loop, return 1.",
        "countPrimes is the counting pattern: loop i from 1 to limit with `<=`, and add 1 to a local counter when `isPrime(i) == 1`.",
      ],
      takeaway: "A return inside a loop ends the search the moment the answer is known. Building countPrimes on isPrime is how large programs grow: small tested functions calling each other.",
    },
    {
      id: "czero-battery",
      kind: "code",
      mode: "debug",
      tier: "expert",
      title: "Expert: three bugs, one report",
      goal: "Find and fix three separate bugs in a battery report, using printf and tracing.",
      refs: REFS,
      brief: `
A battery pack has \`CELLS\` cells. The first is at 3300 millivolts, and each next one is 100 higher: 3300, 3400, and so on up to 4000. A cell below \`LIMIT\` is weak.

The program should check every cell and report

\`\`\`
3 of 8 weak: 37.5 percent
\`\`\`

It compiles. It runs. The answer is wrong, in three ways, because of **three separate bugs**. Each is a mistake this chapter warned about. None is in \`isWeak\`, and no \`#define\` is wrong.

## How to hunt
- Run it and compare each printed number with what it should be.
- Fix one bug at a time, and run after each fix.
- When a number surprises you, print the variables it was made from, or trace the lines by hand.

The tests read the globals \`checked\`, \`weak\` and \`percentWeak\`.
`,
      kit: "launchpad",
      durationMs: 2,
      watch: ["checked", "weak", "percentWeak"],
      starter: `#define CELLS 8
#define FIRST 3300
#define STEP 100
#define LIMIT 3600

int checked;            // how many cells were checked
int weak;               // how many of them were below LIMIT
float percentWeak;      // the weak cells, in percent of all cells

// Returns 1 if a cell voltage in millivolts is below the limit.
int isWeak(int millivolts)
{
    if (millivolts < LIMIT) {
        return 1;
    }
    return 0;
}

void main(void)
{
    int i;
    int mv = FIRST;
    int weak = 0;

    for (i = 1; i < CELLS; i++) {
        if (isWeak(mv) == 1) {
            weak++;
        }
        checked++;
        mv += STEP;
    }
    percentWeak = weak / checked * 100;
    printf("%d of %d weak: %.1f percent\\n", weak, checked, percentWeak);
    while (1) {}
}
`,
      solution: `#define CELLS 8
#define FIRST 3300
#define STEP 100
#define LIMIT 3600

int checked;            // how many cells were checked
int weak;               // how many of them were below LIMIT
float percentWeak;      // the weak cells, in percent of all cells

// Returns 1 if a cell voltage in millivolts is below the limit.
int isWeak(int millivolts)
{
    if (millivolts < LIMIT) {
        return 1;
    }
    return 0;
}

void main(void)
{
    int i;
    int mv = FIRST;

    for (i = 1; i <= CELLS; i++) {
        if (isWeak(mv) == 1) {
            weak++;
        }
        checked++;
        mv += STEP;
    }
    percentWeak = 100.0 * weak / checked;
    printf("%d of %d weak: %.1f percent\\n", weak, checked, percentWeak);
    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "checked", equals: 8, label: "checked is 8: every cell was looked at", hint: "7 means the loop makes one pass too few. Look at its test." },
        { kind: "var", name: "weak", equals: 3, label: "The global weak is 3", hint: "The printf shows a count, yet the global stays 0. Which box does `weak++` change inside main?" },
        {
          kind: "var",
          name: "percentWeak",
          equals: 37.5,
          label: "percentWeak is 37.5",
          hint: "0 means a whole-number division threw the fraction away before the multiplication. Multiply by 100.0 first, then divide.",
        },
        { kind: "console", includes: "3 of 8 weak: 37.5 percent", label: "The program prints 3 of 8 weak: 37.5 percent", hint: "Keep the printf line as it is. It becomes right when the three values are right." },
      ],
      hints: [
        "One bug is about how often the loop runs, one about which box is changed, one about dividing whole numbers.",
        "Count the passes of `for (i = 1; i < CELLS; i++)`. Look for a name that is declared twice. Work out `3 / 8` the way C does.",
        "Use `i <= CELLS`. Delete `int weak = 0;` inside main. Write `percentWeak = 100.0 * weak / checked;`.",
      ],
      takeaway: "Off by one, a local hiding a global, and whole-number division: three bugs that compile without complaint. Only comparing the output with what you expected finds them.",
    },
  ],
};
