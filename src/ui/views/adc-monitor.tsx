import { triggerName } from "../../sim/plugins/adc";
import type { Board } from "../../sim/board";
import type { BenchView, ViewProps } from "./types";

const ADCS = ["a", "b", "c", "d"];
/** Pins an ADC channel shares with a DAC output (as in the ADC model). */
const DAC_PIN: Record<string, { regs: string; out: string }> = {
  ADCINA0: { regs: "DacaRegs", out: "DACA" },
  ADCINA1: { regs: "DacbRegs", out: "DACB" },
  ADCINB1: { regs: "DaccRegs", out: "DACC" },
};

const powered = (board: Board, letter: string) => board.dev.get(`Adc${letter}Regs.ADCCTL1`, "ADCPWDNZ") === 1;

/** Voltage on an ADC pin right now, read without marking the input as used. */
function pinVolts(board: Board, L: string, ch: number): { volts: number; from: string } {
  const name = `ADCIN${L}${ch}`;
  const dac = DAC_PIN[name];
  if (dac && board.dev.get(`${dac.regs}.DACOUTEN`, "DACOUTEN") === 1) {
    const tr = board.outputs.get(dac.out);
    return { volts: tr?.length ? tr[tr.length - 1].v : 0, from: dac.out };
  }
  if (ch >= 14 && !board.inputs.has(name)) return { volts: board.inputs.get(`ADCIN${ch}`) ?? 0, from: "" };
  return { volts: board.inputs.get(name) ?? 0, from: "" };
}

function when(trigsel: number): string {
  const name = triggerName(trigsel);
  if (trigsel === 0) return "software only";
  if (!name) return `TRIGSEL ${trigsel}`;
  if (name.startsWith("TINT")) return `CPU timer ${name.slice(4)}`;
  return name.replace(/SOC/, " SOC");
}

interface Row {
  adc: string;
  soc: number;
  trigsel: number;
  ch: number;
  acqps: number;
  result: number;
  volts: number;
  from: string;
  ints: number[];
}

function rows(board: Board): Row[] {
  const out: Row[] = [];
  for (const letter of ADCS) {
    if (!powered(board, letter)) continue;
    const L = letter.toUpperCase();
    const pre = `Adc${letter}Regs`;
    const ints: number[][] = Array.from({ length: 16 }, () => []);
    for (let n = 1; n <= 4; n++) {
      const sel = `${pre}.${n <= 2 ? "ADCINTSEL1N2" : "ADCINTSEL3N4"}`;
      if (board.dev.get(sel, `INT${n}E`)) ints[board.dev.get(sel, `INT${n}SEL`)].push(n);
    }
    for (let s = 0; s < 16; s++) {
      const ctl = `${pre}.ADCSOC${s}CTL`;
      const trigsel = board.dev.get(ctl, "TRIGSEL");
      const ch = board.dev.get(ctl, "CHSEL");
      const acqps = board.dev.get(ctl, "ACQPS");
      const result = board.dev.get(`Adc${letter}ResultRegs.ADCRESULT${s}`);
      if (!trigsel && !ch && !acqps && !result && !ints[s].length) continue;
      out.push({ adc: L, soc: s, trigsel, ch, acqps, result, ...pinVolts(board, L, ch), ints: ints[s] });
    }
  }
  return out;
}

/** One row per configured SOC: when, which pin, the pin's voltage now and the latest result. */
function AdcMonitor({ board }: ViewProps) {
  const list = rows(board);
  if (!list.length) return <p className="hint-text">The ADC is powered up but no SOC is set up yet. A SOC needs a trigger (TRIGSEL), a pin (CHSEL) and a sample time (ACQPS).</p>;
  const W = 400;
  const RH = 44;
  const BX0 = 130;
  const BX1 = 296;
  const bx = (frac: number) => BX0 + Math.max(0, Math.min(1, frac)) * (BX1 - BX0);
  return (
    <svg className="scope" viewBox={`0 0 ${W} ${list.length * RH + 14}`} role="img" aria-label={list.map((r) => `ADC${r.adc} SOC${r.soc}: trigger ${when(r.trigsel)}, pin ADCIN${r.adc}${r.ch} at ${r.volts.toFixed(3)} volts, result ${r.result}`).join(". ")}>
      {list.map((r, i) => {
        const y = i * RH;
        return (
          <g key={`${r.adc}${r.soc}`}>
            {i > 0 && <line x1={4} x2={W - 4} y1={y + 1} y2={y + 1} stroke="var(--border)" />}
            <text x={6} y={y + 15} style={{ fill: "var(--text)", fontWeight: 700 }}>ADC{r.adc} SOC{r.soc}</text>
            <text x={70} y={y + 15}>when: <tspan style={{ fill: "var(--text)" }}>{when(r.trigsel)}</tspan></text>
            <text x={190} y={y + 15}>pin: <tspan style={{ fill: "var(--text)" }}>ADCIN{r.adc}{r.ch}</tspan></text>
            {r.ints.length > 0 && <text x={W - 6} y={y + 15} textAnchor="end" style={{ fill: "var(--orange)" }}>raises ADCINT{r.ints.join(",")}</text>}
            <text x={6} y={y + 33}>{r.from || "pin"} now <tspan style={{ fill: "var(--orange)" }}>{r.volts.toFixed(3)} V</tspan></text>
            <rect x={BX0} y={y + 24} width={BX1 - BX0} height={10} rx={2} fill="none" stroke="var(--dim)" strokeWidth={0.8} />
            <rect x={BX0} y={y + 24} width={bx(r.result / 4095) - BX0} height={10} rx={2} fill="var(--harvest)" />
            <line x1={bx(r.volts / 3)} x2={bx(r.volts / 3)} y1={y + 21} y2={y + 37} stroke="var(--orange)" strokeWidth={1.6} />
            <text x={W - 6} y={y + 33} textAnchor="end">RESULT{r.soc} <tspan style={{ fill: "var(--harvest)", fontWeight: 700 }}>{r.result}</tspan></text>
          </g>
        );
      })}
      <text x={BX0} y={list.length * RH + 9}>0</text>
      <text x={BX1} y={list.length * RH + 9} textAnchor="end">4095</text>
      <text x={6} y={list.length * RH + 9}>bar: result</text>
      <text x={W - 6} y={list.length * RH + 9} textAnchor="end">line: pin now</text>
    </svg>
  );
}

export const view: BenchView = {
  id: "adc-monitor",
  title: "ADC: one row per SOC",
  order: 45,
  relevant: (board) => ADCS.some((l) => powered(board, l)),
  Component: AdcMonitor,
};
