import { useState } from "react";

// RGB to HSL exactly as chapter 19 (lecture 17) computes it in rgb_to_hsl():
//   L = (max + min) / 2,  S = d / (1 - |2L - 1|),  d = max - min
//   H = 60 (G - B) / d          when R is the largest (add 360 if negative)
//   H = 60 ((B - R) / d + 2)    when G is the largest
//   H = 60 ((R - G) / d + 4)    when B is the largest
//   d = 0 (grey): H = 0 and S = 0 by convention.
// The mask window (hue 15 to 45 degrees, saturation at least 0.5) and the
// test pixels are the ones of the chapter's levels.

const H_MIN = 15;
const H_MAX = 45;
const S_MIN = 0.5;
const SHADOW = 0.4;

const PRESETS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Orange ball", rgb: [255, 128, 0] },
  { name: "Red cone", rgb: [230, 20, 40] },
  { name: "Blue ball", rgb: [0, 90, 255] },
  { name: "Wooden wall", rgb: [180, 150, 120] },
  { name: "Grey floor", rgb: [160, 160, 160] },
];

interface Hsl {
  r: number;
  g: number;
  b: number;
  hi: number;
  lo: number;
  d: number;
  l: number;
  s: number;
  h: number;
  /** Hue before 360 is added to a negative value. */
  raw: number;
  /** 0 R largest, 1 G largest, 2 B largest, -1 grey. */
  branch: number;
}

function hsl(R: number, G: number, B: number): Hsl {
  const r = R / 255;
  const g = G / 255;
  const b = B / 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo;
  const l = (hi + lo) / 2;
  if (d === 0) return { r, g, b, hi, lo, d, l, s: 0, h: 0, raw: 0, branch: -1 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const branch = hi === r ? 0 : hi === g ? 1 : 2;
  const raw = branch === 0 ? 60 * ((g - b) / d) : branch === 1 ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { r, g, b, hi, lo, d, l, s, h: raw < 0 ? raw + 360 : raw, raw, branch };
}

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);

const CX = 344;
const CY = 80;
/** Point on the hue circle: 0 degrees at the top, clockwise. */
const polar = (deg: number, r: number): [number, number] => [CX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)];
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

function HslPicker() {
  const [base, setBase] = useState<[number, number, number]>([255, 128, 0]);
  const [shadow, setShadow] = useState(false);
  const px = base.map((v) => (shadow ? Math.round(v * SHADOW) : v)) as [number, number, number];
  const lit = hsl(...base);
  const c = hsl(...px);
  const grey = c.branch < 0;
  const inHue = c.h >= H_MIN && c.h <= H_MAX;
  const inMask = !grey && inHue && c.s >= S_MIN;
  const names = ["R", "G", "B"];
  const chan = [c.r, c.g, c.b];
  // The first channel that equals the maximum is "the largest", as in the C code.
  const hiIdx = grey ? -1 : c.branch;
  const loIdx = grey ? -1 : chan.indexOf(c.lo);
  const BRANCH = [
    { when: "R largest", f: "H = 60 × (G - B) / d" },
    { when: "G largest", f: "H = 60 × ((B - R) / d + 2)" },
    { when: "B largest", f: "H = 60 × ((R - G) / d + 4)" },
  ];
  const set = (i: number, v: number) => setBase(base.map((x, k) => (k === i ? v : x)) as [number, number, number]);

  const maskWhy = grey
    ? "It is grey, so it is not in the mask."
    : inMask
      ? `Hue ${f1(c.h)} is inside the mask window (${H_MIN} to ${H_MAX} degrees) and the saturation ${f2(c.s)} is at least ${S_MIN}: this pixel is in the mask.`
      : inHue
        ? `Hue ${f1(c.h)} is inside the window (${H_MIN} to ${H_MAX} degrees), but the saturation ${f2(c.s)} is below ${S_MIN}: too pale, not in the mask.`
        : `Hue ${f1(c.h)} is outside the mask window (${H_MIN} to ${H_MAX} degrees): not in the mask.`;
  const status = grey
    ? `All three channels are equal, so d = 0: there is no colour. H and S are set to 0 by convention, and the function returns before it would divide by d.${shadow ? " The shadow only lowered L." : ""}`
    : shadow
      ? `The shadow multiplied every channel by ${SHADOW}: R ${base[0]} to ${px[0]}, G ${base[1]} to ${px[1]}, B ${base[2]} to ${px[2]}. The lightness fell from ${f2(lit.l)} to ${f2(c.l)}. The hue ${lit.branch < 0 ? "stays undefined" : f1(lit.h) === f1(c.h) ? `stays at ${f1(c.h)}` : `went from ${f1(lit.h)} to ${f1(c.h)}`}: the differences between channels and d shrink by the same factor, so their ratio does not move${lit.branch >= 0 && f1(lit.h) !== f1(c.h) ? " (the small change comes from rounding the pixel to whole numbers)" : ""}.`
      : `${names[c.branch]} is the largest channel, so the ${["first", "second", "third"][c.branch]} hue formula applies${c.raw < 0 ? `. It gives ${f1(c.raw)}, a negative angle: add 360 to get ${f1(c.h)}. Red lies on both sides of the 0 / 360 seam, so a red mask needs "hue above 340 OR hue below 20"` : ""}. Press Shadow: R, G and B all change, the hue does not.`;

  const [mx, my] = polar(c.h, 40);
  const [m0x, m0y] = polar(c.h, 30);
  const [m1x, m1y] = polar(c.h, 53);

  return (
    <figure className="figure" aria-label="Interactive RGB to HSL converter with a shadow button">
      <style>{`
        .hslp-row input[type=range] { accent-color: var(--orange); flex: 1 1 6rem; min-width: 5rem; padding: 0; }
        .hslp-row output { font-family: var(--mono); color: var(--harvest); font-size: 0.82rem; width: 2.2rem; text-align: right; }
        .hslp-swatch { stroke: var(--text); stroke-width: 1; }
        .hslp-ghost { fill: none; stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 2; }
        .hslp-bar { fill: var(--border); }
        .hslp-window { fill: none; stroke: var(--harvest); stroke-width: 3; }
        .hslp-marker { stroke: var(--text); stroke-width: 2; fill: none; }
        .hslp-seam { stroke: var(--text); stroke-width: 1.2; stroke-dasharray: 2 2; }
      `}</style>
      <svg viewBox="0 0 420 172" role="img" aria-label={`Pixel R ${px[0]}, G ${px[1]}, B ${px[2]}${shadow ? " in shadow" : ""}. Hue ${f1(c.h)} degrees, saturation ${f2(c.s)}, lightness ${f2(c.l)}. ${maskWhy}`}>
        {/* swatch */}
        <rect x="6" y="8" width="50" height="50" rx="4" className="hslp-swatch" style={{ fill: `rgb(${px[0]},${px[1]},${px[2]})` }} />
        <text x="31" y="69" textAnchor="middle" className="fig-label dim">{shadow ? "in shadow" : "in the light"}</text>
        {/* channel bars, scaled 0..1 */}
        {names.map((n, i) => {
          const y = 10 + i * 18;
          const w = 120;
          return (
            <g key={n}>
              <text x="68" y={y + 9} className="fig-label">{n}</text>
              <rect x="80" y={y} width={w} height="11" rx="2" className="hslp-bar" />
              <rect x="80" y={y} width={Math.max(0.5, chan[i] * w)} height="11" rx="2" style={{ fill: ["#ff6b5c", "#7ad79a", "#6fa8ff"][i] }} />
              {shadow && <rect x="80" y={y} width={Math.max(0.5, (base[i] / 255) * w)} height="11" rx="2" className="hslp-ghost" />}
              <text x="206" y={y + 9} className="fig-value small">{String(px[i]).padStart(3, " ")} = {f2(chan[i])}</text>
              <text x="274" y={y + 9} className="fig-label dim">{i === hiIdx ? "max" : i === loIdx ? "min" : ""}</text>
            </g>
          );
        })}
        {/* the three results */}
        <text x="6" y="88" className="fig-label">
          d = max - min = <tspan className="fig-value small">{f2(c.d)}</tspan>
        </text>
        <text x="6" y="102" className="fig-label">
          L = (max + min) / 2 = <tspan className="fig-value small">{f2(c.l)}</tspan>
        </text>
        <text x="6" y="116" className="fig-label">
          S = d / (1 - |2L - 1|) = <tspan className="fig-value small">{grey ? "0 (grey)" : f2(c.s)}</tspan>
        </text>
        {/* hue branches */}
        {BRANCH.map((b, i) => {
          const y = 124 + i * 15;
          const on = i === c.branch;
          return (
            <g key={i}>
              {on && <rect x="3" y={y} width="268" height="14" rx="3" className="fig-box hot" />}
              <text x="8" y={y + 10} className={`fig-label ${on ? "" : "dim"}`}>
                {on ? "▶ " : ""}{b.when}: {b.f}
                {on && <tspan className="fig-value small"> = {f1(c.raw)}{c.raw < 0 ? ` + 360 = ${f1(c.h)}` : ""}</tspan>}
              </text>
            </g>
          );
        })}
        {grey && <text x="140" y="88" className="fig-label dim">d = 0: grey, H = 0 and S = 0, no division</text>}
        {/* hue circle */}
        {Array.from({ length: 72 }, (_, k) => (
          <path key={k} d={arc(k * 5 - 0.3, k * 5 + 5.3, 40)} style={{ stroke: `hsl(${k * 5 + 2.5}, 100%, 50%)`, strokeWidth: 12, fill: "none" }} />
        ))}
        <path d={arc(H_MIN, H_MAX, 50)} className="hslp-window" />
        <line x1={CX} x2={CX} y1={CY - 56} y2={CY - 30} className="hslp-seam" />
        <text x={CX} y="14" textAnchor="middle" className="fig-label">0 = 360: red</text>
        <text x="418" y={CY + 30} textAnchor="end" className="fig-label dim">120</text>
        <text x="418" y={CY + 42} textAnchor="end" className="fig-label dim">green</text>
        <text x={CX - 52} y={CY + 30} textAnchor="end" className="fig-label dim">240</text>
        <text x={CX - 52} y={CY + 42} textAnchor="end" className="fig-label dim">blue</text>
        {grey ? (
          <text x={CX} y={CY - 2} textAnchor="middle" className="fig-label dim">no hue</text>
        ) : (
          <>
            <line x1={m0x} y1={m0y} x2={m1x} y2={m1y} className="hslp-marker" />
            <circle cx={mx} cy={my} r="6.5" className="hslp-marker" style={{ fill: `rgb(${px[0]},${px[1]},${px[2]})` }} />
            <text x={CX} y={CY - 2} textAnchor="middle" className="fig-value">H {f1(c.h)}</text>
          </>
        )}
        <text x={CX} y="150" textAnchor="middle" className="fig-label dim">outer arc: mask window,</text>
        <text x={CX} y="161" textAnchor="middle" className="fig-label dim">hue {H_MIN} to {H_MAX}{inMask ? ": pixel is in" : ": pixel is out"}</text>
      </svg>
      <div className="fig-why" role="status">
        {status} {maskWhy}
      </div>
      <div className="fig-controls">
        {names.map((n, i) => (
          <div key={n} className="hslp-row">
            <span><label htmlFor={`hslp-${n}`} aria-label={`${n} in the light, 0 to 255`}>{n} (lit)</label></span>
            <input id={`hslp-${n}`} type="range" min={0} max={255} value={base[i]} onChange={(e) => set(i, +e.target.value)} />
            <output>{base[i]}</output>
          </div>
        ))}
        <div>
          <span>Pixel</span>
          {PRESETS.map((p) => (
            <button key={p.name} className="fig-opt" aria-pressed={p.rgb.every((v, i) => v === base[i])} onClick={() => setBase(p.rgb)}>{p.name}</button>
          ))}
        </div>
        <div>
          <span>Light</span>
          <button className="fig-opt" aria-pressed={!shadow} onClick={() => setShadow(false)}>Lit</button>
          <button className="fig-opt" aria-pressed={shadow} onClick={() => setShadow(true)}>Shadow</button>
          <code>rgb_to_hsl({px[0]}, {px[1]}, {px[2]}, &amp;h, &amp;s, &amp;l);</code>
        </div>
      </div>
      <figcaption>One pixel converted from RGB to hue, saturation and lightness. A shadow scales R, G and B together: the lightness drops and the hue stays, so the mask tests the hue. It also asks for enough saturation, because pale and grey pixels have no reliable hue.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "hsl-picker",
  title: "RGB to hue, saturation, lightness",
  description: "Set a pixel's red, green and blue, put it in shadow, and see its hue, saturation and lightness and whether the colour mask accepts it.",
  Component: HslPicker,
};
