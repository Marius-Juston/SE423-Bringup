import { useState } from "react";
import { REGISTER_PAGES, registerPage, resetMeaning, typeMeaning, type PageField, type RegisterPage } from "../../sim/device/register-pages";
import { TRM_URL } from "../device";

// One register description page as the Technical Reference Manual prints it
// (the layout of every "Register" subsection, for example 3.15.2.3 TCR):
// the heading with offset and reset value, the bit-field figure in rows of
// eight bits (field name, then access type and reset value under it), and
// the field description table (Bit, Field, Type, Reset, Description). The
// pages are data in sim/device/register-pages.ts, checked against the
// register map. Write protection is not on the page: it is a column of the
// peripheral's register summary table, which the header line here cites.
// This file has no `figure` export: register-page.tsx and
// adc-trigger-table.tsx open it on different pages.

const CSS = `
.rpv-doc { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.4rem; }
.rpv-head { font-weight: 700; font-size: 0.8rem; margin: 0; overflow-wrap: anywhere; }
.rpv-sub { font-size: 0.74rem; margin: 0.15rem 0 0; color: var(--text); }
.rpv-sub.dim { color: var(--dim); }
.rpv-cap { text-align: center; font-weight: 700; font-size: 0.76rem; margin: 0.55rem 0 0.25rem; }
.rpv-row { display: grid; grid-template-columns: repeat(8, 1fr); margin-bottom: 0.3rem; }
.rpv-num { text-align: center; font-size: var(--fig-small, 11px); color: var(--dim); font-family: var(--mono); }
.rpv-seg { min-width: 0; margin: 0 -0.5px; padding: 3px 1px; background: var(--surface); border: 1px solid var(--text); border-radius: 0; color: var(--text); font-size: var(--fig-small, 11px); line-height: 1.1; letter-spacing: -0.02em; text-align: center; overflow-wrap: anywhere; cursor: pointer; }
.rpv-seg.rsv { color: var(--dim); }
.rpv-seg[aria-pressed="true"] { background: var(--orange); color: var(--accent-ink); border-color: var(--orange); position: relative; z-index: 1; }
.rpv-acc { text-align: center; font-size: var(--fig-small, 11px); font-family: var(--mono); letter-spacing: -0.03em; color: var(--text); padding-top: 1px; overflow-wrap: anywhere; }
.rpv-acc.sel { color: var(--orange); font-weight: 700; }
.rpv-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.72rem; line-height: 1.25; background: var(--surface); margin-top: 0.5rem; }
.rpv-table caption { background: var(--surface); margin: 0; padding: 0.4rem 0 0.25rem; border-radius: 6px 6px 0 0; }
.rpv-table th:first-child, .rpv-table td:first-child { padding-left: 0.4rem; }
.rpv-table th { text-align: left; border-bottom: 1.5px solid var(--text); padding: 2px 3px 2px 0; }
.rpv-table td { vertical-align: top; border-bottom: 1px solid var(--border); padding: 3px 3px 3px 0; overflow-wrap: anywhere; }
.rpv-table tr { cursor: pointer; }
.rpv-table tr.sel td { background: var(--accent-soft); }
.rpv-table td span { display: block; }
.rpv-table td span.more { color: var(--dim); font-style: italic; }
.rpv-code { display: block; margin: 0.4rem 0 0; padding: 0.4rem 0.5rem; background: var(--surface); border-radius: 6px; font-size: 0.72rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.rpv-legend { margin: 0.2rem 0 0; padding-left: 1.1rem; font-size: 0.76rem; }
.rpv-link { font-size: 0.74rem; }
`;

const bitsText = (f: PageField) => (f.hi === f.lo ? `${f.hi}` : `${f.hi}-${f.lo}`);
const reserved = (f: PageField) => f.name === "RESERVED";

/** The C a field is read or written with, in the course's style. */
function fieldCode(page: RegisterPage, f: PageField): string {
  if (reserved(f)) return "// reserved: no field name, nothing to read or write";
  const lhs = `${page.reg}.bit.${f.name}`;
  const max = 2 ** (f.hi - f.lo + 1) - 1;
  const lock = page.protection.value === "EALLOW";
  const wrap = (line: string) => (lock ? `EALLOW;\n${line}\nEDIS;` : line);
  const read = `x = ${lhs};   // read`;
  switch (f.type) {
    case "R/W":
      return `${read}\n${wrap(`${lhs} = ${max === 1 ? "1" : "n"};   // write${max === 1 ? "" : `: n is 0 to ${max}`}`)}`;
    case "R/W1C":
      return `${read}\n${wrap(`${lhs} = 1;   // writing 1 clears it to 0`)}`;
    case "R-0/W1S":
      return wrap(`${lhs} = 1;   // writing 1 sets it`);
    default:
      return read;
  }
}

/** The pieces of the fields that fall in one row of eight bits, highest bit first. */
function rowSegments(page: RegisterPage, top: number): { f: PageField; hi: number; lo: number }[] {
  const bottom = top - 7;
  return page.fields.filter((f) => f.hi >= bottom && f.lo <= top).map((f) => ({ f, hi: Math.min(f.hi, top), lo: Math.max(f.lo, bottom) }));
}

export function RegisterPageView({ initial, field }: { initial: string; field?: string }) {
  const [reg, setReg] = useState(initial);
  const page = registerPage(reg)!;
  const [chosen, setChosen] = useState<Record<string, number>>(() => {
    const p = registerPage(initial)!;
    const i = field ? p.fields.findIndex((f) => f.name === field) : 0;
    return { [initial]: Math.max(0, i) };
  });
  const at = chosen[reg] ?? 0;
  const f = page.fields[at];
  const choose = (i: number) => setChosen((c) => ({ ...c, [reg]: i }));
  const bits = page.fields[0].hi + 1;
  const tops = Array.from({ length: bits / 8 }, (_, i) => bits - 1 - 8 * i);
  const n = f.hi - f.lo + 1;
  const lock = page.protection.value === "EALLOW";
  const why = reserved(f)
    ? `Bit${n === 1 ? ` ${f.hi} is` : `s ${bitsText(f)} are`} RESERVED: the chip keeps ${n === 1 ? "it" : "them"} for itself. ${typeMeaning(f.type)} ${resetMeaning(f)} Writing fields with .bit never touches reserved bits.`
    : `${f.name} is ${n === 1 ? `bit ${f.hi}` : `bits ${bitsText(f)} (${n} bits wide, values 0 to ${2 ** n - 1})`}. Type ${typeMeaning(f.type)} ${resetMeaning(f)}${lock ? ` Write protection EALLOW: a write only counts between EALLOW; and EDIS;.` : ""}`;

  return (
    <figure className="figure" aria-label={`The page of the ${page.acronym} register in the reference manual. Choose a field to see what its type and reset value mean.`}>
      <style>{CSS}</style>
      <div className="rpv-doc">
        <p className="rpv-head">{page.heading}</p>
        <p className="rpv-sub">{page.name}</p>
        {page.notes?.map((t) => (
          <p key={t} className="rpv-sub">{t}</p>
        ))}
        <p className="rpv-sub dim">
          Write Protection ({page.protection.table}, the list of this peripheral's registers): {page.protection.value || "none"}
        </p>
        <p className="rpv-cap">{page.figure}</p>
        {tops.map((top) => {
          const segs = rowSegments(page, top);
          return (
            <div key={top}>
              <div className="rpv-row" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className="rpv-num">{top - i}</span>
                ))}
              </div>
              <div className="rpv-row">
                {segs.map((s) => {
                  const i = page.fields.indexOf(s.f);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`rpv-seg ${reserved(s.f) ? "rsv" : ""}`}
                      style={{ gridColumn: `span ${s.hi - s.lo + 1}` }}
                      aria-pressed={i === at}
                      aria-label={`${s.f.name}, bit${s.f.hi === s.f.lo ? "" : "s"} ${bitsText(s.f)}, ${s.f.type}, reset ${s.f.reset}`}
                      onClick={() => choose(i)}
                    >
                      {s.f.name}
                    </button>
                  );
                })}
              </div>
              <div className="rpv-row" aria-hidden="true">
                {segs.map((s) => (
                  <span key={s.hi} className={`rpv-acc ${page.fields.indexOf(s.f) === at ? "sel" : ""}`} style={{ gridColumn: `span ${s.hi - s.lo + 1}` }}>
                    {s.f.type}-{s.f.reset}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <details className="fig-more">
          <summary>What the codes under the boxes mean</summary>
          <ul className="rpv-legend">
            {[...new Set(page.fields.map((x) => x.type))].map((t) => (
              <li key={t}>{typeMeaning(t)}</li>
            ))}
            <li>The part after the dash, such as -0h, is the value after a reset, in hexadecimal.</li>
          </ul>
        </details>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <code className="rpv-code">{fieldCode(page, f)}</code>
      <div className="fig-controls">
        <div>
          <span>Register</span>
          {REGISTER_PAGES.map((p) => (
            <button key={p.reg} type="button" className="fig-opt" aria-pressed={p.reg === reg} onClick={() => setReg(p.reg)}>
              {p.acronym}
            </button>
          ))}
        </div>
      </div>
      <table className="rpv-table">
        <caption className="rpv-cap">{page.table}</caption>
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }}>Bit</th>
              <th style={{ width: "4.9rem" }}>Field</th>
              <th style={{ width: "3.1rem" }}>Type</th>
              <th style={{ width: "2.6rem" }}>Reset</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {page.fields.map((x, i) => {
              const open = i === at || x.desc.length <= 2;
              const lines = open ? x.desc : x.desc.slice(0, 1);
              return (
                <tr key={i} className={i === at ? "sel" : undefined} onClick={() => choose(i)}>
                  <td>{bitsText(x)}</td>
                  <td>{x.name}</td>
                  <td>{x.type}</td>
                  <td>{x.reset}</td>
                  <td>
                    {lines.map((t, k) => (
                      <span key={k}>{t}</span>
                    ))}
                    {!open && <span className="more">{x.desc.length - 1} more lines: choose {x.name} to read them</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
      </table>
      <figcaption>
        A register page has two halves that say the same thing: the picture of the bits, and the table with one row per field. Choose a field in the picture or a row of the table.{" "}
        <a className="rpv-link" href={`${TRM_URL}#page=${page.page}`} target="_blank" rel="noreferrer">
          Open this page in the manual (page {page.page})
        </a>
      </figcaption>
    </figure>
  );
}
