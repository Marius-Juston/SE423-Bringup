import type { GlossaryEntry } from "../types";

// Every file in this folder that exports `glossary` is merged here.
const modules = import.meta.glob<{ glossary?: GlossaryEntry[] }>("./*.ts", { eager: true });

// The same term may be explained in several chapters: keep the first (files load in name order).
const seen = new Set<string>();
export const GLOSSARY: GlossaryEntry[] = Object.values(modules)
  .flatMap((m) => m.glossary ?? [])
  .filter((g) => {
    const k = g.term.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
