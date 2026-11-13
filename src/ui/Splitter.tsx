import { useRef } from "react";

/**
 * A draggable divider between two panes. `value` is the width in pixels of
 * the pane on the side named by `side`; drag or use the arrow keys.
 */
export function Splitter({ value, onChange, min, max, side, label }: { value: number; onChange: (v: number) => void; min: number; max: number; side: "left" | "right"; label: string }) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const sign = side === "left" ? 1 : -1;
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, v: value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.v + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(value - sign * 24));
        if (e.key === "ArrowRight") onChange(clamp(value + sign * 24));
      }}
      title="Drag to resize (or focus and use the arrow keys)"
    />
  );
}
