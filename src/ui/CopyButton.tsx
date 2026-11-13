import { useRef, useState, type ReactNode } from "react";

/** Puts text on the clipboard. Works in the desktop app and on pages without the clipboard API too. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A small button that copies `text` (or what `text()` returns at that moment) and says so. */
export function CopyButton({ text, label = "Copy", what = "this code", className = "copy-btn" }: { text: string | (() => string); label?: string; what?: string; className?: string }) {
  const [state, setState] = useState<"" | "ok" | "bad">("");
  const timer = useRef(0);
  const copy = async () => {
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "ok" : "bad");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(""), 1600);
  };
  return (
    <button type="button" className={className} onClick={copy} aria-label={`Copy ${what}`} title={`Copy ${what}`}>
      <span aria-live="polite">{state === "ok" ? "Copied" : state === "bad" ? "Could not copy" : label}</span>
    </button>
  );
}

/** A code read-out with a copy button: what is copied is exactly the text shown. */
export function CodePre({ children }: { children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="code-wrap">
      <pre ref={pre}>{children}</pre>
      <CopyButton text={() => pre.current?.textContent ?? ""} />
    </div>
  );
}
