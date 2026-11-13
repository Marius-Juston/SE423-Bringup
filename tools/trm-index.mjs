#!/usr/bin/env node
// Builds src/levels/trm-index.json (section number -> title, page) from the
// table of contents of the TMS320F2837xD Technical Reference Manual.
// Usage: node tools/trm-index.mjs <tms320f28379D_TechRefi.pdf>
// Needs pdftotext (poppler-utils). The PDF itself is never committed.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const pdf = process.argv[2];
if (!pdf) {
  console.error("usage: trm-index.mjs <TRM pdf>");
  process.exit(1);
}
// The contents pages come first; 60 pages cover all of them.
const text = execFileSync("pdftotext", ["-layout", "-f", "1", "-l", "60", pdf, "-"], { maxBuffer: 1 << 28 }).toString();
const index = {};
for (const line of text.split("\n")) {
  const m = /^\s*(\d+(?:\.\d+){0,4})\s+(\S.*?)\s*\.{4,}\s*(\d+)\s*$/.exec(line);
  if (!m) continue;
  const [, sec, title, page] = m;
  if (!(sec in index)) index[sec] = { title: title.replace(/\s+/g, " "), page: +page };
}
const out = join(import.meta.dirname, "..", "src", "levels", "trm-index.json");
writeFileSync(out, JSON.stringify(index, null, 0).replace(/\},/g, "},\n"));
console.log(`${Object.keys(index).length} sections -> ${out}`);
