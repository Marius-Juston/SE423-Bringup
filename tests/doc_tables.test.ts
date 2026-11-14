import { describe, expect, it } from "vitest";
import { PIE_CHANNELS, PIE_ENTRIES, PIE_GROUPS, isGradedPie, pieCode, pieEntry } from "../src/sim/device/pie-map";
import { PINMUX_INDEXES, PINMUX_ROWS, isGradedMux, muxCall, muxFields, pinMuxRow, pinPlace, pinsFor, signalName } from "../src/sim/device/pinmux";
import { ADC_TRIGGERS, REGISTER_PAGES } from "../src/sim/device/register-pages";
import { fieldShift } from "../src/sim/device/device";
import { SCI_PINS } from "../src/sim/periph/sci";
import { triggerName } from "../src/sim/plugins/adc";
import { epwmPins } from "../src/sim/plugins/epwm";
import { ENCODERS } from "../src/sim/plugins/eqep";
import { I2C_MUX, I2C_SCL_PIN, I2C_SDA_PIN } from "../src/sim/plugins/i2c";
import { PINS as SPI_PINS } from "../src/sim/plugins/spi";
import { runProgram } from "../src/sim/runner";
import { CHAPTERS } from "../src/levels";

// The documents the game shows (the PIE channel map, the pin mux table and
// register pages) are data next to the simulator. These tests keep the two
// from disagreeing, and keep the look-ups that homeworks and labs grade
// out of the text of the levels that teach reading the documents.

const board = runProgram({ kit: "robot", source: "void main(void)\n{\n    while (1) {\n    }\n}\n", durationMs: 1 }).board;

describe("the PIE channel map", () => {
  it("has 12 groups of 16 channels and names the vectors the PIE model uses", () => {
    expect(PIE_ENTRIES.length).toBe(PIE_GROUPS * PIE_CHANNELS);
    for (const e of PIE_ENTRIES) {
      const model = board.pie.vectorName(e.group, e.channel);
      if (e.vector) expect(e.vector).toBe(model);
      else expect(model).toMatch(/RESERVED/);
    }
  });
  it("agrees with Table 3-2 on entries the course uses", () => {
    const at = (x: number, y: number) => pieEntry(x, y)!.name;
    expect([at(1, 1), at(1, 4), at(1, 7), at(3, 5), at(2, 5), at(9, 1), at(12, 9), at(1, 9), at(9, 5)]).toEqual(["ADCA1", "XINT1", "TIMER0", "EPWM5", "EPWM5_TZ", "SCIA_RX", "EMIF_ERROR", "-", "CANA_0"]);
  });
  it("prints no group or channel number for an entry that is graded work", () => {
    const graded = PIE_ENTRIES.filter(isGradedPie);
    expect(graded.map((e) => e.name)).toEqual(["ADCB1", "ADCC1", "SPIB_RX"]);
    for (const e of graded) expect(pieCode(e).join("\n")).not.toMatch(/PIEIER\d|INTx\d|M_INT\d|GROUP\d/);
    expect(pieCode(pieEntry(1, 7)!).join("\n")).toContain("PieCtrlRegs.PIEIER1.bit.INTx7 = 1;");
    // The simulator hides the same channels in its messages.
    for (const key of board.pie.libraryEnable.keys()) {
      const [x, y] = key.split(".").map(Number);
      expect(isGradedPie(pieEntry(x, y)!), key).toBe(true);
    }
  });
});

describe("the pin mux table", () => {
  const cell = (pin: number, index: number) => {
    const row = pinMuxRow(pin);
    return row?.fn[index] ? signalName(row.fn[index]!) : undefined;
  };
  it("lists each pin once, in order, with signals only in the table's columns", () => {
    const pins = PINMUX_ROWS.map((r) => r.pin);
    expect([...pins].sort((a, b) => a - b)).toEqual(pins);
    expect(new Set(pins).size).toBe(pins.length);
    for (const r of PINMUX_ROWS) for (const k of Object.keys(r.fn)) expect(PINMUX_INDEXES as readonly number[]).toContain(+k);
  });
  it("splits an index into the two register fields the simulator reads", () => {
    for (let i = 0; i < 16; i++) {
      const f = muxFields(i);
      expect((f.gmux << 2) | f.mux).toBe(i);
    }
    expect(muxFields(6)).toMatchObject({ gmuxText: "01b", muxText: "10b" });
    expect(pinPlace(40)).toMatchObject({ port: "B", bit: 8, mux: "GPBMUX1", gmux: "GPBGMUX1", lo: 16, hi: 17 });
    expect(pinPlace(22)).toMatchObject({ port: "A", mux: "GPAMUX2", lo: 12 });
  });
  it("agrees with the pins of the peripheral models", () => {
    // ePWM outputs (plugins/epwm.ts)
    for (let n = 1; n <= 12; n++)
      for (const out of [0, 1] as const)
        for (const r of epwmPins(n, out)) if (pinMuxRow(r.pin)) expect(cell(r.pin, r.mux), `GPIO${r.pin}`).toBe(`EPWM${n}${"AB"[out]}`);
    // serial ports (periph/sci.ts): [rx, tx, mux]
    SCI_PINS.forEach(([rx, tx, mux], port) => {
      const L = "ABCD"[port];
      if (pinMuxRow(rx)) expect(cell(rx, mux)).toBe(`SCIRXD${L}`);
      if (pinMuxRow(tx)) expect(cell(tx, mux)).toBe(`SCITXD${L}`);
    });
    // encoders (plugins/eqep.ts)
    for (const e of ENCODERS) {
      expect(cell(e.pinA, e.mux)).toBe(`EQEP${e.n}A`);
      expect(cell(e.pinB, e.mux)).toBe(`EQEP${e.n}B`);
    }
    // I2CB (plugins/i2c.ts)
    expect(cell(I2C_SDA_PIN, I2C_MUX)).toBe("SDAB");
    expect(cell(I2C_SCL_PIN, I2C_MUX)).toBe("SCLB");
    // SPI (plugins/spi.ts)
    for (const [id, sigs] of Object.entries(SPI_PINS))
      for (const [sig, list] of Object.entries(sigs))
        for (const [pin, mux] of list) if (pinMuxRow(pin)) expect(cell(pin, mux), `GPIO${pin}`).toBe(`SPI${sig.toUpperCase()}${id.toUpperCase()}`);
    // CAN-B as the course starter sets it (plugins/can.ts)
    expect(cell(17, 2)).toBe("CANRXB");
    expect(cell(12, 2)).toBe("CANTXB");
  });
  it("finds every pin of a signal", () => {
    expect(pinsFor("SDAB")).toEqual([{ pin: 2, index: 6 }, { pin: 34, index: 6 }, { pin: 40, index: 6 }, { pin: 66, index: 6 }]);
    expect(pinsFor("epwm7a")).toEqual([{ pin: 12, index: 1 }, { pin: 157, index: 1 }]);
  });
  it("leaves the index of a graded cell for the student", () => {
    expect(muxCall(40, 6, "SDAB")).toBe("GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);");
    for (const [pin, sig] of [[22, "EPWM12A"], [0, "EPWM1A"], [2, "EPWM2A"], [16, "EPWM9A"], [63, "SPISIMOB"], [64, "SPISOMIB"], [65, "SPICLKB"]] as const) {
      expect(isGradedMux(pin, sig)).toBe(true);
      expect(muxCall(pin, 99, sig)).toBe(`GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, index);`);
    }
  });
});

describe("the register pages", () => {
  for (const page of REGISTER_PAGES) {
    it(`${page.acronym}: fields, bits and write protection agree with the register map`, () => {
      const reg = board.dev.reg(page.reg);
      const bits = reg.words * 16;
      // The page lists every bit once, from the top down.
      let next = bits - 1;
      for (const f of page.fields) {
        expect(f.hi, f.name).toBe(next);
        expect(f.lo).toBeLessThanOrEqual(f.hi);
        next = f.lo - 1;
      }
      expect(next).toBe(-1);
      const named = page.fields.filter((f) => f.name !== "RESERVED").map((f) => `${f.name} ${f.hi}:${f.lo}`);
      const map = reg.fields.map((f) => `${f.name} ${fieldShift(f) + (f.bitW ?? 16) - 1}:${fieldShift(f)}`).sort((a, b) => +b.split(" ")[1].split(":")[0] - +a.split(" ")[1].split(":")[0]);
      expect(named).toEqual(map);
      expect(page.protection.value === "EALLOW").toBe(!!reg.hook.protect);
      // The reset value in the heading is the fields' reset values put together.
      const reset = page.fields.reduce((v, f) => v + parseInt(f.reset, 16) * 2 ** f.lo, 0);
      expect(page.heading).toContain(`[reset = ${reset.toString(16).toUpperCase()}h]`);
    });
  }
  it("the TRIGSEL list is the trigger the ADC model takes for each value", () => {
    expect(ADC_TRIGGERS.length).toBe(32);
    for (const t of ADC_TRIGGERS) {
      const model = triggerName(t.value);
      if (!model) continue;
      const timer = /^TINT(\d)$/.exec(model);
      if (timer) expect(t.text).toContain(`CPU1 Timer ${timer[1]}, TINT${timer[1]}n`);
      else {
        const m = /^EPWM(\d+)SOC([AB])$/.exec(model)!;
        expect(t.text).toContain(`ePWM${m[1]}, ADCSOC${m[2]}`);
      }
    }
    expect(ADC_TRIGGERS[0x15].text).toBe("15h ADCTRIG21 - ePWM9, ADCSOCA");
  });
});

describe("what homeworks and labs grade is not printed by the levels on reading documents", () => {
  const IDS = ["reg-page", "reg-page-set", "int-table", "int-lookup", "adc-trigger-table", "pwm-pinmux", "pwm-route"];
  const levels = CHAPTERS.flatMap((c) => c.levels).filter((l) => IDS.includes(l.id));
  it("covers every level of the thread", () => {
    expect(levels.map((l) => l.id).sort()).toEqual([...IDS].sort());
  });
  it("no PIE channel of ADCB1, ADCC1 or SPIB_RX, no mux index of the graded pins, no graded TRIGSEL", () => {
    for (const level of levels) {
      const t = JSON.stringify(level);
      // Lab 4: ADCB1 and ADCC1. Homework 3: SPIB_RX.
      expect(t, level.id).not.toMatch(/INT1\.[23]\b|PIEIER1\.bit\.INTx[23]\b|INT6\.3\b|PIEIER6\.bit\.INTx3\b|[23] ADC[BC]1|3 SPIB_RX/);
      // Homework 2 and Lab 3: EPWM12A, EPWM1A, EPWM2A. Homework 3: EPWM9A and the SPIB pins.
      expect(t, level.id).not.toMatch(/GPIO_SetupPinMux\((22|16), GPIO_MUX_CPU1, 5\)|GPIO_SetupPinMux\((0|2), GPIO_MUX_CPU1, 1\)|GPIO_SetupPinMux\(6[345], GPIO_MUX_CPU1, (?!0\))/);
      expect(t, level.id).not.toMatch(/EPWM12A[^.]{0,40}index 5|EPWM9A[^.]{0,40}index 5|EPWM[12]A[^.]{0,40}index 1\b/);
      // Homework 2 and Lab 4: the TRIGSEL of EPWM4 and EPWM7 ADCSOCA.
      expect(t, level.id).not.toMatch(/TRIGSEL = (11|0x0?B|17|0x11)\b|0Bh|11h/i);
    }
  });
});
