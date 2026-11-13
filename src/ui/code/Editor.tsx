import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export interface Mark {
  line: number;
  /** "current" marks the line the paused program is on. */
  severity: "error" | "warning" | "info" | "current";
}

const setMarks = StateEffect.define<Mark[]>();
const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const lines = new Map<number, string>();
      for (const m of e.value) {
        if (m.line < 1 || m.line > tr.state.doc.lines) continue;
        if (m.severity === "current" || (lines.get(m.line) !== "error" && lines.get(m.line) !== "current")) lines.set(m.line, m.severity);
      }
      deco = Decoration.set(
        [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([line, sev]) => Decoration.line({ class: `cm-mark-${sev}` }).range(tr.state.doc.line(line).from)),
      );
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--inset)", color: "var(--text)" },
    ".cm-content": { caretColor: "var(--value)" },
    ".cm-cursor": { borderLeftColor: "var(--value)", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--dim)", border: "none" },
    ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--select)" },
    ".cm-mark-error": { backgroundColor: "var(--bad-soft)", boxShadow: "inset 3px 0 0 var(--bad)" },
    ".cm-mark-warning": { backgroundColor: "var(--accent-soft)", boxShadow: "inset 3px 0 0 var(--value)" },
    ".cm-mark-current": { backgroundColor: "var(--accent-soft)", boxShadow: "inset 4px 0 0 var(--accent)" },
    ".cm-mark-info": { backgroundColor: "var(--accent-soft)", boxShadow: "inset 3px 0 0 var(--info)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller:focus-visible": { outline: "none" },
  },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: "var(--code-kw)" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "var(--code-type)" },
  { tag: [t.number, t.bool], color: "var(--code-num)" },
  { tag: [t.string, t.character], color: "var(--code-str)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.macroName], color: "var(--code-macro)" },
  { tag: t.function(t.variableName), color: "var(--code-fn)" },
  { tag: t.propertyName, color: "var(--code-prop)" },
]);

export interface EditorHandle {
  /** Moves the cursor to a line and focuses the editor. */
  goto(line: number): void;
  /** Scrolls a line into view without taking focus. */
  reveal(line: number): void;
}

export function Editor({ value, onChange, marks, handle }: { value: string; onChange: (v: string) => void; marks: Mark[]; handle?: { current: EditorHandle | null } }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          // Ctrl+Enter and Ctrl+Shift+Enter run the tests and the program (CodeLevelView): they must not also add a line here.
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => true }, { key: "Shift-Mod-Enter", run: () => true }])),
          keymap.of([indentWithTab]),
          indentUnit.of("    "),
          cpp(),
          theme,
          syntaxHighlighting(highlight),
          markField,
          EditorView.contentAttributes.of({ "aria-label": "C source code editor. Press Escape then Tab to leave the editor.", "aria-describedby": "editor-exit", tabindex: "0" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    if (handle)
      handle.current = {
        goto(line) {
          const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
          v.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
          v.focus();
        },
        reveal(line) {
          const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
          v.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
        },
      };
    return () => v.destroy();
    // The editor is created once; later value changes come from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External resets (the "Reset code" button) replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of(marks) });
  }, [marks]);

  return (
    <div className="editor-wrap">
      <div className="editor-host" ref={host} />
      <p className="editor-exit" id="editor-exit">
        <kbd>Tab</kbd> indents. To leave the editor with the keyboard press <kbd>Esc</kbd>, then <kbd>Tab</kbd>.
      </p>
    </div>
  );
}
