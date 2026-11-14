// The real FFT of TI's FPU DSP library (C2000Ware, libraries/dsp/FPU:
// fpu32/fpu_rfft.h) as the course's fftDMAstarter project uses it, and the
// robot board's microphone on ADCINB4.
//
// Library (only the header is public; these are written for this game and
// follow the "C28x FPU Library" user's guide for RFFT_f32):
// - RFFT_F32_STRUCT and RFFT_F32_STRUCT_Handle, with the fields of the header.
// - RFFT_f32_sincostable(h): fills CosSinBuf. The transform here does not
//   read the table (its layout in TI's library is not documented), but a
//   program that never called it gets a diagnostic, because on the chip the
//   transform would then use garbage.
// - RFFT_f32(h), RFFT_f32u(h): FFT of the FFTSize real numbers in InBuf, not
//   scaled. OutBuf[k] is the real part of bin k for k = 0 .. N/2 and
//   OutBuf[N - k] the imaginary part of bin k for k = 1 .. N/2 - 1, with the
//   sign convention X[k] = sum x[n] exp(-j 2 pi k n / N). InBuf is left as
//   it was.
// - RFFT_f32_mag(h), RFFT_f32s_mag(h) and the _TMU0 names: MagBuf[k] =
//   sqrt(re^2 + im^2) for k = 0 .. N/2 (N/2 + 1 numbers). A sine of
//   amplitude A exactly on bin k gives MagBuf[k] = A N / 2.
// - RFFT_f32_phase(h) and RFFT_f32_phase_TMU0(h): PhaseBuf[k] = atan2(im, re)
//   for k = 0 .. N/2.
// Bin k of an N-point FFT of samples taken fs times a second is the
// frequency k fs / N.
// Time: the calls take a nominal time (5 SYSCLK cycles per butterfly, 50 per
// square root, 200 per arctangent), about 0.26 ms for the 1024-point FFT.
// Not provided: the complex FFT (CFFT_f32), the windows, RFFT_adc_f32, the
// ready-made twiddle table RFFT_f32_twiddleFactors, FIR and IIR filters.
//
// Microphone (robot board): the starter samples it on ADCINB4. Here it is a
// pure tone: 1.5 V + MIC_AMPL_V * sin(2 pi MIC_TONE_HZ t), limited to 0..3 V,
// evaluated at the instant the ADC samples, so aliasing above half the
// sampling rate is the ADC's own. Inputs: MIC_TONE_HZ (0 = silence, a steady
// 1.5 V; the robot kit's knob, which starts at 1000 Hz) and MIC_AMPL_V
// (default 1). A level or test that sets ADCINB4 itself overrides the
// microphone. It costs nothing while no program converts ADCINB4. Not
// modelled: the microphone's amplifier, its real bias voltage, noise, or
// real sound.

import type { Board } from "../board";
import { RuntimeError, bitsFloat, floatBits } from "../cc/compile";
import type { SimPlugin } from "../plugin";

/** In-place radix-2 FFT of re + j im (length a power of two), X[k] = sum x[n] exp(-j 2 pi k n / N). */
export function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

const PRELUDE = `
// ---- TI FPU DSP library: fpu32/fpu_rfft.h
typedef struct {
    float *InBuf;
    float *OutBuf;
    float *CosSinBuf;
    float *MagBuf;
    float *PhaseBuf;
    uint16_t FFTSize;
    uint16_t FFTStages;
} RFFT_F32_STRUCT;
typedef RFFT_F32_STRUCT* RFFT_F32_STRUCT_Handle;
void RFFT_f32(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32u(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32_mag(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32s_mag(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32_phase(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32_mag_TMU0(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32s_mag_TMU0(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32_phase_TMU0(RFFT_F32_STRUCT_Handle hndRFFT_F32);
void RFFT_f32_sincostable(RFFT_F32_STRUCT_Handle hndRFFT_F32);
`;

// Word offsets in RFFT_F32_STRUCT: five pointers of two words, then two 16-bit numbers.
const IN = 0;
const OUT = 2;
const COSSIN = 4;
const MAG = 6;
const PHASE = 8;
const SIZE = 10;
const STAGES = 11;

function install(b: Board): void {
  const c = b.compiler;
  const mem = b.mem;
  const tables = new Set<number>();

  interface Handle {
    h: number;
    n: number;
  }
  const handle = (h: number, fn: string): Handle => {
    if (!h) throw new RuntimeError(b.line, `${fn} was given a NULL handle. Pass the address of your RFFT_F32_STRUCT, for example ${fn}(&rfft);`);
    const n = mem.peek(h + SIZE, 1);
    const stages = mem.peek(h + STAGES, 1);
    if (n < 4 || n > 4096 || (n & (n - 1)) !== 0)
      throw new RuntimeError(b.line, `${fn}: FFTSize is ${n}. It must be a power of two from 4 to 4096, set before the call (hnd_rfft->FFTSize = 1024;).`);
    if (1 << stages !== n)
      throw new RuntimeError(b.line, `${fn}: FFTSize is ${n} but FFTStages is ${stages}. FFTSize must be 2 to the power FFTStages (1024 goes with 10).`);
    return { h, n };
  };
  const buf = (x: Handle, off: number, field: string, fn: string): number => {
    const p = mem.peek(x.h + off, 2);
    if (!p) throw new RuntimeError(b.line, `${fn}: the ${field} pointer of the structure is NULL. Point it to your array before the call (hnd_rfft->${field} = &array[0];).`);
    return p;
  };
  const busy = (ns: number) => {
    b.delay(ns);
    mem.liveReads++;
  };
  const put = (addr: number, v: number) => mem.write(addr, 2, floatBits(Math.fround(v)));
  const get = (addr: number) => bitsFloat(mem.peek(addr, 2));
  const def = (names: string[], fn: (h: number, name: string) => void) => {
    for (const name of names) {
      c.defineNative(name, (a) => (fn(a[0] >>> 0, name), 0));
      c.fns.get(name)!.waits = true;
    }
  };

  def(["RFFT_f32_sincostable"], (h, name) => {
    const x = handle(h, name);
    const t = buf(x, COSSIN, "CosSinBuf", name);
    // One quarter-wave table per stage, N - 4 numbers in all, which fits the N the starter reserves.
    let at = t;
    for (let len = 4; len <= x.n; len <<= 1)
      for (let k = 0; k < len / 2; k++, at += 2) put(at, k % 2 ? Math.sin((Math.PI * (k + 1)) / len) : Math.cos((Math.PI * k) / len));
    tables.add(t);
    busy(x.n * 1000);
  });

  def(["RFFT_f32", "RFFT_f32u"], (h, name) => {
    const x = handle(h, name);
    const src = buf(x, IN, "InBuf", name);
    const dst = buf(x, OUT, "OutBuf", name);
    if (!tables.has(mem.peek(h + COSSIN, 2)))
      b.warn(b.line, "fft-no-table", `${name} needs its table of sines and cosines. Set CosSinBuf to an array of FFTSize floats and call RFFT_f32_sincostable(hnd_rfft); once before the first transform.`);
    const re = new Float64Array(x.n);
    const im = new Float64Array(x.n);
    for (let i = 0; i < x.n; i++) re[i] = get(src + 2 * i);
    fftRadix2(re, im);
    for (let k = 0; k <= x.n / 2; k++) put(dst + 2 * k, re[k]);
    for (let k = 1; k < x.n / 2; k++) put(dst + 2 * (x.n - k), im[k]);
    busy((x.n / 2) * mem.peek(h + STAGES, 1) * 5 * 5);
  });

  const bin = (dst: number, n: number, k: number): [number, number] => [get(dst + 2 * k), k > 0 && k < n / 2 ? get(dst + 2 * (n - k)) : 0];
  def(["RFFT_f32_mag", "RFFT_f32s_mag", "RFFT_f32_mag_TMU0", "RFFT_f32s_mag_TMU0"], (h, name) => {
    const x = handle(h, name);
    const dst = buf(x, OUT, "OutBuf", name);
    const mag = buf(x, MAG, "MagBuf", name);
    for (let k = 0; k <= x.n / 2; k++) {
      const [r, i] = bin(dst, x.n, k);
      put(mag + 2 * k, Math.hypot(r, i));
    }
    busy((x.n / 2) * 50 * 5);
  });
  def(["RFFT_f32_phase", "RFFT_f32_phase_TMU0"], (h, name) => {
    const x = handle(h, name);
    const dst = buf(x, OUT, "OutBuf", name);
    const ph = buf(x, PHASE, "PhaseBuf", name);
    for (let k = 0; k <= x.n / 2; k++) {
      const [r, i] = bin(dst, x.n, k);
      put(ph + 2 * k, Math.atan2(i, r));
    }
    busy((x.n / 2) * 200 * 5);
  });

  // The microphone on ADCINB4.
  b.sources.set("ADCINB4", (t) => {
    const hz = b.input("MIC_TONE_HZ", 0);
    if (hz <= 0) return 1.5;
    const v = 1.5 + b.input("MIC_AMPL_V", 1) * Math.sin(2 * Math.PI * hz * (t / 1e9));
    return Math.max(0, Math.min(3, v));
  });
}

export const plugin: SimPlugin = {
  name: "course-fft",
  prelude: PRELUDE,
  install,
  parts: {
    robot: [
      { kind: "knob", id: "MIC_TONE", label: "Tone at the microphone (ADCINB4), 0 = silence", input: "MIC_TONE_HZ", min: 0, max: 5000, step: 10, initial: 1000, unit: "Hz" },
    ],
  },
};
