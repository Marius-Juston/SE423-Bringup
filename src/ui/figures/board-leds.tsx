import { TourFigure } from "../wiring/TourFigure";
import { TOURS } from "../wiring/tours";

// One of the board lessons' figures (primer D). What it shows is in
// src/ui/wiring/tours.ts, how it is drawn in src/ui/wiring/TourFigure.tsx.

function BoardLeds() {
  return <TourFigure spec={TOURS.leds} />;
}

export const figure = {
  id: "board-leds",
  title: "LEDs and their pins",
  description: "Follow each LED of the homework board along its copper to the pin that drives it.",
  Component: BoardLeds,
};
