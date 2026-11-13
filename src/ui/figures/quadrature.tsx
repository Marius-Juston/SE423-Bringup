import { useRef, useState } from "react";

// Quadrature encoder: two sensors a quarter of a slit period apart.
// TRM chapter 17 (eQEP): 17.4.1 "Position Counter Input Modes" and Table 17-2
// (quadrature decoder truth table): in quadrature count mode (QDECCTL.QSRC = 0)
// every edge of QEPA and QEPB counts, up when A leads B. The state order and
// the starting position (middle of state 00) are those of src/sim/plugins/eqep.ts.

const SLITS = 8; // drawn; the robot's disc has 500
const QDEG = 360 / SLITS / 4; // one quarter of a slit period, degrees
const CX = 70;
const CY = 86;
const MIN = -40;
const MAX = 40;
const STATES = ["00", "10", "11", "01"];
const mod = (a: number, m: number) => ((a % m) + m) % m;
/** Channel levels at shaft position p (in quarter periods). A leads B when p grows. */
const levelA = (p: number) => (mod(p, 4) >= 1 && mod(p, 4) < 3 ? 1 : 0);
const levelB = (p: number) => (mod(p, 4) >= 2 ? 1 : 0);
type Mode = 1 | 2 | 4;
const countOf = (p: number, m: Mode) => (m === 4 ? Math.floor(p) : m === 2 ? Math.floor((p + 1) / 2) : Math.floor((p + 3) / 4));

const pol = (r: number, deg: number) => `${(CX + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)},${(CY + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
const sector = (r1: number, r2: number, a0: number, a1: number) => `M${pol(r1, a0)} A${r1},${r1} 0 0 1 ${pol(r1, a1)} L${pol(r2, a1)} A${r2},${r2} 0 0 0 ${pol(r2, a0)} Z`;
/** Screen angle of a fixed place given in quarter periods (sensor B sits at 0, sensor A at -1). */
const place = (s: number) => -90 + (s + 0.5) * QDEG;

function Quadrature() {
  const [st, setSt] = useState({ pos: 0.5, aEdges: 0, dir: 0 });
  const [mode, setMode] = useState<Mode>(4);
  const [oneChannel, setOneChannel] = useState(false);
  const drag = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { pos, dir } = st;

  const moveTo = (target: number) =>
    setSt((s) => {
      const p = Math.max(MIN, Math.min(MAX, target));
      if (p === s.pos) return s;
      return { pos: p, aEdges: s.aEdges + Math.abs(countOf(p, 2) - countOf(s.pos, 2)), dir: Math.sign(p - s.pos) };
    });
  const angleAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const k = 420 / r.width;
    return (Math.atan2((e.clientY - r.top) * k - CY, (e.clientX - r.left) * k - CX) * 180) / Math.PI;
  };

  const a = levelA(pos);
  const b = levelB(pos);
  const q = mod(Math.floor(pos), 4);
  const count = countOf(pos, mode) - countOf(0.5, mode);
  // Edges of A, forward minus backward: what a counter that knew the direction would show.
  const netA = countOf(pos, 2) - countOf(0.5, 2);
  const col = (lv: number) => (lv ? "var(--orange)" : "var(--arches)");

  // Waveforms against shaft angle: the sensors are at the centre line.
  const X0 = 156;
  const XC = 284;
  const PX = 16;
  const HALF = 8;
  const xOf = (p: number) => XC + (p - pos) * PX;
  const wave = (level: (p: number) => number, top: number) => {
    const y = (lv: number) => top + (lv ? 0 : 20);
    let d = `M${X0},${y(level(pos - HALF))}`;
    for (let n = Math.ceil(pos - HALF); n <= Math.floor(pos + HALF); n++) {
      if (level(n - 0.5) !== level(n + 0.5)) d += ` H${xOf(n).toFixed(1)} V${y(level(n + 0.5))}`;
    }
    return `${d} H${XC + HALF * PX}`;
  };
  const marks: { x: number; y: number }[] = [];
  for (let n = Math.ceil(pos - HALF + 0.3); n <= Math.floor(pos + HALF - 0.3); n++) {
    const onA = mod(n, 2) === 1;
    const counted = oneChannel ? onA : mode === 4 || (mode === 2 && onA) || (mode === 1 && mod(n, 4) === 1);
    if (counted) marks.push({ x: xOf(n), y: onA ? 34 : 76 });
  }

  const nodes = [
    { x: 196, y: 126 },
    { x: 232, y: 152 },
    { x: 196, y: 178 },
    { x: 160, y: 152 },
  ];

  const why = oneChannel
    ? `Sensor B is covered. Channel A gives the same square wave whichever way you turn, so all a counter can do is add: ${st.aEdges} edge${st.aEdges === 1 ? "" : "s"} of A counted so far. Counted forward minus backward, the shaft is really ${netA} edge${Math.abs(netA) === 1 ? "" : "s"} from the start. ${st.aEdges === Math.abs(netA) ? "Turn back and forth and watch the two numbers part." : "The two numbers differ: the direction is lost, so the position is lost."}`
    : dir === 0
      ? "Light through a slit makes a sensor's output high. The two sensors are a quarter of a slit period apart, so A and B never change at the same moment. Turn the disc: drag it, step it or move the slider."
      : `Turning ${dir > 0 ? "forward" : "backward"}: ${dir > 0 ? "A changes first and B follows (A leads B)" : "B changes first and A follows (B leads A)"}, so the state walks ${dir > 0 ? "clockwise" : "counter-clockwise"} round the circle and every step counts ${dir > 0 ? "+1" : "-1"}. Now A B = ${STATES[q]}.`;

  return (
    <figure className="figure qd-fig" aria-label="Interactive quadrature encoder: disc, channels A and B, state sequence and count">
      <style>{`.qd-fig .qd-disc{cursor:grab;touch-action:none}.qd-fig .qd-range{flex:1;min-width:120px;accent-color:var(--orange)}.qd-fig .qd-hole{fill:var(--inset);stroke:var(--dim);stroke-width:.6}.qd-fig .qd-off{stroke-dasharray:3 3;opacity:.55}`}</style>
      <svg ref={svg} viewBox="0 0 420 200" role="img" aria-label={`Channel A is ${a ? "high" : "low"}, channel B is ${oneChannel ? "covered" : b ? "high" : "low"}. ${dir > 0 ? "Last turned forward. " : dir < 0 ? "Last turned backward. " : ""}${oneChannel ? `${st.aEdges} edges of A counted, true position ${netA} edges` : `Count ${count} with x${mode} decoding`}.`}>
        {/* disc */}
        <g
          className="qd-disc"
          onPointerDown={(e) => {
            drag.current = angleAt(e);
            (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const now = angleAt(e);
            let d = now - drag.current;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            drag.current = now;
            moveTo(pos + d / QDEG);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <circle cx={CX} cy={CY} r={58} className="fig-box" />
          {Array.from({ length: SLITS }, (_, k) => (
            <path key={k} d={sector(40, 54, place(4 * k + pos), place(4 * k + 2 + pos))} className="qd-hole" />
          ))}
          <circle cx={CX} cy={CY} r={7} className="qd-hole" />
          <path d={`M${pol(12, place(pos) + 180)} L${pol(32, place(pos) + 180)}`} className="fig-wire thick" />
        </g>
        {/* sensors */}
        {[
          { s: -1, lv: a, name: "A", dim: false },
          { s: 0, lv: b, name: "B", dim: oneChannel },
        ].map(({ s, lv, name, dim }) => {
          const [x, y] = pol(47, place(s)).split(",").map(Number);
          const [lx, ly] = pol(70, place(s * 2.4 + 0.7)).split(",").map(Number);
          return (
            <g key={name} opacity={dim ? 0.4 : 1}>
              <circle cx={x} cy={y} r={4} fill={dim ? "var(--dim)" : col(lv)} stroke="var(--text)" strokeWidth={0.8} />
              <line x1={x} y1={y - 4} x2={lx} y2={ly + 3} className="fig-wire" />
              <text x={lx} y={ly} textAnchor="middle" className="fig-label">{name}</text>
            </g>
          );
        })}
        <text x={CX} y={160} textAnchor="middle" className="fig-label dim">drag the disc to turn it</text>
        <text x={CX} y={172} textAnchor="middle" className="fig-label dim">{SLITS} slits here, 500 on the robot</text>

        {/* waveforms */}
        <text x={150} y={36} textAnchor="end" className="fig-label">A</text>
        <text x={150} y={78} textAnchor="end" className="fig-label" opacity={oneChannel ? 0.4 : 1}>B</text>
        <path d={wave(levelA, 22)} className="fig-trace" />
        <path d={wave(levelB, 64)} className={`fig-trace ${oneChannel ? "dim qd-off" : "data"}`} />
        {marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y - 2} r={2.6} fill="var(--harvest)" stroke="var(--inset)" strokeWidth={0.8} />
        ))}
        <line x1={XC} x2={XC} y1={12} y2={92} className="fig-sample" />
        <text x={XC} y={10} textAnchor="middle" className="fig-label dim">now</text>
        <circle cx={XC} cy={a ? 22 : 42} r={3.4} fill={col(a)} stroke="var(--text)" strokeWidth={0.8} />
        {!oneChannel && <circle cx={XC} cy={b ? 64 : 84} r={3.4} fill={col(b)} stroke="var(--text)" strokeWidth={0.8} />}
        <text x={X0} y={102} className="fig-label dim">← backward</text>
        <text x={XC + HALF * PX} y={102} textAnchor="end" className="fig-label dim">forward →</text>
        <text x={XC} y={102} textAnchor="middle" className="fig-label dim">dots: counted edges</text>

        {/* the four states */}
        <g opacity={oneChannel ? 0.35 : 1}>
          <circle cx={196} cy={152} r={30} className="fig-wire" strokeDasharray="2 3" />
          <text x={196} y={dir === 0 ? 143 : 150} textAnchor="middle" className="fig-label dim">A B</text>
          {dir === 0 ? (
            <>
              <text x={196} y={155} textAnchor="middle" className="fig-label">↻ +1</text>
              <text x={196} y={167} textAnchor="middle" className="fig-label">↺ -1</text>
            </>
          ) : (
            <text x={196} y={161} textAnchor="middle" className="fig-label" style={{ fill: "var(--harvest)" }}>{dir > 0 ? "↻ +1" : "↺ -1"}</text>
          )}
          {nodes.map((n, i) => (
            <g key={i}>
              <rect x={n.x - 14} y={n.y - 9} width={28} height={18} rx={4} className={`fig-box ${i === q && !oneChannel ? "hot" : ""}`} />
              <text x={n.x} y={n.y + 4} textAnchor="middle" className="fig-value">{STATES[i]}</text>
            </g>
          ))}
        </g>

        {/* counts */}
        {oneChannel ? (
          <g>
            <text x={262} y={128} className="fig-label">A alone: edges counted</text>
            <text x={262} y={148} className="fig-value" style={{ fontSize: 16 }}>{st.aEdges}</text>
            <text x={262} y={166} className="fig-label dim">true position: forward minus backward</text>
            <text x={262} y={180} className="fig-value">{netA}</text>
            <text x={262 + 8 * String(netA).length + 4} y={180} className="fig-label dim">edges of A</text>
          </g>
        ) : (
          <g>
            <text x={262} y={124} className="fig-label dim">count</text>
            <text x={412} y={124} textAnchor="end" className="fig-label dim">per motor turn</text>
            {([4, 2, 1] as Mode[]).map((m, i) => (
              <g key={m} opacity={m === mode ? 1 : 0.55}>
                {m === mode && <rect x={256} y={130 + i * 22} width={160} height={19} rx={4} className="fig-box hot" />}
                <text x={262} y={143 + i * 22} className="fig-label">x{m}</text>
                <text x={330} y={144 + i * 22} textAnchor="end" className="fig-value">{countOf(pos, m) - countOf(0.5, m)}</text>
                <text x={412} y={143 + i * 22} textAnchor="end" className="fig-label">500 x {m} = {500 * m}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div className="fig-why" role="status">{why}</div>
      <div className="fig-controls">
        <div>
          <span>Turn</span>
          <button className="fig-opt" disabled={pos <= MIN} onClick={() => moveTo(Math.floor(pos) - 0.5)}>Back</button>
          <button className="fig-opt" disabled={pos >= MAX} onClick={() => moveTo(Math.floor(pos) + 1.5)}>Step</button>
          <button className="fig-opt" disabled={pos === 0.5 && st.aEdges === 0 && dir === 0} onClick={() => setSt({ pos: 0.5, aEdges: 0, dir: 0 })}>Reset</button>
          <input className="qd-range" type="range" aria-label="Shaft angle" min={MIN} max={MAX} step={0.05} value={pos} onChange={(e) => moveTo(+e.target.value)} />
        </div>
        <div>
          <span>Count</span>
          <button className="fig-opt" aria-pressed={mode === 1} onClick={() => setMode(1)}>x1: one edge of A</button>
          <button className="fig-opt" aria-pressed={mode === 2} onClick={() => setMode(2)}>x2: both edges of A</button>
          <button className="fig-opt" aria-pressed={mode === 4} onClick={() => setMode(4)}>x4: every edge of A and B</button>
        </div>
        <div>
          <span>Sensors</span>
          <button className="fig-opt" aria-pressed={!oneChannel} onClick={() => setOneChannel(false)}>A and B</button>
          <button className="fig-opt" aria-pressed={oneChannel} onClick={() => setOneChannel(true)}>cover B: one channel only</button>
        </div>
      </div>
      <div className="fig-step">
        <pre><code>{oneChannel ? "// One channel: a counter cannot tell forward from\n// backward. The eQEP needs both QEPA and QEPB\n// for quadrature count mode (QSRC = 0)." : mode === 4 ? "// x4: every edge of A and B\nEQep1Regs.QDECCTL.bit.QSRC = 0;\n// the count so far\nint32_t raw = EQep1Regs.QPOSCNT;" : `// x${mode}: what simpler decoders do, with\n// ${mode === 2 ? "half" : "a quarter of"} the resolution. The eQEP's\n// quadrature count (QSRC = 0) is always x4.`}</code></pre>
      </div>
      <figcaption>The same disc read with one sensor or two. With two, the order of the edges gives the direction, and counting all four edges of a slit period gives 4 x 500 = 2000 counts per motor turn. Each step of Back or Step is one edge, a quarter of a slit period.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "quadrature",
  title: "Quadrature encoder",
  description: "Turn an encoder disc and watch the two sensor signals, the direction they reveal and the count in x1, x2 and x4 mode.",
  Component: Quadrature,
};
