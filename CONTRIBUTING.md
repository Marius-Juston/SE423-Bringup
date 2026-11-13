# Contributing

Thank you for improving Bringup. The short version:

- **Levels** are data: add an entry to a chapter file in `src/levels/chapters/`. The rules are in [docs/AUTHORING.md](docs/AUTHORING.md): write for a complete beginner, one new idea per level, facts from the reference manual and the course code, never a graded answer, checks that fail the likely wrong programs.
- **Figures and bench views** are one file each in `src/ui/figures/` and `src/ui/views/`: [docs/VISUALS.md](docs/VISUALS.md).
- **Simulator models** are one file each in `src/sim/plugins/`: [docs/PLUGINS.md](docs/PLUGINS.md).
- [CLAUDE.md](CLAUDE.md) summarises the rules that are easy to break and the commands; `.claude/skills/` has step-by-step recipes (written for coding agents, readable by people).

Before opening a pull request: `npx tsc --noEmit`, `npx vitest run`, and for content or interface changes `npm run e2e`, plus a look at screenshots (`node tools/shot.mjs ...`) in both themes. Say in the pull request what you verified.

Found a wrong fact, a level a wrong program passes, or an explanation that lost you? Open an issue with the level's title; those reports are the most useful ones.
