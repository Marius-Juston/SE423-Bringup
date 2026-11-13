import { Arbitration } from "./i2c-arbitration";

// The arbitration figure of i2c-arbitration.tsx, opened in its CAN mode:
// two nodes start a frame together and the lower 11-bit identifier wins
// (CAN protocol, ISO 11898-1; TRM 22.4.2 on message priority).

function CanArbitration() {
  return <Arbitration startCan />;
}

export const figure = {
  id: "can-arbitration",
  title: "CAN arbitration",
  description: "Step two CAN nodes through their identifiers bit by bit to see which one backs off and why the lower identifier always wins.",
  Component: CanArbitration,
};
