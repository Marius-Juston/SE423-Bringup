// sRGB to CIE L*a*b*, the colour space the course's camera thresholds in
// (lecture 17, slides 31 and 32; OpenMV `image.rgb_to_lab()` and the six
// numbers of `find_blobs`). Written from the standard definitions:
//
//   1. sRGB (IEC 61966-2-1): c = C / 255, then undo the gamma curve
//        lin = c / 12.92                      for c <= 0.04045
//        lin = ((c + 0.055) / 1.055) ^ 2.4    otherwise
//   2. Linear RGB to CIE XYZ, sRGB primaries, D65 white (matrix below).
//   3. XYZ to L*a*b* (CIE 1976), with the D65 white (Xn, Yn, Zn):
//        f(t) = t ^ (1/3)                     for t > (6/29)^3
//        f(t) = t / (3 (6/29)^2) + 4/29       otherwise
//        L = 116 f(Y/Yn) - 16
//        a = 500 (f(X/Xn) - f(Y/Yn))
//        b = 200 (f(Y/Yn) - f(Z/Zn))
//
// The camera reports whole numbers: L from 0 to 100, A and B from -128 to 127.

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

/** D65 white point, Y normalised to 1 (2 degree observer). */
export const D65: [number, number, number] = [0.95047, 1.0, 1.08883];

/** One sRGB channel (0 to 255) to linear light (0 to 1). */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0 to 1) to one sRGB channel (0 to 255, rounded and clipped). */
export function linearToSrgb(lin: number): number {
  const c = lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

const DELTA = 6 / 29;
const f = (t: number) => (t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29);

/** sRGB (each 0 to 255) to L*a*b* as real numbers. */
export function rgbToLab([r8, g8, b8]: Rgb): Lab {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / D65[0]);
  const fy = f(y / D65[1]);
  const fz = f(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** L*a*b* as the camera reports it: whole numbers, A and B kept within -128 to 127. */
export function rgbToLabInt(rgb: Rgb): Lab {
  const [l, a, b] = rgbToLab(rgb);
  // `|| 0` turns the -0 that rounding a tiny negative number gives into 0.
  const clamp = (v: number) => Math.max(-128, Math.min(127, Math.round(v))) || 0;
  return [Math.max(0, Math.min(100, Math.round(l))), clamp(a), clamp(b)];
}

/** Scales the light falling on a colour by `k` (in linear light, as a dimmer or a shadow does). */
export function relight(rgb: Rgb, k: number): Rgb {
  return rgb.map((v) => linearToSrgb(srgbToLinear(v) * k)) as Rgb;
}

/** The six numbers of a camera threshold, in the camera's order. */
export interface LabThreshold {
  lMin: number;
  lMax: number;
  aMin: number;
  aMax: number;
  bMin: number;
  bMax: number;
}

/** The course's test for one pixel (ManualBlob script): every channel strictly between its two limits. */
export function inThreshold([l, a, b]: Lab, t: LabThreshold): boolean {
  return t.lMin < l && l < t.lMax && t.aMin < a && a < t.aMax && t.bMin < b && b < t.bMax;
}
