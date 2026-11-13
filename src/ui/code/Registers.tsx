import { useMemo, useState } from "react";
import type { Board, WriteEntry } from "../../sim/board";
import { fieldsOf, fieldValue, hex, type BitField } from "../device";

const MS = 1e6;

interface Row {
  e: WriteEntry;
  bits: number;
  fields: BitField[];
  /** Fields whose value changed, or the whole register when it has none. */
  changes: { name: string; from: number; to: number }[];
  /** True for registers that act on the bits written and read back 0 (SET, CLEAR, TOGGLE, ...). */
  command: boolean;
}

function describe(board: Board, e: WriteEntry): Row {
  const r = board.dev.regs.get(e.name);
  const bits = (r?.words ?? 1) * 16;
  const fields = r ? fieldsOf(r).filter((f) => !f.reserved && f.name) : [];
  const command = e.after === e.before && e.written !== e.after;
  // For command registers show what was written; otherwise what changed.
  const from = command ? 0 : e.before;
  const to = command ? e.written : e.after;
  const changed = fields.filter((f) => fieldValue(from, f) !== fieldValue(to, f)).map((f) => ({ name: f.name, from: fieldValue(from, f), to: fieldValue(to, f) }));
  return { e, bits, fields, command, changes: changed.length && changed.length <= 6 ? changed : [{ name: "", from, to }] };
}

function Bits({ row }: { row: Row }) {
  const { e, bits, command } = row;
  const from = command ? 0 : e.before;
  const to = command ? e.written : e.after;
  const cells = [];
  for (let b = bits - 1; b >= 0; b--) {
    const was = Math.floor(from / 2 ** b) % 2;
    const is = Math.floor(to / 2 ** b) % 2;
    cells.push(
      <span key={b} className={`rb ${is ? "one" : ""} ${was !== is ? "chg" : ""} ${b % 4 === 0 && b ? "gap" : ""}`} title={`bit ${b}: ${was} → ${is}`}>
        {is}
      </span>,
    );
  }
  return (
    <div className="regbits" role="img" aria-label={`Bits ${bits - 1} down to 0: ${to.toString(2).padStart(bits, "0")}. Changed bits are outlined.`}>
      {cells}
    </div>
  );
}

/**
 * What the program did to the chip's registers: a change log in time order
 * (select an entry to see its bits) and the registers in a fixed order.
 */
export function Registers({ board, onGoto }: { board: Board; onGoto?: (line: number) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [showLib, setShowLib] = useState(false);
  const log = board.writeLog;
  const shown = useMemo(() => (showLib ? log : log.filter((e) => !e.lib)), [log, log.length, showLib]);
  const recent = shown.slice(-60).reverse();
  const picked = sel !== null ? (log.find((e) => e.n === sel) ?? null) : (recent[0] ?? null);
  const names = useMemo(() => [...new Set(log.map((e) => e.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [log, log.length]);
  if (!log.length) return <p className="hint-text">Nothing written yet. Each register your code writes will be listed here with the line that wrote it and what changed.</p>;
  const row = picked ? describe(board, picked) : null;
  return (
    <div className="regs">
      <div className="reglog-head">
        <h4 className="sub">Change log ({shown.length}{shown.length !== log.length ? ` of ${log.length}` : ""})</h4>
        <label className="tiny">
          <input type="checkbox" checked={showLib} onChange={(e) => setShowLib(e.target.checked)} /> include writes made inside library functions
        </label>
      </div>
      <ol className="reglog" aria-label="Register writes, newest first">
        {recent.map((e) => {
          const d = describe(board, e);
          const active = picked?.n === e.n;
          return (
            <li key={e.n}>
              <button className={active ? "on" : ""} aria-pressed={active} onClick={() => setSel(e.n)}>
                <span className="when">{(e.t / MS).toFixed(e.t / MS < 10 ? 4 : 2)} ms</span>
                <span className="where">{e.line ? `line ${e.line}` : "start"}{e.lib ? " (library)" : ""}</span>
                <span className="what">
                  <b>{e.name}</b>
                  {d.changes.map((c, i) => (
                    <span key={i} className="chgval">
                      {c.name ? `.${c.name} ` : " "}
                      {d.command ? (
                        <>wrote <i>{c.name ? c.to : hex(c.to, d.bits)}</i></>
                      ) : (
                        <>
                          {c.name ? c.from : hex(c.from, d.bits)} → <i>{c.name ? c.to : hex(c.to, d.bits)}</i>
                        </>
                      )}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {shown.length > recent.length && <p className="tiny">Showing the latest {recent.length} of {shown.length}.</p>}
      {row && picked && (
        <div className="regdetail" aria-live="polite">
          <div className="regdetail-head">
            <b className="mono">{picked.name}</b>
            <span className="mono">
              {row.command ? `wrote ${hex(picked.written, row.bits)}` : `${hex(picked.before, row.bits)} → ${hex(picked.after, row.bits)}`}
            </span>
          </div>
          <Bits row={row} />
          <p className="tiny">
            {board.dev.regs.get(picked.name)?.desc ?? "CPU register."}
            {row.command ? " This register acts on the bits written as 1 and always reads 0." : ""}
            {board.dev.regs.get(picked.name)?.hook.protect ? " EALLOW-protected." : ""}
            {picked.line && onGoto ? (
              <>
                {" "}
                <button className="linkish" onClick={() => onGoto(picked.line)}>Show line {picked.line}</button>
              </>
            ) : null}
          </p>
          {row.fields.length > 0 && row.fields.length <= 40 && (
            <table className="fields">
              <tbody>
                {[...row.fields]
                  .reverse()
                  .filter((f) => row.fields.length <= 16 || fieldValue(row.command ? picked.written : picked.after, f) !== 0 || row.changes.some((c) => c.name === f.name))
                  .map((f) => {
                    const chg = row.changes.find((c) => c.name === f.name);
                    return (
                      <tr key={f.name} className={chg ? "changed" : ""}>
                        <td className="mono">{f.name}</td>
                        <td className="mono">{chg ? `${chg.from} → ${chg.to}` : fieldValue(row.command ? picked.written : picked.after, f)}</td>
                        <td>{f.desc}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      )}
      <h4 className="sub">Registers written so far (current values)</h4>
      <table className="fields regnow">
        <tbody>
          {names.map((n) => {
            const r = board.dev.regs.get(n);
            const v = r ? board.mem.peek(r.addr, r.words) : n === "IER" ? board.ier : board.ifr;
            const last = [...log].reverse().find((e) => e.name === n);
            return (
              <tr key={n} className={picked?.name === n ? "changed" : ""}>
                <td className="mono">
                  <button className="linkish" onClick={() => last && setSel(last.n)}>{n}</button>
                </td>
                <td className="mono">{hex(v, (r?.words ?? 1) * 16)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
