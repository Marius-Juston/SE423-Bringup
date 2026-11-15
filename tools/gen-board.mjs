#!/usr/bin/env node
// Builds src/sim/world/boards/hw-board.json, the homework board of the wiring
// bench, from the course's Eagle 7.7 board file (SE423_F28379D.brd in the
// course starter checkout, which is not part of this repository).
//
// Usage: node tools/gen-board.mjs <path to SE423_F28379D.brd> [out.json]
//
// The output is a compact description, not a copy of the design: the board's
// size, every place a wire or a leg can go (with its position and the net it
// belongs to), the parts soldered on the board that the bench simulates, the
// outlines and silkscreen words needed to recognise the board, and where the
// LaunchPad sits. Copper routing, the schematic sheets, the part libraries and
// everything about the circuits the bench does not simulate are left out.
// Running it twice gives the same bytes. See docs/WIRING.md.
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
const out = process.argv[3] ?? new URL("../src/sim/world/boards/hw-board.json", import.meta.url).pathname;
if (!src) {
  console.error("usage: gen-board.mjs <SE423_F28379D.brd> [out.json]");
  process.exit(1);
}

// ---------- a small XML reader (Eagle files are plain, regular XML) ----------
function parseXml(text) {
  const root = { tag: "#root", a: {}, kids: [], text: "" };
  const stack = [root];
  const re = /<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  const ent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  for (let m; (m = re.exec(text)); ) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.text += ent(m[5]);
      continue;
    }
    if (m[1]) {
      stack.pop();
      continue;
    }
    const node = { tag: m[2], a: {}, kids: [], text: "" };
    for (const am of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) node.a[am[1]] = ent(am[2]);
    top.kids.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const all = (n, tag, acc = []) => {
  for (const k of n.kids) {
    if (k.tag === tag) acc.push(k);
    all(k, tag, acc);
  }
  return acc;
};
const kids = (n, tag) => n.kids.filter((k) => k.tag === tag);

const doc = parseXml(readFileSync(src, "latin1").replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, ""));
const board = all(doc, "board")[0];
const plain = kids(board, "plain")[0];

// ---------- geometry ----------
const r2 = (v) => Math.round(v * 100) / 100;
const dims = kids(plain, "wire").filter((w) => w.a.layer === "20");
const W = Math.max(...dims.map((w) => Math.max(+w.a.x1, +w.a.x2)));
const H = Math.max(...dims.map((w) => Math.max(+w.a.y1, +w.a.y2)));
/** Eagle rotation "R90", "MR180": angle in degrees and whether the part is mirrored. */
const rot = (s) => ({ deg: +(/(\d+)/.exec(s ?? "")?.[1] ?? 0), mirror: /^S?M/.test(s ?? "") });
/** A point of a package placed on the board, in screen coordinates (y down, mm). */
function place(el, x, y) {
  const { deg, mirror } = rot(el.a.rot);
  const px = mirror ? -x : x;
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [r2(+el.a.x + px * c - y * s), r2(H - (+el.a.y + px * s + y * c))];
}

const packages = new Map();
for (const lib of all(board, "library")) for (const p of all(lib, "package")) packages.set(`${lib.a.name}/${p.a.name}`, p);
const natural = (a, b) => a.localeCompare(b, "en", { numeric: true });
const elements = all(board, "element").sort((a, b) => natural(a.a.name, b.a.name));
const elByName = new Map(elements.map((e) => [e.a.name, e]));
const pkgOf = (el) => packages.get(`${el.a.library}/${el.a.package}`);

// ---------- nets ----------
/** "element.pad" -> the Eagle signal it belongs to. */
const signalOf = new Map();
for (const s of all(board, "signal")) for (const c of kids(s, "contactref")) signalOf.set(`${c.a.element}.${c.a.pad}`, s.a.name);

const RAILS = { GND: "GND", VCC: "3V3", "+5V": "5V", POWER: "VIN" };
/** The name the bench shows for a signal; null for one without a meaning of its own. */
function netName(sig) {
  if (!sig) return null;
  if (RAILS[sig]) return RAILS[sig];
  if (/^(GPIO\d+|ADCIN[A-D]?\d+|DACOUT[AB]|RESET(_2)?)$/.test(sig)) return sig;
  return null;
}

// ---------- what a wire or a leg can go into ----------
// Sockets and header pins. Pads of soldered parts (chips, the buzzer, the jack) are not offered.
const PLUG = /^(STRIP\d+|MA\d+-\d|1X0\d|JP1|BANANA_MALE|MPU-9250-BB|0207\/10|TO220|RELAY_JQC-3F_5V|TH_PUSHBUTTON)$/;

const nets = []; // [name]
const netIndex = new Map(); // key -> index
const net = (key, name) => {
  let i = netIndex.get(key);
  if (i === undefined) {
    i = nets.length;
    nets.push(name);
    netIndex.set(key, i);
  }
  return i;
};
// Fixed order for the rails, then the chip's pins in natural order, so regenerating gives no diff.
for (const n of ["GND", "3V3", "5V", "VIN"]) net(`sig:${Object.keys(RAILS).find((k) => RAILS[k] === n)}`, n);
const named = [...new Set([...signalOf.values()])].filter((s) => netName(s) && !RAILS[s]).sort(natural);
for (const s of named) net(`sig:${s}`, netName(s));

const groups = []; // { id, kind, label }
const holes = []; // [x, y, net, group]
let anon = 0;
const netOfPad = (el, pad) => {
  const sig = signalOf.get(`${el.a.name}.${pad}`);
  if (sig && netIndex.has(`sig:${sig}`)) return netIndex.get(`sig:${sig}`);
  // A signal without a name of its own, or a pad that touches nothing: a net numbered in the order it is met.
  const key = sig ? `sig:${sig}` : `pad:${el.a.name}.${pad}`;
  return netIndex.has(key) ? netIndex.get(key) : net(key, `n${++anon}`);
};

for (const el of elements) {
  const pk = pkgOf(el);
  if (!PLUG.test(pk.a.name)) continue;
  // The two small boards for other processors and the motor drivers are drawn, but nothing can be plugged into them.
  const g = groups.length;
  groups.push({ id: el.a.name, kind: pk.a.name.replace(/^MA(\d+)-(\d)$/, "HDR$2x$1").replace(/^1X0(\d)$/, "HDR1x$1") });
  for (const p of kids(pk, "pad")) {
    const [x, y] = place(el, +p.a.x, +p.a.y);
    holes.push([x, y, netOfPad(el, p.a.name), g]);
  }
}

// ---------- names a student can read ----------
// The breadboard: two banks of five-hole rows between the 3V3 rail (left) and the GND rail (right).
const rows = groups.map((g, i) => ({ g, i })).filter(({ g, i }) => g.kind === "STRIP5" && holes.some((h) => h[3] === i && /^n\d+$/.test(nets[h[2]])));
const xOf = (i) => Math.min(...holes.filter((h) => h[3] === i).map((h) => h[0]));
const yOf = (i) => Math.min(...holes.filter((h) => h[3] === i).map((h) => h[1]));
const bankX = [...new Set(rows.map(({ i }) => xOf(i)))].sort((a, b) => a - b);
// Only the columns that hold many rows are the breadboard; single strips elsewhere keep their own names.
const banks = bankX.filter((x) => rows.filter(({ i }) => xOf(i) === x).length >= 10);
banks.forEach((x, b) => {
  rows
    .filter(({ i }) => xOf(i) === x)
    .sort((p, q) => yOf(p.i) - yOf(q.i))
    .forEach(({ g, i }, n) => {
      g.label = `Row ${"ABCD"[b]}${n + 1}`;
      const ni = holes.find((h) => h[3] === i)[2];
      nets[ni] = `${"ABCD"[b]}${n + 1}`;
    });
});
for (const [i, g] of groups.entries()) {
  if (g.label) continue;
  const own = [...new Set(holes.filter((h) => h[3] === i).map((h) => nets[h[2]]))];
  g.label = own.length === 1 && !/^n\d+$/.test(own[0]) ? `${own[0]} (${g.id})` : g.id;
}

// ---------- the parts the bench simulates, where they really are ----------
// Each one: what it is, the box it takes on the board (screen mm) and the chip pins it reaches, traced through the nets.
const parts = [];
const pin = (name, pad) => netOfPad(elByName.get(name), pad);
const at = (name) => place(elByName.get(name), 0, 0);
const gpioOf = (netI) => (/^GPIO(\d+)$/.exec(nets[netI]) ? +/^GPIO(\d+)$/.exec(nets[netI])[1] : null);
const ohms = (v) => {
  const m = /^([\d.]+)\s*(k|K)?/.exec(v ?? "");
  return m ? +m[1] * (m[2] ? 1000 : 1) : null;
};
/** The box around points of placed elements: [x, y, w, h], grown by `pad` mm. */
function boxOf(points, pad = 1.2) {
  const x0 = Math.min(...points.map((p) => p[0])) - pad;
  const y0 = Math.min(...points.map((p) => p[1])) - pad;
  const x1 = Math.max(...points.map((p) => p[0])) + pad;
  const y1 = Math.max(...points.map((p) => p[1])) + pad;
  return [r2(Math.max(0, x0)), r2(Math.max(0, y0)), r2(Math.min(W, x1) - Math.max(0, x0)), r2(Math.min(H, y1) - Math.max(0, y0))];
}
const padsOf = (name) => {
  const el = elByName.get(name);
  return pkgOf(el).kids.filter((k) => k.tag === "pad" || k.tag === "smd").map((k) => place(el, +k.a.x, +k.a.y));
};
const outlineOf = (name) => {
  const el = elByName.get(name);
  const pts = padsOf(name);
  for (const k of pkgOf(el).kids) {
    if (k.tag === "wire" && k.a.layer === "21") pts.push(place(el, +k.a.x1, +k.a.y1), place(el, +k.a.x2, +k.a.y2));
    if (k.tag === "circle" && k.a.layer === "21") pts.push(place(el, +k.a.x - +k.a.radius, +k.a.y - +k.a.radius), place(el, +k.a.x + +k.a.radius, +k.a.y + +k.a.radius));
  }
  return pts;
};

// The 74x04 inverters: gate input pad -> output pad.
const GATES = [["1", "2"], ["3", "4"], ["5", "6"], ["9", "8"], ["11", "10"], ["13", "12"]];
const gateDriving = (netI) => {
  for (const ic of ["IC1", "IC2", "IC3"]) for (const [i, o] of GATES) if (signalOf.has(`${ic}.${o}`) && pin(ic, o) === netI) return { ic, input: pin(ic, i) };
  return null;
};
const resistorOn = (netI) => elements.find((e) => /^R\d+$/.test(e.a.name) && ["1", "2"].some((p) => netOfPad(e, p) === netI));

// The 16 LEDs: 3V3 -> resistor -> LED -> inverter output; the inverter's input is the pin. The resistors carry no
// value in the board file; the assembly handout (HW1) has 1 k soldered there.
const served = { IC1: [], IC2: [], IC3: [] };
for (const el of elements) {
  if (el.a.package !== "CHIPLED_1206") continue;
  const name = el.a.name;
  const r = resistorOn(pin(name, "A"));
  if (/^LED([1-9]|1[0-6])$/.test(name)) {
    const g = gateDriving(pin(name, "C"));
    served[g.ic].push(name);
    parts.push({ id: name, kind: "led", label: name, box: boxOf(padsOf(name), 0.9), pin: gpioOf(g.input), via: g.ic, res: r.a.name, ohm: ohms(r.a.value) ?? 1000 });
  } else if (/^(5V|3V3)$/.test(name)) {
    parts.push({ id: `PWR${name}`, kind: "power-led", label: `${name} supply LED`, box: boxOf(padsOf(name), 0.9), rail: name, res: r.a.name, ohm: ohms(r.a.value) });
  }
}
parts.sort((a, b) => natural(a.id, b.id));
// The buzzer: its input header pin -> inverter -> 100 ohm -> buzzer -> GND. A jumper joins that pin to GPIO16.
const buzIn = pin("J194", "P$1");
{
  const g = gateDriving(pin("R40", "1")) ?? gateDriving(pin("R40", "2"));
  served[g.ic].push("B1");
  const sel = gpioOf(pin("J251", "P$1"));
  parts.push({ id: "B1", kind: "buzzer", label: "Buzzer", box: boxOf(outlineOf("B1"), 0), pin: sel, via: g.ic, res: "R40", ohm: ohms(elByName.get("R40").a.value), jumper: "JBUZ" });
  if (g.input !== buzIn) throw new Error("the buzzer's input header is not on its inverter");
  parts.push({ id: "JBUZ", kind: "buzzer-jumper", label: "Buzzer jumper", box: boxOf([...padsOf("J194"), ...padsOf("J251"), ...padsOf("J7"), ...padsOf("J8")]), pin: sel });
}
for (const ic of ["IC1", "IC2", "IC3"]) parts.push({ id: ic, kind: "inverter", label: `Inverter chip ${ic}`, box: boxOf(padsOf(ic), 0.4), serves: served[ic] });
// The four push buttons sit on pairs of pads: one pair on the pin, one on ground.
for (const [id, a, b] of [["PB1", "U$5", "U$6"], ["PB2", "U$10", "U$7"], ["PB3", "U$11", "U$8"], ["PB4", "U$12", "U$9"]]) {
  if (nets[pin(b, "P$1")] !== "GND") throw new Error(`${id}: the second pad pair is not ground`);
  parts.push({ id, kind: "button", label: id, box: boxOf([...padsOf(a), ...padsOf(b)]), pin: gpioOf(pin(a, "P$1")) });
}
// The joystick's five-pin socket: ground, supply, the two axes, the switch.
{
  const names = ["1", "2", "3", "4", "5"].map((p) => nets[pin("SV11", p)]);
  if (names[0] !== "GND" || names[1] !== "3V3") throw new Error("the joystick socket is not as expected");
  parts.push({ id: "JOY", kind: "joystick", label: "Joystick", box: boxOf(padsOf("SV11"), 1.6), adcX: names[2], adcY: names[3], pin: gpioOf(pin("SV11", "5")) });
}
// The servo connectors: one column across a ground row, a supply row and a signal row. The signal row stands next
// to its pin's pads; the handout has a wire soldered across.
for (const [id, rows, sig] of [["RC1", ["S129", "S147", "S130"], "J201"], ["RC2", ["S137", "S139", "S138"], "J202"]]) {
  if (nets[pin(rows[0], "P$1")] !== "GND") throw new Error(`${id}: the first row is not ground`);
  parts.push({ id, kind: "servo", label: `RC servo ${id.slice(2)}`, box: boxOf(rows.flatMap((s) => padsOf(s))), pin: gpioOf(pin(sig, "P$1")) });
}
// The battery holder is on the back of the board (mirrored in the file).
parts.push({ id: "BAT", kind: "battery", label: "Battery pack", box: boxOf(outlineOf("B2"), 0), back: true });
// The MPU-9250 breakout and the four jumpers that take SPIB to it: each joins a pin's pads to a row of the socket.
parts.push({ id: "IMU", kind: "imu", label: "MPU-9250 IMU", box: boxOf(outlineOf("U$1"), 0) });
for (const [i, [strip, row, signal]] of [["J206", "J125", "SCLK"], ["J204", "J126", "MOSI"], ["J205", "J129", "MISO"], ["J207", "J131", "NCS"]].entries()) {
  parts.push({ id: `JIMU${i + 1}`, kind: "imu-jumper", label: `IMU jumper ${signal}`, box: boxOf([padsOf(strip)[1], padsOf(row)[0]]), pin: gpioOf(pin(strip, "P$1")), signal });
}
// The photoresistor divider of homework 2 has no footprint: it is soldered on free pads and wired to its ADC pin.
// It is drawn on the first rows of the pad field, which is an assumption about where a student puts it.
parts.push({ id: "LDR", kind: "photoresistor", label: "Photoresistor", box: boxOf([...padsOf("S210"), ...padsOf("S212")]), adc: "ADCINA4", ohm: 2200 });

// ---------- which nets each part is on, and the copper that joins them ----------
// `nets`: what the part hangs on at the chip's side. `far`: the nets behind an inverter or a resistor.
const byName = (n) => nets.indexOf(n);
const rowNet = (strip) => pin(strip, "P$1");
const IMU_ROWS = { JIMU1: "J125", JIMU2: "J126", JIMU3: "J129", JIMU4: "J131" };
for (const p of parts) {
  const g = p.pin !== undefined && p.pin !== null ? byName(`GPIO${p.pin}`) : -1;
  if (p.kind === "led") Object.assign(p, { nets: [g], far: [pin(p.id, "C"), pin(p.id, "A")] });
  else if (p.kind === "power-led") Object.assign(p, { nets: [byName(p.rail)], far: [pin(p.rail, "A")] });
  else if (p.kind === "buzzer") Object.assign(p, { nets: [g, buzIn], far: [pin("R40", "1"), pin("R40", "2")] });
  else if (p.kind === "buzzer-jumper") Object.assign(p, { nets: [g, buzIn], far: [] });
  else if (p.kind === "inverter") {
    const gates = GATES.filter(([i, o]) => signalOf.has(`${p.id}.${i}`) && signalOf.has(`${p.id}.${o}`));
    Object.assign(p, { nets: gates.map(([i]) => pin(p.id, i)), far: gates.map(([, o]) => pin(p.id, o)) });
  } else if (p.kind === "button") Object.assign(p, { nets: [g], far: [] });
  else if (p.kind === "joystick") Object.assign(p, { nets: [byName(p.adcX), byName(p.adcY), g], far: [] });
  else if (p.kind === "servo") {
    const rows = p.id === "RC1" ? ["S130", "S147"] : ["S138", "S139"];
    Object.assign(p, { nets: [g, rowNet(rows[0])], far: [rowNet(rows[1])] });
  } else if (p.kind === "battery") Object.assign(p, { nets: [byName("VIN")], far: [] });
  else if (p.kind === "imu") Object.assign(p, { nets: Object.values(IMU_ROWS).map(rowNet), far: [] });
  else if (p.kind === "imu-jumper") Object.assign(p, { nets: [g, rowNet(IMU_ROWS[p.id])], far: [] });
  else if (p.kind === "photoresistor") Object.assign(p, { nets: [byName(p.adc)], far: [] });
  if (!p.nets || p.nets.some((n) => n < 0)) throw new Error(`${p.id}: a net was not found`);
}

// The copper traces of the nets a part or a LaunchPad pin is on: top layer 0, bottom layer 1. Segments that
// meet end to end are joined into one line, and points are rounded to 0.05 mm, to keep the file small.
// The ground plane is a filled area on the board, not traces: ground is shown by its pads.
const wanted = new Set([...parts.flatMap((p) => [...p.nets, ...p.far]), ...nets.map((n, i) => (/^(GPIO\d+|ADCIN[A-D]?\d+|DACOUT[AB]|3V3|5V|VIN)$/.test(n) ? i : -1)).filter((i) => i >= 0)]);
const r5 = (v) => Math.round(v * 20) / 20;
const traces = [];
for (const sgn of all(board, "signal").sort((a, b) => natural(a.a.name, b.a.name))) {
  const ni = netIndex.get(`sig:${sgn.a.name}`);
  if (ni === undefined || !wanted.has(ni)) continue;
  for (const [layer, code] of [["1", 0], ["16", 1]]) {
    const segs = kids(sgn, "wire").filter((w) => w.a.layer === layer).map((w) => [[r5(+w.a.x1), r5(H - +w.a.y1)], [r5(+w.a.x2), r5(H - +w.a.y2)]]);
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const lines = [];
    while (segs.length) {
      const line = segs.shift();
      for (let grown = true; grown; ) {
        grown = false;
        for (let k = 0; k < segs.length; k++) {
          const [a, b] = segs[k];
          const head = line[0];
          const tail = line[line.length - 1];
          if (same(tail, a)) line.push(b);
          else if (same(tail, b)) line.push(a);
          else if (same(head, b)) line.unshift(a);
          else if (same(head, a)) line.unshift(b);
          else continue;
          segs.splice(k, 1);
          grown = true;
          break;
        }
      }
      // A point on a straight run says nothing.
      const slim = line.filter((pt, k) => k === 0 || k === line.length - 1 || Math.abs((line[k + 1][0] - line[k - 1][0]) * (pt[1] - line[k - 1][1]) - (line[k + 1][1] - line[k - 1][1]) * (pt[0] - line[k - 1][0])) > 1e-6);
      lines.push([ni, code, ...slim.flat()]);
    }
    traces.push(...lines);
  }
}

// ---------- the picture ----------
// Silkscreen words placed on the board itself (layers 21 tPlace, 25 tNames, 48 Document).
// Names of sub-circuits the course's homeworks never use are left out.
const UNRELATED = /ESP8266|ESP32|MSP430|^MSP |Orange PI/i;
const texts = kids(plain, "text")
  .filter((t) => ["21", "25", "48"].includes(t.a.layer) && t.text.trim() && !UNRELATED.test(t.text.trim()))
  .map((t) => [r2(+t.a.x), r2(H - +t.a.y), r2(+t.a.size), rot(t.a.rot).deg, t.text.trim()])
  .sort((a, b) => a[1] - b[1] || a[0] - b[0] || natural(a[4], b[4]));

// Outlines of the parts that are only drawn: the box around a package's pads and outline, and a word for it.
const DRAW = {
  A4973: "Motor driver", DRV8874: "Motor driver", F28027: "F28027", MAX4506: "MAX4506", BQ32000: "Clock", IS62WVS512: "RAM",
  USR_ES1_W5500: "Ethernet", CR2032V: "Coin cell", "RELAY_JQC-3F_5V": "Relay",
  "JACK-PMS": "Power jack", SWITCH_SLIDE: "Switch", TO220: "Transistor",
};
const decor = [];
for (const el of elements) {
  const pk = pkgOf(el);
  const word = DRAW[el.a.value] ?? DRAW[pk.a.name];
  if (!word || rot(el.a.rot).mirror) continue;
  const pts = [];
  for (const k of pk.kids) {
    if (k.tag === "pad" || k.tag === "smd" || k.tag === "hole") pts.push([+k.a.x, +k.a.y]);
    else if (k.tag === "wire" && (k.a.layer === "21" || k.a.layer === "51")) pts.push([+k.a.x1, +k.a.y1], [+k.a.x2, +k.a.y2]);
    else if (k.tag === "circle" && k.a.layer === "21") pts.push([+k.a.x - +k.a.radius, +k.a.y - +k.a.radius], [+k.a.x + +k.a.radius, +k.a.y + +k.a.radius]);
  }
  if (!pts.length) continue;
  const placed = pts.map(([x, y]) => place(el, x, y));
  const x0 = Math.min(...placed.map((p) => p[0]));
  const y0 = Math.min(...placed.map((p) => p[1]));
  const x1 = Math.max(...placed.map((p) => p[0]));
  const y1 = Math.max(...placed.map((p) => p[1]));
  decor.push([r2(Math.max(0, x0)), r2(Math.max(0, y0)), r2(Math.min(W, x1) - Math.max(0, x0)), r2(Math.min(H, y1) - Math.max(0, y0)), word]);
}
for (const b of ["B3", "B4", "B5"]) {
  const [x, y] = at(b);
  // The banana jacks are sockets too: one hole each, drawn as a round jack.
  decor.push([r2(x - 5.08), r2(y - 5.08), 10.16, 10.16, elByName.get(b).a.value.replace(" SCOPE", "")]);
}

// The LaunchPad: its outline and its 80 header pins with the net each one is.
const lp = elByName.get("L1");
const lpk = pkgOf(lp);
const box = kids(lpk, "wire").filter((w) => Math.abs(+w.a.x1 - +w.a.x2) > 20 || Math.abs(+w.a.y1 - +w.a.y2) > 20);
const corners = box.flatMap((w) => [place(lp, +w.a.x1, +w.a.y1), place(lp, +w.a.x2, +w.a.y2)]);
const lx0 = Math.max(0, Math.min(...corners.map((c) => c[0])));
const ly0 = Math.max(0, Math.min(...corners.map((c) => c[1])));
const launchpad = {
  x: r2(lx0),
  y: r2(ly0),
  w: r2(Math.min(W, Math.max(...corners.map((c) => c[0]))) - lx0),
  h: r2(Math.min(H, Math.max(...corners.map((c) => c[1]))) - ly0),
  pins: kids(lpk, "pad")
    .map((p) => [...place(lp, +p.a.x, +p.a.y), signalOf.has(`L1.${p.a.name}`) ? netOfPad(lp, p.a.name) : -1, +p.a.name.replace("P$", "")])
    .sort((a, b) => a[3] - b[3]),
  // The words printed next to its header columns.
  heads: kids(lpk, "text").filter((t) => /^J\d$/.test(t.text.trim())).map((t) => [...place(lp, +t.a.x, +t.a.y), t.text.trim()]).sort((a, b) => natural(a[2], b[2])),
};

const version = texts.find((t) => /^Version /.test(t[4]))?.[4] ?? "";
const data = { v: 1, name: "SE 423 homework board", rev: version, w: r2(W), h: r2(H), nets, groups, holes, parts, traces, texts, decor, launchpad };

// One short line per entry: small on disk, readable in a diff.
const line = (v) => JSON.stringify(v);
const block = (arr) => `[\n${arr.map((v) => `  ${line(v)}`).join(",\n")}\n]`;
const body = Object.entries(data)
  .map(([k, v]) => `"${k}": ${Array.isArray(v) && k !== "nets" ? block(v) : k === "launchpad" ? `{"x":${v.x},"y":${v.y},"w":${v.w},"h":${v.h},"pins":${line(v.pins)},"heads":${line(v.heads)}}` : line(v)}`)
  .join(",\n");
writeFileSync(out, `{\n${body}\n}\n`);
console.log(`${out}: ${nets.length} nets, ${holes.length} holes in ${groups.length} groups, ${parts.length} parts, ${traces.length} traces, ${Buffer.byteLength(`{\n${body}\n}\n`)} bytes`);
