import { useState } from "react";

// EALLOW protection (TRM section 3.6.1.2, Table 3-5, and the "EALLOW-protected" notes in
// the register tables): a write to a protected register only lands between
// EALLOW; and EDIS;. Anywhere else it is ignored without any error.
// Protected here: GpioCtrlRegs (pin configuration), PieVectTable (interrupt
// vectors), ClkCfgRegs / CpuSysRegs (clocks), WdRegs (watchdog).
// Not protected: GpioDataRegs, CpuTimerxRegs.

interface Target { reg: string; stmt: string; what: string; before: string; after: string; protect: boolean }
const TARGETS: Target[] = [
  { reg: "GpioCtrlRegs.GPADIR", stmt: "GpioCtrlRegs.GPADIR.bit.GPIO22 = 1;", what: "pin direction", before: "GPIO22 = 0 (input)", after: "GPIO22 = 1 (output)", protect: true },
  { reg: "PieVectTable.TIMER0_INT", stmt: "PieVectTable.TIMER0_INT = &cpu_timer0_isr;", what: "interrupt vector", before: "default handler", after: "&cpu_timer0_isr", protect: true },
  { reg: "ClkCfgRegs.LOSPCP", stmt: "ClkCfgRegs.LOSPCP.bit.LSPCLKDIV = 0;", what: "clock divider", before: "LSPCLKDIV = 2 (divide by 4)", after: "LSPCLKDIV = 0 (divide by 1)", protect: true },
  { reg: "GpioDataRegs.GPASET", stmt: "GpioDataRegs.GPASET.bit.GPIO22 = 1;", what: "pin level", before: "GPIO22 latch = 0", after: "GPIO22 latch = 1", protect: false },
];

interface Line { text: string; note: string; ok: boolean | null }

const CSS = `
.el-prog { margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-family: var(--mono); font-size: 0.8rem; list-style: none; min-height: 4.6em; }
.el-prog li { display: flex; flex-wrap: wrap; gap: 0 0.8em; }
.el-prog .ok { color: var(--ok); }
.el-prog .bad { color: var(--bad); font-weight: 700; }
.el-prog .dim { color: var(--dim); }
.el-run { font-family: var(--mono); background: var(--surface); border: 1px solid var(--dim); border-radius: 6px; padding: 0.2em 0.7em; font-size: 0.82rem; }
.el-gate { fill: var(--surface); stroke: var(--dim); stroke-width: 1.4; }
.el-shackle { fill: none; stroke-width: 3; stroke-linecap: round; }
.el-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.2rem 1rem; margin: 0.3rem 0 0.5rem; font-size: 0.8rem; color: var(--dim); }
.el-list div { margin: 0; }
.el-list b { display: block; color: var(--text); }
`;

function EallowLock() {
  const [ti, setTi] = useState(0);
  const [open, setOpen] = useState(false);
  const [written, setWritten] = useState<Record<number, boolean>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [last, setLast] = useState<"none" | "landed" | "ignored">("none");
  const t = TARGETS[ti];
  const add = (l: Line) => setLines([...lines, l].slice(-6));
  const eallow = () => {
    setOpen(true);
    setLast("none");
    add({ text: "EALLOW;", note: "protected registers unlocked", ok: null });
  };
  const edis = () => {
    setOpen(false);
    setLast("none");
    add({ text: "EDIS;", note: "protected registers locked again", ok: null });
  };
  const write = () => {
    const lands = !t.protect || open;
    if (lands) setWritten({ ...written, [ti]: true });
    setLast(lands ? "landed" : "ignored");
    add({ text: t.stmt, note: lands ? "written" : "IGNORED: no EALLOW", ok: lands });
  };
  const reset = () => {
    setOpen(false);
    setWritten({});
    setLines([]);
    setLast("none");
  };
  const passes = !t.protect || open;
  const done = !!written[ti];
  const wire = last === "landed" ? "var(--ok)" : last === "ignored" ? "var(--bad)" : undefined;
  const why =
    last === "ignored"
      ? `Ignored. ${t.reg} is protected and the lock is closed, so the write never reaches it. The program carries on as if nothing happened: no error, no warning, and the register still holds its old value.`
      : last === "landed"
        ? t.protect
          ? `Written. EALLOW; had opened the lock, so the write went through. Run EDIS; next: a lock left open would let a stray write through later.`
          : `Written. ${t.reg} is not protected: its writes always land, whether the lock is open or closed.`
        : t.protect
          ? `${t.reg} (${t.what}) is protected. The lock is ${open ? "open: a write will land now" : "closed: a write now would be ignored. Run EALLOW; first"}. Run the three lines below in any order.`
          : `${t.reg} (${t.what}) is not protected: the lock does not apply to it. Registers you write all the time while the program runs are left unprotected.`;
  // padlock: body at (LX, 58); the shackle lifts when open
  const LX = 186;
  return (
    <figure className="figure" aria-label="Interactive EALLOW lock: when does a write to a protected register land?">
      <style>{CSS}</style>
      <div className="fig-controls">
        <div>
          <span>Write to</span>
          {TARGETS.map((x, i) => (
            <button key={x.reg} className="fig-opt" aria-pressed={ti === i} onClick={() => { setTi(i); setLast("none"); }}>{x.reg}</button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 400 104" role="img" aria-label={`The lock is ${open ? "open" : "closed"}. ${t.reg} is ${t.protect ? "protected" : "not protected"} and holds ${done ? t.after : t.before}.${last === "ignored" ? " The last write was ignored." : last === "landed" ? " The last write landed." : ""}`}>
        {/* CPU */}
        <rect x="8" y="38" width="96" height="52" rx="5" className="fig-box" />
        <text x="56" y="54" textAnchor="middle" className="fig-label">your program</text>
        <text x="56" y="68" textAnchor="middle" className="fig-label dim">writes a value</text>
        <text x="56" y="80" textAnchor="middle" className="fig-label dim">to the register</text>
        {/* write path */}
        <line x1="104" y1="64" x2={passes ? 286 : LX - 22} y2="64" className="fig-wire thick" style={{ stroke: wire }} />
        {passes ? (
          <path d="M280,59 L288,64 L280,69" className="fig-wire thick" style={{ stroke: wire }} />
        ) : (
          <path d={`M${LX - 28},58 L${LX - 16},70 M${LX - 28},70 L${LX - 16},58`} className="fig-wire thick" style={{ stroke: "var(--bad)" }} />
        )}
        <text x="136" y="57" textAnchor="middle" className="fig-label">write</text>
        {!passes && <text x={LX - 18} y="81" textAnchor="end" className="fig-label" style={{ fill: "var(--bad)" }}>ignored</text>}
        {/* lock, drawn only for protected registers */}
        {t.protect ? (
          <g>
            <path d={open ? `M${LX - 8},50 V38 a8,8 0 0 1 16,0 V41` : `M${LX - 8},52 V44 a8,8 0 0 1 16,0 V52`} className="el-shackle" style={{ stroke: open ? "var(--ok)" : "var(--text)" }} />
            <rect x={LX - 13} y="51" width="26" height="24" rx="4" className="el-gate" style={{ stroke: open ? "var(--ok)" : "var(--text)" }} />
            <circle cx={LX} cy="61" r="2.6" className="fig-dot" />
            <line x1={LX} y1="61" x2={LX} y2="68" className="fig-wire thick" />
            <text x={LX} y="24" textAnchor="middle" className="fig-value" style={{ fill: open ? "var(--ok)" : "var(--text)" }}>{open ? "OPEN" : "LOCKED"}</text>
            <text x={LX} y="93" textAnchor="middle" className="fig-label dim">{open ? "after EALLOW;" : "after EDIS; or reset"}</text>
          </g>
        ) : (
          <text x="197" y="81" textAnchor="middle" className="fig-label dim">no lock on this register</text>
        )}
        {/* register */}
        <rect x="290" y="30" width="104" height="68" rx="5" className={`fig-box ${last === "landed" ? "hot" : "active"}`} />
        <text x="342" y="44" textAnchor="middle" className="fig-label">{t.reg.split(".")[0]}</text>
        <text x="342" y="55" textAnchor="middle" className="fig-label">.{t.reg.split(".")[1]}</text>
        <text x="342" y="68" textAnchor="middle" className="fig-label dim">{t.protect ? "protected" : "not protected"}</text>
        {(done ? t.after : t.before).split(" (").map((part, i) => (
          <text key={i} x="342" y={81 + i * 11} textAnchor="middle" className="fig-value small">{i ? `(${part}` : part}</text>
        ))}
      </svg>
      <div className="el-list">
        <div><b>Protected (need EALLOW)</b>GpioCtrlRegs (pin mux, direction, pull-ups), PieVectTable (interrupt vectors), ClkCfgRegs and CpuSysRegs (clocks), WdRegs (watchdog)</div>
        <div><b>Not protected</b>GpioDataRegs (pin levels), CpuTimer0Regs (timer settings), PieCtrlRegs (interrupt enables)</div>
      </div>
      <div className="fig-controls">
        <div>
          <span>Run a line</span>
          <button className="el-run" onClick={eallow}>EALLOW;</button>
          <button className="el-run" onClick={write}>{t.stmt}</button>
          <button className="el-run" onClick={edis}>EDIS;</button>
          <button className="fig-opt" aria-disabled={lines.length === 0 && !open} onClick={reset}>Reset</button>
        </div>
      </div>
      <ol className="el-prog" aria-label="The lines you have run">
        {lines.length === 0 && <li className="dim">// the lines you run appear here, in order</li>}
        {lines.map((l, i) => (
          <li key={i}>
            <span>{l.text}</span>
            <span className={l.ok === null ? "dim" : l.ok ? "ok" : "bad"}>// {l.note}</span>
          </li>
        ))}
      </ol>
      <p className="fig-why" role="status">{why}</p>
      <figcaption>A protected register only takes a write between EALLOW; and EDIS;. A write that meets the closed lock is dropped without any error: on the real chip the only sign is that the hardware does not do what the code says.</figcaption>
    </figure>
  );
}

export const figure = { id: "eallow-lock", Component: EallowLock };
