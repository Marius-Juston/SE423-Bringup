import { useMemo, useState } from "react";
import { inThreshold, relight, rgbToLabInt, type LabThreshold, type Rgb } from "./lab-color";

// A six-number LAB threshold on a small synthetic camera image, as the
// course's camera does it (lecture 17, slides 31, 32 and 35; OpenMV scripts
// of lab 7): every pixel is converted from RGB to L, A, B (image.rgb_to_lab)
// and is in the mask when L_min < L < L_max, A_min < A < A_max and
// B_min < B < B_max. The six numbers are written in the camera's order,
// (L_min, L_max, A_min, A_max, B_min, B_max), the tuple find_blobs takes.
// L runs from 0 to 100, A (green to red) and B (blue to yellow) from -128 to
// 127. The conversion (sRGB, D65) is in lab-color.ts and unit-tested.

const COLS = 20;
const ROWS = 12;
const CELL = 9.8;

type ObjId = "floor" | "wall" | "ball" | "cone" | "blue" | "tape";
const OBJECTS: Record<ObjId, { name: string; the: string; rgb: Rgb; probe: [number, number] }> = {
  ball: { name: "Orange ball", the: "the orange ball", rgb: [255, 128, 0], probe: [5, 5] },
  cone: { name: "Red cone", the: "the red cone", rgb: [230, 20, 40], probe: [12, 7] },
  blue: { name: "Blue ball", the: "the blue ball", rgb: [0, 90, 255], probe: [16, 4] },
  tape: { name: "Yellow tape", the: "the yellow tape", rgb: [230, 200, 40], probe: [9, 11] },
  wall: { name: "Wooden wall", the: "the wooden wall", rgb: [180, 150, 120], probe: [10, 0] },
  floor: { name: "Floor", the: "the floor", rgb: [160, 160, 160], probe: [9, 3] },
};
const ORDER: ObjId[] = ["ball", "cone", "blue", "tape", "wall", "floor"];

/** Which object a pixel shows, and how much of the light reaches it (shading and sensor noise). */
function scenePixel(col: number, row: number): { obj: ObjId; shade: number } {
  // A fixed pattern of small differences between neighbouring pixels, as a real sensor has.
  const noise = 0.94 + 0.12 * (((col * 7 + row * 13 + col * row * 3) % 11) / 10);
  const disc = (cx: number, cy: number, r: number) => (col - cx) ** 2 + (row - cy) ** 2 <= r * r;
  if (disc(5.5, 6, 2.7)) {
    // Lit from the upper left: the lower right of the ball is in its own shade.
    const t = (col - 5.5 + (row - 6)) / (2.7 * 1.414);
    return { obj: "ball", shade: noise * (0.68 - 0.32 * t) };
  }
  if (disc(16, 4.5, 2.1)) return { obj: "blue", shade: noise * (0.8 - 0.2 * ((col - 16 + (row - 4.5)) / 3)) };
  if (row >= 4 && row <= 9 && Math.abs(col - 12) <= (row - 3) * 0.42) return { obj: "cone", shade: noise * (col > 12 ? 0.6 : 1) };
  if (row === 11 && col >= 2 && col <= 17) return { obj: "tape", shade: noise };
  if (row <= 1) return { obj: "wall", shade: noise };
  return { obj: "floor", shade: noise };
}
const SCENE = Array.from({ length: ROWS * COLS }, (_, i) => scenePixel(i % COLS, Math.floor(i / COLS)));

const START: LabThreshold = { lMin: 40, lMax: 80, aMin: 25, aMax: 55, bMin: 45, bMax: 90 };
const CHANNELS = [
  { key: "L", name: "L", min: 0, max: 100, lo: "lMin", hi: "lMax", ends: ["0 black", "white 100"], grad: "labp-gl" },
  { key: "A", name: "A", min: -128, max: 127, lo: "aMin", hi: "aMax", ends: ["-128 green", "red 127"], grad: "labp-ga" },
  { key: "B", name: "B", min: -128, max: 127, lo: "bMin", hi: "bMax", ends: ["-128 blue", "yellow 127"], grad: "labp-gb" },
] as const;
type Key = keyof LabThreshold;

const X0 = 6;
const X1 = 218;
const TOP = 16;
const AX0 = 92;
const AXW = 230;

function LabPicker() {
  const [light, setLight] = useState(100);
  const [t, setT] = useState<LabThreshold>(START);
  const [probe, setProbe] = useState<[number, number]>(OBJECTS.ball.probe);

  const px = useMemo(
    () =>
      SCENE.map((p) => {
        const rgb = relight(OBJECTS[p.obj].rgb, (p.shade * light) / 100);
        return { obj: p.obj, rgb, lab: rgbToLabInt(rgb) };
      }),
    [light],
  );
  const inMask = px.map((p) => inThreshold(p.lab, t));
  const at = px[probe[1] * COLS + probe[0]];
  const probeIn = inMask[probe[1] * COLS + probe[0]];

  // One threshold slider moved: the other end of the range gives way, so min never passes max.
  const set = (key: Key, v: number) =>
    setT((old) => {
      const next = { ...old, [key]: v };
      for (const c of CHANNELS) {
        if (key === c.lo && next[c.hi] < v) next[c.hi] = v;
        if (key === c.hi && next[c.lo] > v) next[c.lo] = v;
      }
      return next;
    });
  const fromProbe = () => {
    const [l, a, b] = at.lab;
    const m = 12;
    setT({ lMin: Math.max(0, l - m), lMax: Math.min(100, l + m), aMin: Math.max(-128, a - m), aMax: Math.min(127, a + m), bMin: Math.max(-128, b - m), bMax: Math.min(127, b + m) });
  };

  // ---- the sentence: how well the threshold fits the object under the probe
  const stat = (obj: ObjId) => {
    const idx = px.map((p, i) => (p.obj === obj ? i : -1)).filter((i) => i >= 0);
    const sel = idx.filter((i) => inMask[i]);
    return { obj, idx, sel, total: idx.length };
  };
  const stats = ORDER.map(stat);
  const total = inMask.filter(Boolean).length;
  const target = stats.find((s) => s.obj === at.obj)!;
  const others = stats.filter((s) => s.obj !== at.obj && s.sel.length > 0).sort((a, b) => b.sel.length - a.sel.length);
  const share = (s: { sel: number[]; total: number; obj: ObjId }) => `${s.sel.length === s.total ? "all" : "part"} of ${OBJECTS[s.obj].the} (${s.sel.length} of ${s.total} pixels)`;
  const range = (idx: number[], ch: number) => [Math.min(...idx.map((i) => px[i].lab[ch])), Math.max(...idx.map((i) => px[i].lab[ch]))];

  let status: string;
  if (total === 0) {
    status = "No pixel is inside the threshold: the mask is empty. Press \"Set from probe\" to start from the pixel under the probe, then widen the ranges.";
  } else if (at.obj === "floor") {
    status = `The probe is on the floor. The threshold selects ${[...others, ...(target.sel.length ? [target] : [])].map(share).join(" and ")}. Put the probe on an object to see how well the threshold fits it.`;
  } else {
    const name = OBJECTS[at.obj].the;
    const parts: string[] = [];
    if (target.sel.length === target.total) parts.push(`All ${target.total} pixels of ${name} are selected`);
    else if (target.sel.length === 0) parts.push(`No pixel of ${name} is selected`);
    else parts.push(`${target.sel.length} of the ${target.total} pixels of ${name} are selected`);
    if (target.sel.length < target.total) {
      // Which limit rejects most of the missed pixels?
      const missed = target.idx.filter((i) => !inMask[i]);
      let best = { n: 0, text: "" };
      CHANNELS.forEach((c, ch) => {
        const [lo, hi] = range(missed, ch);
        const below = missed.filter((i) => px[i].lab[ch] <= t[c.lo]).length;
        const above = missed.filter((i) => px[i].lab[ch] >= t[c.hi]).length;
        if (below > best.n) best = { n: below, text: `the missed ones have ${c.name} down to ${lo}, not above ${c.name} min (${t[c.lo]}): lower ${c.name} min` };
        if (above > best.n) best = { n: above, text: `the missed ones have ${c.name} up to ${hi}, not below ${c.name} max (${t[c.hi]}): raise ${c.name} max` };
      });
      parts[0] += `: ${best.text}`;
    }
    if (target.sel.length === 0 && others.length > 0) {
      parts.push(`The threshold picks ${others.map(share).join(", ")}. Press "Set from probe" to aim it at ${name} instead`);
    } else if (others.length === 0) {
      parts.push(target.sel.length === target.total ? "Nothing else is: this threshold works at this light. Move Light and see how long it holds" : "Nothing else is selected");
    } else {
      parts.push(`Also selected: ${others.map(share).join(", ")}`);
      // The channel in which the intruder lies furthest from the target.
      const o = others[0];
      let best = { gap: 0, text: "" };
      CHANNELS.forEach((c, ch) => {
        const [tLo, tHi] = range(target.idx, ch);
        const [oLo, oHi] = range(o.sel, ch);
        if (oLo - tHi > best.gap) best = { gap: oLo - tHi, text: `Narrow ${c.name}: ${name} has ${c.name} up to ${tHi} and ${OBJECTS[o.obj].the} from ${oLo}, so put ${c.name} max between them` };
        if (tLo - oHi > best.gap) best = { gap: tLo - oHi, text: `Narrow ${c.name}: ${name} has ${c.name} from ${tLo} and ${OBJECTS[o.obj].the} up to ${oHi}, so put ${c.name} min between them` };
      });
      parts.push(best.text || `At this light no single channel separates ${name} from ${OBJECTS[o.obj].the}: their L, A and B ranges overlap`);
    }
    status = parts.join(". ") + ".";
  }

  const [pc, pr] = probe;
  const verdicts = CHANNELS.map((c, ch) => (at.lab[ch] <= t[c.lo] ? "not above min" : at.lab[ch] >= t[c.hi] ? "not below max" : "inside"));
  const tuple = `(${t.lMin}, ${t.lMax}, ${t.aMin}, ${t.aMax}, ${t.bMin}, ${t.bMax})`;
  const ring = (x0: number) => (
    <g pointerEvents="none">
      <rect x={x0 + pc * CELL - 1.5} y={TOP + pr * CELL - 1.5} width={CELL + 3} height={CELL + 3} className="labp-ring-out" />
      <rect x={x0 + pc * CELL - 0.5} y={TOP + pr * CELL - 0.5} width={CELL + 1} height={CELL + 1} className="labp-ring-in" />
    </g>
  );
  const barY = (i: number) => 166 + i * 30;

  return (
    <figure className="figure" aria-label="Interactive LAB colour threshold on a small camera image">
      <style>{`
        .labp-frame { fill: none; stroke: var(--border-strong); stroke-width: 1; }
        .labp-ring-out { fill: none; stroke: #000; stroke-width: 2.4; }
        .labp-ring-in { fill: none; stroke: #fff; stroke-width: 1.2; }
        .labp-px { cursor: crosshair; }
        .labp-window { fill: none; stroke: var(--harvest); stroke-width: 2; }
        .labp-mark { fill: var(--text); stroke: var(--bg, var(--surface)); stroke-width: 0.6; }
        .labp-strip { stroke: var(--border-strong); stroke-width: 0.6; }
        .fig-controls > .labp-row { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr) minmax(0, 1fr); gap: 0.3rem 0.7rem; align-items: center; }
        .fig-controls > .labp-row > span:first-child { width: auto; }
        .labp-row label { display: flex; align-items: center; gap: 0.3rem; min-width: 0; font-size: 0.82rem; color: var(--dim); }
        .labp-row label.wide { grid-column: 2 / 4; }
        .labp-row input[type=range] { accent-color: var(--orange); flex: 1 1 0; width: 0; min-width: 0; padding: 0; }
        .labp-row output { font-family: var(--mono); color: var(--harvest); font-size: 0.82rem; min-width: 2.1rem; text-align: right; }
        .labp-code { display: block; margin: 0.4rem 0; padding: 0.35rem 0.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; font-family: var(--mono); font-size: 0.78rem; overflow-x: auto; white-space: pre; }
      `}</style>
      <svg
        viewBox="0 0 420 252"
        role="img"
        aria-label={`Camera image of ${COLS} by ${ROWS} pixels at ${light} percent light, and its mask for the threshold L ${t.lMin} to ${t.lMax}, A ${t.aMin} to ${t.aMax}, B ${t.bMin} to ${t.bMax}: ${total} pixels selected. Probe on ${OBJECTS[at.obj].the} at column ${pc}, row ${pr}: L ${at.lab[0]}, A ${at.lab[1]}, B ${at.lab[2]}, ${probeIn ? "in the mask" : "not in the mask"}. ${status}`}
      >
        <defs>
          <linearGradient id="labp-gl"><stop offset="0" stopColor="#000" /><stop offset="1" stopColor="#fff" /></linearGradient>
          <linearGradient id="labp-ga"><stop offset="0" stopColor="#00a37a" /><stop offset="0.5" stopColor="#9a9a9a" /><stop offset="1" stopColor="#e8457c" /></linearGradient>
          <linearGradient id="labp-gb"><stop offset="0" stopColor="#2f7df6" /><stop offset="0.5" stopColor="#9a9a9a" /><stop offset="1" stopColor="#e8c800" /></linearGradient>
        </defs>
        <text x={X0} y="10" className="fig-label">Camera image (click a pixel)</text>
        <text x={X1} y="10" className="fig-label">Mask: white = inside the threshold</text>
        {px.map((p, i) => {
          const x = (i % COLS) * CELL;
          const y = TOP + Math.floor(i / COLS) * CELL;
          return (
            <g key={i}>
              <rect className="labp-px" x={X0 + x} y={y} width={CELL + 0.2} height={CELL + 0.2} style={{ fill: `rgb(${p.rgb.join(",")})` }} onClick={() => setProbe([i % COLS, Math.floor(i / COLS)])} />
              <rect x={X1 + x} y={y} width={CELL + 0.2} height={CELL + 0.2} style={{ fill: inMask[i] ? "#fff" : "#000" }} />
            </g>
          );
        })}
        <rect x={X0} y={TOP} width={COLS * CELL} height={ROWS * CELL} className="labp-frame" />
        <rect x={X1} y={TOP} width={COLS * CELL} height={ROWS * CELL} className="labp-frame" />
        {ring(X0)}
        {ring(X1)}
        <text x={X0} y="148" className="fig-label">
          Probe: column {pc}, row {pr}, {OBJECTS[at.obj].name.toLowerCase()}. R {at.rgb[0]}, G {at.rgb[1]}, B {at.rgb[2]}
        </text>
        <text x="414" y="148" textAnchor="end" className="fig-value small">{probeIn ? "in the mask" : "not in the mask"}</text>
        {CHANNELS.map((c, ch) => {
          const y = barY(ch);
          const sx = (v: number) => AX0 + ((v - c.min) / (c.max - c.min)) * AXW;
          const v = at.lab[ch];
          return (
            <g key={c.key}>
              <text x={X0} y={y + 7} className="fig-label">{c.name} =</text>
              <text x={X0 + 24} y={y + 7} className="fig-value">{v}</text>
              <rect x={AX0} y={y} width={AXW} height="7" fill={`url(#${c.grad})`} className="labp-strip" />
              <rect x={sx(t[c.lo])} y={y - 3} width={Math.max(1.5, sx(t[c.hi]) - sx(t[c.lo]))} height="13" rx="2" className="labp-window" />
              <path d={`M${sx(v)},${y - 1} l-4,-6 h8 z`} className="labp-mark" />
              <text x={AX0} y={y + 19} className="fig-label dim">{c.ends[0]}</text>
              <text x={AX0 + AXW} y={y + 19} textAnchor="end" className="fig-label dim">{c.ends[1]}</text>
              <text x={AX0 + AXW / 2} y={y + 19} textAnchor="middle" className="fig-label dim">window {t[c.lo]} to {t[c.hi]}</text>
              <text x="414" y={y + 7} textAnchor="end" className="fig-label">{verdicts[ch]}</text>
            </g>
          );
        })}
      </svg>
      <div className="fig-why" role="status">{status}</div>
      <div className="fig-controls">
        <div className="labp-row">
          <span>Light</span>
          <label className="wide">
            <span className="sr-only">Light on the scene, percent</span>
            <input type="range" min={30} max={130} step={5} value={light} onChange={(e) => setLight(+e.target.value)} />
            <output>{light} %</output>
          </label>
        </div>
        {CHANNELS.map((c) => (
          <div className="labp-row" key={c.key}>
            <span>{c.name}</span>
            {([c.lo, c.hi] as Key[]).map((k, j) => (
              <label key={k}>
                <span aria-hidden="true">{j ? "max" : "min"}</span>
                <input type="range" aria-label={`${c.name} ${j ? "max" : "min"}`} min={c.min} max={c.max} value={t[k]} onChange={(e) => set(k, +e.target.value)} />
                <output>{t[k]}</output>
              </label>
            ))}
          </div>
        ))}
        <div>
          <span>Probe on</span>
          {ORDER.map((o) => (
            <button key={o} className="fig-opt" aria-pressed={at.obj === o} onClick={() => setProbe(OBJECTS[o].probe)}>{OBJECTS[o].name}</button>
          ))}
        </div>
        <div>
          <span>Threshold</span>
          <button className="fig-opt" onClick={fromProbe}>Set from probe, 12 either side</button>
          <button className="fig-opt" onClick={() => { setT(START); setLight(100); setProbe(OBJECTS.ball.probe); }}>Start again</button>
        </div>
      </div>
      <details className="fig-more">
        <summary>More controls: move the probe one pixel at a time</summary>
        <div className="fig-controls">
          <div className="labp-row">
            <span>Probe</span>
            <label>
              <span>column</span>
              <input type="range" aria-label="Probe column" min={0} max={COLS - 1} value={pc} onChange={(e) => setProbe([+e.target.value, pr])} />
              <output>{pc}</output>
            </label>
            <label>
              <span>row</span>
              <input type="range" aria-label="Probe row" min={0} max={ROWS - 1} value={pr} onChange={(e) => setProbe([pc, +e.target.value])} />
              <output>{pr}</output>
            </label>
          </div>
        </div>
      </details>
      <code className="labp-code">threshold = {tuple}{"\n"}# (L_min, L_max, A_min, A_max, B_min, B_max)</code>
      <figcaption>
        Left, what the camera sees; right, the mask. A pixel is in the mask when its L, A and B (the three markers) each lie inside their window. Less light lowers L most; A and B move towards 0 more slowly and keep their signs. So the L window is left wide and the A and B windows do the choosing. The probe can also be moved with the buttons and under More controls.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "lab-picker",
  title: "Colour threshold on a camera image",
  description: "Dim the light on a small camera picture, move six sliders that say which colours count, and see which pixels are picked and what to change when the wrong ones are.",
  Component: LabPicker,
};
