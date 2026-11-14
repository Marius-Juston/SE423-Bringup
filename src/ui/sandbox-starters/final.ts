// The Sandbox's "robot tour" starting program for the robot board: the push
// buttons drive the motors with a fixed power and the LCD shows the wheel
// encoders and the LADAR. Written for this game. Left out on purpose,
// because the labs, the homeworks and the levels have the student write
// them: speed control, steering, the robot's pose, way points, wall
// following, and the code that reads the IMU (SPI) and the CAN distance
// sensors.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "final",
  label: "Robot tour: buttons drive, the LCD shows the sensors",
  kit: "robot",
  about:
    "Hold PB1 to drive forward, PB2 to turn left, PB3 to turn right, PB4 to drive backward; the robot stops when you let go. The LCD shows how far each wheel has turned and the LADAR's distance straight ahead: drive at a wall in the Robot arena panel and watch the distance shrink.",
  watch: ["buttons", "leftPower", "rightPower", "LeftWheel", "RightWheel", "ahead"],
  // The robot stands in a room, so driving moves it and the LADAR sees the walls come closer.
  stimuli: [
    { at: 0, set: "LIDAR_ROOM", value: 3 },
    { at: 0, set: "ROBOT_START_X_FT", value: 3 },
    { at: 0, set: "ROBOT_START_Y_FT", value: 3 },
    { at: 0, set: "ROBOT_START_THETA_RAD", value: 0 },
    { at: 0, set: "ROBOT_WORLD", value: 1 },
  ],
  source: String.raw`// A tour of the robot board: buttons, motors, wheel encoders, LADAR, LCD.
// Ten times a second main() looks at the push buttons, gives each motor a
// fixed power, asks the LADAR for a scan and prints on the LCD.
// The power is "open loop": nothing measures the speed or corrects it, and
// the program does not know where the robot is.
// The functions used here come from the board's library:
//   readbuttons()      one bit per button held: PB1 is 1, PB2 is 2, PB3 is 4, PB4 is 8
//   init_EPWM1and2()   sets up the two motor outputs, both motors stopped
//   setEPWM1A(power)   left motor, -10 (full backward) to 10 (full forward)
//   setEPWM2A(power)   right motor, mounted the other way round
//   init_eQEPs()       sets up the wheel encoders
//   readEncLeft(), readEncRight()   how far a wheel has turned, in radians
//   RXCINT_recv_ready()   reads the LADAR's reply into the array ladar_data

// Kept by the board's library.
extern datapts ladar_data[228];   // distance_ping and distance_pong of each point, in feet
extern char G_command[];          // the request for a scan
extern uint16_t G_len;            // its length
extern uint16_t LADARpingpong;    // which of ping and pong the library fills next

uint16_t buttons = 0;
float leftPower = 0;
float rightPower = 0;
float LeftWheel = 0;    // wheel angles, radians
float RightWheel = 0;
float ahead = 0;        // feet, LADAR point 114: straight ahead

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();
    InitSE423DefaultGPIO();   // LEDs and push buttons of the robot board

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
    init_EPWM1and2();                    // the motors
    init_eQEPs();                        // the wheel encoders

    IER |= M_INT8;   // SCIC
    IER |= M_INT9;   // SCIB

    EINT;   // interrupts on

    while (1) {
        // Buttons to motor powers.
        buttons = readbuttons();
        if (buttons == 1) {          // PB1: forward
            leftPower = 3.0;
            rightPower = 3.0;
        } else if (buttons == 2) {   // PB2: turn left on the spot
            leftPower = -2.0;
            rightPower = 2.0;
        } else if (buttons == 4) {   // PB3: turn right on the spot
            leftPower = 2.0;
            rightPower = -2.0;
        } else if (buttons == 8) {   // PB4: backward
            leftPower = -3.0;
            rightPower = -3.0;
        } else {                     // no button, or several: stop
            leftPower = 0;
            rightPower = 0;
        }
        setEPWM1A(leftPower);
        setEPWM2A(-rightPower);   // minus: this motor is mounted the other way round

        // Ask the LADAR for a scan and wait for it.
        serial_sendSCIC(&SerialC, G_command, G_len);
        DELAY_US(100000);   // 100 ms

        // The newest complete scan is the one the library is not filling.
        if (LADARpingpong == 1) {
            ahead = ladar_data[114].distance_ping;
        } else {
            ahead = ladar_data[114].distance_pong;
        }
        LeftWheel = readEncLeft();
        RightWheel = readEncRight();

        // %.1f prints a float with one decimal.
        UART_printfLine(1, "L %.1f R %.1f", LeftWheel, RightWheel);
        UART_printfLine(2, "Ahead %.2f ft", ahead);
    }
}
`,
};
