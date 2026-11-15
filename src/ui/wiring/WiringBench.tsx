// The wiring bench of the Sandbox's homework board: the real board with its
// parts, a fault switch for each, and devices to attach to free pins.
// docs/WIRING.md describes it. Its styles are in this file (prefix "wb-").
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollBox } from "../ScrollBox";
import { usePanelSize } from "../Panel";
import { frameBus, useFrame } from "../code/frame";
import { benchLink } from "../../sim/wiring/active";
import { HW_BOARD } from "../../sim/wiring/board";
import {
  MAX_ADDED, PART_DEFS, addDevice, benchView, checkBench, connect, connectionWords, describeBench, emptyBench, faultCount, optionsOf, parseBench, pinChoices, removeDevice,
  serializeBench, setInput, setOption, statusOf, wiringCsv, wiringTable,
} from "../../sim/wiring/bench";
import { schematic } from "../../sim/wiring/schematic";
import type { BenchState, BenchView, Inst, InputDef } from "../../sim/wiring/types";
import { highlightOf, netKind, partNets, pinRows, type NetKind, type Pick } from "../../sim/wiring/nets";
import { BoardPicture, Legend } from "./BoardPicture";
import { benchStore as benchStoreOfSandbox, download, lessonStore, useBench, type BenchStore } from "./store";

const ZOOMS = [1, 1.5, 2, 3, 4.5, 6];
const SEVERITY = { error: "Error", warning: "Warning", info: "Note" } as const;

const CSS = `
.wb { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.6rem; font-size: var(--fs-2); min-width: 0; }
.wb > * { min-width: 0; }
.wb p { margin: 0; }
.wb-bar { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.wb-bar .spacer { flex: 1 1 0; }
.wb-count { border: 1px solid var(--control); border-radius: 4px; padding: 0.1em 0.5em; font-weight: 680; }
.wb-count.some { border-style: dashed; }
/* Under half the window's height, so the picture's box is never taken for the pane that scrolls the page. */
.wb-scroll { overflow: auto; max-height: min(26rem, 46vh); border: 1px solid var(--border); border-radius: var(--radius); background: var(--inset); }
.wb[data-size="wide"] .wb-scroll { max-height: 46vh; }
.wb[data-size="large"] .wb-scroll { max-height: calc(100vh - 16rem); }
/* The picture's size never widens what is around it: the box takes its width from the panel alone. */
.wb-box { width: 0; min-width: 100%; }
.wb-board { display: block; font-family: var(--sans); }
.wb-part { cursor: pointer; }
.wb-stage { position: relative; margin: 0 auto; }
.wb-focus { position: absolute; transform: translate(-50%, -50%); background: transparent; border: 0; padding: 0; border-radius: 4px; cursor: pointer; }
.wb-focus:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
.wb-info { border-left: 3px solid var(--focus); padding: 0.25rem 0.5rem; background: var(--surface); border-radius: 0 6px 6px 0; min-height: 2.9em; overflow-wrap: anywhere; }
.wb-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.2rem 0.9rem; color: var(--dim); font-size: var(--fs-1); }
.wb-legend li { display: inline-flex; align-items: center; gap: 0.35rem; }
.wb-swatch { flex: none; border: 1px solid var(--border); border-radius: 3px; }
.wb-sort { background: none; border: 0; padding: 0; font: inherit; color: inherit; font-weight: 680; text-decoration: underline; min-height: 1.5rem; min-width: 1.5rem; }
.wb-filter { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; }
.wb-filter input[type="search"] { min-width: 0; width: 11rem; max-width: 100%; font: inherit; min-height: 1.9rem; }
.wb-halo { paint-order: stroke; stroke: var(--pcb); stroke-width: 0.6px; stroke-linejoin: round; }
.wb-row { display: grid; grid-template-columns: minmax(6rem, 11rem) minmax(0, 1fr); gap: 0.5rem; align-items: center; }
.wb-row select, .wb-pick select { min-width: 0; max-width: 100%; font: inherit; }
.wb-pick { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.5rem; align-items: center; font-weight: 680; }
.wb-card { display: grid; gap: 0.45rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.6rem 0.7rem; min-width: 0; }
.wb-card h4 { margin: 0; font-size: var(--fs-3); }
.wb-card .wb-kind { color: var(--dim); font-weight: 400; font-size: var(--fs-2); }
.wb-now strong { color: var(--value); }
.wb-why { border-left: 3px solid var(--value); padding: 0.25rem 0.5rem; background: var(--inset); border-radius: 0 6px 6px 0; overflow-wrap: anywhere; }
.wb-slider { display: grid; grid-template-columns: minmax(6rem, 11rem) minmax(3rem, 1fr) minmax(4.5rem, auto); gap: 0.5rem; align-items: center; }
.wb-slider input { width: 100%; padding: 0; min-height: 1.5rem; }
.wb-slider output { font-family: var(--mono); text-align: right; color: var(--value); }
.wb-check { display: inline-flex; gap: 0.4rem; align-items: center; min-height: 1.75rem; }
.wb-check input { width: 1.15rem; height: 1.15rem; }
.wb-issues { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.3rem; }
.wb-issues li { border: 1px solid var(--border); border-left-width: 3px; border-radius: 0 6px 6px 0; padding: 0.3rem 0.5rem; overflow-wrap: anywhere; }
.wb-issues li.error { border-color: var(--bad); border-left-style: double; border-left-width: 5px; }
.wb-issues li.warning { border-left-color: var(--value); border-left-style: dashed; }
.wb details { border: 1px solid var(--border); border-radius: var(--radius); padding: 0.35rem 0.6rem; }
.wb details[open] > summary { margin-bottom: 0.45rem; }
.wb summary { font-weight: 680; min-height: 1.6rem; }
.wb-stack { display: grid; gap: 0.5rem; min-width: 0; }
.wb-tablebox { overflow-x: auto; }
.wb table { border-collapse: collapse; width: 100%; }
.wb th, .wb td { text-align: left; padding: 0.2rem 0.45rem; border-bottom: 1px solid var(--border); vertical-align: top; }
.wb th { color: var(--dim); font-size: var(--fs-1); }
.wb-words { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; overflow-wrap: anywhere; }
.wb-sch { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--inset); color: var(--text); }
.wb-sch svg { display: block; max-width: none; }
.wb-sch .sch-box { fill: var(--surface); stroke: currentColor; stroke-width: 1.5; }
.wb-sch .sch-wire { fill: none; stroke: currentColor; stroke-width: 1.5; }
.wb-sch .sch-open { stroke: currentColor; stroke-width: 1.5; stroke-dasharray: 4 3; }
.wb-sch .sch-title { font: 680 13px var(--sans); fill: currentColor; }
.wb-sch .sch-text, .wb-sch .sch-rail { font: 12px var(--sans); fill: currentColor; }
.wb-sch .sch-rail { font-weight: 680; }
.wb-file { position: absolute; width: 1px; height: 1px; opacity: 0; }
.wb-file:focus-visible + span { outline: 2px solid var(--focus); outline-offset: 2px; }
.wb-dim { color: var(--dim); }
/* This panel stands above the bench's own panels, so its large view needs saying twice: show it, hide those. */
.bench:has(> .panel.size-large[data-panel="wiring-bench"]) > .panel[data-panel="wiring-bench"] { display: flex; }
.bench:has(> .panel.size-large[data-panel="wiring-bench"]) > .bench-panels { display: none; }
@container (min-width: 56rem) {
  .wb[data-size="large"] { grid-template-columns: minmax(0, 3fr) minmax(19rem, 2fr); column-gap: 0.9rem; align-content: start; }
  .wb[data-size="large"] > * { grid-column: 2; }
  .wb[data-size="large"] > .wb-box { grid-column: 1; grid-row: 1 / span 12; }
}
@media (any-pointer: coarse) {
  .wb summary, .wb-check, .wb-slider input, .wb-sort, .wb-filter input[type="search"] { min-height: 44px; min-width: 44px; }
  .wb-focus { min-width: 44px; min-height: 44px; }
  .wb summary { display: flex; align-items: center; gap: 0.4rem; }
  .wb-check input { width: 1.6rem; height: 1.6rem; }
}
@container (max-width: 26rem) {
  .wb-row, .wb-slider { grid-template-columns: minmax(0, 1fr); gap: 0.15rem; }
  .wb-slider output { text-align: left; }
}
`;

const HELP = [
  "This is the homework board as you solder it: the LaunchPad, the 16 LEDs behind their inverter chips, four push buttons, the buzzer and its jumper, the joystick, the photoresistor, two servo connectors with the battery pack, and the IMU with its jumpers.",
  "Choose a part in the list, or click it in the picture. The card shows which pin it is on and what it is doing now. Move its sliders while your program runs.",
  "A push button can be held in the picture: press the mouse on it, or move to it with the arrow keys and hold Space. The Hold button on its card does the same.",
  "Point at a part, a pad or a LaunchPad pin to light up everything joined to it: the copper on the board, every pad of it and the LaunchPad pin, with its name. A click or a tap keeps it lit; Escape clears it. A pin with nothing on it is free for a device of yours.",
  "With the keyboard, Tab to the picture. The parts are one group and the LaunchPad's pins another: the arrow keys move inside each, and the sentence under the picture says what you are on. The table of pins says the same.",
  "Each part has fault switches: not soldered, reversed, a jumper off. Switch one on, run your program and read the symptom. That is how you find the same fault on your own board.",
  "Add a device to try a part of your own project. For each of its terminals choose a free pin or a supply. The bench tells you when a choice cannot work, and why.",
  "The bench follows simple rules for each part. It does not compute currents. Confirm on the real board.",
];

function useLive(): boolean {
  // Frames arrive while a program runs or is paused, and stop when it stops.
  const [live, setLive] = useState(false);
  const last = useRef(0);
  useEffect(
    () =>
      frameBus.subscribe(() => {
        last.current = performance.now();
        setLive(true);
      }),
    [],
  );
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => performance.now() - last.current > 600 && setLive(false), 300);
    return () => clearInterval(t);
  }, [live]);
  return live;
}

function Slider({ d, value, onChange }: { d: InputDef; value: number; onChange: (v: number) => void }) {
  const shown = `${Number.isInteger(d.step ?? 1) ? value.toFixed(0) : value.toFixed(2)} ${d.unit ?? ""}`.trim();
  return (
    <label className="wb-slider">
      <span>{d.label}</span>
      <input type="range" min={d.min} max={d.max} step={d.step} value={value} aria-valuetext={shown} onChange={(e) => onChange(+e.target.value)} />
      <output>{shown}</output>
    </label>
  );
}

function Hold({ label, down, enabled, onHold }: { label: string; down: boolean; enabled: boolean; onHold: (down: boolean) => void }) {
  return (
    <button
      className="btn small"
      aria-pressed={down}
      disabled={!enabled}
      title={enabled ? undefined : "Run a program first"}
      onPointerDown={() => onHold(true)}
      onPointerUp={() => onHold(false)}
      onPointerLeave={() => down && onHold(false)}
      onPointerCancel={() => down && onHold(false)}
      onBlur={() => down && onHold(false)}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && onHold(true)}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && onHold(false)}
    >
      {label}
    </button>
  );
}

function Card({ i, view, state, live, store }: { i: Inst; view: BenchView; state: BenchState; live: boolean; store: BenchStore }) {
  const benchStore = store;
  const touched = store.touched?.();
  const s = statusOf(i, view);
  const choices = useMemo(() => (i.part ? [] : pinChoices(state, i.id)), [state, i.id, i.part]);
  const held = (view.mem(i).held ?? 0) > 0;
  return (
    <section className="wb-card" aria-label={`${i.label}: details`} data-card={i.id}>
      <h4>
        {i.label} <span className="wb-kind">{i.def.name}</span>
      </h4>
      <p className="wb-dim">{i.def.description}</p>
      {i.part && i.def.terminals.length > 0 && <p>Connected: {connectionWords(i)}.</p>}
      <p className="wb-now">
        Now: <strong data-now={i.id}>{s.text}</strong>
      </p>
      {s.why && <p className="wb-why">{s.why}</p>}
      {!i.part &&
        i.def.terminals.map((d) => {
          const to = i.conn[d.id];
          const used = choices.find((c) => c.target === to)?.usedBy ?? [];
          return (
            <label key={d.id} className="wb-row">
              <span>{d.name} goes to</span>
              <select value={to} onChange={(e) => benchStore.set(connect(state, i.id, d.id, e.target.value))} data-terminal={d.id} aria-describedby={used.length ? `wb-used-${i.id}-${d.id}` : undefined}>
                <option value="">Not connected</option>
                <optgroup label="Supplies">
                  {choices.filter((c) => !/^(GPIO|ADC)/.test(c.target)).map((c) => <option key={c.target} value={c.target}>{c.words}</option>)}
                </optgroup>
                <optgroup label="Free pins">
                  {choices.filter((c) => /^(GPIO|ADC)/.test(c.target) && !c.usedBy.length).map((c) => <option key={c.target} value={c.target}>{c.words}</option>)}
                </optgroup>
                <optgroup label="Pins already in use">
                  {choices.filter((c) => c.usedBy.length).map((c) => <option key={c.target} value={c.target}>{c.words}: used by {c.usedBy.join(", ")}</option>)}
                </optgroup>
              </select>
              {used.length > 0 && <span id={`wb-used-${i.id}-${d.id}`} className="wb-dim" style={{ gridColumn: "1 / -1" }}>In use: {to} is also on {used.join(", ")}.</span>}
            </label>
          );
        })}
      {optionsOf(i).map((o) =>
        touched ? (
          // In a level the switches are repairs: they start neutral and do not show how the board is.
          <label key={o.id} className="wb-row">
            <span>Repair: {o.label.toLowerCase()}</span>
            <select value={touched[i.id]?.[o.id] ?? ""} data-option={o.id} onChange={(e) => store.repair?.(i.id, o.id, e.target.value)}>
              <option value="">Leave as it is</option>
              {o.choices.map((c) => <option key={c.id} value={c.id}>Make it: {c.label}</option>)}
            </select>
          </label>
        ) : (
          <label key={o.id} className="wb-row">
            <span>{o.label}{o.fault ? " (fault switch)" : ""}</span>
            <select value={i.opts[o.id]} data-option={o.id} onChange={(e) => benchStore.set(setOption(state, i.id, o.id, e.target.value))}>
              {o.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        ),
      )}
      {(i.def.inputs ?? []).map((d) =>
        d.kind === "range" ? (
          <Slider key={d.id} d={d} value={i.inputs[d.id]} onChange={(v) => benchStore.set(setInput(state, i.id, d.id, v), `${i.id}.${d.id}`)} />
        ) : d.kind === "toggle" ? (
          <label key={d.id} className="wb-check">
            <input type="checkbox" checked={!!i.inputs[d.id]} onChange={(e) => benchStore.set(setInput(state, i.id, d.id, e.target.checked ? 1 : 0))} />
            {d.label}
          </label>
        ) : (
          <div key={d.id}>
            <Hold label={d.label} down={held} enabled={live} onHold={(down) => benchLink.engine?.press(i.id, down)} />
          </div>
        ),
      )}
      {!i.part && (
        <div>
          <button className="btn small" onClick={() => benchStore.set(removeDevice(state, i.id))}>Remove {i.label}</button>
        </div>
      )}
    </section>
  );
}

const HELP_LESSON = [
  "Something on this board is wrong, and the page does not say what. Run the program and look.",
  "Choose a part in the list, or click it in the picture. While the program runs, its card says what the part is doing and, if it is not doing what the pin asks, why.",
  "Point at a part or a LaunchPad pin to light up what it is joined to. The messages under the editor name faults the program runs into.",
  "Repair what you found with the part's Repair lists. They start at \"Leave as it is\" and do not show how the board is. Then press Run tests.",
];

/**
 * The bench panel. In the Sandbox it shows the student's own saved bench. With `lesson` it is the bench of one
 * fault-finding level: the faults are not shown until a running program reveals them, and nothing is saved.
 */
export function WiringBench({ lesson }: { lesson?: { faults: Record<string, Record<string, string>> } }) {
  const benchStore = useMemo((): BenchStore => (lesson ? lessonStore(lesson.faults) : benchStoreOfSandbox), [lesson]);
  const real = useBench(benchStore);
  const L = !!lesson;
  useFrame();
  const live = useLive();
  const size = usePanelSize();
  const [selected, setSelected] = useState("LED1");
  /** What stays lit up (a click, a tap, a key), and what the mouse is passing over. */
  const [pick, setPick] = useState<Pick | null>({ t: "part", id: "LED1" });
  const [hover, setHover] = useState<Pick | null>(null);
  const [allRoutes, setAllRoutes] = useState(false);
  const [pinFilter, setPinFilter] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [pinSort, setPinSort] = useState<"number" | "name" | "users">("number");
  const [zoom, setZoom] = useState(0);
  const [kind, setKind] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);

  // The Sandbox's homework board gets a bench while this is on the screen.
  useEffect(() => {
    benchStore.enable(true);
    return () => benchStore.enable(false);
  }, [benchStore]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 4)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const engine = live ? benchLink.engine : null;
  // In a level, with no program running, the board is shown as if nothing were wrong.
  const state = useMemo((): BenchState => (L ? { ...emptyBench(), inputs: real.inputs } : real), [L, real]);
  const view: BenchView = engine ?? benchView(state, null);
  const list = view.all();
  const sel = list.find((i) => i.id === selected) ?? list[0];
  const issues = useMemo(() => checkBench(state), [state]);
  const faults = faultCount(state);
  const px = (width / HW_BOARD.w) * ZOOMS[zoom];
  const pictured = list.map((inst) => ({ inst, status: statusOf(inst, view) }));
  const table = wiringTable(state);
  const sch = useMemo(() => schematic(state), [state]);
  const addable = PART_DEFS.filter((d) => d.addable);
  const chosen = addable.find((d) => d.kind === kind) ?? addable[0];
  const changed = L ? Object.values(benchStore.touched?.() ?? {}).some((o) => Object.keys(o).length > 0) : serializeBench(state) !== serializeBench(emptyBench());
  const choose = (id: string) => {
    setSelected(id);
    setPick({ t: "part", id });
  };
  const onPick = (p: Pick | null, keep: boolean) => {
    if (!keep) return setHover(p);
    setHover(null);
    setPick(p);
    if (p?.t === "part") setSelected(p.id);
  };
  const shown = hover ?? pick;
  const light = useMemo(() => (shown ? highlightOf(state, shown) : null), [state, shown]);
  const shownPart = shown?.t === "part" ? list.find((i) => i.id === shown.id) : undefined;
  // Every net something is on, with how it is used.
  const routes = useMemo((): [number, NetKind][] => {
    if (!allRoutes) return [];
    const all = benchView(state, null).all();
    const nets = new Set(all.filter((i) => !i.part || i.opts.fitted !== "no").flatMap((i) => partNets(i).near));
    return [...nets].map((n): [number, NetKind | null] => [n, netKind(all, n)]).filter((x): x is [number, NetKind] => x[1] !== null);
  }, [state, allRoutes]);
  const pins = useMemo(() => {
    const q = pinFilter.trim().toLowerCase();
    const rows = pinRows(state).filter((r) => (!freeOnly || ((r.type === "GPIO" || r.type === "ADC") && !r.users.length)) && (!q || `${r.number} ${r.header} ${r.name} ${r.type} ${r.users.join(" ")} ${r.pwm.join(" ")}`.toLowerCase().includes(q)));
    return rows.sort((a, b) => (pinSort === "name" ? a.name.localeCompare(b.name, "en", { numeric: true }) : pinSort === "users" ? b.users.length - a.users.length : 0) || a.number - b.number);
  }, [state, pinFilter, freeOnly, pinSort]);

  const add = () => {
    const next = addDevice(state, chosen.kind);
    if (next === state) return;
    benchStore.set(next);
    const made = next.added[next.added.length - 1];
    choose(made.id);
    setSaid(`${made.label} added. Choose where each of its terminals goes.`);
  };
  const load = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const next = parseBench(text);
    let ok = false;
    try {
      ok = JSON.parse(text)?.v === 1;
    } catch {
      ok = false;
    }
    if (!ok) return setSaid("That file is not a bench file. Nothing was changed.");
    benchStore.set(next);
    setSaid(`Bench loaded: ${next.added.length} attached ${next.added.length === 1 ? "device" : "devices"}, ${faultCount(next)} ${faultCount(next) === 1 ? "fault" : "faults"}.`);
  };

  return (
    <div
      className="wb"
      data-size={size}
      data-live={live ? "yes" : "no"}
      onKeyDown={(e) => {
        // Escape clears what is lit up (and only then leaves a large view).
        if (e.key !== "Escape" || !pick) return;
        e.preventDefault();
        setPick(null);
      }}
    >
      <style>{CSS}</style>
      <div className="wb-bar" role="group" aria-label="Bench tools">
        {L ? <span className="wb-count some">Find the fault</span> : <span className={`wb-count ${faults ? "some" : ""}`} data-faults={faults}>{faults === 0 ? "No faults" : faults === 1 ? "1 fault on" : `${faults} faults on`}</span>}
        <span className="spacer" />
        <button className="btn small" onClick={() => benchStore.undo()} disabled={!benchStore.canUndo()}>Undo</button>
        <button className="btn small" onClick={() => benchStore.redo()} disabled={!benchStore.canRedo()}>Redo</button>
        <button className="btn small" onClick={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom === 0} aria-label="Zoom out">Zoom -</button>
        <button className="btn small" onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">Zoom +</button>
      </div>
      <div ref={box} className="wb-box">
        <ScrollBox className="wb-scroll" label="Board picture: scroll to see more">
          <BoardPicture
            px={px}
            parts={pictured}
            selected={sel.id}
            pick={shown}
            light={light}
            routes={routes}
            live={live}
            onPick={onPick}
            onHold={(id, down) => live && benchLink.engine?.press(id, down)}
            label={`The homework board, ${HW_BOARD.w.toFixed(0)} by ${HW_BOARD.h.toFixed(0)} mm, with the LaunchPad in the middle. ${list.filter((i) => i.part).length} parts on it, ${list.filter((i) => !i.part).length} devices attached, ${faults} ${faults === 1 ? "fault" : "faults"} switched on. Selected: ${sel.label}. Every part is in the Part list below, every pin in the table of pins.`}
          />
        </ScrollBox>
      </div>
      <p className="wb-info" role="status" data-wb="info">
        {light ? light.words : "Point at a part, a pad or a LaunchPad pin to see what it is joined to."}
        {shownPart && live ? ` Now: ${statusOf(shownPart, view).text}.` : ""}
      </p>
      <label className="wb-check">
        <input type="checkbox" checked={allRoutes} onChange={(e) => setAllRoutes(e.target.checked)} data-wb="routes" />
        Show all connections
      </label>
      <Legend routes={allRoutes} />
      <label className="wb-pick">
        <span>Part</span>
        <select value={sel.id} onChange={(e) => choose(e.target.value)} data-wb="part">
          <optgroup label="On the board">
            {list.filter((i) => i.part).map((i) => <option key={i.id} value={i.id}>{i.label}{!L && optionsOf(i).some((o) => o.fault && i.opts[o.id] !== o.choices[0].id) ? " (fault on)" : ""}</option>)}
          </optgroup>
          {list.some((i) => !i.part) && (
            <optgroup label="Attached by you">
              {list.filter((i) => !i.part).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      <Card i={sel} view={view} state={L ? real : state} live={live} store={benchStore} />
      {!live && <p className="wb-dim">Press Run to power the board: the parts then show what your program does.</p>}
      <div role="status" className="wb-stack">
        {said && <p>{said}</p>}
        {issues.length > 0 && (
          <ul className="wb-issues" aria-label="Problems with what you attached">
            {issues.map((x) => (
              <li key={`${x.inst}-${x.code}`} className={x.severity}>
                <strong>{SEVERITY[x.severity]}.</strong> {x.msg}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!L && (
        <>
      <details data-wb="add">
        <summary>Add a device to free pins</summary>
        <div className="wb-stack">
          <label className="wb-row">
            <span>Device</span>
            <select value={chosen.kind} onChange={(e) => setKind(e.target.value)} data-wb="kind">
              {addable.map((d) => <option key={d.kind} value={d.kind}>{d.name}</option>)}
            </select>
          </label>
          <p className="wb-dim">{chosen.description}</p>
          <div>
            <button className="btn small" onClick={add} disabled={state.added.length >= MAX_ADDED}>Add {chosen.name}</button>
          </div>
        </div>
      </details>
      <details data-wb="table">
        <summary>Wiring table and drawing ({state.added.length} attached)</summary>
        <div className="wb-stack">
          {table.length === 0 ? (
            <p className="wb-dim">Nothing is attached yet. The table and the drawing list only what you attach.</p>
          ) : (
            <>
              <ScrollBox className="wb-tablebox" label="Wiring table">
                <table>
                  <thead>
                    <tr><th scope="col">Device</th><th scope="col">Terminal</th><th scope="col">Goes to</th><th scope="col">Header</th></tr>
                  </thead>
                  <tbody>
                    {table.map((r, n) => (
                      <tr key={n}><td>{r.device}</td><td>{r.terminal}</td><td>{r.goesTo}</td><td>{r.header}</td></tr>
                    ))}
                  </tbody>
                </table>
              </ScrollBox>
              <ScrollBox className="wb-sch" label="Drawing of what you attached">
                <div role="img" aria-label={`Drawing of what you attached. ${sch.words}`} dangerouslySetInnerHTML={{ __html: sch.svg }} />
              </ScrollBox>
            </>
          )}
          <div className="wb-bar">
            <button className="btn small" disabled={!table.length} onClick={() => download("wiring-table.csv", wiringCsv(state), "text/csv")}>Table as CSV</button>
            <button className="btn small" disabled={!table.length} onClick={() => download("wiring-drawing.svg", schematic(state, true).svg, "image/svg+xml")}>Drawing as SVG</button>
            <button className="btn small" onClick={() => download("bench.json", serializeBench(state), "application/json")}>Save bench file</button>
            <label className="btn small">
              <input className="wb-file" type="file" accept="application/json,.json" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
              <span>Load bench file</span>
            </label>
          </div>
        </div>
      </details>
        </>
      )}
      <details data-wb="pins">
        <summary>Pins and what is on them</summary>
        <div className="wb-stack">
          <div className="wb-filter">
            <label>
              Find <input type="search" value={pinFilter} onChange={(e) => setPinFilter(e.target.value)} placeholder="GPIO22, LED, EPWM8A" data-wb="pin-filter" />
            </label>
            <label className="wb-check">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} data-wb="pin-free" />
              Free pins only
            </label>
          </div>
          <p role="status" className="wb-dim">{pins.length} of 80 pins shown.</p>
          <ScrollBox className="wb-tablebox" label="Table of the LaunchPad's pins">
            <table data-wb="pin-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={pinSort === "number" ? "ascending" : undefined}><button className="wb-sort" onClick={() => setPinSort("number")}>Pin</button></th>
                  <th scope="col" aria-sort={pinSort === "name" ? "ascending" : undefined}><button className="wb-sort" onClick={() => setPinSort("name")}>Name</button></th>
                  <th scope="col">Can carry</th>
                  <th scope="col" aria-sort={pinSort === "users" ? "descending" : undefined}><button className="wb-sort" onClick={() => setPinSort("users")}>Connected</button></th>
                </tr>
              </thead>
              <tbody>
                {pins.map((r) => (
                  <tr key={r.number}>
                    <td>{r.number}, {r.header}</td>
                    <td>{r.name || "not connected"}</td>
                    <td>{r.pwm.join(", ")}</td>
                    <td>{r.type === "Supply" ? "supply" : r.type === "Ground" ? "ground" : r.users.length ? r.users.join(", ") : r.type === "GPIO" || r.type === "ADC" ? "nothing: free" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        </div>
      </details>
      <details data-wb="words">
        <summary>The bench in words</summary>
        <ul className="wb-words">
          {describeBench(state, view).map((line, n) => <li key={n}>{line}</li>)}
        </ul>
      </details>
      <details data-wb="help">
        <summary>How to use the wiring bench</summary>
        <div className="wb-stack">
          {(L ? HELP_LESSON : HELP).map((h, n) => <p key={n}>{h}</p>)}
        </div>
      </details>
      <div className="wb-bar">
        {confirming ? (
          <>
            <span>{L ? "Take back every repair you made?" : "Put every part back, switch all faults off and remove what you attached?"}</span>
            <button className="btn small" onClick={() => { if (L) benchStore.reset?.(); else benchStore.set(emptyBench()); setConfirming(false); setSaid(L ? "Your repairs are taken back. Undo brings them back." : "The bench is back to the fully built board. Undo brings your bench back."); }}>Yes, reset</button>
            <button className="btn small" onClick={() => setConfirming(false)}>No, keep it</button>
          </>
        ) : (
          <button className="btn small" disabled={!changed} onClick={() => setConfirming(true)}>{L ? "Take back my repairs" : "Reset the bench"}</button>
        )}
      </div>
    </div>
  );
}
