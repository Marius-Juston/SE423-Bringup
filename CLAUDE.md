# CLAUDE.md

Guidance for agents (and people) working in this repository. Read it before changing anything.

## What this is

**Bringup** is a practice game for UIUC SE 423, Introduction to Mechatronics (TI TMS320F28379D LaunchPad, C, then a robot). Students work through chapters of short levels: a brief with interactive figures, puzzles, then real course-style C that runs on a simulated board. It runs in a browser (GitHub Pages, installable, offline) and as a Tauri desktop app.

- Live: https://marius-juston.github.io/SE423-Bringup/
- Course material it follows (lectures, labs, homeworks, the TI reference manual): https://github.com/Marius-Juston/SE-423---Class-Material, usually checked out next to this repo at `../SE-423---Class-Material`.
- The repository is **public**. Never put session links (`Claude-Session:` trailers, claude.ai URLs), private paths or personal details in commits, pull requests, issues or files.

## Commands

```sh
npm ci                      # install (Node 24; the lockfile is made with the newest npm)
npm run dev                 # the game in a browser with live reload
npx tsc --noEmit            # type check
npx vitest run              # simulator, level and logic tests (about 2,000; under a minute)
npm run check-levels        # only tests/levels.test.ts: every level's content rules
npm run e2e                 # builds, then solves every level through the real UI in headless Chromium (minutes)
E2E_FROM=9 npx vitest run --config vitest.e2e.config.ts   # e2e from chapter 9 on (after `npx vite build`)
node tools/shot.mjs level <level-id> out.png [--tests] [--run ms] [--code file.c] [--dark] [--width N] [--height N]
node tools/shot.mjs figure <figure-id> out.png [--dark] [--width N] [--click "button text"]
node tools/shot.mjs map|handbook out.png [--section "Key diagrams"]
npm run tauri build         # desktop installers (needs Rust and the Tauri system packages)
```

Every screen has an address, so a reload and the Back button keep your place: `#/level/<level-id>`, `#/handbook`, `#/sandbox`, `#/settings` after the game's URL (`src/ui/route.ts`).

Run a C program against the simulator from a script: import `runProgram` from `src/sim/runner.ts` and run the script with `npx vite-node script.ts` from the repo root.

## Layout

```
src/sim/            the simulator: pure TypeScript, no DOM
  cc/               C-subset lexer, preprocessor, parser, compiler to closures (C2000 semantics: 16-bit int and char)
  device/           register map generated from the TI headers (registers.json)
  periph/           GPIO, CPU timers, PIE, SCI
  plugins/          one file per further peripheral or world model, auto-loaded (docs/PLUGINS.md)
  lib/              the course library functions (prelude) and printf
  world/            boards ("kits"), terrain
  runner.ts         runs a program for a level and evaluates its checks
  live.ts           a running session for the UI (pause, step, buttons, knobs)
src/levels/         content as data
  chapters/         one file per chapter, auto-discovered (chA..chC primers, ch00..ch21)
  glossary/         terms in plain words, auto-merged
  types.ts          the level format; course-links.ts and slides-index.json: links to lecture slides
src/ui/             React: map, level view, widgets, bench, handbook, sandbox, settings
  figures/          interactive figures, one per file, auto-registered (docs/VISUALS.md)
  views/            bench views shown beside a running program, auto-registered
tests/              vitest; tests/e2e/ plays the game in a browser
tools/              screenshot tool, generators
docs/               AUTHORING.md (levels), PLUGINS.md (simulator), VISUALS.md (figures and views)
public/             install.sh, install.ps1, web manifest, icons
```

Adding a level, a figure, a bench view, a glossary file or a simulator plugin never requires editing a registry: drop the file in its folder.

## Rules that are easy to break

**Content (full rules: `docs/AUTHORING.md`)**
- The reader is a complete beginner who did the primers. A word, C construct or piece of maths is explained in one plain sentence where it first appears, with a small worked example before the student must use it. One new idea per level. Briefs stay under about 350 words before the activity.
- Facts come from the Technical Reference Manual, the data sheet and the course code, not from memory. Cite the manual section in `refs`; link the lecture slide (`{ course: "L5", slide: 31 }`).
- Never publish a graded answer. Homeworks and labs have blanks students fill in for credit: teach the same skill with different numbers, pins, registers or maps.
- The Sandbox's starting programs (`src/ui/sandbox-starters/`) only show the hardware through the board's library. None may solve a level, a lab or a homework: no controller, pose, steering, wall following, filter or set-up a handout has students write. `tests/sandbox_starters*.test.ts` runs each one against every code level.
- A code level's starter compiles and fails; its solution passes every check and star with zero diagnostics. Checks judge behaviour and must fail the two or three most likely wrong programs (run them). A check that reads only end-state globals needs a second input so constants cannot pass.
- Stars reward something real (a time budget, accuracy, distance), never line counts or anything every correct solution earns.
- Three hints form a ladder: a nudge, the mechanism, nearly the answer. A check's `hint` names the likely cause.
- Level ids are permanent: saved progress is keyed by them. Add new ids; do not rename.
- Code in levels: plain ASCII, lines at most 100 characters, the course's style (`GpioDataRegs.GPASET.bit.GPIO31 = 1;`).

**Simulator (`docs/PLUGINS.md`)**
- A model implements what the manual says and cites the section in its header, including what it does not model. If a level needs behaviour the simulator lacks, add it to the simulator; do not bend the level.
- A mistake a beginner makes should produce a diagnostic that names the line, what happened and what to try. Silent wrong behaviour is a bug.
- Time is simulated (nanoseconds, event driven). Nothing in `src/sim` may use wall-clock time, `Math.random`, or the DOM.

**Interface and visuals (`docs/VISUALS.md`)**
- Colours only through the CSS tokens in `src/ui/styles.css`, so both themes work. Everything is keyboard operable with visible focus and real labels; nothing moves unless the student started it; `prefers-reduced-motion` is respected.
- A figure teaches one idea: picture, a sentence that reacts to the state, controls, caption. It must be correct at the extremes of every control and legible at 380 px wide. Register a `title` and `description`.
- Bench views re-render every animation frame: no heavy work, no timers of their own.
- Look at what you build: take screenshots in light and dark and at a narrow width, and read them.

**Writing style (everywhere: levels, UI text, docs, commit messages)**
- Second person, short plain sentences, no filler, no long dashes. Say what something does, not that it is powerful.

## Before you say it is done

1. `npx tsc --noEmit` and `npx vitest run` pass.
2. For content or UI changes: `npm run e2e` (or `E2E_FROM=<chapter>` for the chapters you touched) passes, and you looked at screenshots of what changed.
3. State plainly what you verified and what you did not.

## Publishing

- Pushing to `main` runs CI and publishes the web version to GitHub Pages (`.github/workflows/pages.yml`).
- Installers: bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, refresh the lockfiles, push, then push a tag `vX.Y.Z` (`.github/workflows/release.yml`). The install scripts in `public/` fetch the latest release.
- Workflow actions are pinned by commit SHA with the version in a comment.
- Dependabot (`.github/dependabot.yml`) opens grouped update pull requests on Mondays for npm, the Rust crates in `src-tauri` and the workflow actions, and security fixes at once. Merge one when CI is green. The npm group `tauri` and the cargo group `tauri` must be merged together: the JavaScript and Rust sides of Tauri share a minor version. A pull request that touches `src-tauri` or the package files also compiles the desktop app (`.github/workflows/desktop.yml`).
- Commit messages start with a verb and say what changed for the student or the simulator. End with a `Co-Authored-By:` line when an agent wrote the change; nothing else.

## Skills

Task recipes live in `.claude/skills/`: `add-level`, `add-figure`, `add-sim-plugin`, `beginner-review`, `verify`, `release`.
