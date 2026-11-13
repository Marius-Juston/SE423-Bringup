import type { ReactElement } from "react";
import type { Board } from "../../sim/board";
import type { BenchView, ViewProps } from "./types";

// The things the PWM pins move (src/sim/plugins/actuators.ts): the two
// wheels, the RC servos and the buzzer, drawn from the values the world
// model publishes.
type Trace = { t: number; v: number }[];

const WHEELS: [string, string][] = [
  ["LEFT_WHEEL_RADPS", "Left wheel"],
  ["RIGHT_WHEEL_RADPS", "Right wheel"],
];
const SERVOS: [string, string][] = [
  ["SERVO1_DEG", "Servo 1 · EPWM8A"],
  ["SERVO2_DEG", "Servo 2 · EPWM8B"],
  ["SERVO3A_DEG", "Servo · EPWM3A"],
  ["SERVO3B_DEG", "Servo · EPWM3B"],
  ["SERVO5A_DEG", "Servo · EPWM5A"],
  ["SERVO5B_DEG", "Servo · EPWM5B"],
  ["SERVO6A_DEG", "Servo · EPWM6A"],
];
const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const moved = (board: Board, name: string) => (board.outputs.get(name)?.length ?? 0) > 1;

/** Where each wheel trace has been integrated to, so a frame only adds the new part. */
const turned = new WeakMap<Trace, { i: number; angle: number }>();

/** Speed at time t (ns) and the angle turned since the start, rad. */
function wheel(tr: Trace, t: number): { v: number; angle: number } {
  let s = turned.get(tr);
  if (!s || tr[s.i].t > t) turned.set(tr, (s = { i: 0, angle: 0 }));
  while (s.i + 1 < tr.length && tr[s.i + 1].t <= t) {
    s.angle += (tr[s.i].v * (tr[s.i + 1].t - tr[s.i].t)) / 1e9;
    s.i++;
  }
  const dt = Math.max(0, t - tr[s.i].t) / 1e9;
  return { v: tr[s.i].v, angle: s.angle + tr[s.i].v * dt };
}

function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

const CELL = 100;
const H = 104;

function Wheel({ label, v, angle }: { label: string; v: number; angle: number }) {
  const cx = CELL / 2;
  const cy = 46;
  const dir = Math.abs(v) < 0.005 ? 0 : Math.sign(v);
  const deg = (angle * 180) / Math.PI;
  // Arrow over the top of the wheel: forward turns clockwise in this view.
  const R = 31;
  const a0 = (-90 - dir * 38) * (Math.PI / 180);
  const a1 = (-90 + dir * 38) * (Math.PI / 180);
  const p = (a: number) => `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  return (
    <g role="img" aria-label={`${label}: ${v.toFixed(2)} radians per second, ${dir > 0 ? "forward" : dir < 0 ? "backward" : "stopped"}`}>
      <text x={cx} y={11} textAnchor="middle" style={{ fill: "var(--text)" }}>{label}</text>
      <circle cx={cx} cy={cy} r={23} fill="var(--surface)" stroke="var(--text)" strokeWidth={5} />
      <g transform={`rotate(${deg.toFixed(1)} ${cx} ${cy})`} stroke="var(--dim)" strokeWidth={2.5} strokeLinecap="round">
        {[0, 120, 240].map((s) => (
          <line key={s} x1={cx} y1={cy} x2={cx + 19 * Math.cos((s * Math.PI) / 180)} y2={cy + 19 * Math.sin((s * Math.PI) / 180)} />
        ))}
        <circle cx={cx + 19} cy={cy} r={2.5} fill="var(--value)" stroke="none" />
      </g>
      <circle cx={cx} cy={cy} r={3.5} fill="var(--text)" />
      {dir !== 0 && (
        <>
          <path d={`M${p(a0)} A${R},${R} 0 0 ${dir > 0 ? 1 : 0} ${p(a1)}`} fill="none" stroke={dir > 0 ? "var(--hi)" : "var(--lo)"} strokeWidth={2} />
          <path d="M-4,-4 L4,0 L-4,4 Z" fill={dir > 0 ? "var(--hi)" : "var(--lo)"} transform={`translate(${p(a1)}) rotate(${(a1 * 180) / Math.PI + dir * 90})`} />
        </>
      )}
      <text x={cx} y={88} textAnchor="middle" style={{ fill: "var(--value)" }}>{v.toFixed(2)} rad/s</text>
      <text x={cx} y={100} textAnchor="middle">{dir > 0 ? "forward" : dir < 0 ? "backward" : "stopped"}</text>
    </g>
  );
}

function Servo({ label, deg }: { label: string; deg: number }) {
  const cx = CELL / 2;
  const cy = 58;
  const R = 30;
  // 0 degrees points up, positive angles turn counter-clockwise.
  const tip = (d: number, r: number) => {
    const a = ((90 + d) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [hx, hy] = tip(deg, R - 5);
  return (
    <g role="img" aria-label={`${label}: ${deg.toFixed(1)} degrees`}>
      <text x={cx} y={11} textAnchor="middle" style={{ fill: "var(--text)" }}>{label}</text>
      <rect x={cx - 22} y={cy - 5} width={44} height={22} rx={4} fill="var(--surface)" stroke="var(--dim)" />
      <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} fill="none" stroke="var(--dim)" strokeDasharray="2 3" />
      {[-90, -45, 0, 45, 90].map((d) => {
        const [ax, ay] = tip(d, R);
        const [bx, by] = tip(d, R + 4);
        return <line key={d} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--dim)" />;
      })}
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="var(--accent)" strokeWidth={5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="var(--surface)" stroke="var(--text)" />
      <text x={cx} y={88} textAnchor="middle" style={{ fill: "var(--value)" }}>{deg.toFixed(1)}°</text>
      <text x={cx} y={100} textAnchor="middle">+90 left · -90 right</text>
    </g>
  );
}

function Buzzer({ hz }: { hz: number }) {
  const cx = CELL / 2;
  const on = hz > 0;
  return (
    <g role="img" aria-label={on ? `Buzzer: ${hz.toFixed(1)} hertz, note ${noteName(hz)}` : "Buzzer: silent"}>
      <text x={cx} y={11} textAnchor="middle" style={{ fill: "var(--text)" }}>Buzzer</text>
      <path d={`M${cx - 22},38 h9 l12,-11 v38 l-12,-11 h-9 Z`} fill={on ? "var(--accent-soft)" : "var(--surface)"} stroke={on ? "var(--hi)" : "var(--dim)"} strokeWidth={1.5} strokeLinejoin="round" />
      {on ? (
        [8, 15, 22].map((r) => <path key={r} d={`M${cx + 4 + r * 0.5},${46 - r} Q${cx + 4 + r * 1.2},46 ${cx + 4 + r * 0.5},${46 + r}`} fill="none" stroke="var(--hi)" strokeWidth={1.5} strokeLinecap="round" />)
      ) : (
        <path d={`M${cx + 8},39 l12,14 m0,-14 l-12,14`} stroke="var(--dim)" strokeWidth={1.5} strokeLinecap="round" />
      )}
      <text x={cx} y={88} textAnchor="middle" style={{ fill: "var(--value)" }}>{on ? `${hz.toFixed(1)} Hz` : "silent"}</text>
      <text x={cx} y={100} textAnchor="middle">{on ? `note ${noteName(hz)}` : "no tone"}</text>
    </g>
  );
}

/** Wheels, servo arms and the buzzer, as the PWM pins are driving them now. */
function ActuatorView({ board, window: [, to] }: ViewProps) {
  const t = to * 1e6;
  const cells: ReactElement[] = [];
  if (WHEELS.some(([n]) => moved(board, n)))
    for (const [name, label] of WHEELS) {
      const tr = board.outputs.get(name);
      if (tr?.length) cells.push(<Wheel key={name} label={label} {...wheel(tr, t)} />);
    }
  for (const [name, label] of SERVOS) {
    const deg = board.output(name, t);
    if (deg !== undefined) cells.push(<Servo key={name} label={label} deg={deg} />);
  }
  if (moved(board, "BUZZER_HZ")) cells.push(<Buzzer key="buzzer" hz={board.output("BUZZER_HZ", t) ?? 0} />);
  if (!cells.length) return <p className="hint-text">Motors, servos and the buzzer appear here once their PWM pin drives them.</p>;
  const cols = Math.min(4, cells.length);
  const rows = Math.ceil(cells.length / cols);
  return (
    <svg className="scope" viewBox={`0 0 ${cols * CELL} ${rows * H}`} style={{ maxWidth: `${cols * 9}rem`, margin: "0 auto" }} role="group" aria-label="Actuators driven by the PWM pins">
      {cells.map((c, i) => (
        <g key={c.key} transform={`translate(${(i % cols) * CELL} ${Math.floor(i / cols) * H})`}>{c}</g>
      ))}
    </svg>
  );
}

export const view: BenchView = {
  id: "actuator-view",
  title: "Motors, servos and buzzer",
  order: 45,
  relevant: (board) => WHEELS.some(([n]) => moved(board, n)) || SERVOS.some(([n]) => board.outputs.has(n)) || moved(board, "BUZZER_HZ"),
  Component: ActuatorView,
};
