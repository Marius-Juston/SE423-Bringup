---
name: fix-a11y-finding
description: Fix a finding of the Bringup game's accessibility suite (npm run a11y), or decide what to do with a new warning. Use when the suite or the Accessibility check on a pull request fails, when adding a screen, level kind, figure or bench view, or when asked about a11y-baseline.json.
---

# Fix an accessibility finding

Read `docs/ACCESSIBILITY.md` ("A finding", "The baseline", "What is checked").

1. **Read the finding.** `a11y-out/summary.md` lists what is not in the baseline. The key is `<where>|<rule>|<scheme or state>`: `where` is a screen, a level id, `figure:<id>` or `view:<id>`; the last part is the colour scheme and window (`dark@320`, `light@1440+xl`). The detail names the element, the measured value and the page state.
2. **Reproduce only that.** `npm run a11y -- --level <id>`, `--only screens`, or `node tools/a11y/figures.mjs --only <figure id> --warnings`. Open the same state yourself (`node tools/shot.mjs ...`, both themes, the stated width) and look at it.
3. **Fix the cause, in the app.** Contrast: use the right token, never a literal colour (`src/ui/styles.css` header says what each token promises; `tests/a11y_tokens.test.ts` holds it). Text overlap or text cut at a narrow width: restructure (shorter labels with a key, two rows, labels outside), do not shrink text under 11 px (drawings: 9 px at 380 px). Colour alone: add a shape, a dash, an icon or a word. Keyboard: a real button or input with a name, visible focus, in reading order. A box that scrolls: `ScrollBox`. Motion: only after the student acted, and none with reduced motion.
4. **Do not make the suite pass by other means.** Never add an entry or raise a count in `a11y-baseline.json` by hand. Never loosen a check, add a selector to an exclusion list, or mark content `aria-hidden` to hide it from the check, unless it truly is decoration (then use the documented decoration classes in `docs/VISUALS.md`). An error can never be accepted.
5. **A warning beyond level AA** (7:1 contrast, 44 px target, a palette pair that looks alike without full colour vision) that cannot be fixed without a design decision: accept it with `npm run a11y -- --accept-new`, add its reason under `reasons` in the same change, and say so in the pull request.
6. **After a fix,** run the full `npm run a11y -- --update-baseline` and commit the lowered file. A partial run cannot update the baseline. If the finding appeared only on a slow machine, say so: it may be a timing problem in the suite (`tools/a11y`), which is fixed there, not by retrying.
7. Then the `verify` skill.
