import { useMemo, useState } from "react";
import { device, fieldsOf, hex } from "./device";
import { KITS } from "../sim/world/kits";

const PAGES = ["Pins on the course boards", "Formulas"] as const;

export function Handbook() {
  const dev = device();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>(PAGES[0]);
  const names = useMemo(() => [...dev.regs.keys()], [dev]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return names.filter((n) => /^(GpioDataRegs|GpioCtrlRegs\.GPA|CpuTimer0Regs|PieCtrlRegs\.PIE(CTRL|ACK|IER1$|IFR1$)|SciaRegs)/.test(n));
    return names.filter((n) => n.toLowerCase().includes(s)).slice(0, 300);
  }, [q, names]);
  const reg = dev.regs.get(sel);
  return (
    <div className="handbook">
      <nav className="list" aria-label="Handbook pages and registers">
        {PAGES.map((p) => (
          <button key={p} aria-current={sel === p} onClick={() => setSel(p)} style={{ fontFamily: "var(--sans)", fontSize: "0.95rem" }}>{p}</button>
        ))}
        <hr style={{ borderColor: "var(--border)", margin: "0.6rem 0" }} />
        <label className="sr-only" htmlFor="regsearch">Search registers</label>
        <input id="regsearch" placeholder={`Search ${names.length} registers`} value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.map((n) => (
          <button key={n} aria-current={sel === n} onClick={() => setSel(n)}>{n}</button>
        ))}
        {!q && <p style={{ color: "var(--dim)", fontSize: "0.85rem" }}>Showing the registers of the first chapters. Search to find any other, for example "TBCTL" or "ADCSOC0".</p>}
      </nav>
      <div className="detail">
        {reg ? (
          <>
            <h1 className="mono" style={{ fontSize: "1.3rem" }}>{reg.name}</h1>
            <p style={{ color: "var(--dim)" }}>
              {reg.desc} {reg.words * 16} bits at address {hex(reg.addr, 16)}.{reg.hook.protect ? " EALLOW-protected: write it between EALLOW; and EDIS;." : ""}
            </p>
            {reg.fields.length > 0 ? (
              <table className="fields">
                <thead>
                  <tr><th>Field</th><th>Bits</th><th>Description</th><th>In C</th></tr>
                </thead>
                <tbody>
                  {[...fieldsOf(reg)].reverse().filter((f) => !f.reserved).map((f) => (
                    <tr key={f.name}>
                      <td className="mono">{f.name}</td>
                      <td className="mono">{f.hi === f.lo ? f.hi : `${f.hi}:${f.lo}`}</td>
                      <td>{f.desc}</td>
                      <td className="mono">{reg.name}.bit.{f.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>This register has no named fields: use it as a whole value{dev.instances.some((i) => reg.name.startsWith(i.name) && /Vect/.test(i.name)) ? " (a pointer to an interrupt function)" : ""}.</p>
            )}
          </>
        ) : sel === PAGES[0] ? (
          <>
            <h1>Pins on the course boards</h1>
            {Object.values(KITS).filter((k) => k.id !== "launchpad").map((k) => (
              <section key={k.id} style={{ marginTop: "1rem" }}>
                <h2>{k.name}</h2>
                <table className="fields">
                  <thead>
                    <tr><th>Part</th><th>GPIO</th><th>Port</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {k.parts.filter((p): p is Extract<typeof p, { pin: number }> => "pin" in p).map((p) => (
                      <tr key={p.id}>
                        <td>{p.label}</td>
                        <td className="mono">GPIO{p.pin}</td>
                        <td className="mono">{"ABCDEF"[p.pin >> 5]} (bit {p.pin & 31})</td>
                        <td>{p.kind === "led" ? (p.activeLow ? "Lights when the pin is low" : "Lights when the pin is high") : "Connects the pin to ground when pressed: needs the pull-up, reads 0 when pressed"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </>
        ) : (
          <>
            <h1>Formulas</h1>
            <table className="fields" style={{ marginTop: "1rem" }}>
              <thead>
                <tr><th>What</th><th>Formula</th><th>Source</th></tr>
              </thead>
              <tbody>
                <tr><td>System clock</td><td className="mono">SYSCLK = 200 MHz (5 ns per cycle)</td><td>LABstarter, TRM 3.7</td></tr>
                <tr><td>Low-speed peripheral clock</td><td className="mono">LSPCLK = SYSCLK / 4 = 50 MHz</td><td>TRM 3.7</td></tr>
                <tr><td>CPU timer period</td><td className="mono">(PRD + 1) x (TDDRH:TDDR + 1) x 5 ns</td><td>TRM 3.8</td></tr>
                <tr><td>ConfigCpuTimer</td><td className="mono">PRD = Freq(MHz) x Period(us) - 1</td><td>F2837xD_CpuTimers.c</td></tr>
                <tr><td>Serial baud rate</td><td className="mono">LSPCLK / ((BRR + 1) x 8)</td><td>TRM 19.12</td></tr>
                <tr><td>Port of a GPIO</td><td className="mono">"ABCDEF"[GPIO / 32], bit GPIO % 32</td><td>TRM 8.9</td></tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
