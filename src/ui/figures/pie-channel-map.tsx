import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { PIE_CHANNELS, PIE_ENTRIES, PIE_GROUPS, isGradedPie, pieCode, pieEntry, type PieEntry } from "../../sim/device/pie-map";

// Table 3-2 "PIE Channel Mapping" (TRM section 3.4.5), which the course hands
// out as a page of its own (PeripheralInterruptChannelMapTable.pdf): each row
// is a group INTx.y, each column a channel. The entries come from the
// simulator's vector table (sim/device/pie-map.ts). What an entry needs in
// code is TRM 3.4.4 "Interrupt Entry Sequence": the vector, PIEIERx.y, the
// IER bit of group x and the PIEACK bit of group x. CPU timers 1 and 2 are
// not in the table: they are wired to INT13 and INT14 (TRM 3.4.3, Figure 3-1).
// For the entries a homework or lab has students find, the code keeps the
// letters x and y (pieCode).

const CSS = `
.pcm-doc { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.2rem; }
.pcm-title { text-align: center; font-weight: 700; font-size: 0.78rem; margin: 0.1rem 0 0.3rem; }
.pcm-title + table { margin-bottom: 0.5rem; }
.pcm-doc table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--fig-small, 11px); line-height: 1.15; }
.pcm-doc th { font-weight: 700; color: var(--text); padding: 2px 1px; border-bottom: 1.5px solid var(--text); text-align: center; overflow-wrap: anywhere; }
.pcm-doc th[scope="row"] { border-bottom: 1px solid var(--border); text-align: left; width: 4.4em; white-space: nowrap; padding-left: 0; }
/* In the larger view all sixteen channels get room for their names; a narrow window scrolls sideways. */
.fig-big .pcm-doc { min-width: 62rem; }
/* The first row sets the column widths of a fixed table: its corner cell is the row names' column. */
.pcm-doc thead th:first-child { width: 4.4em; }
.pcm-doc td { padding: 0; border-bottom: 1px solid var(--border); vertical-align: top; }
.pcm-cell { display: block; width: 100%; min-height: 2.5em; padding: 2px 0; background: none; letter-spacing: -0.01em; border: 1px solid transparent; border-radius: 3px; color: var(--text); font: inherit; text-align: center; overflow-wrap: anywhere; cursor: pointer; }
.pcm-cell.none { color: var(--dim); }
.pcm-cell.hit { background: var(--accent-soft); border-color: var(--harvest); }
.pcm-cell[aria-pressed="true"] { background: var(--orange); border-color: var(--orange); color: var(--accent-ink); }
.pcm-rowsel th[scope="row"], th.pcm-colsel { color: var(--orange); }
.pcm-note { font-size: 0.72rem; color: var(--dim); margin: 0.2rem 0 0; }
.pcm-code { display: block; margin: 0.4rem 0 0; padding: 0.4rem 0.5rem; background: var(--surface); border-radius: 6px; font-size: 0.72rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.pcm-find { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.pcm-find label { color: var(--dim); font-size: 0.82rem; }
.pcm-find input { width: 9rem; font-family: var(--mono); font-size: 0.85rem; background: var(--inset); color: var(--text); border: 1px solid var(--dim); border-radius: 4px; padding: 0.15em 0.35em; }
`;

const NAMES = PIE_ENTRIES.filter((e) => e.vector).map((e) => e.name.replace(/ \(.*/, ""));
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const plain = (e: PieEntry) => e.name.replace(/ \(.*/, "");

/** A name with a place to break after each underscore, as the manual wraps them. */
function Name({ text }: { text: string }) {
  const parts = text.split("_");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

function PieChannelMap() {
  const [sel, setSel] = useState<[number, number]>([1, 7]);
  const [find, setFind] = useState("");
  const [wide, setWide] = useState(false);
  const doc = useRef<HTMLDivElement>(null);
  const focus = useRef(false);

  useLayoutEffect(() => {
    const el = doc.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= 640);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // After an arrow key the newly chosen cell takes the focus.
  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    doc.current?.querySelector<HTMLButtonElement>(`[data-cell="${sel[0]}.${sel[1]}"]`)?.focus();
  }, [sel]);

  const [g, c] = sel;
  const e = pieEntry(g, c)!;
  const q = norm(find);
  const hits = q ? PIE_ENTRIES.filter((x) => x.vector && norm(plain(x)).includes(q)) : [];
  const choose = (text: string) => {
    setFind(text);
    const n = norm(text);
    if (!n) return;
    const all = PIE_ENTRIES.filter((x) => x.vector && norm(plain(x)).includes(n));
    const exact = all.find((x) => norm(plain(x)) === n) ?? (all.length === 1 ? all[0] : undefined);
    if (exact) setSel([exact.group, exact.channel]);
  };
  const key = (ev: KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const move = d[ev.key];
    if (!move) return;
    ev.preventDefault();
    focus.current = true;
    setSel([Math.min(PIE_GROUPS, Math.max(1, g + move[0])), Math.min(PIE_CHANNELS, Math.max(1, c + move[1]))]);
  };

  const graded = isGradedPie(e);
  const why = !e.vector
    ? `INT${g}.${c} is marked "-": reserved. No peripheral uses this cell, so there is nothing to enable.`
    : graded
      ? `${plain(e)} is the cell in orange. Its row gives the group x and its column the channel y. A homework or lab asks you for these two numbers, so the lines below keep the letters: put the numbers in yourself.`
      : `${plain(e)} is in row INT${g}.y and column INTx.${c}: PIE group ${g}, channel ${c}, written INT${g}.${c}. The group number goes into three names (PIEIER${g}, M_INT${g}, PIEACK_GROUP${g}). The channel only goes into the bit INTx${c}.`;
  const found = !q ? "" : hits.length === 0 ? ` Nothing in the table contains "${find.trim()}".` : hits.length === 1 ? "" : ` ${hits.length} entries contain "${find.trim()}": they are outlined. Choose one.`;

  const table = (from: number, to: number, title: string) => {
    const cols = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    return (
      <Fragment key={from}>
        <p className="pcm-title">{title}</p>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: "4.4em" }}></th>
              {cols.map((y) => (
                <th key={y} scope="col" className={y === c ? "pcm-colsel" : undefined}>INTx.{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: PIE_GROUPS }, (_, i) => i + 1).map((x) => (
              <tr key={x} className={x === g ? "pcm-rowsel" : undefined}>
                <th scope="row">INT{x}.y</th>
                {cols.map((y) => {
                  const cell = pieEntry(x, y)!;
                  const on = x === g && y === c;
                  return (
                    <td key={y}>
                      <button
                        type="button"
                        data-cell={`${x}.${y}`}
                        className={`pcm-cell ${cell.vector ? "" : "none"} ${hits.includes(cell) ? "hit" : ""}`}
                        aria-pressed={on}
                        aria-label={`INT${x}.${y}: ${cell.vector ? cell.name : "reserved"}`}
                        tabIndex={on ? 0 : -1}
                        onClick={() => setSel([x, y])}
                      >
                        <Name text={cell.name} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Fragment>
    );
  };

  return (
    <figure className="figure" aria-label="The PIE channel mapping table of the reference manual. Choose a cell to see the code it needs.">
      <style>{CSS}</style>
      <div className="pcm-doc" ref={doc} onKeyDown={key}>
        {wide ? table(1, 16, "Table 3-2. PIE Channel Mapping") : [table(1, 8, "Table 3-2. PIE Channel Mapping"), table(9, 16, "Table 3-2. PIE Channel Mapping (continued)")]}
        <p className="pcm-note">Note: Cells marked "-" are Reserved</p>
      </div>
      <p className="fig-why" role="status">
        {why}
        {found}
      </p>
      <div className="fig-controls">
        <div className="pcm-find">
          <label htmlFor="pcm-find">Find a name</label>
          <input id="pcm-find" list="pcm-names" value={find} placeholder="SCIA_RX" spellCheck={false} autoComplete="off" onChange={(ev) => choose(ev.target.value)} />
          <datalist id="pcm-names">
            {NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {find && (
            <button type="button" className="fig-opt" onClick={() => setFind("")}>
              Clear
            </button>
          )}
        </div>
      </div>
      {e.vector && <code className="pcm-code">{pieCode(e).join("\n")}</code>}
      <figcaption>
        Each row is a group and each column a channel. Choose a cell (or move with the arrow keys) to see the four lines it needs. CPU timers 1 and 2 are not in the table: they go straight to INT13 and INT14.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "pie-channel-map",
  title: "PIE channel map",
  description: "The manual's table of every peripheral interrupt. Choose a cell, or type a name to find it, and see the four lines of code that follow from its row and column.",
  Component: PieChannelMap,
};
