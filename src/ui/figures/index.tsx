// Interactive figures a brief embeds with a line of its own: {{figure:<id>}}.
// Every file in this folder is one figure: it is named <id>.tsx and exports
//   export const figure = { id: "<id>", Component };
// so adding a figure never edits a shared file.
import type { ComponentType } from "react";

interface FigureDef {
  id: string;
  Component: ComponentType;
}

const modules = import.meta.glob<{ figure?: FigureDef }>("./*.tsx", { eager: true });
const TABLE = new Map<string, ComponentType>();
for (const m of Object.values(modules)) if (m.figure) TABLE.set(m.figure.id, m.figure.Component);

export const FIGURE_IDS = [...TABLE.keys()].sort();

export function Figure({ id }: { id: string }) {
  const C = TABLE.get(id);
  return C ? <C /> : <p className="fig-missing">[missing figure: {id}]</p>;
}
