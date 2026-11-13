import { Stepper, trace, type Program } from "./c-stepper";

// Which lines run, and how often (levels czero-if, czero-while, czero-for):
// an if/else runs one of its two blocks, a while loop goes back to its test
// after every pass, and a for loop is the same loop with the start, the test
// and the step written on one line.

function ifProgram(temp: number): Program {
  const hot = temp > 25;
  return {
    name: `if / else, temp = ${temp}`,
    code: [
      "void main(void)",
      "{",
      `    int temp = ${temp};`,
      "",
      "    if (temp > 25) {",
      '        printf("Fan on\\n");',
      "    } else {",
      '        printf("Fan off\\n");',
      "    }",
      '    printf("Done\\n");',
      "}",
    ],
    steps: trace("Nothing has run yet. Press Step, and watch which of the two printf lines is skipped.", (t) => {
      t.run(3, `Line 3 makes the box temp and stores ${temp} in it.`, () => t.set("main", "temp", temp));
      t.run(5, `Line 5 asks a question: is temp greater than 25? temp holds ${temp}, so the answer is ${hot ? "yes (true). The block right after the if runs" : "no (false). The block right after the if is skipped, and the else block runs"}.`);
      if (hot) t.run(6, "Line 6 runs, because the answer was yes.", () => t.print("Fan on\n"));
      else t.run(8, "Line 8 runs, because the answer was no. Line 6 was jumped over.", () => t.print("Fan off\n"));
      t.run(10, `Line 10 is after the whole if / else, so it runs either way. ${hot ? "Line 8 never ran." : "Line 6 never ran."}`, () => t.print("Done\n"));
    }),
  };
}

const WHILE: Program = {
  name: "while",
  code: [
    "void main(void)",
    "{",
    "    int count = 1;",
    "",
    "    while (count <= 3) {",
    '        printf("%d\\n", count);',
    "        count = count + 1;",
    "    }",
    '    printf("Done\\n");',
    "}",
  ],
  steps: trace("Nothing has run yet. Press Step, and count how often line 5 asks its question.", (t) => {
    let count = 1;
    t.run(3, "Line 3 makes the box count and stores 1 in it.", () => t.set("main", "count", count));
    while (count <= 3) {
      t.run(5, `Line 5 asks: is count less than or equal to 3? count holds ${count}: yes. The block runs.`);
      t.run(6, `Line 6 prints the value of count: ${count}.`, () => t.print(`${count}\n`));
      count++;
      t.run(7, `Line 7 adds 1 to count. It now holds ${count}. At the closing brace the program jumps back up to line 5.`, () => t.set("main", "count", count));
    }
    t.run(5, "Line 5 asks again: is count less than or equal to 3? count holds 4: no. The loop is over, and the program jumps to the line after the block.");
    t.run(9, "Line 9 runs once, after the loop. The question on line 5 was asked 4 times: 3 times yes, and one last time no.", () => t.print("Done\n"));
  }),
};

const FOR: Program = {
  name: "for",
  code: [
    "void main(void)",
    "{",
    "    int i;",
    "",
    "    for (i = 1; i <= 3; i++) {",
    '        printf("%d\\n", i);',
    "    }",
    '    printf("Done\\n");',
    "}",
  ],
  steps: trace("Nothing has run yet. This is the while program again, written as a for loop. Press Step.", (t) => {
    let i = 1;
    t.run(3, "Line 3 makes the box i. Nothing is stored in it yet.", () => t.set("main", "i", "?"));
    t.run(5, "Line 5, first part (i = 1): the start. It runs once and stores 1 in i.", () => t.set("main", "i", i));
    while (i <= 3) {
      t.run(5, `Line 5, middle part (i <= 3): the test. i holds ${i}: yes. The block runs.`);
      t.run(6, `Line 6 prints the value of i: ${i}.`, () => t.print(`${i}\n`));
      i++;
      t.run(5, `Line 5, last part (i++): the step. It runs after every pass and adds 1 to i, which now holds ${i}.`, () => t.set("main", "i", i));
    }
    t.run(5, "Line 5, the test again: i holds 4, and 4 <= 3 is false. The loop is over.");
    t.run(8, "Line 8 runs once, after the loop. The output is the same as the while program printed.", () => t.print("Done\n"));
  }),
};

function CFlow() {
  return (
    <Stepper
      programs={[ifProgram(30), ifProgram(20), WHILE, FOR]}
      label="Short programs with an if, a while loop and a for loop, run line by line"
      caption="The marked line is the one that just ran. An if / else runs one of its two blocks. A loop jumps back to its test after every pass and stops when the answer is no."
    />
  );
}

export const figure = {
  id: "c-flow",
  title: "if / else, while and for, line by line",
  description: "Step through four short programs one line at a time and see which lines an if / else skips and how often a loop asks its question.",
  Component: CFlow,
};
