# Accessibility

The game is held to WCAG 2.2 level AA on every screen and every level, and to level AAA where that can be reached (contrast of 7:1, 44 px targets on a touch screen). A suite in `tools/a11y/` checks it in a real browser. It is the same idea as the class material's `tools/a11y/` (pinned axe-core, findings with stable keys, a baseline that may only shrink, SARIF for code scanning), written in JavaScript for this repository.

## Run it

```sh
npm run a11y                           # everything: build, serve, check, compare with a11y-baseline.json
npm run a11y -- --only tokens          # one or more of: screens, levels, figures, tokens
npm run a11y -- --from 9               # levels from chapter 9 on
npm run a11y -- --level out-blink      # only these levels (comma separated)
npm run a11y -- --quick                # the pull-request subset (below)
npm run a11y -- --resume               # continue an interrupted run
npm run a11y -- --update-baseline      # after a fix: lower the counts in a11y-baseline.json
```

It needs Playwright's Chromium (`npx playwright-core install chromium`, or `CHROME=<path>`). A whole run takes about 12 minutes on a 16-core machine (5,300 page states of 13 screens and 498 levels, and every figure), with half as many browser windows as the machine has processors, 16 at most (`--workers <n>` changes that). With 12 processors or more the figure sweep runs beside the screens and levels; with fewer it runs after them, two pages a processor, so the two do not fight over the cores. On 4 cores a whole run takes 33 minutes (screens and levels 22, figures and views 11) and the subset 8 to 10. It prints progress, then a table of rules, and writes to `a11y-out/` (ignored by git):

- `findings.json`: every finding;
- `findings.sarif`: the same for GitHub code scanning;
- `summary.md`: the table, also added to the CI job summary.

It exits 1 when a finding is not in the baseline. `--report-only` always exits 0.

The token checks alone also run in `npx vitest run` (`tests/a11y_tokens.test.ts`).

## A finding

```js
{ key, rule, where, severity, count, detail }
```

- `key` is `<where>|<rule>|<scheme or state>`, for example `adc-soc|layout/text-overlap|any@320`. It never holds a line number or a generated id, so it stays the same across unrelated edits.
- `where` is a screen (`map`, `handbook`, `settings`, `sandbox:robot:blink`, `warm-up`), a level id or a figure id. Parts shared by many screens are counted once under their own name: `chrome:topbar`, `chrome:level-head`, `chrome:level-tabs`, `chrome:editor`, `panel:<panel id>` (a bench panel or view), `component:primary-button`.
- The last part is the colour scheme and the window: `light@1440`, `dark@320`, `any@720` (a check that does not depend on colour), `light@1440+xl` (Text size Extra large), `dark-setting@1440` (the scheme pinned in Settings against the system's).
- `severity` is `error` (a failure of level A or AA, or of a rule of this repository) or `warning` (level AAA, an axe best practice, or something on purpose such as an ellipsis).
- `count` is the number of elements. One key seen in several page states (as opened, after a wrong answer, after the pass) keeps its largest count; `detail` names the states.

`tools/a11y/findings.mjs` holds the shape, `compare(findings, baseline)` and `toSarif(findings)`. It imports nothing else from the suite, so any checker can use it.

## The baseline

`a11y-baseline.json` at the root records the accepted count for each key, and a reason:

```json
{ "accepted": { "component:primary-button|axe/color-contrast-enhanced|light@1440": 2 },
  "reasons": { "axe/color-contrast-enhanced": "why this stays" } }
```

A run fails when a key is missing from `accepted` or its count is higher. Errors and warnings are both held this way, so the count of AAA shortfalls can only go down too. A reason is filed under a full key or under a rule name (it then covers every key of that rule).

- Fixed something: run `npm run a11y -- --update-baseline` and commit the file. It lowers counts and removes entries that are gone. It never raises a count.
- Never raise a count or add an entry by hand to make a run pass. Fix the problem. The baseline holds no errors: keep it that way.
- A warning that cannot be fixed without a design decision is accepted with `--accept-new`, and gets a reason in the same change. Say so in the pull request. An error cannot be accepted.
- A partial run (`--quick`, `--from`, `--level`) compares but cannot update the baseline.

## What is checked

Where: the map (as opened, a chapter chosen, a "working on" filter, with progress and a finished part, after a warm-up), a warm-up question, the handbook (every section, a search with and without results, a register chosen, a figure opened), settings (also with the paste box open and after a failed load), the sandbox on each board with each starting program (stopped, running, paused, a panel in its large view; on the homework board also the wiring bench with a fault on, a device attached, all connections shown and every section open), and every level of every chapter: as first opened, after a wrong answer (code levels: after Run tests with the starter), after the pass, and with every hint and the reference solution open. A fixed sample of code levels (the first level that shows each bench view, then every twelfth, at least 25) is also checked during a live run.

How: in light and dark (`prefers-color-scheme`), in a window 1440 px wide and one 320 px wide. The 320 px window has a touch screen. A fixed sample (every screen; every tenth level and the first of each kind, about 55 levels) is also checked at 720 px (1440 px at 200 %), with Text size Extra large at both widths, and with the scheme pinned by the Theme setting against the system's.

Interactive figures inside a level are left out of these checks: `tools/a11y/figures.mjs` checks each figure and bench view on its own, to the same finding shape, and `run.mjs` adds its findings.

| Rule prefix | What must hold | WCAG |
|---|---|---|
| `axe/*` | axe-core (the exact version in `package.json`; `npm ci` verifies it against the hash in `package-lock.json`) with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`: critical and serious are errors, moderate and minor warnings. The best-practice rules are warnings. `axe/color-contrast-enhanced` (7:1) is a warning. | A, AA; 1.4.6 |
| `target/size-44` | On the touch-screen window every target is at least 44 by 44 px, except links inside a sentence. Warning. With a mouse the 24 px rule of 2.5.8 holds (`axe/target-size`). | 2.5.5 |
| `reflow/*` | At every width: no pane scrolls sideways, no text is outside the window unless a box can scroll to it, no text runs out of its box, and a box that scrolls sideways can be reached with the keyboard and has a name. The code editor may scroll: it never wraps. | 1.4.10, 1.4.4 |
| `layout/*` | No text is cut off by a box that hides overflow, no text is drawn over other text. Text shortened on purpose (an ellipsis, a line clamp) is a warning. `layout/off-centre`: an icon sits on the middle of the one line of text beside it (within 1.5 px), and the line that joins the markers of a level list runs through their centres (within 0.5 px). | 1.4.4; off-centre is this repository's own rule |
| `text-spacing/*` | The same with line height 1.5, paragraph spacing 2 em, letter spacing 0.12 em and word spacing 0.16 em forced on everything: reports what breaks only then. | 1.4.12 |
| `keyboard/*` | Tab from the top of the page to its end: every visible control is reached (or belongs to a group the arrow keys move along), Tab always moves on (Escape then Tab leaves the code editor), the order follows the page and never jumps upwards within a column, every stop shows an outline or another change with at least 3:1 against what is next to it, and it is in the window and not behind a sticky bar. | 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 1.4.11 |
| `motion/*` | Nothing animates or changes on its own on a screen where nothing was started. With `prefers-reduced-motion`, `document.getAnimations()` is empty everywhere, also during a live run, and the page comes to rest after a test run (levels are played with reduced motion, so a replay may not start by itself). No animation repeats faster than three times a second. | 2.2.2, 2.3.1, 2.3.3 |
| `names/*`, `structure/*` | A document title on every screen, different for every screen and level; `lang`; one `h1`; heading levels are not skipped; one `main`, a `nav`; every picture (`svg`, `canvas`, `img`) has a text alternative or is hidden as decoration. Form labels are covered by axe. | 2.4.2, 3.1.1, 1.3.1, 2.4.6, 1.1.1 |
| `status/not-announced` | What appears after Check, Run tests, a search or a load is in a live region (`role=status`, `alert`, `log`, `aria-live`), or a live region says it, or the focus moves to it. | 4.1.3 |
| `colour/only-cue` | Things of one kind in different states (a passed and an open level, a right and a wrong cell) differ by more than colour: a word, an icon, a shape, a border style, a weight. | 1.4.1 |
| `code/*` | No non-breaking space, typographic quote, dash or ellipsis in any code the game shows (in the page, and in the level files: starters, solutions, code in briefs and hints). Every Copy button copies exactly the text beside it. | course rule |
| `tokens/*` | The colour tokens of `src/ui/styles.css` keep what its header promises, in both themes: body text and coloured words 7:1, code colours 7:1 in the editor and 4.5:1 on a highlighted line or a selection, edges of controls, focus ring and marks 3:1; the two light blocks are the same. Colours that tell states apart are simulated for protanopia, deuteranopia and tritanopia (Machado, Oliveira and Fernandes 2009) and pairs that become alike (CIEDE2000 under 8) are warnings. | 1.4.3, 1.4.6, 1.4.11, 1.4.1 |
| `page/error`, `suite/not-checked` | The page logged an error, or a check could not finish. Both are errors: a screen that was not checked is not a pass. | |

## How it works

- `run.mjs` builds the game into `a11y-out/dist`, serves it with `vite preview`, reads the levels through Vite (as the game does), and gives jobs to several browser windows. Each job writes its part to `a11y-out/parts/`, which is what `--resume` continues from.
- `screens.mjs` drives the game the way `tests/e2e/play.e2e.ts` does. `page-checks.mjs` holds the checks that run inside the page. `tokens.mjs` is plain arithmetic on the CSS.
- It never sleeps. After every action it waits until the fonts are loaded, the page has not changed for three animation frames, and no fade that the action started is still running (an animation without end does not count as running here: it is reported). A page that never comes to rest is a finding (`motion/never-still`). There are no retries.
- The keyboard is walked in light at 1440 px and in dark at 320 px, and in both on the screens. In the second colour scheme only the axe rules that look at colour run again on levels; the screens get all rules in both.

## Continuous integration

`.github/workflows/a11y.yml`:

- Pull requests: `npm run a11y -- --quick`. Every screen at 1440 px and 320 px, every level as first opened at 1440 px in both schemes, the sample levels in full at both widths, the live-run sample at 1440 px, the tokens, and the figure subset: every figure at 380 px and 700 px in light (all checks, the whole walk) and at 700 px in dark (colours, with every control at its ends and every option, but without the keyboard walk and the random walk), and every bench view in the 1440 px window in light, at its three sizes, after Run tests and in a live run. A finding that is not in the baseline fails the check. About 8 minutes on 4 cores of a development machine (screens and levels 5, figures 3); a hosted 4-core runner is about three times slower, so about 25 minutes.
- What the figure subset leaves to the whole sweep: figures at 320 px, with Extra large text, in the Larger view, the motion pass and the focus ring in dark; bench views in dark, with Extra large text and in a 390 px window.
- Pushes to `main`: the same subset, reporting only (`continue-on-error`), so publishing is never blocked.
- Once a week (Mondays) and on a manual run (`workflow_dispatch`): the whole sweep, reporting only. It takes about 100 minutes on a hosted runner, which is why it does not run on every push.
- The figure sweep prints a line every 100 pages and once a minute, naming any page that has been open for more than 45 seconds. A page that has no result after 4 minutes (a bench-view level run after 6) is closed and reported as `suite/not-checked` for that figure, and the sweep goes on; if no page finishes for 15 minutes the sweep itself is reported as `suite/not-checked`.
- Both keep `findings.json`, `findings.sarif` and `summary.md` as an artifact and upload the SARIF to code scanning under the category `accessibility` (no extra secret; skipped for pull requests from forks, whose token cannot write).

## Not automated

Check these by hand when you change what they depend on:

- What a screen reader says. The suite checks names, roles, live regions and order, not the words as they are heard. Read a changed screen with NVDA or VoiceOver.
- Real touch devices: a finger, the on-screen keyboard over the code editor, pinch zoom.
- Windows high-contrast mode and other forced colours.
- Cognitive load, reading level and whether an explanation is understood. `docs/AUTHORING.md` and the `beginner-review` skill cover that.
- A page that stops answering during a live run is reported as `suite/not-checked` (the check times out); the suite does not say why.
- A replay that the student started (the robot arena after Run tests) is watched only for coming to rest under reduced motion. Its Pause button is not pressed by the suite.
- Text that is hidden until something scrolls it into view is checked for clipping but not for overlap.
- The desktop app's own window (Tauri) and the installed web app are the same pages; their shells are not checked.
