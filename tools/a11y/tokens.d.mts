// Types of tokens.mjs, for tests/a11y_tokens.test.ts.
export type Rgba = [number, number, number, number];
export interface Themes {
  dark: Record<string, string>;
  light: Record<string, string>;
  lightPinned: Record<string, string>;
}
export interface ContrastRule {
  name: string;
  inks: string[];
  on: string[];
  min: number;
}
export interface ContrastFailure {
  theme: "dark" | "light";
  rule: string;
  ink: string;
  on: string;
  ratio: number;
  min: number;
}
export interface CvdCollision {
  theme: "dark" | "light";
  kind: "protanopia" | "deuteranopia" | "tritanopia";
  a: string;
  b: string;
  deltaE: number;
}
export const STYLES: string;
export const CONTRAST_RULES: ContrastRule[];
export const STATE_PAIRS: [string, string][];
export const CVD: Record<"protanopia" | "deuteranopia" | "tritanopia", number[][]>;
export function parseColour(value: string): Rgba | null;
export function parseTokens(css?: string): Themes;
export function over(fg: Rgba, bg: Rgba): Rgba;
export function luminance(c: Rgba): number;
export function contrast(a: Rgba, b: Rgba): number;
export function simulate(c: Rgba, kind: keyof typeof CVD): Rgba;
export function deltaE(a: Rgba, b: Rgba): number;
export function contrastFailures(themes?: Themes, rules?: ContrastRule[]): ContrastFailure[];
export function cvdCollisions(themes?: Themes, pairs?: [string, string][]): CvdCollision[];
export function lightBlocksDiffer(themes?: Themes): string[];
export function enhancedShortfalls(themes?: Themes): ContrastFailure[];
export function tokenFindings(): { key: string; rule: string; where: string; severity: "error" | "warning"; count: number; detail: string }[];
