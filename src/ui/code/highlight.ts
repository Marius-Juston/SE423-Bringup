// Colours for C that is only read (code blocks in briefings, the reference
// solution): the same parser and the same colour tokens as the editor.
import { cppLanguage } from "@codemirror/lang-cpp";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";

const classes = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.controlKeyword], class: "tk-kw" },
  { tag: [t.typeName, t.standard(t.typeName)], class: "tk-type" },
  { tag: [t.number, t.bool], class: "tk-num" },
  { tag: [t.string, t.character], class: "tk-str" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tk-comment" },
  { tag: [t.processingInstruction, t.macroName], class: "tk-macro" },
  { tag: t.function(t.variableName), class: "tk-fn" },
  { tag: t.propertyName, class: "tk-prop" },
]);

const LOOKS_LIKE_C = /[;{}]|^\s*#\s*(define|include|if)|\/\/|\/\*/m;

export interface Piece {
  text: string;
  /** The colour class, or "" for plain text. */
  cls: string;
}

const cache = new Map<string, Piece[][]>();

/** The code as lines of coloured pieces. Joining every piece's text gives the code back unchanged. */
export function highlightLines(code: string): Piece[][] {
  const hit = cache.get(code);
  if (hit) return hit;
  const spans: { from: number; to: number; cls: string }[] = [];
  try {
    // A block of something else (a bit table, a waveform drawn in text) stays plain: "for" and "if" there are words.
    if (LOOKS_LIKE_C.test(code))
      highlightTree(cppLanguage.parser.parse(code), classes, (from, to, cls) => spans.push({ from, to, cls }));
  } catch {
    // Text the parser cannot take is shown plain.
    spans.length = 0;
  }
  const lines: Piece[][] = [];
  let at = 0;
  let k = 0;
  for (const line of code.split("\n")) {
    const end = at + line.length;
    const out: Piece[] = [];
    let pos = at;
    while (k < spans.length && spans[k].to <= pos) k++;
    for (let j = k; j < spans.length && spans[j].from < end; j++) {
      const from = Math.max(spans[j].from, pos);
      const to = Math.min(spans[j].to, end);
      if (to <= from) continue;
      if (from > pos) out.push({ text: code.slice(pos, from), cls: "" });
      out.push({ text: code.slice(from, to), cls: spans[j].cls });
      pos = to;
    }
    if (pos < end) out.push({ text: code.slice(pos, end), cls: "" });
    lines.push(out);
    at = end + 1;
  }
  if (cache.size > 400) cache.clear();
  cache.set(code, lines);
  return lines;
}
