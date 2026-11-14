// The Sandbox's "Robot arena" starting program for the robot board: the
// robot drives a circle in a room, so the arena's playground has something
// to show. Open loop on purpose: no speed control, no pose, no goal. Those
// are what the levels and the labs have the student write.
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "arena",
  label: "Robot arena",
  kit: "robot",
  about:
    "The robot drives a circle with a fixed power on each motor and the LCD shows how far each wheel has turned: change the two powers, drag the robot in the Robot arena panel, or put a box in its way.",
  watch: ["LeftWheel", "RightWheel", "leftPower", "rightPower"],
  // The robot stands in the middle of the room with the obstacle.
  stimuli: [
    { at: 0, set: "LIDAR_ROOM", value: 3 },
    { at: 0, set: "ROBOT_START_X_FT", value: 5 },
    { at: 0, set: "ROBOT_START_Y_FT", value: 3 },
    { at: 0, set: "ROBOT_START_THETA_RAD", value: 0 },
    { at: 0, set: "ROBOT_WORLD", value: 1 },
  ],
  source: String.raw`// Robot arena: drive a circle.
// Each motor gets a fixed power. The left wheel gets less than the right
// one, so the robot curves to the left. Nothing measures the speed and
// nothing corrects it: this is "open loop" driving.
// The functions used here come from the board's library:
//   init_EPWM1and2()   sets up the two motor outputs, both motors stopped
//   setEPWM1A(power)   left motor, -10 (full backward) to 10 (full forward)
//   setEPWM2A(power)   right motor, mounted the other way round
//   init_eQEPs()       sets up the wheel encoders
//   readEncLeft(), readEncRight()   how far a wheel has turned, in radians

float leftPower = 2.0;    // try other numbers, also negative ones
float rightPower = 3.0;

float LeftWheel = 0;      // wheel angles, radians
float RightWheel = 0;

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();
    InitSE423DefaultGPIO();   // LEDs and push buttons of the robot board

    init_EPWM1and2();
    init_eQEPs();

    while (1) {
        setEPWM1A(leftPower);
        setEPWM2A(-rightPower);   // minus: this motor is mounted the other way round

        LeftWheel = readEncLeft();
        RightWheel = readEncRight();

        // Two lines on the LCD. %.1f prints a float with one decimal.
        UART_printfLine(1, "Left  %.1f rad", LeftWheel);
        UART_printfLine(2, "Right %.1f rad", RightWheel);

        GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;   // red LED: the program is alive
        DELAY_US(200000);                        // five times a second
    }
}
`,
};
