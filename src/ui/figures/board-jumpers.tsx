import { TourFigure } from "../wiring/TourFigure";
import { TOURS } from "../wiring/tours";

// One of the board lessons' figures (primer D). What it shows is in
// src/ui/wiring/tours.ts, how it is drawn in src/ui/wiring/TourFigure.tsx.

function BoardJumpers() {
  return <TourFigure spec={TOURS.jumpers} />;
}

export const figure = {
  id: "board-jumpers",
  title: "Buzzer and IMU jumpers",
  description: "See the removable connections of the homework board and which pin each one carries.",
  Component: BoardJumpers,
};
