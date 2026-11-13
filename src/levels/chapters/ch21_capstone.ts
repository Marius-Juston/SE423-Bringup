import type { Chapter } from "../types";
import type { Check, Stimulus } from "../../sim/runner";

// Timing: library maths costs simulated time (sin, cos, atan2 about 1 us,
// sqrt 0.25 us). From cap-lean on, the 1 ms interrupt keeps only the heading;
// x, y, dist and eTheta are computed by navigate() in the main loop behind
// navFlag. Longest pass of cpu_timer0_isr: 6.0 us with the maths inside
// (cap-goto), 2.5 to 2.75 us after; the budget of ISR_BUDGET is 3.5 us, which
// also fails a program that leaves sqrt and atan2 inside (3.95 us) or reads
// the 39 LIDAR points in the 1 ms loop (7.7 us).
//
// Chapter 21 is ONE program that grows level by level. Each code level
// `continues` the one before it, so the student keeps building on their own
// file. The reference program is assembled by `program(n, ...)`: stage n
// contains everything of stage n - 1 plus one new part, and the starter of
// each level is the previous stage with "// TODO" comment lines inserted
// (`withTodos`), so the chain property holds by construction
// (tests/capstone.test.ts checks it).
//
// The world is src/sim/plugins/robot_world.ts: the motors of actuators.ts
// (30 rad/s at 100 % duty, 50 ms time constant, 4 % dead zone) move a robot
// with wheels 0.6 ft apart through a room of lidar.ts. Measured with these
// programs: 0.32 ft/s per unit of effort above 0.4, 3.09 ft/s at effort 10,
// 1.5 ft/s at effort 5; one simulated second costs about 0.1 s of wall time.
// Every level sets MOTOR_RIGHT_GAIN to 0.88: the right motor is 12 % weaker,
// so open loop veers right, PI makes the speeds equal and the steering
// coupling keeps the heading through the start (0.001 rad against 0.007).

// ---------- the room ----------

/** Room 3 of lidar.ts: a 10 ft x 10 ft box with a 1 ft block at x 7..8, y 6..7. */
const ROOM = 3;
/** The right motor's speed for the same command, relative to the left one. */
const RIGHT_GAIN = 0.88;
/** Start pose used by the whole chapter. */
const START: [number, number, number] = [1, 2, 0];

const world = (o: { room?: number; start?: [number, number, number]; goal?: [number, number] } = {}): Stimulus[] => {
  const s = o.start ?? START;
  return [
    // No two motors are alike: the right one gives 12 % less speed for the same duty cycle.
    { at: 0, set: "MOTOR_RIGHT_GAIN", value: RIGHT_GAIN },
    { at: 0, set: "LIDAR_ROOM", value: o.room ?? ROOM },
    { at: 0, set: "ROBOT_START_X_FT", value: s[0] },
    { at: 0, set: "ROBOT_START_Y_FT", value: s[1] },
    { at: 0, set: "ROBOT_START_THETA_RAD", value: s[2] },
    ...(o.goal
      ? [
          { at: 0, set: "ROBOT_GOAL_X_FT", value: o.goal[0] },
          { at: 0, set: "ROBOT_GOAL_Y_FT", value: o.goal[1] },
        ]
      : []),
    { at: 0.01, set: "ROBOT_WORLD", value: 1 },
  ];
};

/** One foot per second at the wheel, in rad/s (the course's 1.235 inch wheel radius). */
const RADPS_PER_FTPS = 12 / 1.235;

const stopped = (at?: number): Check[] => [
  { kind: "signal", name: "LEFT_WHEEL_RADPS", at, equals: 0, tol: 0.05, label: "The left wheel has stopped", hint: "Stopped means an effort of 0 (50 % duty), or a speed command of 0 once the controller is in." },
  { kind: "signal", name: "RIGHT_WHEEL_RADPS", at, equals: 0, tol: 0.05, label: "The right wheel has stopped" },
];
const NO_CRASH: Check = { kind: "signal", name: "ROBOT_CRASHED", equals: 0, label: "The robot never touched a wall", hint: "The robot is a disc 0.35 ft in radius. Look at Robot x and Robot y at the moment it stopped to see which wall it met." };

// ---------- program text ----------

/** One motor PWM channel as SE423Lib.c sets it up (chapter 10). */
const motorPwm = (n: number) => `    EPwm${n}Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm${n}Regs.TBCTL.bit.FREE_SOFT = 3;   // free run
    EPwm${n}Regs.TBCTL.bit.CLKDIV = 0;      // divide by 1
    EPwm${n}Regs.TBCTL.bit.PHSEN = 0;
    EPwm${n}Regs.TBCTR = 0;
    EPwm${n}Regs.TBPRD = 2500;              // 50 MHz / 2500 = 20 kHz
    EPwm${n}Regs.CMPA.bit.CMPA = 1250;      // 50 %: motor stopped
    EPwm${n}Regs.AQCTLA.bit.CAU = 1;        // clear at the compare match
    EPwm${n}Regs.AQCTLA.bit.ZRO = 2;        // set at zero
    EPwm${n}Regs.TBPHS.bit.TBPHS = 0;`;

const setEpwm = (n: number) => `void setEPWM${n}A(float controleffort)
{
    if (controleffort < -10) {
        controleffort = -10;
    }
    if (controleffort > 10) {
        controleffort = 10;
    }
    uint16_t period = EPwm${n}Regs.TBPRD;
    float value = (controleffort + 10) * period / 20.0;
    EPwm${n}Regs.CMPA.bit.CMPA = value;
}`;

const INIT_PWM = `// Motor PWM (chapter 10, Lab 3): EPWM1A on GPIO0 is the left motor,
// EPWM2A on GPIO2 the right motor. 20 kHz, 50 % duty is stopped.
void init_EPWM1and2(void)
{
${motorPwm(1)}

${motorPwm(2)}

    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1;   // pull-ups off on the PWM pins
    GpioCtrlRegs.GPAPUD.bit.GPIO2 = 1;
    EDIS;

    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);  // EPWM1A
    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);  // EPWM2A
}`;

/** One block of init_eQEPs(), as in Lab 3 (chapter 11). */
const qep = (n: number, a: number, b: number, port: "A" | "B", mux: number) => `    // eQEP${n}: GPIO${a} is EQEP${n}A, GPIO${b} is EQEP${n}B
    EALLOW;
    GpioCtrlRegs.GP${port}PUD.bit.GPIO${a} = 1;      // pull-ups off
    GpioCtrlRegs.GP${port}PUD.bit.GPIO${b} = 1;
    GpioCtrlRegs.GP${port}QSEL2.bit.GPIO${a} = 2;    // qualify with 6 samples
    GpioCtrlRegs.GP${port}QSEL2.bit.GPIO${b} = 2;
    EDIS;
    GPIO_SetupPinMux(${a}, GPIO_MUX_CPU1, ${mux});
    GPIO_SetupPinMux(${b}, GPIO_MUX_CPU1, ${mux});
    EQep${n}Regs.QEPCTL.bit.QPEN = 0;       // hold the counter in reset
    EQep${n}Regs.QDECCTL.bit.QSRC = 0;      // quadrature count mode
    EQep${n}Regs.QPOSCTL.all = 0x0;         // no position compare
    EQep${n}Regs.QCAPCTL.all = 0x0;         // no capture
    EQep${n}Regs.QEINT.all = 0x0;           // no eQEP interrupts
    EQep${n}Regs.QPOSMAX = 0xFFFFFFFF;      // use all 32 bits
    EQep${n}Regs.QEPCTL.bit.FREE_SOFT = 2;
    EQep${n}Regs.QPOSCNT = 0;
    EQep${n}Regs.QEPCTL.bit.QPEN = 1;       // count`;

const INIT_QEP = `// Encoder counters (chapter 11, Lab 3): eQEP1 is the left wheel, eQEP2 the
// right wheel. 40000 counts per turn of a wheel.
void init_eQEPs(void)
{
${qep(1, 20, 21, "A", 1)}

${qep(2, 54, 55, "B", 5)}
}`;

const READ_ENC = `// Wheel angles in radians (chapter 11). The left encoder counts down when
// the robot drives forward, so its factor is negative.
float readEncLeft(void)
{
    int32_t raw = 0;
    raw = EQep1Regs.QPOSCNT;
    return (raw*(-2*PI/(2000.0*20.0)));
}

float readEncRight(void)
{
    int32_t raw = 0;
    raw = EQep2Regs.QPOSCNT;
    return (raw*(2*PI/(2000.0*20.0)));
}`;

const LIDAR_FNS = (first: number, last: number) => `// Runs every 100 ms: look ahead (chapter 17)
__interrupt void cpu_timer1_isr(void)
{
    // Points ${first} to ${last} of the scan: straight ahead, 20 degrees to each side
    front_ft = min_ft(${first}, ${last});
    numScans++;
}

// Smallest reading, in feet, of points first to last (chapter 17)
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

/** The real sensor path of chapter 17: ask over SCIC, parse the reply character by character. */
const SERIAL_GLOBALS = `
// LIDAR over SCIC (chapter 17)
char G_command[] = "G04472503\\n";   // distances from -120 to 120 degrees
uint16_t G_len = 10;
uint16_t read_ladar_state = 0;  // 0: wait for 'G', 1: header, 2: data
uint16_t G_count = 0;           // characters of the header so far
uint16_t LF_count = 0;          // line feeds in a row
uint16_t get_dis_first = 1;     // 1: the next character starts a pair
uint16_t tempscid = 0;          // top 6 bits, already shifted up
uint16_t distance = 0;
uint16_t dis_index = 0;         // which point comes next
float ladar_ft[228];            // the last complete scan, ft
float front_ft = 19.0;          // nearest thing ahead, ft
uint32_t numScans = 0;          // complete scans received
uint16_t newScan = 0;           // 1: a complete scan waits for the main loop`;

const SERIAL_FNS = (first: number, last: number) => `// Runs every 100 ms: ask the LIDAR for a scan (chapter 17)
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
}

// Called from the main loop when a reply is complete: the nearest thing
// ahead, points ${first} to ${last}, 20 degrees to each side
void look_ahead(void)
{
    int i;
    float m = 19.0;   // more than the largest reading
    for (i = ${first}; i <= ${last}; i++) {
        if (ladar_ft[i] < m) {
            m = ladar_ft[i];
        }
    }
    front_ft = m;
    numScans++;
}

// Runs each time a character arrives from the LIDAR (chapter 17, F28379dSerial.c)
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
            if (G_count == 11) {
                // the 11th character is the status: anything but '0' is an error
                if (RXCdata != '0') {
                    read_ladar_state = 0;
                }
            }
            if (G_count >= 12) {
                // there are 12 characters before the data
                read_ladar_state = 2;
                get_dis_first = 1;
                dis_index = 0;
            }
        } else if (read_ladar_state == 2) {
            if (RXCdata == 0x0a) {
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
                    if (distance == 0 || distance == 6) {
                        // error code: set to the max reading
                        distance = LADAR_MAX_READING;
                    }
                    if (dis_index < 228) {
                        ladar_ft[dis_index] = distance*0.00328084;
                    }
                    dis_index += 1;
                    get_dis_first = 1;
                }
            }
            if (LF_count == 2) {
                // two line feeds in a row: the reply is complete, tell main
                read_ladar_state = 0;
                newScan = 1;
            }
        }
    }
    ScicRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}`;

/** Lecture 11's anti-windup for one wheel (chapter 16). */
const clampedPI = (w: "Left" | "Right") => `    INew = I${w} + e${w} * 0.001;
    u${w} = Kp * e${w} + Ki * INew;
    if (u${w} > 10.0) {
        u${w} = 10.0;
        if (e${w} < 0.0) I${w} = INew;
    } else if (u${w} < -10.0) {
        u${w} = -10.0;
        if (e${w} > 0.0) I${w} = INew;
    } else {
        I${w} = INew;
    }`;

const MEASURE = `    // ---- Measure: wheel angles, speeds, distance (chapter 11) ----
    LeftWheel = readEncLeft();
    RightWheel = readEncRight();
    vLeft = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;
    vRight = (1.235/12.0) * (RightWheel - RightWheel_1) / 0.001;
    LeftWheel_1 = LeftWheel;
    RightWheel_1 = RightWheel;
    travel = 0.5 * (LeftWheel + RightWheel) * (1.235/12.0);`;

const HEADING = `    // ---- Estimate: heading from the difference of the wheels (chapter 18) ----
    theta = theta0 + (RightWheel - LeftWheel) * (1.235/12.0) / WHEEL_BASE;`;

const POSE = `    // ---- Estimate: dead reckoning (chapter 18) ----
    theta = theta0 + (RightWheel - LeftWheel) * (1.235/12.0) / WHEEL_BASE;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;`;

const GOAL_GEOMETRY = `    // Where is the goal from here: distance and heading error
    dist = sqrt((xGoal - x) * (xGoal - x) + (yGoal - y) * (yGoal - y));
    eTheta = atan2(yGoal - y, xGoal - x) - theta;
    while (eTheta > PI) eTheta = eTheta - 2.0 * PI;
    while (eTheta < -PI) eTheta = eTheta + 2.0 * PI;`;

/** Stage 6 on: the interrupt keeps the heading and asks the main loop for the rest. */
const HEADING_AND_FLAG = `    // ---- Estimate: the heading here (chapter 18); x, y and the goal in navigate() ----
    theta = theta0 + (RightWheel - LeftWheel) * (1.235/12.0) / WHEEL_BASE;
    navFlag = 1;`;

const NAVIGATE = `// Called from the main loop after every pass of the 1 ms interrupt: the slow
// maths. cos, sin and atan2 take about 1 microsecond each.
void navigate(void)
{
    // Dead reckoning (chapter 18)
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

${GOAL_GEOMETRY}
}`;

const CONTROL_PI = `    // ---- Control: one PI loop per wheel, with anti-windup (chapter 16) ----
    eLeft = vref - vLeft;
    eRight = vref - vRight;
${clampedPI("Left")}
${clampedPI("Right")}`;

const CONTROL_STEER = `    // ---- Control: steering coupling, then one PI loop per wheel (chapter 16) ----
    eSteer = vRight - vLeft + turn;
    eLeft = vref - vLeft + Kturn * eSteer;
    eRight = vref - vRight - Kturn * eSteer;
${clampedPI("Left")}
${clampedPI("Right")}`;

const ACT = `    // ---- Act: efforts to the motors; the right motor is mirrored (chapter 10) ----
    setEPWM1A(uLeft);
    setEPWM2A(-uRight);`;

/** What changes between programs of the same stage. */
interface Opts {
  /** The "Decide" section of the 1 ms interrupt. */
  mission: string;
  /** Start pose and goal written into the globals (stages 4 and up). */
  start?: [number, number, number];
  goal?: [number, number];
  /** Extra global lines of the mission. */
  globals?: string;
  /** Gains. */
  kp?: number;
  ki?: number;
  /** Read the LIDAR through its serial port instead of tb_lidar_ft (expert level). */
  serial?: boolean;
  /** Another 100 ms interrupt and min_ft() than LIDAR_FNS (the terrain levels look sideways too). */
  lidarFns?: string;
}

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : `${+v.toFixed(8)}`);

/**
 * The program after stage n:
 * 1 motors, 2 encoders, 3 PI speed control, 4 steering and heading,
 * 5 dead reckoning and the goal (all in the 1 ms interrupt),
 * 6 the same with the slow maths moved to the main loop, 7 LIDAR.
 */
function program(n: number, o: Opts): string {
  const s = o.start ?? START;
  const g = o.goal ?? [5, 5];
  const out: string[] = [];
  const add = (cond: boolean, text: string) => {
    if (cond) out.push(text);
  };
  add(true, `#define LAUNCHPAD_CPU_FREQUENCY 200
#define PI          3.1415926535897932384626433832795`);
  add(n >= 4, `#define WHEEL_BASE  0.6     // distance between the wheels, ft`);
  add(true, `
__interrupt void cpu_timer0_isr(void);`);
  add(n >= 7, `__interrupt void cpu_timer1_isr(void);`);
  add(true, `void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);
void init_eQEPs(void);`);
  add(n >= 2, `float readEncLeft(void);
float readEncRight(void);`);
  add(n >= 6, `void navigate(void);`);
  add(n >= 7 && !o.serial, `float min_ft(int first, int last);`);
  add(n >= 7 && !!o.serial, `void look_ahead(void);`);
  add(true, `
uint32_t numTimer0calls = 0;   // counts the 1 ms interrupts

// Motors (chapter 10): control efforts, -10 to 10
float uLeft = 0;
float uRight = 0;`);
  add(n >= 2, `
// Encoders (chapter 11)
float LeftWheel = 0;      // wheel angles, rad
float RightWheel = 0;
float LeftWheel_1 = 0;    // wheel angles 1 ms ago
float RightWheel_1 = 0;
float vLeft = 0;          // wheel speeds, ft/s
float vRight = 0;
float travel = 0;         // distance driven, ft (average of the two wheels)`);
  add(n >= 3, `
// Speed control (chapter 16)
float vref = 0;           // speed command, ft/s
float Kp = ${f(o.kp ?? 5)};
float Ki = ${f(o.ki ?? 100)};
float eLeft = 0;          // wheel speed errors
float eRight = 0;
float ILeft = 0;          // integrals of the errors
float IRight = 0;
float INew = 0;           // tentative integral (anti-windup)`);
  add(n >= 4, `
// Steering (chapter 16) and heading (chapter 18)
float turn = 0;           // turn command, ft/s: positive turns right
float Kturn = 3.0;
float eSteer = 0;
float theta0 = ${f(s[2])};       // heading at the start, rad
float theta = ${f(s[2])};        // heading now, rad: positive is counter-clockwise`);
  add(n >= 5, `
// Dead reckoning (chapter 18): the pose in the room's coordinates, ft
float x = ${f(s[0])};
float y = ${f(s[1])};
float xGoal = ${f(g[0])};
float yGoal = ${f(g[1])};
float dist = 0;           // distance to the goal, ft
float eTheta = 0;         // heading error towards the goal, rad`);
  add(n >= 6, `
// Hand-off to the main loop (chapter 5)
uint16_t navFlag = 0;     // 1: the interrupt has new speeds, main must call navigate()`);
  add(n >= 7 && !!o.serial, SERIAL_GLOBALS);
  add(n >= 7 && !o.serial, `
// LIDAR (chapter 17)
float front_ft = 19.0;    // nearest thing ahead, ft
uint32_t numScans = 0;`);
  add(!!o.globals, `
${o.globals}`);
  add(true, `
void main(void)
{
    InitSysCtrl();
    InitGpio();

    init_EPWM1and2();`);
  add(n >= 2, `    init_eQEPs();`);
  add(true, `
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;`);
  add(n >= 7, `    PieVectTable.TIMER1_INT = &cpu_timer1_isr;`);
  add(n >= 7 && !!o.serial, `    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;`);
  add(true, `    EDIS;

    // Timer 0 interrupts every 1 ms (1000 microseconds): the control loop
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;`);
  add(n >= 7, `    // Timer 1 interrupts every 100 ms: the LIDAR
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;`);
  add(n >= 7 && !!o.serial, `
    // The LIDAR is on SCIC, 115200 baud
    init_serialSCIC(&SerialC, 115200);`);
  add(true, `
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;`);
  add(n >= 7 && !!o.serial, `    IER |= M_INT8;   // SCIC`);
  add(n >= 7, `    IER |= M_INT13;  // CPU Timer 1`);
  add(n >= 6, `
    // dist and eTheta must be right before the first interrupt uses them
    navigate();`);
  add(true, `    EINT;
    ERTM;

    while (1) {`);
  add(n >= 6, `        // The slow maths waits here until the 1 ms interrupt asks for it
        if (navFlag == 1) {
            navFlag = 0;
            navigate();
        }`);
  add(n >= 7 && !!o.serial, `        // A complete scan waits here until the receive interrupt has it
        if (newScan == 1) {
            newScan = 0;
            look_ahead();
        }`);
  add(true, `    }
}

// Runs every 1 ms: measure, estimate, decide, control, act
__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
`);
  add(n >= 2, `${MEASURE}
`);
  add(n === 4, `${HEADING}
`);
  add(n === 5, `${POSE}
`);
  add(n >= 6, `${HEADING_AND_FLAG}
`);
  add(true, `    // ---- Decide: the mission ----
${o.mission.replace(/^\n+|\s+$/g, "")}
`);
  add(n === 3, `${CONTROL_PI}
`);
  add(n >= 4, `${CONTROL_STEER}
`);
  add(true, `${ACT}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`);
  add(n >= 6, `${NAVIGATE}
`);
  add(n >= 7, `${o.lidarFns ?? (o.serial ? SERIAL_FNS : LIDAR_FNS)(94, 132)}
`);
  add(true, `${INIT_PWM}

${setEpwm(1)}

${setEpwm(2)}

${INIT_QEP}`);
  add(n >= 2, `
${READ_ENC}`);
  return `${out.join("\n")}\n`;
}

/**
 * Inserts comment lines into a program: each entry puts `todo` after the
 * first line that contains `after` (or before the line containing `before`).
 * Every inserted line must start with "// TODO" so the chain test can strip
 * it again.
 */
function withTodos(source: string, todos: { after?: string; before?: string; todo: string }[]): string {
  const lines = source.split("\n");
  for (const t of todos) {
    const key = (t.after ?? t.before)!;
    const i = lines.findIndex((l) => l.includes(key));
    if (i < 0) throw new Error(`capstone: no line contains "${key}"`);
    const indent = /^\s*/.exec(lines[i])![0];
    const add = t.todo.split("\n").map((l) => {
      if (!l.startsWith("// TODO")) throw new Error(`capstone: "${l}" is not a TODO comment`);
      return (t.after && /[{]\s*$/.test(lines[i]) ? `${indent}    ` : indent) + l;
    });
    lines.splice(t.after ? i + 1 : i, 0, ...add);
  }
  return lines.join("\n");
}

// ---------- the missions ----------

// Stage 1: open loop.
const M_OPEN = `
    // Open loop: effort 5 for 1.43 s, then stop
    if (numTimer0calls <= 1430) {
        uLeft = 5.0;
        uRight = 5.0;
    } else {
        uLeft = 0.0;
        uRight = 0.0;
    }`;

// Stage 2: stop after 3 ft of measured travel.
const M_DIST = `
    // Drive 3 ft by the encoders: fast, then slowly up to the line, then stop
    if (travel < 2.6) {
        uLeft = 5.0;
        uRight = 5.0;
    } else if (travel < 2.99) {
        uLeft = 1.5;
        uRight = 1.5;
    } else {
        uLeft = 0.0;
        uRight = 0.0;
    }`;

// Stage 3: PI speed control.
const M_SPEED = `
    // 0.7 s at a speed the robot cannot reach, then 1 ft/s
    if (numTimer0calls <= 700) {
        vref = 4.0;
    } else {
        vref = 1.0;
    }`;

// Stage 4: straight, then a quarter turn to the left.
const G_STATE = `// The mission
uint16_t state = 0;`;
const M_TURN = `
    switch (state) {
    case 0:
        // straight for 3 ft
        vref = 1.0;
        turn = 0.0;
        if (travel >= 3.0) {
            state = 1;
        }
        break;
    case 1:
        // turn left on the spot until the heading is 90 degrees
        vref = 0.0;
        turn = -2.0 * (PI/2.0 - theta);
        if (turn < -1.0) turn = -1.0;
        if (turn > 1.0) turn = 1.0;
        if (fabs(PI/2.0 - theta) < 0.02) {
            state = 2;
        }
        break;
    default:
        // done
        vref = 0.0;
        turn = 0.0;
        break;
    }`;

const STEER_TO_GOAL = `        turn = -2.0 * eTheta;
        if (turn > 1.0) turn = 1.0;
        if (turn < -1.0) turn = -1.0;`;

// Stage 5: go to the goal.
const GOTO_SWITCH = `
    switch (state) {
    case 0:
        // FACE: turn on the spot towards the goal
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.05) {
            state = 1;
        }
        break;
    case 1:
        // DRIVE: steer at the goal, slow down close to it
        vref = 2.0 * dist;
        if (vref > 1.5) vref = 1.5;
${STEER_TO_GOAL}
        if (dist < 0.05) {
            state = 2;
        }
        break;
    default:
        // DONE
        vref = 0.0;
        turn = 0.0;
        break;
    }`;
const M_GOTO = `
${GOAL_GEOMETRY}
${GOTO_SWITCH}`;
// Stage 6: the same mission; dist and eTheta now come from navigate().
const M_LEAN = GOTO_SWITCH;

// Stage 7: the same, but stop when the LIDAR sees something close ahead.
const M_WALL = `
    switch (state) {
    case 0:
        // FACE: turn on the spot towards the goal
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.05) {
            state = 1;
        }
        break;
    case 1:
        // DRIVE: steer at the goal, slow down close to it
        vref = 2.0 * dist;
        if (vref > 1.5) vref = 1.5;
${STEER_TO_GOAL}
        if (dist < 0.05) {
            state = 2;
        } else if (front_ft < 1.2 && front_ft < dist) {
            // something is in the way, and it is nearer than the goal
            state = 3;
        }
        break;
    case 3:
        // BLOCKED: wait
        vref = 0.0;
        turn = 0.0;
        break;
    default:
        // DONE
        vref = 0.0;
        turn = 0.0;
        break;
    }`;

// Checkpoint: go around what is in the way.
const G_FINAL = `${G_STATE}
float passStart = 0;      // travel when the robot began to pass the obstacle, ft`;
const mFinal = (o: { vmax?: number; pass?: number; blocked?: number; clear?: number; vpass?: number } = {}) => `
    switch (state) {
    case 0:
        // FACE: turn on the spot towards the goal
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.05) {
            state = 1;
        }
        break;
    case 1:
        // DRIVE: steer at the goal, slow down close to it
        vref = 2.0 * dist;
        if (vref > ${f(o.vmax ?? 1.5)}) vref = ${f(o.vmax ?? 1.5)};
${STEER_TO_GOAL}
        if (dist < 0.05) {
            state = 2;
        } else if (front_ft < ${f(o.blocked ?? 1.2)} && front_ft < dist) {
            // something is in the way, and it is nearer than the goal
            state = 3;
        }
        break;
    case 3:
        // TURN: left on the spot until the way ahead is clear
        vref = 0.0;
        turn = -1.0;
        if (front_ft > ${f(o.clear ?? 2.5)}) {
            state = 4;
            passStart = travel;
        }
        break;
    case 4:
        // PASS: straight ahead until the obstacle is behind
        vref = ${f(o.vpass ?? 1)};
        turn = 0.0;
        if (front_ft < ${f(o.blocked ?? 1.2)}) {
            state = 3;
        } else if (travel - passStart > ${f(o.pass ?? 2)}) {
            state = 0;
        }
        break;
    default:
        // DONE
        vref = 0.0;
        turn = 0.0;
        break;
    }`;

// Expert: four corners of a square, then back to the starting heading.
const G_SQUARE = `${G_STATE}
float wpX[4] = {4.0, 4.0, 1.0, 1.0};   // the corners, in the order they are visited
float wpY[4] = {2.0, 5.0, 5.0, 2.0};
uint16_t corner = 0;      // corners reached so far
float eHome = 0;          // heading error towards the starting heading, rad`;
const mSquare = (vmax: number) => `
    switch (state) {
    case 0:
        // FACE: turn on the spot towards the next corner
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.05) {
            state = 1;
        }
        break;
    case 1:
        // DRIVE: steer at the corner, slow down close to it
        vref = 2.0 * dist;
        if (vref > ${f(vmax)}) vref = ${f(vmax)};
${STEER_TO_GOAL}
        if (dist < 0.03) {
            corner++;
            if (corner < 4) {
                // the next corner is the goal: navigate() works out dist and
                // eTheta for it before the next pass
                xGoal = wpX[corner];
                yGoal = wpY[corner];
                state = 0;
            } else {
                state = 5;
            }
        } else if (front_ft < 1.2 && front_ft < dist) {
            state = 3;
        }
        break;
    case 3:
        // BLOCKED: wait
        vref = 0.0;
        turn = 0.0;
        break;
    case 5:
        // HOME: turn back to the heading the robot started with
        eHome = theta0 - theta;
        while (eHome > PI) eHome = eHome - 2.0 * PI;
        while (eHome < -PI) eHome = eHome + 2.0 * PI;
        vref = 0.0;
        turn = -2.0 * eHome;
        if (turn > 1.0) turn = 1.0;
        if (turn < -1.0) turn = -1.0;
        if (fabs(eHome) < 0.02) {
            state = 2;
        }
        break;
    default:
        // DONE
        vref = 0.0;
        turn = 0.0;
        break;
    }`;

// ---------- the programs of the levels ----------

const GOAL_GOTO: [number, number] = [4, 5];
const GOAL_WALL: [number, number] = [12, 2];
const GOAL_FINAL: [number, number] = [9, 7.6];

const S_OPEN = program(1, { mission: M_OPEN });
const S_DIST = program(2, { mission: M_DIST });
const S_SPEED = program(3, { mission: M_SPEED });
const S_STEER = program(4, { mission: M_TURN, globals: G_STATE });
const S_GOTO = program(5, { mission: M_GOTO, globals: G_STATE, goal: GOAL_GOTO });
const S_LEAN = program(6, { mission: M_LEAN, globals: G_STATE, goal: GOAL_GOTO });
const S_WALL = program(7, { mission: M_WALL, globals: G_STATE, goal: GOAL_WALL });
const S_FINAL = program(7, { mission: mFinal(), globals: G_FINAL, goal: GOAL_FINAL });

// Practice: other places.
const CORNER = { start: [8.8, 9, Math.PI] as [number, number, number], goal: [6.5, 4.5] as [number, number] };
const DOOR = { room: 4, start: [8.5, 2, Math.PI / 2] as [number, number, number], goal: [12, 7.25] as [number, number] };
const S_CORNER = program(7, { mission: mFinal(), globals: G_FINAL, ...CORNER });
const S_DOOR = program(7, { mission: mFinal(), globals: G_FINAL, start: DOOR.start, goal: DOOR.goal });

// Expert.
const S_FAST = program(7, { mission: mFinal({ vmax: 3, blocked: 1.5, vpass: 2 }), globals: G_FINAL, goal: GOAL_FINAL });
const S_SERIAL = program(7, { mission: mFinal(), globals: G_FINAL, goal: GOAL_FINAL, serial: true });
const S_SQUARE = program(7, { mission: mSquare(2.5), globals: G_SQUARE, goal: [4, 2] });

// ---------- terrains: two trips, the second one back through a changed world ----------

/** Second trip: DONE waits until `ms`, then the place the robot started from becomes the goal. */
const secondTrip = (ms: number, home: [number, number], first = 0) => `    default:
        // DONE: stand still. At ${ms / 1000} s the second trip begins: back to the start
        vref = 0.0;
        turn = 0.0;
        if (trip == 0 && numTimer0calls >= ${ms}) {
            trip = 1;
            xGoal = ${f(home[0])};
            yGoal = ${f(home[1])};
            state = ${first};
        }
        break;
    }`;

const G_TRIP = `uint16_t trip = 0;        // 0: the way out, 1: the way back`;

// Practice: the slalom. The checkpoint's five states, with numbers that fit posts.
const SLALOM = { start: [1, 3, 0] as [number, number, number], goal: [11, 3] as [number, number], swapMs: 12500 };
const G_SLALOM = `${G_FINAL}
${G_TRIP}`;
const DONE_CASE = `    default:
        // DONE
        vref = 0.0;
        turn = 0.0;
        break;
    }`;
const M_SLALOM = blank(mFinal({ vpass: 1.5 }), [[DONE_CASE, secondTrip(SLALOM.swapMs, [SLALOM.start[0], SLALOM.start[1]])]]);

/** The 100 ms interrupt of the terrain levels: ahead, to the right and (trap) towards the goal. */
const SIDE_FNS = (towardsGoal: boolean) => `// Runs every 100 ms: look ahead and to the right (chapter 17)
__interrupt void cpu_timer1_isr(void)
{
    // Points 94 to 132 of the scan: straight ahead, 20 degrees to each side
    front_ft = min_ft(94, 132);
    // Points 52 to 56: about 63 degrees to the right, the wall the robot follows
    right_ft = min_ft(52, 56);${
      towardsGoal
        ? `
    // The point that looks at the goal: point 113 is straight ahead and one
    // point is 1.0547 degrees, so 54.3 points per radian of heading error
    goalPoint = 113 + (int)(54.3 * eTheta);
    if (goalPoint >= 10 && goalPoint <= 217) {
        goal_ft = min_ft(goalPoint - 10, goalPoint + 10);
    } else {
        goal_ft = 0.0;   // the goal is behind the robot: the LIDAR cannot see that way
    }`
        : ""
    }
    numScans++;
}

// Smallest reading, in feet, of points first to last (chapter 17)
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

/** FOLLOW: the course's right wall follower (chapter 17), as one state. */
const followWall = (o: { v: number; ref: number; k: number; sat: number }) => `        vref = ${f(o.v)};
        turn = ${f(o.k)} * (right_ft - ${f(o.ref)});
        if (turn > ${f(o.sat)}) turn = ${f(o.sat)};
        if (turn < -${f(o.sat)}) turn = -${f(o.sat)};`;

// Expert: the U-shaped dead end. Bug style: follow the wall, leave when nearer than at the hit.
const TRAP = { start: [1.5, 5, 0] as [number, number, number], goal: [8.5, 5] as [number, number], swapMs: 13000 };
const TRAP_FOLLOW = { v: 1.5, ref: 1.1, k: 2.0, sat: 1.0 };
const G_TRAP = `${G_STATE}
float right_ft = 19.0;    // the wall on the right, ft (63 degrees to the right)
float goal_ft = 0.0;      // free floor in the direction of the goal, ft
int16_t goalPoint = 113;  // the point of the scan that looks at the goal
float dHit = 0;           // distance to the goal when the robot met the obstacle, ft
${G_TRIP}`;
const mTrap = (o: { leave?: string } = {}) => `
    switch (state) {
    case 0:
        // FACE: turn on the spot towards the goal
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.05) {
            state = 1;
        }
        break;
    case 1:
        // DRIVE: steer at the goal, slow down close to it
        vref = 2.0 * dist;
        if (vref > 1.5) vref = 1.5;
${STEER_TO_GOAL}
        if (dist < 0.05) {
            state = 2;
        } else if (front_ft < 1.2 && front_ft < dist) {
            // HIT: something is in the way. Remember how far the goal was
            dHit = dist;
            state = 3;
        }
        break;
    case 3:
        // TURN: left on the spot until the way ahead is clear
        vref = 0.0;
        turn = -1.5;
        if (front_ft > 2.0) {
            state = 4;
        }
        break;
    case 4:
        // FOLLOW: keep the obstacle on the right (chapter 17)
${followWall(TRAP_FOLLOW)}
        if (front_ft < 1.2) {
            state = 3;
        } else if (${o.leave ?? "dist < dHit - 0.5 && goal_ft > 2.0"}) {
            // LEAVE: nearer to the goal than at the hit, and free floor towards it
            state = 0;
        }
        break;
${secondTrip(TRAP.swapMs, [TRAP.start[0], TRAP.start[1]])}`;

// Expert: the maze. Follow the right wall until the robot is in the goal cell.
const MAZE = { size: 4, seedA: 43, seedB: 46, start: [1, 1, 0] as [number, number, number], goal: [7, 7] as [number, number], swapMs: 12000 };
const MAZE_FOLLOW = { v: 1.2, ref: 1.1, k: 2.0, sat: 0.7 };
const G_MAZE = `// The mission
uint16_t state = 4;       // the robot starts in FOLLOW
float right_ft = 19.0;    // the wall on the right, ft (63 degrees to the right)
${G_TRIP}`;
const mMaze = (o: { follow?: typeof MAZE_FOLLOW } = {}) => `
    switch (state) {
    case 3:
        // TURN: left on the spot until the way ahead is clear
        vref = 0.0;
        turn = -1.0;
        if (front_ft > 2.0) {
            state = 4;
        }
        break;
    case 4:
        // FOLLOW: keep the wall on the right (chapter 17)
${followWall(o.follow ?? MAZE_FOLLOW)}
        if (dist < 0.5) {
            // in the goal cell
            state = 2;
        } else if (front_ft < 1.1) {
            state = 3;
        }
        break;
${secondTrip(MAZE.swapMs, [MAZE.start[0], MAZE.start[1]], 4)}`;

const S_SLALOM = program(7, { mission: M_SLALOM, globals: G_SLALOM, start: SLALOM.start, goal: SLALOM.goal });
const S_TRAP = program(7, { mission: mTrap(), globals: G_TRAP, start: TRAP.start, goal: TRAP.goal, lidarFns: SIDE_FNS(true) });
const S_MAZE = program(7, { mission: mMaze(), globals: G_MAZE, start: MAZE.start, goal: MAZE.goal, lidarFns: SIDE_FNS(false) });

/** Stimuli of a terrain level: world A, and at swapMs world B with the old start as the goal. */
const trips = (o: { kind: number; seeds: [number, number]; size?: number; start: [number, number, number]; goal: [number, number]; swapMs: number }): Stimulus[] => [
  { at: 0, set: "MOTOR_RIGHT_GAIN", value: RIGHT_GAIN },
  { at: 0, set: "WORLD_KIND", value: o.kind },
  { at: 0, set: "WORLD_SEED", value: o.seeds[0] },
  ...(o.size ? [{ at: 0, set: "WORLD_SIZE", value: o.size }] : []),
  { at: 0, set: "ROBOT_START_X_FT", value: o.start[0] },
  { at: 0, set: "ROBOT_START_Y_FT", value: o.start[1] },
  { at: 0, set: "ROBOT_START_THETA_RAD", value: o.start[2] },
  { at: 0, set: "ROBOT_GOAL_X_FT", value: o.goal[0] },
  { at: 0, set: "ROBOT_GOAL_Y_FT", value: o.goal[1] },
  { at: 0.01, set: "ROBOT_WORLD", value: 1 },
  // The second trip: the world changes and the goal is where the robot came from.
  { at: o.swapMs, set: "WORLD_SEED", value: o.seeds[1] },
  { at: o.swapMs, set: "ROBOT_GOAL_X_FT", value: o.start[0] },
  { at: o.swapMs, set: "ROBOT_GOAL_Y_FT", value: o.start[1] },
];

/** Replaces exact pieces of a program; every piece must be there. */
function blank(source: string, pieces: [string, string][]): string {
  let out = source;
  for (const [from, to] of pieces) {
    if (!out.includes(from)) throw new Error(`capstone: cannot blank "${from.slice(0, 40)}"`);
    out = out.replace(from, to);
  }
  return out;
}

// The first code level starts from a skeleton: the parts of chapter 10 with gaps.
const OPEN_STARTER = blank(S_OPEN, [
  [motorPwm(2), `    // TODO 1: set up EPWM2 for the right motor, exactly like EPWM1 above`],
  [`    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);  // EPWM2A`, `    // TODO 2: give GPIO2 to EPWM2A`],
  [
    setEpwm(2),
    `void setEPWM2A(float controleffort)
{
    // TODO 3: saturate to -10 ... 10, scale to 0 ... TBPRD, write CMPA of EPWM2

}`,
  ],
  [M_OPEN.replace(/^\n+|\s+$/g, ""), `    // TODO 4: set uLeft and uRight: effort 5 for the first part of the run, then 0`],
  [`    setEPWM2A(-uRight);`, `    // TODO 5: send uRight to the right motor. It is mounted mirrored`],
]);

const DIST_STARTER = withTodos(S_OPEN, [
  { after: "void init_eQEPs(void);", todo: "// TODO 1: prototypes of readEncLeft() and readEncRight()" },
  { after: "float uRight = 0;", todo: "// TODO 2: globals LeftWheel, RightWheel, LeftWheel_1, RightWheel_1, vLeft, vRight, travel" },
  { after: "    init_EPWM1and2();", todo: "// TODO 3: call init_eQEPs()" },
  { before: "// ---- Decide: the mission ----", todo: "// TODO 4: Measure. Read both wheel angles, compute vLeft, vRight (ft/s) and travel (ft)" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 5: new mission. Drive until travel reaches 3 ft, then stop (replace the lines below)" },
  { before: "// Encoder counters (chapter 11, Lab 3)", todo: "// TODO 6: write readEncLeft() and readEncRight() (here or at the end of the file)" },
]);

const SPEED_STARTER = withTodos(S_DIST, [
  { after: "float travel = 0;", todo: "// TODO 1: globals vref, Kp, Ki, eLeft, eRight, ILeft, IRight, INew" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 2: new mission. vref = 4.0 during the first 0.7 s, then 1.0 (replace the lines below)" },
  { before: "// ---- Act:", todo: "// TODO 3: Control. One PI loop per wheel with saturation and anti-windup sets uLeft and uRight" },
]);

const STEER_STARTER = withTodos(S_SPEED, [
  { after: "#define PI ", todo: "// TODO 1: #define WHEEL_BASE 0.6" },
  { after: "float INew = 0;", todo: "// TODO 2: globals turn, Kturn, eSteer, theta0, theta and state" },
  { before: "// ---- Decide: the mission ----", todo: "// TODO 3: Estimate. theta from the difference of the two wheel angles" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 4: new mission. 3 ft straight, then turn left on the spot to 90 degrees, then stop" },
  { after: "// ---- Control:", todo: "// TODO 5: steering error first. eLeft and eRight then include + and - Kturn * eSteer" },
]);

const GOTO_STARTER = withTodos(S_STEER, [
  { after: "float theta = ", todo: "// TODO 1: globals x, y (start at 1.0, 2.0), xGoal, yGoal (4.0, 5.0), dist, eTheta" },
  { after: "    theta = theta0 +", todo: "// TODO 2: dead reckoning. Add this millisecond's step to x and y" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 3: new mission. Face the goal, drive to it, stop (replace the switch below)" },
]);

const LEAN_STARTER = withTodos(S_GOTO, [
  { after: "void init_eQEPs(void);", todo: "// TODO 1: prototype of navigate()" },
  { after: "float eTheta = 0;", todo: "// TODO 2: a global flag, uint16_t navFlag = 0;" },
  { before: "    EINT;", todo: "// TODO 5: call navigate() once here, before the first interrupt" },
  { after: "    while (1) {", todo: "// TODO 4: when navFlag is 1, set it back to 0 and call navigate()" },
  { after: "    theta = theta0 +", todo: "// TODO 1: move the two lines below (x and y) into navigate()\n// TODO 3: here, only raise the flag: navFlag = 1;" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 1: move the four lines for dist and eTheta into navigate() as well" },
  { before: "// Motor PWM (chapter 10, Lab 3)", todo: "// TODO 1: write void navigate(void) here, with the six lines you moved" },
]);

const WALL_STARTER = withTodos(S_LEAN, [
  { after: "__interrupt void cpu_timer0_isr(void);", todo: "// TODO 1: prototypes of cpu_timer1_isr() and min_ft()" },
  { after: "uint16_t navFlag = 0;", todo: "// TODO 2: globals front_ft (start at 19.0) and numScans. Set the goal to (12.0, 2.0)" },
  { after: "    PieVectTable.TIMER0_INT = &cpu_timer0_isr;", todo: "// TODO 3: the vector of timer 1" },
  { after: "    CpuTimer0Regs.TCR.all = 0x4000;", todo: "// TODO 4: timer 1 every 100 ms (100000 microseconds), and start it" },
  { after: "    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;", todo: "// TODO 5: enable CPU interrupt 13 (timer 1)" },
  { before: "        if (dist < 0.05) {", todo: "// TODO 6: in DRIVE, go to a new state BLOCKED (stand still) when front_ft < 1.2" },
  { before: "// Motor PWM (chapter 10, Lab 3)", todo: "// TODO 7: write cpu_timer1_isr() (front_ft = min_ft(94, 132)) and min_ft()" },
]);

const FINAL_STARTER = withTodos(S_WALL, [
  { after: "uint16_t state = 0;", todo: "// TODO 1: a global passStart. Set the goal to (9.0, 7.6)" },
  { before: "    case 3:", todo: "// TODO 2: BLOCKED becomes TURN: turn left on the spot until front_ft > 2.5, then PASS" },
  { before: "    default:", todo: "// TODO 3: a new state PASS: straight for 2 ft, then back to FACE. Blocked again: TURN" },
]);

const CORNER_STARTER = withTodos(S_FINAL, [
  { before: "float theta0 = ", todo: "// TODO 1: the robot now starts at (8.8, 9.0) with heading PI" },
  { before: "float xGoal = ", todo: "// TODO 2: the goal is (6.5, 4.5)" },
]);

const DOOR_STARTER = withTodos(S_FINAL, [
  { before: "float theta0 = ", todo: "// TODO 1: the robot now starts at (8.5, 2.0) with heading PI/2" },
  { before: "float xGoal = ", todo: "// TODO 2: the goal is (12.0, 7.25), outside the door" },
]);

const FAST_STARTER = withTodos(S_FINAL, [{ after: "// ---- Decide: the mission ----", todo: "// TODO: the same trip in 10 s. Find where the time goes first" }]);

const SERIAL_STARTER = withTodos(S_FINAL, [
  { after: "uint32_t numScans = 0;", todo: "// TODO 1: the G command, the parser's variables and float ladar_ft[228]" },
  { after: "    PieVectTable.TIMER1_INT = &cpu_timer1_isr;", todo: "// TODO 2: the vector of the SCIC receive interrupt" },
  { after: "    CpuTimer1Regs.TCR.all = 0x4000;", todo: "// TODO 3: init_serialSCIC at 115200 baud, and M_INT8 in IER" },
  { before: "// Runs every 100 ms: look ahead", todo: "// TODO 4: cpu_timer1_isr() now only sends the G command" },
  { before: "// Smallest reading, in feet", todo: "// TODO 5: RXCINT_recv_ready() fills ladar_ft[] and sets newScan when a reply is complete" },
  { after: "    while (1) {", todo: "// TODO 6: when newScan is 1, set it back to 0 and compute front_ft from ladar_ft[]" },
]);

const SQUARE_STARTER = withTodos(S_FINAL, [
  { after: "float passStart = 0;", todo: "// TODO 1: the four corners, and a global corner that counts the corners reached" },
  { before: "float xGoal = ", todo: "// TODO 2: the first goal is the first corner, (4.0, 2.0)" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 3: new mission. Visit the corners in order, then turn back to the starting heading" },
]);

const SLALOM_STARTER = withTodos(S_FINAL, [
  { before: "float theta0 = ", todo: "// TODO 1: the hall. The robot starts at (1.0, 3.0), heading 0; the goal is (11.0, 3.0)" },
  { after: "float passStart = 0;", todo: "// TODO 2: a global uint16_t trip = 0;" },
  { before: "    case 4:", todo: "// TODO 4: PASS at 1.5 ft/s: at 1.0 ft/s the trips take too long" },
  { before: "    default:", todo: "// TODO 3: DONE starts the second trip at 12.5 s: trip = 1, goal (1.0, 3.0), state = 0" },
]);

const TRAP_STARTER = withTodos(S_FINAL, [
  { before: "float theta0 = ", todo: "// TODO 1: the robot starts at (1.5, 5.0), heading 0; the goal is (8.5, 5.0)" },
  { after: "uint32_t numScans = 0;", todo: "// TODO 2: globals right_ft, goal_ft, goalPoint (an int16_t), dHit and trip" },
  { before: "            // something is in the way, and it is nearer than the goal", todo: "// TODO 3: HIT. Remember dHit = dist" },
  { before: "    case 4:", todo: "// TODO 4: FOLLOW replaces PASS. Keep the wall on the right; leave it for FACE only when\n// TODO    dist < dHit - 0.5 and goal_ft > 2.0" },
  { before: "    default:", todo: "// TODO 5: DONE starts the second trip at 13 s: trip = 1, goal (1.5, 5.0), state = 0" },
  { before: "// Smallest reading, in feet", todo: "// TODO 6: cpu_timer1_isr() also works out right_ft (points 52 to 56) and goal_ft" },
]);

const MAZE_STARTER = withTodos(S_FINAL, [
  { before: "float theta0 = ", todo: "// TODO 1: the robot starts in the cell at (1.0, 1.0), heading 0; the goal cell is at (7.0, 7.0)" },
  { after: "uint16_t state = 0;", todo: "// TODO 2: the robot starts in FOLLOW. Globals right_ft and trip" },
  {
    after: "// ---- Decide: the mission ----",
    todo: "// TODO 3: new mission. FOLLOW the wall on the right, TURN left on the spot at a wall ahead,\n// TODO    DONE in the goal cell. At 12 s DONE starts the way back to (1.0, 1.0)",
  },
  { before: "// Smallest reading, in feet", todo: "// TODO 4: cpu_timer1_isr() also works out right_ft = min_ft(52, 56)" },
]);

// ---------- checks shared by the room levels ----------

const arrived = (hint?: string): Check[] => [
  { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.15, label: "The robot ends within 0.15 ft of the goal", hint },
  ...stopped(),
  NO_CRASH,
];

/** Checks of a terrain level: at the goal and standing just before the swap, back and standing at the end. */
const twoTrips = (o: { swapMs: number; there: string; back: string; hintThere: string; hintBack: string; hintLate: string; hintCrash: string; tol?: number }): Check[] => {
  const tol = o.tol ?? 0.15;
  return [
    { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: o.swapMs - 10, max: tol, label: `Trip 1: at ${o.swapMs / 1000} s the robot is within ${tol} ft of ${o.there}`, hint: o.hintThere },
    { kind: "signal", name: "LEFT_WHEEL_RADPS", at: o.swapMs - 10, equals: 0, tol: 0.05, label: "Trip 1: it stands still there", hint: o.hintLate },
    { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: tol, label: `Trip 2: the robot ends within ${tol} ft of ${o.back}`, hint: o.hintBack },
    { kind: "signal", name: "LEFT_WHEEL_RADPS", equals: 0, tol: 0.05, label: "Trip 2: it stands still at the end", hint: o.hintLate },
    { kind: "signal", name: "RIGHT_WHEEL_RADPS", equals: 0, tol: 0.05, label: "Trip 2: both wheels have stopped" },
    { kind: "signal", name: "ROBOT_CRASHED", equals: 0, label: "The robot never touched anything", hint: o.hintCrash },
  ];
};

const ISR_BUDGET: Check = {
  kind: "isr-time",
  fn: "cpu_timer0_isr",
  maxUs: 3.5,
  label: "No pass of cpu_timer0_isr takes more than 3.5 microseconds",
  hint: "About 6 us: cos, sin, atan2 or sqrt are still called inside cpu_timer0_isr, or navigate() is called from it. They belong in the main loop, behind navFlag. About 8 us: the 39 LIDAR points are read in the 1 ms loop. Do that in the 100 ms interrupt and let the 1 ms loop only use the result.",
};

/** Always true for a robot that drove forward: it is there so the student reads the number. */
const veered = (label: string, at?: number): Check => ({
  kind: "signal",
  name: "ROBOT_THETA_RAD",
  at,
  min: -1.5,
  max: 0.5,
  label,
  hint: "A heading this far from 0 means the robot went round in a circle instead of driving: one wheel is not driven forwards. Check that GPIO2 is given to EPWM2A and that the right motor gets setEPWM2A(-uRight).",
});

const ROOM_NOTE = `
**The room** is a 10 ft by 10 ft box with a 1 ft block at x = 7 to 8, y = 6 to 7. The robot is a disc 0.35 ft in radius. It starts at (1, 2), looking along +x. The meters "Robot x", "Robot y" and "Robot heading" show the truth. Your program never sees them: it has only its encoders and, later, the LIDAR.
`;

const MOTOR_NOTE = `
**The two motors are not alike.** For the same command the right motor gives 12 % less speed than the left one. That is normal: no two real motors match.
`;

export const ch21: Chapter = {
  id: "capstone",
  number: 21,
  title: "Capstone: drive the robot",
  blurb: "One program, grown level by level, until the robot drives itself across a room.",
  requires: ["actuators", "encoders", "control", "sensors"],
  course: ["Lab 5", "Lab 6", "Lab 7", "Project"],
  levels: [
    {
      id: "cap-brief",
      kind: "brief",
      title: "The robot is one program",
      goal: "See how the parts you built in earlier chapters fit into one loop, and what this chapter will make of them.",
      refs: [{ course: "L14", slide: [31, 33], note: "a fast inner loop and a slow outer loop" }, { course: "L11", slide: 20, note: "the Lab 5 control loop" }, { course: "Lab 5" }, { course: "Lab 6" }],
      brief: `
So far every chapter gave you one part of the robot and a test bench to try it on. On the real robot the parts run together, in one program, and each one feeds the next. This chapter builds that program. At the end the robot crosses a room on its own, around an obstacle, to a point you give it.

Nothing here is new hardware. Every part is something you wrote in an earlier chapter, and each level tells you which chapter and which level, so you can open your old solution next to it.

## Two loops
**Every 1 ms**, CPU timer 0 interrupts (chapter 5) and one function does five things, always in this order:

1. **Measure**: read the two encoders, the sensors that count how far each wheel has turned. Turn the counts into wheel angles, and the change since the last pass into wheel speeds in feet per second (chapter 11).
2. **Estimate**: work out which way the robot points and where it is, from what the wheels did. This is called dead reckoning, and this chapter teaches it from the start. The part of it that needs slow maths (\`cos\`, \`sin\`) is handed to the main loop with a flag (chapter 5), so that this function stays short.
3. **Decide**: a **state machine** (chapter 17: a variable that remembers what the robot is doing, and rules for when to change it) sets two numbers: the speed command \`vref\` and the turn command \`turn\`.
4. **Control**: a PI controller per wheel (chapter 16) compares the commanded speed with the measured speed and produces a **control effort** for each motor: a number from -10 (full power backwards) through 0 (stopped) to 10 (full power forwards). They are called \`uLeft\` and \`uRight\`.
5. **Act**: \`setEPWM1A\` and \`setEPWM2A\` (chapter 10) turn the efforts into PWM duty cycles, the motors turn, and the wheels move.

The wheels turn the encoders, and the next pass measures the result. That circle is the **feedback loop**.

**Every 100 ms**, CPU timer 1 interrupts and the program looks at the LIDAR, the laser sensor that measures the distance to the walls around the robot (chapter 17). It stores one number, the distance to the nearest thing ahead, for the Decide step to use.

## How this chapter works
- It is **one file**. Each level opens with your own code from the level before. If you skipped a level you get the reference version instead.
- Each level adds one part and says exactly where it goes.
- The **Decide** step is called "the mission" here. It is rewritten in almost every level. Everything else stays and grows.
- The tests watch what the **robot does**: where it ends, whether it stopped, whether it touched a wall. Where a test needs to read one of your variables, the brief gives its name.

Keep the file tidy. You will be reading it for the rest of the chapter.

## The plan
1. Motors: drive about 2 ft by timing alone.
2. Encoders: drive exactly 3 ft.
3. PI speed control: hold 1 ft/s.
4. Steering: drive straight, then turn 90 degrees.
5. Dead reckoning: drive to a point.
6. Timing: move the slow maths out of the 1 ms loop.
7. LIDAR: stop in front of a wall.
8. Checkpoint: drive to a point behind an obstacle.
${ROOM_NOTE}${MOTOR_NOTE}`,
      questions: [
        {
          prompt: "The motors are driven by one PWM signal each (chapter 10). Which duty cycle stops a motor?",
          options: ["0 %", "50 %", "100 %", "Any, as long as CMPA is 0"],
          answer: 1,
          why: "The PWM pin switches the motor between full voltage one way and full voltage the other way. At 50 % the two cancel and the average is zero. That is why setEPWM1A turns an effort of 0 into half of TBPRD.",
        },
        {
          prompt: "The course code calls setEPWM1A(uLeft); setEPWM2A(-uRight);. Why the minus sign?",
          options: [
            "The right encoder counts backwards",
            "The right motor is mounted mirrored, so the same voltage turns its wheel the other way",
            "EPWM2 counts down instead of up",
            "To make the robot turn",
          ],
          answer: 1,
          why: "The two motors face each other. The same voltage turns one wheel forwards and the other backwards. The sign is put at the call, so that uRight keeps its meaning (positive is forward) everywhere else.",
        },
        {
          prompt: "How does the 1 ms loop get a wheel speed from an encoder (chapter 11)?",
          options: [
            "It reads a speed register of the eQEP",
            "It counts encoder edges with an interrupt",
            "It subtracts the angle of 1 ms ago from the angle now and divides by 0.001 s",
            "It measures the PWM duty cycle",
          ],
          answer: 2,
          why: "This is the backward difference: speed = (position now - position before) / time between. The old angle is kept in a global variable and updated at the end of every pass.",
        },
        {
          prompt: "The PI controller of chapter 16 stops adding to its integral while the effort is at the limit of 10. What happens without that?",
          options: [
            "Nothing: the limit already protects the motor",
            "The integral keeps growing while the wheel cannot follow, and the wheel then stays too fast for a long time",
            "The proportional part becomes too small",
            "The encoder overflows",
          ],
          answer: 1,
          why: "This is called integrator windup. The effort stays at the limit until the stored-up integral has been worked off again, long after the command dropped. You will see it on this robot in the PI level.",
        },
        {
          prompt: "Why does the LIDAR get its own 100 ms interrupt instead of being read in the 1 ms loop?",
          options: [
            "The 1 ms loop is not allowed to call functions",
            "A new scan only arrives every 100 ms, and going through it takes longer than the rest of the control loop",
            "The LIDAR only works when the motors are off",
            "Timer 0 cannot interrupt faster than 100 ms",
          ],
          answer: 1,
          why: "Fast things (wheel speed) are done fast, slow things (a scan) slowly. The 1 ms loop must stay short and regular: the speed formula and the integral both assume exactly 0.001 s between passes.",
        },
      ],
      hints: [
        "Follow one number around the loop: an encoder count becomes an angle, a speed, an error, an effort, a duty cycle, a wheel speed, and new encoder counts.",
      ],
      takeaway: "Measure, estimate, decide, control, act, a thousand times a second. Every program in the rest of this chapter has that shape.",
    },
    {
      id: "cap-order",
      kind: "order",
      title: "One pass of the loop",
      goal: "Put the steps of one pass through the finished robot's 1 ms interrupt function in order.",
      refs: [{ course: "L11", slide: 13, note: "one pass of the PI code" }, { course: "L15", slide: 26 }, { course: "L14", slide: 31 }, { course: "Lab 5" }],
      brief: `
This is the 1 ms function you will have written by the end of the chapter, cut into steps and shuffled. Put the steps back in order. You do not need to understand every formula yet: each one is explained in the level that adds it.

Ask of each step: **what does it need?** A step can only run after the steps that produce its inputs.

- A speed needs two angles: this pass's and the last one's. So the encoders are read first.
- The heading comes from the two wheel angles. The position ("dead reckoning": adding up small movements) needs slow maths, so the function only raises a flag, \`navFlag\`, and the main loop works out the position and the way to the goal before the next pass.
- The decision needs to know which way the robot points.
- The controller needs the commands \`vref\` and \`turn\` and the measured speeds.
- The motors get the efforts last, and the interrupt is acknowledged at the very end, as in every timer 0 function since chapter 5.

While you sort, name the chapter each step came from. The answer is shown when you are done.
`,
      steps: [
        "Timer 0 reaches zero and cpu_timer0_isr starts",
        "Read EQep1 and EQep2: the two wheel angles in radians",
        "Wheel speeds in ft/s: (angle now - angle 1 ms ago) x (1.235/12) / 0.001, then save the angles",
        "The heading theta from the two wheel angles, then navFlag = 1: the main loop will update x, y and the way to the goal",
        "The mission's state machine sets vref and turn from the heading, the way to the goal and the LIDAR distance",
        "eSteer = vRight - vLeft + turn, then the two wheel errors eLeft and eRight",
        "PI for each wheel, limited to -10 ... 10 with anti-windup: uLeft and uRight",
        "setEPWM1A(uLeft); setEPWM2A(-uRight);",
        "PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;",
      ],
      hints: [
        "Start with the two ends: the timer starts the function, the acknowledge (PIEACK) ends it.",
        "In between, the order is always: measure, estimate, decide, control, act. Sort each step into one of those five.",
        "Encoders, speeds, heading and flag, state machine, steering error (eSteer), PI, the two setEPWM calls, PIEACK.",
      ],
      takeaway: "Encoders and speeds are chapter 11, the state machine chapter 17, steering and PI chapter 16, the PWM calls chapter 10, PIEACK chapter 5. The flag is chapter 5 too. Only dead reckoning is new, and the order.",
    },
    {
      id: "cap-open",
      kind: "code",
      mode: "complete",
      title: "Motors: drive 2 ft by the clock",
      goal: "Bring up both motor PWM channels and drive the robot about 2 ft forward by timing alone.",
      refs: [{ course: "L6-7", slide: 77, note: "50 % duty is a stopped motor" }, { course: "Lab 3" }, { trm: "15" }],
      brief: `
The file you see is the skeleton of the whole chapter. Read it once from top to bottom:

- \`main\` sets up the pins and a timer interrupt every 1 ms. This is the timer 0 set-up you have written since chapter 5.
- \`cpu_timer0_isr\` is the 1 ms loop. It has two sections so far: **Decide** (the mission) and **Act** (the motors).
- At the bottom are the hardware functions. \`init_EPWM1and2()\` and \`setEPWM1A()\` are yours from the chapter 10 level "setEPWM1A and setEPWM2A". \`init_eQEPs()\` is Lab 3's encoder set-up from the chapter 11 level "The second encoder". It is not used yet: it waits for the next level.

## The motors, again
- The left motor is on **EPWM1A** (pin GPIO0), the right motor on **EPWM2A** (pin GPIO2).
- The mission speaks in **control efforts**: a number from -10 to 10. \`setEPWM1A(u)\` turns it into a duty cycle: -10 is 0 %, 0 is 50 %, 10 is 100 %. **50 % is stopped.**
- The right motor is mounted **mirrored**. The same duty cycle that drives the left wheel forwards drives the right wheel backwards.

## What to add (five gaps, marked TODO 1 to 5)
1. In \`init_EPWM1and2()\`: the set-up of **EPWM2**. It is the same ten lines as the EPWM1 block above it, with \`EPwm2Regs\`.
2. In the same function: \`GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);\` gives pin GPIO2 to EPWM2A, as the line above it does for GPIO0.
3. The body of \`setEPWM2A()\`. It is \`setEPWM1A()\`, which is written just above, with \`EPwm2Regs\`.
4. In \`cpu_timer0_isr\`, under "Decide": **the mission**. Set \`uLeft\` and \`uRight\` to 5 for the first part of the run and to 0 after that. \`numTimer0calls\` counts the passes, so it is the time in milliseconds.
5. Under "Act": send \`uRight\` to the right motor, with the sign that a mirrored motor needs.

## How long is "the first part"?
With an effort of 5 the left wheel settles at about 1.5 ft/s and the weaker right wheel at about 1.3 ft/s. The middle of the robot moves at the average, **1.4 ft/s**. Time is distance divided by speed. The motors need a moment to get going and a moment to stop, and the two roughly cancel.

## What you will see
This is **open loop** control: the program sends a command and never looks at the result. Two things follow.

- The distance is only roughly right. The tests accept 1.6 to 2.3 ft.
- The robot **veers to the right**, because the right wheel is slower. Look at the meter "Robot heading" when it has stopped: a heading of 0 would be straight, and you will see about -0.4 rad (23 degrees). The tests do not fail you for that. Nothing in this program could know about it.

The next levels give the program eyes and remove both problems.
${ROOM_NOTE}${MOTOR_NOTE}`,
      kit: "robot",
      durationMs: 3000,
      stimuli: world(),
      starter: OPEN_STARTER,
      solution: S_OPEN,
      checks: [
        { kind: "signal", name: "ROBOT_ODOMETER_FT", min: 1.6, max: 2.3, label: "The robot drove between 1.6 and 2.3 ft", hint: "0 ft and no wheel turns: the efforts are still 0. Almost 0 ft although both wheel meters moved: the robot spun on the spot, the right motor needs setEPWM2A(-uRight). About half the distance: only one wheel is driven, check EPWM2 and the pin mux of GPIO2. Too far or too short: time = 2 ft / 1.4 ft/s." },
        { kind: "signal", name: "ROBOT_X_FT", min: 2.4, label: "It drove forward, along +x", hint: "Backwards: both signs are flipped. The minus belongs only on the right motor. Not moved at all: see the first check." },
        veered("Read this number: the heading is not 0. The robot veered right because its right motor is weaker"),
        ...stopped(),
        NO_CRASH,
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD" },
      ],
      bonus: [{ kind: "signal", name: "ROBOT_ODOMETER_FT", min: 1.9, max: 2.1, label: "Within 0.1 ft of 2 ft, by arithmetic and a little trial and error" }],
      watch: ["numTimer0calls", "uLeft", "uRight"],
      inspect: ["EPwm1Regs.CMPA", "EPwm2Regs.CMPA"],
      hints: [
        "Do the hardware first (gaps 1, 2, 3 and 5). For gap 4 write `uLeft = 5.0; uRight = 5.0;` for now and watch the two wheel speed meters: both must show a positive speed. Then add the timing.",
        "Gap 3 is the eight lines inside setEPWM1A with EPwm2Regs instead of EPwm1Regs. Gap 5 is `setEPWM2A(-uRight);`. Gap 2 is `GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);`.",
        "Gap 4: 2 ft at 1.4 ft/s is 1.43 s, so `if (numTimer0calls <= 1430) { uLeft = 5.0; uRight = 5.0; } else { uLeft = 0.0; uRight = 0.0; }`",
      ],
      takeaway: "Open loop gets you roughly there, pointing roughly the right way, on a good day. Note the two lines under \"Act\": from now on everything above them only has to produce uLeft and uRight.",
    },
    {
      id: "cap-dist",
      kind: "code",
      mode: "write",
      continues: "cap-open",
      title: "Encoders: drive exactly 3 ft",
      goal: "Read both wheel encoders every millisecond, compute speeds and distance, and stop after 3 ft of measured travel.",
      refs: [{ course: "L6-7", slide: [37, 36] }, { course: "Lab 3" }, { trm: "17" }],
      brief: `
You continue in your file from the last level. Now the program gets eyes: the **encoders** of chapter 11. An encoder is a sensor on the motor shaft. The chip's eQEP counter counts its pulses: 40000 counts for one turn of a wheel (2000 per motor turn, times the 20:1 gear).

When the program measures the result and acts on it, that is **closed loop** control.

## What to add, and where
1. **At the bottom of the file: two read functions.** They are yours from the chapter 11 level "Read all three".
   - \`float readEncLeft(void)\` returns the left wheel angle in radians, from the counter \`EQep1Regs.QPOSCNT\`
   - \`float readEncRight(void)\` returns the right wheel angle, from \`EQep2Regs.QPOSCNT\`

   Copy the counter into an \`int32_t\` first, then multiply by \`2*PI/(2000.0*20.0)\`: 2 PI radians per 40000 counts. The **left** encoder counts down when the robot drives forward (the motors are mirrored), so the left factor is negative.
2. **At the top, with the other prototypes:** \`float readEncLeft(void);\` and \`float readEncRight(void);\`.
3. **In \`main\`, after \`init_EPWM1and2();\`:** the call \`init_eQEPs();\`. The function is already at the bottom of the file.
4. **With the other globals:** \`LeftWheel\`, \`RightWheel\` (wheel angles now, in radians), \`LeftWheel_1\`, \`RightWheel_1\` (the angles 1 ms ago), \`vLeft\`, \`vRight\` (speeds in ft/s) and \`travel\` (distance driven in ft). All \`float\`, all starting at 0.
5. **In \`cpu_timer0_isr\`, after \`numTimer0calls++;\` and before the mission: a Measure section.** This is your code from the chapter 11 level "How fast, how far", which called the speeds LeftVel and RightVel:
   - read both angles: \`LeftWheel = readEncLeft();\` and the same for the right
   - speed: \`vLeft = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;\` and the same for the right
   - then save the angles for the next pass: \`LeftWheel_1 = LeftWheel;\` and the same for the right
   - distance: \`travel = 0.5 * (LeftWheel + RightWheel) * (1.235/12.0);\`
6. **The mission**, replacing the timed one: drive until \`travel\` reaches 3 ft, then set both efforts to 0.

## The two formulas
- **\`(1.235/12.0)\`** is the wheel radius in feet (1.235 inches). An angle in radians times the radius is the distance rolled. Example: the wheel has turned 29.15 rad, so the robot rolled 29.15 x 0.1029 = 3.0 ft.
- **Speed** is how much the distance changed, divided by how long that took (0.001 s). Example: the angle grew by 0.0144 rad in one pass, which is 0.00148 ft, so the speed is 0.00148 / 0.001 = 1.48 ft/s.
- **\`travel\`** is the average of the two wheels: the distance the middle of the robot moved.

## Stopping on the line
At effort 5 the robot rolls another 0.07 ft after the effort goes to 0. The tests allow 0.05 ft. So do what you do with a car: slow down before the line. A low effort such as 1.5 gives about 0.35 ft/s, and from there the robot stops almost at once.

The robot still veers right. That is for the next two levels. The tests read your globals \`travel\` and \`vLeft\`, and they measure the real distance with the room's odometer.
`,
      kit: "robot",
      durationMs: 4000,
      stimuli: world(),
      starter: DIST_STARTER,
      solution: S_DIST,
      checks: [
        { kind: "var", name: "vLeft", at: 150, min: 0.2, max: 3.2, label: "Just after the start (0.15 s) your vLeft shows a forward speed in ft/s (between 0.2 and 3.2)", hint: "Always 0: the old angle was saved before the speed was computed, or init_eQEPs() is not called. Negative: the factor in readEncLeft must be negative. In the hundreds or thousands: check (1.235/12.0) and the division by 0.001." },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", equals: 3, tol: 0.05, label: "The robot drove 3 ft, within 0.05 ft", hint: "Stopped after 0.3 ft: travel is still in radians, multiply by (1.235/12.0). Stopped after 1.5 ft: travel is the sum of the two wheels, it must be the average (0.5 x the sum). Drove into the wall: travel never reached 3, see the check on travel. A little too far: slow down before 3 ft." },
        { kind: "var", name: "travel", min: 2.95, max: 3.05, label: "Your variable travel says 3 ft too", hint: "travel = 0.5 * (LeftWheel + RightWheel) * (1.235/12.0). If it stays near 0 while the robot drives, the two wheel angles cancel: readEncLeft needs its negative factor." },
        veered("Read this number: the robot still veers right. Measuring the distance does not fix the heading"),
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_ODOMETER_FT", equals: 3, tol: 0.02, label: "Within 0.02 ft of the line (a quarter of an inch)" },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 3200, equals: 0, tol: 0.05, label: "On the line and stopped within 3.2 s" },
      ],
      watch: ["LeftWheel", "RightWheel", "vLeft", "vRight", "travel"],
      inspect: ["EQep1Regs.QPOSCNT", "EQep2Regs.QPOSCNT"],
      hints: [
        "Do steps 1 to 5 first and keep the old timed mission. Watch travel: it should count up to about 2 and vLeft should read about 1.5 while driving. Only then change the mission.",
        "The left read function: `float readEncLeft(void) { int32_t raw = 0; raw = EQep1Regs.QPOSCNT; return (raw*(-2*PI/(2000.0*20.0))); }`. The right one is the same with EQep2Regs and without the minus. In the Measure section, save the old angles after computing the speeds, not before.",
        "The mission: `if (travel < 2.6) { uLeft = 5.0; uRight = 5.0; } else if (travel < 2.99) { uLeft = 1.5; uRight = 1.5; } else { uLeft = 0.0; uRight = 0.0; }`",
      ],
      takeaway: "The distance is now right whatever the battery or the motors do, because the program measures it. The speed is still whatever an effort of 5 happens to give each motor. That is next.",
    },
    {
      id: "cap-speed",
      kind: "code",
      mode: "write",
      continues: "cap-dist",
      title: "PI control: hold 1 ft/s",
      goal: "Put a PI speed controller with saturation and anti-windup on each wheel, so that both wheels hold the commanded speed although the motors differ.",
      refs: [{ course: "L11", slide: [13, 14] }, { course: "Lab 5" }],
      brief: `
Until now the mission wrote the efforts itself, and the weaker right motor turned the same effort into less speed. From this level on the mission only says how fast to go, in \`vref\` (ft/s), and a controller finds the effort each motor needs. This is the PI controller of chapter 16.

## PI in four lines
For each wheel, on every pass:

- the **error** is what is missing: \`eLeft = vref - vLeft;\`
- the **P** part pushes in proportion to the error: \`Kp * eLeft\`
- the **I** part adds up the error over time (the integral) and pushes in proportion to the sum: \`Ki * ILeft\`. It keeps growing until the error is zero. This is what finds the extra effort the weak motor needs
- the effort is the sum, **saturated**: cut off at -10 and 10, because the motor driver takes no more

Example: \`vref = 1.0\`, the wheel does 0.8 ft/s, \`Kp = 5\`, \`Ki = 100\` and the integral so far is 0.03. The error is 0.2. The effort is 5 x 0.2 + 100 x 0.03 = 4.0.

**Anti-windup**: while the effort is cut off at a limit, the wheel cannot follow, the error stays, and the integral would grow without end ("wind up"). So while the effort is at a limit, the integral may only change in the direction that brings the effort back.

## What to add, and where
1. **With the other globals:** \`vref\`, \`Kp = 5.0\`, \`Ki = 100.0\`, the errors \`eLeft\`, \`eRight\`, the integrals \`ILeft\`, \`IRight\`, and \`INew\`. All \`float\`, the rest starting at 0.
2. **In \`cpu_timer0_isr\`, after the mission and before the two \`setEPWM\` calls: a Control section.** For the left wheel this is your block from the chapter 16 level "The wheel that would not slow down":

\`\`\`c
eLeft = vref - vLeft;
INew = ILeft + eLeft * 0.001;        // the integral if this pass is added
uLeft = Kp * eLeft + Ki * INew;
if (uLeft > 10.0) {
    uLeft = 10.0;
    if (eLeft < 0.0) ILeft = INew;   // only keep it if it shrinks
} else if (uLeft < -10.0) {
    uLeft = -10.0;
    if (eLeft > 0.0) ILeft = INew;
} else {
    ILeft = INew;
}
\`\`\`

   Then the same block for the right wheel, with every Left changed to Right. Each wheel has its own error, integral and effort.
3. **The mission**, replacing the 3 ft one: \`vref = 4.0\` during the first 0.7 s (\`numTimer0calls <= 700\`), then \`vref = 1.0\`. The mission must no longer write \`uLeft\` and \`uRight\`: the controller does that now.

## The test
- **First 0.7 s**: 4 ft/s is asked. The robot's top speed is 3.1 ft/s, so both efforts sit at 10 and the error never goes away. This is exactly the situation that winds up an integral.
- **Then 1 ft/s**: half a second later the wheels must be within 6 % of 1 ft/s, which is **9.72 rad/s** on the two wheel speed meters. At the end both must hold it within 1.5 %. Without anti-windup the wheels are still flat out 0.3 s after the command dropped.

- **At 2.0 s** the test makes the right motor weaker still, as if that wheel had rolled onto carpet. The right wheel may dip to 8.3 rad/s and must be back within 2 % a quarter of a second later. The left wheel must not notice. Only a right wheel that reacts to its **own** error does this.

Watch \`uLeft\` and \`uRight\`: the right effort is larger. The integral found what the weaker motor needs, without being told.

## What is still wrong
Both wheels now hold the same speed, but look at "Robot heading": about -0.4 rad. Flat out, the right motor is simply slower and no controller can help. And equal speeds from now on do not bring back the angle that was lost. The next level deals with the heading.
`,
      kit: "robot",
      durationMs: 2400,
      // At 2.0 s the right motor loses a third of its strength: only the right wheel's own error sees that.
      stimuli: [...world(), { at: 2000, set: "MOTOR_RIGHT_GAIN", value: 0.6 }],
      starter: SPEED_STARTER,
      solution: S_SPEED,
      checks: [
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 600, min: 28, label: "Flat out while 4 ft/s is asked (the left wheel reaches 30 rad/s)", hint: "About 14 rad/s: the old mission still writes uLeft itself, or the mission writes uLeft after the controller did. Standing still or running backwards: the error is vref - vLeft, not the other way round. The mission sets vref = 4.0 while numTimer0calls <= 700." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 1200, equals: RADPS_PER_FTPS, tol: 0.6, label: "0.5 s after the command drops, the left wheel is within 6 % of 1 ft/s (9.72 rad/s)", hint: "Still far too fast: the integral wound up during the first 0.7 s. While uLeft is at a limit, store INew in ILeft only if the error has the opposite sign. Far too slow: is Ki * INew part of the effort?" },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 1900, equals: RADPS_PER_FTPS, tol: 0.15, label: "The left wheel holds 1 ft/s within 1.5 %", hint: "A steady error that never goes away means the integral is not adding up. It must be ILeft plus eLeft * 0.001, kept from pass to pass in a global." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 1900, equals: RADPS_PER_FTPS, tol: 0.15, label: "The weaker right wheel holds 1 ft/s too, within 1.5 %", hint: "The right wheel needs its own block: eRight, IRight and uRight. A leftover Left in the copied block makes it follow the wrong wheel." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 2060, min: 8.3, label: "0.06 s after the right motor gets weaker (at 2.0 s), the right wheel is still above 8.3 rad/s", hint: "Only the right wheel's own error sees this. If it dips to about 8.0, the P part of the right wheel does not react: look for a leftover eLeft in the line `uRight = Kp * eRight + Ki * INew;`." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 2250, equals: RADPS_PER_FTPS, tol: 0.2, label: "0.25 s after it, the right wheel is back at 1 ft/s within 2 %, without overshooting", hint: "Swinging past 9.9 rad/s means the right wheel is held by its integral alone. Its P part must use eRight." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 2060, equals: RADPS_PER_FTPS, tol: 0.15, label: "The left wheel does not notice", hint: "The left wheel's effort must depend on eLeft and ILeft only." },
        veered("Read this number: both wheels are equally fast now, but the heading lost at the start is still lost"),
        NO_CRASH,
      ],
      bonus: [{ kind: "signal", name: "LEFT_WHEEL_RADPS", at: 1000, equals: RADPS_PER_FTPS, tol: 0.2, label: "Already at 1 ft/s (within 2 %) 0.3 s after the command drops" }],
      watch: ["vref", "vLeft", "vRight", "uLeft", "uRight", "ILeft", "IRight"],
      hints: [
        "Write the left wheel completely and run it: the robot will circle, but the left wheel meter must show 9.72 rad/s at the end. Then copy the block and change every Left to Right.",
        "The block in the brief is complete for the left wheel. It goes after the mission and before `setEPWM1A(uLeft);`. Do not forget the globals, and delete the lines of the old mission that set uLeft and uRight.",
        "The mission is `if (numTimer0calls <= 700) { vref = 4.0; } else { vref = 1.0; }` and nothing else. The right wheel's first lines are `eRight = vref - vRight; INew = IRight + eRight * 0.001; uRight = Kp * eRight + Ki * INew;`",
      ],
      takeaway: "The mission now speaks in ft/s and the controller translates, separately for each motor. Friction, battery voltage and a weak motor are the integral's problem, not the mission's.",
    },
    {
      id: "cap-steer",
      kind: "code",
      mode: "write",
      continues: "cap-speed",
      title: "Steering: straight, then a quarter turn",
      goal: "Add the steering coupling and a heading computed from the encoders, then drive 3 ft straight and turn left by 90 degrees on the spot.",
      refs: [{ course: "L11", slide: [21, 22, 23] }, { course: "L15", slide: 23, note: "heading from the difference of the wheels" }, { course: "Lab 5" }],
      brief: `
Two things are added: a second command, \`turn\`, and the robot's first idea of which way it points.

## The steering coupling
Two separate PI loops make the two speeds equal in the end. But while they are getting there, the stronger left motor is ahead, and the angle lost in that moment never comes back. The fix is to tell each wheel about the other. These are the three lines of the course's \`PIcontrol\` function, from the chapter 16 level "Speed and steering":

\`\`\`c
eSteer = vRight - vLeft + turn;
eLeft  = vref - vLeft  + Kturn * eSteer;
eRight = vref - vRight - Kturn * eSteer;
\`\`\`

- \`eSteer\` is the **steering error**: how much faster the right wheel is than it should be. It is added to the left wheel's error and subtracted from the right one's, so the wheel that is behind is pushed and the one that is ahead is held back.
- Example with \`turn = 0\`, \`vref = 1.0\`, \`Kturn = 3\`: the left wheel does 1.0 and the right 0.9 ft/s. \`eSteer\` = 0.9 - 1.0 = -0.1. \`eLeft\` = 1.0 - 1.0 + 3 x (-0.1) = -0.3: the left wheel is told to wait. \`eRight\` = 1.0 - 0.9 - 3 x (-0.1) = 0.4: the right wheel is pushed four times as hard as its own loop would.
- \`turn\` is the **turn command**: the speed difference you want, in ft/s. A **positive** \`turn\` makes the left wheel faster, so the robot turns **right**. To turn **left**, \`turn\` is negative.

On this robot the coupling keeps the heading within 0.001 rad through the start. Without it the robot is off by 0.007 rad, which is 2.5 inches sideways after 30 ft of hallway. One star checks this.

## The heading
The **heading** is the angle the robot points along, in radians: 0 is along +x, and it grows when the robot turns left (counter-clockwise). The robot turns when one wheel rolls further than the other:

\`\`\`c
theta = theta0 + (RightWheel - LeftWheel) * (1.235/12.0) / WHEEL_BASE;
\`\`\`

- Why: the difference of the two wheel distances is an arc, and the distance between the wheels, \`WHEEL_BASE\` = **0.6 ft**, is its radius. Arc divided by radius is an angle in radians.
- Example: the right wheel has rolled 2.00 ft and the left 1.70 ft. The difference is 0.30 ft, and 0.30 / 0.6 = 0.5 rad, about 29 degrees to the left.
- \`theta0\` is the heading at the start, 0 here.
- A quarter turn is 90 degrees = PI/2 = **1.571 rad**. The C math functions and this formula all work in radians, never in degrees.

## What to add, and where
1. **At the top, under the PI define:** \`#define WHEEL_BASE 0.6\`.
2. **With the other globals:** \`float turn = 0;\`, \`float Kturn = 3.0;\`, \`float eSteer = 0;\`, \`float theta0 = 0;\`, \`float theta = 0;\` and \`uint16_t state = 0;\` for the mission.
3. **After the Measure section: an Estimate section** with the heading line above.
4. **In Control:** replace your two lines \`eLeft = vref - vLeft;\` and \`eRight = vref - vRight;\` by the three lines above. Both wheel errors must be computed before the first PI block. The PI blocks stay as they are.
5. **The mission**, a state machine as in the chapter 17 level "A three-state wall follower": a \`switch (state)\` with one \`case\` per state.
   - **state 0, straight**: \`vref = 1.0\`, \`turn = 0\`. When \`travel >= 3.0\`, set \`state = 1\`
   - **state 1, turn left on the spot**: \`vref = 0\`. The angle still to go is \`PI/2.0 - theta\`. Make the turn command proportional to it, \`turn = -2.0 * (PI/2.0 - theta);\`, and limit it to -1 ... 1. So the robot turns fast while it is far off and slows down as it gets there. When less than 0.02 rad is left, set \`state = 2\`
   - **state 2, done**: \`vref = 0\`, \`turn = 0\`

## The test
- 2 s after the start, on the straight, the heading is still within 0.05 rad of 0. Compare that with -0.4 in the last level.
- At the end the robot stands at (4, 2), 3 ft from where it started, and looks along +y: a heading of 1.571 rad, within 0.08.
`,
      kit: "robot",
      durationMs: 6500,
      stimuli: world(),
      starter: STEER_STARTER,
      solution: S_STEER,
      checks: [
        { kind: "signal", name: "ROBOT_THETA_RAD", at: 2000, min: -0.05, max: 0.05, label: "After 2 s, on the straight, the heading is within 0.05 rad of 0", hint: "This is measured while the robot should still be on its 3 ft straight at 1 ft/s. Spinning: the signs of the coupling are swapped, it is + Kturn * eSteer for the left wheel and - Kturn * eSteer for the right. Veering as before: the mission must set vref, not the efforts." },
        { kind: "signal", name: "ROBOT_X_FT", equals: 4, tol: 0.15, label: "The robot drove 3 ft along x before turning (x = 4)", hint: "State 0 ends when travel >= 3.0. While turning on the spot travel does not change, because the wheels move equal and opposite." },
        { kind: "signal", name: "ROBOT_Y_FT", equals: 2, tol: 0.15, label: "It drove straight and turned on the spot (y is still 2)", hint: "vref must be 0 while turning." },
        { kind: "signal", name: "ROBOT_THETA_RAD", equals: Math.PI / 2, tol: 0.08, label: "It ends looking along +y: heading 1.571 rad, within 0.08", hint: "Still turning at the end (the wheels have not stopped): either the robot turns the wrong way, so the angle still to go only grows (a left turn needs a negative turn), or theta is compared with 90 instead of PI/2.0 (theta is in radians). About 2.6: the wheel difference must be divided by WHEEL_BASE. Still 0: state never became 1." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_THETA_RAD", at: 2000, min: -0.005, max: 0.005, label: "On the straight the heading is within 0.005 rad: the steering coupling held the wheels together", hint: "Two separate PI loops lose about 0.007 rad while the unequal motors speed up. Add Kturn * eSteer to the left error and subtract it from the right one." },
        { kind: "signal", name: "ROBOT_THETA_RAD", equals: Math.PI / 2, tol: 0.03, label: "Final heading within 0.03 rad (under 2 degrees)" },
        { kind: "signal", name: "ROBOT_X_FT", equals: 4, tol: 0.06, label: "Stopped within 0.06 ft of x = 4 before turning" },
      ],
      watch: ["state", "travel", "theta", "vref", "turn", "vLeft", "vRight"],
      hints: [
        "Do steps 1 to 4 first and, as the mission, only `vref = 1.0; turn = 0.0;`. Watch theta stay near 0 and the meter \"Robot heading\" agree with it. Then write the switch.",
        "The frame of the mission: `switch (state) { case 0: vref = 1.0; turn = 0.0; if (travel >= 3.0) { state = 1; } break; case 1: /* the turn */ break; default: vref = 0.0; turn = 0.0; break; }`",
        "Inside case 1: `vref = 0.0; turn = -2.0 * (PI/2.0 - theta); if (turn < -1.0) turn = -1.0; if (turn > 1.0) turn = 1.0; if (fabs(PI/2.0 - theta) < 0.02) { state = 2; }`",
      ],
      takeaway: "The mission now has two knobs, vref and turn, and that is all any mission ever needs. A turn that slows down as the remaining angle shrinks is a proportional controller on the heading, wrapped around the PI loops.",
    },
    {
      id: "cap-goto",
      kind: "code",
      mode: "write",
      continues: "cap-steer",
      title: "Dead reckoning: drive to a point",
      goal: "Keep track of x and y as well as the heading, and use them to drive the robot to the point (4, 5).",
      refs: [{ course: "L15", slide: [26, 23] }, { course: "L19", slide: 8, note: "atan2 gives the direction to the goal" }, { course: "Lab 5" }, { course: "HW4" }],
      brief: `
The robot knows its heading. Add the position and it knows where it is. Position and heading together are called the **pose**. Working the pose out from the wheels alone is called **dead reckoning**. Chapter 18 goes deeper into it; everything you need is here.

## The position
Every millisecond the robot moves forward by its speed times 0.001 s, in the direction it points. Its speed is the average of the two wheels. \`cos\` of the heading says how much of that step goes along x, \`sin\` how much along y:

\`\`\`c
x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;
\`\`\`

Example: both wheels do 1 ft/s and the heading is 0.5 rad. In one pass the robot moves 0.001 ft. Of that, cos(0.5) = 0.878 goes along x and sin(0.5) = 0.479 along y: x grows by 0.00088 ft and y by 0.00048 ft.

The robot starts at **(1, 2)** in the room, so \`x\` and \`y\` start at 1.0 and 2.0, not at 0.

## Where is the goal from here?
Call the goal (\`xGoal\`, \`yGoal\`). Two numbers say everything about it:

- **how far**: \`dist = sqrt(dx*dx + dy*dy)\`, with \`dx = xGoal - x\` and \`dy = yGoal - y\` (Pythagoras)
- **which way to turn**: the **heading error** \`eTheta = atan2(dy, dx) - theta\`. \`atan2(dy, dx)\` is the direction of the goal as an angle in radians, measured like the heading. Subtract the heading and you have how far the robot must still turn: positive means the goal is to the left

Example: the robot is at (1, 2) with heading 0, the goal is (4, 5). dx = 3 and dy = 3, so dist = 4.24 ft. The direction is atan2(3, 3) = 0.785 rad (45 degrees), so eTheta = 0.785: turn left by 45 degrees.

## Wrapping the error
Angles repeat every 2 PI, so the subtraction can give a silly answer. Example: the heading is 3.0 rad and the goal's direction is -3.0 rad. The difference is -6.0: "turn right by 344 degrees". Add 2 PI and it is 0.28: "turn left by 16 degrees", the same direction the short way. So after computing \`eTheta\`, bring it into -PI ... PI:

\`\`\`c
while (eTheta > PI) eTheta = eTheta - 2.0 * PI;
while (eTheta < -PI) eTheta = eTheta + 2.0 * PI;
\`\`\`

## Driving there
Two proportional rules, like the turn of the last level:

- **steer**: \`turn = -2.0 * eTheta\`, limited to -1 ... 1. The minus is there because a goal to the left (positive error) needs a left turn, and a left turn is a negative \`turn\`
- **speed**: \`vref = 2.0 * dist\`, limited to 1.5 ft/s. Far away that is the full 1.5 ft/s. At 0.5 ft from the goal it is 1.0 ft/s and at 0.1 ft it is 0.2 ft/s, so the robot slows down as it arrives instead of rushing past

## What to add, and where
1. **With the other globals:** \`float x = 1.0;\`, \`float y = 2.0;\`, \`float xGoal = 4.0;\`, \`float yGoal = 5.0;\`, \`float dist = 0;\`, \`float eTheta = 0;\`.
2. **In Estimate, after the heading line:** the two lines for \`x\` and \`y\`.
3. **The mission**, replacing the old switch. First compute \`dist\` and \`eTheta\` (with the wrap) on every pass. Then:
   - **state 0, FACE**: \`vref = 0\` and steer. When \`fabs(eTheta) < 0.05\`, set \`state = 1\`
   - **state 1, DRIVE**: steer, and set the speed by the rule above. When \`dist < 0.05\`, set \`state = 2\`
   - **state 2, DONE**: \`vref = 0\`, \`turn = 0\`

## The test
The robot must stop within 0.15 ft of (4, 5). The room measures where it really is. The tests also read your globals \`x\` and \`y\`: they must say (4, 5) too. If your estimate is wrong, the robot drives confidently to the wrong place, and comparing \`x\` and \`y\` with the meters "Robot x" and "Robot y" shows you by how much.

The simulated wheels never slip, so dead reckoning is almost perfect here. On the lab floor it drifts by an inch or two per turn.
`,
      kit: "robot",
      durationMs: 7000,
      stimuli: world({ goal: GOAL_GOTO }),
      starter: GOTO_STARTER,
      solution: S_GOTO,
      checks: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.15, label: "The robot ends within 0.15 ft of (4, 5)", hint: "Compare the meters Robot x and Robot y with your x and y. If they agree, the estimate is fine and the mission is wrong: a robot that spins without end has the sign of turn wrong (turn = -2.0 * eTheta), one that drives off sideways has atan2(dx, dy) instead of atan2(dy, dx). If your x and y say (4, 5) but the meters do not: about 2.2 ft off means x and y did not start at 1.0 and 2.0; otherwise check that cos and sin get theta as it is, in radians." },
        { kind: "var", name: "x", min: 3.85, max: 4.15, label: "Your x says 4", hint: "About 3: x must start at 1.0, where the robot starts. Otherwise: x adds 0.5 * (vLeft + vRight) * cos(theta) * 0.001 on every pass, after theta was updated." },
        { kind: "var", name: "y", min: 4.85, max: 5.15, label: "Your y says 5", hint: "About 3: y must start at 2.0. Otherwise: y uses sin(theta), with theta in radians." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.06, label: "Within 0.06 ft of the goal (three quarters of an inch)" },
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 5000, max: 0.15, label: "There within 5 s" },
      ],
      watch: ["state", "x", "y", "theta", "dist", "eTheta", "vref", "turn"],
      hints: [
        "Do steps 1 and 2 first and keep the old mission. After the 3 ft and the turn, your x and y should read (4, 2), like the meters. Then write the new mission.",
        "Before the switch: `dist = sqrt((xGoal - x) * (xGoal - x) + (yGoal - y) * (yGoal - y)); eTheta = atan2(yGoal - y, xGoal - x) - theta;` and the two while lines of the wrap. Steering, in both FACE and DRIVE: `turn = -2.0 * eTheta; if (turn > 1.0) turn = 1.0; if (turn < -1.0) turn = -1.0;`",
        "`case 0: vref = 0.0;` steer, `if (fabs(eTheta) < 0.05) { state = 1; } break; case 1: vref = 2.0 * dist; if (vref > 1.5) vref = 1.5;` steer, `if (dist < 0.05) { state = 2; } break; default: vref = 0.0; turn = 0.0; break;`",
      ],
      takeaway: "A go-to-point controller is two proportional rules, one on the heading error and one on the distance, and a wrap. The course's xy_control function is the same idea with a few more guards. The next level looks at what cos, sin and atan2 cost the 1 ms loop.",
    },
    {
      id: "cap-lean",
      kind: "code",
      mode: "write",
      continues: "cap-goto",
      title: "Keep the 1 ms loop short",
      goal: "Move the slow maths of dead reckoning out of the 1 ms interrupt into the main loop, behind a flag.",
      refs: [{ course: "L14", slide: 31, note: "only time-critical work in the 1 ms interrupt" }, { course: "L4", slide: 27, note: "move long work out of the timer function" }, { course: "L15", slide: 26, note: "the maths that moves" }, { course: "Lab 1" }],
      brief: `
The robot arrives. Now look at what the last level cost. The simulator times every pass of \`cpu_timer0_isr\`. Before dead reckoning the longest pass took 2.5 microseconds (us). Now it takes **6**.

## Where the time goes
\`cos\`, \`sin\` and \`atan2\` take about 1 us each on this chip, \`sqrt\` a quarter of that. Those four calls cost more than the encoders, both PI loops and the motors together.

6 us out of 1000 is not an emergency. But this is the one function that must never be late: the speed formula and the integral assume exactly 0.001 s between passes, and while it runs every other interrupt waits. The LIDAR and a serial port are still to come. So engineers keep a rule:

**An interrupt does only what must happen at its rate. The rest is handed to the main loop.**

Measure, heading, mission, PI and motors must happen every millisecond. \`x\`, \`y\`, \`dist\` and \`eTheta\` may be a few microseconds late.

## What to change, and where
The hand-off is the flag of the chapter 5 level "Leave the slow work to main".

1. **A new function at the bottom**, \`void navigate(void)\`, and its prototype at the top. Move six lines into it, unchanged: the two lines for \`x\` and \`y\`, and the four lines for \`dist\` and \`eTheta\` from the top of the mission.
2. **With the globals:** \`uint16_t navFlag = 0;\`
3. **In \`cpu_timer0_isr\`**, where the \`x\` and \`y\` lines were: \`navFlag = 1;\`
4. **In \`main\`, inside \`while (1)\`:**
\`\`\`c
if (navFlag == 1) {
    navFlag = 0;
    navigate();
}
\`\`\`
5. **In \`main\`, just before \`EINT;\`:** call \`navigate();\` once. The first interrupt comes before the main loop has run. Without this call it finds \`eTheta = 0\`, and FACE believes the robot already points at the goal.

## Is that safe?
\`navigate()\` starts right after the interrupt returns and is done about 6 us later. The next interrupt is 994 us away, so the two never work on these variables at the same moment. When you cannot be sure of that, copy the shared values with interrupts off (chapter 20).

## The test
The robot still reaches (4, 5), and no pass of \`cpu_timer0_isr\` takes more than **3.5 us**.
`,
      kit: "robot",
      durationMs: 7000,
      stimuli: world({ goal: GOAL_GOTO }),
      starter: LEAN_STARTER,
      solution: S_LEAN,
      checks: [
        { ...ISR_BUDGET, hint: "About 6 us: nothing has moved yet, or navigate() is called from cpu_timer0_isr. A function call does not make the maths faster: only main may call navigate(). About 4 us: the lines for dist and eTheta (sqrt, atan2) are still in the mission. They move too." },
        { kind: "var", name: "state", at: 100, equals: 0, label: "After 0.1 s the mission is still in FACE (state 0), turning towards the goal", hint: "Already 1: the first interrupt ran before navigate() ever did. eTheta was still 0, so FACE believed the robot was pointing at the goal and skipped the turn. Call navigate() once in main, just before EINT." },
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.15, label: "The robot still ends within 0.15 ft of (4, 5)", hint: "Spinning on the spot or driving into a wall: dist and eTheta are not being updated. See the check on x." },
        { kind: "var", name: "x", min: 3.85, max: 4.15, label: "Your x says 4", hint: "Stays at 1: navigate() never runs. The interrupt must set navFlag = 1 and while (1) must test it. Far too large although the robot hardly moved: navigate() runs over and over. Set navFlag back to 0 inside the if, before the call." },
        { kind: "var", name: "y", min: 4.85, max: 5.15, label: "Your y says 5" },
        { kind: "var", name: "navFlag", equals: 0, label: "The flag is back at 0 after main used it", hint: "`navFlag = 0;` inside the if in main, before navigate()." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.06, label: "Still within 0.06 ft of the goal" },
      ],
      watch: ["navFlag", "state", "x", "y", "dist", "eTheta"],
      hints: [
        "Move first, then connect. Write navigate() and move the six lines. The program still compiles if you call nothing yet, and the robot stands still: that tells you the lines are gone from the interrupt.",
        "The interrupt keeps the heading line `theta = theta0 + ...` and gets `navFlag = 1;` after it. The mission starts directly with `switch (state)`.",
        "`void navigate(void) { x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001; y = ...sin(theta)...; dist = sqrt(...); eTheta = atan2(...) - theta;` and the two while lines `}`. In main: `navigate();` before `EINT;`, and `if (navFlag == 1) { navFlag = 0; navigate(); }` inside `while (1)`.",
      ],
      takeaway: "The interrupt decides when, the main loop does the slow work. On the course robot the same job is done by software interrupts of low priority (chapter 5): the 1 ms control code always goes first.",
    },
    {
      id: "cap-wall",
      kind: "code",
      mode: "write",
      continues: "cap-lean",
      title: "LIDAR: stop before the wall",
      goal: "Read the LIDAR every 100 ms from CPU timer 1 and stop the robot when something is close ahead.",
      refs: [{ course: "L14", slide: 33, note: "a scan every 100 ms, used by the fast loop" }, { course: "L16", slide: [31, 30], note: "which points look ahead, and no-echo readings" }, { trm: "3.8" }],
      brief: `
The goal is now **(12, 2)**. The room ends at x = 10. Your dead reckoning has no idea that there is a wall in between, so the robot will drive into it at full speed. It needs to look. This is the **LIDAR** of chapter 17: a laser that turns and measures the distance to whatever it hits, 228 directions ("points") per scan.

## Which LIDAR path?
In chapter 17 you asked the sensor for a scan over the serial port SCIC and parsed 477 characters into an array. That parser is about 80 lines that you have already written and debugged. Here the test bench function \`tb_lidar_ft(i)\` stands in for it: it returns point \`i\` of the current scan in feet, the same number your parser stores. The rest of the program cannot tell the difference. An expert level at the end puts the real serial path back.

Point **113** looks straight ahead, and the points are 1.05 degrees apart. Points **94 to 132** cover 20 degrees to each side, which is enough to see anything the robot's body would touch.

## What to add, and where
1. **At the bottom of the file:** \`float min_ft(int first, int last)\`, which returns the smallest of \`tb_lidar_ft(first)\` ... \`tb_lidar_ft(last)\`. It is the loop of the chapter 17 level "What is closest, and where": start with \`m = 19.0\` (more than any reading) and keep every reading that is smaller.
2. **Also at the bottom:** a second interrupt function,
\`\`\`c
__interrupt void cpu_timer1_isr(void)
{
    front_ft = min_ft(94, 132);
    numScans++;
}
\`\`\`
   It needs no PIEACK line: timer 1 is wired straight to CPU interrupt 13 and does not go through the PIE (chapter 5, "Two timers, two rhythms").
3. **At the top:** the prototypes \`__interrupt void cpu_timer1_isr(void);\` and \`float min_ft(int first, int last);\`.
4. **With the other globals:** \`float front_ft = 19.0;\` (nothing seen yet) and \`uint32_t numScans = 0;\`. Change the goal to \`xGoal = 12.0\`, \`yGoal = 2.0\`.
5. **In \`main\`**, four lines, each next to its timer 0 twin:
   - \`PieVectTable.TIMER1_INT = &cpu_timer1_isr;\` between EALLOW and EDIS
   - \`ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);\` (the period is in microseconds: 100 ms)
   - \`CpuTimer1Regs.TCR.all = 0x4000;\` starts the timer
   - \`IER |= M_INT13;\` before \`EINT;\`
6. **The mission**: one new state, **BLOCKED** (\`case 3\`): \`vref = 0\`, \`turn = 0\`. In DRIVE, after the test for \`dist < 0.05\`, go there when \`front_ft < 1.2 && front_ft < dist\`. The second half means: only if the thing ahead is nearer than the goal. Something behind the goal does not matter.

## How close is 1.2 ft?
At 1.5 ft/s the robot moves 0.15 ft between two scans and needs a little more to brake. It ends about 1 ft from the wall. The tests want it between 0.6 and 1.4 ft, stopped, and never touching.

The tests read your global \`front_ft\`.
`,
      kit: "robot",
      durationMs: 8000,
      stimuli: world({ goal: GOAL_WALL }),
      starter: WALL_STARTER,
      solution: S_WALL,
      checks: [
        { kind: "isr", fn: "cpu_timer1_isr", min: 70, max: 90, label: "cpu_timer1_isr runs every 100 ms (about 80 times in 8 s)", hint: "0 times: one of the four lines in main is missing: the vector, ConfigCpuTimer, the start (TCR = 0x4000) or IER |= M_INT13. Thousands of times: ConfigCpuTimer takes the period in microseconds, 100000." },
        { kind: "var", name: "front_ft", min: 0.6, max: 1.4, label: "Your front_ft ends between 0.6 and 1.4 ft", hint: "Still 19: cpu_timer1_isr does not run, see the check above. Some other large value: points 94 to 132 are the ones that look ahead; low numbers such as 28 look to the right." },
        NO_CRASH,
        { kind: "signal", name: "ROBOT_X_FT", min: 8.4, label: "The robot drove up to the wall (x above 8.4)", hint: "Ended near (4, 5): the goal is still the old one, set xGoal = 12.0 and yGoal = 2.0. Never left the start: is state 3 entered at once? front_ft must start at 19.0." },
        { kind: "signal", name: "LIDAR_FRONT_FT", min: 0.6, max: 1.4, label: "It stands 0.6 to 1.4 ft from the wall", hint: "Too close or crashed: the robot moves between scans and while braking, so stop earlier than you want to end: try 1.2 ft. Crashed with front_ft correct: DRIVE must go to state 3 when front_ft < 1.2." },
        ...stopped(),
      ],
      bonus: [
        ISR_BUDGET,
        { kind: "signal", name: "LIDAR_FRONT_FT", min: 0.9, max: 1.2, label: "Stopped 0.9 to 1.2 ft from the wall" },
      ],
      watch: ["state", "front_ft", "numScans", "x", "dist", "vref"],
      hints: [
        "Do steps 1 to 5 first, but keep the old goal. The robot still drives to (4, 5), numScans should count up by 10 per second, and front_ft should start near 9 and change as the robot turns and drives.",
        "`float min_ft(int first, int last) { int i; float m = 19.0; for (i = first; i <= last; i++) { if (tb_lidar_ft(i) < m) { m = tb_lidar_ft(i); } } return m; }`",
        "In DRIVE: `if (dist < 0.05) { state = 2; } else if (front_ft < 1.2 && front_ft < dist) { state = 3; }` and, before `default:`, `case 3: vref = 0.0; turn = 0.0; break;`",
      ],
      takeaway: "Dead reckoning says where the robot is. Only a sensor says what is around it. The slow loop looks, the fast loop acts on the last look.",
    },
    {
      id: "cap-final",
      kind: "code",
      mode: "checkpoint",
      continues: "cap-wall",
      title: "Checkpoint: across the room",
      goal: "Drive the robot to a goal behind an obstacle: go around what is in the way, then carry on to the goal and stop there.",
      refs: [{ course: "L14", slide: [35, 37] }, { course: "L16", slide: 31, note: "which points look ahead" }, { course: "Lab 6" }],
      brief: `
The goal is **(9, 7.6)**. The straight line from the start runs through the 1 ft block. With the program of the last level the robot stops in front of the block and waits forever. Now it has to go around.

## A plan that works
Your state machine has FACE (0), DRIVE (1), DONE (2) and BLOCKED (3). Two changes turn "stop" into "go around":

- **TURN** replaces BLOCKED (\`case 3\`): turn left on the spot, \`vref = 0\`, \`turn = -1.0\`, until the way ahead is clear: \`front_ft > 2.5\`. At that moment remember how far the robot has driven so far, \`passStart = travel;\`, and set \`state = 4\`.
- **PASS** is new (\`case 4\`): drive straight, \`vref = 1.0\`, \`turn = 0\`. When \`travel - passStart > 2.0\`, the robot has driven 2 ft since the turn and the obstacle is behind it: set \`state = 0\`, FACE, which turns to the goal again. If something comes up ahead first (\`front_ft < 1.2\`), set \`state = 3\` and turn again.

FACE, DRIVE and DONE stay as they are. If the way to the goal is still blocked after one pass, DRIVE sends the robot round again. So the same five states also handle bigger obstacles.

Why 2 ft? The block is 1 ft wide and the robot must clear it by more than its own radius, 0.35 ft.

Walk through it once on paper: FACE the goal, DRIVE until the block is 1.2 ft ahead, TURN left until the LIDAR sees 2.5 ft of free floor, PASS 2 ft, FACE the goal again, DRIVE, DONE.

## What to change, and where
1. **In the globals:** the goal, \`xGoal = 9.0\` and \`yGoal = 7.6\`, and a new \`float passStart = 0;\`.
2. **In the mission's switch:** rewrite \`case 3\` as TURN, and add \`case 4\`, PASS, before \`default:\`.

You are free to do it another way, for example by following the side of the obstacle as the wall follower of chapter 17 does. The tests only look at the result.

## The test
Within 16 s the robot stands still within 0.15 ft of the goal and has touched nothing. Stars: arrive within 13 s, drive less than 11.5 ft on the way (the straight line is 9.8 ft), and keep the 1 ms loop short.
${ROOM_NOTE}

Open the Robot arena's large view and replay the run to see where the robot turns.
`,
      kit: "robot",
      durationMs: 16000,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: FINAL_STARTER,
      solution: S_FINAL,
      checks: arrived("Watch state while it runs. Stuck at 3 in front of the block: case 3 must turn (turn = -1.0) and leave when front_ft > 2.5. Turning and stopping over and over: passStart = travel must be set at the moment TURN ends, or PASS ends at once. Ended near x = 9, y = 2: the goal is still (12, 2)."),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13000, max: 0.15, label: "At the goal within 13 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 11.5, label: "Drove less than 11.5 ft to get there" },
        ISR_BUDGET,
      ],
      watch: ["state", "x", "y", "theta", "front_ft", "dist", "passStart", "travel"],
      hints: [
        "Watch state while it runs. A good run shows 0, 1, then 3 at the block, 4, 0, 1 and finally 2. The state it gets stuck in tells you which rule is missing.",
        "`case 3: vref = 0.0; turn = -1.0; if (front_ft > 2.5) { state = 4; passStart = travel; } break;`",
        "`case 4: vref = 1.0; turn = 0.0; if (front_ft < 1.2) { state = 3; } else if (travel - passStart > 2.0) { state = 0; } break;` and, in the globals, `float passStart = 0;`, `float xGoal = 9.0;`, `float yGoal = 7.6;`",
      ],
      takeaway: "Count what is in this file: PWM for two unequal motors, two encoders, backward-difference speeds, two PI loops with anti-windup, steering, dead reckoning, a LIDAR and a state machine, in two interrupts. Almost every line came from a chapter you finished, and now it is one robot.",
    },
    {
      id: "cap-p-corner",
      kind: "code",
      mode: "write",
      tier: "practice",
      continues: "cap-final",
      title: "Practice: from the far corner",
      goal: "Run the same program from a different start pose to a different goal, across the +-PI line.",
      refs: [{ course: "L15", slide: 26 }, { course: "L19", slide: 8, note: "the direction to the goal, and its wrap" }, { course: "L14", slide: 35 }],
      brief: `
A good program does not care where it starts. Same room, new trip: the robot now stands at **(8.8, 9)** and looks along **-x**. That is a heading of **PI** (180 degrees). The goal is **(6.5, 4.5)**, and the block is in the way again.

## What to change
Only numbers, all in the globals:

- the start pose: \`theta0\` and \`theta\` (both PI), \`x\` and \`y\`
- the goal: \`xGoal\` and \`yGoal\`

Your heading line is \`theta = theta0 + ...\`, so the heading follows from \`theta0\`. If you assumed anywhere else that the heading starts at 0, this level finds it.

## What it tests
From a heading of PI, the goal is 63 degrees to the robot's **left**. Without the wrap of the heading error, the subtraction says "turn right by 297 degrees". The robot still arrives that way, three seconds late. With the wrap from the dead reckoning level it takes the short way, and that is what the star for 10 s needs.
`,
      kit: "robot",
      durationMs: 13000,
      stimuli: world(CORNER),
      starter: CORNER_STARTER,
      solution: S_CORNER,
      checks: arrived("Drove off in a strange direction: the program still believes it starts at (1, 2) with heading 0. Set theta0 and theta to PI, x to 8.8 and y to 9.0, and the goal to (6.5, 4.5)."),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 10000, max: 0.15, label: "At the goal within 10 s", hint: "Did the robot turn the long way round at the start? Wrap the heading error into -PI ... PI with the two while lines." },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 6.6, label: "Drove less than 6.6 ft (the straight line is 5.1 ft)" },
      ],
      watch: ["state", "x", "y", "theta", "eTheta", "front_ft", "dist"],
      hints: [
        "Six globals describe the trip: where the robot is, which way it points, and where it is going. Nothing in the interrupt functions changes.",
        "`float theta0 = PI;` and `float theta = PI;`, `float x = 8.8;`, `float y = 9.0;`",
        "`float xGoal = 6.5;` and `float yGoal = 4.5;`. If it turns the long way round, check the two lines `while (eTheta > PI) eTheta = eTheta - 2.0 * PI;` and `while (eTheta < -PI) eTheta = eTheta + 2.0 * PI;`",
      ],
      takeaway: "Start pose and goal are data. If changing them means changing code, the code was written for one room.",
    },
    {
      id: "cap-p-door",
      kind: "code",
      mode: "write",
      tier: "practice",
      continues: "cap-final",
      title: "Practice: out through the door",
      goal: "Drive the robot out of a room through a doorway to a goal outside.",
      refs: [{ course: "L14", slide: [35, 37] }, { course: "L16", slide: 31, note: "which points look ahead" }],
      brief: `
A different room: the same 10 ft box without the block, but with a **doorway** in the wall x = 10, from y = 6 to y = 8.5. The robot stands at **(8.5, 2)** and looks along **+y**. That is a heading of **PI/2** (90 degrees). The goal is outside, at **(12, 7.25)**.

The straight line to the goal runs into the wall beside the door. The robot has to find the opening.

## What to change
Only numbers, all in the globals: the start pose (\`theta0\` and \`theta\` both \`PI/2.0\`, \`x\`, \`y\`) and the goal (\`xGoal\`, \`yGoal\`). If your state machine from the checkpoint is sound, that is all.

## What to watch
The robot is blocked by the wall, turns left until it sees 2.5 ft of free floor, passes, faces the goal and tries again. It may need two or three rounds to reach the door. Watch \`state\`. This is the same machine handling a case you did not design it for. That is the reason for writing it as states and rules instead of a fixed list of moves.

The doorway is 2.5 ft wide and the robot 0.7 ft. Do not cut the corner of the door post.
`,
      kit: "robot",
      durationMs: 15000,
      stimuli: world(DOOR),
      starter: DOOR_STARTER,
      solution: S_DOOR,
      checks: [
        { kind: "signal", name: "ROBOT_X_FT", min: 10.5, label: "The robot is outside the room (x above 10.5)", hint: "Still near x = 1.5: the start pose and goal are the old ones. Stuck in front of the wall: after PASS the machine must go back to FACE (state 0) so that it tries the goal again." },
        ...arrived("Set the start pose (x = 8.5, y = 2.0, theta0 and theta = PI/2.0) and the goal (12.0, 7.25)."),
      ],
      bonus: [{ kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13000, max: 0.15, label: "Outside and at the goal within 13 s" }],
      watch: ["state", "x", "y", "theta", "front_ft", "dist"],
      hints: [
        "Change the six numbers first and run it. Then watch where the robot is each time state changes.",
        "`float theta0 = PI/2.0;`, `float theta = PI/2.0;`, `float x = 8.5;`, `float y = 2.0;`, `float xGoal = 12.0;`, `float yGoal = 7.25;`",
        "If it touches the door post, pass further (2.5 instead of 2.0 in PASS) or call the way blocked earlier (1.5 instead of 1.2 ft) and run it again.",
      ],
      takeaway: "The robot was never told about doors. Blocked, turn, pass, face the goal again: four rules were enough to find one.",
    },
    {
      id: "cap-x-fast",
      kind: "code",
      mode: "write",
      tier: "expert",
      continues: "cap-final",
      title: "Expert: in 10 seconds",
      goal: "Make the checkpoint trip to (9, 7.6) in 10 seconds or less, without touching anything.",
      refs: [{ course: "L11", slide: [17, 18], note: "tuning for speed" }, { course: "L14", slide: 33, note: "one look every 100 ms: how far the robot drives between two" }, { course: "Lab 5" }],
      brief: `
The checkpoint trip took the reference program 12 s. Do it in **10 s**: at 10.0 s the robot must stand still within 0.1 ft of **(9, 7.6)**. Same room, same start, same rules: touch nothing.

No recipe this time. Some facts:

- The left wheel's top speed is 3.1 ft/s, the weaker right wheel's 2.7 ft/s. A wheel that is asked for more than it can give has nothing left for steering.
- The LIDAR is read every 100 ms. At 3 ft/s the robot moves 0.3 ft between two looks, and it also needs room to brake. The distance at which you call the way "blocked" has to grow with the speed.
- \`vref = 2.0 * dist\` starts to slow the robot down 0.75 ft before the goal at 1.5 ft/s, and 1.5 ft before it at 3 ft/s.
- Time is lost wherever the robot stands still: turning on the spot, creeping the last inches.
- The checkpoint's rules always turn left. Left is not always the short way round.

Measure before you change anything: watch \`state\` and \`numTimer0calls\` (the time in ms), and write down how long each state takes.
`,
      kit: "robot",
      durationMs: 11000,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: FAST_STARTER,
      solution: S_FAST,
      checks: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 10000, max: 0.1, label: "At 10 s the robot is within 0.1 ft of the goal", hint: "Find the state that takes longest and work on that one first. The long straight parts gain most from a higher speed." },
        ...stopped(10000),
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.1, label: "It stays there" },
        { ...NO_CRASH, hint: "A faster robot needs more room to stop. Raise the distance at which the way counts as blocked together with the speed." },
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 9000, max: 0.1, label: "There in 9 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 11.2, label: "Drove less than 11.2 ft" },
        ISR_BUDGET,
      ],
      watch: ["state", "numTimer0calls", "vref", "front_ft", "dist", "travel"],
      hints: [
        "The long straight parts are where a higher speed pays. Raise the limit on vref in DRIVE and the speed in PASS.",
        "Faster means stopping earlier: raise the blocked distance from 1.2 ft together with the speed, in DRIVE and in PASS.",
        "One set that works: in DRIVE `if (vref > 3.0) vref = 3.0;`, blocked when `front_ft < 1.5` (both places), and in PASS `vref = 2.0;`.",
      ],
      takeaway: "Speed is paid for in stopping distance, and stopping distance in how early the sensor must see. Every fast robot is tuned along that chain.",
    },
    {
      id: "cap-x-serial",
      kind: "code",
      mode: "write",
      tier: "expert",
      continues: "cap-final",
      title: "Expert: the real LIDAR",
      goal: "Replace the test bench shortcut with the real sensor path: ask the LIDAR over SCIC every 100 ms and parse its reply.",
      refs: [{ course: "L16", slide: [31, 32, 30] }, { trm: "19" }, { trm: "3.4.5" }],
      brief: `
\`tb_lidar_ft()\` does not exist on the robot. Take it out and put in what does: the serial path of chapter 17. The trip is the checkpoint's, to (9, 7.6). Have your solutions of the chapter 17 levels "Ask every 100 ms" and "The parser is a state machine" open.

## What to build, and where
- **In \`main\`:** \`init_serialSCIC(&SerialC, 115200);\` after the timers, the vector \`PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;\` between EALLOW and EDIS, and \`IER |= M_INT8;\`.
- **\`cpu_timer1_isr\`** now only **asks**: \`serial_sendSCIC(&SerialC, G_command, G_len);\` with the globals \`char G_command[] = "G04472503\\n";\` and \`uint16_t G_len = 10;\`.
- **A new interrupt function** \`__interrupt void RXCINT_recv_ready(void)\`: your parser. It runs once per received character. It reads \`ScicRegs.SCIRXBUF.all\` into \`RXCdata\` (declared by the serial library), counts the 12 header characters, joins the data characters in pairs, skips single line feeds and ends on two in a row. Its last two lines clear \`ScicRegs.SCIFFRX.bit.RXFFINTCLR\` and acknowledge **PIE group 8**.
- **Globals:** the parser's variables and \`float ladar_ft[228];\`. Store each distance in feet: \`distance * 0.00328084\` (the sensor sends millimetres). Readings of 0 and 6 are error codes, not distances: store \`LADAR_MAX_READING\` for them, as the course code does.
- **When a reply is complete:** the parser only sets a flag, \`newScan = 1;\`. The \`while (1)\` loop in \`main\` sees it, sets it back, computes \`front_ft\` as the smallest of \`ladar_ft[94]\` ... \`ladar_ft[132]\` and counts the scan in \`numScans\`. This is the hand-off you used for \`navigate()\`, and the one of the chapter 17 checkpoint: searching 39 points takes six times as long as handling one character.
- Remove \`min_ft()\` or change it to read the array. No \`tb_lidar\` call may remain.

## What changes for the robot
The answer now arrives about 42 ms after the question, 477 characters later, one interrupt per character. \`front_ft\` is always a little older than before. If the robot now gets too close, you know why, and what to change.

There are three interrupt sources now. The 1 ms loop must not notice.
`,
      kit: "robot",
      durationMs: 14500,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: SERIAL_STARTER,
      solution: S_SERIAL,
      checks: [
        { kind: "source", mustNotMatch: "tb_lidar", label: "The program does not use tb_lidar_ft or tb_lidar_mm", hint: "Replace the call in min_ft() or delete the function: the distances now come from your array ladar_ft[]." },
        { kind: "signal", name: "LIDAR_SCANS", min: 100, label: "The LIDAR answered at least 100 requests", hint: "No scans: the command never reached the sensor. It needs init_serialSCIC(&SerialC, 115200) and the 10 characters of G04472503 with its line feed, sent from cpu_timer1_isr." },
        { kind: "var", name: "numScans", min: 100, label: "Your parser completed at least 100 scans (numScans)", hint: "Requests go out but no scan completes: the receive interrupt needs its vector (SCIC_RX_INT) and IER |= M_INT8, and the parser must end a scan on two line feeds in a row." },
        { kind: "no-diagnostic", code: "lidar", label: "The LIDAR understood every command" },
        ...arrived("Stopped or turning in open floor: an error code (0 or 6) was stored as a distance of a few millimetres. Store LADAR_MAX_READING for those."),
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13500, max: 0.15, label: "At the goal within 13.5 s" },
        ISR_BUDGET,
        { kind: "isr-time", fn: "RXCINT_recv_ready", maxUs: 1.5, label: "No character takes more than 1.5 microseconds to handle: the scan is searched in main", hint: "About 7 us: front_ft is computed inside RXCINT_recv_ready when the reply ends. Set a flag there and do the search in while (1)." },
      ],
      watch: ["state", "front_ft", "numScans", "read_ladar_state", "dis_index"],
      hints: [
        "Bring it up in the order of chapter 17: first the request (watch the meter \"LIDAR scans sent\"), then the parser (watch numScans), then front_ft.",
        "The parser's states: 0 waits for 'G'; 1 counts to 12 and checks that character 11 is '0'; 2 joins pairs, `(first - 0x30) << 6` plus `(second - 0x30)`, and counts line feeds. Two line feeds in a row: back to state 0 and `newScan = 1;`. In main: `if (newScan == 1) { newScan = 0; ... }` with the search for front_ft.",
        "In the data state, on the second character of a pair: `if (distance == 0 || distance == 6) distance = LADAR_MAX_READING; if (dis_index < 228) ladar_ft[dis_index] = distance*0.00328084; dis_index += 1;`",
      ],
      takeaway: "This is the robot's real program structure: a 1 ms control interrupt, a 100 ms request, and a receive interrupt that assembles the answer one character at a time.",
    },
    {
      id: "cap-x-square",
      kind: "code",
      mode: "write",
      tier: "expert",
      continues: "cap-final",
      title: "Expert: a square, and home",
      goal: "Drive a 3 ft square through four corners and end where you started, within 3 inches, looking the way you started.",
      refs: [{ course: "L15", slide: [26, 28] }, { course: "L19", slide: [6, 8], note: "way points" }, { course: "Lab 5" }],
      brief: `
The classic test of a robot's dead reckoning: drive a square and see how far from the start you end.

From the start at (1, 2), visit the corners **(4, 2)**, **(4, 5)**, **(1, 5)** and come back to **(1, 2)**, in that order. Then turn back to the heading you started with and stop.

## What the tests need
- A global \`uint16_t corner\` that counts the corners reached. It must end at **4** (the start counts as the fourth).
- The odometer reads between 11.6 and 12.6 ft: the square is 12 ft.
- At the end the robot stands still within **0.25 ft** (3 inches) of the start, and its heading is within 0.1 rad of 0.

## Things that will bite
- The goal now changes while the program runs. Two arrays of corner coordinates keep that tidy. Set \`xGoal\` and \`yGoal\` to the next corner **in the same pass that counts the corner**. \`navigate()\` then works out \`dist\` and \`eTheta\` for the new corner before the next pass. Change the goal one pass later and FACE acts once on numbers for the old corner.
- After the fourth corner the robot points along -y. "Back to the starting heading" is a turn to a **heading**, not towards a point: the heading error is \`theta0 - theta\`, wrapped. Keep it in a variable of its own: \`eTheta\` belongs to \`navigate()\`.
- Your \`theta\` keeps growing through four left turns, to about 2 PI. The wrap of the error takes care of it, if every error is wrapped.
- An error of 0.05 ft at each corner is 0.05 ft at the end, not 0.2: each corner is a point in the room, not a distance from the last corner. That is what dead reckoning buys you over "3 ft, turn 90 degrees, four times".
- The whole trip must fit in 20 s. At 1.5 ft/s it takes almost 19 s. The star for 18 s needs more speed on the straight parts.

On this floor the wheels never slip, so the square closes almost perfectly. Run the same program on the real robot and measure the gap with a ruler: that gap is what the Kalman filter of chapter 18 is for.
`,
      kit: "robot",
      durationMs: 20000,
      stimuli: world({ goal: [START[0], START[1]] }),
      starter: SQUARE_STARTER,
      solution: S_SQUARE,
      checks: [
        { kind: "var", name: "corner", equals: 4, label: "All four corners were reached (corner is 4)", hint: "Count a corner when dist to it falls below a small radius, then make the next corner the goal and go back to FACE." },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", min: 11.6, max: 12.6, label: "The robot drove the 12 ft of the square" },
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.25, label: "It ends within 0.25 ft (3 inches) of the start" },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: -0.1, max: 0.1, label: "It looks along +x again (heading within 0.1 rad of 0)", hint: "After the last corner, turn on the spot until theta0 - theta, wrapped into -PI ... PI, is small." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.08, label: "Within 0.08 ft (one inch) of the start" },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 18000, equals: 0, tol: 0.05, label: "Home and stopped within 18 s" },
        ISR_BUDGET,
      ],
      watch: ["corner", "state", "x", "y", "theta", "dist", "eTheta"],
      hints: [
        "`float wpX[4] = {4.0, 4.0, 1.0, 1.0}; float wpY[4] = {2.0, 5.0, 5.0, 2.0};` and the goal starts at the first corner: `float xGoal = 4.0; float yGoal = 2.0;`",
        "In DRIVE, when dist is small: `corner++;` then, if `corner < 4`, `xGoal = wpX[corner]; yGoal = wpY[corner]; state = 0;` (FACE), else go to a new state HOME, for example `state = 5;`.",
        "`case 5: eHome = theta0 - theta;` then the two wrap lines on eHome, `vref = 0.0; turn = -2.0 * eHome;` (limited to -1 ... 1), and `if (fabs(eHome) < 0.02) { state = 2; } break;`. Let DRIVE go up to 2.5 ft/s.",
      ],
      takeaway: "Waypoints in room coordinates do not add up their errors; steps relative to the last pose do. The error that remains on a real floor is the wheels' slip, and no amount of code in this file can see it.",
    },
    {
      id: "cap-p-slalom",
      kind: "code",
      mode: "write",
      tier: "practice",
      continues: "cap-final",
      title: "Practice: round the posts, there and back",
      goal: "Drive past three posts to the far end of a hall, and back again after the posts have been moved.",
      refs: [{ course: "L14", slide: [35, 37] }, { course: "L16", slide: 31, note: "which points look ahead" }, { course: "Lab 6" }],
      brief: `
A hall, 12 ft long and 6 ft wide. **Three round posts**, each 0.6 ft thick, stand on the straight line from the start, **(1, 3)**, to the goal, **(11, 3)**. The robot starts looking along +x.

Your checkpoint program already knows what to do with something in the way: TURN left until it sees free floor, PASS, FACE the goal again. A post is only a smaller block. So this level is mostly numbers, plus one new rule.

## Two trips
The test runs the mission twice, so that a list of moves that fits one hall does not pass.

- **Trip 1** starts at 0 s. The robot must stand still at (11, 3) by **12.5 s**.
- **Trip 2** starts at 12.5 s. The posts have been moved, and the goal is now the place the robot came from, **(1, 3)**. It must stand still there by 28 s.

Your program cannot see that the posts moved, and it does not need to. It only has to start again. Add a global \`uint16_t trip = 0;\` and, in DONE (\`default:\`), after the two lines that stop the robot:

\`\`\`c
if (trip == 0 && numTimer0calls >= 12500) {
    trip = 1;
    xGoal = 1.0;
    yGoal = 3.0;
    state = 0;
}
\`\`\`

\`numTimer0calls\` counts milliseconds, so 12500 is 12.5 s. \`navigate()\` works out \`dist\` and \`eTheta\` for the new goal before the next pass, and FACE turns the robot round.

## What to change
1. **In the globals:** the start, \`y = 3.0\`; the goal, (11.0, 3.0); and \`trip\`.
2. **In DONE:** the lines above.
3. **In PASS:** at 1.0 ft/s the trips do not fit in their time. Pass at \`vref = 1.5\`.

## The test
Both arrivals on time, standing still, and no post touched. Stars: less than 24 ft driven in all (the two straight lines add up to 20 ft), and the short 1 ms loop.

Watch the Robot arena: at 12.5 s the posts jump and the goal moves back to the start.
`,
      kit: "robot",
      durationMs: 28000,
      stimuli: trips({ kind: 2, seeds: [0, 1], start: SLALOM.start, goal: SLALOM.goal, swapMs: SLALOM.swapMs }),
      starter: SLALOM_STARTER,
      solution: S_SLALOM,
      checks: twoTrips({
        swapMs: SLALOM.swapMs,
        there: "the far end, (11, 3)",
        back: "the start, (1, 3)",
        hintThere: "Still on the way at 12.5 s: PASS at 1.0 ft/s is too slow, use vref = 1.5 there. Standing in front of a wall: the start is (1.0, 3.0) and the goal (11.0, 3.0), both in the globals.",
        hintBack: "Still at (11, 3): DONE never starts the second trip. In default: when trip is 0 and numTimer0calls >= 12500, set trip = 1, the goal to (1.0, 3.0) and state = 0. On the way but late: trip 1 must be over by 12.5 s, or the second trip starts late.",
        hintLate: "Still rolling when the time is up: the trip takes too long. In PASS, drive at vref = 1.5 instead of 1.0.",
        hintCrash: "A post is 0.6 ft thick and the robot 0.7 ft. After TURN the robot must be well past the post before it faces the goal again: PASS for 2 ft, as in the checkpoint, not less.",
      }),
      bonus: [{ kind: "signal", name: "ROBOT_ODOMETER_FT", max: 24, label: "Drove less than 24 ft on the two trips" }, ISR_BUDGET],
      watch: ["trip", "state", "x", "y", "front_ft", "dist", "passStart"],
      hints: [
        "Change the start and the goal first and run it. Trip 1 already works, a little late. Then look at what the robot does after 12.5 s: nothing, because DONE has no rule for it.",
        "`uint16_t trip = 0;` in the globals. In `default:`, after `turn = 0.0;`: `if (trip == 0 && numTimer0calls >= 12500) { trip = 1; xGoal = 1.0; yGoal = 3.0; state = 0; }`",
        "`float y = 3.0;`, `float xGoal = 11.0;`, `float yGoal = 3.0;`, and in `case 4:` `vref = 1.5;` instead of 1.0. Keep `travel - passStart > 2.0`.",
      ],
      takeaway: "The posts moved and the program did not change: rules that read the sensor fit a world they have never seen. A list of moves fits one.",
    },
    {
      id: "cap-x-trap",
      kind: "code",
      mode: "write",
      tier: "expert",
      continues: "cap-final",
      title: "Expert: out of the dead end",
      goal: "Reach a goal behind a U-shaped wall, where steering straight at the goal leads into a trap.",
      refs: [{ course: "L14", slide: [37, 35], note: "the wall follower; the Bug algorithms themselves are not in the lectures" }, { course: "L18", slide: 24, note: "planning with a map, for contrast" }, { course: "Lab 6" }],
      brief: `
The goal is at **(8.5, 5)**, straight ahead of the start at **(1.5, 5)**. Between them stands a wall bent into a **U**, open towards the robot. The checkpoint program drives in, turns, passes, faces the goal and drives in again, for ever. That is **Bug 0** from chapter 19 ("Planning without a map").

## The way out
- **Follow the wall.** The wall follower of chapter 17 keeps a wall on the robot's right: \`vref = 1.5\`, \`turn = 2.0 * (right_ft - 1.1)\`, limited to -1.0 ... 1.0. \`right_ft\` is the smallest of points 52 to 56 of the scan, 63 degrees to the right. A wall too far away gives a positive \`turn\`, to the right, so the robot also goes round the end of a wall.
- **Remember where you hit.** When DRIVE is blocked, store \`dHit = dist\`. Leave the wall only when the goal is nearer than that, \`dist < dHit - 0.5\`, **and** there are 2 ft of free floor towards it, \`goal_ft > 2.0\`.

The 100 ms interrupt looks towards the goal. Point 113 looks straight ahead; there are 54.3 points per radian:

\`\`\`c
goalPoint = 113 + (int)(54.3 * eTheta);
if (goalPoint >= 10 && goalPoint <= 217) {
    goal_ft = min_ft(goalPoint - 10, goalPoint + 10);
} else {
    goal_ft = 0.0;   // behind the robot
}
\`\`\`

\`(int)\` cuts a float down to a whole number. \`goalPoint\` is an \`int16_t\`.

## The states
FACE, DRIVE and DONE stay. TURN (\`turn = -1.5\` until \`front_ft > 2.0\`) leads to **FOLLOW**, which replaces PASS. FOLLOW goes to TURN when \`front_ft < 1.2\`, and to FACE when both conditions for leaving hold.

## Two trips
At **13 s** the U is turned round and changed, and the goal becomes the start, (1.5, 5). In DONE: \`if (trip == 0 && numTimer0calls >= 13000)\`, set \`trip = 1\`, the new goal and \`state = 0\`. \`trip\` is a new global, 0 at first.

## The test
Standing at the goal by 13 s, back at the start by 28 s, nothing touched. Stars: there within 12 s, less than 27 ft driven, the short 1 ms loop.

In the Robot arena the checkpoint program draws the same loop in the U again and again.
`,
      kit: "robot",
      durationMs: 28000,
      stimuli: trips({ kind: 3, seeds: [0, 1], start: TRAP.start, goal: TRAP.goal, swapMs: TRAP.swapMs }),
      starter: TRAP_STARTER,
      solution: S_TRAP,
      checks: twoTrips({
        swapMs: TRAP.swapMs,
        there: "the goal, (8.5, 5)",
        back: "the start, (1.5, 5)",
        hintThere: "Watch state, dist and dHit. In and out of the U for ever: the robot leaves the wall as soon as it sees free floor towards the goal, as Bug 0 does. Leave only when dist < dHit - 0.5 as well, with dHit = dist stored when DRIVE is blocked. Curving away from the wall: a wall too far away must give a positive turn, turn = 2.0 * (right_ft - 1.1). Still at (1.5, 5): the goal in the globals is not (8.5, 5.0).",
        hintBack: "Standing at (8.5, 5): DONE must start the second trip, when trip is 0 and numTimer0calls >= 13000. Moving but not home: the U now opens the other way and its arms have moved, so turns learnt for the first trip do not fit. Only the rules that read the LIDAR work for both.",
        hintLate: "Still moving when the time is up. Circling the U: see the first check. Nearly there: FOLLOW at vref = 1.5 and TURN at turn = -1.5, and let FACE and DRIVE take over as soon as both conditions for leaving hold.",
        hintCrash: "The robot is 0.7 ft wide. Going round the end of a wall at 1.5 ft/s needs the limit of turn at 1.0 (an arc of 0.9 ft), and TURN must start 1.2 ft before a wall.",
      }),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 12000, max: 0.15, label: "At the goal within 12 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 27, label: "Drove less than 27 ft on the two trips" },
        ISR_BUDGET,
      ],
      watch: ["trip", "state", "dist", "dHit", "front_ft", "right_ft", "goal_ft", "eTheta"],
      hints: [
        "Build it in two steps. First FOLLOW without ever leaving: the robot should go round and round the U at a steady distance. Then add the rule for leaving.",
        "`case 4: vref = 1.5; turn = 2.0 * (right_ft - 1.1);` then limit turn to -1.0 ... 1.0, then `if (front_ft < 1.2) { state = 3; } else if (dist < dHit - 0.5 && goal_ft > 2.0) { state = 0; } break;`. In DRIVE, `dHit = dist;` goes next to `state = 3;`.",
        "In cpu_timer1_isr(): `right_ft = min_ft(52, 56);` and the six lines for goal_ft from the brief. Globals: `float right_ft = 19.0; float goal_ft = 0.0; int16_t goalPoint = 113; float dHit = 0; uint16_t trip = 0;`. TURN ends at `front_ft > 2.0` with `state = 4;` and no passStart.",
      ],
      takeaway: "A robot that only ever asks \"where is the goal?\" walks into every dead end. Remembering one number, how far the goal was when it got stuck, is enough to know when leaving the wall is progress.",
    },
    {
      id: "cap-x-maze",
      kind: "code",
      mode: "write",
      tier: "expert",
      continues: "cap-final",
      title: "Expert: through the maze",
      goal: "Find the way through a maze to the goal cell with one hand on the wall, and back through a second maze.",
      refs: [{ course: "L14", slide: [35, 37, 44], note: "the state machine for maze solving and the right-wall follower" }, { course: "L18", slide: 24, note: "planning with a map, for contrast" }, { course: "Lab 6" }],
      brief: `
A maze of 4 by 4 cells, each 2 ft square. The robot starts in the middle of the cell at **(1, 1)**, looking along +x. The goal is the middle of the opposite corner cell, **(7, 7)**. Your program knows where the goal is, but not where the walls are.

## One hand on the wall
Put your right hand on the wall of a maze and walk, never letting go. In a **perfect maze**, one with exactly one way between any two cells, every wall hangs together with the outer wall. So your hand slides along all of them, and you pass through every cell, the goal cell too. The robot's hand is the wall follower of chapter 17.

Take a few walls away and there are loops: some walls now stand free, like islands. A goal that touches only an island is never passed, and the robot circles for ever. Then it needs a map and the search of chapter 19.

## The mission
Three states. FACE and DRIVE go.

- **FOLLOW** (the robot starts here): \`vref = 1.2\`, \`turn = 2.0 * (right_ft - 1.1)\`, limited to -0.7 ... 0.7. \`right_ft\` is the smallest of points 52 to 56 of the scan, 63 degrees to the right: work it out in the 100 ms interrupt. Where the wall on the right ends, \`turn\` is at its limit and the robot curves round the end in an arc of 0.6 * 1.2 / 0.7 = 1 ft, half a cell. When \`dist < 0.5\` it is in the goal cell: DONE. When \`front_ft < 1.1\`: TURN.
- **TURN**: left on the spot, \`turn = -1.0\`, until \`front_ft > 2.0\`. Then FOLLOW.
- **DONE**: stand still.

## Two trips
At **12 s** the walls are rebuilt as another maze, and the goal becomes the start cell, (1, 1). In DONE, when \`trip == 0\` and \`numTimer0calls >= 12000\`: set \`trip = 1\`, the new goal, and the state back to FOLLOW. \`trip\` is a new global, 0 at first.

## The test
Standing within 0.8 ft of the goal by 12 s, back in the start cell by 28 s, no wall touched. Stars: there within 11.5 s, less than 24 ft driven, the short 1 ms loop.

Replay the run in the Robot arena: the trail hugs the right wall.
`,
      kit: "robot",
      durationMs: 28000,
      stimuli: trips({ kind: 5, seeds: [MAZE.seedA, MAZE.seedB], size: MAZE.size, start: MAZE.start, goal: MAZE.goal, swapMs: MAZE.swapMs }),
      starter: MAZE_STARTER,
      solution: S_MAZE,
      checks: twoTrips({
        swapMs: MAZE.swapMs,
        there: "the middle of the goal cell, (7, 7)",
        back: "the middle of the start cell, (1, 1)",
        tol: 0.8,
        hintThere: "Watch state and right_ft in a live run. Wandering through other cells: is the hand on the right wall (points 52 to 56)? Here the right-hand way is 6 cells long and the left-hand way 18. Driving past openings on the right: the arc is too wide for a 2 ft cell. Its radius is 0.6 * vref / (limit of turn): 1.2 ft/s needs a limit of 0.7. Spinning: a wall too far away must give a positive turn. In the goal cell but moving on: FOLLOW must go to DONE when dist < 0.5.",
        hintBack: "Standing in the goal cell: DONE must start the way back, when trip is 0 and numTimer0calls >= 12000, with the goal (1.0, 1.0) and the state of FOLLOW. Blocked or lost: the second maze has its walls elsewhere, so a route learnt in the first one does not fit. Only rules that read the LIDAR work in both.",
        hintLate: "Still moving when the time is up. The right-hand way is 6 cells on each trip, about 10 s at 1.2 ft/s. More than that: the robot follows the left wall, misses openings on its right, or does not stop in the goal cell (dist < 0.5).",
        hintCrash: "The robot is 0.7 ft wide in a 2 ft corridor. Keep the wall at right_ft = 1.1, start TURN 1.1 ft before a wall ahead, and do not drive faster than the arc allows.",
      }),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 11500, max: 0.8, label: "In the goal cell within 11.5 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 24, label: "Drove less than 24 ft on the two trips" },
        ISR_BUDGET,
      ],
      watch: ["trip", "state", "x", "y", "dist", "front_ft", "right_ft"],
      hints: [
        "Start with FOLLOW and TURN only and watch a live run: the robot should stay in the middle of the corridor, curve into every opening on its right and turn left where it is boxed in.",
        "`case 4: vref = 1.2; turn = 2.0 * (right_ft - 1.1);` then limit turn to -0.7 ... 0.7, then `if (dist < 0.5) { state = 2; } else if (front_ft < 1.1) { state = 3; } break;` and `case 3: vref = 0.0; turn = -1.0; if (front_ft > 2.0) { state = 4; } break;`",
        "Globals: `uint16_t state = 4;`, `float right_ft = 19.0;`, `uint16_t trip = 0;`, start `x = 1.0; y = 1.0;`, goal (7.0, 7.0). In cpu_timer1_isr(): `right_ft = min_ft(52, 56);`. In `default:` after stopping: `if (trip == 0 && numTimer0calls >= 12000) { trip = 1; xGoal = 1.0; yGoal = 1.0; state = 4; }`",
      ],
      takeaway: "Two rules, no map, any perfect maze. What the wall follower cannot do is know that a shorter way exists, or find a goal on an island: for that the robot has to remember where it has been, which is where mapping begins.",
    },
  ],
};
