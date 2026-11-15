import { TourFigure } from "../wiring/TourFigure";
import { TOURS } from "../wiring/tours";

// One of the board lessons' figures (primer D). What it shows is in
// src/ui/wiring/tours.ts, how it is drawn in src/ui/wiring/TourFigure.tsx.

function BoardConnections() {
  return <TourFigure spec={TOURS.board} />;
}

export const figure = {
  id: "board-connections",
  title: "Homework board connections",
  description: "Choose a part of the homework board to see which pin it is on, or a pin to see what is connected to it.",
  Component: BoardConnections,
};
