import type { GlossaryEntry } from "../types";

// Terms first used in chapter 21 (the capstone). Terms the capstone shares with
// earlier chapters (open loop, dead reckoning, heading, pose ...) are in robot.ts.
// `level` is the level that explains the term.
export const glossary: GlossaryEntry[] = [
  {
    term: "blocked distance",
    meaning:
      "How close something ahead may come before the robot stops or turns away. It must cover the distance driven between two LIDAR scans plus the distance needed to brake, so it grows with the speed.",
    level: "cap-wall",
  },
  {
    term: "go-to-point",
    meaning:
      "Driving to a target position with two simple rules: turn in proportion to the heading error, and drive at a speed in proportion to the distance left, each with a limit.",
    level: "cap-goto",
  },
  {
    term: "heading error",
    meaning:
      "How far the robot must still turn to point at its goal: the goal's direction, atan2(dy, dx), minus the heading. Positive means the goal is to the left.",
    level: "cap-goto",
  },
  {
    term: "hand-off (interrupt to main)",
    meaning:
      "Leaving work for the main loop: the interrupt function sets a flag, and while (1) in main sees the flag, sets it back and does the work. The interrupt stays short, and the work runs a few microseconds later.",
    level: "cap-lean",
  },
  {
    term: "mission",
    meaning:
      "This chapter's name for the Decide step of the control loop: the few lines, usually a state machine, that choose the speed command and the turn command. Everything else in the program serves it.",
    level: "cap-brief",
  },
  {
    term: "motor mismatch",
    meaning:
      "No two motors are alike: for the same command one turns a little faster. Open loop, the robot then drives a curve. Speed control with feedback removes the difference.",
    level: "cap-open",
  },
  {
    term: "odometer",
    meaning: "The total distance a vehicle has driven. The simulated room keeps one for the robot, and the tests compare it with what your program measured.",
    level: "cap-dist",
  },
  {
    term: "steering coupling",
    meaning:
      "An extra term that tells each wheel's speed controller about the other wheel: the difference of the two wheel speeds is added to one wheel's error and subtracted from the other's, so the wheels stay together.",
    level: "cap-steer",
  },
  {
    term: "time budget",
    meaning:
      "The longest time a piece of code is allowed to take, here one pass of the 1 ms interrupt function. Slow maths (cos, sin, atan2, about a microsecond each) is what uses it up.",
    level: "cap-lean",
  },
  {
    term: "travel",
    meaning: "The distance the middle of the robot has driven: the average of the distances rolled by the left and the right wheel.",
    level: "cap-dist",
  },
  {
    term: "hit point",
    meaning:
      "The place where a robot on its way to a goal first meets an obstacle. Bug-style planners remember it, or how far the goal was from it, to decide later whether leaving the obstacle is progress.",
    level: "cap-x-trap",
  },
  {
    term: "perfect maze",
    meaning:
      "A maze with exactly one way between any two cells: no loops and no closed-off parts. All its walls hang together with the outer wall, which is why following one wall leads through every cell.",
    level: "cap-x-maze",
  },
  {
    term: "right-hand rule",
    meaning:
      "A way through a maze without a map: keep one hand on the wall beside you and never let go. On the robot it is a wall follower. It fails when the goal lies at a free-standing wall, an island.",
    level: "cap-x-maze",
  },
  {
    term: "second trip",
    meaning:
      "In the terrain levels of chapter 21 the test runs the mission twice: at a fixed time the world changes and the goal becomes the place the robot started from. A program that learnt one route by heart fails the second trip.",
    level: "cap-p-slalom",
  },
  {
    term: "waypoint",
    meaning: "One of several target points that a robot visits in order. Reaching one makes the next one the goal.",
    level: "cap-x-square",
  },
  {
    term: "wheel base",
    meaning: "The distance between the left and the right wheel, 0.6 ft on this robot. The difference of the two wheel distances divided by the wheel base is the angle the robot has turned.",
    level: "cap-steer",
  },
];
