import type { Chapter } from "../types";

// Primer A: electricity and circuits for a student who has never held a
// wire. Assumes school arithmetic only. No code levels: C starts in primer B.
// Board facts used here: 3.3 V logic; a GPIO pin delivers about 4 mA and
// reads below about 0.8 V as 0 and above about 2.0 V as 1 (F28379D
// datasheet SPRS880, electrical characteristics); the system clock is
// 200 MHz, 5 ns per tick (TRM 3.7); the course's PWM runs at 20 kHz.

const REF = [{ course: "Primer A" }];

export const chA: Chapter = {
  id: "primer-circuits",
  number: -3,
  label: "A",
  title: "Electricity and circuits",
  blurb: "Start here if you have never held a wire: voltage, current, resistors, LEDs, buttons and signals.",
  requires: [],
  course: [],
  levels: [
    {
      id: "elec-system",
      kind: "brief",
      title: "What you are going to build",
      goal: "See the whole robot in one picture, then answer three questions.",
      refs: [{ course: "L1", slide: 9, note: "what the robot will do by the end" }, { course: "Primer A" }],
      brief: `
Without a picture of the whole machine, every detail you learn later has nowhere to go. So start with the whole thing.

A robot that drives up to a wall and stops must do three things, over and over: notice the wall, decide to stop, and stop. A machine built this way is a **mechatronic system**: moving parts, electronics and a small computer working together.

{{figure:mechatronic-loop}}

Select each part in the figure and read what it does. In short:

- A **sensor** measures something and reports it.
- A **microcontroller** is a small computer on a single chip (one of the black rectangles on a circuit board). It runs a **program**: a list of instructions that you write. Its metal contacts are called **pins**. Every wire to a sensor or an actuator ends on a pin.
- An **actuator** makes something happen: it moves, lights up or makes a sound.
- **Wires** carry electricity between them. A message sent along a wire is called a **signal**.

## What you will build
By the end of this game you will have programmed the course robot: read its buttons and sensors, switch its lights, drive its motors at a speed you choose, and work out where it is. Everything runs on a simulated board inside the game, so nothing can break.

## The road there
First electricity (this chapter). Then the programming language C (chapters B and C). Then the board, one part at a time. You need no earlier knowledge except school arithmetic.
`,
      questions: [
        {
          prompt: "Which part of a mechatronic system decides what to do?",
          options: ["The sensor", "The actuator", "The microcontroller", "The wires"],
          answer: 2,
          why: "The microcontroller runs your program. The program reads the sensors and decides what the actuators should do.",
        },
        {
          prompt: "A motor that turns a wheel is...",
          options: ["an actuator", "a sensor", "a program", "a pin"],
          answer: 0,
          why: "An actuator makes something happen in the world. A motor turns electricity into movement.",
        },
        {
          prompt: "What is a pin?",
          options: ["A list of instructions", "A part that measures distance", "A small light", "A metal contact of the chip, where a wire connects to it"],
          answer: 3,
          why: "Pins are the only places where the microcontroller touches the rest of the circuit. Sensors and actuators are wired to pins.",
        },
      ],
      hints: [
        "Select every part in the figure. Each question is answered by one of its sentences.",
        "Sensors measure, the microcontroller decides, actuators act.",
        "The microcontroller decides. A motor is an actuator. A pin is a metal contact of the chip.",
      ],
      takeaway: "A mechatronic system is a loop: sensors measure, the microcontroller decides, actuators act, and the sensors measure again. The rest of this game fills in each box.",
    },
    {
      id: "elec-voltage",
      kind: "brief",
      title: "Voltage and ground",
      goal: "Learn what a voltage is and what it is measured from.",
      refs: REF,
      brief: `
Every sensor reports to the microcontroller as a voltage, and every command leaves it as a voltage. If you cannot say what a voltage is, you cannot say what the robot is being told.

## A push
Picture water in pipes. Water only moves if something pushes it. A pump does that: it makes the pressure on one side higher than on the other.

**Voltage** is that push, for electricity. A **battery** is the pump. This water picture will come back in the next levels, and you will be told where it stops being true.

Voltage is measured in **volts**, written **V**. Some sizes:

- a small AA battery: 1.5 V
- the microcontroller in this game: 3.3 V
- a USB socket: 5 V
- the robot's motor battery: about 12 V

## Always between two points
A push is a difference: higher here than there. So a voltage is always between **two** points. A battery marked 9 V has 9 V between its two ends, which are marked + and -.

Height works the same way. "The hill is 200 m high" only means something once you say above what. For height we agree on sea level. For circuits we pick one point and agree to call it 0 V. That point is **ground**, often written **GND**. It is usually the - end of the battery.

## A worked example
Take the 9 V battery and call its - end ground. Then the - end is at 0 V and the + end is at 9 V. "This wire is at 3.3 V" always means: 3.3 V higher than ground.

Two points that are both at 3.3 V have 0 V between them: no difference, so no push.
`,
      questions: [
        {
          prompt: "A wire is \"at 5 V\". Measured from where?",
          options: ["From the + end of the battery", "From ground, the point we agreed to call 0 V", "From the nearest other wire", "From nothing: a single point has a voltage of its own"],
          answer: 1,
          why: "A voltage is always a difference between two points. When only one point is named, the other one is ground.",
        },
        {
          prompt: "Two points are both at 3.3 V. What is the voltage between them?",
          options: ["6.6 V", "3.3 V", "1.65 V", "0 V"],
          answer: 3,
          why: "Voltage is a difference: 3.3 V - 3.3 V = 0 V. With no difference there is no push between them.",
        },
        {
          prompt: "In the water picture, what plays the role of the battery?",
          options: ["The pump", "The pipe", "The water", "The tap"],
          answer: 0,
          why: "The pump creates the pressure difference that pushes water. The battery creates the voltage that pushes electricity.",
        },
      ],
      hints: [
        "A voltage is a difference, like a height.",
        "\"At 5 V\" is short for \"5 V higher than ground\". A difference between two equal values is zero.",
        "From ground. 3.3 V - 3.3 V = 0 V. The pump.",
      ],
      takeaway: "Voltage is a push, measured in volts (V), and always between two points. When one point is named, the other is ground, which we call 0 V.",
    },
    {
      id: "elec-current",
      kind: "brief",
      title: "Current needs a loop",
      goal: "Learn what current is and why it only flows around a closed loop.",
      refs: REF,
      brief: `
A motor connected by a single wire never turns, however good the battery. Beginners lose hours to this. The reason is the most important rule in electricity.

## What flows
Voltage is the push. What it pushes is called **charge**. **Current** is how much charge flows past a point each second, like litres of water per second in a pipe.

Current is measured in **amperes**, or amps, written **A**. In formulas current is written **I**.

## The loop
Current can only flow around a complete loop: out of the battery's + end, through the wires and parts, and back into its - end. Such a loop is called a **circuit**, and a loop with no gap in it is a **closed** circuit.

{{figure:closed-loop}}

Try it in the figure. Close the switch: the lamp lights. Now remove the wire back to the battery: the lamp goes dark, although the + side is still connected.

## Where the water picture breaks
Cut a water pipe and the water sprays out. Cut a wire and nothing comes out: the current simply stops, everywhere in the loop at once.

## Current is not used up
In one loop, the current is the same at every point. If 2 A flows into the lamp, 2 A flows out of it. The lamp takes energy from the current, not the current itself, just as a water wheel does not swallow the water that turns it.
`,
      questions: [
        {
          prompt: "The switch is closed, but the wire from the lamp back to the battery is missing. What happens?",
          options: ["The lamp lights, a little dimmer", "The lamp lights until the battery's + side is empty", "No current flows anywhere, and the lamp stays dark", "Current flows as far as the lamp and stops there"],
          answer: 2,
          why: "Current needs a complete loop. With no way back to the battery, nothing flows at all, not even in the part that is still connected.",
        },
        {
          prompt: "What is the unit of current?",
          options: ["The volt (V)", "The ampere (A)", "The loop", "The litre"],
          answer: 1,
          why: "Current is measured in amperes, written A. The volt measures voltage, the push.",
        },
        {
          prompt: "2 A flows into a lamp. How much current flows out of its other end?",
          options: ["0 A, the lamp uses it up", "1 A, the lamp uses half", "A little less than 2 A", "2 A"],
          answer: 3,
          why: "Current is not used up. In one loop it is the same everywhere. The lamp takes energy, not charge.",
        },
      ],
      hints: [
        "Use the figure: try all four combinations of the two controls.",
        "The lamp is lit in only one of the four combinations. Read the text under \"Current is not used up\" for the last question.",
        "No loop, no current. Amperes. What flows in flows out: 2 A.",
      ],
      takeaway: "Current is the flow of charge, in amperes (A). It flows only around a closed loop, and it is the same at every point of that loop. One wire is never enough.",
    },
    {
      id: "elec-ohm",
      kind: "calc",
      title: "Resistance and Ohm's law",
      goal: "Use Ohm's law to find a current, a voltage and a resistance.",
      refs: REF,
      brief: `
Connect a small light straight to a battery and it burns out in a flash, because nothing limits the current. To build anything, you must be able to set the current you want.

## Resistance
**Resistance** says how hard a part makes it for current to pass. In the water picture it is a narrow piece of pipe: the same push gets less water through.

Resistance is measured in **ohms**, written **Ω** (the Greek letter omega; when typing, people write "ohm"). In formulas it is written **R**. A **resistor** is a part made to have one known resistance. A plain wire has almost none.

## Ohm's law
The three quantities are tied together by one rule, **Ohm's law**:

- current = voltage / resistance, or **I = V / R**

Here V is the voltage **across** the part: the difference between its two ends.

{{figure:ohms-law}}

Move the sliders. More voltage gives more current. More resistance gives less.

The same rule can be turned around:

- **V = I x R** (the voltage needed to push a current through a resistance)
- **R = V / I** (the resistance that gives the current you want)

## Worked examples
- 6 V across 3 Ω: I = 6 / 3 = 2 A.
- To push 0.5 A through 10 Ω you need V = 0.5 x 10 = 5 V.
- 12 V should give 3 A: R = 12 / 3 = 4 Ω.

Now you: three calculations, one for each form of the rule.
`,
      fields: [
        { id: "i", label: "12 V across a 4 Ω resistor. Current?", unit: "A", answer: 3, why: "I = V / R = 12 / 4 = 3 A." },
        { id: "v", label: "2 A flows through a 5 Ω resistor. Voltage across it?", unit: "V", answer: 10, why: "V = I x R = 2 x 5 = 10 V." },
        { id: "r", label: "9 V should drive exactly 3 A. Resistance needed?", unit: "Ω", answer: 3, why: "R = V / I = 9 / 3 = 3 Ω." },
      ],
      hints: [
        "Pick the form of the rule that has the unknown alone on the left: I = V / R, V = I x R or R = V / I.",
        "Current: divide the voltage by the resistance. Voltage: multiply current by resistance. Resistance: divide voltage by current.",
        "12 / 4, then 2 x 5, then 9 / 3.",
      ],
      takeaway: "Ohm's law, V = I x R, ties voltage, current and resistance together. Know two of them and you can work out the third.",
    },
    {
      id: "elec-prefixes",
      kind: "calc",
      title: "Milli, micro, kilo, mega",
      goal: "Convert four values between prefixed units and plain units.",
      refs: REF,
      brief: `
Real values are awkward. A small light takes 0.02 A. A common resistor is 4700 Ω. The chip's clock, the steady beat that paces everything it does, ticks every 0.000000005 seconds. Drop one zero and a pin gets ten times too much current. Engineers avoid the zeros with **prefixes**: a letter in front of the unit that stands for a factor.

- **M**, mega: a million (x 1 000 000)
- **k**, kilo: a thousand (x 1000)
- **m**, milli: a thousandth (/ 1000)
- **µ**, micro: a millionth (/ 1 000 000)
- **n**, nano: a billionth (/ 1 000 000 000)

So 20 mA is 20 thousandths of an ampere, and 4.7 kΩ is 4.7 thousand ohms.

Two traps. Capital **M** is mega and small **m** is milli: a factor of a billion apart. And µ is the Greek letter mu. Keyboards do not have it, so people type **u**: "us" means µs.

{{figure:prefixes}}

Pick a quantity in the figure and rewrite it with each prefix.

## The rule
Each step on the line is a factor of 1000.

- To a **smaller** unit: the number gets 1000 times **larger** per step. 0.02 A = 20 mA.
- To a **larger** unit: the number gets 1000 times **smaller** per step. 4700 Ω = 4.7 kΩ.

## Worked examples
- 3.3 kΩ = 3.3 x 1000 = 3300 Ω.
- 0.5 ms = 0.5 x 1000 = 500 µs (one step smaller).
- 250 mA = 250 / 1000 = 0.25 A.

Prefixes work on every unit. You will use them all the time on volts, amperes, ohms, on seconds (**s**: ms, µs, ns) and on **hertz** (**Hz**: kHz, MHz). A hertz means "times per second". A later level in this chapter explains it.
`,
      fields: [
        { id: "a", label: "2.2 kΩ in ohms", unit: "Ω", answer: 2200, why: "Kilo is a thousand: 2.2 x 1000 = 2200 Ω." },
        { id: "b", label: "0.015 A in milliamperes", unit: "mA", answer: 15, why: "Milliamperes are 1000 times smaller, so the number is 1000 times larger: 0.015 x 1000 = 15 mA." },
        { id: "c", label: "3 ms in microseconds", unit: "µs", answer: 3000, why: "Micro is one step smaller than milli: 3 x 1000 = 3000 µs." },
        { id: "d", label: "20 kHz in hertz", unit: "Hz", answer: 20000, why: "Kilo is a thousand: 20 x 1000 = 20 000 Hz." },
      ],
      hints: [
        "Ask first: is the new unit smaller or larger than the old one? A smaller unit needs a bigger number.",
        "Every one of these four is a single step of 1000. Use the figure's line to see which way.",
        "2.2 x 1000, 0.015 x 1000, 3 x 1000, 20 x 1000.",
      ],
      takeaway: "n, µ, m, (none), k, M: each step is a factor of 1000. A smaller unit needs a bigger number. Mind capital M (mega) and small m (milli).",
    },
    {
      id: "elec-schematic",
      kind: "quiz",
      title: "Reading a schematic",
      goal: "Learn the symbols on a circuit drawing and answer four questions about them.",
      refs: REF,
      brief: `
The robot's documentation does not show photos of its wiring. It shows schematics. If you cannot read one, you cannot find out which pin your light or your button is on.

A **schematic** is a drawing of a circuit that shows what is connected to what. Each part is drawn as a **symbol**, and each wire as a line. Where the parts sit on the page means nothing. Only the connections count.

{{figure:schematic-symbols}}

Select every symbol in the figure and read what it stands for. Two of them are parts you have not met yet:

- An **LED** is a small light. The next level is about it.
- A **push button** is a switch that is closed only while you press it. A later level uses it.

## Three rules for reading
- **A dot joins, a crossing does not.** Lines that meet at a dot are connected. Lines that cross without a dot are not.
- **One wire, one voltage.** A wire has almost no resistance, so by Ohm's law there is almost no voltage across it. Everything joined by wire is at the same voltage.
- **All grounds are one point.** Every ground symbol is the same 0 V, even though no line is drawn between them. The same goes for every "3.3 V" label.
`,
      questions: [
        {
          prompt: "Two lines cross on a schematic and there is no dot where they cross. Are the two wires connected?",
          options: ["Yes, lines that touch are always connected", "No, without a dot they only pass over each other", "Only while current flows", "It depends on the voltage"],
          answer: 1,
          why: "A dot means joined. A crossing without a dot means the wires are not connected.",
        },
        {
          prompt: "A schematic has three ground symbols in three different corners. What does that tell you?",
          options: ["There are three separate batteries", "Those three points are at three different voltages", "Those three points are all connected together, at 0 V", "Nothing: ground symbols are decoration"],
          answer: 2,
          why: "Every ground symbol is the same point. The symbol saves drawing a long line back to the battery's - end.",
        },
        {
          prompt: "Which of these parts only works one way round?",
          options: ["The LED", "The resistor", "The wire", "The push button"],
          answer: 0,
          why: "Current passes through an LED only in the direction its triangle points. A resistor, a wire and a button work the same in both directions.",
        },
        {
          prompt: "Two points on a schematic are joined by a line with no part in between. What do you know about them?",
          options: ["Nothing", "One is at 3.3 V and the other at 0 V", "No current can flow between them", "They are at the same voltage"],
          answer: 3,
          why: "A line is a wire. A wire has almost no resistance, so there is no voltage across it: both ends are at the same voltage.",
        },
      ],
      hints: [
        "Every answer is in the figure's sentences or in the three rules.",
        "Compare the tiles \"Wires joined\" and \"Wires crossing\". Read the tiles \"Ground\" and \"LED\".",
        "No dot, no connection. All grounds are one point. The LED has a direction. One wire, one voltage.",
      ],
      takeaway: "A schematic shows connections, not positions. A dot joins wires, every ground symbol is the same 0 V, and everything joined by wire is at one voltage.",
    },
    {
      id: "elec-led",
      kind: "calc",
      title: "The LED and its resistor",
      goal: "Work out the resistor that an LED needs on 3.3 V.",
      refs: [{ course: "L3", slide: 9, note: "LED with its resistor on 3.3 V" }, { course: "Primer A" }],
      brief: `
Put an LED straight across 3.3 V and far too much current flows. The LED is damaged, or the pin that feeds it is. That is why every LED on the robot has a resistor next to it.

An **LED** (light-emitting diode) is a small light. Two facts make it different from a lamp.

## 1. It works one way only
Current must enter at the **anode** (the flat side of the triangle in the symbol, the + side) and leave at the **cathode** (the bar, the - side). Turned round, it blocks the current and stays dark. On a real LED the longer leg is the anode.

## 2. It keeps a fixed voltage
A lit red LED has about 2 V across it, almost whatever the current. This is its **forward voltage**. The LED does not limit the current by itself.

## So add a resistor
Put a resistor in the same path. The LED keeps its 2 V and the resistor gets what is left of the supply. Then Ohm's law on the resistor sets the current for both.

{{figure:led-resistor}}

Try it: change the resistor, switch to 5 V, turn the LED round.

## Worked example
Supply 3.3 V, red LED, and you want 10 mA.

1. Voltage left for the resistor: 3.3 - 2.0 = 1.3 V.
2. Write the current in amperes: 10 mA = 0.010 A.
3. R = V / I = 1.3 / 0.010 = 130 Ω.

A small LED is clearly lit at 2 mA and must stay under 20 mA. One pin of the microcontroller can deliver about 4 mA.
`,
      fields: [
        { id: "vr", label: "Supply 5 V, LED keeps 2 V. Voltage across the resistor?", unit: "V", answer: 3, why: "The resistor gets what the LED leaves: 5 - 2 = 3 V." },
        { id: "r", label: "Supply 3.3 V, LED keeps 2.0 V, you want 4 mA. Resistor?", unit: "Ω", answer: 325, tolPct: 1, why: "1.3 V is left for the resistor, and 4 mA = 0.004 A. R = 1.3 / 0.004 = 325 Ω. In practice you would take the nearest common value, 330 Ω." },
        { id: "i", label: "Supply 3.3 V, LED keeps 2.0 V, resistor 1 kΩ. Current?", unit: "mA", answer: 1.3, tolPct: 1, why: "1.3 V across 1000 Ω: I = 1.3 / 1000 = 0.0013 A = 1.3 mA." },
      ],
      hints: [
        "Always start by taking the LED's 2 V away from the supply. What is left is across the resistor.",
        "Before using Ohm's law, change mA to A (divide by 1000) and kΩ to Ω (multiply by 1000).",
        "5 - 2. Then 1.3 / 0.004. Then 1.3 / 1000 = 0.0013 A, which you write in mA.",
      ],
      takeaway: "An LED works one way only and keeps about 2 V. The resistor takes the rest of the supply voltage and sets the current: R = (supply - 2 V) / I.",
    },
    {
      id: "elec-series",
      kind: "brief",
      title: "Series and parallel",
      goal: "Tell the two ways of joining parts apart, and say what they share.",
      refs: REF,
      brief: `
All the robot's parts live on one supply. Whether two parts share the current or share the voltage depends on how they are joined. Mix the two up and you get a dim light or an overloaded pin.

## Series: one after the other
Parts are in **series** when the current has only one path, through one part and then the next. The LED and its resistor were in series.

\`\`\`
3 V ---[ R1 ]---[ R2 ]--- ground
\`\`\`

- The **current is the same** through both. There is nowhere else for it to go.
- The **voltages add up** to the supply voltage.
- The **resistances add**: together they act like one resistor of R1 + R2.

## Parallel: side by side
Parts are in **parallel** when both ends of one are joined to both ends of the other.

\`\`\`
3 V --+--[ R1 ]--+-- ground
      +--[ R2 ]--+
\`\`\`

- The **voltage is the same** across both. They sit between the same two wires.
- Each takes its own current, and the **currents add** in the wire that feeds them.

## Worked examples
Series: 1 kΩ and 2 kΩ across 3 V. Together 3 kΩ = 3000 Ω, so I = 3 / 3000 = 0.001 A = 1 mA through both. The 1 kΩ has 1 V across it and the 2 kΩ has 2 V (use V = I x R on each). 1 V + 2 V = 3 V.

Parallel: two LEDs, each with its own resistor, each taking 4 mA from the same 3.3 V supply. The supply delivers 4 + 4 = 8 mA.
`,
      questions: [
        {
          prompt: "Two resistors are in series. What is certainly the same for both?",
          options: ["The voltage across each", "The current through each", "Their resistance", "Nothing"],
          answer: 1,
          why: "In series there is one path, so the same current flows through both. The voltages are equal only if the resistors are equal.",
        },
        {
          prompt: "Two parts are in parallel. What is certainly the same for both?",
          options: ["The current through each", "Their resistance", "The voltage across each", "Nothing"],
          answer: 2,
          why: "Parallel parts sit between the same two wires, so they have the same voltage across them. Each takes its own current.",
        },
        {
          prompt: "A 100 Ω resistor and a 220 Ω resistor are in series. Together they act like one resistor of...",
          options: ["320 Ω", "120 Ω", "220 Ω", "100 Ω"],
          answer: 0,
          why: "Resistances in series add: 100 + 220 = 320 Ω.",
        },
        {
          prompt: "Three LEDs, each with its own resistor, are in parallel on one supply. Each takes 3 mA. How much current does the supply deliver?",
          options: ["1 mA", "3 mA", "6 mA", "9 mA"],
          answer: 3,
          why: "Currents of parallel branches add: 3 + 3 + 3 = 9 mA.",
        },
      ],
      hints: [
        "Series: one path. Parallel: the same two wires.",
        "One path means one current. The same two wires mean one voltage.",
        "Series shares the current and adds resistances (100 + 220). Parallel shares the voltage and adds currents (3 + 3 + 3).",
      ],
      takeaway: "Series: same current, voltages add, resistances add. Parallel: same voltage, currents add.",
    },
    {
      id: "elec-divider",
      kind: "calc",
      title: "The voltage divider",
      goal: "Work out the voltage between two resistors in series.",
      refs: REF,
      brief: `
Some sensors put out 5 V, and 5 V on a 3.3 V pin damages the chip. Two resistors are enough to bring a voltage down. The same little circuit sits inside every knob and behind every push button on the robot.

## The circuit
A **voltage divider** is two resistors in series between a voltage and ground. You use the voltage at the point between them.

{{figure:voltage-divider}}

Move the sliders and watch the middle point. The larger resistor always takes the larger share of the voltage.

## Why it works
Call the voltage at the top **Vin**. The two resistors are in series, so the same current flows through both:

- I = Vin / (R1 + R2)

The middle point is above ground by the voltage across the bottom resistor, R2:

- V = I x R2 = **Vin x R2 / (R1 + R2)**

Read the formula as "R2's share of the total resistance".

## Worked examples
- Vin = 3.3 V, R1 = 10 kΩ, R2 = 10 kΩ: V = 3.3 x 10 / 20 = 1.65 V. Equal resistors give half.
- Vin = 3.3 V, R1 = 20 kΩ, R2 = 10 kΩ: V = 3.3 x 10 / 30 = 1.1 V.

Both resistances are in kΩ here, so the "k" cancels in the division.

## A knob is a divider
A **potentiometer** is a resistor with a sliding contact. Turning the knob moves the contact, which makes R1 larger and R2 smaller, or the other way round. The contact's voltage goes smoothly from 0 V to Vin. That is how a knob tells the microcontroller its position.
`,
      fields: [
        { id: "a", label: "Vin = 3.3 V, R1 = 1 kΩ (top), R2 = 2 kΩ (bottom). Middle voltage?", unit: "V", answer: 2.2, tolPct: 1, why: "V = 3.3 x 2 / (1 + 2) = 2.2 V. The bottom resistor is two thirds of the total, so it gets two thirds of 3.3 V." },
        { id: "b", label: "Vin = 5 V, R1 = 10 kΩ (top), R2 = 20 kΩ (bottom). Middle voltage?", unit: "V", answer: 3.333, tolPct: 1, why: "V = 5 x 20 / (10 + 20) = 3.33 V." },
        { id: "c", label: "In the first circuit (3.3 V, 1 kΩ and 2 kΩ): current through the resistors?", unit: "mA", answer: 1.1, tolPct: 1, why: "In series the resistances add: 3 kΩ = 3000 Ω. I = 3.3 / 3000 = 0.0011 A = 1.1 mA." },
      ],
      hints: [
        "The middle voltage is Vin times the bottom resistor's share of the total: R2 / (R1 + R2).",
        "First circuit: the share is 2 / 3. Second: 20 / 30. For the current, add the two resistances and use I = V / R.",
        "3.3 x 2 / 3. Then 5 x 20 / 30. Then 3.3 / 3000 = 0.0011 A, written in mA.",
      ],
      takeaway: "Two resistors in series split a voltage: middle = Vin x R2 / (R1 + R2). The larger resistor takes the larger share.",
    },
    {
      id: "elec-switch",
      kind: "brief",
      title: "Buttons, floating wires and the pull-up",
      goal: "See why a button needs a resistor, and what a floating wire is.",
      refs: [{ course: "L3", slide: [10, 11, 16] }, { course: "Primer A" }],
      brief: `
Wire a button to a pin with nothing else, and the robot reacts when you wave a hand near the board. The pin reads random values. Here is why, and the fix.

## Open and closed
A **switch** is a gap you can close. **Open**, it is a gap: no current. **Closed**, it is a wire. A **push button** is a switch that is closed only while you press it.

(The water picture misleads here. A closed tap stops water. A closed switch lets current flow.)

## The problem: a floating wire
Suppose a button connects a pin to ground. Pressed, the pin is wired to ground: 0 V. Released, the pin is connected to nothing at all.

A wire connected to nothing is **floating**. Its voltage is not 0 V. It is undefined: it drifts with every bit of electrical disturbance nearby, which is called **noise**. A program reading that pin gets random results.

## The fix: a pull-up resistor
Add a resistor from 3.3 V to the pin. It is called a **pull-up resistor**, often 10 kΩ.

{{figure:voltage-divider}}

In the figure, set the bottom part to "button, released" and then "button, pressed". The middle point is the pin.

- **Released:** no current can flow, so there is no voltage across the resistor (V = I x R = 0). The pin sits at 3.3 V.
- **Pressed:** the pin is wired to ground: 0 V. Current flows through the resistor, but only 3.3 V / 10 kΩ = 0.33 mA.

Without the resistor, with a plain wire to 3.3 V instead, a press would join 3.3 V straight to ground. That is a **short circuit**: a path with almost no resistance, so a huge current flows.

Chapter 3 uses this circuit for every button on the robot.
`,
      questions: [
        {
          prompt: "A wire is connected to a pin at one end and to nothing at the other. What is the voltage on it?",
          options: ["0 V", "3.3 V", "Undefined: it floats and drifts with noise", "Half the supply, 1.65 V"],
          answer: 2,
          why: "Nothing sets the voltage of a floating wire, so it drifts. It is not 0 V: 0 V would need a connection to ground.",
        },
        {
          prompt: "Pull-up resistor in place, button released. Why is the pin at 3.3 V?",
          options: ["No current flows, so there is no voltage across the resistor, and the pin is at the same voltage as the resistor's other end", "The resistor makes voltage", "The button sends 3.3 V to the pin", "The resistor is too large for voltage to pass"],
          answer: 0,
          why: "V = I x R. With I = 0 the voltage across the resistor is 0, so both its ends are at 3.3 V.",
        },
        {
          prompt: "Pull-up of 10 kΩ on 3.3 V, button pressed. How much current flows through the resistor?",
          options: ["0 mA", "33 mA", "3.3 mA", "0.33 mA"],
          answer: 3,
          why: "The resistor has 3.3 V at one end and 0 V at the other: I = 3.3 V / 10 000 Ω = 0.00033 A = 0.33 mA.",
        },
        {
          prompt: "Why not use a plain wire instead of the pull-up resistor?",
          options: ["A wire cannot carry 3.3 V", "Pressing the button would connect 3.3 V straight to ground: a short circuit", "The pin would float when the button is released", "It would work just as well"],
          answer: 1,
          why: "With no resistance in the path, pressing the button shorts the supply to ground and a huge current flows. The resistor limits it to a fraction of a milliamp.",
        },
      ],
      hints: [
        "Use the figure with the bottom part set to the button, in both positions, and read the sentence under it.",
        "A floating wire has no defined voltage. With no current, a resistor has no voltage across it.",
        "Floating. No current, no voltage across the resistor. 3.3 / 10 000 A. A short circuit.",
      ],
      takeaway: "A wire connected to nothing floats: its voltage is undefined. A pull-up resistor gives the pin 3.3 V when the button is released, and the button pulls it to 0 V when pressed.",
    },
    {
      id: "elec-digital",
      kind: "brief",
      title: "Digital, analog, and why a pin cannot run a motor",
      goal: "Learn how a pin turns a voltage into a 0 or a 1, and how much current it can give.",
      refs: [{ course: "L3", slide: [6, 10, 15] }, { course: "Primer A" }],
      brief: `
Wire a motor straight to a pin of the microcontroller and the pin is destroyed. A pin is made to signal, not to supply power. First, what it signals.

## Analog and digital
An **analog** voltage can have any value in a range. A knob gives 0 V, 3.3 V, or anything in between, and the exact value matters.

A **digital** voltage only has two values that matter:

- **high**, near 3.3 V, written **1**
- **low**, near 0 V, written **0**

The microcontroller in this game uses **3.3 V logic**: its high is 3.3 V.

## Thresholds
A pin does not need exactly 3.3 V or 0 V. It reads anything above about 2.0 V as 1, and anything below about 0.8 V as 0. These limits are called **thresholds**. Between them, nothing is promised: the pin may read 0 or 1. This is why digital signals are robust: a little noise on a 3.3 V wire still reads as 1.

## A pin gives very little current
One pin can deliver about 4 mA. That lights an LED or signals another chip. A robot motor needs about 1 A, which is 1000 mA: 250 times too much.

## The fix: a transistor
A **transistor** is a switch that is worked by electricity instead of by a finger. A tiny current on its control wire closes a path for a large current that comes from somewhere else: the battery.

{{figure:transistor-switch}}

Set the pin high and low in the figure. The pin gives the order, and the transistor does the work. A chip that holds such transistors, ready to connect to a motor, is called a **driver**. Chapter 10 uses one.
`,
      questions: [
        {
          prompt: "A pin measures 3.1 V. What does it read?",
          options: ["0", "1", "3.1", "Nothing is promised"],
          answer: 1,
          why: "3.1 V is above the upper threshold of about 2.0 V, so it reads as 1. A digital pin only tells high from low, not the exact voltage.",
        },
        {
          prompt: "A pin measures 1.4 V. What does it read?",
          options: ["Certainly 0", "Certainly 1", "1.4", "Nothing is promised: it may read 0 or 1"],
          answer: 3,
          why: "1.4 V is between the thresholds (about 0.8 V and 2.0 V). A good circuit never leaves a digital pin there.",
        },
        {
          prompt: "A motor needs 1 A. A pin delivers about 4 mA. How do you run the motor?",
          options: ["Let the pin control a transistor (a driver) that switches the battery's current to the motor", "Connect the motor to the pin and wait longer", "Use a smaller resistor", "Connect it to two pins"],
          answer: 0,
          why: "The pin only signals. A transistor switches the large current, which comes from the battery and never passes through the microcontroller.",
        },
        {
          prompt: "A knob gives a voltage that can be 0.4 V, 1.27 V, 2.9 V or anything else up to 3.3 V, and the exact value matters. What kind of signal is that?",
          options: ["Digital", "Floating", "Analog", "A short circuit"],
          answer: 2,
          why: "Analog: any value in a range, and the value itself is the information. Digital has only high and low.",
        },
      ],
      hints: [
        "Compare each voltage with the two thresholds: about 0.8 V and about 2.0 V.",
        "Above 2.0 V is 1, below 0.8 V is 0, in between nothing is promised. For the motor, use the figure.",
        "3.1 V reads 1. 1.4 V is in between. The pin controls a transistor. Any value in a range is analog.",
      ],
      takeaway: "Digital means two levels: high (1, near 3.3 V) and low (0, near 0 V), told apart by thresholds. A pin gives about 4 mA, so anything bigger is switched by a transistor.",
    },
    {
      id: "elec-waveform",
      kind: "timing",
      title: "Signals over time",
      goal: "Read period, frequency and duty cycle from a waveform, then draw one.",
      refs: [{ course: "L6-7", slide: [58, 59] }, { course: "Primer A" }],
      brief: `
The command to a motor is not a steady voltage. It switches between high and low thousands of times per second. To check it, you must read a picture of voltage against time.

A **signal** is a voltage that carries information. A **waveform** is a drawing of a signal over time, with time running from left to right.

{{figure:waveform-basics}}

Three words describe a signal that repeats. Change the figure's controls and watch each one.

- The **period**, **T**, is the time one full cycle takes: high, then low, up to the point where it starts again.
- The **frequency**, **f**, is how many cycles fit in one second. Its unit is the **hertz** (**Hz**). The two are tied by **f = 1 / T**, with T in seconds.
- The **duty cycle** is the share of each period that the signal is high, in percent.

## Worked example
A cycle takes 5 ms. In seconds that is 0.005 s, so f = 1 / 0.005 = 200 Hz. If the signal is high for 1 ms of those 5 ms, the duty cycle is 1 / 5 = 20 %.

Going the other way: T = 1 / f. A 1 kHz signal has T = 1 / 1000 s = 1 ms.

## Two instruments
A **multimeter** shows one number: a steady voltage, a current or a resistance. An **oscilloscope**, or scope, draws the waveform on a screen. You need a scope as soon as a signal changes faster than you can read numbers.

## Your turn
The grid in the activity is like a scope screen. Each slot is 1 ms. The top row is given as an example: 500 Hz at 50 %, so T = 2 ms, high for 1 ms.

Draw a signal of **250 Hz** with a duty cycle of **25 %**. Start high in slot 0.
`,
      slots: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
      rows: [
        {
          name: "500 Hz, 50 %",
          editable: false,
          initial: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
          answer: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
        },
        {
          name: "250 Hz, 25 %",
          editable: true,
          initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          answer: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        },
      ],
      hints: [
        "First find the period: T = 1 / f. Then find how long the signal is high in each period.",
        "T = 1 / 250 s = 0.004 s = 4 ms, which is 4 slots. 25 % of 4 ms is 1 ms: one slot high, three slots low.",
        "High in slots 0, 4 and 8. Low everywhere else.",
      ],
      takeaway: "Period T is the time of one cycle, frequency f = 1 / T is cycles per second in hertz, and duty cycle is the share of the period spent high. A scope draws the waveform; a multimeter shows one number.",
    },
    {
      id: "elec-capacitor",
      kind: "brief",
      title: "The capacitor: voltages take time",
      goal: "Learn the one thing a capacitor does, and how R and C set how long it takes.",
      refs: [{ course: "L5", slide: 25, note: "a capacitor needs time to charge" }, { course: "Primer A" }],
      brief: `
Press a button and the pin's voltage does not move cleanly from one level to the other. Measure a sensor too early and the number is wrong. Both come from the same part.

## A small tank
A **capacitor** stores a little charge, like a small tank on a water pipe. The more charge is in it, the higher the voltage across it. In formulas it is written **C**. Its size, the **capacitance**, is measured in **farads** (**F**). A farad is huge: real parts are a few µF or nF. On a schematic it is two short parallel lines with a gap between them.

## The one idea
A tank cannot fill in no time. So:

**The voltage across a capacitor cannot jump.** To change it, charge must flow in or out, and that takes time.

{{figure:rc-charge}}

In the figure a switch asks for 3.3 V at once (the dashed line). The capacitor is fed through a resistor and follows on a curve: fast at first, then slower and slower.

## How long: the time constant
The resistor limits how fast charge flows, and the capacitor sets how much is needed. Together they give the **time constant**, written **tau**:

- **tau = R x C**

After one tau the voltage has covered about 63 % of the way. After five tau it has practically arrived.

## Worked example
R = 10 kΩ and C = 100 nF. In plain units: 10 000 Ω x 0.0000001 F = 0.001 s, so tau = 1 ms. A shortcut: kΩ times µF gives ms. Here 100 nF = 0.1 µF, and 10 x 0.1 = 1 ms.

Move the sliders: a larger resistor or a larger capacitor makes the curve slower.

You will meet this curve again when a button is cleaned up (chapter 3) and when the chip measures an analog voltage (chapter 8).
`,
      questions: [
        {
          prompt: "What can a capacitor not do?",
          options: ["Store charge", "Change the voltage across it instantly", "Be connected to a resistor", "Be measured in farads"],
          answer: 1,
          why: "Its voltage follows the charge stored in it, and charge needs time to flow in or out. So the voltage cannot jump.",
        },
        {
          prompt: "R = 1 kΩ and C = 1 µF. What is the time constant tau = R x C?",
          options: ["1 ms", "1 s", "1 µs", "1000 s"],
          answer: 0,
          why: "1000 Ω x 0.000001 F = 0.001 s = 1 ms. With the shortcut: kΩ x µF = ms, so 1 x 1 = 1 ms.",
        },
        {
          prompt: "A capacitor charges too slowly through its resistor. What makes it faster?",
          options: ["A larger resistor", "A larger capacitor", "A longer wait", "A smaller resistor or a smaller capacitor"],
          answer: 3,
          why: "tau = R x C. Making either one smaller makes tau smaller, so the voltage arrives sooner.",
        },
        {
          prompt: "A capacitor starts at 0 V and charges towards 3.3 V. Roughly where is it after one time constant?",
          options: ["At 0.33 V", "At 1.65 V, half way", "At about 2.1 V, 63 % of the way", "At 3.3 V"],
          answer: 2,
          why: "After one tau the voltage has covered about 63 % of the way: 0.63 x 3.3 V is about 2.1 V. The figure marks this point.",
        },
      ],
      hints: [
        "The figure answers all four. Watch the marked point at t = tau.",
        "tau = R x C. Use the shortcut kΩ x µF = ms. A smaller tau means a faster curve.",
        "It cannot jump. 1 x 1 = 1 ms. Smaller R or smaller C. About 63 % of 3.3 V.",
      ],
      takeaway: "A capacitor stores a little charge, so the voltage across it cannot jump. Fed through a resistor, it needs about five time constants, tau = R x C, to arrive.",
    },
    {
      id: "elec-power",
      kind: "brief",
      title: "Power and not breaking things",
      goal: "Learn what power is and the four rules that keep a board alive.",
      refs: [{ course: "L3", slide: [15, 6], note: "a pin is not a power supply" }, { course: "Primer A" }],
      brief: `
Electronic parts die of heat, and heat comes from power. A handful of mistakes kill most student boards. All of them can be seen coming with what you know now.

## Power
**Power** is how fast energy is delivered. Most of it ends up as heat. It is measured in **watts** (**W**) and written **P**:

- **P = V x I**

## Worked examples
- An LED's resistor with 1.3 V across it and 4 mA through it: P = 1.3 x 0.004 = 0.0052 W = 5.2 mW. It stays cold.
- A motor on 12 V taking 1 A: P = 12 x 1 = 12 W. That is real heat.

## Four rules
1. **Never more than 3.3 V on a pin.** The microcontroller runs on 3.3 V. Many sensors and other parts run on 5 V, and a 5 V signal damages a 3.3 V pin. Bring it down first, for example with a voltage divider.
2. **Never short the supply.** A wire from 3.3 V (or from the battery's +) straight to ground is a short circuit. By Ohm's law, I = V / R with R close to 0 is enormous. Wires get hot, the battery suffers, the chip can die.
3. **Never ask a pin for more than about 4 mA.** An LED with its resistor is fine. A motor, a lamp or a loudspeaker needs a driver.
4. **Connect the grounds.** Two boards can only agree on what "3.3 V" means if they share the same 0 V. A signal wire between two boards always needs a ground wire as well.

And one habit: switch the power off before you move a wire.
`,
      questions: [
        {
          prompt: "A part has 5 V across it and 2 A flows through it. How much power does it take?",
          options: ["2.5 W", "7 W", "10 W", "0.4 W"],
          answer: 2,
          why: "P = V x I = 5 x 2 = 10 W.",
        },
        {
          prompt: "A sensor's output swings between 0 V and 5 V. May you wire it straight to a pin of the 3.3 V microcontroller?",
          options: ["Yes, a pin reads anything above 2.0 V as 1", "Yes, if the wire is short", "Yes, but only as an output", "No: bring it down to 3.3 V or less first, for example with a voltage divider"],
          answer: 3,
          why: "A pin must never see more than 3.3 V. Two resistors as a voltage divider bring 5 V down to a safe level.",
        },
        {
          prompt: "Someone drops a screwdriver across the battery's + and - ends. What happens?",
          options: ["Nothing: metal has no resistance, so no power", "A short circuit: almost no resistance, so a huge current flows and things get hot", "The battery charges", "The voltage doubles"],
          answer: 1,
          why: "I = V / R. With R close to 0 the current is enormous. That is a short circuit.",
        },
        {
          prompt: "Two boards are joined by one signal wire and nothing else. Why does the signal not work?",
          options: ["They have no shared ground, so they do not agree on what 0 V is", "One wire is too thin", "Signals need 5 V", "The wire floats only at night"],
          answer: 0,
          why: "A voltage is always between two points. Without a shared ground there is no common 0 V to measure the signal from, and no loop for current.",
        },
      ],
      hints: [
        "Power is voltage times current. The other three questions are each answered by one of the four rules.",
        "Rule 1 for the sensor, rule 2 for the screwdriver, rule 4 for the two boards.",
        "5 x 2 = 10 W. Bring it down with a divider. A short circuit. No shared ground.",
      ],
      takeaway: "P = V x I. Keep every pin at or below 3.3 V and about 4 mA, never short the supply, and always connect the grounds.",
    },
    {
      id: "elec-checkpoint",
      kind: "quiz",
      title: "Checkpoint: read the circuit",
      goal: "Work out the voltages and currents in a button circuit and an LED circuit.",
      refs: [{ course: "L3", slide: [11, 9] }, { course: "Primer A" }],
      brief: `
This is the circuit behind the first real chapters: a push button that the microcontroller reads, and an LED that it switches. If you can read it, you are ready for the board.

{{figure:button-led-schematic}}

The figure does not tell you any voltage. It only helps you read: select a point to highlight everything joined to it by wire.

## Left side
3.3 V, then resistor R1 (10 kΩ), then point A, then a push button, then ground. Point A also goes to an **input pin**: a pin that only measures the voltage. No current flows into it.

## Right side
An **output pin**: a pin that the program sets to 3.3 V (high) or 0 V (low). Then point B, resistor R2 (330 Ω), point C, an LED, and ground. The LED keeps about 2 V when it is lit.

## What you need
- One wire, one voltage.
- No current through a resistor means no voltage across it (V = I x R).
- Ohm's law, with mA and kΩ changed to A and Ω first.
- An LED needs a higher voltage on its triangle side than on its bar side to light.
`,
      questions: [
        {
          prompt: "The button is released. What is the voltage at point A?",
          options: ["0 V", "1.65 V", "3.3 V", "It floats"],
          answer: 2,
          why: "No current can flow through R1 (the button is open and the input pin takes none), so there is no voltage across R1. Point A is at 3.3 V. R1 is a pull-up resistor.",
        },
        {
          prompt: "The button is pressed. What is the voltage at point A?",
          options: ["0 V", "1.65 V", "3.3 V", "It floats"],
          answer: 0,
          why: "The pressed button is a wire from A to ground, and everything joined by wire is at one voltage: 0 V.",
        },
        {
          prompt: "The button is pressed. How much current flows through R1 (10 kΩ)?",
          options: ["0 mA", "3.3 mA", "33 mA", "0.33 mA"],
          answer: 3,
          why: "R1 has 3.3 V at the top and 0 V at point A: I = 3.3 / 10 000 = 0.00033 A = 0.33 mA.",
        },
        {
          prompt: "The output pin is high (3.3 V) and the LED is lit. What is the voltage at point C?",
          options: ["3.3 V", "About 2 V", "1.3 V", "0 V"],
          answer: 1,
          why: "The LED's bar side is at ground and a lit LED keeps about 2 V across it, so its triangle side, point C, is at about 2 V. The other 1.3 V is across R2.",
        },
        {
          prompt: "Same state: pin high, LED lit. How much current flows through R2 (330 Ω) and the LED?",
          options: ["About 10 mA", "About 6 mA", "About 3.9 mA", "About 0.39 mA"],
          answer: 2,
          why: "R2 has 3.3 - 2.0 = 1.3 V across it: I = 1.3 / 330 = 0.0039 A = 3.9 mA. That is just within the 4 mA a pin can deliver.",
        },
        {
          prompt: "The program sets the output pin low (0 V). What does the LED do?",
          options: ["It stays lit, more dimly", "It goes dark: both ends of the path are at 0 V, so nothing pushes current", "It lights backwards", "It burns out"],
          answer: 1,
          why: "With 0 V at the pin and 0 V at ground there is no voltage difference, so no current flows and the LED is dark.",
        },
        {
          prompt: "Someone removes R1 completely. The button is released. What is point A now?",
          options: ["Floating: nothing sets its voltage, so the pin reads random values", "3.3 V", "0 V", "2 V"],
          answer: 0,
          why: "Without the pull-up, a released button leaves point A connected to nothing but the input pin, which only measures. The wire floats.",
        },
      ],
      hints: [
        "Take one side at a time. On the left, ask whether any current can flow through R1.",
        "Released: no current, so no voltage across R1. Pressed: A is wired to ground. On the right, the LED keeps 2 V and R2 gets the rest.",
        "3.3 V, 0 V, 3.3 / 10 000 A. Point C is at 2 V, the current is 1.3 / 330 A. Pin low: dark. No R1: floating.",
      ],
      takeaway: "You can now read the two circuits the whole course starts from: a button with a pull-up gives 3.3 V released and 0 V pressed, and a pin lights an LED through a resistor that sets the current.",
    },
    {
      id: "elec-p-wiring",
      kind: "wiring",
      tier: "practice",
      title: "Practice: wire an LED to a pin",
      goal: "Connect a resistor and an LED so that a high pin lights the LED.",
      refs: [{ course: "L3", slide: 9, note: "LED with its resistor on 3.3 V" }, { course: "Primer A" }],
      brief: `
An LED that is wired backwards, or without its resistor, is the classic first mistake on a real board. Practise the right order once.

The program will set the **GPIO pin** high (3.3 V) to light the LED. "GPIO pin" is the usual name for a pin that a program controls. Chapter 2 explains it.

A terminal is a point where a wire can be attached. Already in place (grey):

- The pin is connected to one end of the **resistor**. The resistor is drawn as a box.

The **LED** itself is not drawn. It sits between its two terminals:

- **LED anode (+)**: where current must enter.
- **LED cathode (-)**: where current leaves.

Add the two wires that are missing, so that current can flow from the pin, through the resistor and the LED, to **GND** (ground).

To add a wire, select one terminal and then the other.
`,
      nodes: [
        { id: "pin", label: "GPIO pin (3.3 V when high)", x: 32, y: 14, side: "top" },
        { id: "ra", label: "Resistor end 1", x: 32, y: 32, side: "left" },
        { id: "rb", label: "Resistor end 2", x: 56, y: 32, side: "bottom" },
        { id: "an", label: "LED anode (+)", x: 72, y: 14, side: "top" },
        { id: "ca", label: "LED cathode (-)", x: 72, y: 32, side: "right" },
        { id: "gnd", label: "GND", x: 72, y: 49, side: "bottom" },
      ],
      parts: [{ kind: "resistor", a: "ra", b: "rb", label: "resistor 330 Ω" }],
      fixed: [["pin", "ra"]],
      wires: [
        ["rb", "an"],
        ["ca", "gnd"],
      ],
      mistakes: [
        {
          wire: ["rb", "ca"],
          why: "That puts the resistor on the LED's cathode, so current would have to enter the LED at the wrong end. An LED blocks current in that direction and stays dark.",
        },
        {
          wire: ["an", "gnd"],
          why: "The anode is where current enters the LED, so it must be on the side that comes from the pin. Ground belongs on the cathode.",
        },
        {
          wire: ["pin", "an"],
          why: "That wire goes around the resistor. With nothing to limit the current, the LED and the pin would be overloaded.",
        },
        {
          wire: ["pin", "gnd"],
          why: "When the pin goes high, that wire connects 3.3 V straight to ground: a short circuit.",
        },
        {
          wire: ["rb", "gnd"],
          why: "Now the current goes from the pin through the resistor straight to ground and never passes through the LED.",
        },
        {
          wire: ["ra", "gnd"],
          why: "Resistor end 1 is joined to the pin. Wiring it to ground shorts the pin to ground when it goes high.",
        },
      ],
      hints: [
        "Follow the current: it leaves the pin, must pass the resistor, then the LED, and must end at ground.",
        "Current enters an LED at its anode and leaves at its cathode.",
        "Wire Resistor end 2 to LED anode (+), and LED cathode (-) to GND.",
      ],
      takeaway: "Pin, resistor, LED anode, LED cathode, ground: one path, one loop. The resistor may sit on either side of the LED, but the LED must point from the high side to ground.",
    },
    {
      id: "elec-p-calc",
      kind: "calc",
      tier: "practice",
      title: "Practice: Ohm's law in mA and kΩ",
      goal: "Use Ohm's law on four everyday values with prefixes.",
      refs: REF,
      brief: `
On the robot, almost every current is in mA and almost every resistor is in kΩ. A slip between the two gives an answer that is wrong by a factor of 1000, which is the difference between a safe pin and a dead one.

The safe way is always the same:

1. Change everything to plain units: A, V, Ω.
2. Use Ohm's law.
3. Change the result back to a handy prefix.

## Worked example
3.3 V across 1 kΩ.

1. 1 kΩ = 1000 Ω.
2. I = 3.3 / 1000 = 0.0033 A.
3. 0.0033 A = 3.3 mA.

## A shortcut
Look at the example again: 3.3 V and 1 kΩ gave 3.3 mA. Volts divided by kilohms gives milliamperes directly, because the two factors of 1000 cancel. In the same way, mA times kΩ gives V.

- 5 V / 2 kΩ = 2.5 mA
- 2 mA x 3 kΩ = 6 V

Use whichever way you trust. Check one answer both ways.
`,
      fields: [
        { id: "a", label: "3.3 V across 10 kΩ. Current?", unit: "mA", answer: 0.33, tolPct: 1, why: "3.3 V / 10 kΩ = 0.33 mA. In plain units: 3.3 / 10 000 = 0.00033 A." },
        { id: "b", label: "5 V across 250 Ω. Current?", unit: "mA", answer: 20, tolPct: 1, why: "I = 5 / 250 = 0.02 A = 20 mA." },
        { id: "c", label: "2 mA through 4.7 kΩ. Voltage across it?", unit: "V", answer: 9.4, tolPct: 1, why: "2 mA x 4.7 kΩ = 9.4 V. In plain units: 0.002 x 4700 = 9.4 V." },
        { id: "d", label: "3.3 V should give exactly 1 mA. Resistance?", unit: "kΩ", answer: 3.3, tolPct: 1, why: "R = 3.3 V / 1 mA = 3.3 kΩ. In plain units: 3.3 / 0.001 = 3300 Ω." },
      ],
      hints: [
        "Change mA to A and kΩ to Ω first, then use I = V / R, V = I x R or R = V / I.",
        "The shortcut: V / kΩ = mA, mA x kΩ = V, V / mA = kΩ. The second one has plain ohms: 5 / 250 gives amperes.",
        "3.3 / 10. Then 5 / 250 = 0.02 A, in mA. Then 2 x 4.7. Then 3.3 / 1.",
      ],
      takeaway: "Change to plain units, calculate, change back. Or remember that volts, milliamperes and kilohms fit together: V = mA x kΩ.",
    },
    {
      id: "elec-p-order",
      kind: "order",
      tier: "practice",
      title: "Practice: follow the current",
      goal: "Put the path of the current through an LED circuit in order.",
      refs: REF,
      brief: `
When a light on the robot stays dark, you find the fault by following the current around its loop, one part at a time, until you reach the place where the loop is broken. Practise the walk on a circuit that works.

The circuit is the right side of the checkpoint: an output pin, a 330 Ω resistor, an LED, and ground. The program has just set the pin high.

Put the steps in order, starting at the pin and ending where the loop closes. Remember:

- Current flows from the higher voltage towards ground.
- The resistor comes before the LED in this circuit.
- Current enters an LED at its anode (the triangle side) and leaves at its cathode (the bar side).
- A loop is only complete when the current is back at the supply it came from.
`,
      steps: [
        "The output pin is driven high: 3.3 V appears on the pin",
        "Current leaves the pin and enters the resistor",
        "The resistor takes 1.3 V of the 3.3 V, which sets the current to about 3.9 mA",
        "The current reaches the LED's anode, at about 2 V",
        "The current passes through the LED, which lights",
        "The current leaves the LED at its cathode, at 0 V",
        "The current returns through ground to the supply, and the loop is closed",
      ],
      hints: [
        "Walk downhill in voltage: 3.3 V at the pin, about 2 V after the resistor, 0 V after the LED.",
        "Pin, resistor, anode, through the LED, cathode, ground.",
        "Pin high, into the resistor, resistor takes 1.3 V, anode at 2 V, LED lights, cathode at 0 V, back through ground.",
      ],
      takeaway: "Every working circuit can be walked as a loop, downhill in voltage from the supply to ground. A fault is the place where the walk stops.",
    },
    {
      id: "elec-x-divider",
      kind: "calc",
      tier: "expert",
      title: "Expert: a 5 V sensor on a 3.3 V pin",
      goal: "Design a voltage divider that makes a 5 V signal safe, and check what it costs.",
      refs: REF,
      brief: `
A distance sensor on the robot puts out up to 5 V. The pin that reads it must never see more than 3.3 V. You have a 10 kΩ resistor for the top of a voltage divider (R1, on the sensor's side) and must choose the bottom one (R2, to ground). The pin reads the middle point.

This level gives no worked example. Everything you need is in the earlier levels:

- the divider formula, V = Vin x R2 / (R1 + R2)
- Ohm's law and series resistance
- P = V x I

For the first field you must turn the divider formula around. One way: the two resistors carry the same current, so their voltages are in the same proportion as their resistances. If R2 has 3.3 V across it, R1 has the rest of the 5 V.

Resistors are sold only in certain values. The nearest one below your exact answer is 18 kΩ. The last three fields use it.
`,
      fields: [
        { id: "r2", label: "R1 = 10 kΩ. Which R2 gives exactly 3.3 V from 5 V?", unit: "kΩ", answer: 19.41, tolPct: 1, why: "R1 has 5 - 3.3 = 1.7 V across it and R2 has 3.3 V. Same current, so R2 / R1 = 3.3 / 1.7, and R2 = 10 x 3.3 / 1.7 = 19.4 kΩ." },
        { id: "v", label: "With R2 = 18 kΩ: middle voltage when the sensor gives 5 V?", unit: "V", answer: 3.214, tolPct: 1, why: "V = 5 x 18 / (10 + 18) = 3.21 V. That is below 3.3 V, so the pin is safe. Choosing the value below the exact one errs on the safe side." },
        { id: "i", label: "With R2 = 18 kΩ: current drawn from the sensor at 5 V?", unit: "mA", answer: 0.1786, tolPct: 2, why: "The sensor sees R1 + R2 = 28 kΩ: I = 5 V / 28 kΩ = 0.179 mA." },
        { id: "p", label: "Power turned into heat in the two resistors together?", unit: "mW", answer: 0.893, tolPct: 2, why: "P = V x I = 5 V x 0.179 mA = 0.89 mW. Far too little to feel." },
      ],
      hints: [
        "For R2: how many volts must be across R1, and how many across R2? In series, the voltages are in the same proportion as the resistances.",
        "R2 = R1 x 3.3 / 1.7. Then use the divider formula with 18 kΩ, and Ohm's law with the total resistance of 28 kΩ.",
        "10 x 3.3 / 1.7. Then 5 x 18 / 28. Then 5 / 28 in mA. Then 5 V times that current, in mW.",
      ],
      takeaway: "A divider made of tens of kilohms brings 5 V down to a safe level while drawing a fraction of a milliamp. Pick the standard value that errs on the safe side.",
    },
    {
      id: "elec-x-timing",
      kind: "calc",
      tier: "expert",
      title: "Expert: the robot's time scales",
      goal: "Move between frequency, period, duty cycle and time constant on the robot's real numbers.",
      refs: [{ course: "L2", slide: 25, note: "200 MHz clock ticks into times" }, { course: "L6-7", slide: 58 }, { course: "Primer A" }],
      brief: `
Three time scales meet on the robot, a factor of a thousand or more apart. Mix them up and a motor signal is a thousand times too slow, or a filter does nothing. These are the real numbers the later chapters use:

- The microcontroller's clock runs at **200 MHz**. Every operation of the chip is counted in ticks of this clock.
- The signal that commands a motor repeats at **20 kHz**.
- A resistor of 10 kΩ and a capacitor of 100 nF are often used to smooth a signal.

No worked example here. You need f = 1 / T, the meaning of duty cycle, tau = R x C, and the prefixes. Work in plain units (Hz, s) and change to the asked prefix at the end.
`,
      fields: [
        { id: "t", label: "Period of the 20 kHz motor signal", unit: "µs", answer: 50, tolPct: 1, why: "T = 1 / 20 000 s = 0.00005 s = 50 µs." },
        { id: "h", label: "High time per period at a duty cycle of 25 %", unit: "µs", answer: 12.5, tolPct: 1, why: "25 % of 50 µs is 12.5 µs." },
        { id: "c", label: "Period of the 200 MHz clock (one tick)", unit: "ns", answer: 5, tolPct: 1, why: "T = 1 / 200 000 000 s = 0.000000005 s = 5 ns." },
        { id: "n", label: "Clock ticks in one period of the motor signal", answer: 10000, why: "50 µs / 5 ns = 50 000 ns / 5 ns = 10 000 ticks. Equally, 200 MHz / 20 kHz = 10 000." },
        { id: "tau", label: "Time constant of 10 kΩ with 100 nF", unit: "ms", answer: 1, tolPct: 1, why: "tau = 10 000 Ω x 0.0000001 F = 0.001 s = 1 ms." },
        { id: "k", label: "Periods of the motor signal in one time constant", answer: 20, why: "1 ms / 50 µs = 1000 µs / 50 µs = 20. The capacitor barely moves during one period, so it smooths the signal to its average." },
      ],
      hints: [
        "T = 1 / f with f in plain hertz gives T in seconds. Then move the decimal point three places per prefix step.",
        "20 kHz = 20 000 Hz. 200 MHz = 200 000 000 Hz. To compare two times, put both in the same unit first.",
        "1 / 20 000 s in µs. A quarter of that. 1 / 200 000 000 s in ns. 50 000 ns / 5 ns. 10 kΩ x 0.1 µF in ms. 1000 µs / 50 µs.",
      ],
      takeaway: "The chip counts in 5 ns ticks, a motor signal period is 10 000 of them (50 µs), and a 1 ms time constant spans 20 such periods. Always compare times in the same unit.",
    },
  ],
};
