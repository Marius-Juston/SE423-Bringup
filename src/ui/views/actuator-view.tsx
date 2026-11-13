import { useEffect, useState, type ReactElement } from "react";
import { buzz, hush, playTones, setSoundOn, soundOn } from "../sound";
import type { Board } from "../../sim/board";
import type { BenchView, ViewProps } from "./types";

// The RC servos and the buzzer (src/sim/plugins/actuators.ts), drawn from
// the values the world model publishes: SERVOx_DEG (0.8 ms pulse = -90
// degrees, 1.6 ms = 0, 2.4 ms = +90) and BUZZER_HZ (0 when silent). The two
// drive wheels have their own view, wheels.tsx.
type Trace = { t: number; v: number }[];

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

/** Value of a trace at time t (ns): the last entry at or before t. */
function at(tr: Trace | undefined, t: number): number | undefined {
  if (!tr || !tr.length || tr[0].t > t) return undefined;
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return tr[lo].v;
}

function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

const CELL = 132;
const H = 104;

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
  const side = Math.abs(deg) < 0.05 ? "centre" : deg > 0 ? "left of centre" : "right of centre";
  return (
    <g role="img" aria-label={`${label}: ${deg.toFixed(1)} degrees, ${side}`}>
      <text x={cx} y={11} textAnchor="middle" style={{ fill: "var(--text)" }}>{label}</text>
      <rect x={cx - 22} y={cy - 5} width={44} height={22} rx={4} fill="var(--surface)" stroke="var(--dim)" />
      <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} fill="none" stroke="var(--dim)" strokeDasharray="2 3" />
      {[-90, -45, 0, 45, 90].map((d) => {
        const [ax, ay] = tip(d, R);
        const [bx, by] = tip(d, R + 4);
        return <line key={d} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--dim)" />;
      })}
      <text x={cx - R - 6} y={cy + 3} textAnchor="end">+90</text>
      <text x={cx + R + 6} y={cy + 3}>-90</text>
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="var(--accent)" strokeWidth={5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="var(--surface)" stroke="var(--text)" />
      <text x={cx} y={88} textAnchor="middle" style={{ fill: "var(--value)" }}>{deg.toFixed(1)}°</text>
      <text x={cx} y={100} textAnchor="middle">{side}</text>
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
      <text x={cx} y={100} textAnchor="middle">{on ? `note ${noteName(hz)}` : "no tone now"}</text>
    </g>
  );
}

/** Makes the buzzer audible: live while the program runs, or replayed after a test run. */
function BuzzerSound({ board, hz, live, nowMs }: { board: ViewProps["board"]; hz: number; live: boolean; nowMs: number }) {
  const [on, setOn] = useState(soundOn);
  const [playing, setPlaying] = useState<{ stop: () => void } | null>(null);
  // Called again on every frame of a live run, so the tone follows the pin
  // and fades by itself when the run pauses or stops.
  useEffect(() => {
    if (live && on) buzz(hz);
  }, [live, on, hz, nowMs]);
  useEffect(() => () => hush(), []);
  useEffect(() => () => playing?.stop(), [playing]);
  const history = board.outputs.get("BUZZER_HZ") ?? [];
  const heard = history.some((h) => h.v >= 20);
  return (
    <div className="fig-controls" style={{ justifyContent: "center" }}>
      <button
        className="fig-opt"
        aria-pressed={on}
        onClick={() => {
          setSoundOn(!on);
          setOn(!on);
        }}
      >
        {on ? "Sound on" : "Sound off"}
      </button>
      {!live && heard && (
        <button
          className="fig-opt"
          onClick={() => {
            if (playing) return playing.stop();
            const p = playTones(history, board.now, () => setPlaying(null));
            setPlaying(p);
          }}
        >
          {playing ? "Stop" : "Play what the buzzer did"}
        </button>
      )}
      <span className="hint-text">{live ? (on ? "You hear the buzzer while the program runs." : "The buzzer is muted.") : heard ? "Replays the tones of this run through your speakers." : "The buzzer was silent in this run."}</span>
    </div>
  );
}

/** Servo arms and the buzzer, as the PWM pins are driving them at the time shown. */
function ActuatorView({ board, window: [, to], live, nowMs }: ViewProps) {
  const t = to * 1e6;
  const cells: ReactElement[] = [];
  let buzzerHz: number | null = null;
  for (const [name, label] of SERVOS) {
    const deg = at(board.outputs.get(name), t);
    if (deg !== undefined && Number.isFinite(deg)) cells.push(<Servo key={name} label={label} deg={deg} />);
  }
  if (moved(board, "BUZZER_HZ")) {
    const hz = at(board.outputs.get("BUZZER_HZ"), t) ?? 0;
    buzzerHz = Number.isFinite(hz) ? hz : 0;
    cells.push(<Buzzer key="buzzer" hz={buzzerHz} />);
  }
  if (!cells.length) return <p className="hint-text">Servos and the buzzer appear here once their PWM pin drives them.</p>;
  const cols = Math.min(3, cells.length);
  const rows = Math.ceil(cells.length / cols);
  return (
    <>
    <svg className="scope" viewBox={`0 0 ${cols * CELL} ${rows * H}`} style={{ maxWidth: `${cols * 9}rem`, margin: "0 auto" }} role="group" aria-label="Servos and buzzer driven by the PWM pins">
      {cells.map((c, i) => (
        <g key={c.key} transform={`translate(${(i % cols) * CELL} ${Math.floor(i / cols) * H})`}>{c}</g>
      ))}
    </svg>
    {buzzerHz !== null && <BuzzerSound board={board} hz={buzzerHz} live={live} nowMs={nowMs} />}
    </>
  );
}

export const view: BenchView = {
  id: "actuator-view",
  title: "Servos and buzzer",
  order: 45,
  relevant: (board) => SERVOS.some(([n]) => board.outputs.has(n)) || moved(board, "BUZZER_HZ"),
  Component: ActuatorView,
};
