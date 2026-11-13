import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { device, fieldsOf, hex } from "./device";
import { KITS } from "../sim/world/kits";
import { Figure, FIGURE_IDS, figureMeta } from "./figures";
import { Guard } from "./Markdown";
import { Icon } from "./Icon";
import { usePref } from "./prefs";
import { PARTS } from "./MapView";
import { GLOSSARY } from "../levels/glossary/index";
import { CHAPTERS } from "../levels/index";
import { chapterLabel, type Chapter, type Level } from "../levels/types";
import type { RegInfo } from "../sim/device/device";

export const SECTIONS = ["Glossary", "Key diagrams", "Pins and boards", "Formulas", "Registers"] as const;
export type Section = (typeof SECTIONS)[number];
const ICONS: Record<Section, string> = { Glossary: "book", "Key diagrams": "map", "Pins and boards": "bench", Formulas: "test", Registers: "gear" };

/** Where to land when the handbook is opened from somewhere else. */
export interface HandbookTarget {
  reg?: string;
}

// ---- data, built once ----

const FORMULAS: { what: string; formula: string; source: string }[] = [
  { what: "System clock", formula: "SYSCLK = 200 MHz (5 ns per cycle)", source: "LABstarter, TRM 3.7" },
  { what: "Low-speed peripheral clock", formula: "LSPCLK = SYSCLK / 4 = 50 MHz", source: "TRM 3.7" },
  { what: "CPU timer period", formula: "(PRD + 1) x (TDDRH:TDDR + 1) x 5 ns", source: "TRM 3.8" },
  { what: "ConfigCpuTimer", formula: "PRD = Freq(MHz) x Period(us) - 1", source: "F2837xD_CpuTimers.c" },
  { what: "Serial baud rate", formula: "LSPCLK / ((BRR + 1) x 8)", source: "TRM 19.12" },
  { what: "Port of a GPIO", formula: '"ABCDEF"[GPIO / 32], bit GPIO % 32', source: "TRM 8.9" },
];

type Pin = { kit: string; label: string; pin: number; note: string };
const PINS: Pin[] = Object.values(KITS)
  .filter((k) => k.id !== "launchpad")
  .flatMap((k) =>
    k.parts
      .filter((p): p is Extract<typeof p, { pin: number }> => "pin" in p)
      .map((p) => ({
        kit: k.name,
        label: p.label,
        pin: p.pin,
        note: p.kind === "led" ? (p.activeLow ? "Lights when the pin is low" : "Lights when the pin is high") : "Connects the pin to ground when pressed: needs the pull-up, reads 0 when pressed",
      })),
  );

interface Use {
  level: Level;
  chapter: Chapter;
  index: number;
}
interface FigInfo {
  id: string;
  title: string;
  /** One or two sentences on what the figure shows, when its author wrote them. */
  description?: string;
  /** Levels that embed the figure, in campaign order. */
  uses: Use[];
  /** The map part of the first level that uses it ("More" when none does). */
  topic: string;
}

const UPPER = new Set(["adc", "dac", "pwm", "spi", "i2c", "can", "uart", "imu", "lidar", "hsl", "pi", "sar", "fifo", "gpio", "isr", "pie", "dma", "led", "sci", "lcd", "r2r", "eallow", "1d", "2d", "fsm"]);
/** A figure without a title of its own gets one made from its id ("pwm-clock-tree"). */
const titleOf = (id: string) =>
  id
    .split("-")
    .map((w, i) => (UPPER.has(w) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

let figCache: FigInfo[] | null = null;
function figures(): FigInfo[] {
  if (figCache) return figCache;
  const ordered = [...CHAPTERS].sort((a, b) => a.number - b.number);
  const texts = ordered.flatMap((chapter) => chapter.levels.map((level, index) => ({ use: { level, chapter, index }, text: JSON.stringify(level) })));
  figCache = FIGURE_IDS.map((id) => {
    const uses = texts.filter((t) => t.text.includes(`{{figure:${id}}}`)).map((t) => t.use);
    const n = uses[0]?.chapter.number;
    const topic = n === undefined ? "More" : (PARTS.find((p) => n >= p.from && n <= p.to)?.title ?? "More");
    const meta = figureMeta(id);
    return { id, title: meta.title?.trim() || titleOf(id), description: meta.description?.trim() || undefined, uses, topic };
  }).sort((a, b) => (a.uses[0]?.chapter.number ?? 999) - (b.uses[0]?.chapter.number ?? 999) || a.title.localeCompare(b.title));
  return figCache;
}
/** A diagram matches a search by its title, its description, its id or a level that uses it. */
const figMatches = (f: FigInfo, s: string) => f.title.toLowerCase().includes(s) || !!f.description?.toLowerCase().includes(s) || f.id.includes(s) || f.uses.some((u) => u.level.title.toLowerCase().includes(s));
const levelName = (u: Use) => `${chapterLabel(u.chapter)}.${u.index + 1} ${u.level.title}`;

let periphCache: Map<string, RegInfo[]> | null = null;
function peripherals(): Map<string, RegInfo[]> {
  if (periphCache) return periphCache;
  periphCache = new Map();
  for (const r of device().regs.values()) {
    const p = r.name.split(".")[0];
    const list = periphCache.get(p);
    if (list) list.push(r);
    else periphCache.set(p, [r]);
  }
  return periphCache;
}

/** Scroll position of every handbook view, kept while the game is open. */
const SCROLL = new Map<string, number>();

// ---- sections ----

function Glossary({ open, q, setQ }: { open: (id: string) => void; q: string; setQ: (q: string) => void }) {
  const s = q.trim().toLowerCase();
  const shown = GLOSSARY.filter((g) => !s || g.term.toLowerCase().includes(s) || g.meaning.toLowerCase().includes(s));
  const levels = useMemo(() => new Map(CHAPTERS.flatMap((chapter) => chapter.levels.map((level, index) => [level.id, { level, chapter, index }] as const))), []);
  return (
    <div className="glossary">
      <h1>Glossary</h1>
      <p className="hint-text">The words this course uses, in plain language.</p>
      <label className="sr-only" htmlFor="glossary-search">Filter the glossary</label>
      <input id="glossary-search" type="search" placeholder={`Filter ${GLOSSARY.length} terms`} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="hint-text" role="status">
        {GLOSSARY.length === 0 ? "No terms have been added yet." : shown.length === 0 ? `No term or meaning contains "${q}".` : s ? `${shown.length} of ${GLOSSARY.length} terms.` : ""}
      </p>
      <dl>
        {shown.map((g) => {
          const at = g.level ? levels.get(g.level) : undefined;
          return (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>
                {g.meaning}{" "}
                {at && (
                  <button className="linkish" onClick={() => open(at.level.id)}>
                    Practise it: {levelName(at)}
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * A small, still picture of a figure for its card: the real figure, drawn
 * at a third of its size, only while the card is near the screen (a
 * hundred live figures at once would be slow). It cannot be operated or
 * focused: the card's button opens the figure itself.
 */
function CardPreview({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const seen = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: "400px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <div className="hb-card-preview" ref={box} aria-hidden="true" inert>
      {near && (
        <div className="hb-card-preview-inner">
          <Figure id={id} />
        </div>
      )}
    </div>
  );
}

function Diagrams({ open, fig, setFig }: { open: (id: string) => void; fig: string; setFig: (id: string) => void }) {
  const all = figures();
  const [topic, setTopic] = usePref<string>("hb-topic", "");
  const [q, setQ] = usePref<string>("hb-fq", "");
  const topics = useMemo(() => [...new Set(all.map((f) => f.topic))], [all]);
  const s = q.trim().toLowerCase();
  const shown = all.filter((f) => (!topic || f.topic === topic) && (!s || figMatches(f, s) || f.uses.some((u) => u.chapter.title.toLowerCase().includes(s))));
  const cur = all.find((f) => f.id === fig);
  // Coming back from one diagram: the card it was opened from has the focus again.
  const back = useRef("");
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cur && back.current) {
      grid.current?.querySelector<HTMLElement>(`[data-figure="${back.current}"]`)?.focus({ preventScroll: true });
      back.current = "";
    }
  }, [cur]);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (cur) title.current?.focus();
  }, [cur?.id]);

  if (cur) {
    const list = shown.includes(cur) ? shown : all;
    const i = list.indexOf(cur);
    const go = (f: FigInfo | undefined) => f && setFig(f.id);
    return (
      <div className="hb-figure">
        <div className="hb-figure-bar">
          <button
            className="btn small"
            onClick={() => {
              back.current = cur.id;
              setFig("");
            }}
          >
            <Icon name="back" size={14} /> All diagrams
          </button>
          <span className="spacer" />
          <span className="hint-text">{i + 1} of {list.length}</span>
          <button className="btn small" disabled={i <= 0} onClick={() => go(list[i - 1])} title={i > 0 ? list[i - 1].title : "This is the first diagram"}>
            <Icon name="back" size={14} /> Previous
          </button>
          <button className="btn small" disabled={i >= list.length - 1} onClick={() => go(list[i + 1])} title={i < list.length - 1 ? list[i + 1].title : "This is the last diagram"}>
            Next <Icon name="next" size={14} />
          </button>
        </div>
        <h1 ref={title} tabIndex={-1}>{cur.title}</h1>
        {cur.description && <p className="hb-figure-desc">{cur.description}</p>}
        <p className="hint-text">
          {cur.uses.length === 0 ? "Not used in a level yet." : "Used in: "}
          {cur.uses.map((u, k) => (
            <span key={u.level.id}>
              {k > 0 && ", "}
              <button className="linkish" onClick={() => open(u.level.id)}>{levelName(u)}</button>
            </span>
          ))}
        </p>
        <Guard key={cur.id} what="This figure">
          <Figure id={cur.id} />
        </Guard>
      </div>
    );
  }
  return (
    <div className="hb-diagrams">
      <h1>Key diagrams</h1>
      <p className="hint-text">Every interactive figure of the game. Open one to try it on its own.</p>
      <div className="hb-filter">
        <label className="sr-only" htmlFor="diagram-search">Filter the diagrams</label>
        <input id="diagram-search" type="search" placeholder={`Filter ${all.length} diagrams`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="weeks" role="group" aria-label="Show the diagrams of one topic">
          {["", ...topics].map((t) => (
            <button key={t} className="week" aria-pressed={topic === t} onClick={() => setTopic(t)}>
              {t || "All"}
            </button>
          ))}
        </div>
      </div>
      <p className="hint-text" role="status">{shown.length === all.length ? "" : shown.length === 0 ? "No diagram matches." : `${shown.length} of ${all.length} diagrams.`}</p>
      <div className="hb-grid" ref={grid}>
        {shown.map((f) => (
          <div key={f.id} className="hb-card-wrap" onClick={() => setFig(f.id)}>
            <CardPreview id={f.id} />
            <button className="hb-card" data-figure={f.id} onClick={(e) => (e.stopPropagation(), setFig(f.id))}>
              <span className="hb-card-title">{f.title}</span>
              {f.description && <span className="hb-card-desc">{f.description}</span>}
              <span className="hb-card-use">{f.uses[0] ? `First used in ${levelName(f.uses[0])}` : "Not used in a level yet"}</span>
              <span className="tag">{f.uses[0] ? `Chapter ${chapterLabel(f.uses[0].chapter)} · ${f.uses[0].chapter.title}` : "More"}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegisterDetail({ reg }: { reg: RegInfo }) {
  return (
    <>
      <h2 className="mono regname">{reg.name}</h2>
      <p className="hint-text">
        {reg.desc} {reg.words * 16} bits at address {hex(reg.addr, 16)}.{reg.hook.protect ? " EALLOW-protected: write it between EALLOW; and EDIS;." : ""}
      </p>
      {reg.fields.length > 0 ? (
        <div className="table-scroll">
          <table className="fields">
            <thead>
              <tr><th scope="col">Field</th><th scope="col">Bits</th><th scope="col">Description</th><th scope="col">In C</th></tr>
            </thead>
            <tbody>
              {[...fieldsOf(reg)].reverse().filter((f) => !f.reserved).map((f) => (
                <tr key={f.name}>
                  <td className="mono">{f.name}</td>
                  <td className="mono">{f.hi === f.lo ? f.hi : `${f.hi}:${f.lo}`}</td>
                  <td>{f.desc}</td>
                  <td className="mono">{reg.name}.bit.{f.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>This register has no named fields: use it as a whole value{/Vect/.test(reg.name) ? " (a pointer to an interrupt function)" : ""}.</p>
      )}
    </>
  );
}

/** Peripheral, then register, then fields: only one peripheral's registers are ever in the page. */
function Registers({ sel, setSel, q, setQ }: { sel: string; setSel: (name: string) => void; q: string; setQ: (q: string) => void }) {
  const all = peripherals();
  const [periphPref, setPeriph] = usePref<string>("hb-periph", "GpioDataRegs");
  const s = useDeferredValue(q).trim().toLowerCase();
  const hit = (r: RegInfo) => !s || r.name.toLowerCase().includes(s) || r.fields.some((f) => f.name.toLowerCase().includes(s));
  const names = useMemo(() => [...all.keys()].filter((p) => !s || all.get(p)!.some(hit)), [all, s]);
  // A register chosen elsewhere (a search result, a link from a level) brings its peripheral with it.
  useEffect(() => {
    const p = sel.split(".")[0];
    if (sel && all.has(p)) setPeriph(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  const periph = names.includes(periphPref) ? periphPref : (names[0] ?? "");
  const regs = (all.get(periph) ?? []).filter(hit);
  const reg = regs.find((r) => r.name === sel) ?? device().regs.get(sel);
  const shownReg = reg && reg.name.split(".")[0] === periph ? reg : undefined;
  const total = device().regs.size;
  return (
    <div className="hb-regs">
      <div className="hb-regs-head">
        <h1>Registers</h1>
        <label className="sr-only" htmlFor="reg-filter">Filter registers and fields by name</label>
        <input id="reg-filter" type="search" placeholder={`Filter ${total} registers and their fields, for example TBCTL or GPIO22`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <nav className="hb-col" aria-label="Peripherals">
        <h2 className="eyebrow">Peripherals ({names.length})</h2>
        {names.length === 0 && <p className="hint-text" role="status">No register or field name contains "{q}".</p>}
        {names.map((p) => (
          <button key={p} aria-current={p === periph ? "true" : undefined} onClick={() => setPeriph(p)}>
            {p} <span className="count">{s ? all.get(p)!.filter(hit).length : all.get(p)!.length}</span>
          </button>
        ))}
      </nav>
      <nav className="hb-col" aria-label={`Registers of ${periph}`}>
        <h2 className="eyebrow">{periph ? `${periph} (${regs.length})` : "Registers"}</h2>
        {regs.map((r) => (
          <button key={r.name} aria-current={r.name === shownReg?.name ? "true" : undefined} title={r.name} data-reg={r.name} onClick={() => setSel(r.name)}>
            {r.name.slice(periph.length + 1)}
          </button>
        ))}
      </nav>
      <div className="hb-col hb-reg-detail" tabIndex={-1}>
        {shownReg ? <RegisterDetail reg={shownReg} /> : <p className="hint-text">Choose a peripheral, then one of its registers, to see its fields. In C a field is written as <code>Peripheral.REGISTER.bit.FIELD</code>.</p>}
      </div>
    </div>
  );
}

function Pins() {
  const kits = [...new Set(PINS.map((p) => p.kit))];
  return (
    <>
      <h1>Pins and boards</h1>
      <p className="hint-text">What is wired to which pin on the course boards.</p>
      {kits.map((k) => (
        <section key={k}>
          <h2>{k}</h2>
          <div className="table-scroll">
            <table className="fields">
              <thead>
                <tr><th scope="col">Part</th><th scope="col">GPIO</th><th scope="col">Port</th><th scope="col">Notes</th></tr>
              </thead>
              <tbody>
                {PINS.filter((p) => p.kit === k).map((p) => (
                  <tr key={p.label + p.pin}>
                    <td>{p.label}</td>
                    <td className="mono">GPIO{p.pin}</td>
                    <td className="mono">{"ABCDEF"[p.pin >> 5]} (bit {p.pin & 31})</td>
                    <td>{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function Formulas() {
  return (
    <>
      <h1>Formulas</h1>
      <div className="table-scroll">
        <table className="fields">
          <thead>
            <tr><th scope="col">What</th><th scope="col">Formula</th><th scope="col">Source</th></tr>
          </thead>
          <tbody>
            {FORMULAS.map((f) => (
              <tr key={f.what}><td>{f.what}</td><td className="mono">{f.formula}</td><td>{f.source}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- search across every section ----

const CAP = 12;
interface Hit {
  label: string;
  note?: string;
  go: () => void;
}

function Results({ q, groups }: { q: string; groups: { title: string; hits: Hit[]; total: number }[] }) {
  const n = groups.reduce((s, g) => s + g.total, 0);
  return (
    <div className="hb-results">
      <h1>Results for "{q}"</h1>
      <p className="hint-text" role="status">{n === 0 ? "Nothing in the handbook matches. Try a shorter word, a register name such as TBCTL, or a pin such as GPIO22." : `${n} match${n === 1 ? "" : "es"} in ${groups.filter((g) => g.total).length} section${groups.filter((g) => g.total).length === 1 ? "" : "s"}.`}</p>
      {groups.filter((g) => g.total > 0).map((g) => (
        <section key={g.title}>
          <h2>{g.title} <span className="count">{g.total}</span></h2>
          <ul>
            {g.hits.map((h, i) => (
              <li key={i}>
                <button className="hb-hit" onClick={h.go}>
                  <span>{h.label}</span>
                  {h.note && <span className="hint-text">{h.note}</span>}
                </button>
              </li>
            ))}
          </ul>
          {g.total > g.hits.length && <p className="tiny">Showing {g.hits.length} of {g.total}: type more to narrow it down.</p>}
        </section>
      ))}
    </div>
  );
}

export function Handbook({ open, at }: { open: (id: string) => void; at?: HandbookTarget }) {
  const [sectionPref, setSection] = usePref<Section>("hb-section", "Key diagrams");
  const section = SECTIONS.includes(sectionPref) ? sectionPref : "Key diagrams";
  const [q, setQ] = usePref<string>("hb-q", "");
  /** True while the search results are showing (a result or a section was not chosen since the last typing). */
  const [results, setResults] = usePref<boolean>("hb-results", false);
  const [fig, setFig] = usePref<string>("hb-figure", "");
  const [reg, setReg] = usePref<string>("hb-reg", "");
  const [gq, setGq] = usePref<string>("hb-gq", "");
  const [rq, setRq] = usePref<string>("hb-rq", "");
  const showReg = (name: string) => {
    setReg(name);
    setRq("");
  };
  const searching = results && q.trim().length > 0;

  // Opened from a level ("Open ... in the handbook"): land on that register.
  useEffect(() => {
    if (!at?.reg || !device().regs.has(at.reg)) return;
    setSection("Registers");
    showReg(at.reg);
    setResults(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.reg]);

  // Each view scrolls on its own and comes back where it was left.
  const view = searching ? "search" : section === "Key diagrams" && fig ? `figure:${fig}` : section;
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = view.startsWith("figure:") ? 0 : (SCROLL.get(view) ?? 0);
  }, [view]);

  const goto = (s: Section, then?: () => void) => () => {
    setSection(s);
    setResults(false);
    then?.();
  };
  const s = useDeferredValue(q).trim().toLowerCase();
  const groups = useMemo(() => {
    if (!s) return [];
    const cap = <T,>(all: T[], hit: (x: T) => Hit) => ({ hits: all.slice(0, CAP).map(hit), total: all.length });
    const regs = [...device().regs.values()];
    const fields: { r: RegInfo; f: string; desc: string }[] = [];
    for (const r of regs) for (const f of r.fields) if (f.name.toLowerCase().includes(s)) fields.push({ r, f: f.name, desc: f.desc ?? "" });
    return [
      { title: "Glossary", ...cap(GLOSSARY.filter((g) => g.term.toLowerCase().includes(s) || g.meaning.toLowerCase().includes(s)), (g) => ({ label: g.term, note: g.meaning, go: goto("Glossary", () => setGq(g.term)) })) },
      { title: "Key diagrams", ...cap(figures().filter((f) => figMatches(f, s)), (f) => ({ label: f.title, note: f.description ?? (f.uses[0] ? `Used in ${levelName(f.uses[0])}` : undefined), go: goto("Key diagrams", () => setFig(f.id)) })) },
      { title: "Pins and boards", ...cap(PINS.filter((p) => `${p.label} gpio${p.pin} ${p.kit}`.toLowerCase().includes(s)), (p) => ({ label: `${p.label}: GPIO${p.pin}`, note: `${p.kit}. ${p.note}`, go: goto("Pins and boards") })) },
      { title: "Formulas", ...cap(FORMULAS.filter((f) => `${f.what} ${f.formula}`.toLowerCase().includes(s)), (f) => ({ label: f.what, note: f.formula, go: goto("Formulas") })) },
      { title: "Registers", ...cap(regs.filter((r) => r.name.toLowerCase().includes(s)), (r) => ({ label: r.name, note: r.desc, go: goto("Registers", () => showReg(r.name)) })) },
      { title: "Register fields", ...cap(fields, (x) => ({ label: `${x.r.name}.bit.${x.f}`, note: x.desc, go: goto("Registers", () => showReg(x.r.name)) })) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  let body: ReactNode;
  if (searching) body = <Results q={q.trim()} groups={groups} />;
  else if (section === "Glossary") body = <Glossary open={open} q={gq} setQ={setGq} />;
  else if (section === "Key diagrams") body = <Diagrams open={open} fig={fig} setFig={setFig} />;
  else if (section === "Pins and boards") body = <Pins />;
  else if (section === "Formulas") body = <Formulas />;
  else body = <Registers sel={reg} setSel={setReg} q={rq} setQ={setRq} />;

  return (
    <div className="handbook">
      <nav className="hb-nav" aria-label="Handbook">
        <label className="sr-only" htmlFor="hb-search">Search the whole handbook</label>
        <input
          id="hb-search"
          type="search"
          placeholder="Search the handbook"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setResults(true);
          }}
        />
        {q.trim() && !results && (
          <button className="linkish hb-back" onClick={() => setResults(true)}>Back to the results for "{q.trim()}"</button>
        )}
        <div className="hb-sections">
          {SECTIONS.map((x) => (
            <button key={x} aria-current={!searching && section === x ? "page" : undefined} onClick={goto(x, x === "Key diagrams" && section === x ? () => setFig("") : undefined)}>
              <Icon name={ICONS[x]} size={15} /> {x}
            </button>
          ))}
        </div>
      </nav>
      <div
        className={`hb-content ${!searching && section === "Registers" ? "fixed" : ""}`}
        ref={content}
        role="region"
        aria-label={searching ? "Search results" : section}
        tabIndex={0}
        onScroll={(e) => SCROLL.set(view, e.currentTarget.scrollTop)}
      >
        {body}
      </div>
    </div>
  );
}
