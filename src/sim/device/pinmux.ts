// The course's pin mux table: "GPIO Muxed Pins" for the pins the F28379D
// LaunchPad brings out (PinMuxTableF28379DLaunchPad, the document Homework 2
// and Lab 3 send students to). It is the LaunchPad's part of Table 4-3 of
// the data sheet (TMS320F2837xD, SPRS880, section 4.4.1), in the same
// columns. Four cells are corrected against the data sheet, where the
// course's sheet has a typing slip: GPIO7 index 6 is CANRXB, GPIO9 index 6
// SCIRXDA, GPIO20 index 3 CANTXB and GPIO64 index 3 EM2D4.
//
// A mux index 0..15 is two fields of two bits (TRM 8.7 and 8.9.2):
// GPyGMUXn.GPIOz holds the upper two bits and GPyMUXn.GPIOz the lower two.
// GPIO_SetupPinMux() takes the index. Index 0, 4, 8 and 12 are plain GPIO.
// The peripheral models keep their own pin lists; tests/doc_tables.test.ts
// checks them against this table.
//
// Not in the table: the pins the LaunchPad does not bring out, and the
// functions of index 9 to 11, 13 and 14, which the chip does not use.

export interface PinMuxRow {
  /** GPIO number. */
  pin: number;
  /** LaunchPad header pin as the table prints it ("40/J4.10"), or "". */
  header: string;
  /** Signal at each mux index (1, 2, 3, 5, 6, 7, 15) as the table prints it. */
  fn: Partial<Record<number, string>>;
}

/** The table's columns: the mux index GPIO_SetupPinMux() takes. */
export const PINMUX_INDEXES = [0, 1, 2, 3, 5, 6, 7, 15] as const;

export const PINMUX_ROWS: PinMuxRow[] = [
  { pin: 0, header: "40/J4.10", fn: { 1: "EPWM1A", 6: "SDAA" } },
  { pin: 1, header: "39/J4.9", fn: { 1: "EPWM1B", 3: "MFSRB", 6: "SCLA" } },
  { pin: 2, header: "38/J4.8", fn: { 1: "EPWM2A", 5: "OUTXBAR1", 6: "SDAB" } },
  { pin: 3, header: "37/J4.7", fn: { 1: "EPWM2B", 2: "OUTXBAR2", 3: "MCLKRB", 5: "OUTXBAR2", 6: "SCLB" } },
  { pin: 4, header: "36/J4.6", fn: { 1: "EPWM3A", 5: "OUTXBAR3", 6: "CANTXA" } },
  { pin: 5, header: "35/J4.5", fn: { 1: "EPWM3B", 2: "MFSRA", 3: "OUTXBAR3", 6: "CANRXA" } },
  { pin: 6, header: "80/J8.10", fn: { 1: "EPWM4A", 2: "OUTXBAR4", 3: "EXTSYNCOUT", 5: "EQEP3A", 6: "CANTXB" } },
  { pin: 7, header: "79/J8.9", fn: { 1: "EPWM4B", 2: "MCLKRA", 3: "OUTXBAR5", 5: "EQEP3B", 6: "CANRXB" } },
  { pin: 8, header: "78/J8.8", fn: { 1: "EPWM5A", 2: "CANTXB", 3: "ADCSOCAO", 5: "EQEP3S", 6: "SCITXDA" } },
  { pin: 9, header: "77/J8.7", fn: { 1: "EPWM5B", 2: "SCITXDB", 3: "OUTXBAR6", 5: "EQEP3I", 6: "SCIRXDA" } },
  { pin: 10, header: "76/J8.6", fn: { 1: "EPWM6A", 2: "CANRXB", 3: "ADCSOCBO", 5: "EQEP1A", 6: "SCITXDB", 15: "UPP-WAIT" } },
  { pin: 11, header: "75/J8.5", fn: { 1: "EPWM6B", 2: "SCIRXDB", 3: "OUTXBAR7", 5: "EQEP1B", 6: "SCIRXDB", 15: "UPP-START" } },
  { pin: 12, header: "J12", fn: { 1: "EPWM7A", 2: "CANTXB", 3: "MDXB", 5: "EQEP1S", 6: "SCITXDC", 15: "UPP-ENA" } },
  { pin: 14, header: "74/J8.4", fn: { 1: "EPWM8A", 2: "SCITXDB", 3: "MCLKXB", 6: "OUTXBAR3", 15: "UPP-D6" } },
  { pin: 15, header: "73/J8.3", fn: { 1: "EPWM8B", 2: "SCIRXDB", 3: "MFSXB", 6: "OUTXBAR4", 15: "UPP-D5" } },
  { pin: 16, header: "33/J4.3", fn: { 1: "SPISIMOA", 2: "CANTXB", 3: "OUTXBAR7", 5: "EPWM9A", 7: "SD1_D1", 15: "UPP-D4" } },
  { pin: 17, header: "J12", fn: { 1: "SPISOMIA", 2: "CANRXB", 3: "OUTXBAR8", 5: "EPWM9B", 7: "SD1_C1", 15: "UPP-D3" } },
  { pin: 18, header: "4/J1.4", fn: { 1: "SPICLKA", 2: "SCITXDB", 3: "CANRXA", 5: "EPWM10A", 7: "SD1_D2", 15: "UPP-D2" } },
  { pin: 19, header: "3/J1.3", fn: { 1: "SPISTEA", 2: "SCIRXDB", 3: "CANTXA", 5: "EPWM10B", 7: "SD1_C2", 15: "UPP-D1" } },
  { pin: 20, header: "J14", fn: { 1: "EQEP1A", 2: "MDXA", 3: "CANTXB", 5: "EPWM11A", 7: "SD1_D3", 15: "UPP-D0" } },
  { pin: 21, header: "J14", fn: { 1: "EQEP1B", 2: "MDRA", 3: "CANRXB", 5: "EPWM11B", 7: "SD1_C3", 15: "UPP-CLK" } },
  { pin: 22, header: "8/J1.8", fn: { 1: "EQEP1S", 2: "MCLKXA", 3: "SCITXDB", 5: "EPWM12A", 6: "SPICLKB", 7: "SD1_D4" } },
  { pin: 24, header: "34/J4.4", fn: { 1: "OUTXBAR1", 2: "EQEP2A", 3: "MDXB", 6: "SPISIMOB", 7: "SD2_D1" } },
  { pin: 25, header: "51/J6.1", fn: { 1: "OUTXBAR2", 2: "EQEP2B", 3: "MDRB", 6: "SPISOMIB", 7: "SD2_C1" } },
  { pin: 26, header: "53/J6.3", fn: { 1: "OUTXBAR3", 2: "EQEP2I", 3: "MCLKXB", 5: "OUTXBAR3", 6: "SPICLKB", 7: "SD2_D2" } },
  { pin: 27, header: "52/J6.2", fn: { 1: "OUTXBAR4", 2: "EQEP2S", 3: "MFSXB", 5: "OUTXBAR4", 6: "SPISTEB", 7: "SD2_C2" } },
  { pin: 29, header: "11/J2.1", fn: { 1: "SCITXDA", 2: "EMSDCKE", 5: "OUTXBAR6", 6: "EQEP3B", 7: "SD2_C3" } },
  { pin: 31, header: "", fn: { 1: "CANTXA", 2: "EM1WE", 5: "OUTXBAR8", 6: "EQEP3I", 7: "SD2_C4" } },
  { pin: 32, header: "2/J1.2", fn: { 1: "SDAA", 2: "EM1CS0" } },
  { pin: 34, header: "", fn: { 1: "OUTXBAR1", 2: "EM1CS2", 6: "SDAB" } },
  { pin: 40, header: "50/J5.10", fn: { 2: "EM1A2", 6: "SDAB" } },
  { pin: 41, header: "49/J5.9", fn: { 2: "EM1A3", 6: "SCLB" } },
  { pin: 42, header: "FTDI", fn: { 6: "SDAA", 15: "SCITXDA" } },
  { pin: 43, header: "FTDI", fn: { 6: "SCLA", 15: "SCIRXDA" } },
  { pin: 52, header: "48/J5.8", fn: { 1: "EQEP1S", 2: "EM1A12", 6: "SPICLKC", 7: "SD1_D3" } },
  { pin: 54, header: "J15", fn: { 1: "SPISIMOA", 2: "EM1D30", 3: "EM2D14", 5: "EQEP2A", 6: "SCITXDB", 7: "SD1_D4" } },
  { pin: 55, header: "J15", fn: { 1: "SPISOMIA", 2: "EM1D29", 3: "EM2D13", 5: "EQEP2B", 6: "SCIRXDB", 7: "SD1_C4" } },
  { pin: 56, header: "44/J5.4", fn: { 1: "SPICLKA", 2: "EM1D28", 3: "EM2D12", 5: "EQEP2S", 6: "SCITXDC", 7: "SD2_D1" } },
  { pin: 57, header: "J15", fn: { 1: "SPISTEA", 2: "EM1D27", 3: "EM2D11", 5: "EQEP2I", 6: "SCIRXDC (I)", 7: "SD2_C1" } },
  { pin: 58, header: "15/J2.5", fn: { 1: "MCLKRA", 2: "EM1D26", 3: "EM2D10", 5: "OUTXBAR1", 6: "SPICLKB", 7: "SD2_D2", 15: "SPISIMOA" } },
  { pin: 59, header: "14/J2.4", fn: { 1: "MFSRA", 2: "EM1D25", 3: "EM2D9", 5: "OUTXBAR2", 6: "SPISTEB", 7: "SD2_C2", 15: "SPISOMIA" } },
  { pin: 60, header: "7/J1.7", fn: { 1: "MCLKRB", 2: "EM1D24", 3: "EM2D8", 5: "OUTXBAR3", 6: "SPISIMOB", 7: "SD2_D3", 15: "SPICLKA" } },
  { pin: 61, header: "19/J2.9", fn: { 1: "MFSRB", 2: "EM1D23", 3: "EM2D7", 5: "OUTXBAR4", 6: "SPISOMIB", 7: "SD2_C3", 15: "SPISTEA" } },
  { pin: 63, header: "55/J6.5", fn: { 1: "SCITXDC", 2: "EM1D21", 3: "EM2D5", 5: "EQEP3B", 6: "CANTXA", 7: "SD2_C4", 15: "SPISIMOB" } },
  { pin: 64, header: "54/J6.4", fn: { 2: "EM1D20", 3: "EM2D4", 5: "EQEP3S", 6: "SCIRXDA", 15: "SPISOMIB" } },
  { pin: 65, header: "47/J5.7", fn: { 2: "EM1D19", 3: "EM2D3", 5: "EQEP3I", 6: "SCITXDA", 15: "SPICLKB" } },
  { pin: 66, header: "59/J6.9", fn: { 2: "EM1D18", 3: "EM2D2", 6: "SDAB", 15: "SPISTEB" } },
  { pin: 67, header: "5/J1.5", fn: { 2: "EM1D17", 3: "EM2D1" } },
  { pin: 72, header: "", fn: {  } },
  { pin: 84, header: "", fn: {  } },
  { pin: 94, header: "46/J5.6", fn: { 6: "SCIRXDD" } },
  { pin: 95, header: "42/J5.2", fn: {  } },
  { pin: 97, header: "45/J5.5", fn: { 3: "EM2DQM0", 5: "EQEP1B" } },
  { pin: 99, header: "J14", fn: { 3: "EM2A1", 5: "EQEP1I" } },
  { pin: 104, header: "10/J1.10", fn: { 1: "SDAA", 3: "EM2A6", 5: "EQEP3A", 6: "SCITXDD" } },
  { pin: 105, header: "9/J1.9", fn: { 1: "SCLA", 3: "EM2A7", 5: "EQEP3B", 6: "SCIRXDD" } },
  { pin: 111, header: "6/J1.6", fn: { 3: "EM2BA0" } },
  { pin: 122, header: "17/J2.7", fn: { 6: "SPISIMOC" } },
  { pin: 123, header: "18/J2.8", fn: { 6: "SPISOMIC" } },
  { pin: 124, header: "13/J2.3", fn: { 6: "SPICLKC" } },
  { pin: 125, header: "12/J2.2", fn: { 6: "SPISTEC" } },
  { pin: 130, header: "57/J6.7", fn: { 7: "SD2_D1 (I)" } },
  { pin: 131, header: "58/J6.8", fn: { 7: "SD2_C1 (I)" } },
  { pin: 139, header: "43/J5.3", fn: { 6: "SCIRXDC (I)" } },
  { pin: 157, header: "72/J8.2", fn: { 1: "EPWM7A (O)" } },
  { pin: 158, header: "71/J8.1", fn: { 1: "EPWM7B (O)" } },
  { pin: 159, header: "32/J4.2", fn: { 1: "EPWM8A (O)" } },
  { pin: 160, header: "31/J4.1", fn: { 1: "EPWM8B (O)" } },
];

const BIN2 = ["00b", "01b", "10b", "11b"];

/** The two register fields a mux index is stored in, as the table's header prints them. */
export function muxFields(index: number): { gmux: number; mux: number; gmuxText: string; muxText: string } {
  const gmux = (index >> 2) & 3;
  const mux = index & 3;
  return { gmux, mux, gmuxText: BIN2[gmux], muxText: BIN2[mux] };
}

/** Port letter, bit and the mux registers of a GPIO number (TRM 8.9.2: GPyMUX1 holds pins 0..15 of a port). */
export function pinPlace(pin: number): { port: string; bit: number; half: 1 | 2; mux: string; gmux: string; lo: number; hi: number } {
  const port = "ABCDEF"[pin >> 5];
  const bit = pin & 31;
  const half = bit < 16 ? 1 : 2;
  const lo = 2 * (bit & 15);
  return { port, bit, half, mux: `GP${port}MUX${half}`, gmux: `GP${port}GMUX${half}`, lo, hi: lo + 1 };
}

/** A signal name without the table's direction note: "EPWM7A (O)" is "EPWM7A". */
export const signalName = (printed: string): string => printed.replace(/\s*\([^)]*\)\s*$/, "").toUpperCase();

export const pinMuxRow = (pin: number): PinMuxRow | undefined => PINMUX_ROWS.find((r) => r.pin === pin);

/** Every (pin, index) of the table that carries the signal. */
export function pinsFor(signal: string): { pin: number; index: number }[] {
  const want = signalName(signal);
  const out: { pin: number; index: number }[] = [];
  for (const r of PINMUX_ROWS) for (const i of PINMUX_INDEXES) if (i && r.fn[i] && signalName(r.fn[i]!) === want) out.push({ pin: r.pin, index: i });
  return out;
}

/**
 * Cells a homework or lab has students look up for credit (Homework 2 and
 * Lab 3: EPWM12A, EPWM1A, EPWM2A; Homework 3: EPWM9A and the SPIB pins).
 * The table shows them, as the document does. Nothing in the game prints
 * the finished line of code for them.
 */
const GRADED: [number, string][] = [[22, "EPWM12A"], [0, "EPWM1A"], [2, "EPWM2A"], [16, "EPWM9A"], [63, "SPISIMOB"], [64, "SPISOMIB"], [65, "SPICLKB"]];
export const isGradedMux = (pin: number, signal: string): boolean => GRADED.some(([p, s]) => p === pin && s === signalName(signal));

/** The call that selects a cell of the table. For a graded cell the index is left for the student to read. */
export function muxCall(pin: number, index: number, signal?: string): string {
  const graded = !!signal && isGradedMux(pin, signal);
  return `GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, ${graded ? "index" : index});`;
}
