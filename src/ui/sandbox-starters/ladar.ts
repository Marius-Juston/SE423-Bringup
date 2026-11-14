// The Sandbox's "LADAR" starting program for the robot board: ask the LADAR
// for scans and show three of its distances on the LCD. The board's library
// reads the reply. Written for this game.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "ladar",
  label: "LADAR distances on the LCD",
  kit: "robot",
  about:
    "Ten times a second the program asks the LADAR for a scan and the LCD shows the distance straight ahead, to the right and to the left, in feet: drag the robot in the Robot arena panel, or put a box in front of it, and watch the numbers.",
  watch: ["ahead", "right", "left", "numScans"],
  // The robot stands in a room, so the LADAR has walls to see and the arena's playground works.
  stimuli: [
    { at: 0, set: "LIDAR_ROOM", value: 3 },
    { at: 0, set: "ROBOT_START_X_FT", value: 4 },
    { at: 0, set: "ROBOT_START_Y_FT", value: 3 },
    { at: 0, set: "ROBOT_START_THETA_RAD", value: 0 },
    { at: 0, set: "ROBOT_WORLD", value: 1 },
  ],
  source: String.raw`// LADAR distances on the LCD.
// The LADAR measures 228 distances over 240 degrees, from the robot's right
// (-120 degrees) round the front to its left (120 degrees).
// The program sends it the request G_command. The reply arrives on the
// serial port SCIC, one character at a time, and the board's library reads
// it: its function RXCINT_recv_ready() stores each distance, in feet, in the
// array ladar_data. This program only asks, waits and looks at three points.
//
// The library stores the scans in turn in distance_ping and distance_pong.
// LADARpingpong says which of the two it fills next, so the other one holds
// the newest complete scan.

// Kept by the board's library.
extern datapts ladar_data[228];   // angle, distance_ping, distance_pong of each point
extern char G_command[];          // the request for points -120 to 120 degrees
extern uint16_t G_len;            // its length
extern uint16_t LADARpingpong;

float ahead = 0;   // feet, point 114: 0 degrees
float right = 0;   // feet, point 28: -90 degrees
float left = 0;    // feet, point 199: 90 degrees
uint32_t numScans = 0;

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // The library's functions for the serial ports of the LCD and the LADAR.
    EALLOW;
    PieVectTable.SCIB_RX_INT = &RXBINT_recv_ready;
    PieVectTable.SCIB_TX_INT = &TXBINT_data_sent;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    PieVectTable.SCIC_TX_INT = &TXCINT_data_sent;
    EDIS;

    init_serialSCIB(&SerialB, 19200);    // the LCD
    init_serialSCIC(&SerialC, 115200);   // the LADAR

    IER |= M_INT8;   // SCIC
    IER |= M_INT9;   // SCIB

    EINT;   // interrupts on

    while (1) {
        // Ask for a scan. The answer takes about 41 ms to arrive.
        serial_sendSCIC(&SerialC, G_command, G_len);
        DELAY_US(100000);   // 100 ms: the LADAR cannot scan faster than that
        numScans++;

        // Read three points of the newest complete scan.
        if (LADARpingpong == 1) {
            ahead = ladar_data[114].distance_ping;
            right = ladar_data[28].distance_ping;
            left = ladar_data[199].distance_ping;
        } else {
            ahead = ladar_data[114].distance_pong;
            right = ladar_data[28].distance_pong;
            left = ladar_data[199].distance_pong;
        }

        // %.2f prints a float with two decimals.
        UART_printfLine(1, "Ahead %.2f ft", ahead);
        UART_printfLine(2, "R %.2f L %.2f", right, left);
    }
}
`,
};
