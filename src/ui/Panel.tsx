import type { ReactNode } from "react";
import { usePref } from "./prefs";
import { Icon } from "./Icon";

/** A titled section that can be folded away; whether it is open is remembered. */
export function Panel({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  const [closed, setClosed] = usePref<boolean>(`panel-${id}`, false);
  return (
    <section className={`panel ${closed ? "closed" : ""}`} data-panel={id}>
      <h3>
        <button aria-expanded={!closed} aria-controls={`panel-body-${id}`} onClick={() => setClosed(!closed)}>
          <Icon name={closed ? "next" : "down"} size={13} />
          <span className="panel-title">{title}</span>
          {note && <span className="panel-note">{note}</span>}
        </button>
      </h3>
      <div className="panel-body" id={`panel-body-${id}`} hidden={closed}>
        {!closed && children}
      </div>
    </section>
  );
}
