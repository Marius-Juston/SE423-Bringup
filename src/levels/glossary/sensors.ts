import type { GlossaryEntry } from "../types";

// Words for reading the robot's sensors in code, from the practice levels on each bus.
export const glossary: GlossaryEntry[] = [
  { term: "Ranging status", meaning: "A byte a distance sensor sends with each measurement to say whether the distance can be trusted. For the robot's CAN sensors 0 means valid.", level: "bus-can-range" },
  { term: "Range (of a sensor)", meaning: "The smallest and the largest value a sensor can measure. Outside it the sensor still sends a number, but not a measurement.", level: "bus-can-range" },
  { term: "Interpolation", meaning: "Finding a value between two rows of a table by drawing a straight line from one row to the next.", level: "spi-sharp" },
  { term: "Peak to peak", meaning: "The highest value of a signal minus its lowest over a stretch of time: how far it swings.", level: "dmaf-mic" },
];
