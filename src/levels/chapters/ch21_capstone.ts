import type { Chapter } from "../types";
import type { Check, Stimulus } from "../../sim/runner";

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

// ---------- the room ----------

/** Room 3 of lidar.ts: a 10 ft x 10 ft box with a 1 ft block at x 7..8, y 6..7. */
const ROOM = 3;
/** Start pose used by the whole chapter. */
const START: [number, number, number] = [1, 2, 0];

const world = (o: { room?: number; start?: [number, number, number]; goal?: [number, number] } = {}): Stimulus[] => {
  const s = o.start ?? START;
  return [
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
uint32_t numScans = 0;          // complete scans received`;

const SERIAL_FNS = (first: number, last: number) => `// Runs every 100 ms: ask the LIDAR for a scan (chapter 17)
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
}

// Called when a reply is complete: the nearest thing ahead,
// points ${first} to ${last}, 20 degrees to each side
void scan_done(void)
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
                // two line feeds in a row: the reply is complete
                read_ladar_state = 0;
                scan_done();
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
}

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : `${+v.toFixed(8)}`);

/**
 * The program after stage n:
 * 1 motors, 2 encoders, 3 PI speed control, 4 steering and heading,
 * 5 dead reckoning and the goal, 6 LIDAR.
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
  add(n >= 6, `__interrupt void cpu_timer1_isr(void);`);
  add(true, `void init_EPWM1and2(void);
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);
void init_eQEPs(void);`);
  add(n >= 2, `float readEncLeft(void);
float readEncRight(void);`);
  add(n >= 6 && !o.serial, `float min_ft(int first, int last);`);
  add(n >= 6 && !!o.serial, `void scan_done(void);`);
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
  add(n >= 6 && !!o.serial, SERIAL_GLOBALS);
  add(n >= 6 && !o.serial, `
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
  add(n >= 6, `    PieVectTable.TIMER1_INT = &cpu_timer1_isr;`);
  add(n >= 6 && !!o.serial, `    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;`);
  add(true, `    EDIS;

    // Timer 0 interrupts every 1 ms (1000 microseconds): the control loop
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;`);
  add(n >= 6, `    // Timer 1 interrupts every 100 ms: the LIDAR
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;`);
  add(n >= 6 && !!o.serial, `
    // The LIDAR is on SCIC, 115200 baud
    init_serialSCIC(&SerialC, 115200);`);
  add(true, `
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;`);
  add(n >= 6 && !!o.serial, `    IER |= M_INT8;   // SCIC`);
  add(n >= 6, `    IER |= M_INT13;  // CPU Timer 1`);
  add(true, `    EINT;
    ERTM;

    while (1) {
    }
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
  add(n >= 5, `${POSE}
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
  add(n >= 6, `${(o.serial ? SERIAL_FNS : LIDAR_FNS)(94, 132)}
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
    // Open loop: effort 5 for 1.35 s, then stop
    if (numTimer0calls <= 1350) {
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
    // 1 s at a speed the robot cannot reach, then 1 ft/s
    if (numTimer0calls <= 1000) {
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
const M_GOTO = `
${GOAL_GEOMETRY}

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

// Stage 6: the same, but stop when the LIDAR sees something close ahead.
const M_WALL = `
${GOAL_GEOMETRY}

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

// Stage 7: go around what is in the way.
const G_FINAL = `${G_STATE}
float passStart = 0;      // travel when the robot began to pass the obstacle, ft`;
const mFinal = (o: { vmax?: number; pass?: number; blocked?: number; clear?: number; vpass?: number } = {}) => `
${GOAL_GEOMETRY}

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
uint16_t corner = 0;      // corners reached so far`;
const mSquare = (vmax: number) => `
    if (corner < 4) {
        xGoal = wpX[corner];
        yGoal = wpY[corner];
    }
${GOAL_GEOMETRY}

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
        eTheta = theta0 - theta;
        while (eTheta > PI) eTheta = eTheta - 2.0 * PI;
        while (eTheta < -PI) eTheta = eTheta + 2.0 * PI;
        vref = 0.0;
${STEER_TO_GOAL}
        if (fabs(eTheta) < 0.02) {
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
const S_WALL = program(6, { mission: M_WALL, globals: G_STATE, goal: GOAL_WALL });
const S_FINAL = program(6, { mission: mFinal(), globals: G_FINAL, goal: GOAL_FINAL });

// Practice: other places.
const CORNER = { start: [8.8, 9, Math.PI] as [number, number, number], goal: [6.5, 4.5] as [number, number] };
const DOOR = { room: 4, start: [8.5, 2, Math.PI / 2] as [number, number, number], goal: [12, 7.25] as [number, number] };
const S_CORNER = program(6, { mission: mFinal(), globals: G_FINAL, ...CORNER });
const S_DOOR = program(6, { mission: mFinal(), globals: G_FINAL, start: DOOR.start, goal: DOOR.goal });

// Expert.
const S_FAST = program(6, { mission: mFinal({ vmax: 3, blocked: 1.5, vpass: 2 }), globals: G_FINAL, goal: GOAL_FINAL });
const S_SERIAL = program(6, { mission: mFinal(), globals: G_FINAL, goal: GOAL_FINAL, serial: true });
const S_SQUARE = program(6, { mission: mSquare(2.5), globals: G_SQUARE, goal: [START[0], START[1]] });

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
  { after: "// ---- Decide: the mission ----", todo: "// TODO 2: new mission. vref = 4.0 during the first second, then 1.0 (replace the lines below)" },
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

const WALL_STARTER = withTodos(S_GOTO, [
  { after: "__interrupt void cpu_timer0_isr(void);", todo: "// TODO 1: prototypes of cpu_timer1_isr() and min_ft()" },
  { after: "float eTheta = 0;", todo: "// TODO 2: globals front_ft (start at 19.0) and numScans. Set the goal to (12.0, 2.0)" },
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
  { before: "// Smallest reading, in feet", todo: "// TODO 5: RXCINT_recv_ready() fills ladar_ft[]; scan_done() computes front_ft from it" },
]);

const SQUARE_STARTER = withTodos(S_FINAL, [
  { after: "float passStart = 0;", todo: "// TODO 1: the four corners, and a global corner that counts the corners reached" },
  { after: "// ---- Decide: the mission ----", todo: "// TODO 2: new mission. Visit the corners in order, then turn back to the starting heading" },
]);

// ---------- checks shared by the room levels ----------

const arrived = (hint?: string): Check[] => [
  { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.15, label: "The robot ends within 0.15 ft of the goal", hint },
  ...stopped(),
  NO_CRASH,
];

const ISR_BUDGET: Check = {
  kind: "isr-time",
  fn: "cpu_timer0_isr",
  maxUs: 4,
  label: "The 1 ms loop never takes more than 4 microseconds",
  hint: "Reading 39 LIDAR points belongs in the 100 ms interrupt. The 1 ms loop only uses the result.",
};

const ROOM_NOTE = `
**The room** is a 10 ft by 10 ft box with a 1 ft block at x = 7 to 8, y = 6 to 7. The robot is a disc 0.35 ft in radius. It starts at (1, 2), looking along +x. The meters "Robot x", "Robot y" and "Robot heading" show the truth. Your program never sees them: it has only its encoders and, later, the LIDAR.
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
      refs: [{ course: "Lab 5" }, { course: "Lab 6" }, { course: "L11" }, { course: "L14" }],
      brief: `
So far every chapter gave you one part of the robot and a test bench to try it on. On the real robot the parts run together, in one program, and each one feeds the next. This chapter builds that program. At the end the robot crosses a room on its own, around an obstacle, to a point you give it.

## Two loops
**Every 1 ms**, CPU timer 0 interrupts and one function does five things, always in this order:

1. **Measure**: read both encoder counters, turn counts into wheel angles, and the change since the last pass into wheel speeds in ft/s (chapter 11).
2. **Estimate**: update the heading and the position from what the wheels did (chapter 18).
3. **Decide**: a small state machine looks at the estimate and at the LIDAR and sets two numbers, the speed command \`vref\` and the turn command \`turn\` (chapter 17).
4. **Control**: the steering error and one PI loop per wheel turn \`vref\` and \`turn\` into two control efforts, \`uLeft\` and \`uRight\`, from -10 to 10 (chapter 16).
5. **Act**: \`setEPWM1A\` and \`setEPWM2A\` turn the efforts into duty cycles. The H-bridge turns duty into motor voltage, and the wheels turn (chapters 9 and 10).

The wheels turn the encoders, and the next pass measures the result. That is the feedback loop.

**Every 100 ms**, CPU timer 1 interrupts and the program looks at the LIDAR scan (chapter 17). It stores one number, the distance to the nearest thing ahead, for the Decide step to use. A scan only arrives ten times a second, so there is no reason to look more often.

## How this chapter works
- It is **one file**. Each level opens with your own code from the level before. If you skipped a level you get the reference version instead.
- Each level adds one part and says exactly where it goes. The part is something you have written before. The brief names the chapter, so you can look at your old solution.
- The **Decide** step is "the mission". It is rewritten in almost every level. Everything else stays and grows.
- The tests watch what the **robot does**: where it ends, whether it stopped, whether it touched a wall. Where a test needs to read one of your variables, the brief gives its name.

Keep the file tidy. You will be reading it for the rest of the chapter.

## The plan
1. Motors, open loop: drive about 2 ft.
2. Encoders: drive exactly 3 ft.
3. PI speed control: hold 1 ft/s.
4. Steering: drive straight, then turn 90 degrees.
5. Dead reckoning: drive to a point.
6. LIDAR: stop in front of a wall.
7. Checkpoint: drive to a point behind an obstacle.
${ROOM_NOTE}`,
      questions: [
        {
          prompt: "The motors are driven by one PWM signal each (chapter 10). Which duty cycle stops a motor?",
          options: ["0 %", "50 %", "100 %", "Any, as long as CMPA is 0"],
          answer: 1,
          why: "The PWM pin switches the H-bridge between full voltage one way and full voltage the other way. At 50 % the average is zero. That is why setEPWM1A maps an effort of 0 to half of TBPRD.",
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
          why: "The two motors face each other. For the robot to go forward they must turn in opposite directions as seen from the motor. The sign belongs at the call, so that uRight keeps its meaning (positive is forward) everywhere else.",
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
          why: "The backward difference: v = (p_now - p_old) / 0.001. The old angle is kept in a global variable and updated at the end of every pass.",
        },
        {
          prompt: "The PI controller of chapter 16 stops adding to its integral while the effort is at the limit. What happens without that?",
          options: [
            "Nothing: the limit already protects the motor",
            "The integral keeps growing while the wheel cannot follow, and the wheel then overshoots for a long time",
            "The proportional part becomes too small",
            "The encoder overflows",
          ],
          answer: 1,
          why: "This is integrator windup. The effort stays at the limit until the stored-up integral has been worked off again, long after the speed has passed the command. You will see it on this robot in level 5.",
        },
        {
          prompt: "Why does the LIDAR get its own 100 ms interrupt instead of being read in the 1 ms loop?",
          options: [
            "The 1 ms loop is not allowed to call functions",
            "A new scan only arrives every 100 ms, and going through it takes much longer than the rest of the control loop",
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
      refs: [{ course: "Lab 5" }, { course: "L11" }, { course: "L15" }],
      brief: `
This is the 1 ms function you will have written by the end of the chapter, cut into steps and shuffled. Put the steps back in order.

Ask of each step: **what does it need?** A step can only run after the steps that produce its inputs.

- A speed needs two angles: this pass's and the last one's.
- The position step needs the speed, to know how far the robot moved in this millisecond.
- The decision needs to know where the robot is.
- The controller needs the commands and the measured speeds.
- The motors get the efforts last, and the interrupt is acknowledged at the very end, as in every timer 0 function.

While you sort, name the chapter each step came from. The answer is shown when you are done.
`,
      steps: [
        "Timer 0 reaches zero and cpu_timer0_isr starts",
        "Read EQep1 and EQep2: the two wheel angles in radians",
        "Wheel speeds in ft/s: (angle now - angle 1 ms ago) x (1.235/12) / 0.001, then save the angles",
        "Dead reckoning: update theta, then x and y, from the wheel angles and speeds",
        "The mission's state machine sets vref and turn from the pose and the LIDAR distance",
        "eSteer = vRight - vLeft + turn, then the two wheel errors eLeft and eRight",
        "PI for each wheel, limited to -10 ... 10 with anti-windup: uLeft and uRight",
        "setEPWM1A(uLeft); setEPWM2A(-uRight);",
        "PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;",
      ],
      hints: [
        "Start with the two ends: the timer starts the function, the acknowledge ends it.",
        "Measure before you estimate, estimate before you decide, decide before you control.",
        "Encoders (11), speeds (11), dead reckoning (18), state machine (17), steering error (16), PI (16), PWM (10), acknowledge (5).",
      ],
      takeaway: "Encoders and speeds are chapter 11, dead reckoning chapter 18, the state machine chapter 17, steering and PI chapter 16, the PWM calls chapter 10, PIEACK chapter 5. Nothing in the loop is new. The order is.",
    },
    {
      id: "cap-open",
      kind: "code",
      mode: "complete",
      title: "Motors: drive 2 ft, open loop",
      goal: "Bring up both motor PWM channels and drive the robot about 2 ft forward by timing alone.",
      refs: [{ course: "Lab 3" }, { trm: "15" }],
      brief: `
The file you see is the skeleton of the whole chapter: \`main\`, a 1 ms timer interrupt, and at the bottom the hardware functions. Read it once from top to bottom.

This level brings back the motors of **chapter 10** (Lab 3, exercise 2). The left motor is on EPWM1A (GPIO0), the right motor on EPWM2A (GPIO2), both at 20 kHz, and 50 % duty is stopped. Five things are missing:

1. In \`init_EPWM1and2()\`: the set-up of **EPWM2**. It is the same ten lines as EPWM1, which is written.
2. In the same function: the pin mux call that gives **GPIO2** to EPWM2A (mux position 1, as for GPIO0).
3. The body of \`setEPWM2A()\`. \`setEPWM1A()\` is written. This is your function from the chapter 10 level "setEPWM1A and setEPWM2A".
4. In \`cpu_timer0_isr\`, under "Decide": **the mission**. Set \`uLeft\` and \`uRight\` to 5 for the first part of the run and to 0 after that. \`numTimer0calls\` counts milliseconds.
5. Under "Act": send \`uRight\` to the right motor. The right motor is mounted mirrored.

\`init_eQEPs()\` at the bottom is not used yet. It is Lab 3's encoder set-up, in the file for the next level.

## How long is "the first part"?
On this robot an effort of 5 settles at about **1.5 ft/s**. The motor needs a moment to get going and a moment to stop, and the two roughly cancel. Work out the time for 2 ft.

This is **open loop** control: the program sends a command and never looks at the result. The tests accept anything from 1.7 to 2.3 ft, because open loop cannot promise more. A lower battery, a carpet or a heavier robot would change the answer. On the real robot it would not even drive straight, because no two motors are the same. The simulated motors are identical, so here it does. The next levels remove the guessing.
${ROOM_NOTE}`,
      kit: "robot",
      durationMs: 3000,
      stimuli: world(),
      starter: OPEN_STARTER,
      solution: S_OPEN,
      checks: [
        { kind: "signal", name: "ROBOT_ODOMETER_FT", min: 1.7, max: 2.3, label: "The robot drove between 1.7 and 2.3 ft", hint: "Nothing moves until GPIO2 and GPIO0 carry a PWM signal and the efforts are not 0. Too far or too short: time = distance / speed." },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: -0.1, max: 0.1, label: "It drove straight (heading within 0.1 rad)", hint: "Spinning on the spot: both motors got the same sign. The right motor is mirrored and needs setEPWM2A(-uRight)." },
        { kind: "signal", name: "ROBOT_X_FT", min: 2.5, label: "It drove forward, along +x", hint: "Backwards: both signs are flipped. The minus belongs only on the right motor." },
        ...stopped(),
        NO_CRASH,
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD" },
      ],
      bonus: [{ kind: "signal", name: "ROBOT_ODOMETER_FT", min: 1.9, max: 2.1, label: "Within 0.1 ft of 2 ft, by arithmetic alone" }],
      watch: ["numTimer0calls", "uLeft", "uRight"],
      inspect: ["EPwm1Regs.CMPA", "EPwm2Regs.CMPA"],
      hints: [
        "Do the hardware first (1 to 3 and 5), with a fixed effort, and watch the two wheel speed meters. Then write the timing.",
        "setEPWM2A is setEPWM1A with EPwm2Regs. The call is `setEPWM2A(-uRight);`. The mux call is `GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);`.",
        "2 ft at 1.5 ft/s is 1.33 s: `if (numTimer0calls <= 1350) { uLeft = 5.0; uRight = 5.0; } else { uLeft = 0.0; uRight = 0.0; }`",
      ],
      takeaway: "Open loop gets you roughly there on a good day. Note the two lines under \"Act\": from now on everything above them only has to produce uLeft and uRight.",
    },
    {
      id: "cap-dist",
      kind: "code",
      mode: "write",
      continues: "cap-open",
      title: "Encoders: drive exactly 3 ft",
      goal: "Read both wheel encoders every millisecond, compute speeds and distance, and stop after 3 ft of measured travel.",
      refs: [{ course: "Lab 3" }, { trm: "17" }],
      brief: `
You continue in your file from the last level. Now the program gets eyes: the encoders of **chapter 11**.

## What to add
1. **Two read functions** at the bottom of the file, and their prototypes at the top. They are yours from the chapter 11 level on reading the encoders ("Read all three"):
   - \`float readEncLeft(void)\` returns the left wheel angle in radians from \`EQep1Regs.QPOSCNT\`
   - \`float readEncRight(void)\` returns the right wheel angle from \`EQep2Regs.QPOSCNT\`

   A wheel turn is 2000 x 20 = 40000 counts. Read the counter into an \`int32_t\` first. The **left** encoder counts down when the robot drives forward, so its factor is negative.
2. In \`main\`, after \`init_EPWM1and2();\`: call \`init_eQEPs();\`. The function is already in the file.
3. **Globals**: \`LeftWheel\`, \`RightWheel\` (angles now), \`LeftWheel_1\`, \`RightWheel_1\` (angles 1 ms ago), \`vLeft\`, \`vRight\` (speeds in ft/s) and \`travel\` (distance driven in ft). All \`float\`, all starting at 0.
4. A **Measure** section at the top of \`cpu_timer0_isr\`, after \`numTimer0calls++;\` and before the mission. This is your code from the chapter 11 level "How fast, how far":
   - read both angles
   - speed by backward difference: \`vLeft = (1.235/12.0) * (LeftWheel - LeftWheel_1) / 0.001;\` and the same for the right wheel. Chapter 11 called these LeftVel and RightVel
   - save the angles for the next pass
   - \`travel\` is the average of the two wheel angles times \`(1.235/12.0)\`
5. **The mission**, replacing the timed one: drive until \`travel\` reaches 3 ft, then set both efforts to 0.

## Stopping on the line
At effort 5 the robot rolls another 0.07 ft after the effort goes to 0. The tests allow 0.05 ft. So do what you do with a car: slow down before the line. A low effort such as 1.5 gives about 0.35 ft/s, and from there the robot stops almost at once.

The tests read your global \`travel\`, and they measure the real distance with the room's odometer.
`,
      kit: "robot",
      durationMs: 4000,
      stimuli: world(),
      starter: DIST_STARTER,
      solution: S_DIST,
      checks: [
        { kind: "signal", name: "ROBOT_ODOMETER_FT", equals: 3, tol: 0.05, label: "The robot drove 3 ft, within 0.05 ft", hint: "Short by half: is travel the average of the two wheels, or their sum? Too far: slow down before 3 ft. Still moving at the end: the slow part is too slow." },
        { kind: "var", name: "travel", min: 2.95, max: 3.05, label: "Your variable travel says 3 ft too", hint: "travel = 0.5 * (LeftWheel + RightWheel) * (1.235/12.0). If it is negative, check the sign in readEncLeft." },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: -0.1, max: 0.1, label: "It drove straight" },
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
        "Add the Measure section first and watch travel while the old timed mission still runs: it should count up to about 2. Then change the mission.",
        "`raw = EQep1Regs.QPOSCNT; return (raw*(-2*PI/(2000.0*20.0)));` for the left wheel, the same without the minus and with EQep2Regs for the right. Save the old angles after computing the speeds, not before.",
        "`if (travel < 2.6) { uLeft = 5.0; uRight = 5.0; } else if (travel < 2.99) { uLeft = 1.5; uRight = 1.5; } else { uLeft = 0.0; uRight = 0.0; }`",
      ],
      takeaway: "The distance is now right whatever the battery does, because the program measures it. The speed is still whatever an effort of 5 happens to give. That is next.",
    },
    {
      id: "cap-speed",
      kind: "code",
      mode: "write",
      continues: "cap-dist",
      title: "PI control: hold 1 ft/s",
      goal: "Put a PI speed controller with saturation and anti-windup on each wheel, so the mission can command a speed instead of an effort.",
      refs: [{ course: "L11" }, { course: "Lab 5" }],
      brief: `
Until now the mission wrote the efforts itself. From this level on it only says how fast to go, in \`vref\` (ft/s), and a controller finds the efforts. This is the PI controller of **chapter 16**.

## What to add
1. **Globals**: \`vref\`, the gains \`Kp\` and \`Ki\`, the errors \`eLeft\`, \`eRight\`, the integrals \`ILeft\`, \`IRight\`, and \`INew\` for the anti-windup.
2. A **Control** section in \`cpu_timer0_isr\`, after the mission and before the two \`setEPWM\` calls. For each wheel:
   - the error: \`eLeft = vref - vLeft;\`
   - PI: \`uLeft = Kp * eLeft + Ki * (integral of eLeft)\`. One pass adds \`eLeft * 0.001\` to the integral
   - **saturation**: limit \`uLeft\` to -10 ... 10
   - **anti-windup**: while \`uLeft\` is at a limit, do not let the integral grow further in that direction. This is your block from the chapter 16 level on windup ("The wheel that would not slow down"), once per wheel, each wheel with its own integral
3. **The mission**, replacing the 3 ft one: \`vref = 4.0\` during the first second (\`numTimer0calls <= 1000\`), then \`vref = 1.0\`. The mission no longer touches \`uLeft\` and \`uRight\`.

## Gains for this robot
Each unit of effort adds about 0.32 ft/s, and the motor's time constant is 50 ms. **Kp = 5** and **Ki = 100** settle in a few tenths of a second without overshoot. Try others once it works.

## The test
- **First second**: 4 ft/s is asked. The robot's top speed is 3.1 ft/s, so both efforts sit at 10 and the error never goes away. This is exactly the situation that winds up an integral.
- **Then 1 ft/s**: half a second later the wheels must be within 6 % of 1 ft/s (9.72 rad/s on the wheel speed meters), and at the end they must hold it within 1.5 %. Without anti-windup they are still flat out 0.3 s after the command dropped.
`,
      kit: "robot",
      durationMs: 2500,
      stimuli: world(),
      starter: SPEED_STARTER,
      solution: S_SPEED,
      checks: [
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 900, min: 28, label: "Flat out while 4 ft/s is asked (the wheels reach 30 rad/s)", hint: "The mission must set vref = 4.0 for the first 1000 ms, and the efforts must come from the PI controller." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 1500, equals: RADPS_PER_FTPS, tol: 0.6, label: "0.5 s after the command drops, the left wheel is within 6 % of 1 ft/s (9.72 rad/s)", hint: "Still far too fast: the integral wound up during the first second. While the effort is at a limit, keep the new integral only if the error pulls it back." },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 2400, equals: RADPS_PER_FTPS, tol: 0.15, label: "The left wheel holds 1 ft/s within 1.5 %", hint: "A steady error that never goes away means the integral part is missing or never added to." },
        { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 2400, equals: RADPS_PER_FTPS, tol: 0.15, label: "The right wheel holds 1 ft/s within 1.5 %", hint: "Each wheel needs its own error, its own integral and its own effort." },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: -0.1, max: 0.1, label: "It drove straight" },
        NO_CRASH,
      ],
      bonus: [{ kind: "signal", name: "LEFT_WHEEL_RADPS", at: 1300, equals: RADPS_PER_FTPS, tol: 0.2, label: "Already at 1 ft/s (within 2 %) 0.3 s after the command drops" }],
      watch: ["vref", "vLeft", "vRight", "uLeft", "uRight", "ILeft", "IRight"],
      hints: [
        "Write the left wheel completely and run it: the robot will circle, but the left wheel meter must show 9.72 rad/s at the end. Then copy the block and change every Left to Right.",
        "`INew = ILeft + eLeft * 0.001; uLeft = Kp * eLeft + Ki * INew;` then limit uLeft, and store INew in ILeft only when that is allowed.",
        "`if (uLeft > 10.0) { uLeft = 10.0; if (eLeft < 0.0) ILeft = INew; } else if (uLeft < -10.0) { uLeft = -10.0; if (eLeft > 0.0) ILeft = INew; } else { ILeft = INew; }`",
      ],
      takeaway: "The mission now speaks in ft/s and the controller translates. Friction, battery voltage and the dead zone of the motor are the integral's problem, not the mission's.",
    },
    {
      id: "cap-steer",
      kind: "code",
      mode: "write",
      continues: "cap-speed",
      title: "Steering: straight, then a quarter turn",
      goal: "Add the steering coupling and a heading computed from the encoders, then drive 3 ft and turn left by 90 degrees on the spot.",
      refs: [{ course: "Lab 5" }, { course: "L11" }, { course: "L15" }],
      brief: `
Two things are added: a second command, \`turn\`, and the robot's first idea of where it is pointing.

## The steering coupling (chapter 16, "Speed and steering")
These are the three lines of the course's \`PIcontrol\` function. They replace your two error lines:

\`\`\`c
eSteer = vRight - vLeft + turn;
eLeft  = vref - vLeft  + Kturn * eSteer;
eRight = vref - vRight - Kturn * eSteer;
\`\`\`

The PI blocks stay as they are. With \`turn = 0\` the coupling holds the two wheels together: the slower wheel is pushed, the faster one held back. A **positive** \`turn\` makes the left wheel faster, so the robot turns **right**. To turn left, \`turn\` is negative. With \`Kturn = 3\` the wheels settle 6/7 of \`turn\` apart.

On the simulated floor both motors are identical and nothing disturbs a wheel, so the tests cannot tell whether the coupling holds a straight line. On the lab floor you would see it at once.

## The heading (chapter 18)
The robot turns when one wheel travels further than the other:

\`\`\`c
theta = theta0 + (RightWheel - LeftWheel) * (1.235/12.0) / WHEEL_BASE;
\`\`\`

\`WHEEL_BASE\` is the distance between the wheels, **0.6 ft**. \`theta0\` is the heading at the start (0 here). \`theta\` is in radians, positive counter-clockwise: a left turn makes it grow.

## What to add
1. \`#define WHEEL_BASE 0.6\` at the top.
2. **Globals**: \`turn\`, \`Kturn = 3.0\`, \`eSteer\`, \`theta0\`, \`theta\`, and \`uint16_t state = 0;\` for the mission.
3. An **Estimate** section after Measure: the heading line above.
4. In **Control**: the three lines above instead of the two error lines.
5. **The mission**, a state machine as in chapter 17:
   - **state 0**: \`vref = 1.0\`, \`turn = 0\`. When \`travel\` reaches 3 ft, go to state 1
   - **state 1**: \`vref = 0\`, and turn left until \`theta\` is PI/2. Make \`turn\` proportional to the angle still to go, \`turn = -2.0 * (PI/2.0 - theta)\`, limited to -1 ... 1, so the robot slows as it gets there. When less than 0.02 rad is left, go to state 2
   - **state 2**: \`vref = 0\`, \`turn = 0\`

## The test
At the end the robot stands at (4, 2), 3 ft from where it started, and looks along +y (heading 1.571 rad), within 0.08 rad.
`,
      kit: "robot",
      durationMs: 6500,
      stimuli: world(),
      starter: STEER_STARTER,
      solution: S_STEER,
      checks: [
        { kind: "signal", name: "ROBOT_X_FT", equals: 4, tol: 0.15, label: "The robot drove 3 ft along x before turning (x = 4)", hint: "State 0 ends when travel >= 3.0. While turning on the spot travel does not change, because the wheels move equal and opposite." },
        { kind: "signal", name: "ROBOT_Y_FT", equals: 2, tol: 0.15, label: "It turned on the spot (y is still 2)", hint: "vref must be 0 while turning." },
        { kind: "signal", name: "ROBOT_THETA_RAD", equals: Math.PI / 2, tol: 0.08, label: "It ends looking along +y: heading 1.571 rad, within 0.08", hint: "Turned right instead: a left turn needs a negative turn. Turned and never stopped: compare theta, not travel. Stopped short: theta uses the difference of the wheel angles in feet, divided by WHEEL_BASE." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_THETA_RAD", equals: Math.PI / 2, tol: 0.03, label: "Heading within 0.03 rad (under 2 degrees)" },
        { kind: "signal", name: "ROBOT_X_FT", equals: 4, tol: 0.06, label: "Stopped within 0.06 ft of x = 4 before turning" },
      ],
      watch: ["state", "travel", "theta", "vref", "turn", "vLeft", "vRight"],
      hints: [
        "Add the coupling and the heading first and keep the old mission: watch theta stay near 0 while the robot drives straight. Then write the switch.",
        "`switch (state) { case 0: vref = 1.0; turn = 0.0; if (travel >= 3.0) state = 1; break; case 1: ... break; default: vref = 0.0; turn = 0.0; break; }`",
        "State 1: `vref = 0.0; turn = -2.0 * (PI/2.0 - theta); if (turn < -1.0) turn = -1.0; if (turn > 1.0) turn = 1.0; if (fabs(PI/2.0 - theta) < 0.02) state = 2;`",
      ],
      takeaway: "The mission now has two knobs, vref and turn, and that is all any mission ever needs. A turn that slows down as the error shrinks is a proportional controller on the heading, wrapped around the PI loops.",
    },
    {
      id: "cap-goto",
      kind: "code",
      mode: "write",
      continues: "cap-steer",
      title: "Dead reckoning: drive to a point",
      goal: "Keep track of x and y as well as the heading, and use the pose to drive the robot to the point (4, 5).",
      refs: [{ course: "L15" }, { course: "Lab 5" }, { course: "HW4" }],
      brief: `
The robot knows its heading. Add the position and it knows where it is. This is the dead reckoning of **chapter 18**, and the first mission that uses it.

## The position
Every millisecond the robot moves forward by its speed times 0.001 s, in the direction it is pointing. Its speed is the average of the two wheels:

\`\`\`c
x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;
\`\`\`

These go right after the heading line. The robot starts at **(1, 2)** in the room, so \`x\` and \`y\` start at 1.0 and 2.0, not at 0.

## Where is the goal from here?
With the pose, two numbers say everything about the goal (\`xGoal\`, \`yGoal\`):

- how far: \`dist = sqrt(dx*dx + dy*dy)\`, with dx and dy from the robot to the goal
- which way to turn: the **heading error** \`eTheta = atan2(dy, dx) - theta\`

A heading error must be **wrapped** into -PI ... PI. Otherwise "turn left by 350 degrees" is the answer when "turn right by 10" was meant. Add or subtract 2 PI until it fits.

## What to add
1. **Globals**: \`x = 1.0\`, \`y = 2.0\`, \`xGoal = 4.0\`, \`yGoal = 5.0\`, \`dist\`, \`eTheta\`.
2. In **Estimate**: the two lines for \`x\` and \`y\`.
3. **The mission**. Compute \`dist\` and \`eTheta\` on every pass, then:
   - **state 0, FACE**: \`vref = 0\`. Steer at the goal: \`turn = -2.0 * eTheta\`, limited to -1 ... 1. (Minus: a goal to the left is a positive error and needs a negative turn.) When \`fabs(eTheta) < 0.05\`, go to state 1
   - **state 1, DRIVE**: keep steering the same way, and set \`vref = 2.0 * dist\`, limited to 1.5 ft/s, so the robot slows down as it arrives. When \`dist < 0.05\`, go to state 2
   - **state 2, DONE**: \`vref = 0\`, \`turn = 0\`

## The test
The robot must stop within 0.15 ft of (4, 5). The room measures where it really is. The tests also read your globals \`x\` and \`y\`: they must say (4, 5) too. If your estimate is wrong, the robot drives confidently to the wrong place, and the meters show you where.

The simulated wheels never slip, so dead reckoning is almost perfect here. On the lab floor it drifts by an inch or two per turn.
`,
      kit: "robot",
      durationMs: 7000,
      stimuli: world({ goal: GOAL_GOTO }),
      starter: GOTO_STARTER,
      solution: S_GOTO,
      checks: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.15, label: "The robot ends within 0.15 ft of (4, 5)", hint: "Compare the meters with your x and y. If they agree, the mission is wrong. If they differ, the dead reckoning is: start at (1, 2), speed in ft/s times 0.001, angle in radians." },
        { kind: "var", name: "x", min: 3.85, max: 4.15, label: "Your x says 4", hint: "x starts at 1.0 and adds 0.5 * (vLeft + vRight) * cos(theta) * 0.001 on every pass." },
        { kind: "var", name: "y", min: 4.85, max: 5.15, label: "Your y says 5", hint: "y starts at 2.0 and uses sin(theta)." },
        ...stopped(),
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.06, label: "Within 0.06 ft of the goal (three quarters of an inch)" },
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 5000, max: 0.15, label: "There within 5 s" },
      ],
      watch: ["state", "x", "y", "theta", "dist", "eTheta", "vref", "turn"],
      hints: [
        "Add x and y first, keep the old mission, and check them against the meters: after the 3 ft and the turn they should read (4, 2).",
        "`dist = sqrt((xGoal - x) * (xGoal - x) + (yGoal - y) * (yGoal - y)); eTheta = atan2(yGoal - y, xGoal - x) - theta;` then `while (eTheta > PI) eTheta = eTheta - 2.0 * PI;` and the same the other way.",
        "DRIVE: `vref = 2.0 * dist; if (vref > 1.5) vref = 1.5; turn = -2.0 * eTheta;` (limit turn to -1 ... 1) `if (dist < 0.05) state = 2;`",
      ],
      takeaway: "A go-to-point controller is two proportional controllers, one on the heading and one on the distance, and a wrap. The course's xy_control function is the same idea with a few more guards.",
    },
    {
      id: "cap-wall",
      kind: "code",
      mode: "write",
      continues: "cap-goto",
      title: "LIDAR: stop before the wall",
      goal: "Read the LIDAR every 100 ms from CPU timer 1 and stop the robot when something is close ahead.",
      refs: [{ course: "L16" }, { course: "L14" }, { trm: "3.8" }],
      brief: `
The goal is now **(12, 2)**. The room ends at x = 10. Your dead reckoning has no idea that there is a wall in between, so the robot will drive into it at full speed. It needs to look. This is the LIDAR of **chapter 17**.

## Which LIDAR path?
In chapter 17 you asked the sensor for a scan over SCIC and parsed 477 characters into an array. That parser is about 80 lines that you have already written and debugged. Here the test bench function \`tb_lidar_ft(i)\` stands in for it: it returns point \`i\` of the current scan in feet, the same number your parser stores. The rest of the program cannot tell the difference. An expert level at the end puts the real serial path back.

Point **113** looks straight ahead and the points are 1.05 degrees apart. Points **94 to 132** cover 20 degrees to each side, which is enough to see anything the robot's body would touch.

## What to add
1. \`float min_ft(int first, int last)\`: the smallest of \`tb_lidar_ft(first)\` ... \`tb_lidar_ft(last)\`. This is the function of the chapter 17 level on the nearest point ("What is closest, and where").
2. **Globals**: \`float front_ft = 19.0;\` (nothing seen yet) and \`uint32_t numScans = 0;\`.
3. \`__interrupt void cpu_timer1_isr(void)\`: \`front_ft = min_ft(94, 132);\` and \`numScans++;\`. Timer 1 needs no PIEACK: it is wired straight to CPU interrupt 13.
4. In \`main\`: the vector \`PieVectTable.TIMER1_INT\`, \`ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);\`, start it with \`CpuTimer1Regs.TCR.all = 0x4000;\`, and \`IER |= M_INT13;\`. Timer 1 at 100 ms is how the course's robot code polls the LIDAR.
5. Prototypes for the two new functions.
6. Change the goal: \`xGoal = 12.0\`, \`yGoal = 2.0\`.
7. **The mission**: one new state, **BLOCKED** (state 3): \`vref = 0\`, \`turn = 0\`. In DRIVE, go there when \`front_ft < 1.2\`. Add one more condition, \`front_ft < dist\`: if the goal is nearer than the thing ahead, the thing is behind the goal and does not matter.

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
        NO_CRASH,
        { kind: "signal", name: "ROBOT_X_FT", min: 8.4, label: "The robot drove up to the wall (x above 8.4)", hint: "Still near the start: is the goal (12, 2)? Stopped early: front_ft must come from points around 113, the ones that look ahead." },
        { kind: "signal", name: "LIDAR_FRONT_FT", min: 0.6, max: 1.4, label: "It stands 0.6 to 1.4 ft from the wall", hint: "Too close: the robot moves between scans and while braking. Stop earlier than you want to end." },
        { kind: "var", name: "front_ft", min: 0.6, max: 1.4, label: "Your front_ft agrees", hint: "front_ft still 19: cpu_timer1_isr never runs. It needs its vector, ConfigCpuTimer, the start (TCR) and M_INT13 in IER." },
        { kind: "isr", fn: "cpu_timer1_isr", min: 70, max: 90, label: "cpu_timer1_isr runs every 100 ms", hint: "ConfigCpuTimer takes the period in microseconds: 100000." },
        ...stopped(),
      ],
      bonus: [
        ISR_BUDGET,
        { kind: "signal", name: "LIDAR_FRONT_FT", min: 0.9, max: 1.2, label: "Stopped 0.9 to 1.2 ft from the wall" },
      ],
      watch: ["state", "front_ft", "numScans", "x", "dist", "vref"],
      hints: [
        "Get front_ft working first: with the old goal the robot still drives to (4, 5). front_ft should start near 9 and change as the robot turns and drives.",
        "`float min_ft(int first, int last) { int i; float m = 19.0; for (i = first; i <= last; i++) { if (tb_lidar_ft(i) < m) m = tb_lidar_ft(i); } return m; }`",
        "In DRIVE: `if (dist < 0.05) { state = 2; } else if (front_ft < 1.2 && front_ft < dist) { state = 3; }` and `case 3: vref = 0.0; turn = 0.0; break;`",
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
      refs: [{ course: "L14" }, { course: "L16" }, { course: "Lab 6" }],
      brief: `
The goal is **(9, 7.6)**. The straight line from the start runs through the 1 ft block. With the program of the last level the robot stops in front of the block and waits forever. Now it has to go around.

## A plan that works
Two more states turn "stop" into "go around":

- **TURN** (replaces BLOCKED, state 3): turn left on the spot, \`vref = 0\`, \`turn = -1.0\`, until the way ahead is clear: \`front_ft > 2.5\`. Then remember how far the robot has driven, \`passStart = travel;\`, and go to PASS.
- **PASS** (state 4): drive straight, \`vref = 1.0\`, \`turn = 0\`. When \`travel - passStart\` is more than **2 ft**, the obstacle is behind: go back to **FACE** (state 0), which turns to the goal again. If something comes up ahead first (\`front_ft < 1.2\`), go back to TURN.

FACE, DRIVE and DONE stay as they are. If the way to the goal is still blocked after one pass, DRIVE sends the robot round again, so the same five states also handle bigger obstacles.

Why 2 ft? The block is 1 ft wide and the robot must clear it by more than its own radius, 0.35 ft.

## What to change
1. The goal: \`xGoal = 9.0\`, \`yGoal = 7.6\`.
2. A global \`float passStart = 0;\`.
3. The mission: state 3 becomes TURN, and a new \`case 4\` is PASS.

You are free to do it another way, for example by following the side of the obstacle with a side-looking part of the scan, as the wall follower of chapter 17 does. The tests only look at the result.

## The test
Within 16 s the robot stands still within 0.15 ft of the goal and has touched nothing. Stars: arrive within 13 s, drive less than 11.5 ft on the way (the straight line is 9.8 ft), and keep the 1 ms loop short.
${ROOM_NOTE}`,
      kit: "robot",
      durationMs: 16000,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: FINAL_STARTER,
      solution: S_FINAL,
      checks: arrived("Still in front of the block: BLOCKED must become TURN. Circling: after PASS go back to FACE, not DRIVE. Stopped somewhere else: is the goal (9, 7.6)?"),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13000, max: 0.15, label: "At the goal within 13 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 11.5, label: "Drove less than 11.5 ft to get there" },
        ISR_BUDGET,
      ],
      watch: ["state", "x", "y", "theta", "front_ft", "dist", "passStart", "travel"],
      hints: [
        "Watch state while it runs: 0, 1, then 3 at the block, 4, 0, 1 and finally 2. Where it gets stuck tells you which transition is missing.",
        "`case 3: vref = 0.0; turn = -1.0; if (front_ft > 2.5) { state = 4; passStart = travel; } break;`",
        "`case 4: vref = 1.0; turn = 0.0; if (front_ft < 1.2) { state = 3; } else if (travel - passStart > 2.0) { state = 0; } break;`",
      ],
      takeaway: "Count what is in this file: PWM and the H-bridge, two encoders, backward-difference speeds, two PI loops with anti-windup, steering, dead reckoning, a LIDAR and a state machine, in two interrupts. Every line of it came from a chapter you finished, and now it is one robot.",
    },
    {
      id: "cap-p-corner",
      kind: "code",
      mode: "write",
      tier: "practice",
      continues: "cap-final",
      title: "Practice: from the far corner",
      goal: "Run the same program from a different start pose to a different goal, across the +-PI line.",
      refs: [{ course: "L15" }, { course: "L14" }],
      brief: `
A good program does not care where it starts. Same room, new trip: the robot now stands at **(8.8, 9)** looking along **-x**, a heading of **PI**. The goal is **(6.5, 4.5)**, and the block is in the way again.

## What to change
Only numbers:

- the start pose: \`theta0\` (and \`theta\`), \`x\` and \`y\`
- the goal: \`xGoal\` and \`yGoal\`

If you used the variable \`theta0\` in your heading line, the rest follows. If you assumed that the heading starts at 0 anywhere else, this level finds it.

## What it tests
From a heading of PI, the goal is 63 degrees to the robot's **left**. The unwrapped heading error says "turn right by 297 degrees". The robot still arrives that way, three seconds late. With the wrap from the dead reckoning level it takes the short way, and that is what the star for 10 s needs.
`,
      kit: "robot",
      durationMs: 13000,
      stimuli: world(CORNER),
      starter: CORNER_STARTER,
      solution: S_CORNER,
      checks: arrived("Drove off in a strange direction: the program still believes it starts at (1, 2) with heading 0. Set theta0, x and y."),
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 10000, max: 0.15, label: "At the goal within 10 s", hint: "Did the robot turn the long way round at the start? Wrap the heading error to -PI ... PI." },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 6.6, label: "Drove less than 6.6 ft (the straight line is 5.1 ft)" },
      ],
      watch: ["state", "x", "y", "theta", "eTheta", "front_ft", "dist"],
      hints: [
        "Four globals describe the trip: where the robot is and where it is going. Nothing in the interrupt functions changes.",
        "`float theta0 = PI;` and `float theta = PI;`, `float x = 8.8;`, `float y = 9.0;`",
        "`float xGoal = 6.5;` and `float yGoal = 4.5;`. If it turns the long way round, look at the two while loops that wrap eTheta.",
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
      refs: [{ course: "L14" }, { course: "L16" }],
      brief: `
A different room: the same 10 ft box without the block, but with a **doorway** in the wall x = 10, from y = 6 to y = 8.5. The robot stands at **(8.5, 2)** looking along **+y**, a heading of **PI/2**. The goal is outside, at **(12, 7.25)**.

The straight line to the goal runs into the wall beside the door. The robot has to find the opening.

## What to change
The start pose (\`theta0\`, \`theta\`, \`x\`, \`y\`) and the goal (\`xGoal\`, \`yGoal\`). If your state machine from the checkpoint is sound, that is all.

## What to watch
The robot is blocked by the wall, turns left until it sees 2.5 ft of free floor, passes, faces the goal and tries again. It may need two or three rounds to reach the door. Watch \`state\`. That is the same machine handling a case you did not design it for, which is the point of writing it as states and transitions instead of a fixed sequence.

The doorway is 2.5 ft wide and the robot 0.7 ft. Do not cut the corner of the door post.
`,
      kit: "robot",
      durationMs: 15000,
      stimuli: world(DOOR),
      starter: DOOR_STARTER,
      solution: S_DOOR,
      checks: [
        { kind: "signal", name: "ROBOT_X_FT", min: 10.5, label: "The robot is outside the room (x above 10.5)", hint: "Stuck in front of the wall: after PASS the machine must go back to FACE so that it tries the goal again." },
        ...arrived("Set the start pose (8.5, 2, PI/2) and the goal (12, 7.25)."),
      ],
      bonus: [{ kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13000, max: 0.15, label: "Outside and at the goal within 13 s" }],
      watch: ["state", "x", "y", "theta", "front_ft", "dist"],
      hints: [
        "Change the six numbers first and run it. Then watch where the robot is when state changes.",
        "`float theta0 = PI/2.0;`, `float theta = PI/2.0;`, `float x = 8.5;`, `float y = 2.0;`, `float xGoal = 12.0;`, `float yGoal = 7.25;`",
        "If it touches the door post, pass further (a longer PASS) or stop earlier (a larger blocked distance) and try again.",
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
      refs: [{ course: "Lab 5" }, { course: "L11" }, { course: "L14" }],
      brief: `
The checkpoint trip took the reference program 12 s. Do it in **10 s**: at 10.0 s the robot must stand still within 0.1 ft of **(9, 7.6)**. Same room, same start, same rules: touch nothing.

No recipe this time. Some facts:

- The robot's top speed is 3.1 ft/s. A wheel that is asked for more than it can give has nothing left for steering.
- The LIDAR is read every 100 ms. At 3 ft/s the robot moves 0.3 ft between two looks, and it also needs room to brake. The distance at which you call the way "blocked" has to grow with the speed.
- \`vref = 2.0 * dist\` starts to slow the robot down 0.75 ft before the goal at 1.5 ft/s, and 1.5 ft before it at 3 ft/s.
- Time is lost wherever the robot stands still: turning on the spot, creeping the last inches.
- The checkpoint's rules always turn left. Left is not always the short way round.

Measure before you change anything: watch \`state\` and the clock, and write down how long each state takes.
`,
      kit: "robot",
      durationMs: 11000,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: FAST_STARTER,
      solution: S_FAST,
      checks: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 10000, max: 0.1, label: "At 10 s the robot is within 0.1 ft of the goal" },
        ...stopped(10000),
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.1, label: "It stays there" },
        NO_CRASH,
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 9000, max: 0.1, label: "There in 9 s" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", max: 11.2, label: "Drove less than 11.2 ft" },
        ISR_BUDGET,
      ],
      watch: ["state", "numTimer0calls", "vref", "front_ft", "dist", "travel"],
      hints: [
        "The long straight parts are where a higher speed pays. Raise the limit on vref in DRIVE and the speed in PASS.",
        "Faster means stopping earlier: raise the blocked distance from 1.2 ft with the speed.",
        "One set that works: DRIVE up to 3.0 ft/s, blocked below 1.5 ft, PASS at 2.0 ft/s.",
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
      refs: [{ course: "L16" }, { trm: "19" }, { trm: "3.4.5" }],
      brief: `
\`tb_lidar_ft()\` does not exist on the robot. Take it out and put in what does: the serial path of **chapter 17**. The trip is the checkpoint's, to (9, 7.6).

## What to build
- \`init_serialSCIC(&SerialC, 115200);\` in \`main\`, the vector \`PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;\` and \`IER |= M_INT8;\`.
- \`cpu_timer1_isr\` now only **asks**: \`serial_sendSCIC(&SerialC, G_command, G_len);\` with \`char G_command[] = "G04472503\\n";\` and \`G_len = 10\`.
- \`__interrupt void RXCINT_recv_ready(void)\`: your parser from the chapter 17 level "The parser is a state machine". It reads \`ScicRegs.SCIRXBUF.all\` into \`RXCdata\`, counts the 12 header characters, pairs the data characters, skips single line feeds and ends on two in a row. It must clear \`ScicRegs.SCIFFRX.bit.RXFFINTCLR\` and acknowledge **PIE group 8**. \`RXCdata\` is declared by the serial library.
- Store the distances in feet, \`float ladar_ft[228]\` (\`distance * 0.00328084\`). Readings of 0 and 6 are error codes, not distances: store \`LADAR_MAX_READING\` for them, as the course code does.
- When a reply is complete, compute \`front_ft\` from \`ladar_ft[94]\` ... \`ladar_ft[132]\` and count the scan in \`numScans\`.

## What changes for the robot
The answer now arrives about 42 ms after the question, 477 characters later, one interrupt per character. \`front_ft\` is always a little older than before. If the robot now gets too close, you know why, and what to change.

There are three interrupt sources now. The 1 ms loop must not notice.
`,
      kit: "robot",
      durationMs: 16000,
      stimuli: world({ goal: GOAL_FINAL }),
      starter: SERIAL_STARTER,
      solution: S_SERIAL,
      checks: [
        { kind: "source", mustNotMatch: "tb_lidar", label: "The program does not use tb_lidar_ft or tb_lidar_mm" },
        { kind: "signal", name: "LIDAR_SCANS", min: 100, label: "The LIDAR answered at least 100 requests", hint: "0 scans: the command never reached the sensor. It needs init_serialSCIC at 115200 baud and the 10 characters of G04472503 with its line feed." },
        { kind: "var", name: "numScans", min: 100, label: "Your parser completed at least 100 scans (numScans)", hint: "Requests go out but no scan completes: the receive interrupt needs its vector, and the parser must end a scan on two line feeds in a row." },
        { kind: "no-diagnostic", code: "lidar", label: "The LIDAR understood every command" },
        ...arrived("Stopped in open floor: an error code (0 or 6) was read as a distance of a few millimetres."),
      ],
      bonus: [
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", at: 13500, max: 0.15, label: "At the goal within 13.5 s" },
        ISR_BUDGET,
        { kind: "isr-time", fn: "RXCINT_recv_ready", maxUs: 8, label: "No character takes more than 8 microseconds to handle" },
      ],
      watch: ["state", "front_ft", "numScans", "read_ladar_state", "dis_index"],
      hints: [
        "Bring it up in the order of chapter 17: first the request (watch the meter \"LIDAR scans sent\"), then the parser (watch numScans), then front_ft.",
        "The parser's states: 0 waits for 'G'; 1 counts to 12 and checks that character 11 is '0'; 2 pairs characters, `(first - 0x30) << 6` plus `(second - 0x30)`, and counts line feeds.",
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
      refs: [{ course: "L15" }, { course: "Lab 5" }],
      brief: `
The classic test of a robot's dead reckoning: drive a square and see how far from the start you end.

From the start at (1, 2), visit the corners **(4, 2)**, **(4, 5)**, **(1, 5)** and come back to **(1, 2)**, in that order. Then turn back to the heading you started with and stop.

## What the tests need
- A global \`uint16_t corner\` that counts the corners reached. It must end at **4** (the start counts as the fourth).
- The odometer reads between 11.6 and 12.6 ft: the square is 12 ft.
- At the end the robot stands still within **0.25 ft** (3 inches) of the start, and its heading is within 0.1 rad of 0.

## Things that will bite
- The goal now changes while the program runs. Arrays of corner coordinates keep that tidy.
- After the fourth corner the robot points along -y. "Back to the starting heading" is a turn to a **heading**, not towards a point: the heading error is \`theta0 - theta\`, wrapped.
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
        { kind: "var", name: "corner", equals: 4, label: "All four corners were reached (corner is 4)", hint: "Count a corner when dist to it falls below a small radius, then make the next corner the goal." },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", min: 11.6, max: 12.6, label: "The robot drove the 12 ft of the square" },
        { kind: "signal", name: "ROBOT_GOAL_DIST_FT", max: 0.25, label: "It ends within 0.25 ft (3 inches) of the start" },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: -0.1, max: 0.1, label: "It looks along +x again (heading within 0.1 rad of 0)", hint: "After the last corner, turn until theta0 - theta, wrapped to -PI ... PI, is small." },
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
        "`float wpX[4] = {4.0, 4.0, 1.0, 1.0}; float wpY[4] = {2.0, 5.0, 5.0, 2.0};` and, at the top of the mission, `if (corner < 4) { xGoal = wpX[corner]; yGoal = wpY[corner]; }`",
        "In DRIVE, when dist is small: `corner++;` then back to FACE if `corner < 4`, else to a new state HOME.",
        "HOME: `eTheta = theta0 - theta;` wrap it, `vref = 0.0; turn = -2.0 * eTheta;` (limited), and DONE when `fabs(eTheta) < 0.02`. Let DRIVE go up to 2.5 ft/s.",
      ],
      takeaway: "Waypoints in room coordinates do not add up their errors; steps relative to the last pose do. The error that remains on a real floor is the wheels' slip, and no amount of code in this file can see it.",
    },
  ],
};
