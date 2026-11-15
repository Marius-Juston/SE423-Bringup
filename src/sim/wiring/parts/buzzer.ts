// A piezo buzzer: it sounds while a square wave between 20 Hz and 20 kHz
// drives it; a steady level is silent (HW3 plays notes by changing the
// frequency). On the board it hangs behind an inverter of IC3 and a 100 ohm
// resistor, and a jumper decides whether GPIO16 reaches that inverter.
// Not modelled: loudness against frequency, the piezo's resonance.
import { fitted } from "../bench";
import type { BenchView, Inst, PartDef } from "../types";
import { circle, empty, notDriven } from "./_draw";

/** "" when the pin's signal reaches the buzzer, else why not. */
function blocked(i: Inst, b: BenchView): string {
  if (!i.part) return i.conn.gnd === "GND" ? "" : "Its other leg is not on GND.";
  const j = b.inst(i.part.jumper ?? "");
  if (j && (!fitted(j) || j.opts.pos !== "pin"))
    return j.opts.pos === "gnd" && fitted(j) ? `The buzzer's jumper joins the buzzer's input to GND, so ${i.conn.sig} never reaches it. Move the jumper to the ${i.conn.sig} position.` : `The buzzer's jumper is missing, so ${i.conn.sig} never reaches the buzzer. Put it on the ${i.conn.sig} position.`;
  if (i.part.via && !fitted(b.inst(i.part.via))) return `Inverter chip ${i.part.via}, between the jumper and the buzzer, is not soldered.`;
  return "";
}

export const part: PartDef = {
  kind: "buzzer",
  name: "Buzzer",
  description: "A piezo that sounds at the frequency of the square wave on its pin.",
  addable: true,
  terminals: [
    { id: "sig", name: "signal leg", role: "pwm" },
    { id: "gnd", name: "other leg", role: "ground" },
  ],
  onBoard: (p) => ({ sig: `GPIO${p.pin}`, gnd: "GND" }),
  works: (i, b) => blocked(i, b) === "",
  edge(i, r, t, level) {
    if (level !== 1) return;
    const w = r.pin(t)?.wave;
    const why = w && w.hz >= 20 && w.hz <= 20000 ? blocked(i, r) : "";
    if (why) r.warn(i, "buzzer-silent", `${t} carries a ${w!.hz.toFixed(0)} Hz tone and the buzzer is silent. ${why}`);
  },
  status(i, b) {
    if (!b.board) return { text: "no program running" };
    const why = blocked(i, b);
    if (why) return { text: "silent", level: 0, why };
    const w = b.pin(i.conn.sig)?.wave;
    if (!w) return { text: "silent", level: 0, why: notDriven(b, i.conn.sig, "set up its ePWM") };
    if (w.hz < 20 || w.hz > 20000) return { text: "silent", level: 0, why: `${i.conn.sig} carries ${w.hz.toFixed(0)} Hz, which is outside what you can hear (20 Hz to 20 kHz).` };
    return { text: `sounding at ${w.hz.toFixed(0)} Hz`, level: 1 };
  },
  draw(i, s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    const cx = x + w / 2;
    const cy = y + h / 2;
    // Sounding: a filled centre and two rings of sound around it.
    return [circle(cx, cy, w / 2, "part"), circle(cx, cy, w * 0.12, s.level ? "lit" : "dark"), ...(s.level ? [circle(cx, cy, w * 0.24, "metal", false), circle(cx, cy, w * 0.36, "metal", false)] : [])];
  },
};
