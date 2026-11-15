import { describe, expect, it } from "vitest";
import { CONTRAST_RULES, contrast, contrastFailures, cvdCollisions, deltaE, lightBlocksDiffer, parseColour, parseTokens, simulate, type Rgba } from "../tools/a11y/tokens.mjs";

// The colours of the interface are the tokens at the top of src/ui/styles.css.
// Its header comment promises contrast ratios: this holds them, in both themes.
// The same checks run in `npm run a11y` (docs/ACCESSIBILITY.md).

const rgb = (hex: string) => parseColour(hex) as Rgba;

describe("design tokens", () => {
  const themes = parseTokens();

  it("measures contrast and colour difference like the standards do", () => {
    expect(contrast(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#767676"), rgb("#ffffff"))).toBeCloseTo(4.54, 2);
    // CIEDE2000: equal colours differ by 0, black and white by 100.
    expect(deltaE(rgb("#336699"), rgb("#336699"))).toBe(0);
    expect(deltaE(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(100, 0);
    // Red and green of equal lightness are far apart with full colour vision and close without the red cones.
    expect(deltaE(rgb("#c83232"), rgb("#5a8a00"))).toBeGreaterThan(40);
    expect(deltaE(simulate(rgb("#c83232"), "protanopia"), simulate(rgb("#5a8a00"), "protanopia"))).toBeLessThan(20);
    // Grey has no hue to lose.
    const grey = simulate(rgb("#808080"), "deuteranopia");
    expect(Math.max(...grey.slice(0, 3)) - Math.min(...grey.slice(0, 3))).toBeLessThan(2);
  });

  it("reads every colour token of both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const name of ["--bg", "--bg-2", "--surface", "--surface-2", "--inset", "--text", "--dim", "--accent", "--accent-text", "--value", "--info", "--ok", "--bad", "--control", "--focus", "--select"]) {
        expect(parseColour(themes[theme][name] ?? ""), `${theme} ${name}`).not.toBeNull();
      }
    }
    // --focus points at another token and is resolved.
    expect(themes.dark["--focus"]).toBe(themes.dark["--value"]);
  });

  it("keeps the promises of the header comment in styles.css", () => {
    const failures = contrastFailures(themes).map((f) => `${f.theme}: ${f.ink} on ${f.on} is ${f.ratio.toFixed(2)}:1, ${f.rule} needs ${f.min}:1`);
    expect(failures).toEqual([]);
  });

  it("holds body text and coloured words to 7:1, code to 7:1 in the editor, controls and marks to 3:1", () => {
    const min = (name: string) => CONTRAST_RULES.find((r) => r.name === name)?.min;
    expect(min("body text")).toBe(7);
    expect(min("coloured words")).toBe(7);
    expect(min("code colours")).toBe(7);
    expect(min("code colours on a highlighted line or a selection")).toBe(4.5);
    expect(min("edges of controls")).toBe(3);
    expect(min("focus ring")).toBe(3);
  });

  it("defines the light theme the same way for the system setting and for the Theme setting", () => {
    expect(lightBlocksDiffer(themes)).toEqual([]);
  });

  it("knows which state colours look alike without full colour vision", () => {
    // These pairs are reported by `npm run a11y` as warnings and counted in a11y-baseline.json: where two of them
    // tell states apart, a word, an icon or a shape has to say it too (the suite's colour/only-cue check).
    const collisions = cvdCollisions(themes);
    for (const c of collisions) expect(c.deltaE).toBeLessThan(8);
    // Pass and fail must never be the same colour outright.
    for (const theme of ["dark", "light"] as const) expect(deltaE(rgb(themes[theme]["--ok"]), rgb(themes[theme]["--bad"]))).toBeGreaterThan(40);
  });
});
