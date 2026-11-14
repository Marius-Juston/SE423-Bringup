// Interactive figures a brief embeds with a line of its own: {{figure:<id>}}.
// Every file in this folder is one figure: it is named <id>.tsx and exports
//   export const figure = { id: "<id>", title, description, Component };
// so adding a figure never edits a shared file.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";

export interface FigureDef {
  id: string;
  /** What a student would call it: "RC charging curve", "Ohm's law". */
  title?: string;
  /** One plain sentence: what you can do with it and what it shows. */
  description?: string;
  Component: ComponentType;
}

const modules = import.meta.glob<{ figure?: FigureDef }>("./*.tsx", { eager: true });
const TABLE = new Map<string, FigureDef>();
for (const m of Object.values(modules)) if (m.figure) TABLE.set(m.figure.id, m.figure);

export const FIGURE_IDS = [...TABLE.keys()].sort();

/** Title and description of a figure, for lists such as the Handbook's. */
export function figureMeta(id: string): { title?: string; description?: string } {
  const f = TABLE.get(id);
  return { title: f?.title, description: f?.description };
}

/** Smallest size, in screen pixels, a label inside a figure's drawing may have. */
const MIN_LABEL_PX = 9;
/** ...but a label never grows past this factor (a very narrow column would otherwise pile labels up). */
const MAX_GROW = 1.3;

// Drawings scale with the column, so their 8.5-unit labels would shrink to
// about 7.5 px in a 380 px reading pane. Every drawing gets its scale as
// --fig-k (screen px per viewBox unit) and the standard label classes never
// render smaller than MIN_LABEL_PX. A figure with a text class of its own
// uses the same expression: font-size: max(8px, calc(9px / var(--fig-k, 1))).
// Small text in an HTML table of a figure uses var(--fig-small): 11 px at
// least in the text, larger in the larger view.
// .fig-more is the one disclosure for secondary controls:
//   <details className="fig-more"><summary>More controls</summary>...</details>
const FIT_CSS = `
.fig-fit svg .fig-label, .fig-fit svg .fig-value.small { font-size: max(8.5px, calc(${MIN_LABEL_PX / 16}rem / var(--fig-k, 1))); }
.fig-fit svg .fig-value { font-size: max(11px, calc(${MIN_LABEL_PX / 16}rem / var(--fig-k, 1))); }
/* Any figure can be opened across the window, where its labels grow with it. */
.fig-fit { position: relative; --fig-small: max(11px, 0.69rem); }
.fig-fit.fig-big { --fig-small: 0.92rem; }
.fig-zoom { position: absolute; top: 0.35rem; right: 0.35rem; z-index: 2; display: inline-flex; align-items: center; gap: 0.25rem; font: inherit; font-size: 0.75rem; line-height: 1.2; padding: 0.2rem 0.5rem; color: var(--text); background: var(--surface); border: 1px solid var(--control); border-radius: var(--radius); cursor: pointer; opacity: 0.85; }
.fig-zoom:hover, .fig-zoom:focus-visible { opacity: 1; }
.fig-fit > .figure { padding-top: 2.1rem; }
.fig-fit.fig-big { max-width: none; position: fixed; z-index: 61; top: 1rem; bottom: 1rem; left: 50%; transform: translateX(-50%); width: min(68rem, calc(100vw - 2rem)); overflow: auto; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 0.6rem; /* the dimmed surround is the box's own shadow, so it is drawn wherever the box is */ box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.55); }
/* On a narrow screen the larger figure is wider than the window and scrolls sideways inside its own box. */
.fig-fit.fig-big > .figure { margin: 0; font-size: 1.15rem; min-width: min(46rem, 190vw); }
.hb-card-preview .fig-zoom { display: none; }
.hb-card-preview .fig-fit > .figure { padding-top: 0.7rem; }
.fig-more { margin: 0.4rem 0; }
.fig-more > summary { cursor: pointer; width: fit-content; color: var(--dim); font-size: 0.82rem; }
.fig-more[open] > summary { margin-bottom: 0.35rem; }
.fig-more > .fig-controls { margin-top: 0; }
`;

function fit(root: HTMLElement) {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg[viewBox]")) {
    const units = svg.viewBox.baseVal.width;
    const px = svg.getBoundingClientRect().width;
    if (!units || !px) continue;
    // The smallest label follows the Text size setting (the root font size), like the text around the figure.
    const min = (MIN_LABEL_PX * rootPx) / 16;
    const k = Math.max(px / units, min / (8.5 * MAX_GROW)).toFixed(3);
    if (svg.style.getPropertyValue("--fig-k") !== k) svg.style.setProperty("--fig-k", k);
  }
}

/**
 * The sentence that reacts to the state, a code read-out or a row of
 * controls is taller in some states than in others. Every block of a figure
 * keeps the tallest height it has had at this width, so a control never
 * makes what is below it jump back up.
 */
const HELD = ".figure > :not(svg):not(style):not(details):not(table), .fig-why, .fig-step";
function hold(root: HTMLElement, tallest: WeakMap<Element, number>) {
  for (const box of root.querySelectorAll<HTMLElement>(HELD)) {
    // A part the student folds open and shut keeps its own height.
    if (box.querySelector("details")) continue;
    const h = box.offsetHeight;
    if (!h) continue;
    const most = Math.max(tallest.get(box) ?? 0, h);
    tallest.set(box, most);
    // min-height counts the content only, unless the box is sized by its border.
    const cs = getComputedStyle(box);
    const edges = cs.boxSizing === "border-box" ? 0 : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const want = `${Math.max(0, most - edges)}px`;
    if (box.style.minHeight !== want) box.style.minHeight = want;
  }
}

export function Figure({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  // The larger view: the same figure, in the state it is in, across the window. Escape or the button closes it.
  const [big, setBig] = useState(false);
  const zoom = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!big) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setBig(false);
      zoom.current?.focus();
    };
    // A press outside the figure closes it too.
    const out = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setBig(false);
    };
    window.addEventListener("keydown", on, true);
    window.addEventListener("pointerdown", out, true);
    return () => {
      window.removeEventListener("keydown", on, true);
      window.removeEventListener("pointerdown", out, true);
    };
  }, [big]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let tallest = new WeakMap<Element, number>();
    let width = el.clientWidth;
    fit(el);
    hold(el, tallest);
    const sized =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fit(el);
            // Another width wraps the text differently: start again.
            if (Math.abs(el.clientWidth - width) > 1) {
              width = el.clientWidth;
              tallest = new WeakMap();
              for (const b of el.querySelectorAll<HTMLElement>(HELD)) b.style.minHeight = "";
            }
            hold(el, tallest);
          });
    sized?.observe(el);
    // A figure may swap its drawing (another scene, another viewBox), and its text changes with every control.
    const changed =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            fit(el);
            hold(el, tallest);
          });
    changed?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["viewBox"] });
    return () => {
      sized?.disconnect();
      changed?.disconnect();
    };
  }, [id]);
  const C = TABLE.get(id)?.Component;
  if (!C) return <p className="fig-missing">[missing figure: {id}]</p>;
  const title = TABLE.get(id)?.title ?? "figure";
  return (
    <>
      <div className={`fig-fit ${big ? "fig-big" : ""}`} ref={box} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? `${title}, larger view` : undefined}>
        <style href="fig-fit" precedence="default">{FIT_CSS}</style>
        <button ref={zoom} type="button" className="fig-zoom" aria-pressed={big} onClick={() => setBig(!big)} title={big ? "Back to its place in the text (Escape)" : "Show this figure across the window, with larger text"}>
          {big ? "Close larger view" : "Larger"}
        </button>
        <C />
      </div>
    </>
  );
}
