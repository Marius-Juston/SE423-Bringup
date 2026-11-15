// The part of the figure and bench-view checks that runs inside the page.
//
// `probe` is one self-contained function: Playwright sends its source to the page
// (page.addInitScript(probe)), where it installs window.__a11y. Nothing in it may refer to
// anything outside its own body.
//
// What it measures, and from what:
//   text boxes      SVG text: the positions of the characters (getStartPositionOfChar) through the
//                   element's screen matrix; HTML text: Range rectangles. Both are cut down to the
//                   ink of the glyphs (canvas measureText: actualBoundingBoxAscent / Descent), so
//                   two lines that only share line spacing are not reported.
//   shapes          line, polyline, polygon, path, rect, circle, ellipse as screen polylines.
//   colours         computed fill / stroke / color, opacity of the element and its ancestors,
//                   composited over what is painted before it at that point.
//   colour vision   Machado, Oliveira and Fernandes (2009), "A physiologically-based model for
//                   simulation of color vision deficiency", IEEE TVCG 15(6): the severity 1.0
//                   matrices for protanopia, deuteranopia and tritanopia, applied in linear RGB.
//                   Differences are CIEDE2000 (Sharma, Wu and Dalal 2005), the measure and the
//                   thresholds (15 apart, 8 alike) of the course material's cvd_check.py.
//   contrast        WCAG 2.2 relative luminance and contrast ratio.

export function probe() {
  if (window.__a11y) return;
  const A = (window.__a11y = {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    await sleep(0);
    await sleep(0);
  };
  A.settle = settle;

  // ---------------------------------------------------------------- colour
  const cctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const colourCache = new Map();
  /** Any CSS colour as [r, g, b, a] (0..255, a 0..1), or null for none / a paint server. */
  function parseColour(str) {
    if (!str || str === "none" || str.startsWith("url(")) return null;
    let c = colourCache.get(str);
    if (c !== undefined) return c;
    const m = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) c = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]];
    else {
      cctx.clearRect(0, 0, 1, 1);
      cctx.fillStyle = "#000";
      cctx.fillStyle = str;
      cctx.fillRect(0, 0, 1, 1);
      const d = cctx.getImageData(0, 0, 1, 1).data;
      c = [d[0], d[1], d[2], d[3] / 255];
    }
    colourCache.set(str, c);
    return c;
  }
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const unlin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const hex = (c) => "#" + [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, c[i]))).toString(16).padStart(2, "0")).join("");
  // Machado et al. 2009, severity 1.0.
  const CVD = {
    protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  };
  const simulate = (c, m) => {
    const r = lin(c[0]);
    const g = lin(c[1]);
    const b = lin(c[2]);
    return [unlin(m[0] * r + m[1] * g + m[2] * b), unlin(m[3] * r + m[4] * g + m[5] * b), unlin(m[6] * r + m[7] * g + m[8] * b), 1].map((v, i) => (i < 3 ? Math.min(255, Math.max(0, v)) : v));
  };
  const lab = (c) => {
    const r = lin(c[0]);
    const g = lin(c[1]);
    const b = lin(c[2]);
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const chroma = (c) => {
    const l = lab(c);
    return Math.hypot(l[1], l[2]);
  };
  function deltaE(c1, c2) {
    const [L1, a1, b1] = lab(c1);
    const [L2, a2, b2] = lab(c2);
    const rad = Math.PI / 180;
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const ap1 = (1 + G) * a1;
    const ap2 = (1 + G) * a2;
    const Cp1 = Math.hypot(ap1, b1);
    const Cp2 = Math.hypot(ap2, b2);
    const h = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
    const hp1 = h(b1, ap1);
    const hp2 = h(b2, ap2);
    const dL = L2 - L1;
    const dC = Cp2 - Cp1;
    let dh = hp2 - hp1;
    if (Cp1 * Cp2 === 0) dh = 0;
    else if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
    const Lb = (L1 + L2) / 2;
    const Cpb = (Cp1 + Cp2) / 2;
    let hb = hp1 + hp2;
    if (Cp1 * Cp2 !== 0) hb = Math.abs(hp1 - hp2) <= 180 ? hb / 2 : hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2;
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
    const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
    const Sc = 1 + 0.045 * Cpb;
    const Sh = 1 + 0.015 * Cpb * T;
    const Rt = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
  }
  A.colour = { parseColour, ratio, deltaE, simulate, CVD, hex };

  // ---------------------------------------------------------------- small helpers
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  /** A text as a signature: numbers change with every control, so they do not make a new item. */
  const sigOf = (s) => norm(s).replace(/[-+−]?\d+(?:[.,]\d+)*/g, "#").slice(0, 40);
  const short = (s) => (norm(s).length > 36 ? norm(s).slice(0, 34) + "…" : norm(s));
  const nameOfEl = (el) => {
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
    return el.tagName.toLowerCase() + (cls ? "." + cls.trim().split(/\s+/).slice(0, 2).join(".") : "");
  };
  let styleMemo = new Map();
  const cs = (el) => {
    let s = styleMemo.get(el);
    if (!s) styleMemo.set(el, (s = getComputedStyle(el)));
    return s;
  };
  let opMemo = new Map();
  /** Opacity of an element with its ancestors, up to the root being checked. */
  function opacityOf(el) {
    let o = opMemo.get(el);
    if (o !== undefined) return o;
    o = parseFloat(cs(el).opacity);
    if (Number.isNaN(o)) o = 1;
    if (el.parentElement && el !== document.body) o *= opacityOf(el.parentElement);
    opMemo.set(el, o);
    return o;
  }
  function shown(el) {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    if (el.closest(".sr-only, [hidden]")) return false;
    return opacityOf(el) > 0.05;
  }
  const rectOf = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const cross = (a, b, tol) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > tol && Math.min(a.b, b.b) - Math.max(a.t, b.t) > tol;
  const inside = (inner, outer, tol) => inner.l >= outer.l - tol && inner.r <= outer.r + tol && inner.t >= outer.t - tol && inner.b <= outer.b + tol;

  // ---------------------------------------------------------------- glyph ink
  const mctx = document.createElement("canvas").getContext("2d");
  const inkMemo = new Map();
  /** Ink of a string above and below the baseline, and the font's own ascent and descent, per px of font size. */
  function inkOf(style, s) {
    const font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
    const key = font + "\n" + s;
    let m = inkMemo.get(key);
    if (!m) {
      mctx.font = font;
      const t = mctx.measureText(s);
      m = { asc: t.actualBoundingBoxAscent / 100, desc: t.actualBoundingBoxDescent / 100, fasc: t.fontBoundingBoxAscent / 100, fdesc: t.fontBoundingBoxDescent / 100 };
      if (inkMemo.size > 20000) inkMemo.clear();
      inkMemo.set(key, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- SVG text
  const svgTextMemo = new WeakMap();
  const matKey = (m) => (m ? `${m.a.toFixed(4)},${m.b.toFixed(4)},${m.c.toFixed(4)},${m.d.toFixed(4)},${m.e.toFixed(2)},${m.f.toFixed(2)}` : "");
  const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  function boxOfPoints(pts) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const [x, y] of pts) {
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
    }
    return { l, t, r, b };
  }
  /** The runs of one <text>: each a line (or a separate column) with its ink box on the screen. */
  function svgTextRuns(text) {
    const m = text.getScreenCTM();
    if (!m) return [];
    const style = cs(text);
    const fs = parseFloat(style.fontSize) || 10;
    const key = text.outerHTML + "|" + matKey(m) + "|" + fs + "|" + style.fontFamily + "|" + style.fontWeight;
    const memo = svgTextMemo.get(text);
    if (memo && memo.key === key) return memo.runs;
    const runs = [];
    let n = 0;
    try {
      n = text.getNumberOfChars();
    } catch {
      n = 0;
    }
    const whole = norm(text.textContent);
    const raw = text.textContent;
    const exact = raw.length === n ? raw : whole.length === n ? whole : null;
    let cur = null;
    const close = () => {
      if (!cur) return;
      const s = exact ? exact.slice(cur.i0, cur.i1) : whole;
      if (norm(s)) {
        const k = inkOf(style, norm(s));
        const y0 = cur.y - k.asc * fs;
        const y1 = cur.y + k.desc * fs;
        const box = boxOfPoints([apply(m, cur.x0, y0), apply(m, cur.x1, y0), apply(m, cur.x0, y1), apply(m, cur.x1, y1)]);
        runs.push({ s: norm(s), box });
      }
      cur = null;
    };
    for (let i = 0; i < n; i++) {
      let a, b;
      try {
        a = text.getStartPositionOfChar(i);
        b = text.getEndPositionOfChar(i);
      } catch {
        continue;
      }
      if (cur && (Math.abs(a.y - cur.y) > 0.6 * fs || a.x < cur.x1 - 0.5 * fs || a.x > cur.x1 + 1.5 * fs)) close();
      if (!cur) cur = { i0: i, i1: i + 1, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y: a.y };
      else {
        cur.i1 = i + 1;
        cur.x0 = Math.min(cur.x0, a.x, b.x);
        cur.x1 = Math.max(cur.x1, a.x, b.x);
      }
    }
    close();
    svgTextMemo.set(text, { key, runs });
    return runs;
  }

  // ---------------------------------------------------------------- shapes
  const SHAPES = "line, polyline, polygon, path, rect, circle, ellipse";
  const geoMemo = new WeakMap();
  function pathPoints(el) {
    const d = el.getAttribute("d") || "";
    // Straight segments only: read them. Anything curved: walk the path.
    if (/^[\sMLHVZmlhvz\d.,eE+-]*$/.test(d)) {
      const subs = [];
      let cur = null;
      let x = 0, y = 0, sx = 0, sy = 0;
      const re = /([MLHVZmlhvz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
      let cmd = "";
      let nums = [];
      const flush = () => {
        const C = cmd.toUpperCase();
        const rel = cmd !== C;
        const step = C === "H" || C === "V" ? 1 : 2;
        for (let i = 0; i + step <= nums.length; i += step) {
          if (C === "H") x = rel ? x + nums[i] : nums[i];
          else if (C === "V") y = rel ? y + nums[i] : nums[i];
          else {
            x = rel ? x + nums[i] : nums[i];
            y = rel ? y + nums[i + 1] : nums[i + 1];
          }
          if (C === "M" && i === 0) {
            cur = [[x, y]];
            subs.push(cur);
            sx = x;
            sy = y;
          } else cur?.push([x, y]);
        }
        nums = [];
      };
      let mt;
      while ((mt = re.exec(d))) {
        if (mt[1]) {
          flush();
          cmd = mt[1];
          if (cmd === "Z" || cmd === "z") {
            cur?.push([sx, sy]);
            x = sx;
            y = sy;
          }
        } else nums.push(+mt[2]);
      }
      flush();
      return subs;
    }
    let len = 0;
    try {
      len = el.getTotalLength();
    } catch {
      return [];
    }
    if (!len) return [];
    const n = Math.min(240, Math.max(8, Math.ceil(len / 3)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((len * i) / n);
      pts.push([p.x, p.y]);
    }
    // Sub-paths of a curved path are not told apart: a jump between them is at most one false segment.
    return /[Mm][^Mm]*[Mm]/.test(d) ? splitJumps(pts, (len / n) * 3) : [pts];
  }
  function splitJumps(pts, far) {
    const out = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > far) out.push([]);
      out[out.length - 1].push(pts[i]);
    }
    return out.filter((s) => s.length > 1);
  }
  /** Geometry of a shape in its own units: polylines and whether it encloses an area. */
  function geometry(el) {
    let key = "";
    for (const a of el.attributes) if (a.name !== "class" && a.name !== "style") key += a.name + "=" + a.value + ";";
    const memo = geoMemo.get(el);
    if (memo && memo.key === key) return memo;
    const num = (n) => el[n]?.baseVal?.value ?? 0;
    let subs = [];
    let closed = false;
    switch (el.tagName) {
      case "line":
        subs = [[[num("x1"), num("y1")], [num("x2"), num("y2")]]];
        break;
      case "rect": {
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        subs = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
        closed = true;
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = num("cx"), cy = num("cy");
        const rx = el.tagName === "circle" ? num("r") : num("rx");
        const ry = el.tagName === "circle" ? num("r") : num("ry");
        const p = [];
        for (let i = 0; i <= 24; i++) p.push([cx + rx * Math.cos((i * Math.PI) / 12), cy + ry * Math.sin((i * Math.PI) / 12)]);
        subs = [p];
        closed = true;
        break;
      }
      case "polyline":
      case "polygon": {
        const p = [];
        for (const q of el.points) p.push([q.x, q.y]);
        if (el.tagName === "polygon" && p.length) p.push(p[0]);
        subs = [p];
        closed = el.tagName === "polygon";
        break;
      }
      case "path":
        subs = pathPoints(el);
        closed = /[Zz]\s*$/.test(el.getAttribute("d") || "");
        break;
    }
    const g = { key, subs: subs.filter((s) => s.length > 1), closed };
    geoMemo.set(el, g);
    return g;
  }
  // Decoration by its class: grid lines, guides, a glow, the ghost of an earlier state.
  const DECOR = /(^|[\s_-])(grid|gridline|guide|ghost|glow)s?(\s|$)/;
  const NOT_DRAWN = "defs, marker, clipPath, mask, pattern, symbol, linearGradient, radialGradient";
  /** Every drawn shape of one <svg>, in painting order, with colours and screen geometry. */
  function shapesOf(svg, order) {
    const out = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest(NOT_DRAWN) || !shown(el)) continue;
      const m = el.getScreenCTM();
      if (!m) continue;
      const style = cs(el);
      const op = opacityOf(el);
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      let stroke = parseColour(style.stroke);
      const sw = parseFloat(style.strokeWidth) * scale;
      if (stroke) stroke = [stroke[0], stroke[1], stroke[2], stroke[3] * op * (parseFloat(style.strokeOpacity) || 0)];
      if (!stroke || stroke[3] < 0.02 || !(sw > 0.05)) stroke = null;
      let fill = el.tagName === "line" ? null : parseColour(style.fill);
      if (fill) fill = [fill[0], fill[1], fill[2], fill[3] * op * (parseFloat(style.fillOpacity) || 0)];
      if (!fill || fill[3] < 0.02) fill = null;
      const paint = style.fill.startsWith("url(") ? "server" : null;
      if (!stroke && !fill && !paint) continue;
      const g = geometry(el);
      const subs = g.subs.map((s) => s.map(([x, y]) => apply(m, x, y)));
      if (!subs.length) continue;
      const box = boxOfPoints(subs.flat());
      out.push({
        el,
        tag: el.tagName,
        idx: order.get(el),
        stroke,
        fill,
        paint,
        sw: stroke ? sw : 0,
        dash: style.strokeDasharray && style.strokeDasharray !== "none" ? "dash" : "solid",
        closed: g.closed || (!!fill && el.tagName !== "polyline") || (el.tagName === "polyline" && !!fill),
        subs,
        box,
        decor: (!!el.closest('[aria-hidden="true"], [data-decor]') && el.closest('[aria-hidden="true"], [data-decor]') !== svg) || DECOR.test(el.getAttribute("class") ?? "") || DECOR.test(el.parentElement?.getAttribute("class") ?? ""),
        clip: clipBox(el, svg),
        pe: style.pointerEvents,
        cursor: style.cursor,
      });
    }
    return out;
  }
  /** The screen box an element is clipped to by a clip-path on it or on a group around it. */
  function clipBox(el, svg) {
    for (let a = el; a && a !== svg; a = a.parentElement) {
      const cp = cs(a).clipPath;
      if (!cp || cp === "none") continue;
      const id = /url\(["']?#([^"')]+)/.exec(cp)?.[1];
      const node = id && svg.ownerDocument.getElementById(id);
      const first = node?.firstElementChild;
      const m = a.getScreenCTM();
      if (!first || !first.getBBox || !m) return null;
      const b = first.getBBox();
      return boxOfPoints([apply(m, b.x, b.y), apply(m, b.x + b.width, b.y + b.height)]);
    }
    return null;
  }
  function segHitsBox(p, q, b) {
    // Liang-Barsky.
    let t0 = 0, t1 = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] - b.l], [dx, b.r - p[0]], [-dy, p[1] - b.t], [dy, b.b - p[1]]]) {
      if (pp === 0) {
        if (qq < 0) return false;
      } else {
        const r = qq / pp;
        if (pp < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return true;
  }
  function pointInShape(sh, x, y) {
    if (x < sh.box.l || x > sh.box.r || y < sh.box.t || y > sh.box.b) return false;
    if (sh.tag === "rect") return true;
    // Even-odd over the screen polylines.
    let inside = false;
    for (const s of sh.subs) {
      for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
        const [xi, yi] = s[i];
        const [xj, yj] = s[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  // ---------------------------------------------------------------- backgrounds
  /** The colour behind an HTML element: its ancestors' backgrounds, composited. */
  function htmlBg(el, self) {
    const layers = [];
    for (let a = self ? el : el.parentElement; a; a = a.parentElement) {
      const c = parseColour(cs(a).backgroundColor);
      if (c && c[3] > 0) {
        const o = a === el ? 1 : 1;
        layers.push([c[0], c[1], c[2], c[3] * o]);
        if (c[3] >= 0.999) break;
      }
    }
    let base = matchMedia("(prefers-color-scheme: dark)").matches ? [18, 18, 18, 1] : [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  /** The colour behind a point of a drawing, below painting position `idx`. */
  function svgBg(scene, idx, x, y, skip) {
    const stack = [];
    for (let i = scene.shapes.length - 1; i >= 0; i--) {
      const sh = scene.shapes[i];
      if (sh.idx >= idx || sh === skip || !sh.fill || !sh.closed) continue;
      if (!pointInShape(sh, x, y)) continue;
      stack.push(sh.fill);
      if (sh.fill[3] >= 0.999) break;
    }
    let base = scene.bg;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }

  // ---------------------------------------------------------------- one look at the figure
  const CONTROL = 'button, input:not([type="hidden"]), select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"]), [role="button"], [role="slider"], [role="switch"], [role="tab"]';
  const NATIVE = /^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|A)$/;
  function controlsOf(root, opts = {}) {
    const out = [];
    for (const el of root.querySelectorAll(CONTROL)) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (opts.skip && el.closest(opts.skip)) continue;
      out.push(el);
    }
    return out;
  }
  A.controlsOf = controlsOf;
  function accName(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (norm(t)) return norm(t);
    }
    const al = el.getAttribute("aria-label");
    if (al && norm(al)) return norm(al);
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
      if (lab) {
        let t = "";
        const walk = (n) => {
          for (const c of n.childNodes) {
            if (c === el || (c.nodeType === 1 && /^(SELECT|INPUT|TEXTAREA)$/.test(c.tagName))) continue;
            if (c.nodeType === 3) t += c.textContent;
            else if (c.nodeType === 1) walk(c);
          }
        };
        walk(lab);
        if (norm(t)) return norm(t);
      }
      if (el.tagName === "INPUT" && /^(button|submit|reset)$/.test(el.type) && el.value) return norm(el.value);
    } else {
      let t = "";
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) t += c.textContent;
          else if (c.nodeType === 1) {
            if (c.getAttribute("aria-hidden") === "true") continue;
            if (c.tagName === "title") t += " " + c.textContent + " ";
            else if (c.getAttribute("aria-label")) t += " " + c.getAttribute("aria-label") + " ";
            else walk(c);
          }
        }
      };
      walk(el);
      if (norm(t)) return norm(t);
    }
    return norm(el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "");
  }
  A.accName = accName;
  /** The name of the group a control sits in (a row of options with its label), read out before the control's own. */
  const groupName = (el) => {
    const g = el.parentElement?.closest('[role="group"], [role="radiogroup"], [role="toolbar"], [role="tablist"], [role="row"], fieldset, tr');
    if (!g) return "";
    if (g.tagName === "FIELDSET") return norm(g.querySelector("legend")?.textContent ?? "");
    if (g.tagName === "TR" || g.getAttribute("role") === "row") return norm(g.querySelector("th, [role='rowheader']")?.textContent ?? "");
    const by = g.getAttribute("aria-labelledby");
    return norm(g.getAttribute("aria-label") ?? (by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : ""));
  };
  const inNamedGroup = (el) => /[A-Za-zÀ-ÿ]{2}/.test(groupName(el));
  const roleOf = (el) => el.getAttribute("role") || (el.tagName === "INPUT" ? "input:" + el.type : el.tagName.toLowerCase());
  /** The area a press on a control lands on: the control, with the label wrapped around it. */
  function targetBox(el) {
    let r = rectOf(el.getBoundingClientRect());
    if (/^(INPUT)$/.test(el.tagName) && /^(checkbox|radio)$/.test(el.type)) {
      const lab = el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) {
        const q = lab.getBoundingClientRect();
        r = { l: Math.min(r.l, q.left), t: Math.min(r.t, q.top), r: Math.max(r.r, q.right), b: Math.max(r.b, q.bottom) };
      }
    }
    return r;
  }

  /**
   * Looks at the root once and returns what is wrong, as items { rule, sig, detail, severity }.
   * `sig` names the offending thing without its numbers, so one label is one item however
   * many states show it.
   */
  function look(root, cfg) {
    styleMemo = new Map();
    opMemo = new Map();
    const out = [];
    const add = (rule, sig, detail, severity = "error") => out.push({ rule, sig, detail, severity });
    const rootBox = rectOf(root.getBoundingClientRect());
    // A root that scrolls inside its own box (the Larger view on a narrow window) holds all it can scroll to.
    if (/auto|scroll/.test(getComputedStyle(root).overflowX)) {
      rootBox.l -= root.scrollLeft;
      rootBox.r = rootBox.l + Math.max(root.scrollWidth, rootBox.r - rootBox.l);
    }
    if (/auto|scroll/.test(getComputedStyle(root).overflowY)) {
      rootBox.t -= root.scrollTop;
      rootBox.b = rootBox.t + Math.max(root.scrollHeight, rootBox.b - rootBox.t);
    }
    const info = { minSvgPx: Infinity, minSvgText: "", svgNames: [], marks: [], height: rootBox.b - rootBox.t };

    // ---- gather text
    const items = []; // { s, box, el, kind, px, node, svg, idx }
    const scenes = [];
    const svgs = [...root.querySelectorAll("svg")].filter((s) => !s.parentElement.closest("svg") && shown(s));
    for (const svg of svgs) {
      const order = new Map();
      let i = 0;
      for (const el of svg.querySelectorAll("*")) order.set(el, i++);
      const scene = { svg, order, shapes: [], box: rectOf(svg.getBoundingClientRect()), bg: htmlBg(svg, true), texts: [] };
      const sb = parseColour(cs(svg).backgroundColor);
      if (sb && sb[3] > 0) scene.bg = over(sb, htmlBg(svg, false));
      scene.shapes = shapesOf(svg, order);
      scene.clipped = cs(svg).overflow !== "visible";
      scenes.push(scene);
      for (const text of svg.querySelectorAll("text")) {
        if (text.closest(NOT_DRAWN) || !shown(text)) continue;
        const style = cs(text);
        const fill = parseColour(style.fill);
        if (!fill || fill[3] * (parseFloat(style.fillOpacity) || 0) < 0.03) continue;
        const m = text.getScreenCTM();
        if (!m) continue;
        const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
        let px = parseFloat(style.fontSize) * scale;
        for (const ts of text.querySelectorAll("tspan")) if (norm(ts.textContent)) px = Math.min(px, parseFloat(cs(ts).fontSize) * scale);
        for (const run of svgTextRuns(text)) {
          if (run.box.r - run.box.l < 0.5) continue;
          const it = { s: run.s, box: run.box, el: text, kind: "svg", px, svg, scene, idx: order.get(text), style };
          items.push(it);
          scene.texts.push(it);
        }
      }
    }
    // What a box that clips or scrolls lets through, for the text inside it.
    const clipMemo = new Map();
    const clipOf = (el) => {
      if (!el || el === root.parentElement) return null;
      if (clipMemo.has(el)) return clipMemo.get(el);
      let c = clipOf(el.parentElement);
      const st = cs(el);
      if (st.overflowX !== "visible" || st.overflowY !== "visible") {
        const r = el.getBoundingClientRect();
        const b = { l: st.overflowX === "visible" ? -1e6 : r.left + el.clientLeft, r: st.overflowX === "visible" ? 1e6 : r.left + el.clientLeft + el.clientWidth, t: st.overflowY === "visible" ? -1e6 : r.top + el.clientTop, b: st.overflowY === "visible" ? 1e6 : r.top + el.clientTop + el.clientHeight };
        c = c ? { l: Math.max(c.l, b.l), r: Math.min(c.r, b.r), t: Math.max(c.t, b.t), b: Math.min(c.b, b.b) } : b;
      }
      clipMemo.set(el, c);
      return c;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent;
      const a = t.search(/\S/);
      if (a < 0) continue;
      const el = n.parentElement;
      if (!el || el.closest("svg, style, script, select, option, noscript") || !shown(el)) continue;
      const style = cs(el);
      const range = document.createRange();
      range.setStart(n, a);
      range.setEnd(n, t.trimEnd().length);
      const px = parseFloat(style.fontSize);
      const k = inkOf(style, norm(t));
      for (const q of range.getClientRects()) {
        if (q.width < 0.5 || q.height < 0.5) continue;
        const h = q.height;
        const base = q.top + (Math.abs(h - (k.fasc + k.fdesc) * px) < 1.5 ? k.fasc * px : (h * k.fasc) / (k.fasc + k.fdesc));
        const box = { l: q.left, r: q.right, t: base - k.asc * px, b: base + k.desc * px };
        const clip = el === root ? null : clipOf(el);
        // Scrolled out of sight inside its own box: not on the screen now.
        if (clip && (box.r <= clip.l + 1 || box.l >= clip.r - 1 || box.b <= clip.t + 1 || box.t >= clip.b - 1)) continue;
        const seenBox = clip ? { l: Math.max(box.l, clip.l), r: Math.min(box.r, clip.r), t: Math.max(box.t, clip.t), b: Math.min(box.b, clip.b) } : box;
        items.push({ s: norm(t), box, seenBox, el, kind: "html", px, node: n, style });
      }
    }
    info.texts = items.length;

    // ---- a. text over text
    // HTML text under something that lies over it (a table's sticky header) is not seen.
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const covered = (it) => {
      if (it.kind !== "html") return false;
      if (it.covered !== undefined) return it.covered;
      const b = it.seenBox ?? it.box;
      const x = (b.l + b.r) / 2, y = (b.t + b.b) / 2;
      let c = false;
      if (x >= 0 && y >= 0 && x < vw && y < vh) {
        const top = document.elementFromPoint(x, y);
        c = !!top && top !== it.el && !top.contains(it.el) && !it.el.contains(top);
      }
      return (it.covered = c);
    };
    if (cfg.layout) {
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          if (a.node && a.node === b.node) continue;
          if (!cross(a.seenBox ?? a.box, b.seenBox ?? b.box, 1)) continue;
          if (covered(a) || covered(b)) continue;
          const pair = [sigOf(a.s), sigOf(b.s)].sort();
          const ox = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
          const oy = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
          add("layout/text-overlap", pair.join(" × "), `"${short(a.s)}" is drawn over "${short(b.s)}" (${ox.toFixed(1)} by ${oy.toFixed(1)} px)`);
        }
      }
      // ---- a. text cut by its container
      for (const it of items) {
        if (it.kind === "svg") {
          const lim = it.scene.clipped ? it.scene.box : rootBox;
          if (!inside(it.box, lim, 0.75)) add("layout/text-cut", sigOf(it.s) + " @drawing", `"${short(it.s)}" runs past the edge of its drawing`);
          else if (!inside(it.box, rootBox, 0.75)) add("layout/text-cut", sigOf(it.s) + " @figure", `"${short(it.s)}" runs out of the figure`);
          continue;
        }
        let scroller = false;
        let cut = "";
        for (let a = it.el; a && a !== root.parentElement; a = a.parentElement) {
          const s = cs(a);
          if (s.display === "inline" || s.display === "contents") continue;
          const r = a.getBoundingClientRect();
          const box = { l: r.left + a.clientLeft, t: r.top + a.clientTop, r: r.left + a.clientLeft + a.clientWidth, b: r.top + a.clientTop + a.clientHeight };
          const ox = s.overflowX, oy = s.overflowY;
          if (/auto|scroll/.test(ox) || /auto|scroll/.test(oy)) {
            scroller = true;
            break;
          }
          if ((/hidden|clip/.test(ox) && (it.box.l < box.l - 1 || it.box.r > box.r + 1)) || (/hidden|clip/.test(oy) && (it.box.t < box.t - 1 || it.box.b > box.b + 1))) {
            cut = `is clipped by ${nameOfEl(a)}`;
            break;
          }
          if (/^(TD|TH|BUTTON|SUMMARY|LABEL)$/.test(a.tagName) && !inside(it.box, rectOf(r), 1)) {
            cut = `runs out of its ${a.tagName === "TD" || a.tagName === "TH" ? "table cell" : a.tagName.toLowerCase()}`;
            break;
          }
        }
        if (cut) add("layout/text-cut", sigOf(it.s) + " @" + cut.split(" ").slice(-1)[0], `"${short(it.s)}" ${cut}`);
        else if (!scroller && (it.box.l < rootBox.l - 1 || it.box.r > rootBox.r + 1)) add("layout/text-cut", sigOf(it.s) + " @figure", `"${short(it.s)}" runs out of the figure`);
      }
      // ---- a. a line through a label
      for (const scene of scenes) {
        for (const it of scene.texts) {
          const halo = parseColour(it.style.stroke);
          const haloed = halo && halo[3] > 0.5 && /stroke/.test(it.style.paintOrder) && parseFloat(it.style.strokeWidth) > 0;
          const w = it.box.r - it.box.l, h = it.box.b - it.box.t;
          if (w < 3 || h < 3) continue;
          const cx = (it.box.l + it.box.r) / 2, cy = (it.box.t + it.box.b) / 2;
          for (const sh of scene.shapes) {
            if (!sh.stroke && !(sh.fill && sh.closed)) continue;
            if (sh.box.r < it.box.l || sh.box.l > it.box.r || sh.box.b < it.box.t || sh.box.t > it.box.b) continue;
            const grow = Math.min(sh.sw / 2, 3) - 1;
            const b = { l: it.box.l - grow, r: it.box.r + grow, t: it.box.t - grow, b: it.box.b + grow };
            if (b.r - b.l < 1 || b.b - b.t < 1) continue;
            if (sh.clip && !cross(b, sh.clip, 0)) continue;
            let hit = false;
            for (const s of sh.subs) {
              for (let i = 1; i < s.length && !hit; i++) if (segHitsBox(s[i - 1], s[i], b)) hit = true;
              if (hit) break;
            }
            if (!hit) continue;
            const edge = sh.stroke ?? sh.fill;
            const under = svgBg(scene, sh.idx, cx, cy, sh);
            // A line that hardly differs from what it lies on does not disturb reading.
            if (ratio(over(edge, under), under) < 1.3) continue;
            if (sh.idx < it.idx) {
              if (haloed) continue;
              // A plate: something opaque painted between the line and the label, under the whole label.
              const plate = scene.shapes.some((p) => p.idx > sh.idx && p.idx < it.idx && p.fill && p.fill[3] >= 0.7 && p.closed && inside(it.box, p.box, 1) && pointInShape(p, cx, cy));
              if (plate) continue;
            }
            add("layout/line-through-text", sigOf(it.s) + " | " + nameOfEl(sh.el), `${sh.stroke ? "a line" : "the edge of a shape"} (${nameOfEl(sh.el)}) passes through "${short(it.s)}"`);
            break;
          }
        }
        // ---- a. drawn off the figure
        if (scene.clipped) {
          for (const sh of scene.shapes) {
            if (sh.clip || sh.decor) continue;
            const b = sh.box;
            const lim = scene.box;
            const outside = b.r < lim.l || b.l > lim.r || b.b < lim.t || b.t > lim.b;
            const small = b.r - b.l < 40 && b.b - b.t < 40;
            const past = Math.max(lim.l - b.l, b.r - lim.r, lim.t - b.t, b.b - lim.b) - sh.sw / 2;
            if (outside || (small && past > 2) || (!small && past > 6 && sh.stroke && !sh.closed)) add("layout/off-figure", nameOfEl(sh.el), `${nameOfEl(sh.el)} is drawn ${outside ? "outside" : `${past.toFixed(0)} px past the edge of`} its drawing`);
          }
        }
      }
    }

    // ---- b. size
    for (const it of items) {
      if (it.kind === "svg") {
        if (it.px < info.minSvgPx) {
          info.minSvgPx = it.px;
          info.minSvgText = it.s;
        }
        if (cfg.minSvgPx && it.px < cfg.minSvgPx - 0.05) add("size/drawing-text", sigOf(it.s), `"${short(it.s)}" is ${it.px.toFixed(1)} px, under ${cfg.minSvgPx} px`);
      } else if (cfg.layout && it.px < 10.95) add("size/html-text", sigOf(it.s), `"${short(it.s)}" (${nameOfEl(it.el)}) is ${it.px.toFixed(1)} px, under 11 px`);
    }

    // ---- c. contrast
    if (cfg.colour) {
      for (const it of items) {
        if (it.el.closest(":disabled, [aria-disabled='true']")) continue;
        let fg, bg;
        const cx = (it.box.l + it.box.r) / 2, cy = (it.box.t + it.box.b) / 2;
        if (it.kind === "svg") {
          const f = parseColour(it.style.fill);
          if (!f) continue;
          bg = svgBg(it.scene, it.idx, cx, cy);
          fg = over([f[0], f[1], f[2], f[3] * (parseFloat(it.style.fillOpacity) || 0) * opacityOf(it.el)], bg);
        } else {
          const f = parseColour(it.style.color);
          if (!f) continue;
          bg = htmlBg(it.el, true);
          fg = over([f[0], f[1], f[2], f[3] * opacityOf(it.el)], bg);
        }
        const r = ratio(fg, bg);
        const bold = parseInt(it.style.fontWeight, 10) >= 700;
        const need = it.px >= 24 || (it.px >= 18.66 && bold) ? 3 : 4.5;
        const pair = `${hex(fg)} on ${hex(bg)}`;
        if (r < need - 0.005) add("contrast/text", pair + (need === 3 ? " large" : ""), `"${short(it.s)}" is ${pair}: ${r.toFixed(2)}:1, needs ${need}:1`);
        else if (r < (need === 3 ? 4.5 : 7) - 0.005) add("contrast/text-aaa", pair, `"${short(it.s)}" is ${pair}: ${r.toFixed(2)}:1, under the enhanced ${need === 3 ? 4.5 : 7}:1`, "warning");
      }
      // graphics
      for (const scene of scenes) {
        const marks = [];
        for (const sh of scene.shapes) {
          if (sh.decor) continue;
          const cx = (sh.box.l + sh.box.r) / 2, cy = (sh.box.t + sh.box.b) / 2;
          let under, sc = null, fc = null, rs = 0, rf = 0;
          if (sh.closed) {
            // What lies beside the shape (just outside its left and top edges), and what lies under it.
            const beneath = svgBg(scene, sh.idx, cx, cy, sh);
            const off = sh.sw / 2 + 2;
            const beside = [[sh.box.l - off, cy], [cx, sh.box.t - off], [sh.box.r + off, cy], [cx, sh.box.b + off]].filter(([x, y]) => x > scene.box.l && x < scene.box.r && y > scene.box.t && y < scene.box.b).map(([x, y]) => svgBg(scene, sh.idx, x, y, sh));
            // A frame that fills its drawing has the page beside it.
            if (!beside.length) beside.push(scene.bg);
            under = beside[0];
            if (sh.fill) {
              fc = over(sh.fill, beneath);
              rf = Math.max(...(beside.length ? beside : [beneath]).map((b) => ratio(fc, b)));
            }
            if (sh.stroke) {
              sc = over(sh.stroke, fc ?? beneath);
              rs = Math.max(ratio(sc, beneath), ...(beside.length ? beside : [beneath]).map((b) => ratio(sc, b)));
              if (fc) rs = Math.max(rs, ratio(sc, fc) >= 3 && rf < 1.15 ? ratio(sc, fc) : 0);
            }
          } else if (sh.stroke) {
            // A line shows if it stands out somewhere along its length.
            const pts = sh.subs[0];
            let best = -1;
            for (const f of [0.5, 0.25, 0.75, 0.02, 0.98]) {
              const i = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
              const t = f * (pts.length - 1) - i;
              const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
              const b = svgBg(scene, sh.idx, x, y, sh);
              const c = over(sh.stroke, b);
              const r = ratio(c, b);
              if (r > best) {
                best = r;
                under = b;
                sc = c;
              }
            }
            rs = best;
          } else continue;
          const holdsText = sh.closed && scene.texts.some((t) => t.idx > sh.idx && inside(t.box, sh.box, 2));
          sh.sc = sc;
          sh.fc = fc;
          sh.under = under;
          sh.holdsText = holdsText;
          // An area without an outline that only tints what is written on it is a plate, not a mark.
          const plate = !sc && fc && (rf < 1.15 || holdsText);
          if (!plate && Math.max(rs, rf) < 3 - 0.005 && (sc || fc)) {
            const c = rs >= rf ? sc : fc;
            add("contrast/graphic", `${nameOfEl(sh.el)} ${hex(c)} on ${hex(under)}`, `${nameOfEl(sh.el)} is ${hex(c)} on ${hex(under)}: ${Math.max(rs, rf).toFixed(2)}:1, needs 3:1 (or mark it as decoration with aria-hidden)`);
          }
          if (sc && !(sh.closed && fc && rf > rs)) marks.push({ sh, c: sc, kind: sh.closed ? "outline" : "line" });
          else if (fc) marks.push({ sh, c: fc, kind: "area" });
        }
        colourChecks(scene, marks, add);
        // For the walk: what each closed mark looks like now, to see what changes with the state.
        const si = svgs.indexOf(scene.svg);
        for (const m of marks) {
          const sh = m.sh;
          if (!sh.closed) continue;
          const b = sh.box;
          const near = scene.texts.filter((t) => t.box.r > b.l - 10 && t.box.l < b.r + 10 && t.box.b > b.t - 10 && t.box.t < b.b + 10).map((t) => t.s).join("|");
          info.marks.push({ pos: `${si}|${sh.tag}|${Math.round((b.l - scene.box.l) / 2)},${Math.round((b.t - scene.box.t) / 2)},${Math.round((b.r - b.l) / 2)},${Math.round((b.b - b.t) / 2)}`, look: `${sh.dash}|${Math.round(sh.sw)}|${m.kind}|${near}`, c: m.c, name: nameOfEl(sh.el) });
        }
      }
      // The same for HTML: a cell, a chip or a button whose fill is its state.
      for (const el of root.querySelectorAll("button, td, th, span, i, b, li, div, code, label")) {
        if (el.closest("svg") || !shown(el)) continue;
        // A control that is switched off is dimmed on purpose and says so itself (disabled).
        if (el.closest(":disabled, [aria-disabled='true']")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.width > 220 || r.height > 90) continue;
        const st = cs(el);
        const own = parseColour(st.backgroundColor);
        if (!own || own[3] < 0.02) continue;
        const c = over([own[0], own[1], own[2], own[3] * opacityOf(el)], htmlBg(el, false));
        info.marks.push({ pos: `h|${el.tagName}|${Math.round((r.left - rootBox.l) / 2)},${Math.round((r.top - rootBox.t) / 2)},${Math.round(r.width / 2)},${Math.round(r.height / 2)}`, look: `${st.borderTopStyle}|${st.borderTopWidth}|${st.fontWeight}|${st.textDecorationLine}|${norm(el.textContent)}`, c, name: nameOfEl(el) });
      }
      // control boundaries
      for (const el of controlsOf(root)) {
        if (!NATIVE.test(el.tagName) || el.tagName === "A" || el.tagName === "SUMMARY") continue;
        if (el.closest("svg")) continue;
        // A cell of a table that can be pressed: the table's grid is its boundary.
        if (/^(TD|TH)$/.test(el.parentElement?.tagName ?? "")) continue;
        const s = cs(el);
        const outside = htmlBg(el, false);
        if (el.tagName === "INPUT" && /^(range|checkbox|radio)$/.test(el.type)) {
          const ac = parseColour(s.accentColor);
          if (ac && s.accentColor !== "auto" && ratio(over(ac, outside), outside) < 3 - 0.005) add("contrast/control", `${nameOfEl(el)} accent ${hex(ac)} on ${hex(outside)}`, `the ${el.type} "${short(accName(el))}" is ${hex(ac)} on ${hex(outside)}: ${ratio(over(ac, outside), outside).toFixed(2)}:1, needs 3:1`);
          continue;
        }
        const own = parseColour(s.backgroundColor);
        const ownC = own && own[3] > 0 ? over([own[0], own[1], own[2], own[3] * opacityOf(el)], outside) : outside;
        const bw = parseFloat(s.borderTopWidth);
        const bc = bw > 0 && s.borderTopStyle !== "none" ? parseColour(s.borderTopColor) : null;
        const edge = bc && bc[3] > 0 ? over([bc[0], bc[1], bc[2], bc[3] * opacityOf(el)], outside) : null;
        const best = Math.max(edge ? ratio(edge, outside) : 0, ratio(ownC, outside));
        if (best < 3 - 0.005) add("contrast/control", `${nameOfEl(el)} ${hex(edge ?? ownC)} on ${hex(outside)}`, `the boundary of "${short(accName(el))}" (${nameOfEl(el)}) is ${hex(edge ?? ownC)} on ${hex(outside)}: ${best.toFixed(2)}:1, needs 3:1`);
      }
    }

    // ---- e. reflow, target size
    if (cfg.reflow && document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) add("reflow/page-scrolls", "", `the page scrolls sideways by ${document.documentElement.scrollWidth - document.documentElement.clientWidth} px`);
    const ctrls = cfg.targets || cfg.names ? controlsOf(root).map((el) => ({ el, box: targetBox(el), name: accName(el) })) : [];
    if (cfg.targets) {
      const smallOnes = ctrls.filter((c) => c.box.r - c.box.l < 23.5 || c.box.b - c.box.t < 23.5);
      for (const c of smallOnes) {
        const cx = (c.box.l + c.box.r) / 2, cy = (c.box.t + c.box.b) / 2;
        let clash = "";
        for (const o of ctrls) {
          if (o === c || o.el.contains(c.el) || c.el.contains(o.el)) continue;
          const small = smallOnes.includes(o);
          if (small) {
            const ox = (o.box.l + o.box.r) / 2, oy = (o.box.t + o.box.b) / 2;
            if (Math.hypot(ox - cx, oy - cy) < 23.5) clash = o.name;
          }
          const dx = Math.max(o.box.l - cx, 0, cx - o.box.r), dy = Math.max(o.box.t - cy, 0, cy - o.box.b);
          if (Math.hypot(dx, dy) < 11.75) clash = o.name;
          if (clash) break;
        }
        if (clash) add("target/too-small", `${roleOf(c.el)} ${sigOf(c.name)}`, `"${short(c.name)}" (${nameOfEl(c.el)}) is ${(c.box.r - c.box.l).toFixed(0)} by ${(c.box.b - c.box.t).toFixed(0)} px and closer than 24 px to "${short(clash)}"`);
      }
      for (const c of ctrls) {
        if (c.box.r - c.box.l < 43.5 || c.box.b - c.box.t < 43.5) add("target/under-44", `${roleOf(c.el)} ${sigOf(c.name)}`, `"${short(c.name)}" is ${(c.box.r - c.box.l).toFixed(0)} by ${(c.box.b - c.box.t).toFixed(0)} px`, "warning");
      }
      // A part that scrolls inside its own box can be reached and has a name.
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("svg") || !shown(el)) continue;
        const s = cs(el);
        if (!/auto|scroll/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
        const reach = el.tabIndex >= 0 || controlsOf(el).length > 0;
        const named = norm(el.getAttribute("aria-label") ?? "") || el.getAttribute("aria-labelledby");
        if (!reach) add("reflow/scroll-box-unreachable", nameOfEl(el), `${nameOfEl(el)} scrolls sideways but cannot be focused (tabindex="0")`);
        else if (el.tabIndex >= 0 && !named) add("reflow/scroll-box-unnamed", nameOfEl(el), `${nameOfEl(el)} scrolls sideways and is focusable but has no name (aria-label and a role)`);
      }
    }
    if (cfg.names) {
      for (const c of ctrls) {
        if (!c.name) add("name/missing", nameOfEl(c.el), `a control (${nameOfEl(c.el)}) has no accessible name`);
        else if (!/[A-Za-zÀ-ÿ]{2}/.test(c.name) && !inNamedGroup(c.el)) add("name/unclear", `${roleOf(c.el)} ${sigOf(c.name)}`, `the name "${short(c.name)}" of ${nameOfEl(c.el)} does not say what the control does`);
        const isSlider = (c.el.tagName === "INPUT" && c.el.type === "range") || c.el.getAttribute("role") === "slider";
        if (isSlider && !c.el.getAttribute("aria-valuetext")) add("name/slider-value", sigOf(c.name), `the slider "${short(c.name)}" has no aria-valuetext (the value with its unit, in words)`);
      }
      const seen = new Map();
      for (const c of ctrls) {
        if (!c.name) continue;
        const k = nameOfEl(c.el) + "|" + groupName(c.el) + "|" + c.name;
        if (seen.has(k)) add("name/duplicate", `${roleOf(c.el)} ${sigOf(c.name)}`, `two controls are both named "${short(c.name)}"`);
        seen.set(k, true);
      }
      // f. pictures
      for (const scene of scenes) {
        const svg = scene.svg;
        if (svg.closest("button, a, label, summary") || svg.closest('[aria-hidden="true"]')) {
          const r = scene.box;
          if (svg.closest('[aria-hidden="true"]') && !svg.closest("button, a, label, summary") && (r.r - r.l > 60 || r.b - r.t > 60) && scene.texts.length) add("picture/hidden", nameOfEl(svg), "a drawing with text in it is hidden from assistive technology");
          continue;
        }
        const role = svg.getAttribute("role");
        const name = norm(svg.getAttribute("aria-label") ?? "") || norm((svg.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")) || norm(svg.querySelector(":scope > title")?.textContent ?? "");
        const focusable = controlsOf(svg).length > 0 || svg.matches(CONTROL);
        const idx = svgs.indexOf(svg);
        info.svgNames.push({ idx, name, picture: hashOf(svg.innerHTML) });
        if (!name) add("picture/no-name", `svg ${idx}`, "a drawing has no accessible name (role=\"img\" and an aria-label that states what it shows now)");
        else if (name.length < 15 || /^(a |the )?(diagram|figure|image|picture|graph|chart|plot|drawing|illustration)\.?$/i.test(name)) add("picture/generic-name", `svg ${idx}`, `the drawing's name "${short(name)}" does not say what it shows`);
        if (!focusable && role !== "img" && !(role === "group" && svg.querySelector('[aria-label], title, [role="img"]'))) add("picture/no-role", `svg ${idx}`, `a drawing without controls in it needs role="img" (has ${role ? `role="${role}"` : "no role"})`);
        if (focusable && role === "img") add("picture/img-with-controls", `svg ${idx}`, 'a drawing with focusable parts must not be role="img": use role="group" and name the parts');
        if (focusable) for (const el of controlsOf(svg)) if (!accName(el)) add("name/missing", nameOfEl(el), `a focusable part of the drawing (${nameOfEl(el)}) has no accessible name`);
        // Parts that take the pointer but not the keyboard.
        if (cfg.pointer) {
          const seenCls = new Set();
          for (const el of svg.querySelectorAll("*")) {
            const cur = cs(el).cursor;
            if (!/pointer|grab|resize|move|crosshair/.test(cur)) continue;
            if (el.closest(CONTROL) || el.closest('[aria-hidden="true"]') !== null) continue;
            if (cs(el.parentElement).cursor === cur && el.parentElement !== svg.parentElement && el !== svg) continue;
            const k = nameOfEl(el);
            if (seenCls.has(k)) continue;
            seenCls.add(k);
            add("keyboard/pointer-only", k, `${k} takes the pointer (cursor: ${cur}) but cannot be focused; give it tabindex, a name and keys, or hide it from assistive technology (aria-hidden) when a labelled control does the same`);
          }
        }
      }
      // f. the sentence that reacts
      const live = [...root.querySelectorAll('[role="status"], [aria-live]')].filter(shown);
      info.live = live.length;
      for (const el of live) if (el.getAttribute("aria-live") === "assertive" || el.getAttribute("role") === "alert") add("status/assertive", nameOfEl(el), `${nameOfEl(el)} interrupts the reader (assertive); use role="status"`);
    }
    return { items: out, info };
  }
  A.look = look;

  /** Do two colours that differ for most readers fall together for a colour-blind one? Returns the kinds. */
  function confusable(a, b) {
    const out = [];
    if (deltaE(a, b) < 15) return out;
    for (const [name, m] of Object.entries(CVD)) if (deltaE(simulate(a, m), simulate(b, m)) < 8) out.push(name);
    return out;
  }
  A.confusable = confusable;
  /**
   * d. In one state: lines of the same dash pattern that differ only by colour, and (warning)
   * colours in the drawing that fall together for colour-blind readers. Marks that change
   * colour from state to state are judged over the whole walk (explore).
   */
  function colourChecks(scene, marks, add) {
    const labelled = (sh) => {
      for (const t of scene.texts) {
        const b = { l: t.box.l - 12, r: t.box.r + 12, t: t.box.t - 12, b: t.box.b + 12 };
        if (sh.box.r < b.l || sh.box.l > b.r || sh.box.b < b.t || sh.box.t > b.b) continue;
        for (const s of sh.subs) for (let i = 1; i < s.length; i++) if (segHitsBox(s[i - 1], s[i], b)) return true;
      }
      return false;
    };
    const groups = new Map();
    for (const m of marks) {
      const sh = m.sh;
      if (sh.closed || sh.subs.reduce((n, s) => n + s.length, 0) < 8) continue;
      const key = `${sh.dash} ${Math.round(sh.sw)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const list of groups.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (hex(a.c) === hex(b.c) || deltaE(a.c, b.c) < 15) continue;
          if (ratio(a.c, b.c) >= 3) continue; // light against dark: told apart without colour
          if (labelled(a.sh) && labelled(b.sh)) continue;
          const pair = [hex(a.c), hex(b.c)].sort().join(" and ");
          const cvd = confusable(a.c, b.c);
          add(cvd.length ? "cvd/confusable-marks" : "colour-only/series", `${nameOfEl(a.sh.el)} ${nameOfEl(b.sh.el)} ${pair}`, `two lines (${nameOfEl(a.sh.el)}, ${nameOfEl(b.sh.el)}) differ only by colour (${pair}, ${ratio(a.c, b.c).toFixed(2)}:1 apart${cvd.length ? `; alike with ${cvd.join(", ")}` : ""}): give one a dash pattern, or label each where it runs`);
        }
      }
    }
    const colours = new Map();
    for (const m of marks) if (chroma(m.c) >= 12) colours.set(hex(m.c), m.c);
    if (colours.size > 12) return;
    const list = [...colours.entries()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const cvd = confusable(list[i][1], list[j][1]);
        if (!cvd.length) continue;
        const pair = [list[i][0], list[j][0]].sort().join(" and ");
        add("cvd/confusable-colours", pair, `${pair} look alike with ${cvd.join(", ")}`, "warning");
      }
    }
  }

  function hashOf(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  }
  A.hashOf = hashOf;
  /** The picture and text of the root, without the heights the wrapper pins. */
  const stateOf = (root) => hashOf(root.innerHTML.replace(/min-height: [\d.]+px;?/g, "")) + ":" + Math.round(root.getBoundingClientRect().width);
  A.stateOf = stateOf;

  // ---------------------------------------------------------------- driving the controls
  const setValue = (el, v) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const key = (el, k, extra = {}) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : k, bubbles: true, cancelable: true, ...extra }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: k, code: k === " " ? "Space" : k, bubbles: true, cancelable: true, ...extra }));
  };
  /** A press, on HTML and SVG elements alike. */
  const press = (el) => (typeof el.click === "function" ? el.click() : el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })));
  const scrolls = (el) => /auto|scroll/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY) && !NATIVE.test(el.tagName);
  const kindOf = (el) => {
    if (el.tagName === "INPUT") return el.type === "range" ? "range" : el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : el.type === "number" ? "number" : "text";
    if (el.tagName === "SELECT") return "select";
    if (el.tagName === "SUMMARY") return "summary";
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab") return "button";
    if (el.tagName === "TEXTAREA" || el.tagName === "A") return "skip";
    // A box that takes the focus only so that the keyboard can scroll it.
    if (scrolls(el)) return "skip";
    return "handle";
  };
  /** A control whose job is to switch what the figure shows: the height may change with it. */
  const isMode = (el, kind) => kind === "select" || kind === "radio" || kind === "summary" || el.hasAttribute("aria-pressed") || el.getAttribute("role") === "tab" || el.hasAttribute("aria-expanded") || el.hasAttribute("aria-selected");

  /**
   * Walks the figure: as opened, every control at its ends, every option and toggle, every
   * button three times, then a seeded random walk. Looks at the figure after every step
   * whose result it has not seen before.
   */
  A.explore = async (cfg) => {
    const root = document.querySelector(cfg.root);
    const found = new Map(); // rule|sig -> { rule, sig, detail, severity, state }
    const seen = new Set();
    const stats = { states: 0, looks: 0, minSvgPx: Infinity, minSvgText: "", texts: 0 };
    const names = new Map(); // svg idx -> { names:Set, pictures:Set }
    const shared = new Set();
    const seenMarks = new Map(); // place of a closed mark -> its look without colour -> colours it has had
    const skip = cfg.skip ?? ".fig-zoom";
    let last = "as opened";
    const usable = () => controlsOf(root, { skip }).filter((el) => !/^cop(y|ied)/i.test(accName(el)) && kindOf(el) !== "skip");
    const lookNow = (state) => {
      stats.states++;
      if (cfg.reduced) {
        const moving = document.getAnimations().filter((a) => a.playState === "running" && root.contains(a.effect?.target));
        if (moving.length) put({ rule: "motion/reduced", sig: nameOfEl(moving[0].effect.target), detail: `${nameOfEl(moving[0].effect.target)} animates although reduced motion is asked for`, severity: "error" }, state);
      }
      const h = stateOf(root);
      if (seen.has(h)) return;
      seen.add(h);
      stats.looks++;
      const { items, info } = look(root, cfg);
      for (const it of items) put(it, state);
      if (info.minSvgPx < stats.minSvgPx) {
        stats.minSvgPx = info.minSvgPx;
        stats.minSvgText = info.minSvgText;
      }
      stats.texts = Math.max(stats.texts, info.texts);
      stats.live = Math.max(stats.live ?? 0, info.live ?? 0);
      // Two marks in one place at one time (a trace drawn in two colours) are not one mark changing state.
      const here = new Map();
      for (const m of info.marks) {
        const k = m.pos + "\n" + m.look;
        if (!here.has(k)) here.set(k, new Set());
        here.get(k).add(hex(m.c));
      }
      for (const m of info.marks) {
        if (here.get(m.pos + "\n" + m.look).size > 1) {
          shared.add(m.pos);
          continue;
        }
        if (!seenMarks.has(m.pos)) seenMarks.set(m.pos, new Map());
        const looks = seenMarks.get(m.pos);
        if (!looks.has(m.look)) looks.set(m.look, new Map());
        const h = hex(m.c);
        if (!looks.get(m.look).has(h)) looks.get(m.look).set(h, { c: m.c, name: m.name, state });
      }
      for (const n of info.svgNames) {
        if (!names.has(n.idx)) names.set(n.idx, { names: new Set(), pictures: new Set() });
        names.get(n.idx).names.add(n.name);
        names.get(n.idx).pictures.add(n.picture);
      }
    };
    const put = (it, state) => {
      const k = it.rule + "|" + it.sig;
      if (!found.has(k)) found.set(k, { ...it, state });
    };
    const heightOf = () => Math.round(root.getBoundingClientRect().height);
    /** One action on a control, then a look. */
    const act = async (el, what, fn) => {
      const kind = kindOf(el);
      const name = accName(el) || nameOfEl(el);
      const mode = isMode(el, kind);
      const before = heightOf();
      const wasOpen = [...root.querySelectorAll("details")].filter((d) => d.open).length;
      try {
        fn();
      } catch (e) {
        put({ rule: "figure/throws", sig: sigOf(name), detail: `${what} "${short(name)}" threw ${String(e).slice(0, 80)}`, severity: "error" }, last);
      }
      await settle();
      const state = `${what} "${short(name)}"`;
      last = state;
      const after = heightOf();
      const nowOpen = [...root.querySelectorAll("details")].filter((d) => d.open).length;
      if (cfg.height && !mode && nowOpen === wasOpen) {
        if (after < before - 1) put({ rule: "layout/height-jump", sig: `${kind} ${sigOf(name)}`, detail: `the figure gets shorter (${before} to ${after} px) on ${state}: what is below it jumps up`, severity: "error" }, state);
        else if (after > before + 1) put({ rule: "layout/height-grows", sig: `${kind} ${sigOf(name)}`, detail: `the figure grows from ${before} to ${after} px on ${state}, which is not a mode switch`, severity: "warning" }, state);
      }
      lookNow(state);
    };
    await settle();
    lookNow("as opened");

    // Every control, in turn. The list is read again each time: controls come and go.
    const budget = cfg.systematic ?? 400;
    for (let i = 0; i < 400 && stats.states < budget; i++) {
      let el = usable()[i];
      if (!el) break;
      const kind = kindOf(el);
      const again = () => usable()[i];
      if (kind === "range" || kind === "number") {
        const min = el.min === "" ? null : +el.min, max = el.max === "" ? null : +el.max;
        if (min === null || max === null) continue;
        const was = el.value;
        await act(el, "minimum of", () => setValue(el, min));
        if ((el = again()) && kindOf(el) === kind) await act(el, "maximum of", () => setValue(el, max));
        if ((el = again()) && kindOf(el) === kind) await act(el, "restoring", () => setValue(el, was));
      } else if (kind === "select") {
        const was = el.value;
        const n = el.options.length;
        for (let o = 0; o < n; o++) {
          el = again();
          if (!el || kindOf(el) !== "select" || !el.options[o] || el.options[o].disabled) break;
          const v = el.options[o].value;
          await act(el, `option ${o + 1} of`, () => setValue(el, v));
        }
        if ((el = again()) && kindOf(el) === "select") await act(el, "restoring", () => setValue(el, was));
      } else if (kind === "checkbox") {
        await act(el, "ticking", () => press(el));
        if ((el = again()) && kindOf(el) === "checkbox") await act(el, "unticking", () => press(el));
      } else if (kind === "radio" || kind === "summary") {
        if (kind === "summary" && el.parentElement.open) continue;
        await act(el, kind === "summary" ? "opening" : "choosing", () => press(el));
      } else if (kind === "button") {
        for (let p = 0; p < 3; p++) {
          el = again();
          if (!el || kindOf(el) !== "button") break;
          await act(el, `press ${p + 1} of`, () => press(el));
        }
      } else if (kind === "handle") {
        for (const k of ["ArrowRight", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Enter", " ", "Home", "End"]) {
          el = again();
          if (!el || kindOf(el) !== "handle") break;
          el.focus();
          await act(el, `key ${k === " " ? "Space" : k} on`, () => key(el, k));
        }
      }
    }
    // The random walk.
    let seed = cfg.seed ?? 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let s = 0; s < (cfg.walk ?? 60); s++) {
      const els = usable();
      if (!els.length) break;
      const el = els[Math.floor(rnd() * els.length)];
      const kind = kindOf(el);
      const q = rnd();
      if (kind === "range" || kind === "number") {
        if (el.min === "" || el.max === "") continue;
        const step = +el.step || 1;
        const v = +el.min + Math.round(((+el.max - +el.min) * q) / step) * step;
        await act(el, `walk: ${+v.toFixed(6)} on`, () => setValue(el, Math.min(+el.max, +v.toFixed(6))));
      } else if (kind === "select") {
        const o = el.options[Math.floor(q * el.options.length)];
        if (o && !o.disabled) await act(el, `walk: "${short(o.textContent)}" in`, () => setValue(el, o.value));
      } else if (kind === "handle") {
        const k = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter", " "][Math.floor(q * 6)];
        el.focus();
        await act(el, `walk: key ${k === " " ? "Space" : k} on`, () => key(el, k));
      } else if (kind !== "text") await act(el, "walk: press", () => press(el));
    }
    // d. A mark that changes colour with the state and nothing else: not its outline, its dash, or a label on or beside it.
    if (cfg.colour) {
      for (const [pos, looks] of seenMarks) {
        if (shared.has(pos)) continue;
        for (const cols of looks.values()) {
          const list = [...cols.values()];
          if (list.length < 2 || list.length > 6) continue; // more than a few colours in one place is a scale (an image, a heat map)
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const a = list[i], b = list[j];
              if (deltaE(a.c, b.c) < 15 || ratio(a.c, b.c) >= 3) continue;
              const pair = [hex(a.c), hex(b.c)].sort().join(" and ");
              const cvd = confusable(a.c, b.c);
              const names2 = [...new Set([a.name, b.name])].join(" / ");
              put({ rule: cvd.length ? "cvd/confusable-marks" : "colour-only/state", sig: `${names2} ${pair}`, severity: "error", detail: `${names2} changes state by colour alone (${pair}, ${ratio(a.c, b.c).toFixed(2)}:1 apart${cvd.length ? `; alike with ${cvd.join(", ")}` : ""}): change its outline, dash or shape as well, or write the state on it` }, `${a.state} and ${b.state}`);
            }
          }
        }
      }
    }
    // f. a picture's name follows what it shows
    if (cfg.names) {
      for (const [idx, n] of names) {
        if (n.pictures.size >= 3 && n.names.size === 1 && [...n.names][0]) found.set(`picture/static-name|svg ${idx}`, { rule: "picture/static-name", sig: `svg ${idx}`, severity: "error", state: "over the whole walk", detail: `the drawing changed ${n.pictures.size - 1} times but its accessible name stayed "${short([...n.names][0])}"` });
      }
      if (!stats.live && usable().length) found.set("status/missing|", { rule: "status/missing", sig: "", severity: "error", state: "as opened", detail: 'the figure has controls but no sentence that reacts (role="status")' });
    }
    return { found: [...found.values()], stats };
  };

  /** f. Dragging a slider must not send one announcement per step. */
  A.flood = async (rootSel) => {
    const root = document.querySelector(rootSel);
    const el = controlsOf(root).find((e) => e.tagName === "INPUT" && e.type === "range");
    const live = [...root.querySelectorAll('[role="status"], [aria-live]')].filter(shown);
    if (!el || !live.length) return null;
    const was = el.value;
    const min = +el.min, max = +el.max, step = +el.step || 1;
    let changes = 0, quiet = 0;
    const text = () => live.map((l) => l.textContent).join("|");
    let prev = text();
    for (let i = 0; i < 12; i++) {
      const v = min + Math.round(((max - min) * (i + 1)) / 13 / step) * step;
      const input = controlsOf(root).find((e) => e.tagName === "INPUT" && e.type === "range");
      if (!input) break;
      setValue(input, +v.toFixed(6));
      await sleep(0);
      const now = text();
      if (now !== prev) {
        changes++;
        if (live.every((l) => l.getAttribute("aria-busy") === "true" || l.closest('[aria-busy="true"]'))) quiet++;
      }
      prev = now;
    }
    await sleep(900);
    const stuck = live.some((l) => l.getAttribute("aria-busy") === "true" || l.closest('[aria-busy="true"]'));
    const again = controlsOf(root).find((e) => e.tagName === "INPUT" && e.type === "range");
    if (again) setValue(again, was);
    await sleep(700);
    return { changes, quiet, stuck };
  };

  /** g. Does the root change by itself? Looks `times` times, `gap` ms apart. */
  A.moving = async (rootSel, times = 4, gap = 120) => {
    const root = document.querySelector(rootSel);
    let h = root.innerHTML;
    let changed = 0;
    for (let i = 0; i < times; i++) {
      await sleep(gap);
      const n = root.innerHTML;
      if (n !== h) changed++;
      h = n;
    }
    const anims = document.getAnimations().filter((a) => a.playState === "running" && root.contains(a.effect?.target)).length;
    return { changed, anims };
  };

  /** e. What the focused element shows, for the keyboard walk. */
  A.focusInfo = (rootSel) => {
    styleMemo = new Map();
    opMemo = new Map();
    const root = document.querySelector(rootSel);
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    const s = getComputedStyle(el);
    const inRoot = root.contains(el);
    const svg = el.closest("svg");
    const outside = svg && svg !== el ? htmlBg(svg, true) : htmlBg(el, false);
    let ring = null;
    const candidates = [el, ...el.querySelectorAll("*")].slice(0, 60);
    let visible = false, best = 0, colour = "";
    for (const c of candidates) {
      const q = c === el ? s : getComputedStyle(c);
      if (q.outlineStyle !== "none" && parseFloat(q.outlineWidth) >= 1) {
        const oc = parseColour(q.outlineColor);
        if (oc && oc[3] > 0) {
          visible = true;
          const r = ratio(over(oc, outside), outside);
          if (r > best) {
            best = r;
            colour = hex(over(oc, outside));
          }
        }
      }
      if (c !== el && c instanceof SVGElement && c.closest("svg") && /focus|cursor/.test(c.getAttribute("class") ?? "") && q.display !== "none") {
        const oc = parseColour(q.stroke);
        if (oc && oc[3] > 0) {
          visible = true;
          const r = ratio(over(oc, outside), outside);
          if (r > best) {
            best = r;
            colour = hex(over(oc, outside));
          }
        }
      }
    }
    if (!visible && s.boxShadow && s.boxShadow !== "none") {
      const oc = parseColour(/rgba?\([^)]*\)|#[0-9a-f]+/i.exec(s.boxShadow)?.[0]);
      if (oc) {
        visible = true;
        best = ratio(over(oc, outside), outside);
        colour = hex(over(oc, outside));
      }
    }
    ring = { visible, ratio: best, colour, on: hex(outside) };
    return { inRoot, id: el.getAttribute("data-a11y-n"), tag: nameOfEl(el), name: accName(el), focusVisible: el.matches(":focus-visible"), handle: kindOf(el) === "handle", ring, sentinel: el.id?.startsWith("a11y-sentinel") ? el.id : "", native: NATIVE.test(el.tagName) };
  };
  A.mark = (rootSel, skip) => {
    const root = document.querySelector(rootSel);
    const list = controlsOf(root, { skip });
    list.forEach((el, i) => el.setAttribute("data-a11y-n", String(i)));
    // One stop per radio group is what Tab gives.
    return list.map((el, i) => ({ n: String(i), name: accName(el), tag: nameOfEl(el), radio: el.tagName === "INPUT" && el.type === "radio" ? el.name || "radio" : "", native: NATIVE.test(el.tagName), tabindex: el.getAttribute("tabindex") }));
  };
}
