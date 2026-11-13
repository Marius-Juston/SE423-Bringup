import { useState, type ReactNode } from "react";

// The path of one CPU Timer 0 interrupt request (PIE group 1, channel 7),
// exactly as TRM 3.4.3 "Interrupt Entry Sequence" (Figure 3-2) lists it:
//   1. latched in PIEIFRx.y           2. passes if PIEIERx.y is set
//   3. passes if PIEACK.x is clear, and PIEACK.x is SET
//   4. latched in IFR.x               5. passes if IER.x is set
//   6. the CPU receives it if INTM is clear
//   8-9. context saved; IFR.x and IER.x cleared, INTM set, EALLOW cleared
//   10. vector fetched from the PIE; PIEIFRx.y cleared   11. branch to the ISR
// Returning restores IER and INTM. Nothing clears PIEACK.x except the
// program writing 1 to it (TRM 3.4.4, PIEACK register). CPU timers 1 and 2
// are wired straight to INT13 and INT14 (TRM 3.4.2, Figure 3-1; 3.8,
// Figure 3-11) and do not pass the PIE. Enabling steps: TRM 3.4.4.1.

interface S {
  tie: boolean;
  pieier: boolean;
  ier: boolean;
  eint: boolean;
  vector: boolean;
  ackLine: boolean;
  pieifr: 0 | 1;
  pieack: 0 | 1;
  ifr: 0 | 1;
  runs: number;
  crashed: boolean;
  justRan: boolean;
  event: "" | "tie" | "lost";
}

const RESET: S = { tie: true, pieier: false, ier: false, eint: false, vector: false, ackLine: false, pieifr: 0, pieack: 0, ifr: 0, runs: 0, crashed: false, justRan: false, event: "" };

/** Lets pending requests move as far as the gates allow. */
function settle(s: S): S {
  const n = { ...s };
  // Steps 2-4: PIE stage.
  if (n.pieifr && n.pieier && !n.pieack) {
    n.pieack = 1;
    n.ifr = 1;
  }
  // Steps 5-11: CPU stage.
  if (n.ifr && n.ier && n.eint && !n.crashed) {
    n.ifr = 0;
    n.pieifr = 0;
    if (!n.vector) n.crashed = true;
    else {
      n.runs++;
      n.justRan = true;
      if (n.ackLine) n.pieack = 0;
    }
  }
  return n;
}

function fire(s: S): S {
  if (s.crashed) return s;
  const n: S = { ...s, justRan: false, event: "" };
  if (!n.tie) n.event = "tie";
  else if (n.pieifr) n.event = "lost";
  else n.pieifr = 1;
  return settle(n);
}

type Kind = "source" | "latch" | "gate" | "box";

function Symbol({ kind, value, pass }: { kind: Kind; value?: number; pass?: boolean }) {
  return (
    <svg viewBox="0 0 40 28" aria-hidden="true">
      {kind === "latch" && (
        <>
          <rect x={9} y={3} width={22} height={22} rx={3} fill="var(--inset)" />
          <rect x={9} y={3} width={22} height={22} rx={3} className={`fig-box ${value ? "hot" : ""}`} />
          <text x={20} y={18} textAnchor="middle" className="fig-value">{value}</text>
        </>
      )}
      {kind === "gate" &&
        (pass ? (
          <>
            <line x1={31} x2={31} y1={5} y2={23} className="ip-bar open" />
            <circle cx={31} cy={23} r={2.2} className="fig-dot" />
          </>
        ) : (
          <>
            <rect x={14} y={9} width={12} height={10} fill="var(--inset)" />
            <line x1={7} x2={31} y1={14} y2={14} className="ip-bar" />
            <circle cx={31} cy={14} r={2.2} className="fig-dot" />
          </>
        ))}
      {kind === "source" && <circle cx={20} cy={14} r={8} className="fig-box active" />}
      {kind === "box" && (
        <>
          <rect x={8} y={5} width={24} height={18} rx={3} fill="var(--inset)" />
          <rect x={8} y={5} width={24} height={18} rx={3} className={`fig-box ${pass ? "hot" : ""}`} />
        </>
      )}
    </svg>
  );
}

function InterruptPath() {
  const [s, setS] = useState<S>(RESET);
  const set = (patch: Partial<S>) => setS((old) => settle({ ...old, ...patch, justRan: false, event: "" }));

  const waitRow = s.crashed ? 7 : s.ifr ? (!s.ier ? 5 : !s.eint ? 6 : -1) : s.pieifr ? (!s.pieier ? 2 : s.pieack ? 3 : -1) : s.event === "tie" ? 0 : -1;
  const done = s.justRan;
  const hot = [
    !!s.pieifr || done,
    !!s.pieifr || done,
    !!s.pieifr || done,
    (!!s.pieifr && s.pieier) || done,
    !!s.ifr || done,
    !!s.ifr || done,
    (!!s.ifr && s.ier) || done,
    done || s.crashed,
    done,
  ];

  const lostNote = s.event === "lost" ? " The timer fired again while PIEIFR1.7 was still 1, which changes nothing: one flag bit cannot count two events, so that tick is lost." : "";
  const why = s.crashed
    ? "The CPU accepted the interrupt and fetched the address in PieVectTable.TIMER0_INT. Your function's address was never written there, so it jumped to the default handler, which halts the program. Write the vector, then restart the program."
    : s.event === "tie"
      ? "TIE is 0, so the timer does not ask. Its own flag TIF is set, but no request leaves the timer."
      : done
        ? s.ackLine
          ? `The request passed every gate and cpu_timer0_isr ran (${s.runs} time${s.runs > 1 ? "s" : ""} so far). The CPU cleared IFR bit INT1 and PIEIFR1.7 by itself; the last line of the function cleared PIEACK. Group 1 is open for the next request.`
          : `The request passed every gate and cpu_timer0_isr ran (${s.runs} time${s.runs > 1 ? "s" : ""} so far). The CPU cleared IFR bit INT1 and PIEIFR1.7 by itself. But the PIE set PIEACK bit 1 when it let the request through, and nothing has cleared it. Let the timer reach zero again.`
        : waitRow === 2
          ? `The request is latched in PIEIFR1.7 and waits there: PIEIER1.7 is 0. Nothing is lost, the flag remembers it. Open the gate and it moves on.${lostNote}`
          : waitRow === 3
            ? s.runs > 0
              ? `This is the "runs once" bug. The new request is latched in PIEIFR1.7 and PIEIER1.7 lets it through, but PIEACK bit 1 is still 1 from the last interrupt, so group 1 is blocked. The function must end with PieCtrlRegs.PIEACK.all = PIEACK_GROUP1; switch that line on and restart the program.${lostNote}`
              : `PIEACK bit 1 is 1, so group 1 is blocked and the request waits in PIEIFR1.7.${lostNote}`
            : waitRow === 5
              ? `The request left the PIE (which set PIEACK bit 1) and is latched in the CPU's IFR. It waits there: the INT1 bit of IER is 0.${lostNote}`
              : waitRow === 6
                ? `Everything is enabled except the global switch: INTM is 1, so the CPU accepts no maskable interrupt. The request waits in IFR until EINT; runs.${lostNote}`
                : "After reset every gate is closed. Let the timer reach zero and see how far the request gets, then open the gate that stopped it.";

  const Row = ({ i, kind, value, pass, name, badge, children }: { i: number; kind: Kind; value?: number; pass?: boolean; name: string; badge?: string; children?: ReactNode }) => (
    <li className={`ip-row ${hot[i] ? "hot" : ""} ${waitRow === i ? "wait" : ""} ${i === 0 ? "first" : i === 8 ? "last" : ""}`}>
      <div className="ip-rail"><Symbol kind={kind} value={value} pass={pass} /></div>
      <div className="ip-body">
        <span className="ip-name">{name}</span>
        {badge && <span className="ip-badge">{badge}</span>}
        {waitRow === i && <span className="ip-wait">{s.crashed ? "■ stopped here" : i === 0 ? "■ no request" : "● the request waits here"}</span>}
        {children}
      </div>
    </li>
  );
  const Zone = ({ children, lit }: { children: ReactNode; lit?: boolean }) => (
    <li className={`ip-row ip-zone ${lit ? "hot" : ""} ${children === "Peripheral" ? "top" : ""}`}>
      <div className="ip-rail" />
      <div>{children}</div>
    </li>
  );
  const Toggle = ({ on, label, flip, text }: { on: boolean; label: string; flip: () => void; text: [string, string] }) => (
    <button className="fig-opt" aria-pressed={on} aria-label={`${label}: ${on ? text[1] : text[0]}`} onClick={flip}>{on ? text[1] : text[0]}</button>
  );

  return (
    <figure className="figure ip-fig" aria-label="Interactive diagram of the path of a timer interrupt request through the PIE and the CPU">
      <style>{`
        .ip-fig ol { list-style: none; margin: 0; padding: 0; }
        .ip-fig .ip-row { display: grid; grid-template-columns: 44px 1fr; }
        .ip-fig .ip-rail { position: relative; display: flex; align-items: center; justify-content: center; }
        .ip-fig .ip-rail::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: var(--dim); opacity: 0.45; }
        .ip-fig .ip-row.hot .ip-rail::before { background: var(--orange); opacity: 1; }
        .ip-fig .ip-row.first .ip-rail::before { top: 50%; }
        .ip-fig .ip-row.last .ip-rail::before { bottom: 50%; }
        .ip-fig .ip-zone.top .ip-rail::before { display: none; }
        .ip-fig .ip-rail svg { position: relative; width: 40px; height: 28px; }
        .ip-fig .ip-bar { stroke: var(--bad); stroke-width: 4; stroke-linecap: round; }
        .ip-fig .ip-bar.open { stroke: var(--ok); }
        .ip-fig .ip-body { padding: 0.28rem 0.45rem; margin: 2px 0; border-radius: 6px; display: flex; flex-wrap: wrap; gap: 0.15rem 0.5rem; align-items: center; min-height: 2.3rem; border: 2px solid transparent; }
        .ip-fig .ip-row.wait .ip-body { background: var(--accent-soft, rgba(255, 95, 5, 0.16)); border-color: var(--orange); }
        .ip-fig .ip-name { font-weight: 700; font-size: 0.9rem; }
        .ip-fig .ip-badge { font-family: var(--mono); font-size: 0.78rem; color: var(--harvest); font-weight: 700; }
        .ip-fig .ip-wait { font-weight: 700; font-size: 0.82rem; }
        .ip-fig .ip-note { flex-basis: 100%; color: var(--dim); font-size: 0.8rem; }
        .ip-fig .ip-body code { font-size: 0.75rem; overflow-wrap: anywhere; }
        .ip-fig .ip-zone > div:last-child { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: var(--dim); padding: 0.5rem 0.45rem 0.1rem; border-top: 1px dashed var(--border); margin-top: 0.25rem; }
        .ip-fig .ip-zone.top > div:last-child { border-top: 0; margin-top: 0; padding-top: 0; }
                .ip-fig .ip-side .ip-rail svg { height: 100%; min-height: 28px; }
        .ip-fig .ip-side p { margin: 2px 0; padding: 0.28rem 0.45rem; font-size: 0.8rem; color: var(--dim); border: 1px dashed var(--border); border-radius: 6px; }
        .ip-fig .ip-side b { color: var(--text); }
        .ip-fig .ip-fire { background: var(--orange); border-color: var(--orange); color: var(--accent-ink, #1a0a00); font-weight: 700; }
        .ip-fig .ip-fire:disabled { opacity: 0.5; }
      `}</style>
      <ol>
        <Zone>Peripheral</Zone>
        <Row i={0} kind="source" name="CPU Timer 0 counts down to zero">
          <button className="fig-opt ip-fire" disabled={s.crashed} onClick={() => setS(fire)}>Timer 0 reaches zero</button>
          <Toggle on={s.tie} label="TIE" flip={() => set({ tie: !s.tie })} text={["TIE = 0: does not ask", "TIE = 1: asks"]} />
          <code>CpuTimer0Regs.TCR.all = 0x4000;</code>
        </Row>
        <Zone lit={hot[1]}>PIE, group 1 (shared by 16 channels)</Zone>
        <Row i={1} kind="latch" value={s.pieifr} name="PIEIFR1.7" badge="flag">
          <span className="ip-note">Set by the timer's request. Cleared by the CPU itself when it fetches the vector.</span>
        </Row>
        <Row i={2} kind="gate" pass={s.pieier} name="PIEIER1.7" badge="enable">
          <Toggle on={s.pieier} label="PIEIER1.7" flip={() => set({ pieier: !s.pieier })} text={["0: blocks", "1: lets it through"]} />
          <code>PieCtrlRegs.PIEIER1.bit.INTx7 = {s.pieier ? 1 : 0};</code>
        </Row>
        <Row i={3} kind="gate" pass={!s.pieack} name="PIEACK bit 1" badge={s.pieack ? "= 1: group 1 blocked" : "= 0: lets it through"}>
          <Toggle on={s.ackLine} label="PIEACK line" flip={() => setS((o) => ({ ...o, ackLine: !o.ackLine }))} text={["function does not clear it", "function clears it"]} />
          <code>{s.ackLine ? "" : "// missing: "}PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;</code>
          <span className="ip-note">The PIE sets this bit itself when a request passes. Only your code clears it, by writing 1, as the last line of the function.</span>
        </Row>
        <Zone lit={hot[4]}>CPU</Zone>
        <li className={`ip-row ip-side ${hot[4] ? "hot" : ""}`}>
          <div className="ip-rail">
            <svg viewBox="0 0 40 28" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
              <path d="M40,14 H24 M28,10 L22,14 L28,18" className="fig-wire" />
            </svg>
          </div>
          <p>
            <b>CPU Timer 1</b> is wired straight to <b>INT13</b> and <b>CPU Timer 2</b> to <b>INT14</b>. They join here and skip the PIE: no PIEIER bit, no PIEACK. They still need <code>IER |= M_INT13;</code> or <code>M_INT14</code>, and <code>EINT;</code>.
          </p>
        </li>
        <Row i={4} kind="latch" value={s.ifr} name="IFR, bit INT1" badge="flag">
          <span className="ip-note">Set when the PIE passes a group 1 request on. Cleared by the CPU itself when it accepts the interrupt.</span>
        </Row>
        <Row i={5} kind="gate" pass={s.ier} name="IER, bit INT1" badge="enable">
          <Toggle on={s.ier} label="IER" flip={() => set({ ier: !s.ier })} text={["0: blocks", "1: lets it through"]} />
          <code>{s.ier ? "IER |= M_INT1;" : "// missing: IER |= M_INT1;"}</code>
        </Row>
        <Row i={6} kind="gate" pass={s.eint} name="INTM" badge={s.eint ? "= 0: lets it through" : "= 1: all interrupts blocked"}>
          <Toggle on={s.eint} label="INTM" flip={() => set({ eint: !s.eint })} text={["DINT", "EINT"]} />
          <code>{s.eint ? "EINT;" : "DINT;"}</code>
        </Row>
        <Row i={7} kind="box" pass={hot[7]} name="Vector table: where to jump?" badge={s.vector ? "&cpu_timer0_isr" : "default handler"}>
          <Toggle on={s.vector} label="Vector" flip={() => set({ vector: !s.vector })} text={["not written", "written"]} />
          <code>EALLOW; PieVectTable.TIMER0_INT = &amp;cpu_timer0_isr; EDIS;</code>
        </Row>
        <Row i={8} kind="box" pass={hot[8]} name="cpu_timer0_isr() runs" badge={`ran ${s.runs} time${s.runs === 1 ? "" : "s"}`}>
          <span className="ip-note">While it runs, INTM is 1 and the INT1 bit of IER is 0; both come back when it returns.</span>
        </Row>
      </ol>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Program</span>
          <button className="fig-opt" onClick={() => setS((o) => ({ ...o, pieifr: 0, pieack: 0, ifr: 0, runs: 0, crashed: false, justRan: false, event: "" }))}>restart program</button>
          <button className="fig-opt" onClick={() => setS(RESET)}>close every gate</button>
        </div>
      </div>
      <figcaption>
        A flag remembers a request; an enable decides whether it may pass. The orange line shows how far the request has come. Timer 0 is PIE group 1, channel 7, so every name here ends in 1 or 1.7; another interrupt uses the same path with its own numbers.
      </figcaption>
    </figure>
  );
}

export const figure = { id: "interrupt-path", Component: InterruptPath };
