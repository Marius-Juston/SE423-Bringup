// What the figure checks and the bench-view checks share on the Node side: the worker pool,
// the keyboard walk, axe-core on one part of the page, and the turning of the probe's items
// into findings.
import { finding } from "./findings.mjs";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function pool(tasks, jobs, run) {
  let next = 0;
  const out = new Array(tasks.length);
  await Promise.all(
    Array.from({ length: Math.min(jobs, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await run(tasks[i], i);
      }
    }),
  );
  return out;
}

/** Waits until the game's own fonts are in use: nothing may be measured in a fallback font. */
export async function fontsReady(page) {
  await page.evaluate(async () => {
    const cs = getComputedStyle(document.body);
    for (const w of ["400", "700"]) for (const f of ["--mono", "--sans"]) await document.fonts.load(`${w} 10px ${cs.getPropertyValue(f).split(",")[0]}`, "MAr0x").catch(() => {});
    await document.fonts.ready;
  });
}

/** Turns the probe's items into findings: one per rule, counting the distinct offending things. */
export function toFindings(where, cond, items) {
  const byRule = new Map();
  for (const it of items) {
    if (!byRule.has(it.rule)) byRule.set(it.rule, []);
    byRule.get(it.rule).push(it);
  }
  const out = [];
  for (const [rule, list] of byRule) {
    const severity = list.some((i) => i.severity === "error") ? "error" : "warning";
    const sample = list.slice(0, 3).map((i) => i.detail + (i.state ? ` [${i.state}]` : "")).join("; ");
    out.push(finding({ where, rule, state: cond, severity, count: list.reduce((n, i) => n + (i.count ?? 1), 0), detail: sample + (list.length > 3 ? `; and ${list.length - 3} more` : "") }));
  }
  return out;
}

export async function addSentinels(page, ROOT) {
  await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    for (const pos of ["before", "after"]) {
      if (document.getElementById(`a11y-sentinel-${pos}`)) continue;
      const b = document.createElement("button");
      b.id = `a11y-sentinel-${pos}`;
      b.textContent = pos;
      b.style.cssText = "position:fixed;left:0;width:60px;height:24px;z-index:1;" + (pos === "before" ? "top:0" : "bottom:0");
      root.parentElement.insertBefore(b, pos === "before" ? root : root.nextSibling);
    }
  }, ROOT);
}

/** e. Tab through the figure: everything is reached, shows where the focus is, and works by keys. */
export async function keyboardWalk(page, items, state, ROOT) {
  const list = await page.evaluate((sel) => window.__a11y.mark(sel), ROOT);
  await page.evaluate(() => document.getElementById("a11y-sentinel-before").focus());
  const reached = new Set();
  for (let i = 0; i < list.length + 8; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate((sel) => window.__a11y.focusInfo(sel), ROOT);
    if (f.none || f.sentinel === "a11y-sentinel-after") break;
    if (!f.inRoot) continue;
    const label = f.name || f.tag;
    if (f.id === null) {
      // Focusable, visible to Tab, but not something the probe counts as a control: still needs a ring.
    } else reached.add(f.id);
    if (!f.ring.visible) items.push({ rule: "focus/invisible", sig: f.tag, detail: `nothing shows that "${label}" (${f.tag}) has the keyboard focus`, severity: "error", state });
    else if (f.ring.ratio < 3 - 0.005) items.push({ rule: "focus/contrast", sig: `${f.ring.colour} on ${f.ring.on}`, detail: `the focus ring of "${label}" is ${f.ring.colour} on ${f.ring.on}: ${f.ring.ratio.toFixed(2)}:1, needs 3:1`, severity: "error", state });
    if (!f.native && f.id !== null && f.handle) {
      // A part of a drawing that takes the focus must do something with the keys.
      const before = await page.evaluate((sel) => window.__a11y.stateOf(document.querySelector(sel)), ROOT);
      let works = false;
      for (const k of ["ArrowRight", "ArrowUp", "Enter", "Space", "ArrowLeft", "ArrowDown"]) {
        await page.keyboard.press(k);
        const now = await page.evaluate((sel) => window.__a11y.stateOf(document.querySelector(sel)), ROOT);
        if (now !== before) {
          works = true;
          break;
        }
      }
      if (!works) items.push({ rule: "keyboard/inoperable", sig: f.tag, detail: `"${label}" (${f.tag}) takes the focus but the arrow keys, Enter and Space do nothing`, severity: "error", state });
      // The keys may have moved the focus or redrawn the list: go on from this element if it is still there.
      await page.evaluate((n) => document.querySelector(`[data-a11y-n="${n}"]`)?.focus(), f.id);
    }
  }
  const radios = new Set();
  const still = await page.evaluate(
    (sel) => {
      const root = document.querySelector(sel);
      return [...root.querySelectorAll("[data-a11y-n]")].map((el) => ({
        n: el.getAttribute("data-a11y-n"),
        roving: el.getAttribute("tabindex") === "-1" && !!el.closest('[role="radiogroup"], [role="tablist"], [role="toolbar"], [role="grid"], [role="listbox"], [role="group"]'),
        checkedRadio: el.tagName === "INPUT" && el.type === "radio",
      }));
    },
    ROOT,
  );
  const info = new Map(still.map((s) => [s.n, s]));
  for (const c of list) if (c.radio && reached.has(c.n)) radios.add(c.radio);
  for (const c of list) {
    if (reached.has(c.n) || !info.has(c.n)) continue;
    if (c.radio && radios.has(c.radio)) continue;
    if (info.get(c.n).roving) continue;
    // One of a set that the arrow keys move through (a roving tabindex): another of the set was reached.
    if (c.tabindex === "-1" && list.some((o) => o.tag.split(".").slice(0, 2).join(".") === c.tag.split(".").slice(0, 2).join(".") && reached.has(o.n))) continue;
    items.push({ rule: "keyboard/unreachable", sig: c.tag + " " + c.name.replace(/\d+/g, "#"), detail: `Tab never reaches "${c.name || c.tag}" (${c.tag})`, severity: "error", state });
  }
}

export async function runAxe(page, axe, items, state, ROOT) {
  if (!axe) return;
  await page.evaluate(axe.source);
  const res = await page.evaluate(
    async ([sel, tags]) => {
      const r = await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: [...tags, "best-practice"] }, rules: { region: { enabled: false }, "landmark-one-main": { enabled: false }, "page-has-heading-one": { enabled: false } }, resultTypes: ["violations"] });
      return r.violations.map((v) => ({ id: v.id, help: v.help, tags: v.tags, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((x) => x.target.join(" ")).join(" ; "), why: (v.nodes[0]?.any?.[0]?.message ?? v.nodes[0]?.all?.[0]?.message ?? "").slice(0, 160) }));
    },
    [ROOT, AXE_TAGS],
  );
  for (const v of res) {
    const wcag = v.tags.some((t) => AXE_TAGS.includes(t));
    for (let i = 0; i < v.n; i++) items.push({ rule: `axe/${v.id}`, sig: `${state} ${i}`, detail: i === 0 ? `${v.help} (${v.sample})${v.why ? ": " + v.why : ""}` : "", severity: wcag ? "error" : "warning", state: i === 0 ? state : "" });
  }
}

