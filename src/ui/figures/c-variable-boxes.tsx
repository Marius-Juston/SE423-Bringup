import { Stepper, trace, type Program } from "./c-stepper";

// Variables as named boxes (level czero-variables): declaring makes a box,
// "=" stores the value of the right side in it, and a box never follows
// another box afterwards. A local variable that was declared but never
// assigned has an indeterminate value in C, drawn here as "?".

const CODE = [
  "void main(void)",
  "{",
  "    int apples;",
  "    int total;",
  "",
  "    apples = 3;",
  "    total = apples + 2;",
  "    apples = apples + 1;",
  "}",
];

const PROGRAM: Program = {
  name: "boxes",
  code: CODE,
  steps: trace("Nothing has run yet. Press Step to run the program one line at a time.", (t) => {
    t.run(3, "Line 3 declares a variable: the computer makes a box named apples for a whole number. Nothing is stored in it yet, so its value is unknown.", () => t.set("main", "apples", "?"));
    t.run(4, "Line 4 makes a second box, named total. It is also still unknown.", () => t.set("main", "total", "?"));
    t.run(6, "Line 6 stores 3 in apples. Read = as \"store\": the value on the right goes into the box on the left.", () => t.set("main", "apples", 3));
    t.run(7, "Line 7 works out the right side first: apples holds 3, and 3 + 2 is 5. Then it stores 5 in total. apples itself does not change.", () => t.set("main", "total", 5));
    t.run(8, "Line 8 reads apples (3), adds 1, and stores the 4 back in apples. The old 3 is gone. total still holds 5: it was given a number, not a link to apples.", () => t.set("main", "apples", 4));
    t.run(9, "The closing brace ends the program. apples holds 4 and total holds 5.");
  }),
};

function CVariableBoxes() {
  return (
    <Stepper
      programs={[PROGRAM]}
      showOutput={false}
      label="A short program run line by line, with its variables drawn as boxes"
      caption="Each variable is a named box that holds one number. A line with = works out its right side, then stores the result in the box named on the left."
    />
  );
}

export const figure = {
  id: "c-variable-boxes",
  title: "Variables as boxes",
  description: "Step through a short program line by line and watch each variable as a named box whose value changes when a line stores into it.",
  Component: CVariableBoxes,
};
