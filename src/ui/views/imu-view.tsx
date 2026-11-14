import type { BenchView, ViewProps } from "./types";
import { IMU_INPUTS, type SpiDevicesState } from "../../sim/plugins/spi_devices";

// The MPU-9250 beside a running program: what the chip feels (the bench
// knobs or, in the robot world, the robot's own motion), what its last
// sample says (a real part adds an offset and noise), and how it is set up.
// One sentence says where the numbers come from. Axes: X to the right and Y
// up the screen in the top view, Z out of the board; a positive turn rate
// about Z is counter-clockwise seen from above (the right-hand rule).
// Next to it, what the program has worked out, when it uses the course's
// variable names. The view only reads the model's state: it never makes a
// sample itself.

const CSS = `
.iv-svg { width: 100%; display: block; background: var(--inset); border: 1px solid var(--border); border-radius: 6px; }
.iv-ring { fill: none; stroke: var(--border-strong); stroke-width: 1; }
.iv-ring.g1 { stroke-dasharray: 3 3; }
.iv-txt { fill: var(--text); font-size: 11.5px; font-family: var(--sans); }
.iv-txt.dim { fill: var(--dim); }
.iv-num { fill: var(--value); font-size: 12px; font-family: var(--mono); font-weight: 700; }
.iv-src { margin: 0 0 0.4rem; font-size: 0.9rem; color: var(--text); }
.iv-src b { color: var(--value); font-weight: 700; }
.iv-table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 0; font-size: 0.85rem; }
.iv-table th { text-align: left; color: var(--dim); font-weight: 400; padding: 0.1rem 0.3rem 0.1rem 0; }
.iv-table td { font-family: var(--mono); color: var(--value); font-weight: 700; text-align: right; padding: 0.1rem 0.3rem; white-space: nowrap; }
.iv-table thead th { border-bottom: 1px solid var(--border); text-align: right; }
.iv-table thead th:first-child { text-align: left; }
.iv-table td.unit { color: var(--dim); font-weight: 400; text-align: left; font-family: var(--sans); }
.iv-cfg { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--dim); }
.iv-vars { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin: 0.3rem 0 0; font-family: var(--mono); font-size: 0.82rem; }
.iv-vars dt { color: var(--dim); display: inline; }
.iv-vars dd { display: inline; margin: 0 0 0 0.3rem; color: var(--value); font-weight: 700; }
`;

/** Rows of the table: index into the model's arrays, name, unit, decimals. */
const ROWS: [number, string, string, number][] = [
  [0, "Acceleration X", "g", 3],
  [1, "Acceleration Y", "g", 3],
  [2, "Acceleration Z", "g", 3],
  [4, "Turn rate about X", "deg/s", 1],
  [5, "Turn rate about Y", "deg/s", 1],
  [6, "Turn rate about Z", "deg/s", 1],
];
/** No "-0.0". */
const fix = (v: number, d: number) => {
  const t = v.toFixed(d);
  return /^-0\.?0*$/.test(t) ? t.slice(1) : t;
};
const VARS = ["gyrox", "gyroy", "gyroz", "gyrox_raw", "gyroz_raw", "accelx", "accely", "accelz", "heading", "roll", "pitch", "rollrate", "bias"];

/** A program value: whole numbers as they are, others with three decimals, no "-0.000". */
const show = (v: number) => {
  if (!Number.isFinite(v)) return "not a number";
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(3);
  return /^-0\.0+$/.test(s) ? s.slice(1) : s;
};

function ImuView({ board }: ViewProps) {
  const dev = board.plugins.get("spi_devices") as SpiDevicesState | undefined;
  const imu = dev?.imu;
  const feels = imu?.feels ?? [0, 0, 1, 25, 0, 0, 0];
  const [ax, ay, az, , gx, gy, gz] = feels;
  // The picture is a top view, so it only draws the turn about Z; a turn
  // about X or Y (tipping the board) is given in words when there is one.
  const tipping = gx !== 0 || gy !== 0 ? `Turn rate about X ${gx.toFixed(1)} deg/s, about Y ${gy.toFixed(1)} deg/s.` : "";
  const byRobot = imu?.source === "robot";
  const real = (board.inputs.get("IMU_REAL") ?? 0) !== 0;
  const regs = dev?.mpuRegs;
  const gRange = 250 << (((regs?.[0x1b] ?? 0) >> 3) & 3);
  const aRange = 2 << (((regs?.[0x1c] ?? 0) >> 3) & 3);
  const rate = imu?.rateHz ?? 8000;
  const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`);
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
      <p className="iv-src">
        {byRobot ? (
          <>
            <b>The robot's motion</b> sets turn rate Z (how fast it turns), acceleration X (speeding up, slowing down) and acceleration Y (going round a bend). The other axes follow their knobs.
          </>
        ) : (
          <>
            <b>The bench knobs</b> set what the chip feels: move the IMU sliders beside the board's LEDs and buttons. The robot is not driving in a room here, so nothing else moves the chip.
          </>
        )}
        {imu?.asleep ? " The chip is asleep: it measures nothing and its registers keep the last sample." : real ? " This is a real part: every sample has a small offset and noise." : ""}
      </p>
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
      <table className="iv-table">
        <thead>
          <tr>
            <th scope="col">Axis</th>
            <th scope="col">Feels</th>
            <th scope="col">Last sample</th>
            <th scope="col" aria-label="Unit" />
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([i, name, unit, d]) => (
            <tr key={i}>
              <th scope="row">{name}</th>
              <td>{fix(feels[i], d)}</td>
              <td>{fix(imu?.sample[i] ?? feels[i], d)}</td>
              <td className="unit">{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="iv-cfg">
        New sample {hz(rate)}. Filter: gyro {hz(imu?.gyroBwHz ?? 250)}, accelerometer {hz(imu?.accelBwHz ?? 460)}. Range: +-{gRange} deg/s, +-{aRange} g.
      </p>
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
  relevant: (board) => IMU_INPUTS.some((n) => board.inputsUsed.has(n)),
  Component: ImuView,
};
