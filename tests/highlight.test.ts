import { describe, expect, it } from "vitest";
import { highlightLines } from "../src/ui/code/highlight";

describe("colours for code that is read", () => {
  it("keeps the text exactly and colours keywords, numbers and comments", () => {
    const code = "if (x == 0x1F) {\n    GpioDataRegs.GPASET.bit.GPIO31 = 1;   // on\n}\n\n/* two\n   lines */";
    const lines = highlightLines(code);
    expect(lines.map((l) => l.map((p) => p.text).join("")).join("\n")).toBe(code);
    const cls = (text: string) => lines.flat().find((p) => p.text === text)?.cls;
    expect(cls("if")).toBe("tk-kw");
    expect(cls("0x1F")).toBe("tk-num");
    expect(cls("// on")).toBe("tk-comment");
    expect(lines[4][0].cls).toBe("tk-comment");
    expect(lines[5][0].cls).toBe("tk-comment");
  });
  it("shows text that is not C unchanged", () => {
    const text = "bit:  7 6 5 4\n      1 0 1 1  -> it's 0xB";
    expect(highlightLines(text).map((l) => l.map((p) => p.text).join("")).join("\n")).toBe(text);
    expect(highlightLines("for each bit: if set, count 1").flat().every((p) => p.cls === "")).toBe(true);
  });
});
