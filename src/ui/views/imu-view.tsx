import type { BenchView, ViewProps } from "./types";

// What the MPU-9250 is feeling right now: the acceleration vector (signal
// bus inputs IMU_AX_G, IMU_AY_G, IMU_AZ_G, in g) and the turn rate about Z
// (IMU_GZ_DPS, degrees per second; positive = counter-clockwise seen from
// above, the right-hand rule about an upward Z axis). Next to it, what the
// program has worked out, when it uses the course's variable names.

const CSS = `
.iv-svg { width: 100%; display: block; background: var(--inset); border: 1px solid var(--border); border-radius: 6px; }
.iv-ring { fill: none; stroke: var(--border-strong); stroke-width: 1; }
.iv-ring.g1 { stroke-dasharray: 3 3; }
.iv-txt { fill: var(--text); font-size: 10px; font-family: var(--sans); }
.iv-txt.dim { fill: var(--dim); }
.iv-num { fill: var(--value); font-size: 11px; font-family: var(--mono); font-weight: 700; }
.iv-vars { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin: 0.3rem 0 0; font-family: var(--mono); font-size: 0.82rem; }
.iv-vars dt { color: var(--dim); display: inline; }
.iv-vars dd { display: inline; margin: 0 0 0 0.3rem; color: var(--value); font-weight: 700; }
`;

const NAMES = ["IMU_AX_G", "IMU_AY_G", "IMU_AZ_G", "IMU_GX_DPS", "IMU_GY_DPS", "IMU_GZ_DPS"];
const VARS = ["gyrox", "gyroy", "gyroz", "gyrox_raw", "gyroz_raw", "accelx", "accely", "accelz", "heading", "roll", "pitch", "bias"];

/** A program value: whole numbers as they are, others with three decimals, no "-0.000". */
const show = (v: number) => {
  if (!Number.isFinite(v)) return "not a number";
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(3);
  return /^-0\.0+$/.test(s) ? s.slice(1) : s;
};

function ImuView({ board }: ViewProps) {
  const inp = (n: string, d: number) => {
    const v = board.inputs.get(n);
    return v !== undefined && Number.isFinite(v) ? v : d;
  };
  const ax = inp("IMU_AX_G", 0);
  const ay = inp("IMU_AY_G", 0);
  const az = inp("IMU_AZ_G", 1);
  const gz = inp("IMU_GZ_DPS", 0);
  // The picture is a top view, so it only draws the turn about Z; a turn
  // about X or Y (tipping the board) is given in words when there is one.
  const gx = inp("IMU_GX_DPS", 0);
  const gy = inp("IMU_GY_DPS", 0);
  const tipping = gx !== 0 || gy !== 0 ? `Turn rate about X ${gx.toFixed(1)} deg/s, about Y ${gy.toFixed(1)} deg/s.` : "";
  const G = 24; // px per g
  const CX = 72;
  const CY = 76;
  const clampLen = (x: number, y: number) => {
    const l = Math.hypot(x, y);
    return l > 2.1 ? [(x / l) * 2.1, (y / l) * 2.1] : [x, y];
  };
  const [vx, vy] = clampLen(ax, ay);
  // X to the right, Y up the screen.
  const tipX = CX + vx * G;
  const tipY = CY - vy * G;
  const len = Math.hypot(tipX - CX, tipY - CY);
  const head = len > 4 ? `M${tipX},${tipY} L${tipX - ((tipX - CX) / len) * 7 + ((tipY - CY) / len) * 4},${tipY - ((tipY - CY) / len) * 7 - ((tipX - CX) / len) * 4} L${tipX - ((tipX - CX) / len) * 7 - ((tipY - CY) / len) * 4},${tipY - ((tipY - CY) / len) * 7 + ((tipX - CX) / len) * 4} Z` : "";
  // Z bar
  const ZX = 162;
  const zy = (g: number) => CY - Math.max(-2, Math.min(2, g)) * G;
  // Gyro dial: the arc sweeps up to 150 degrees for 250 deg/s.
  const DX = 300;
  const R = 44;
  const sweep = (Math.max(-250, Math.min(250, gz)) / 250) * 150;
  const pt = (deg: number, r = R) => [DX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)];
  // Positive rate = counter-clockwise = towards the left on screen.
  const end = -sweep;
  const [ex, ey] = pt(end);
  const [sx, sy] = pt(0);
  const arc = Math.abs(sweep) > 1 ? `M${sx},${sy} A${R},${R} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 0 : 1} ${ex},${ey}` : "";
  const dir = sweep > 0 ? -1 : 1;
  const [h1x, h1y] = pt(end - dir * 9, R + 6);
  const [h2x, h2y] = pt(end - dir * 9, R - 6);
  const turning = Math.abs(gz) < 0.5 ? "not turning" : gz > 0 ? "turning left (counter-clockwise)" : "turning right (clockwise)";
  const vars = VARS.map((n) => [n, board.readVar(n)] as const).filter(([, v]) => v !== undefined);
  return (
    <div>
      <style>{CSS}</style>
      <svg className="iv-svg" viewBox="0 0 400 152" role="img" aria-label={`What the MPU-9250 measures now. Acceleration X ${ax.toFixed(2)} g, Y ${ay.toFixed(2)} g, Z ${az.toFixed(2)} g. Turn rate about Z ${gz.toFixed(1)} degrees per second, ${turning}. ${tipping}`}>
        <text x={8} y={13} className="iv-txt dim">X and Y, from above</text>
        <circle cx={CX} cy={CY} r={2 * G} className="iv-ring" />
        <circle cx={CX} cy={CY} r={G} className="iv-ring g1" />
        <line x1={CX - 2 * G} x2={CX + 2 * G} y1={CY} y2={CY} className="iv-ring" />
        <line x1={CX} x2={CX} y1={CY - 2 * G} y2={CY + 2 * G} className="iv-ring" />
        <text x={CX + 2 * G + 3} y={CY + 3} className="iv-txt dim">X</text>
        <text x={CX + 3} y={CY - 2 * G - 3} className="iv-txt dim">Y</text>
        <text x={CX + G + 2} y={CY + 11} className="iv-txt dim">1 g</text>
        <line x1={CX} y1={CY} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth={2.5} />
        {head ? <path d={head} fill="var(--accent)" /> : <circle cx={CX} cy={CY} r={3.5} fill="var(--accent)" />}
        <text x={8} y={134} className="iv-num">X {ax.toFixed(2)} g</text>
        <text x={8} y={146} className="iv-num">Y {ay.toFixed(2)} g</text>
        {/* Z */}
        <text x={ZX} y={13} textAnchor="middle" className="iv-txt dim">Z (up)</text>
        <line x1={ZX} x2={ZX} y1={zy(2)} y2={zy(-2)} className="iv-ring" />
        {[-2, -1, 0, 1, 2].map((g) => (
          <g key={g}>
            <line x1={ZX - 4} x2={ZX + 4} y1={zy(g)} y2={zy(g)} className="iv-ring" />
            <text x={ZX + 8} y={zy(g) + 3} className="iv-txt dim">{g}</text>
          </g>
        ))}
        <line x1={ZX} x2={ZX} y1={zy(0)} y2={zy(az)} stroke={az >= 0 ? "var(--hi)" : "var(--lo)"} strokeWidth={6} />
        <text x={ZX} y={146} textAnchor="middle" className="iv-num">Z {az.toFixed(2)} g</text>
        {/* gyro */}
        <text x={DX} y={13} textAnchor="middle" className="iv-txt dim">turn rate about Z (gyro)</text>
        <circle cx={DX} cy={CY} r={R} className="iv-ring" />
        <line x1={DX} x2={DX} y1={CY - R - 5} y2={CY - R + 5} className="iv-ring" />
        <rect x={DX - 14} y={CY - 20} width={28} height={40} rx={4} fill="var(--surface)" stroke="var(--dim)" transform={`rotate(${end / 3} ${DX} ${CY})`} />
        <path d={`M${DX},${CY - 14} l-5,8 h10 z`} fill="var(--dim)" transform={`rotate(${end / 3} ${DX} ${CY})`} />
        {arc && <path d={arc} fill="none" stroke={gz > 0 ? "var(--hi)" : "var(--lo)"} strokeWidth={5} />}
        {arc && <path d={`M${ex},${ey} L${h1x},${h1y} L${h2x},${h2y} Z`} fill={gz > 0 ? "var(--hi)" : "var(--lo)"} transform={`rotate(${-dir * 9} ${DX} ${CY})`} />}
        <text x={DX} y={146} textAnchor="middle" className="iv-num">{gz >= 0 ? "+" : ""}{gz.toFixed(1)} deg/s</text>
        <text x={DX} y={134} textAnchor="middle" className="iv-txt">{turning}</text>
      </svg>
      {tipping && <p className="hint-text">{tipping}</p>}
      {vars.length > 0 && (
        <dl className="iv-vars" aria-label="What the program has computed">
          {vars.map(([n, v]) => (
            <div key={n}>
              <dt>{n}</dt>
              <dd>{show(v as number)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export const view: BenchView = {
  id: "imu-view",
  title: "What the MPU-9250 feels",
  order: 45,
  relevant: (board) => NAMES.some((n) => board.inputsUsed.has(n)),
  Component: ImuView,
};
