// Accessibility findings: one shape for every checker, the ratchet baseline and SARIF.
//
// A finding:
//   {
//     key: string       stable: "<where>|<rule>|<scheme or state>"; never a line number or a random id
//     rule: string      for example "axe/color-contrast", "reflow/page-scrolls", "keyboard/no-focus-ring"
//     where: string     a screen ("map", "handbook", "settings", "sandbox"), a level id or a figure id
//     severity: "error" | "warning"
//     count: number     how many elements (or pairs) have the problem in that place and state
//     detail: string    what is wrong and where to look, in one or two sentences
//   }
//
// The ratchet: a11y-baseline.json at the repository root records the accepted count per key.
// A run fails when a key is not in the baseline or its count went up. Counts may only go down:
// `npm run a11y -- --update-baseline` lowers them after a fix and never raises them.
//
// This file depends on nothing but Node, so every checker can import it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BASELINE_PATH = resolve(REPO, "a11y-baseline.json");

/**
 * @typedef {{ key: string, rule: string, where: string, severity: "error" | "warning",
 *             count: number, detail: string }} Finding
 * @typedef {{ about?: string, accepted: Record<string, number>, reasons?: Record<string, string> }} Baseline
 */

/** The stable key of a finding. `state` is the colour scheme, the width or the page state. */
export function keyOf(where, rule, state = "") {
  return `${where}|${rule}|${state}`;
}

/**
 * Build a finding. `state` only goes into the key.
 * @returns {Finding}
 */
export function finding({ where, rule, state = "", severity = "error", count = 1, detail = "" }) {
  return { key: keyOf(where, rule, state), rule, where, severity, count, detail };
}

/**
 * Combine findings that share a key. `how` says what a repeated key means:
 * "max" (the same place seen more than once: keep the worst count) or "sum".
 * @param {Finding[]} findings
 * @returns {Finding[]}
 */
export function merge(findings, how = "max") {
  const out = new Map();
  for (const f of findings) {
    const seen = out.get(f.key);
    if (!seen) out.set(f.key, { ...f });
    else {
      seen.count = how === "sum" ? seen.count + f.count : Math.max(seen.count, f.count);
      if (f.severity === "error") seen.severity = "error";
      if (!seen.detail) seen.detail = f.detail;
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** @returns {Baseline} */
export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return { accepted: {}, reasons: {} };
  const data = JSON.parse(readFileSync(path, "utf8"));
  return { ...data, accepted: data.accepted ?? {}, reasons: data.reasons ?? {} };
}

/** The accepted count of a key. Accepts a whole baseline or its `accepted` map. */
function acceptedMap(baseline) {
  if (!baseline) return {};
  return baseline.accepted && typeof baseline.accepted === "object" ? baseline.accepted : baseline;
}

/**
 * Compare a run with the baseline.
 * `scope(key)` limits "improved" to the keys the run could have produced, so a partial run
 * (`--only tokens`) does not report the rest of the baseline as fixed.
 * @param {Finding[]} findings
 * @param {Baseline | Record<string, number>} baseline
 * @param {(key: string) => boolean} [scope]
 * @returns {{ regressions: Finding[], improved: string[] }}
 *   regressions: findings that are new or whose count went up (errors and warnings).
 *   improved: baseline keys that are gone or whose count went down.
 */
export function compare(findings, baseline, scope = () => true) {
  const accepted = acceptedMap(baseline);
  const current = new Map(merge(findings).map((f) => [f.key, f]));
  const regressions = [...current.values()].filter((f) => f.count > (accepted[f.key] ?? 0));
  const improved = Object.keys(accepted).filter((k) => {
    if (!scope(k)) return false;
    const now = current.get(k);
    return !now || now.count < accepted[k];
  });
  return { regressions, improved: improved.sort() };
}

/**
 * The baseline after a run: counts go down to what is current and never up, unless
 * `acceptNew` (a deliberate decision: give each new key a reason). Only warnings can be
 * accepted: an error stays a failure until it is fixed.
 * @returns {Baseline}
 */
export function updatedBaseline(findings, baseline, { scope = () => true, acceptNew = false } = {}) {
  const accepted = acceptedMap(baseline);
  const reasons = baseline?.reasons ?? {};
  const merged = merge(findings);
  const current = new Map(merged.map((f) => [f.key, f.count]));
  // Errors are never accepted: the baseline holds warnings only, each with a reason.
  const isError = new Set(merged.filter((f) => f.severity === "error").map((f) => f.key));
  const out = {};
  for (const [k, n] of Object.entries(accepted)) {
    if (!scope(k)) out[k] = n;
    else if (current.has(k) && !isError.has(k)) out[k] = acceptNew ? current.get(k) : Math.min(n, current.get(k));
  }
  if (acceptNew) for (const [k, n] of current) if (!(k in out) && !isError.has(k)) out[k] = n;
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  const keptReasons = Object.fromEntries(
    Object.entries(reasons).filter(([pattern]) => Object.keys(sorted).some((k) => reasonMatches(pattern, k))),
  );
  return {
    about:
      "Accepted accessibility backlog (tools/a11y, docs/ACCESSIBILITY.md). Counts may only go down: " +
      "fix the problem, then run `npm run a11y -- --update-baseline`. `reasons` says why each " +
      "accepted warning stays; a reason's key is a finding key or a rule name.",
    accepted: sorted,
    reasons: keptReasons,
  };
}

/** A reason is filed under a full key, or under a rule (it then covers every key of that rule). */
export function reasonMatches(pattern, key) {
  return pattern === key || key.split("|")[1] === pattern;
}

export function reasonFor(baseline, key) {
  const reasons = baseline?.reasons ?? {};
  if (reasons[key]) return reasons[key];
  const rule = key.split("|")[1];
  return reasons[rule] ?? "";
}

export function saveBaseline(baseline, path = BASELINE_PATH) {
  writeFileSync(path, JSON.stringify(baseline, null, 1) + "\n");
}

export function writeFindings(findings, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merge(findings), null, 1) + "\n");
}

/** The source file a finding most likely belongs to, for the SARIF location. */
function sourceOf(f) {
  if (f.rule.startsWith("tokens/")) return "src/ui/styles.css";
  if (f.where.startsWith("figure:")) {
    const file = `src/ui/figures/${f.where.slice(7)}.tsx`;
    return existsSync(resolve(REPO, file)) ? file : "src/ui/figures/index.tsx";
  }
  const screens = { map: "src/ui/MapView.tsx", handbook: "src/ui/Handbook.tsx", settings: "src/ui/Settings.tsx", sandbox: "src/ui/Sandbox.tsx" };
  const screen = f.where.split(":")[0];
  if (screens[screen]) return screens[screen];
  if (existsSync(resolve(REPO, `src/ui/figures/${f.where}.tsx`))) return `src/ui/figures/${f.where}.tsx`;
  return "src/ui/LevelView.tsx";
}

/**
 * SARIF 2.1.0 for GitHub code scanning. Each result is fingerprinted by its stable key, so an
 * alert is tracked across commits the way the baseline tracks it. A finding the baseline
 * already accepts is reported as a note.
 * @param {Finding[]} findings
 * @param {Baseline | Record<string, number>} [baseline]
 */
export function toSarif(findings, baseline = {}) {
  const accepted = acceptedMap(baseline);
  const rules = new Map();
  const results = [];
  for (const f of merge(findings)) {
    if (!rules.has(f.rule)) {
      rules.set(f.rule, {
        id: f.rule,
        name: f.rule.replace(/[^A-Za-z0-9]+/g, "-"),
        shortDescription: { text: f.rule },
        properties: { tags: ["accessibility", f.rule.split("/")[0]] },
      });
    }
    const isAccepted = f.count <= (accepted[f.key] ?? 0);
    const state = f.key.split("|").slice(2).join("|");
    results.push({
      ruleId: f.rule,
      level: isAccepted ? "note" : f.severity,
      message: { text: `${f.where}${state ? ` (${state})` : ""}: ${f.detail}${f.count > 1 ? ` x${f.count}` : ""}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: sourceOf(f), uriBaseId: "%SRCROOT%" },
            region: { startLine: 1 },
          },
        },
      ],
      partialFingerprints: { "a11yKey/v1": createHash("sha256").update(f.key).digest("hex") },
    });
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "bringup-a11y",
            informationUri: "https://github.com/Marius-Juston/SE423-Bringup/tree/main/tools/a11y",
            rules: [...rules.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
          },
        },
        results,
      },
    ],
  };
}

/** A short report for the terminal and the CI job summary. */
export function summaryMarkdown(findings, regressions, improved) {
  const all = merge(findings);
  const lines = ["## Accessibility", ""];
  if (regressions.length) {
    lines.push(`**${regressions.length} finding(s) not in the baseline:**`, "");
    for (const f of regressions.slice(0, 200)) lines.push(`- \`${f.key}\` (${f.severity}, x${f.count}): ${f.detail}`);
    if (regressions.length > 200) lines.push(`- and ${regressions.length - 200} more (see findings.json)`);
    lines.push("");
  } else lines.push("Nothing new: every finding is in the baseline.", "");
  const byRule = new Map();
  for (const f of all) {
    const r = byRule.get(f.rule) ?? { errors: 0, warnings: 0, places: 0 };
    r[f.severity === "error" ? "errors" : "warnings"] += f.count;
    r.places += 1;
    byRule.set(f.rule, r);
  }
  if (byRule.size) {
    lines.push("| Rule | Errors | Warnings | Places |", "|---|---:|---:|---:|");
    for (const [rule, r] of [...byRule].sort()) lines.push(`| ${rule} | ${r.errors} | ${r.warnings} | ${r.places} |`);
    lines.push("");
  }
  if (improved.length) {
    lines.push(`${improved.length} baseline item(s) improved. Run \`npm run a11y -- --update-baseline\` and commit \`a11y-baseline.json\`.`, "");
  }
  return lines.join("\n");
}
