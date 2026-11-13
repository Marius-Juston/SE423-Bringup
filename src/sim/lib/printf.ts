// printf formatting as it behaves on the C28x, where int is 16 bits.
// Arguments are laid out as 16-bit words; each conversion takes the number
// of words its length modifier says, so %d given a 32-bit value prints the
// wrong number (and shifts everything after it), as on the real board.

export interface PrintfArg {
  kind: "int" | "float" | "ptr";
  words: number;
  /** Raw bits (16 or 32). */
  bits: number;
  value: number;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function formatPrintf(
  fmt: string,
  args: PrintfArg[],
  readString: (addr: number) => string,
  warn: (code: string, msg: string) => void,
): string {
  // Flatten the arguments into words, remembering which argument each came from.
  const words: number[] = [];
  const owner: number[] = [];
  args.forEach((a, i) => {
    words.push(a.bits & 0xffff);
    owner.push(i);
    if (a.words === 2) {
      words.push((a.bits >>> 16) & 0xffff);
      owner.push(i);
    }
  });
  let w = 0;
  let out = "";
  let used = 0;
  const take = (n: number, spec: string): { bits: number; arg?: PrintfArg; aligned: boolean } => {
    if (w + n > words.length) {
      warn("printf-args", `The format string asks for more values than were passed (at ${spec}).`);
      w = words.length;
      return { bits: 0, aligned: false };
    }
    const first = owner[w];
    const arg = args[first];
    const aligned = (w === 0 || owner[w - 1] !== first) && arg.words === n;
    const bits = n === 1 ? words[w] : ((words[w + 1] << 16) | words[w]) >>> 0;
    w += n;
    used = Math.max(used, owner[w - 1] + 1);
    return { bits, arg: aligned ? arg : undefined, aligned };
  };

  const re = /%([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?(l|h|L)?([diuxXocsfeEgG%])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    out += fmt.slice(last, m.index);
    last = re.lastIndex;
    const [spec, flags, widthS, precS, len, conv] = m;
    if (conv === "%") {
      out += "%";
      continue;
    }
    const width = widthS && widthS !== "*" ? parseInt(widthS, 10) : 0;
    const prec = precS !== undefined ? parseInt(precS, 10) : undefined;
    let body: string;
    let sign = "";
    if ("diuxXoc".includes(conv)) {
      const long = len === "l";
      const { bits, arg, aligned } = take(long ? 2 : 1, spec);
      if (!aligned) {
        const a = args[owner[Math.max(0, w - 1)]];
        if (a?.kind === "float")
          warn("printf-type", `${spec} was given a float. Use %f for float values (or cast to an integer type first). The number printed here is not the value of your variable.`);
        else if (a && a.words === 2 && !long)
          warn("printf-type", `${spec} prints a 16-bit int, but this value is 32 bits wide (int32_t, uint32_t or long). Use %l${conv}. The number printed here is wrong, as it would be on the board.`);
        else if (a && a.words === 1 && long)
          warn("printf-type", `${spec} expects a 32-bit value, but this one is 16 bits wide (int16_t or uint16_t). Use %${conv}. The number printed here is wrong, as it would be on the board.`);
      } else if (arg?.kind === "float") {
        warn("printf-type", `${spec} was given a float. Use %f for float values.`);
      }
      if (conv === "c") body = String.fromCharCode(bits & 0xff);
      else if (conv === "d" || conv === "i") {
        const v = long ? bits | 0 : (bits << 16) >> 16;
        sign = v < 0 ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
        body = Math.abs(v).toString();
      } else if (conv === "u") body = (bits >>> 0).toString();
      else if (conv === "o") body = (bits >>> 0).toString(8);
      else {
        body = (bits >>> 0).toString(16);
        if (conv === "X") body = body.toUpperCase();
        if (flags.includes("#") && bits) sign = conv === "X" ? "0X" : "0x";
      }
      if (prec !== undefined && conv !== "c") body = body.padStart(prec, "0");
    } else if (conv === "s") {
      const { bits, arg, aligned } = take(2, spec);
      if (!aligned || arg?.kind !== "ptr") {
        warn("printf-type", `${spec} needs a string (a char array or "text"), but something else was passed.`);
        body = "";
      } else {
        body = readString(bits);
        if (prec !== undefined) body = body.slice(0, prec);
      }
    } else {
      const { bits, arg, aligned } = take(2, spec);
      if (!aligned || arg?.kind !== "float")
        warn("printf-type", `${spec} needs a float, but an integer was passed. Use %d (16-bit) or %ld (32-bit), or cast with (float). The number printed here is not the value of your variable.`);
      u32[0] = bits;
      const v = f32[0];
      sign = v < 0 || Object.is(v, -0) ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
      const a = Math.abs(v);
      if (!Number.isFinite(a)) body = Number.isNaN(a) ? "nan" : "inf";
      else if (conv === "f") body = a.toFixed(prec ?? 6);
      else if (conv === "e" || conv === "E") {
        body = a.toExponential(prec ?? 6).replace(/e([+-])(\d)$/, "e$10$2");
        if (conv === "E") body = body.toUpperCase();
      } else {
        const p = prec === undefined ? 6 : prec === 0 ? 1 : prec;
        const exp = a === 0 ? 0 : Math.floor(Math.log10(a));
        if (exp < -4 || exp >= p) body = a.toExponential(p - 1).replace(/\.?0+e/, "e").replace(/e([+-])(\d)$/, "e$10$2");
        else body = a.toFixed(Math.max(0, p - 1 - exp)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        if (conv === "G") body = body.toUpperCase();
      }
    }
    const len2 = sign.length + body.length;
    if (len2 >= width) out += sign + body;
    else if (flags.includes("-")) out += (sign + body).padEnd(width, " ");
    else if (flags.includes("0") && conv !== "s" && conv !== "c" && prec === undefined) out += sign + body.padStart(width - sign.length, "0");
    else out += (sign + body).padStart(width, " ");
  }
  out += fmt.slice(last);
  const stray = /%(?![-+ 0#]*(\d+|\*)?(\.\d+)?[lhL]?[diuxXocsfeEgG%])/.exec(fmt.replace(/%%/g, ""));
  if (stray) warn("printf-format", `The format string has a % that is not followed by a valid conversion such as %d, %ld or %f.`);
  if (used < args.length && w >= words.length - 0 && args.length - used > 0)
    warn("printf-args", `${args.length - used} value${args.length - used === 1 ? " was" : "s were"} passed but the format string never prints ${args.length - used === 1 ? "it" : "them"}.`);
  return out;
}
