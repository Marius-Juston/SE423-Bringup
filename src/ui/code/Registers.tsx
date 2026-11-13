import { useMemo, useRef, useState } from "react";
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
  // The log is appended to in place (and trimmed when long): the number of its last entry says when it changed.
  const stamp = log.length ? log[log.length - 1].n : -1;
  const shown = useMemo(() => (showLib ? [...log] : log.filter((e) => !e.lib)), [log, stamp, showLib]);
  const recent = useMemo(() => shown.slice(-60).reverse(), [shown]);
  // While the pointer is over the list (or the keyboard focus is in it) the rows hold still, so a row can be read and chosen while the program keeps writing.
  const [held, setHeld] = useState<WriteEntry[] | null>(null);
  const holders = useRef({ pointer: false, keys: false });
  const hold = (who: "pointer" | "keys", on: boolean) => {
    holders.current[who] = on;
    const any = holders.current.pointer || holders.current.keys;
    setHeld((h) => (any ? (h ?? recent) : null));
  };
  const rows = held ?? recent;
  const newer = held ? shown.length && held.length ? shown.filter((e) => e.n > held[0].n).length : shown.length : 0;
  const picked = sel !== null ? (log.find((e) => e.n === sel) ?? null) : (rows[0] ?? null);
  /** Last write to each register, by name, in a fixed (sorted) order. */
  const lastWrite = useMemo(() => {
    const m = new Map<string, WriteEntry>();
    for (const e of log) m.set(e.name, e);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [log, stamp]);
  if (!log.length) return <p className="hint-text">Nothing written yet. Each register your code writes will be listed here with the line that wrote it and what changed.</p>;
  const row = picked ? describe(board, picked) : null;
  return (
    <div className="regs">
      <div className="reglog-head">
        <h4 className="sub">Change log, newest first ({shown.length}{shown.length !== log.length ? ` of ${log.length}` : ""})</h4>
        <label className="tiny check">
          <input type="checkbox" checked={showLib} onChange={(e) => setShowLib(e.target.checked)} /> include writes made inside library functions
        </label>
      </div>
      <p className="tiny">
        {sel === null ? "Showing the newest write below. Select a line to keep one in view." : "Keeping the selected write in view."}{" "}
        {sel !== null && <button className="linkish" onClick={() => setSel(null)}>Follow the newest write</button>}
      </p>
      <ol
        className="reglog"
        aria-label="Register writes, newest first"
        tabIndex={0}
        onPointerEnter={() => hold("pointer", true)}
        onPointerLeave={() => hold("pointer", false)}
        onFocus={(e) => e.target.matches(":focus-visible") && hold("keys", true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && hold("keys", false)}
      >
        {rows.map((e) => {
          const d = describe(board, e);
          const active = picked?.n === e.n;
          return (
            <li key={e.n}>
              <button className={active ? "on" : ""} aria-pressed={active} onClick={() => setSel(e.n)} title={`${e.name}: ${d.changes.map((c) => `${c.name ? `${c.name} ` : ""}${d.command ? `wrote ${c.name ? c.to : hex(c.to, d.bits)}` : `${c.name ? c.from : hex(c.from, d.bits)} to ${c.name ? c.to : hex(c.to, d.bits)}`}`).join(", ")}`}>
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
      <p className="tiny reglog-foot">
        {newer > 0 ? `Held still while you are on the list: ${newer} newer write${newer === 1 ? "" : "s"} will show when you leave it.` : shown.length > recent.length ? `Showing the latest ${recent.length} of ${shown.length}.` : ""}
      </p>
      {row && picked && (
        <div className="regdetail">
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
              <thead>
                <tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">What it does</th></tr>
              </thead>
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
        <thead>
          <tr><th scope="col">Register</th><th scope="col">Value now</th></tr>
        </thead>
        <tbody>
          {lastWrite.map(([n, last]) => {
            const r = board.dev.regs.get(n);
            const v = r ? board.mem.peek(r.addr, r.words) : n === "IER" ? board.ier : board.ifr;
            return (
              <tr key={n} className={picked?.name === n ? "changed" : ""}>
                <td className="mono">
                  <button className="linkish" title="Show the last write to this register" onClick={() => setSel(last.n)}>{n}</button>
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
