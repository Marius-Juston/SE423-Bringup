import { Component, type ReactNode } from "react";
import { Figure } from "./figures";

/**
 * Keeps a failure in one part (a figure, a bench view) from taking the whole
 * screen down: the part is replaced by a short note and the rest keeps working.
 */
export class Guard extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="part-failed" role="note">
        {this.props.what} could not be shown (a bug in the game, not in your work). The rest of this screen still works.{" "}
        <button className="linkish" onClick={() => this.setState({ failed: false })}>Try again</button>
      </p>
    );
  }
}

/** Inline: **bold**, `code`. */
function inline(text: string, key: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong> : <code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Small Markdown subset: paragraphs, "- " lists, "1. " lists, ``` code blocks, "## " headings. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/^\n+|\s+$/g, "").split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else if (/^\{\{figure:[a-z0-9-]+\}\}\s*$/.test(line.trim())) {
      blocks.push(<Guard key={k++} what="This figure"><Figure id={line.trim().slice(9, -2)} /></Guard>);
      i++;
    } else if (/^##\s/.test(line)) {
      blocks.push(<h3 key={k++} className="md-h">{inline(line.slice(3), k)}</h3>);
      i++;
    } else if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      // A numbered list interrupted by a code block continues its numbering.
      const start = ordered ? parseInt(line, 10) : 1;
      const items: ReactNode[] = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^(-|\d+\.)\s/, ""), k * 100 + items.length)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k++} start={start}>{items}</ol> : <ul key={k++}>{items}</ul>);
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(```|##\s|-\s|\d+\.\s|\{\{figure:)/.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={k++}>{inline(para.join(" "), k)}</p>);
    }
  }
  return <>{blocks}</>;
}
