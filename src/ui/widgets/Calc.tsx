import { useState } from "react";
import type { CalcField } from "../../levels/types";

/**
 * The number a student typed. Spaces and underscores may group digits, a
 * comma groups thousands ("1,024") or stands for the decimal point
 * ("102,4"), and the field's own unit may follow the number ("102.4 ms").
 */
export function parse(text: string, unit = ""): number | null {
  let s = text.trim();
  const u = unit.trim();
  if (u && s.toLowerCase().endsWith(u.toLowerCase()) && !/^0x[0-9a-f]+$/i.test(s)) s = s.slice(0, s.length - u.length);
  s = s.replace(/[_\s]/g, "");
  // Commas that are not thousands separators: one comma and no point is a decimal comma.
  if (s.includes(",")) s = /^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s) ? s.replace(/,/g, "") : /^-?\d*,\d+$/.test(s) ? s.replace(",", ".") : s;
  if (!s) return null;
  if (/^-?0x[0-9a-f]+$/i.test(s)) return s.startsWith("-") ? -parseInt(s.slice(3), 16) : parseInt(s.slice(2), 16);
  if (/^0b[01]+$/i.test(s)) return parseInt(s.slice(2), 2);
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function fieldRight(f: CalcField, text: string): boolean {
  const v = parse(text, f.unit);
  if (v === null) return false;
  if (f.tolPct) return Math.abs(v - f.answer) <= Math.abs(f.answer) * (f.tolPct / 100);
  return v === f.answer;
}

export function Calc({ fields, onPass, onMiss }: { fields: CalcField[]; onPass: () => void; /** Called when a check finds a wrong answer (a warm-up counts the first try). */ onMiss?: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  /** Wrong checks per field: the explanation appears after the second. */
  const [misses, setMisses] = useState<Record<string, number>>({});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setChecked(true);
        const m = { ...misses };
        for (const f of fields) if (!fieldRight(f, vals[f.id] ?? "") && parse(vals[f.id] ?? "", f.unit) !== null) m[f.id] = (m[f.id] ?? 0) + 1;
        setMisses(m);
        if (fields.every((f) => fieldRight(f, vals[f.id] ?? ""))) onPass();
        // An empty or unreadable field is not an answer yet: only a wrong number is a miss.
        else if (fields.some((f) => parse(vals[f.id] ?? "", f.unit) !== null && !fieldRight(f, vals[f.id] ?? ""))) onMiss?.();
      }}
    >
      {fields.map((f) => {
        const right = fieldRight(f, vals[f.id] ?? "");
        return (
          <div className="calc-field" key={f.id}>
            <label htmlFor={`calc-${f.id}`}>{f.label}</label>
            <span>
              <input
                id={`calc-${f.id}`}
                value={vals[f.id] ?? ""}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={f.format === "hex" ? "0x..." : ""}
                onChange={(e) => {
                  setVals({ ...vals, [f.id]: e.target.value });
                  setChecked(false);
                }}
              />{" "}
              {f.unit}
            </span>
            {checked && (
              <p className={`why ${right ? "ok" : "bad"}`} role="status">
                {right ? `Correct. ${f.why}` : parse(vals[f.id] ?? "", f.unit) === null ? `Enter a number${f.unit ? `, in ${f.unit}` : ""} (decimal, or hex as 0x...).` : (misses[f.id] ?? 0) >= 2 ? `Not this value. Here is the reasoning: ${f.why}` : "Not this value. Recheck the formula and the units."}
              </p>
            )}
          </div>
        );
      })}
      <div className="actions">
        <button className="btn primary" type="submit">Check</button>
      </div>
    </form>
  );
}
