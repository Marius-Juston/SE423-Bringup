// A figure's code is fetched when it is shown; the list of figures (ids,
// titles, descriptions) is read from the figure files when the game is
// built (tools/figure-meta.ts). This holds the two together: what is read
// from the source is what the loaded figures say, for every figure.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFigureMeta } from "../tools/figure-meta";
import { FIGURE_IDS, figureIdsIn, figureMeta, loadFigure } from "../src/ui/figures";
import { CHAPTERS } from "../src/levels";

interface Def {
  id: string;
  title?: string;
  description?: string;
  Component: unknown;
}
const modules = import.meta.glob<{ figure?: Def }>(["../src/ui/figures/*.tsx", "!../src/ui/figures/index.tsx"], { eager: true });
const loaded = Object.values(modules)
  .map((m) => m.figure)
  .filter((f): f is Def => !!f);
const read = readFigureMeta(join(__dirname, "../src/ui/figures"));

describe("the list of figures read from their source", () => {
  it("has every figure, with the id, title and description the figure itself gives", () => {
    expect(loaded.length).toBeGreaterThan(90);
    expect(read.map((f) => f.id).sort()).toEqual(loaded.map((f) => f.id).sort());
    for (const f of loaded) {
      const r = read.find((x) => x.id === f.id)!;
      expect(r.title, `title of ${f.id}`).toBe(f.title);
      expect(r.description, `description of ${f.id}`).toBe(f.description);
      // The Handbook lists a figure by these.
      expect(r.title?.trim(), `${f.id} has a title`).toBeTruthy();
      expect(r.description?.trim(), `${f.id} has a description`).toBeTruthy();
    }
  });

  it("is what the game uses", () => {
    expect(FIGURE_IDS).toEqual(read.map((f) => f.id).sort());
    for (const f of read) expect(figureMeta(f.id)).toEqual({ title: f.title, description: f.description });
    expect(figureMeta("no-such-figure")).toEqual({ title: undefined, description: undefined });
  });

  it("fetches a figure by its id, and nothing for an id that is not a figure", async () => {
    const f = await loadFigure("gpio-pin");
    expect(f?.id).toBe("gpio-pin");
    expect(typeof f?.Component).toBe("function");
    expect(await loadFigure("no-such-figure")).toBeUndefined();
    // A part shared by figures is not a figure.
    expect(await loadFigure("mem-shared")).toBeUndefined();
  });

  it("finds the figures a level embeds, and every one of them exists", () => {
    expect(figureIdsIn("text\n{{figure:gpio-pin}}\nmore {{figure:adc-chain}} and again {{figure:gpio-pin}}")).toEqual(["gpio-pin", "adc-chain"]);
    const used = new Set(CHAPTERS.flatMap((c) => c.levels).flatMap((l) => figureIdsIn(JSON.stringify(l))));
    expect(used.size).toBeGreaterThan(50);
    for (const id of used) expect(FIGURE_IDS, `{{figure:${id}}} is embedded by a level`).toContain(id);
  });
});
