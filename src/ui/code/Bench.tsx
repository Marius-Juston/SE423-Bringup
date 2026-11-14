import type { Board } from "../../sim/board";
import type { Kit } from "../../sim/world/kits";
import type { PinChange } from "../../sim/periph/gpio";

const MS = 1e6;

export function Parts({ kit, board, pressed, onButton, onKnob, focus }: { kit: Kit; board: Board | null; pressed?: (id: string) => boolean; onButton?: (id: string, down: boolean) => void; onKnob?: (id: string, value: number) => void; focus?: Set<string> }) {
  const lit = (pin: number, activeLow: boolean) => {
    if (!board) return false;
    const g = board.gpio;
    if (g.mux(pin) === 0 && !g.isOutput(pin)) return false;
    const lv = g.level[pin];
    return lv < 0 ? false : activeLow ? lv === 0 : lv === 1;
  };
  // Plugins add many knobs and meters to a kit; show only the ones this
  // program touches (an input it read, an output something produced).
  // A meter is relevant when the level names its signal or its value has
  // moved; a knob when the level names it or something read it.
  const moved = (name: string) => {
    const tr = board?.outputs.get(name);
    return !!tr && (tr.length > 1 || tr[0].v !== 0);
  };
  const analog = kit.parts.filter(
    // A knob whose signal the simulated hardware itself drives (the wheels, once the motors turn) would fight it: hide it.
    (p) => (p.kind === "knob" && !moved(p.input) && (focus?.has(p.input) || !!board?.inputsUsed.has(p.input))) || (p.kind === "meter" && (focus?.has(p.output) || moved(p.output))),
  );
  return (
    <>
    <div className="parts" role="group" aria-label={`${kit.name}: LEDs and push buttons`}>
      {kit.parts.map((p) =>
        p.kind === "knob" || p.kind === "meter" ? null : p.kind === "led" ? (
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
              onPointerCancel={() => pressed?.(p.id) && onButton?.(p.id, false)}
              // Tabbing away with the key still down would leave the button held for good.
              onBlur={() => pressed?.(p.id) && onButton?.(p.id, false)}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && onButton?.(p.id, true)}
              onKeyUp={(e) => (e.key === " " || e.key === "Enter") && onButton?.(p.id, false)}
            />
            <span>{p.id}</span>
            <span className="pinno">GPIO{p.pin}</span>
          </div>
        ),
      )}
    </div>
    {analog.length > 0 && (
      <div className="analog">
        {analog.map((p) =>
          p.kind === "knob" ? (
            <label key={p.id} className="knob">
              <span>{p.label}</span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step ?? (p.max - p.min) / 200}
                value={board?.inputs.get(p.input) ?? p.initial}
                disabled={!onKnob}
                onChange={(e) => onKnob?.(p.id, +e.target.value)}
              />
              <output>{(board?.inputs.get(p.input) ?? p.initial).toFixed(2)} {p.unit}</output>
            </label>
          ) : p.kind === "meter" ? (
            <div key={p.id} className="meter" role="img" aria-label={`${p.label}: ${board?.output(p.output)?.toFixed(p.digits ?? 2) ?? "no value"} ${p.unit}`}>
              <span>{p.label}</span>
              <output>{board?.output(p.output)?.toFixed(p.digits ?? 2) ?? "--"} {p.unit}</output>
            </div>
          ) : null,
        )}
      </div>
    )}
    </>
  );
}

/** Logic-analyser view of the kit's pins over [fromMs, toMs]. */
export function Scope({ kit, traces, fromMs, toMs, marks }: { kit: Kit; traces: Map<number, PinChange[]>; fromMs: number; toMs: number; marks?: { tMs: number; label: string }[] }) {
  const rows = kit.parts.filter((p): p is Extract<typeof p, { pin: number }> => "pin" in p && traces.has(p.pin));
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
            <line x1={x(t)} x2={x(t)} y1={0} y2={H - 16} stroke="var(--faint)" />
            <text x={x(t)} y={H - 4} textAnchor={i === 0 ? "start" : i === ticks ? "end" : "middle"}>{span >= 10 ? t.toFixed(0) : t.toFixed(2)} ms</text>
          </g>
        );
      })}
      {(marks ?? []).filter((m) => m.tMs >= fromMs && m.tMs <= toMs).map((m, i) => (
        <g key={`m${i}`}>
          <line x1={x(m.tMs)} x2={x(m.tMs)} y1={0} y2={H - 16} stroke="var(--accent)" strokeDasharray="3 3" />
          <text x={x(m.tMs) + 2} y={9} style={{ fill: "var(--accent)" }}>{m.label}</text>
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
            <text x={2} y={ri * rowH + rowH / 2 + 3} style={{ fill: "var(--text)" }}>{r.id}</text>
            <path d={d} fill="none" stroke={r.kind === "button" ? "var(--value)" : "var(--info)"} strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}
