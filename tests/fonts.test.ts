// The game ships only the font files its text can use (src/ui/fonts.css).
// This holds that promise: the shipped rules are the packages' own, and no
// level, glossary entry or interface text uses a character that needs a
// subset which is not shipped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/levels";
import * as glossary from "../src/levels/glossary";

type Range = [number, number];
interface Face {
  /** The package's name for the rule: "jetbrains-mono-latin-400-normal". */
  name: string;
  family: string;
  file: string;
  range: string;
}

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The @font-face rules of a style sheet, by the comment fontsource puts above each. */
function faces(css: string): Face[] {
  const out: Face[] = [];
  for (const m of css.matchAll(/\/\* ([a-z0-9-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const family = /font-family:\s*["']([^"']+)["']/.exec(body)?.[1] ?? "";
    const file = /url\(["']?[^)"']*\/([^/)"']+\.woff2)["']?\)/.exec(body)?.[1] ?? "";
    const range = (/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? "").replace(/\s+/g, "");
    out.push({ name: m[1], family, file, range });
  }
  return out;
}
const rangesOf = (f: Face): Range[] =>
  f.range.split(",").map((r) => {
    const [a, b] = r.replace("U+", "").split("-");
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
const covers = (f: Face, cp: number) => rangesOf(f).some(([a, b]) => cp >= a && cp <= b);

const shipped = faces(read("src/ui/fonts.css"));
const packaged = [
  ...faces(read("node_modules/@fontsource-variable/atkinson-hyperlegible-next/index.css")),
  ...faces(read("node_modules/@fontsource/jetbrains-mono/400.css")),
  ...faces(read("node_modules/@fontsource/jetbrains-mono/700.css")),
];

/** Source files whose text can reach the page. */
function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) sources(p, out);
    else if (/\.(tsx?|json|css|html)$/.test(f)) out.push(p);
  }
  return out;
}
/** A file's text with the escapes of a string literal read as the characters they stand for. */
const unescaped = (text: string) =>
  text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_, a, b, c) => String.fromCodePoint(parseInt(a ?? b ?? c, 16)));

describe("the shipped fonts", () => {
  it("are rules of the font packages, with the packages' unicode ranges and files", () => {
    expect(shipped.length).toBeGreaterThan(0);
    for (const f of shipped) {
      const theirs = packaged.find((p) => p.name === f.name);
      expect(theirs, `${f.name} is not a rule of the font packages`).toBeDefined();
      expect(f.range, `unicode-range of ${f.name}`).toBe(theirs!.range);
      expect(f.family, `font-family of ${f.name}`).toBe(theirs!.family);
      expect(f.file, `file of ${f.name}`).toBe(theirs!.file);
      // The file is in the installed package.
      const pkg = f.family === "JetBrains Mono" ? "@fontsource/jetbrains-mono" : "@fontsource-variable/atkinson-hyperlegible-next";
      expect(statSync(join(ROOT, "node_modules", pkg, "files", f.file)).size).toBeGreaterThan(1000);
    }
  });

  it("ship the code font in both weights for every subset they ship", () => {
    const mono = shipped.filter((f) => f.family === "JetBrains Mono");
    const subsets = new Set(mono.map((f) => f.name.replace(/-\d+-normal$/, "")));
    for (const s of subsets) for (const w of [400, 700]) expect(mono.some((f) => f.name === `${s}-${w}-normal`), `${s} at weight ${w}`).toBe(true);
  });

  it("cover every character of the levels, the glossary and the interface that the packages have a subset for", () => {
    const texts: [string, string][] = [
      ["the levels", JSON.stringify(CHAPTERS)],
      ["the glossary", JSON.stringify(glossary)],
      ...["src/levels", "src/ui", "src/sim"].flatMap((d) => sources(d)).map((p): [string, string] => [p, unescaped(read(p))]),
      ["index.html", read("index.html")],
    ];
    const missing = new Map<string, string>();
    for (const [where, text] of texts)
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x80) continue;
        for (const p of packaged) {
          if (!covers(p, cp) || shipped.some((f) => f.family === p.family && covers(f, cp))) continue;
          const key = `U+${cp.toString(16).toUpperCase().padStart(4, "0")} "${ch}" needs ${p.name.replace(/-(wght|\d+)-normal$/, "")}`;
          if (!missing.has(key)) missing.set(key, where);
        }
      }
    // A character listed here would be drawn in a fallback font: add the subset's @font-face rules to src/ui/fonts.css.
    expect([...missing].map(([k, where]) => `${k} (${where})`)).toEqual([]);
  });

  it("would notice a character of a subset that is not shipped", () => {
    // U+0151 (o with double acute) is extended Latin, U+0416 is Cyrillic: neither subset is shipped.
    for (const cp of [0x151, 0x416]) {
      expect(packaged.some((p) => covers(p, cp))).toBe(true);
      expect(shipped.some((f) => covers(f, cp))).toBe(false);
    }
    // The capital omega is in code, and the code font's Greek subset is shipped.
    expect(shipped.some((f) => f.family === "JetBrains Mono" && covers(f, 0x3a9))).toBe(true);
  });
});
