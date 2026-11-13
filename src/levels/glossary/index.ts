import type { GlossaryEntry } from "../types";

// Every file in this folder that exports `glossary` is merged here.
const modules = import.meta.glob<{ glossary?: GlossaryEntry[] }>("./*.ts", { eager: true });

export const GLOSSARY: GlossaryEntry[] = Object.values(modules)
  .flatMap((m) => m.glossary ?? [])
  .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
