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
  ({ kind: "var" as const, name, min: +(v - tol).toFixed(4), max: +(v + tol).toFixed(4), at, label, hint });

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

// A backslash (0x5C) is a legal data character but would need escaping in a C string.
if (/[\\?]/.test(DEC_LINE + DEC_TAIL)) throw new Error("pick another pose: the sample lines need escaping in C");

const decodeProgram = (decode: string, decodeLine: string) => `// Line 4 of a reply (points 96 to 127), and the short last line with the
// two line feeds that end the reply
char line[] = "${DEC_LINE}";
char tail[] = "${DEC_TAIL}\\n\\n";

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
  { kind: "var" as const, name: "scans", at: 160, equals: 1, label: "The first scan is complete after its two line feeds", hint: "0: scan_done() was never called. Call it when LF_count reaches 2. More than 1: it was called at a single line feed, which only ends a line." },
  { kind: "var" as const, name: "points", at: 160, equals: 228, label: "The scan has 228 points", hint: "0: dis_index is never increased, or scan_done() never runs. 32 or 64: the scan ended early: LF_count must go back to 0 at every data character, and the reply ends at 2 line feeds in a row. 232: line feeds are being decoded as data. About 455: every character is treated as a second character: set get_dis_first back to 1 after storing." },
  { kind: "var" as const, name: "right_mm", at: 160, equals: a[28], label: `Point 28 (right) of the first scan is ${a[28]} mm`, hint: "Below 64: the first character's 6 bits were not shifted up by 6. Exactly 48 too large: 0x30 was not subtracted from the second character. Far too large: 0x30 was not subtracted from the first." },
  { kind: "var" as const, name: "front_mm", at: 160, equals: a[113], label: `Point 113 (front) of the first scan is ${a[113]} mm`, hint: "Point 113 is in the fourth line. If only the points of the first line are right, look at what happens at a line feed." },
  { kind: "var" as const, name: "left_mm", at: 160, equals: a[199], label: `Point 199 (left) of the first scan is ${a[199]} mm` },
  { kind: "var" as const, name: "scans", equals: 2, label: "The second scan is complete too", hint: "After a scan, go back to state 0 so the next 'G' starts a new one." },
  { kind: "var" as const, name: "front_mm", equals: b[113], label: `After the robot moved, the front reading is ${b[113]} mm`, hint: "Still the value of the first scan: the parser did not start again. Set read_ladar_state = 0 when the reply is complete, so that the next 'G' begins a new scan and dis_index starts at 0." },
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
  { room: 3, x: 6.1, y: 7.9, theta: -1.2 },
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
  { pose: { x: 8.8, y: 2, theta: 0 }, state: 2, why: "Into a corner, wall 1.2 ft ahead and 2 ft to the right: the front comes first, turn left" },
  { pose: { x: 8.8, y: 5, theta: Math.PI / 2 }, state: 3, why: "Front open again: follow" },
  { pose: { x: 5, y: 8.8, theta: Math.PI / 2 }, state: 2, why: "Wall 1.2 ft ahead and no wall on the right: still turn left, not straight" },
];
const LED_OF: Record<number, string> = { 1: "LED1", 2: "LED2", 3: "LED3" };

// Script for the chattering level: the front distance hovers around 1.5 ft.
const CHATTER_FRONT = [4, 1.47, 1.53, 1.46, 1.52, 1.48, 3.5, 1.58];

// ---------- the course's two-state wall follower ----------

// Names (with their spelling) and starting values of the final project starter.
const STEER_VARS = `// The wall-following variables of the course's final project starter,
// with their names and starting values
uint16_t right_wall_follow_state = 2;   // 1: left turn, 2: right wall follow
float Kp_front_wall = -2.0;
float front_turn_velocity = 0.2;        // ft/s while turning left
float left_turn_Stop_threshold = 3.5;   // ft: the turn ends when the front is this open
float Kp_right_wal = -4.0;
float ref_right_wall = 1.1;             // ft: wanted reading of LADARrightfront
float foward_velocity = 1.0;            // ft/s along the wall
float left_turn_Start_threshold = 1.3;  // ft: closer than this in front starts a turn
float turn_saturation = 2.5;

float LADARfront = 0;        // smallest of points 111 to 115, feet
float LADARrightfront = 0;   // smallest of points 52 to 56, feet
float vref = 0;              // speed command for the wheel controller, ft/s
float turn = 0;              // turn command for the wheel controller`;

const STEER_BODY = `    if (right_wall_follow_state == 1) {
        // Left turn
        turn = Kp_front_wall*(14.5 - LADARfront);
        vref = front_turn_velocity;
        if (LADARfront > left_turn_Stop_threshold) {
            right_wall_follow_state = 2;
        }
    } else if (right_wall_follow_state == 2) {
        // Right wall follow
        turn = Kp_right_wal*(ref_right_wall - LADARrightfront);
        vref = foward_velocity;
        if (LADARfront < left_turn_Start_threshold) {
            right_wall_follow_state = 1;
        }
    }
    if (turn > turn_saturation) {
        turn = turn_saturation;
    }
    if (turn < -turn_saturation) {
        turn = -turn_saturation;
    }`;

/** One call of the course's wall follower: the commands of this scan and the state for the next. */
const steerStep = (state: number, front: number, rightFront: number) => {
  const raw = state === 1 ? -2.0 * (14.5 - front) : -4.0 * (1.1 - rightFront);
  const turn = Math.max(-2.5, Math.min(2.5, raw));
  const vref = state === 1 ? 0.2 : 1.0;
  const next = state === 1 ? (front > 3.5 ? 2 : 1) : front < 1.3 ? 1 : 2;
  return { turn, vref, next };
};

const steerProgram = (body: string) => `${FREQ}

__interrupt void cpu_timer1_isr(void);

${STEER_VARS}
uint32_t numScans = 0;

${MIN_FT_TB}

// The wall follower: called once for every new scan
void wall_follow(void)
{
${body}
}

${tbMain(false)}

// A new scan every 100 ms. In the course code these lines are in the software
// interrupt that runs when the LIDAR's reply is complete.
__interrupt void cpu_timer1_isr(void)
{
    LADARfront = min_ft(111, 115);
    LADARrightfront = min_ft(52, 56);
    wall_follow();
    numScans++;
}
`;

// One pose per scan, in the 10 ft box, starting in state 2 (right wall follow).
const STEER_SCRIPT: { pose: Partial<Pose>; why: string }[] = [
  { pose: { room: 0, x: 5, y: 1, theta: 0 }, why: "wall 1 ft to the right: almost no correction" },
  { pose: { x: 5, y: 1.4, theta: 0 }, why: "too far from the wall: turn right, towards it" },
  { pose: { x: 5, y: 0.7, theta: 0 }, why: "too close: turn left, away from it" },
  { pose: { x: 5, y: 2.5, theta: 0 }, why: "far too far: the turn command is limited" },
  { pose: { x: 8.9, y: 1, theta: 0 }, why: "a wall 1.1 ft ahead: still following on this scan, left turn from the next" },
  { pose: { x: 8.9, y: 1, theta: 0.8 }, why: "turning left, front 1.5 ft: not open enough, keep turning" },
  { pose: { x: 8.9, y: 1, theta: Math.PI / 2 }, why: "front open: this scan still turns, the next one follows" },
  { pose: { x: 8.9, y: 1.2, theta: Math.PI / 2 }, why: "following the new wall" },
];
const STEER_RUN = (() => {
  let pose: Pose = { room: 0, x: 5, y: 5, theta: 0 };
  let state = 2;
  return STEER_SCRIPT.map((step) => {
    pose = { ...pose, ...step.pose };
    const sc = scan(pose);
    const front = minFt(sc, 111, 115);
    const rightFront = minFt(sc, 52, 56);
    const before = state;
    const r = steerStep(state, front, rightFront);
    state = r.next;
    return { front, rightFront, before, ...r };
  });
})();

// ---------- checkpoint ----------

const CORRIDOR: Partial<Pose>[] = [
  { room: 1, x: 0, y: -0.5, theta: 0 },
  { x: 27.5, y: -0.2 },
  { x: 29 },
  { theta: Math.PI / 2 },
  // 12 ft of corridor ahead: in range, so the left-turn law keeps its sign
  { x: 10, theta: Math.PI },
];
const CORRIDOR_LINES = (() => {
  let pose: Pose = { room: 1, x: 0, y: 0, theta: 0 };
  let state = 2;
  return CORRIDOR.map((step) => {
    pose = { ...pose, ...step };
    const sc = scan(pose);
    const front = minFt(sc, 111, 115);
    const rightFront = minFt(sc, 52, 56);
    const r = steerStep(state, front, rightFront);
    state = r.next;
    return `F ${front.toFixed(2)} R ${rightFront.toFixed(2)} S ${state} T ${r.turn.toFixed(2)}`;
  });
})();

const corridorProgram = (o: { setup: string; timer: string; loop: string; data: string; follow: string }) => `${FREQ}

__interrupt void cpu_timer1_isr(void);
void scan_done(void);

${G_CMD}

${PARSER_VARS}
float ladar_ft[228];            // the distances of the last scan, feet

${STEER_VARS}

uint16_t newScan = 0;           // flag: set when a scan is complete
uint32_t numScans = 0;

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

// The course's wall follower: called once for every new scan
void wall_follow(void)
{
${o.follow}
}

void main(void)
{
${SETUP}

${o.setup}

    while (1) {
${o.loop}
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
${o.timer}
    CpuTimer1.InterruptCount++;
}

${parser(o.data)}
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
  blurb: "Infrared and laser ranging, the LIDAR's serial protocol and the wall-following state machine.",
  requires: ["serial"],
  course: ["L14", "L16", "Lab 6", "HW3", "HW4", "HW5"],
  levels: [
    {
      id: "sens-brief",
      kind: "brief",
      title: "Measuring distance with light",
      goal: "Learn how the robot measures distance and how it turns a scan into a decision.",
      refs: [{ course: "L14" }, { course: "L16" }],
      brief: `
A robot that drives has to know how far away things are. Without that it finds a wall by hitting it.

## Passive and active sensors
A **passive** sensor only listens: a camera, a thermometer. An **active** sensor sends energy out and measures what comes back, so it works in the dark. The robot's use **infrared** (IR) light: light just beyond red, which your eye cannot see.

## Infrared distance sensors
A simple IR sensor lights the scene with an infrared LED and measures how strong the reflection is: closer means stronger. The light spreads out, so at twice the distance the reflection is four times weaker, and a dark surface reflects less than a white one. Such a sensor is cheap, but it sees one direction only and reaches about 80 cm.

## Time of flight
A better way is to measure **how long** the light takes to come back:

\`\`\`c
d = c * t / 2;   // c = 3.0e8 m/s, t = time for the round trip
\`\`\`

\`c\` is the speed of light. \`3.0e8\` is how C writes 3.0 times 10 to the power 8: 300 000 000. The light travels the distance twice, hence the division by 2. Move the wall in the figure and count the 5 ns clock periods that fit into the round trip.

{{figure:time-of-flight}}

## A scan
The robot carries a **LIDAR**, a Hokuyo URG-04LX (the course code says LADAR). It measures by time of flight, and a mirror inside spins its infrared laser beam around, so one sensor measures in many directions. One turn gives a **scan**: a list of distances, one per direction.

- field of view (the part of a full turn it sees): 240 of the 360 degrees
- range: 20 mm to 4095 mm, about 4 m
- a new scan ten times per second

Its laser is class 1: safe to look at. With stronger lasers, invisible infrared is the more dangerous kind: your eye does not see it, so you do not blink or look away.

The sensor reports millimetres. The course's robot code works in **feet** (ft): 1 ft = 12 inches = 304.8 mm.

## From a scan to a decision
The scan arrives as text over a serial port (chapter 6). Your code asks for it every 100 ms, decodes it, and then decides: drive on, turn, or follow the wall. You will write all three parts.
`,
      questions: [
        {
          prompt: "Which of these is an active sensor?",
          options: ["A camera", "A LIDAR", "A microphone", "A thermometer"],
          answer: 1,
          why: "A LIDAR sends out laser pulses and measures their echo. The other three only receive what is already there.",
        },
        {
          prompt: "A simple IR sensor judges distance by the strength of the reflection. What is the weakness of that?",
          options: [
            "A dark surface reflects less than a white one, so it looks further away than it is",
            "Infrared light is slower than visible light",
            "It only works in the dark",
            "It needs a spinning mirror",
          ],
          answer: 0,
          why: "The strength depends on the surface as well as on the distance. Timing the light instead (time of flight) hardly depends on the colour.",
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
      id: "sens-angles",
      kind: "calc",
      title: "Where each point looks",
      goal: "Work out how many points the course's scan has and in which direction each one looks.",
      refs: [{ course: "L16" }, { course: "HW4" }],
      brief: `
A scan is a list of distances. To use one you must know which way each distance was measured.

Directions are angles in **degrees**: a full turn is 360, a quarter turn 90. The mirror of the URG-04LX divides the full turn into **1024 steps**, so one step is 360 / 1024 degrees. Step 384 looks straight ahead, and the steps count up to the left (counter-clockwise seen from above).

The course asks for the scan with the command \`G04472503\`:

- \`044\`: first step, 44
- \`725\`: last step, 725
- \`03\`: cluster count 3. The sensor groups the steps in threes and sends one distance per group

Point 0 of the reply is step 44, point 1 is step 47, and point \`i\` is step \`3*i + 44\`. The course code turns that into an angle:

\`\`\`c
angle = (3*i + 44)*0.3515625 - 135;
\`\`\`

The first part is the step times the size of one step. The 135 is that same product for step 384, so straight ahead comes out as 0. Negative angles are to the **right**, positive angles to the **left**.

**Worked example, point 100:** step 3*100 + 44 = 344. 344 * 0.3515625 = 120.94. 120.94 - 135 = **-14.06 degrees**: a little to the right of straight ahead.

Check it in the figure: move the slider to i = 100, then find the points that look ahead and to the right.

{{figure:lidar-fan}}

The last group is not full: it starts at step 725, where the scan ends. It still produces a point.
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
        "Count the steps from 44 to 725 (both included), divide by the cluster count and round up.",
        "To go from an angle to an index, undo the formula one operation at a time, last one first: add 135, divide by 0.3515625 (that is the step), subtract 44, divide by 3.",
        "682 steps / 3, rounded up. Point 0 is step 44: 44 * 0.3515625 - 135. Ahead: (384 - 44) / 3 = 113.3, take the nearest whole index. Right: step (135 - 90) / 0.3515625 = 128, then (128 - 44) / 3.",
      ],
      takeaway: "Point 113 looks ahead, point 28 to the right, point 199 to the left. Every later level uses these indices. HW4 rounds these numbers: 228 readings from -120 to 120 degrees, about 1.05 degrees apart, element 113 straight ahead.",
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

Try it in the figure: step through the decode of another reading, then move the slider and watch which of the two characters changes.

{{figure:lidar-encoding}}

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
        "Subtract 0x30 from each character code first. Each result fits in 6 bits.",
        "0x4D - 0x30 = 0x1D, which is 01 1101 in six bits. 0x63 - 0x30 = 0x33, which is 11 0011.",
        "high = 011101, low = 110011: the value is 0x773 = 1907.",
      ],
      takeaway: "29 * 64 + 51 = 1907 mm. Shifting left by 6 is the same as multiplying by 64.",
    },
    {
      id: "sens-poll",
      kind: "code",
      mode: "complete",
      title: "Ask every 100 ms",
      goal: "Send the G command to the LIDAR from CPU timer 1 and let the receive interrupt count the reply.",
      refs: [{ course: "L16" }, { trm: "19" }, { trm: "3.8" }, { trm: "3.4.5" }],
      brief: `
The URG-04LX only speaks when spoken to: you send it a command, it sends a reply. Asking again and again at a fixed rate is called **polling**. The command for distances is the letter \`G\`. Here the sensor listens at **115200** baud.

The LIDAR is wired to **SCIC**, a third serial port of the chip. It works like the SCIA of chapter 6, with a C in every name: \`init_serialSCIC(&SerialC, 115200);\` sets up the port and its pins (GPIO139 receives, GPIO56 transmits).

## The request
The course sends this from **CPU timer 1**, every 100 ms:

\`\`\`c
serial_sendSCIC(&SerialC, G_command, G_len);
\`\`\`

\`G_command\` is \`"G04472503\\n"\`: the letter, first step 044, last step 725, cluster count 03, and a line feed. Ten characters, counted in \`G_len\`.

## The reply
The sensor answers with

- the echo of your command and its line feed (10 characters)
- a status character, \`'0'\` when all is well, and a line feed (2 characters)
- the data: 228 points, 2 characters each = 456 characters, in lines of 64, each line followed by a line feed (7 full lines and one of 8 characters: 8 line feeds)
- one more line feed, so the reply ends with two in a row

That is 10 + 2 + 456 + 8 + 1 = **477 characters**. At 115200 baud they take about 41 ms, comfortably inside the 100 ms.

## Your task
Every character from the LIDAR causes the SCIC receive interrupt, **PIE group 8, interrupt 5**. The function that runs is \`RXCINT_recv_ready\`. It is given, in the course library, like \`RXAINT_recv_ready\` in chapter 6: here it takes the character and counts it in \`numRXC\`. Three lines are missing:

1. the vector: \`PieVectTable.SCIC_RX_INT\` must point to \`RXCINT_recv_ready\`
2. the port: the call to \`init_serialSCIC\`. It also enables the interrupt in the PIE
3. the request itself, in \`cpu_timer1_isr\`

The course starter sets \`G_len\` to 11, which also sends the 0 that ends the string. The sensor ignores it.
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

    // TODO 2: set up SCIC for the LIDAR, 115200 baud

    IER |= M_INT8;   // SCIC
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
        { kind: "serial", port: 2, matches: "^(G04472503\\n\\x00?){3}$", label: "Three requests were sent on SCIC in 360 ms", hint: "serial_sendSCIC(&SerialC, G_command, G_len); once per timer 1 interrupt." },
        { kind: "signal", name: "LIDAR_SCANS", equals: 3, label: "The LIDAR answered three times", hint: "The LIDAR answers once per request. No answer: no request reached it (TODO 3 goes in cpu_timer1_isr, on SerialC, at 115200 baud). One answer: the request was sent once from main instead of on every timer interrupt." },
        { kind: "var", name: "numRXC", equals: 3 * 477, label: "numRXC counted 3 x 477 characters", hint: "0 characters: either nothing was requested (see the checks above), or the receive interrupt never ran. It needs its vector, and init_serialSCIC to set up the port and enable the interrupt. 477: only one request was sent." },
        { kind: "no-diagnostic", code: "lidar", label: "The LIDAR understood every command", hint: "The message above says what the sensor received. The command is the ten characters of G_command, sent at 115200 baud." },
      ],
      watch: ["numRXC", "RXCdata"],
      inspect: ["PieCtrlRegs.PIEIER8", "ScicRegs.SCIFFRX"],
      hints: [
        "Each TODO is one line. The second and third are quoted in the brief. The first looks like the line above it, with the names from point 1 of the task.",
        "The vector goes between EALLOW and EDIS: `PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;`. The port: `init_serialSCIC(&SerialC, 115200);`",
        "The third line, in the timer function: `serial_sendSCIC(&SerialC, G_command, G_len);`",
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
The receive interrupt gets **one character at a time**. The same character means different things in different places: a \`'0'\` in the header is the status, a \`'0'\` in the data is half a distance. So the function has to remember where in the reply it is. That memory is one variable, the **state**, here \`read_ladar_state\`. Code built around such a variable is a **state machine**: it is always in exactly one state, and what arrives decides when it moves to another.

- **state 0**: wait for the \`'G'\` that starts a reply
- **state 1**: count the header. It has 12 characters: the echo (10), the status and a line feed. The 11th must be \`'0'\`; if not, give up and go back to state 0
- **state 2**: the data

States 0 and 1 are given, as in the course's \`F28379dSerial.c\`. So are the lines above them, which restart the port after a damaged character. You write state 2.

## State 2
For each character:

- a **line feed** (0x0a) is not data. Count it in \`LF_count\`
- anything else is data: set \`LF_count = 0\`, then
  - if \`get_dis_first\` is 1, this is the first character of a pair. Keep its 6 bits (\`RXCdata - 0x30\`), shifted up by 6, in \`tempscid\`, and set \`get_dis_first = 0\`
  - otherwise it is the second character. \`distance = tempscid + \` its 6 bits. Store it in \`ladar_mm[dis_index]\`, add 1 to \`dis_index\`, and set \`get_dis_first = 1\`
- when \`LF_count\` reaches **2**, the reply is complete: set \`read_ladar_state = 0\` and call \`scan_done()\`

**Example.** \`M\`, \`c\`, line feed arrive. \`M\` is the first of a pair: \`tempscid = (0x4D - 0x30) << 6 = 1856\`. \`c\` is the second: \`distance = 1856 + (0x63 - 0x30) = 1907\`, stored. The line feed only makes \`LF_count\` 1.

\`scan_done()\` is given. It copies points 28 (right), 113 (front) and 199 (left) into global variables for you and the tests.

The robot stands in the middle of a 10 ft square room (1524 mm to each wall), then moves between the first and the second scan.
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

Here is a wall follower with three states. \`front\` and \`right\` are distances in feet from the last scan. Each is compared with a fixed limit, a **threshold**.

- **STRAIGHT**: drive straight ahead.
  - if \`front < 1.5\`: go to TURN_LEFT
  - else if \`right < 2.5\`: go to FOLLOW
- **TURN_LEFT**: turn left on the spot.
  - if \`front > 3.0\`: go to FOLLOW
- **FOLLOW**: steer to keep the wall on the right at a fixed distance.
  - if \`front < 1.5\`: go to TURN_LEFT
  - else if \`right > 4.0\`: go to STRAIGHT

If no condition is true, the robot stays in its state. The machine is evaluated once for every scan, and makes at most one transition each time.

Try it in the figure: the sliders are the two readings, every move is one scan, and the state that lights up is where the robot is now. Play the quiz questions through on it.

{{figure:state-machine}}

Notice the two different numbers for the front: the robot starts turning below 1.5 ft but only stops turning above 3.0 ft. Between them it keeps doing whatever it was doing. That gap is called **hysteresis**. Without it, a reading that hovers around a single threshold makes the robot flip between two states on every scan. That is called **chattering**: switch the figure to one threshold and step through the noisy wall to see it.
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
      id: "sens-pturn",
      kind: "calc",
      title: "Steer in proportion",
      goal: "Compute the turn command of a robot that should stay 1.1 ft from a wall: the error, the gain and the limit.",
      refs: [{ course: "L14" }, { course: "Lab 6" }],
      brief: `
The robot should drive along a wall on its right, 1.1 ft away from it. How hard should it steer when it is off? Full lock every time makes it zigzag. The usual answer is to steer **in proportion**: a little when it is a little off, more when it is far off. That takes three steps.

1. The **error**: what you want minus what you measure. Zero means nothing to correct.
2. The command: the error times a fixed number, the **gain**. A larger gain reacts harder to the same error.
3. A **limit**, also called **saturation**: if the result is beyond what the robot should do, cut it to the largest allowed value.

The command here is \`turn\`: how much faster the left wheel should go than the right one, in ft/s. **Positive turns the robot right, negative turns it left.** The course's wall follower computes it like this:

\`\`\`c
turn = Kp_right_wal*(ref_right_wall - LADARrightfront);
if (turn > turn_saturation) {
    turn = turn_saturation;
}
if (turn < -turn_saturation) {
    turn = -turn_saturation;
}
\`\`\`

with \`ref_right_wall = 1.1\` (wanted, ft), \`Kp_right_wal = -4.0\` (the gain) and \`turn_saturation = 2.5\`. \`LADARrightfront\` is the measured distance to the wall.

**Worked example.** The robot measures 1.5 ft. Error: 1.1 - 1.5 = **-0.4** ft, so it is too far away. Turn: -4.0 * -0.4 = **+1.6**: positive, to the right, back towards the wall. Inside the limit, so it stays 1.6.

The gain is negative because the wall is on the right: "too far" is a negative error and must give a positive turn.

Try it in the figure: move the robot away from the wall until the command hits the limit, then change the gain.

{{figure:math-proportional}}
`,
      fields: [
        { id: "err", label: "The robot measures 0.8 ft. Error (wanted - measured)", unit: "ft", answer: 0.3, tolPct: 1, why: "1.1 - 0.8 = +0.3 ft: positive, the robot is too close to the wall." },
        { id: "turn", label: "turn for that reading", answer: -1.2, tolPct: 1, why: "-4.0 * 0.3 = -1.2: negative, a left turn, away from the wall." },
        { id: "far", label: "The robot measures 2.0 ft. turn before the limit", answer: 3.6, tolPct: 1, why: "Error 1.1 - 2.0 = -0.9. -4.0 * -0.9 = +3.6." },
        { id: "sat", label: "turn after the limit, for that reading", answer: 2.5, why: "3.6 is more than turn_saturation, so turn is cut to 2.5: turn right as hard as allowed." },
        { id: "zero", label: "Measured distance at which turn is exactly 0", unit: "ft", answer: 1.1, tolPct: 1, why: "turn is 0 when the error is 0: when the robot measures what it wants, 1.1 ft." },
      ],
      hints: [
        "Always wanted minus measured, in that order. Then multiply by -4.0. Keep track of the signs: minus times minus is plus.",
        "For 0.8 ft: 1.1 - 0.8, then times -4.0. For 2.0 ft: 1.1 - 2.0, then times -4.0, then compare with 2.5.",
        "0.3, then -4.0 * 0.3 = -1.2. For 2.0 ft: -4.0 * -0.9 = 3.6, which the limit cuts to 2.5. The turn is 0 at the wanted distance.",
      ],
      takeaway: "Error = wanted - measured, command = gain * error, then limit. This is a proportional (P) controller. Chapter 16 uses the same three steps for the wheel speeds.",
    },
    {
      id: "sens-steer",
      kind: "code",
      mode: "write",
      title: "The course's wall follower",
      goal: "Turn the front and right-front distances into a speed and a turn command, with the two states of the course's starter code.",
      refs: [{ course: "L14" }, { course: "Lab 6" }, { course: "HW3" }],
      brief: `
A state is more than a name: each state has an **action**. Here the action is two numbers for the **wheel controller**, code that runs every 1 ms and makes the wheels turn at the speeds you ask for (chapter 16 builds it; the tests here only read your two numbers):

- \`vref\`: forward speed in ft/s
- \`turn\`: as in the last level. Positive turns right, negative turns left

Your decision runs once per scan, every 100 ms. Lecture 14 calls the fast wheel controller the **inner loop** and this slower decision the **outer loop**.

## What it looks at
- \`LADARfront\`: the smallest of points 111 to 115
- \`LADARrightfront\`: the smallest of points 52 to 56. They look about 63 degrees to the right: sideways and a little ahead, so a corner shows up early

Both are worked out for you before \`wall_follow()\` is called, by the given function \`min_ft(first, last)\`. Find both groups in the figure.

{{figure:lidar-fan}}

## The two states
The course's final project starter follows the wall on its **right** with two states, kept in \`right_wall_follow_state\`.

**State 2, right wall follow.** The proportional law of the last level, at full speed:

\`\`\`c
turn = Kp_right_wal*(ref_right_wall - LADARrightfront);
vref = foward_velocity;
\`\`\`

Then, if \`LADARfront < left_turn_Start_threshold\`, a wall is close ahead: go to state 1.

**State 1, left turn.** Slowly, and steering by the front distance:

\`\`\`c
turn = Kp_front_wall*(14.5 - LADARfront);
vref = front_turn_velocity;
\`\`\`

With a wall 1.2 ft ahead that is -2.0 * 13.3 = -26.6, which the limit cuts to -2.5: a hard left. Then, if \`LADARfront > left_turn_Stop_threshold\`, the way is open: go to state 2.

**In both states**, last of all, limit \`turn\` to the range \`-turn_saturation\` to \`turn_saturation\`.

## Your task
Write \`wall_follow()\` as \`if (right_wall_follow_state == 1) { ... } else if (right_wall_follow_state == 2) { ... }\`. Keep the order above: first the commands of the state you are in, then the test that may change the state for the **next** scan. All the variables exist, with the starter's names (and spelling: \`foward_velocity\`, \`Kp_right_wal\`) and values. The tests place the robot along a wall of a 10 ft room, at a wall ahead, and through the left turn.
`,
      kit: "robot",
      durationMs: 60 + 100 * STEER_SCRIPT.length,
      stimuli: STEER_SCRIPT.flatMap((st, i) => poseStimuli(i === 0 ? 0 : 50 + 100 * i, st.pose)),
      starter: steerProgram(`    // TODO`),
      solution: steerProgram(STEER_BODY),
      checks: [
        ...STEER_RUN.flatMap((r, i) => [
          near(
            "turn",
            r.turn,
            0.01,
            160 + 100 * i,
            `Scan ${i + 1}, ${STEER_SCRIPT[i].why}: turn is ${r.turn.toFixed(2)}`,
            i === 6
              ? "A small positive number: these commands came from state 2. On the scan that ends the turn, turn and vref are still those of state 1 and only the state changes, so use else if: one state's code per call. About -11: the limit is missing on the negative side."
              : Math.abs(r.turn) === 2.5 && r.before === 1
                ? "The left-turn law gives about -26 here. Limit turn to -turn_saturation .. turn_saturation after the if chain, for both signs and in both states."
                : Math.abs(r.turn) === 2.5
                  ? "More than 2.5: limit turn to -turn_saturation .. turn_saturation after the if chain. -2.5: the sign of the law is wrong, see the hint of scan 2."
                  : i === 1
                    ? "The sign is wrong if this is negative: turn = Kp_right_wal*(ref_right_wall - LADARrightfront), wanted minus measured, and Kp_right_wal is already negative."
                    : i === 4
                      ? "On the scan that sees the wall ahead, the commands still come from state 2. Only the state changes."
                      : "0: wall_follow() did not set turn in this state. The opposite sign: the bracket is (ref_right_wall - LADARrightfront), wanted minus measured. -2.5: the code of state 1 ran; compare with == and not with =.",
          ),
          {
            kind: "var" as const,
            name: "right_wall_follow_state",
            at: 160 + 100 * i,
            equals: r.next,
            label: `Scan ${i + 1}: front ${r.front.toFixed(2)} ft, so the state for the next scan is ${r.next}`,
            hint: i === 5 ? "A left turn ends above left_turn_Stop_threshold (3.5 ft), not above the 1.3 ft that started it." : undefined,
          },
        ]),
        near("vref", 1.0, 0.001, 160, "Following the wall: vref is foward_velocity, 1.0 ft/s", "Set vref in each state, next to turn."),
        near("vref", 0.2, 0.001, 660, "Turning left: vref is front_turn_velocity, 0.2 ft/s", "State 1 drives slowly: vref = front_turn_velocity; there."),
      ],
      watch: ["right_wall_follow_state", "LADARfront", "LADARrightfront", "vref", "turn"],
      hints: [
        "Two branches, one per state. Each sets turn and vref and then has one if that may change right_wall_follow_state.",
        "The limit comes after both branches: `if (turn > turn_saturation) { turn = turn_saturation; }` and the same for the negative side.",
        "State 2: `turn = Kp_right_wal*(ref_right_wall - LADARrightfront); vref = foward_velocity; if (LADARfront < left_turn_Start_threshold) { right_wall_follow_state = 1; }`. State 1 has the same shape with the other two lines of the brief and `>` `left_turn_Stop_threshold`.",
      ],
      takeaway: "Wall following is a proportional controller on a distance, wrapped in a state machine. With the starter's numbers the left turn is always at the limit (-2.5), because LADARfront is far below 14.5 ft for any wall the sensor can see: the gains and thresholds are a starting point that you tune on the robot.",
    },
    {
      id: "sens-chatter",
      kind: "code",
      mode: "debug",
      title: "Left, no, right, no, left",
      goal: "Stop the wall follower from flipping between two states when the front distance hovers around the threshold.",
      refs: [{ course: "L14" }],
      brief: `
This is the three-state wall follower of "States and transitions". It works in open space, but in front of a wall the robot twitches: it starts to turn, stops, starts again, stops again. The motors get a new command on every scan and the robot hardly moves.

## Reading the code
The state machine is written with a \`switch\`, which picks one block of code by the value of a variable:

\`\`\`c
switch (state) {
case TURN_LEFT:     // runs when state == TURN_LEFT
    ...
    break;          // done: jump to the end of the switch
case FOLLOW:        // runs when state == FOLLOW
    ...
    break;
}
\`\`\`

It does the same as \`if (state == TURN_LEFT) { ... } else if (state == FOLLOW) { ... }\`. \`default:\` catches every other value. The state names are numbers, given by the \`#define\` lines at the top. The LED lines after the switch are given: they show the state.

## The run
The tests hold the robot about 1.5 ft from a wall. The reading is never exactly the same twice: 1.47, 1.53, 1.46, 1.52, 1.48 ft. Then the turn is completed and the front opens up to 3.5 ft. Last, the robot follows the new wall with 1.58 ft in front, which is not blocked.

\`transitions\` counts how often the state changed. It should be **2**: into TURN_LEFT when the wall comes close, and to FOLLOW when the turn is finished. Run the code and see what it does instead.

The figure replays the first seven readings: choose "one threshold", press Next seven times and count the state changes. Then do the same with two thresholds.

{{figure:state-machine}}

## Your task
Fix the state machine with **hysteresis** (lecture 14 also says deadband): leave a state at a different threshold than the one that got you into it. A turn is finished when the front is more than **3.0 ft** away.
`,
      kit: "robot",
      durationMs: 860,
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
        { kind: "var", name: "state", at: 260, equals: 2, label: "The robot starts turning when the wall is 1.47 ft ahead", hint: "Keep the test that starts the turn: front_ft < FRONT_BLOCKED, with FRONT_BLOCKED at 1.5." },
        { kind: "var", name: "state", at: 360, equals: 2, label: "At 1.53 ft it is still turning", hint: "1.53 is more than 1.5, but the turn is not finished. Leave TURN_LEFT only when the front is clearly open." },
        { kind: "var", name: "state", at: 560, equals: 2, label: "At 1.52 ft it is still turning", hint: "The threshold that ends the turn must be well above the noise: 3.0 ft." },
        { kind: "steady", led: "LED2", from: 210, to: 690, on: true, label: "LED2 (turning left) stays on without flicker while the front hovers around 1.5 ft", hint: "Each flicker is one trip from TURN_LEFT to FOLLOW and back. Look at the condition in case TURN_LEFT." },
        { kind: "var", name: "state", at: 760, equals: 3, label: "With 3.5 ft in front the turn is finished: FOLLOW", hint: "The turn must still end: in case TURN_LEFT, go to FOLLOW when front_ft is above the new, higher threshold." },
        { kind: "var", name: "state", equals: 3, label: "Following with 1.58 ft in front: not blocked, still FOLLOW", hint: "Do not raise FRONT_BLOCKED to hide the noise: the robot would then turn away from walls it should follow. Keep 1.5 for starting a turn and add a second threshold for ending it." },
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
      goal: "Poll the LIDAR, parse its reply, run the wall follower on every scan and report over serial.",
      refs: [{ course: "Lab 6" }, { course: "L14" }, { course: "L16" }, { course: "Lab 1" }, { trm: "19" }, { trm: "3.4.5" }],
      brief: `
Everything together, on the real serial path. You have written every piece in this chapter; here you connect them.

## Set-up, in main
- vectors for \`TIMER1_INT\` (your \`cpu_timer1_isr\`) and \`SCIC_RX_INT\` (\`RXCINT_recv_ready\`)
- CPU timer 1 with a period of 100 ms, started
- \`init_serialSCIC(&SerialC, 115200);\` for the LIDAR and \`init_serialSCIA(&SerialA, 115200);\` for the terminal
- \`IER\` bits for PIE group 8 (SCIC, \`M_INT8\`) and CPU timer 1 (\`M_INT13\`), then \`EINT\`

## Timer 1
Send \`G_command\` to the LIDAR.

## The parser
Paste your data state from "The parser is a state machine". The course stores **feet**, and stores "very far" when the sensor sends an error code instead of a distance (0 or 6: no usable echo). So replace the line that stored \`ladar_mm[dis_index]\` by

\`\`\`c
if (distance == 0 || distance == 6) {
    distance = LADAR_MAX_READING;   // 5700 mm, defined in the course library
}
ladar_ft[dis_index] = distance*0.00328084;   // mm to feet: 1 / 304.8
\`\`\`

## The wall follower
Paste the body of your \`wall_follow()\` from "The course's wall follower".

## When a scan is complete
The parser calls \`scan_done()\`, which sets the flag \`newScan\`. Printing is slow, so it belongs in \`while(1)\`, behind the flag (chapters 5 and 6). When \`newScan\` is 1:

1. set it back to 0
2. \`LADARfront = min_ft(111, 115);\` and \`LADARrightfront = min_ft(52, 56);\`
3. call \`wall_follow()\`
4. add 1 to \`numScans\`
5. print one line on SerialA with the two distances, the state and the turn command, exactly in this format:

\`\`\`c
"F %.2f R %.2f S %d T %.2f\\r\\n"
\`\`\`

## The run
The robot is in a corridor 3 ft wide and 32 ft long. The tests move it: at the start, near the far end, right up to the end wall, turned left by 90 degrees, and facing back the way it came. Where the corridor is longer than the sensor can see, the front reads 18.70 ft.
`,
      kit: "robot",
      durationMs: 560,
      stimuli: CORRIDOR.flatMap((p, i) => poseStimuli(i === 0 ? 0 : 50 + 100 * i, p)),
      starter: corridorProgram({
        setup: `    // TODO: vectors, timer 1 (100 ms), the two serial ports, IER, EINT`,
        timer: `    // TODO: ask the LIDAR for a scan`,
        loop: `        // TODO: when newScan is set: the two distances, wall_follow(), numScans, print`,
        data: `            // TODO: paste your data state from "The parser is a state machine",
            // then store feet in ladar_ft[] as the brief shows`,
        follow: `    // TODO: paste the body of your wall_follow() from "The course's wall follower"`,
      }),
      solution: corridorProgram({
        setup: `    EALLOW;
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
        timer: `    serial_sendSCIC(&SerialC, G_command, G_len);`,
        loop: `        if (newScan == 1) {
            newScan = 0;
            LADARfront = min_ft(111, 115);
            LADARrightfront = min_ft(52, 56);
            wall_follow();
            numScans++;
            serial_printf(&SerialA, "F %.2f R %.2f S %d T %.2f\\r\\n",
                          LADARfront, LADARrightfront, right_wall_follow_state, turn);
        }`,
        data: state2(STORE_FT, DONE),
        follow: STEER_BODY,
      }),
      checks: [
        { kind: "signal", name: "LIDAR_SCANS", equals: 5, label: "The LIDAR was asked for five scans, one every 100 ms", hint: "Timer 1 needs its vector, a 100000 microsecond period, TCR and IER |= M_INT13." },
        { kind: "var", name: "numScans", equals: 5, label: "main handled each scan once", hint: "0: the receive interrupt is not running (vector, init_serialSCIC), the parser never sees two line feeds, or the flag is never tested. A huge number: the flag is never set back to 0." },
        { kind: "serial", includes: `${CORRIDOR_LINES[0]}\r\n`, label: `Start of the corridor: "${CORRIDOR_LINES[0]}"`, hint: "F 0.00: an error code was stored as a distance; error codes must become LADAR_MAX_READING, which prints as 18.70 ft. F 19.00 R 19.00: the array holds millimetres, multiply by 0.00328084. A different state or turn: call wall_follow() before printing. Otherwise compare the format string character by character, including \\r\\n." },
        { kind: "serial", includes: `${CORRIDOR_LINES[1]}\r\n`, label: `Near the end, further from the right wall: "${CORRIDOR_LINES[1]}"`, hint: "Right-front is points 52 to 56." },
        { kind: "serial", includes: `${CORRIDOR_LINES[2]}\r\n`, label: `At the end wall: "${CORRIDOR_LINES[2]}"`, hint: "Call wall_follow() after updating the distances and before printing." },
        { kind: "serial", includes: `${CORRIDOR_LINES[3]}\r\n`, label: `Turned left by 90 degrees: "${CORRIDOR_LINES[3]}"` },
        { kind: "serial", includes: `${CORRIDOR_LINES[4]}\r\n`, label: `Facing back, front open: "${CORRIDOR_LINES[4]}"`, hint: "On the scan that sees the open front the commands are still those of the left turn. Only the state changes." },
        { kind: "serial", matches: `^(F \\d+\\.\\d\\d R \\d+\\.\\d\\d S \\d T -?\\d\\.\\d\\d\\r\\n){5}$`, label: "Exactly five lines, nothing else", hint: "One serial_printf per scan, with exactly the format of the brief. Many equal lines: newScan is never set back to 0." },
        { kind: "serial-period", periodMs: 100, label: "A line is printed every 100 ms", hint: "Print once per scan, in while(1), when newScan is 1. Timer 1 must have a period of 100000 microseconds." },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function", hint: "Print from while(1), behind the newScan flag." },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the values" },
      ],
      bonus: [
        { kind: "isr-time", fn: "RXCINT_recv_ready", maxUs: 1.5, label: "The receive interrupt never runs longer than 1.5 us: the scan is worked on in main, not inside the interrupt", hint: "Keep scan_done() to setting the flag. min_ft() and wall_follow() belong in while(1)." },
      ],
      watch: ["numScans", "right_wall_follow_state", "LADARfront", "LADARrightfront", "turn", "read_ladar_state"],
      hints: [
        "Set-up is that of \"Ask every 100 ms\" (open that level and copy your main), plus `init_serialSCIA(&SerialA, 115200);` for the terminal. The loop is `if (newScan == 1) { newScan = 0; ... }` with the five steps of the brief inside.",
        "The print: `serial_printf(&SerialA, \"F %.2f R %.2f S %d T %.2f\\r\\n\", LADARfront, LADARrightfront, right_wall_follow_state, turn);`",
        "If you do not have your parser at hand, the data state is: `if (RXCdata == 0x0a) { LF_count += 1; } else { LF_count = 0; if (get_dis_first == 1) { tempscid = (RXCdata - 0x30) << 6; get_dis_first = 0; } else { distance = tempscid + (RXCdata - 0x30); /* store, as in the brief */ dis_index += 1; get_dis_first = 1; } } if (LF_count == 2) { read_ladar_state = 0; scan_done(); }`. The wall follower is spelled out in the brief of its level.",
      ],
      takeaway: "This is the skeleton of the robot's navigation code: poll, parse, reduce the scan to a few distances, decide, hand vref and turn to the wheel controller. The homeworks ask you to design more states; now you know where they run.",
    },

    // ------------------------------------------------------------ practice
    {
      id: "sens-ir",
      kind: "calc",
      tier: "practice",
      title: "What an IR sensor can and cannot do",
      goal: "Put numbers on the limits of an infrared sensor that measures the strength of the reflection.",
      refs: [{ course: "L14" }],
      brief: `
A simple IR distance sensor sends out infrared light and measures how much comes back. Light that spreads out covers four times the area at twice the distance, so each part of it is four times weaker. That is the **inverse square law** of lecture 14:

\`\`\`c
signal = k * reflectivity / (d * d);
\`\`\`

\`reflectivity\` says how much of the light the surface sends back (white paint a lot, black cloth little), and \`k\` collects everything that stays the same. At 3 times the distance, \`d * d\` is 9 times larger, so the signal is 9 times weaker.

The sensor only sees \`signal\`. It turns it into a distance by assuming one fixed reflectivity.

Two consequences follow, and the fields below put numbers on them: the signal fades fast, which limits the range to about 80 cm, and a darker surface looks further away than it is.

The last field is the reason for the LIDAR. An IR sensor looks in one direction with a narrow cone, so covering a wide view takes many of them.
`,
      fields: [
        { id: "far", label: "Signal at 40 cm, as a percentage of the signal at 10 cm (same surface)", unit: "%", answer: 6.25, tolPct: 1, why: "4 times the distance: 1 / (4 * 4) = 1/16 = 6.25 %." },
        { id: "ratio", label: "The object moves from 20 cm to 80 cm. The signal becomes this many times weaker", answer: 16, why: "(80 / 20) squared = 16." },
        { id: "dark", label: "A dark box reflects a quarter of what the calibration surface does. It stands at 30 cm. Distance the sensor reports", unit: "cm", answer: 60, tolPct: 1, why: "A quarter of the signal looks like twice the distance, because the signal goes with 1 / d squared: 30 * sqrt(4) = 60 cm." },
        { id: "count", label: "Sensors with a 15 degree cone needed to cover the LIDAR's 240 degrees without gaps", answer: 16, why: "240 / 15 = 16 sensors, each with its own wiring, calibration and stray light from its neighbours. One spinning laser does the same job." },
      ],
      hints: [
        "Only ratios matter: k drops out when you divide one signal by another.",
        "For the dark box, write the signal it really gives, then ask which distance gives the same signal with the calibration reflectivity.",
        "signal ratio = (d1 / d2) squared. A quarter of the signal looks like twice the distance, because 2 * 2 = 4 (2 is the square root of 4): 30 cm is reported as 60 cm.",
      ],
      takeaway: "Strength of reflection is a cheap but rough measure of distance. The robot's own IR sensors (on the CAN bus, chapter 14) and its LIDAR time the light instead, which hardly depends on the surface.",
    },
    {
      id: "sens-tof",
      kind: "calc",
      tier: "practice",
      title: "How fast is light",
      goal: "Work out the times a laser range finder has to measure, and compare them with the CPU clock.",
      refs: [{ course: "L14" }, { trm: "3.7" }],
      brief: `
Time of flight: the sensor sends a pulse and times the echo.

\`\`\`c
d = c * t / 2;
\`\`\`

Use c = 3.0e8 m/s (300 000 000 m/s). One nanosecond (ns) is 1e-9 s, a billionth of a second. One picosecond (ps) is 1e-12 s, a thousand times shorter again.

The figure draws the round trip and the CPU clock to the same scale. Work the numbers out first, then check them with the slider.

{{figure:time-of-flight}}

The CPU of the F28379D runs at 200 MHz. Imagine you tried to time the echo yourself by counting CPU clock periods. The last two questions show why nobody does that: the sensor has its own timing circuit and only sends you the finished distance. (The URG-04LX does not time single pulses. It makes the brightness of its beam rise and fall in a steady rhythm and measures how far the returning rhythm lags behind. The distance still follows from the travel time.)
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
        "t = 2 * 3 / 3.0e8 s. d = 3.0e8 * 10e-9 / 2 m. One period is 1 / 200e6 s. Then d = 3.0e8 * 5e-9 / 2 m, and t = 2 * 0.001 / 3.0e8 s.",
      ],
      takeaway: "A 5 ns clock is far too coarse to time one laser pulse. The sensor does the timing in its own hardware and sends you a number.",
    },
    {
      id: "sens-decode",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Decode a line",
      goal: "Write decode() for one reading and decode_line() for a whole line of readings.",
      refs: [{ course: "L16" }],
      brief: `
Do in C what you did by hand in "Two characters, twelve bits". The figure shows the same steps with the C expression next to them.

{{figure:lidar-encoding}}

## \`int decode(char hi, char lo)\`
Returns the distance in millimetres for the two characters of one reading: subtract 0x30 from each, shift the first one up by 6 bits, add the second.

## \`int decode_line(char *text, int *out)\`
The sensor sends the readings in lines of 64 characters, which is 32 readings. \`decode_line\` walks through the text two characters at a time, stores each distance in \`out[0]\`, \`out[1]\`, ... and returns how many readings it found. It stops at the \`0\` that ends a C string, or at a line feed (\`'\\n'\`).

The program calls your functions on two pieces of a real reply: a full line of 64 characters, and the short last line of a scan: 8 characters, followed by the two line feeds that end the reply.
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
        { kind: "var", name: "tail_count", equals: 4, label: "The short line holds 4 readings", hint: "Do not assume 32 readings, and do not decode a line feed: stop at '\\n' as well as at 0." },
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
      id: "sens-parser-debug",
      kind: "code",
      mode: "debug",
      tier: "practice",
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
      tier: "practice",
      title: "From a laser pulse to the wheels",
      goal: "Put the steps of one 100 ms cycle of the wall-following robot in order.",
      refs: [{ course: "L14" }, { course: "L16" }],
      brief: `
The robot runs two loops at two speeds.

- The **inner loop** runs in a hardware interrupt every 1 ms. It reads the wheel encoders (sensors that count how far each wheel has turned), runs the wheel speed controller and updates the robot's position. It needs a speed and a turn rate to aim for.
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
      tier: "practice",
      title: "What is closest, and where",
      goal: "Find the nearest obstacle in a scan and its direction, and the distance in front and to the right.",
      refs: [{ course: "L14" }, { course: "L16" }, { course: "HW4" }],
      brief: `
A scan is 228 numbers. Behaviour needs a few meaningful ones. Here the decoded scan is handed to you directly, so you can concentrate on using it: \`dist[i]\` is the distance of point \`i\` in **feet**, as in the course code. A point without an echo holds 18.7 ft (the course's "maximum reading"), so it is never the nearest.

## \`float point_deg(int i)\`
The angle of point \`i\` in degrees, with the course's formula:

\`\`\`c
(3*i + 44)*0.3515625 - 135
\`\`\`

## \`void process_scan(void)\`
Called once per scan. Set:

- \`nearest_index\`: the index of the smallest distance in the whole scan (the tests use scans where only one point has it)
- \`nearest_ft\`: that distance
- \`nearest_deg\`: its direction, from \`point_deg\`
- \`front_ft\`: the smallest of points **111 to 115** (straight ahead)
- \`right_ft\`: the smallest of points **26 to 30** (around -90 degrees)

Taking the smallest of five neighbours, as the course code does, makes the reading less sensitive to one bad point.

Finding the smallest of a list is always the same loop: start with a first guess, look at every element, and replace the guess whenever a smaller one turns up.

\`\`\`c
best = 0;                       // guess: element 0 is the smallest
for (i = 1; i < 228; i++) {
    if (dist[i] < dist[best]) {
        best = i;               // found a smaller one: remember where
    }
}
\`\`\`

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
      bonus: [
        { kind: "isr-time", fn: "cpu_timer1_isr", maxUs: 60, label: "A scan is handled in under 60 us (copying it takes about 35 of them)", hint: "Search the 228 points once, compute the angle once after the loop, and loop over only five points for the front and the right." },
      ],
      watch: ["nearest_index", "nearest_ft", "nearest_deg", "front_ft", "right_ft"],
      hints: [
        "The loop in the brief gives nearest_index. For front_ft and right_ft start the guess at 19.0 (more than any reading) and loop over five points only.",
        "Remember the index of the smallest value, not only the value: you need it for the angle.",
        "`for (i = 1; i < 228; i++) { if (dist[i] < dist[nearest_index]) { nearest_index = i; } }`, then `nearest_ft = dist[nearest_index]; nearest_deg = point_deg(nearest_index);`. The same loop over 111..115 and 26..30 gives front_ft and right_ft.",
      ],
      takeaway: "Two numbers, front and right, are enough to follow a wall. The course's starter looks a little further forward on the right (points 52 to 56, about -63 degrees) so that the robot sees a corner coming.",
    },
    {
      id: "sens-follow",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "A three-state wall follower",
      goal: "Write the wall follower's state machine as a switch and show the state on three LEDs.",
      refs: [{ course: "L14" }, { course: "HW3" }, { course: "HW4" }],
      brief: `
Write the three-state machine of "States and transitions" in C. The usual form is a \`switch\` on the state variable, with one \`case\` per state. Inside each case, test that state's transitions and assign the new state.

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

The four thresholds are defined at the top of the file. Inside a case, the order of the tests matters: a blocked front always wins.

## The action
This robot has no motors yet, so each state only lights an LED. After the switch, in \`wall_follow()\`:

- **LED1** (GPIO22, port A) is on in STRAIGHT
- **LED2** (GPIO94, port C) is on in TURN_LEFT
- **LED3** (GPIO95, port C) is on in FOLLOW

Exactly one LED is on at any time.

\`wall_follow()\` is called once per scan, after \`front_ft\` and \`right_ft\` have been updated. The tests move the robot through a 10 ft square room, one pose per scan: open floor, along a wall, up to a wall, through a left turn, away again and into a corner.
`,
      kit: "robot",
      durationMs: 960,
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
                : i === 8
                  ? "In FOLLOW, test the front first."
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
        "513 steps / 2 = 256.5, so 257 points. (128 - 384) * 0.3515625 = -90. (384 - 128) / 2 = 128. 514 characters = 8 lines of 64 and one of 2: 9 lines. 10 + 2 + 514 + 9 + 1 = 536. 536 * 10 / 115200 s = 46.5 ms.",
      ],
      takeaway: "The reply length follows from the request. A parser that counts on 228 points only works for the one command it was written for.",
    },

    {
      id: "sens-polar",
      kind: "calc",
      tier: "practice",
      title: "From a beam to a point",
      goal: "Turn one LIDAR reading, a distance and an angle, into how far ahead and how far to the side the point is.",
      refs: [{ course: "L16" }, { course: "HW5" }],
      brief: `
A LIDAR reading says "something is \`d\` away, in direction \`alpha\`". A map needs "how far ahead, and how far to the side". This level converts one into the other. The expert levels build on it.

Picture a right-angled triangle with the beam as its long side. Its two short sides are what you want:

- \`x = d * cos(alpha)\`: how far **ahead** of the sensor the point is
- \`y = d * sin(alpha)\`: how far to its **left**

\`cos\` (cosine) and \`sin\` (sine) are functions that a calculator and C both have. For an angle, each gives a number between -1 and 1: cos is the fraction of the distance that points ahead, sin the fraction that points left.

- 0 degrees: cos = 1, sin = 0. All of it is ahead
- 90 degrees: cos = 0, sin = 1. All of it is to the left
- 30 degrees: cos = 0.866, sin = 0.5
- negative angles (to the right) give a negative sin; beyond 90 degrees cos is negative: behind the sensor

## Radians
C's \`sin()\` and \`cos()\` do not take degrees. They take **radians**, a second unit for angles in which half a turn, 180 degrees, is pi = 3.14159. So one degree is pi / 180 = 0.01745329 rad:

\`\`\`c
alpha = deg*0.01745329;   // degrees to radians
x = d*cos(alpha);
y = d*sin(alpha);
\`\`\`

Forget the conversion and \`cos(90)\` is the cosine of 90 radians, more than 14 full turns: a wrong number, with no error message.

**Worked example.** A beam 30 degrees to the left hits a wall 3.0 ft away. alpha = 30 * 0.01745329 = 0.5236 rad. x = 3.0 * 0.866 = **2.60 ft** ahead, y = 3.0 * 0.5 = **1.50 ft** to the left.

Set the same beam in the figure, then use it (or a calculator in degree mode) for the fields.

{{figure:math-polar}}
`,
      fields: [
        { id: "rad", label: "60 degrees in radians", unit: "rad", answer: 1.0472, tolPct: 0.5, why: "60 * 0.01745329 = 1.0472 rad. That is pi / 3: a third of half a turn." },
        { id: "x60", label: "Beam 60 degrees to the left, d = 4.0 ft: x (ahead)", unit: "ft", answer: 2.0, tolPct: 1, why: "cos(60 degrees) = 0.5, so x = 4.0 * 0.5 = 2.0 ft." },
        { id: "y60", label: "Same beam: y (to the left)", unit: "ft", answer: 3.464, tolPct: 1, why: "sin(60 degrees) = 0.866, so y = 4.0 * 0.866 = 3.46 ft. The point is more to the side than ahead." },
        { id: "yright", label: "Beam at -90 degrees (exactly right), d = 2.5 ft: y", unit: "ft", answer: -2.5, tolPct: 1, why: "sin(-90 degrees) = -1, so y = -2.5 ft: negative y is to the right. x is 2.5 * cos(-90 degrees) = 0." },
        { id: "xback", label: "Beam at 120 degrees, d = 3.0 ft: x", unit: "ft", answer: -1.5, tolPct: 1, why: "cos(120 degrees) = -0.5, so x = -1.5 ft: the point is 1.5 ft behind the sensor." },
      ],
      hints: [
        "Radians = degrees * 0.01745329. Then x = d * cos, y = d * sin. Mind the signs.",
        "cos(60) = 0.5 and sin(60) = 0.866. sin(-90) = -1. cos(120) = -0.5. The figure shows all of them.",
        "1.0472. 4.0 * 0.5 = 2.0 and 4.0 * 0.866 = 3.464. 2.5 * -1 = -2.5. 3.0 * -0.5 = -1.5.",
      ],
      takeaway: "x = d cos(alpha) ahead, y = d sin(alpha) to the left, with alpha in radians in C. Every point of a scan becomes a dot on a map this way.",
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
A LIDAR reading is seen from the sensor. A map needs the same point in **world** coordinates: x and y measured from a fixed corner of the room, so that a wall stays where it is when the robot moves. Do "From a beam to a point" (practice) first.

## Step 1: the point seen from the robot
\`alpha\` is the angle of point \`i\`: the course formula, times 0.01745329 for radians. The sensor sits \`LADAR_OFFSET\` feet ahead of the robot's centre, looking the same way:

\`\`\`c
xr = LADAR_OFFSET + dist[i]*cos(alpha);   // ahead of the robot's centre
yr = dist[i]*sin(alpha);                  // to its left
\`\`\`

## Step 2: turn it by the heading, shift it by the position
The robot's centre is at \`(robot_x, robot_y)\`, and \`robot_theta\` is its heading in radians: 0 along the world's x axis, positive counter-clockwise. "xr ahead" is a step along the heading, "yr to the left" a step a quarter turn further round:

\`\`\`c
ptx[i] = robot_x + xr*cos(robot_theta) - yr*sin(robot_theta);
pty[i] = robot_y + xr*sin(robot_theta) + yr*cos(robot_theta);
\`\`\`

Check it with numbers: robot at (2, 1), heading 90 degrees (cos 0, sin 1), a point 3 ft ahead (xr = 3, yr = 0). World: (2 + 0, 1 + 3) = (2, 4). Ahead is now up the y axis. (Use these lines, not the matrix on the lecture slide: its y row has an error.)

## \`to_world()\`
Fill \`ptx[i]\` and \`pty[i]\` for all 228 points. \`dist[]\` and the pose are filled in before your functions run.

## \`fit_wall()\`
There is one long, straight wall. Find the line \`y = wall_m * x + wall_c\` that passes closest to the points with an echo (\`dist[i] < NO_ECHO\`). The **least squares** formulas give it:

\`\`\`c
m = (n*Sxy - Sx*Sy) / (n*Sxx - Sx*Sx);
c = (Sy - m*Sx) / n;
\`\`\`

\`Sx\`, \`Sy\`, \`Sxx\`, \`Sxy\` are the sums of x, y, x*x and x*y over those points, \`n\` their number. Then set

- \`npts\`: the number of points used
- \`wall_dist\`: the shortest distance from the robot's centre to the line: \`fabs(m*robot_x - robot_y + c) / sqrt(m*m + 1.0)\`. \`fabs\` drops the sign, \`sqrt\` is the square root
- \`wall_angle\`: \`atan(m) - robot_theta\`. \`atan\` turns a slope into the angle of the line, in radians. A wall parallel to the robot's path gives 0

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
        near("wall_m", 0, 0.004, 160, "First pose: the wall runs along the x axis (slope 0)", "A slope far from 0 means the points are turned wrongly. Check the signs in step 2 (minus in the x line only), and that alpha is in radians: multiply the degrees by 0.01745329."),
        near("wall_c", -2, 0.02, 160, "First pose: the wall is the line y = -2", "Off by a few hundredths: the sensor is not at the robot's centre. Add LADAR_OFFSET along the robot's heading."),
        near("wall_dist", 2.5, 0.02, 160, "First pose: the robot's centre is 2.5 ft from the wall", "fabs(wall_m*robot_x - robot_y + wall_c) / sqrt(wall_m*wall_m + 1.0), computed after wall_m and wall_c."),
        near("wall_angle", -0.3, 0.005, 160, "First pose: the wall is at -0.3 rad relative to the heading", "atan(wall_m) - robot_theta. The wall lies along the x axis and the robot's heading is 0.3 rad."),
        { kind: "var", name: "npts", equals: WORLD_N[1], label: `Second pose: ${WORLD_N[1]} points have an echo` },
        near("wall_m", 0, 0.004, undefined, "Second pose: still slope 0"),
        near("wall_c", -2, 0.02, undefined, "Second pose: still y = -2"),
        near("wall_dist", 3, 0.02, undefined, "Second pose: 3 ft from the wall"),
        near("wall_angle", 0.4, 0.005, undefined, "Second pose: the wall is at +0.4 rad relative to the heading"),
      ],
      watch: ["npts", "wall_m", "wall_c", "wall_dist", "wall_angle", "robot_theta"],
      hints: [
        "to_world: one loop over i from 0 to 227. Inside: `alpha = ((3*i + 44)*0.3515625 - 135.0)*0.01745329;` then the two lines of step 1 and the two of step 2.",
        "fit_wall: set the four sums and npts to 0, then loop: `if (dist[i] < NO_ECHO) { sx += ptx[i]; sy += pty[i]; sxx += ptx[i]*ptx[i]; sxy += ptx[i]*pty[i]; npts++; }`.",
        "After the loop: `wall_m = (npts*sxy - sx*sy) / (npts*sxx - sx*sx); wall_c = (sy - wall_m*sx) / npts;` then the two expressions of the brief for wall_dist and wall_angle, with wall_m and wall_c.",
      ],
      takeaway: "Turn by the heading, then shift by the position: the lectures call this pair a homogeneous transform. In world coordinates, fixed things stay fixed when the robot moves, and that is what makes a map possible.",
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
- \`door_width_ft\`: the distance between the two door posts. The sensor and the two posts form a triangle. You know two of its sides (the two readings, \`a\` and \`b\`) and the angle \`gamma\` between them. The **law of cosines** gives the third side: \`w*w = a*a + b*b - 2*a*b*cos(gamma)\`, so \`w = sqrt(...)\`, where \`sqrt\` is the square root

A run that touches the edge of the scan (point 0 or point 227) has only one post and does not count. When no doorway is found, leave \`door_deg\` and \`door_width_ft\` at 0.

The tests look from two poses in the room with the doorway, then put the robot in a room without one. \`cos\` takes radians (see "From a beam to a point"): multiply degrees by 0.01745329.
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
      bonus: [
        { kind: "var", name: "good_scans", min: 5, max: 5, label: "5 scans accepted: the reply that only lost its last line feed is saved, because all of its points arrived", hint: "Finish a scan at the line feed that follows point 228. Do not wait for a second one." },
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
