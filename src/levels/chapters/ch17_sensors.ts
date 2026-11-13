import type { Chapter } from "../types";
import type { Stimulus } from "../../sim/runner";
import { FT_PER_MM, LADAR_MAX_READING, dataLines, pointDeg, scan, type Pose } from "../../sim/plugins/lidar";

// ---------- expected values, from the same model the simulated sensor uses ----------

/** What the course code stores for a reading: error codes become LADAR_MAX_READING. */
const stored = (mm: number) => (mm < 20 ? LADAR_MAX_READING : mm);
const ft = (mm: number) => stored(mm) * FT_PER_MM;
const minOf = (s: number[], first: number, last: number) => Math.min(...s.slice(first, last + 1).map(stored));
const minFt = (s: number[], first: number, last: number) => minOf(s, first, last) * FT_PER_MM;
const poseStimuli = (at: number, p: Partial<Pose>): Stimulus[] => [
  ...(p.room !== undefined ? [{ at, set: "LIDAR_ROOM", value: p.room }] : []),
  ...(p.x !== undefined ? [{ at, set: "LIDAR_X_FT", value: p.x }] : []),
  ...(p.y !== undefined ? [{ at, set: "LIDAR_Y_FT", value: p.y }] : []),
  ...(p.theta !== undefined ? [{ at, set: "LIDAR_THETA_RAD", value: p.theta }] : []),
];
const near = (name: string, v: number, tol: number, at: number | undefined, label: string, hint?: string) =>
  ({ kind: "var" as const, name, min: v - tol, max: v + tol, at, label, hint });

// ---------- code shared by the levels ----------

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const SETUP = `    InitSysCtrl();
    InitGpio();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

const led = (pin: number, port: string, n: number) => `    // LED${n}, off
    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GP${port}CLEAR.bit.GPIO${pin} = 1;`;
const LEDS = [led(22, "A", 1), led(94, "C", 2), led(95, "C", 3)].join("\n");

const G_CMD = `// Command for the distances from -120 to 120 degrees
char G_command[] = "G04472503\\n";
uint16_t G_len = 10;`;

const PARSER_VARS = `uint16_t read_ladar_state = 0;  // 0: wait for 'G', 1: header, 2: data
uint16_t G_count = 0;           // characters of the header so far
uint16_t LF_count = 0;          // line feeds in a row
uint16_t get_dis_first = 1;     // 1: the next character starts a pair
uint16_t tempscid = 0;          // top 6 bits, already shifted up
uint16_t distance = 0;
uint16_t dis_index = 0;         // which point comes next`;

/** RXCINT_recv_ready as in the course's F28379dSerial.c, with the data state passed in. */
const parser = (state2: string, header = 12) => `// Runs each time a character arrives from the LIDAR (from F28379dSerial.c)
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
        if (read_ladar_state == 0) {
            // wait for the starting char 'G'
            if (RXCdata == 'G') {
                read_ladar_state = 1;
                G_count = 1;
            }
        } else if (read_ladar_state == 1) {
            // the header: echo of the command, status, line feed
            G_count += 1;
            // the 11th character is the status: anything but '0' is an error
            if (G_count == 11) {
                if (RXCdata != '0') {
                    read_ladar_state = 0;
                }
            }
            if (G_count >= ${header}) {
                // there are 12 characters before the data
                read_ladar_state = 2;
                get_dis_first = 1;
                dis_index = 0;
            }
        } else if (read_ladar_state == 2) {
${state2}
        }
        numRXC ++;
    }
    ScicRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}`;

/** The data state. `store` is what happens to a finished distance. */
const state2 = (store: string, done: string) => `            if (RXCdata == 0x0a) {
                // a line feed ends every line of 64 characters
                LF_count += 1;
            } else {
                LF_count = 0;
                if (get_dis_first == 1) {
                    // first character: the top 6 bits of the distance
                    tempscid = (RXCdata - 0x30) << 6;
                    get_dis_first = 0;
                } else {
                    // second character: the bottom 6 bits
                    distance = tempscid + (RXCdata - 0x30);
${store}
                    dis_index += 1;
                    get_dis_first = 1;
                }
            }
            if (LF_count == 2) {
                // two line feeds in a row: the reply is complete
                read_ladar_state = 0;
${done}
            }`;

const STORE_MM = `                    if (dis_index < 228) {
                        ladar_mm[dis_index] = distance;
                    }`;
const STORE_MM_SAFE = `                    if (distance < 20) {
                        // error code: no usable echo
                        distance = LADAR_MAX_READING;
                    }
                    if (dis_index < 228) {
                        ladar_mm[dis_index] = distance;
                    }`;
const STORE_FT = `                    if (distance == 0 || distance == 6) {
                        // error code: set to the max reading
                        distance = LADAR_MAX_READING;
                    }
                    if (dis_index < 228) {
                        ladar_ft[dis_index] = distance*0.00328084;
                    }`;
const DONE = `                scan_done();`;

const TIMER1_ISR = `// CPU Timer 1 asks the LIDAR for a new scan every 100 ms
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
    CpuTimer1.InterruptCount++;
}`;

const lidarMain = (extra = "", loop = "    while (1) {}") => `void main(void)
{
${SETUP}
${extra}
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    EDIS;

    InitCpuTimers();
    // !!!!! Important, used to command the LADAR every 100 ms
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;

    init_serialSCIC(&SerialC, 115200);

    IER |= M_INT8;   // SCIC
    IER |= M_INT13;  // CPU Timer 1
    EINT;

${loop}
}`;

/** Main for the levels that read the scan through tb_lidar_ft() from a 100 ms timer. */
const tbMain = (leds: boolean) => `void main(void)
{
${SETUP}
${leds ? `\n${LEDS}\n` : ""}
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;

    IER |= M_INT13;  // CPU Timer 1
    EINT;

    while (1) {}
}`;

const MIN_FT_TB = `// Smallest reading, in feet, of points first to last
float min_ft(int first, int last)
{
    int i;
    float m = 19.0;   // more than the largest reading
    for (i = first; i <= last; i++) {
        if (tb_lidar_ft(i) < m) {
            m = tb_lidar_ft(i);
        }
    }
    return m;
}`;

// ---------- decoding ----------

const DEC_SCAN = scan({ room: 3, x: 4, y: 6.2, theta: 0.4 });
const DEC_LINES = dataLines(DEC_SCAN);
const DEC_LINE = DEC_LINES[3];
const DEC_TAIL = DEC_LINES[7];
const DEC_MM = DEC_SCAN.slice(96, 128);

const decodeProgram = (decode: string, decodeLine: string) => `// Line 4 of a reply (points 96 to 127) and its short last line, without the line feeds
char line[] = "${DEC_LINE}";
char tail[] = "${DEC_TAIL}";

int dist[32];
int rest[32];
int single_mm = 0;
int count = 0;
int first_mm = 0;
int last_mm = 0;
long sum_mm = 0;
int tail_count = 0;
int tail_mm = 0;

// Distance in mm from the two characters of one reading
int decode(char hi, char lo)
{
${decode}
}

// Decodes a line of text: two characters per reading, up to the 0 that ends
// the string or a line feed. Stores the distances in out[] and returns how
// many there were.
int decode_line(char *text, int *out)
{
${decodeLine}
}

void main(void)
{
    int i;

    single_mm = decode('M', 'c');
    count = decode_line(line, dist);
    first_mm = dist[0];
    last_mm = dist[31];
    for (i = 0; i < 32; i++) {
        sum_mm += dist[i];
    }
    tail_count = decode_line(tail, rest);
    tail_mm = rest[3];

    while (1) {}
}
`;

// ---------- the parser levels ----------

const PARSE_A = scan({ room: 0, x: 5, y: 5, theta: 0 });
const PARSE_B = scan({ room: 0, x: 7, y: 3, theta: 0.5 });

const parserProgram = (body: string, header = 12) => `${FREQ}

__interrupt void cpu_timer1_isr(void);
void scan_done(void);

${G_CMD}

${PARSER_VARS}
uint16_t ladar_mm[228];         // the distances of the last scan, mm

uint16_t scans = 0;
uint16_t points = 0;
uint16_t front_mm = 0;
uint16_t right_mm = 0;
uint16_t left_mm = 0;

${lidarMain()}

// Called when a reply is complete
void scan_done(void)
{
    scans++;
    points = dis_index;
    right_mm = ladar_mm[28];    // -90 degrees
    front_mm = ladar_mm[113];   // straight ahead
    left_mm = ladar_mm[199];    // +90 degrees
}

${TIMER1_ISR}

${parser(body, header)}
`;

const parserChecks = (a: number[], b: number[]) => [
  { kind: "var" as const, name: "scans", at: 160, equals: 1, label: "The first scan is complete after its two line feeds", hint: "The reply ends with two line feeds in a row. A single line feed only ends a line." },
  { kind: "var" as const, name: "points", at: 160, equals: 228, label: "The scan has 228 points", hint: "More than 228: line feeds are being decoded as data. Fewer: characters are being skipped." },
  { kind: "var" as const, name: "right_mm", at: 160, equals: a[28], label: `Point 28 (right) of the first scan is ${a[28]} mm` },
  { kind: "var" as const, name: "front_mm", at: 160, equals: a[113], label: `Point 113 (front) of the first scan is ${a[113]} mm`, hint: "Point 113 is in the fourth line. If only the points of the first line are right, look at what happens at a line feed." },
  { kind: "var" as const, name: "left_mm", at: 160, equals: a[199], label: `Point 199 (left) of the first scan is ${a[199]} mm` },
  { kind: "var" as const, name: "scans", equals: 2, label: "The second scan is complete too", hint: "After a scan, go back to state 0 so the next 'G' starts a new one." },
  { kind: "var" as const, name: "front_mm", equals: b[113], label: `After the robot moved, the front reading is ${b[113]} mm` },
  { kind: "var" as const, name: "left_mm", equals: b[199], label: `After the robot moved, the left reading is ${b[199]} mm` },
];

const BUGGY_STATE2 = `            if (RXCdata == 0x0a) {
                // a line feed ends every line of 64 characters
                LF_count += 1;
            } else {
                LF_count = 0;
            }
            if (get_dis_first == 1) {
                // first character: the top 6 bits of the distance
                tempscid = (RXCdata - 0x30) << 6;
                get_dis_first = 0;
            } else {
                // second character: the bottom 6 bits
                distance = tempscid + (RXCdata - 0x30);
                if (dis_index < 228) {
                    ladar_mm[dis_index] = distance;
                }
                dis_index += 1;
                get_dis_first = 1;
            }
            if (LF_count == 2) {
                // two line feeds in a row: the reply is complete
                read_ladar_state = 0;
                scan_done();
            }`;

// ---------- error codes (practice) ----------

const ERR_A = scan({ room: 1, x: 0, y: 0, theta: 0 });
const ERR_B = scan({ room: 1, x: 27, y: 0, theta: 0 });

const errProgram = (store: string) => `${FREQ}

__interrupt void cpu_timer1_isr(void);
void scan_done(void);

${G_CMD}

${PARSER_VARS}
uint16_t ladar_mm[228];         // the distances of the last scan, mm

uint16_t scans = 0;
uint16_t front_mm = 0;
uint16_t nearest_mm = 0;

${lidarMain()}

// Called when a reply is complete
void scan_done(void)
{
    uint16_t i;
    scans++;
    front_mm = ladar_mm[113];
    nearest_mm = ladar_mm[0];
    for (i = 1; i < 228; i++) {
        if (ladar_mm[i] < nearest_mm) {
            nearest_mm = ladar_mm[i];
        }
    }
}

${TIMER1_ISR}

${parser(state2(store, DONE))}
`;

// ---------- nearest obstacle ----------

const NEAR_POSES: Pose[] = [
  { room: 3, x: 5, y: 5, theta: 0 },
  { room: 3, x: 8.3, y: 3.1, theta: 0.3 },
];
const nearestOf = (p: Pose) => {
  const s = scan(p).map(stored);
  const index = s.indexOf(Math.min(...s));
  return { index, ft: s[index] * FT_PER_MM, deg: pointDeg(index), right: minFt(s, 26, 30), front: minFt(s, 111, 115) };
};
const NEAR = NEAR_POSES.map(nearestOf);

const nearestProgram = (pointDegBody: string, body: string) => `${FREQ}

__interrupt void cpu_timer1_isr(void);

float dist[228];          // the last scan, feet
int nearest_index = 0;
float nearest_ft = 0;
float nearest_deg = 0;
float front_ft = 0;
float right_ft = 0;
uint32_t numScans = 0;

// Angle of point i in degrees: 0 is straight ahead, positive is to the left
float point_deg(int i)
{
${pointDegBody}
}

// Called with a new scan in dist[]
void process_scan(void)
{
${body}
}

${tbMain(false)}

// A new scan every 100 ms. On the robot the scan arrives over SCIC; here the
// test bench hands over the distances directly.
__interrupt void cpu_timer1_isr(void)
{
    int i;
    for (i = 0; i < 228; i++) {
        dist[i] = tb_lidar_ft(i);
    }
    process_scan();
    numScans++;
}
`;

// ---------- wall follower ----------

const FOLLOW_DEFS = `#define STRAIGHT  1
#define TURN_LEFT 2
#define FOLLOW    3

#define FRONT_BLOCKED 1.5   // feet: closer than this in front means turn
#define FRONT_CLEAR   3.0   // feet: the turn is finished when the front is this open
#define WALL_NEAR     2.5   // feet: a wall this close on the right can be followed
#define WALL_LOST     4.0   // feet: beyond this the wall on the right is gone`;

const SWITCH = `    switch (state) {
    case STRAIGHT:
        if (front_ft < FRONT_BLOCKED) {
            state = TURN_LEFT;
        } else if (right_ft < WALL_NEAR) {
            state = FOLLOW;
        }
        break;
    case TURN_LEFT:
        if (front_ft > FRONT_CLEAR) {
            state = FOLLOW;
        }
        break;
    case FOLLOW:
        if (front_ft < FRONT_BLOCKED) {
            state = TURN_LEFT;
        } else if (right_ft > WALL_LOST) {
            state = STRAIGHT;
        }
        break;
    default:
        state = STRAIGHT;
        break;
    }`;

const SHOW = `    // LED1: straight, LED2: turning left, LED3: following the wall
    if (state == STRAIGHT) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }
    if (state == TURN_LEFT) {
        GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    } else {
        GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    }
    if (state == FOLLOW) {
        GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    } else {
        GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    }`;

const followProgram = (body: string, opts: { defs?: string; initial?: string; count?: boolean } = {}) => `${FREQ}

${opts.defs ?? FOLLOW_DEFS}

__interrupt void cpu_timer1_isr(void);

int state = ${opts.initial ?? "STRAIGHT"};
float front_ft = 0;
float right_ft = 0;
uint32_t numScans = 0;${opts.count ? "\nint last_state = FOLLOW;\nint transitions = 0;   // how many times the state changed" : ""}

${MIN_FT_TB}

// The state machine: called once for every new scan
void wall_follow(void)
{
${body}
}

${tbMain(true)}

// A new scan every 100 ms. In the course code these lines are in the software
// interrupt that runs when the LIDAR's reply is complete.
__interrupt void cpu_timer1_isr(void)
{
    front_ft = min_ft(111, 115);
    right_ft = min_ft(26, 30);
    wall_follow();${opts.count ? "\n    if (state != last_state) {\n        transitions++;\n        last_state = state;\n    }" : ""}
    numScans++;
}
`;

// Script for the three-state follower, in the 10 ft box. One pose per scan.
const FOLLOW_SCRIPT: { pose: Partial<Pose>; state: number; why: string }[] = [
  { pose: { x: 5, y: 5, theta: 0 }, state: 1, why: "In the open (5 ft all round) the robot drives straight" },
  { pose: { x: 5, y: 2, theta: 0 }, state: 3, why: "A wall 2 ft to the right: follow it" },
  { pose: { x: 8.8, y: 2, theta: 0 }, state: 2, why: "A wall 1.2 ft ahead: turn left" },
  { pose: { x: 8.8, y: 2, theta: 0.8 }, state: 2, why: "Front at 1.7 ft, part way through the turn: keep turning" },
  { pose: { x: 8.8, y: 2, theta: Math.PI / 2 }, state: 3, why: "Front open again (8 ft): follow the wall now on the right" },
  { pose: { x: 5, y: 5, theta: Math.PI / 2 }, state: 1, why: "The wall on the right is 5 ft away: lost, drive straight" },
  { pose: { x: 5, y: 8.8, theta: Math.PI / 2 }, state: 2, why: "Driving straight into a wall 1.2 ft ahead: turn left" },
];
const LED_OF: Record<number, string> = { 1: "LED1", 2: "LED2", 3: "LED3" };

// Script for the chattering level: the front distance hovers around 1.5 ft.
const CHATTER_FRONT = [4, 1.47, 1.53, 1.46, 1.52, 1.48, 3.5];

// ---------- checkpoint ----------

const CORRIDOR: Partial<Pose>[] = [
  { room: 1, x: 0, y: 0, theta: 0 },
  { x: 27.5 },
  { x: 29 },
  { theta: Math.PI / 2 },
  { theta: Math.PI },
];
const CORRIDOR_LINES = (() => {
  let pose: Pose = { room: 1, x: 0, y: 0, theta: 0 };
  let state = 1;
  return CORRIDOR.map((step) => {
    pose = { ...pose, ...step };
    const s = scan(pose);
    const front = minFt(s, 111, 115);
    const left = minFt(s, 197, 201);
    const right = minFt(s, 26, 30);
    if (state === 1) state = front < 1.5 ? 2 : right < 2.5 ? 3 : 1;
    else if (state === 2) state = front > 3.0 ? 3 : 2;
    else state = front < 1.5 ? 2 : right > 4.0 ? 1 : 3;
    return `F ${front.toFixed(2)} L ${left.toFixed(2)} R ${right.toFixed(2)} S ${state}`;
  });
})();

const WALL_FOLLOW_FN = `// The three-state wall follower of the earlier level
void wall_follow(void)
{
${SWITCH}
}`;

const corridorProgram = (enables: string, timer: string, loop: string) => `${FREQ}

${FOLLOW_DEFS}

__interrupt void cpu_timer1_isr(void);
void scan_done(void);

${G_CMD}

${PARSER_VARS}
float ladar_ft[228];            // the distances of the last scan, feet

uint16_t newScan = 0;           // flag: set when a scan is complete
uint32_t numScans = 0;
int state = STRAIGHT;
float front_ft = 0;
float left_ft = 0;
float right_ft = 0;

// Smallest reading, in feet, of points first to last
float min_ft(int first, int last)
{
    int i;
    float m = 19.0;   // more than the largest reading
    for (i = first; i <= last; i++) {
        if (ladar_ft[i] < m) {
            m = ladar_ft[i];
        }
    }
    return m;
}

${WALL_FOLLOW_FN}

void main(void)
{
${SETUP}

${enables}

    while (1) {
${loop}
    }
}

// Called when a reply is complete
void scan_done(void)
{
    newScan = 1;
}

// CPU Timer 1 asks the LIDAR for a new scan every 100 ms
__interrupt void cpu_timer1_isr(void)
{
${timer}
    CpuTimer1.InterruptCount++;
}

${parser(state2(STORE_FT, DONE))}
`;

// ---------- expert: world coordinates ----------

const SENSOR_OFFSET = 3.5 / 12;
const WORLD_POSES: Pose[] = [
  { room: 2, x: 1, y: 0.5, theta: 0.3, offset: SENSOR_OFFSET },
  { room: 2, x: -3, y: 1, theta: -0.4, offset: SENSOR_OFFSET },
];
const WORLD_N = WORLD_POSES.map((p) => scan(p).filter((v) => v >= 20).length);

const worldProgram = (toWorld: string, fit: string) => `${FREQ}

#define LADAR_OFFSET 0.29167   // the sensor is 3.5 inches ahead of the robot's centre, feet
#define NO_ECHO 18.0           // readings above this are "nothing there"

__interrupt void cpu_timer1_isr(void);

float dist[228];     // the last scan, feet
float ptx[228];      // world coordinates of every point
float pty[228];
float robot_x = 0;   // pose of the robot's centre, feet and radians
float robot_y = 0;
float robot_theta = 0;

int npts = 0;          // points used in the fit
float wall_m = 0;      // the wall in world coordinates: y = wall_m * x + wall_c
float wall_c = 0;
float wall_dist = 0;   // shortest distance from the robot's centre to the wall, feet
float wall_angle = 0;  // direction of the wall relative to the robot's heading, radians
uint32_t numScans = 0;

// World coordinates of every point of the scan, into ptx[] and pty[]
void to_world(void)
{
${toWorld}
}

// Least-squares line through the points that have an echo
void fit_wall(void)
{
${fit}
}

${tbMain(false)}

// A new scan every 100 ms, with the pose the robot had when it was taken
__interrupt void cpu_timer1_isr(void)
{
    int i;
    for (i = 0; i < 228; i++) {
        dist[i] = tb_lidar_ft(i);
    }
    robot_x = tb_pose_x();
    robot_y = tb_pose_y();
    robot_theta = tb_pose_theta();
    to_world();
    fit_wall();
    numScans++;
}
`;

// ---------- expert: doorway ----------

const DOOR_POSES: Pose[] = [
  { room: 4, x: 5, y: 5, theta: 0 },
  { room: 4, x: 6, y: 3, theta: 0.5 },
];
const doorOf = (p: Pose) => {
  const s = scan(p).map(ft);
  let best: { deg: number; width: number } | null = null;
  for (let i = 1; i < 227; ) {
    if (s[i] <= 18) {
      i++;
      continue;
    }
    let j = i;
    while (j < 227 && s[j + 1] > 18) j++;
    if (j - i + 1 >= 5 && s[i - 1] <= 18 && j + 1 <= 227 && s[j + 1] <= 18) {
      const a = s[i - 1];
      const b = s[j + 1];
      const gap = ((pointDeg(j + 1) - pointDeg(i - 1)) * Math.PI) / 180;
      best = { deg: (pointDeg(i - 1) + pointDeg(j + 1)) / 2, width: Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(gap)) };
    }
    i = j + 1;
  }
  if (!best) throw new Error("no doorway in the reference scan");
  return best;
};
const DOORS = DOOR_POSES.map(doorOf);

const doorProgram = (body: string) => `${FREQ}

#define NO_ECHO 18.0   // readings above this are "nothing there"

__interrupt void cpu_timer1_isr(void);

float dist[228];        // the last scan, feet
int door_found = 0;     // 1 when the scan shows a doorway
float door_deg = 0;     // direction of the middle of the doorway, degrees
float door_width_ft = 0;
uint32_t numScans = 0;

// Angle of point i in degrees
float point_deg(int i)
{
    return (3*i + 44)*0.3515625 - 135.0;
}

// Called with a new scan in dist[]
void find_door(void)
{
${body}
}

${tbMain(false)}

__interrupt void cpu_timer1_isr(void)
{
    int i;
    for (i = 0; i < 228; i++) {
        dist[i] = tb_lidar_ft(i);
    }
    find_door();
    numScans++;
}
`;

// ---------- expert: a parser that survives a lost character ----------

const ROBUST_POSE: Pose = { room: 3, x: 4, y: 6.2, theta: 0.4 };
const ROBUST = scan(ROBUST_POSE);

const robustProgram = (vars: string, isr: string) => `${FREQ}

__interrupt void cpu_timer1_isr(void);
void scan_done(void);

${G_CMD}

${PARSER_VARS}
uint16_t ladar_mm[228];         // the distances of the last scan, mm
${vars}
uint16_t good_scans = 0;
uint16_t bad_scans = 0;         // replies you recognised as damaged and threw away
uint16_t front_mm = 0;
uint16_t right_mm = 0;
uint16_t left_mm = 0;

${lidarMain()}

// Called when a reply is complete and believed to be intact. Do not change it.
void scan_done(void)
{
    good_scans++;
    right_mm = ladar_mm[28];
    front_mm = ladar_mm[113];
    left_mm = ladar_mm[199];
}

${TIMER1_ISR}

${isr}
`;

const ROBUST_ISR = `// Runs each time a character arrives from the LIDAR
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
        if (read_ladar_state == 0) {
            if (RXCdata == 'G') {
                read_ladar_state = 1;
                G_count = 1;
            }
        } else if (read_ladar_state == 1) {
            // every character of the header must be the expected one
            if (RXCdata == G_expect[G_count]) {
                G_count += 1;
                if (G_count == 12) {
                    read_ladar_state = 2;
                    get_dis_first = 1;
                    dis_index = 0;
                    line_chars = 0;
                }
            } else if (RXCdata == 'G') {
                G_count = 1;
            } else {
                read_ladar_state = 0;
            }
        } else if (read_ladar_state == 2) {
            if (RXCdata == 0x0a) {
                if (dis_index == 228 && get_dis_first == 1) {
                    // every point arrived: complete, whatever follows
                    read_ladar_state = 0;
                    scan_done();
                } else if (line_chars != 64) {
                    // a short line before the end: a character was lost
                    read_ladar_state = 0;
                    bad_scans++;
                }
                line_chars = 0;
            } else {
                line_chars += 1;
                if (line_chars > 64 || dis_index >= 228) {
                    // a line feed was lost, or there is more data than a scan has
                    read_ladar_state = 0;
                    bad_scans++;
                } else if (get_dis_first == 1) {
                    tempscid = (RXCdata - 0x30) << 6;
                    get_dis_first = 0;
                } else {
                    distance = tempscid + (RXCdata - 0x30);
                    ladar_mm[dis_index] = distance;
                    dis_index += 1;
                    get_dis_first = 1;
                }
            }
        }
        numRXC ++;
    }
    ScicRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}`;

// =====================================================================

export const ch17: Chapter = {
  id: "sensors",
  number: 17,
  title: "Sensors and state machines",
  blurb: "Laser ranging, the LIDAR's serial protocol and wall-following state machines.",
  requires: ["serial"],
  course: ["L14", "L16", "HW3", "HW4", "HW5"],
  levels: [
    {
      id: "sens-brief",
      kind: "brief",
      title: "Measuring distance with light",
      goal: "Learn how the robot measures distance and how it turns a scan into a decision.",
      refs: [{ course: "L14" }, { course: "L16" }],
      brief: `
A robot that drives has to know how far away things are. This chapter is about the sensor that tells it, and about the code that decides what to do with the answer.

## Passive and active sensors
A **passive** sensor only listens: a camera, a microphone, a thermometer. An **active** sensor sends energy out and measures what comes back: an infrared (IR) distance sensor, an ultrasonic sensor, a laser scanner. Active sensors work in the dark, but two of the same kind can disturb each other.

## Infrared distance sensors
An IR distance sensor lights the scene with an infrared LED and measures how strong the reflection is. The light spreads out on the way to the object and spreads out again on the way back, so the returned intensity falls off **faster than 1/r^2**. A little further away means a lot less signal, and the reading also depends on the colour of the surface.

## Time of flight
A **LIDAR** (the course code calls it LADAR) does not measure how strong the echo is. It measures **how long** a laser pulse takes to come back:

\`\`\`c
d = c * t / 2;   // c = 3.0e8 m/s, t = time for the round trip
\`\`\`

The division by 2 is there because the light travels the distance twice. Light is fast: an echo from 3 m arrives after only 20 ns.

## A scan
The course robot carries a Hokuyo URG-04LX. A mirror inside spins the laser beam around, so one sensor measures in many directions. The result of one turn is a **scan**: a list of distances, one per direction, like a map seen from above.

- laser: 785 nm (infrared, invisible), class 1
- field of view: 240 degrees, in steps of 360/1024 = 0.3515625 degrees
- range: 20 mm to 4095 mm
- a new scan ten times per second

Class 1 means safe to look at. With stronger lasers, invisible infrared is the more dangerous kind: your eye does not see it, so you do not blink or look away.

## From a scan to a decision
The distances arrive over a serial port (SCIC). Your code asks for a scan every 100 ms, decodes the reply character by character, and then decides: drive on, turn, or follow the wall. The decision code is a **state machine**: the robot is always in exactly one state (driving straight, turning left, following a wall), and the sensor readings decide when it moves to another one.

Both the decoder and the wall follower are state machines. You will write both.
`,
      questions: [
        {
          prompt: "Which of these is an active sensor?",
          options: ["A camera", "A LIDAR", "A microphone", "A thermometer"],
          answer: 1,
          why: "A LIDAR sends out laser pulses and measures their echo. The other three only receive what is already there.",
        },
        {
          prompt: "An IR distance sensor measures the strength of the reflection. Why does that strength fall off faster than 1/r^2?",
          options: [
            "The light spreads out on the way to the object and again on the way back",
            "Infrared light is slower than visible light",
            "The LED gets weaker as it warms up",
            "The object absorbs all of the light",
          ],
          answer: 0,
          why: "It is a round trip: the light thins out going to the object, and the reflection thins out again coming back.",
        },
        {
          prompt: "Why is a strong infrared laser more dangerous for your eyes than a visible one of the same power?",
          options: [
            "Infrared light carries more energy per photon",
            "You cannot see it, so you do not blink or look away",
            "Infrared travels further in air",
            "It is not: visible light is always worse",
          ],
          answer: 1,
          why: "The blink reflex protects you from bright visible light. An invisible beam does not trigger it. The course LIDAR is class 1, which is safe.",
        },
      ],
    },
    {
      id: "sens-tof",
      kind: "calc",
      title: "How fast is light",
      goal: "Work out the times a laser range finder has to measure, and compare them with the CPU clock.",
      refs: [{ course: "L14" }, { trm: "3.7" }],
      brief: `
Time of flight: the sensor sends a pulse and times the echo.

\`\`\`c
d = c * t / 2;
\`\`\`

Use c = 3.0e8 m/s. One nanosecond (ns) is 1e-9 s, one picosecond (ps) is 1e-12 s.

The CPU of the F28379D runs at 200 MHz. Imagine you tried to time the echo yourself by counting CPU clock periods. The last two questions show why nobody does that: the LIDAR has its own dedicated timing circuit and only sends you the finished distance.
`,
      fields: [
        { id: "t3m", label: "Round-trip time for a wall 3 m away", unit: "ns", answer: 20, tolPct: 1, why: "t = 2 d / c = 6 m / 3.0e8 m/s = 20 ns." },
        { id: "d10", label: "The echo returns after 10 ns. Distance to the object", unit: "m", answer: 1.5, tolPct: 1, why: "d = c t / 2 = 3.0e8 * 10e-9 / 2 = 1.5 m." },
        { id: "sysclk", label: "Period of the 200 MHz CPU clock", unit: "ns", answer: 5, why: "1 / 200e6 Hz = 5 ns." },
        { id: "res", label: "Distance that corresponds to one clock period of round-trip time", unit: "m", answer: 0.75, tolPct: 1, why: "d = c * 5 ns / 2 = 0.75 m. Counting CPU clocks could only tell 0.75 m steps apart." },
        { id: "ps", label: "Round-trip time difference for 1 mm of distance", unit: "ps", answer: 6.67, tolPct: 1, why: "t = 2 * 0.001 m / 3.0e8 m/s = 6.67e-12 s. Millimetre accuracy needs picosecond timing." },
      ],
      hints: [
        "The light goes there and back: the round trip is twice the distance.",
        "For the fourth field, put the clock period into d = c t / 2.",
        "20 ns, 1.5 m, 5 ns, 0.75 m, 6.67 ps.",
      ],
      takeaway: "A 5 ns clock is far too coarse to time one laser pulse. The sensor does the timing in its own hardware and sends you a number.",
    },
    {
      id: "sens-angles",
      kind: "calc",
      title: "Where each point looks",
      goal: "Work out how many points the course's scan has and in which direction each one looks.",
      refs: [{ course: "L16" }, { course: "HW4" }],
      brief: `
The mirror of the URG-04LX stops at **1024 steps per turn**. Step 384 looks straight ahead. Steps count up to the left (counter-clockwise seen from above).

The course asks for the scan with the command \`G04472503\`:

- \`044\`: first step, 44
- \`725\`: last step, 725
- \`03\`: cluster count 3, one distance for every group of 3 steps

So point \`i\` of the reply belongs to step \`3*i + 44\`, and the course code computes its angle like this (degrees, before the conversion to radians):

\`\`\`c
angle = (3*i + 44)*0.3515625 - 135;
\`\`\`

0 degrees is straight ahead, negative angles are to the **right**, positive angles to the **left**. The 135 is the angle of step 384: 384 * 0.3515625.

The last group is not full (steps 725 and 726 are missing from it), but it still produces a point. HW4 rounds these numbers: 228 readings from -120 to 120 degrees, about 1.05 degrees apart, element 113 straight ahead.
`,
      fields: [
        { id: "pitch", label: "Angle between two steps (360 / 1024)", unit: "deg", answer: 0.3515625, tolPct: 0.5, why: "360 / 1024 = 0.3515625 degrees. The data sheet rounds it to 0.36." },
        { id: "n", label: "Number of points in the reply (steps 44 to 725, groups of 3)", answer: 228, why: "725 - 44 + 1 = 682 steps; 682 / 3 = 227.3, and the last, incomplete group still gives a point: 228." },
        { id: "spacing", label: "Angle between two neighbouring points", unit: "deg", answer: 1.0546875, tolPct: 0.6, why: "3 steps of 0.3515625 degrees = 1.0547 degrees." },
        { id: "a0", label: "Angle of point 0", unit: "deg", answer: -119.53, tolPct: 0.2, why: "44 * 0.3515625 - 135 = -119.53 degrees: far to the right." },
        { id: "front", label: "Index of the point closest to straight ahead", answer: 113, why: "Straight ahead is step 384. (384 - 44) / 3 = 113.3, so point 113 (step 383, -0.35 degrees) is the closest." },
        { id: "right", label: "Index of the point that looks exactly to the right (-90 degrees)", answer: 28, why: "-90 degrees is step (135 - 90) / 0.3515625 = 128. (128 - 44) / 3 = 28." },
      ],
      hints: [
        "Count steps first, then divide by the cluster count and round up.",
        "To go from an angle to an index, undo the formula: step = (angle + 135) / 0.3515625, then i = (step - 44) / 3.",
        "0.3515625, 228, 1.0547, -119.53, 113, 28.",
      ],
      takeaway: "Point 113 looks ahead, point 28 to the right, point 199 to the left. The scan covers a little less than -120 to +120 degrees.",
    },
    {
      id: "sens-encode",
      kind: "register",
      title: "Two characters, twelve bits",
      goal: "Decode the two characters M and c into a 12-bit distance.",
      refs: [{ course: "L16" }],
      brief: `
The LIDAR sends text, not binary numbers, so that no distance can ever look like a line feed. A distance is at most 4095 mm, which fits in **12 bits**. The sensor splits those 12 bits into two halves of **6 bits** and adds **0x30** to each half. Every half then becomes a printable character between \`'0'\` (0x30) and \`'o'\` (0x6F).

To decode, undo it:

1. subtract 0x30 from the first character: the upper 6 bits
2. subtract 0x30 from the second character: the lower 6 bits
3. distance = upper * 64 + lower

## Your task
The sensor sent the two characters \`M\` and \`c\`. In ASCII, \`'M'\` is 0x4D and \`'c'\` is 0x63.

Set the bits of the 12-bit distance. The field **high** takes the 6 bits from \`M\`, the field **low** the 6 bits from \`c\`. The value you build is the distance in millimetres.
`,
      custom: {
        bits: 16,
        fields: [
          { name: "high", hi: 11, lo: 6, desc: "first character - 0x30" },
          { name: "low", hi: 5, lo: 0, desc: "second character - 0x30" },
        ],
      },
      initial: 0,
      targets: [
        { field: "high", value: 0x1d },
        { field: "low", value: 0x33 },
      ],
      code: `distance = (('M' - 0x30) << 6) + ('c' - 0x30);   // 1907 mm`,
      hints: [
        "0x4D - 0x30 = 0x1D and 0x63 - 0x30 = 0x33.",
        "0x1D is 01 1101 in six bits, 0x33 is 11 0011.",
        "high = 011101, low = 110011: the value is 0x773 = 1907.",
      ],
      takeaway: "29 * 64 + 51 = 1907 mm. Shifting left by 6 is the same as multiplying by 64.",
    },
    {
      id: "sens-decode",
      kind: "code",
      mode: "write",
      title: "Decode a line",
      goal: "Write decode() for one reading and decode_line() for a whole line of readings.",
      refs: [{ course: "L16" }],
      brief: `
Now do in C what you just did by hand.

## \`int decode(char hi, char lo)\`
Returns the distance in millimetres for the two characters of one reading: subtract 0x30 from each, shift the first one up by 6 bits, add the second.

## \`int decode_line(char *text, int *out)\`
The sensor sends the readings in lines of 64 characters, which is 32 readings. \`decode_line\` walks through the text two characters at a time, stores each distance in \`out[0]\`, \`out[1]\`, ... and returns how many readings it found. It stops at the \`0\` that ends a C string, or at a line feed (\`'\\n'\`).

The program calls your functions on two pieces of a real reply: a full line of 64 characters, and the short last line of a scan, which has only 8.
`,
      kit: "robot",
      durationMs: 2,
      starter: decodeProgram(`    return 0;`, `    return 0;`),
      solution: decodeProgram(
        `    return ((hi - 0x30) << 6) + (lo - 0x30);`,
        `    int n = 0;
    while (text[2*n] != 0 && text[2*n] != '\\n') {
        out[n] = decode(text[2*n], text[2*n + 1]);
        n++;
    }
    return n;`,
      ),
      checks: [
        { kind: "var", name: "single_mm", equals: 1907, label: "decode('M', 'c') is 1907", hint: "(0x4D - 0x30) * 64 + (0x63 - 0x30). The first character is the upper half." },
        { kind: "var", name: "count", equals: 32, label: "The full line holds 32 readings", hint: "Two characters per reading: advance by 2 each time, and stop at the 0 that ends the string." },
        { kind: "var", name: "first_mm", equals: DEC_MM[0], label: `The first reading of the line is ${DEC_MM[0]} mm` },
        { kind: "var", name: "last_mm", equals: DEC_MM[31], label: `The last reading of the line is ${DEC_MM[31]} mm` },
        { kind: "var", name: "sum_mm", equals: DEC_MM.reduce((a, v) => a + v, 0), label: "Every reading in between is right too (their sum matches)" },
        { kind: "var", name: "tail_count", equals: 4, label: "The short line holds 4 readings", hint: "Do not assume 32 readings: stop where the text stops." },
        { kind: "var", name: "tail_mm", equals: DEC_SCAN[227], label: `The last reading of the scan is ${DEC_SCAN[227]} mm` },
      ],
      watch: ["single_mm", "count", "first_mm", "last_mm", "tail_count"],
      hints: [
        "A char is a small number. `hi - 0x30` is a value from 0 to 63.",
        "Reading n uses text[2*n] and text[2*n + 1]. Loop while text[2*n] is neither 0 nor '\\n'.",
        "`return ((hi - 0x30) << 6) + (lo - 0x30);` and `while (text[2*n] != 0 && text[2*n] != '\\n') { out[n] = decode(text[2*n], text[2*n + 1]); n++; }`",
      ],
      takeaway: "Two characters per point, 32 points per line. The whole scan of 228 points is seven full lines and one short one.",
    },
    {
      id: "sens-poll",
      kind: "code",
      mode: "complete",
      title: "Ask every 100 ms",
      goal: "Send the G command to the LIDAR from CPU timer 1 and let the receive interrupt count the reply.",
      refs: [{ course: "L16" }, { trm: "19" }, { trm: "3.8" }, { trm: "3.4.5" }],
      brief: `
The URG-04LX only speaks when spoken to. Its commands are single letters: \`V\` (version), \`L\` (laser on or off), \`S\` (change the baud rate) and \`G\` (get distances). After power-up it listens at 19200 baud; the course switches it to **115200** baud once, with the S command, and that is how you find it here.

The LIDAR is wired to **SCIC**: \`init_serialSCIC(&SerialC, 115200);\` sets up the port and its pins (GPIO139 receives, GPIO56 transmits).

## The request
The course sends this from **CPU timer 1**, every 100 ms:

\`\`\`c
serial_sendSCIC(&SerialC, G_command, G_len);
\`\`\`

\`G_command\` is \`"G04472503\\n"\`: the letter, first step 044, last step 725, cluster count 03, and a line feed. Ten characters.

## The reply
The sensor answers with

- the echo of your command and its line feed (10 characters)
- a status character, \`'0'\` when all is well, and a line feed (2 characters)
- the data: 228 points, 2 characters each = 456 characters, in lines of 64, each line followed by a line feed (7 full lines and one of 8 characters: 8 line feeds)
- one more line feed, so the reply ends with two in a row

That is 10 + 2 + 456 + 8 + 1 = **477 characters**. At 115200 baud they take about 41 ms, comfortably inside the 100 ms.

## Your task
Every character from the LIDAR causes the SCIC receive interrupt, **PIE group 8, interrupt 5**. The library function \`RXCINT_recv_ready\` takes the character and counts it in \`numRXC\`. Three things are missing:

1. the vector: \`PieVectTable.SCIC_RX_INT\` must point to \`RXCINT_recv_ready\`
2. the CPU enable for group 8: \`M_INT8\`
3. the request itself, in \`cpu_timer1_isr\`
`,
      kit: "robot",
      durationMs: 360,
      starter: `${FREQ}

__interrupt void cpu_timer1_isr(void);

${G_CMD}

void main(void)
{
${SETUP}

    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    // TODO 1: the vector for the SCIC receive interrupt
    EDIS;

    InitCpuTimers();
    // !!!!! Important, used to command the LADAR every 100 ms
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;

    init_serialSCIC(&SerialC, 115200);

    // TODO 2: enable PIE group 8 in IER
    IER |= M_INT13;  // CPU Timer 1
    EINT;

    while (1) {}
}

// CPU Timer 1 asks the LIDAR for a new scan every 100 ms
__interrupt void cpu_timer1_isr(void)
{
    // TODO 3: send G_command on SerialC
    CpuTimer1.InterruptCount++;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer1_isr(void);

${G_CMD}

void main(void)
{
${SETUP}

    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    EDIS;

    InitCpuTimers();
    // !!!!! Important, used to command the LADAR every 100 ms
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;

    init_serialSCIC(&SerialC, 115200);

    IER |= M_INT8;   // SCIC
    IER |= M_INT13;  // CPU Timer 1
    EINT;

    while (1) {}
}

// CPU Timer 1 asks the LIDAR for a new scan every 100 ms
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
    CpuTimer1.InterruptCount++;
}
`,
      checks: [
        { kind: "serial", port: 2, equals: "G04472503\nG04472503\nG04472503\n", label: "Three requests were sent on SCIC in 360 ms", hint: "serial_sendSCIC(&SerialC, G_command, G_len); once per timer 1 interrupt." },
        { kind: "signal", name: "LIDAR_SCANS", equals: 3, label: "The LIDAR answered three times" },
        { kind: "var", name: "numRXC", equals: 3 * 477, label: "numRXC counted 3 x 477 characters", hint: "0 characters: the receive interrupt never ran. It needs IER |= M_INT8; (the vector alone is not enough)." },
        { kind: "no-diagnostic", code: "lidar", label: "The LIDAR understood every command" },
      ],
      watch: ["numRXC", "RXCdata"],
      inspect: ["PieCtrlRegs.PIEIER8", "ScicRegs.SCIFFRX"],
      hints: [
        "SCIC is in PIE group 8, so its CPU enable bit is M_INT8. init_serialSCIC already sets PIEIER8.",
        "The vector goes between EALLOW and EDIS: `PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;`",
        "`PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;`, `IER |= M_INT8;` and in the timer function `serial_sendSCIC(&SerialC, G_command, G_len);`",
      ],
      takeaway: "The sensor is polled: one G command every 100 ms, 477 characters back. Timer 1 is reserved for this in the course's robot code.",
    },
    {
      id: "sens-parser",
      kind: "code",
      mode: "complete",
      title: "The parser is a state machine",
      goal: "Complete the data state of the receive function so that it fills the distance array.",
      refs: [{ course: "L16" }, { course: "L14" }, { trm: "19" }],
      brief: `
The receive interrupt gets **one character at a time**. It cannot look ahead or back, so it has to remember where in the reply it is. That memory is a **state** variable, and the function is a state machine:

- **state 0**: wait for the \`'G'\` that starts a reply
- **state 1**: count the header. It has 12 characters: the echo (10), the status and a line feed. The 11th must be \`'0'\`; if not, give up and go back to state 0
- **state 2**: the data

States 0 and 1 are written, as they are in the course's \`F28379dSerial.c\`. You write state 2.

## State 2
For each character:

- a **line feed** (0x0a) is not data. Count it in \`LF_count\`
- anything else is data: set \`LF_count = 0\`, then
  - if \`get_dis_first\` is 1, this is the first character of a pair. Keep its 6 bits, shifted up by 6, in \`tempscid\`, and set \`get_dis_first = 0\`
  - otherwise it is the second character. \`distance = tempscid + \` its 6 bits. Store it in \`ladar_mm[dis_index]\`, add 1 to \`dis_index\`, and set \`get_dis_first = 1\`
- when \`LF_count\` reaches **2**, the reply is complete: set \`read_ladar_state = 0\` and call \`scan_done()\`

\`scan_done()\` is written. It copies three readings into global variables so you (and the tests) can see them: point 28 (right), 113 (front) and 199 (left).

The robot stands in the middle of a 10 ft square room, then moves between the first and the second scan. The meter "LIDAR straight ahead" shows the true distance in feet (1 ft = 304.8 mm).
`,
      kit: "robot",
      durationMs: 260,
      stimuli: [...poseStimuli(150, { x: 7, y: 3, theta: 0.5 })],
      starter: parserProgram(`            // TODO: the data
            //  - a line feed: count it in LF_count
            //  - any other character: LF_count = 0, then
            //      first of a pair: its 6 bits, shifted up by 6, go into tempscid
            //      second of a pair: distance = tempscid + its 6 bits,
            //        store it in ladar_mm[dis_index] and move to the next point
            //  - two line feeds in a row: back to state 0 and call scan_done()`),
      solution: parserProgram(state2(STORE_MM, DONE)),
      checks: parserChecks(PARSE_A, PARSE_B),
      watch: ["read_ladar_state", "dis_index", "scans", "points", "front_mm", "right_mm", "left_mm"],
      hints: [
        "The outer shape is `if (RXCdata == 0x0a) { LF_count += 1; } else { LF_count = 0; ... }` followed by `if (LF_count == 2) { ... }`.",
        "First character: `tempscid = (RXCdata - 0x30) << 6; get_dis_first = 0;`. Second: `distance = tempscid + (RXCdata - 0x30);`",
        "After the second character: `ladar_mm[dis_index] = distance; dis_index += 1; get_dis_first = 1;`. At two line feeds: `read_ladar_state = 0; scan_done();`",
      ],
      takeaway: "An interrupt that receives one character at a time needs a state variable to know what that character means. This is the same idea as the wall follower later in this chapter.",
    },
    {
      id: "sens-parser-debug",
      kind: "code",
      mode: "debug",
      title: "Right on the right, wrong in front",
      goal: "Find out why only the first 32 points of the scan are correct, and fix the parser.",
      refs: [{ course: "L16" }],
      brief: `
A teammate rewrote the data state of the parser "to make it shorter". Now the robot reports nonsense:

- \`right_mm\` (point 28) is correct
- \`front_mm\` (point 113) and \`left_mm\` (point 199) are wrong
- \`points\` is **232**, although a scan has 228 points

Run it and look at the watch list. Then think about where point 28, point 113 and point 199 are in the reply: the data comes in lines of 64 characters, 32 points per line. What is different about the points after the first line?

Fix the bug in state 2 of \`RXCINT_recv_ready\`. Change as little as you can.
`,
      kit: "robot",
      durationMs: 260,
      stimuli: [...poseStimuli(150, { x: 7, y: 3, theta: 0.5 })],
      starter: parserProgram(BUGGY_STATE2),
      solution: parserProgram(state2(STORE_MM, DONE)),
      checks: parserChecks(PARSE_A, PARSE_B),
      watch: ["read_ladar_state", "dis_index", "scans", "points", "front_mm", "right_mm", "left_mm"],
      hints: [
        "Points 0 to 31 are in the first line. Everything after the first line feed is wrong. What does the code do with a line feed?",
        "232 - 228 = 4 extra points = 8 extra characters: the reply has exactly 8 line feeds inside the data. They are being decoded as if they were data.",
        "The decoding must only run for characters that are not line feeds: move the whole `if (get_dis_first == 1) { ... } else { ... }` inside the `else` that sets `LF_count = 0`.",
      ],
      takeaway: "A line feed is framing, not data. One character decoded by mistake shifts every pair after it, so the error shows up far from its cause. Checking the count of points catches it at once.",
    },
    {
      id: "sens-flow",
      kind: "order",
      title: "From a laser pulse to the wheels",
      goal: "Put the steps of one 100 ms cycle of the wall-following robot in order.",
      refs: [{ course: "L14" }, { course: "L16" }],
      brief: `
The robot runs two loops at two speeds.

- The **inner loop** runs in a hardware interrupt every 1 ms. It reads the wheel encoders, runs the wheel speed controller and updates the robot's position. It needs a speed and a turn rate to aim for.
- The **outer loop** runs when a new scan is complete, every 100 ms. It looks at the distances and decides the speed and turn rate. The course runs it in a **software interrupt** (chapter 5), which the receive function posts when the reply is complete. Long work stays out of the receive interrupt that way.

Order the steps of one cycle, starting with the timer that asks for a scan.
`,
      steps: [
        "CPU timer 1 reaches zero and its interrupt function sends G04472503 and a line feed on SCIC",
        "The LIDAR starts its reply: the echo of the command, then the status character",
        "For every character that arrives, the SCIC receive interrupt runs: data characters are paired and decoded into the distance array",
        "Two line feeds in a row arrive: the scan is complete and the receive function posts a software interrupt",
        "The software interrupt works out the front and right distances from the new scan",
        "The state machine uses those distances to choose the state, the speed and the turn rate",
        "The 1 ms control loop drives the wheels toward that speed and turn rate until the next scan arrives",
      ],
      hints: [
        "Nothing arrives until the sensor has been asked.",
        "The distances are only complete after the two line feeds. The decision comes after that.",
        "Timer 1, reply starts, characters decoded, two line feeds, distances, state machine, wheels.",
      ],
      takeaway: "Fast and exact work in the 1 ms interrupt, the decision once per scan in a software interrupt. The decision can only change ten times per second, because that is how often there is new information.",
    },
    {
      id: "sens-nearest",
      kind: "code",
      mode: "write",
      title: "What is closest, and where",
      goal: "Find the nearest obstacle in a scan and its direction, and the distance in front and to the right.",
      refs: [{ course: "L14" }, { course: "L16" }, { course: "HW4" }],
      brief: `
A scan is 228 numbers. Behaviour needs a few meaningful ones. From here to the checkpoint the decoded scan is handed to you directly, so you can concentrate on using it: \`dist[i]\` is the distance of point \`i\` in **feet**, as in the course code. A point without an echo holds 18.7 ft (the course's "maximum reading"), so it is never the nearest.

## \`float point_deg(int i)\`
The angle of point \`i\` in degrees, with the course's formula:

\`\`\`c
(3*i + 44)*0.3515625 - 135
\`\`\`

## \`void process_scan(void)\`
Called once per scan. Set:

- \`nearest_index\`: the index of the smallest distance in the whole scan
- \`nearest_ft\`: that distance
- \`nearest_deg\`: its direction, from \`point_deg\`
- \`front_ft\`: the smallest of points **111 to 115** (straight ahead)
- \`right_ft\`: the smallest of points **26 to 30** (around -90 degrees)

Taking the smallest of five neighbours, as the course code does, makes the reading less sensitive to one bad point.

The robot is in a 10 ft square room with a box in it. The tests look at two poses.
`,
      kit: "robot",
      durationMs: 260,
      stimuli: [...poseStimuli(0, NEAR_POSES[0]), ...poseStimuli(150, NEAR_POSES[1])],
      starter: nearestProgram(`    return 0;`, `    // TODO`),
      solution: nearestProgram(
        `    return (3*i + 44)*0.3515625 - 135.0;`,
        `    int i;
    nearest_index = 0;
    for (i = 1; i < 228; i++) {
        if (dist[i] < dist[nearest_index]) {
            nearest_index = i;
        }
    }
    nearest_ft = dist[nearest_index];
    nearest_deg = point_deg(nearest_index);

    front_ft = 19.0;
    for (i = 111; i <= 115; i++) {
        if (dist[i] < front_ft) {
            front_ft = dist[i];
        }
    }
    right_ft = 19.0;
    for (i = 26; i <= 30; i++) {
        if (dist[i] < right_ft) {
            right_ft = dist[i];
        }
    }`,
      ),
      checks: [
        { kind: "var", name: "nearest_index", at: 160, equals: NEAR[0].index, label: `First pose: the nearest point is number ${NEAR[0].index} (a corner of the box)`, hint: "Search all 228 points, 0 to 227." },
        near("nearest_ft", NEAR[0].ft, 0.005, 160, `First pose: it is ${NEAR[0].ft.toFixed(2)} ft away`),
        near("nearest_deg", NEAR[0].deg, 0.05, 160, `First pose: it is ${NEAR[0].deg.toFixed(1)} degrees to the left`, "Angle of point i: (3*i + 44)*0.3515625 - 135."),
        near("front_ft", NEAR[0].front, 0.005, 160, `First pose: ${NEAR[0].front.toFixed(2)} ft straight ahead`, "The smallest of dist[111] to dist[115]."),
        near("right_ft", NEAR[0].right, 0.005, 160, `First pose: ${NEAR[0].right.toFixed(2)} ft to the right`, "The smallest of dist[26] to dist[30]."),
        { kind: "var", name: "nearest_index", equals: NEAR[1].index, label: `Second pose: the nearest point is number ${NEAR[1].index}` },
        near("nearest_deg", NEAR[1].deg, 0.05, undefined, `Second pose: it is at ${NEAR[1].deg.toFixed(1)} degrees`),
        near("front_ft", NEAR[1].front, 0.005, undefined, `Second pose: ${NEAR[1].front.toFixed(2)} ft straight ahead`),
        near("right_ft", NEAR[1].right, 0.005, undefined, `Second pose: ${NEAR[1].right.toFixed(2)} ft to the right`),
      ],
      watch: ["nearest_index", "nearest_ft", "nearest_deg", "front_ft", "right_ft"],
      hints: [
        "Finding a minimum: start with a first guess, then replace it whenever a smaller value turns up.",
        "Remember the index of the smallest value, not only the value: you need it for the angle.",
        "`for (i = 1; i < 228; i++) { if (dist[i] < dist[nearest_index]) { nearest_index = i; } }`, then `nearest_ft = dist[nearest_index]; nearest_deg = point_deg(nearest_index);`. The same loop over 111..115 and 26..30 gives front_ft and right_ft.",
      ],
      takeaway: "Two numbers, front and right, are enough to follow a wall. The course's starter looks a little further forward on the right (points 52 to 56, about -63 degrees) so that the robot sees a corner coming.",
    },
    {
      id: "sens-fsm-quiz",
      kind: "quiz",
      title: "States and transitions",
      goal: "Read a state machine: which state the robot is in, and what makes it change.",
      refs: [{ course: "L14" }, { course: "HW3" }, { course: "HW4" }],
      brief: `
A **finite state machine** has

- a small set of **states**. The robot is in exactly one at any time, stored in one variable
- **transitions**: conditions that move it from one state to another
- an **action** for each state: what the robot does while it is there

Here is a wall follower with three states. \`front\` and \`right\` are distances in feet from the last scan.

- **STRAIGHT**: drive straight ahead.
  - if \`front < 1.5\`: go to TURN_LEFT
  - else if \`right < 2.5\`: go to FOLLOW
- **TURN_LEFT**: turn left on the spot.
  - if \`front > 3.0\`: go to FOLLOW
- **FOLLOW**: steer to keep the wall on the right at a fixed distance.
  - if \`front < 1.5\`: go to TURN_LEFT
  - else if \`right > 4.0\`: go to STRAIGHT

If no condition is true, the robot stays in its state. The machine is evaluated once for every scan, and makes at most one transition each time.

Notice the two different numbers for the front: the robot starts turning below 1.5 ft but only stops turning above 3.0 ft. Between them it keeps doing whatever it was doing. That gap is called **hysteresis**. Without it, a reading that hovers around a single threshold makes the robot flip between two states on every scan. That is called **chattering**.
`,
      questions: [
        {
          prompt: "The robot is in FOLLOW. The new scan gives front = 2.0 ft and right = 1.8 ft. Which state is it in afterwards?",
          options: ["STRAIGHT", "TURN_LEFT", "FOLLOW"],
          answer: 2,
          why: "front is not below 1.5 and right is not above 4.0, so no transition fires and it stays in FOLLOW.",
        },
        {
          prompt: "The robot is in TURN_LEFT. The new scan gives front = 2.0 ft. Which state is it in afterwards?",
          options: ["STRAIGHT", "TURN_LEFT", "FOLLOW"],
          answer: 1,
          why: "TURN_LEFT only ends when front is above 3.0 ft. 2.0 ft is inside the hysteresis gap, so it keeps turning.",
        },
        {
          prompt: "The robot is in STRAIGHT. The new scan gives front = 1.2 ft and right = 2.0 ft. Which state is it in afterwards?",
          options: ["STRAIGHT", "TURN_LEFT", "FOLLOW"],
          answer: 1,
          why: "The conditions are tested in order, and the blocked front comes first. Avoiding a collision has priority over following a wall.",
        },
        {
          prompt: "Why does the same pair of readings (front = 2.0, right = 1.8) lead to different behaviour in the first two questions?",
          options: [
            "The sensor is not accurate enough",
            "What the robot does depends on its state as well as on the readings",
            "The state machine is evaluated too slowly",
            "It should not: that is a bug",
          ],
          answer: 1,
          why: "That is the point of a state machine: it remembers what the robot was doing. The readings alone do not say whether a turn is finished.",
        },
      ],
    },
    {
      id: "sens-follow",
      kind: "code",
      mode: "write",
      title: "A three-state wall follower",
      goal: "Write the wall follower's state machine as a switch and show the state on three LEDs.",
      refs: [{ course: "L14" }, { course: "HW3" }, { course: "HW4" }],
      brief: `
Write the state machine of the last level in C. The usual form is a \`switch\` on the state variable, with one \`case\` per state. Inside each case, test that state's transitions and assign the new state.

\`\`\`c
switch (state) {
case STRAIGHT:
    if (front_ft < FRONT_BLOCKED) {
        state = TURN_LEFT;
    } else if (...) {
        ...
    }
    break;
case TURN_LEFT:
    ...
    break;
}
\`\`\`

Do not forget the \`break;\` at the end of each case: without it the code runs on into the next case.

## The transitions
- **STRAIGHT**: \`front_ft < FRONT_BLOCKED\` goes to TURN_LEFT; otherwise \`right_ft < WALL_NEAR\` goes to FOLLOW
- **TURN_LEFT**: \`front_ft > FRONT_CLEAR\` goes to FOLLOW
- **FOLLOW**: \`front_ft < FRONT_BLOCKED\` goes to TURN_LEFT; otherwise \`right_ft > WALL_LOST\` goes to STRAIGHT

The four thresholds are defined at the top of the file.

## The action
This robot has no motors yet, so each state only lights an LED. After the switch, in \`wall_follow()\`:

- **LED1** (GPIO22, port A) is on in STRAIGHT
- **LED2** (GPIO94, port C) is on in TURN_LEFT
- **LED3** (GPIO95, port C) is on in FOLLOW

Exactly one LED is on at any time.

\`wall_follow()\` is called once per scan, after \`front_ft\` and \`right_ft\` have been updated. The tests move the robot through a 10 ft square room, one pose per scan: open floor, along a wall, up to a wall, through a left turn, and away again.
`,
      kit: "robot",
      durationMs: 760,
      stimuli: FOLLOW_SCRIPT.flatMap((s, i) => poseStimuli(50 + 100 * i, s.pose)),
      starter: followProgram(`    // TODO: the switch, then the LEDs`),
      solution: followProgram(`${SWITCH}

${SHOW}`),
      checks: [
        ...FOLLOW_SCRIPT.map((s, i) => ({
          kind: "var" as const,
          name: "state",
          at: 160 + 100 * i,
          equals: s.state,
          label: `Scan ${i + 1}: ${s.why} (state ${s.state})`,
          hint:
            i === 3
              ? "A turn only ends when the front is more than FRONT_CLEAR away, not as soon as it is more than FRONT_BLOCKED."
              : i === 6
                ? "In STRAIGHT, test the front first."
                : undefined,
        })),
        ...FOLLOW_SCRIPT.slice(0, 5).map((s, i) => ({ kind: "led" as const, led: LED_OF[s.state], at: 160 + 100 * i, on: true, label: `Scan ${i + 1}: ${LED_OF[s.state]} is on` })),
        { kind: "led", led: "LED1", at: 360, on: false, label: "LED1 is off while turning left" },
        { kind: "led", led: "LED3", at: 360, on: false, label: "LED3 is off while turning left", hint: "Switch the other two LEDs off when the state changes." },
        { kind: "source", mustMatch: "switch\\s*\\(\\s*state\\s*\\)", label: "The state machine is a switch on state" },
        { kind: "no-dat-write", label: "The LEDs are changed through SET and CLEAR" },
      ],
      watch: ["state", "front_ft", "right_ft", "numScans"],
      hints: [
        "One case per state, each ending in break. Only assign to state inside the case of the state you are leaving.",
        "TURN_LEFT has a single way out: `if (front_ft > FRONT_CLEAR) { state = FOLLOW; }`.",
        "For the LEDs: `if (state == STRAIGHT) { GpioDataRegs.GPASET.bit.GPIO22 = 1; } else { GpioDataRegs.GPACLEAR.bit.GPIO22 = 1; }` and the same for GPIO94 (TURN_LEFT) and GPIO95 (FOLLOW) with GPCSET and GPCCLEAR.",
      ],
      takeaway: "A switch with one case per state keeps the transitions of each state in one place. Adding a state later means adding a case, not untangling nested ifs.",
    },
    {
      id: "sens-chatter",
      kind: "code",
      mode: "debug",
      title: "Left, no, right, no, left",
      goal: "Stop the wall follower from flipping between two states when the front distance hovers around the threshold.",
      refs: [{ course: "L14" }],
      brief: `
This wall follower works in open space, but in front of a wall the robot twitches: it starts to turn, stops, starts again, stops again. The motors get a new command on every scan and the robot hardly moves.

The tests hold the robot about 1.5 ft from a wall. The front reading is never exactly the same twice: 1.47, 1.53, 1.46, 1.52, 1.48 ft. Then the turn is completed and the front opens up to 3.5 ft.

\`transitions\` counts how often the state changed. For this run it should be **2**: one change into TURN_LEFT when the wall comes close, one change to FOLLOW when the turn is finished. Run the code and look at what it does instead.

Fix the state machine. Lecture 14 gives the cure: a **deadband** or **hysteresis**. Leave a state at a different threshold than the one that got you into it. For this robot, a turn is finished when the front is more than **3.0 ft** away.
`,
      kit: "robot",
      durationMs: 760,
      stimuli: CHATTER_FRONT.flatMap((d, i) => poseStimuli(50 + 100 * i, { x: 10 - d, y: 2, theta: 0 })),
      starter: followProgram(
        `${SWITCH.replace("front_ft > FRONT_CLEAR", "front_ft > FRONT_BLOCKED")}

${SHOW}`,
        { defs: FOLLOW_DEFS.replace(/#define FRONT_CLEAR[^\n]*\n/, ""), initial: "FOLLOW", count: true },
      ),
      solution: followProgram(
        `${SWITCH}

${SHOW}`,
        { initial: "FOLLOW", count: true },
      ),
      checks: [
        { kind: "var", name: "state", at: 260, equals: 2, label: "The robot starts turning when the wall is 1.47 ft ahead" },
        { kind: "var", name: "state", at: 360, equals: 2, label: "At 1.53 ft it is still turning", hint: "1.53 is more than 1.5, but the turn is not finished. Leave TURN_LEFT only when the front is clearly open." },
        { kind: "var", name: "state", at: 560, equals: 2, label: "At 1.52 ft it is still turning" },
        { kind: "steady", led: "LED2", from: 210, to: 690, on: true, label: "LED2 (turning left) stays on without flicker while the front hovers around 1.5 ft" },
        { kind: "var", name: "state", equals: 3, label: "With 3.5 ft in front the turn is finished: FOLLOW" },
        { kind: "var", name: "transitions", equals: 2, label: "The state changed exactly twice", hint: "More than 2: the robot still flips between TURN_LEFT and FOLLOW." },
      ],
      watch: ["state", "front_ft", "transitions", "numScans"],
      hints: [
        "Look at the condition that ends TURN_LEFT and the condition that starts it. They use the same number.",
        "Add a second threshold, larger than FRONT_BLOCKED, and use it to leave TURN_LEFT.",
        "`#define FRONT_CLEAR 3.0` and, in case TURN_LEFT, `if (front_ft > FRONT_CLEAR) { state = FOLLOW; }`",
      ],
      takeaway: "One threshold plus a noisy reading gives chattering. Two thresholds with a gap between them (hysteresis) give one clean transition each way.",
    },
    {
      id: "sens-corridor",
      kind: "code",
      mode: "checkpoint",
      title: "Down the corridor",
      goal: "Poll the LIDAR, work out the front, left and right distances of each scan, run the state machine and report over serial.",
      refs: [{ course: "HW4" }, { course: "L14" }, { course: "L16" }, { course: "Lab 1" }, { trm: "19" }, { trm: "3.4.5" }],
      brief: `
Everything together, on the real serial path. The parser (with distances in feet, as the course stores them) and the wall follower are in the file. You connect them.

## Set-up, in main
- vectors for \`TIMER1_INT\` (your \`cpu_timer1_isr\`) and \`SCIC_RX_INT\` (\`RXCINT_recv_ready\`)
- CPU timer 1 with a period of 100 ms, started
- \`init_serialSCIC(&SerialC, 115200);\` for the LIDAR and \`init_serialSCIA(&SerialA, 115200);\` for the terminal
- \`IER\` bits for PIE group 8 (SCIC) and CPU timer 1 (INT13), then \`EINT\`

## Timer 1
Send \`G_command\` to the LIDAR, as before.

## When a scan is complete
The parser calls \`scan_done()\`, which sets the flag \`newScan\`. Printing is slow, so it belongs in \`while(1)\`, behind the flag (chapters 5 and 6). When \`newScan\` is 1:

1. set it back to 0
2. \`front_ft = min_ft(111, 115);\`, \`left_ft = min_ft(197, 201);\`, \`right_ft = min_ft(26, 30);\`
3. call \`wall_follow()\`
4. add 1 to \`numScans\`
5. print one line on SerialA, exactly in this format:

\`\`\`c
"F %.2f L %.2f R %.2f S %d\\r\\n"
\`\`\`

with the front, left and right distances and the state.

## The run
The robot is in a corridor 3 ft wide and 32 ft long. The tests move it: at the start, near the far end, right up to the end wall, turned left by 90 degrees, and turned around. Where the corridor is longer than the sensor can see, the LIDAR reports an error code and the parser stores the maximum reading, 18.70 ft.
`,
      kit: "robot",
      durationMs: 560,
      stimuli: CORRIDOR.flatMap((p, i) => poseStimuli(i === 0 ? 0 : 50 + 100 * i, p)),
      starter: corridorProgram(
        `    // TODO: vectors, timer 1 (100 ms), the two serial ports, IER, EINT`,
        `    // TODO: ask the LIDAR for a scan`,
        `        // TODO: when newScan is set: distances, wall_follow(), numScans, print`,
      ),
      solution: corridorProgram(
        `    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    EDIS;

    InitCpuTimers();
    // !!!!! Important, used to command the LADAR every 100 ms
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;

    init_serialSCIA(&SerialA, 115200);
    init_serialSCIC(&SerialC, 115200);

    IER |= M_INT8;   // SCIC
    IER |= M_INT13;  // CPU Timer 1
    EINT;`,
        `    serial_sendSCIC(&SerialC, G_command, G_len);`,
        `        if (newScan == 1) {
            newScan = 0;
            front_ft = min_ft(111, 115);
            left_ft = min_ft(197, 201);
            right_ft = min_ft(26, 30);
            wall_follow();
            numScans++;
            serial_printf(&SerialA, "F %.2f L %.2f R %.2f S %d\\r\\n", front_ft, left_ft, right_ft, state);
        }`,
      ),
      checks: [
        { kind: "signal", name: "LIDAR_SCANS", equals: 5, label: "The LIDAR was asked for five scans, one every 100 ms", hint: "Timer 1 needs its vector, a 100000 microsecond period, TCR and IER |= M_INT13." },
        { kind: "var", name: "numScans", equals: 5, label: "main handled each scan once", hint: "0: the receive interrupt is not running (vector, M_INT8) or the flag is never tested. A huge number: the flag is never set back to 0." },
        { kind: "serial", includes: `${CORRIDOR_LINES[0]}\r\n`, label: `Start of the corridor: "${CORRIDOR_LINES[0]}"`, hint: "Nothing is in range ahead, so the front is the maximum reading, 18.70 ft. Check the format string character by character." },
        { kind: "serial", includes: `${CORRIDOR_LINES[1]}\r\n`, label: `Near the end: "${CORRIDOR_LINES[1]}"` },
        { kind: "serial", includes: `${CORRIDOR_LINES[2]}\r\n`, label: `At the end wall: "${CORRIDOR_LINES[2]}"`, hint: "Call wall_follow() after updating the distances and before printing." },
        { kind: "serial", includes: `${CORRIDOR_LINES[3]}\r\n`, label: `Turned left: "${CORRIDOR_LINES[3]}"`, hint: "Left is points 197 to 201, right is points 26 to 30." },
        { kind: "serial", includes: `${CORRIDOR_LINES[4]}\r\n`, label: `Turned around: "${CORRIDOR_LINES[4]}"` },
        { kind: "serial", matches: `^(F \\d+\\.\\d\\d L \\d+\\.\\d\\d R \\d+\\.\\d\\d S \\d\\r\\n){5}$`, label: "Exactly five lines, nothing else" },
        { kind: "serial-period", periodMs: 100, label: "A line is printed every 100 ms" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function", hint: "Print from while(1), behind the newScan flag." },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the values" },
      ],
      watch: ["numScans", "state", "front_ft", "left_ft", "right_ft", "read_ladar_state"],
      hints: [
        "Set-up is the same list as in \"Ask every 100 ms\", plus init_serialSCIA for the terminal.",
        "The loop: `if (newScan == 1) { newScan = 0; ... }`. Inside: three calls to min_ft, then wall_follow(), then numScans++, then the print.",
        "`serial_printf(&SerialA, \"F %.2f L %.2f R %.2f S %d\\r\\n\", front_ft, left_ft, right_ft, state);`",
      ],
      takeaway: "This is the skeleton of the robot's navigation code: poll, parse, reduce the scan to a few distances, run the state machine, report. HW4 asks you to design the states; now you know where they run.",
    },

    // ------------------------------------------------------------ practice
    {
      id: "sens-errcodes",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Zero is not a distance",
      goal: "Find out why the robot believes there is a wall 0 mm ahead in an empty corridor, and fix it.",
      refs: [{ course: "L16" }],
      brief: `
The robot stands at the start of a long corridor, 1.5 ft from the wall on each side. Nothing is in front of it for 30 ft. This program reports:

- \`front_mm = 0\`
- \`nearest_mm = 0\`

A robot that believed this would refuse to move.

The URG-04LX can only measure from 20 mm to 4095 mm. When it gets no usable echo for a point, it does not send a distance. It sends a small number as an **error code**. Any reading below 20 is an error code. The two you meet in practice are **0** (nothing within range) and **6**, and those are the two the course's parser tests for.

The course replaces an error code with a reading that is larger than any real one, so that "nothing there" behaves like "very far away":

\`\`\`c
distance = LADAR_MAX_READING;   // 5700, from F28379dSerial.h
\`\`\`

Fix the program so that error codes never reach \`ladar_mm[]\` as distances. Halfway through, the tests move the robot to 3 ft from the end wall.
`,
      kit: "robot",
      durationMs: 260,
      stimuli: [...poseStimuli(0, { room: 1, x: 0, y: 0, theta: 0 }), ...poseStimuli(150, { x: 27 })],
      starter: errProgram(STORE_MM),
      solution: errProgram(STORE_MM_SAFE),
      checks: [
        { kind: "var", name: "front_mm", at: 160, equals: 5700, label: "Nothing ahead: front_mm is LADAR_MAX_READING (5700)", hint: "Replace the reading before it is stored: if (distance < 20) { distance = LADAR_MAX_READING; }" },
        { kind: "var", name: "nearest_mm", at: 160, equals: minOf(ERR_A, 0, 227), label: `The nearest thing is the side wall, ${minOf(ERR_A, 0, 227)} mm away` },
        { kind: "var", name: "front_mm", equals: ERR_B[113], label: `3 ft from the end wall: front_mm is ${ERR_B[113]}` , hint: "Real distances must stay as they are." },
        { kind: "var", name: "nearest_mm", equals: minOf(ERR_B, 0, 227), label: `The nearest thing is still the side wall, ${minOf(ERR_B, 0, 227)} mm` },
        { kind: "var", name: "scans", equals: 2, label: "Both scans were received" },
      ],
      watch: ["front_mm", "nearest_mm", "scans", "distance"],
      hints: [
        "Where does a decoded distance get stored? That is the last place to catch an error code.",
        "Test the reading right after it is put together from its two characters.",
        "After `distance = tempscid + (RXCdata - 0x30);` add `if (distance < 20) { distance = LADAR_MAX_READING; }` (the course writes `distance == 0 || distance == 6`).",
      ],
      takeaway: "A sensor reading can be a number that means \"I do not know\". Check what the small and the large values of a sensor mean before you take a minimum over them.",
    },
    {
      id: "sens-reply-size",
      kind: "calc",
      tier: "practice",
      title: "A different request",
      goal: "Predict the reply to a G command with other parameters.",
      refs: [{ course: "L16" }],
      brief: `
Suppose you only care about what is in front of and beside the robot, but want it finer. You send

\`\`\`c
"G12864002\\n"
\`\`\`

That is first step **128**, last step **640**, cluster count **2**. Step 384 looks straight ahead and one step is 0.3515625 degrees, as before. Point \`i\` now belongs to step \`2*i + 128\`.

The reply has the same shape as always: the echo with its line feed, the status with its line feed, the data in lines of at most 64 characters with a line feed after each, and one last line feed. Each character takes 10 bit times at 115200 baud.
`,
      fields: [
        { id: "n", label: "Number of points", answer: 257, why: "640 - 128 + 1 = 513 steps; 513 / 2 = 256.5, and the incomplete last group still gives a point: 257." },
        { id: "a0", label: "Angle of point 0", unit: "deg", answer: -90, tolPct: 0.2, why: "(128 - 384) * 0.3515625 = -90 degrees: exactly to the right." },
        { id: "front", label: "Index of the point straight ahead", answer: 128, why: "(384 - 128) / 2 = 128." },
        { id: "lines", label: "Number of data lines", answer: 9, why: "257 points are 514 characters: 8 full lines of 64 (512) and one line of 2." },
        { id: "chars", label: "Characters in the whole reply", answer: 536, why: "10 (echo) + 2 (status) + 514 (data) + 9 (line feeds) + 1 (final line feed) = 536." },
        { id: "ms", label: "Time to receive the reply at 115200 baud", unit: "ms", answer: 46.5, tolPct: 1, why: "536 characters * 10 bits / 115200 bits per second = 46.5 ms." },
      ],
      hints: [
        "Count the steps, divide by the cluster count, round up.",
        "Two characters per point. Each started line of 64 characters gets one line feed.",
        "257, -90, 128, 9, 536, 46.5.",
      ],
      takeaway: "The reply length follows from the request. A parser that counts on 228 points only works for the one command it was written for.",
    },

    // ------------------------------------------------------------ expert
    {
      id: "sens-world",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Where is that wall, really",
      goal: "Turn a scan into world coordinates and fit a line to a wall, so that the answer does not depend on where the robot stands.",
      refs: [{ course: "L16" }, { course: "L14" }, { course: "HW5" }],
      brief: `
A LIDAR reading is a distance \`d\` along a direction \`alpha\`, seen from the sensor. To build a map you need the same point in **world** coordinates.

## The frames
- The robot's centre is at \`(robot_x, robot_y)\` in feet, with heading \`robot_theta\` in radians (0 along the world's x axis, positive counter-clockwise).
- The sensor sits \`LADAR_OFFSET\` feet **ahead** of the robot's centre, on its centre line, looking the same way as the robot.
- \`alpha\` is the angle of the point: the course formula, converted to radians.

Derive the transform yourself: write the point in the robot's frame first, then rotate it by the heading and shift it by the robot's position. (Do not copy the matrix from the lecture slide: its y row has an error. The rotation and translation above are all you need.) The values of \`dist[]\`, \`robot_x\`, \`robot_y\` and \`robot_theta\` are filled in for you before your functions run.

## \`to_world()\`
Fill \`ptx[i]\` and \`pty[i]\` for all 228 points.

## \`fit_wall()\`
There is one long, straight wall in this world. Fit the line \`y = wall_m * x + wall_c\` to the points that have an echo (\`dist[i] < NO_ECHO\`), by least squares:

\`\`\`c
m = (n*Sxy - Sx*Sy) / (n*Sxx - Sx*Sx);
c = (Sy - m*Sx) / n;
\`\`\`

where \`Sx\`, \`Sy\`, \`Sxx\`, \`Sxy\` are the sums of x, y, x*x and x*y over those points and \`n\` is their number. Then set

- \`npts\`: the number of points used
- \`wall_dist\`: the shortest (perpendicular) distance from the robot's centre to that line, in feet
- \`wall_angle\`: the direction of the wall minus the robot's heading, in radians. A wall parallel to the robot's path gives 0

## The test
The robot is looked at in two different poses. If your transform is right, \`wall_m\` and \`wall_c\` come out the same both times, because the wall did not move.
`,
      kit: "robot",
      durationMs: 260,
      stimuli: [
        { at: 0, set: "LIDAR_OFFSET_FT", value: SENSOR_OFFSET },
        ...poseStimuli(0, WORLD_POSES[0]),
        ...poseStimuli(150, WORLD_POSES[1]),
      ],
      starter: worldProgram(`    // TODO`, `    // TODO`),
      solution: worldProgram(
        `    int i;
    float alpha;
    float xr;
    float yr;
    for (i = 0; i < 228; i++) {
        alpha = ((3*i + 44)*0.3515625 - 135.0)*0.01745329;
        // the point in the robot's frame
        xr = LADAR_OFFSET + dist[i]*cos(alpha);
        yr = dist[i]*sin(alpha);
        // rotate by the heading, shift by the position
        ptx[i] = robot_x + xr*cos(robot_theta) - yr*sin(robot_theta);
        pty[i] = robot_y + xr*sin(robot_theta) + yr*cos(robot_theta);
    }`,
        `    int i;
    float sx = 0;
    float sy = 0;
    float sxx = 0;
    float sxy = 0;
    npts = 0;
    for (i = 0; i < 228; i++) {
        if (dist[i] < NO_ECHO) {
            sx += ptx[i];
            sy += pty[i];
            sxx += ptx[i]*ptx[i];
            sxy += ptx[i]*pty[i];
            npts++;
        }
    }
    wall_m = (npts*sxy - sx*sy) / (npts*sxx - sx*sx);
    wall_c = (sy - wall_m*sx) / npts;
    wall_dist = fabs(wall_m*robot_x - robot_y + wall_c) / sqrt(wall_m*wall_m + 1.0);
    wall_angle = atan(wall_m) - robot_theta;`,
      ),
      checks: [
        { kind: "var", name: "npts", at: 160, equals: WORLD_N[0], label: `First pose: ${WORLD_N[0]} points have an echo`, hint: "Use only the points with dist[i] < NO_ECHO." },
        near("wall_m", 0, 0.004, 160, "First pose: the wall runs along the x axis (slope 0)", "A slope far from 0 means the rotation is wrong. Rotate by robot_theta: x' = x cos - y sin, y' = x sin + y cos."),
        near("wall_c", -2, 0.02, 160, "First pose: the wall is the line y = -2", "Off by a few hundredths: the sensor is not at the robot's centre. Add LADAR_OFFSET along the robot's heading."),
        near("wall_dist", 2.5, 0.02, 160, "First pose: the robot's centre is 2.5 ft from the wall"),
        near("wall_angle", -0.3, 0.005, 160, "First pose: the wall is at -0.3 rad relative to the heading"),
        { kind: "var", name: "npts", equals: WORLD_N[1], label: `Second pose: ${WORLD_N[1]} points have an echo` },
        near("wall_m", 0, 0.004, undefined, "Second pose: still slope 0"),
        near("wall_c", -2, 0.02, undefined, "Second pose: still y = -2"),
        near("wall_dist", 3, 0.02, undefined, "Second pose: 3 ft from the wall"),
        near("wall_angle", 0.4, 0.005, undefined, "Second pose: the wall is at +0.4 rad relative to the heading"),
      ],
      watch: ["npts", "wall_m", "wall_c", "wall_dist", "wall_angle", "robot_theta"],
      hints: [
        "In the robot's frame the point is at x = LADAR_OFFSET + d cos(alpha), y = d sin(alpha).",
        "World: x = robot_x + xr cos(theta) - yr sin(theta), y = robot_y + xr sin(theta) + yr cos(theta).",
        "Distance from (x0, y0) to y = m x + c is |m x0 - y0 + c| / sqrt(m*m + 1). The wall's direction is atan(m).",
      ],
      takeaway: "A homogeneous transform is a rotation followed by a shift. In world coordinates, fixed things stay fixed when the robot moves, and that is what makes a map possible.",
    },
    {
      id: "sens-door",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Find the doorway",
      goal: "Detect a doorway in a scan and report its direction and width.",
      refs: [{ course: "HW4" }, { course: "L14" }],
      brief: `
HW4 asks how you would recognise things in a scan. Here is one: a doorway.

The robot is in a 10 ft square room. One wall has an opening, and behind it there is nothing within the sensor's range. In the scan, a doorway is therefore a **run of points without an echo** (\`dist[i] > NO_ECHO\`) with a point that **does** have an echo directly before the run and directly after it. Those two points are the door posts.

Write \`find_door()\`. It is called once per scan and sets:

- \`door_found\`: 1 if the scan has such a run of **at least 5** points, otherwise 0
- \`door_deg\`: the direction of the middle of the doorway, in degrees: the average of the angles of the two door posts
- \`door_width_ft\`: the distance between the two door posts. You know two sides of a triangle (the two readings) and the angle between them: use the law of cosines, \`w*w = a*a + b*b - 2*a*b*cos(gamma)\`

A run that touches the edge of the scan (point 0 or point 227) has only one post and does not count. When no doorway is found, leave \`door_deg\` and \`door_width_ft\` at 0.

The tests look from two poses in the room with the doorway, then put the robot in a room without one. \`cos\` takes radians: 1 degree is 0.01745329 rad.
`,
      kit: "robot",
      durationMs: 360,
      stimuli: [...poseStimuli(0, DOOR_POSES[0]), ...poseStimuli(150, DOOR_POSES[1]), ...poseStimuli(250, { room: 0 })],
      starter: doorProgram(`    // TODO`),
      solution: doorProgram(`    int i = 1;
    int j;
    float a;
    float b;
    float gamma;
    door_found = 0;
    door_deg = 0;
    door_width_ft = 0;
    while (i < 227) {
        if (dist[i] > NO_ECHO) {
            // the run without echo is i to j
            j = i;
            while (j < 227 && dist[j + 1] > NO_ECHO) {
                j++;
            }
            if (j < 227 && dist[i - 1] < NO_ECHO && (j - i + 1) >= 5) {
                a = dist[i - 1];
                b = dist[j + 1];
                gamma = (point_deg(j + 1) - point_deg(i - 1))*0.01745329;
                door_found = 1;
                door_deg = (point_deg(i - 1) + point_deg(j + 1)) / 2.0;
                door_width_ft = sqrt(a*a + b*b - 2.0*a*b*cos(gamma));
            }
            i = j + 1;
        } else {
            i++;
        }
    }`),
      checks: [
        { kind: "var", name: "door_found", at: 160, equals: 1, label: "First pose: a doorway is found" },
        near("door_deg", DOORS[0].deg, 0.6, 160, `First pose: it is ${DOORS[0].deg.toFixed(1)} degrees to the left`, "Average the angles of the last point before the gap and the first point after it."),
        near("door_width_ft", DOORS[0].width, 0.05, 160, `First pose: it is about ${DOORS[0].width.toFixed(1)} ft wide`, "Use the readings of the two door posts and the angle between them, in radians."),
        { kind: "var", name: "door_found", at: 260, equals: 1, label: "Second pose: a doorway is found" },
        near("door_deg", DOORS[1].deg, 0.6, 260, `Second pose: it is at ${DOORS[1].deg.toFixed(1)} degrees`),
        near("door_width_ft", DOORS[1].width, 0.05, 260, `Second pose: about ${DOORS[1].width.toFixed(1)} ft wide`),
        { kind: "var", name: "door_found", equals: 0, label: "In the room without a doorway nothing is found", hint: "Set door_found back to 0 at the start of every scan." },
        { kind: "var", name: "door_width_ft", equals: 0, label: "Without a doorway the width is 0" },
      ],
      watch: ["door_found", "door_deg", "door_width_ft", "numScans"],
      hints: [
        "Walk through the scan. When you meet a point without an echo, walk on until the echoes come back, and remember where the run started and ended.",
        "The posts are at index (start - 1) and (end + 1). Both must exist and both must have an echo.",
        "gamma = (point_deg(end + 1) - point_deg(start - 1)) * 0.01745329; width = sqrt(a*a + b*b - 2*a*b*cos(gamma)).",
      ],
      takeaway: "The measured width is a little more than the real 2.5 ft: the posts you see are the nearest points with an echo, up to one point spacing outside the opening. Features in a scan are only as sharp as the angle between two points.",
    },
    {
      id: "sens-robust",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "One character goes missing",
      goal: "Harden the parser so that a reply with a lost character is thrown away instead of producing wrong distances.",
      refs: [{ course: "L16" }, { trm: "19" }],
      brief: `
Serial lines lose characters now and then: a glitch on the wire, a receive buffer that overflowed while a long interrupt was running. The SCIP 1 reply has no checksum, and the course's parser trusts every character. Find out what that costs.

The program below is the working parser. The tests run seven scans with the robot standing still, and damage three of the replies:

- scan 2 loses one **data** character in the middle
- scan 4 loses its **last line feed**
- scan 6 loses one character of the **echo**

Run it first and watch \`front_mm\`, \`left_mm\` and \`good_scans\`. Work out, for each kind of damage, what the state machine does with the characters that follow. If a counter suddenly holds a number that makes no sense, ask what \`ladar_mm[dis_index]\` does once \`dis_index\` is past 227: C does not stop you from writing beyond the end of an array, and what lies there is your other variables.

## Your task
Change \`RXCINT_recv_ready\` so that

- \`scan_done()\` is only ever called for a scan in which **every** point is right. The tests read \`right_mm\`, \`front_mm\` and \`left_mm\` after every scan; they must never be wrong, not even once
- a reply you recognise as damaged is dropped and counted in \`bad_scans\`
- the parser recovers by itself: the scan after a damaged one is received normally
- at least **4** of the 7 scans are accepted

You may add variables. Do not change \`scan_done()\`.

What you can rely on: a good reply starts with exactly \`G04472503\`, a line feed, \`0\`, a line feed; every data line except the last has exactly 64 characters; a scan has exactly 228 points. Note that \`'G'\` (0x47) is also a legal data character.
`,
      kit: "robot",
      durationMs: 760,
      stimuli: [
        ...poseStimuli(0, ROBUST_POSE),
        { at: 150, set: "LIDAR_DROP_CHAR", value: 200 },
        { at: 350, set: "LIDAR_DROP_CHAR", value: 477 },
        { at: 550, set: "LIDAR_DROP_CHAR", value: 5 },
      ],
      starter: robustProgram("", parser(state2(`                    ladar_mm[dis_index] = distance;`, DONE))),
      solution: robustProgram(
        `char G_expect[] = "G04472503\\n0\\n";  // how a good reply starts
uint16_t line_chars = 0;        // data characters in the current line`,
        ROBUST_ISR,
      ),
      checks: [
        ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
          {
            kind: "var" as const,
            name: "front_mm",
            at: 60 + 100 * n,
            equals: ROBUST[113],
            label: `After scan ${n}: front_mm is ${ROBUST[113]}`,
            hint:
              n === 2
                ? "Scan 2 lost a data character, so every pair after it is split wrong. A line that does not have 64 characters gives it away."
                : n === 5
                  ? "Scan 4 lost its last line feed, so the parser was still in state 2 when scan 5 arrived. Do not wait for a second line feed once all 228 points are in, and never store more than 228."
                  : n === 6
                    ? "Scan 6 lost a character of the echo, so counting to 12 put the start of the data in the wrong place. Compare the header with what it should be."
                    : undefined,
          },
          { kind: "var" as const, name: "left_mm", at: 60 + 100 * n, equals: ROBUST[199], label: `After scan ${n}: left_mm is ${ROBUST[199]}` },
        ]),
        { kind: "var", name: "right_mm", equals: ROBUST[28], label: `At the end right_mm is ${ROBUST[28]}` },
        { kind: "var", name: "good_scans", min: 4, max: 5, label: "4 or 5 of the 7 scans were accepted", hint: "Fewer than 4: the parser does not recover after a damaged reply. More than 5: a damaged reply was accepted. A huge number: the parser wrote past the end of ladar_mm[] and overwrote this counter." },
        { kind: "var", name: "bad_scans", min: 1, max: 3, label: "At least one damaged reply was recognised and counted" },
        { kind: "signal", name: "LIDAR_SCANS", equals: 7, label: "The LIDAR was asked seven times" },
      ],
      watch: ["good_scans", "bad_scans", "front_mm", "left_mm", "right_mm", "read_ladar_state", "dis_index"],
      hints: [
        "Count the data characters of each line. At a line feed, a line that is not 64 characters long (and is not the last one) means something was lost.",
        "Finish the scan when 228 points are in and a line feed arrives. Then a missing final line feed does no harm, and the next 'G' is seen in state 0.",
        "Check the header character by character against \"G04472503\\n0\\n\" instead of only counting to 12, and go back to state 0 at the first mismatch.",
      ],
      takeaway: "A protocol without a checksum still has structure you can check: a fixed header, fixed line lengths, a fixed number of points. A parser should use all of it, and should always have a way back to its first state.",
    },
  ],
};
