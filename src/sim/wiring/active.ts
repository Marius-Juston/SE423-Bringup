// The link between the Sandbox's wiring bench and the simulator. The bench
// is switched on by setting `benchLink.state`; every Board made for the
// homework board after that gets a running bench (plugins/bench_wiring.ts),
// kept here so the interface can show its live state. With `state` null,
// which is how levels and tests run, the simulator is exactly as it is
// without the bench.

import type { BenchEngine } from "../plugins/bench_wiring";
import type { BenchState } from "./types";

export const benchLink: { state: BenchState | null; engine: BenchEngine | null } = { state: null, engine: null };
