// The link between the Sandbox's wiring bench and the simulator. The bench
// is switched on by setting `benchLink.state`; every Board made for the
// homework board after that gets a running bench (plugins/bench_wiring.ts),
// kept here so the interface can show its live state. With `state` null,
// which is how levels and tests run, the simulator is exactly as it is
// without the bench.

import type { BenchEngine } from "../plugins/bench_wiring";
import type { BenchState } from "./types";

export const benchLink: { state: BenchState | null; engine: BenchEngine | null; changes: number } = { state: null, engine: null, changes: 0 };

/** The bench a fault-finding level starts with, plus what has been repaired. `changes` counts the repairs. */
export function lessonBench(faults: Record<string, Record<string, string>>, repairs: Record<string, Record<string, string>> = {}): { state: BenchState; changes: number } {
  const opts: Record<string, Record<string, string>> = {};
  let changes = 0;
  for (const id of new Set([...Object.keys(faults), ...Object.keys(repairs)])) {
    opts[id] = { ...faults[id], ...repairs[id] };
    for (const [o, v] of Object.entries(repairs[id] ?? {})) if (v !== (faults[id]?.[o] ?? null)) changes++;
  }
  return { state: { v: 1, opts, inputs: {}, added: [] }, changes };
}
