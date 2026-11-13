import { useState } from "react";

// Why a circuit must be a closed loop (primer A). A battery, a switch, a
// lamp and the wire back. Current flows only when there is an unbroken path
// from the battery's + terminal, through the lamp, back to its - terminal.
// Wire colours follow the game's convention: orange = at the battery's +
// voltage, blue = at 0 V, dashed grey = connected to nothing (undefined).

const CSS = `
.cl-glow { fill: var(--orange); opacity: 0.25; }
.cl-lamp { fill: var(--surface); stroke: var(--text); stroke-width: 1.6; }
.cl-lamp.lit { fill: var(--orange); stroke: var(--orange); }
.cl-flow { fill: none; stroke: var(--harvest); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cl-batt { fill: var(--surface); stroke: var(--text); stroke-width: 1.4; }
`;

const HI = "var(--orange)";
const LO = "var(--arches)";
const FLOAT = "var(--dim)";

function ClosedLoop() {
  const [closed, setClosed] = useState(false);
  const [ret, setRet] = useState(true);
  const flows = closed && ret;
  // The stretch from the switch through the lamp down to the gap in the return wire.
  const mid = closed ? HI : ret ? LO : FLOAT;
  const midDash = !closed && !ret ? "3 2" : undefined;
  const why = flows
    ? "The loop is closed: there is an unbroken path from the battery's + end, through the switch and the lamp, back to its - end. Current flows all the way round and the lamp lights."
    : !closed && ret
      ? "The switch is open: the path is broken at the switch. No current flows anywhere in the loop, not even in the parts that are still connected, and the lamp is dark."
      : closed
        ? "The switch is closed, but the wire back to the battery is missing. Current has no way to return, so none flows at all. One wire is never enough: electricity needs a way out and a way back."
        : "The path is broken in two places. No current flows. The piece between the two gaps is connected to nothing.";
  const chev = (x: number, y: number, dir: "r" | "l" | "d" | "u") => {
    const d = dir === "r" ? `M${x - 3},${y - 4} l5,4 l-5,4` : dir === "l" ? `M${x + 3},${y - 4} l-5,4 l5,4` : dir === "d" ? `M${x - 4},${y - 3} l4,5 l4,-5` : `M${x - 4},${y + 3} l4,-5 l4,5`;
    return <path key={`${x}-${y}`} d={d} className="cl-flow" />;
  };
  return (
    <figure className="figure" aria-label="Interactive circuit: a battery, a switch and a lamp in a loop">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 170" role="img" aria-label={`Battery, switch and lamp. The switch is ${closed ? "closed" : "open"}. The return wire is ${ret ? "connected" : "removed"}. ${flows ? "Current flows around the loop and the lamp is lit." : "No current flows and the lamp is dark."}`}>
        {/* battery */}
        <line x1="60" y1="30" x2="60" y2="62" className="fig-wire thick" style={{ stroke: HI }} />
        <rect x="42" y="62" width="36" height="56" rx="4" className="cl-batt" />
        <rect x="53" y="56" width="14" height="6" className="cl-batt" />
        <text x="60" y="78" textAnchor="middle" className="fig-value">+</text>
        <text x="60" y="94" textAnchor="middle" className="fig-label">battery</text>
        <text x="60" y="112" textAnchor="middle" className="fig-value">-</text>
        <line x1="60" y1="118" x2="60" y2="150" className="fig-wire thick" style={{ stroke: LO }} />
        {/* top wire to the switch */}
        <line x1="60" y1="30" x2="150" y2="30" className="fig-wire thick" style={{ stroke: HI }} />
        <circle cx="150" cy="30" r="3" className="fig-dot" />
        <circle cx="190" cy="30" r="3" className="fig-dot" />
        <line x1="150" y1="30" x2={closed ? 190 : 186} y2={closed ? 30 : 12} className="fig-wire thick" />
        <text x="170" y="48" textAnchor="middle" className="fig-label">switch: {closed ? "closed" : "open"}</text>
        {/* switch to lamp */}
        <path d="M190,30 H320 V66" className="fig-wire thick" style={{ stroke: mid, strokeDasharray: midDash }} />
        {flows && <circle cx="320" cy="84" r="30" className="cl-glow" />}
        <circle cx="320" cy="84" r="18" className={`cl-lamp ${flows ? "lit" : ""}`} />
        <text x="346" y="80" className="fig-label">lamp</text>
        <text x="346" y="93" className="fig-value small" style={{ fill: flows ? "var(--orange)" : "var(--dim)" }}>{flows ? "LIT" : "dark"}</text>
        {/* return wire */}
        <path d={`M320,102 V150 H${ret ? 60 : 230}`} className="fig-wire thick" style={{ stroke: ret ? LO : mid, strokeDasharray: ret ? undefined : midDash }} />
        {!ret && <line x1="170" y1="150" x2="60" y2="150" className="fig-wire thick" style={{ stroke: LO }} />}
        {!ret && <text x="200" y="146" textAnchor="middle" className="fig-label">gap</text>}
        <text x="200" y="165" textAnchor="middle" className="fig-label dim">the wire back to the battery</text>
        {flows && (
          <>
            {[95, 125, 230, 270].map((x) => chev(x, 30, "r"))}
            {chev(320, 52, "d")}
            {chev(320, 128, "d")}
            {[270, 200, 130].map((x) => chev(x, 150, "l"))}
            {chev(60, 136, "u")}
            <text x="250" y="20" textAnchor="middle" className="fig-label">current</text>
          </>
        )}
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Switch</span>
          <button className="fig-opt" aria-pressed={!closed} onClick={() => setClosed(false)}>open</button>
          <button className="fig-opt" aria-pressed={closed} onClick={() => setClosed(true)}>closed</button>
        </div>
        <div>
          <span>Wire back</span>
          <button className="fig-opt" aria-pressed={ret} onClick={() => setRet(true)}>connected</button>
          <button className="fig-opt" aria-pressed={!ret} onClick={() => setRet(false)}>removed</button>
        </div>
      </div>
      <figcaption>Current flows only around a complete loop. Orange wire is at the battery's + voltage, blue wire is at 0 V, dashed grey is connected to nothing. Yellow arrows show the current.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "closed-loop",
  title: "A complete circuit",
  description: "Open and close the switch of a battery and lamp circuit to see that current flows only around a complete loop.",
  Component: ClosedLoop,
};
