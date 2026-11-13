// What a student can do after the core path of each chapter, in one line
// (shown on the map when the chapter is finished). A chapter without an
// entry falls back to its blurb.
const OUTCOMES: Record<string, string> = {
  "primer-circuits": "read a simple circuit: voltage, current, resistors, LEDs, push buttons and logic signals.",
  "primer-c": "write small C programs with variables, decisions, loops and functions.",
  "primer-c-hardware": "use arrays, pointers and structs, the way C reaches a register.",
  bits: "move between hex, binary and decimal, and set, clear and test bits with masks.",
  registers: "find a register and its fields, write it with .all or .bit, and unlock it with EALLOW.",
  outputs: "set a pin's mux and direction and drive LEDs with SET, CLEAR and TOGGLE.",
  inputs: "read push buttons through GPxDAT with pull-ups, without reading noise.",
  timers: "set a CPU timer's period and prescaler and blink at an exact rate without DELAY_US.",
  interrupts: "bring an interrupt from a timer flag to your function through PIE, IER, EINT and PIEACK.",
  serial: "print to the terminal, react to typed keys, and read a UART frame bit by bit.",
  dac: "turn a number into a voltage with the 12-bit DAC and setDACA.",
  adc: "sample a voltage: set up the SOC chain and convert the result back to volts.",
  pwm: "set a PWM's time base, period and compare value for a given frequency and duty cycle.",
  actuators: "drive a motor through an H-bridge, position an RC servo and sound the buzzer.",
  encoders: "read quadrature with the eQEP counter and turn counts into wheel angle and speed.",
  spi: "run an SPI transfer: clock mode, chip select, and a word back for every word sent.",
  "spi-devices": "read the MPU-9250's gyro and accelerometer and share the port with the DAN28027.",
  buses: "talk on shared buses: I2C addresses and acknowledges, CAN frames and arbitration.",
  "dma-filters": "collect samples with DMA ping-pong buffers and smooth them with an FIR filter.",
  control: "close a PI speed loop with anti-windup, friction compensation and steering.",
  sensors: "range with infrared and LIDAR and follow a wall with a state machine.",
  localization: "keep track of where the robot is: transforms, dead reckoning, a Kalman filter and move-to-XY.",
  "vision-planning": "find a coloured blob and its centroid, and plan a path with BFS and A* on an occupancy grid.",
  threads: "share data between threads safely: races, locks and producer-consumer buffers.",
  capstone: "put it all together: your own program drives the robot across a room.",
};

/** One line that completes "You can now ...", or the chapter's blurb as its own sentence. */
export function outcomeOf(c: { id: string; blurb: string }): string {
  const o = OUTCOMES[c.id];
  return o ? `You can now ${o}` : c.blurb;
}
