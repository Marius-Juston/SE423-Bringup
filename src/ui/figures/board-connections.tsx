import { useEffect, useMemo, useRef, useState } from "react";
import { HW_BOARD } from "../../sim/wiring/board";
import { benchView, emptyBench, statusOf } from "../../sim/wiring/bench";
import { highlightOf, type Pick } from "../../sim/wiring/nets";
import { BoardPicture, PICTURE_CSS } from "../wiring/BoardPicture";

// The homework board with every part in place, drawn from the compiled
// board data (src/sim/world/boards/hw-board.json, docs/WIRING.md), for the
// board lessons: point at a part to see the pin it is on, or at a
// LaunchPad pin to see what is on it. The connections are the board's own
// copper. Nothing runs here; the Sandbox's wiring bench is the live one.

const CSS = `
${PICTURE_CSS}
.bc-box { width: 0; min-width: 100%; }
.bc-scroll { border: 1px solid var(--border); border-radius: var(--radius); background: var(--inset); overflow: hidden; }
.bc-pick { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: center; }
.bc-cap { color: var(--dim); font-size: var(--fs-2); margin: 0.4rem 0 0; }
.bc-pick select { min-width: 0; max-width: 100%; font: inherit; }
`;
const STATE = emptyBench();

function BoardConnections() {
  const [pick, setPick] = useState<Pick | null>({ t: "part", id: "LED1" });
  const [hover, setHover] = useState<Pick | null>(null);
  const [width, setWidth] = useState(360);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth - 4)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const view = useMemo(() => benchView(STATE, null), []);
  const parts = useMemo(() => view.all().map((inst) => ({ inst, status: statusOf(inst, view) })), [view]);
  const shown = hover ?? pick;
  const light = shown ? highlightOf(STATE, shown) : null;
  const selected = pick?.t === "part" ? pick.id : "LED1";
  const px = width / HW_BOARD.w;
  return (
    <figure className="figure bc" onKeyDown={(e) => e.key === "Escape" && setPick(null)}>
      <style>{CSS}</style>
      <div className="bc-box" ref={box}>
        <div className="bc-scroll">
          <BoardPicture
            px={px}
            parts={parts}
            selected={selected}
            pick={shown}
            light={light}
            routes={[]}
            live={false}
            onPick={(p, keep) => (keep ? (setHover(null), setPick(p)) : setHover(p))}
            onHold={() => {}}
            plain
            label={`The homework board with the LaunchPad in the middle and ${parts.length} parts. ${light ? light.words : "Nothing is chosen."}`}
          />
        </div>
      </div>
      <p className="fig-why" role="status">{light ? light.words : "Point at a part, a pad or a LaunchPad pin to see what it is joined to."}</p>
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
        Click a part or a pin in the picture, or choose one from the lists. The Larger button shows the picture across the window. Its connection lights up: solid lines are copper on the top of the board, dashed lines copper on the bottom. Dotted lines are what lies behind an inverter chip or a resistor.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "board-connections",
  title: "Homework board connections",
  description: "Point at a part of the homework board to see which pin it is on, or at a pin to see what is connected to it.",
  Component: BoardConnections,
};
