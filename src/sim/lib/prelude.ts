// The course library the student's code is compiled against: types and
// constants, the TI helper functions (run from their real C source), the
// course serial library, and native implementations of the rest.

import type { Board } from "../board";
import { RuntimeError, floatBits } from "../cc/compile";
import type { CType } from "../cc/types";
import { TI_SOURCE } from "./ti_source";
import { formatPrintf, type PrintfArg } from "./printf";

export const PRELUDE = `
typedef unsigned int Uint16;
typedef int int16;
typedef unsigned long Uint32;
typedef long int32;
typedef float float32;
typedef int int16_t;
typedef unsigned int uint16_t;
typedef long int32_t;
typedef unsigned long uint32_t;
typedef unsigned long size_t;
#define NULL 0
#define true 1
#define false 0
#define EALLOW __eallow()
#define EDIS __edis()
#define EINT __eint()
#define DINT __dint()
#define ERTM __nop()
#define DRTM __nop()
#define ESTOP0 __nop()
#define LSPCLK_HZ 50000000L
void __eallow(void); void __edis(void); void __eint(void); void __dint(void); void __nop(void);
void asm(char *text);
void __asm(char *text);

struct CPUTIMER_VARS {
    volatile struct CPUTIMER_REGS *RegsAddr;
    Uint32 InterruptCount;
    float CPUFreqInMHz;
    float PeriodInUSec;
};
struct CPUTIMER_VARS CpuTimer0;
struct CPUTIMER_VARS CpuTimer1;
struct CPUTIMER_VARS CpuTimer2;

void InitSysCtrl(void);
void InitPieCtrl(void);
void InitPieVectTable(void);
void DELAY_US(float microseconds);

${TI_SOURCE}

// ---- course serial library (F28379dSerial.c, SE 423), register setup kept as in the original
typedef struct serialSCIA_s { volatile struct SCI_REGS *sci; Uint16 port; } serialSCIA_t;
typedef struct serialSCIA_s serialSCIB_t;
typedef struct serialSCIA_s serialSCIC_t;
typedef struct serialSCIA_s serialSCID_t;
serialSCIA_t SerialA;
serialSCIB_t SerialB;
serialSCIC_t SerialC;
serialSCID_t SerialD;
uint32_t numRXA = 0;
uint32_t numRXB = 0;
uint32_t numRXC = 0;
uint32_t numRXD = 0;
uint16_t RXAdata = 0;
__interrupt void RXAINT_recv_ready(void)
{
    RXAdata = SciaRegs.SCIRXBUF.all;
    /* SCI PE or FE error */
    if (RXAdata & 0xC000) {
        SciaRegs.SCICTL1.bit.SWRESET = 0;
        SciaRegs.SCICTL1.bit.SWRESET = 1;
        SciaRegs.SCIFFRX.bit.RXFIFORESET = 0;
        SciaRegs.SCIFFRX.bit.RXFIFORESET = 1;
    } else {
        RXAdata = RXAdata & 0x00FF;
        numRXA ++;
    }
    SciaRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
__interrupt void TXAINT_data_sent(void)
{
    SciaRegs.SCIFFTX.bit.TXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
uint16_t RXBdata = 0;
__interrupt void RXBINT_recv_ready(void)
{
    RXBdata = ScibRegs.SCIRXBUF.all;
    /* SCI PE or FE error */
    if (RXBdata & 0xC000) {
        ScibRegs.SCICTL1.bit.SWRESET = 0;
        ScibRegs.SCICTL1.bit.SWRESET = 1;
        ScibRegs.SCIFFRX.bit.RXFIFORESET = 0;
        ScibRegs.SCIFFRX.bit.RXFIFORESET = 1;
    } else {
        RXBdata = RXBdata & 0x00FF;
        numRXB ++;
    }
    ScibRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
__interrupt void TXBINT_data_sent(void)
{
    ScibRegs.SCIFFTX.bit.TXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
uint16_t RXCdata = 0;
__interrupt void RXCINT_recv_ready(void)
{
    RXCdata = ScicRegs.SCIRXBUF.all;
    /* SCI PE or FE error */
    if (RXCdata & 0xC000) {
        ScicRegs.SCICTL1.bit.SWRESET = 0;
        ScicRegs.SCICTL1.bit.SWRESET = 1;
        ScicRegs.SCIFFRX.bit.RXFIFORESET = 0;
        ScicRegs.SCIFFRX.bit.RXFIFORESET = 1;
    } else {
        RXCdata = RXCdata & 0x00FF;
        numRXC ++;
    }
    ScicRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
__interrupt void TXCINT_data_sent(void)
{
    ScicRegs.SCIFFTX.bit.TXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
uint16_t RXDdata = 0;
__interrupt void RXDINT_recv_ready(void)
{
    RXDdata = ScidRegs.SCIRXBUF.all;
    /* SCI PE or FE error */
    if (RXDdata & 0xC000) {
        ScidRegs.SCICTL1.bit.SWRESET = 0;
        ScidRegs.SCICTL1.bit.SWRESET = 1;
        ScidRegs.SCIFFRX.bit.RXFIFORESET = 0;
        ScidRegs.SCIFFRX.bit.RXFIFORESET = 1;
    } else {
        RXDdata = RXDdata & 0x00FF;
        numRXD ++;
    }
    ScidRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
__interrupt void TXDINT_data_sent(void)
{
    ScidRegs.SCIFFTX.bit.TXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
uint16_t serial_printf(serialSCIA_t *s, char *fmt, ...);
uint16_t __serial_send(serialSCIA_t *s, char *data, Uint16 len);
void UART_printfLine(unsigned char line, char *format, ...);

void __init_sci(volatile struct SCI_REGS *sci, uint32_t baud)
{
    uint32_t clk;
    sci->SCICTL1.bit.SWRESET = 0;
    sci->SCICCR.all = 0x0;
    sci->SCICTL1.all = 0x0;
    sci->SCICTL2.all = 0x0;
    sci->SCIPRI.all = 0x0;
    clk = LSPCLK_HZ;
    clk /= baud*8;
    clk--;
    sci->SCILBAUD.all = clk & 0xFF;
    sci->SCIHBAUD.all = (clk >> 8) & 0xFF;
    sci->SCICCR.bit.SCICHAR = 0x7;
    sci->SCICCR.bit.PARITYENA = 0;
    sci->SCICCR.bit.STOPBITS = 0;
    sci->SCICCR.bit.LOOPBKENA = 0;
    sci->SCICCR.bit.ADDRIDLE_MODE = 0;
    sci->SCIFFCT.bit.FFTXDLY = 0;
    sci->SCIFFTX.bit.SCIFFENA = 1;
    sci->SCIFFTX.bit.TXFIFORESET = 0;
    sci->SCIFFTX.bit.TXFFIL = 0x0;
    sci->SCIFFTX.bit.TXFFINTCLR = 1;
    sci->SCIFFTX.bit.TXFFIENA = 0;
    sci->SCIFFTX.bit.TXFIFORESET = 1;
    sci->SCIFFRX.bit.RXFIFORESET = 0;
    sci->SCIFFRX.bit.RXFFINTCLR = 1;
    sci->SCIFFRX.bit.RXFFIENA = 1;
    sci->SCIFFRX.bit.RXFFIL = 0x1;
    sci->SCIFFRX.bit.RXFIFORESET = 1;
    sci->SCICTL2.bit.RXBKINTENA = 0;
    sci->SCICTL2.bit.TXINTENA = 0;
    sci->SCICTL1.bit.TXWAKE = 0;
    sci->SCICTL1.bit.SLEEP = 0;
    sci->SCICTL1.bit.RXENA = 1;
    sci->SCICTL1.bit.RXERRINTENA = 0;
    sci->SCICTL1.bit.TXENA = 1;
    sci->SCICTL1.bit.SWRESET = 1;
}
uint16_t init_serialSCIA(serialSCIA_t *s, uint32_t baud)
{
    if (s != &SerialA) return 1;
    s->sci = &SciaRegs; s->port = 0;
    GPIO_SetupPinMux(43, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinOptions(43, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(42, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinOptions(42, GPIO_OUTPUT, GPIO_PUSHPULL);
    __init_sci(s->sci, baud);
    PieCtrlRegs.PIEIER9.bit.INTx1 = 1;
    PieCtrlRegs.PIEIER9.bit.INTx2 = 1;
    IER |= (M_INT9);
    PieCtrlRegs.PIEACK.all = (PIEACK_GROUP9);
    return 0;
}
uint16_t init_serialSCIB(serialSCIB_t *s, uint32_t baud)
{
    if (s != &SerialB) return 1;
    s->sci = &ScibRegs; s->port = 1;
    GPIO_SetupPinMux(15, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(15, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(14, GPIO_OUTPUT, GPIO_PUSHPULL);
    __init_sci(s->sci, baud);
    PieCtrlRegs.PIEIER9.bit.INTx3 = 1;
    PieCtrlRegs.PIEIER9.bit.INTx4 = 1;
    IER |= (M_INT9);
    PieCtrlRegs.PIEACK.all = (PIEACK_GROUP9);
    return 0;
}
uint16_t init_serialSCIC(serialSCIC_t *s, uint32_t baud)
{
    if (s != &SerialC) return 1;
    s->sci = &ScicRegs; s->port = 2;
    GPIO_SetupPinMux(139, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(139, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(56, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(56, GPIO_OUTPUT, GPIO_PUSHPULL);
    __init_sci(s->sci, baud);
    PieCtrlRegs.PIEIER8.bit.INTx5 = 1;
    PieCtrlRegs.PIEIER8.bit.INTx6 = 1;
    IER |= (M_INT8);
    PieCtrlRegs.PIEACK.all = (PIEACK_GROUP8);
    return 0;
}
uint16_t init_serialSCID(serialSCID_t *s, uint32_t baud)
{
    if (s != &SerialD) return 1;
    s->sci = &ScidRegs; s->port = 3;
    GPIO_SetupPinMux(105, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(105, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(104, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(104, GPIO_OUTPUT, GPIO_PUSHPULL);
    __init_sci(s->sci, baud);
    PieCtrlRegs.PIEIER8.bit.INTx7 = 1;
    PieCtrlRegs.PIEIER8.bit.INTx8 = 1;
    IER |= (M_INT8);
    PieCtrlRegs.PIEACK.all = (PIEACK_GROUP8);
    return 0;
}
uint16_t serial_sendSCIA(serialSCIA_t *s, char *data, Uint16 len) { return __serial_send(s, data, len); }
uint16_t serial_sendSCIB(serialSCIB_t *s, char *data, Uint16 len) { return __serial_send(s, data, len); }
uint16_t serial_sendSCIC(serialSCIC_t *s, char *data, Uint16 len) { return __serial_send(s, data, len); }
uint16_t serial_sendSCID(serialSCID_t *s, char *data, Uint16 len) { return __serial_send(s, data, len); }

// ---- C standard library
int printf(char *fmt, ...);
int sprintf(char *buffer, char *fmt, ...);
float sin(float x); float cos(float x); float tan(float x);
float asin(float x); float acos(float x); float atan(float x); float atan2(float y, float x);
float sqrt(float x); float fabs(float x); float exp(float x); float log(float x); float log10(float x);
float pow(float x, float y); float floor(float x); float ceil(float x); float fmod(float x, float y);
float sinf(float x); float cosf(float x); float tanf(float x); float atan2f(float y, float x);
float sqrtf(float x); float fabsf(float x); float powf(float x, float y);
int abs(int x); long labs(long x);
size_t strlen(char *s); char *strcpy(char *dst, char *src); int strcmp(char *a, char *b);
void *memset(void *dst, int value, size_t n); void *memcpy(void *dst, void *src, size_t n);
`;

/** Library functions a student file may replace (Lab 1 edits the receive interrupt). */
export const REPLACEABLE = [
  "RXAINT_recv_ready", "RXBINT_recv_ready", "RXCINT_recv_ready", "RXDINT_recv_ready",
];

export function installLibrary(b: Board): void {
  const c = b.compiler;
  const mem = b.mem;
  const dev = b.dev;

  const cstr = (addr: number, line: number): string => {
    if (addr === 0) throw new RuntimeError(line, "A string argument is NULL (address 0).");
    let s = "";
    for (let i = 0; i < 4096; i++) {
      const ch = mem.peek(addr + i, 1);
      if (ch === 0) return s;
      s += String.fromCharCode(ch & 0xff);
    }
    throw new RuntimeError(line, "This string has no terminating 0, so the function ran off its end. Make the char array one element longer than the text.");
  };
  const varargs = (args: number[], types: CType[], from: number): PrintfArg[] =>
    args.slice(from).map((v, i) => {
      const t = types[from + i];
      if (t.k === "float") return { kind: "float", words: 2, bits: floatBits(v), value: v };
      if (t.k === "ptr" || t.k === "array") return { kind: "ptr", words: 2, bits: v >>> 0, value: v };
      const w = t.k === "int" ? t.w : 1;
      return { kind: "int", words: w, bits: w === 1 ? v & 0xffff : v >>> 0, value: v };
    });
  const format = (args: number[], types: CType[], fmtIndex: number, line: number): string =>
    formatPrintf(cstr(args[fmtIndex], line), varargs(args, types, fmtIndex + 1), (a) => cstr(a, line), (code, msg) =>
      b.warn(b.line, code, msg),
    );

  c.defineNative("__eallow", () => {
    mem.eallow = true;
    mem.writes++;
    return 0;
  });
  c.defineNative("__edis", () => {
    mem.eallow = false;
    mem.writes++;
    return 0;
  });
  c.defineNative("__eint", () => (b.setIntm(false), 0));
  c.defineNative("__dint", () => (b.setIntm(true), 0));
  c.defineNative("__nop", () => 0);
  c.defineNative("asm", () => 0);
  c.defineNative("__asm", () => 0);
  c.defineNative("InitSysCtrl", () => 0);
  c.defineNative("DELAY_US", (a) => {
    b.delay(Math.max(0, a[0]) * 1000);
    mem.liveReads++;
    return 0;
  });

  // Default handler every vector points to after InitPieVectTable().
  const proto = c.fns.get("__nop")!.t;
  const mkIsr = (name: string, body: () => void) => {
    const f = { name, id: c.fnById.length, t: proto, interrupt: true, line: 0, frame: 0, paramStore: [], defined: true, file: "library", native: () => (body(), 0) };
    c.fns.set(name, f);
    c.fnById.push(f);
    return f;
  };
  b.defaultIsr = mkIsr("__default_isr", () => {});
  for (const name of REPLACEABLE) c.fns.get(name)!.replaceable = true;

  c.defineNative("InitPieCtrl", () => {
    b.setIntm(true);
    dev.set("PieCtrlRegs.PIECTRL", 0, "ENPIE");
    for (let g = 1; g <= 12; g++) {
      dev.set(`PieCtrlRegs.PIEIER${g}`, 0);
      dev.set(`PieCtrlRegs.PIEIFR${g}`, 0);
    }
    b.pie.evaluate();
    return 0;
  });
  c.defineNative("InitPieVectTable", () => {
    const addr = c.fnAddr(b.defaultIsr!);
    for (const [name, r] of dev.regs) if (name.startsWith("PieVectTable.")) mem.poke(r.addr, 2, addr);
    dev.set("PieCtrlRegs.PIECTRL", 1, "ENPIE");
    mem.writes++;
    b.pie.evaluate();
    return 0;
  });

  const portOf = (s: number, line: number): number => {
    const names = ["SerialA", "SerialB", "SerialC", "SerialD"];
    const i = names.findIndex((n) => c.globals.get(n)!.addr === s);
    if (i < 0) throw new RuntimeError(line, "The first argument must be the address of a serial port, for example &SerialA.");
    const pre = `Sci${"abcd"[i]}Regs`;
    if (!dev.get(`${pre}.SCICTL1`, "TXENA"))
      throw new RuntimeError(line, `${names[i]} was used before it was set up. Call init_serialSCI${"ABCD"[i]}(&${names[i]}, 115200); first.`);
    return i;
  };
  c.defineNative("serial_printf", (a, t, line) => {
    const port = portOf(a[0], b.line);
    const text = format(a, t, 1, line);
    if (b.isrDepth)
      b.warn(b.line, "print-in-isr", "serial_printf is slow. Calling it inside an interrupt function delays every other interrupt: set a flag here and print from the while(1) loop in main().");
    for (const ch of text) b.sci.send(port, ch.charCodeAt(0));
    return 0;
  });
  c.defineNative("__serial_send", (a, _t, line) => {
    const port = portOf(a[0], b.line);
    for (let i = 0; i < a[2]; i++) b.sci.send(port, mem.peek(a[1] + i, 1) & 0xff);
    return 0;
  });
  c.defineNative("UART_printfLine", (a, t, line) => {
    const row = a[0];
    if (row !== 1 && row !== 2) b.warn(b.line, "lcd-line", `The LCD has lines 1 and 2; line ${row} does not exist.`);
    else b.lcd[row - 1] = format(a, t, 1, line).slice(0, 20);
    mem.writes++;
    return 0;
  });
  c.defineNative("printf", (a, t, line) => {
    const text = format(a, t, 0, line);
    b.console += text;
    mem.writes++;
    return text.length;
  });
  c.defineNative("sprintf", (a, t, line) => {
    const text = format(a, t, 1, line);
    for (let i = 0; i < text.length; i++) mem.write(a[0] + i, 1, text.charCodeAt(i));
    mem.write(a[0] + text.length, 1, 0);
    return text.length;
  });

  const f1 = (name: string, f: (x: number) => number) => c.defineNative(name, (a) => Math.fround(f(a[0])));
  const f2 = (name: string, f: (x: number, y: number) => number) => c.defineNative(name, (a) => Math.fround(f(a[0], a[1])));
  f1("sin", Math.sin); f1("cos", Math.cos); f1("tan", Math.tan);
  f1("sinf", Math.sin); f1("cosf", Math.cos); f1("tanf", Math.tan);
  f1("asin", Math.asin); f1("acos", Math.acos); f1("atan", Math.atan);
  f1("sqrt", Math.sqrt); f1("sqrtf", Math.sqrt); f1("fabs", Math.abs); f1("fabsf", Math.abs);
  f1("exp", Math.exp); f1("log", Math.log); f1("log10", Math.log10);
  f1("floor", Math.floor); f1("ceil", Math.ceil);
  f2("atan2", Math.atan2); f2("atan2f", Math.atan2); f2("pow", Math.pow); f2("powf", Math.pow);
  f2("fmod", (x, y) => x % y);
  c.defineNative("abs", (a) => (Math.abs(a[0]) << 16) >> 16);
  c.defineNative("labs", (a) => Math.abs(a[0]) | 0);
  c.defineNative("strlen", (a, _t, line) => cstr(a[0], line).length);
  c.defineNative("strcpy", (a, _t, line) => {
    const s = cstr(a[1], line);
    for (let i = 0; i < s.length; i++) mem.write(a[0] + i, 1, s.charCodeAt(i));
    mem.write(a[0] + s.length, 1, 0);
    return a[0];
  });
  c.defineNative("strcmp", (a, _t, line) => {
    const x = cstr(a[0], line);
    const y = cstr(a[1], line);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  c.defineNative("memset", (a) => {
    for (let i = 0; i < a[2]; i++) mem.write(a[0] + i, 1, a[1] & 0xffff);
    return a[0];
  });
  c.defineNative("memcpy", (a) => {
    for (let i = 0; i < a[2]; i++) mem.write(a[0] + i, 1, mem.read(a[1] + i, 1));
    return a[0];
  });
}
