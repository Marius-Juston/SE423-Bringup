import { describe, expect, it } from "vitest";
import { LiveSession } from "../src/sim/live";
import { TOUR_HOLD_MS, TOUR_MOVE_MS, replayAt, tourAt, waypoints } from "../src/sim/tour";
import { findLevel } from "../src/levels";
import type { CodeLevel } from "../src/levels/types";

const sets = [
  { at: 0, set: "LIDAR_ROOM", value: 1 },
  { at: 0, set: "LIDAR_X_FT", value: 2 },
  { at: 0, set: "LIDAR_THETA_RAD", value: 3 },
  { at: 150, set: "LIDAR_X_FT", value: 10 },
  { at: 250, set: "LIDAR_THETA_RAD", value: -3 },
];

describe("the path a test moves the robot along", () => {
  it("is empty when the test never moves the robot", () => {
    expect(waypoints(sets.slice(0, 3))).toEqual([]);
    expect(waypoints([{ at: 5, set: "ADC_A0", value: 1 }])).toEqual([]);
  });
  it("keeps every input at each pose", () => {
    const w = waypoints(sets);
    expect(w.map((x) => x.at)).toEqual([0, 150, 250]);
    expect(w[2].values.get("LIDAR_X_FT")).toBe(10);
    expect(w[2].values.get("LIDAR_ROOM")).toBe(1);
  });
  it("replays the jumps exactly, with a glide just before each", () => {
    const w = waypoints(sets);
    expect(replayAt(w, 100, 40).get("LIDAR_X_FT")).toBe(2);
    expect(replayAt(w, 130, 40).get("LIDAR_X_FT")).toBeCloseTo(6);
    expect(replayAt(w, 150, 40).get("LIDAR_X_FT")).toBe(10);
    expect(replayAt(w, 9999, 40).get("LIDAR_THETA_RAD")).toBe(-3);
    // From 3 rad to -3 rad the short way goes through pi, not through 0.
    expect(Math.abs(replayAt(w, 230, 40).get("LIDAR_THETA_RAD")!)).toBeGreaterThan(3);
  });
  it("tours round the poses for ever", () => {
    const w = waypoints(sets);
    const leg = TOUR_HOLD_MS + TOUR_MOVE_MS;
    expect(tourAt(w, 0).get("LIDAR_X_FT")).toBe(2);
    expect(tourAt(w, TOUR_HOLD_MS + TOUR_MOVE_MS / 2).get("LIDAR_X_FT")).toBeCloseTo(6);
    expect(tourAt(w, leg).get("LIDAR_X_FT")).toBe(10);
    expect(tourAt(w, 3 * leg).get("LIDAR_X_FT")).toBe(2);
  });
  it("moves the robot of a live run, until it is placed by hand", () => {
    const level = findLevel("sens-corridor")!.level as CodeLevel;
    const script = (level.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s);
    const live = new LiveSession(level.kit, level.solution, script.filter((s) => s.at === 0), script);
    expect(live.hasTour).toBe(true);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      live.step(16, 1000);
      seen.add(live.board.inputs.get("LIDAR_X_FT")!);
    }
    expect(live.error).toBeNull();
    expect(seen.size).toBeGreaterThan(20);
    expect(live.board.readVar("numScans")).toBeGreaterThan(50);
    live.placeRobot(5, 1.5, 0, "scan");
    live.step(500, 5000);
    expect(live.board.inputs.get("LIDAR_X_FT")).toBe(5);
  });
});
