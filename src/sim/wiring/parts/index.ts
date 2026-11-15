// The part bin. Every file in this folder that exports `part: PartDef` is
// picked up: the board's own parts (LEDs, buttons, the buzzer ...) and the
// devices a student can attach to free pins. To add one, drop a file here
// (docs/WIRING.md). Files whose name starts with "_" are helpers.

import type { PartDef } from "../types";

const modules = import.meta.glob<{ part?: PartDef }>(["./*.ts", "!./index.ts", "!./_*.ts"], { eager: true });

export const PART_DEFS: PartDef[] = Object.values(modules)
  .map((m) => m.part)
  .filter((p): p is PartDef => !!p)
  .sort((a, b) => a.name.localeCompare(b.name));

export const partDef = (kind: string): PartDef | undefined => PART_DEFS.find((p) => p.kind === kind);
