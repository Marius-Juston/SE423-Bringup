import { Stepper, trace, type Program } from "./c-stepper";

// What a function call does (levels czero-call, czero-function, czero-scope):
// the program starts at main, a call copies the argument into the parameter,
// the function's local variables exist only while it runs, and the returned
// value replaces the call in the line that made it.

const CODE = [
  "int twice(int n)",
  "{",
  "    int result;",
  "",
  "    result = n * 2;",
  "    return result;",
  "}",
  "",
  "void main(void)",
  "{",
  "    int a;",
  "    int b;",
  "",
  "    a = twice(4);",
  "    b = twice(10);",
  "}",
];

const PROGRAM: Program = {
  name: "call",
  code: CODE,
  steps: trace("Nothing has run yet. Lines 1 to 7 only describe the function twice: they do not run by themselves. Press Step.", (t) => {
    t.run(9, "The program always starts at main, wherever main is written in the file.");
    t.run(11, "Line 11 makes the box a. It belongs to main.", () => t.set("main", "a", "?"));
    t.run(12, "Line 12 makes the box b. It also belongs to main.", () => t.set("main", "b", "?"));
    const call = (line: number, arg: number, into: string) => {
      t.run(line, `Line ${line} calls twice. main waits on this line. The value ${arg} in the brackets is copied into the function's own box, n.`, () => t.set("twice", "n", arg));
      t.run(3, "Now the lines of twice run. Line 3 makes a box result. It belongs to twice: main cannot see it.", () => t.set("twice", "result", "?"));
      t.run(5, `Line 5: n holds ${arg}, and ${arg} * 2 is ${arg * 2}. That is stored in result.`, () => t.set("twice", "result", arg * 2));
      t.run(6, `Line 6 ends the function and sends the value ${arg * 2} back to the line that called it.`);
      t.run(line, `Back on line ${line}. The call twice(${arg}) is replaced by the returned ${arg * 2}, which is stored in ${into}. The boxes of twice are thrown away.`, () => {
        t.drop("twice");
        t.set("main", into, arg * 2);
      });
    };
    call(14, 4, "a");
    call(15, 10, "b");
    t.run(16, "main ends. The same five lines of twice did the job two times, with two different inputs.");
  }),
};

function CFunctionCall() {
  return (
    <Stepper
      programs={[PROGRAM]}
      showOutput={false}
      label="A program that calls the function twice two times, run line by line"
      caption="A call copies its input into the function's own boxes, runs the function's lines, and brings one value back. Each function has its own boxes, and they exist only while it runs."
    />
  );
}

export const figure = { id: "c-function-call", Component: CFunctionCall };
