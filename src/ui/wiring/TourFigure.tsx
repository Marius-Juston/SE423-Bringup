// The figure of a board lesson (primer D): the homework board drawn from the
// compiled board data (src/sim/world/boards/hw-board.json, docs/WIRING.md),
// cropped to what the lesson is about, with the names of that lesson written
// in the picture. One file per lesson in src/ui/figures gives the region,
// the names and what is chosen at the start; this component does the rest.
//
// In the text the picture shows one or two regions. The Larger view shows
// the whole board with every part named and, where a row of pins is tall
// enough, all 80 pins. The connections are the board's own copper. Nothing
// runs here: the Sandbox's wiring bench is the live one.
import { useEffect, useMemo, useRef, useState } from "react";
import { HW_BOARD } from "../../sim/wiring/board";
import { benchView, emptyBench, statusOf } from "../../sim/wiring/bench";
import { highlightOf, type Pick } from "../../sim/wiring/nets";
import { BoardPicture, PICTURE_CSS, type Tour } from "./BoardPicture";

type Box = [number, number, number, number];

export interface TourView {
  /** What the region is, for the picture's name: "The top right of the homework board". */
  name: string;
  /** The region in millimetres: x, y, width, height. */
  crop: Box;
  /** The region in a narrow column (under 480 px), where names need more room beside the pins. */
  narrow?: Box;
}

export interface TourSpec {
  /** What is chosen when the figure opens. */
  start: Pick;
  /** One or two regions of the board. Two stand side by side where there is room. */
  views: TourView[];
  /** The parts named in the picture: id to the words written ("" for the part's own short name), or every part. */
  parts: "all" | Record<string, string>;
  /** The LaunchPad pins named in the picture. */
  pins: number[];
  /** Pins are written by number, not by signal. */
  numbers?: boolean;
  /** The LaunchPad and its header pairs are named. */
  heads?: boolean;
  /** What the caption says first: what is named and what to try. */
  caption: string;
}

const CSS = `
${PICTURE_CSS}
.bc-box { width: 0; min-width: 100%; }
.bc-views { display: flex; justify-content: center; align-items: center; gap: 8px; }
.bc-view { border: 1px solid var(--border); border-radius: var(--radius); background: var(--pcb); overflow: hidden; }
.bc-view .wb-stage { margin: 0; }
.bc-pick { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: center; }
.bc-pick label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.bc-pick select { min-width: 0; max-width: 100%; min-height: 2.75rem; font: inherit; }
`;
const STATE = emptyBench();
const WHOLE: Box = [0, 0, HW_BOARD.w, HW_BOARD.h];
const GAP = 8;
/** A region is never drawn taller than this in the text. */
const MAX_HEIGHT = 620;
/** Two regions stand side by side from this scale on (px per mm). */
const SIDE_BY_SIDE = 3.4;

export function TourFigure({ spec }: { spec: TourSpec }) {
  const [pick, setPick] = useState<Pick | null>(spec.start);
  const [hover, setHover] = useState<Pick | null>(null);
  // Nothing is drawn before the column's width is known: a first guess would be kept as the figure's height.
  const [size, setSize] = useState({ width: 0, big: false });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // The Larger view is the same figure in a box of its own (.fig-big, src/ui/figures/index.tsx).
    const frame = el.closest(".fig-fit");
    const read = () => {
      const width = Math.max(200, el.clientWidth);
      const big = !!frame?.classList.contains("fig-big");
      setSize((s) => (s.width === width && s.big === big ? s : { width, big }));
    };
    read();
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    sized?.observe(el);
    const framed = frame && typeof MutationObserver !== "undefined" ? new MutationObserver(read) : null;
    if (frame) framed?.observe(frame, { attributes: true, attributeFilter: ["class"] });
    return () => {
      sized?.disconnect();
      framed?.disconnect();
    };
  }, []);
  const view = useMemo(() => benchView(STATE, null), []);
  const parts = useMemo(() => view.all().map((inst) => ({ inst, status: statusOf(inst, view) })), [view]);
  const shown = hover ?? pick;
  const light = shown ? highlightOf(STATE, shown) : null;
  const selected = shown?.t === "part" ? shown.id : "";

  // What is drawn: the lesson's regions, or the whole board in the Larger view.
  const { pictures, beside } = useMemo((): { pictures: { name: string; px: number; tour: Tour }[]; beside: boolean } => {
    if (!size.width) return { pictures: [], beside: false };
    // Each picture has a 1 px border; one more pixel keeps a rounded width inside the column.
    const room = size.width - 3;
    if (size.big) return { pictures: [{ name: "The whole homework board, with the LaunchPad in the middle", px: room / WHOLE[2], tour: { crop: WHOLE, parts: "all", pins: "all", heads: true, leads: true } }], beside: false };
    const crops = spec.views.map((v) => (size.width < 480 && v.narrow ? v.narrow : v.crop));
    const scale = (size.width - 1 - GAP * (crops.length - 1) - 2 * crops.length) / crops.reduce((sum, c) => sum + c[2], 0);
    const beside = crops.length > 1 && scale >= SIDE_BY_SIDE;
    const tallest = Math.max(...crops.map((c) => c[3]));
    const pictures = spec.views.map((v, k) => {
      const crop = crops[k];
      const px = beside ? Math.min(scale, MAX_HEIGHT / tallest) : Math.min(room / crop[2], MAX_HEIGHT / crop[3]);
      return { name: v.name, px, tour: { crop, parts: spec.parts, pins: spec.pins, numbers: spec.numbers, heads: spec.heads, leads: spec.parts === "all" } };
    });
    return { pictures, beside };
  }, [size, spec]);

  return (
    <figure className="figure bc" onKeyDown={(e) => e.key === "Escape" && setPick(null)}>
      <style>{CSS}</style>
      <div className="bc-box" ref={box}>
        <div className="bc-views" style={{ flexDirection: beside ? "row" : "column" }}>
          {pictures.map((p) => (
            <div className="bc-view" key={p.name}>
              <BoardPicture
                px={p.px}
                parts={parts}
                selected={selected}
                pick={shown}
                light={light}
                routes={[]}
                live={false}
                onPick={(q, keep) => (keep ? (setHover(null), setPick(q)) : setHover(q))}
                onHold={() => {}}
                tour={p.tour}
                label={`${p.name}. ${light ? `Lit up: ${light.words}` : "Nothing is chosen."}`}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="fig-why" role="status">{light ? light.words : "Choose a part or a LaunchPad pin to see what it is joined to."}</p>
      <div className="fig-controls">
        <div className="bc-pick">
          <label>
            Part{" "}
            <select value={pick?.t === "part" ? pick.id : ""} onChange={(e) => setPick(e.target.value ? { t: "part", id: e.target.value } : null)}>
              <option value="">(none)</option>
              {view.all().map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>
          <label>
            LaunchPad pin{" "}
            <select value={pick?.t === "pin" ? pick.n : ""} onChange={(e) => setPick(e.target.value ? { t: "pin", n: +e.target.value } : null)}>
              <option value="">(none)</option>
              {HW_BOARD.launchpad.pins.map((p) => <option key={p[3]} value={p[3]}>Pin {p[3]}, J{Math.ceil(p[3] / 10)}.{((p[3] - 1) % 10) + 1}</option>)}
            </select>
          </label>
        </div>
      </div>
      <figcaption>
        {spec.caption} Choose a part or a pin from the lists, or click it in the picture: its connection lights up, thick and solid on the top of the board, dashed on the bottom, and dotted behind an inverter chip or a resistor. The Larger button shows the whole board with every name.
      </figcaption>
    </figure>
  );
}
