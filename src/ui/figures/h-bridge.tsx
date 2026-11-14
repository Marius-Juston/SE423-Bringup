// The H-bridge and the course's way of driving it (Lab 3, exercise 2;
// src/sim/plugins/actuators.ts): one PWM signal on the amplifier's
// direction input. Pin high closes one diagonal, pin low the other, so
// 50 % duty is zero average voltage, 100 % full voltage one way and 0 %
// full voltage the other way. The command is the power in percent of the
// chapter 10 levels (setMotor1 / setMotor2), p = -100..100, saturated and
// mapped to CMPA = (p + 100) x TBPRD / 200 with TBPRD = 2500 (20 kHz; TRM
// 15.4.3, 15.5). It is not the course's control effort of -10..10: the
// functions for that scale are a graded exercise of Lab 3, so the figure
// does not show their line. EPWM1A is the left motor, where a duty cycle
// above 50 % drives the robot forward; the right motor is mounted
// mirrored, so it gets the opposite command, setMotor2(-p). In PWM mode the
// drawing shows one half of the period at a time (never all four switches
// closed: that would be shoot-through).
import { useState } from "react";
import { CodePre } from "../CopyButton";

const TBPRD = 2500;
const CSS = `
.hbr input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--accent); }
.hbr-sw { cursor: pointer; fill: transparent; }
.hbr-num { font-family: var(--mono); color: var(--value); min-width: 2.8em; text-align: right; font-size: 0.85rem; }
.hbr pre { margin: 0.3rem 0 0; font-size: 0.78rem; background: var(--surface); border-radius: 6px; padding: 0.4rem 0.6rem; overflow-x: auto; }
`;

const LX = 120;
const RX = 240;
const CX = 180;
const TOP = 22;
const MID = 95;
const BOT = 168;

interface Paint {
  c: string;
  w: number;
}
const IDLE: Paint = { c: "var(--dim)", w: 1.4 };

function Head({ x, y, deg, c }: { x: number; y: number; deg: number; c: string }) {
  return <path d="M-4.5,-4 L4.5,0 L-4.5,4 Z" fill={c} transform={`translate(${x} ${y}) rotate(${deg})`} />;
}

function HBridge() {
  const [pwm, setPwm] = useState(false);
  const [sw, setSw] = useState([true, false, false, true]);
  const [u, setU] = useState(50);
  const [high, setHigh] = useState(true);
  const [s1, s2, s3, s4] = pwm ? [high, !high, !high, high] : sw;
  const toggle = (i: number) => {
    setPwm(false);
    setSw(sw.map((v, k) => (k === i ? !v : v)));
  };

  // u is the power in percent.
  const us = Math.max(-100, Math.min(100, u));
  const saturated = us !== u;
  const cmpa = Math.floor(((us + 100) * TBPRD) / 200);
  const duty = cmpa / TBPRD;
  const net = 2 * duty - 1;

  // Hand mode: what the four switches do.
  const shortL = !pwm && s1 && s2;
  const shortR = !pwm && s3 && s4;
  const short = shortL || shortR;
  const fwd = !pwm && !short && s1 && s4;
  const rev = !pwm && !short && s3 && s2;
  const brake = !pwm && !short && ((s1 && s3) || (s2 && s4));
  const dir = pwm ? Math.sign(net) : fwd ? 1 : rev ? -1 : 0;
  const mag = pwm ? Math.abs(net) : dir ? 1 : 0;

  const hi: Paint = { c: "var(--hi)", w: 2.8 };
  const lo: Paint = { c: "var(--lo)", w: 2.8 };
  // Which way the battery is connected across the motor in the state drawn.
  const flow = pwm ? (high ? 1 : -1) : fwd ? 1 : rev ? -1 : 0;
  const bad: Paint = { c: "var(--bad)", w: 3.4 };
  const P: Record<string, Paint> = { tl: IDLE, tr: IDLE, bl: IDLE, br: IDLE, s1: IDLE, s2: IDLE, s3: IDLE, s4: IDLE, m: IDLE };
  if (short) {
    if (shortL) P.tl = P.s1 = P.s2 = P.bl = bad;
    if (shortR) P.tr = P.s3 = P.s4 = P.br = bad;
  } else if (flow > 0) P.tl = P.s1 = P.s4 = P.br = P.m = hi;
  else if (flow < 0) P.tr = P.s3 = P.s2 = P.bl = P.m = lo;

  const leg = (x: number, y0: number, closed: boolean, p: Paint, inward: number) => {
    const a = y0 + 22;
    const b = a + 26;
    return (
      <g stroke={p.c} strokeWidth={p.w} fill="none" strokeLinecap="round">
        <path d={`M${x},${y0} V${a} M${x},${b} V${y0 + 73}`} />
        <path d={closed ? `M${x},${b} V${a}` : `M${x},${b} L${x + inward * 12},${a + 4}`} />
        <circle cx={x} cy={a} r="2" fill="var(--surface)" strokeWidth="1.2" />
        <circle cx={x} cy={b} r="2" fill="var(--surface)" strokeWidth="1.2" />
      </g>
    );
  };
  const line = (d: string, p: Paint) => <path d={d} stroke={p.c} strokeWidth={p.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;

  // Rotation arrow around the motor.
  const R = 25;
  const sweep = ((50 + 220 * mag) * Math.PI) / 180;
  const a0 = -Math.PI / 2 - (dir * sweep) / 2;
  const a1 = -Math.PI / 2 + (dir * sweep) / 2;
  const pt = (a: number) => `${(CX + R * Math.cos(a)).toFixed(1)},${(MID + R * Math.sin(a)).toFixed(1)}`;
  const arc = dir ? `M${pt(a0)} A${R},${R} 0 ${sweep > Math.PI ? 1 : 0} ${dir > 0 ? 1 : 0} ${pt(a1)}` : "";

  const nodeV = (up: boolean, down: boolean) => (up && down ? "shorted" : up ? "battery +" : down ? "ground" : "not connected");
  const state = pwm ? (net > 0 ? "forward" : net < 0 ? "backward" : "stopped") : short ? "SHORT CIRCUIT" : fwd ? "forward" : rev ? "backward" : brake ? "braking" : "coasting";
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, "")} %`;

  let why: string;
  if (pwm) {
    const first = saturated ? `p = ${u} is outside -100..100, so the function first cuts it back to ${us}. ` : "";
    why =
      net === 0
        ? `${first}p = 0 is a 50 % duty cycle: the motor gets full voltage forward and full voltage backward for equal times, 20 000 times a second. The average is zero and the motor stands still, although the pin is switching the whole time.`
        : `${first}Duty ${pct(duty)}: in every 50 µs period the pin is high for ${pct(duty)} (S1 and S4 closed, forward) and low for ${pct(1 - duty)} (S3 and S2 closed, backward). The motor feels the difference, ${net > 0 ? "+" : "-"}${pct(Math.abs(net))} of the battery voltage: ${Math.abs(net) === 1 ? "full power" : "part power"} ${net > 0 ? "forward" : "backward"}. The drawing shows the part with the pin ${high ? "high" : "low"}.`;
  } else if (short)
    why = `Shoot-through: ${shortL && shortR ? "S1 and S2 are closed together, and so are S3 and S4. Each pair connects the battery" : `${shortL ? "S1 and S2" : "S3 and S4"} are closed together, so the battery is connected`} straight to ground through two switches. Nothing limits that current: the transistors burn. The amplifier's logic never allows this state.`;
  else if (fwd) why = "S1 and S4 closed: current flows from the battery through S1, into terminal A, through the motor, out of B and through S4 to ground. The motor turns forward.";
  else if (rev) why = "S3 and S2 closed, the other diagonal: current enters the motor at B and leaves at A. Same battery, opposite voltage on the motor: it turns backward.";
  else if (brake) why = `Both motor terminals are tied to ${s1 && s3 ? "the battery" : "ground"}: no voltage across the motor, and its own generated current is short-circuited, which brakes it.`;
  else why = "No complete path from the battery through the motor to ground: no current, the motor coasts. Close one diagonal: S1 with S4, or S3 with S2.";

  const X0 = 64;
  const X1 = 300;
  const Y0 = 92;
  const Y1 = 18;
  const tx = (v: number) => X0 + ((v + 140) / 280) * (X1 - X0);
  const ty = (c: number) => Y0 - (c / TBPRD) * (Y0 - Y1);
  const names = ["S1", "S2", "S3", "S4"];

  return (
    <figure className="figure hbr" aria-label="Interactive H-bridge: four switches around a motor, and the course's PWM drive">
      <style>{CSS}</style>
      <svg viewBox={pwm ? "0 0 420 190" : "30 0 300 190"} role="img" aria-label={pwm ? `PWM drive, power ${u} percent, duty cycle ${pct(duty)}: motor ${state}. Drawn: the part of the period with the pin ${high ? "high, S1 and S4 closed" : "low, S3 and S2 closed"}.` : `Switches closed: ${names.filter((_, i) => sw[i]).join(", ") || "none"}. Motor ${state}.`}>
        <text x={CX} y="12" textAnchor="middle" className="fig-label">battery +</text>
        <text x={CX} y="184" textAnchor="middle" className="fig-label">ground</text>
        {line(`M${CX},${TOP} H${LX}`, P.tl)}
        {line(`M${CX},${TOP} H${RX}`, P.tr)}
        {line(`M${CX},${BOT} H${LX}`, P.bl)}
        {line(`M${CX},${BOT} H${RX}`, P.br)}
        {leg(LX, TOP, s1, P.s1, 1)}
        {leg(LX, MID, s2, P.s2, 1)}
        {leg(RX, TOP, s3, P.s3, -1)}
        {leg(RX, MID, s4, P.s4, -1)}
        {line(`M${LX},${MID} H${CX - 18} M${CX + 18},${MID} H${RX}`, P.m)}
        {flow !== 0 && (
          <>
            <Head x={flow > 0 ? LX + 22 : LX + 16} y={MID} deg={flow > 0 ? 0 : 180} c={P.m.c} />
            <Head x={flow > 0 ? RX - 16 : RX - 22} y={MID} deg={flow > 0 ? 0 : 180} c={P.m.c} />
          </>
        )}
        {(flow > 0 || shortL) && <Head x={LX} y={TOP + 14} deg={90} c={P.s1.c} />}
        {(flow > 0 || shortR) && <Head x={RX} y={BOT - 8} deg={90} c={P.s4.c} />}
        {(flow < 0 || shortR) && <Head x={RX} y={TOP + 14} deg={90} c={P.s3.c} />}
        {(flow < 0 || shortL) && <Head x={LX} y={BOT - 8} deg={90} c={P.s2.c} />}
        <circle cx={LX} cy={MID} r="2.6" className="fig-dot" />
        <circle cx={RX} cy={MID} r="2.6" className="fig-dot" />
        <circle cx={CX} cy={MID} r="18" className="fig-box" />
        <text x={CX} y={MID + 4} textAnchor="middle" className="fig-label" style={{ fontSize: 12, fontWeight: 700 }}>M</text>
        {arc && (
          <>
            <path d={arc} fill="none" stroke="var(--value)" strokeWidth="2" />
            <Head x={CX + R * Math.cos(a1)} y={MID + R * Math.sin(a1)} deg={(a1 * 180) / Math.PI + dir * 90} c="var(--value)" />
          </>
        )}
        <text x={CX} y={MID + 44} textAnchor="middle" className="fig-value small" style={short ? { fill: "var(--bad)" } : undefined}>{short ? "! short circuit" : state}</text>
        {names.map((n, i) => {
          const x = i < 2 ? LX : RX;
          const y = (i % 2 ? MID : TOP) + 22;
          return (
            <g key={n}>
              <text x={i < 2 ? x - 9 : x + 9} y={y + 11} textAnchor={i < 2 ? "end" : "start"} className="fig-label" style={{ fontWeight: 700 }}>{n}</text>
              <text x={i < 2 ? x - 9 : x + 9} y={y + 22} textAnchor={i < 2 ? "end" : "start"} className="fig-label dim">{[s1, s2, s3, s4][i] ? "closed" : "open"}</text>
              {!pwm && <rect x={x - 40} y={y - 8} width="80" height="42" className="hbr-sw" onClick={() => toggle(i)}><title>Click to open or close {n}</title></rect>}
            </g>
          );
        })}
        {!pwm && (
          <>
            <text x={LX - 8} y={MID + 3} textAnchor="end" className="fig-label">A: {nodeV(s1, s2)}</text>
            <text x={RX + 8} y={MID + 3} className="fig-label">B: {nodeV(s3, s4)}</text>
          </>
        )}
        {pwm && (
          <g>
            <text x="318" y="34" className="fig-label">pin high {pct(duty)}</text>
            <rect x="318" y="38" width="96" height="7" rx="2" className="fig-box" />
            <rect x="318" y="38" width={96 * duty} height="7" rx="2" fill="var(--hi)" />
            <text x="318" y="56" className="fig-label dim">S1 + S4: forward</text>
            <text x="318" y="78" className="fig-label">pin low {pct(1 - duty)}</text>
            <rect x="318" y="82" width="96" height="7" rx="2" className="fig-box" />
            <rect x="318" y="82" width={96 * (1 - duty)} height="7" rx="2" fill="var(--lo)" />
            <text x="318" y="100" className="fig-label dim">S3 + S2: backward</text>
            <text x="318" y="126" className="fig-label">average on the motor</text>
            <text x="318" y="140" className="fig-value">{net > 0 ? "+" : net < 0 ? "-" : ""}{pct(Math.abs(net))}</text>
            <text x="318" y="151" className="fig-label dim">of the battery voltage</text>
          </g>
        )}
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Drive it</span>
          <button className="fig-opt" aria-pressed={!pwm} onClick={() => setPwm(false)}>switches by hand</button>
          <button className="fig-opt" aria-pressed={pwm} onClick={() => setPwm(true)}>one PWM pin, as on the robot</button>
        </div>
        {!pwm ? (
          <div>
            <span>Switches</span>
            {names.map((n, i) => (
              <button key={n} className="fig-opt" aria-pressed={sw[i]} onClick={() => toggle(i)}>{n} {sw[i] ? "closed" : "open"}</button>
            ))}
          </div>
        ) : (
          <div>
            <span>Draw</span>
            <button className="fig-opt" aria-pressed={high} onClick={() => setHigh(true)}>pin high, {pct(duty)} of the time</button>
            <button className="fig-opt" aria-pressed={!high} onClick={() => setHigh(false)}>pin low, {pct(1 - duty)}</button>
          </div>
        )}
      </div>
      {pwm && (
        <>
          <svg viewBox="0 -4 420 120" role="img" aria-label={`Transfer line of setMotor1: power ${u} percent gives CMPA ${cmpa}, duty cycle ${pct(duty)}.`}>
            <rect x={X0} y={Y1} width={tx(-100) - X0} height={Y0 - Y1} fill="var(--bad)" fillOpacity="0.1" />
            <rect x={tx(100)} y={Y1} width={X1 - tx(100)} height={Y0 - Y1} fill="var(--bad)" fillOpacity="0.1" />
            <text x={X0 + 4} y={Y1 + 12} className="fig-label dim">saturated</text>
            <text x={X1 - 4} y={Y0 - 8} textAnchor="end" className="fig-label dim">saturated</text>
            {[0, 1250, 2500].map((c, i) => (
              <g key={c}>
                <line x1={X0 - 6} x2={X1} y1={ty(c)} y2={ty(c)} stroke="var(--border)" />
                <text x={X0 - 8} y={ty(c) + 3} textAnchor="end" className="fig-label">{c}</text>
                <text x={X1 + 5} y={ty(c) + 3} className="fig-label dim">{["0 %: full backward", "50 %: stopped", "100 %: full forward"][i]}</text>
              </g>
            ))}
            <text x="4" y={Y1 - 9} className="fig-label dim">CMPA</text>
            {[-100, 0, 100].map((v) => (
              <g key={v}>
                <line x1={tx(v)} x2={tx(v)} y1={Y0} y2={Y0 + 3} className="fig-wire" />
                <text x={tx(v)} y={Y0 + 13} textAnchor="middle" className="fig-label">{v}</text>
              </g>
            ))}
            <text x={X1} y={Y0 + 13} textAnchor="end" className="fig-label dim">p</text>
            <path d={`M${X0},${ty(0)} H${tx(-100)} L${tx(100)},${ty(TBPRD)} H${X1}`} className="fig-trace data" strokeLinejoin="round" />
            <line x1={tx(u)} x2={tx(u)} y1={Y0} y2={ty(cmpa)} className="fig-sample" />
            <line x1={X0} x2={tx(u)} y1={ty(cmpa)} y2={ty(cmpa)} className="fig-sample" />
            <circle cx={tx(u)} cy={ty(cmpa)} r="4" fill="var(--accent)" stroke="var(--text)" strokeWidth="1" />
          </svg>
          <div className="fig-controls">
            <div>
              <span>Power p</span>
              <input type="range" min={-140} max={140} step={5} value={u} aria-label="Power p in percent" onChange={(e) => setU(+e.target.value)} />
              <span className="hbr-num">{u}</span>
              <button className="fig-opt" onClick={() => setU(0)}>stop (0)</button>
            </div>
          </div>
          <CodePre><code>{`setMotor1(${u});${saturated ? `   // saturated to ${us}` : ""}\n// -100 is 0 % duty, 0 is 50 %, +100 is 100 %,\n// on a straight line in between: here ${pct(duty)}`}</code></CodePre>
        </>
      )}
      <figcaption>
        {pwm
          ? "The robot's amplifier takes one PWM signal as its direction input and works the four switches itself, one diagonal at a time. The duty cycle is a signed command centred on 50 %: a stopped motor is a pin switching at exactly half. The right motor is mounted mirrored, so it gets the opposite command: setMotor2(-p)."
          : "Four switches connect the motor to the battery either way round. The two diagonals are the two directions. Two closed switches in the same leg short the battery: the one state that must never happen."}
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "h-bridge",
  title: "H-bridge",
  description: "Close the four switches around a motor by hand to see forward, backward, braking and the forbidden short, then drive it with one PWM signal as the robot does.",
  Component: HBridge,
};
