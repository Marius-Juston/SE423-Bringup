import type { BenchView } from "./types";

const modules = import.meta.glob<{ view?: BenchView }>("./*.tsx", { eager: true });

export const VIEWS: BenchView[] = Object.values(modules)
  .map((m) => m.view)
  .filter((v): v is BenchView => !!v)
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.id.localeCompare(b.id));
