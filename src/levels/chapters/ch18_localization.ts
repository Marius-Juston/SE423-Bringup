import type { Chapter } from "../types";

// Chapter 18 runs on the test bench robot of src/sim/plugins/plant.ts
// (wheel base 0.6 ft, heading counter-clockwise positive, gyro in rad/s,
// position fixes at 100 Hz). The homework numbers are HW4's; only its
// published check values (x = 8.9129 and x = 3.8482) are asked for or
// shown, never the parts of the answer the homework grades.

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

/** A complete program whose timer 0 interrupt (every `periodUs`) runs `isr`. */
const prog = (globals: string, isr: string, opts: { functions?: string; periodUs?: number; setup?: string } = {}) => `${FREQ}
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

    while (1) {}
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
The robot is the simulator's **test bench** (functions starting with \`tb_\`). On the real robot the same values come from your encoder, gyro and OptiTrack code.

- \`tb_left_speed()\`, \`tb_right_speed()\`: wheel speeds in ft/s. The wheels are **0.6 ft** apart (\`WHEEL_BASE\`).
- \`tb_set_effort(uLeft, uRight)\`: control efforts, -10 to 10.
- \`tb_report_pose(x, y, theta)\`: tell the bench where you think the robot is (ft, ft, rad). The bench knows the truth and the tests use the difference.
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

const SQUARE_GLOBALS = `float vLeft = 0;
float vRight = 0;
float x = 0;          // estimated pose: ft, ft, rad
float y = 0;
float theta = 0;
float vref = 0;
float turn = 0;
int corners = 0;      // corners finished, 4 when the square is complete
${SPEED_GLOBALS}`;

export const ch18: Chapter = {
  id: "localization",
  number: 18,
  title: "Where am I",
  blurb: "Frames and transforms, dead reckoning, gyro drift, and a Kalman filter built step by step.",
  requires: ["control"],
  course: ["L15", "L20-21", "HW4", "HW6"],
  levels: [
    {
      id: "loc-brief",
      kind: "brief",
      title: "Two frames and a pose",
      goal: "Learn the robot and world frames, the rotation that connects them, and how a robot keeps track of its pose.",
      refs: [{ course: "L15" }, { course: "HW4" }],
      brief: `
A sensor on the robot says "golf ball 2.8 ft ahead, 2.3 ft to the right". Where is that in the room? To answer, you need to know where the robot is and which way it points. This chapter is about that question.

## Two frames
- The **world frame** is fixed to the room: an origin on the floor, x and y axes along the tiles.
- The **robot frame** (body frame) is fixed to the robot: origin between the wheels, **x straight ahead, y to the robot's left**.

The robot's **pose** is its position (x, y) in the world frame and its heading **theta**: the angle from the world x axis to the robot's x axis, counter-clockwise positive, in radians.

## From robot frame to world frame
Rotate by the heading, then add the robot's position:

- x_world = x_robot cos(theta) - y_robot sin(theta) + x_of_robot
- y_world = x_robot sin(theta) + y_robot cos(theta) + y_of_robot

In matrix form this is **P_world = R(theta) P_robot + T**, with the rotation matrix R(theta) = [cos -sin; sin cos] and the translation T = the robot's position. Packing R and T into one 3 x 3 matrix gives the **homogeneous transformation** of HW4.

Try it in the figure: drag and turn the robot and watch the same point get new world coordinates, with the formula filled in.

{{figure:frames}}

## Dead reckoning
Nobody tells the robot its pose. It can work it out from its own wheels. For a robot with two driven wheels a distance b apart (**differential drive**):

- forward speed **V = (vL + vR) / 2**
- turn rate **omega = (vR - vL) / b** (right wheel faster: turning left, positive)

Every millisecond the robot moved a little: \`theta += omega * dt\`, \`x += V * cos(theta) * dt\`, \`y += V * sin(theta) * dt\`. Adding up these small steps is called **dead reckoning**.

## Why that is not enough
Every step has a small error, and the errors add up:

- **Systematic** errors always push the same way: a wheel slightly smaller than you think, a gyro that reads 0.05 rad/s when the robot is still (**bias**). They grow steadily, and they can be measured and removed.
- **Random** errors are different every time: a wheel slipping, sensor noise. They can only be averaged or filtered.

Encoders measure distance well and heading poorly (a small wheel slip turns the estimate for good). A gyro measures turning well, but integrating its bias gives a heading that **drifts**. So robots combine sensors. The second half of this chapter builds the tool for that, the Kalman filter, one small step at a time.
`,
      questions: [
        {
          prompt: "In the robot frame, where is a point with coordinates (0, 1)?",
          options: ["One foot to the robot's left", "One foot ahead of the robot", "One foot to the robot's right", "One foot north of the room's origin"],
          answer: 0,
          why: "Robot x points straight ahead, so robot y points to the robot's left. HW4 uses the same convention.",
        },
        {
          prompt: "The left wheel runs at 0.8 ft/s and the right wheel at 1.2 ft/s. What does the robot do?",
          options: [
            "It moves forward at 1.0 ft/s while turning left",
            "It moves forward at 1.0 ft/s while turning right",
            "It moves forward at 2.0 ft/s in a straight line",
            "It spins on the spot",
          ],
          answer: 0,
          why: "V = (0.8 + 1.2) / 2 = 1.0 ft/s. omega = (1.2 - 0.8) / b is positive: counter-clockwise, a left turn.",
        },
        {
          prompt: "A gyro reads 0.01 rad/s too much, all the time. After integrating it for 100 s, how wrong is the heading?",
          options: ["1 rad, and still growing", "0.01 rad", "0.1 rad, then it stops growing", "Nothing: the error averages out"],
          answer: 0,
          why: "A constant bias integrates to a ramp: 0.01 rad/s x 100 s = 1 rad, about 57 degrees. This is gyro drift. Random noise averages out; a bias does not.",
        },
      ],
      takeaway: "Pose = position + heading. Sensors on the robot speak robot frame; the room speaks world frame; R(theta) and T translate. Dead reckoning adds up small steps, and small errors.",
    },
    {
      id: "loc-transform",
      kind: "calc",
      title: "Rotate, translate, and back",
      goal: "Transform points between the robot frame and the world frame by hand, with HW4's numbers.",
      refs: [{ course: "HW4" }, { course: "L15" }],
      brief: `
## Robot frame to world frame
Rotate by the heading theta, then add the robot's position (Tx, Ty):

- x_world = x cos(theta) - y sin(theta) + Tx
- y_world = x sin(theta) + y cos(theta) + Ty

## World frame to robot frame
Undo the two steps in the opposite order: **subtract** the robot's position, then rotate **back** by theta:

- dx = x_world - Tx, dy = y_world - Ty
- x_robot = dx cos(theta) + dy sin(theta)
- y_robot = -dx sin(theta) + dy cos(theta)

This is HW4's inverse of the homogeneous transformation: the rotation part becomes its transpose (the signs of the two sines swap), and the translation becomes -R^T d.

In the robot frame, positive y is to the robot's **left**. A negative y means the point is on its right.

Try it in the figure: switch the point to "stays in the room" to see the inverse written out with numbers.

{{figure:frames}}

Your calculator must be in degree mode for these, or convert: radians = degrees x pi / 180.
`,
      fields: [
        { id: "a", label: "The point (2, 1) rotated by 90 degrees: x", answer: -1, tolPct: 1, why: "x = 2 cos 90 - 1 sin 90 = 0 - 1 = -1. A quarter turn to the left sends (2, 1) to (-1, 2)." },
        { id: "b", label: "The point (2, 1) rotated by 30 degrees: y", answer: 1.866, tolPct: 0.5, why: "y = 2 sin 30 + 1 cos 30 = 1 + 0.866 = 1.866." },
        {
          id: "c",
          label: "HW4: ball at (2.8, -2.3) in the robot frame, robot at (5.3, -1.4), theta = 35 degrees. World x",
          answer: 8.9129,
          tolPct: 0.05,
          why: "x = 2.8 cos 35 + 2.3 sin 35 + 5.3 = 2.2936 + 1.3192 + 5.3 = 8.9129, the check value the homework gives. Note the sign: minus y sin(theta) with y = -2.3 is plus.",
        },
        { id: "d", label: "Robot at (1, 2) heading 90 degrees, ball at (3, 5) in the world: ball's x in the robot frame", answer: 3, tolPct: 1, why: "dx = 2, dy = 3. x_robot = 2 cos 90 + 3 sin 90 = 3. The robot looks along world y, and the ball is 3 ft further along world y: 3 ft ahead." },
        { id: "e", label: "Same case: ball's y in the robot frame", answer: -2, tolPct: 1, why: "y_robot = -2 sin 90 + 3 cos 90 = -2. Negative: the ball is 2 ft to the robot's right." },
        {
          id: "f",
          label: "HW4: ball at (2.54, 1.45) in the world, robot at (5.3, -1.4), theta = 120 degrees. Ball's x in the robot frame",
          answer: 3.8482,
          tolPct: 0.05,
          why: "dx = 2.54 - 5.3 = -2.76, dy = 1.45 + 1.4 = 2.85. x_robot = -2.76 cos 120 + 2.85 sin 120 = 1.38 + 2.4682 = 3.8482, the homework's check value.",
        },
      ],
      hints: [
        "cos 90 = 0 and sin 90 = 1; cos 30 = 0.866 and sin 30 = 0.5.",
        "For the world to robot direction, subtract the robot's position first. Only then rotate, with the signs of the sines swapped.",
        "cos 120 = -0.5, sin 120 = 0.866; cos 35 = 0.81915, sin 35 = 0.57358.",
      ],
      takeaway: "Out: rotate, then add. Back: subtract, then rotate the other way. The order matters.",
    },
    {
      id: "loc-rotate",
      kind: "code",
      mode: "complete",
      title: "rotate() and body_to_world()",
      goal: "Complete a rotation function and use it to transform a point from the robot frame to the world frame.",
      refs: [{ course: "HW4" }, { course: "L15" }],
      brief: `
Put the two formulas into two functions. A C function returns one value, and a point has two, so the results come back through **pointers**: the caller passes the addresses of two floats and the function writes to them with \`*xw = ...\`.

## rotate
\`rotate(x, y, phi, &xw, &yw)\` rotates the point (x, y) by the angle \`phi\` (radians). The x line is written. Add the y line:

y_w = x sin(phi) + y cos(phi)

## body_to_world
\`body_to_world(xb, yb, rx, ry, rphi, &xw, &yw)\` takes a point in the robot (body) frame and the robot's pose (rx, ry, rphi) and gives the point in the world frame: rotate by \`rphi\`, then add (rx, ry). Call \`rotate\` inside it.

\`main\` already calls both, with one easy case each and with HW4's golf ball. \`sin\` and \`cos\` take **radians**: the calls convert with \`* PI / 180.0\`.
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
    rotate(2.0, 1.0, 90.0 * PI / 180.0, &px, &py);
    body_to_world(1.0, 0.5, 2.0, 3.0, 180.0 * PI / 180.0, &qx, &qy);
    // HW4: the golf ball
    body_to_world(2.8, -2.3, 5.3, -1.4, 35.0 * PI / 180.0, &ballx, &bally);

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
    rotate(2.0, 1.0, 90.0 * PI / 180.0, &px, &py);
    body_to_world(1.0, 0.5, 2.0, 3.0, 180.0 * PI / 180.0, &qx, &qy);
    // HW4: the golf ball
    body_to_world(2.8, -2.3, 5.3, -1.4, 35.0 * PI / 180.0, &ballx, &bally);

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "px", min: -1.001, max: -0.999, label: "rotate: (2, 1) turned by 90 degrees has x = -1" },
        { kind: "var", name: "py", min: 1.999, max: 2.001, label: "rotate: (2, 1) turned by 90 degrees has y = 2", hint: "y_w = x sin(phi) + y cos(phi). Write it through the pointer: *yw = ..." },
        { kind: "var", name: "qx", min: 0.999, max: 1.001, label: "body_to_world: (1, 0.5) seen by a robot at (2, 3) facing backwards is at x = 1", hint: "Rotate first, then add rx to *xw." },
        { kind: "var", name: "qy", min: 2.499, max: 2.501, label: "... and y = 2.5" },
        { kind: "var", name: "ballx", min: 8.912, max: 8.914, label: "HW4's golf ball is at world x = 8.9129" },
      ],
      watch: ["px", "py", "qx", "qy", "ballx"],
      hints: [
        "In rotate, the second line is like the first with sin and cos swapped and a plus sign.",
        "Inside body_to_world, xw and yw are already pointers: pass them on as they are, `rotate(xb, yb, rphi, xw, yw);`",
        "Then `*xw = *xw + rx;` and `*yw = *yw + ry;`",
      ],
      takeaway: "Two small functions carry every sensor reading from the robot into the room. The golf-ball and LIDAR code of the project is this, applied to each reading.",
    },
    {
      id: "loc-dead",
      kind: "code",
      mode: "write",
      title: "Dead reckoning",
      goal: "Keep track of the robot's pose by integrating its wheel speeds every millisecond.",
      refs: [{ course: "L15" }, { course: "Lab 3" }],
      brief: `
The interrupt function already drives the robot: straight, then on a left arc, then stop. Add the code that keeps track of where it is.

Every 1 ms:

1. Read both wheel speeds into \`vLeft\` and \`vRight\`.
2. Forward speed: \`V = (vLeft + vRight) / 2\`.
3. Turn rate: \`omega = (vRight - vLeft) / WHEEL_BASE\`.
4. Take one small step of 0.001 s (the **rectangle rule**: speed x time step):
   - \`theta = theta + omega * 0.001\`
   - \`x = x + V * cos(theta) * 0.001\`
   - \`y = y + V * sin(theta) * 0.001\`

\`x\`, \`y\` and \`theta\` are globals that start at 0: the robot starts at the origin, looking along the world x axis.

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
        { kind: "var", name: "x", at: 1500, min: 1.42, max: 1.46, label: "Your x agrees after the straight part (1.44 ft)", hint: "x adds V * cos(theta) * 0.001 on every pass, with V the average of the two wheel speeds." },
        { kind: "var", name: "theta", min: 1.48, max: 1.52, label: "Your heading after the arc is about 1.49 rad", hint: "omega = (vRight - vLeft) / WHEEL_BASE. Swapped wheels give -1.49." },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.01, label: "Heading estimate within 0.01 rad of the truth at the end" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.02, label: "Position estimate within 0.02 ft of the truth at the end", hint: "sin and cos take the heading in radians, and each step is multiplied by 0.001 s." },
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
      id: "loc-units",
      kind: "code",
      mode: "debug",
      title: "Degrees, radians and a heading that keeps growing",
      goal: "Fix a dead-reckoning function that mixes degrees with radians and never wraps its heading.",
      refs: [{ course: "L15" }, { course: "Lab 5" }],
      brief: `
This robot takes its heading from the gyro. Like the course's gyro code, it works in **degrees**: the rate is converted to degrees per second and integrated into \`angle_deg\`. The robot drives a little more than three quarters of a circle to the left.

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
      id: "loc-gyro",
      kind: "code",
      mode: "complete",
      title: "Gyro bias: measure it, remove it",
      goal: "Average the gyro while the robot stands still and subtract that offset before integrating.",
      refs: [{ course: "L15" }, { course: "Lab 5" }],
      brief: `
A rate gyro reads **true turn rate + bias + noise**. The bias is a small constant: the reading when the robot is not turning at all. This one reads about 0.05 rad/s at rest. Integrate that for 7 seconds and the heading is off by 0.35 rad (20 degrees) although the robot never moved.

## The cure
A bias is a systematic error, so it can be measured. The robot's start-up code keeps the robot still, adds up the gyro readings for a while, and divides by their number. That average is the bias (the noise averages out). From then on it is subtracted from every reading.

## What to do
The function below has two phases, like the robot's code:

- **First second** (calls 1 to 1000): the robot stands still. Add each reading to \`gyro_sum\`. On call 1000, set \`gyro_offset = gyro_sum / 1000.0\`.
- **After that**: subtract \`gyro_offset\` from the reading before it is integrated. The integration is already written, with the **trapezoid rule** the course code uses: the average of this reading and the previous one, times the time step.

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
        { kind: "signal", name: "TB_EST_ERR_RAD", at: 3500, max: 0.02, label: "Heading within 0.02 rad of the truth after the spin" },
        { kind: "signal", name: "TB_EST_ERR_RAD", max: 0.02, label: "Still within 0.02 rad after standing for 4.5 s: no drift", hint: "The heading creeps by 0.05 rad every second: subtract gyro_offset from gyro before the integration." },
      ],
      watch: ["gyro", "gyro_offset", "theta"],
      hints: [
        "Two places need code: inside the calibration branch, and right after the comment 'Remove the bias'.",
        "Calibration: `gyro_sum = gyro_sum + gyro;` and, when numTimer0calls == 1000, `gyro_offset = gyro_sum / 1000.0;`",
        "Then `gyro = gyro - gyro_offset;` before the trapezoid line.",
      ],
      takeaway: "Keep the robot still at start-up and you get the gyro's bias for free. The course code averages 2000 samples this way. What the calibration cannot remove is a bias that changes later, as the sensor warms up.",
    },
    {
      id: "loc-comp",
      kind: "code",
      mode: "complete",
      title: "Complementary filter",
      goal: "Blend the gyro heading with the encoder heading so the result does not drift when the gyro's bias changes.",
      refs: [{ course: "L15" }],
      brief: `
The calibration of the previous level removed the bias the gyro had at start-up. In this run the bias **changes after 3 seconds** (sensors warm up). The gyro heading \`theta_gyro\` starts to drift again, and no start-up calibration can help.

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
      takeaway: "Two imperfect sensors with different weaknesses beat either one. A complementary filter uses a fixed blend. The Kalman filter, next, works out the best blend by itself.",
    },
    {
      id: "loc-kf-calc",
      kind: "calc",
      title: "A Kalman filter with one number",
      goal: "Do one predict step and one update step of a 1-D Kalman filter by hand.",
      refs: [{ course: "L20-21" }, { course: "HW6" }],
      brief: `
Forget matrices for now. The robot drives along a line and wants to know one number: its position x.

It never knows x exactly. It keeps a **belief**: a best guess (the **mean**) and how unsure that guess is (the **variance**, the square of the typical error). A small variance means "quite sure".

The filter repeats two steps.

## Predict: the robot moves
The wheels say the robot moved by u. The guess moves with it. But the wheels are not perfect, so the robot is now a bit **less** sure:

- mean = mean + u
- variance = variance + q (q: variance added by the move, the **process noise**)

## Update: a measurement arrives
A sensor says "you are at z". It is not perfect either: its variance is r. The filter moves the guess part of the way towards the measurement. How far is the **Kalman gain**:

- K = variance / (variance + r)
- mean = mean + K (z - mean)
- variance = (1 - K) variance

Read the gain as trust. If the belief is very unsure (large variance) and the sensor is good (small r), K is close to 1: take the measurement. If the belief is already good and the sensor is poor, K is close to 0: keep the prediction. After an update the variance is always **smaller**: a measurement can only add information.

Try it in the figure: go through one round step by step, then move the two variances and watch the gain and the updated curve.

{{figure:kalman-1d}}

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
      refs: [{ course: "L20-21" }, { course: "HW6" }],
      brief: `
Turn the two steps into two functions. The belief lives in two globals: \`kf_x\` (mean) and \`kf_p\` (variance).

## kf_predict(u, q)
- \`kf_x\` grows by \`u\`
- \`kf_p\` grows by \`q\`

## kf_update(z, r)
- gain: \`kf_k = kf_p / (kf_p + r)\`
- \`kf_x\` moves towards \`z\` by the gain: \`kf_x = kf_x + kf_k * (z - kf_x)\`
- \`kf_p = (1.0 - kf_k) * kf_p\`

The order inside \`kf_update\` matters: the gain is computed from the variance **before** it is reduced.

The figure shows each line of the two functions next to what it does to the belief.

{{figure:kalman-1d}}

\`main\` runs the numbers of the previous level, so you know what to expect after round 1: mean 3.48, variance 0.16. Then it runs a second round.

These are the same equations HW6 writes with matrices, for a state with one entry: F = 1, H = 1, and P, Q, R, K are single numbers.
`,
      kit: "robot",
      durationMs: 2,
      starter: KF_MAIN(KF_EMPTY),
      solution: KF_MAIN(KF_FUNCTIONS),
      checks: [
        { kind: "var", name: "x1", min: 3.479, max: 3.481, label: "Round 1: the mean is 3.48 ft", hint: "3.0 means the update did nothing; 3.6 means the gain is 1. K = kf_p / (kf_p + r)." },
        { kind: "var", name: "p1", min: 0.1599, max: 0.1601, label: "Round 1: the variance is 0.16", hint: "Compute the gain before you change kf_p, and reduce kf_p after you have used it." },
        { kind: "var", name: "kf_k", min: 0.6969, max: 0.6971, label: "Round 2: the gain is 0.46 / 0.66 = 0.697" },
        { kind: "var", name: "kf_x", min: 4.2845, max: 4.2852, label: "Round 2: the mean is 4.2848 ft" },
        { kind: "var", name: "kf_p", min: 0.1393, max: 0.1395, label: "Round 2: the variance is 0.1394" },
      ],
      watch: ["x1", "p1", "kf_k", "kf_x", "kf_p"],
      hints: [
        "kf_predict is two lines, each one an addition.",
        "kf_update is three lines, in this order: gain, mean, variance.",
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
      refs: [{ course: "HW6" }, { course: "L20-21" }],
      brief: `
This is HW6 in one dimension. The robot drives along the x axis at about 1 ft/s. It has two sources of information, and each has a problem:

- **Dead reckoning** from the wheel speeds, every 1 ms. Smooth, but it only measures **change**. The robot was put down 2 ft away from where the code thinks it starts, and dead reckoning will never notice.
- **Position fixes** (the OptiTrack cameras of the lab; here \`tb_gps_x()\`), 100 times a second. They know where the robot really is, but each one is off by about 0.2 ft, at random.

The Kalman filter uses each for what it is good at.

## What to do
In the interrupt function:

1. **Every call**: predict. The robot moved \`v * 0.001\` ft since the last call. Use the process noise \`Q\`.
2. **Only when a new fix has arrived**: update. \`tb_gps_new()\` returns 1 once for every new fix. Read it with \`tb_gps_x()\` into \`z\` and use the measurement noise \`R\`.

\`R\` is the variance of a fix: 0.2 x 0.2 = 0.04. \`Q\` is the variance one millisecond of dead reckoning adds: tiny. The filter starts with \`kf_p = 100\`: "I have no idea where I am".

## What to look for
The first fix pulls the estimate almost all the way to the truth, because the filter is so unsure. After that the gain falls, and the estimate becomes several times more accurate than any single fix.

This is also what tuning Q and R in HW6 means. A larger R (or smaller Q) trusts the fixes less: smoother, slower to correct. A smaller R trusts them more: the estimate jumps around with them.
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
        { kind: "signal", name: "TB_EST_ERR_FT", at: 100, max: 0.3, label: "After 0.1 s the estimate has found the robot (it started 2 ft off)", hint: "Still 2 ft off: the update never runs. Call kf_update when tb_gps_new() returns 1." },
        { kind: "signal", name: "TB_GPS_RMS_FT", min: 0.15, label: "The raw fixes are off by about 0.2 ft" },
        { kind: "signal", name: "TB_EST_RMS_FT", max: 0.06, label: "From 2 s on, the estimate is off by less than 0.06 ft: several times better than a fix", hint: "About 0.2 ft: the estimate just follows the fixes. Predict on every call with v * 0.001, and update with R, not with 0." },
        { kind: "var", name: "kf_p", max: 0.005, label: "The filter knows it is sure: the variance is below 0.005" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 5990, label: "The filter runs every millisecond" },
      ],
      watch: ["v", "z", "kf_x", "kf_p", "kf_k"],
      hints: [
        "The predict call needs the distance moved in one call: speed times 0.001 s.",
        "`kf_predict(v * 0.001, Q);`",
        "`if (tb_gps_new()) { z = tb_gps_x(); kf_update(z, R); }`",
      ],
      takeaway: "Fast, smooth, drifting dead reckoning plus slow, noisy, absolute fixes give an estimate better than both. The robot's real filter does this for x, y and theta at once, with 3 x 3 matrices in place of these single numbers. A Kalman filter is the best possible blend only when the system is linear and the noise is Gaussian; otherwise it is still a good one.",
    },
    {
      id: "loc-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: drive a square",
      goal: "Drive a 2 ft square with closed-loop speed control, steering by your own dead-reckoned pose, and come back to the start.",
      refs: [{ course: "L15" }, { course: "Lab 5" }, { course: "L11" }],
      brief: `
Put the two chapters together. The robot starts at the origin, heading 0. Drive a square with **2 ft sides, turning left** at each corner, and stop where you started, facing the way you started.

## What you have
\`speed_control(vref, turn)\` is the checkpoint of chapter 16: two PI loops with the steering coupling. Call it once in every interrupt. \`vref\` is the forward speed. \`turn\` is the wanted \`vLeft - vRight\`, so a **negative** \`turn\` turns the robot **left** (heading increases).

## What to write
1. **Dead reckoning** from the wheel speeds, as before. Keep \`theta\` wrapped to -PI ... PI, and report the pose with \`tb_report_pose(x, y, theta)\`.
2. **A state machine** with two states, repeated four times:
   - *Drive a side*: \`vref = 1.0\` until the robot is 2 ft from the corner where the side started.
   - *Turn*: \`vref = 0\` and turn left until the heading reaches the next side's direction (the previous one plus PI / 2, wrapped). Then count the corner in \`corners\`.
3. When \`corners\` reaches 4: \`vref = 0\`, \`turn = 0\`.

## Steering towards a heading
Do not just switch the turn on and off. Steer in proportion to the heading error, in **both** states:

\`\`\`c
eTheta = thetaGoal - theta;      // then wrap eTheta to -PI ... PI
turn = -2.0 * eTheta;            // limit it to -0.6 ... 0.6
\`\`\`

While driving a side this holds the robot on the side's direction. In the corner it turns the robot and slows down smoothly as it gets there. Call the turn finished when the error is below 0.02 rad.

The heading error must be wrapped: at the last corner the goal is 2 PI wrapped to 0, while \`theta\` comes from about -PI / 2.

## The test
At the end (20 s) the robot must be stopped within 0.2 ft of the origin, heading within 0.1 rad of 0, and your own estimate must agree with the true pose within 0.05 ft.
${BENCH}`,
      kit: "robot",
      durationMs: 20000,
      starter: prog(
        SQUARE_GLOBALS,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning: theta (wrapped), x, y

    tb_report_pose(x, y, theta);

    // State machine: drive a side, turn left, four times. It sets vref and turn.

    speed_control(vref, turn);`,
        { functions: SPEED_CONTROL },
      ),
      solution: prog(
        `${SQUARE_GLOBALS}
float thetaGoal = 0;  // direction of the current side, rad
float eTheta = 0;     // heading error, rad
float x0 = 0;         // corner where the current side started
float y0 = 0;
int turning = 0;      // 0: driving a side, 1: turning at a corner`,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning: theta (wrapped), x, y
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    if (theta > PI) theta = theta - 2.0 * PI;
    if (theta < -PI) theta = theta + 2.0 * PI;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

    tb_report_pose(x, y, theta);

    // State machine: drive a side, turn left, four times. It sets vref and turn.
    eTheta = thetaGoal - theta;
    if (eTheta > PI) eTheta = eTheta - 2.0 * PI;
    if (eTheta < -PI) eTheta = eTheta + 2.0 * PI;
    turn = -2.0 * eTheta;
    if (turn > 0.6) turn = 0.6;
    if (turn < -0.6) turn = -0.6;

    if (corners >= 4) {
        vref = 0.0;
        turn = 0.0;
    } else if (turning == 0) {
        vref = 1.0;
        if (sqrt((x - x0) * (x - x0) + (y - y0) * (y - y0)) >= 2.0) {
            turning = 1;
            thetaGoal = thetaGoal + PI / 2.0;
            if (thetaGoal > PI) thetaGoal = thetaGoal - 2.0 * PI;
        }
    } else {
        vref = 0.0;
        if (fabs(eTheta) < 0.02) {
            turning = 0;
            corners++;
            x0 = x;
            y0 = y;
        }
    }

    speed_control(vref, turn);`,
        { functions: SPEED_CONTROL },
      ),
      checks: [
        { kind: "signal", name: "TB_VLEFT_PEAK", min: 0.9, label: "The robot drove at about 1 ft/s" },
        { kind: "var", name: "corners", equals: 4, label: "Four corners were turned" },
        { kind: "signal", name: "TB_X_FT", min: -0.2, max: 0.2, label: "Back at the start: x within 0.2 ft of 0", hint: "Sides of 2 ft, measured from the corner where each side started." },
        { kind: "signal", name: "TB_Y_FT", min: -0.2, max: 0.2, label: "Back at the start: y within 0.2 ft of 0", hint: "Turn left: the heading goal grows by PI / 2 at each corner, and a left turn needs a negative turn." },
        { kind: "signal", name: "TB_THETA_RAD", min: -0.1, max: 0.1, label: "Facing the starting direction again (within 0.1 rad)" },
        { kind: "signal", name: "TB_VLEFT", min: -0.02, max: 0.02, label: "The robot has stopped" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.05, label: "Your pose estimate agrees with the truth within 0.05 ft" },
      ],
      bonus: [
        { kind: "signal", name: "TB_X_FT", min: -0.05, max: 0.05, label: "x within 0.05 ft of the start" },
        { kind: "signal", name: "TB_Y_FT", min: -0.05, max: 0.05, label: "y within 0.05 ft of the start" },
      ],
      watch: ["x", "y", "theta", "corners", "vref", "turn"],
      hints: [
        "Get the dead reckoning right first: with vref = 1 and turn = 0 your x must match the 'Robot x' meter.",
        "Keep the direction of the current side in a global, thetaGoal, and the corner where the side started in x0, y0. Distance driven: sqrt((x - x0) * (x - x0) + (y - y0) * (y - y0)).",
        "Compute eTheta (wrapped) and turn = -2.0 * eTheta (limited to +-0.6) on every call. Driving: vref = 1.0 until the distance is 2.0, then add PI / 2 to thetaGoal. Turning: vref = 0 until fabs(eTheta) < 0.02, then corners++ and store x0, y0.",
      ],
      takeaway: "Speed control below, pose estimate beside it, a state machine on top: this is the shape of the robot's whole navigation code. The final project swaps the square for way points and adds the Kalman filter to keep the pose honest.",
    },
    {
      id: "loc-inverse",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Practice: world_to_body()",
      goal: "Write the inverse transform: where is a point of the room, seen from the robot?",
      refs: [{ course: "HW4" }, { course: "L15" }],
      brief: `
The robot knows a way point in world coordinates and wants to know: is it ahead of me or behind, on my left or on my right? That is the inverse transform of HW4.

Write \`world_to_body(xw, yw, rx, ry, rphi, &xb, &yb)\` for a robot at (rx, ry) with heading \`rphi\` (radians):

1. Subtract the robot's position: dx = xw - rx, dy = yw - ry.
2. Rotate back by the heading:
   - xb = dx cos(rphi) + dy sin(rphi)
   - yb = -dx sin(rphi) + dy cos(rphi)

Then, in \`main\`, set \`ball_on_left\` to 1 if the first ball is on the robot's left and to 0 if it is on its right. In the robot frame positive y is to the left.

\`main\` calls the function for an easy case and for HW4's second golf ball, whose x in the robot frame the homework gives as a check: 3.8482.
`,
      kit: "robot",
      durationMs: 2,
      starter: `#define PI 3.14159265

float ax = 0;         // results
float ay = 0;
float ballx = 0;
float bally = 0;
int ball_on_left = -1;

// Point (xw, yw) in the world frame -> robot frame, for a robot at (rx, ry) heading rphi.
void world_to_body(float xw, float yw, float rx, float ry, float rphi, float *xb, float *yb)
{

}

void main(void)
{
    // A robot at (1, 2) looking along world y, and a ball at (3, 5)
    world_to_body(3.0, 5.0, 1.0, 2.0, 90.0 * PI / 180.0, &ax, &ay);
    // ball_on_left = 1 if that ball is on the robot's left, 0 if it is on its right

    // HW4: the second golf ball
    world_to_body(2.54, 1.45, 5.3, -1.4, 120.0 * PI / 180.0, &ballx, &bally);

    while (1) {}
}
`,
      solution: `#define PI 3.14159265

float ax = 0;         // results
float ay = 0;
float ballx = 0;
float bally = 0;
int ball_on_left = -1;

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
    // ball_on_left = 1 if that ball is on the robot's left, 0 if it is on its right
    if (ay > 0.0) {
        ball_on_left = 1;
    } else {
        ball_on_left = 0;
    }

    // HW4: the second golf ball
    world_to_body(2.54, 1.45, 5.3, -1.4, 120.0 * PI / 180.0, &ballx, &bally);

    while (1) {}
}
`,
      checks: [
        { kind: "var", name: "ax", min: 2.999, max: 3.001, label: "Easy case: the ball is 3 ft ahead (x = 3)", hint: "Subtract the robot's position before you rotate." },
        { kind: "var", name: "ay", min: -2.001, max: -1.999, label: "Easy case: y = -2", hint: "+2 means the rotation goes the wrong way: yb = -dx sin + dy cos." },
        { kind: "var", name: "ball_on_left", equals: 0, label: "That ball is on the robot's right", hint: "Positive y in the robot frame is the left side." },
        { kind: "var", name: "ballx", min: 3.8477, max: 3.8487, label: "HW4's second golf ball: x = 3.8482 in the robot frame" },
      ],
      watch: ["ax", "ay", "ball_on_left", "ballx"],
      hints: [
        "Two local floats for dx and dy make the two formulas easy to read.",
        "`*xb = dx * cos(rphi) + dy * sin(rphi);`",
        "`*yb = -dx * sin(rphi) + dy * cos(rphi);` and in main `if (ay > 0.0) ball_on_left = 1; else ball_on_left = 0;`",
      ],
      takeaway: "Subtract, then rotate back. The sign of the robot-frame y tells left from right, and atan2(yb, xb) is the angle the robot would have to turn to face the point.",
    },
    {
      id: "loc-trap",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Practice: rectangle or trapezoid",
      goal: "Make dead reckoning accurate at a slow sample rate by replacing the rectangle rule with the trapezoid rule.",
      refs: [{ course: "L15" }, { course: "Lab 5" }],
      brief: `
To save processor time, someone slowed the dead-reckoning interrupt from 1 ms to **20 ms**. The code is the one you wrote, with the new time step \`DT = 0.02\`. The position estimate is now off by more than a hundredth of a foot after one short drive, a hundred times more than before, and it gets worse with every turn.

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

Try it in the figure: pick a 100 ms time step on a tight turn and switch between the two rules.

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
      id: "loc-goto",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: go to a point",
      goal: "Drive the robot to a target position: turn to face it, drive there, stop, within 7.5 seconds.",
      refs: [{ course: "L15" }, { course: "Lab 5" }, { course: "HW4" }],
      brief: `
The robot stands at **(1, 1) ft with heading 2.8 rad**. Drive it to the target **(-1.0, -1.5) ft** and stop there, in at most 7.5 s.

You get \`speed_control(vref, turn)\` (a negative \`turn\` turns left) and the wheel speeds. Everything else is yours: dead reckoning from the given start pose, the direction to the target, the heading error, a small state machine (turn to face the target, drive, stop), and \`tb_report_pose(x, y, theta)\` on every call.

## Things that will bite
- The direction to the target is \`atan2(dy, dx)\`, with dx and dy from the robot to the target.
- From this start, the target is behind the robot and to its left, on the far side of the +-PI line. An unwrapped heading error says "turn right by 5 rad". The right answer is "turn left by 1.2 rad". There is no time for the long way round.
- Close to the target \`atan2\` of two tiny numbers swings wildly. Stop caring about the direction when you are close: declare victory inside a small radius and stop.
- A robot arriving at full speed overshoots. Slow down as the distance shrinks.
- Speeds: at most 1 ft/s forward and a \`turn\` of at most 0.6 in size.

## The test
At 7.5 s: stopped, within 0.1 ft of the target, with a pose estimate within 0.05 ft of the truth.
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
float eTheta = 0;     // heading error, rad`,
        `
    vLeft = tb_left_speed();
    vRight = tb_right_speed();

    // Dead reckoning, direction and distance to the target, state machine
    theta = theta + (vRight - vLeft) / WHEEL_BASE * 0.001;
    if (theta > PI) theta = theta - 2.0 * PI;
    if (theta < -PI) theta = theta + 2.0 * PI;
    x = x + 0.5 * (vLeft + vRight) * cos(theta) * 0.001;
    y = y + 0.5 * (vLeft + vRight) * sin(theta) * 0.001;

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
    speed_control(vref, turn);`,
        { functions: SPEED_CONTROL },
      ),
      checks: [
        { kind: "signal", name: "TB_X_FT", min: -1.1, max: -0.9, label: "x within 0.1 ft of the target (-1.0)", hint: "Not there yet: did the robot turn the long way round? Wrap the heading error to -PI ... PI." },
        { kind: "signal", name: "TB_Y_FT", min: -1.6, max: -1.4, label: "y within 0.1 ft of the target (-1.5)" },
        { kind: "signal", name: "TB_VLEFT", min: -0.02, max: 0.02, label: "The left wheel has stopped", hint: "Spinning near the target: stop steering once you are inside a small radius." },
        { kind: "signal", name: "TB_VRIGHT", min: -0.02, max: 0.02, label: "The right wheel has stopped" },
        { kind: "signal", name: "TB_EST_ERR_FT", max: 0.05, label: "Your pose estimate agrees with the truth within 0.05 ft", hint: "The dead reckoning starts from (1, 1) and 2.8 rad, not from zero." },
      ],
      bonus: [
        { kind: "signal", name: "TB_VLEFT", at: 6000, min: -0.02, max: 0.02, label: "Arrived and stopped within 6 s" },
        { kind: "signal", name: "TB_EST_ERR_FT", at: 6000, max: 0.05, label: "... with a good pose estimate" },
      ],
      watch: ["x", "y", "theta", "state", "vref", "turn"],
      hints: [
        "Compute three things on every call: the distance to the target, the direction atan2(yGoal - y, xGoal - x), and the heading error (direction minus theta, wrapped).",
        "Steer with turn = -2.0 * eTheta, limited to +-0.6, in the turning state and in the driving state.",
        "Driving: vref = 3.0 * dist, limited to 1.0, until dist < 0.04. Then vref = 0 and turn = 0.",
      ],
      takeaway: "A go-to-point controller is two proportional controllers (heading and distance) and a wrap. The robot's xy_control function is the same idea with a few more guards.",
    },
    {
      id: "loc-kf2",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Expert: a Kalman filter with two states",
      goal: "Estimate position and velocity from position fixes alone, with the matrix equations written out by hand.",
      refs: [{ course: "L20-21" }, { course: "HW6" }],
      brief: `
Now there are no wheel speeds: the only sensor is the position fix, 100 times a second, off by about 0.1 ft each time. Estimate **two** things from it: the position and the **velocity**. Dividing the difference of two fixes by 0.01 s would give a velocity that is off by more than 10 ft/s. The filter does far better.

## The model
State: position p and velocity v. In one step of length dt the position grows by v dt and the velocity stays (plus something unknown, the process noise qv on the velocity):

F = [1 dt; 0 1], H = [1 0] (only the position is measured), Q = [0 0; 0 qv], R = r

## The equations (HW6), written out
Write the covariance matrix P as four floats: \`P00\`, \`P01\`, \`P10\`, \`P11\`. No matrix library.

**Predict** (x = F x, P = F P F' + Q):
- pos = pos + vel dt
- P00 = P00 + dt (P01 + P10) + dt dt P11
- P01 = P01 + dt P11
- P10 = P10 + dt P11
- P11 = P11 + qv

**Update** (S = H P H' + R, K = P H' / S, x = x + K (z - H x), P = (I - K H) P):
- S = P00 + r
- K0 = P00 / S, K1 = P10 / S
- with e = z - pos: pos = pos + K0 e, vel = vel + K1 e
- P00 = (1 - K0) P00, P01 = (1 - K0) P01, P10 = P10 - K1 P00, P11 = P11 - K1 P01

Careful: every right-hand side uses the values from **before** the step. Assigning in the wrong order silently uses a new value where an old one belongs. Copy what you still need into local variables first.

## What to build
- \`kf2_predict(dt, qv)\` and \`kf2_update(z, r)\` on the globals \`kf_pos\`, \`kf_vel\`, \`P00\` ... \`P11\`.
- In the interrupt: when \`tb_gps_new()\` is 1, read the fix into \`z\`, predict with dt = 0.01 and \`QV\`, update with \`R\`. Then report \`tb_report_pose(kf_pos, 0.0, 0.0)\`.

\`main\` first runs a self-test with round numbers (P = identity, dt = 1, qv = 0.5, z = 3, r = 2). By hand: after the predict P = [2 1; 1 1.5]; after the update pos = 1.5, vel = 0.75 and P = [1 0.5; 0.5 1.25].

The robot then drives at 1 ft/s for 3 s and at 2 ft/s after that. Your velocity estimate must follow.
${BENCH}
- \`tb_gps_new()\`: 1 once per new fix. \`tb_gps_x()\`: the latest fix, ft.
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
  ],
};
