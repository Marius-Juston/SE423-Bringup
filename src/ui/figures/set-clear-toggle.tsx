import { useState } from "react";

// TRM section 8.3, "Digital General-Purpose I/O Control": GPyDAT reads the
// pins, not the output latch, and a pin lags behind the latch. Two
// read-modify-write statements on GPADAT in a row: the second reads the
// first pin's old level and writes it back. GPySET / GPyCLEAR / GPyTOGGLE
// always read back 0 and only act on bits written as 1, so they cannot
// disturb another pin. The two statements below are the TRM's own example,
// on the pins of this game's level (GPIO22 = LED1, GPIO31).

type Bit = 0 | 1;
type Phase = "start" | "read" | "modify" | "write" | "settle";
interface Frame {
  l22: Bit; l31: Bit; p22: Bit; p31: Bit;
  /** The CPU's working copy of port A (bits 31 and 22), or null when it holds nothing of interest. */
  copy: { c22: Bit; c31: Bit } | null;
  phase: Phase;
  line: number; // index into the program, -1 before it starts
  stale?: boolean;
  text: string;
}

const DAT_CODE = ["GpioDataRegs.GPADAT.bit.GPIO22 = 1;", "GpioDataRegs.GPADAT.bit.GPIO31 = 0;"];
const SAFE_CODE = ["GpioDataRegs.GPASET.bit.GPIO22 = 1;", "GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;"];
const START = { l22: 0 as Bit, l31: 1 as Bit, p22: 0 as Bit, p31: 1 as Bit };

const DAT: Frame[] = [
  { ...START, copy: null, phase: "start", line: -1, text: "Start: GPIO22 is low and GPIO31 is high. The program wants GPIO22 high, then GPIO31 low. A .bit write cannot touch one bit alone: the CPU reads the whole register, changes the bit, and writes the whole register back." },
  { ...START, copy: { c22: 0, c31: 1 }, phase: "read", line: 0, text: "Line 1, read: the CPU reads GPADAT. That gives the levels on the pins: GPIO22 = 0, GPIO31 = 1." },
  { ...START, copy: { c22: 1, c31: 1 }, phase: "modify", line: 0, text: "Line 1, change: in its copy the CPU sets bit 22 to 1. The chip's pins have not changed yet." },
  { l22: 1, l31: 1, p22: 0, p31: 1, copy: { c22: 1, c31: 1 }, phase: "write", line: 0, text: "Line 1, write: the whole copy goes to the output latch. The latch for GPIO22 is now 1, but the pin needs a moment to rise, and GPADAT will only show the 1 after that." },
  { l22: 1, l31: 1, p22: 0, p31: 1, copy: { c22: 0, c31: 1 }, phase: "read", line: 1, stale: true, text: "Line 2, read: the CPU reads GPADAT again, straight away. GPIO22's pin has not risen yet, so the copy gets its OLD level, 0. This is the bug." },
  { l22: 1, l31: 1, p22: 0, p31: 1, copy: { c22: 0, c31: 0 }, phase: "modify", line: 1, stale: true, text: "Line 2, change: the CPU clears bit 31 in its copy. Bit 22 of the copy is still the stale 0." },
  { l22: 0, l31: 0, p22: 0, p31: 1, copy: { c22: 0, c31: 0 }, phase: "write", line: 1, stale: true, text: "Line 2, write: the whole copy goes to the latch, the stale 0 included. GPIO22's latch is back at 0: line 2 has undone line 1 without ever naming GPIO22." },
  { l22: 0, l31: 0, p22: 0, p31: 0, copy: null, phase: "settle", line: 2, text: "Result: GPIO31 went low as asked, but GPIO22 never went high and LED1 stays dark. Only the last change survived." },
];
const SAFE: Frame[] = [
  { ...START, copy: null, phase: "start", line: -1, text: "The same start: GPIO22 low, GPIO31 high. This time the program writes 1s to GPASET and GPACLEAR. Those registers always read back 0, so no pin level is ever read and written back." },
  { l22: 1, l31: 1, p22: 0, p31: 1, copy: null, phase: "write", line: 0, text: "Line 1: a 1 written to bit 22 of GPASET sets GPIO22's latch. All the 0 bits do nothing, so GPIO31 is not touched. The pin starts to rise." },
  { l22: 1, l31: 0, p22: 0, p31: 1, copy: null, phase: "write", line: 1, text: "Line 2: a 1 written to bit 31 of GPACLEAR clears GPIO31's latch. GPIO22's pin is still rising, and it does not matter: nothing was read, so nothing old is written back." },
  { l22: 1, l31: 0, p22: 1, p31: 0, copy: null, phase: "settle", line: 2, text: "Result: GPIO22 is high, LED1 is lit, and GPIO31 is low. Both changes survived." },
];

const CSS = `
.sc-code { margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-family: var(--mono); font-size: 0.8rem; list-style: none; }
.sc-code li { padding-left: 1.3em; position: relative; overflow-wrap: anywhere; }
.sc-code li.cur { color: var(--harvest); font-weight: 700; }
.sc-code li.cur::before { content: "\\25B6"; position: absolute; left: 0; }
.sc-code li.done { color: var(--dim); }
.sc-run { font-family: var(--mono); background: var(--surface); border: 1px solid var(--dim); border-radius: 6px; padding: 0.2em 0.6em; font-size: 0.8rem; }
`;

const lv = (b: Bit) => (b ? "var(--orange)" : "var(--arches)");
const volts = (b: Bit) => (b ? "3.3 V" : "0 V");

function SetClearToggle() {
  const [mode, setMode] = useState<"free" | "dat" | "safe">("free");
  const [step, setStep] = useState(0);
  const [free, setFree] = useState<{ l22: Bit; stmt: string; text: string }>({
    l22: 0,
    stmt: "",
    text: "Press a register button: it writes a 1 to bit 22 only. Every other bit is written as 0, and a 0 written to SET, CLEAR or TOGGLE does nothing.",
  });
  const frames = mode === "dat" ? DAT : SAFE;
  const f: Frame = mode === "free" ? { l22: free.l22, l31: 1, p22: free.l22, p31: 1, copy: null, phase: "settle", line: -1, text: free.text } : frames[step];
  const code = mode === "dat" ? DAT_CODE : mode === "safe" ? SAFE_CODE : free.stmt ? [free.stmt] : [];
  const act = (reg: "SET" | "CLEAR" | "TOGGLE") => {
    const l22: Bit = reg === "SET" ? 1 : reg === "CLEAR" ? 0 : free.l22 ? 0 : 1;
    setMode("free");
    setFree({
      l22,
      stmt: `GpioDataRegs.GPA${reg}.bit.GPIO22 = 1;`,
      text: `GPA${reg}: the 1 in bit 22 ${reg === "SET" ? "sets" : reg === "CLEAR" ? "clears" : "flips"} GPIO22's latch, now ${l22}, and the pin follows a moment later. GPIO31 was written as 0 in this register, which means "leave it alone": it stays high.`,
    });
  };
  const begin = (m: "dat" | "safe") => {
    setMode(m);
    setStep(0);
  };
  const lag22 = f.l22 !== f.p22;
  const lag31 = f.l31 !== f.p31;
  const rows = [
    { name: "GPIO31", y: 28, latch: f.l31, pin: f.p31, lag: lag31, copy: f.copy?.c31, stale: false, note: "" },
    { name: "GPIO22", y: 84, latch: f.l22, pin: f.p22, lag: lag22, copy: f.copy?.c22, stale: !!f.stale, note: f.p22 ? "LED1 lit" : "LED1 dark" },
  ];
  const reading = f.phase === "read";
  const writing = f.phase === "write" && f.copy !== null;
  return (
    <figure className="figure" aria-label="Interactive: SET, CLEAR and TOGGLE registers against read-modify-write on GPADAT">
      <style>{CSS}</style>
      <div className="fig-controls">
        <div>
          <span>Write a 1</span>
          <button className="sc-run" onClick={() => act("SET")}>GPASET</button>
          <button className="sc-run" onClick={() => act("CLEAR")}>GPACLEAR</button>
          <button className="sc-run" onClick={() => act("TOGGLE")}>GPATOGGLE</button>
          <code>bit 22 only</code>
        </div>
        <div>
          <span>Two lines</span>
          <button className="fig-opt" aria-pressed={mode === "dat"} onClick={() => begin("dat")}>through GPADAT.bit</button>
          <button className="fig-opt" aria-pressed={mode === "safe"} onClick={() => begin("safe")}>through GPASET and GPACLEAR</button>
        </div>
      </div>
      <svg viewBox="0 0 400 176" role="img" aria-label={`GPIO22: latch ${f.l22}, pin ${volts(f.p22)}${lag22 ? ", still changing" : ""}, LED1 ${f.p22 ? "lit" : "dark"}. GPIO31: latch ${f.l31}, pin ${volts(f.p31)}${lag31 ? ", still changing" : ""}.${f.copy ? ` The CPU's copy of GPADAT holds ${f.copy.c22} for bit 22 and ${f.copy.c31} for bit 31.` : ""}${f.stale ? " The copy of bit 22 is stale." : ""}`}>
        <text x="62" y="12" textAnchor="middle" className="fig-label dim">CPU's copy of GPADAT</text>
        <text x="197" y="12" textAnchor="middle" className="fig-label dim">output latch</text>
        <text x="308" y="12" textAnchor="middle" className="fig-label dim">pin</text>
        {rows.map((r) => {
          const mid = r.y + 16;
          const pinColor = lv(r.pin);
          return (
            <g key={r.name}>
              {/* working copy */}
              <rect x="20" y={r.y} width="84" height="32" rx="4" className={`fig-box ${r.copy === undefined ? "off" : r.stale ? "hot" : "active"}`} style={{ strokeDasharray: r.copy === undefined ? "3 2" : undefined }} />
              <text x="28" y={mid - 3} className="fig-label">bit {r.name.slice(4)}</text>
              <text x="28" y={mid + 9} className="fig-label" style={{ fill: r.stale ? "var(--bad)" : "var(--dim)" }}>{r.copy === undefined ? "not in use" : r.stale ? "STALE" : "copy"}</text>
              <text x="88" y={mid + 4} textAnchor="middle" className="fig-value">{r.copy === undefined ? "-" : r.copy}</text>
              {/* write arrow */}
              <line x1="104" y1={mid} x2="158" y2={mid} className={`fig-wire ${writing ? "hot" : ""}`} style={{ strokeDasharray: writing ? undefined : "3 2" }} />
              <path d={`M152,${mid - 4} L159,${mid} L152,${mid + 4}`} className={`fig-wire ${writing ? "hot" : ""}`} />
              {writing && <text x="131" y={mid - 5} textAnchor="middle" className="fig-label">write</text>}
              {/* latch */}
              <rect x="162" y={r.y} width="70" height="32" rx="4" className="fig-box active" />
              <text x="170" y={mid + 3} className="fig-label">{r.name}</text>
              <text x="218" y={mid + 4} textAnchor="middle" className="fig-value">{r.latch}</text>
              {/* pin */}
              <line x1="232" y1={mid} x2="301" y2={mid} className="fig-wire thick" style={{ stroke: pinColor, strokeDasharray: r.lag ? "4 3" : undefined }} />
              <rect x="301" y={mid - 9} width="14" height="18" className="fig-pin" />
              <text x="321" y={mid - 3} className="fig-value small" style={{ fill: pinColor }}>{volts(r.pin)}{r.lag ? " still" : ""}</text>
              <text x="321" y={mid + 9} className="fig-label dim">{r.lag ? (r.latch ? "on its way up" : "on its way down") : r.note || (r.pin ? "high" : "low")}</text>
              <circle cx="270" cy={mid} r="2.5" className="fig-dot" />
            </g>
          );
        })}
        {/* read path: from the pins back to the CPU */}
        <path d="M270,44 V150 H62 V122" className={`fig-wire ${reading ? "hot" : ""}`} style={{ strokeDasharray: reading ? undefined : "3 2" }} />
        <path d="M58,128 L62,120 L66,128" className={`fig-wire ${reading ? "hot" : ""}`} />
        <text x="166" y="145" textAnchor="middle" className="fig-label">{reading ? "read" : ""}</text>
        <text x="166" y="164" textAnchor="middle" className="fig-label dim">Reading GPADAT reads the pins, not the latch.</text>
      </svg>
      {code.length > 0 && (
        <ol className="sc-code" aria-label="The program">
          {code.map((c, i) => (
            <li key={c} className={mode === "free" || f.line === i ? "cur" : f.line > i ? "done" : ""}>{c}</li>
          ))}
        </ol>
      )}
      <p className="fig-why" role="status">{f.text}</p>
      {mode !== "free" && (
        <div className="fig-controls row">
          {/* aria-disabled, not disabled: a disabled button would drop the keyboard focus at the last step */}
          <button className="fig-opt" aria-disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
          <button className="fig-opt" aria-disabled={step === frames.length - 1} onClick={() => setStep(Math.min(frames.length - 1, step + 1))}>Next</button>
          <button className="fig-opt" aria-disabled={step === 0} onClick={() => setStep(0)}>Reset</button>
          <span className="fig-dots" role="img" aria-label={`step ${step + 1} of ${frames.length}`}>
            {frames.map((_, i) => <i key={i} className={i <= step ? "on" : ""} />)}
          </span>
        </div>
      )}
      <figcaption>Two pins of port A. SET, CLEAR and TOGGLE change only the bits you write as 1. A .bit write to GPADAT reads the whole port from the pins, changes one bit and writes all 32 bits back, so a pin that had not reached its new level yet gets its old level again.</figcaption>
    </figure>
  );
}

export const figure = { id: "set-clear-toggle", Component: SetClearToggle };
