#!/usr/bin/env node
// Builds src/sim/device/registers.json from the TI bit-field headers
// (C2000Ware device_support/f2837xd/headers, BSD-3-Clause, see THIRD_PARTY.md).
// Usage: node tools/gen-registers.mjs <path to .../f2837xd/headers>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: gen-registers.mjs <f2837xd/headers dir>");
  process.exit(1);
}
const HEADERS = [
  "gpio", "cputimer", "piectrl", "pievect", "sci", "dac", "adc", "epwm",
  "eqep", "spi", "i2c", "dma", "xint", "can", "input_xbar", "sysctrl",
];

const types = {}; // name -> { k: "struct"|"union", m: [[name, type, arrayLen, bitWidth, desc]] }
const externs = []; // [instance, structName]

for (const h of HEADERS) {
  const text = readFileSync(join(root, "include", `F2837xD_${h}.h`), "latin1");
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const ci = raw.indexOf("//");
    const code = (ci >= 0 ? raw.slice(0, ci) : raw).trim();
    let desc = ci >= 0 ? raw.slice(ci + 2).trim() : "";
    if (!code) continue;
    let m;
    if (!cur && (m = code.match(/^(struct|union)\s+(\w+)\s*\{$/))) {
      cur = { name: m[2], k: m[1], m: [] };
      continue;
    }
    if (cur && /^\};?$/.test(code)) {
      types[cur.name] = { k: cur.k, m: cur.m };
      cur = null;
      continue;
    }
    if (cur && (m = code.match(/^(?:(union|struct)\s+)?(\w+)\s+(\w+)\s*(?:\[(\d+)\])?\s*(?::\s*(\d+))?\s*;$/))) {
      const type = m[1] ? `${m[1]} ${m[2]}` : m[2];
      // Bit-field comments start with the bit range ("15:0 text"): drop it.
      desc = desc.replace(/^\d+(:\d+)?\s+/, "");
      const reserved = /^rsvd/i.test(m[3]);
      cur.m.push([m[3], type, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, reserved ? "" : desc]);
      continue;
    }
    if ((m = code.match(/^extern\s+volatile\s+struct\s+(\w+)\s+(\w+)\s*;$/))) {
      if (!externs.some((e) => e[0] === m[2])) externs.push([m[2], m[1]]);
    }
  }
}

// instance -> section (GlobalVariableDefs.c), section -> region -> origin (.cmd)
const defs = readFileSync(join(root, "source", "F2837xD_GlobalVariableDefs.c"), "latin1");
const sectionOf = {};
for (const m of defs.matchAll(/DATA_SECTION\((\w+)\s*,\s*"(\w+)"\)/g)) sectionOf[m[1]] = m[2];
const cmd = readFileSync(join(root, "cmd", "F2837xD_Headers_nonBIOS_cpu1.cmd"), "latin1");
const origin = {};
for (const m of cmd.matchAll(/^\s*(\w+)\s*:\s*origin\s*=\s*(0x[0-9A-Fa-f]+)/gm)) origin[m[1]] = parseInt(m[2], 16);
const regionOf = {};
for (const m of cmd.matchAll(/^\s*(\w+)\s*:\s*>\s*(\w+)/gm)) regionOf[m[1]] = m[2];

const instances = [];
for (const [name, struct] of externs) {
  const addr = origin[regionOf[sectionOf[name]]];
  if (addr === undefined) {
    console.warn(`no address for ${name}, skipped`);
    continue;
  }
  instances.push([name, struct, addr]);
}
instances.sort((a, b) => a[2] - b[2]);

// Keep only the types reachable from an instance.
const keep = {};
const visit = (n) => {
  if (keep[n] || !types[n]) return;
  keep[n] = types[n];
  for (const mem of types[n].m) {
    const t = mem[1].replace(/^(struct|union) /, "");
    if (types[t]) visit(t);
  }
};
for (const [, s] of instances) visit(s);

const out = join(import.meta.dirname, "..", "src", "sim", "device", "registers.json");
writeFileSync(out, JSON.stringify({ types: keep, instances }));
console.log(`${instances.length} instances, ${Object.keys(keep).length} types -> ${out}`);
