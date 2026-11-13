import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export interface Mark {
  line: number;
  severity: "error" | "warning" | "info";
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
        if (lines.get(m.line) !== "error") lines.set(m.line, m.severity);
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
    "&": { backgroundColor: "#0a1730", color: "#ffffff" },
    ".cm-content": { caretColor: "#fcb316" },
    ".cm-cursor": { borderLeftColor: "#fcb316", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "#0e1f3a", color: "#c8c6c7", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.05)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.08)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#28508f" },
    ".cm-mark-error": { backgroundColor: "rgba(255,138,115,0.22)", boxShadow: "inset 3px 0 0 #ff8a73" },
    ".cm-mark-warning": { backgroundColor: "rgba(252,179,22,0.14)", boxShadow: "inset 3px 0 0 #fcb316" },
    ".cm-mark-info": { backgroundColor: "rgba(79,195,232,0.14)", boxShadow: "inset 3px 0 0 #4fc3e8" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: "#ff9a5c" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "#4fc3e8" },
  { tag: [t.number, t.bool], color: "#fcb316" },
  { tag: [t.string, t.character], color: "#7ad79a" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#a9b6c9", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.macroName], color: "#d8a6ff" },
  { tag: t.function(t.variableName), color: "#ffe08a" },
  { tag: t.propertyName, color: "#cfe8ff" },
]);

export interface EditorHandle {
  goto(line: number): void;
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
          keymap.of([indentWithTab]),
          indentUnit.of("    "),
          cpp(),
          theme,
          syntaxHighlighting(highlight),
          markField,
          EditorView.contentAttributes.of({ "aria-label": "C source code editor. Press Escape then Tab to leave the editor." }),
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

  return <div className="editor-host" ref={host} />;
}
