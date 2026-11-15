import { TourFigure } from "../wiring/TourFigure";
import { TOURS } from "../wiring/tours";

// One of the board lessons' figures (primer D). What it shows is in
// src/ui/wiring/tours.ts, how it is drawn in src/ui/wiring/TourFigure.tsx.

function BoardButtons() {
  return <TourFigure spec={TOURS.buttons} />;
}

export const figure = {
  id: "board-buttons",
  title: "Push buttons and their pins",
  description: "See where the four push buttons of the homework board sit and which pin each one is on.",
  Component: BoardButtons,
};
