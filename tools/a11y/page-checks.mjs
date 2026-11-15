// The checks that run inside the page. `installChecks` is sent to the browser as text
// (context.addInitScript), so it may not use anything outside its own body.
//
// Everything hangs off window.__a11y. Each function returns plain data; screens.mjs turns
// it into findings. Interactive figures (.figure) are skipped by the geometry checks: they
// are checked one by one in figures.mjs.

export function installChecks() {
  if (window.__a11y) return;
  const A = (window.__a11y = {});

  // ---------- small helpers ----------
  const cs = (el) => getComputedStyle(el);
  const inFigure = (el) => !!el.closest?.(".figure");
  /** A short description of an element for a finding's detail (never part of a key). */
  const describe = (el) => {
    if (!el || !el.tagName) return "?";
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
    const first = cls.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const text = (el.getAttribute?.("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return el.tagName.toLowerCase() + (first ? "." + first : "") + (text ? ` "${text}"` : "");
  };
  A.describe = describe;
  /** The part of the interface an element belongs to: shared chrome is counted once, not once per level. */
  const region = (el) => {
    if (!el?.closest) return "";
    if (el.closest(".figure")) return "figure";
    // One component used on every screen: counted once.
    if (el.closest(".btn.primary")) return "component:primary-button";
    if (el.closest(".bit")) return "component:register-bit";
    if (el.closest(".topbar, .skip")) return "chrome:topbar";
    if (el.closest(".level-head")) return "chrome:level-head";
    if (el.closest(".level-tabs")) return "chrome:level-tabs";
    if (el.closest(".toolbar, .editor-wrap, .problems")) return "chrome:editor";
    const panel = el.closest("[data-panel]");
    if (panel) return "panel:" + panel.getAttribute("data-panel");
    return "";
  };
  A.region = region;

  /** Not drawn: display none, visibility hidden, clipped away (.sr-only), no size, transparent, or in a closed <details>. */
  const hidden = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = cs(a);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return true;
      if (+s.opacity === 0) return true;
      if (s.position === "absolute" && (s.clip !== "auto" || s.clipPath !== "none")) return true;
      if (s.display !== "contents" && s.display !== "inline" && !(a instanceof SVGElement && a.tagName !== "svg")) {
        const r = a.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return true;
      }
      const d = a.parentElement?.closest("details:not([open])");
      if (d && a.tagName !== "SUMMARY" && !a.closest("summary")) return true;
    }
    return false;
  };
  A.hidden = hidden;
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  /** The boxes of an element's own visible characters, one per line. */
  const inkRects = (el) => {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const t = n.textContent;
      const a = t.search(/\S/);
      if (a < 0) continue;
      const range = document.createRange();
      range.setStart(n, a);
      range.setEnd(n, t.trimEnd().length);
      for (const q of range.getClientRects()) if (q.width > 0.5 && q.height > 0.5) out.push(q);
    }
    return out;
  };
  const union = (rects) => {
    if (!rects.length) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const q of rects) {
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  };
  const scrollsX = (s) => s.overflowX === "auto" || s.overflowX === "scroll";
  const scrollsY = (s) => s.overflowY === "auto" || s.overflowY === "scroll";
  const clipsX = (s) => s.overflowX === "hidden" || s.overflowX === "clip";
  const clipsY = (s) => s.overflowY === "hidden" || s.overflowY === "clip";

  // ---------- colour ----------
  const parseColor = (str) => {
    if (!str || str === "transparent" || str === "none") return [0, 0, 0, 0];
    let m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = str.match(/^color\(srgb\s+([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[/\s]+/).filter(Boolean).map(parseFloat);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    return null;
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** The colour behind an element's content: its background and its ancestors', composited. null when a picture is involved. */
  const backdrop = (el) => {
    const layers = [];
    for (let a = el; a; a = a.parentElement) {
      const s = cs(a);
      const img = s.backgroundImage;
      if (img && img !== "none") {
        const g = img.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/);
        if (!img.includes("gradient") || !g) return null;
        const c = parseColor(g[0]);
        if (c) layers.push(c);
      }
      const c = parseColor(s.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let out = [255, 255, 255, 1];
    for (const c of layers.reverse()) out = over(c, out);
    return out;
  };
  A.color = { parseColor, over, contrast, backdrop };

  /** A change that changed something: React writes some attributes again with the value they had. */
  const real = (m) => (m.type === "attributes" ? m.target.getAttribute(m.attributeName) !== m.oldValue : m.type === "characterData" ? m.target.data !== m.oldValue : true);
  /** The records of one batch that left something different. An attribute cleared and set back (React does this to the name of a radio button) is no change. */
  const realOnes = (list) => {
    const first = new Map();
    const out = [];
    for (const m of list) {
      if (m.type !== "attributes") {
        if (real(m)) out.push(m);
        continue;
      }
      let per = first.get(m.target);
      if (!per) first.set(m.target, (per = new Map()));
      if (!per.has(m.attributeName)) per.set(m.attributeName, m);
    }
    for (const per of first.values()) for (const m of per.values()) if (real(m)) out.push(m);
    return out;
  };

  // ---------- settle: the app's idle state ----------
  /**
   * Resolves when the fonts are loaded, the page has not changed for `quiet` frames, and nothing that
   * ends is still moving (a fade of something the last action brought in, a change of screen): a check
   * made halfway through a fade would measure half-transparent text. An animation without end does
   * not hold it up; `motion()` reports that one. `idle` is false if the page never came to rest.
   */
  A.settle = (quiet = 3, maxFrames = 90) =>
    new Promise((resolve) => {
      let changed = true;
      let still = 0;
      let frames = 0;
      const mo = new MutationObserver((list) => {
        if (realOnes(list).length) changed = true;
      });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, characterDataOldValue: true });
      const fading = () =>
        document.getAnimations().some((a) => (a.playState === "running" || a.playState === "pending") && (a.effect?.getComputedTiming?.().iterations ?? 1) !== Infinity);
      const tick = () => {
        frames++;
        still = changed || fading() ? 0 : still + 1;
        changed = false;
        if (still >= quiet || frames >= maxFrames) {
          mo.disconnect();
          resolve({ idle: still >= quiet, frames });
        } else requestAnimationFrame(tick);
      };
      (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(tick));
    });

  // ---------- layout: reflow (1.4.10), clipping and overlap ----------
  /**
   * Ported from the class material's check_html.py (REFLOW_JS), for an app whose panes scroll:
   *  pageScroll  a pane that scrolls the page's content up and down also scrolls sideways
   *  offScreen   visible text outside the window that no box can scroll to
   *  spills      text running out of its own box
   *  clipped     text cut off by a box that hides what does not fit (truncated: with an ellipsis or a line clamp, on purpose)
   *  overlaps    text drawn over other text
   *  scrollers   boxes that scroll sideways and cannot be reached or have no name
   */
  const layoutScan = () => {
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    const res = { pageScroll: [], offScreen: [], spills: [], clipped: [], truncated: [], overlaps: [], scrollers: [] };
    if (document.documentElement.scrollWidth - W > 1) res.pageScroll.push(document.documentElement);
    const all = [...document.body.querySelectorAll("*")];
    const style = new Map();
    const st = (el) => {
      let s = style.get(el);
      if (!s) style.set(el, (s = cs(el)));
      return s;
    };
    // Boxes that scroll.
    for (const el of all) {
      // The code editor never wraps: it scrolls in its own box, which has a name and takes the focus.
      if (inFigure(el) || el.closest(".cm-editor")) continue;
      const s = st(el);
      if (!scrollsX(s) || el.scrollWidth - el.clientWidth <= 1 || hidden(el)) continue;
      const r = el.getBoundingClientRect();
      // (overflow-x: auto alone makes overflow-y compute to auto: a pane is a box that really scrolls up and down.)
      const pane = scrollsY(s) && el.scrollHeight > el.clientHeight + 1 && r.height >= H * 0.5;
      if (pane) {
        // Name what sticks out furthest.
        const edge = r.left + el.clientLeft + el.clientWidth;
        let worst = null, far = edge + 1;
        for (const d of el.querySelectorAll("*")) {
          if (d.children.length > 6) continue;
          const q = d.getBoundingClientRect();
          if (!(q.width > 0 && q.right > far) || hidden(d)) continue;
          // Not what a box in between already scrolls or cuts off.
          let inner = false;
          for (let a = d.parentElement; a && a !== el; a = a.parentElement) if (st(a).overflowX !== "visible") inner = true;
          if (!inner) { far = q.right; worst = d; }
        }
        // A figure that is too wide is the figure's finding (figures.mjs), not the level's.
        if (worst && inFigure(worst)) continue;
        res.pageScroll.push({ el, why: worst ? `${describe(worst)} reaches ${Math.round(far - edge)} px past the edge` : `${el.scrollWidth - el.clientWidth} px too wide` });
      }
      else {
        const reachable = el.tabIndex >= 0 || !!el.querySelector("a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex='-1'])");
        const named = !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) || el.tagName === "TEXTAREA" || el.tagName === "INPUT";
        const role = el.getAttribute("role") || ["PRE", "TEXTAREA", "INPUT", "TABLE", "SECTION", "NAV"].includes(el.tagName);
        if (!reachable) res.scrollers.push({ el, why: "cannot be reached with the keyboard" });
        else if (el.tabIndex >= 0 && !(named && role)) res.scrollers.push({ el, why: "has no name (aria-label and a role)" });
      }
    }
    const texts = [];
    for (const el of all) {
      const tag = el.tagName;
      const media = tag === "IMG" || tag === "svg" || tag === "CANVAS" || tag === "VIDEO";
      if (!media && !ownText(el)) continue;
      if (inFigure(el) || el.closest(".cm-editor")) continue;
      if (media && el.closest("svg") !== el && tag === "svg") continue;
      if (hidden(el)) continue;
      const rects = media ? [el.getBoundingClientRect()] : inkRects(el);
      const r = union(rects);
      if (!r) continue;
      // What can scroll this into view, and what cuts it off.
      let scrollX = false;
      let clip = null;
      let fixedOff = false;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = st(a);
        if (scrollsX(s)) { scrollX = true; break; }
        if (!clip && (clipsX(s) || clipsY(s)) && !(a instanceof SVGElement)) clip = a;
        if (s.position === "absolute" || s.position === "fixed") fixedOff = true;
      }
      const s = st(el);
      // Entirely outside the window and positioned there: hidden on purpose (the skip link until it has the focus).
      if ((r.right <= 0 || r.left >= W) && (fixedOff || s.position === "absolute" || s.position === "fixed")) continue;
      if ((r.right > W + 1 || r.left < -1) && !scrollX) res.offScreen.push(el);
      if (!media && s.overflowX === "visible" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && s.display !== "inline" && !scrollX && !(el instanceof SVGElement)) res.spills.push(el);
      // Cut off by its own box or by an ancestor that hides overflow.
      if (!media && !(el instanceof SVGElement)) {
        const self = (clipsX(s) && el.scrollWidth > el.clientWidth + 1) || (clipsY(s) && el.scrollHeight > el.clientHeight + 1);
        let cut = self ? el : null;
        if (!cut && clip && !scrollX) {
          const c = clip.getBoundingClientRect();
          const cst = st(clip);
          if ((clipsX(cst) && (r.right > c.right + 1.5 || r.left < c.left - 1.5)) || (clipsY(cst) && !scrollsY(cst) && (r.bottom > c.bottom + 1.5 || r.top < c.top - 1.5))) {
            // A box that scrolls up and down between the two shows the rest by scrolling.
            let between = false;
            for (let a = el.parentElement; a && a !== clip; a = a.parentElement) if (scrollsY(st(a))) between = true;
            if (!between) cut = clip;
          }
        }
        if (cut) {
          const cst = st(cut);
          const onPurpose = st(el).textOverflow === "ellipsis" || cst.textOverflow === "ellipsis" || (cst.webkitLineClamp && cst.webkitLineClamp !== "none");
          (onPurpose ? res.truncated : res.clipped).push(el);
        }
      }
      if (!media) {
        // Only what is drawn: each line cut to the boxes that clip or scroll it.
        let cl = 0, ct = 0, cr = W, cb = H;
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
          const as = st(a);
          if (as.overflowX === "visible" && as.overflowY === "visible") continue;
          if (a instanceof SVGElement) continue;
          const c = a.getBoundingClientRect();
          if (as.overflowX !== "visible") { cl = Math.max(cl, c.left); cr = Math.min(cr, c.right); }
          if (as.overflowY !== "visible") { ct = Math.max(ct, c.top); cb = Math.min(cb, c.bottom); }
        }
        for (const q of rects) {
          const l = Math.max(q.left, cl), t = Math.max(q.top, ct), rr = Math.min(q.right, cr), b = Math.min(q.bottom, cb);
          if (rr - l > 1 && b - t > 1) texts.push({ el, l, t, r: rr, b });
        }
      }
    }
    // Text over text: two visible runs of characters sharing more than a quarter of the smaller one.
    texts.sort((a, b) => a.t - b.t);
    const seen = new Set();
    const opaqueUpTo = (el, stop) => {
      for (let a = el; a && a !== stop; a = a.parentElement) {
        const s = st(a);
        const c = parseColor(s.backgroundColor);
        if ((c && c[3] >= 0.95) || (s.backgroundImage && s.backgroundImage !== "none")) return true;
      }
      return false;
    };
    for (let i = 0; i < texts.length; i++) {
      const a = texts[i];
      for (let j = i + 1; j < texts.length && texts[j].t < a.b; j++) {
        const b = texts[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w <= 1 || h <= 1) continue;
        const small = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
        if (w * h < 0.25 * small) continue;
        // One covering the other with a solid background (a sticky heading over a list) is not an overlap.
        let common = a.el.parentElement;
        while (common && !common.contains(b.el)) common = common.parentElement;
        if (opaqueUpTo(a.el, common) || opaqueUpTo(b.el, common)) continue;
        const top = document.elementFromPoint(Math.max(a.l, b.l) + w / 2, Math.max(a.t, b.t) + h / 2);
        if (top && !(a.el.contains(top) || top.contains(a.el) || b.el.contains(top) || top.contains(b.el))) continue;
        const key = a.el;
        if (!seen.has(key)) {
          seen.add(key);
          res.overlaps.push(a.el);
        }
      }
    }
    return res;
  };
  const pack = (res) => {
    const out = {};
    for (const [k, list] of Object.entries(res)) {
      const byRegion = {};
      for (const item of list) {
        const el = item.el ?? item;
        const rg = region(el);
        if (rg === "figure") continue;
        const g = (byRegion[rg] ??= { count: 0, sample: [] });
        g.count++;
        if (g.sample.length < 3) g.sample.push(describe(el) + (item.why ? `: ${item.why}` : ""));
      }
      out[k] = byRegion;
    }
    return out;
  };
  A.layout = () => pack(layoutScan());

  /**
   * Text spacing (1.4.12): line height 1.5, paragraph spacing 2em, letter spacing 0.12em and
   * word spacing 0.16em forced on everything. Reports what is cut off or overlapping only with them.
   */
  A.spacing = async () => {
    const before = layoutScan();
    const had = new Set([...before.clipped, ...before.truncated, ...before.overlaps, ...before.spills, ...before.offScreen, ...before.pageScroll.map((x) => x.el ?? x)]);
    const style = document.createElement("style");
    style.textContent =
      "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
    document.head.appendChild(style);
    await A.settle(2, 30);
    const after = layoutScan();
    style.remove();
    await A.settle(2, 30);
    const fresh = {};
    for (const k of ["clipped", "truncated", "overlaps", "spills", "offScreen", "pageScroll"]) fresh[k] = after[k].filter((x) => !had.has(x.el ?? x));
    return pack(fresh);
  };

  // ---------- names and structure ----------
  const BAD_CODE = /[  -​ ‘’‚“”„–—…−‐‑﻿]/g;
  const accName = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (t) return t;
    }
    return (el.getAttribute("aria-label") || "").trim() || (el.tagName === "svg" ? el.querySelector(":scope > title")?.textContent?.trim() ?? "" : "") || (el.getAttribute("title") || "").trim();
  };
  A.structure = () => {
    const out = { title: document.title, lang: document.documentElement.lang, h1: 0, headingSkips: [], mains: document.querySelectorAll("main, [role=main]").length, navs: document.querySelectorAll("nav, [role=navigation]").length, graphics: {}, codeChars: {}, targets: {} };
    let prev = 0;
    for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")) {
      // Headings read out but not drawn (.sr-only) are part of the outline.
      if (inFigure(h) || h.closest("[hidden], [aria-hidden='true']") || cs(h).display === "none" || cs(h).visibility === "hidden") continue;
      const level = h.getAttribute("role") === "heading" ? +(h.getAttribute("aria-level") || 2) : +h.tagName[1];
      if (level === 1) out.h1++;
      if (prev && level > prev + 1) out.headingSkips.push(`h${prev} then h${level} ${describe(h)}`);
      prev = level;
    }
    const add = (bucket, el, note) => {
      const rg = region(el);
      const g = (bucket[rg] ??= { count: 0, sample: [] });
      g.count++;
      if (g.sample.length < 3) g.sample.push(describe(el) + (note ? `: ${note}` : ""));
    };
    // Pictures: named, or hidden as decoration.
    for (const el of document.querySelectorAll("svg, canvas, img")) {
      if (inFigure(el) || hidden(el)) continue;
      if (el.tagName === "svg" && el.parentElement?.closest("svg")) continue;
      if (el.closest("[aria-hidden='true']")) continue;
      const role = el.getAttribute("role");
      if (role === "presentation" || role === "none") continue;
      if (el.tagName === "IMG" && el.hasAttribute("alt")) continue;
      if (accName(el)) continue;
      // Inside something that carries the name (a button, a labelled picture): the drawing itself should then be hidden.
      const holder = el.closest("[role=img][aria-label], button, a, summary, label");
      add(out.graphics, el, holder ? "inside a named control but not hidden (aria-hidden)" : "no text alternative");
    }
    // Code that must paste unchanged.
    for (const el of document.querySelectorAll("pre, code, .cm-content, .code-block")) {
      if (el.parentElement?.closest("pre, code, .code-block")) continue;
      const bad = el.textContent.match(BAD_CODE);
      if (bad) add(out.codeChars, el, [...new Set(bad)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" "));
    }
    // Pointer targets under 44 by 44 CSS px (2.5.5, AAA). A link inside a sentence is exempt, as in the criterion.
    const seen = new Set();
    for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=slider], [role=separator][tabindex], [role=checkbox], [role=radio], [role=switch]")) {
      if (inFigure(el) || el.disabled || hidden(el)) continue;
      const s = cs(el);
      if (s.pointerEvents === "none") continue;
      if ((el.tagName === "A" || el.classList.contains("linkish")) && s.display.startsWith("inline") && el.parentElement && ownText(el.parentElement)) continue;
      let r = el.getBoundingClientRect();
      // Parked outside the window until it has the focus (the skip link).
      if (r.right <= 0 || r.left >= innerWidth) continue;
      const label = el.tagName === "INPUT" ? el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) : null;
      if (label && (el.type === "checkbox" || el.type === "radio")) {
        if (seen.has(label)) continue;
        seen.add(label);
        r = label.getBoundingClientRect();
      }
      if (r.width < 43.5 || r.height < 43.5) add(out.targets, el, `${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  };

  // ---------- colour alone (1.4.1) ----------
  /**
   * Finds things of one kind (siblings with the same tag) that differ in state (a class, an ARIA
   * state) and look different only by colour: same shape, same icon, same border, same weight.
   */
  A.colourOnly = () => {
    const COLOUR = ["color", "backgroundColor", "borderTopColor", "borderLeftColor", "borderBottomColor", "fill", "stroke", "outlineColor", "textDecorationColor"];
    const SHAPE = ["borderTopStyle", "borderLeftStyle", "borderBottomStyle", "borderTopWidth", "borderLeftWidth", "borderBottomWidth", "fontWeight", "fontStyle", "textDecorationLine", "transform", "borderTopLeftRadius", "opacity", "strokeDasharray", "strokeWidth", "outlineStyle", "textTransform"];
    const STATE_ATTRS = ["aria-pressed", "aria-current", "aria-selected", "aria-checked", "aria-expanded", "aria-invalid", "data-wrong", "data-state", "disabled"];
    const sigOf = (root) => {
      const state = [], colour = [], shape = [];
      let texts = "";
      const visit = (el, depth) => {
        const s = cs(el);
        if (s.display === "none") return;
        const cls = (typeof el.className === "string" ? el.className : el.className?.baseVal ?? "").trim().split(/\s+/).filter(Boolean).sort().join(".");
        state.push(cls + STATE_ATTRS.map((a) => (el.hasAttribute(a) ? `[${a}=${el.getAttribute(a)}]` : "")).join(""));
        const bg = parseColor(s.backgroundColor);
        colour.push(COLOUR.map((p) => s[p]).join("|") + "|" + s.boxShadow.replace(/[\d.]+px|inset/g, "").trim());
        shape.push(
          el.tagName + "|" + SHAPE.map((p) => s[p]).join("|") + "|" + (bg && bg[3] > 0 ? "filled" : "clear") + "|" + (s.backgroundImage === "none" ? "" : "img") + "|" +
            s.boxShadow.replace(/rgba?\([^)]+\)|color\([^)]+\)/g, "c") + "|" + (el.tagName === "path" ? el.getAttribute("d") : "") + (el.tagName === "use" ? el.getAttribute("href") : "") +
            "|" + ((s.fill === "none") + "" + (s.stroke === "none")),
        );
        for (const pseudo of ["::before", "::after"]) {
          const p = getComputedStyle(el, pseudo);
          if (p.content && p.content !== "none" && p.content !== "normal") {
            colour.push(pseudo + p.color + p.backgroundColor);
            const pb = parseColor(p.backgroundColor);
            shape.push(pseudo + p.content + "|" + p.top + "|" + p.bottom + "|" + p.left + "|" + p.width + "|" + p.height + "|" + p.transform + "|" + (pb && pb[3] > 0 ? "filled" : "clear") + p.borderTopStyle);
          }
        }
        for (const n of el.childNodes) if (n.nodeType === 3) texts += n.textContent.trim() + " ";
        if (depth < 4) for (const c of el.children) visit(c, depth + 1);
      };
      visit(root, 0);
      return { state: state.join("/"), colour: colour.join("/"), shape: shape.join("/"), text: texts.trim() };
    };
    const groups = new Map();
    for (const el of document.body.querySelectorAll("button, li, td, th, tr, span, i, b, p, a, div, label, g, circle, rect, summary, dt, dd")) {
      // Syntax colours repeat what the characters already say.
      if (inFigure(el) || el.closest(".cm-editor, pre, code")) continue;
      const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
      // Decoration carries no state: hidden from assistive technology, or the grid and guide lines of a drawing (docs/VISUALS.md).
      if (el.closest("[aria-hidden='true'], [data-decor]")) continue;
      const classed = [el, ...el.querySelectorAll("[class]")].filter((e) => e.getAttribute("class"));
      if (classed.length && classed.every((e) => /-(grid|guide|glow|ghost)\b/.test(e.getAttribute("class")))) continue;
      const stateful = cls || STATE_ATTRS.some((a) => el.hasAttribute(a));
      if (!stateful && !el.querySelector("[class]")) continue;
      const parent = el.parentElement;
      if (!parent) continue;
      // Same kind: same tag and same first class, under parents of the same kind (rows of one table, buttons of one row of groups).
      const key = [parent.parentElement?.tagName, parent.tagName, (typeof parent.className === "string" ? parent.className : "").split(/\s+/)[0], el.tagName, cls.trim().split(/\s+/)[0]].join(">");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { root: parent.parentElement ?? parent, items: [] }));
      if (g.root === (parent.parentElement ?? parent)) g.items.push(el);
    }
    const found = {};
    for (const g of groups.values()) {
      if (g.items.length < 2 || g.items.length > 400) continue;
      const byState = new Map();
      for (const el of g.items) {
        if (hidden(el)) continue;
        const sig = sigOf(el);
        let b = byState.get(sig.state);
        const words = new Set(sig.text.split(/\s+/).filter(Boolean));
        if (!b) byState.set(sig.state, (b = { el, sig, texts: new Set(), common: words }));
        else b.common = new Set([...b.common].filter((w) => words.has(w)));
        b.texts.add(sig.text);
      }
      const states = [...byState.values()];
      const reported = new Set();
      for (let i = 0; i < states.length; i++)
        for (let j = i + 1; j < states.length; j++) {
          const a = states[i], b = states[j];
          if (a.sig.colour === b.sig.colour || a.sig.shape !== b.sig.shape) continue;
          // Words that go with the state ("Passed" on every passed item) are a second cue.
          // (a word or sign that every item in one state has and the other state lacks: "Correct.", a tick, 1 and 0).
          if ([...a.common].some((w) => !b.common.has(w)) || [...b.common].some((w) => !a.common.has(w))) continue;
          if (reported.has(a.el) && reported.has(b.el)) continue;
          reported.add(a.el).add(b.el);
          const rg = region(a.el);
          const f = (found[rg] ??= { count: 0, sample: [] });
          f.count++;
          if (f.sample.length < 3) f.sample.push(`${describe(a.el)} and ${describe(b.el)}` + (window.__a11yDebug ? ` :: ${a.el.outerHTML.slice(0, 500)} :: ${b.el.outerHTML.slice(0, 500)}` : ""));
        }
    }
    return found;
  };

  // ---------- motion (2.2.2, 2.3.1, 2.3.3) ----------
  A.motion = () => {
    const out = [];
    for (const a of document.getAnimations()) {
      if (a.playState !== "running" && a.playState !== "pending") continue;
      const t = a.effect?.getComputedTiming?.() ?? {};
      const el = a.effect?.target;
      out.push({
        el: describe(el),
        region: region(el),
        figure: !!el && inFigure(el),
        name: a.animationName || a.transitionProperty || "animation",
        duration: +t.duration || 0,
        endless: t.iterations === Infinity,
        // More than three flashes a second.
        flashing: t.iterations >= 3 && +t.duration > 0 && +t.duration < 333,
      });
    }
    return out;
  };
  /** Counts what changes on its own during `frames` animation frames. */
  A.watchStill = (frames = 30) =>
    new Promise((resolve) => {
      const changed = new Map();
      const mo = new MutationObserver((list) => {
        for (const m of realOnes(list)) {
          const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          if (!el || inFigure(el) || el.closest(".cm-editor")) continue;
          changed.set(el, (changed.get(el) ?? 0) + 1);
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, characterDataOldValue: true });
      let n = 0;
      const tick = () => {
        if (++n < frames) return requestAnimationFrame(tick);
        mo.disconnect();
        resolve([...changed.keys()].slice(0, 5).map(describe));
      };
      requestAnimationFrame(tick);
    });

  // ---------- status messages (4.1.3) ----------
  let watch = null;
  const LIVE = "[role=status], [role=alert], [role=log], [aria-live]:not([aria-live=off])";
  A.watchStart = () => {
    const roots = new Set();
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "childList") for (const n of m.addedNodes) roots.add(n.nodeType === 1 ? n : n.parentElement);
        else if (m.type === "characterData") roots.add(m.target.parentElement);
        else roots.add(m.target);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "open"] });
    watch = { mo, roots, focus: document.activeElement };
  };
  A.watchEnd = () => {
    if (!watch) return null;
    const { mo, roots, focus } = watch;
    for (const m of mo.takeRecords()) if (m.type === "childList") for (const n of m.addedNodes) roots.add(n.nodeType === 1 ? n : n.parentElement);
    mo.disconnect();
    watch = null;
    const active = document.activeElement;
    let live = 0;
    const quiet = [];
    for (const el of roots) {
      if (!el || !el.isConnected) continue;
      if ([...roots].some((o) => o !== el && o?.contains?.(el))) continue;
      const text = (el.innerText ?? el.textContent ?? "").trim();
      if (!text) continue;
      const region = el.closest(LIVE) ?? el.querySelector(LIVE);
      if (region && region.textContent.trim()) {
        live++;
        continue;
      }
      if (inFigure(el) || el.closest(".cm-editor") || hidden(el)) continue;
      if (active && active !== document.body && (el.contains(active) || active.contains(el))) continue;
      quiet.push(describe(el));
    }
    const focusMoved = active !== focus && active && active !== document.body;
    return { live, quiet: quiet.slice(0, 6), quietCount: quiet.length, focusMoved, focusOn: describe(active) };
  };

  // ---------- keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 1.4.11) ----------
  const FOCUSABLE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=true], audio[controls], video[controls]";
  const FOCUS_PROPS = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow", "borderTopColor", "borderBottomColor", "backgroundColor", "stroke", "strokeWidth", "textDecorationLine", "display"];
  const focusSig = (el) => {
    const s = cs(el);
    const o = {};
    for (const p of FOCUS_PROPS) o[p] = s[p];
    return o;
  };
  const around = (el) => {
    const list = [el];
    for (let a = el.parentElement, i = 0; a && i < 3 && a !== document.body; a = a.parentElement, i++) list.push(a);
    const kids = el.querySelectorAll("*");
    for (let i = 0; i < kids.length && i < 30; i++) list.push(kids[i]);
    return list;
  };
  let kb = null;
  A.kbInit = () => {
    kb = { base: new Map(), expected: new Set(), reached: new Set(), order: [], prev: null, first: null };
    // Nothing has the focus while the unfocused look of everything is recorded.
    document.activeElement?.blur?.();
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      if (el.disabled || hidden(el)) continue;
      if (el.closest("[inert]")) continue;
      kb.expected.add(el);
      for (const e of around(el)) if (!kb.base.has(e)) kb.base.set(e, focusSig(e));
    }
    // Start at the top of the page.
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
    const had = document.body.getAttribute("tabindex");
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    if (had === null) document.body.removeAttribute("tabindex");
    else document.body.setAttribute("tabindex", had);
    return kb.expected.size;
  };
  const indicatorOf = (el) => {
    const group = around(el);
    let best = null;
    const consider = (kind, ink, against, e) => {
      let ratio = null;
      if (ink && against) ratio = contrast(over(ink, against), against);
      if (!best || (ratio ?? 0) > (best.ratio ?? 0)) best = { kind, ratio, on: describe(e) };
    };
    for (const e of group) {
      const now = focusSig(e);
      const was = kb.base.get(e);
      const outlined = now.outlineStyle !== "none" && parseFloat(now.outlineWidth) > 0;
      if (outlined && (!was || was.outlineStyle === "none" || was.outlineColor !== now.outlineColor || was.outlineWidth !== now.outlineWidth)) {
        const inside = parseFloat(now.outlineOffset) < 0;
        const bg = inside ? backdrop(e) : e.parentElement ? backdrop(e.parentElement) : null;
        consider("outline", parseColor(now.outlineColor), bg, e);
        // Drawn outside the box: the box's own colour is next to it too when the box is filled.
        continue;
      }
      if (!was) continue;
      // A mark that is only drawn while the thing has the focus (a ring inside a picture).
      if (was.display === "none" && now.display !== "none") {
        const svg = e.closest("svg");
        const ink = parseColor(now.stroke) ?? parseColor(cs(e).fill);
        consider("mark", ink && ink[3] > 0 ? ink : null, svg ? backdrop(svg) : e.parentElement ? backdrop(e.parentElement) : null, e);
        continue;
      }
      if (now.boxShadow !== was.boxShadow && now.boxShadow !== "none") {
        const c = now.boxShadow.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/);
        const inset = now.boxShadow.includes("inset");
        consider("box-shadow", c ? parseColor(c[0]) : null, inset ? backdrop(e) : e.parentElement ? backdrop(e.parentElement) : null, e);
      } else if (now.stroke !== was.stroke || now.strokeWidth !== was.strokeWidth) {
        const svg = e.closest("svg");
        consider("stroke", parseColor(now.stroke), svg ? backdrop(svg) : null, e);
      } else if (now.borderTopColor !== was.borderTopColor || now.borderBottomColor !== was.borderBottomColor) {
        consider("border", parseColor(now.borderBottomColor), e.parentElement ? backdrop(e.parentElement) : null, e);
      } else if (now.backgroundColor !== was.backgroundColor) {
        const under = e.parentElement ? backdrop(e.parentElement) : [255, 255, 255, 1];
        const a = parseColor(now.backgroundColor), b = parseColor(was.backgroundColor);
        if (a && b && under) {
          const ratio = contrast(over(a, under), over(b, under));
          if (!best || ratio > (best.ratio ?? 0)) best = { kind: "background", ratio, on: describe(e) };
        }
      } else if (now.textDecorationLine !== was.textDecorationLine) {
        if (!best) best = { kind: "underline", ratio: null, on: describe(e) };
      }
    }
    return best;
  };
  /** Called after each Tab: what has the focus now, and what is wrong with it. */
  A.kbStop = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { end: "body" };
    const index = kb.order.indexOf(el);
    const info = { desc: describe(el), region: region(el), figure: inFigure(el), editor: !!el.closest(".cm-editor"), repeat: index >= 0, same: el === kb.prev, n: kb.order.length };
    if (index >= 0) {
      info.loop = index === 0;
      return info;
    }
    kb.order.push(el);
    kb.reached.add(el);
    const full = el.getBoundingClientRect();
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    // The part of it that the boxes around it let through (a long editor shows a window of itself).
    let cl = -Infinity, ct = -Infinity, cr = Infinity, cb = Infinity;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const as = cs(a);
      if ((as.overflowX === "visible" && as.overflowY === "visible") || a instanceof SVGElement) continue;
      const c = a.getBoundingClientRect();
      if (as.overflowX !== "visible") { cl = Math.max(cl, c.left); cr = Math.min(cr, c.right); }
      if (as.overflowY !== "visible") { ct = Math.max(ct, c.top); cb = Math.min(cb, c.bottom); }
    }
    const r = { left: Math.max(full.left, cl), top: Math.max(full.top, ct), right: Math.min(full.right, cr), bottom: Math.min(full.bottom, cb) };
    r.width = r.right - r.left;
    r.height = r.bottom - r.top;
    // Visible focus.
    const ind = indicatorOf(el);
    info.indicator = ind;
    // In view, and not behind something else (a sticky bar).
    const sr = el.closest(".sr-only") || (full.width <= 1 && full.height <= 1);
    if (!sr) {
      if (r.width <= 1 || r.height <= 1 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) info.offscreen = true;
      else {
        const pts = [0.5, 0.15, 0.85].flatMap((fx) => [0.5, 0.2, 0.8].map((fy) => [r.left + r.width * fx, r.top + r.height * fy]));
        let seenAny = false, inView = 0;
        let cover = null;
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          inView++;
          const top = document.elementFromPoint(x, y);
          if (top && (el.contains(top) || top.contains(el) || top.closest("label")?.contains(el) || (el.id && top.closest(`label[for="${CSS.escape(el.id)}"]`)))) seenAny = true;
          else if (top) cover = top;
        }
        if (inView && !seenAny) info.obscured = describe(cover);
      }
    } else info.invisible = true;
    // Order: the document's order, and not upwards within a column.
    if (kb.prev && kb.prev.isConnected) {
      if (kb.prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) info.domBack = describe(kb.prev);
      else {
        const p = kb.prev.getBoundingClientRect();
        const r = full;
        const w = Math.min(p.right, r.right) - Math.max(p.left, r.left);
        if (w > 0.5 * Math.min(p.width, r.width) && r.bottom < p.top - 4 && p.height > 0 && r.height > 0) {
          // Moving from one box that scrolls to another is not out of order: each has its own top.
          const sc = (e) => {
            for (let a = e.parentElement; a; a = a.parentElement) if (scrollsY(cs(a))) return a;
            return null;
          };
          if (sc(kb.prev) === sc(el) && cs(el).position !== "sticky") info.visualBack = describe(kb.prev);
        }
      }
    }
    if (el.tabIndex > 0) info.positiveTabindex = true;
    kb.prev = el;
    return info;
  };
  A.kbPrev = () => {
    kb.prev = document.activeElement;
  };
  /** After the walk: what could be operated but was never reached. */
  A.kbEnd = () => {
    const missed = {};
    for (const el of kb.expected) {
      if (kb.reached.has(el) || !el.isConnected || inFigure(el) || el.disabled || hidden(el)) continue;
      if (el.tagName === "INPUT" && el.type === "radio" && el.name && [...kb.reached].some((o) => o.tagName === "INPUT" && o.type === "radio" && o.name === el.name && o.form === el.form)) continue;
      const ti = el.getAttribute("tabindex");
      if (ti !== null && +ti < 0) {
        // Not a Tab stop on purpose: a heading or pane that takes the focus by script, or one of a group that the arrow keys move along.
        const interactive = el.matches("button, a[href], input, select, textarea, [role=button], [role=tab], [role=option], [role=radio], [role=menuitem]");
        if (!interactive) continue;
        const group = el.closest("[role=tablist], [role=radiogroup], [role=toolbar], [role=listbox], [role=menu], [role=group], [role=grid], ul, ol, nav") ?? el.parentElement;
        if (group && [...kb.reached].some((o) => group.contains(o))) continue;
        // One of several groups that share one Tab stop (the chapter tiles of all parts of the map).
        const kind = (e) => e.tagName + "." + (typeof e.className === "string" ? e.className.trim().split(/\s+/)[0] : "");
        if ([...kb.reached].some((o) => kind(o) === kind(el))) continue;
        // A whole part of the page reached another way (the file input behind its button).
        if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      }
      const rg = region(el);
      const g = (missed[rg] ??= { count: 0, sample: [] });
      g.count++;
      if (g.sample.length < 4) g.sample.push(describe(el));
    }
    const n = kb.order.length;
    kb = null;
    return { missed, stops: n };
  };

  // ---------- axe ----------
  /** Runs axe on the page without the figures, and groups each rule's elements by the part of the interface they are in. */
  A.axe = async (options) => {
    const context = document.querySelector(".figure") ? { exclude: [[".figure"]] } : document;
    const res = await window.axe.run(context, { ...options, resultTypes: ["violations"], elementRef: true });
    const out = [];
    for (const v of res.violations) {
      const byRegion = {};
      for (const n of v.nodes) {
        const el = n.element;
        const rg = el ? region(el) : "";
        const g = (byRegion[rg] ??= { count: 0, sample: [] });
        g.count++;
        if (g.sample.length < 2) {
          const data = [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].find((c) => c.data && (c.data.contrastRatio || c.data.minSize));
          g.sample.push(describe(el) + (data?.data?.contrastRatio ? ` ${data.data.contrastRatio}:1 (${data.data.fgColor} on ${data.data.bgColor})` : ""));
        }
      }
      out.push({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, byRegion });
    }
    return out;
  };
}
