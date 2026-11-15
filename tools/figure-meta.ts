// The list of figures (id, title, description) without the figures.
//
// A figure's code is loaded when a level or the Handbook shows it
// (src/ui/figures/index.tsx). The Handbook lists every figure by its title
// and description, and the game must know which ids exist, before any
// figure is loaded. This plugin reads that from the source of each figure
// file and serves it as the module "virtual:figure-meta", so adding a
// figure is still one file dropped in src/ui/figures and nothing else.
//
// It reads, it does not run: the three values must be plain string literals
// in the `export const figure = { ... }` of the file, as docs/VISUALS.md
// shows. Anything else stops the build with the file's name.
// tests/figure_meta.test.ts compares the result with the loaded figures.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

export interface FigureMeta {
  id: string;
  title?: string;
  description?: string;
}

const ID = "virtual:figure-meta";
const STRING = String.raw`"(?:[^"\\\n]|\\.)*"`;

/** The value of `key: "..."` in the text of an object literal; undefined when the key is not there. */
function literal(body: string, key: string, file: string): string | undefined {
  const at = new RegExp(String.raw`(?:^|[\s{,])${key}:\s*`).exec(body);
  if (!at) return undefined;
  const rest = body.slice(at.index + at[0].length);
  const m = new RegExp(`^${STRING}(?=\\s*[,}])`).exec(rest);
  if (!m) throw new Error(`${file}: write the figure's ${key} as one plain string in double quotes (the list of figures is read from the source, not run).`);
  return JSON.parse(m[0]) as string;
}

/** Reads id, title and description of every figure file in a folder. A .tsx file without `export const figure` is a shared part, not a figure. */
export function readFigureMeta(dir: string): FigureMeta[] {
  const out: FigureMeta[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".tsx") || name === "index.tsx") continue;
    const file = join(dir, name);
    const src = readFileSync(file, "utf8");
    const start = /^export const figure(?::\s*[\w.]+)?\s*=\s*\{/m.exec(src);
    if (!start) continue;
    const end = src.indexOf("\n};", start.index);
    if (end < 0) throw new Error(`${file}: the figure's object must end with "};" on a line of its own.`);
    const body = src.slice(start.index + start[0].length, end);
    const id = literal(body, "id", file);
    if (id !== name.slice(0, -4)) throw new Error(`${file}: the figure's id is ${JSON.stringify(id)}, but the file must be named like its id (${name.slice(0, -4)}).`);
    out.push({ id, title: literal(body, "title", file), description: literal(body, "description", file) });
  }
  return out;
}

export function figureMeta(root = process.cwd()): Plugin {
  const dir = resolve(root, "src/ui/figures");
  const resolved = "\0" + ID;
  return {
    name: "bringup-figure-meta",
    resolveId(id) {
      return id === ID ? resolved : undefined;
    },
    load(id) {
      if (id !== resolved) return undefined;
      // Rebuild (and, in the dev server, reload) when a figure changes.
      for (const name of readdirSync(dir)) if (name.endsWith(".tsx")) this.addWatchFile(join(dir, name));
      return `export default ${JSON.stringify(readFigureMeta(dir))};`;
    },
    // The dev server: a figure file was added, removed or edited.
    configureServer(server) {
      const refresh = (file: string) => {
        if (!file.startsWith(dir) || !file.endsWith(".tsx")) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on("add", refresh).on("unlink", refresh).on("change", refresh);
    },
  };
}
