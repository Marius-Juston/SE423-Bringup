import { useMemo, useState } from "react";
import type { RegisterLevel } from "../../levels/types";
import { device, fieldValue, fieldsOf, fillGaps, hex, type BitField } from "../device";

export function layoutOf(level: RegisterLevel): { bits: number; fields: BitField[]; name: string } {
  if (level.reg) {
    const r = device().reg(level.reg);
    return { bits: r.words * 16, fields: fieldsOf(r), name: level.reg };
  }
  const c = level.custom!;
  return { bits: c.bits, fields: fillGaps((c.fields ?? []).map((f) => ({ ...f })), c.bits), name: "" };
}

/** True when the value meets the level's targets and leaves the other bits alone. */
export function registerSolved(level: RegisterLevel, value: number): boolean {
  if (level.value !== undefined) return value >>> 0 === level.value >>> 0;
  const { bits, fields } = layoutOf(level);
  let free = 0;
  for (const t of level.targets ?? []) {
    const f = fields.find((x) => x.name === t.field);
    if (!f) return false;
    if (fieldValue(value, f) !== t.value) return false;
    for (let b = f.lo; b <= f.hi; b++) free += 2 ** b;
  }
  for (let b = 0; b < bits; b++) {
    if (Math.floor(free / 2 ** b) % 2) continue;
    if (Math.floor(value / 2 ** b) % 2 !== Math.floor((level.initial >>> 0) / 2 ** b) % 2) return false;
  }
  return true;
}

export function RegisterPuzzle({ level, onPass, onMiss, solved }: { level: RegisterLevel; onPass: () => void; /** Called when a check finds a wrong answer (a warm-up counts the first try). */ onMiss?: () => void; solved: boolean }) {
  const { bits, fields, name } = useMemo(() => layoutOf(level), [level]);
  const [value, setValue] = useState(level.initial >>> 0);
  const [checked, setChecked] = useState(false);
  const ok = registerSolved(level, value);
  const toggle = (b: number) => {
    setValue((v) => (Math.floor(v / 2 ** b) % 2 ? v - 2 ** b : v + 2 ** b));
    setChecked(false);
  };
  const rows = bits === 32 ? [fields.filter((f) => f.lo >= 16), fields.filter((f) => f.lo < 16)] : [fields];
  const targetNames = new Set((level.targets ?? []).map((t) => t.field));
  return (
    <div>
      {name && <h3 className="mono regname">{name}</h3>}
      <p className="hint-text">Select a bit to switch it between 0 and 1.{targetNames.size ? " Leave the bits of the other fields as they are." : ""}</p>
      <div className="bits-scroll">
      {rows.map((row, ri) => (
        <div className="bits" key={ri}>
          {[...row].reverse().map((f) => (
            <div className="bitgroup gap" key={`${f.name}-${f.lo}`}>
              <div className="cells">
                {Array.from({ length: f.hi - f.lo + 1 }, (_, i) => f.hi - i).map((b) => {
                  const on = Math.floor(value / 2 ** b) % 2 === 1;
                  return (
                    <button key={b} className="bit" data-bit={b} aria-pressed={on} title={`Bit ${b}${f.name && !f.reserved ? `, field ${f.name}` : ""}`} onClick={() => toggle(b)}>
                      <small><span className="sr-only">Bit </span>{b}<span className="sr-only">{f.name && !f.reserved ? `, field ${f.name}` : ""}: </span></small>
                      {on ? 1 : 0}
                    </button>
                  );
                })}
              </div>
              {f.name && <div className={`fieldname ${f.reserved ? "rsvd" : ""}`} title={f.desc}>{f.name}</div>}
            </div>
          ))}
        </div>
      ))}
      </div>
      <div className="readout" aria-live="polite">
        <span>hex <b>{hex(value, bits)}</b></span>
        <span>decimal <b>{value}</b></span>
      </div>
      {fields.some((f) => !f.reserved && f.name) && (
        <table className="fields">
          <thead>
            <tr><th scope="col">Field</th><th scope="col">Bits</th><th scope="col">Value</th><th scope="col">What it does</th></tr>
          </thead>
          <tbody>
            {[...fields].reverse().filter((f) => !f.reserved && f.name).map((f) => {
              const t = (level.targets ?? []).find((x) => x.field === f.name);
              const cls = checked && t ? (fieldValue(value, f) === t.value ? "target-ok" : "target") : "";
              return (
                <tr key={f.name} className={cls}>
                  <td className="mono">{f.name}{targetNames.has(f.name) && checked ? (fieldValue(value, f) === t!.value ? " ✓" : " ✗") : ""}</td>
                  <td className="mono">{f.hi === f.lo ? f.hi : `${f.hi}:${f.lo}`}</td>
                  <td className="mono">{fieldValue(value, f)}</td>
                  <td>{f.desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="actions">
        <button
          className="btn primary"
          onClick={() => {
            setChecked(true);
            if (ok) onPass();
            else onMiss?.();
          }}
        >
          Check value
        </button>
        <button className="btn ghost" onClick={() => { setValue(level.initial >>> 0); setChecked(false); }}>Reset</button>
        <span role="status" className="verdict bad">{checked && !ok ? "Not yet: a needed field is wrong, or a bit that should stay unchanged was flipped." : ""}</span>
      </div>
      {solved && level.code && (
        <div className="takeaway">
          <strong>In C:</strong>
          <pre><code>{level.code}</code></pre>
        </div>
      )}
    </div>
  );
}
