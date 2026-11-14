import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PINMUX_INDEXES, PINMUX_ROWS, isGradedMux, muxCall, muxFields, pinMuxRow, pinPlace, pinsFor, signalName } from "../../sim/device/pinmux";

// The course's pin mux table (PinMuxTableF28379DLaunchPad, the LaunchPad's
// rows of Table 4-3 "GPIO Muxed Pins" of the data sheet, section 4.4.1), in
// its own columns: the GPIO index on top, then the two register fields the
// index is made of (GPyGMUXn and GPyMUXn, TRM 8.7 and 8.9.2). The rows are
// data next to the simulator (sim/device/pinmux.ts), checked against the
// pins its peripheral models use. For the cells a homework or lab has
// students look up, the call keeps the word "index" (muxCall).

const CSS = `
.pmt-doc { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.2rem 0.2rem; }
.pmt-title { text-align: center; font-weight: 700; font-size: 0.78rem; margin: 0.1rem 0 0.3rem; }
.pmt-scroll { max-height: 17.5rem; overflow-y: auto; position: relative; }
.pmt-doc table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--fig-small, 11px); line-height: 1.15; }
.pmt-doc thead { position: sticky; top: 0; z-index: 1; }
.pmt-doc thead th { background: var(--surface); font-weight: 700; padding: 2px 1px; text-align: center; overflow-wrap: anywhere; }
.pmt-doc thead tr:nth-child(2) th { color: var(--dim); }
.pmt-doc thead tr:nth-child(3) th { color: var(--dim); box-shadow: 0 1.5px 0 var(--text); }
.pmt-doc thead th.pmt-lab { text-align: left; color: var(--text); letter-spacing: -0.03em; white-space: nowrap; }
.pmt-doc thead th.pmt-colsel { color: var(--orange); }
.pmt-doc td { padding: 0; border-bottom: 1px solid var(--border); vertical-align: middle; }
.pmt-cell { display: block; width: 100%; min-height: 2.3em; padding: 2px 0; background: none; border: 0; border-radius: 3px; color: var(--text); font: inherit; letter-spacing: -0.03em; text-align: center; overflow-wrap: anywhere; cursor: pointer; }
.pmt-cell.pin { font-weight: 700; }
.pmt-cell.hit { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--harvest); }
.pmt-cell[aria-pressed="true"] { background: var(--orange); box-shadow: none; color: var(--accent-ink); }
.pmt-doc td.pmt-hdr { color: var(--dim); padding: 0 1px; overflow-wrap: anywhere; }
.pmt-rowsel td { background: var(--inset); }
.pmt-code { display: block; margin: 0.4rem 0 0; padding: 0.4rem 0.5rem; background: var(--surface); border-radius: 6px; font-size: 0.72rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.pmt-row { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.pmt-row label { color: var(--dim); font-size: 0.82rem; }
.pmt-row select, .pmt-row input { font-family: var(--mono); font-size: 0.85rem; background: var(--inset); color: var(--text); border: 1px solid var(--dim); border-radius: 4px; padding: 0.15em 0.35em; }
.pmt-row input { width: 8.5rem; }
`;

const SIGNALS = [...new Set(PINMUX_ROWS.flatMap((r) => Object.values(r.fn).map((s) => signalName(s!))))].sort();
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const COLS = PINMUX_INDEXES;

function PinMuxTable() {
  const [pin, setPin] = useState(40);
  const [index, setIndex] = useState(6);
  const [find, setFind] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const focus = useRef(false);

  const q = norm(find);
  const isHit = (s?: string) => !!q && !!s && norm(signalName(s)).includes(q);
  const rows = q ? PINMUX_ROWS.filter((r) => COLS.some((i) => isHit(r.fn[i]))) : PINMUX_ROWS;
  const row = pinMuxRow(pin)!;
  const signal = index === 0 ? undefined : row.fn[index];

  // Keep the chosen row in view inside the table's own scroll box, and give it the focus after an arrow key.
  useEffect(() => {
    const el = box.current;
    const cell = el?.querySelector<HTMLButtonElement>(`[data-cell="${pin}.${index}"]`);
    if (el && cell) {
      // Position inside the scroll box; the header rows stay on top.
      const y = cell.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      const top = y - (el.querySelector("thead")?.offsetHeight ?? 46) - 2;
      const bottom = y + cell.offsetHeight;
      if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - el.clientHeight / 2);
      if (focus.current) cell.focus({ preventScroll: true });
    }
    focus.current = false;
  }, [pin, index, rows.length]);

  const pick = (p: number, i: number) => {
    setPin(p);
    setIndex(i);
  };
  const key = (ev: KeyboardEvent) => {
    const at = rows.findIndex((r) => r.pin === pin);
    if (at < 0) return;
    let p = pin;
    let i: number = index;
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const next = rows[at + (ev.key === "ArrowUp" ? -1 : 1)];
      if (!next) return;
      p = next.pin;
      if (i !== 0 && !next.fn[i]) i = 0;
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const filled = COLS.filter((c) => c === 0 || row.fn[c]);
      const next = filled[filled.indexOf(index as (typeof COLS)[number]) + (ev.key === "ArrowLeft" ? -1 : 1)];
      if (next === undefined) return;
      i = next;
    } else return;
    ev.preventDefault();
    focus.current = true;
    pick(p, i);
  };

  const tabKey = rows.some((r) => r.pin === pin) ? `${pin}.${index}` : rows[0] ? `${rows[0].pin}.0` : "";
  const place = pinPlace(pin);
  const f = muxFields(index);
  const graded = !!signal && isGradedMux(pin, signal);
  const where = `GPIO${pin} is bit ${place.bit} of port ${place.port} (${pin} / 32 = ${pin >> 5} remainder ${place.bit})${row.header ? `, LaunchPad pin ${row.header}` : ""}.`;
  const why =
    index === 0
      ? `${where} The first column is the plain GPIO: index 0 (4, 8 and 12 do the same). Both fields are 00b, the value after reset.`
      : graded
        ? `${where} ${signalName(signal!)} is the cell in orange. The index is at the top of its column. A homework or lab asks you for it, so the line below keeps the word: put the number in yourself.`
        : `${where} ${signalName(signal!)} is in the column of index ${index}. Under it: GPyGMUXn = ${f.gmuxText} and GPyMUXn = ${f.muxText}, the two halves of ${index} (${f.gmux} x 4 + ${f.mux}). For this pin they are the fields ${place.gmux}.GPIO${pin} and ${place.mux}.GPIO${pin}, bits ${place.hi}-${place.lo} of each.`;
  const hits = q ? SIGNALS.filter((s) => norm(s).includes(q)) : [];
  const exact = hits.find((s) => norm(s) === q) ?? (hits.length === 1 ? hits[0] : undefined);
  const found = !q
    ? ""
    : rows.length === 0
      ? ` No signal in the table contains "${find.trim()}".`
      : exact
        ? ` ${exact} can be on ${pinsFor(exact).length === 1 ? "one pin" : `${pinsFor(exact).length} pins`} of this board: ${pinsFor(exact).map((x) => `GPIO${x.pin}`).join(", ")}. Each outlined cell is under its index.`
        : ` ${hits.length} signals contain "${find.trim()}". The table shows only their rows.`;

  return (
    <figure className="figure" aria-label="The pin mux table of the LaunchPad. Choose a cell to see the index and the call that selects it.">
      <style>{CSS}</style>
      <div className="pmt-doc">
        <p className="pmt-title">GPIO Muxed Pins: GPIO Mux Selection</p>
        <div className="pmt-scroll" ref={box} onKeyDown={key}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="pmt-lab" style={{ width: "3.05rem" }}>GPIO Index</th>
                {COLS.map((i) => (
                  <th key={i} scope="col" className={i === index ? "pmt-colsel" : undefined}>{i === 0 ? "0, 4, 8, 12" : i}</th>
                ))}
              </tr>
              <tr>
                <th scope="row" className="pmt-lab">GPyGMUXn</th>
                <th>00b-11b</th>
                <th colSpan={3}>00b</th>
                <th colSpan={3}>01b</th>
                <th>11b</th>
              </tr>
              <tr>
                <th scope="row" className="pmt-lab">GPyMUXn</th>
                {["00b", "01b", "10b", "11b", "01b", "10b", "11b", "11b"].map((b, i) => (
                  <th key={i}>{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pin} className={r.pin === pin ? "pmt-rowsel" : undefined}>
                  <td className="pmt-hdr">{r.header}</td>
                  {COLS.map((i) => {
                    const text = i === 0 ? `GPIO${r.pin}` : r.fn[i];
                    if (!text) return <td key={i}></td>;
                    const on = r.pin === pin && i === index;
                    return (
                      <td key={i}>
                        <button
                          type="button"
                          data-cell={`${r.pin}.${i}`}
                          className={`pmt-cell ${i === 0 ? "pin" : ""} ${isHit(r.fn[i]) && i !== 0 ? "hit" : ""}`}
                          aria-pressed={on}
                          aria-label={i === 0 ? `GPIO${r.pin} as a plain GPIO` : `GPIO${r.pin}: ${text}`}
                          tabIndex={`${r.pin}.${i}` === tabKey ? 0 : -1}
                          onClick={() => pick(r.pin, i)}
                        >
                          {text}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="fig-why" role="status">
        {why}
        {found}
      </p>
      <div className="fig-controls">
        <div className="pmt-row">
          <label htmlFor="pmt-pin">Pin</label>
          <select id="pmt-pin" value={pin} onChange={(ev) => pick(+ev.target.value, 0)}>
            {PINMUX_ROWS.map((r) => (
              <option key={r.pin} value={r.pin}>GPIO{r.pin}</option>
            ))}
          </select>
          <label htmlFor="pmt-find">Find a signal</label>
          <input id="pmt-find" list="pmt-signals" value={find} placeholder="SCITXDB" spellCheck={false} autoComplete="off" onChange={(ev) => setFind(ev.target.value)} />
          <datalist id="pmt-signals">
            {SIGNALS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {find && (
            <button type="button" className="fig-opt" onClick={() => setFind("")}>
              Show all rows
            </button>
          )}
        </div>
      </div>
      <code className="pmt-code">{muxCall(pin, index, signal)}</code>
      <figcaption>
        One row per pin, one column per mux index. Choose a cell (or move with the arrow keys) to see the call that selects it. The table scrolls: it lists the {PINMUX_ROWS.length} pins the LaunchPad brings out.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "pin-mux-table",
  title: "Pin mux table",
  description: "The course's table of what each LaunchPad pin can be. Choose a pin and a signal to get the number GPIO_SetupPinMux takes, or type a signal to find every pin that can carry it.",
  Component: PinMuxTable,
};
