import { useState } from "react";
import type { Board } from "../../sim/board";
import type { Kit } from "../../sim/world/kits";
import type { PinChange } from "../../sim/periph/gpio";
import { fieldsOf, fieldValue, hex } from "../device";

const MS = 1e6;

export function Parts({ kit, board, pressed, onButton }: { kit: Kit; board: Board | null; pressed?: (id: string) => boolean; onButton?: (id: string, down: boolean) => void }) {
  const lit = (pin: number, activeLow: boolean) => {
    if (!board) return false;
    const g = board.gpio;
    if (g.mux(pin) === 0 && !g.isOutput(pin)) return false;
    const lv = g.level[pin];
    return lv < 0 ? false : activeLow ? lv === 0 : lv === 1;
  };
  return (
    <div className="parts" role="group" aria-label={`${kit.name}: LEDs and push buttons`}>
      {kit.parts.map((p) =>
        p.kind === "led" ? (
          <div key={p.id} className={`led ${p.color} ${lit(p.pin, p.activeLow) ? "on" : ""}`} role="img" aria-label={`${p.label} on GPIO${p.pin}: ${lit(p.pin, p.activeLow) ? "on" : "off"}`}>
            <i />
            <span>{p.id}</span>
            <span className="pinno">GPIO{p.pin}</span>
          </div>
        ) : (
          <div key={p.id} className="pb">
            <button
              aria-pressed={pressed?.(p.id) ?? false}
              aria-label={`Push button ${p.label} on GPIO${p.pin}. Hold to press.`}
              disabled={!onButton}
              onPointerDown={() => onButton?.(p.id, true)}
              onPointerUp={() => onButton?.(p.id, false)}
              onPointerLeave={() => pressed?.(p.id) && onButton?.(p.id, false)}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && onButton?.(p.id, true)}
              onKeyUp={(e) => (e.key === " " || e.key === "Enter") && onButton?.(p.id, false)}
            />
            <span>{p.id}</span>
            <span className="pinno">GPIO{p.pin}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** Logic-analyser view of the kit's pins over [fromMs, toMs]. */
export function Scope({ kit, traces, fromMs, toMs, marks }: { kit: Kit; traces: Map<number, PinChange[]>; fromMs: number; toMs: number; marks?: { tMs: number; label: string }[] }) {
  const rows = kit.parts.filter((p) => traces.has(p.pin));
  if (!rows.length) return <p style={{ color: "var(--dim)", fontSize: "0.9rem" }}>No pin has changed yet.</p>;
  const W = 400;
  const left = 46;
  const rowH = 26;
  const H = rows.length * rowH + 22;
  const span = Math.max(1e-9, toMs - fromMs);
  const x = (tMs: number) => left + ((tMs - fromMs) / span) * (W - left - 6);
  const ticks = 4;
  return (
    <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Signal traces for ${rows.map((r) => r.id).join(", ")} from ${fromMs.toFixed(1)} to ${toMs.toFixed(1)} milliseconds`}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const t = fromMs + (span * i) / ticks;
        return (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={H - 16} stroke="rgba(255,255,255,0.1)" />
            <text x={x(t)} y={H - 4} textAnchor={i === 0 ? "start" : i === ticks ? "end" : "middle"}>{span >= 10 ? t.toFixed(0) : t.toFixed(2)} ms</text>
          </g>
        );
      })}
      {(marks ?? []).filter((m) => m.tMs >= fromMs && m.tMs <= toMs).map((m, i) => (
        <g key={`m${i}`}>
          <line x1={x(m.tMs)} x2={x(m.tMs)} y1={0} y2={H - 16} stroke="#ff5f05" strokeDasharray="3 3" />
          <text x={x(m.tMs) + 2} y={9} style={{ fill: "#ff9a5c" }}>{m.label}</text>
        </g>
      ))}
      {rows.map((r, ri) => {
        const tr = traces.get(r.pin)!;
        const yHi = ri * rowH + 6;
        const yLo = ri * rowH + rowH - 6;
        let level = -1;
        for (const c of tr) {
          if (c.t / MS > fromMs) break;
          level = c.level;
        }
        let d = "";
        let pen = false;
        const y = (lv: number) => (lv ? yHi : yLo);
        if (level >= 0) {
          d += `M${x(fromMs)},${y(level)}`;
          pen = true;
        }
        for (const c of tr) {
          const t = c.t / MS;
          if (t <= fromMs) continue;
          if (t > toMs) break;
          if (pen) d += `H${x(t)}V${y(c.level)}`;
          else {
            d += `M${x(t)},${y(c.level)}`;
            pen = true;
          }
          level = c.level;
        }
        if (pen) d += `H${x(toMs)}`;
        return (
          <g key={r.id}>
            <text x={2} y={ri * rowH + rowH / 2 + 3} style={{ fill: "#fff" }}>{r.id}</text>
            <path d={d} fill="none" stroke={r.kind === "button" ? "#fcb316" : "#4fc3e8"} strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}

export function Registers({ board, names }: { board: Board; names: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!names.length) return <p style={{ color: "var(--dim)", fontSize: "0.9rem" }}>Registers your code writes will appear here.</p>;
  return (
    <div>
      {[...names].reverse().map((n) => {
        const r = board.dev.regs.get(n);
        // IER and IFR are CPU registers, not part of the peripheral map.
        if (!r) {
          const v = n === "IER" ? board.ier : n === "IFR" ? board.ifr : 0;
          return (
            <div className="reg-row" key={n}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: "0.85rem" }}>
                <span>{n} (CPU register)</span>
                <span style={{ color: "var(--harvest)" }}>{hex(v, 16)}</span>
              </div>
            </div>
          );
        }
        const v = board.mem.peek(r.addr, r.words);
        const fields = fieldsOf(r).filter((f) => !f.reserved);
        return (
          <details className="reg-row" key={n} open={open === n} onToggle={(e) => (e.currentTarget.open ? setOpen(n) : open === n && setOpen(null))}>
            <summary>
              <span>{n}</span>
              <span>{hex(v, r.words * 16)}</span>
            </summary>
            <p style={{ margin: "0.3rem 0", fontSize: "0.85rem", color: "var(--dim)" }}>
              {r.desc} Address 0x{r.addr.toString(16).toUpperCase()}.{r.hook.protect ? " EALLOW-protected." : ""}
            </p>
            {fields.length > 0 && fields.length <= 40 && (
              <table className="fields">
                <tbody>
                  {[...fields].reverse().filter((f) => fields.length <= 16 || fieldValue(v, f) !== 0).map((f) => (
                    <tr key={f.name}>
                      <td className="mono">{f.name}</td>
                      <td className="mono">{fieldValue(v, f)}</td>
                      <td>{f.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        );
      })}
    </div>
  );
}
