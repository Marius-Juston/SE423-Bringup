import { TourFigure } from "../wiring/TourFigure";
import { TOURS } from "../wiring/tours";

// One of the board lessons' figures (primer D). What it shows is in
// src/ui/wiring/tours.ts, how it is drawn in src/ui/wiring/TourFigure.tsx.

function BoardHeaders() {
  return <TourFigure spec={TOURS.headers} />;
}

export const figure = {
  id: "board-headers",
  title: "LaunchPad headers on the board",
  description: "Find where the LaunchPad sits on the homework board and how its 80 pins are numbered, and choose a pin to see what it is.",
  Component: BoardHeaders,
};
