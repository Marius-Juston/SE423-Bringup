import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePref } from "./prefs";
import { Icon } from "./Icon";

/** How much room a panel has: its normal place, the whole width of the bench, or the large view beside the editor. */
export type PanelSize = "normal" | "wide" | "large";
const SizeContext = createContext<PanelSize>("normal");
/** The size of the panel a component is drawn in, so it can use the room it has. */
export const usePanelSize = (): PanelSize => useContext(SizeContext);

export interface PanelExpand {
  /** The size is remembered under this name (default: the panel's id), so one kind of level can differ from another. */
  sizeKey?: string;
  /** Size before the student has chosen one. */
  defaultSize?: "normal" | "wide";
  /** Shown above the content in the large view of a narrow window, where the editor's toolbar is on another tab. */
  bar?: ReactNode;
}

/**
 * A titled section that can be folded away; whether it is open is remembered.
 *
 * With `expand` it also has two size buttons. "Fill the column" makes the
 * panel span the bench's columns and tells its content it may be tall
 * (remembered). "Large view" hides the rest of the bench and the briefing
 * so the panel fills everything beside the editor; Escape or the same
 * button returns, and the focus stays on that button. The large view is
 * not remembered: a level never opens in it.
 */
export function Panel({ id, title, note, children, expand }: { id: string; title: string; note?: string; children: ReactNode; expand?: PanelExpand }) {
  const [closed, setClosed] = usePref<boolean>(`panel-${id}`, false);
  const [stored, setStored] = usePref<"normal" | "wide">(`panel-size-${expand?.sizeKey ?? id}`, expand?.defaultSize ?? "normal");
  const [large, setLarge] = useState(false);
  const largeButton = useRef<HTMLButtonElement>(null);
  const size: PanelSize = !expand ? "normal" : large ? "large" : stored === "wide" ? "wide" : "normal";
  const folded = closed && !large;

  // Escape leaves the large view, from anywhere but the code editor (where Escape has its own meaning).
  useEffect(() => {
    if (!large) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.(".cm-editor")) return;
      e.preventDefault();
      setLarge(false);
      largeButton.current?.focus();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [large]);

  return (
    <section className={`panel ${folded ? "closed" : ""} ${expand ? "expandable" : ""} size-${size}`} data-panel={id} data-size={size}>
      <h3>
        <button aria-expanded={!folded} aria-controls={`panel-body-${id}`} disabled={large} onClick={() => setClosed(!closed)}>
          <Icon name={folded ? "next" : "down"} size={13} />
          <span className="panel-title">{title}</span>
          {note && <span className="panel-note">{note}</span>}
        </button>
      </h3>
      {expand && (
        <div className="panel-tools" role="group" aria-label={`Size of ${title}`}>
          {!large && (
            <button className="panel-tool" data-size-button="wide" aria-pressed={stored === "wide"} title={stored === "wide" ? "Back to the normal size" : "Fill the width of the board column, and more height"} onClick={() => { setStored(stored === "wide" ? "normal" : "wide"); if (closed) setClosed(false); }}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={stored === "wide" ? "M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4" : "M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"} /></svg>
              <span>{stored === "wide" ? "Smaller" : "Fill the column"}</span>
            </button>
          )}
          <button ref={largeButton} className="panel-tool" data-size-button="large" aria-pressed={large} title={large ? "Back to the board (Escape)" : "Show this beside the editor, as large as the window allows"} onClick={() => setLarge(!large)}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={large ? "M6 6l12 12M18 6L6 18" : "M4 5h16v14H4zM4 9h16"} /></svg>
            <span>{large ? "Close large view" : "Large view"}</span>
          </button>
        </div>
      )}
      <div className="panel-body" id={`panel-body-${id}`} hidden={folded}>
        {large && expand?.bar ? <div className="panel-bar">{expand.bar}</div> : null}
        {!folded && <SizeContext.Provider value={size}>{children}</SizeContext.Provider>}
      </div>
    </section>
  );
}
