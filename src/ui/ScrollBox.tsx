import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A box whose content may be wider or taller than it (a table in a narrow window).
 * While it scrolls it is a named region that takes the focus, so the arrow keys can
 * scroll it; while everything fits it is a plain box and no extra Tab stop.
 */
export function ScrollBox({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div ref={box} className={className} role={scrolls ? "region" : undefined} aria-label={scrolls ? label : undefined} tabIndex={scrolls ? 0 : undefined}>
      {children}
    </div>
  );
}
