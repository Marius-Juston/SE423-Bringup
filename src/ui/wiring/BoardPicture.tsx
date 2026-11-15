// The homework board drawn from the compiled board data
// (src/sim/world/boards/hw-board.json): outline, pads, the LaunchPad, the
// parts that are only drawn, the silkscreen words, the copper of the nets
// in use, then the bench's parts in their live state with their names, and
// a tag at every pin a device is attached to.
//
// One unit of the drawing is one millimetre. Names keep one size on the
// screen (11 px) and are placed where nothing else is written: a name that
// finds no room is left out, and is then in the sentence under the picture
// when the part is pointed at, focused or chosen. Silkscreen words are
// drawn only where they are at least 9 px tall.
//
// Pointing works three ways, none of them by hovering alone: the mouse
// (move to look, click to keep), touch (tap), and the keyboard: the parts
// and the LaunchPad's pins are two groups that the arrow keys move through.
import { memo, useMemo, useRef, useState } from "react";
import { HW_BOARD } from "../../sim/wiring/board";
import { NET_KINDS, netWords, pinsOfNet, type Highlight, type NetKind, type Pick } from "../../sim/wiring/nets";
import type { Inst, Shape, Status, Tone } from "../../sim/wiring/types";

const B = HW_BOARD;
const MIN_TEXT_PX = 9;
const NAME_PX = 11;

const TONE: Record<Tone, { fill: string; stroke: string; dash?: string }> = {
  part: { fill: "var(--pcb-edge)", stroke: "var(--pcb-ink)" },
  metal: { fill: "none", stroke: "var(--pcb-ink)" },
  lit: { fill: "var(--accent)", stroke: "var(--pcb-ink)" },
  dark: { fill: "var(--pcb)", stroke: "var(--pcb-ink)" },
  gone: { fill: "none", stroke: "var(--pcb-ink)", dash: "1 0.8" },
  bad: { fill: "none", stroke: "var(--pcb-ink)", dash: "0.5 0.5" },
  ink: { fill: "var(--pcb-ink)", stroke: "none" },
};

/** How each kind of connection is drawn: told apart by dash and weight, not by colour. */
export const KIND_STYLE: Record<NetKind, { w: number; dash?: string }> = {
  out: { w: 0.45 },
  in: { w: 0.45, dash: "1.6 0.9" },
  pwm: { w: 0.5, dash: "2.6 0.7 0.5 0.7" },
  analog: { w: 0.7, dash: "0.1 1.1" },
  spi: { w: 0.9, dash: "0.9 0.6" },
  supply: { w: 0.25, dash: "3.2 1" },
  ground: { w: 0.25, dash: "0.5 0.5" },
};

function shape(s: Shape, k: number, px: number) {
  const t = TONE[s.tone];
  switch (s.s) {
    case "rect":
      return <rect key={k} x={s.x} y={s.y} width={Math.max(0.1, s.w)} height={Math.max(0.1, s.h)} rx={s.r} fill={s.fill ? t.fill : "none"} stroke={t.stroke} strokeWidth={0.3} strokeDasharray={s.dash ? "1 0.8" : t.dash} />;
    case "circle":
      return <circle key={k} cx={s.x} cy={s.y} r={s.r} fill={s.fill ? t.fill : "none"} stroke={t.stroke} strokeWidth={0.3} strokeDasharray={t.dash} />;
    case "line":
      return <line key={k} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.tone === "lit" ? "var(--accent)" : t.stroke} strokeWidth={s.w ?? 0.35} strokeLinecap="round" strokeDasharray={t.dash} />;
    case "text":
      return (s.size ?? 1.6) * px >= MIN_TEXT_PX ? <text key={k} x={s.x} y={s.y} fontSize={s.size ?? 1.6} textAnchor={s.anchor ?? "middle"} fill="var(--pcb-ink)">{s.text}</text> : null;
  }
}

type Box = [number, number, number, number];
const hits = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** The box a silkscreen word takes (its anchor is the lower left corner, turned about that point). */
function silkBox([x, y, size, rot, text]: (typeof B.texts)[number]): Box {
  const len = text.length * size * 0.66;
  if (rot === 90) return [x - size, y - len, size, len];
  if (rot === 270) return [x, y, size, len];
  if (rot === 180) return [x - len, y, len, size];
  return [x, y - size, len, size];
}

function silk([x, y, size, rot, text]: (typeof B.texts)[number], k: number) {
  const turned = rot === 90 || rot === 270;
  const flipped = rot === 180 || rot === 270;
  return (
    <text key={k} x={x} y={y} fontSize={size} textAnchor={flipped ? "end" : "start"} transform={turned ? `rotate(-90 ${x} ${y})` : undefined} dy={flipped ? size : 0} fill="var(--pcb-ink)">
      {text}
    </text>
  );
}

const tracePath = (t: number[]): string => {
  let d = `M${t[2]},${t[3]}`;
  for (let k = 4; k < t.length; k += 2) d += `L${t[k]},${t[k + 1]}`;
  return d;
};
/** The copper of each net: one path for the top layer, one for the bottom. */
const TRACES = new Map<number, [string, string]>();
for (const t of B.traces) {
  const e = TRACES.get(t[0]) ?? ["", ""];
  e[t[1]] += tracePath(t);
  TRACES.set(t[0], e);
}
const PADS = new Map<number, string>();
for (const [x, y, net] of B.holes) PADS.set(net, `${PADS.get(net) ?? ""}M${x - 0.85},${y}a0.85,0.85 0 1,0 1.7,0a0.85,0.85 0 1,0 -1.7,0`);

/** Everything that never changes while a program runs. */
const Still = memo(function Still({ px }: { px: number }) {
  const lp = B.launchpad;
  const pads = B.holes.map(([x, y]) => `M${x - 0.5},${y}a0.5,0.5 0 1,0 1,0a0.5,0.5 0 1,0 -1,0`).join("");
  const lpPins = lp.pins.map(([x, y]) => `M${x - 0.6},${y - 0.6}h1.2v1.2h-1.2z`).join("");
  return (
    <g aria-hidden="true">
      <rect x={0.2} y={0.2} width={B.w - 0.4} height={B.h - 0.4} rx={2} fill="var(--pcb)" stroke="var(--pcb-edge)" strokeWidth={0.6} />
      <path d={pads} fill="none" stroke="var(--pcb-ink)" strokeWidth={0.18} opacity={0.75} />
      {B.decor.map(([x, y, w, h, word], k) => (
        <g key={k}>
          <rect x={x} y={y} width={w} height={h} rx={/^(GND|ADC|DAC)$/.test(word) ? 5 : 0.5} fill="none" stroke="var(--pcb-ink)" strokeWidth={0.25} />
          {2 * px >= MIN_TEXT_PX && w > word.length * 1.2 && !B.texts.some((t) => t[0] > x - 12 && t[0] < x + w + 2 && t[1] > y - 2 && t[1] < y + h + 2) && <text x={x + w / 2} y={y + h / 2 + 0.7} fontSize={2} textAnchor="middle" fill="var(--pcb-ink)">{word}</text>}
        </g>
      ))}
      <rect x={lp.x} y={lp.y} width={lp.w} height={lp.h} rx={1.5} fill="var(--pcb-edge)" fillOpacity={0.35} stroke="var(--pcb-ink)" strokeWidth={0.4} />
      <path d={lpPins} fill="var(--pcb-ink)" />
      {3.2 * px >= MIN_TEXT_PX && <text x={lp.x + lp.w / 2} y={lp.y + 14} fontSize={3.2} textAnchor="middle" fill="var(--pcb-ink)">F28379D LaunchPad</text>}
      {1.6 * px >= MIN_TEXT_PX && lp.heads.map(([x, y, word], k) => <text key={k} x={x} y={y} fontSize={1.6} fill="var(--pcb-ink)">{word}</text>)}
      {B.texts.filter((t) => t[2] * px >= MIN_TEXT_PX).map(silk)}
    </g>
  );
});

/** Every connection in use, each kind in its own line style. */
const AllRoutes = memo(function AllRoutes({ nets }: { nets: [number, NetKind][] }) {
  return (
    <g aria-hidden="true" className="wb-routes-guide">
      {nets.map(([net, kind]) => {
        const t = TRACES.get(net);
        const st = KIND_STYLE[kind];
        return t ? (
          <g key={net} fill="none" stroke="var(--pcb-ink)" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={st.dash}>
            <path d={t[0]} strokeWidth={st.w} />
            {/* The bottom layer: the same pattern, thinner. */}
            <path d={t[1]} strokeWidth={st.w * 0.55} />
          </g>
        ) : null;
      })}
    </g>
  );
});

export interface Pictured {
  inst: Inst;
  status: Status;
}

/** The short name written beside a part. */
function nameOf({ inst, status }: Pictured, live: boolean): string {
  const p = inst.part!;
  const base = p.kind === "buzzer" ? "BUZZER" : p.kind === "buzzer-jumper" ? "JUMPER" : p.kind === "photoresistor" ? "PHOTO" : p.kind === "battery" ? "BATTERY (back)" : p.kind === "imu-jumper" ? (p.signal ?? p.id) : p.kind === "power-led" ? (p.rail ?? p.id) : p.id;
  if (p.kind === "servo" && live && status.angle !== undefined) return `${base} ${Math.round(status.angle)} deg`;
  return base;
}

interface Label {
  key: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  text: string;
}

const PIN_AT = new Map(B.launchpad.pins.map((p) => [p[3], p] as const));
const LP_MID = B.launchpad.x + B.launchpad.w / 2;

export interface PictureProps {
  px: number;
  parts: Pictured[];
  /** The part whose card is open. */
  selected: string;
  /** What is lit up now (pointed at, focused or chosen), with its nets. */
  pick: Pick | null;
  light: Highlight | null;
  /** Nets drawn by "all connections", with their kind; empty when the switch is off. */
  routes: [number, NetKind][];
  live: boolean;
  label: string;
  /** `keep`: a click, a tap or a key (stays); otherwise the mouse is only passing. */
  onPick: (p: Pick | null, keep: boolean) => void;
  onHold: (id: string, down: boolean) => void;
}

export function BoardPicture({ px, parts, selected, pick, light, routes, live, label, onPick, onHold }: PictureProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [holding, setHolding] = useState("");
  const [pinCursor, setPinCursor] = useState(1);
  const lp = B.launchpad;
  const mm = (n: number) => n / px;
  const tag = mm(NAME_PX);
  const onBoard = useMemo(() => parts.filter((p) => p.inst.part && p.inst.def.draw), [parts]);
  const order = useMemo(() => [...onBoard].sort((a, b) => a.inst.part!.box[1] - b.inst.part!.box[1] || a.inst.part!.box[0] - b.inst.part!.box[0]).map((p) => p.inst.id), [onBoard]);
  const holdable = (id: string) => !!parts.find((p) => p.inst.id === id)?.inst.def.inputs?.some((d) => d.kind === "hold");

  // ----- names: placed where nothing else is written -----
  const { labels, tags, pinNames, lightLabels } = useMemo(() => {
    const taken: Box[] = [];
    const width = (text: string) => mm(text.length * NAME_PX * 0.6 + 4);
    const h = mm(NAME_PX + 2);
    const boxAt = (x: number, y: number, anchor: Label["anchor"], text: string): Box => [anchor === "start" ? x : anchor === "end" ? x - width(text) : x - width(text) / 2, y - h * 0.8, width(text), h];
    const inside = (b: Box) => b[0] >= 0.5 && b[1] >= 0.5 && b[0] + b[2] <= B.w - 0.5 && b[1] + b[3] <= B.h - 0.5;
    const place = (key: string, text: string, tries: [number, number, Label["anchor"]][], force = false): Label | null => {
      for (const [x, y, anchor] of tries) {
        const b = boxAt(x, y, anchor, text);
        if (!inside(b) || taken.some((t) => hits(t, b))) continue;
        taken.push(b);
        return { key, x, y, anchor, text };
      }
      if (!force) return null;
      const [x, y, anchor] = tries[0];
      taken.push(boxAt(x, y, anchor, text));
      return { key, x, y, anchor, text };
    };
    // What is written already: silkscreen words that show at this zoom, and the words of parts that are only drawn.
    for (const t of B.texts) if (t[2] * px >= MIN_TEXT_PX) taken.push(silkBox(t));
    if (2 * px >= MIN_TEXT_PX) for (const d of B.decor) taken.push([d[0], d[1], d[2], d[3]]);
    if (3.2 * px >= MIN_TEXT_PX) taken.push([lp.x + 6, lp.y + 10, lp.w - 12, 5]);
    const side = (x: number, y: number, out = 2.2): [number, number, Label["anchor"]][] => (x < LP_MID ? [[x - out, y + tag * 0.35, "end"]] : [[x + out, y + tag * 0.35, "start"]]);
    // 1. The label of what is lit up, at its LaunchPad pin: it always shows.
    const lightLabels: Label[] = [];
    for (const net of light?.near ?? []) {
      const words = netWords(net);
      for (const [n, x, y] of pinsOfNet(net).slice(0, 2)) {
        const l = place(`hl-${n}`, words, [...side(x, y, x < LP_MID ? x - lp.x + 1.5 : lp.x + lp.w - x + 1.5), [x, y - 2.2, "middle"], [x, y + 2.2 + tag, "middle"]], true);
        if (l) lightLabels.push(l);
      }
    }
    // 2. Devices attached to pins.
    const tags: (Label & { id: string; px: number; py: number; x2: number; x0: number; x1: number })[] = [];
    for (const { inst } of parts) {
      if (inst.part) continue;
      for (const d of inst.def.terminals) {
        const net = B.nets.indexOf(inst.conn[d.id]);
        const at = net < 0 ? undefined : B.launchpad.pins.find((q) => q[2] === net);
        if (!at || /^(GND|3V3|5V)$/.test(inst.conn[d.id])) continue;
        const left = at[0] < LP_MID;
        const x2 = left ? lp.x - 3 : lp.x + lp.w + 3;
        const text = `${inst.label}: ${d.name.replace(/ \(.*\)$/, "")}`;
        const l = place(`${inst.id}-${d.id}`, text, [[left ? x2 - 0.8 : x2 + 0.8, at[1] + tag * 0.35, left ? "end" : "start"], [left ? x2 - 0.8 : x2 + 0.8, at[1] + tag * 0.35 - h, left ? "end" : "start"], [left ? x2 - 0.8 : x2 + 0.8, at[1] + tag * 0.35 + h, left ? "end" : "start"]]);
        const reach = l ? width(text) + 0.8 : 0;
        tags.push({ ...(l ?? { key: `${inst.id}-${d.id}`, x: 0, y: 0, anchor: "start", text: "" }), id: inst.id, px: at[0], py: at[1], x2, x0: left ? x2 - reach : at[0], x1: left ? at[0] : x2 + reach });
      }
    }
    // 3. The parts' names. Rows of like parts that are too close for a name each get one name for the row.
    const labels: Label[] = [];
    const roomy = (pitch: number, text: string, along: "x" | "y") => (along === "x" ? pitch >= width(text) : pitch >= h);
    const group = (kind: string, text: string) => {
      const boxes = onBoard.filter((p) => p.inst.kind === kind).map((p) => p.inst.part!.box);
      if (!boxes.length) return;
      const x0 = Math.min(...boxes.map((b) => b[0]));
      const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
      const y0 = Math.min(...boxes.map((b) => b[1]));
      const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
      const l = place(`group-${kind}`, text, [[(x0 + x1) / 2, y0 - 1.2, "middle"], [(x0 + x1) / 2, y1 + tag + 0.6, "middle"], [x0 - 1, (y0 + y1) / 2, "end"], [x1 + 1, (y0 + y1) / 2, "start"]]);
      if (l) labels.push(l);
    };
    const each = { led: roomy(7.4, "LED16", "x"), "imu-jumper": roomy(2.54, "MISO", "y"), button: roomy(5.08, "PB1", "y") };
    // Parts first claim their own ground, so no name lands on another part.
    for (const p of onBoard) if (p.inst.kind !== "battery") taken.push(p.inst.part!.box);
    // The joystick's module is drawn below its socket.
    for (const p of onBoard) if (p.inst.kind === "joystick") taken.push([p.inst.part!.box[0] + p.inst.part!.box[2] - 5.5, p.inst.part!.box[1] + p.inst.part!.box[3] + 0.8, 5.5, 5.5]);
    const first = onBoard.find((p) => p.inst.id === selected);
    for (const p of [...(first ? [first] : []), ...onBoard.filter((q) => q !== first)]) {
      const k = p.inst.kind;
      if (k in each && !each[k as keyof typeof each] && p !== first) continue;
      const [x, y, w, hh] = p.inst.part!.box;
      const text = nameOf(p, live);
      const cx = x + w / 2;
      const cy = y + hh / 2 + tag * 0.35;
      const tries: [number, number, Label["anchor"]][] =
        k === "battery" ? [[cx, y + hh - 1.5, "middle"], [cx, y + hh / 2, "middle"]]
        : k === "led" ? [[cx, y - 0.8, "middle"], [cx, y + hh + tag + 0.2, "middle"], [x + w + 1.4, cy, "start"], [x - 1.4, cy, "end"]]
        : k === "joystick" ? [[x - 1, cy, "end"], [x + w, y - 1, "end"], [x + w, y + hh + 7.5 + tag, "end"]]
        : k === "servo" ? [[x + w + 13.5, cy, "start"], [x + 1, y - 0.8, "start"], [x + 1, y + hh + tag, "start"]]
        : [[cx, y - 0.9, "middle"], [cx, y + hh + tag + 0.3, "middle"], [x + w + 1, cy, "start"], [x - 1, cy, "end"]];
      const l = place(`part-${p.inst.id}`, text, tries, p === first);
      if (l) labels.push(l);
    }
    if (!each.led) group("led", "LED1 to LED16");
    if (!each.button) group("button", "PB1 to PB4");
    if (!each["imu-jumper"]) group("imu-jumper", "IMU jumpers");
    // 4. The LaunchPad's pin names, when a row is tall enough for one.
    const pinNames: Label[] = [];
    if (2.54 * px >= NAME_PX + 1) {
      for (const [x, y, net, n] of B.launchpad.pins) {
        if (net < 0) continue;
        // The outer columns are named outwards, the inner ones inwards.
        const outer = Math.abs(x - LP_MID) > 21.5;
        const leftSide = x < LP_MID;
        const l = place(`pin-${n}`, B.nets[net], [[x + (outer === leftSide ? -1.4 : 1.4), y + tag * 0.35, outer === leftSide ? "end" : "start"]]);
        if (l) pinNames.push(l);
      }
    }
    return { labels, tags, pinNames, lightLabels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, parts, selected, light, live, onBoard]);

  // ----- the mouse: what is under the pointer -----
  const under = (e: { clientX: number; clientY: number }): Pick | null => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * B.w;
    const y = ((e.clientY - r.top) / r.height) * B.h;
    const slack = Math.max(0.6, mm(12));
    let best: Pick | null = null;
    let area = Infinity;
    // The smallest part under the pointer wins (the battery pack lies under half the board).
    for (const p of onBoard) {
      const [bx, by, bw, bh] = p.inst.part!.box;
      const m = Math.max(0, slack - Math.min(bw, bh) / 2);
      if (x >= bx - m && x <= bx + bw + m && y >= by - m && y <= by + bh + m && bw * bh < area) {
        area = bw * bh;
        best = { t: "part", id: p.inst.id };
      }
    }
    if (best && area < 400) return best;
    for (const t of tags) if (Math.abs(y - t.py) < slack && x >= t.x0 - 1 && x <= t.x1 + 1) return { t: "part", id: t.id };
    for (const [qx, qy, , n] of B.launchpad.pins) if (Math.abs(x - qx) < 1.27 && Math.abs(y - qy) < 1.27) return { t: "pin", n };
    for (const [qx, qy, net] of B.holes) if (Math.abs(x - qx) < 1.1 && Math.abs(y - qy) < 1.1) return { t: "net", net };
    return best;
  };
  const release = () => {
    if (holding) onHold(holding, false);
    setHolding("");
  };

  // ----- the keyboard: two groups the arrow keys move through -----
  const partKey = (e: React.KeyboardEvent) => {
    const at = Math.max(0, order.indexOf(selected));
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : (at + step + order.length) % order.length;
      onPick({ t: "part", id: order[next] }, true);
    } else if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      onPick({ t: "part", id: order[at] }, true);
      if (holdable(order[at])) {
        setHolding(order[at]);
        onHold(order[at], true);
      }
    } else if (e.key === "Escape") onPick(null, true);
  };
  const pinKey = (e: React.KeyboardEvent) => {
    const here = PIN_AT.get(pinCursor)!;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (dir) {
      e.preventDefault();
      let best = pinCursor;
      let cost = Infinity;
      for (const q of B.launchpad.pins) {
        const dx = (q[0] - here[0]) * dir[0] + (q[1] - here[1]) * dir[1];
        const off = Math.abs((q[0] - here[0]) * dir[1]) + Math.abs((q[1] - here[1]) * dir[0]);
        if (dx > 0.5 && dx + off * 4 < cost) {
          cost = dx + off * 4;
          best = q[3];
        }
      }
      setPinCursor(best);
      onPick({ t: "pin", n: best }, true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick({ t: "pin", n: pinCursor }, true);
    } else if (e.key === "Escape") onPick(null, true);
  };

  const sel = onBoard.find((p) => p.inst.id === selected);
  const cursorPin = PIN_AT.get(pick?.t === "pin" ? pick.n : pinCursor)!;
  const name = (l: Label, cls = "wb-halo") => (
    <text key={l.key} x={l.x} y={l.y} fontSize={tag} textAnchor={l.anchor} fill="var(--pcb-ink)" className={cls}>{l.text}</text>
  );
  // The keyboard's two stops are real buttons laid over the picture: one on the chosen part, one on a LaunchPad pin.
  const over = (x: number, y: number, w: number, h: number): React.CSSProperties => {
    const side = (v: number) => Math.max(24, v * px + 8);
    // Placed by its centre (the style sheet shifts it by half its size), so a larger touch size stays centred.
    return { left: (x + w / 2) * px, top: (y + h / 2) * px, width: side(w), height: side(h) };
  };
  const pinNet = cursorPin[2];
  return (
    <div className="wb-stage" style={{ width: B.w * px, height: B.h * px }}>
    <svg
      ref={svg}
      className="wb-board"
      viewBox={`0 0 ${B.w} ${B.h}`}
      width={B.w * px}
      height={B.h * px}
      role="img"
      aria-label={label}
      onPointerMove={(e) => e.pointerType === "mouse" && !holding && onPick(under(e), false)}
      onPointerLeave={(e) => {
        // Onto the button that now lies over the pressed part: the press goes on there.
        if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest(".wb-focus"))) release();
        onPick(null, false);
      }}
      onPointerDown={(e) => {
        const p = under(e);
        onPick(p, true);
        if (p?.t === "part" && holdable(p.id)) {
          setHolding(p.id);
          onHold(p.id, true);
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <Still px={px} />
      {routes.length > 0 && <AllRoutes nets={routes} />}
      {/* What is lit up: its copper (top solid, bottom dashed), every pad of it, and its LaunchPad pin. */}
      {light && (
        <g aria-hidden="true" data-light={light.near.map((n) => B.nets[n]).join(" ")}>
          {light.far.map((net) => (
            <g key={`f${net}`} fill="none" stroke="var(--pcb-ink)" strokeLinecap="round">
              <path d={(TRACES.get(net)?.[0] ?? "") + (TRACES.get(net)?.[1] ?? "")} strokeWidth={0.5} strokeDasharray="0.1 0.9" />
              <path d={PADS.get(net) ?? ""} strokeWidth={0.25} strokeDasharray="0.4 0.4" />
            </g>
          ))}
          {light.near.map((net) => (
            <g key={net} fill="none" stroke="var(--focus)" strokeLinecap="round" strokeLinejoin="round">
              <path d={TRACES.get(net)?.[0] ?? ""} strokeWidth={0.85} />
              <path d={TRACES.get(net)?.[1] ?? ""} strokeWidth={0.85} strokeDasharray="1.5 1" />
              <path d={PADS.get(net) ?? ""} strokeWidth={0.4} />
              {pinsOfNet(net).map(([n, x, y]) => <rect key={n} x={x - 1.25} y={y - 1.25} width={2.5} height={2.5} strokeWidth={0.5} />)}
            </g>
          ))}
        </g>
      )}
      <g>
        {onBoard.map(({ inst, status }) => (
          <g key={inst.id} className="wb-part" data-part={inst.id} data-state={status.text}>
            <title>{`${inst.label}: ${status.text}`}</title>
            {inst.def.draw!(inst, status, inst.part!.box).map((s, k) => shape(s, k, px))}
          </g>
        ))}
        {sel && (
          <rect className="wb-cursor" x={sel.inst.part!.box[0] - 1.2} y={sel.inst.part!.box[1] - 1.2} width={sel.inst.part!.box[2] + 2.4} height={sel.inst.part!.box[3] + 2.4} rx={1} fill="none" stroke="var(--focus)" strokeWidth={Math.max(0.5, mm(2.5))} strokeDasharray={`${mm(6)} ${mm(3)}`} />
        )}
      </g>
      {tags.map((t) => (
        <g key={t.key} className="wb-part" data-part={t.id}>
          <line x1={t.px} y1={t.py} x2={t.x2} y2={t.py} stroke="var(--pcb-ink)" strokeWidth={t.id === selected ? 0.7 : 0.4} strokeDasharray="1.2 0.6" />
          <path d={`M${t.px - 1.3},${t.py}l1.3,-1.3 1.3,1.3 -1.3,1.3z`} fill="var(--accent)" stroke="var(--pcb-ink)" strokeWidth={0.25} />
          {t.text && name(t)}
        </g>
      ))}
      <g aria-hidden="true">
        {pinNames.map((l) => name(l, "wb-halo wb-pinname"))}
        {labels.map((l) => name(l))}
        {lightLabels.map((l) => name(l, "wb-halo wb-lightname"))}
      </g>
      {pick?.t === "pin" && <rect aria-hidden="true" x={cursorPin[0] - 1.9} y={cursorPin[1] - 1.9} width={3.8} height={3.8} rx={0.6} fill="none" stroke="var(--focus)" strokeWidth={Math.max(0.5, mm(2.5))} />}
    </svg>
      {sel && (
        <button
          type="button"
          className="wb-focus"
          data-keys="parts"
          style={over(...sel.inst.part!.box)}
          aria-label={`${sel.inst.label}: ${sel.status.text}. Arrow keys move to the other parts${holdable(sel.inst.id) ? "; hold Space to press it" : ""}.`}
          aria-pressed={holdable(sel.inst.id) ? holding === sel.inst.id : undefined}
          onKeyDown={partKey}
          onKeyUp={(e) => (e.key === " " || e.key === "Enter") && release()}
          onBlur={release}
          onFocus={() => onPick({ t: "part", id: sel.inst.id }, true)}
          onPointerDown={() => {
            onPick({ t: "part", id: sel.inst.id }, true);
            if (holdable(sel.inst.id)) {
              setHolding(sel.inst.id);
              onHold(sel.inst.id, true);
            }
          }}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
        />
      )}
      <button
        type="button"
        className="wb-focus"
        data-keys="pins"
        style={over(cursorPin[0] - 0.6, cursorPin[1] - 0.6, 1.2, 1.2)}
        aria-label={`LaunchPad pin ${cursorPin[3]}: ${pinNet < 0 ? "not connected" : B.nets[pinNet]}. Arrow keys move over the pins; the sentence under the picture says what is on each.`}
        onKeyDown={pinKey}
        onFocus={() => onPick({ t: "pin", n: cursorPin[3] }, true)}
        onPointerDown={() => onPick({ t: "pin", n: cursorPin[3] }, true)}
      />
    </div>
  );
}

/** The legend of the picture: how a state and a kind of connection look, in words and a sample each. */
export function Legend({ routes }: { routes: boolean }) {
  const swatch = (children: React.ReactNode) => (
    <svg viewBox="0 0 16 8" width="32" height="16" aria-hidden="true" className="wb-swatch">
      <rect width="16" height="8" fill="var(--pcb)" />
      {children}
    </svg>
  );
  const ink = "var(--pcb-ink)";
  return (
    <ul className="wb-legend" aria-label="Legend of the picture">
      <li>{swatch(<><rect x="6" y="1.5" width="4" height="5" fill="var(--accent)" stroke={ink} strokeWidth="0.5" /><path d="M2.5,4h2M11.5,4h2M3,1.5l1.5,1M13,1.5l-1.5,1" stroke={ink} strokeWidth="0.5" /></>)} LED on: filled, with rays</li>
      <li>{swatch(<><circle cx="8" cy="4" r="1.6" fill="var(--accent)" stroke={ink} strokeWidth="0.5" /><circle cx="8" cy="4" r="3" fill="none" stroke={ink} strokeWidth="0.5" /></>)} Button pressed: filled, in a second ring</li>
      <li>{swatch(<><path d="M5,4L11,2.5" stroke={ink} strokeWidth="0.6" /><circle cx="11" cy="2.5" r="1.6" fill="none" stroke={ink} strokeWidth="0.5" /></>)} Joystick: the knob moves off centre</li>
      <li>{swatch(<><circle cx="5" cy="5" r="1" fill="none" stroke={ink} strokeWidth="0.5" /><path d="M5,5L11,2" stroke="var(--accent)" strokeWidth="1.1" /></>)} Servo: the horn turns; its name gives the angle</li>
      <li>{swatch(<><rect x="4" y="1.5" width="8" height="5" fill="none" stroke={ink} strokeWidth="0.5" strokeDasharray="1 0.8" /><path d="M4,1.5l8,5M12,1.5l-8,5" stroke={ink} strokeWidth="0.5" /></>)} Not soldered: dashed box with a cross</li>
      <li>{swatch(<><path d="M1,2.5H15" stroke="var(--focus)" strokeWidth="1.2" /><path d="M1,5.5H15" stroke="var(--focus)" strokeWidth="1.2" strokeDasharray="2 1.4" /></>)} Lit-up connection: solid on the top of the board, dashed on the bottom</li>
      {routes && NET_KINDS.map((k) => (
        <li key={k.id}>{swatch(<path d="M1,4H15" stroke={ink} strokeWidth={Math.max(0.6, KIND_STYLE[k.id].w * 1.6)} strokeDasharray={KIND_STYLE[k.id].dash} strokeLinecap="round" />)} {k.name}</li>
      ))}
    </ul>
  );
}
