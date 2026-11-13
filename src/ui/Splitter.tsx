import { useRef } from "react";

/**
 * A draggable divider between two panes. `value` is the width in pixels of
 * the pane on the side named by `side`. Drag it, or focus it and use the
 * arrow keys (Shift for bigger steps, Home and End for the limits);
 * double-click or Enter puts it back to `reset`.
 */
export function Splitter({ value, onChange, min, max, side, label, reset }: { value: number; onChange: (v: number) => void; min: number; max: number; side: "left" | "right"; label: string; reset?: number }) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(Math.max(min, max), Math.round(v)));
  const sign = side === "left" ? 1 : -1;
  const home = () => reset !== undefined && onChange(clamp(reset));
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max))}
      aria-valuetext={`${Math.round(value)} pixels wide`}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, v: value };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.currentTarget.focus();
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.v + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onLostPointerCapture={() => (start.current = null)}
      onDoubleClick={home}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24;
        if (e.key === "ArrowLeft") onChange(clamp(value - sign * step));
        else if (e.key === "ArrowRight") onChange(clamp(value + sign * step));
        else if (e.key === "Home") onChange(clamp(side === "left" ? min : max));
        else if (e.key === "End") onChange(clamp(side === "left" ? max : min));
        else if (e.key === "Enter") home();
        else return;
        e.preventDefault();
      }}
      title="Drag to resize. Keyboard: arrow keys, Home, End; Enter or double-click resets."
    />
  );
}
