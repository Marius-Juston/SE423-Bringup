import type { Board } from "../../sim/board";
import type { PinChange } from "../../sim/periph/gpio";
import { epwmPins } from "../../sim/plugins/epwm";
import type { Epwm } from "../../sim/plugins/epwm";
import type { BenchView, ViewProps } from "./types";

// Frequency and duty cycle are measured from the pin's edges, the way a
// scope would, so they show what the pin does, whatever the registers say
// (src/sim/plugins/epwm.ts drives the pins; TRM chapter 15).

/** What the course boards connect to a PWM pin. */
const USE: Record<number, string> = { 0: "left motor", 2: "right motor", 14: "RC servo 1", 15: "RC servo 2", 16: "buzzer", 22: "LED1" };
/** Edges looked at, counted back from the time shown. */
const TAIL = 48;

interface Row {
  name: string;
  pin: number;
  tr: PinChange[];
}

/** ePWM outputs whose pin has switched, on the pin the mux gives them. */
function outputs(board: Board): Row[] {
  const epwm = board.plugins.get("epwm") as Epwm | undefined;
  if (!epwm) return [];
  const rows: Row[] = [];
  for (const m of epwm.mods) {
    if (m.mode === 3) continue;
    for (const out of [0, 1] as const)
      for (const { pin, mux } of epwmPins(m.n, out)) {
        const tr = board.gpio.trace.get(pin);
        if (tr && tr.length > 2 && board.gpio.mux(pin) === mux) rows.push({ name: `EPWM${m.n}${out ? "B" : "A"}`, pin, tr });
      }
  }
  return rows;
}

/** Frequency and duty over whole periods (rising edge to rising edge) before time t, ns. */
function measure(tr: PinChange[], t: number): { hz: number; duty: number; level: number } {
  // Last change at or before t.
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  if (tr[lo].t > t) return { hz: 0, duty: 0, level: 0 };
  const level = tr[lo].level;
  const rises: number[] = [];
  for (let i = lo; i > 0 && i > lo - TAIL; i--) if (tr[i].level === 1 && tr[i - 1].level === 0) rises.push(i);
  if (rises.length < 2) return { hz: 0, duty: level, level };
  const a = rises[rises.length - 1];
  const b = rises[0];
  const first = tr[a].t;
  const last = tr[b].t;
  const period = (last - first) / (rises.length - 1);
  // The signal has stopped: only the level is left.
  if (t - tr[lo].t > 2 * period) return { hz: 0, duty: level, level };
  let high = 0;
  for (let i = a; i < b; i++) if (tr[i].level === 1) high += tr[i + 1].t - tr[i].t;
  return { hz: 1e9 / period, duty: Math.max(0, Math.min(1, high / (last - first))), level };
}

const hz = (f: number) => (f >= 1e6 ? `${(f / 1e6).toFixed(2)} MHz` : f >= 1e3 ? `${(f / 1e3).toFixed(2)} kHz` : `${f.toFixed(1)} Hz`);

/** Every running ePWM output with its measured frequency and duty cycle. */
function PwmMonitor({ board, window: [, to] }: ViewProps) {
  const rows = outputs(board);
  if (!rows.length) return <p className="hint-text">PWM outputs appear here once a pin is switched over to its ePWM module.</p>;
  const W = 400;
  const H = 34;
  return (
    <div className="plots">
      {rows.map((r) => {
        const m = measure(r.tr, to * 1e6);
        const pct = m.duty * 100;
        const text = m.hz ? `${hz(m.hz)}, high ${pct.toFixed(1)} % of the time` : `not switching, steady ${m.level ? "high" : "low"}`;
        // Two periods at the measured duty, as a picture of the waveform.
        const X0 = 150;
        const P = 44;
        let wave = `M${X0},26`;
        if (m.hz) for (let k = 0; k < 2; k++) wave += ` V10 H${X0 + k * P + m.duty * P} V26 H${X0 + (k + 1) * P}`;
        else wave = `M${X0},${m.level ? 10 : 26} H${X0 + 2 * P}`;
        return (
          <svg key={r.name + r.pin} className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${r.name} on GPIO${r.pin}: ${text}`}>
            <text x={6} y={14} style={{ fill: "var(--text)" }}>{r.name}</text>
            <text x={6} y={27}>GPIO{r.pin}{USE[r.pin] ? ` · ${USE[r.pin]}` : ""}</text>
            <path d={wave} fill="none" stroke="var(--hi)" strokeWidth={1.5} strokeLinejoin="round" />
            <rect x={250} y={6} width={144} height={9} rx={2} fill="var(--surface)" stroke="var(--border)" />
            <rect x={250} y={6} width={144 * m.duty} height={9} rx={2} fill="var(--hi)" />
            <line x1={322} x2={322} y1={4} y2={17} stroke="var(--dim)" strokeDasharray="2 2" />
            <text x={250} y={28} style={{ fill: "var(--value)" }}>{m.hz ? hz(m.hz) : `steady ${m.level ? "high" : "low"}`}</text>
            <text x={394} y={28} textAnchor="end" style={{ fill: "var(--text)" }}>{pct.toFixed(1)} % high</text>
          </svg>
        );
      })}
    </div>
  );
}

export const view: BenchView = {
  id: "pwm-monitor",
  title: "PWM outputs",
  order: 40,
  relevant: (board) => outputs(board).length > 0,
  Component: PwmMonitor,
};
