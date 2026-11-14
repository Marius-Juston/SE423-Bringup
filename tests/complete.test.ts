import { describe, expect, it } from "vitest";
import { offerAt } from "../src/ui/code/complete";

const labels = (before: string, explicit = false) => offerAt(before, "robot", explicit)?.options.map((o) => o.label) ?? null;

describe("editor completion", () => {
  it("offers the registers of a peripheral after its name", () => {
    const l = labels("    GpioDataRegs.");
    expect(l).toContain("GPASET");
    expect(l).toContain("GPBTOGGLE");
    expect(l!.some((x) => /^rsvd/i.test(x))).toBe(false);
  });
  it("walks .bit and .all, and replaces what is typed so far", () => {
    expect(labels("GpioDataRegs.GPASET.")).toEqual(expect.arrayContaining(["all", "bit"]));
    const o = offerAt("  GpioDataRegs.GPASET.bit.GPIO3", "robot")!;
    expect(o.typed).toBe(5);
    expect(o.options.map((x) => x.label)).toContain("GPIO31");
    expect(o.options.find((x) => x.label === "GPIO31")!.detail).toBe("1 bit");
  });
  it("follows -> through a pointer and an index through an array", () => {
    expect(labels("CpuTimer0.RegsAddr->")).toContain("TCR");
    expect(labels("x = CpuTimer0.RegsAddr->TCR.bit.")).toContain("TSS");
    expect(labels("PieCtrlRegs.PIEIER1.bit.")).toContain("INTx7");
  });
  it("offers nothing after a dot it cannot resolve", () => {
    expect(labels("mine.")).toBeNull();
    expect(labels("GpioDataRegs.NOPE.")).toBeNull();
    expect(labels("x = 1.")).toBeNull();
  });
  it("offers library names for a word, but not inside a number or with nothing typed", () => {
    const l = labels("    GPIO_Set");
    expect(l).toEqual(expect.arrayContaining(["GPIO_SetupPinMux", "GpioDataRegs", "EALLOW", "uint16_t", "while"]));
    expect(l!.some((x) => x.startsWith("__") && x !== "__interrupt")).toBe(false);
    expect(labels("    else")).toBeNull();
    expect(labels("    EALLOW")).toBeNull();
    expect(labels("x = 0x1F")).toBeNull();
    expect(labels("x = 10UL")).toBeNull();
    expect(labels("    ")).toBeNull();
    expect(labels("    ", true)).toContain("GpioDataRegs");
  });
});
