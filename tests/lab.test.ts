import { describe, expect, it } from "vitest";
import { inThreshold, linearToSrgb, relight, rgbToLab, rgbToLabInt, srgbToLinear, type Rgb } from "../src/ui/figures/lab-color";

// The sRGB to CIE L*a*b* conversion behind the "LAB threshold" figure and the
// colour levels of chapter 19, checked against published values (D65 white).

const near = (got: number[], want: number[], tol = 0.15) => got.forEach((v, i) => expect(Math.abs(v - want[i]), `${got} vs ${want}`).toBeLessThan(tol));

describe("sRGB to L*a*b* (D65)", () => {
  it("white is (100, 0, 0)", () => near(rgbToLab([255, 255, 255]), [100, 0, 0], 0.02));
  it("black is (0, 0, 0)", () => near(rgbToLab([0, 0, 0]), [0, 0, 0], 0.001));
  it("sRGB red is about (53.2, 80.1, 67.2)", () => near(rgbToLab([255, 0, 0]), [53.24, 80.09, 67.2]));
  it("sRGB green is about (87.7, -86.2, 83.2)", () => near(rgbToLab([0, 255, 0]), [87.73, -86.18, 83.18]));
  it("sRGB blue is about (32.3, 79.2, -107.9)", () => near(rgbToLab([0, 0, 255]), [32.3, 79.19, -107.86]));
  it("mid grey has no colour: A and B are 0", () => near(rgbToLab([119, 119, 119]), [50.03, 0, 0], 0.05));

  it("rounds to the whole numbers the camera reports and keeps A and B in -128 to 127", () => {
    expect(rgbToLabInt([255, 0, 0])).toEqual([53, 80, 67]);
    expect(rgbToLabInt([0, 0, 255])).toEqual([32, 79, -108]);
    expect(rgbToLabInt([255, 255, 255])).toEqual([100, 0, 0]);
  });

  it("the gamma curve and its inverse agree", () => {
    for (const v of [0, 1, 10, 11, 64, 128, 200, 255]) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
  });

  it("less light lowers L and pulls A and B towards 0 without changing their signs", () => {
    const orange: Rgb = [255, 128, 0];
    const lit = rgbToLab(orange);
    const dim = rgbToLab(relight(orange, 0.3));
    expect(dim[0]).toBeLessThan(lit[0] - 20);
    for (const ch of [1, 2]) {
      expect(dim[ch]).toBeGreaterThan(0);
      expect(dim[ch]).toBeLessThan(lit[ch]);
    }
    // Away from black both scale with the cube root of the light: the direction (B / A) stays.
    expect(Math.abs(dim[2] / dim[1] - lit[2] / lit[1])).toBeLessThan(0.25);
  });
});

describe("six-number threshold", () => {
  const t = { lMin: 20, lMax: 80, aMin: 10, aMax: 60, bMin: -5, bMax: 70 };
  it("accepts a pixel with every channel between its limits", () => expect(inThreshold([50, 30, 40], t)).toBe(true));
  it("rejects a pixel when one channel is outside", () => {
    expect(inThreshold([85, 30, 40], t)).toBe(false);
    expect(inThreshold([50, 5, 40], t)).toBe(false);
    expect(inThreshold([50, 30, -9], t)).toBe(false);
  });
  it("is strict, as in the course's script: a value equal to a limit is outside", () => {
    expect(inThreshold([20, 30, 40], t)).toBe(false);
    expect(inThreshold([50, 60, 40], t)).toBe(false);
  });
});
