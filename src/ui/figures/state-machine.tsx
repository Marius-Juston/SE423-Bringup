import { useState } from "react";
import { CodePre } from "../CopyButton";

// The three-state wall follower of chapter 17 (levels sens-fsm-quiz,
// sens-follow, sens-chatter; lecture 14, homework 3 and 4). States,
// thresholds and the order of the tests are the ones in FOLLOW_DEFS and
// SWITCH of src/levels/chapters/ch17_sensors.ts; the noisy readings are
// that chapter's CHATTER_FRONT.

type State = "STRAIGHT" | "TURN_LEFT" | "FOLLOW";

const FRONT_BLOCKED = 1.5;
const FRONT_CLEAR = 3.0;
const WALL_NEAR = 2.5;
const WALL_LOST = 4.0;
const NOISY = [4, 1.47, 1.53, 1.46, 1.52, 1.48, 3.5];
const KEEP = 10;

interface Transition {
  id: string;
  from: State;
  to: State;
  /** Path of the arrow in the diagram. */
  d: string;
  test: (front: number, right: number, clear: number) => boolean;
  code: (hyst: boolean) => string;
  say: (front: number, right: number, clear: number) => string;
}

// In the order the switch tests them.
const TRANSITIONS: Transition[] = [
  {
    id: "s-t",
    from: "STRAIGHT",
    to: "TURN_LEFT",
    d: "M48 66 V139 H158",
    test: (f) => f < FRONT_BLOCKED,
    code: () => "if (front_ft < FRONT_BLOCKED) { state = TURN_LEFT; }",
    say: (f) => `front ${f.toFixed(2)} ft is below ${FRONT_BLOCKED.toFixed(1)}: a wall is in the way`,
  },
  {
    id: "s-f",
    from: "STRAIGHT",
    to: "FOLLOW",
    d: "M120 40 H298",
    test: (_f, r) => r < WALL_NEAR,
    code: () => "if (front_ft < FRONT_BLOCKED) { state = TURN_LEFT; }\n    else if (right_ft < WALL_NEAR) { state = FOLLOW; }",
    say: (_f, r) => `right ${r.toFixed(1)} ft is below ${WALL_NEAR.toFixed(1)}: there is a wall to follow`,
  },
  {
    id: "t-f",
    from: "TURN_LEFT",
    to: "FOLLOW",
    d: "M236 120 V92 H310 V68",
    test: (f, _r, clear) => f > clear,
    code: (h) => `if (front_ft > ${h ? "FRONT_CLEAR" : "FRONT_BLOCKED"}) { state = FOLLOW; }`,
    say: (f, _r, clear) => `front ${f.toFixed(2)} ft is above ${clear.toFixed(1)}: the turn is finished`,
  },
  {
    id: "f-t",
    from: "FOLLOW",
    to: "TURN_LEFT",
    d: "M372 66 V139 H262",
    test: (f) => f < FRONT_BLOCKED,
    code: () => "if (front_ft < FRONT_BLOCKED) { state = TURN_LEFT; }",
    say: (f) => `front ${f.toFixed(2)} ft is below ${FRONT_BLOCKED.toFixed(1)}: a wall is in the way`,
  },
  {
    id: "f-s",
    from: "FOLLOW",
    to: "STRAIGHT",
    d: "M298 56 H120",
    test: (_f, r) => r > WALL_LOST,
    code: () => "if (front_ft < FRONT_BLOCKED) { state = TURN_LEFT; }\n    else if (right_ft > WALL_LOST) { state = STRAIGHT; }",
    say: (_f, r) => `right ${r.toFixed(1)} ft is above ${WALL_LOST.toFixed(1)}: the wall is gone`,
  },
];

const NODES: { s: State; x: number; y: number; action: string; led: string; letter: string }[] = [
  { s: "STRAIGHT", x: 20, y: 28, action: "drive straight", led: "LED1", letter: "S" },
  { s: "FOLLOW", x: 300, y: 28, action: "steer along the wall", led: "LED3", letter: "F" },
  { s: "TURN_LEFT", x: 160, y: 120, action: "turn on the spot", led: "LED2", letter: "T" },
];
const LETTER: Record<State, string> = { STRAIGHT: "S", TURN_LEFT: "T", FOLLOW: "F" };

interface Scan {
  front: number;
  right: number;
  state: State;
  /** Transition taken by this scan. */
  fired?: string;
}

interface Model {
  hyst: boolean;
  front: number;
  right: number;
  scans: Scan[];
  /** Total scans evaluated since the last reset. */
  n: number;
  changes: number;
  /** Next reading of the noisy sequence, or -1 when it is not being played. */
  noisy: number;
}

const start = (hyst: boolean): Model => ({ hyst, front: 4, right: 5, scans: [{ front: 4, right: 5, state: "STRAIGHT" }], n: 1, changes: 0, noisy: -1 });

/** One scan: at most one transition, tested in the order of the switch. */
function evaluate(m: Model, front: number, right: number, from?: State): Model {
  const cur = from ?? m.scans[m.scans.length - 1].state;
  const clear = m.hyst ? FRONT_CLEAR : FRONT_BLOCKED;
  const t = TRANSITIONS.find((x) => x.from === cur && x.test(front, right, clear));
  const scan: Scan = { front, right, state: t ? t.to : cur, fired: t?.id };
  return { ...m, front, right, scans: [...m.scans, scan].slice(-KEEP), n: m.n + 1, changes: m.changes + (t ? 1 : 0) };
}

function StateMachine() {
  const [m, setM] = useState<Model>(() => start(true));
  const last = m.scans[m.scans.length - 1];
  const state = last.state;
  const clear = m.hyst ? FRONT_CLEAR : FRONT_BLOCKED;
  const fired = TRANSITIONS.find((t) => t.id === last.fired);
  const playing = m.noisy >= 0;

  const setFront = (v: number) => setM((p) => evaluate({ ...p, noisy: -1 }, v, p.right));
  const setRight = (v: number) => setM((p) => evaluate({ ...p, noisy: -1 }, p.front, v));
  const setHyst = (h: boolean) => setM(start(h));
  const noisyStep = () =>
    setM((p) => {
      if (p.noisy >= NOISY.length) return p;
      if (p.noisy < 0) {
        // Start the run of level sens-chatter: in FOLLOW, wall 2 ft to the right.
        const first: Model = { ...p, scans: [], n: 0, changes: 0, noisy: 1 };
        const e = evaluate(first, NOISY[0], 2, "FOLLOW");
        return { ...e, changes: 0 };
      }
      return { ...evaluate(p, NOISY[p.noisy], 2), noisy: p.noisy + 1 };
    });

  // What the status line says about the scan just evaluated.
  let why: string;
  if (fired) why = `In ${fired.from}, ${fired.say(last.front, last.right, clear)}. The state becomes ${fired.to}.`;
  else if (state === "TURN_LEFT")
    why =
      last.front > FRONT_BLOCKED && m.hyst
        ? `In TURN_LEFT the only way out is front above ${clear.toFixed(1)} ft. ${last.front.toFixed(2)} ft is inside the gap between the two thresholds, so the robot keeps turning.`
        : `In TURN_LEFT the only way out is front above ${clear.toFixed(1)} ft. ${last.front.toFixed(2)} ft is not, so the robot keeps turning.`;
  else if (state === "FOLLOW") why = `In FOLLOW: front ${last.front.toFixed(2)} ft is not below ${FRONT_BLOCKED.toFixed(1)} and right ${last.right.toFixed(1)} ft is not above ${WALL_LOST.toFixed(1)}. No condition is true, so the state stays.`;
  else why = `In STRAIGHT: front ${last.front.toFixed(2)} ft is not below ${FRONT_BLOCKED.toFixed(1)} and right ${last.right.toFixed(1)} ft is not below ${WALL_NEAR.toFixed(1)}. No condition is true, so the state stays.`;
  const noisyDone = playing && m.noisy >= NOISY.length;
  const verdict = noisyDone
    ? m.changes > 2
      ? ` The state changed ${m.changes} times for one wall: that is chattering. Entering and leaving the turn use the same number, and the reading hovers around it.`
      : ` The state changed ${m.changes} times: once into the turn, once out of it. The noise between 1.46 and 1.53 ft never reaches ${FRONT_CLEAR.toFixed(1)} ft.`
    : "";

  // Top view of the robot: front is up, the wall on the right.
  const RX = 44;
  const RY = 262;
  const FT = 9.5;
  // Distances are drawn from the edge of the robot, so 0.5 ft is still a visible gap.
  const wallY = RY - 7 - last.front * FT;
  const wallX = RX + 7 + last.right * FT;
  const wallLost = last.right > WALL_LOST;

  // Strip chart of the front reading.
  const CX0 = 172;
  const CX1 = 410;
  const CY0 = 196;
  const CY1 = 250;
  const cy = (ft: number) => CY1 - (Math.min(5, ft) / 5) * (CY1 - CY0);
  const cx = (k: number) => CX0 + 12 + k * ((CX1 - CX0 - 24) / (KEEP - 1));
  const line = m.scans.map((s, k) => `${k ? "L" : "M"}${cx(k).toFixed(1)},${cy(s.front).toFixed(1)}`).join(" ");

  return (
    <figure className="figure fsm-fig" aria-label="Interactive state diagram of the three-state wall follower">
      <style>{`
        .fsm-fig input[type=range] { flex: 1 1 8rem; min-width: 7rem; accent-color: var(--orange); }
        .fsm-fig output { font-family: var(--mono); font-size: 0.82rem; color: var(--harvest); min-width: 4.2rem; }
        .fsm-fig svg text.fsm-name { font-weight: 700; font-size: max(9.5px, calc(9px / var(--fig-k, 1))); }
        .fsm-fig .fsm-gap { fill: var(--value); opacity: 0.16; }
        .fsm-fig .fsm-plot { fill: none; stroke: var(--border); }
        .fsm-fig .fsm-thr { stroke: var(--harvest); stroke-width: 1; stroke-dasharray: 4 3; }
        .fsm-fig .fsm-wall { stroke: var(--text); stroke-width: 3; }
        .fsm-fig .fsm-wall.lost { stroke: var(--dim); stroke-width: 1.4; stroke-dasharray: 3 3; }
        .fsm-fig .fsm-robot { fill: var(--arches); }
        .fsm-fig .fsm-cell { fill: var(--surface); stroke: var(--dim); stroke-width: 0.8; }
        .fsm-fig .fsm-cell.turn { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 1.6; }
        .fsm-fig .fsm-nose { fill: var(--inset); }
        .fsm-fig .fsm-hot { fill: var(--orange); }
        .fsm-fig .fsm-note { color: var(--dim); font-size: 0.82rem; }
      `}</style>
      <svg viewBox="0 0 420 290" role="img" aria-label={`The robot is in state ${state}. Front ${last.front.toFixed(2)} feet, right ${last.right.toFixed(1)} feet. ${m.hyst ? "Two thresholds for the front, 1.5 and 3.0 feet." : "One threshold for the front, 1.5 feet."} The state has changed ${m.changes} time${m.changes === 1 ? "" : "s"}.`}>
        <defs>
          <marker id="fsm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
          <marker id="fsm-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fsm-hot" />
          </marker>
        </defs>
        <text x="4" y="12" className="fig-label dim">STATES AND TRANSITIONS (one test per scan)</text>
        {TRANSITIONS.map((t) => (
          <path key={t.id} d={t.d} className={`fig-wire ${t.id === last.fired ? "hot" : ""}`} markerEnd={`url(#${t.id === last.fired ? "fsm-arrow-hot" : "fsm-arrow"})`} />
        ))}
        <text x="209" y="34" textAnchor="middle" className="fig-label">right &lt; {WALL_NEAR.toFixed(1)}</text>
        <text x="209" y="68" textAnchor="middle" className="fig-label">right &gt; {WALL_LOST.toFixed(1)}</text>
        <text x="54" y="100" className="fig-label">front &lt; {FRONT_BLOCKED.toFixed(1)}</text>
        <text x="54" y="111" className="fig-label dim">tested first</text>
        <text x="368" y="100" textAnchor="end" className="fig-label">front &lt; {FRONT_BLOCKED.toFixed(1)}</text>
        <text x="368" y="111" textAnchor="end" className="fig-label dim">tested first</text>
        <text x="273" y="87" textAnchor="middle" className={m.hyst ? "fig-label" : "fig-value small"}>front &gt; {clear.toFixed(1)}</text>
        {NODES.map((n) => (
          <g key={n.s}>
            <rect x={n.x} y={n.y} width="100" height="38" rx="8" className={`fig-box ${state === n.s ? "hot" : ""}`} />
            <text x={n.x + 50} y={n.y + 12.5} textAnchor="middle" className="fig-label fsm-name">{n.s}{state === n.s ? " ◀" : ""}</text>
            <text x={n.x + 50} y={n.y + 23.5} textAnchor="middle" className="fig-label dim">{n.action}</text>
            <text x={n.x + 50} y={n.y + 34.5} textAnchor="middle" className={`fig-label ${state === n.s ? "" : "dim"}`}>{n.led} {state === n.s ? "on" : "off"}</text>
          </g>
        ))}

        {/* the robot seen from above */}
        <text x="4" y="182" className="fig-label dim">SEEN FROM ABOVE (feet)</text>
        <line x1={RX - 30} x2={wallLost ? RX + 76 : wallX} y1={wallY} y2={wallY} className="fsm-wall" />
        <line x1={wallX} x2={wallX} y1={wallY} y2={RY + 8} className={`fsm-wall ${wallLost ? "lost" : ""}`} />
        <line x1={RX} x2={RX} y1={RY - 7} y2={wallY + 3} className="fig-sample" />
        <line x1={RX + 7} x2={wallX - 3} y1={RY} y2={RY} className="fig-sample" />
        <circle cx={RX} cy={RY} r="6" className="fsm-robot" />
        <path d={`M${RX - 3.5} ${RY + 1} L${RX} ${RY - 5} L${RX + 3.5} ${RY + 1} Z`} className="fsm-nose" />
        <text x="4" y={RY + 21} className="fig-label">front <tspan className="fig-value small">{last.front.toFixed(2)}</tspan>{"  "}right <tspan className="fig-value small">{last.right.toFixed(1)}</tspan>{wallLost ? " (no wall)" : ""}</text>

        {/* history of the front reading */}
        <text x={CX0} y="182" className="fig-label dim">FRONT, LAST {KEEP} SCANS</text>
        <text x={CX1} y="182" textAnchor="end" className="fig-label">state changes: <tspan className="fig-value small">{m.changes}</tspan></text>
        <rect x={CX0} y={CY0 - 6} width={CX1 - CX0} height={CY1 - CY0 + 10} className="fsm-plot" />
        {m.hyst && <rect x={CX0} y={cy(FRONT_CLEAR)} width={CX1 - CX0} height={cy(FRONT_BLOCKED) - cy(FRONT_CLEAR)} className="fsm-gap" />}
        <line x1={CX0} x2={CX1} y1={cy(FRONT_BLOCKED)} y2={cy(FRONT_BLOCKED)} className="fsm-thr" />
        <text x={CX0 - 3} y={cy(FRONT_BLOCKED) + 3} textAnchor="end" className="fig-value small">1.5</text>
        {m.hyst && (
          <>
            <line x1={CX0} x2={CX1} y1={cy(FRONT_CLEAR)} y2={cy(FRONT_CLEAR)} className="fsm-thr" />
            <text x={CX0 - 3} y={cy(FRONT_CLEAR) + 3} textAnchor="end" className="fig-value small">3.0</text>
            <text x={CX1 - 4} y={(cy(FRONT_CLEAR) + cy(FRONT_BLOCKED)) / 2 + 3} textAnchor="end" className="fig-label dim">gap: keep the state</text>
          </>
        )}
        <path d={line} className="fig-trace" />
        {m.scans.map((s, k) => (
          <g key={k}>
            <circle cx={cx(k)} cy={cy(s.front)} r="2.4" className="fig-dot" />
            <rect x={cx(k) - 9} y={CY1 + 8} width="18" height="15" rx="3" className={`fsm-cell ${s.state === "TURN_LEFT" ? "turn" : ""}`} />
            <text x={cx(k)} y={CY1 + 19} textAnchor="middle" className="fig-label">{LETTER[s.state]}</text>
          </g>
        ))}
        <text x={CX0 - 3} y={CY1 + 19} textAnchor="end" className="fig-label dim">state</text>
      </svg>
      <div className="fig-step" role="status">
        <p>
          <strong>Scan {m.n}.</strong> {why}
          {verdict}
        </p>
        <CodePre><code>{fired ? `case ${fired.from}:\n    ${fired.code(m.hyst).replace(/ \{ /g, " {\n        ").replace(/ \}/g, "\n    }").replace("}\n    else", "} else")}` : `case ${state}:\n    // no condition is true: state stays ${state}`}</code></CodePre>
      </div>
      <div className="fig-controls">
        <div>
          <span>Front</span>
          <input type="range" min={0.5} max={5} step={0.05} value={last.front} aria-label="Front distance in feet" onChange={(e) => setFront(+e.target.value)} />
          <output>{last.front.toFixed(2)} ft</output>
        </div>
        <div>
          <span>Right</span>
          <input type="range" min={0.5} max={6} step={0.1} value={last.right} aria-label="Distance to the right in feet" onChange={(e) => setRight(+e.target.value)} />
          <output>{last.right.toFixed(1)} ft</output>
        </div>
        <div>
          <span>End of turn</span>
          <button className="fig-opt" aria-pressed={m.hyst} onClick={() => setHyst(true)}>two thresholds</button>
          <button className="fig-opt" aria-pressed={!m.hyst} onClick={() => setHyst(false)}>one threshold</button>
          <code>{m.hyst ? "case TURN_LEFT: if (front_ft > FRONT_CLEAR)" : "case TURN_LEFT: if (front_ft > FRONT_BLOCKED)"}</code>
        </div>
      </div>
      <div className="fig-controls">
        <div>
          <span>Noisy wall</span>
          <button className="btn small primary" onClick={noisyStep} disabled={noisyDone} aria-label="Next scan of the noisy wall">Next</button>
          <button className="btn small" onClick={() => setM(start(m.hyst))} disabled={m.n === 1 && !playing}>Reset</button>
          <span className="fsm-note">{playing ? `scan ${m.noisy} of ${NOISY.length}` : `${NOISY.length} scans`}: front {NOISY.join(", ")} ft, starting in FOLLOW</span>
        </div>
      </div>
      <figcaption>
        In the row of letters under the plot, S is straight, T turn left and F follow; the newest scan is on the right. Each scan (each slider move, or Next) makes at most one transition. With one threshold, a front reading that moves around 1.5 ft changes the state on every scan. A second, higher threshold for leaving the turn stops that.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "state-machine",
  title: "Wall-follower state machine",
  description: "Move the front and right distances or play a run to see which state the robot is in and which condition makes it change.",
  Component: StateMachine,
};
