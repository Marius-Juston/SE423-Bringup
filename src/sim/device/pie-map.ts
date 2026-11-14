// Table 3-2 "PIE Channel Mapping" of the Technical Reference Manual
// (SPRUHM8I, section 3.4.5; the course hands it out as one page,
// PeripheralInterruptChannelMapTable.pdf). 12 groups (rows, INT1.y to
// INT12.y) of 16 channels (columns, INTx.1 to INTx.16).
//
// The entries are not typed in here: they come from the comments of TI's
// header for the vector table ("1.7 - Timer 0 Interrupt" on TIMER0_INT),
// the same data the PIE model (periph/pie.ts) reads, so a figure and the
// simulator cannot disagree. Only the spelling the table prints is added
// where it differs from the header's field name.

import data from "./registers.json";

const RAW = data as unknown as { types: Record<string, { m: [string, string, number, number, string][] }>; instances: [string, string, number][] };

export const PIE_GROUPS = 12;
export const PIE_CHANNELS = 16;

export interface PieEntry {
  group: number;
  channel: number;
  /** Name as Table 3-2 prints it ("TIMER0"), or "-" for a reserved cell. */
  name: string;
  /** Field of PieVectTable ("TIMER0_INT"), or null for a reserved cell. */
  vector: string | null;
}

/** Where the table's spelling is not the vector's name without "_INT". */
const PRINTED: Record<string, string> = {
  CANA0_INT: "CANA_0", CANA1_INT: "CANA_1", CANB0_INT: "CANB_0", CANB1_INT: "CANB_1",
  UPPA_INT: "UPPA (CPU1 only)", USBA_INT: "USBA (CPU1 only)",
};

function build(): PieEntry[] {
  const struct = RAW.instances.find((i) => i[0] === "PieVectTable")![1];
  const out: PieEntry[] = [];
  for (const [field, , , , desc] of RAW.types[struct].m) {
    const m = /^(\d+)\.(\d+) - /.exec(desc ?? "");
    if (!m) continue;
    const reserved = /RESERVED/.test(field);
    out.push({ group: +m[1], channel: +m[2], name: reserved ? "-" : (PRINTED[field] ?? field.replace(/_INT$/, "")), vector: reserved ? null : field });
  }
  return out.sort((a, b) => a.group - b.group || a.channel - b.channel);
}

export const PIE_ENTRIES: PieEntry[] = build();

export const pieEntry = (group: number, channel: number): PieEntry | undefined => PIE_ENTRIES.find((e) => e.group === group && e.channel === channel);

/** The four things the table gives for an entry, as the course writes them. */
export function pieLines(e: PieEntry): { vector: string; enable: string; ier: string; ack: string } {
  return {
    vector: `PieVectTable.${e.vector} = &my_isr;`,
    enable: `PieCtrlRegs.PIEIER${e.group}.bit.INTx${e.channel} = 1;`,
    ier: `IER |= M_INT${e.group};`,
    ack: `PieCtrlRegs.PIEACK.all = PIEACK_GROUP${e.group};`,
  };
}

/**
 * Entries a lab or homework has students find for credit (Lab 4: ADCB1 and
 * ADCC1; Homework 3: SPIB_RX). The table shows them, as the document does.
 * Nothing in the game prints their numbers as finished code.
 */
const GRADED = new Set(["ADCB1_INT", "ADCC1_INT", "SPIB_RX_INT"]);
export const isGradedPie = (e: PieEntry): boolean => !!e.vector && GRADED.has(e.vector);

/**
 * The lines of C an entry needs, for a figure to print. For an entry that
 * is graded work the group and channel stay as the letters x and y: the
 * table gives them, the student reads them.
 */
export function pieCode(e: PieEntry): string[] {
  if (!e.vector) return [];
  const l = isGradedPie(e)
    ? { vector: `PieVectTable.${e.vector} = &my_isr;`, enable: "PieCtrlRegs.PIEIERx.bit.INTxy = 1;", ier: "IER |= M_INTx;", ack: "PieCtrlRegs.PIEACK.all = PIEACK_GROUPx;" }
    : pieLines(e);
  return [`${l.vector}   // between EALLOW; and EDIS;`, l.enable, l.ier, `${l.ack}   // last line of my_isr`];
}
