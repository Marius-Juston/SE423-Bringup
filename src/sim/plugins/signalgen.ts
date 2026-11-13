// Test bench signal source for filter practice. This is NOT a chip feature:
// every C name starts with tb_ so that students can tell it from the course
// library. It stands in for "a sensor on an ADC pin" in levels that are about
// what happens to the samples afterwards (Lectures 8-9: Nyquist, aliasing,
// FIR filters, ping-pong buffers).
//
// The signal is described by inputs of the signal bus, set by a level with
// stimuli (usually at time 0):
//   TB_F1_HZ, TB_A1   first sine: frequency in Hz and amplitude (default 100 Hz, 1.0)
//   TB_F2_HZ, TB_A2   second sine (default off)
//   TB_NOISE          amplitude of uniform pseudo-random noise in [-1, 1) (default 0)
//   TB_DC             constant offset (default 0)
//   TB_FS_HZ          sampling rate in Hz (default 10000, the course's 0.1 ms)
//
//   x[n] = TB_DC + TB_A1 sin(2 pi TB_F1_HZ n / TB_FS_HZ)
//                + TB_A2 sin(2 pi TB_F2_HZ n / TB_FS_HZ) + TB_NOISE u[n]
//
// u[n] depends only on n, so every run gives the same numbers.
//
// C interface (prototypes in the prelude below):
//   float tb_sample(void)        x[n], then n = n + 1. One sample per call, whatever the time is.
//   void tb_output(float y)      publishes y as the output "TB_OUT" (for `signal` checks and meters).
//   void tb_stream(uint16_t *p)  from now on the test bench stores a new sample at *p every
//                                1 / TB_FS_HZ seconds, as a 12-bit ADC reading of 1.5 V + x[n] volts
//                                (0 V = 0, 3 V = 4095, clipped). It plays the role of an ADC result
//                                register for DMA practice. tb_stream(0) stops it.
// tb_sample and tb_stream share the sample counter n. The last sample is
// also published as "TB_IN".
//
// Analog feed: setting the input "TB_FEED_ADCIN<A-D><0-15>" (for example
// "TB_FEED_ADCINA4") to 1 makes the test bench drive that ADC input with
// TB_FEED_MID (default 1.5 V) + TB_FEED_GAIN (default 1 V per unit) times the
// same waveform evaluated in continuous time, clipped to 0..3 V and updated
// TB_FEED_HZ times per second (default 100000). An ADC model can then sample
// it at any rate, so aliasing comes from the ADC's own sampling. Nothing here
// depends on an ADC plugin being present.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";

/** Deterministic uniform noise in [-1, 1) from an integer (mulberry32 finaliser). */
export function tbNoise(n: number): number {
  let z = (Math.imul(n | 0, 0x9e3779b1) + 0x6d2b79f5) | 0;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return (((z ^ (z >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}

interface Shape {
  f1: number;
  a1: number;
  f2: number;
  a2: number;
  noise: number;
  dc: number;
  fs: number;
}

const shape = (b: Board): Shape => ({
  f1: b.input("TB_F1_HZ", 100),
  a1: b.input("TB_A1", 1),
  f2: b.input("TB_F2_HZ", 0),
  a2: b.input("TB_A2", 0),
  noise: b.input("TB_NOISE", 0),
  dc: b.input("TB_DC", 0),
  fs: Math.max(1e-3, b.input("TB_FS_HZ", 10000)),
});

/** The waveform at time `sec`; `k` selects the noise value. */
function wave(s: Shape, sec: number, k: number): number {
  const w = 2 * Math.PI * sec;
  return s.dc + s.a1 * Math.sin(w * s.f1) + s.a2 * Math.sin(w * s.f2) + (s.noise ? s.noise * tbNoise(k) : 0);
}

/** Sample n of the test bench signal for the given settings (also used by tests). */
export function tbSampleAt(s: Partial<Shape>, n: number): number {
  const full: Shape = { f1: 100, a1: 1, f2: 0, a2: 0, noise: 0, dc: 0, fs: 10000, ...s };
  return Math.fround(wave(full, n / full.fs, n));
}

/** 12-bit ADC reading of a voltage with a 3.0 V reference. */
const adcCode = (volts: number) => Math.max(0, Math.min(4095, Math.floor((volts * 4096) / 3.0)));

export const plugin: SimPlugin = {
  name: "signalgen",
  prelude: `
// ---- test bench (not part of the chip or the course library)
float tb_sample(void);
void tb_output(float y);
void tb_stream(uint16_t *where);
`,
  install(b) {
    let n = 0;
    const next = (): number => {
      const s = shape(b);
      const x = Math.fround(wave(s, n / s.fs, n));
      n++;
      b.mem.writes++;
      b.publish("TB_IN", x);
      return x;
    };
    b.compiler.defineNative("tb_sample", () => next());
    b.compiler.defineNative("tb_output", (a) => {
      b.publish("TB_OUT", Math.fround(a[0]));
      b.mem.writes++;
      return 0;
    });

    // tb_stream: a sample lands in the student's variable every 1 / TB_FS_HZ.
    let streamAddr = 0;
    let streamEv: ReturnType<Board["at"]> | null = null;
    const streamTick = (t: number) => {
      streamEv = null;
      if (!streamAddr) return;
      b.mem.poke(streamAddr, 1, adcCode(1.5 + next()));
      streamEv = b.at(t + 1e9 / shape(b).fs, streamTick);
    };
    b.compiler.defineNative("tb_stream", (a) => {
      b.cancel(streamEv);
      streamEv = null;
      streamAddr = a[0] >>> 0;
      b.mem.writes++;
      if (streamAddr) streamEv = b.at(b.now + 1e9 / shape(b).fs, streamTick);
      return 0;
    });

    // Analog feed to ADC inputs, in continuous time.
    const feeds = new Map<string, ReturnType<Board["at"]> | null>();
    let k = 0;
    const feedTick = (pin: string) => (t: number) => {
      if (!feeds.has(pin)) return;
      const v = b.input("TB_FEED_MID", 1.5) + b.input("TB_FEED_GAIN", 1) * wave(shape(b), t / 1e9, k++);
      b.setInput(pin, Math.max(0, Math.min(3, v)), t);
      feeds.set(pin, b.at(t + 1e9 / Math.max(1, b.input("TB_FEED_HZ", 100000)), feedTick(pin)));
    };
    for (const m of "ABCD")
      for (let ch = 0; ch < 16; ch++) {
        const pin = `ADCIN${m}${ch}`;
        b.onInput(`TB_FEED_${pin}`, (v, t) => {
          b.cancel(feeds.get(pin));
          feeds.delete(pin);
          if (v > 0) {
            feeds.set(pin, null);
            feedTick(pin)(t);
          }
        });
      }
  },
};
