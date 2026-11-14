// printf on the C28x: every row of the tables of the reference page the course links
// (https://cplusplus.com/reference/cstdio/printf/, lecture 4 slides 13 to 15), with the
// expected text worked out by hand for 16-bit int, 32-bit long and 32-bit float
// (SPRU514X, Table 6-1), and the argument layout of SPRU514X 7.3.1.
import { describe, expect, it } from "vitest";
import { formatPrintf, tracePrintf, type PrintfArg } from "../src/sim/lib/printf";
import { codes, main, out, run } from "./helpers";

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const i16 = (v: number): PrintfArg => ({ kind: "int", words: 1, bits: v & 0xffff, value: v, signed: true, type: "int16_t" });
const u16 = (v: number): PrintfArg => ({ kind: "int", words: 1, bits: v & 0xffff, value: v, signed: false, type: "uint16_t" });
const i32 = (v: number): PrintfArg => ({ kind: "int", words: 2, bits: v >>> 0, value: v, signed: true, type: "int32_t" });
const u32a = (v: number): PrintfArg => ({ kind: "int", words: 2, bits: v >>> 0, value: v, signed: false, type: "uint32_t" });
const flt = (v: number): PrintfArg => ((f32[0] = v), { kind: "float", words: 2, bits: u32[0], value: f32[0] });
const strings = ["", "Hello", "A string", "robot"];
const str = (s: string): PrintfArg => {
  let i = strings.indexOf(s);
  if (i < 0) i = strings.push(s) - 1;
  return { kind: "ptr", words: 2, bits: 0x9000 + i, value: 0x9000 + i };
};
const readString = (a: number) => strings[a - 0x9000] ?? "?";

/** The text and the diagnostic codes. */
function p(fmt: string, ...args: PrintfArg[]): { text: string; codes: string[]; msgs: string[] } {
  const codes: string[] = [];
  const msgs: string[] = [];
  const text = formatPrintf(fmt, args, readString, (c, m) => (codes.push(c), msgs.push(m)));
  return { text, codes, msgs };
}
/** The text of a call that must raise no diagnostic. */
function ok(fmt: string, ...args: PrintfArg[]): string {
  const r = p(fmt, ...args);
  expect(r.codes, `${fmt}: ${r.msgs.join(" | ")}`).toEqual([]);
  return r.text;
}

describe("printf specifiers (16-bit int)", () => {
  it("d and i: signed decimal", () => {
    expect(ok("%d", i16(392))).toBe("392");
    expect(ok("%i", i16(-392))).toBe("-392");
    expect(ok("%d %d", i16(32767), i16(-32768))).toBe("32767 -32768");
  });
  it("u: unsigned decimal; -1 held in a uint16_t is 65535", () => {
    expect(ok("%u", u16(7235))).toBe("7235");
    expect(ok("%u", u16(-1))).toBe("65535");
    expect(ok("%u", u16(40000))).toBe("40000");
  });
  it("o: unsigned octal", () => {
    expect(ok("%o", u16(610))).toBe("1142");
    expect(ok("%o", i16(-1))).toBe("177777");
  });
  it("x and X: unsigned hexadecimal; -1 is ffff, not ffffffff", () => {
    expect(ok("%x", u16(0x7fa))).toBe("7fa");
    expect(ok("%X", u16(0x7fa))).toBe("7FA");
    expect(ok("%x", i16(-1))).toBe("ffff");
    expect(ok("%X", i16(-2))).toBe("FFFE");
  });
  it("f and F: decimal floating point, six decimals by default", () => {
    expect(ok("%f", flt(392.65))).toBe("392.649994"); // the nearest float to 392.65
    expect(ok("%f", flt(0.5))).toBe("0.500000");
    expect(ok("%F", flt(-2.25))).toBe("-2.250000");
    expect(ok("%f", flt(0))).toBe("0.000000");
  });
  it("e and E: scientific notation with at least two exponent digits", () => {
    expect(ok("%e", flt(1234.5))).toBe("1.234500e+03");
    expect(ok("%E", flt(1234.5))).toBe("1.234500E+03");
    expect(ok("%e", flt(0.00015625))).toBe("1.562500e-04"); // 5 / 32000 = 2^-13 * 1.28: exact below
    expect(ok("%e", flt(0))).toBe("0.000000e+00");
    expect(ok("%.2e", flt(-98765))).toBe("-9.88e+04");
    expect(ok("%.0e", flt(250000))).toBe("2e+05"); // 2.5 goes to the even digit
    expect(ok("%e", flt(1e10))).toBe("1.000000e+10");
  });
  it("g and G: the shorter of f and e, six significant digits, no trailing zeros", () => {
    expect(ok("%g", flt(392.65))).toBe("392.65");
    expect(ok("%g", flt(100000))).toBe("100000");
    expect(ok("%g", flt(1000000))).toBe("1e+06"); // exponent 6 is not below the precision 6
    expect(ok("%g", flt(1234567))).toBe("1.23457e+06");
    expect(ok("%g", flt(0.0001))).toBe("0.0001"); // exponent -4 still prints as f
    expect(ok("%g", flt(0.00001))).toBe("1e-05"); // exponent -5 prints as e
    expect(ok("%G", flt(0.00001))).toBe("1E-05");
    expect(ok("%g", flt(0.5))).toBe("0.5");
    expect(ok("%g", flt(0))).toBe("0");
    expect(ok("%g", flt(3))).toBe("3");
    expect(ok("%.3g", flt(3.14159))).toBe("3.14");
    expect(ok("%.3g", flt(31415.9))).toBe("3.14e+04");
    expect(ok("%.0g", flt(0.75))).toBe("0.8"); // precision 0 counts as 1; 0.75 is exact: to even
  });
  it("a and A: hexadecimal floating point", () => {
    expect(ok("%a", flt(1))).toBe("0x1p+0");
    expect(ok("%a", flt(3))).toBe("0x1.8p+1");
    expect(ok("%a", flt(-0.75))).toBe("-0x1.8p-1");
    expect(ok("%A", flt(10))).toBe("0X1.4P+3");
    expect(ok("%.2a", flt(3))).toBe("0x1.80p+1");
    expect(ok("%.0a", flt(3))).toBe("0x1p+2"); // 1.8 hex is half way: up to the even 2, which is 1 times 2^2
    expect(ok("%a", flt(0))).toBe("0x0p+0");
    expect(ok("%a", flt(0.1))).toBe("0x1.99999ap-4"); // the float nearest 0.1
  });
  it("c: the character with that ASCII number", () => {
    expect(ok("%c", i16(65))).toBe("A");
    expect(ok("%c%c%c", i16(0x52), i16(0x32), i16(0x44))).toBe("R2D");
  });
  it("s: a string up to its final 0", () => {
    expect(ok("%s", str("A string"))).toBe("A string");
    expect(ok("[%s]", str(""))).toBe("[]");
  });
  it("p: an address, printed like %lx (SPRU514X J.3.12)", () => {
    expect(ok("%p", { kind: "ptr", words: 2, bits: 0x7f02, value: 0x7f02 })).toBe("7f02");
    expect(ok("%p", u32a(0xc04))).toBe("c04");
  });
  it("n: prints nothing and stores the count so far", () => {
    const stored: number[][] = [];
    const text = formatPrintf("abc%n def%ln", [str("x"), str("y")], readString, () => {}, (a, w, v) => stored.push([a, w, v]));
    expect(text).toBe("abc def");
    expect(stored).toEqual([
      [0x9000 + strings.indexOf("x"), 1, 3],
      [0x9000 + strings.indexOf("y"), 2, 7],
    ]);
    expect(p("%n", i16(5)).codes).toEqual(["printf-type"]);
  });
  it("%%: a percent sign, taking no value", () => {
    expect(ok("100%%")).toBe("100%");
    expect(ok("%d%% of %d", i16(50), i16(8))).toBe("50% of 8");
  });
  it("inf and nan (SPRU514X J.3.12)", () => {
    expect(ok("%f %F %e %g", flt(Infinity), flt(-Infinity), flt(NaN), flt(Infinity))).toBe("inf -INF nan inf");
    expect(ok("%06f|%-6f|", flt(Infinity), flt(Infinity))).toBe("   inf|inf   |");
  });
});

describe("printf flags", () => {
  it("-: left-justify in the width", () => {
    expect(ok("%-5d|", i16(42))).toBe("42   |");
    expect(ok("%-8.3f|", flt(3.14159))).toBe("3.142   |");
    expect(ok("%-6s|", str("robot"))).toBe("robot |");
    expect(ok("%-3c|", i16(65))).toBe("A  |");
    expect(ok("%-05d|", i16(42))).toBe("42   |"); // - wins over 0
  });
  it("+: always a sign, for signed conversions", () => {
    expect(ok("%+d %+d %+d", i16(42), i16(-42), i16(0))).toBe("+42 -42 +0");
    expect(ok("%+.1f %+.1f", flt(2.5), flt(-2.5))).toBe("+2.5 -2.5");
    expect(ok("%+u %+x", u16(7), u16(7))).toBe("7 7"); // unsigned conversions have no sign
    expect(ok("%+ld", i32(100000))).toBe("+100000");
  });
  it("space: a blank where the minus would be", () => {
    expect(ok("% d|% d", i16(42), i16(-42))).toBe(" 42|-42");
    expect(ok("% .2f", flt(1.5))).toBe(" 1.50");
    expect(ok("%+ d", i16(42))).toBe("+42"); // + wins over space
  });
  it("#: 0, 0x and 0X prefixes; always a decimal point", () => {
    expect(ok("%#x %#X %#o", u16(255), u16(255), u16(8))).toBe("0xff 0XFF 010");
    expect(ok("%#x %#o", u16(0), u16(0))).toBe("0 0"); // no prefix on zero
    expect(ok("%#.0f %.0f", flt(3), flt(3))).toBe("3. 3");
    expect(ok("%#.0e", flt(3))).toBe("3.e+00");
    expect(ok("%#g %g", flt(2.5), flt(2.5))).toBe("2.50000 2.5"); // # keeps the trailing zeros
    expect(ok("%#lx", u32a(0xdeadbeef))).toBe("0xdeadbeef");
    expect(ok("%#06x", u16(255))).toBe("0x00ff"); // the zeros go after the prefix
    expect(ok("%#6x|%-#6x|", u16(255), u16(255))).toBe("  0xff|0xff  |");
  });
  it("0: pad with zeros instead of spaces", () => {
    expect(ok("%05d", i16(42))).toBe("00042");
    expect(ok("%05d", i16(-42))).toBe("-0042"); // the sign comes first
    expect(ok("%+05d", i16(42))).toBe("+0042");
    expect(ok("%04x %04X", u16(0xa5), u16(0xbeef))).toBe("00a5 BEEF");
    expect(ok("%08lx", u32a(0x1234))).toBe("00001234");
    expect(ok("%07.2f", flt(3.14159))).toBe("0003.14");
    expect(ok("%07.2f", flt(-3.14159))).toBe("-003.14");
    expect(ok("%010.3e", flt(1234.5))).toBe("01.234e+03"); // 1.2345 is exactly half way: to the even 4
    expect(ok("%05s|%03c|", str("ab"), i16(65))).toBe("   ab|  A|"); // no zeros for text
    expect(ok("%05.3d|", i16(7))).toBe("  007|"); // a precision switches 0 off for integers
  });
});

describe("printf width", () => {
  it("a number: the least number of characters, never cutting", () => {
    expect(ok("%5d|", i16(42))).toBe("   42|");
    expect(ok("%5d|", i16(-42))).toBe("  -42|");
    expect(ok("%2d|", i16(12345))).toBe("12345|");
    expect(ok("%10d|", i16(1977))).toBe("      1977|");
    expect(ok("%6ld|", i32(-70000))).toBe("-70000|");
    expect(ok("%8.3f|", flt(3.14159))).toBe("   3.142|");
    expect(ok("%8s|%3c|", str("robot"), i16(65))).toBe("   robot|  A|");
    expect(ok("%12e|", flt(1.5))).toBe("1.500000e+00|");
    expect(ok("%14e|", flt(1.5))).toBe("  1.500000e+00|");
  });
  it("*: the width is a 16-bit int in the list; a negative one left-justifies", () => {
    expect(ok("%*d|", i16(5), i16(10))).toBe("   10|");
    expect(ok("%*d|", i16(-5), i16(10))).toBe("10   |");
    expect(ok("%0*d", i16(4), i16(7))).toBe("0007");
    expect(ok("%*ld|", i16(8), i32(70000))).toBe("   70000|"); // the long starts at an even address
    expect(p("%*d", i32(5), i16(10)).codes).toContain("printf-type");
  });
});

describe("printf precision", () => {
  it("integers: the least number of digits", () => {
    expect(ok("%.3d", i16(7))).toBe("007");
    expect(ok("%.3d", i16(-7))).toBe("-007");
    expect(ok("%.3d", i16(12345))).toBe("12345");
    expect(ok("%.4x %.4X %.3o %.5u", u16(0xa5), u16(0xa5), u16(8), u16(42))).toBe("00a5 00A5 010 00042");
    expect(ok("%8.3d|%-8.3d|", i16(7), i16(7))).toBe("     007|007     |");
    expect(ok("%.8lx", u32a(0xbeef))).toBe("0000beef");
    expect(ok("[%.0d] [%.d] [%.0d]", i16(0), i16(0), i16(5))).toBe("[] [] [5]"); // 0 with precision 0: nothing
    expect(ok("%#.4x", u16(255))).toBe("0x00ff");
  });
  it("f, e and a: digits after the point, rounding half to even", () => {
    expect(ok("%.2f", flt(3.14159))).toBe("3.14");
    expect(ok("%.3f %.3f", flt(0.0625), flt(0.1875))).toBe("0.062 0.188"); // both exactly half way
    expect(ok("%.0f %.0f %.0f", flt(0.5), flt(1.5), flt(2.5))).toBe("0 2 2");
    expect(ok("%.1f", flt(0.25))).toBe("0.2");
    expect(ok("%.2f", flt(-0.004))).toBe("-0.00");
    expect(ok("%4.2f %+.0e %E", flt(3.1416), flt(3.1416), flt(3.1416))).toBe("3.14 +3e+00 3.141600E+00");
    expect(ok("%.10f", flt(0.1))).toBe("0.1000000015"); // a float holds about 7 digits
    expect(ok("%.f", flt(7.6))).toBe("8"); // a point without digits is precision 0
  });
  it("g: the most significant digits", () => {
    expect(ok("%.2g %.4g %.10g", flt(1234), flt(1234), flt(1234))).toBe("1.2e+03 1234 1234");
  });
  it("s: the most characters", () => {
    expect(ok("%.3s|", str("Hello"))).toBe("Hel|");
    expect(ok("%.9s|", str("Hello"))).toBe("Hello|");
    expect(ok("%6.2s|%-6.2s|", str("Hello"), str("Hello"))).toBe("    He|He    |");
    expect(ok("%.0s|", str("Hello"))).toBe("|");
  });
  it(".*: the precision is a 16-bit int in the list; a negative one counts as none", () => {
    expect(ok("%.*f", i16(1), flt(3.14159))).toBe("3.1");
    expect(ok("%.*f", i16(-1), flt(0.5))).toBe("0.500000");
    expect(ok("%*.*f|", i16(7), i16(2), flt(3.14159))).toBe("   3.14|");
    expect(ok("%.*s", i16(2), str("Hello"))).toBe("He");
  });
});

describe("printf length modifiers on this chip", () => {
  it("l: a 32-bit value", () => {
    expect(ok("%ld", i32(650000))).toBe("650000");
    expect(ok("%ld %li", i32(-70000), i32(2147483647))).toBe("-70000 2147483647");
    expect(ok("%ld", i32(-2147483648))).toBe("-2147483648");
    expect(ok("%lu", u32a(4294967295))).toBe("4294967295");
    expect(ok("%lu", u32a(3000000000))).toBe("3000000000");
    expect(ok("%lx %lX %lo", i32(-1), u32a(0xdeadbeef), u32a(8))).toBe("ffffffff DEADBEEF 10");
    expect(ok("%ld", u32a(70000))).toBe("70000"); // the course prints uint32_t counters with %ld
  });
  it("h and hh: nothing changes, short and char are 16 bits like int", () => {
    expect(ok("%hd %hhd %hu %hx", i16(-5), i16(300), u16(65535), u16(0xabcd))).toBe("-5 300 65535 abcd");
  });
  it("l with f, e, g, c and s changes nothing: double is float (COFF), wchar_t is int", () => {
    expect(ok("%lf %le %lg", flt(1.5), flt(1.5), flt(1.5))).toBe("1.500000 1.500000e+00 1.5");
    expect(ok("%lc%ls", i16(65), str("Hello"))).toBe("AHello");
  });
  it("z and t: size_t and ptrdiff_t are 32 bits", () => {
    expect(ok("%zu %td", u32a(100000), i32(-3))).toBe("100000 -3");
  });
  it("ll and j: 64 bits, four words, which no value of this game has", () => {
    const r = p("%lld", i32(70000));
    expect(r.codes).toEqual(["printf-type"]);
    expect(r.msgs[0]).toContain("Write %ld");
    // Two longs lie where one long long would: 0x00000002 above 0x00000001.
    expect(p("%llx", i32(2), i32(1)).text).toBe("200000001");
    expect(p("%jd", i16(5)).codes).toEqual(["printf-type"]);
  });
  it("L: long double, which this game does not have", () => {
    const r = p("%Lf", flt(1.5));
    expect(r.text).toBe("1.500000");
    expect(r.codes).toEqual(["printf-type"]);
    expect(r.msgs[0]).toContain("%f");
    expect(p("%Ld", i16(5)).codes).toEqual(["printf-format"]);
  });
});

describe("printf with a conversion that does not fit its value", () => {
  it("%d of a number above 32767 held in a uint16_t prints it as negative", () => {
    const r = p("%d", u16(40000));
    expect(r.text).toBe("-25536"); // 40000 - 65536
    expect(r.codes).toEqual(["printf-sign"]);
    expect(r.msgs[0]).toContain('printed "-25536"');
    expect(r.msgs[0]).toContain("holds 40000");
    expect(r.msgs[0]).toContain("Write %u");
    expect(ok("%d", u16(32767))).toBe("32767"); // no complaint while the number is right
  });
  it("%u of a negative int16_t prints 65536 more", () => {
    const r = p("%5u", i16(-1));
    expect(r.text).toBe("65535");
    expect(r.codes).toEqual(["printf-sign"]);
    expect(r.msgs[0]).toContain("Write %5d");
    const big = p("%ld", u32a(3000000000));
    expect(big.text).toBe("-1294967296"); // 3000000000 - 2^32
    expect(big.msgs[0]).toContain("Write %lu");
  });
  it("%d of a 32-bit value prints its upper half, and the next 16-bit values move", () => {
    // 70000 = 0x0001 1170. Words under the format string, from the top:
    // 0x0001 (upper half), 0x1170 (lower half), then 7 and 9.
    const r = p("%d %d %d", i32(70000), i16(7), i16(9));
    expect(r.text).toBe("1 4464 7");
    expect(r.codes).toEqual(["printf-type"]);
    expect(r.msgs[0]).toContain("%d takes a 16-bit value");
    expect(r.msgs[0]).toContain("int32_t (32 bits)");
    expect(r.msgs[0]).toContain('printed "1" instead of 70000');
    expect(r.msgs[0]).toContain("Write %ld");
    // A negative one: -2 = 0xFFFF FFFE, upper half 0xFFFF = -1.
    expect(p("%d", i32(-2)).text).toBe("-1");
    expect(p("%5u|", u32a(0x12345678)).msgs[0]).toContain("Write %5lu");
    expect(p("%x", u32a(0x12345678)).text).toBe("1234");
  });
  it("a 32-bit conversion starts again at an even address (SPRU514X 7.3.1)", () => {
    expect(p("%d|%ld", i32(70000), i32(70000)).text).toBe("1|70000");
    // int, then a long: one word is skipped so that the long lies at an even address.
    const t = tracePrintf("%d %ld", [i16(5), i32(70000)], readString);
    expect(t.text).toBe("5 70000");
    expect(t.cells.map((c) => [c.offset, c.part, c.word])).toEqual([
      [1, "only", 5],
      [2, "skipped", 0],
      [3, "high", 1],
      [4, "low", 0x1170],
    ]);
    expect(t.convs.map((c) => c.read)).toEqual([[1], [3, 4]]);
    // Two ints fill a pair: no word is skipped.
    expect(tracePrintf("%d %d %ld", [i16(5), i16(6), i32(70000)], readString).cells.length).toBe(4);
    // %d where the skipped word is: the board prints what lies there (0 here).
    const s = p("%d %d", i16(5), i32(70000));
    expect(s.text).toBe("5 0");
    expect(s.codes).toEqual(["printf-type"]);
  });
  it("%ld of a 16-bit value takes the next word too", () => {
    // 7 is met first, so it becomes the upper half: 7 * 65536 + 9.
    const r = p("%ld %d", i16(7), i16(9));
    expect(r.text.startsWith("458761 ")).toBe(true);
    expect(r.codes).toContain("printf-type");
    expect(r.msgs[0]).toContain("%ld takes a 32-bit value");
    expect(r.msgs[0]).toContain("int16_t (16 bits)");
    expect(r.msgs[0]).toContain("Write %d");
  });
  it("%d of a float and %f of an integer print bits, not the value", () => {
    // 2.5 is 0x4020 0000: upper half 0x4020 = 16416.
    const a = p("%d", flt(2.5));
    expect(a.text).toBe("16416");
    expect(a.codes).toEqual(["printf-type"]);
    expect(a.msgs[0]).toContain("Write %f");
    const b = p("%ld", flt(2.5));
    expect(b.text).toBe("1075838976"); // 0x40200000
    expect(b.codes).toEqual(["printf-type"]);
    // The long 1075838976 has the bits of 2.5.
    const c = p("%.1f", i32(1075838976));
    expect(c.text).toBe("2.5");
    expect(c.codes).toEqual(["printf-type"]);
    expect(c.msgs[0]).toContain("Write %ld");
    expect(p("%f", i16(3)).msgs[0]).toContain("Write %d");
  });
  it("%s of a number and %d of a string", () => {
    const a = p("[%s]", i16(65));
    expect(a.text).toBe("[]");
    expect(a.codes).toEqual(["printf-type"]);
    expect(p("%d", str("Hello")).msgs[0]).toContain("Write %s");
    expect(ok("%lx", str("Hello"))).toBe((0x9000 + strings.indexOf("Hello")).toString(16)); // an address is 32 bits
  });
  it("too few and too many values", () => {
    const few = p("%d %d", i16(1));
    expect(few.text).toBe("1 0");
    expect(few.codes).toEqual(["printf-args"]);
    expect(few.msgs[0]).toContain("%d");
    const many = p("%d", i16(1), i16(2), i32(3));
    expect(many.text).toBe("1");
    expect(many.codes).toEqual(["printf-args"]);
    expect(many.msgs[0]).toContain("2 values were passed");
    expect(p("%*d", i16(4)).codes).toEqual(["printf-args"]);
  });
  it("a % that starts no conversion is printed and reported", () => {
    const r = p("50%, done %d", i16(3));
    expect(r.text).toBe("50%, done 3");
    // "% d" is a conversion (the space flag), so this one takes the value and eats the d.
    expect(p("50% done", i16(3)).text).toBe("50 3one");
    expect(r.codes).toEqual(["printf-format"]);
    expect(r.msgs[0]).toContain("%%");
    expect(p("%k", i16(1)).text).toBe("%k");
    expect(p("abc%").codes).toEqual(["printf-format"]);
    expect(p("%5.2l").codes).toEqual(["printf-format"]);
  });
  it("a conversion longer than the library's 510-character buffer", () => {
    expect(p("%600d", i16(1)).codes).toEqual(["printf-width"]);
    expect(ok("%510d", i16(1)).length).toBe(510);
    expect(ok("%600s", str("a")).length).toBe(600); // %s is copied straight through
    expect(p("%.200f", flt(1)).text).toBe("1." + "0".repeat(200));
  });
});

describe("printf in a program", () => {
  it("runs the example of the reference page (lecture 4, slide 13) as this chip prints it", () => {
    // 650000L is a long: %ld. Everything else is an int, a float or a string.
    const text = out(
      main(`
  printf("Characters: %c %c \\n", 'a', 65);
  printf("Decimals: %d %ld\\n", 1977, 650000L);
  printf("Preceding with blanks: %10d \\n", 1977);
  printf("Preceding with zeros: %010d \\n", 1977);
  printf("Some different radices: %d %x %o %#x %#o \\n", 100, 100, 100, 100, 100);
  printf("floats: %4.2f %+.0e %E \\n", 3.1416, 3.1416, 3.1416);
  printf("Width trick: %*d \\n", 5, 10);
  printf("%s \\n", "A string");`),
    );
    expect(text).toBe(
      [
        "Characters: a A ",
        "Decimals: 1977 650000",
        "Preceding with blanks:       1977 ",
        "Preceding with zeros: 0000001977 ",
        "Some different radices: 100 64 144 0x64 0144 ",
        "floats: 3.14 +3e+00 3.141600E+00 ",
        "Width trick:    10 ",
        "A string ",
        "",
      ].join("\n"),
    );
  });
  it("names the type and the fix when %d is given a 32-bit variable", () => {
    const r = run(main(`uint32_t count = 70000; int16_t a = 7; printf("%d %d", count, a);`));
    expect(r.console).toBe("1 4464");
    const d = r.diagnostics.filter((x) => x.code === "printf-type");
    expect(d.length).toBe(1);
    expect(d[0].line).toBe(3);
    expect(d[0].msg).toContain("uint32_t (32 bits)");
    expect(d[0].msg).toContain("Write %ld");
  });
  it("a decimal constant above 32767 is a long, so %d does not fit it", () => {
    expect(codes(run(main(`printf("%d", 40000);`)))).toContain("printf-type");
    expect(out(main(`printf("%ld %u", 40000, 40000u);`))).toBe("40000 40000");
  });
  it("a char is passed as a 16-bit int", () => {
    const r = run(main(`char c = 'A'; char name[] = "robot"; printf("%c %d %x %.3s", c, c, c, name);`));
    expect(r.console).toBe("A 65 41 rob");
    expect(codes(r)).toEqual([]);
  });
  it("sprintf, serial_printf and UART_printfLine format the same way", () => {
    const src = `char buf[24]; int16_t n;
void main(void) {
  init_serialSCIA(&SerialA, 115200);
  n = sprintf(buf, "%-6s|%+06.1f|%04X", "ab", -2.5, 0xBEEF);
  printf("%s %d", buf, n);
  serial_printf(&SerialA, "%5.1f%%|%-4d|%08lx\\r\\n", 99.5, -7, 0x12345678);
  UART_printfLine(1, "L%+6.2f R%+6.2f", 1.5, -12.25);
  UART_printfLine(2, "%-10s%10ld", "count", 123456L);
}`;
    const r = run(src, 20);
    expect(r.console).toBe("ab    |-002.5|BEEF 18");
    expect(r.serial[0]).toBe(" 99.5%|-7  |12345678\r\n");
    expect(r.lcd).toEqual(["L +1.50 R-12.25", "count         123456"]);
    expect(codes(r)).toEqual([]);
  });
  it("%n stores the count in the program's variable", () => {
    expect(out(main(`int n = 0; printf("abcd%n", &n); printf(" %d", n);`))).toBe("abcd 4");
  });
});
