import { useState } from "react";

// Polling a flag in while (1) against letting the hardware interrupt main.
// The interrupt latency quoted is the minimum of TRM 3.4.3 "Interrupt Entry
// Sequence": at least 14 SYSCLK cycles (70 ns at 200 MHz) from the flag being
// latched to the first instruction of the function, so "about 70 ns" here.
// A flag (TCR.TIF, TRM 3.8) is one bit: a second event before it is cleared
// is not counted. The polling loop is simulated past the 100 ms shown until
// every event has been seen, so the last delay is not understated.

const T_END = 100; // ms shown
const EVENTS = [12, 37, 62, 87]; // ms: the timer reaches zero every 25 ms
const HANDLE = 3; // ms the reaction itself takes

interface Block {
  from: number;
  to: number;
  kind: "work" | "react" | "ask";
}

function polling(work: number) {
  const blocks: Block[] = [];
  const late: { event: number; at: number }[] = [];
  const lost: number[] = [];
  let t = 0;
  let next = 0; // index of the first event the loop has not seen yet
  while (t < T_END || next < EVENTS.length) {
    // The check itself: has the flag been set since the last look?
    const pending = [];
    while (next < EVENTS.length && EVENTS[next] <= t) pending.push(EVENTS[next++]);
    if (pending.length) {
      // One flag bit: every event but one is gone.
      lost.push(...pending.slice(0, -1));
      late.push({ event: pending[pending.length - 1], at: t });
      blocks.push({ from: t, to: t + HANDLE, kind: "react" });
      t += HANDLE;
    }
    if (work > 0) {
      blocks.push({ from: t, to: t + work, kind: "work" });
      t += work;
    } else {
      const until = next < EVENTS.length ? EVENTS[next] : T_END;
      if (until > t) blocks.push({ from: t, to: until, kind: "ask" });
      t = Math.max(until, t + 0.001);
    }
  }
  return { blocks, late, lost };
}

function interrupted(work: number) {
  const main: Block[] = [];
  let t = 0;
  let e = 0;
  if (work <= 0) return main;
  while (t < T_END) {
    let left = work;
    while (left > 1e-9 && t < T_END) {
      if (e < EVENTS.length && EVENTS[e] <= t) {
        t = EVENTS[e++] + HANDLE; // main is paused while the function runs
        continue;
      }
      const stop = Math.min(t + left, e < EVENTS.length ? EVENTS[e] : Infinity);
      main.push({ from: t, to: stop, kind: "work" });
      left -= stop - t;
      t = stop;
    }
  }
  return main;
}

function PollingVsInterrupt() {
  const [work, setWork] = useState(16);
  const { blocks, late, lost } = polling(work);
  const main = interrupted(work);
  const delays = late.map((l) => l.at - l.event);
  const worst = delays.length ? Math.max(...delays) : 0;
  const shown = blocks.filter((b) => b.from < T_END);

  const X0 = 40;
  const X1 = 412;
  const x = (t: number) => X0 + (Math.min(t, T_END) / T_END) * (X1 - X0);
  const w = (b: Block) => Math.max(0.5, x(b.to) - x(b.from));

  const why =
    work === 0
      ? "With nothing else in the loop, polling reacts at once. But the CPU does nothing except ask, millions of times a second. Give main some work with the slider."
      : lost.length
        ? `One pass of main now takes ${work} ms of work plus the ${HANDLE} ms reaction, longer than the 25 ms between events. The flag was set a second time before main looked, so ${lost.length} event${lost.length > 1 ? "s were" : " was"} lost: a flag is one bit and cannot count. The interrupt still reacts to all ${EVENTS.length}, each about 70 ns after the event.`
        : delays.every((d) => d < 0.5)
          ? `With ${work} ms of work every event happens to land just as main reaches the check, so polling is on time here. That is luck: move the slider and the delay can be as long as one whole pass of the loop. With an interrupt the function starts about 70 ns after the event, whatever main is doing.`
        : `Polling sees an event only when main reaches the check again: ${delays.map((d) => d.toFixed(0)).join(", ")} ms late here. The delay is different each time and can be as long as one whole pass of the loop. With an interrupt the function starts about 70 ns after the event, whatever main is doing, and main continues ${HANDLE} ms later.`;

  return (
    <figure className="figure pvi-fig" aria-label="Interactive comparison of polling and interrupts on a timeline">
      <style>{`
        .pvi-fig .pvi-work { fill: var(--surface-2); stroke: var(--dim); stroke-width: 0.8; }
        .pvi-fig .pvi-react { fill: var(--orange); }
        .pvi-fig .pvi-ask { fill: none; stroke: var(--dim); stroke-width: 0.8; stroke-dasharray: 1.5 2.5; }
        .pvi-fig .pvi-late { stroke: var(--bad); stroke-width: 2; }
        .pvi-fig .pvi-latetext { fill: var(--bad); font-size: max(8.5px, calc(9px / var(--fig-k, 1))); font-weight: 700; font-family: var(--sans); }
        .pvi-fig .pvi-lost { fill: var(--bad); font-size: max(8.5px, calc(9px / var(--fig-k, 1))); font-weight: 700; font-family: var(--sans); }
        .pvi-fig .pvi-sum { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin: 0.5rem 0; }
        .pvi-fig .pvi-sum div { background: var(--surface); border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.82rem; color: var(--dim); }
        .pvi-fig .pvi-sum b { display: block; font-family: var(--mono); font-size: 1rem; color: var(--text); }
        .pvi-fig .pvi-sum code { display: block; margin-top: 0.2rem; font-size: 0.72rem; overflow-wrap: anywhere; }
        .pvi-fig input[type=range] { flex: 1 1 8rem; min-width: 6rem; accent-color: var(--orange); }
      `}</style>
      <svg viewBox="0 0 420 198" role="img" aria-label={`Four events, 25 milliseconds apart. Polling with ${work} milliseconds of other work per loop pass reacts up to ${worst.toFixed(0)} milliseconds late and loses ${lost.length} events. The interrupt reacts about 70 nanoseconds after each event.`}>
        {/* events */}
        <text x={4} y={10} className="fig-label">Events: the timer reaches zero every 25 ms</text>
        {EVENTS.map((e) => (
          <g key={e}>
            <path d={`M${x(e) - 4},15 h8 l-4,8 z`} fill="var(--harvest)" />
            <line x1={x(e)} x2={x(e)} y1={48} y2={90} className="fig-sample" />
            <line x1={x(e)} x2={x(e)} y1={114} y2={180} className="fig-sample" />
            {lost.includes(e) && <text x={x(e) + 7} y={23} className="pvi-lost">lost</text>}
          </g>
        ))}
        {/* polling */}
        <text x={4} y={40} className="fig-label">Polling: main asks "has it happened?" once per loop pass</text>
        <text x={4} y={62} className="fig-label dim">main</text>
        {shown.map((b, i) =>
          b.kind === "ask" ? (
            <g key={i}>
              <rect x={x(b.from)} y={50} width={w(b)} height={18} className="pvi-ask" />
              {w(b) > 44 && <text x={x(b.from) + w(b) / 2} y={62} textAnchor="middle" className="fig-label dim">asking...</text>}
            </g>
          ) : (
            <g key={i}>
              <rect x={x(b.from)} y={50} width={w(b)} height={18} rx={b.kind === "work" ? 2 : 0} className={b.kind === "work" ? "pvi-work" : "pvi-react"} />
              {b.kind === "work" && w(b) > 26 && <text x={x(b.from) + w(b) / 2} y={62} textAnchor="middle" className="fig-label">work</text>}
            </g>
          ),
        )}
        {late.map((l, i) => {
          const d = l.at - l.event;
          if (d < 0.5) return null;
          return (
            <g key={i}>
              <line x1={x(l.event)} x2={x(l.at)} y1={74} y2={74} className="pvi-late" />
              <text x={x(l.event) > 330 ? x(l.at) : x(l.event) + 3} y={86} textAnchor={x(l.event) > 330 ? "end" : "start"} className="pvi-latetext">{d.toFixed(0)} ms{i === 0 ? " late" : ""}</text>
            </g>
          );
        })}
        {/* interrupt */}
        <text x={4} y={106} className="fig-label">Interrupt: the hardware calls the function, main pauses</text>
        <text x={4} y={127} className="fig-label dim">function</text>
        <text x={4} y={158} className="fig-label dim">main</text>
        {EVENTS.map((e) => (
          <g key={e}>
            <rect x={x(e)} y={116} width={x(e + HANDLE) - x(e)} height={16} className="pvi-react" />
            <path d={`M${x(e)},146 V132 M${x(e + HANDLE)},132 V146`} className="fig-wire" />
          </g>
        ))}
        {work === 0 ? (
          <g>
            <rect x={x(0)} y={146} width={x(T_END) - x(0)} height={18} className="pvi-ask" />
            <text x={(X0 + X1) / 2} y={158} textAnchor="middle" className="fig-label dim">free for anything else</text>
          </g>
        ) : (
          main.map((b, i) => (
            <g key={i}>
              <rect x={x(b.from)} y={146} width={w(b)} height={18} rx={2} className="pvi-work" />
              {w(b) > 26 && <text x={x(b.from) + w(b) / 2} y={158} textAnchor="middle" className="fig-label">work</text>}
            </g>
          ))
        )}
        <text x={x(EVENTS[0]) + 3} y={176} className="pvi-latetext" style={{ fill: "var(--ok)" }}>70 ns late</text>
        {/* axis */}
        {[0, 25, 50, 75, 100].map((t) => (
          <text key={t} x={x(t)} y={195} textAnchor={t === 100 ? "end" : t === 0 ? "start" : "middle"} className="fig-label dim">{t} ms</text>
        ))}
        <line x1={X0} x2={X1} y1={184} y2={184} className="fig-wire" style={{ strokeWidth: 0.8 }} />
      </svg>
      <div className="pvi-sum">
        <div>Polling reacts<b>{work === 0 ? "at once" : worst < 0.5 ? "on time, by luck" : `up to ${worst.toFixed(0)} ms late`}</b>{lost.length ? `${lost.length} of ${EVENTS.length} events lost` : `all ${EVENTS.length} events seen`}<code>while (1) {"{"} if (flag) react(); work(); {"}"}</code></div>
        <div>Interrupt reacts<b>about 70 ns late</b>all {EVENTS.length} events seen<code>while (1) {"{"} work(); {"}"}</code></div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span id="pvi-w">main's work</span>
          <input type="range" min={0} max={40} step={2} value={work} aria-labelledby="pvi-w" aria-valuetext={`${work} milliseconds per loop pass`} onChange={(e) => setWork(+e.target.value)} />
          <strong>{work} ms per pass</strong>
        </div>
      </div>
      <figcaption>
        Orange blocks are the reaction to the event ({HANDLE} ms of code, the same in both rows). Blocks labelled "work" are everything else main has to do. Polling has to wait until main reaches the check again; an <code>__interrupt</code> function does not wait for main.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "polling-vs-interrupt",
  title: "Polling versus interrupts",
  description: "Give main more work per loop pass and compare how late it reacts to a timer event when it polls a flag and when an interrupt calls the function.",
  Component: PollingVsInterrupt,
};
