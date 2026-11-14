// printf formatting as the TI C28x library does it for the course's projects
// (COFF ABI, --printf_support=full). printf, sprintf, serial_printf and
// UART_printfLine all end in the same formatter (the course's serial_printf and
// UART_printfLine call vsprintf), so one function serves them all.
//
// Source: TMS320C28x Optimizing C/C++ Compiler User's Guide, SPRU514X.
//  - 6.3, Table 6-1: char, short and int are 16 bits, long is 32 bits, long long
//    64 bits, float and (COFF) double 32 bits, long double 64 bits, pointers 32
//    bits. So hh and h change nothing, l means 32 bits, ll and j mean 64 bits.
//  - 6.3.2, 6.3.3: long long needs ll in the format, long double needs L.
//  - 7.1.2, 7.3.1, 7.3.2: the stack grows towards higher addresses, arguments are
//    put on it in reverse order (the leftmost at the highest address, just under
//    the format string), every 32-bit argument sits at an even address, and a
//    long or float has its least significant word at the lower address.
//    The library walks DOWN from the format string. So a conversion that takes
//    one word where a 32-bit value lies gets its UPPER half first, and a 32-bit
//    conversion always starts again at the next even address.
//  - J.3.12: %p prints like %x of the pointer's size (32 bits, no 0x); infinity
//    and not-a-number print as inf and nan (INF and NAN for F, E, G, A).
//  - 2.3 (--printf_support): "full" supports every specifier, n, a and A included.
//  - 8.2.1.1: each conversion except %s is built in a buffer of 510 characters
//    (FORMAT_CONVERSION_BUFSIZE).
//
// Not modelled:
//  - long long and long double values. The simulator's C has neither, so %lld,
//    %llu, %jd and %Lf can never be given a matching value: they read the words
//    the chip would read and always report a diagnostic.
//  - The library's own rounding in 32-bit arithmetic. Digits are those of the
//    exact value of the float, so beyond about 7 significant digits the board
//    may show other digits.
//  - What lies on the stack under the last argument, and in the word skipped to
//    reach an even address: both read as 0 here.
//  - size_t and ptrdiff_t are taken as 32 bits (z and t act like l), as the
//    simulator's size_t is; the guide does not print their types.

export interface PrintfArg {
  kind: "int" | "float" | "ptr";
  /** 16-bit words the value takes: 1 or 2. */
  words: number;
  /** Raw bits (16 or 32). */
  bits: number;
  value: number;
  /** Integers: whether the C type is signed. */
  signed?: boolean;
  /** The C type as the student wrote it, for messages ("uint32_t"). */
  type?: string;
}

/** One 16-bit word of the argument area. Offset 1 is the word just under the format string. */
export interface PrintfCell {
  offset: number;
  word: number;
  /** Index of the argument the word belongs to. A skipped word belongs to the argument it makes room for. */
  arg: number;
  part: "only" | "high" | "low" | "skipped";
}

export interface PrintfConv {
  /** The conversion as written, for example "%-5ld". */
  spec: string;
  /** Where it starts in the format string. */
  at: number;
  conv: string;
  /** The characters it produced. */
  text: string;
  /** Offsets of the words it read, in the order it met them (highest address first). */
  read: number[];
  /** The argument it printed, when the conversion and the argument fit. */
  arg?: number;
  /** What went wrong, when something did. */
  problem?: { code: string; msg: string };
}

export interface PrintfTrace {
  text: string;
  cells: PrintfCell[];
  convs: PrintfConv[];
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The library formats each conversion (except %s) in a buffer of this many characters. */
const CONVERSION_BUF = 510;

/**
 * a (not negative) with prec digits after the point. A value exactly half
 * way between two results goes to the even one, as the C library does
 * (2.5 prints as 2 with %.0f); JavaScript's toFixed always rounds it up.
 */
function fixed(a: number, prec: number): string {
  if (prec > 100) return a.toFixed(100) + "0".repeat(prec - 100);
  const up = a.toFixed(prec);
  if (prec > 40) return up;
  const exact = a.toFixed(prec + 50);
  if (!/^50*$/.test(exact.slice(exact.length - 50))) return up;
  const down = exact.slice(0, exact.length - 50).replace(/\.$/, "");
  return "02468".includes(down[down.length - 1]) ? down : up;
}

/**
 * a (not negative) as d.ddde+XX with prec digits after the point and at least two exponent
 * digits. A value exactly half way goes to the even digit, as with fixed().
 */
function expo(a: number, prec: number): string {
  const p = Math.min(prec, 100);
  let s = a.toExponential(p);
  if (p <= 70) {
    const exact = a.toExponential(p + 30);
    const [mant, ex] = exact.split("e");
    if (/^50*$/.test(mant.slice(mant.length - 30))) {
      const down = mant.slice(0, mant.length - 30).replace(/\.$/, "");
      if ("02468".includes(down[down.length - 1])) s = `${down}e${ex}`;
    }
  }
  if (prec > p) s = s.replace("e", "0".repeat(prec - p) + "e");
  return s.replace(/e([+-])(\d)$/, "e$10$2");
}

/** a (not negative, finite) as a hexadecimal floating-point number: 0x1.8p+1 is 3. */
function hexFloat(a: number, prec: number | undefined): string {
  if (a === 0) return `0x0${prec ? "." + "0".repeat(prec) : ""}p+0`;
  let e = Math.floor(Math.log2(a));
  let m = a / 2 ** e;
  if (m < 1) (e -= 1), (m *= 2);
  if (m >= 2) (e += 1), (m /= 2);
  // A double has 13 hexadecimal digits after the point, so this product is exact.
  const digits = prec === undefined ? 13 : Math.min(prec, 13);
  const scale = 16 ** digits;
  let n = m * scale;
  const fl = Math.floor(n);
  const rest = n - fl;
  n = rest > 0.5 || (rest === 0.5 && fl % 2 === 1) ? fl + 1 : fl;
  if (n >= 2 * scale) (n /= 2), (e += 1);
  let frac = digits ? (n - scale).toString(16).padStart(digits, "0") : "";
  if (prec === undefined) frac = frac.replace(/0+$/, "");
  else frac = frac.padEnd(prec, "0");
  return `0x1${frac ? "." + frac : ""}p${e < 0 ? "-" : "+"}${Math.abs(e)}`;
}

const INT_CONVS = "diuoxXc";
const FLOAT_CONVS = "fFeEgGaA";
const ALL_CONVS = INT_CONVS + FLOAT_CONVS + "spn%";

const describe = (a: PrintfArg): string => {
  if (a.kind === "float") return "a float (32 bits)";
  if (a.kind === "ptr") return "a string or a pointer (32 bits)";
  const bits = a.words === 2 ? "32 bits" : "16 bits";
  if (a.type) return `${a.type.startsWith("int") ? "an" : "a"} ${a.type} (${bits})`;
  return a.words === 2 ? "32 bits wide (int32_t, uint32_t or long)" : "16 bits wide (int16_t, uint16_t or char)";
};

/** The argument's value as the student thinks of it. */
const shown = (a: PrintfArg): string => {
  if (a.kind === "float") return String(Number(a.value.toPrecision(7)));
  if (a.kind === "ptr") return "the text";
  const u = a.words === 2 ? a.bits >>> 0 : a.bits & 0xffff;
  if (a.signed === false) return String(u);
  if (a.signed === true) return String(a.words === 2 ? u | 0 : (u << 16) >> 16);
  return String(a.value);
};

/**
 * Formats like the board's printf and also reports how: where each argument
 * lies, which words each conversion read and what went wrong.
 * `store` writes the count of a %n conversion (words is 1 or 2).
 */
export function tracePrintf(
  fmt: string,
  args: PrintfArg[],
  readString: (addr: number) => string,
  warn: (code: string, msg: string) => void = () => {},
  store?: (addr: number, words: number, value: number) => void,
): PrintfTrace {
  // Lay the arguments out under the format string (SPRU514X 7.3.1).
  const cells = new Map<number, PrintfCell>();
  const slot: number[] = [];
  let k = 0;
  args.forEach((a, i) => {
    if (a.words === 2) {
      k += 2;
      if (k % 2) {
        cells.set(k - 1, { offset: k - 1, word: 0, arg: i, part: "skipped" });
        k += 1;
      }
      cells.set(k - 1, { offset: k - 1, word: (a.bits >>> 16) & 0xffff, arg: i, part: "high" });
      cells.set(k, { offset: k, word: a.bits & 0xffff, arg: i, part: "low" });
    } else {
      k += 1;
      cells.set(k, { offset: k, word: a.bits & 0xffff, arg: i, part: "only" });
    }
    slot.push(k);
  });
  const touched = new Set<number>();
  const convs: PrintfConv[] = [];
  let r = 0;
  let out = "";
  let mismatched = false;

  interface Taken {
    /** The words as one number, least significant word first. */
    bits: number;
    big: bigint;
    read: number[];
    /** The argument, when the conversion read exactly its words. */
    arg?: PrintfArg;
    argIndex?: number;
    /** The argument whose words were met first, when the conversion did not fit. */
    blamed?: PrintfArg;
    /** Nothing was passed where the conversion read. */
    missing: boolean;
  }
  const take = (n: number): Taken => {
    r += n;
    if (n >= 2 && r % 2) r += 1;
    const read: number[] = [];
    let big = 0n;
    for (let o = r - n + 1; o <= r; o++) {
      read.push(o);
      big = (big << 16n) | BigInt(cells.get(o)?.word ?? 0);
    }
    const first = read.map((o) => cells.get(o)).find((c) => c);
    for (const o of read) {
      const c = cells.get(o);
      if (c && c.part !== "skipped") touched.add(c.arg);
    }
    const i = slot.indexOf(r);
    const fits = i >= 0 && args[i].words === n;
    return {
      bits: Number(big & 0xffffffffn),
      big,
      read,
      arg: fits ? args[i] : undefined,
      argIndex: fits ? i : undefined,
      blamed: fits ? undefined : first ? args[first.arg] : undefined,
      missing: !first,
    };
  };

  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf("%", i);
    if (pct < 0) break;
    out += fmt.slice(i, pct);
    // %[flags][width][.precision][length]specifier
    let j = pct + 1;
    let flags = "";
    while (j < fmt.length && "-+ #0".includes(fmt[j])) flags += fmt[j++];
    let widthS = "";
    if (fmt[j] === "*") widthS = fmt[j++];
    else while (j < fmt.length && /\d/.test(fmt[j])) widthS += fmt[j++];
    let precS: string | undefined;
    if (fmt[j] === ".") {
      j++;
      precS = "";
      if (fmt[j] === "*") precS = fmt[j++];
      else while (j < fmt.length && /\d/.test(fmt[j])) precS += fmt[j++];
    }
    let len = "";
    if (fmt.startsWith("hh", j) || fmt.startsWith("ll", j)) (len = fmt.slice(j, j + 2)), (j += 2);
    else if (j < fmt.length && "hljztL".includes(fmt[j])) len = fmt[j++];
    const conv = fmt[j] ?? "";
    if (!conv || !ALL_CONVS.includes(conv)) {
      const bad = fmt.slice(pct, j + 1);
      warn(
        "printf-format",
        conv
          ? `"${bad}" in the format string is not a conversion: after the % (and any flags, width, precision and l) must come one of d i u o x X f F e E g G a A c s p n. Printed as it stands. To print a percent sign write %%.`
          : `The format string ends in the middle of a conversion ("${bad}"). After the % must come a letter such as d, ld or f. To print a percent sign write %%.`,
      );
      out += bad;
      i = j + 1;
      continue;
    }
    const spec = fmt.slice(pct, j + 1);
    i = j + 1;
    if (conv === "%") {
      out += "%";
      continue;
    }
    const c: PrintfConv = { spec, at: pct, conv, text: "", read: [] };
    convs.push(c);
    const problem = (code: string, msg: string) => {
      if (!c.problem) c.problem = { code, msg };
      // After one conversion of the wrong size the next ones read from the wrong place too: say it once.
      if ((code === "printf-type" || code === "printf-args") && mismatched) return;
      if (code === "printf-type") mismatched = true;
      warn(code, msg);
    };
    const star = (what: string): number => {
      const t = take(1);
      c.read.push(...t.read);
      if (t.missing) problem("printf-args", `The * in ${spec} takes the ${what} from a value in the list, and none was passed for it.`);
      else if (!t.arg || t.arg.kind !== "int")
        problem("printf-type", `The * in ${spec} takes the ${what} from a 16-bit int in the list, but the value there is ${describe(t.blamed ?? t.arg!)}. Pass an int16_t, or write the number in the format string.`);
      return (t.bits << 16) >> 16;
    };

    let left = flags.includes("-");
    let width = 0;
    if (widthS === "*") {
      // A negative width from the list means left-justify.
      const w16 = star("width");
      width = Math.abs(w16);
      if (w16 < 0) left = true;
    } else if (widthS) width = parseInt(widthS, 10);
    let prec: number | undefined;
    if (precS === "*") {
      // A negative precision from the list counts as none.
      const p16 = star("precision");
      prec = p16 < 0 ? undefined : p16;
    } else if (precS !== undefined) prec = precS ? parseInt(precS, 10) : 0;

    const plus = flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
    const alt = flags.includes("#");
    // Characters before the digits (sign, 0x): zero padding goes after them.
    let lead = "";
    let body = "";
    let zeroOk = false;
    // The conversion with the length the value needs, for "write this instead".
    const withLen = (l: string, cv = conv) => `%${flags}${widthS}${precS === undefined ? "" : "." + precS}${l}${cv}`;
    const printed = () => `"${(lead + body).trim()}"`;
    let late: (() => void) | undefined;

    if (INT_CONVS.includes(conv)) {
      const n = len === "ll" || len === "j" ? 4 : len === "l" || len === "z" || len === "t" ? (conv === "c" ? 1 : 2) : 1;
      if (len === "L") problem("printf-format", `The L in ${spec} goes only with f, e, g and a (it means long double). For a 32-bit integer write ${withLen("l")}.`);
      const t = take(n);
      c.read.push(...t.read);
      c.arg = t.argIndex;
      if (conv === "c") body = String.fromCharCode(t.bits & 0xff);
      else {
        const neg = (conv === "d" || conv === "i") && (n === 4 ? t.big >> 63n === 1n : n === 2 ? t.bits >>> 31 === 1 : (t.bits & 0x8000) !== 0);
        const mag = n === 4 ? (neg ? (1n << 64n) - t.big : t.big) : BigInt(neg ? (n === 2 ? -(t.bits | 0) : 0x10000 - (t.bits & 0xffff)) : n === 2 ? t.bits >>> 0 : t.bits & 0xffff);
        const zero = mag === 0n;
        body = mag.toString(conv === "o" ? 8 : conv === "x" || conv === "X" ? 16 : 10);
        if (conv === "X") body = body.toUpperCase();
        if (prec !== undefined) body = prec === 0 && zero ? "" : body.padStart(prec, "0");
        if (conv === "d" || conv === "i") lead = neg ? "-" : plus;
        else if (alt && conv === "o" && !body.startsWith("0")) body = "0" + body;
        else if (alt && conv !== "o" && conv !== "u" && !zero) lead = conv === "X" ? "0X" : "0x";
        zeroOk = prec === undefined;
      }
      const a = t.arg;
      const bl = t.blamed;
      const fix16 = conv === "c" ? "%c" : withLen("");
      late = () => {
        if (n === 4)
          problem(
            "printf-type",
            `${spec} reads a 64-bit long long: four 16-bit words. This game has no 64-bit integers, so no value can match it${bl ? `: the value there is ${describe(bl)}` : ""}. It printed ${printed()}. Write ${bl?.words === 1 ? withLen("") : withLen("l")}.`,
          );
        else if (t.missing) problem("printf-args", `The format string asks for more values than were passed: nothing is left for ${spec}. It printed ${printed()}; the board prints whatever lies in memory there. Add the value after the format string, or remove ${spec}.`);
        else if (a?.kind === "float" || (!a && bl?.kind === "float"))
          problem("printf-type", `${spec} was given a float. It printed ${printed()} instead of ${shown(a ?? bl!)}: the bits of a float are not those of an integer. Write %f (or %.2f for two decimals), or cast the value first: (int16_t)value with %d.`);
        else if (!a && bl?.kind === "ptr")
          problem("printf-type", `${spec} takes a 16-bit value, but the value there is ${describe(bl)}. It printed ${printed()}. Write %s to print the text, or %p to print the address.`);
        else if (!a && bl && bl.words === 2)
          problem(
            "printf-type",
            `${spec} takes a 16-bit value, but the value there is ${describe(bl)}. It printed ${printed()} instead of ${shown(bl)}, as the board does, and the 16-bit values after it are read from the wrong place. Write ${withLen("l")}.`,
          );
        else if (!a && bl)
          problem(
            "printf-type",
            `${spec} takes a 32-bit value, but the value there is ${describe(bl)}. Its 16 bits became the upper half of the number and the lower half is whatever lies next in memory, so it printed ${printed()} instead of ${shown(bl)}. Write ${fix16}, or cast the value: (int32_t)value.`,
          );
        else if (a && a.kind === "int" && (conv === "d" || conv === "i") && a.signed === false && lead === "-")
          problem("printf-sign", `${spec} printed ${printed()} for ${describe(a)} that holds ${shown(a)}: %${len}${conv} reads the bits as a signed number. Write ${withLen(len, "u")}.`);
        else if (a && a.kind === "int" && conv === "u" && a.signed === true && shown(a).startsWith("-"))
          problem("printf-sign", `${spec} printed ${printed()} for ${describe(a)} that holds ${shown(a)}: %${len}u reads the bits as an unsigned number. Write ${withLen(len, "d")}.`);
      };
    } else if (conv === "s") {
      const t = take(2);
      c.read.push(...t.read);
      c.arg = t.argIndex;
      if (t.missing) problem("printf-args", `The format string asks for more values than were passed: nothing is left for ${spec}. Add the string after the format string, or remove ${spec}.`);
      else if (t.arg?.kind !== "ptr")
        problem("printf-type", `${spec} needs a string (a char array or "text"), but the value there is ${describe(t.arg ?? t.blamed!)}. Nothing was printed for it; the board would read memory at a meaningless address. Write %d, %ld or %f for a number, %c for one character.`);
      else {
        body = readString(t.bits);
        if (prec !== undefined) body = body.slice(0, prec);
      }
    } else if (conv === "p") {
      const t = take(2);
      c.read.push(...t.read);
      c.arg = t.argIndex;
      body = (t.bits >>> 0).toString(16);
      if (prec !== undefined) body = prec === 0 && !t.bits ? "" : body.padStart(prec, "0");
      zeroOk = prec === undefined;
      const bl = t.blamed;
      late = () => {
        if (t.missing) problem("printf-args", `The format string asks for more values than were passed: nothing is left for ${spec}.`);
        else if (t.arg?.kind === "float" || bl)
          problem("printf-type", `${spec} prints an address (32 bits, in hexadecimal), but the value there is ${describe(t.arg ?? bl!)}. It printed ${printed()}. Pass a pointer such as &variable, or write %d, %ld or %f for a number.`);
      };
    } else if (conv === "n") {
      const t = take(2);
      c.read.push(...t.read);
      c.arg = t.argIndex;
      if (t.missing) problem("printf-args", `The format string asks for more values than were passed: nothing is left for ${spec}.`);
      else if (t.arg?.kind !== "ptr")
        problem("printf-type", `${spec} prints nothing: it stores the number of characters printed so far in an int whose address you pass, as in &count. The value there is ${describe(t.arg ?? t.blamed!)}, so nothing was stored; the board would write to a meaningless address.`);
      else store?.(t.bits, len === "l" ? 2 : 1, out.length);
      continue;
    } else {
      if (len === "L")
        problem("printf-type", `${spec}: the L means long double, a 64-bit type that this game does not have and that the board passes in another way. The value is shown here as ${withLen("")} would print it; the board would not. For a float write ${withLen("")}.`);
      const t = take(2);
      c.read.push(...t.read);
      c.arg = t.argIndex;
      u32[0] = t.bits;
      const v = f32[0];
      const upper = conv === conv.toUpperCase();
      lead = v < 0 || Object.is(v, -0) ? "-" : plus;
      const a = Math.abs(v);
      if (!Number.isFinite(a)) body = Number.isNaN(a) ? "nan" : "inf";
      else if (conv === "f" || conv === "F") {
        body = fixed(a, prec ?? 6);
        if (alt && !body.includes(".")) body += ".";
        zeroOk = true;
      } else if (conv === "e" || conv === "E") {
        body = expo(a, prec ?? 6);
        if (alt && !body.includes(".")) body = body.replace("e", ".e");
        zeroOk = true;
      } else if (conv === "g" || conv === "G") {
        const p = prec === undefined ? 6 : prec === 0 ? 1 : prec;
        // The exponent of the value once rounded to p significant digits, as C defines %g.
        const exp = a === 0 ? 0 : Number(a.toExponential(Math.min(p, 101) - 1).split("e")[1]);
        if (exp < -4 || exp >= p) {
          body = expo(a, p - 1);
          if (!alt) body = body.replace(/\.?0*e/, "e");
          else if (!body.includes(".")) body = body.replace("e", ".e");
        } else {
          body = fixed(a, Math.max(0, p - 1 - exp));
          if (!alt) body = body.includes(".") ? body.replace(/\.?0+$/, "") : body;
          else if (!body.includes(".")) body += ".";
        }
        zeroOk = true;
      } else {
        body = hexFloat(a, prec);
        if (alt && !body.includes(".")) body = body.replace("p", ".p");
        lead += "0x";
        body = body.slice(2);
        zeroOk = true;
      }
      if (!Number.isFinite(a)) zeroOk = false;
      if (upper) (body = body.toUpperCase()), (lead = lead.toUpperCase());
      const arg = t.arg;
      const bl = t.blamed;
      late = () => {
        if (t.missing) problem("printf-args", `The format string asks for more values than were passed: nothing is left for ${spec}. It printed ${printed()}; the board prints whatever lies in memory there. Add the value after the format string, or remove ${spec}.`);
        else if (arg?.kind !== "float") {
          const o = arg ?? bl!;
          const fix = o.kind === "ptr" ? "%s" : o.words === 2 ? "%ld" : "%d";
          problem(
            "printf-type",
            `${spec} needs a float, but the value there is ${describe(o)}. It printed ${printed()} instead of ${shown(o)}: the bits of an integer are not those of a float. Write ${fix}${o.kind === "ptr" ? "" : ", or cast the value: (float)value"}.`,
          );
        }
      };
    }

    const total = lead.length + body.length;
    let text: string;
    if (total >= width) text = lead + body;
    else if (left) text = (lead + body).padEnd(width, " ");
    else if (flags.includes("0") && zeroOk) text = lead + body.padStart(width - lead.length, "0");
    else text = (lead + body).padStart(width, " ");
    late?.();
    if (conv !== "s" && text.length > CONVERSION_BUF)
      problem(
        "printf-width",
        `${spec} makes ${text.length} characters. The library builds each value in a buffer of ${CONVERSION_BUF} characters, so on the board this writes past its end. Use a smaller width or precision.`,
      );
    c.text = text;
    out += text;
  }
  out += fmt.slice(i);

  // After a conversion of the wrong size the rest is read from the wrong place: that message is enough.
  const unused = args.length - touched.size;
  if (unused > 0 && !convs.some((c) => c.problem?.code === "printf-type"))
    warn(
      "printf-args",
      `${unused} value${unused === 1 ? " was" : "s were"} passed but the format string never prints ${unused === 1 ? "it" : "them"}. Add a conversion such as %d for each value, or remove ${unused === 1 ? "it" : "them"} from the list.`,
    );
  return { text: out, cells: [...cells.values()].sort((a, b) => a.offset - b.offset), convs };
}

export function formatPrintf(
  fmt: string,
  args: PrintfArg[],
  readString: (addr: number) => string,
  warn: (code: string, msg: string) => void,
  store?: (addr: number, words: number, value: number) => void,
): string {
  return tracePrintf(fmt, args, readString, warn, store).text;
}
