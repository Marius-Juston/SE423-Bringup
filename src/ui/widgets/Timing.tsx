import { useState, type CSSProperties } from "react";
import type { TimingLevel } from "../../levels/types";

export function Timing({ level, onPass }: { level: TimingLevel; onPass: () => void }) {
  const [rows, setRows] = useState(() => level.rows.map((r) => [...r.initial]));
  const [checked, setChecked] = useState(false);
  const ok = level.rows.every((r, ri) => r.answer.every((v, i) => rows[ri][i] === v));
  return (
    <div>
      <div className="timing">
        <table style={{ "--slots": level.slots.length } as CSSProperties}>
          <thead>
            <tr>
              <th className="rowname"><span className="sr-only">Signal</span></th>
              {level.slots.map((s, i) => (
                <th key={i} scope="col">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {level.rows.map((r, ri) => (
              <tr key={r.name}>
                <th className="rowname" scope="row">{r.name}</th>
                {rows[ri].map((v, i) => {
                  const edge = i > 0 && rows[ri][i - 1] !== v;
                  const wrong = checked && r.editable && v !== r.answer[i];
                  return (
                    <td key={i} style={{ padding: 0 }}>
                      <button
                        data-wrong={wrong || undefined}
                        className={`wave ${v ? "hi" : "lo"} ${edge ? "edge" : ""} ${wrong ? "wrong" : ""}`}
                        disabled={!r.editable}
                        aria-label={`${r.name}, ${level.slots[i]}: ${v ? "high" : "low"}${wrong ? ", wrong" : ""}${r.editable ? ". Press to change" : ", given"}`}
                        onClick={() => {
                          setRows(rows.map((row, k) => (k === ri ? row.map((x, j) => (j === i ? ((1 - x) as 0 | 1) : x)) : row)));
                          setChecked(false);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint-text">Select a cell to switch it between low and high. {level.rows.some((r) => !r.editable) ? "Grey traces are given and cannot be changed." : ""}</p>
      <div className="actions">
        <button
          className="btn primary"
          onClick={() => {
            setChecked(true);
            if (ok) onPass();
          }}
        >
          Check waveform
        </button>
        <span role="status" className="verdict bad">{checked && !ok ? "The outlined cells are wrong." : ""}</span>
      </div>
    </div>
  );
}
