import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import { ERR_NOTHING, ERR_TOO_CLOSE, G_COMMAND, LIDAR_POINTS, ROOMS, castRay, dataLines, encode, gReply, pointDeg, reading, scan } from "../src/sim/plugins/lidar";

// The receive state machine of the course (RXCINT_recv_ready in
// F28379dSerial.c, FinalProjectwithCANAprilStarter), without the ping-pong
// buffers: the simulated sensor must produce exactly what it accepts.
const COURSE = `
char G_command[] = "G04472503\\n";
uint16_t G_len = 11;
uint16_t read_ladar_state = 0;
uint16_t G_count = 0;
uint16_t LF_count = 0;
uint16_t get_dis_first = 1;
uint16_t dis_index = 0;
uint16_t tempscid = 0;
uint16_t distance = 0;
uint16_t ladar_mm[228];
uint16_t scans = 0;
uint16_t print_dis_index = 0;
uint16_t printed = 0;

__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
    CpuTimer1.InterruptCount++;
}

__interrupt void RXCINT_recv_ready(void)
{
    RXCdata = ScicRegs.SCIRXBUF.all;
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
            G_count += 1;
            if (G_count == 11) {
                if (RXCdata != '0') {
                    read_ladar_state = 0;
                }
            }
            if (G_count >= 12) {
                read_ladar_state = 2;
                get_dis_first = 1;
                dis_index = 0;
            }
        } else if (read_ladar_state == 2) {
            if (RXCdata == 0x0a) {
                LF_count += 1;
            } else {
                LF_count = 0;
                if (get_dis_first == 1) {
                    tempscid = (RXCdata - 0x30) << 6;
                    get_dis_first = 0;
                } else if (get_dis_first == 0) {
                    distance = tempscid + (RXCdata - 0x30);
                    if (distance == 0 || distance == 6) {
                        distance = LADAR_MAX_READING;
                    }
                    ladar_mm[dis_index] = distance;
                    dis_index += 1;
                    get_dis_first = 1;
                }
            }
            if (LF_count == 2) {
                read_ladar_state = 0;
                print_dis_index = dis_index;
                scans++;
            }
        }
        numRXC ++;
    }
    ScicRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
`;

const main = (baud: number, body = "") => `${COURSE}
void main(void)
{
    uint16_t i;
    InitSysCtrl();
    InitGpio();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, 200, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;
    init_serialSCIC(&SerialC, ${baud});
${body}
    IER |= M_INT8;
    IER |= M_INT13;
    EINT;
    while (1) {
        if (scans == 2 && printed == 0) {
            printed = 1;
            for (i = 0; i < 228; i++) printf("%u ", ladar_mm[i]);
        }
    }
}
`;

const stored = (mm: number[]) => mm.map((v) => (v === 0 || v === 6 ? 5700 : v));

describe("LIDAR plugin: the world", () => {
  it("places the points as the course's angle formula does", () => {
    expect(pointDeg(0)).toBeCloseTo(-119.53125, 6);
    expect(pointDeg(28)).toBeCloseTo(-90, 9);
    expect(pointDeg(113)).toBeCloseTo(-0.3515625, 9);
    expect(pointDeg(227)).toBeCloseTo(119.8828125, 6);
    expect(scan({ room: 0, x: 5, y: 5, theta: 0 })).toHaveLength(LIDAR_POINTS);
  });

  it("casts rays to the walls and reports millimetres", () => {
    expect(castRay(ROOMS[0], 5, 5, 0)).toBeCloseTo(5, 9);
    expect(castRay(ROOMS[0], 2, 5, Math.PI / 2)).toBeCloseTo(5, 9);
    expect(castRay(ROOMS[2], 0, 0, Math.PI / 2)).toBe(Infinity);
    const s = scan({ room: 0, x: 5, y: 5, theta: 0 });
    // 5 ft = 1524 mm straight ahead (point 113 is 0.35 degrees to the right).
    expect(s[113]).toBe(1524);
    expect(s[28]).toBe(1524);
    // Turning the robot left by 90 degrees puts the wall x = 10 on its right.
    const t = scan({ room: 0, x: 8, y: 5, theta: Math.PI / 2 });
    expect(t[28]).toBe(Math.round(2 * 304.8));
    expect(t[113]).toBe(1524);
    // The obstacle of room 3 is nearer than the wall behind it.
    expect(Math.min(...scan({ room: 3, x: 5, y: 5, theta: 0 }))).toBeLessThan(Math.min(...s));
  });

  it("reports error codes instead of distances outside 20 to 4095 mm", () => {
    expect(reading(4095 / 304.8)).toBe(4095);
    expect(reading(4096.6 / 304.8)).toBe(ERR_NOTHING);
    expect(reading(Infinity)).toBe(ERR_NOTHING);
    expect(reading(0.05)).toBe(ERR_TOO_CLOSE);
    expect(reading(20 / 304.8)).toBe(20);
    // In the corridor the far wall is 30 ft away: nothing straight ahead.
    const s = scan({ room: 1, x: 0, y: 0, theta: 0 });
    expect(s[113]).toBe(ERR_NOTHING);
    expect(s[28]).toBe(457);
    // The doorway of room 4 is a run of "nothing" between two pieces of wall.
    const d = scan({ room: 4, x: 5, y: 5, theta: 0 });
    const gap = d.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    expect(gap.length).toBeGreaterThan(10);
    expect(gap[gap.length - 1] - gap[0]).toBe(gap.length - 1);
    expect(pointDeg(gap[0])).toBeGreaterThan(11);
    expect(pointDeg(gap[gap.length - 1])).toBeLessThan(35);
  });

  it("encodes 12 bits as two characters of 6 bits plus 0x30", () => {
    expect(encode(1907)).toBe("Mc");
    expect(encode(0)).toBe("00");
    expect(encode(4095)).toBe("oo");
    const mm = scan({ room: 0, x: 5, y: 5, theta: 0 });
    const lines = dataLines(mm);
    expect(lines).toHaveLength(8);
    expect(lines.slice(0, 7).every((l) => l.length === 64)).toBe(true);
    expect(lines[7]).toHaveLength(8);
    const r = gReply(G_COMMAND, mm);
    expect(r).toHaveLength(477);
    expect(r.startsWith("G04472503\n0\n")).toBe(true);
    expect(r.endsWith("\n\n")).toBe(true);
  });
});

describe("LIDAR plugin: the device on SCIC", () => {
  const stimuli: Stimulus[] = [
    { at: 0, set: "LIDAR_ROOM", value: 3 },
    { at: 0, set: "LIDAR_X_FT", value: 4 },
    { at: 0, set: "LIDAR_Y_FT", value: 6.2 },
    { at: 0, set: "LIDAR_THETA_RAD", value: 0.4 },
  ];

  it("answers the course's G command with a reply the course's parser accepts", () => {
    const r = runProgram({ kit: "robot", durationMs: 260, source: main(115200), stimuli });
    expect(r.compileError).toBeUndefined();
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    const b = r.board;
    expect(b.readVar("scans")).toBe(2);
    expect(b.readVar("print_dis_index")).toBe(228);
    expect(b.readVar("numRXC")).toBe(2 * 477);
    const truth = scan({ room: 3, x: 4, y: 6.2, theta: 0.4 });
    expect(r.console.trim().split(" ").map(Number)).toEqual(stored(truth));
    expect(b.output("LIDAR_SCANS")).toBe(2);
    // 477 characters at 115200 baud take 41.4 ms.
    const rx = b.sci.rx[2];
    expect((rx[476].t - rx[0].t) / 1e6).toBeCloseTo((476 * 10 * 1000) / 115200, 2);
    expect(String.fromCharCode(...rx.slice(0, 477).map((x) => x.ch))).toBe(gReply(G_COMMAND, truth));
  });

  it("measures the pose at the time of each command", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 260,
      source: main(115200),
      stimuli: [{ at: 150, set: "LIDAR_X_FT", value: 8 }],
    });
    // Room 0, default pose (5, 5, 0) for scan 1, x = 8 for scan 2.
    expect(r.console.trim().split(" ").map(Number)).toEqual(stored(scan({ room: 0, x: 8, y: 5, theta: 0 })));
    expect(r.board.output("LIDAR_FRONT_FT", 120e6)).toBeCloseTo(5, 1);
    expect(r.board.output("LIDAR_FRONT_FT")).toBeCloseTo(2, 1);
  });

  it("ignores commands sent at the wrong baud rate and says why", () => {
    const r = runProgram({ kit: "robot", durationMs: 160, source: main(19200) });
    expect(r.board.readVar("numRXC")).toBe(0);
    expect(r.diagnostics.map((d) => d.code)).toContain("lidar-baud");
  });

  it("starts at LIDAR_BAUD and changes its rate with the S command, as the course does", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 1300,
      stimuli: [{ at: 0, set: "LIDAR_BAUD", value: 19200 }],
      source: main(
        19200,
        `    serial_sendSCIC(&SerialC, "S1152000124000\\n", 15);
    DELAY_US(1000000);
    init_serialSCIC(&SerialC, 115200);`,
      ),
    });
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    // Timer 1 is first served when interrupts are enabled, about 1 s in.
    expect(r.board.readVar("scans")).toBeGreaterThanOrEqual(2);
    expect(r.board.readVar("print_dis_index")).toBe(228);
  });

  it("refuses a malformed request with status 1 and loses a character on request", () => {
    const bad = runProgram({ kit: "robot", durationMs: 160, source: main(115200).replace("G04472503", "G72504403") });
    expect(bad.board.readVar("scans")).toBe(0);
    expect(bad.board.readVar("numRXC")).toBe(13);
    expect(bad.diagnostics.map((d) => d.code)).toContain("lidar-command");
    const drop = runProgram({ kit: "robot", durationMs: 260, source: main(115200), stimuli: [{ at: 50, set: "LIDAR_DROP_CHAR", value: 100 }] });
    expect(drop.board.readVar("numRXC")).toBe(2 * 477 - 1);
  });

  it("gives the same readings through the tb_ natives", () => {
    const truth = scan({ room: 3, x: 4, y: 6.2, theta: 0.4 });
    const r = runProgram({
      kit: "robot",
      durationMs: 5,
      stimuli,
      source: `void main(void) {
  int i;
  DELAY_US(1000);
  for (i = 0; i < 228; i++) printf("%d ", tb_lidar_mm(i));
  printf("| %.4f %.4f %.3f %.3f %.3f", tb_lidar_ft(113), tb_lidar_ft(0), tb_pose_x(), tb_pose_y(), tb_pose_theta());
  while (1) {}
}`,
    });
    expect(r.runtimeError).toBeUndefined();
    const [points, rest] = r.console.split("|");
    expect(points.trim().split(" ").map(Number)).toEqual(truth);
    const want = [truth[113], truth[0]].map((v) => ((v < 20 ? 5700 : v) * 0.00328084).toFixed(4));
    expect(rest.trim()).toBe(`${want[0]} ${want[1]} 4.000 6.200 0.400`);
    const out = runProgram({ kit: "robot", durationMs: 1, source: `void main(void) { float d = tb_lidar_ft(228); while (1) {} }` });
    expect(out.runtimeError?.msg).toContain("points 0 to 227");
  });
});

describe("LIDAR plugin: rays aimed at corners", () => {
  it("never slip out between two walls that meet (rounding at the very end of a wall)", () => {
    // From these points the ray to the corner missed both walls by one rounding step.
    const cases: [number, number, number, number, number][] = [
      [0, 0.6953802300600344, 1.521891429559942, 0, 0],
      [0, 2.591636157500011, 3.6251410949998872, 0, 10],
      [0, 3.8128317641800806, 9.385561412680014, 10, 10],
      [1, 17.859129706879997, 1.2906304765199808, 30, 1.5],
      [1, -0.6972959557758167, 0.046433164595973214, -2, 1.5],
    ];
    for (const [room, x, y, cx, cy] of cases) expect(castRay(ROOMS[room], x, y, Math.atan2(cy - y, cx - x))).toBeCloseTo(Math.hypot(cx - x, cy - y), 9);
    // And on a sweep: in a closed room every ray ends on a wall, no farther than the corner it is aimed at.
    for (const room of [ROOMS[0], ROOMS[1], ROOMS[3]]) {
      const [x0, y0, x1, y1] = room.bounds;
      const corners = room.walls.flatMap((s) => [[s[0], s[1]], [s[2], s[3]]]);
      for (let i = 0; i < 300; i++) {
        const x = x0 + (x1 - x0) * (0.01 + 0.98 * ((i * 0.6180339887) % 1));
        const y = y0 + (y1 - y0) * (0.01 + 0.98 * ((i * 0.7548776662) % 1));
        for (const [cx, cy] of corners) {
          const d = castRay(room, x, y, Math.atan2(cy - y, cx - x));
          if (!(d <= Math.hypot(cx - x, cy - y) + 1e-9)) throw new Error(`${room.name}: the ray from (${x}, ${y}) to the corner (${cx}, ${cy}) went ${d} ft`);
        }
      }
    }
  });
});
