// The design tokens of src/ui/styles.css: contrast, and colour-blind safety of the colours
// that tell two states apart. Pure JavaScript: used by `npm run a11y -- --only tokens` and by
// tests/a11y_tokens.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, finding } from "./findings.mjs";

export const STYLES = resolve(REPO, "src/ui/styles.css");

const parseHex = (v) => {
  const h = v.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1);
};
/** "#rrggbb" or "rgb(a)(r, g, b, a)" to [r, g, b, a]; null for anything else (a shadow, a font). */
export function parseColour(v) {
  v = v.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return parseHex(v);
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const p = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/**
 * The tokens of each theme: { dark, light, lightPinned }. `dark` is the :root block, `light` the
 * prefers-color-scheme block and `lightPinned` the [data-theme="light"] block (the Theme setting).
 * A token that points at another (`--focus: var(--value)`) is resolved.
 */
export function parseTokens(css = readFileSync(STYLES, "utf8")) {
  const block = (re) => {
    const m = css.match(re);
    if (!m) throw new Error(`styles.css: no block matches ${re}`);
    const out = {};
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
    return out;
  };
  const dark = block(/^:root\s*\{([\s\S]*?)^\}/m);
  const light = { ...dark, ...block(/:root:not\(\[data-theme="dark"\]\)\s*\{([\s\S]*?)\}/) };
  const lightPinned = { ...dark, ...block(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/) };
  const resolveAll = (t) => {
    const get = (name, depth = 0) => {
      const v = t[name];
      const ref = v?.match(/^var\((--[\w-]+)\)$/);
      return ref && depth < 5 ? get(ref[1], depth + 1) : v;
    };
    return Object.fromEntries(Object.keys(t).map((k) => [k, get(k)]));
  };
  return { dark: resolveAll(dark), light: resolveAll(light), lightPinned: resolveAll(lightPinned) };
}

export const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const linear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = (c) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
/** WCAG contrast ratio of two opaque colours. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Colour-vision deficiency, full strength, applied to linear RGB. Matrices from
// G. M. Machado, M. M. Oliveira, L. A. F. Fernandes, "A Physiologically-based Model for
// Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009, table for severity 1.0.
export const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const encode = (v) => {
  v = Math.min(1, Math.max(0, v));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};
export function simulate(c, kind) {
  const lin = [linear(c[0]), linear(c[1]), linear(c[2])];
  return CVD[kind].map((row) => encode(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])).concat(1);
}

/** sRGB to CIELAB (D65). */
function lab(c) {
  const [r, g, b] = [linear(c[0]), linear(c[1]), linear(c[2])];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** Colour difference CIEDE2000 (Sharma, Wu, Dalal 2005). */
export function deltaE(c1, c2) {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G);
  const C1 = Math.hypot(ap1, b1), C2 = Math.hypot(ap2, b2);
  const hue = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = hue(b1, ap1), h2 = hue(b2, ap2);
  const dL = L2 - L1, dC = C2 - C1;
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cm = (C1 + C2) / 2;
  let hm = h1 + h2;
  if (C1 * C2 !== 0) hm = Math.abs(h1 - h2) <= 180 ? hm / 2 : hm < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cm;
  const Sh = 1 + 0.015 * Cm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ---- what the header comment of styles.css promises, and a little more ----
const PAGE = ["--bg", "--bg-2", "--surface", "--surface-2", "--inset"];
/** Each rule: these inks on these backgrounds (a "+" layers a tint over a background) with at least this ratio. */
export const CONTRAST_RULES = [
  { name: "body text", inks: ["--text", "--dim"], on: PAGE, min: 7 },
  { name: "coloured words", inks: ["--value", "--info", "--ok", "--bad", "--accent-text"], on: ["--bg", "--bg-2", "--surface", "--inset"], min: 7 },
  { name: "words on the accent tint", inks: ["--text", "--dim", "--value", "--info", "--accent-text"], on: ["--accent-soft+--bg", "--accent-soft+--bg-2", "--accent-soft+--surface", "--accent-soft+--inset"], min: 4.5 },
  { name: "words on the pass tint", inks: ["--text", "--dim", "--ok", "--value"], on: ["--ok-soft+--bg", "--ok-soft+--bg-2", "--ok-soft+--surface"], min: 4.5 },
  { name: "words on the fail tint", inks: ["--text", "--dim", "--bad"], on: ["--bad-soft+--bg", "--bad-soft+--bg-2", "--bad-soft+--surface", "--bad-soft+--inset"], min: 4.5 },
  { name: "edges of controls", inks: ["--control"], on: ["--bg", "--bg-2", "--surface", "--inset"], min: 3 },
  { name: "focus ring", inks: ["--focus"], on: [...PAGE, "--accent-soft+--bg-2", "--accent-soft+--inset"], min: 3 },
  { name: "words on the primary button", inks: ["--accent-ink"], on: ["--accent", "--accent-hover"], min: 4.5 },
  { name: "marks (not words)", inks: ["--accent", "--ok", "--bad", "--value", "--info", "--hi", "--lo"], on: ["--bg", "--bg-2", "--surface", "--inset", "--accent-soft+--bg-2", "--accent-soft+--inset"], min: 3 },
  { name: "code colours", inks: ["--code-kw", "--code-type", "--code-num", "--code-str", "--code-comment", "--code-macro", "--code-fn", "--code-prop", "--text"], on: ["--inset"], min: 7 },
  { name: "code colours on a highlighted line or a selection", inks: ["--code-kw", "--code-type", "--code-num", "--code-str", "--code-comment", "--code-macro", "--code-fn", "--code-prop", "--text"], on: ["--accent-soft+--inset", "--bad-soft+--inset", "--select", "--bg", "--surface"], min: 4.5 },
  { name: "words on the board", inks: ["--pcb-ink"], on: ["--pcb"], min: 4.5 },
  { name: "what is lit up on the board", inks: ["--pcb-lit"], on: ["--pcb", "--pcb-edge"], min: 3 },
  { name: "words on a chosen filter", inks: ["--bg"], on: ["--text", "--value"], min: 4.5 },
];
/** Pairs that mean different things and must stay apart without colour vision. */
export const STATE_PAIRS = [
  ["--ok", "--bad"], ["--hi", "--lo"], ["--accent", "--value"], ["--hi", "--value"], ["--accent", "--info"], ["--value", "--info"], ["--ok", "--value"], ["--bad", "--value"],
  ...["--code-kw", "--code-type", "--code-num", "--code-str", "--code-comment", "--code-macro", "--code-fn", "--code-prop"].flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b])),
];
const DISTINCT = 15; // CIEDE2000 between two colours meant to be told apart
const CONFUSED = 8; // below this they look alike (the thresholds of the class material's cvd_check.py)

function colourOf(tokens, spec) {
  const [top, under] = spec.split("+");
  const c = parseColour(tokens[top] ?? "");
  if (!c) throw new Error(`token ${top} is not a colour: ${tokens[top]}`);
  if (!under) return c;
  return over(c, colourOf(tokens, under));
}

/** Every ink/background pair below its minimum: [{ theme, rule, ink, on, ratio, min }]. */
export function contrastFailures(themes = parseTokens(), rules = CONTRAST_RULES) {
  const out = [];
  for (const theme of ["dark", "light"])
    for (const rule of rules)
      for (const ink of rule.inks)
        for (const on of rule.on) {
          const bg = colourOf(themes[theme], on);
          const ratio = contrast(over(colourOf(themes[theme], ink), bg), bg);
          if (ratio < rule.min) out.push({ theme, rule: rule.name, ink, on, ratio, min: rule.min });
        }
  return out;
}

/** State pairs that are distinct with full colour vision and alike with one kind of colour blindness. */
export function cvdCollisions(themes = parseTokens(), pairs = STATE_PAIRS) {
  const out = [];
  for (const theme of ["dark", "light"])
    for (const [a, b] of pairs) {
      const ca = colourOf(themes[theme], a), cb = colourOf(themes[theme], b);
      if (deltaE(ca, cb) < DISTINCT) continue;
      for (const kind of Object.keys(CVD)) {
        const d = deltaE(simulate(ca, kind), simulate(cb, kind));
        if (d < CONFUSED) out.push({ theme, kind, a, b, deltaE: d });
      }
    }
  return out;
}

/** Tokens whose two light definitions (system setting, Theme setting) differ. */
export function lightBlocksDiffer(themes = parseTokens()) {
  return Object.keys(themes.light).filter((k) => themes.light[k] !== themes.lightPinned[k]);
}

/** What stays below 7:1 (AAA) on purpose: reported so the count can only go down. */
export function enhancedShortfalls(themes = parseTokens()) {
  return contrastFailures(themes, [
    { name: "words on the primary button at 7:1", inks: ["--accent-ink"], on: ["--accent", "--accent-hover"], min: 7 },
    { name: "words on the board at 7:1", inks: ["--pcb-ink"], on: ["--pcb"], min: 7 },
  ]);
}

export function tokenFindings() {
  const themes = parseTokens();
  const out = [];
  const group = (list, keyOf) => {
    const by = new Map();
    for (const x of list) by.set(keyOf(x), [...(by.get(keyOf(x)) ?? []), x]);
    return by;
  };
  for (const [theme, list] of group(contrastFailures(themes), (x) => x.theme))
    out.push(finding({ where: "tokens", rule: "tokens/contrast", state: theme, count: list.length, detail: list.slice(0, 6).map((x) => `${x.ink} on ${x.on} is ${x.ratio.toFixed(2)}:1, ${x.rule} needs ${x.min}:1`).join("; ") }));
  const differ = lightBlocksDiffer(themes);
  if (differ.length) out.push(finding({ where: "tokens", rule: "tokens/light-blocks-differ", state: "light", count: differ.length, detail: `the light theme by system setting and by the Theme setting differ in ${differ.join(", ")}` }));
  for (const [key, list] of group(cvdCollisions(themes), (x) => `${x.theme}/${x.kind}`))
    out.push(finding({ where: "tokens", rule: "tokens/cvd-confusable", state: key, severity: "warning", count: list.length, detail: `look alike with ${key.split("/")[1]}: ${list.map((x) => `${x.a} and ${x.b} (dE ${x.deltaE.toFixed(1)})`).join(", ")}; each use needs a second cue (icon, shape, word)` }));
  for (const [theme, list] of group(enhancedShortfalls(themes), (x) => x.theme))
    out.push(finding({ where: "tokens", rule: "tokens/contrast-enhanced", state: theme, severity: "warning", count: list.length, detail: `below 7:1 (AAA): ${list.map((x) => `${x.ink} on ${x.on} ${x.ratio.toFixed(2)}`).join(", ")}` }));
  return out;
}
