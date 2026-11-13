import type { ReactNode } from "react";
import { usePref } from "./prefs";

/** A titled section that can be folded away; whether it is open is remembered. */
export function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [closed, setClosed] = usePref<boolean>(`panel-${id}`, false);
  return (
    <section className="panel" data-panel={id}>
      <h3>
        <button aria-expanded={!closed} onClick={() => setClosed(!closed)}>
          <span aria-hidden="true">{closed ? "▸" : "▾"}</span> {title}
        </button>
      </h3>
      {!closed && <div className="panel-body">{children}</div>}
    </section>
  );
}
