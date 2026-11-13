import { useState } from "react";
import type { WiringLevel } from "../../levels/types";

const same = (a: [string, string], b: [string, string]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function Wiring({ level, onPass }: { level: WiringLevel; onPass: () => void }) {
  const [wires, setWires] = useState<[string, string][]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const node = (id: string) => level.nodes.find((n) => n.id === id)!;
  const click = (id: string) => {
    setMsg(null);
    if (sel === null) return setSel(id);
    if (sel === id) return setSel(null);
    const w: [string, string] = [sel, id];
    setSel(null);
    if (wires.some((x) => same(x, w)) || (level.fixed ?? []).some((x) => same(x, w))) return;
    setWires([...wires, w]);
  };
  const check = () => {
    for (const w of wires) {
      const m = (level.mistakes ?? []).find((x) => same(x.wire, w));
      if (m) return setMsg({ ok: false, text: m.why });
    }
    const extra = wires.find((w) => !level.wires.some((x) => same(x, w)));
    if (extra) return setMsg({ ok: false, text: `The wire from ${node(extra[0]).label} to ${node(extra[1]).label} does not belong in this circuit.` });
    const missing = level.wires.filter((w) => !wires.some((x) => same(x, w))).length;
    if (missing) return setMsg({ ok: false, text: `${missing} more wire${missing === 1 ? " is" : "s are"} needed.` });
    setMsg({ ok: true, text: "The circuit is complete." });
    onPass();
  };
  return (
    <div className="wiring">
      <svg viewBox="0 0 100 60" role="group" aria-label="Circuit. Select two terminals to connect them.">
        {(level.fixed ?? []).map(([a, b], i) => (
          <line key={`f${i}`} className="fixed" x1={node(a).x} y1={node(a).y} x2={node(b).x} y2={node(b).y} />
        ))}
        {(level.parts ?? []).map((part, i) => {
          const a = node(part.a);
          const b = node(part.b);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const h = len / 2;
          return (
            <g key={`p${i}`} className="part" transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${deg})`} aria-hidden="true">
              {part.kind === "resistor" ? (
                <>
                  <line x1={-h} y1={0} x2={h} y2={0} />
                  <rect x={-4.5} y={-1.6} width={9} height={3.2} />
                </>
              ) : (
                <>
                  <line x1={-h} y1={0} x2={-3.5} y2={0} />
                  <line x1={3.5} y1={0} x2={h} y2={0} />
                  <circle cx={-3.5} cy={0} r={0.8} />
                  <circle cx={3.5} cy={0} r={0.8} />
                  <line x1={-4.2} y1={-2.6} x2={4.2} y2={-2.6} />
                  <line x1={0} y1={-2.6} x2={0} y2={-5} />
                </>
              )}
              {part.label && (
                <text x={0} y={part.kind === "button" ? -6.2 : -3} textAnchor="middle" transform={Math.abs(deg) > 45 ? `rotate(${-deg}) translate(${deg > 0 ? 7 : -7} 3.8)` : undefined}>
                  {part.label}
                </text>
              )}
            </g>
          );
        })}
        {wires.map(([a, b], i) => (
          <line key={i} className="wire" x1={node(a).x} y1={node(a).y} x2={node(b).x} y2={node(b).y} />
        ))}
        {level.nodes.map((n) => (
          <g
            key={n.id}
            className={`node ${sel === n.id ? "sel" : ""}`}
            data-node={n.id}
            tabIndex={0}
            role="button"
            aria-pressed={sel === n.id}
            aria-label={`Terminal ${n.label}`}
            onClick={() => click(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                click(n.id);
              }
            }}
          >
            {/* A generous invisible target makes the terminal easy to hit. */}
            <circle className="hit" cx={n.x} cy={n.y} r={4.5} />
            <circle cx={n.x} cy={n.y} r={2.2} />
            <text
              x={n.side === "left" ? n.x - 3.4 : n.side === "right" ? n.x + 3.4 : n.x}
              y={n.side === "bottom" ? n.y + 5.6 : n.side === "left" || n.side === "right" ? n.y + 0.9 : n.y - 3.6}
              textAnchor={n.side === "left" ? "end" : n.side === "right" ? "start" : "middle"}
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <p style={{ color: "var(--dim)", fontSize: "0.9rem" }}>Select one terminal, then another, to add a wire. Grey wires are already in place.</p>
      <ul className="wirelist" aria-label="Wires you added">
        {wires.map((w, i) => (
          <li key={i}>
            {node(w[0]).label} — {node(w[1]).label}
            <button aria-label={`Remove wire ${node(w[0]).label} to ${node(w[1]).label}`} onClick={() => { setWires(wires.filter((_, k) => k !== i)); setMsg(null); }}>×</button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="btn primary" onClick={check}>Check circuit</button>
        {msg && <span role="status" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
