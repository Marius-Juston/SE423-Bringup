// What the course's LADAR / Raspberry Pi starter projects (LADAR_PICOM_starter
// and the ones built on it) expect from their serial library and from TI's
// F2837xD_SWPrioritizedIsrLevels.h, so that such a main file compiles and
// runs unchanged: the types (datapts, xy, pose, the float/raw unions), the
// shared variables (ladar_data, LADARpingpong, G_command, LinuxCommands ...)
// and the priority masks MINTn and MG12_n. Written for this game: the
// course's files are not copied.
//
// LADAR (works): the library's own RXCINT_recv_ready reads each character
// from SCIRXBUF. When it does, this plugin follows the reply of the sensor
// (plugins/lidar.ts describes the format): after 'G' and the 12-character
// header with status '0', every two characters are one 12-bit distance in
// millimetres. Error codes 0 and 6 become LADAR_MAX_READING. The distance in
// feet goes to ladar_data[i].distance_ping when LADARpingpong is 0, else to
// distance_pong. Two line feeds end the scan: LADARpingpong flips and, if
// PIEIER12.10 is enabled, interrupt INT12.10 is requested (TRM Table 3-2;
// the course uses that unused vector as its software interrupt "SWI2").
// It does nothing when the student's file has its own RXCINT_recv_ready or
// its own ladar_data, so levels that teach the parser are not touched.
//
// Software-prioritised interrupts (TRM section 3.4.5 "Nesting interrupts",
// TI's sw_prioritized_interrupts example): MINTn is the IER mask and MG12_n
// the PIEIER12 mask that leave only higher priorities enabled, for the
// priority levels the course project uses (group n has level n, INT13 to
// INT16 have level 4, channel n of group 12 has level n).
//
// Not modelled (inert: the variables exist and never change):
//   - the Raspberry Pi on SCID (LinuxCommands, newLinuxCommands, the
//     LabVIEW floats fromLVvalues / NewLVData, the OptiTrack data). What the
//     program sends on SCID goes nowhere and nothing ever arrives.
//   - the time the receive function's parsing takes on the chip.
//   - MGx_y masks of groups other than 12.

import type { Board } from "../board";
import { floatBits } from "../cc/compile";
import type { SimPlugin } from "../plugin";
import { FT_PER_MM, G_COMMAND, LADAR_MAX_READING, LIDAR_POINTS } from "./lidar";

/** Priority level of CPU interrupt n (1 to 16) in the course project. */
const levelOf = (n: number): number => (n <= 12 ? n : 4);
const mint = (n: number): number => {
  let mask = 0;
  for (let k = 1; k <= 16; k++) if (levelOf(k) < levelOf(n)) mask |= 1 << (k - 1);
  return mask;
};
const hex = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`;

/** Library variables a student's file may define itself (levels do). */
const WEAK = [
  "ladar_data", "ladar_pts", "LADARrightfront", "LADARfront", "LADARpingpong", "LADARxoffset", "LADARyoffset",
  "G_command", "G_len", "printLV1", "printLV2", "DataToLabView", "LVsenddata", "fromLVvalues", "NewLVData",
  "newLinuxCommands", "LinuxCommands", "new_optitrack", "Optitrackdata",
];

export const plugin: SimPlugin = {
  name: "course_ladar",
  // After lidar.ts, which defines LADAR_MAX_READING.
  order: 1,
  prelude: `
${Array.from({ length: 16 }, (_, i) => `#define MINT${i + 1} ${hex(mint(i + 1))}`).join("\n")}
${Array.from({ length: 16 }, (_, i) => `#define MG12_${i + 1} ${hex((1 << i) - 1)}`).join("\n")}
#define LVNUM_TOFROM_FLOATS 8
#define CMDNUM_FROM_FLOATS 11
#define OPTITRACKDATASIZE 5
typedef union { uint16_t rawData[LVNUM_TOFROM_FLOATS*2]; float floatData[LVNUM_TOFROM_FLOATS]; } LVRecFloats_t;
typedef union { uint16_t rawData[LVNUM_TOFROM_FLOATS*2]; float floatData[LVNUM_TOFROM_FLOATS]; } LVSendFloats_t;
typedef union { uint16_t rawData[CMDNUM_FROM_FLOATS*2]; float floatData[CMDNUM_FROM_FLOATS]; } CMDRecFloats_t;
typedef union { uint16_t rawData[10]; float floatData[5]; } optiData_t;
typedef struct { float angle; float distance_ping; float distance_pong; } datapts;
typedef struct { float x; float y; } xy;
typedef struct { float x; float y; float theta; } pose;
datapts ladar_data[${LIDAR_POINTS}];
xy ladar_pts[${LIDAR_POINTS}];
float LADARrightfront = 0;
float LADARfront = 0;
uint16_t LADARpingpong = 0;
float LADARxoffset = 0;
float LADARyoffset = 0;
char G_command[] = ${JSON.stringify(G_COMMAND)};
uint16_t G_len = 11;
float printLV1 = 0;
float printLV2 = 0;
LVSendFloats_t DataToLabView;
char LVsenddata[LVNUM_TOFROM_FLOATS*4+2];
float fromLVvalues[LVNUM_TOFROM_FLOATS];
uint16_t NewLVData = 0;
uint16_t newLinuxCommands = 0;
float LinuxCommands[CMDNUM_FROM_FLOATS];
uint16_t new_optitrack = 0;
float Optitrackdata[OPTITRACKDATASIZE];
`,
  install(b: Board) {
    const c = b.compiler;
    for (const name of WEAK) c.globals.get(name)!.weak = true;
    const data = c.globals.get("ladar_data")!;
    const pingpong = c.globals.get("LADARpingpong")!;
    const isr = c.fns.get("RXCINT_recv_ready")!;

    // 0: waiting for 'G', 1: in the header, 2: in the distances.
    let state = 0;
    let count = 0;
    let high = -1;
    let index = 0;
    let feeds = 0;
    const feed = (ch: number): void => {
      if (state === 0) {
        if (ch === 0x47) {
          state = 1;
          count = 1;
        }
        return;
      }
      if (state === 1) {
        count++;
        // The 11th character is the status: anything but '0' is a refusal.
        if (count === 11 && ch !== 0x30) state = 0;
        else if (count === 12) {
          state = 2;
          high = -1;
          index = 0;
          feeds = 0;
        }
        return;
      }
      if (ch === 10) {
        if (++feeds < 2) return;
        state = 0;
        const next = 1 - b.mem.peek(pingpong.addr, 1);
        b.mem.write(pingpong.addr, 1, next);
        if (b.dev.get("PieCtrlRegs.PIEIER12") & (1 << 9)) b.pie.raise(12, 10);
        return;
      }
      feeds = 0;
      if (high < 0) {
        high = ch - 0x30;
        return;
      }
      let mm = (high << 6) + (ch - 0x30);
      high = -1;
      if (mm === 0 || mm === 6) mm = LADAR_MAX_READING;
      if (index < LIDAR_POINTS) {
        // Each element is angle, distance_ping, distance_pong: three floats of two words.
        const at = data.addr + index * 6 + (b.mem.peek(pingpong.addr, 1) === 0 ? 2 : 4);
        b.mem.write(at, 2, floatBits(Math.fround(mm * FT_PER_MM)));
      }
      index++;
    };

    const rxbuf = b.dev.reg("ScicRegs.SCIRXBUF").hook;
    const read = rxbuf.read!;
    rxbuf.read = (stored) => {
      const v = read(stored);
      // Only for the library's receive function and the library's ladar_data.
      if (b.isrDepth && isr.file === "library" && c.globals.get("ladar_data") === data && !(v & 0xc000)) feed(v & 0xff);
      return v;
    };
  },
};
