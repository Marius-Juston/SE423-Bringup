// ADC A/B/C/D. TRM chapter 11 "Analog-to-Digital Converter (ADC)".
//
//   11.4.5  result = 4096 * (ADCINy - VREFLO) / (VREFHI - VREFLO), limited to
//           0..4095 (12-bit single-ended, the only mode the course uses)
//   11.5    16 SOCs per ADC, each with a trigger (TRIGSEL), a channel (CHSEL)
//           and an acquisition window of (ACQPS + 1) SYSCLK cycles
//   11.6.4  software trigger through ADCSOCFRC1
//   11.7    round-robin order (RRPOINTER) and high-priority SOCs (SOCPRIORITY)
//   11.9    ADCINT1..4: INTxSEL, INTxE, INTxCONT, ADCINTFLG, ADCINTOVF
//   11.12   power-up: ADCCTL2.PRESCALE, ADCCTL1.ADCPWDNZ, then a delay
//   11.14   timings, Table 11-12: after the S+H window the ADC is free again
//           after tEOC, the result latches after tLAT, and the ADCINT flag is
//           set at the end of the window (INTPULSEPOS = 0) or after tEOC
//           (INTPULSEPOS = 1)
//   11.16   register behaviour (write 1 to clear, read-only flags, TRIGSEL
//           numbering of Table 11-32)
//   3.4.5   PIE channels (Table 3-2): ADCA1 1.1, ADCB1 1.2, ADCC1 1.3,
//           ADCD1 1.6, ADCx2..4 in group 10
//
// Inputs are read from the signal bus in volts: "ADCINA0".."ADCINA15",
// "ADCINB0".., "ADCINC2".., "ADCIND0".. (default 0 V). Channels 14 and 15
// are the pins shared by all four ADCs: "ADCIN14" / "ADCIN15" are used
// when no per-ADC value was set. ADCINA0, ADCINA1 and ADCINB1 share a pin
// with DACOUTA, DACOUTB and DACOUTC: while that DAC's output is enabled the
// channel reads the DAC voltage (a loopback with no wire).
//
// Not modelled: 16-bit and differential conversions (a warning is shown and
// the conversion is done as 12-bit single-ended), burst mode, the
// post-processing blocks, ADCEXTSOC (TRIGSEL 4) and the CPU2 timers.

import { SYSCLK_NS } from "../consts";
import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import type { Part } from "../world/kits";

const VREFHI = 3.0;
const VREFLO = 0.0;

/** TRM Table 11-12, 12-bit mode, SYSCLK cycles, indexed by ADCCTL2.PRESCALE (1 is invalid). */
const T_EOC = [11, 11, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86];
const T_LAT = [13, 13, 23, 28, 34, 39, 44, 49, 55, 60, 65, 70, 76, 81, 86, 91];
/** ADCCLK = SYSCLK / ratio (TRM Table 11-17). */
const PRESCALE_RATIO = [1, 1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5];

/** Minimum S+H window in 12-bit mode, ns (F2837xD data manual, the value TRM 11.5.3 refers to). */
const MIN_ACQ_NS = 75;
/** ADC power-up time, ns (F2837xD data manual, the delay of TRM 11.12 step 4). */
const POWER_UP_NS = 500_000;

/** PIE group and channel of ADCINT1..4 for each ADC (TRM Table 3-2). */
const PIE: Record<string, [number, number][]> = {
  a: [[1, 1], [10, 2], [10, 3], [10, 4]],
  b: [[1, 2], [10, 6], [10, 7], [10, 8]],
  c: [[1, 3], [10, 10], [10, 11], [10, 12]],
  d: [[1, 6], [10, 14], [10, 15], [10, 16]],
};

/** Pins an ADC channel shares with a buffered DAC output. */
const DAC_PIN: Record<string, { regs: string; out: string }> = {
  ADCINA0: { regs: "DacaRegs", out: "DACA" },
  ADCINA1: { regs: "DacbRegs", out: "DACB" },
  ADCINB1: { regs: "DaccRegs", out: "DACC" },
};

/** The trigger line that TRIGSEL value selects (TRM Table 11-32), or null. */
export function triggerName(trigsel: number): string | null {
  if (trigsel >= 1 && trigsel <= 3) return `TINT${trigsel - 1}`;
  if (trigsel >= 5 && trigsel <= 28) return `EPWM${((trigsel - 5) >> 1) + 1}SOC${(trigsel - 5) & 1 ? "B" : "A"}`;
  return null;
}

/** TRM Table 11-2: the 12-bit single-ended result for an input voltage. */
export function adcCode(volts: number): number {
  const code = Math.floor((4096 * (volts - VREFLO)) / (VREFHI - VREFLO));
  return Math.min(4095, Math.max(0, code));
}

function installAdc(b: Board, letter: string): void {
  const dev = b.dev;
  const L = letter.toUpperCase();
  const pre = `Adc${letter}Regs`;
  const res = `Adc${letter}ResultRegs`;
  const r = (name: string) => `${pre}.${name}`;

  let busy = false;
  /** Time ADCPWDNZ went from 0 to 1 (ns), -1 while powered down. */
  let poweredAt = -1;
  /** Hardware trigger selected by each SOC, cached from ADCSOCxCTL.TRIGSEL. */
  const trig: (string | null)[] = new Array(16).fill(null);
  /** Line of the student's code that last wrote each ADCSOCxCTL (for diagnostics). */
  const socLine: number[] = new Array(16).fill(0);
  const latched: boolean[] = new Array(16).fill(false);

  // Reset state: RRPOINTER = 16, so SOC0 has the highest round-robin priority.
  dev.set(r("ADCSOCPRICTL"), 16, "RRPOINTER");

  const powered = () => dev.get(r("ADCCTL1"), "ADCPWDNZ") === 1;

  /** Voltage on the pin of channel `ch`. */
  const voltage = (ch: number): number => {
    const name = `ADCIN${L}${ch}`;
    const dac = DAC_PIN[name];
    if (dac && dev.get(`${dac.regs}.DACOUTEN`, "DACOUTEN") === 1) return b.output(dac.out) ?? 0;
    if (ch >= 14 && !b.inputs.has(name)) return b.input(`ADCIN${ch}`);
    return b.input(name);
  };

  /** The pending SOC that converts next (TRM 11.7), or -1. */
  const nextSoc = (): number => {
    const flags = dev.get(r("ADCSOCFLG1"));
    if (!flags) return -1;
    const high = dev.get(r("ADCSOCPRICTL"), "SOCPRIORITY");
    // High-priority SOCs (below SOCPRIORITY) go first, lowest number first.
    for (let s = 0; s < Math.min(high, 16); s++) if (flags & (1 << s)) return s;
    const first = Math.min(high, 16);
    const n = 16 - first;
    if (n <= 0) return -1;
    const ptr = dev.get(r("ADCSOCPRICTL"), "RRPOINTER");
    // The SOC after the pointer has the highest round-robin priority.
    const start = ptr >= 16 || ptr < first ? first : ptr + 1;
    for (let i = 0; i < n; i++) {
      const s = first + ((start - first + i) % n);
      if (flags & (1 << s)) return s;
    }
    return -1;
  };

  /** One ADCINT pulse: flag, overflow, PIE request and trigger line (TRM 11.9). */
  const eoc = (soc: number, t: number): void => {
    for (let n = 1; n <= 4; n++) {
      const sel = r(n <= 2 ? "ADCINTSEL1N2" : "ADCINTSEL3N4");
      if (!dev.get(sel, `INT${n}E`) || dev.get(sel, `INT${n}SEL`) !== soc) continue;
      const bit = 1 << (n - 1);
      const flags = dev.get(r("ADCINTFLG"));
      if (flags & bit) {
        // Flag still set from the last time: overflow. A new pulse only in continuous mode.
        dev.set(r("ADCINTOVF"), dev.get(r("ADCINTOVF")) | bit);
        if (!dev.get(sel, `INT${n}CONT`)) continue;
      } else dev.set(r("ADCINTFLG"), flags | bit);
      const [group, channel] = PIE[letter][n - 1];
      b.pie.raise(group, channel);
      b.fireTrigger(`ADC${L}INT${n}`, t);
      // ADCINT1 and ADCINT2 can start SOCs again (ADCINTSOCSEL1/2, TRM 11.5.2).
      if (n <= 2) {
        let mask = 0;
        for (let s = 0; s < 16; s++) if (dev.get(r(s < 8 ? "ADCINTSOCSEL1" : "ADCINTSOCSEL2"), `SOC${s}`) === n) mask |= 1 << s;
        if (mask) request(mask, t, true);
      }
    }
  };

  const start = (soc: number, t: number): void => {
    busy = true;
    b.mem.writes++;
    dev.set(r("ADCSOCFLG1"), dev.get(r("ADCSOCFLG1")) & ~(1 << soc));
    dev.set(r("ADCCTL1"), 1, "ADCBSY");
    dev.set(r("ADCCTL1"), soc, "ADCBSYCHN");
    if (soc >= dev.get(r("ADCSOCPRICTL"), "SOCPRIORITY")) dev.set(r("ADCSOCPRICTL"), soc, "RRPOINTER");

    const ctl = r(`ADCSOC${soc}CTL`);
    const line = socLine[soc] || b.line;
    const prescale = dev.get(r("ADCCTL2"), "PRESCALE");
    const acqNs = (dev.get(ctl, "ACQPS") + 1) * SYSCLK_NS;
    const adcclkNs = SYSCLK_NS * PRESCALE_RATIO[prescale];
    if (acqNs < Math.max(MIN_ACQ_NS, adcclkNs)) {
      const need = Math.ceil(Math.max(MIN_ACQ_NS, adcclkNs) / SYSCLK_NS) - 1;
      b.warn(
        line,
        "adc-acqps",
        `ADC${L} SOC${soc} samples for only ${acqNs} ns (ACQPS + 1 = ${acqNs / SYSCLK_NS} SYSCLK cycles of 5 ns). The sampling capacitor needs at least ` +
          `${Math.max(MIN_ACQ_NS, adcclkNs)} ns to charge, so the result would be wrong on the real chip. Set ACQPS to ${need} or more; the course uses 99 (500 ns).`,
      );
    }
    if (dev.get(r("ADCCTL2"), "RESOLUTION") || dev.get(r("ADCCTL2"), "SIGNALMODE"))
      b.warn(line, "adc-mode", `ADC${L} is set to 16-bit or differential mode, which this simulator does not model. The conversion was done in 12-bit single-ended mode, as the course uses: AdcSetMode(ADC_ADC${L}, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);`);
    if (prescale === 1) b.warn(line, "adc-prescale", `${pre}.ADCCTL2.bit.PRESCALE = 1 is an invalid setting. The course uses 6 (ADCCLK = SYSCLK / 4 = 50 MHz).`);

    const on = powered();
    if (!on)
      b.warn(
        line,
        "adc-powerdown",
        `ADC${L} SOC${soc} was triggered while ADC${L} is powered down, so the result is meaningless (0 here). Power it up first, between EALLOW; and EDIS;: ` +
          `${pre}.ADCCTL1.bit.ADCPWDNZ = 1; then DELAY_US(1000);`,
        "error",
      );
    else if (t - poweredAt < POWER_UP_NS)
      b.warn(
        line,
        "adc-powerup",
        `ADC${L} SOC${soc} was triggered ${Math.round((t - poweredAt) / 1000)} us after power-up. The analog circuits need about 500 us to settle: add DELAY_US(1000); after setting ADCPWDNZ.`,
      );

    const late = dev.get(r("ADCCTL1"), "INTPULSEPOS") === 1;
    const sh = t + acqNs;
    // End of the S+H window: the voltage on the pin at this moment is what gets converted.
    b.at(sh, (ts) => {
      const code = on ? adcCode(voltage(dev.get(ctl, "CHSEL"))) : 0;
      if (!late) eoc(soc, ts);
      b.at(ts + T_LAT[prescale] * SYSCLK_NS, () => {
        dev.set(`${res}.ADCRESULT${soc}`, code);
        latched[soc] = true;
        b.mem.writes++;
      });
      b.at(ts + T_EOC[prescale] * SYSCLK_NS, (te) => {
        if (late) eoc(soc, te);
        busy = false;
        b.mem.writes++;
        dev.set(r("ADCCTL1"), 0, "ADCBSY");
        const next = nextSoc();
        if (next >= 0) start(next, te);
      });
    });
  };

  /** Sets SOC flags (a trigger arrived) and starts converting if the ADC is idle. */
  function request(mask: number, t: number, hardware: boolean): void {
    const flags = dev.get(r("ADCSOCFLG1"));
    // A hardware trigger for a SOC that is still pending was missed (ADCSOCOVF1).
    if (hardware && flags & mask) dev.set(r("ADCSOCOVF1"), dev.get(r("ADCSOCOVF1")) | (flags & mask));
    dev.set(r("ADCSOCFLG1"), flags | mask);
    b.mem.writes++;
    if (!busy) {
      const next = nextSoc();
      if (next >= 0) start(next, t);
    }
  }

  // ---- registers ----
  // TRM Table 11-14: the flag, clear, force and status registers are not
  // EALLOW-protected (the course's interrupt function clears ADCINTFLG with
  // no EALLOW); the configuration registers are.
  for (const [name, info] of dev.regs) {
    if (!name.startsWith(`${pre}.`)) continue;
    const short = name.slice(pre.length + 1);
    if (/^(ADCINTFLG|ADCINTFLGCLR|ADCINTOVF|ADCINTOVFCLR|ADCSOCFLG1|ADCSOCFRC1|ADCSOCOVF1|ADCSOCOVFCLR1|ADCEVTSTAT|ADCEVTCLR|ADCCOUNTER|ADCREV|ADCPPB\dSTAMP|ADCPPB\dOFFREF)$/.test(short))
      info.hook.protect = false;
  }
  const readOnly = (name: string) => {
    dev.reg(r(name)).hook.write = (_v, stored) => stored;
  };
  for (const name of ["ADCINTFLG", "ADCINTOVF", "ADCSOCFLG1", "ADCSOCOVF1"]) readOnly(name);

  /** Write 1 to clear the same bit of `target`; the register itself always reads 0. */
  const clears = (name: string, target: string) => {
    const h = dev.reg(r(name)).hook;
    h.write = () => 0;
    h.after = (v) => dev.set(r(target), dev.get(r(target)) & ~v);
  };
  clears("ADCINTFLGCLR", "ADCINTFLG");
  clears("ADCINTOVFCLR", "ADCINTOVF");
  clears("ADCSOCOVFCLR1", "ADCSOCOVF1");

  const frc = dev.reg(r("ADCSOCFRC1")).hook;
  frc.write = () => 0;
  frc.after = (v) => {
    if (v & 0xffff) request(v & 0xffff, b.now, false);
  };

  const ctl1 = dev.reg(r("ADCCTL1")).hook;
  // ADCBSY (bit 13) and ADCBSYCHN (bits 11-8) are read-only.
  ctl1.write = (v, stored) => (v & ~0x2f00) | (stored & 0x2f00);
  ctl1.after = (v, before) => {
    if (v & 0x80 && !(before & 0x80)) poweredAt = b.now;
    else if (!(v & 0x80)) poweredAt = -1;
  };

  const pri = dev.reg(r("ADCSOCPRICTL")).hook;
  // RRPOINTER (bits 9-5) is read-only and goes back to 16 when the register is written.
  pri.write = (v) => (v & 0x1f) | (16 << 5);

  for (let s = 0; s < 16; s++) {
    dev.reg(r(`ADCSOC${s}CTL`)).hook.after = () => {
      trig[s] = triggerName(dev.get(r(`ADCSOC${s}CTL`), "TRIGSEL"));
      if (!b.libDepth || !socLine[s]) socLine[s] = b.line;
    };
    dev.reg(`${res}.ADCRESULT${s}`).hook.read = (stored) => {
      if (!latched[s])
        b.warn(
          b.line,
          "adc-no-result",
          `${res}.ADCRESULT${s} was read before SOC${s} of ADC${L} finished a conversion, so it still holds 0. Read it after the conversion: in the ADC interrupt function, or once ADCINTFLG shows the SOC is done.`,
        );
      return stored;
    };
  }

  // ---- hardware triggers ----
  const names = new Set<string>();
  for (let v = 0; v < 32; v++) {
    const n = triggerName(v);
    if (n) names.add(n);
  }
  for (const name of names)
    b.onTrigger(name, (t) => {
      let mask = 0;
      for (let s = 0; s < 16; s++) if (trig[s] === name) mask |= 1 << s;
      if (mask) request(mask, t, true);
    });
}

const hw2Knobs: Part[] = [
  { kind: "knob", id: "PHOTO", label: "Photoresistor voltage (ADCINA4)", input: "ADCINA4", min: 0, max: 3, step: 0.01, initial: 1.5, unit: "V" },
  { kind: "knob", id: "JOYX", label: "Joystick X (ADCINA2)", input: "ADCINA2", min: 0, max: 3, step: 0.01, initial: 1.5, unit: "V" },
  { kind: "knob", id: "JOYY", label: "Joystick Y (ADCINA3)", input: "ADCINA3", min: 0, max: 3, step: 0.01, initial: 1.5, unit: "V" },
];

export const plugin: SimPlugin = {
  name: "adc",
  prelude: `
// ---- common/include/F2837xD_Adc_defines.h
#define ADC_ADCA 0
#define ADC_ADCB 1
#define ADC_ADCC 2
#define ADC_ADCD 3
#define ADC_RESOLUTION_12BIT 0
#define ADC_RESOLUTION_16BIT 1
#define ADC_SIGNALMODE_SINGLE 0
#define ADC_SIGNALMODE_DIFFERENTIAL 1

// ---- common/source/F2837xD_Adc.c, without the factory trim values it copies from OTP memory
void AdcSetMode(Uint16 adc, Uint16 resolution, Uint16 signalmode)
{
    switch (adc) {
    case ADC_ADCA:
        AdcaRegs.ADCCTL2.bit.RESOLUTION = resolution;
        AdcaRegs.ADCCTL2.bit.SIGNALMODE = signalmode;
        break;
    case ADC_ADCB:
        AdcbRegs.ADCCTL2.bit.RESOLUTION = resolution;
        AdcbRegs.ADCCTL2.bit.SIGNALMODE = signalmode;
        break;
    case ADC_ADCC:
        AdccRegs.ADCCTL2.bit.RESOLUTION = resolution;
        AdccRegs.ADCCTL2.bit.SIGNALMODE = signalmode;
        break;
    case ADC_ADCD:
        AdcdRegs.ADCCTL2.bit.RESOLUTION = resolution;
        AdcdRegs.ADCCTL2.bit.SIGNALMODE = signalmode;
        break;
    }
}
`,
  install(b) {
    for (const letter of ["a", "b", "c", "d"]) installAdc(b, letter);
  },
  parts: { robot: hw2Knobs, redboard: hw2Knobs },
};
