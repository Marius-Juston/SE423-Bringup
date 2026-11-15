// A simple schematic of what the student attached to the board: the
// LaunchPad as a block on the left with the pins in use, each device as a
// box on the right with its terminals, and a line from every terminal to
// its pin. A terminal on a supply gets a supply label instead of a line.
// It draws only what the student chose: nothing is added or corrected.
// Pure text in, SVG text out, so the interface and the export share it.

import { headerPin, isRail } from "./board";
import { instances } from "./bench";
import type { BenchState } from "./types";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ROW = 22;
const CHIP_X = 16;
const CHIP_W = 150;
const DEV_W = 190;
const GAP = 150;

export interface Schematic {
  svg: string;
  width: number;
  height: number;
  /** The same drawing in words, for the picture's text alternative. */
  words: string;
}

/**
 * The drawing. `standalone` gives a file that opens anywhere (its own
 * colours, black on white); otherwise the colours come from the page
 * through `currentColor` and the class names.
 */
export function schematic(state: BenchState, standalone = false): Schematic {
  const devices = instances(state).filter((i) => !i.part);
  // The chip's pins in use, in the order the devices name them.
  const pins: string[] = [];
  for (const d of devices) for (const t of d.def.terminals) if (d.conn[t.id] && !isRail(d.conn[t.id]) && !pins.includes(d.conn[t.id])) pins.push(d.conn[t.id]);
  const devX = CHIP_X + CHIP_W + GAP;
  const parts: string[] = [];
  const words: string[] = [];
  let y = 40;
  const pinY = new Map<string, number>();
  pins.forEach((p, n) => pinY.set(p, 62 + n * ROW));
  const chipH = Math.max(60, 34 + pins.length * ROW);
  const termAt: { x: number; y: number; target: string }[] = [];
  for (const d of devices) {
    const h = 30 + d.def.terminals.length * ROW;
    parts.push(`<rect class="sch-box" x="${devX}" y="${y}" width="${DEV_W}" height="${h}" rx="4"/>`);
    parts.push(`<text class="sch-title" x="${devX + 8}" y="${y + 18}">${esc(d.label)}</text>`);
    d.def.terminals.forEach((t, n) => {
      const ty = y + 40 + n * ROW;
      const to = d.conn[t.id];
      parts.push(`<text class="sch-text" x="${devX + 8}" y="${ty + 4}">${esc(t.name.replace(/ \(.*\)$/, ""))}</text>`);
      if (!to) {
        parts.push(`<line class="sch-open" x1="${devX - 26}" y1="${ty}" x2="${devX}" y2="${ty}"/>`, `<text class="sch-text" x="${devX - 30}" y="${ty + 4}" text-anchor="end">not connected</text>`);
        words.push(`${d.label} ${t.name}: not connected`);
      } else if (isRail(to)) {
        const name = to === "BAT" ? "Battery" : to;
        parts.push(`<line class="sch-wire" x1="${devX - 26}" y1="${ty}" x2="${devX}" y2="${ty}"/>`, `<text class="sch-rail" x="${devX - 30}" y="${ty + 4}" text-anchor="end">${name}</text>`);
        words.push(`${d.label} ${t.name}: ${name}`);
      } else {
        termAt.push({ x: devX, y: ty, target: to });
        words.push(`${d.label} ${t.name}: ${to}`);
      }
    });
    y += h + 16;
  }
  // Lines: out of the chip, up or down in a lane of their own, into the device.
  termAt.forEach((t, n) => {
    const py = pinY.get(t.target)!;
    const lane = CHIP_X + CHIP_W + 14 + ((n * 9) % (GAP - 80));
    parts.push(`<polyline class="sch-wire" points="${CHIP_X + CHIP_W},${py} ${lane},${py} ${lane},${t.y} ${t.x},${t.y}"/>`);
    parts.push(`<text class="sch-text" x="${t.x - 4}" y="${t.y - 4}" text-anchor="end">${esc(t.target)}</text>`);
  });
  parts.push(`<rect class="sch-box" x="${CHIP_X}" y="24" width="${CHIP_W}" height="${chipH}" rx="4"/>`, `<text class="sch-title" x="${CHIP_X + 8}" y="44">F28379D LaunchPad</text>`);
  for (const p of pins) {
    const h = headerPin(p);
    parts.push(`<text class="sch-text" x="${CHIP_X + CHIP_W - 6}" y="${pinY.get(p)! + 4}" text-anchor="end">${esc(p)}${h ? ` (${h.header})` : ""}</text>`);
  }
  const width = devX + DEV_W + 16;
  const height = Math.max(24 + chipH, y) + 12;
  const style = standalone
    ? `<style>.sch-box{fill:#fff;stroke:#111;stroke-width:1.5}.sch-wire{fill:none;stroke:#111;stroke-width:1.5}.sch-open{stroke:#111;stroke-width:1.5;stroke-dasharray:4 3}.sch-title{font:700 13px sans-serif;fill:#111}.sch-text,.sch-rail{font:12px sans-serif;fill:#111}.sch-rail{font-weight:700}</style><rect width="100%" height="100%" fill="#fff"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${standalone ? "" : ' aria-hidden="true"'}>${style}${parts.join("")}</svg>`;
  return { svg, width, height, words: words.length ? words.join("; ") : "Nothing is attached." };
}
