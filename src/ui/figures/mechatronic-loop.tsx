import { useState } from "react";

// A mechatronic system in one picture (primer A, first level): sensors
// measure, the microcontroller decides, actuators act, and the world closes
// the loop. Examples are the course robot's parts (F28379D LaunchPad, wheel
// encoders, IR distance sensors, DC motors through an H-bridge driver).

type Part = "sensors" | "mcu" | "actuators" | "wires" | "world";

const ORDER: Part[] = ["sensors", "mcu", "actuators", "world", "wires"];
const NAME: Record<Part, string> = {
  sensors: "Sensors",
  mcu: "Microcontroller",
  actuators: "Actuators",
  world: "The world",
  wires: "Wires",
};
const WHY: Record<Part, string> = {
  sensors:
    "Sensors measure. A distance sensor tells how far the wall is, a wheel sensor tells how far the wheel has turned, a push button tells whether a finger is on it. Each one turns something physical into electricity on a wire.",
  mcu: "The microcontroller is a small computer on one chip. It runs your program (a list of instructions you write), reads what the sensors report, decides what to do, and sends commands out. In this game it is a Texas Instruments F28379D.",
  actuators:
    "Actuators act. A motor turns a wheel, an LED (a small light) shows a state, a buzzer makes a sound. Each one turns electricity back into something physical.",
  world:
    "The robot moves, so the wall is now closer, so the sensor reports a new distance. The loop is closed: measure, decide, act, and measure again, many times per second.",
  wires:
    "Wires carry electricity between the parts: measurements go in to the microcontroller, commands go out. Nearly every bug you will meet is a wrong signal on one of these wires. This chapter teaches you to understand them.",
};

const CSS = `
.ml-part { cursor: pointer; }
.ml-part rect { fill: var(--surface); stroke: var(--dim); stroke-width: 1.2; }
.ml-part.sel rect { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 2.2; }
.ml-title { fill: var(--text); font-size: 10.5px; font-family: var(--sans); font-weight: 700; }
.ml-arrow { fill: none; stroke: var(--dim); stroke-width: 2; }
.ml-arrow.sel { stroke: var(--orange); stroke-width: 3; }
.ml-head { fill: var(--dim); }
.ml-head.sel { fill: var(--orange); }
`;

function MechatronicLoop() {
  const [sel, setSel] = useState<Part>("sensors");
  const cls = (p: Part) => `ml-part ${sel === p ? "sel" : ""}`;
  const w = sel === "wires" ? "sel" : "";
  const box = (p: Part, x: number, y: number, wd: number, title: string, l1: string, l2: string) => (
    <g className={cls(p)} onClick={() => setSel(p)}>
      <rect x={x} y={y} width={wd} height="54" rx="6" />
      <text x={x + wd / 2} y={y + 17} textAnchor="middle" className="ml-title">{title}</text>
      <text x={x + wd / 2} y={y + 32} textAnchor="middle" className="fig-label dim">{l1}</text>
      <text x={x + wd / 2} y={y + 44} textAnchor="middle" className="fig-label dim">{l2}</text>
    </g>
  );
  return (
    <figure className="figure" aria-label="Interactive picture of a mechatronic system: sensors, microcontroller, actuators and the world in a loop">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 168" role="img" aria-label={`A loop: sensors feed the microcontroller, the microcontroller commands the actuators, the actuators change the world, and the sensors measure the world again. Selected: ${NAME[sel]}.`}>
        {box("sensors", 8, 20, 104, "Sensors", "measure", "distance, turning, touch")}
        {box("mcu", 148, 20, 104, "Microcontroller", "decides", "runs your program")}
        {box("actuators", 288, 20, 104, "Actuators", "act", "motors, lights, sound")}
        {/* wires between the boxes */}
        <line x1="112" y1="47" x2="140" y2="47" className={`ml-arrow ${w}`} />
        <polygon points="140,42 148,47 140,52" className={`ml-head ${w}`} />
        <line x1="252" y1="47" x2="280" y2="47" className={`ml-arrow ${w}`} />
        <polygon points="280,42 288,47 280,52" className={`ml-head ${w}`} />
        <text x="130" y="14" textAnchor="middle" className="fig-label">wire</text>
        <text x="270" y="14" textAnchor="middle" className="fig-label">wire</text>
        <line x1="130" y1="17" x2="130" y2="42" className="fig-wire" strokeDasharray="2 2" />
        <line x1="270" y1="17" x2="270" y2="42" className="fig-wire" strokeDasharray="2 2" />
        {/* the world closes the loop */}
        <path d="M340,74 V120 H300" className="ml-arrow" />
        <polygon points="300,115 292,120 300,125" className="ml-head" />
        <path d="M108,120 H60 V82" className="ml-arrow" />
        <polygon points="55,82 60,74 65,82" className="ml-head" />
        <g className={cls("world")} onClick={() => setSel("world")}>
          <rect x="108" y="98" width="184" height="54" rx="6" />
          <text x="200" y="115" textAnchor="middle" className="ml-title">The world</text>
          <text x="200" y="130" textAnchor="middle" className="fig-label dim">the robot, the floor, the walls</text>
          <text x="200" y="142" textAnchor="middle" className="fig-label dim">what the actuators change, the sensors see</text>
        </g>
      </svg>
      <p className="fig-why" role="status"><strong>{NAME[sel]}.</strong> {WHY[sel]}</p>
      <div className="fig-controls">
        <div>
          <span>Show</span>
          {ORDER.map((p) => (
            <button key={p} className="fig-opt" aria-pressed={sel === p} onClick={() => setSel(p)}>{NAME[p]}</button>
          ))}
        </div>
      </div>
      <figcaption>A mechatronic system is a loop: measure, decide, act, and measure again. Select each part to see what it does on the robot.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "mechatronic-loop",
  title: "The mechatronic loop",
  description: "Select the sensors, the microcontroller, the actuators, the world or the wires to see what each part of the measure, decide, act loop does on the robot.",
  Component: MechatronicLoop,
};
