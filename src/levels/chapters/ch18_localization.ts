import type { Chapter } from "../types";

// Chapter 18 runs on the test bench robot of src/sim/plugins/plant.ts
// (wheel base 0.6 ft, heading counter-clockwise positive, gyro in rad/s,
// position fixes at 100 Hz). The transform exercises have the form of HW4's
// but their own numbers: the homework grades the worked answers.
// xy_control is the course's (user_xy.c of the final project starter),
// with atan2 in place of my_atanf and float literals without the F suffix.

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

/** A complete program whose timer 0 interrupt (every `periodUs`) runs `isr`. */
const prog = (globals: string, isr: string, opts: { functions?: string; periodUs?: number; setup?: string; loop?: string } = {}) => `${FREQ}
#define PI 3.14159265
#define WHEEL_BASE 0.6    // distance between the wheels, ft

__interrupt void cpu_timer0_isr(void);

${globals.trim()}
${opts.functions ? `\n${opts.functions.trim()}\n` : ""}
void main(void)
{
    InitSysCtrl();
${opts.setup ? `\n${opts.setup.replace(/^\n+|\s+$/g, "")}\n` : ""}
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    // Timer 0 interrupts every ${(opts.periodUs ?? 1000) / 1000} ms
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, ${opts.periodUs ?? 1000});
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    ERTM;

    while (1) {${opts.loop ? `\n${opts.loop.replace(/^\n+|\s+$/g, "")}\n    ` : ""}}
}

// Runs every ${(opts.periodUs ?? 1000) / 1000} ms
__interrupt void cpu_timer0_isr(void)
{
${isr.replace(/^\n+|\s+$/g, "")}

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

const BENCH = `
## The test bench
The simulator's robot (functions starting with \`tb_\`) stands in for the real robot's sensors and motors.

- \`tb_left_speed()\`, \`tb_right_speed()\`: wheel speeds, ft/s. The wheels are **0.6 ft** apart (\`WHEEL_BASE\`).
- \`tb_set_effort(uLeft, uRight)\`: control efforts, -10 to 10.
- \`tb_report_pose(x, y, theta)\`: hands your pose estimate (ft, ft, rad) to the bench. The tests compare it with the true pose.
`;

const POSE_GLOBALS = `float vLeft = 0;      // wheel speeds, ft/s
float vRight = 0;
float x = 0;          // estimated pose: ft, ft, rad
float y = 0;
float theta = 0;
uint32_t numTimer0calls = 0;`;

// Open-loop drive used by the dead-reckoning levels: straight, a left arc, stop.
const DRIVE = `    // Drive: 1.5 s straight, 1.5 s on a left arc, then stop
    numTimer0calls++;
    if (numTimer0calls <= 1500) {
        tb_set_effort(4.8, 4.8);
    } else if (numTimer0calls <= 3000) {
        tb_set_effort(3.6, 6.0);
    } else {
        tb_set_effort(0.0, 0.0);
    }
`;

const SPEED_GLOBALS = `float Kp = 8.0;       // speed controller gains (chapter 16)
float Ki = 100.0;
float Kturn = 3.0;
float ILeft = 0;
float IRight = 0;
float uLeft = 0;
float uRight = 0;`;

// The checkpoint of chapter 16, as a function.
const SPEED_CONTROL = `// Two PI speed loops with steering coupling (chapter 16, Lab 5).
// vref: forward speed, ft/s. turn: wanted vLeft - vRight, ft/s.
// A NEGATIVE turn makes the robot turn left (counter-clockwise).
void speed_control(float vref, float turn)
{
    float eSteer = turn + (vRight - vLeft);
    float eLeft = vref - vLeft + Kturn * eSteer;
    float eRight = vref - vRight - Kturn * eSteer;

    uLeft = Kp * eLeft + Ki * (ILeft + eLeft * 0.001);
    if (uLeft > 10.0) {
        uLeft = 10.0;
    } else if (uLeft < -10.0) {
        uLeft = -10.0;
    } else {
        ILeft = ILeft + eLeft * 0.001;
    }
    uRight = Kp * eRight + Ki * (IRight + eRight * 0.001);
    if (uRight > 10.0) {
        uRight = 10.0;
    } else if (uRight < -10.0) {
        uRight = -10.0;
    } else {
        IRight = IRight + eRight * 0.001;
    }
    tb_set_effort(uLeft, uRight);
}`;

// The course's move-to-XY function. Positive turn = turn right, as in PIcontrol.
const XY_CONTROL = `// xy_control from the course's user_xy.c (final project), lightly shortened.
// Sets *vref_forxy and *turn_forxy to drive towards (x_desired, y_desired).
// Returns 1 when the robot is within target_radius_near of the target, else 0.
int xy_control(float *vref_forxy, float *turn_forxy, float turn_thres,
               float x_pos, float y_pos, float x_desired, float y_desired,
               float thetaabs, float target_radius, float target_radius_near)
{
    float dx, dy, alpha;
    float dist = 0.0;
    float dir = 1.0;
    float theta;
    int target_near = 0;
    float turnerror = 0;

    // theta: the current heading, brought between -PI and PI
    if (thetaabs > PI) {
        theta = thetaabs - 2.0 * PI * floor((thetaabs + PI) / (2.0 * PI));
    } else if (thetaabs < -PI) {
        theta = thetaabs - 2.0 * PI * ceil((thetaabs - PI) / (2.0 * PI));
    } else {
        theta = thetaabs;
    }

    dx = x_desired - x_pos;
    dy = y_desired - y_pos;
    dist = sqrt(dx * dx + dy * dy);

    // alpha: the direction from the robot to the target, between -PI and PI
    alpha = atan2(dy, dx);

    // turn error: positive when the robot must turn right
    turnerror = theta - alpha;

    // take the shortest way round
    if (fabs(turnerror + 2.0 * PI) < fabs(turnerror)) {
        turnerror = turnerror + 2.0 * PI;
    } else if (fabs(turnerror - 2.0 * PI) < fabs(turnerror)) {
        turnerror = turnerror - 2.0 * PI;
    }

    if (dist < target_radius_near) {
        target_near = 1;
        if (dist < target_radius) {
            // arrived: stop
            dir = 0.0;
            turnerror = 0.0;
        } else {
            // close: stop steering, and back up if the target is now behind
            if (fabs(turnerror) > PI / 2.0) {
                dir = -dir;
            }
            turnerror = 0.0;
        }
    }

    // 1 ft/s, slower when closer than 1 ft
    if (dist < 1.0) {
        *vref_forxy = dir * dist;
    } else {
        *vref_forxy = dir;
    }

    if (fabs(*vref_forxy) > 0.0) {
        *turn_forxy = (*vref_forxy * 2.0) * turnerror;
    } else {
        *turn_forxy = 2.0 * turnerror;
    }

    // a large turn: spin on the spot first
    if (fabs(*turn_forxy) > turn_thres) {
        *vref_forxy = 0.0;
    }
    return target_near;
}`;

const XY_TURN_ERROR = `    // turn error: positive when the robot must turn right
    turnerror = theta - alpha;

    // take the shortest way round
    if (fabs(turnerror + 2.0 * PI) < fabs(turnerror)) {
        turnerror = turnerror + 2.0 * PI;
    } else if (fabs(turnerror - 2.0 * PI) < fabs(turnerror)) {
        turnerror = turnerror - 2.0 * PI;
    }
`;

// The same function with the two slips of level loc-xy.
const XY_CONTROL_BUGGY = XY_CONTROL.replace(
  XY_TURN_ERROR,
  `    // turn error
    turnerror = alpha - theta;
`,
);

// The same function with the turn-error lines left out (checkpoint).
const XY_CONTROL_BLANK = XY_CONTROL.replace(
  XY_TURN_ERROR,
  `    // turn error (positive: the robot must turn right), then the shortest way round

`,
);

const XY_GLOBALS = `float xGoal = -2.0;   // target, ft
float yGoal = -2.0;
float vLeft = 0;
float vRight = 0;
float x = 0;          // the robot starts at the origin, heading 2.6 rad
float y = 0;
float theta = 2.6;
float vref = 0;
float turn = 0;
float turned = 0;     // total angle turned so far, rad
int near = 0;         // what xy_control returned
${SPEED_GLOBALS}`;

const XY_ISR = `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning (theta is not wrapped here: xy_control does that itself)
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;
    turned = turned + fabs(vRight - vLeft) / WHEEL_BASE * 0.001;
    tb_report_pose(x, y, theta);

    // The call of the final project: turn threshold 1, radii 0.25 and 0.5 ft
    near = xy_control(&vref, &turn, 1.0, x, y, xGoal, yGoal, theta, 0.25, 0.5);
    speed_control(vref, turn);`;

const WAY_GLOBALS = `#define NUMWAYPOINTS 4
float xWay[NUMWAYPOINTS] = {2.0, 2.0, 0.0, 0.0};   // corners of the square, ft
float yWay[NUMWAYPOINTS] = {0.0, 2.0, 2.0, 0.0};
int statePos = 0;     // index of the way point the robot is driving to
float vLeft = 0;
float vRight = 0;
float x = 0;          // estimated pose: ft, ft, rad
float y = 0;
float theta = 0;
float vref = 0;
float turn = 0;
int near = 0;         // what xy_control returned
${SPEED_GLOBALS}`;

const KF_FUNCTIONS = `// Predict: the robot moved by u. q: variance added by the move.
void kf_predict(float u, float q)
{
    kf_x = kf_x + u;
    kf_p = kf_p + q;
}

// Update: a measurement z with variance r arrived.
void kf_update(float z, float r)
{
    kf_k = kf_p / (kf_p + r);
    kf_x = kf_x + kf_k * (z - kf_x);
    kf_p = (1.0 - kf_k) * kf_p;
}`;

const KF_EMPTY = `// Predict: the robot moved by u. q: variance added by the move.
void kf_predict(float u, float q)
{

}

// Update: a measurement z with variance r arrived.
void kf_update(float z, float r)
{

}`;

const KF_MAIN = (fns: string) => `float kf_x = 2.0;     // mean: best guess of the position, ft
float kf_p = 0.5;     // variance: how unsure the guess is, ft^2
float kf_k = 0;       // gain of the last update
float x1 = 0;         // results after the first round
float p1 = 0;

${fns}

void main(void)
{
    // Round 1: the numbers of the previous level
    kf_predict(1.0, 0.3);
    kf_update(3.6, 0.2);
    x1 = kf_x;
    p1 = kf_p;

    // Round 2
    kf_predict(1.0, 0.3);
    kf_update(4.2, 0.2);

    while (1) {}
}
`;

const KF2_GLOBALS = `float kf_pos = 0;     // state: position (ft) and velocity (ft/s)
float kf_vel = 0;
float P00 = 1.0;      // covariance matrix P, written out
float P01 = 0.0;
float P10 = 0.0;
float P11 = 1.0;
float t_pos = 0;      // results of the self-test in main()
float t_vel = 0;
float t_P00 = 0;
float t_P01 = 0;
float t_P11 = 0;
float z = 0;          // last position fix, ft`;

const KF2_MAIN_SETUP = `
    // Self-test with round numbers: P = identity, dt = 1 s, qv = 0.5, z = 3, r = 2
    kf2_predict(1.0, 0.5);
    kf2_update(3.0, 2.0);
    t_pos = kf_pos;
    t_vel = kf_vel;
    t_P00 = P00;
    t_P01 = P01;
    t_P11 = P11;

    // Start of the real run: nothing known yet
    kf_pos = 0;
    kf_vel = 0;
    P00 = 100.0;
    P01 = 0.0;
    P10 = 0.0;
    P11 = 100.0;
`;

const KF2_DRIVE = `    // Drive: 1 ft/s for 3 s, then 2 ft/s
    numTimer0calls++;
    if (numTimer0calls <= 3000) {
        tb_set_effort(4.8, 4.8);
    } else {
        tb_set_effort(8.8, 8.8);
    }
`;

const GOTO_GLOBALS = `float xGoal = -1.0;   // target, ft
float yGoal = -1.5;
float vLeft = 0;
float vRight = 0;
float x = 1.0;        // the robot starts at (1, 1) ft, heading 2.8 rad
float y = 1.0;
float theta = 2.8;
float vref = 0;
float turn = 0;
int state = 0;        // 0: turn to face the target, 1: drive, 2: arrived
${SPEED_GLOBALS}`;

// ---- Keeping the interrupt short (level loc-budget) ----
const BUDGET_GLOBALS = `${POSE_GLOBALS}
float dist = 0;       // distance driven since the start, ft (summed in the interrupt)
float distDone = 0;   // the part of dist that x and y already contain
float step = 0;       // distance driven since the last update of x and y
int newStep = 0;      // 1: the interrupt asks the main loop to update x and y`;

// ---- The three-state filter (levels loc-kf3-*) ----
// The form is HW6's (F = identity, B from the heading, u = speed and turn
// rate). The numbers, Q and R are this chapter's own, and the bench measures
// only x and y, so H has two rows where the course's has three.
const KF3_P_PLUS_Q = `    // 3. Covariance: P = F P F' + Q. F is the identity, so this is P = P + Q.
    for (i = 0; i < 3; i++) {
        for (j = 0; j < 3; j++) {
            P[i][j] = P[i][j] + Q[i][j];
        }
    }`;

const KF3_PREDICT = `// Predict: the robot drove at v (ft/s) and turned at omega (rad/s) for dt seconds.
void kf3_predict(float v, float omega, float dt)
{
    int i, j;

    // 1. Fill B from the heading BEFORE the step, and u from the inputs
    B[0][0] = cos(xhat[2]) * dt;
    B[0][1] = 0.0;
    B[1][0] = sin(xhat[2]) * dt;
    B[1][1] = 0.0;
    B[2][0] = 0.0;
    B[2][1] = dt;
    u[0] = v;
    u[1] = omega;

    // 2. State: xhat = xhat + B u, one row at a time
    for (i = 0; i < 3; i++) {
        xhat[i] = xhat[i] + B[i][0] * u[0] + B[i][1] * u[1];
    }

${KF3_P_PLUS_Q}
}`;

const KF3_PREDICT_EMPTY = `// Predict: the robot drove at v (ft/s) and turned at omega (rad/s) for dt seconds.
void kf3_predict(float v, float omega, float dt)
{
    int i, j;

    // 1. Fill B from the heading BEFORE the step, and u from the inputs

    // 2. State: xhat = xhat + B u, one row at a time

${KF3_P_PLUS_Q}
}`;

const KF3_PREDICT_MAIN = (fn: string) => `float xhat[3] = {2.0, 1.0, 0.5236};   // state: x (ft), y (ft), heading (rad)
float P[3][3] = {{0.2, 0.0, 0.0},     // covariance: how unsure the filter is
                 {0.0, 0.2, 0.0},
                 {0.0, 0.0, 0.05}};
float Q[3][3] = {{0.05, 0.0, 0.0},    // process noise: what one step adds to P
                 {0.0, 0.05, 0.0},
                 {0.0, 0.0, 0.01}};
float B[3][2];        // input matrix: what each input does to each state
float u[2];           // inputs: forward speed (ft/s) and turn rate (rad/s)
float x1 = 0;         // results after the first step
float y1 = 0;
float th1 = 0;
float x2 = 0;         // results after the second step
float y2 = 0;
float th2 = 0;
float p00 = 0;
float p22 = 0;

${fn}

void main(void)
{
    // Step 1: the numbers of the previous level
    kf3_predict(2.0, 0.5, 0.1);
    x1 = xhat[0];
    y1 = xhat[1];
    th1 = xhat[2];

    // Step 2: slower, turning right
    kf3_predict(1.0, -1.0, 0.1);
    x2 = xhat[0];
    y2 = xhat[1];
    th2 = xhat[2];
    p00 = P[0][0];
    p22 = P[2][2];

    while (1) {}
}
`;

const KF3_INVERSE = `    // 3. Inverse of the 2 x 2 matrix S (given)
    det = S00 * S11 - S01 * S10;
    Si00 = S11 / det;
    Si01 = -S01 / det;
    Si10 = -S10 / det;
    Si11 = S00 / det;`;

const KF3_UPDATE_LOCALS = `    float e0, e1;                   // residual: measurement minus prediction
    float S00, S01, S10, S11;       // S: doubt of the residual
    float det, Si00, Si01, Si10, Si11;
    float P0[3], P1[3];             // rows 0 and 1 of P from before the update
    int i, j;`;

const KF3_UPDATE = `// Update: a position fix (zx, zy) arrived.
void kf3_update(float zx, float zy)
{
${KF3_UPDATE_LOCALS}

    // 1. Residual: e = z - H xhat
    e0 = zx - xhat[0];
    e1 = zy - xhat[1];

    // 2. S = H P H' + R: the top left 2 x 2 corner of P, plus R
    S00 = P[0][0] + R[0][0];
    S01 = P[0][1] + R[0][1];
    S10 = P[1][0] + R[1][0];
    S11 = P[1][1] + R[1][1];

${KF3_INVERSE}

    // 4. Gain: K = P H' Si. P H' is the first two columns of P.
    for (i = 0; i < 3; i++) {
        K[i][0] = P[i][0] * Si00 + P[i][1] * Si10;
        K[i][1] = P[i][0] * Si01 + P[i][1] * Si11;
    }

    // 5. State: xhat = xhat + K e
    for (i = 0; i < 3; i++) {
        xhat[i] = xhat[i] + K[i][0] * e0 + K[i][1] * e1;
    }

    // 6. Covariance: P = P - K H P. H P is rows 0 and 1 of the OLD P.
    for (j = 0; j < 3; j++) {
        P0[j] = P[0][j];
        P1[j] = P[1][j];
    }
    for (i = 0; i < 3; i++) {
        for (j = 0; j < 3; j++) {
            P[i][j] = P[i][j] - K[i][0] * P0[j] - K[i][1] * P1[j];
        }
    }
}`;

const KF3_UPDATE_EMPTY = `// Update: a position fix (zx, zy) arrived.
void kf3_update(float zx, float zy)
{
${KF3_UPDATE_LOCALS}

    // 1. Residual: e = z - H xhat
    e0 = 0.0;
    e1 = 0.0;

    // 2. S = H P H' + R: the top left 2 x 2 corner of P, plus R
    S00 = 1.0;
    S01 = 0.0;
    S10 = 0.0;
    S11 = 1.0;

${KF3_INVERSE}

    // 4. Gain: K = P H' Si. P H' is the first two columns of P.

    // 5. State: xhat = xhat + K e

    // 6. Covariance: P = P - K H P. H P is rows 0 and 1 of the OLD P.

}`;

const KF3_UPDATE_MAIN = (fn: string) => `float xhat[3] = {2.1732, 1.1, 0.5736};   // state after a predict step: x, y, heading
float P[3][3] = {{0.25, 0.05, 0.02},     // covariance after a predict step
                 {0.05, 0.25, -0.03},
                 {0.02, -0.03, 0.06}};
float R[2][2] = {{0.25, 0.0},            // measurement noise of the fix: x, then y
                 {0.0, 0.75}};
float K[3][2];        // gain: 3 states (rows) by 2 measured numbers (columns)
float t_x = 0;        // results
float t_y = 0;
float t_th = 0;
float t_K00 = 0;
float t_K21 = 0;
float t_P00 = 0;
float t_P11 = 0;
float t_P02 = 0;
float t_P22 = 0;

${fn}

void main(void)
{
    kf3_update(2.4, 1.0);
    t_x = xhat[0];
    t_y = xhat[1];
    t_th = xhat[2];
    t_K00 = K[0][0];
    t_K21 = K[2][1];
    t_P00 = P[0][0];
    t_P11 = P[1][1];
    t_P02 = P[0][2];
    t_P22 = P[2][2];

    while (1) {}
}
`;

// Whole filter on the bench (level loc-kf3).
const KF3_RUN_GLOBALS = `#define DT 0.01       // the filter runs every 10 ms
float xhat[3] = {0.0, 0.0, 0.0};        // state: x (ft), y (ft), heading (rad)
float P[3][3] = {{100.0, 0.0, 0.0},     // position unknown, heading known
                 {0.0, 100.0, 0.0},
                 {0.0, 0.0, 0.0001}};
float Q[3][3] = {{0.00001, 0.0, 0.0},   // what 10 ms of dead reckoning adds
                 {0.0, 0.00001, 0.0},
                 {0.0, 0.0, 0.000001}};
float R[2][2] = {{0.0225, 0.0},         // one fix: 0.15 ft squared, in x and in y
                 {0.0, 0.0225}};
float B[3][2];
float u[2];
float K[3][2];
float vLeft = 0;
float vRight = 0;
float vSum = 0;       // sums of the last readings of V and omega
float wSum = 0;
float v = 0;          // their averages over the last 10 ms, for the filter
float omega = 0;
int newStep = 0;      // 1: 10 ms have passed, the main loop must run the filter
uint32_t numTimer0calls = 0;`;

const KF3_RUN_DRIVE = `    // Drive: 4 s straight, 2.5 s on a left arc, then straight again
    numTimer0calls++;
    if (numTimer0calls <= 4000) {
        tb_set_effort(4.8, 4.8);
    } else if (numTimer0calls <= 6500) {
        tb_set_effort(3.6, 6.0);
    } else {
        tb_set_effort(4.8, 4.8);
    }
    vLeft = tb_left_speed();
    vRight = tb_right_speed();
`;

const KF3_PREDICT_BLANK = `// Predict: the robot drove at v (ft/s) and turned at omega (rad/s) for dt seconds.
void kf3_predict(float v, float omega, float dt)
{

}`;

const KF3_UPDATE_BLANK = `// Update: a position fix (zx, zy) arrived. H = [1 0 0; 0 1 0].
void kf3_update(float zx, float zy)
{

}`;

const KF3_RUN_ISR_SUMS = `    // Sum V and omega. Every 10th call: hand their averages to the main loop.
    vSum = vSum + 0.5 * (vLeft + vRight);
    wSum = wSum + (vRight - vLeft) / WHEEL_BASE;
    if (numTimer0calls % 10 == 0) {
        v = vSum / 10.0;
        omega = wSum / 10.0;
        vSum = 0.0;
        wSum = 0.0;
        newStep = 1;
    }`;

const KF3_RUN_LOOP = `
        // Every 10 ms: predict, update if a fix arrived, report
        if (newStep == 1) {
            newStep = 0;
            kf3_predict(v, omega, DT);
            if (tb_gps_new()) {
                kf3_update(tb_gps_x(), tb_gps_y());
            }
            tb_report_pose(xhat[0], xhat[1], xhat[2]);
        }`;

export const ch18: Chapter = {
  id: "localization",
  number: 18,
  title: "Where am I",
  blurb: "Frames and transforms, dead reckoning, gyro drift, a Kalman filter built step by step, and move-to-XY.",
  requires: ["control"],
  course: ["L15", "L19", "L20-21", "HW4", "HW6"],
  levels: [
    {
      id: "loc-brief",
      kind: "brief",
      title: "Two frames and a pose",
      goal: "Learn what coordinates, the robot frame, the world frame and a pose are.",
      refs: [{ course: "L15", slide: [9, 11] }, { course: "HW4" }],
      brief: `
A sensor on the robot says "golf ball 3 ft ahead, 1.5 ft to the right". Where is that in the room? That depends on where the robot is and which way it points. This chapter is about keeping track of both.

## Coordinates
A pair of **coordinates** (x, y) names a point by two distances from a fixed starting point, the **origin**: x along one direction (the x axis), then y along the direction a quarter turn to the left of it (the y axis). The point (2, 1) is "2 along x, then 1 along y". A negative number means the opposite direction.

## Two frames
A **frame** is a choice of origin and axes. The robot uses two.

- The **world frame** is fixed to the room: its origin is a mark on the floor, and it never moves.
- The **robot frame** (or body frame) is fixed to the robot and moves with it: origin between the wheels, **x straight ahead, y to the robot's left**. "3 ft ahead, 1.5 ft to the right" is the point (3, -1.5) in the robot frame.

## The pose
The robot's **pose** is three numbers in the world frame: its position (x, y) and its **heading** theta, the angle from the world x axis to the direction the robot points. Counter-clockwise is positive and the unit is radians, as in chapter 16.

Drag and turn the robot in the figure. The point keeps its robot coordinates, and its world coordinates change.

{{figure:frames}}

## What this chapter builds
1. **Dead reckoning**: the robot works out its own pose by adding up the motion of its wheels. Small errors add up too, so the estimate slowly **drifts** away from the truth.
2. **Transforms**: converting a point from one frame to the other.
3. A **Kalman filter**: blending the drifting estimate with a measurement from outside.
4. **Move to XY**: driving to a point of the room.

Each needs a little maths you may not have met. A short "Maths you need" level comes right before it is used.
`,
      questions: [
        {
          prompt: "In the robot frame, where is a point with coordinates (0, 1)?",
          options: ["One foot to the robot's left", "One foot ahead of the robot", "One foot to the robot's right", "One foot north of the room's origin"],
          answer: 0,
          why: "Robot x points straight ahead, so robot y points to the robot's left. HW4 uses the same convention.",
        },
        {
          prompt: "A ball lies 2 ft ahead of the robot and 0.5 ft to its right. What are its coordinates in the robot frame?",
          options: ["(0.5, 2)", "(2, 0.5)", "(2, -0.5)", "(-0.5, 2)"],
          answer: 2,
          why: "x is the distance ahead: 2. y is positive to the left, so 0.5 ft to the right is y = -0.5.",
        },
        {
          prompt: "The robot stands at (4, 1) in the world with heading 0: it points along the world x axis. A ball is at (1, 0) in the robot frame. Where is the ball in the world?",
          options: ["(1, 0)", "(5, 1)", "(4, 2)", "(3, 1)"],
          answer: 1,
          why: "The ball is 1 ft straight ahead. With heading 0, ahead is the world x direction: (4 + 1, 1) = (5, 1). For any other heading you need the maths of the next levels.",
        },
      ],
      takeaway: "Pose = position + heading. Sensors on the robot speak robot frame (x ahead, y left); the room speaks world frame.",
    },
    {
      id: "loc-sincos",
      kind: "calc",
      title: "Maths you need: sine and cosine",
      goal: "Split a move of a given length and direction into how far it goes along x and how far along y.",
      refs: [{ course: "L15", slide: [14, 26], note: "where the lecture uses r cos and r sin" }],
      brief: `
The robot points in direction theta and drives a short distance d. How far did it move along the world's x axis, and how far along y? Every level from here on needs this answer. It is what sine and cosine are for.

## Across and up
Draw the move as an arrow of length d at the angle theta. Replace it by two moves: **across** (along x), then **up** (along y).

- across = d x cos(theta)
- up = d x sin(theta)

\`cos(theta)\` and \`sin(theta)\` are two numbers between -1 and 1 that depend only on the angle: the share of the length that goes across, and the share that goes up. A calculator has both, and so does C.

Move the arrow in the figure and watch the two parts.

{{figure:math-sincos}}

## Values worth knowing
- 0 degrees: cos = 1, sin = 0. All of it goes across.
- 90 degrees (a quarter turn left, 1.571 rad): cos = 0, sin = 1. All of it goes up.
- 180 degrees (a half turn): cos = -1, sin = 0. All of it goes across, backwards.
- 30 degrees: cos = 0.866, sin = 0.5. At 60 degrees the two swap. At 45 degrees both are 0.707.

A negative result means the opposite direction: backwards along x, or down along y.

## Worked example
Heading 30 degrees, the robot drives 2 ft. Across: 2 x 0.866 = 1.732 ft. Up: 2 x 0.5 = 1.0 ft. From (1, 1) it arrives at (2.732, 2.0).

## In C
\`cos(theta)\` and \`sin(theta)\` take the angle in **radians**. \`cos(90)\` is not 0: it is the cosine of 90 radians. Convert degrees first: \`cos(deg * PI / 180.0)\`.
`,
      fields: [
        { id: "ax", label: "A move of 3 ft at 60 degrees: how far across (along x)", unit: "ft", answer: 1.5, tolPct: 1, why: "3 x cos 60 = 3 x 0.5 = 1.5 ft." },
        { id: "ay", label: "The same move: how far up (along y)", unit: "ft", answer: 2.598, tolPct: 1, why: "3 x sin 60 = 3 x 0.866 = 2.598 ft." },
        { id: "b", label: "The robot is at (5, 1), heading 180 degrees, and drives 2 ft. Its new x", unit: "ft", answer: 3, tolPct: 1, why: "cos 180 = -1: across = 2 x (-1) = -2. New x = 5 - 2 = 3. It drove backwards along the x axis." },
        { id: "c", label: "A move of 2 ft at -30 degrees (30 degrees to the right): how far up", unit: "ft", answer: -1, tolPct: 1, why: "sin(-30) = -0.5, so up = 2 x (-0.5) = -1 ft: the move goes down. cos(-30) is still +0.866." },
        { id: "d", label: "In C, theta = 0.5236 (30 degrees in radians). Value of 4 * cos(theta)", answer: 3.464, tolPct: 1, why: "cos(0.5236 rad) = cos 30 degrees = 0.866, and 4 x 0.866 = 3.464." },
      ],
      hints: [
        "across = length x cos(angle), up = length x sin(angle). Set your calculator to degrees for the first four fields.",
        "cos 60 = 0.5, sin 60 = 0.866, cos 180 = -1, sin(-30) = -0.5.",
        "For the new x, add the across part to the old x: 5 + 2 x cos 180.",
      ],
      takeaway: "cos is the share of a move that goes along x, sin the share that goes along y. In C both take radians.",
    },
    {
      id: "loc-dead",
      kind: "code",
      mode: "write",
      title: "Dead reckoning",
      goal: "Keep track of the robot's pose by adding up its wheel motion every millisecond.",
      refs: [{ course: "L15", slide: [22, 23, 26] }, { course: "Lab 3" }],
      brief: `
**Dead reckoning** is how the robot tracks its own pose with nothing but its wheels: start from a known pose and add up every small move. It is the running sum of chapter 16 ("adding up over time"), done three times.

The robot has two driven wheels a distance b apart (a **differential drive**). From the two wheel speeds:

- forward speed **V = (vLeft + vRight) / 2**: the middle of the robot moves at the average of the wheels
- turn rate **omega = (vRight - vLeft) / b**, in rad/s, as in chapter 16

In one time step of 0.001 s the robot turns by omega x 0.001 and drives V x 0.001 ft in the direction theta. The previous level splits that small move into across and up:

\`\`\`c
theta = theta + omega * 0.001;
x = x + V * cos(theta) * 0.001;
y = y + V * sin(theta) * 0.001;
\`\`\`

Adding "speed x time step" like this is called the **rectangle rule**.

## What to do
The interrupt function already drives the robot: straight, then on a left arc, then stop. Add the code that keeps track of where it is:

1. Read both wheel speeds into \`vLeft\` and \`vRight\` (\`tb_left_speed()\`, \`tb_right_speed()\`).
2. Update \`theta\`, then \`x\` and \`y\`, as above. \`WHEEL_BASE\` is b. Write the average as \`0.5 * (vLeft + vRight)\`.

\`x\`, \`y\` and \`theta\` are globals that start at 0: the robot starts at the origin, pointing along the world x axis. \`theta\` is already in radians: do not convert it.

Try it in the figure: set the two wheel speeds and see the path these three sums produce, then let one encoder read 1 % too much.

{{figure:dead-reckoning}}

The last line of the function reports your estimate to the bench, which compares it with the true pose.
${BENCH}`,
      kit: "robot",
      durationMs: 3500,
      starter: prog(
        POSE_GLOBALS,
        `
${DRIVE}
    // Dead reckoning: wheel speeds -> V and omega -> theta, x, y

    tb_report_pose(x, y, theta);`,
      ),
      solution: prog(
        POSE_GLOBALS,
        `
${DRIVE}
    // Dead reckoning: wheel speeds -> V and omega -> theta, x, y
    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

    tb_report_pose(x, y, theta);`,
      ),
      checks: [
        { kind: "signal", name: "TB_X_FT", at: 1500, equals: 1.44, tol: 0.01, label: "The robot really drove 1.44 ft straight in the first 1.5 s" },
        { kind: "var", name: "x", at: 1500, min: 1.42, max: 1.46, label: "Your x agrees after the straight part (1.44 ft)", hint: "0: the wheel speeds are never read, or the average is written (1/2) * ..., which is 0 in C: write 0.5. About 0.001: x must add to its own old value, x = x + ... About 1400: the `* 0.001` is missing. Nearly 0 with y growing: sin and cos are swapped." },
        { kind: "var", name: "theta", min: 1.48, max: 1.52, label: "Your heading after the arc is about 1.49 rad", hint: "omega = (vRight - vLeft) / WHEEL_BASE. Swapped wheels give -1.49; about 0.89 means the division by WHEEL_BASE is missing." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.01, label: "Heading estimate within 0.01 rad of the truth at the end" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.02, label: "Position estimate within 0.02 ft of the truth at the end", hint: "x uses cos(theta), y uses sin(theta). theta is already in radians: do not convert it. Each step is multiplied by 0.001 s." },
      ],
      watch: ["vLeft", "vRight", "x", "y", "theta"],
      hints: [
        "Five lines: two readings, then theta, x and y.",
        "`theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;`",
        "`x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;` and the same for y with sin.",
      ],
      takeaway: "Three sums, one thousand times a second, and the robot knows where it is. On this bench the wheels never slip, so the estimate stays good. On the floor it slowly goes wrong, which is why the rest of the chapter exists.",
    },
    {
      id: "loc-rotate-math",
      kind: "calc",
      title: "Maths you need: turning a point",
      goal: "Rotate a point by an angle, first as two lines of arithmetic and then as a matrix.",
      refs: [{ course: "L15", slide: [17, 18] }, { course: "HW4" }],
      brief: `
A point is known in the robot frame: "2 ft ahead, 1 ft to the left", the point (2, 1). The robot's heading is theta. Which way is that in the room? To answer, you **rotate** the point by theta.

## Two legs
Walk to the point in two legs: x ahead, then y to the left. Turn the robot by theta and both legs turn with it.

- The "ahead" leg, of length x, now points in the direction theta. It reaches x cos(theta) across and x sin(theta) up: the previous maths level.
- The "left" leg, of length y, points a quarter turn further left. A quarter turn swaps the two parts and flips one sign: it reaches -y sin(theta) across and y cos(theta) up.

Add the legs:

- **x' = x cos(theta) - y sin(theta)**
- **y' = x sin(theta) + y cos(theta)**

Turn the point in the figure and watch the two legs.

{{figure:math-rotate}}

## Worked example
(2, 1) rotated by 30 degrees (cos = 0.866, sin = 0.5):

- x' = 2 x 0.866 - 1 x 0.5 = 1.232
- y' = 2 x 0.5 + 1 x 0.866 = 1.866

## The same thing as a matrix
Lectures and HW4 write the four numbers as a table, the **rotation matrix**:

\`\`\`c
R = [ cos(theta)  -sin(theta) ]
    [ sin(theta)   cos(theta) ]
\`\`\`

"R times (x, y)" means: in each row, multiply the first entry by x and the second by y, and add. Row 1 gives x', row 2 gives y'. It is nothing new, only a compact way to write the two lines. Switch the figure to "a matrix" to see it with numbers.

Angles are given in degrees here: set your calculator to degree mode.
`,
      fields: [
        { id: "a", label: "The point (2, 1) rotated by 90 degrees: new x", answer: -1, tolPct: 1, why: "x' = 2 cos 90 - 1 sin 90 = 0 - 1 = -1. A quarter turn to the left sends (2, 1) to (-1, 2): what was ahead is now to the left." },
        { id: "a2", label: "The point (1, 0) rotated by 45 degrees: new x", answer: 0.707, tolPct: 1, why: "x' = 1 x cos 45 - 0 = 0.707. A point straight ahead only has the 'ahead' leg, so this is the across part of the previous level." },
        { id: "a3", label: "The point (0, 1) rotated by 30 degrees: new x", answer: -0.5, tolPct: 1, why: "x' = 0 - 1 x sin 30 = -0.5. The 'left' leg leans backwards along x when the robot turns left." },
        { id: "b", label: "The point (3, 2) rotated by 60 degrees: new y", answer: 3.598, tolPct: 0.5, why: "y' = 3 sin 60 + 2 cos 60 = 2.598 + 1 = 3.598." },
        { id: "m", label: "For 60 degrees the matrix is [0.5 -0.866; 0.866 0.5]. Row 1 times (4, 2)", answer: 0.268, tolPct: 2, why: "0.5 x 4 + (-0.866) x 2 = 2 - 1.732 = 0.268. That is x' of the point (4, 2)." },
      ],
      hints: [
        "x' = x cos - y sin, and y' = x sin + y cos. Write the numbers under the letters.",
        "cos 90 = 0 and sin 90 = 1; cos 45 = 0.707; sin 30 = 0.5; cos 60 = 0.5 and sin 60 = 0.866.",
        "A matrix row times (x, y): first entry x x, plus second entry x y.",
      ],
      takeaway: "Rotating a point is two lines: x' = x cos - y sin, y' = x sin + y cos. A rotation matrix is those two lines written as a table.",
    },
    {
      id: "loc-transform",
      kind: "calc",
      title: "Rotate, shift, and back",
      goal: "Transform points between the robot frame and the world frame by hand, in both directions.",
      refs: [{ course: "L15", slide: [19, 18] }, { course: "HW4" }],
      brief: `
HW4 asks for these two transforms by hand. Practise them here with other numbers.

## Robot frame to world frame
The robot sees a point at (x, y) in its own frame. Rotate it by the heading theta (previous level), then shift it by the robot's position (Tx, Ty). Shifting is also called a **translation**:

- x_world = x cos(theta) - y sin(theta) + Tx
- y_world = x sin(theta) + y cos(theta) + Ty

Example: the robot is at (4, 1) with heading 90 degrees and sees a ball at (2, 0), straight ahead. Rotated: (0, 2). Shifted: (4, 3). The ball is 2 ft further along world y.

## World frame to robot frame
Undo the two steps in the opposite order, like taking off shoes and socks: **subtract** the robot's position, then rotate **back** by theta:

- dx = x_world - Tx, dy = y_world - Ty
- x_robot = dx cos(theta) + dy sin(theta)
- y_robot = -dx sin(theta) + dy cos(theta)

Rotating back is rotating by -theta, which only flips the signs of the two sines.

In the robot frame, positive y is to the robot's **left**. A negative y means the point is on its right.

In the figure, switch the point to "stays in the room" to see the inverse written out with numbers.

{{figure:frames}}

Angles are given in degrees: set your calculator to degree mode. HW4 packs "rotate, then shift" into one 3 x 3 matrix; the practice level "One matrix for rotate and shift" shows how.
`,
      fields: [
        { id: "z", label: "Robot at (4.0, 1.0), heading 0. Ball at (3.0, -1.5) in the robot frame. Ball's world x", answer: 7, tolPct: 0.5, why: "With heading 0, cos = 1 and sin = 0: nothing turns. x = 3.0 + 4.0 = 7.0." },
        {
          id: "c",
          label: "Ball at (3.0, -1.5) in the robot frame, robot at (4.0, 1.0), theta = 40 degrees. Ball's world x",
          answer: 7.2623,
          tolPct: 0.1,
          why: "x = 3.0 cos 40 - (-1.5) sin 40 + 4.0 = 2.2981 + 0.9642 + 4.0 = 7.2623. Note the sign: minus y sin(theta) with a negative y is a plus.",
        },
        { id: "d", label: "Robot at (1, 2) heading 90 degrees, ball at (3, 5) in the world: ball's x in the robot frame", answer: 3, tolPct: 1, why: "dx = 2, dy = 3. x_robot = 2 cos 90 + 3 sin 90 = 3. The robot looks along world y, and the ball is 3 ft further along world y: 3 ft ahead." },
        { id: "e", label: "Same case: ball's y in the robot frame", answer: -2, tolPct: 1, why: "y_robot = -2 sin 90 + 3 cos 90 = -2. Negative: the ball is 2 ft to the robot's right." },
        {
          id: "f",
          label: "Ball at (1.5, 2.0) in the world, robot at (4.0, 1.0), theta = 150 degrees. Ball's y in the robot frame",
          answer: 0.384,
          tolPct: 1,
          why: "dx = 1.5 - 4.0 = -2.5, dy = 2.0 - 1.0 = 1.0. y_robot = 2.5 sin 150 + 1.0 cos 150 = 1.25 - 0.866 = 0.384. Positive: the ball is on the robot's left.",
        },
      ],
      hints: [
        "Decide the direction first. A point known in the robot frame: rotate, then add. A point known in the world: subtract, then rotate back.",
        "cos 90 = 0 and sin 90 = 1; cos 40 = 0.76604 and sin 40 = 0.64279; cos 150 = -0.866 and sin 150 = 0.5.",
        "Last field: dx = -2.5, dy = 1.0, and y_robot = -dx sin(theta) + dy cos(theta).",
      ],
      takeaway: "Out: rotate, then add. Back: subtract, then rotate the other way. The order matters, and the sign of the robot-frame y tells left from right.",
    },
    {
      id: "loc-spread",
      kind: "calc",
      title: "Maths you need: average and spread",
      goal: "Describe a set of noisy sensor readings with two numbers: their mean and their variance.",
      refs: [{ course: "L20-21", slide: [41, 10] }, { course: "HW6" }],
      brief: `
Dead reckoning drifts, so the robot needs a second opinion: a sensor that measures its position from outside. But every sensor is a little wrong, and differently each time. Ask a distance sensor the same question five times: 2.1, 1.9, 2.2, 1.8, 2.0 ft. The small random part is called **noise**. Two numbers describe such readings.

## The mean
The **mean** is the average: add the readings and divide by how many there are.

(2.1 + 1.9 + 2.2 + 1.8 + 2.0) / 5 = 2.0 ft

Noise is as often above as below, so it largely cancels in the mean. The mean is the best single guess.

## The variance
How far do the readings scatter round the mean? Take each reading's distance from the mean, square it (so above and below both count as positive), and average the squares:

- distances from the mean: 0.1, -0.1, 0.2, -0.2, 0
- squared: 0.01, 0.01, 0.04, 0.04, 0
- average: 0.10 / 5 = 0.02

That is the **variance**: 0.02. Its square root, 0.14 ft, is the **standard deviation**: the typical error of one reading. A small variance means the readings agree: a sensor you can trust.

In the figure, take more readings, then make the sensor noisier. Then switch on a **bias**: a constant error, the same on every reading. Averaging removes noise, but not a bias.

{{figure:math-spread}}

## The bell curve
Pile up many noisy readings and they form a bell shape, the **Gaussian**: most readings near the mean, few far away, about two thirds within one standard deviation. A Gaussian is described completely by its mean and its variance. That is why the filter of the next levels stores just those two numbers.
`,
      fields: [
        { id: "m", label: "Four readings: 3.0, 3.4, 2.6, 3.0 ft. Their mean", unit: "ft", answer: 3.0, tolPct: 0.5, why: "(3.0 + 3.4 + 2.6 + 3.0) / 4 = 12.0 / 4 = 3.0 ft." },
        { id: "v", label: "Their variance", answer: 0.08, tolPct: 1, why: "Distances from the mean: 0, 0.4, -0.4, 0. Squared: 0, 0.16, 0.16, 0. Average: 0.32 / 4 = 0.08." },
        { id: "sd", label: "Their standard deviation", unit: "ft", answer: 0.283, tolPct: 1, why: "sqrt(0.08) = 0.283 ft: a single reading is typically about 0.28 ft from the mean." },
        { id: "r", label: "A position sensor is typically off by 0.2 ft (its standard deviation). Its variance", answer: 0.04, tolPct: 1, why: "Variance = standard deviation squared = 0.2 x 0.2 = 0.04. You will meet this number as R." },
        { id: "bias", label: "A gyro on a robot that stands still reads 0.06, 0.04, 0.05, 0.05 rad/s. Its bias (the mean of the readings)", unit: "rad/s", answer: 0.05, tolPct: 1, why: "(0.06 + 0.04 + 0.05 + 0.05) / 4 = 0.05 rad/s. The robot is not turning, so the whole mean is bias. The course code measures the gyro's bias exactly this way at start-up." },
      ],
      hints: [
        "Mean: add up, divide by the count.",
        "Variance: subtract the mean from each reading, square each result, and take the mean of the squares.",
        "Standard deviation = square root of the variance; variance = standard deviation x itself.",
      ],
      takeaway: "Mean: the best single guess. Variance: how much to trust it (small is good). Averaging removes noise but never a bias.",
    },
    {
      id: "loc-kf-calc",
      kind: "calc",
      title: "A Kalman filter with one number",
      goal: "Do one predict step and one update step of a 1-D Kalman filter by hand.",
      refs: [{ course: "L20-21", slide: [23, 32] }, { course: "HW6" }],
      brief: `
Forget matrices for now. The robot drives along a line and wants one number: its position x. It has dead reckoning, which drifts, and a position sensor, which is noisy. A **Kalman filter** blends the two.

The filter never claims to know x exactly. It keeps a **belief**: a best guess (the **mean**) and how unsure that guess is (the **variance** of the previous level). It repeats two steps.

## Predict: the robot moves
The wheels say the robot moved by u. The guess moves with it. But the wheels are not perfect, so the robot is now a bit **less** sure:

- mean = mean + u
- variance = variance + q (q: the variance one move adds, the **process noise**)

## Update: a measurement arrives
A sensor says "you are at z", with variance r. Now there are two numbers for the same thing: the prediction and the measurement. Blend them with a **weighted average**: each gets a share of the say, and the surer one gets the larger share. The share of the measurement is the **Kalman gain** K:

- K = variance / (variance + r)
- mean = mean + K (z - mean), which is the same as (1 - K) x mean + K x z
- variance = (1 - K) variance

K lies between 0 and 1. Prediction very unsure and sensor good: K is close to 1, take the measurement. Prediction good and sensor poor: K is close to 0, keep the prediction. Both equally unsure: K = 0.5, the plain average. After an update the variance is always **smaller**: a measurement can only add information.

Move the two variances in the figure and watch where the blend lands.

{{figure:math-weighted}}

## Your turn
The belief is: mean 2.0 ft, variance 0.5. The robot moves u = 1.0 ft, with process noise q = 0.3. Then a measurement z = 3.6 ft arrives, with r = 0.2.
`,
      fields: [
        { id: "m1", label: "Mean after the predict step", unit: "ft", answer: 3.0, tolPct: 0.5, why: "2.0 + 1.0 = 3.0 ft." },
        { id: "p1", label: "Variance after the predict step", answer: 0.8, tolPct: 0.5, why: "0.5 + 0.3 = 0.8. Moving made the belief less sure." },
        { id: "k", label: "Kalman gain K", answer: 0.8, tolPct: 0.5, why: "K = 0.8 / (0.8 + 0.2) = 0.8. The measurement (variance 0.2) is four times better than the prediction (0.8), so it gets four fifths of the weight." },
        { id: "m2", label: "Mean after the update step", unit: "ft", answer: 3.48, tolPct: 0.5, why: "3.0 + 0.8 x (3.6 - 3.0) = 3.48 ft: 80 % of the way from the prediction to the measurement." },
        { id: "p2", label: "Variance after the update step", answer: 0.16, tolPct: 0.5, why: "(1 - 0.8) x 0.8 = 0.16. Smaller than both 0.8 and 0.2: the combined belief is better than either source alone." },
      ],
      hints: [
        "Predict first: add u to the mean, add q to the variance.",
        "K uses the variance after the predict step: 0.8 / (0.8 + 0.2).",
        "Mean: 3.0 + K x (3.6 - 3.0). Variance: (1 - K) x 0.8.",
      ],
      takeaway: "Predict: move the guess, grow the doubt. Update: pull the guess towards the measurement by the gain, shrink the doubt. The gain is just 'how unsure am I' divided by 'how unsure are we both'.",
    },
    {
      id: "loc-kf-code",
      kind: "code",
      mode: "write",
      title: "The two functions",
      goal: "Write the predict and update functions of the 1-D Kalman filter.",
      refs: [{ course: "L20-21", slide: [23, 32] }, { course: "HW6" }],
      brief: `
Turn the two steps of the previous level into two functions. The belief lives in two globals: \`kf_x\` (mean) and \`kf_p\` (variance). Keep the gain of the last update in \`kf_k\`, so you can watch it.

- \`kf_predict(u, q)\`: the robot moved by \`u\`, and the move added the variance \`q\`.
- \`kf_update(z, r)\`: a measurement \`z\` with variance \`r\` arrived. Compute the gain, pull the mean towards \`z\` by the gain, shrink the variance.

One thing to watch in \`kf_update\`: the gain is computed from the variance **before** it is reduced, so the order of the lines matters.

The figure shows the same round as bell curves: the belief slides and widens when the robot moves, then narrows when the measurement arrives.

{{figure:kalman-1d}}

\`main\` runs two rounds. The first uses the numbers of the previous level, so you know what to expect: mean 3.48, variance 0.16. The second starts from there with a new measurement.

These are the equations HW6 writes with matrices, for one number. The filter in the robot's code has the same shape, with x, y and theta together and 3 x 3 matrices in place of single numbers.
`,
      kit: "robot",
      durationMs: 2,
      starter: KF_MAIN(KF_EMPTY),
      solution: KF_MAIN(KF_FUNCTIONS),
      checks: [
        { kind: "var", name: "x1", min: 3.479, max: 3.481, label: "Round 1: the mean is 3.48 ft", hint: "2.0: nothing is written yet. 3.0: the update did nothing. 3.12: the gain is upside down, it is kf_p / (kf_p + r). 2.52: the mean moved away from z, use (z - kf_x). 3.43: kf_predict must add q to kf_p. 3.72: brackets, kf_p / (kf_p + r)." },
        { kind: "var", name: "p1", min: 0.1599, max: 0.1601, label: "Round 1: the variance is 0.16", hint: "Compute the gain before you change kf_p, and reduce kf_p after you have used it." },
        { kind: "var", name: "kf_k", min: 0.6969, max: 0.6971, label: "Round 2: the gain is 0.46 / 0.66 = 0.697", hint: "0: the gain must be stored in the global kf_k, not in a new local variable." },
        { kind: "var", name: "kf_x", min: 4.2845, max: 4.2852, label: "Round 2: the mean is 4.2848 ft" },
        { kind: "var", name: "kf_p", min: 0.1393, max: 0.1395, label: "Round 2: the variance is 0.1394" },
      ],
      watch: ["x1", "p1", "kf_k", "kf_x", "kf_p"],
      hints: [
        "kf_predict is two lines, each one an addition: the mean grows by u, the variance by q.",
        "kf_update is three lines, in this order: gain = variance / (variance + r), then the mean moves by gain x (z - mean), then the variance is multiplied by (1 - gain).",
        "`kf_k = kf_p / (kf_p + r);` `kf_x = kf_x + kf_k * (z - kf_x);` `kf_p = (1.0 - kf_k) * kf_p;`",
      ],
      takeaway: "Five lines of C. In round 2 the gain dropped from 0.8 to 0.7: the filter was already more sure, so it trusted the new measurement a little less. Nobody told it to; the variance did.",
    },
    {
      id: "loc-kf-run",
      kind: "code",
      mode: "complete",
      title: "Run it on the robot",
      goal: "Fuse the wheel speeds (1000 times a second) with noisy position fixes (100 times a second) using your two functions.",
      refs: [{ course: "L20-21", slide: [16, 17] }, { course: "HW6" }],
      brief: `
This is HW6 in one dimension. The robot drives along the x axis at about 1 ft/s. It has two sources of information, and each has a problem:

- **Dead reckoning** from the wheel speeds, every 1 ms. Smooth, but it only measures **change**. The robot was put down 2 ft away from where the code thinks it starts, and dead reckoning will never notice.
- **Position fixes**, 100 times a second. A fix is one measured position from outside the robot: in the lab from cameras on the ceiling (the OptiTrack system), here from \`tb_gps_x()\`. It does not drift, but each fix is off by about 0.2 ft, at random.

## What to do
In the interrupt function, as the robot's own code does:

1. **Every call**: predict. The robot moved \`v * 0.001\` ft since the last call. Use the process noise \`Q\`.
2. **Only when a new fix has arrived**: update. \`tb_gps_new()\` returns 1 once for every new fix. Read it with \`tb_gps_x()\` into \`z\` and use the measurement noise \`R\`. Using the same fix twice would count one piece of information as two.

\`R\` is the variance of a fix: standard deviation squared, 0.2 x 0.2 = 0.04. \`Q\` is the variance one millisecond of dead reckoning adds: tiny. The filter starts with \`kf_p = 100\`: "I have no idea where I am".

## What to look for
The first fix pulls the estimate almost all the way to the truth, because the filter is so unsure. Then the gain falls, and the estimate becomes several times more accurate than a single fix.

Tuning Q and R in HW6 is this trade: a larger R (or a smaller Q) trusts the fixes less, so the estimate is smoother and slower to correct. A smaller R makes it jump around with the fixes.
${BENCH}
- \`tb_gps_new()\`: 1 when a new position fix has arrived since the last call, else 0.
- \`tb_gps_x()\`: the latest fix, ft.
`,
      kit: "robot",
      durationMs: 6000,
      stimuli: [
        { at: 0, set: "TB_SET_X_FT", value: 2 },
        { at: 0, set: "TB_GPS_NOISE", value: 0.2 },
        { at: 2000, set: "TB_STATS_RESET", value: 1 },
      ],
      starter: prog(
        `#define Q 0.000001    // variance added by 1 ms of dead reckoning, ft^2
#define R 0.04        // variance of one position fix, ft^2
float kf_x = 0.0;     // mean: best guess of the position, ft
float kf_p = 100.0;   // variance: how unsure the guess is, ft^2
float kf_k = 0;       // gain of the last update
float v = 0;          // forward speed, ft/s
float z = 0;          // last position fix, ft`,
        `
    tb_set_effort(4.8, 4.8);
    v = 0.5 * (tb_left_speed() + tb_right_speed());

    // Predict, every call

    // Update, only when a new fix has arrived

    tb_report_pose(kf_x, 0.0, 0.0);`,
        { functions: KF_FUNCTIONS },
      ),
      solution: prog(
        `#define Q 0.000001    // variance added by 1 ms of dead reckoning, ft^2
#define R 0.04        // variance of one position fix, ft^2
float kf_x = 0.0;     // mean: best guess of the position, ft
float kf_p = 100.0;   // variance: how unsure the guess is, ft^2
float kf_k = 0;       // gain of the last update
float v = 0;          // forward speed, ft/s
float z = 0;          // last position fix, ft`,
        `
    tb_set_effort(4.8, 4.8);
    v = 0.5 * (tb_left_speed() + tb_right_speed());

    // Predict, every call
    kf_predict(v * 0.001, Q);

    // Update, only when a new fix has arrived
    if (tb_gps_new()) {
        z = tb_gps_x();
        kf_update(z, R);
    }

    tb_report_pose(kf_x, 0.0, 0.0);`,
        { functions: KF_FUNCTIONS },
      ),
      checks: [
        { kind: "signal", name: "TB_EST_ERR_FT", at: 100, max: 0.3, label: "After 0.1 s the estimate has found the robot (it started 2 ft off)", hint: "Still 2 ft off: the update never runs. Call kf_update when tb_gps_new() returns 1. Far more than 2 ft: kf_predict takes the distance moved in one call, v * 0.001, not the speed v." },
        { kind: "signal", name: "TB_GPS_RMS_FT", min: 0.15, label: "The raw fixes are off by about 0.2 ft" },
        { kind: "signal", name: "TB_EST_RMS_FT", max: 0.06, label: "From 2 s on, the estimate is off by less than 0.06 ft: several times better than a fix", hint: "About 0.2 ft: the estimate just follows the fixes. Q belongs in kf_predict and R in kf_update, not the other way round. 1 ft or more: kf_predict must run on every call (with v * 0.001), not only when a fix arrives." },
        { kind: "var", name: "kf_p", max: 0.005, label: "The filter knows it is sure: the variance is below 0.005" },
        { kind: "var", name: "kf_p", min: 0.0004, label: "Each fix is used once: the variance settles near 0.0006", hint: "A variance near 0.0002 means every fix went through kf_update about ten times. Update only when tb_gps_new() returns 1." },
        { kind: "isr", fn: "cpu_timer0_isr", min: 5990, label: "The filter runs every millisecond" },
      ],
      watch: ["v", "z", "kf_x", "kf_p", "kf_k"],
      hints: [
        "The predict call needs the distance moved in one call: speed times 0.001 s.",
        "`kf_predict(v * 0.001, Q);`",
        "`if (tb_gps_new()) { z = tb_gps_x(); kf_update(z, R); }`",
      ],
      takeaway: "Fast, smooth, drifting dead reckoning plus slow, noisy, absolute fixes give an estimate better than both. The robot's real filter does this for x, y and theta at once, with 3 x 3 matrices in place of these single numbers. The practice levels \"Three states\" build it. A Kalman filter is the best possible blend only when the system is linear and the noise is Gaussian; otherwise it is still a good one.",
    },
    {
      id: "loc-atan2",
      kind: "calc",
      title: "Maths you need: the direction to a point",
      goal: "Work out how far away a target is, in which direction, and how far the robot must turn to face it.",
      refs: [{ course: "L19", slide: 8, note: "atan2 gives the direction to the next waypoint" }, { course: "L20-21", slide: 92, note: "distance and bearing from x and y" }],
      brief: `
To drive to a point the robot needs two things: how far away it is, and in which direction. Both come from the difference between the target and the robot:

dx = x_target - x_robot, dy = y_target - y_robot

## Distance
dx and dy are the two short sides of a right-angled triangle, and the straight line to the target is its long side. Pythagoras gives its length: **dist = sqrt(dx x dx + dy x dy)**. In C, \`sqrt()\` is the square root.

## Direction
Sine and cosine turn an angle into "across and up". Now you have across (dx) and up (dy) and want the angle back. That is \`atan2(dy, dx)\`: the angle of the arrow from the robot to the target, measured like a heading (from the world x axis, counter-clockwise positive, in radians). It lies between -PI and PI. Mind the order: dy comes first.

Why not the calculator's plain atan(dy / dx)? The division loses the signs: a target ahead and to the left (dx = 1, dy = 1) and one behind and to the right (-1, -1) both give dy / dx = 1. \`atan2\` gets both numbers and keeps them. On a calculator: take atan(dy / dx), and if dx is negative add PI (or subtract PI, to stay between -PI and PI).

Move the target in the figure, also behind the origin.

{{figure:math-atan2}}

## Worked example
Robot at (1, 1), target at (3, 2): dx = 2, dy = 1. dist = sqrt(4 + 1) = 2.236 ft. Direction = atan2(1, 2) = 0.464 rad (26.6 degrees).

## How far to turn
The robot's heading is theta and the direction to the target is alpha. It must turn left by alpha - theta. One trap: directions repeat after a full turn. With theta = 3.0 and alpha = -3.0 the difference is -6.0, "turn right almost a full circle". Adding 2 PI gives +0.283: a small left turn that ends in the same direction. The rule: if adding or subtracting 2 PI (6.283) makes the difference smaller in size, do it.
`,
      fields: [
        { id: "dist", label: "Robot at (0, 0), target at (3, 4). Distance", unit: "ft", answer: 5, tolPct: 0.5, why: "sqrt(3 x 3 + 4 x 4) = sqrt(25) = 5 ft." },
        { id: "a1", label: "Robot at (0, 0), target at (2, 2). Direction atan2(dy, dx)", unit: "rad", answer: 0.785, tolPct: 1, why: "dx = dy, so the arrow is at 45 degrees: 0.785 rad." },
        { id: "a2", label: "Target at (-1, 1): behind and to the left. Direction", unit: "rad", answer: 2.356, tolPct: 1, why: "Plain atan(1 / -1) gives -0.785. dx is negative, so add PI: 2.356 rad (135 degrees)." },
        { id: "a3", label: "Target at (0, -2): straight to the right of a robot that faces along x. Direction", unit: "rad", answer: -1.571, tolPct: 1, why: "A quarter turn clockwise: -PI / 2 = -1.571 rad. (dy / dx would divide by zero; atan2 has no such problem.)" },
        { id: "t", label: "Heading theta = 2.6 rad, direction to the target alpha = -2.356 rad. Turn to the left, the short way round", unit: "rad", answer: 1.327, tolPct: 1, why: "alpha - theta = -4.956. Adding 2 PI gives 1.327 rad, which is smaller in size: turn left by 1.327 rad, not right by 4.956." },
      ],
      hints: [
        "Distance: square dx and dy, add, take the square root.",
        "Direction: atan(dy / dx) on the calculator, in radians; when dx is negative add PI = 3.142.",
        "Last field: -2.356 - 2.6 = -4.956. Compare its size with -4.956 + 6.283.",
      ],
      takeaway: "dist = sqrt(dx x dx + dy x dy) and direction = atan2(dy, dx). Before you use a difference of two angles, bring it to the short way round by adding or subtracting 2 PI.",
    },
    {
      id: "loc-xy",
      kind: "code",
      mode: "debug",
      title: "Move to XY: the course's xy_control",
      goal: "Repair the turn error in the function that drives the robot to a point.",
      refs: [{ course: "L19", slide: [8, 10] }, { course: "L11", slide: 22, note: "the turn command of the speed controller" }, { course: "Lab 5" }],
      brief: `
The final project hands you \`xy_control\` (file \`user_xy.c\`). You call it every millisecond with your pose and a target point, and it sets \`vref\` and \`turn\` for the speed controller. You will tune and debug around it for weeks, so know how it works.

## What it does
1. \`dist\` and \`alpha\`: the distance and the direction to the target, as in the previous level.
2. **Turn error** = heading minus wanted direction: \`theta - alpha\`. The course's \`turn\` is **positive for a right turn** (chapter 16). A robot that points further left than \`alpha\` must turn right, so the error must be positive then. Careful: this is the reverse of the previous level's "alpha - theta, positive = left".
3. **Shortest way**: if adding or subtracting 2 PI makes the error smaller in size, use that. \`fabs()\` gives the size.
4. \`vref\` is 1 ft/s, or \`dist\` when closer than 1 ft: the robot slows down as it arrives.
5. \`turn = 2 * vref * turnerror\`: steer in proportion to the error. If \`turn\` is larger than \`turn_thres\`, \`vref\` becomes 0: spin on the spot first, drive afterwards.
6. Inside \`target_radius_near\` it stops steering (close to the target the direction swings wildly) and returns 1. Inside \`target_radius\` it stops.

## What to do
A teammate retyped the turn-error part and made two slips. The robot stands at the origin with heading 2.6 rad. The target is (-2, -2): behind it, on its left. It should turn left by 1.3 rad and drive there. Instead it twitches on the spot.

Fix the turn error inside \`xy_control\` (look for the comment "turn error"). The rest of the function is the course's and is given: you do not need to change it. Its first lines bring the heading between -PI and PI (\`floor\` and \`ceil\` round down and up to a whole number).

The global \`turned\` adds up how far the robot has turned: 1.3 rad the short way, 5 rad the long way round. \`speed_control(vref, turn)\` is the PI speed controller of chapter 16 with the course's steering coupling. The code works in feet; one floor tile of the course is 1 ft.
`,
      kit: "robot",
      durationMs: 6000,
      stimuli: [{ at: 0, set: "TB_SET_THETA_RAD", value: 2.6 }],
      starter: prog(XY_GLOBALS, XY_ISR, { functions: `${SPEED_CONTROL}\n\n${XY_CONTROL_BUGGY}` }),
      solution: prog(XY_GLOBALS, XY_ISR, { functions: `${SPEED_CONTROL}\n\n${XY_CONTROL}` }),
      checks: [
        { kind: "signal", name: "TB_X_FT", min: -2.25, max: -1.75, label: "x within 0.25 ft of the target (-2)", hint: "Still at the origin: the robot turns away from the target, or flips back and forth. Which sign must the error have when theta is larger than alpha?" },
        { kind: "signal", name: "TB_Y_FT", min: -2.25, max: -1.75, label: "y within 0.25 ft of the target (-2)" },
        { kind: "var", name: "turned", max: 2.5, label: "The robot took the short way round (about 1.4 rad of turning, not 5)", hint: "2.6 - (-2.36) is almost 5 rad. Subtracting 2 PI gives -1.33 rad: smaller, and the same direction." },
        { kind: "var", name: "near", equals: 1, label: "xy_control reports that the robot is near the target" },
        { kind: "signal", name: "TB_VLEFT", min: -0.02, max: 0.02, label: "The robot has stopped" },
      ],
      watch: ["x", "y", "theta", "vref", "turn", "turned", "near"],
      hints: [
        "Take theta = 1.0 and alpha = 0.5. The robot points too far left, so it must turn right, and a right turn is a positive turn. What sign does the code give?",
        "`turnerror = theta - alpha;` Then compare fabs(turnerror) with fabs(turnerror + 2.0 * PI) and with fabs(turnerror - 2.0 * PI), and keep the smallest.",
        "`if (fabs(turnerror + 2.0 * PI) < fabs(turnerror)) turnerror = turnerror + 2.0 * PI; else if (fabs(turnerror - 2.0 * PI) < fabs(turnerror)) turnerror = turnerror - 2.0 * PI;`",
      ],
      takeaway: "Move-to-XY is two proportional controllers (heading and distance) and a wrap. The sign of the turn error and the shortest-way correction are the two lines that go wrong when this code is touched.",
    },
    {
      id: "loc-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: way points round a square",
      goal: "Drive round a 2 ft square with your own dead reckoning, xy_control and a list of way points.",
      refs: [{ course: "L15", slide: 26 }, { course: "L19", slide: [6, 8] }, { course: "L11", slide: 21 }, { course: "Lab 5" }],
      brief: `
The navigation of the final project is three things you now have: a pose estimate, \`xy_control\`, and a list of **way points** (target points visited in order). Put them together.

The robot starts at the origin, heading 0. Drive it to (2, 0), (2, 2), (0, 2) and back to (0, 0), and stop there. The four points are in the arrays \`xWay\` and \`yWay\`.

## What to write
1. **In xy_control**: the turn-error lines are missing again. Write them as you did in the previous level.
2. **Dead reckoning** in the interrupt, from the wheel speeds, as in the level "Dead reckoning". Then report the pose with \`tb_report_pose(x, y, theta)\`.
3. **Way points**: call \`xy_control\` for way point number \`statePos\`:

\`\`\`c
near = xy_control(&vref, &turn, 1.0, x, y, xWay[statePos], yWay[statePos], theta, 0.25, 0.5);
\`\`\`

It returns 1 when the robot is within 0.5 ft of that point. Then go on to the next one: \`statePos++\`. Never go past the last way point: there the robot must arrive and stop.

The call of \`speed_control(vref, turn)\` is in place.

## What to expect
The robot starts each turn 0.5 ft before the corner, as the course robot does. The last two arguments are the final project's: the robot stops once it is within 0.25 ft of the last point, and it turns to the next point 0.5 ft early. They are yours to choose. A smaller target radius stops closer to the point but takes longer to get there. The two stars pull in opposite directions: home in time, and close to the point.

## The test
After 12 s the robot has been round the square and stands still within 0.3 ft of the origin, and your pose estimate is within 0.05 ft of the truth.
${BENCH}`,
      kit: "robot",
      durationMs: 12000,
      starter: prog(
        WAY_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning: theta, x, y. Then tb_report_pose(x, y, theta);

    // Way points: call xy_control for way point statePos, go on to the next when near

    speed_control(vref, turn);`,
        { functions: `${SPEED_CONTROL}\n\n${XY_CONTROL_BLANK}` },
      ),
      solution: prog(
        WAY_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning: theta, x, y. Then tb_report_pose(x, y, theta);
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;
    tb_report_pose(x, y, theta);

    // Way points: call xy_control for way point statePos, go on to the next when near
    near = xy_control(&vref, &turn, 1.0, x, y, xWay[statePos], yWay[statePos], theta, 0.1, 0.5);
    if (near == 1 && statePos < NUMWAYPOINTS - 1) {
        statePos++;
    }

    speed_control(vref, turn);`,
        { functions: `${SPEED_CONTROL}\n\n${XY_CONTROL}` },
      ),
      checks: [
        { kind: "signal", name: "TB_X_FT", at: 3000, min: 1.5, label: "After 3 s the robot is near the first corner (x above 1.5 ft)", hint: "Call xy_control on every interrupt and pass its vref and turn on to speed_control." },
        { kind: "signal", name: "TB_Y_FT", at: 5000, min: 1.4, label: "After 5 s it is near the second corner (y above 1.4 ft)", hint: "Stuck at the first corner: add 1 to statePos when xy_control returns 1. Turning the wrong way: check the turn error inside xy_control." },
        { kind: "var", name: "statePos", equals: 3, label: "The last way point is number 3, and statePos stays there", hint: "Only count up while statePos is below NUMWAYPOINTS - 1." },
        { kind: "signal", name: "TB_X_FT", min: -0.3, max: 0.3, label: "Back at the start: x within 0.3 ft of 0" },
        { kind: "signal", name: "TB_Y_FT", min: -0.3, max: 0.3, label: "Back at the start: y within 0.3 ft of 0" },
        { kind: "signal", name: "TB_VLEFT", min: -0.02, max: 0.02, label: "The robot has stopped" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.05, label: "Your pose estimate agrees with the truth within 0.05 ft", hint: "No value at all: call tb_report_pose(x, y, theta) on every pass. Otherwise: x and y add V * cos(theta) * 0.001 and V * sin(theta) * 0.001, with V the average wheel speed." },
      ],
      bonus: [
        { kind: "signal", name: "TB_VLEFT", at: 10500, min: -0.02, max: 0.02, label: "Home and stopped within 10.5 s", hint: "A very small target radius makes the robot creep the last inches. A larger one stops sooner." },
        { kind: "signal", name: "TB_Y_FT", min: -0.15, max: 0.15, label: "Stops within 0.15 ft of the start (choose the target radius)", hint: "The robot comes home along the y axis and stops as soon as it is inside the target radius. 0.25 ft is too far out." },
      ],
      watch: ["x", "y", "theta", "statePos", "near", "vref", "turn"],
      hints: [
        "Work in this order and test after each step: the turn error in xy_control, then dead reckoning (your x must match the 'Robot x' meter), then the way points.",
        "Turn error: `turnerror = theta - alpha;` then add or subtract 2.0 * PI if that makes fabs(turnerror) smaller. Dead reckoning: theta from (vRight - vLeft) / WHEEL_BASE, x and y from the average speed times cos(theta) and sin(theta), each times 0.001.",
        "After the xy_control call from the brief: `if (near == 1 && statePos < NUMWAYPOINTS - 1) { statePos++; }`",
      ],
      takeaway: "Speed control below, a pose estimate beside it, way points on top: this is the shape of the robot's navigation code. The final project adds the Kalman filter to keep the pose honest, and obstacle avoidance between the way points. This interrupt now spends about 6 us of every millisecond, most of it on sin, cos, atan2 and sqrt: the practice level \"Keep the interrupt short\" moves that work to the main loop.",
    },
    {
      id: "loc-gyro",
      kind: "code",
      mode: "complete",
      tier: "practice",
      title: "Practice: gyro bias, measure it and remove it",
      goal: "Average the gyro while the robot stands still and subtract that offset before integrating.",
      refs: [{ course: "L15", slide: [33, 27] }, { course: "Lab 5" }],
      brief: `
The robot also carries a **gyro** (gyroscope): a sensor chip that measures the turn rate directly, in rad/s. Adding its readings up gives the heading without using the wheels at all. But a gyro reads **true turn rate + bias + noise**. The bias is a small constant: the reading when the robot is not turning at all. This one reads about 0.05 rad/s at rest. Integrate that for 7 seconds and the heading is off by 0.35 rad (20 degrees) although the robot never moved.

## The cure
A bias is the same on every reading, so it can be measured. At start-up the course code keeps the robot still, adds up the gyro readings for a while, and divides by their number. That mean is the bias: the noise averages out, as in the level "Maths you need: average and spread". From then on it is subtracted from every reading.

## What to do
The function below has two phases, like the robot's code:

- **First second** (calls 1 to 1000): the robot stands still. Add each reading to \`gyro_sum\`. On call 1000, set \`gyro_offset = gyro_sum / 1000.0\`.
- **After that**: subtract \`gyro_offset\` from the reading before it is integrated. The integration is already written (given). It uses the **trapezoid rule** of the course code: the average of this reading and the previous one, times the time step. That is a little more accurate than the rectangle rule.

The robot then spins left for 2 seconds and stands still again until the end. Watch \`theta\` during the last seconds: it must not creep.
${BENCH}
- \`tb_gyro_z()\`: turn rate in rad/s, counter-clockwise positive, with bias and noise.
`,
      kit: "robot",
      durationMs: 8000,
      stimuli: [
        { at: 0, set: "TB_GYRO_BIAS", value: 0.05 },
        { at: 0, set: "TB_GYRO_NOISE", value: 0.01 },
      ],
      starter: prog(
        `float gyro = 0;        // gyro reading, rad/s
float gyro_old = 0;    // reading of the previous call
float gyro_sum = 0;    // sum of the readings during calibration
float gyro_offset = 0; // the bias found by the calibration
float theta = 0;       // heading, rad
uint32_t numTimer0calls = 0;`,
        `
    numTimer0calls++;
    gyro = tb_gyro_z();

    if (numTimer0calls <= 1000) {
        // Calibration: the robot stands still

    } else {
        // Remove the bias

        // Integrate with the trapezoid rule
        theta = theta + (gyro + gyro_old) * 0.0005;
        gyro_old = gyro;

        // Spin left for 2 s, then stand still
        if (numTimer0calls <= 3000) {
            tb_set_effort(-3.0, 3.0);
        } else {
            tb_set_effort(0.0, 0.0);
        }
    }

    tb_report_pose(0.0, 0.0, theta);`,
      ),
      solution: prog(
        `float gyro = 0;        // gyro reading, rad/s
float gyro_old = 0;    // reading of the previous call
float gyro_sum = 0;    // sum of the readings during calibration
float gyro_offset = 0; // the bias found by the calibration
float theta = 0;       // heading, rad
uint32_t numTimer0calls = 0;`,
        `
    numTimer0calls++;
    gyro = tb_gyro_z();

    if (numTimer0calls <= 1000) {
        // Calibration: the robot stands still
        gyro_sum = gyro_sum + gyro;
        if (numTimer0calls == 1000) {
            gyro_offset = gyro_sum / 1000.0;
        }
    } else {
        // Remove the bias
        gyro = gyro - gyro_offset;

        // Integrate with the trapezoid rule
        theta = theta + (gyro + gyro_old) * 0.0005;
        gyro_old = gyro;

        // Spin left for 2 s, then stand still
        if (numTimer0calls <= 3000) {
            tb_set_effort(-3.0, 3.0);
        } else {
            tb_set_effort(0.0, 0.0);
        }
    }

    tb_report_pose(0.0, 0.0, theta);`,
      ),
      checks: [
        { kind: "var", name: "gyro_offset", min: 0.048, max: 0.052, label: "The calibration finds the bias: about 0.05 rad/s", hint: "Add every reading of the first 1000 calls to gyro_sum, then divide by 1000.0 on call 1000." },
        { kind: "source", mustMatch: "gyro_sum\\s*(\\+=|=\\s*gyro_sum\\s*\\+|=\\s*gyro\\s*\\+\\s*gyro_sum)", label: "The bias is measured, not typed in: the readings are added to gyro_sum" },
        { kind: "signal", name: "TB_EST_ERR_RAD", at: 3500, max: 0.02, label: "Heading within 0.02 rad of the truth after the spin", hint: "About 0.12 off: the bias is not removed. About 0.25 off: it is added, not subtracted. Write `gyro = gyro - gyro_offset;` before the integration." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.02, label: "Still within 0.02 rad after standing for 4.5 s: no drift", hint: "The heading creeps by 0.05 rad every second: subtract gyro_offset from gyro before the integration." },
      ],
      watch: ["gyro", "gyro_offset", "theta"],
      hints: [
        "Two places need code: inside the calibration branch, and right after the comment 'Remove the bias'.",
        "Calibration: `gyro_sum = gyro_sum + gyro;` and, when numTimer0calls == 1000, `gyro_offset = gyro_sum / 1000.0;`",
        "Then `gyro = gyro - gyro_offset;` before the trapezoid line.",
      ],
      takeaway: "Keep the robot still at start-up and you get the gyro's bias for free. The course code waits 2 s, then averages 2000 samples this way before the robot may move. What the calibration cannot remove is a bias that changes later, as the sensor warms up.",
    },
    {
      id: "loc-rotate",
      kind: "code",
      mode: "complete",
      tier: "practice",
      title: "Practice: rotate() and body_to_world()",
      goal: "Complete a rotation function and use it to transform a point from the robot frame to the world frame.",
      refs: [{ course: "L15", slide: [18, 19] }, { course: "HW4" }],
      brief: `
Put the two formulas into two functions. A C function returns one value, and a point has two, so the results come back through **pointers**: the caller passes the addresses of two floats and the function writes to them with \`*xw = ...\`.

## rotate
\`rotate(x, y, phi, &xw, &yw)\` rotates the point (x, y) by the angle \`phi\` (radians). The x line is written. Add the y line:

y_w = x sin(phi) + y cos(phi)

## body_to_world
\`body_to_world(xb, yb, rx, ry, rphi, &xw, &yw)\` takes a point in the robot (body) frame and the robot's pose (rx, ry, rphi) and gives the point in the world frame: rotate by \`rphi\`, then add (rx, ry). Call \`rotate\` inside it.

\`main\` already calls both: the worked example of "Maths you need: turning a point" for \`rotate\`, an easy case for \`body_to_world\`, and the ball of the "Rotate, shift, and back" level, which must land at (7.2623, 1.7793). \`sin\` and \`cos\` take **radians**: the calls convert with \`* PI / 180.0\`.
`,
      kit: "robot",
      durationMs: 2,
      starter: `#define PI 3.14159265

float px = 0;         // results
float py = 0;
float qx = 0;
float qy = 0;
float ballx = 0;
float bally = 0;

// Rotates the point (x, y) by phi radians, counter-clockwise.
void rotate(float x, float y, float phi, float *xw, float *yw)
{
    *xw = x * cos(phi) - y * sin(phi);
    // the y line

}

// Point (xb, yb) in the robot frame -> world frame, for a robot at (rx, ry) heading rphi.
void body_to_world(float xb, float yb, float rx, float ry, float rphi, float *xw, float *yw)
{
    // rotate by the heading, then add the robot's position

}

void main(void)
{
    rotate(2.0, 1.0, 30.0 * PI / 180.0, &px, &py);
    body_to_world(1.0, 0.5, 2.0, 3.0, 180.0 * PI / 180.0, &qx, &qy);
    // A ball 3 ft ahead and 1.5 ft to the right of a robot at (4, 1) heading 40 degrees
    body_to_world(3.0, -1.5, 4.0, 1.0, 40.0 * PI / 180.0, &ballx, &bally);

    while (1) {}
}
`,
      solution: `#define PI 3.14159265

float px = 0;         // results
float py = 0;
float qx = 0;
float qy = 0;
float ballx = 0;
float bally = 0;

// Rotates the point (x, y) by phi radians, counter-clockwise.
void rotate(float x, float y, float phi, float *xw, float *yw)
{
    *xw = x * cos(phi) - y * sin(phi);
    // the y line
    *yw = x * sin(phi) + y * cos(phi);
}

// Point (xb, yb) in the robot frame -> world frame, for a robot at (rx, ry) heading rphi.
void body_to_world(float xb, float yb, float rx, float ry, float rphi, float *xw, float *yw)
{
    // rotate by the heading, then add the robot's position
    rotate(xb, yb, rphi, xw, yw);
    *xw = *xw + rx;
    *yw = *yw + ry;
}

void main(void)
{
    rotate(2.0, 1.0, 30.0 * PI / 180.0, &px, &py);
    body_to_world(1.0, 0.5, 2.0, 3.0, 180.0 * PI / 180.0, &qx, &qy);
    // A ball 3 ft ahead and 1.5 ft to the right of a robot at (4, 1) heading 40 degrees
    body_to_world(3.0, -1.5, 4.0, 1.0, 40.0 * PI / 180.0, &ballx, &bally);

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "px", min: 1.231, max: 1.233, label: "rotate: (2, 1) turned by 30 degrees has x = 1.232" },
        { kind: "var", name: "py", min: 1.865, max: 1.867, label: "rotate: (2, 1) turned by 30 degrees has y = 1.866", hint: "y_w = x sin(phi) + y cos(phi). Write it through the pointer: *yw = ... 0.134: the second term is added, not subtracted." },
        { kind: "var", name: "qx", min: 0.999, max: 1.001, label: "body_to_world: (1, 0.5) seen by a robot at (2, 3) facing backwards is at x = 1", hint: "Rotate first, then add rx to *xw." },
        { kind: "var", name: "qy", min: 2.499, max: 2.501, label: "... and y = 2.5" },
        { kind: "var", name: "ballx", min: 7.2613, max: 7.2633, label: "The ball is at world x = 7.2623" },
        { kind: "var", name: "bally", min: 1.7783, max: 1.7803, label: "... and world y = 1.7793", hint: "A ball on the robot's right has a negative y in the robot frame. The formulas take care of the sign." },
      ],
      watch: ["px", "py", "qx", "qy", "ballx", "bally"],
      hints: [
        "In rotate, the y line is the x line with sin and cos swapped and a plus sign. It is in the brief.",
        "Inside body_to_world, xw and yw are already pointers: pass them on as they are, `rotate(xb, yb, rphi, xw, yw);`",
        "Then `*xw = *xw + rx;` and `*yw = *yw + ry;`",
      ],
      takeaway: "Two small functions carry every sensor reading from the robot into the room. The LIDAR code of the final project is this, applied to each of the 228 readings.",
    },
    {
      id: "loc-inverse",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: world_to_body()",
      goal: "Write the inverse transform: where is a point of the room, seen from the robot?",
      refs: [{ course: "L19", slide: 9, note: "world to robot frame: subtract, then rotate back" }, { course: "L15", slide: 19 }, { course: "HW4" }],
      brief: `
The robot knows a point in world coordinates and wants to know: is it ahead of me or behind, on my left or on my right? That is the inverse transform.

Write \`world_to_body(xw, yw, rx, ry, rphi, &xb, &yb)\` for a robot at (rx, ry) with heading \`rphi\` (radians):

1. Subtract the robot's position: dx = xw - rx, dy = yw - ry.
2. Rotate back by the heading:
   - xb = dx cos(rphi) + dy sin(rphi)
   - yb = -dx sin(rphi) + dy cos(rphi)

\`main\` calls the function for two balls. After each call, set \`ball1_on_left\` or \`ball2_on_left\` to 1 if that ball is on the robot's left and to 0 if it is on its right. In the robot frame positive y is to the left.
`,
      kit: "robot",
      durationMs: 2,
      starter: `#define PI 3.14159265

float ax = 0;         // results
float ay = 0;
float ballx = 0;
float bally = 0;
int ball1_on_left = -1;
int ball2_on_left = -1;

// Point (xw, yw) in the world frame -> robot frame, for a robot at (rx, ry) heading rphi.
void world_to_body(float xw, float yw, float rx, float ry, float rphi, float *xb, float *yb)
{

}

void main(void)
{
    // A robot at (1, 2) looking along world y, and a ball at (3, 5)
    world_to_body(3.0, 5.0, 1.0, 2.0, 90.0 * PI / 180.0, &ax, &ay);
    // ball1_on_left = 1 if that ball is on the robot's left, 0 if it is on its right

    // A robot at (4, 1) heading 150 degrees, and a ball at (1.5, 2)
    world_to_body(1.5, 2.0, 4.0, 1.0, 150.0 * PI / 180.0, &ballx, &bally);
    // ball2_on_left: the same question for this ball

    while (1) {}
}
`,
      solution: `#define PI 3.14159265

float ax = 0;         // results
float ay = 0;
float ballx = 0;
float bally = 0;
int ball1_on_left = -1;
int ball2_on_left = -1;

// Point (xw, yw) in the world frame -> robot frame, for a robot at (rx, ry) heading rphi.
void world_to_body(float xw, float yw, float rx, float ry, float rphi, float *xb, float *yb)
{
    float dx = xw - rx;
    float dy = yw - ry;
    *xb = dx * cos(rphi) + dy * sin(rphi);
    *yb = -dx * sin(rphi) + dy * cos(rphi);
}

void main(void)
{
    // A robot at (1, 2) looking along world y, and a ball at (3, 5)
    world_to_body(3.0, 5.0, 1.0, 2.0, 90.0 * PI / 180.0, &ax, &ay);
    // ball1_on_left = 1 if that ball is on the robot's left, 0 if it is on its right
    if (ay > 0.0) {
        ball1_on_left = 1;
    } else {
        ball1_on_left = 0;
    }

    // A robot at (4, 1) heading 150 degrees, and a ball at (1.5, 2)
    world_to_body(1.5, 2.0, 4.0, 1.0, 150.0 * PI / 180.0, &ballx, &bally);
    // ball2_on_left: the same question for this ball
    if (bally > 0.0) {
        ball2_on_left = 1;
    } else {
        ball2_on_left = 0;
    }

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "ax", min: 2.999, max: 3.001, label: "Easy case: the ball is 3 ft ahead (x = 3)", hint: "Subtract the robot's position before you rotate." },
        { kind: "var", name: "ay", min: -2.001, max: -1.999, label: "Easy case: y = -2", hint: "+2 means the rotation goes the wrong way: yb = -dx sin + dy cos." },
        { kind: "var", name: "ball1_on_left", equals: 0, label: "The first ball is on the robot's right", hint: "Positive y in the robot frame is the left side." },
        { kind: "var", name: "ballx", min: 2.6641, max: 2.6661, label: "Second ball: x = 2.6651 in the robot frame" },
        { kind: "var", name: "bally", min: 0.383, max: 0.385, label: "Second ball: y = 0.3840" },
        { kind: "var", name: "ball2_on_left", equals: 1, label: "The second ball is on the robot's left" },
      ],
      watch: ["ax", "ay", "ball1_on_left", "ballx", "bally", "ball2_on_left"],
      hints: [
        "Two local floats for dx and dy make the two formulas easy to read.",
        "`*xb = dx * cos(rphi) + dy * sin(rphi);`",
        "`*yb = -dx * sin(rphi) + dy * cos(rphi);` and in main `if (ay > 0.0) ball1_on_left = 1; else ball1_on_left = 0;`, then the same with bally for the second ball.",
      ],
      takeaway: "Subtract, then rotate back. The sign of the robot-frame y tells left from right, and atan2(yb, xb) is the angle the robot would have to turn to face the point.",
    },
    {
      id: "loc-matrix",
      kind: "calc",
      tier: "practice",
      title: "Practice: one matrix for rotate and shift",
      goal: "Multiply a matrix by a list of numbers, and read HW4's homogeneous transformation as rotate, then shift.",
      refs: [{ course: "L15", slide: [18, 19] }, { course: "HW4" }],
      brief: `
HW4 and Lecture 15 write transforms as matrices. A **matrix** is a table of numbers. A **vector** is a list of numbers written as a column, such as a point (x, y).

## Matrix times vector
Each row of the matrix makes one number of the result: multiply the row's entries by the vector's entries, one by one, and add.

\`\`\`c
[ 2  1 ] [ 3 ]   [ 2 x 3 + 1 x 4 ]   [ 10 ]
[ 0  5 ] [ 4 ] = [ 0 x 3 + 5 x 4 ] = [ 20 ]
\`\`\`

The rotation matrix of the level "Maths you need: turning a point" is used exactly like this. In the figure, switch to "a matrix".

{{figure:math-rotate}}

## Rotate and shift in one matrix
A 2 x 2 matrix can rotate but it cannot shift: there is nowhere to put Tx and Ty. The trick is to give every point a third entry that is always 1, and to use a 3 x 3 matrix, the **homogeneous transformation**:

\`\`\`c
    [ cos  -sin  Tx ]            [ x ]
T = [ sin   cos  Ty ]    point = [ y ]
    [  0     0    1 ]            [ 1 ]
\`\`\`

- Row 1: x cos - y sin + Tx x 1. That is "rotate, then shift" for x.
- Row 2: x sin + y cos + Ty x 1. The same for y.
- Row 3: 0 + 0 + 1 = 1. It only keeps the third entry at 1.

So T times a robot-frame point is the world-frame point: nothing but the two lines you already use. The gain is that two transforms in a row (camera to robot, robot to world) become one matrix times another.

## Example
Robot at (4, 1), heading 90 degrees (cos = 0, sin = 1). T = [0 -1 4; 1 0 1; 0 0 1]. The ball at (2, 0) in the robot frame: row 1 gives 0 x 2 - 1 x 0 + 4 = 4, row 2 gives 1 x 2 + 0 x 0 + 1 = 3. World: (4, 3).
`,
      fields: [
        { id: "m1", label: "[1 2; 3 4] times (5, 6): first number of the result", answer: 17, why: "Row 1: 1 x 5 + 2 x 6 = 17." },
        { id: "m2", label: "[1 2; 3 4] times (5, 6): second number", answer: 39, why: "Row 2: 3 x 5 + 4 x 6 = 39." },
        { id: "t1", label: "T = [0 -1 4; 1 0 1; 0 0 1] times the point (1, 2, 1): world x", answer: 2, why: "Row 1: 0 x 1 + (-1) x 2 + 4 x 1 = 2." },
        { id: "t2", label: "The same: world y", answer: 2, why: "Row 2: 1 x 1 + 0 x 2 + 1 x 1 = 2. The point 1 ft ahead and 2 ft to the left of a robot at (4, 1) that faces along world y is at (2, 2)." },
        { id: "t3", label: "Robot at (2, 3) with heading 180 degrees. Entry in row 1, column 1 of its T", answer: -1, why: "That entry is cos(theta) = cos 180 = -1." },
        { id: "t4", label: "The same T: entry in row 2, column 3", answer: 3, why: "The third column holds the robot's position: Tx = 2 in row 1 and Ty = 3 in row 2." },
      ],
      hints: [
        "One row at a time: multiply entry by entry, then add.",
        "For T, do not forget the third entry of the point, which is always 1: it brings in Tx and Ty.",
        "T = [cos -sin Tx; sin cos Ty; 0 0 1]. cos 180 = -1, sin 180 = 0.",
      ],
      takeaway: "A matrix times a vector is one sum of products per row. The homogeneous transformation is the rotation matrix with the robot's position in a third column: rotate, then shift, in one multiplication.",
    },
    {
      id: "loc-units",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Practice: degrees, radians and a heading that keeps growing",
      goal: "Fix a dead-reckoning function that mixes degrees with radians and never wraps its heading.",
      refs: [{ course: "L15", slide: [32, 26], note: "gyro heading, then cos and sin of it in radians" }, { course: "Lab 5" }],
      brief: `
This robot takes its heading from the gyro, the sensor that measures the turn rate. Like the course's gyro code, it works in **degrees**: the rate is converted to degrees per second and integrated into \`angle_deg\`. The robot drives a little more than three quarters of a circle to the left.

The position estimate is far off. Two things are wrong.

## Degrees into cos()
\`cos\` and \`sin\` take **radians**. \`cos(90)\` is not zero: it is the cosine of 90 radians. Convert before use: radians = degrees x PI / 180. \`theta\` must hold the heading in radians.

## A heading that is never wrapped
A heading of 190 degrees and one of -170 degrees are the same direction. Code that compares headings or subtracts them ("how far do I still have to turn?") breaks when one of them is 190 and the other -170: the difference looks like 360 degrees instead of 0. The convention in this course is to keep a heading in **-180 to 180 degrees** (-PI to PI). After each update:

\`\`\`c
if (angle_deg > 180.0) angle_deg = angle_deg - 360.0;
if (angle_deg < -180.0) angle_deg = angle_deg + 360.0;
\`\`\`

The robot turns through about 285 degrees. Wrapped, that is about -75 degrees, or -1.30 rad.
${BENCH}
- \`tb_gyro_z()\`: the turn rate in rad/s, counter-clockwise positive.
`,
      kit: "robot",
      durationMs: 3500,
      starter: prog(
        `${POSE_GLOBALS}
float gyro_dps = 0;   // turn rate, degrees per second
float angle_deg = 0;  // heading, degrees`,
        `
    // Drive: on a left arc for 3 s, then stop
    numTimer0calls++;
    if (numTimer0calls <= 3000) {
        tb_set_effort(2.8, 6.8);
    } else {
        tb_set_effort(0.0, 0.0);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Heading from the gyro, in degrees
    gyro_dps = tb_gyro_z() * 180.0 / PI;
    angle_deg = angle_deg + gyro_dps * 0.001;

    // Position from the wheel speeds and the heading
    theta = angle_deg;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

    tb_report_pose(x, y, theta);`,
      ),
      solution: prog(
        `${POSE_GLOBALS}
float gyro_dps = 0;   // turn rate, degrees per second
float angle_deg = 0;  // heading, degrees`,
        `
    // Drive: on a left arc for 3 s, then stop
    numTimer0calls++;
    if (numTimer0calls <= 3000) {
        tb_set_effort(2.8, 6.8);
    } else {
        tb_set_effort(0.0, 0.0);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Heading from the gyro, in degrees
    gyro_dps = tb_gyro_z() * 180.0 / PI;
    angle_deg = angle_deg + gyro_dps * 0.001;
    if (angle_deg > 180.0) angle_deg = angle_deg - 360.0;
    if (angle_deg < -180.0) angle_deg = angle_deg + 360.0;

    // Position from the wheel speeds and the heading
    theta = angle_deg * PI / 180.0;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

    tb_report_pose(x, y, theta);`,
      ),
      checks: [
        { kind: "var", name: "theta", at: 1000, min: 1.55, max: 1.65, label: "After 1 s the heading is about 1.56 rad (90 degrees)", hint: "theta holds about 90 here: that is degrees. Multiply by PI / 180." },
        { kind: "var", name: "theta", min: -1.33, max: -1.25, label: "At the end the heading is wrapped: about -1.30 rad, not 4.98", hint: "Wrap angle_deg into -180 ... 180 right after it is updated." },
        { kind: "var", name: "angle_deg", min: -180, max: 180, label: "angle_deg stays between -180 and 180" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.02, label: "Position estimate within 0.02 ft of the truth", hint: "cos and sin need radians." },
      ],
      watch: ["angle_deg", "theta", "x", "y"],
      hints: [
        "Look at the value of theta in the watch list after a second. Is that a plausible number of radians?",
        "`theta = angle_deg * PI / 180.0;`",
        "Add the two wrap lines from the brief right after `angle_deg = angle_deg + gyro_dps * 0.001;`",
      ],
      takeaway: "Pick one unit for angles inside your code and convert at the edges. And keep headings wrapped, because sooner or later you will subtract two of them.",
    },
    {
      id: "loc-trap",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Practice: rectangle or trapezoid",
      goal: "Make dead reckoning accurate at a slow sample rate by replacing the rectangle rule with the trapezoid rule.",
      refs: [{ course: "L15", slide: [27, 26] }, { course: "Lab 5" }],
      brief: `
To save processor time, someone slowed the dead-reckoning interrupt from 1 ms to **20 ms**. The code is the dead reckoning you wrote, with the new time step \`DT = 0.02\`. The position estimate is now off by 0.015 ft after one short drive, twenty times more than before, and it gets worse with every turn.

## Why
The **rectangle rule** assumes the speed measured now was the speed during the whole last step. While the robot speeds up or turns, that is wrong by half a step, every step.

The **trapezoid rule** uses the average of the value now and the value one step ago:

\`\`\`c
theta_new = theta + 0.5 * (omega + omega_old) * DT;
x = x + 0.5 * (v * cos(theta_new) + v_old * cos(theta)) * DT;
y = y + 0.5 * (v * sin(theta_new) + v_old * sin(theta)) * DT;
theta = theta_new;
omega_old = omega;
v_old = v;
\`\`\`

For x and y, the thing being integrated is the speed along each axis, so average the **products**: this step's \`v * cos(theta_new)\` and the previous step's \`v_old * cos(theta)\`.

Try it in the figure: open **More controls**, pick a 100 ms time step on a tight turn and switch between the two rules.

{{figure:dead-reckoning}}

The course's gyro code integrates the same way: \`(gyroz + old_gyro) * .0005\` is the average of two readings times 1 ms.

Change the integration to the trapezoid rule. The globals \`omega_old\` and \`v_old\` are ready.
${BENCH}`,
      kit: "robot",
      durationMs: 3500,
      starter: prog(
        `#define DT 0.02       // time step, s
float vLeft = 0;
float vRight = 0;
float v = 0;          // forward speed, ft/s
float omega = 0;      // turn rate, rad/s
float v_old = 0;      // values of the previous step
float omega_old = 0;
float theta_new = 0;
float x = 0;
float y = 0;
float theta = 0;
uint32_t numTimer0calls = 0;`,
        `
    // Drive: 1 s straight, then a tight left arc, then stop
    numTimer0calls++;
    if (numTimer0calls <= 50) {
        tb_set_effort(4.8, 4.8);
    } else if (numTimer0calls <= 150) {
        tb_set_effort(2.0, 7.6);
    } else {
        tb_set_effort(0.0, 0.0);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    v = 0.5 * (vLeft + vRight);
    omega = (vRight - vLeft) / WHEEL_BASE;

    // Rectangle rule
    theta = theta + omega * DT;
    x = x + v * cos(theta) * DT;
    y = y + v * sin(theta) * DT;

    tb_report_pose(x, y, theta);`,
        { periodUs: 20000 },
      ),
      solution: prog(
        `#define DT 0.02       // time step, s
float vLeft = 0;
float vRight = 0;
float v = 0;          // forward speed, ft/s
float omega = 0;      // turn rate, rad/s
float v_old = 0;      // values of the previous step
float omega_old = 0;
float theta_new = 0;
float x = 0;
float y = 0;
float theta = 0;
uint32_t numTimer0calls = 0;`,
        `
    // Drive: 1 s straight, then a tight left arc, then stop
    numTimer0calls++;
    if (numTimer0calls <= 50) {
        tb_set_effort(4.8, 4.8);
    } else if (numTimer0calls <= 150) {
        tb_set_effort(2.0, 7.6);
    } else {
        tb_set_effort(0.0, 0.0);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    v = 0.5 * (vLeft + vRight);
    omega = (vRight - vLeft) / WHEEL_BASE;

    // Trapezoid rule
    theta_new = theta + 0.5 * (omega + omega_old) * DT;
    x = x + 0.5 * (v * cos(theta_new) + v_old * cos(theta)) * DT;
    y = y + 0.5 * (v * sin(theta_new) + v_old * sin(theta)) * DT;
    theta = theta_new;
    omega_old = omega;
    v_old = v;

    tb_report_pose(x, y, theta);`,
        { periodUs: 20000 },
      ),
      checks: [
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.01, label: "Heading estimate within 0.01 rad of the truth" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.005, label: "Position estimate within 0.005 ft of the truth", hint: "Average this step's and the previous step's values, for the turn rate and for the speed along each axis." },
        { kind: "isr", fn: "cpu_timer0_isr", max: 180, label: "The interrupt still runs only every 20 ms" },
      ],
      watch: ["v", "omega", "x", "y", "theta"],
      hints: [
        "Start with the heading: `theta_new = theta + 0.5 * (omega + omega_old) * DT;`",
        "For x use both ends of the step: v * cos(theta_new) now and v_old * cos(theta) one step ago.",
        "Finish the step by saving the old values: `theta = theta_new; omega_old = omega; v_old = v;`",
      ],
      takeaway: "The trapezoid rule costs two more variables and makes the error shrink with the square of the time step, not with the time step. At 1 ms both rules are fine; at 20 ms only one is.",
    },
    {
      id: "loc-comp",
      kind: "code",
      mode: "complete",
      tier: "practice",
      title: "Practice: complementary filter",
      goal: "Blend the gyro heading with the encoder heading so the result does not drift when the gyro's bias changes.",
      refs: [{ course: "L15", slide: [38, 37] }],
      brief: `
The start-up calibration of the practice level "Gyro bias" removes the bias the gyro has at start-up. In this run the bias **changes after 3 seconds** (sensors warm up). The gyro heading \`theta_gyro\` starts to drift again, and no start-up calibration can help.

There is a second heading: \`theta_enc\`, integrated from the wheel speeds. It has no bias. Its weakness is different: its single readings are rough, and on a real floor every wheel slip turns it a little for good.

## Blend them
A **complementary filter** takes the fast changes from one sensor and the slow trend from the other:

\`\`\`c
theta = ALPHA * (theta + gyro * 0.001) + (1.0 - ALPHA) * theta_enc;
\`\`\`

- \`theta + gyro * 0.001\` is one gyro integration step, starting from the blended heading.
- \`ALPHA\` close to 1 trusts the gyro from step to step. The small rest, \`1 - ALPHA\`, pulls the result a little towards the encoder heading on every pass, and that is enough to stop the drift.

With \`ALPHA = 0.998\` and a 1 ms step, the gyro dominates over times shorter than about half a second and the encoders over longer times. A gyro bias of 0.08 rad/s then causes a constant error of about 0.08 x 0.5 = 0.04 rad instead of a drift without end.

## What to do
\`theta_gyro\` and \`theta_enc\` are computed for you. Add the line that computes the blended \`theta\`.

One honest note: on this bench the wheels never slip, so \`theta_enc\` alone would do well here. On the floor it does not, and the gyro is what catches a slipping wheel.
${BENCH}
- \`tb_gyro_z()\`: turn rate in rad/s, with bias and noise.
`,
      kit: "robot",
      durationMs: 8000,
      stimuli: [
        { at: 0, set: "TB_GYRO_NOISE", value: 0.01 },
        { at: 0, set: "TB_ENC_NOISE", value: 0.05 },
        { at: 3000, set: "TB_GYRO_BIAS", value: 0.08 },
      ],
      starter: prog(
        `#define ALPHA 0.998
float vLeft = 0;
float vRight = 0;
float gyro = 0;        // rad/s
float theta_gyro = 0;  // heading from the gyro alone, rad
float theta_enc = 0;   // heading from the wheel speeds alone, rad
float theta = 0;       // blended heading, rad
uint32_t numTimer0calls = 0;`,
        `
    // Drive: left arc, right arc, then slowly straight
    numTimer0calls++;
    if (numTimer0calls <= 2000) {
        tb_set_effort(3.6, 4.8);
    } else if (numTimer0calls <= 4000) {
        tb_set_effort(4.8, 3.6);
    } else {
        tb_set_effort(2.8, 2.8);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    gyro = tb_gyro_z();

    theta_gyro = theta_gyro + gyro * 0.001;
    theta_enc = theta_enc + (vRight - vLeft) / WHEEL_BASE * 0.001;

    // Complementary filter
    theta = theta_gyro;

    tb_report_pose(0.0, 0.0, theta);`,
      ),
      solution: prog(
        `#define ALPHA 0.998
float vLeft = 0;
float vRight = 0;
float gyro = 0;        // rad/s
float theta_gyro = 0;  // heading from the gyro alone, rad
float theta_enc = 0;   // heading from the wheel speeds alone, rad
float theta = 0;       // blended heading, rad
uint32_t numTimer0calls = 0;`,
        `
    // Drive: left arc, right arc, then slowly straight
    numTimer0calls++;
    if (numTimer0calls <= 2000) {
        tb_set_effort(3.6, 4.8);
    } else if (numTimer0calls <= 4000) {
        tb_set_effort(4.8, 3.6);
    } else {
        tb_set_effort(2.8, 2.8);
    }

    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    gyro = tb_gyro_z();

    theta_gyro = theta_gyro + gyro * 0.001;
    theta_enc = theta_enc + (vRight - vLeft) / WHEEL_BASE * 0.001;

    // Complementary filter
    theta = ALPHA * (theta + gyro * 0.001) + (1.0 - ALPHA) * theta_enc;

    tb_report_pose(0.0, 0.0, theta);`,
      ),
      checks: [
        { kind: "signal", name: "TB_EST_ERR_RAD", at: 2900, max: 0.02, label: "Before the bias changes, the heading is within 0.02 rad" },
        { kind: "signal", name: "TB_EST_ERR_RAD", at: 5000, max: 0.06, label: "2 s after the bias changed, the error is bounded (below 0.06 rad)", hint: "The gyro alone is 0.16 rad off here and still drifting." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.06, label: "5 s after the bias changed, the error is no larger", hint: "The gyro alone is 0.4 rad off by now." },
        { kind: "source", mustMatch: "theta\\s*=[^;]*gyro", label: "The blended heading still uses the gyro" },
      ],
      watch: ["theta_gyro", "theta_enc", "theta"],
      hints: [
        "Replace the line `theta = theta_gyro;` by the formula from the brief.",
        "The gyro step starts from the blended heading itself: `theta + gyro * 0.001`, not from theta_gyro.",
        "`theta = ALPHA * (theta + gyro * 0.001) + (1.0 - ALPHA) * theta_enc;`",
      ],
      takeaway: "Two imperfect sensors with different weaknesses beat either one. A complementary filter uses a fixed blend. The Kalman filter works out the best blend by itself.",
    },
    {
      id: "loc-landmark",
      kind: "calc",
      tier: "practice",
      title: "Practice: a landmark resets the drift",
      goal: "Correct a dead-reckoned position from one sighting of a landmark whose place in the room is known.",
      refs: [{ course: "L15", slide: [40, 19] }],
      brief: `
Dead reckoning drifts. A **landmark** is something the robot can recognise and whose world position is known in advance: a corner of the course, a tag on the wall, the wall itself. One sighting tells the robot where it really is.

## From a sighting to a position
The LIDAR or the camera gives the landmark's position in the **robot frame**. You know the transform:

landmark_world = (landmark_robot rotated by theta) + robot_position

This time the left side is known and the robot's position is not. Solve for it:

**robot_position = landmark_world - (landmark_robot rotated by theta)**

So: rotate the sighting by the heading, then subtract it from the landmark's known position. The heading is taken from the gyro here. One point landmark cannot correct the heading; that needs a second landmark or the direction of a wall.

## Case 1: a corner
A corner of the course is at **(6.0, 4.0) ft** in the world. The robot's heading is **30 degrees**. It sees the corner at **(2.0, 1.5) ft** in its own frame. Dead reckoning says the robot is at (4.8, 1.9).

## Case 2: a wall
A wall lies along the world line y = 10 ft. The robot faces it squarely (heading 90 degrees). The LIDAR, mounted 0.3 ft ahead of the robot's centre, reads 3.4 ft straight ahead.
`,
      fields: [
        { id: "rx", label: "Case 1: the sighting rotated into world directions, x part", unit: "ft", answer: 0.982, tolPct: 1, why: "2.0 cos 30 - 1.5 sin 30 = 1.732 - 0.75 = 0.982 ft." },
        { id: "ry", label: "Case 1: the sighting rotated, y part", unit: "ft", answer: 2.299, tolPct: 1, why: "2.0 sin 30 + 1.5 cos 30 = 1.0 + 1.299 = 2.299 ft." },
        { id: "px", label: "Case 1: the robot's true x", unit: "ft", answer: 5.018, tolPct: 0.5, why: "6.0 - 0.982 = 5.018 ft." },
        { id: "py", label: "Case 1: the robot's true y", unit: "ft", answer: 1.701, tolPct: 0.5, why: "4.0 - 2.299 = 1.701 ft." },
        { id: "err", label: "Case 1: how far off dead reckoning was", unit: "ft", answer: 0.295, tolPct: 3, why: "The difference is (5.018 - 4.8, 1.701 - 1.9) = (0.218, -0.199). Its length is sqrt(0.218 x 0.218 + 0.199 x 0.199) = 0.295 ft." },
        { id: "wy", label: "Case 2: the robot's y", unit: "ft", answer: 6.3, tolPct: 0.5, why: "The sensor is 3.4 ft from the wall and the centre is 0.3 ft behind the sensor: y = 10 - 3.4 - 0.3 = 6.3 ft. A wall corrects only the coordinate across it; x stays unknown." },
      ],
      hints: [
        "Rotate the sighting (2.0, 1.5) by 30 degrees, exactly as for a robot-to-world transform, but do not add the robot's position: that is the unknown.",
        "cos 30 = 0.866, sin 30 = 0.5. Robot position = landmark position minus the rotated sighting.",
        "Case 2: the robot's centre is the LIDAR reading plus the mounting offset away from the wall.",
      ],
      takeaway: "A known landmark turns the transform around: instead of finding the point from the pose, you find the pose from the point. The course robot does this with the walls of the course and its LIDAR. A Kalman filter would not swallow the fix whole: it treats it as one more measurement with its own variance.",
    },
    {
      id: "loc-pursuit",
      kind: "calc",
      tier: "practice",
      title: "Practice: pure pursuit",
      goal: "Compute the steering command that carries the robot on an arc to a point further along a planned path.",
      refs: [{ course: "L19", slide: [15, 14, 9] }],
      brief: `
A path planner (chapter 19) hands the robot a path as a list of points. Driving to each one and stopping to turn, as move-to-XY does, is slow and jerky. Lecture 19 names a smoother way: **pure pursuit**. The robot chases a point on the path a fixed distance ahead of it, the **look-ahead point**. As the robot moves, that point moves along the path, so the robot never reaches it and never stops.

## The steering rule
1. Transform the look-ahead point into the **robot frame**: (xb, yb). This is the world-to-robot transform of this chapter.
2. Find the circle that leaves the robot straight ahead and passes through the point. With L the distance to the point (L x L = xb x xb + yb x yb), its **curvature** (1 / radius) is

   **kappa = 2 yb / (L x L)**

   Only the sideways offset yb steers: a point straight ahead (yb = 0) gives a straight line, a point to the left (yb positive) a left arc.
3. Drive that arc: **omega = V kappa**. For the course's speed controller, \`turn\` is the wanted vLeft - vRight, so turn = -omega x b with b the wheel base.

## Your turn
The robot is at **(1, 1) ft, heading 90 degrees**, driving at V = 1 ft/s. Its wheel base is 0.6 ft. The look-ahead point is at **(0.4, 1.8) ft** in the world.
`,
      fields: [
        { id: "xb", label: "Look-ahead point in the robot frame: xb", unit: "ft", answer: 0.8, tolPct: 1, why: "dx = -0.6, dy = 0.8. xb = dx cos 90 + dy sin 90 = 0.8 ft ahead." },
        { id: "yb", label: "Look-ahead point in the robot frame: yb", unit: "ft", answer: 0.6, tolPct: 1, why: "yb = -dx sin 90 + dy cos 90 = 0.6 ft: on the robot's left." },
        { id: "kappa", label: "Curvature kappa", unit: "1/ft", answer: 1.2, tolPct: 1, why: "L x L = 0.64 + 0.36 = 1.0, so kappa = 2 x 0.6 / 1.0 = 1.2 per ft: a circle of radius 0.83 ft." },
        { id: "omega", label: "Turn rate omega", unit: "rad/s", answer: 1.2, tolPct: 1, why: "omega = V kappa = 1.0 x 1.2 = 1.2 rad/s, positive: counter-clockwise." },
        { id: "turn", label: "turn = vLeft - vRight", unit: "ft/s", answer: -0.72, tolPct: 1, why: "turn = -omega x b = -1.2 x 0.6 = -0.72 ft/s. Negative: the right wheel runs faster (1.36 against 0.64 ft/s) and the robot turns left." },
      ],
      hints: [
        "Subtract the robot's position from the look-ahead point, then rotate back by the heading. At 90 degrees, cos is 0 and sin is 1.",
        "kappa = 2 yb / (xb x xb + yb x yb).",
        "omega = V x kappa, and turn = -omega x 0.6.",
      ],
      takeaway: "Pure pursuit is one transform and one division per step. The look-ahead distance is its tuning knob: too short and the robot weaves about the path, too long and it cuts the corners.",
    },
    {
      id: "loc-budget",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Practice: keep the interrupt short",
      goal: "Move the trigonometry of dead reckoning out of the interrupt function into the main loop, behind a flag.",
      refs: [{ course: "L14", slide: 31, note: "only time-critical work in the 1 ms interrupt" }, { course: "L15", slide: 26 }, { course: "Lab 5" }],
      brief: `
The dead reckoning of the level "Dead reckoning" works. It also calls \`cos\` and \`sin\` inside the interrupt function, a thousand times a second. Drop that habit before the program grows.

## Why
While an interrupt function runs, every other interrupt waits. An addition takes a few nanoseconds. \`sin\`, \`cos\` and \`atan2\` take about a microsecond each, and \`sqrt\` a quarter of that: as much as hundreds of additions. Three microseconds do no harm yet. But the final project adds \`atan2\`, a Kalman filter and 228 LADAR points, while serial characters arrive every 87 us and must not be lost.

The rule: **the interrupt does only what must happen on time.** Reading the wheels and summing must: a missed millisecond is lost distance. The trigonometry need not: x and y are just as good when they are updated 100 times a second.

## The hand-off
1. The interrupt keeps the two cheap sums: \`theta\`, and \`dist\`, the total distance driven (\`dist = dist + V * 0.001\`). Every 10th call it sets the flag \`newStep = 1\`.
2. The main loop waits for the flag, clears it and does the costly part:

\`\`\`c
step = dist - distDone;        // driven since the last pass
distDone = distDone + step;
x = x + step * cos(theta);
y = y + step * sin(theta);
\`\`\`

\`dist\` is read once and never reset, so no distance is lost if an interrupt arrives in the middle.

The course's final project has the same shape: a short hardware interrupt reads the sensor, then starts a **software interrupt** (a function of lower priority, which other interrupts may interrupt) where the navigation maths runs.

## What to do
Change \`cpu_timer0_isr\` and the \`while (1)\` loop of \`main\` as described. \`tb_report_pose\` moves to the main loop too, after the update of x and y. \`numTimer0calls\` already counts the calls.

## The test
The pose is as good as before, and the longest run of the interrupt function is below 1.2 us.
${BENCH}`,
      kit: "robot",
      durationMs: 3500,
      starter: prog(
        BUDGET_GLOBALS,
        `
${DRIVE}
    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

    tb_report_pose(x, y, theta);`,
        {
          loop: `
        // When newStep is 1: clear it, update x and y from dist, report the pose
`,
        },
      ),
      solution: prog(
        BUDGET_GLOBALS,
        `
${DRIVE}
    vLeft = tb_left_speed();
    vRight = tb_right_speed();
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    dist = dist + 0.5 * (vLeft + vRight) * 0.001;
    if (numTimer0calls % 10 == 0) {
        newStep = 1;
    }`,
        {
          loop: `
        // When newStep is 1: clear it, update x and y from dist, report the pose
        if (newStep == 1) {
            newStep = 0;
            step = dist - distDone;
            distDone = distDone + step;
            x = x + step * cos(theta);
            y = y + step * sin(theta);
            tb_report_pose(x, y, theta);
        }`,
        },
      ),
      checks: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1.2, label: "The longest run of the interrupt function is below 1.2 us", hint: "Each sin or cos costs about 1 us. Neither may be called in cpu_timer0_isr: only the theta sum, the dist sum and the flag stay there." },
        { kind: "var", name: "x", at: 1500, min: 1.41, max: 1.46, label: "Your x agrees after the straight part (1.44 ft)", hint: "0: the main loop never updates x. Is newStep set in the interrupt, and is dist summed there? Far too large: add step (the distance since the last pass), not dist (the whole distance so far), and add step to distDone." },
        { kind: "var", name: "dist", min: 2.9, max: 3.05, label: "dist holds the whole distance driven, about 2.98 ft: it is never reset", hint: "Sum dist = dist + 0.5 * (vLeft + vRight) * 0.001; on every call of the interrupt, and do not set it back to 0." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.01, label: "Heading estimate within 0.01 rad of the truth at the end", hint: "The theta sum must stay in the interrupt and run every millisecond." },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.02, label: "Position estimate within 0.02 ft of the truth at the end", hint: "No value: call tb_report_pose in the main loop. About 0.1 ft or more: the flag must be set every 10th call, not once a second, and x uses cos, y uses sin." },
        { kind: "max-steps", max: 400000, label: "The main loop works only when the flag is set", hint: "Clear the flag (newStep = 0;) inside the if, or the loop redoes the update on every pass." },
      ],
      watch: ["x", "y", "theta", "dist", "distDone", "newStep"],
      hints: [
        "Two places change. The interrupt loses the x and y lines and the report, and gains a sum for dist and the flag. The main loop gains an if with six lines.",
        "Interrupt: `dist = dist + 0.5 * (vLeft + vRight) * 0.001;` then `if (numTimer0calls % 10 == 0) { newStep = 1; }`. The % sign gives the remainder of a division: it is 0 on every 10th call.",
        "Main loop: `if (newStep == 1) { newStep = 0; step = dist - distDone; distDone = distDone + step; x = x + step * cos(theta); y = y + step * sin(theta); tb_report_pose(x, y, theta); }`",
      ],
      takeaway: "Sums that must not miss a sample stay in the interrupt. Maths that is merely needed soon goes to the main loop behind a flag. The interrupt went from about 2.5 us to under 1 us, and the pose is as good as before.",
    },
    {
      id: "loc-kf3-model",
      kind: "calc",
      tier: "practice",
      title: "Practice: three states, the predict step by hand",
      goal: "Name the matrices of the robot's three-state Kalman filter and do one predict step by hand.",
      refs: [{ course: "L20-21", slide: [37, 46, 75] }, { course: "HW6" }],
      brief: `
The robot's real filter (HW6 and the final project) estimates three numbers at once: x, y and the heading theta. The two steps stay, and the single numbers become matrices (practice level "One matrix for rotate and shift"). This level is about what each entry means.

## Two lists
- **State** xhat = (x, y, theta): what the filter estimates. The hat says "estimate".
- **Input** u = (V, omega): the forward speed and the turn rate, from the wheels.

## B: what the inputs do to the state
One row per state, one column per input, for a step of dt seconds:

\`\`\`c
        V               omega
x    [  cos(theta) dt   0   ]
y    [  sin(theta) dt   0   ]
th   [  0               dt  ]
\`\`\`

Row x says: x grows by V x cos(theta) x dt, and the turn rate does not move x. This is dead reckoning as a table. The predict step is **xhat = F xhat + B u**. The matrix **F** says what the state does on its own. A robot with no input stays where it is, so F is the **identity matrix** (1 on the diagonal, 0 elsewhere): F xhat is just xhat.

## P and Q: the doubt
The **covariance matrix** P takes the place of the variance. On its diagonal: the variance of x, of y and of theta. Off the diagonal: whether two errors go together (0 means they have nothing to do with each other). Q has the same layout: what one step adds. With F the identity, **P = P + Q**.

## Worked example
State (1, 3, 1.5708): the robot points along y. V = 1 ft/s, omega = 0.2 rad/s, dt = 0.5 s. B u = (1 x 0 x 0.5, 1 x 1 x 0.5, 0.2 x 0.5) = (0, 0.5, 0.1). New state: (1, 3.5, 1.6708). P with 0.1, 0.1, 0.02 on its diagonal and Q with 0.01, 0.01, 0.002 give 0.11, 0.11, 0.022.

## Your turn
State (2.0, 1.0, 0.5236): heading 30 degrees. V = 2 ft/s, omega = 0.5 rad/s, dt = 0.1 s. P has 0.2, 0.2, 0.05 on its diagonal and Q has 0.05, 0.05, 0.01. Both are 0 elsewhere.
`,
      fields: [
        { id: "b00", label: "The entry of B in row x, column V", answer: 0.0866, tolPct: 1, why: "cos(30 degrees) x dt = 0.866 x 0.1 = 0.0866: each ft/s of forward speed moves x by 0.0866 ft in this step." },
        { id: "x", label: "x after the predict step", unit: "ft", answer: 2.1732, tolPct: 0.1, why: "2.0 + 0.0866 x 2 = 2.1732 ft. The omega column of this row is 0." },
        { id: "y", label: "y after the predict step", unit: "ft", answer: 1.1, tolPct: 0.1, why: "sin(30 degrees) x 0.1 = 0.05 per ft/s, times V = 2: 1.0 + 0.1 = 1.1 ft." },
        { id: "th", label: "Heading after the predict step", unit: "rad", answer: 0.5736, tolPct: 0.1, why: "Row th of B is (0, dt): 0.5236 + 0.1 x 0.5 = 0.5736 rad. The forward speed does not turn the robot." },
        { id: "p00", label: "Variance of x (top left entry of P) after the step", answer: 0.25, tolPct: 0.5, why: "0.2 + 0.05 = 0.25. Driving made the filter less sure of x." },
        { id: "p22", label: "Variance of the heading (bottom right entry of P) after the step", answer: 0.06, tolPct: 0.5, why: "0.05 + 0.01 = 0.06. The zeros off the diagonal stay 0: 0 + 0." },
      ],
      hints: [
        "cos(30 degrees) = 0.866 and sin(30 degrees) = 0.5. Multiply each by dt = 0.1 to get the first column of B.",
        "Each state grows by its row of B times u: (row entry 1) x V + (row entry 2) x omega.",
        "P after the step is P + Q, entry by entry: 0.2 + 0.05 and 0.05 + 0.01.",
      ],
      takeaway: "B is dead reckoning as a table: one row per state, one column per input. F = identity means the robot stays put without input. P = P + Q: every move adds doubt.",
    },
    {
      id: "loc-kf3-predict",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: three states, the predict function",
      goal: "Write the predict step for the state (x, y, heading) with the input matrix B, and read the given covariance step.",
      refs: [{ course: "L20-21", slide: [46, 75] }, { course: "HW6" }],
      brief: `
Write the predict step of the previous level in C. The state is the array \`xhat[3]\`: x, y, heading. P, Q and B are **two-dimensional arrays**: \`float P[3][3]\` is a table of 3 rows and 3 columns, and \`P[1][2]\` is its entry in row 1, column 2, both counted from 0.

## What to write in kf3_predict(v, omega, dt)
**1.** Fill the six entries of \`B\` and the two of \`u\`:

\`\`\`c
B = [ cos(theta) * dt   0  ]      u = [ v     ]
    [ sin(theta) * dt   0  ]          [ omega ]
    [ 0                 dt ]
\`\`\`

The heading is \`xhat[2]\`, and it is in radians already. Fill B **before** you change the state: the equations of HW6 use the heading from before the step.

**2.** \`xhat = xhat + B u\`. Row i of the product B u is \`B[i][0] * u[0] + B[i][1] * u[1]\`. A \`for\` loop over the three rows needs one line in its body.

## Given: the covariance
Step 3 is written for you. Two nested loops add Q to P, entry by entry. That is all of **P = F P F' + Q** when F is the identity. (F' is F with rows and columns swapped: still the identity.) Read what it says: every predict step makes the filter a little less sure of all three states. Only a measurement brings P down again.

## The test
\`main\` runs two steps. The first uses the numbers of the previous level: (2.0, 1.0, 0.5236) becomes (2.1732, 1.1, 0.5736). The second starts from there with v = 1 and omega = -1: slower, turning right.

The course code calls a small matrix library for the product (\`Matrix3x2_Mult\` in MatrixMath.c). Here you write the loop yourself, so you see what the library does.
`,
      kit: "robot",
      durationMs: 2,
      starter: KF3_PREDICT_MAIN(KF3_PREDICT_EMPTY),
      solution: KF3_PREDICT_MAIN(KF3_PREDICT),
      checks: [
        { kind: "var", name: "x1", min: 2.1727, max: 2.1737, label: "Step 1: x is 2.1732 ft", hint: "2.0: B or the loop is missing. 2.168: B was filled after the heading changed; fill B first. 2.1: sin and cos are swapped. 2.2: the heading is in radians already, do not convert it. 3.73: the first column of B needs * dt. 2.22: B[0][1] must be 0, the turn rate does not move x." },
        { kind: "var", name: "y1", min: 1.0995, max: 1.1005, label: "Step 1: y is 1.1 ft", hint: "B[1][0] = sin(xhat[2]) * dt and B[1][1] = 0." },
        { kind: "var", name: "th1", min: 0.5731, max: 0.5741, label: "Step 1: the heading is 0.5736 rad", hint: "0.5236: row 2 of B is (0, dt), and u[1] is omega. 0.7236: B[2][0] must be 0, the forward speed does not turn the robot." },
        { kind: "var", name: "x2", min: 2.2567, max: 2.2577, label: "Step 2: x is 2.2572 ft", hint: "Step 1 is right and step 2 is not: B must be filled again on every call, from the heading at that moment." },
        { kind: "var", name: "y2", min: 1.1538, max: 1.1548, label: "Step 2: y is 1.1543 ft" },
        { kind: "var", name: "th2", min: 0.4731, max: 0.4741, label: "Step 2: the heading is 0.4736 rad (a right turn makes it smaller)" },
        { kind: "var", name: "p00", min: 0.2999, max: 0.3001, label: "The given covariance step ran twice: P[0][0] is 0.2 + 0.05 + 0.05 = 0.3", hint: "Keep step 3 as it was given." },
        { kind: "var", name: "p22", min: 0.0699, max: 0.0701, label: "P[2][2] is 0.05 + 0.01 + 0.01 = 0.07" },
      ],
      watch: ["x1", "y1", "th1", "x2", "y2", "th2", "p00"],
      hints: [
        "Step 1 is eight assignments: B[0][0], B[0][1], B[1][0], B[1][1], B[2][0], B[2][1], u[0], u[1]. Four of the B entries are 0.0.",
        "`B[0][0] = cos(xhat[2]) * dt;` `B[1][0] = sin(xhat[2]) * dt;` `B[2][1] = dt;` `u[0] = v;` `u[1] = omega;`",
        "`for (i = 0; i < 3; i++) { xhat[i] = xhat[i] + B[i][0] * u[0] + B[i][1] * u[1]; }`",
      ],
      takeaway: "The state step is dead reckoning in matrix clothes, and the covariance step only adds Q. The matrix form earns its keep in the update, where a measurement of one state can correct another.",
    },
    {
      id: "loc-kf3-gain",
      kind: "calc",
      tier: "practice",
      title: "Practice: three states, the update by hand",
      goal: "Name the matrices of the update step (H, R, S, K) and do one update by hand with diagonal matrices.",
      refs: [{ course: "L20-21", slide: [50, 52, 54] }, { course: "HW6" }],
      brief: `
The update uses the position fix: two numbers, z = (zx, zy). The bench measures no heading. The course's OptiTrack does: there z has three numbers and H is the 3 x 3 identity. The steps are the same.

## H: what the sensor sees
One row per measured number, one column per state, with a 1 where the sensor reads that state:

\`\`\`c
        x  y  th
zx   [  1  0  0  ]
zy   [  0  1  0  ]
\`\`\`

H times the state is what the sensor should read if the estimate is right: (x, y). The **residual** e = z - H xhat is the surprise: fix minus prediction.

## R, S and K
- **R** (2 x 2): on its diagonal, the variance of the fix in x and in y.
- **S = H P H' + R** (2 x 2): the doubt of the residual. The corner of P that belongs to x and y, plus the sensor's own doubt: the "variance + r" of the 1-D filter.
- **K = P H' S^-1** (3 rows, 2 columns): the gain. Each entry says how far one state moves per foot of surprise in one measured number. S^-1 is the **inverse** of S, the matrix form of "divide by S".
- **xhat = xhat + K e** and **P = (I - K H) P**, with I the identity.

## When everything is diagonal
If P and R are 0 off the diagonal, the matrices fall apart into the 1-D filter, once for x and once for y: the gain for x is Pxx / (Pxx + Rx). The heading row of K is 0: nothing measures the heading, so it stays.

## Worked example
State (4.0, 2.0, 0.3), P diagonal 0.3, 0.1, 0.02. Fix (4.4, 1.9), R diagonal 0.1, 0.1. Residual: (0.4, -0.1). Gains: 0.3 / 0.4 = 0.75 for x, 0.1 / 0.2 = 0.5 for y. New state: (4.3, 1.95, 0.3). New P diagonal: 0.25 x 0.3 = 0.075, 0.5 x 0.1 = 0.05, 0.02.

## Your turn
The state after the predict step two levels back: (2.1732, 1.1, 0.5736), P diagonal 0.25, 0.25, 0.06. The fix is (2.4, 1.0). R diagonal: 0.25 for x and 0.75 for y. This sensor is worse in y.
`,
      fields: [
        { id: "e0", label: "Residual in x", unit: "ft", answer: 0.2268, tolPct: 1, why: "zx - x = 2.4 - 2.1732 = 0.2268 ft: the fix says the robot is further along x than predicted." },
        { id: "kx", label: "Gain for x (row x, column zx of K)", answer: 0.5, tolPct: 0.5, why: "0.25 / (0.25 + 0.25) = 0.5: prediction and fix are equally unsure in x, so meet in the middle." },
        { id: "ky", label: "Gain for y (row y, column zy of K)", answer: 0.25, tolPct: 0.5, why: "0.25 / (0.25 + 0.75) = 0.25: the fix is three times less sure in y, so it gets a quarter of the say." },
        { id: "x", label: "x after the update", unit: "ft", answer: 2.2866, tolPct: 0.1, why: "2.1732 + 0.5 x 0.2268 = 2.2866 ft." },
        { id: "y", label: "y after the update", unit: "ft", answer: 1.075, tolPct: 0.1, why: "The residual in y is 1.0 - 1.1 = -0.1. 1.1 + 0.25 x (-0.1) = 1.075 ft." },
        { id: "pyy", label: "Variance of y after the update", answer: 0.1875, tolPct: 0.5, why: "(1 - 0.25) x 0.25 = 0.1875. For x it is (1 - 0.5) x 0.25 = 0.125: the better measurement removed more doubt." },
        { id: "th", label: "Heading after the update", unit: "rad", answer: 0.5736, tolPct: 0.1, why: "Unchanged. The fix has no heading, and P is 0 off the diagonal, so nothing links the heading to x or y. The next level shows what happens when P is not diagonal." },
      ],
      hints: [
        "With diagonal matrices, treat x and y as two separate 1-D filters. The heading has no measurement.",
        "Gain = variance of the prediction / (variance of the prediction + variance of the fix), per axis: 0.25 / 0.5 and 0.25 / 1.0.",
        "New value = old + gain x (fix - old). New variance = (1 - gain) x old variance.",
      ],
      takeaway: "H says what the sensor sees, S is the doubt of the surprise, K shares the surprise out among the states. With diagonal matrices this is the 1-D filter once per axis.",
    },
    {
      id: "loc-kf3-update",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: three states, the update function",
      goal: "Write the measurement update for a position fix: residual, S, gain, state and covariance, with every matrix product written out.",
      refs: [{ course: "L20-21", slide: [52, 54, 57] }, { course: "HW6" }],
      brief: `
Write the update for any P, not only a diagonal one. The six steps are numbered in the code, and step 3 is given. With H = [1 0 0; 0 1 0] every product with H only picks rows or columns. So no general matrix multiply is needed: single floats and short loops do it.

**1. Residual**: \`e0 = zx - xhat[0]\` and \`e1 = zy - xhat[1]\`.

**2. S = H P H' + R**: the top left 2 x 2 corner of P plus R, kept in four floats. For example \`S01 = P[0][1] + R[0][1]\`.

**3. Inverse of S** (given). For a 2 x 2 matrix: swap the two diagonal entries, change the sign of the other two, divide all four by \`det = S00 * S11 - S01 * S10\`. Check: [2 0; 0 4] gives [0.5 0; 0 0.25].

**4. Gain K = P H' Si**, for each row i of the three:

\`\`\`c
K[i][0] = P[i][0] * Si00 + P[i][1] * Si10;
K[i][1] = P[i][0] * Si01 + P[i][1] * Si11;
\`\`\`

**5. State**, for each row i: \`xhat[i] = xhat[i] + K[i][0] * e0 + K[i][1] * e1\`.

**6. Covariance P = P - K H P**, for each row i and column j:

\`\`\`c
P[i][j] = P[i][j] - K[i][0] * P0[j] - K[i][1] * P1[j];
\`\`\`

\`P0\` and \`P1\` are rows 0 and 1 of P **from before** this step. Copy them into the two local arrays first: the loop overwrites row 0 while rows 1 and 2 still need the old one.

## The test
This P is not diagonal. \`P[0][2] = 0.02\` says: when x is too small, the heading tends to be too small as well. The fix says x is 0.23 ft further on, and the update moves the **heading** too, from 0.5736 to 0.5866, although nothing measured it. That is how a filter corrects a state it cannot see.

Expected: x = 2.2835, y = 1.0925, heading = 0.5866.

The course code does these steps with 3 x 3 library calls (\`Matrix3x3_Invert\`, \`Matrix3x3_Mult\`), because its H is the identity.
`,
      kit: "robot",
      durationMs: 2,
      starter: KF3_UPDATE_MAIN(KF3_UPDATE_EMPTY),
      solution: KF3_UPDATE_MAIN(KF3_UPDATE),
      checks: [
        { kind: "var", name: "t_K00", min: 0.497, max: 0.498, label: "K[0][0] is 0.4975: a surprise in x moves x by half of it", hint: "0: step 4 is missing. 0.25: S is still the placeholder; S00 = P[0][0] + R[0][0] and so on. 1.0: R was not added to S. Otherwise check the four Si names in step 4." },
        { kind: "var", name: "t_K21", min: -0.0327, max: -0.0317, label: "K[2][1] is -0.0322: a surprise in y moves the heading the other way", hint: "The loop of step 4 must run over all three rows, i = 0, 1, 2. Row 2 is how the heading gets corrected." },
        { kind: "var", name: "t_x", min: 2.283, max: 2.284, label: "x is 2.2835 ft", hint: "2.1732: step 5 is missing, or the residual is still 0. 2.058: the residual is fix minus estimate, zx - xhat[0]. 2.286: the second term K[i][1] * e1 is missing." },
        { kind: "var", name: "t_y", min: 1.092, max: 1.093, label: "y is 1.0925 ft" },
        { kind: "var", name: "t_th", min: 0.5861, max: 0.5871, label: "The heading moved to 0.5866 rad, corrected through P[0][2] and P[1][2]" },
        { kind: "var", name: "t_P00", min: 0.1239, max: 0.1249, label: "P[0][0] fell from 0.25 to 0.1244", hint: "0.25: step 6 is missing. Each entry loses K[i][0] * P0[j] + K[i][1] * P1[j]." },
        { kind: "var", name: "t_P11", min: 0.1842, max: 0.1852, label: "P[1][1] is 0.1847", hint: "0.1870: row 1 was computed from the NEW row 0. Copy rows 0 and 1 of P into P0 and P1 before the loops of step 6, and use the copies." },
        { kind: "var", name: "t_P02", min: 0.0103, max: 0.0113, label: "P[0][2] is 0.0108" },
        { kind: "var", name: "t_P22", min: 0.0577, max: 0.0587, label: "P[2][2] fell a little, to 0.0582: the filter is surer of the heading too", hint: "0.0588: rows 1 and 2 must use the old rows 0 and 1 of P (the copies P0 and P1)." },
      ],
      watch: ["t_x", "t_y", "t_th", "t_K00", "t_P00", "t_P11"],
      hints: [
        "Work down the six comments. Steps 1 and 2 are six assignments. Steps 4 and 5 are each one loop over i from 0 to 2.",
        "Step 6 needs three loops: first `for (j = 0; j < 3; j++) { P0[j] = P[0][j]; P1[j] = P[1][j]; }`, then two nested loops over i and j.",
        "Inside the nested loops: `P[i][j] = P[i][j] - K[i][0] * P0[j] - K[i][1] * P1[j];`",
      ],
      takeaway: "The gain has a row for every state, also for the ones the sensor cannot see. Whether those rows are 0 depends on the off-diagonal entries of P: they carry a correction from a measured state to an unmeasured one.",
    },
    {
      id: "loc-goto",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: go to a point",
      goal: "Drive the robot to a target position: turn to face it, drive there, stop, within 7.5 seconds.",
      refs: [{ course: "L15", slide: 26 }, { course: "L19", slide: [8, 7] }, { course: "Lab 5" }, { course: "HW4" }],
      brief: `
The robot stands at **(1, 1) ft with heading 2.8 rad**. Drive it to the target **(-1.0, -1.5) ft** and stop there, in at most 7.5 s.

No \`xy_control\` this time: write your own move-to-XY. You get \`speed_control(vref, turn)\` (a negative \`turn\` turns left) and the wheel speeds. Everything else is yours: dead reckoning from the given start pose, the direction to the target, the heading error, a small state machine (turn to face the target, drive, stop), and \`tb_report_pose(x, y, theta)\` on every call.

## Things that will bite
- The direction to the target is \`atan2(dy, dx)\`, with dx and dy from the robot to the target.
- From this start, the target is behind the robot and to its left, on the far side of the +-PI line. An unwrapped heading error says "turn right by 5 rad". The right answer is "turn left by 1.2 rad". There is no time for the long way round.
- Close to the target \`atan2\` of two tiny numbers swings wildly. Stop caring about the direction when you are close: declare victory inside a small radius and stop.
- A robot arriving at full speed overshoots. Slow down as the distance shrinks.
- Speeds: at most 1 ft/s forward and a \`turn\` of at most 0.6 in size.

## The test
At 7.5 s: stopped, within 0.1 ft of the target, with a pose estimate within 0.05 ft of the truth.

One star is for a short interrupt: its longest run stays below 2 us. Keep the wheel readings, the heading sum, a distance sum and \`speed_control\` in the interrupt. Do the trigonometry and the state machine in the main loop behind a flag, as in the practice level "Keep the interrupt short".
${BENCH}`,
      kit: "robot",
      durationMs: 7500,
      stimuli: [
        { at: 0, set: "TB_SET_X_FT", value: 1 },
        { at: 0, set: "TB_SET_Y_FT", value: 1 },
        { at: 0, set: "TB_SET_THETA_RAD", value: 2.8 },
      ],
      starter: prog(
        GOTO_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning, direction and distance to the target, state machine

    tb_report_pose(x, y, theta);
    speed_control(vref, turn);`,
        { functions: SPEED_CONTROL },
      ),
      solution: prog(
        `${GOTO_GLOBALS}
float dist = 0;       // distance to the target, ft
float eTheta = 0;     // heading error, rad
float odo = 0;        // distance driven since the start, ft (summed in the interrupt)
float odoDone = 0;    // the part of odo that x and y already contain
float step = 0;
int newStep = 0;      // 1: the main loop must run the navigation
uint32_t numTimer0calls = 0;`,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Every millisecond: the two cheap sums and the speed controller
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    if (theta > PI) theta = theta - 2.0 * PI;
    if (theta < -PI) theta = theta + 2.0 * PI;
    odo = odo + 0.5 * (vLeft + vRight) * 0.001;
    numTimer0calls++;
    if (numTimer0calls % 5 == 0) {
        newStep = 1;
    }
    speed_control(vref, turn);`,
        {
          functions: SPEED_CONTROL,
          loop: `
        // Every 5 ms: position, direction and distance to the target, state machine
        if (newStep == 1) {
            newStep = 0;
            step = odo - odoDone;
            odoDone = odoDone + step;
            x = x + step * cos(theta);
            y = y + step * sin(theta);

            dist = sqrt((xGoal - x) * (xGoal - x) + (yGoal - y) * (yGoal - y));
            eTheta = atan2(yGoal - y, xGoal - x) - theta;
            if (eTheta > PI) eTheta = eTheta - 2.0 * PI;
            if (eTheta < -PI) eTheta = eTheta + 2.0 * PI;
            turn = -2.0 * eTheta;
            if (turn > 0.6) turn = 0.6;
            if (turn < -0.6) turn = -0.6;

            if (state == 0) {
                vref = 0.0;
                if (fabs(eTheta) < 0.05) state = 1;
            } else if (state == 1) {
                vref = 3.0 * dist;
                if (vref > 1.0) vref = 1.0;
                if (dist < 0.04) state = 2;
            } else {
                vref = 0.0;
                turn = 0.0;
            }
            tb_report_pose(x, y, theta);
        }`,
        },
      ),
      checks: [
        { kind: "signal", name: "TB_X_FT", min: -1.1, max: -0.9, label: "x within 0.1 ft of the target (-1.0)", hint: "Not there yet: did the robot turn the long way round? Wrap the heading error to -PI ... PI." },
        { kind: "signal", name: "TB_Y_FT", min: -1.6, max: -1.4, label: "y within 0.1 ft of the target (-1.5)" },
        { kind: "signal", name: "TB_VLEFT", min: -0.02, max: 0.02, label: "The left wheel has stopped", hint: "Spinning near the target: stop steering once you are inside a small radius." },
        { kind: "signal", name: "TB_VRIGHT", min: -0.02, max: 0.02, label: "The right wheel has stopped" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.05, label: "Your pose estimate agrees with the truth within 0.05 ft", hint: "The dead reckoning starts from (1, 1) and 2.8 rad, not from zero." },
      ],
      bonus: [
        { kind: "signal", name: "TB_VLEFT", at: 6000, min: -0.02, max: 0.02, label: "Stopped within 6 s" },
        { kind: "signal", name: "TB_X_FT", at: 6000, min: -1.1, max: -0.9, label: "... and at the target by then: x within 0.1 ft of -1.0 at 6 s" },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "Short interrupt: its longest run is below 2 us", hint: "sin, cos and atan2 cost about 1 us each, sqrt 0.25 us. Sum the heading and the distance in the interrupt, set a flag every few milliseconds, and do the rest in the while (1) loop of main." },
      ],
      watch: ["x", "y", "theta", "state", "vref", "turn"],
      hints: [
        "Compute three things on every call: the distance to the target, the direction atan2(yGoal - y, xGoal - x), and the heading error (direction minus theta, wrapped).",
        "Steer with turn = -2.0 * eTheta, limited to +-0.6, in the turning state and in the driving state.",
        "Driving: vref = 3.0 * dist, limited to 1.0, until dist < 0.04. Then vref = 0 and turn = 0.",
      ],
      takeaway: "A go-to-point controller is two proportional controllers (heading and distance) and a wrap. The course's xy_control is the same idea with a few more guards.",
    },
    {
      id: "loc-kf2",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: a Kalman filter with two states",
      goal: "Estimate position and velocity from position fixes alone, with the matrix equations written out by hand.",
      refs: [{ course: "L20-21", slide: [69, 70, 73] }, { course: "HW6" }],
      brief: `
Now there are no wheel speeds. The only sensor is the position fix, 100 times a second, off by about 0.1 ft each time. Estimate **two** things from it: the position and the **velocity**. Dividing the difference of two fixes by 0.01 s would give a velocity that is off by more than 10 ft/s. The filter does far better.

This level uses matrices: do the practice level "One matrix for rotate and shift" first if a matrix times a list of numbers is new to you. The **state** is the list of numbers the filter estimates. The **covariance matrix** P plays the part of the variance: P00 is the variance of the position, P11 that of the velocity, and P01 = P10 says how errors in the two go together.

## The model
State: position p and velocity v. In a step of length dt the position grows by v dt. The velocity stays, plus an unknown change with variance qv. Only the position is measured:

F = [1 dt; 0 1], H = [1 0], Q = [0 0; 0 qv], R = r

## The equations of HW6, written out
The covariance matrix P is four floats: \`P00\`, \`P01\`, \`P10\`, \`P11\`.

**Predict** (x = F x, P = F P F' + Q):
- pos = pos + vel dt
- P00 = P00 + dt (P01 + P10) + dt dt P11
- P01 = P01 + dt P11, P10 = P10 + dt P11
- P11 = P11 + qv

**Update** (S = H P H' + R, K = P H' / S, x = x + K (z - H x), P = (I - K H) P):
- S = P00 + r, K0 = P00 / S, K1 = P10 / S
- e = z - pos, pos = pos + K0 e, vel = vel + K1 e
- P00 = (1 - K0) P00, P01 = (1 - K0) P01, P10 = P10 - K1 P00, P11 = P11 - K1 P01

Every right-hand side uses the values from **before** the step. Copy what you still need into local variables first.

## What to build
- \`kf2_predict(dt, qv)\` and \`kf2_update(z, r)\` on the globals.
- In the interrupt: when \`tb_gps_new()\` is 1, read \`tb_gps_x()\` into \`z\`, predict with dt = 0.01 and \`QV\`, update with \`R\`. Then report \`tb_report_pose(kf_pos, 0.0, 0.0)\`.

\`main\` first runs a self-test (P = identity, dt = 1, qv = 0.5, z = 3, r = 2). By hand: after the predict P = [2 1; 1 1.5]; after the update pos = 1.5, vel = 0.75, P = [1 0.5; 0.5 1.25]. The robot then drives at 1 ft/s for 3 s and at 2 ft/s after that. Your velocity estimate must follow.
`,
      kit: "robot",
      durationMs: 6000,
      stimuli: [
        { at: 0, set: "TB_GPS_NOISE", value: 0.1 },
        { at: 1000, set: "TB_STATS_RESET", value: 1 },
      ],
      starter: prog(
        `#define QV 0.001      // process noise on the velocity, per 10 ms step
#define R 0.01        // variance of one position fix, ft^2
${KF2_GLOBALS}
uint32_t numTimer0calls = 0;`,
        `
${KF2_DRIVE}
    // On a new fix: predict over 0.01 s, then update

    tb_report_pose(kf_pos, 0.0, 0.0);`,
        {
          functions: `// Predict over dt seconds. qv: variance added to the velocity.
void kf2_predict(float dt, float qv)
{

}

// Update with a position measurement z of variance r.
void kf2_update(float z, float r)
{

}`,
          setup: KF2_MAIN_SETUP,
        },
      ),
      solution: prog(
        `#define QV 0.001      // process noise on the velocity, per 10 ms step
#define R 0.01        // variance of one position fix, ft^2
${KF2_GLOBALS}
uint32_t numTimer0calls = 0;`,
        `
${KF2_DRIVE}
    // On a new fix: predict over 0.01 s, then update
    if (tb_gps_new()) {
        z = tb_gps_x();
        kf2_predict(0.01, QV);
        kf2_update(z, R);
    }

    tb_report_pose(kf_pos, 0.0, 0.0);`,
        {
          functions: `// Predict over dt seconds. qv: variance added to the velocity.
void kf2_predict(float dt, float qv)
{
    kf_pos = kf_pos + kf_vel * dt;
    P00 = P00 + dt * (P01 + P10) + dt * dt * P11;
    P01 = P01 + dt * P11;
    P10 = P10 + dt * P11;
    P11 = P11 + qv;
}

// Update with a position measurement z of variance r.
void kf2_update(float z, float r)
{
    float S = P00 + r;
    float K0 = P00 / S;
    float K1 = P10 / S;
    float e = z - kf_pos;
    float a00 = P00;
    float a01 = P01;

    kf_pos = kf_pos + K0 * e;
    kf_vel = kf_vel + K1 * e;
    P00 = (1.0 - K0) * a00;
    P01 = (1.0 - K0) * a01;
    P10 = P10 - K1 * a00;
    P11 = P11 - K1 * a01;
}`,
          setup: KF2_MAIN_SETUP,
        },
      ),
      checks: [
        { kind: "var", name: "t_pos", min: 1.499, max: 1.501, label: "Self-test: position 1.5", hint: "K0 = P00 / (P00 + r) with P00 = 2 after the predict: 0.5." },
        { kind: "var", name: "t_vel", min: 0.749, max: 0.751, label: "Self-test: velocity 0.75", hint: "K1 = P10 / S = 1 / 4. A position error also corrects the velocity, through P10." },
        { kind: "var", name: "t_P00", min: 0.999, max: 1.001, label: "Self-test: P00 = 1" },
        { kind: "var", name: "t_P01", min: 0.499, max: 0.501, label: "Self-test: P01 = 0.5", hint: "In the predict step, P00 must use P01, P10 and P11 from before the step." },
        { kind: "var", name: "t_P11", min: 1.249, max: 1.251, label: "Self-test: P11 = 1.25", hint: "P11 = P11 - K1 * P01 with the P01 from before the update (1.0), not the new one." },
        { kind: "var", name: "kf_vel", at: 2990, min: 0.85, max: 1.15, label: "At 3 s the velocity estimate is 1 ft/s (within 0.15)" },
        { kind: "var", name: "kf_vel", min: 1.85, max: 2.15, label: "At the end the velocity estimate is 2 ft/s (within 0.15)", hint: "Stuck near 1: QV tells the filter how much the velocity may change. Use the given value." },
        { kind: "signal", name: "TB_GPS_RMS_FT", min: 0.08, label: "The raw fixes are off by about 0.1 ft" },
        { kind: "signal", name: "TB_EST_RMS_FT", max: 0.06, label: "From 1 s on, the position estimate is off by less than 0.06 ft" },
      ],
      watch: ["z", "kf_pos", "kf_vel", "P00", "P11"],
      hints: [
        "Write the predict step in the order given in the brief: P00 first (it needs the old P01, P10 and P11), then P01 and P10 (they need the old P11), then P11.",
        "In the update, compute S, K0, K1 and e first, and save the old P00 and P01 in locals before you overwrite them.",
        "Interrupt: `if (tb_gps_new()) { z = tb_gps_x(); kf2_predict(0.01, QV); kf2_update(z, R); }`",
      ],
      takeaway: "The filter was never given a velocity, yet it estimates one: P10 links a position error to a velocity correction. That link is what the off-diagonal terms of a covariance matrix are for, and why HW6's Q and R are full 3 x 3 matrices.",
    },
    {
      id: "loc-kf3",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: the robot's three-state filter",
      goal: "Write the whole three-state Kalman filter and run it on the robot, so the pose estimate beats both dead reckoning and the raw fixes.",
      refs: [{ course: "L20-21", slide: [57, 75] }, { course: "L15", slide: 26 }, { course: "HW6" }],
      brief: `
Run the filter of HW6 on the bench: state (x, y, heading), predict from the wheels, update from the position fix. You write both functions and the wiring. Do the practice levels "Three states" first.

## The situation
- The code thinks the robot starts at (0, 0). It was put down at (1.5, -1.0), heading 0. Dead reckoning never finds out.
- Each fix is off by about 0.15 ft in x and in y. \`R\` holds 0.15 x 0.15 = 0.0225.
- At 3 s the robot is bumped 0.4 ft sideways. The wheels do not notice.

## What to write
1. \`kf3_predict(v, omega, dt)\`: B and u, xhat = xhat + B u, P = P + Q.
2. \`kf3_update(zx, zy)\`: residual, S, its inverse, K, the state, then P (from rows 0 and 1 of the old P).
3. **In the interrupt**, every call: add V to \`vSum\` and omega to \`wSum\`. Every 10th call: store the averages in \`v\` and \`omega\`, clear the sums, set \`newStep = 1\`.
4. **In the main loop**, when \`newStep\` is 1: clear it, predict with \`v\`, \`omega\` and \`DT\`, update if \`tb_gps_new()\` is 1, then \`tb_report_pose(xhat[0], xhat[1], xhat[2])\`.

The filter costs two trigonometry calls and some sixty multiplications, so it runs in the main loop. The interrupt only sums (practice level "Keep the interrupt short").

## Q, R and the heading
Q and R are given. Q says how far dead reckoning may wander in 10 ms. With Q = 0 the filter ends up trusting the wheels completely, and after the bump it takes many seconds to believe the fixes. With a large Q the estimate jumps with every fix.

Nothing here measures the heading, and with F the identity P never links it to x or y. So this filter carries the heading by dead reckoning alone. On the course robot the OptiTrack measures it too.

## The test
- At 0.5 s the estimate has found the robot (within 0.15 ft).
- At 4 s, one second after the bump, it is within 0.12 ft again.
- From 4.5 s on it is off by less than 0.05 ft on average. A raw fix is off by 0.21 ft.
- Star: the longest run of the interrupt function stays below 1.5 us.
${BENCH}
- \`tb_gps_new()\`: 1 when a new position fix has arrived since the last call, else 0.
- \`tb_gps_x()\`, \`tb_gps_y()\`: the latest fix, ft.
`,
      kit: "robot",
      durationMs: 8000,
      stimuli: [
        { at: 0, set: "TB_SET_X_FT", value: 1.5 },
        { at: 0, set: "TB_SET_Y_FT", value: -1.0 },
        { at: 0, set: "TB_GPS_NOISE", value: 0.15 },
        { at: 3000, set: "TB_SET_Y_FT", value: -0.6 },
        { at: 4500, set: "TB_STATS_RESET", value: 1 },
      ],
      starter: prog(
        KF3_RUN_GLOBALS,
        `
${KF3_RUN_DRIVE}
    // Sum V and omega. Every 10th call: hand their averages to the main loop.
`,
        {
          functions: `${KF3_PREDICT_BLANK}\n\n${KF3_UPDATE_BLANK}`,
          loop: `
        // Every 10 ms: predict, update if a fix arrived, report
`,
        },
      ),
      solution: prog(
        KF3_RUN_GLOBALS,
        `
${KF3_RUN_DRIVE}
${KF3_RUN_ISR_SUMS}`,
        { functions: `${KF3_PREDICT}\n\n${KF3_UPDATE}`, loop: KF3_RUN_LOOP },
      ),
      checks: [
        { kind: "signal", name: "TB_EST_ERR_FT", at: 500, max: 0.15, label: "At 0.5 s the estimate has found the robot (it started 1.8 ft off)", hint: "No value: tb_report_pose is never called; is newStep set in the interrupt? Still 1.8 ft: the update never runs or does nothing; test kf3_update in the practice level. Hundreds of feet: v and omega are averages (sum / 10.0), and the predict runs once per 10 ms with DT." },
        { kind: "signal", name: "TB_EST_ERR_FT", at: 4000, max: 0.12, label: "At 4 s, one second after the bump, the estimate is within 0.12 ft again", hint: "About 0.3 ft: P shrank to nothing, so the filter no longer listens. The predict step must add Q to P on every call." },
        { kind: "signal", name: "TB_GPS_RMS_FT", min: 0.17, label: "The raw fixes are off by about 0.21 ft" },
        { kind: "signal", name: "TB_EST_RMS_FT", max: 0.05, label: "From 4.5 s on the estimate is off by less than 0.05 ft: four times better than a fix", hint: "About 0.2 ft: the estimate just follows the fixes. R must be added in S, and Q must be the given one. More than that: the predict step must run on every 10 ms step, with or without a fix, and B must use cos for x and sin for y." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.02, label: "The heading estimate is within 0.02 rad at the end", hint: "The heading comes from the predict step alone: row 2 of B is (0, dt) and u[1] is omega = (vRight - vLeft) / WHEEL_BASE." },
      ],
      bonus: [
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 1.5, label: "Short interrupt: its longest run is below 1.5 us", hint: "The filter must not run inside cpu_timer0_isr. Set newStep there and call kf3_predict and kf3_update from the while (1) loop of main." },
      ],
      watch: ["v", "omega", "newStep"],
      hints: [
        "Build it in three stages and run after each. First the interrupt sums, the flag and a main loop that only predicts and reports: the estimate then moves like the robot, 1.8 ft away from it. Then the update. Then compare with the test.",
        "Interrupt: `vSum = vSum + 0.5 * (vLeft + vRight); wSum = wSum + (vRight - vLeft) / WHEEL_BASE;` and `if (numTimer0calls % 10 == 0) { v = vSum / 10.0; omega = wSum / 10.0; vSum = 0.0; wSum = 0.0; newStep = 1; }`",
        "Main loop: `if (newStep == 1) { newStep = 0; kf3_predict(v, omega, DT); if (tb_gps_new()) { kf3_update(tb_gps_x(), tb_gps_y()); } tb_report_pose(xhat[0], xhat[1], xhat[2]); }`",
      ],
      takeaway: "This is the filter of the final project: wheels for the fast, smooth part, fixes for the absolute part, Q and R to set the balance. With F the identity and diagonal Q and R, P stays diagonal and the filter is three small ones side by side. The matrix form is what lets you add the off-diagonal terms of HW6's Q and R, or a heading measurement, without rewriting the code.",
    },
  ],
};
