// A small set of line icons drawn on a 24 x 24 grid. Status is always
// carried by the icon's shape and a text label, never by colour alone.
const PATHS: Record<string, string> = {
  play: "M7 4.5v15l12-7.5z",
  stop: "M6 6h12v12H6z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  step: "M5 5v14M9 12h9m-4-4 4 4-4 4",
  skip: "M5 6l7 6-7 6zM13 6l7 6-7 6z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z",
  diamond: "M12 3l8 9-8 9-8-9z",
  map: "M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14",
  book: "M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM8 20a3 3 0 0 1 0-6h9",
  bench: "M4 9h16M6 9v10M18 9v10M8 9V6h8v3M9 14h6",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  bulb: "M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2h-5c0-.8-.4-1.5-1-2z",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  reset: "M5 12a7 7 0 1 0 2.2-5.1M5 4.5v4.6h4.6",
  sun: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8",
  moon: "M19 14.5A8 8 0 0 1 9.5 5 8 8 0 1 0 19 14.5z",
  flask: "M9 3.5h6M10 3.5v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5v-6M7.5 15h9",
  test: "M9 4.5h6v3H9zM7 6H5.5v14h13V6H17M8.5 13l2.5 2.5 4.5-5",
  dot: "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
};

const FILLED = new Set(["play", "stop", "pause", "star", "skip", "dot"]);

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: string; size?: number; label?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

/** Progress as a ring: `value` of `max`. */
export function Ring({ value, max, size = 36 }: { value: number; max: number; size?: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} className="ring-track" />
      {frac > 0 && <circle cx="18" cy="18" r={r} className={`ring-fill ${frac >= 1 ? "full" : ""}`} strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 18 18)" />}
    </svg>
  );
}
