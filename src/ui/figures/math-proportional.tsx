import { useState } from "react";
import { CodePre } from "../CopyButton";

// Proportional steering: the correction is a gain times the error, then
// limited. The numbers are the wall follower of the course's final project
// starter (lecture 14, Lab 6): ref_right_wall = 1.1 ft, Kp_right_wal = -4.0,
// turn_saturation = 2.5, and the course's sign: positive turn = right.
const REF = 1.1;
const LIMIT = 2.5;
const GAINS = [-1, -4, -8];

const WALL_Y = 156;
const PX_PER_FT = 40;
const ROBOT_X = 96;
const yOf = (ft: number) => WALL_Y - ft * PX_PER_FT;
const signed = (v: number, digits = 2) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

function MathProportional() {
  const [d, setD] = useState(1.5);
  const [kp, setKp] = useState(-4);

  const error = REF - d;
  const raw = kp * error;
  const turn = Math.max(-LIMIT, Math.min(LIMIT, raw));
  const limited = Math.abs(raw) > LIMIT + 1e-9;
  const onTarget = Math.abs(error) < 0.049;
  const far = error < 0;
  const y = yOf(d);
  // positive turn is to the right, which is towards the wall: down in the picture
  const bend = turn * 14;
  const gy = (v: number) => 86 + v * 26; // gauge: -2.5 at the top, +2.5 at the bottom

  const why = onTarget
    ? `The robot is at the wanted distance. The error is ${error.toFixed(1)}, so turn is ${turn.toFixed(1)}: it drives straight on.`
    : `The robot is ${Math.abs(error).toFixed(1)} ft too ${far ? "far from" : "close to"} the wall. ` +
      `error = wanted - measured = ${REF} - ${d.toFixed(1)} = ${signed(error, 1)} ft. ` +
      `turn = gain x error = ${kp} x ${signed(error, 1)} = ${signed(raw)}: ${raw > 0 ? "positive, so the robot turns right, towards the wall" : "negative, so the robot turns left, away from the wall"}.` +
      (limited ? ` That is beyond the limit, so turn is cut to ${signed(turn, 1)}.` : " Twice the error would give twice the turn.");

  return (
    <figure className="figure mprop" aria-label="Interactive picture of proportional steering along a wall">
      <style>{`
        .mprop-slider { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 12rem; }
        .mprop-slider input { flex: 1; min-width: 6rem; accent-color: var(--orange); }
        .mprop-slider output { font-family: var(--mono); color: var(--harvest); font-weight: 700; min-width: 3.6rem; }
        .mprop-wall { stroke: var(--text); stroke-width: 4; }
        .mprop-hatch { stroke: var(--dim); stroke-width: 1; }
        .mprop-ref { stroke: var(--arches); stroke-width: 1.4; stroke-dasharray: 5 4; }
        .mprop-meas { stroke: var(--harvest); stroke-width: 1.6; }
        .mprop-path { stroke: var(--orange); stroke-width: 2.4; fill: none; }
        .mprop-head { fill: var(--orange); }
        .mprop-robot { fill: var(--surface); stroke: var(--text); stroke-width: 1.4; }
        .mprop-gauge { fill: var(--surface); stroke: var(--dim); }
        .mprop-mark { fill: var(--orange); }
        .mprop-raw { stroke: var(--dim); stroke-width: 1.4; stroke-dasharray: 3 2; fill: none; }
      `}</style>
      <svg
        viewBox="0 0 420 186"
        role="img"
        aria-label={`The robot is ${d.toFixed(1)} feet from the wall on its right; it should be ${REF} feet. Error ${error.toFixed(1)} feet, gain ${kp}, turn command ${turn.toFixed(2)}${limited ? `, limited from ${raw.toFixed(2)}` : ""}: ${onTarget ? "straight on" : turn > 0 ? "to the right, towards the wall" : "to the left, away from the wall"}.`}
      >
        <defs>
          <marker id="mprop-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="mprop-head" />
          </marker>
        </defs>
        {/* the wall on the robot's right */}
        <line x1="8" x2="300" y1={WALL_Y} y2={WALL_Y} className="mprop-wall" />
        {Array.from({ length: 15 }, (_, k) => (
          <line key={k} x1={14 + k * 20} x2={6 + k * 20} y1={WALL_Y + 2} y2={WALL_Y + 12} className="mprop-hatch" />
        ))}
        <text x="296" y={WALL_Y + 25} textAnchor="end" className="fig-label dim">wall on the robot's right</text>
        {/* wanted distance */}
        <line x1="8" x2="300" y1={yOf(REF)} y2={yOf(REF)} className="mprop-ref" />
        <text x="296" y={yOf(REF) - 4} textAnchor="end" className="fig-label">wanted: {REF} ft</text>
        {/* measured distance */}
        <line x1={ROBOT_X - 34} x2={ROBOT_X - 34} y1={y} y2={WALL_Y - 2} className="mprop-meas" />
        <line x1={ROBOT_X - 39} x2={ROBOT_X - 29} y1={y} y2={y} className="mprop-meas" />
        <text x={ROBOT_X - 40} y={Math.min((y + WALL_Y) / 2 + 3, WALL_Y - 6)} textAnchor="end" className="fig-value small">{d.toFixed(1)} ft</text>
        {/* robot, driving to the right */}
        <rect x={ROBOT_X - 18} y={y - 9} width="30" height="18" rx="4" className="mprop-robot" />
        <polygon points={`${ROBOT_X + 12},${y - 6} ${ROBOT_X + 22},${y} ${ROBOT_X + 12},${y + 6}`} className="mprop-robot" />
        {/* where it steers */}
        <path d={`M${ROBOT_X + 24},${y} Q${ROBOT_X + 70},${y} ${ROBOT_X + 112},${y + bend}`} className="mprop-path" markerEnd="url(#mprop-arrow)" />
        <text x={ROBOT_X + 118} y={y + bend + (turn >= 0 ? 12 : -5)} className="fig-label">{onTarget ? "straight" : turn > 0 ? "turns right" : "turns left"}</text>
        {/* turn gauge */}
        <text x="362" y="12" textAnchor="middle" className="fig-label">turn</text>
        <rect x="354" y={gy(-LIMIT)} width="16" height={gy(LIMIT) - gy(-LIMIT)} rx="3" className="mprop-gauge" />
        <line x1="350" x2="374" y1={gy(0)} y2={gy(0)} className="fig-wire" />
        <text x="348" y={gy(-LIMIT) + 8} textAnchor="end" className="fig-label dim">left -{LIMIT}</text>
        <text x="348" y={gy(0) + 3} textAnchor="end" className="fig-label dim">0</text>
        <text x="348" y={gy(LIMIT)} textAnchor="end" className="fig-label dim">right +{LIMIT}</text>
        <rect x="354" y={Math.min(gy(0), gy(turn))} width="16" height={Math.abs(gy(turn) - gy(0))} className="mprop-mark" opacity="0.35" />
        <polygon points={`376,${gy(turn)} 386,${gy(turn) - 5} 386,${gy(turn) + 5}`} className="mprop-mark" />
        <text x="389" y={gy(turn) + 3} className="fig-value small">{signed(turn, 1)}</text>
        {limited && <text x="362" y={raw > 0 ? gy(LIMIT) + 13 : gy(-LIMIT) - 5} textAnchor="middle" className="fig-label">limited</text>}
      </svg>
      <div className="fig-step" role="status">
        <p>{why}</p>
        <CodePre><code>{`turn = Kp_right_wal *
  (ref_right_wall - LADARrightfront);
//   = ${kp} * (${REF} - ${d.toFixed(1)}) = ${signed(raw)}${limited ? `\n//   limited to ${signed(turn, 1)}` : ""}`}</code></CodePre>
      </div>
      <div className="fig-controls">
        <div>
          <span>Measured</span>
          <label className="mprop-slider">
            <input type="range" min={0.4} max={3} step={0.1} value={d} onChange={(e) => setD(+e.target.value)} aria-label="Measured distance to the wall in feet" />
            <output>{d.toFixed(1)} ft</output>
          </label>
        </div>
        <div>
          <span>Gain</span>
          {GAINS.map((g) => (
            <button key={g} className="fig-opt" aria-pressed={kp === g} onClick={() => setKp(g)}>{g}</button>
          ))}
        </div>
      </div>
      <figcaption>Seen from above: the robot drives to the right of the picture, with the wall on its right-hand side. The further it is from the dashed line, the harder it steers back, up to the limit. A larger gain reacts more strongly to the same error.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-proportional",
  title: "Proportional steering along a wall",
  description: "Move the robot nearer to or further from the wall and change the gain to see the turn command grow with the error, up to its limit.",
  Component: MathProportional,
};
