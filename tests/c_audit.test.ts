import { describe, expect, it } from "vitest";
import { codes, compileError, main, out, run } from "./helpers";

// Regression tests from an audit of the C compiler: each one failed before its fix.

describe("lexer and preprocessor", () => {
  it("ignores quotes and stray characters in a block removed by #if 0", () => {
    const src = `#if 0
this isn't C: " @
#endif
void main(void) { printf("ok"); }`;
    expect(out(src)).toBe("ok");
  });
  it("still reports a bad character or string in live code, on its line", () => {
    expect(compileError(main(`char c = 'ab';`))).toMatch(/^3: 'ab' is not a single character/);
    expect(compileError(main(`printf("abc);`))).toMatch(/^3: This string is missing its closing "/);
    expect(compileError(main(`int a = 5 @ 3;`))).toMatch(/^3: Unexpected character '@'/);
  });
  it("reads octal escapes of one digit and a backslash-newline inside a string", () => {
    expect(out(main(`char s[] = "a\\101\\7"; printf("%d %c %d", (int)sizeof(s), s[1], s[2]);`))).toBe("4 A 7");
    expect(out(`void main(void) { printf("a\\\nb"); }`)).toBe("ab");
  });
  it("rejects malformed numbers instead of guessing", () => {
    expect(compileError(main(`float f = 1.2.3;`))).toMatch(/'1.2.3' is not a valid number/);
    expect(compileError(main(`int n = 09;`))).toMatch(/octal/);
    expect(compileError(main(`int n = 12abc;`))).toMatch(/'12abc' is not a valid number/);
    expect(out(main(`printf("%d %d %lu %.1f %.2f %.1f", 007, 0x1f, 10UL, 1., 1e-2, 2.5f);`))).toBe("7 31 10 1.0 0.01 2.5");
  });
  it("evaluates arithmetic in #if", () => {
    const src = `#define N 4
#if N - 4
#define A 1
#else
#define A 0
#endif
#if N * 0 + 1 > 1
#define B 1
#else
#define B 0
#endif
#if (N + 1) * 2 == 10 && (1 << N) == 16 && NOT_DEFINED == 0
#define C 1
#else
#define C 0
#endif
void main(void) { printf("%d %d %d", A, B, C); }`;
    expect(out(src)).toBe("0 0 1");
    expect(compileError(`#if (3\n#endif\nvoid main(void) {}`)).toMatch(/^1: This #if expression is missing a \)/);
  });
});

describe("declarations and initialisers", () => {
  it("fills arrays of arrays and structs from a flat list", () => {
    const g = `int g[2][3] = {1,2,3,4,5,6}; int h[][2] = {1,2,3,4,5};
typedef struct { float x; int n; } pt; pt ps[2] = {1.5, 1, 2.5, 2};`;
    expect(out(main(`printf("%d %d %d %d %d", g[1][0], g[1][2], (int)sizeof(h), h[1][1], ps[1].n);`, g))).toBe("4 6 6 4 2");
    const byCopy = `typedef struct { int a; int b; } s_t; s_t one = {1, 2};
void main(void) { s_t arr[] = {one, {3, 4}}; printf("%d %d %d", arr[0].b, arr[1].a, (int)sizeof(arr)); }`;
    expect(out(byCopy)).toBe("2 3 4");
    expect(compileError(`int g[2][2] = {1,2,3,4,5};\nvoid main(void) {}`)).toMatch(/Too many values/);
  });
  it("warns when a constant initialiser does not fit in 16 bits", () => {
    const r = run(main(`int a = 70000; int16_t d = 40000; uint16_t e = 65535; printf("%d %d %u", a, d, e);`));
    expect(r.console).toBe("4464 -25536 65535");
    expect(r.diagnostics.filter((d) => d.code === "const-overflow").length).toBe(1);
    expect(run(`int16_t g = 100000;\nvoid main(void) {}`).diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["1 const-overflow"]);
  });
  it("refuses to change a const variable", () => {
    expect(compileError(`const int k = 5;\nvoid main(void) {\n  k = 6;\n}`)).toMatch(/^3: 'k' is declared const/);
    expect(compileError(main(`const int n = 3; n++;`))).toMatch(/'n' is declared const/);
    expect(compileError(`const int tbl[3] = {1,2,3};\nvoid main(void) { tbl[1] = 5; }`)).toMatch(/'tbl' is declared const/);
    expect(compileError(main(`int x; int * const cp = &x; cp = 0;`))).toMatch(/'cp' is declared const/);
    // A pointer to const data can itself be changed, and a const pointer can be written through.
    expect(out(main(`const char *s = "abc"; char b[2]; char * const cp = b; s = "def"; *cp = 'x'; printf("%c%c", s[0], b[0]);`))).toBe("dx");
  });
  it("reports a function defined twice and two types in one declaration", () => {
    expect(compileError(`void f(void) {}\nvoid f(void) {}\nvoid main(void) {}`)).toMatch(/^2: The function 'f' is defined twice/);
    expect(compileError(main(`unsigned float x;`))).toMatch(/cannot be combined with .float./);
    expect(compileError(`typedef struct { int a; } s_t;\ns_t p = { .a = 1 };\nvoid main(void) {}`)).toMatch(/^2: Naming the member/);
  });
});

describe("expressions", () => {
  it("gives a bit-field assignment the value the field holds", () => {
    const g = `struct { unsigned a:3; int s:3; } f;`;
    const r = run(main(`f.a = 7; int v = ++f.a; int w = (f.a = 9); f.a = 3; f.a += 6; printf("%d %d %d", v, w, f.a);`, g));
    expect(r.console).toBe("0 1 1");
    const s = run(main(`f.s = 5; printf("%d", f.s);`, g));
    expect(s.console).toBe("-3");
    expect(codes(s)).toContain("field-overflow");
    expect(codes(run(main(`f.s = -4; f.s = 3; f.a = 7;`, g)))).toEqual([]);
  });
  it("promotes a narrow unsigned bit-field to a signed int", () => {
    const g = `struct { uint16_t a:8; uint16_t b:8; } s;`;
    const r = run(main(`s.a = 200; s.b = 100; uint32_t w = s.a * s.b * 4; long x = s.a << 12; printf("%lu %ld %d", w, x, s.a - s.b - 200 < 0);`, g));
    expect(r.console).toBe("14464 -32768 1");
    expect(codes(r)).toContain("int16-overflow");
    // Writing still warns when the value is too wide for the field.
    expect(codes(run(main(`s.a = 0xFFFF;`, g)))).toContain("field-overflow");
  });
  it("treats constant division, && and ?: as constants in case labels", () => {
    const src = `#define HALF (10 / 2)
#define PICK (HALF > 2 ? 7 : 8)
void main(void) { int i; for (i = 4; i < 9; i++) switch (i) { case HALF: printf("h"); break; case PICK: printf("p"); break; case 1 && 0: break; } }`;
    expect(out(src)).toBe("hp");
  });
  it("rejects a struct assigned from something that is not a variable", () => {
    const src = `typedef struct { int a; } s_t;\ns_t p, q;\nvoid main(void) {\n  s_t x;\n  x = 1 ? p : q;\n}`;
    expect(compileError(src)).toMatch(/^5: The right side must be a struct variable/);
  });
  it("rejects a whole register passed to printf", () => {
    expect(compileError(main(`printf("%d", GpioDataRegs.GPADAT);`))).toMatch(/whole register .* Add \.all/);
  });
});

describe("diagnostics for beginner mistakes", () => {
  it("names a local that is read before it has a value", () => {
    const src = `int total(void) {
  int sum;
  int i;
  for (i = 0; i < 3; i++) sum += i;
  return sum;
}
void main(void) { printf("%d", total()); }`;
    const r = run(src);
    expect(r.diagnostics.filter((d) => d.code === "uninitialised").map((d) => d.line)).toEqual([4]);
    expect(codes(run(main(`int i, s; for (i = 0; i < 3; i++) s = s + i;`)))).toContain("uninitialised");
  });
  it("does not report locals that are written first, filled through a pointer or guarded in a loop", () => {
    const src = `void fill(int *o) { *o = 4; }
int rd(void) { return 3; }
void main(void) {
  int a, b, c, i, w, k, n;
  fill(&a);
  if (a) b = 1; else b = 2;
  for (i = 0; i < 3; i++) { if (i > 0) printf("%d", c); c = i; }
  do { w = rd(); } while (w < 3);
  k = sizeof(n);
  printf(" %d %d %d %d", a, b, w, k);
}`;
    const r = run(src);
    expect(r.console).toBe("01 4 1 3 1");
    expect(codes(r)).toEqual([]);
  });
  it("stops at a NULL pointer instead of writing to address 0", () => {
    const r = run(`void main(void) {\n  int *p = NULL;\n  *p = 5;\n}`);
    expect(r.runtimeError?.line).toBe(3);
    expect(r.runtimeError?.msg).toMatch(/NULL/);
    expect(run(`typedef struct { int a; int b; } s_t;\nvoid main(void) {\n  s_t *p = 0;\n  p->b = 3;\n}`).runtimeError?.line).toBe(4);
    expect(run(main(`int *p = 0; p[2] = 1;`)).runtimeError?.msg).toMatch(/NULL/);
    expect(out(main(`int x = 1; int *p = &x; if (p != NULL) *p = 2; printf("%d", x);`))).toBe("2");
  });
  it("warns when a function can end without returning its value", () => {
    const some = run(`int g(int a) {\n  if (a) return 1;\n}\nvoid main(void) { g(0); }`);
    expect(some.diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["1 missing-return"]);
    const fine = run(`int g(int a) { if (a) return 1; else return 2; }\nint h(int a) { if (a) return 1; return 2; }\nint w(void) { while (1) { } }\nvoid main(void) { g(0); h(0); }`);
    expect(codes(fine)).toEqual([]);
  });
  it("warns about an unsigned value compared with 0", () => {
    expect(codes(run(main(`unsigned int i; int n = 0; for (i = 3; i >= 0; i--) { n++; if (n > 5) break; }`)))).toContain("unsigned-compare");
    expect(codes(run(main(`uint16_t u = 2; int s = 2; if (u > 0 && s >= 0 && u != 0) printf("x");`)))).toEqual([]);
  });
  it("warns about a semicolon right after for (...) or while (...)", () => {
    const r = run(`void main(void) {\n  int i, s = 0;\n  for (i = 0; i < 10; i++);\n  { s += i; }\n}`);
    expect(r.diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["3 empty-loop"]);
    expect(codes(run(main(`int i; for (i = 0; i < 10; i++); printf("%d", i);`)))).toEqual([]);
  });
  it("warns when a pointer is given the address of a different kind of number", () => {
    const r = run(`void set(int *p) { *p = 1; }\nvoid main(void) {\n  float f = 0; long l = 0;\n  set(&f);\n  int *q = &l;\n}`);
    expect(r.diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["4 pointer-type", "5 pointer-type"]);
    expect(codes(run(main(`uint16_t u = 0; int *p = &u; char *c = (char *)&u; void *v = &u; long l = 0; long *lp = &l; *p = *c + *lp;`)))).toEqual([]);
  });
  it("warns when strings are compared with ==", () => {
    expect(codes(run(main(`char s[4] = "abc"; if (s == "abc") printf("same");`)))).toContain("string-compare");
  });
  it("warns when strcpy, sprintf or memset run past the end of a global array", () => {
    const r = run(`char buf[4];\nint next = 7;\nvoid main(void) {\n  strcpy(buf, "too long");\n  sprintf(buf, "%d", 12345);\n  memset(buf, 0, 5);\n}`);
    expect(r.diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["4 buffer-overflow", "5 buffer-overflow", "6 buffer-overflow"]);
    expect(codes(run(`char buf[6];\nvoid main(void) { strcpy(buf, "hello"); sprintf(buf, "%d", 12345); memset(buf, 0, 6); }`))).toEqual([]);
  });
  it("says so when the locals of a function are larger than the stack", () => {
    const r = run(`void main(void) {\n  float big[9000];\n  big[0] = 1;\n}`);
    expect(r.runtimeError?.msg).toMatch(/local variables of 'main' need 18000 words/);
  });
});

describe("printf", () => {
  it("pads floats with zeros when asked", () => {
    expect(out(main(`printf("[%06.2f][%08.3f][%05d]", 3.14159, -3.14159, 42);`))).toBe("[003.14][-003.142][00042]");
  });
  it("takes the width of %*d from the arguments", () => {
    expect(out(main(`printf("[%*d][%*d]", 5, 42, -4, 7);`))).toBe("[   42][7   ]");
  });
  it("chooses %g notation from the rounded value", () => {
    expect(out(main(`printf("[%g][%g][%g][%g]", 0.0001, 100000.0, 1e6, 0.5);`))).toBe("[0.0001][100000][1e+06][0.5]");
  });
  it("rounds exact halves to even, as the C library does", () => {
    expect(out(main(`printf("[%.0f][%.0f][%.0f][%.1f][%.1f]", 0.5, 2.5, 3.5, 0.25, 0.75);`))).toBe("[0][2][4][0.2][0.8]");
  });
});

describe("macro that names another macro with arguments", () => {
  it("takes the arguments from the text after it", async () => {
    const { runProgram } = await import("../src/sim/runner");
    const src = `#define G(x) ((x) * 2)
#define F G
#define H(x) F
int a = 0;
int b = 0;
void main(void) {
    a = F(3);
    b = H(0)(5) + F (1);
    while (1) {}
}`;
    const r = runProgram({ kit: "robot", source: src, durationMs: 1, stimuli: [], checks: [] });
    expect(r.compileError).toBeFalsy();
    expect(r.board!.readVar("a")).toBe(6);
    expect(r.board!.readVar("b")).toBe(12);
  });
});
