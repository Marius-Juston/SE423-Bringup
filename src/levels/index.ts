import { tierOf, type Chapter, type Level } from "./types";

// Every file in ./chapters that exports a Chapter is picked up automatically.
const modules = import.meta.glob<Record<string, unknown>>("./chapters/ch*.ts", { eager: true });
const isChapter = (x: unknown): x is Chapter => typeof x === "object" && x !== null && "levels" in x && "number" in x;

export const CHAPTERS: Chapter[] = Object.values(modules)
  .flatMap((m) => Object.values(m).filter(isChapter))
  .sort((a, b) => a.number - b.number);

/** Chapters planned for later releases, shown on the map as "coming". */
const ALL_PLANNED: { number: number; title: string; blurb: string }[] = [
  { number: 3, title: "Digital inputs", blurb: "Floating pins, pull-ups and push buttons." },
  { number: 4, title: "CPU timers", blurb: "Prescaler, period and ConfigCpuTimer." },
  { number: 5, title: "Interrupts", blurb: "The PIE, the vector table, IER and PIEACK." },
  { number: 6, title: "Serial and ASCII", blurb: "UART frames, baud rate and serial_printf." },
  { number: 7, title: "DAC", blurb: "From a number to a voltage." },
  { number: 8, title: "ADC", blurb: "Sampling, successive approximation and SOCs." },
  { number: 9, title: "PWM", blurb: "Time base, compare and duty cycle." },
  { number: 10, title: "Motors and actuators", blurb: "H-bridge, RC servo and buzzer." },
  { number: 11, title: "Encoders", blurb: "Quadrature, eQEP, position and speed." },
  { number: 12, title: "SPI", blurb: "Four clock modes, chip selects and FIFOs." },
  { number: 13, title: "SPI devices", blurb: "MPU-9250 and the DAN28027." },
  { number: 14, title: "I2C and CAN", blurb: "Shared buses, addresses and arbitration." },
  { number: 15, title: "DMA and filters", blurb: "Ping-pong buffers, Nyquist and FIR." },
  { number: 16, title: "Feedback control", blurb: "PI control, saturation and anti-windup." },
  { number: 17, title: "Sensors and state machines", blurb: "IR, gyro, LIDAR and wall following." },
  { number: 18, title: "Where am I", blurb: "Transforms, dead reckoning and Kalman filters." },
  { number: 19, title: "Seeing and planning", blurb: "Colour, blobs, A* and occupancy grids." },
  { number: 20, title: "Threads", blurb: "Races, mutexes and producer-consumer." },
];

export const PLANNED = ALL_PLANNED.filter((p) => !CHAPTERS.some((c) => c.number === p.number));

const byId = new Map<string, { level: Level; chapter: Chapter; index: number }>();
for (const chapter of CHAPTERS) chapter.levels.forEach((level, index) => byId.set(level.id, { level, chapter, index }));

export const findLevel = (id: string) => byId.get(id);

export function nextLevel(id: string): Level | undefined {
  const cur = byId.get(id);
  if (!cur) return undefined;
  const inChapter = cur.chapter.levels[cur.index + 1];
  if (inChapter) return inChapter;
  const ci = CHAPTERS.indexOf(cur.chapter);
  return CHAPTERS[ci + 1]?.levels[0];
}

export function chapterDone(ch: Chapter, passed: Record<string, true>): boolean {
  return ch.levels.every((l) => tierOf(l) !== "core" || passed[l.id]);
}

export function chapterUnlocked(ch: Chapter, passed: Record<string, true>, unlockAll: boolean): boolean {
  if (unlockAll) return true;
  return ch.requires.every((id) => {
    const r = CHAPTERS.find((c) => c.id === id);
    return !r || chapterDone(r, passed);
  });
}
