// The simulated buzzer, made audible. The simulator publishes the tone the
// buzzer pin produces (BUZZER_HZ); this plays it through the computer's
// speakers with the Web Audio API. A square wave, like the real pin, kept
// quiet. Sound needs a click first (browsers insist): pressing Run counts.

const KEY = "bringup-sound-v1";
const VOLUME = 0.05;

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* the choice just does not persist */
  }
  if (!on) hush();
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** Stop the live tone. */
export function hush(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
}

/**
 * The buzzer is sounding at `hz` right now (0 or less: silent). Call it on
 * every frame of a live run: when the calls stop (paused, stopped, the
 * panel closed) the tone fades out by itself.
 */
export function buzz(hz: number): void {
  if (!soundOn() || !(hz >= 20 && hz <= 20000)) return hush();
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  if (!osc || !gain) {
    osc = c.createOscillator();
    osc.type = "square";
    gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(c.destination);
    osc.start();
  }
  osc.frequency.setTargetAtTime(hz, c.currentTime, 0.003);
  gain.gain.setTargetAtTime(VOLUME, c.currentTime, 0.008);
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(hush, 250);
}

/**
 * Plays a recorded tone history (times in ns, as the simulator stores
 * them) in real time. Returns a function that stops it early, and the
 * length in seconds.
 */
export function playTones(history: { t: number; v: number }[], endNs: number, done: () => void): { stop: () => void; seconds: number } | null {
  const c = context();
  if (!c || !history.length) return null;
  if (c.state === "suspended") void c.resume().catch(() => {});
  hush();
  const t0 = history.find((h) => h.v >= 20)?.t ?? history[0].t;
  const seconds = Math.min(30, Math.max(0.05, (endNs - t0) / 1e9));
  const o = c.createOscillator();
  o.type = "square";
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  const start = c.currentTime + 0.05;
  for (const h of history) {
    const at = start + Math.max(0, (h.t - t0) / 1e9);
    if (at > start + seconds) break;
    const on = h.v >= 20 && h.v <= 20000;
    if (on) o.frequency.setValueAtTime(h.v, at);
    g.gain.setValueAtTime(on ? VOLUME : 0, at);
  }
  g.gain.setValueAtTime(0, start + seconds);
  o.start(start);
  o.stop(start + seconds + 0.05);
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    done();
  };
  o.onended = finish;
  return {
    seconds,
    stop: () => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
      finish();
    },
  };
}
