import { describe, expect, it } from "vitest";
import { fieldRight, parse } from "../src/ui/widgets/Calc";

describe("numbers typed into a calculation", () => {
  it("reads the usual ways of writing a number", () => {
    expect(parse("102.4")).toBe(102.4);
    expect(parse(" 1.024e2 ")).toBe(102.4);
    expect(parse("0x1F")).toBe(31);
    expect(parse("0b101")).toBe(5);
    expect(parse("1 000 000")).toBe(1e6);
    expect(parse("1_024")).toBe(1024);
    expect(parse("-0x10")).toBe(-16);
  });
  it("takes a comma as thousands or as the decimal point", () => {
    expect(parse("1,024")).toBe(1024);
    expect(parse("12,345,678")).toBe(12345678);
    expect(parse("102,4")).toBe(102.4);
    expect(parse("0,5")).toBe(0.5);
    expect(parse("1,02,4")).toBeNull();
  });
  it("accepts the field's own unit after the number, and nothing else", () => {
    expect(parse("102.4 ms", "ms")).toBe(102.4);
    expect(parse("50%", "%")).toBe(50);
    expect(parse("5 kHz", "Hz")).toBeNull();
    expect(parse("102.4 s", "ms")).toBeNull();
    expect(parse("0xA", "A")).toBe(10);
    expect(parse("", "ms")).toBeNull();
    expect(parse("ms", "ms")).toBeNull();
  });
  it("judges a field with and without a tolerance", () => {
    expect(fieldRight({ id: "a", label: "", answer: 102.4, unit: "ms", why: "" }, "102,4 ms")).toBe(true);
    expect(fieldRight({ id: "a", label: "", answer: 100, tolPct: 1, why: "" }, "100.9")).toBe(true);
    expect(fieldRight({ id: "a", label: "", answer: 100, tolPct: 1, why: "" }, "101.5")).toBe(false);
  });
});
