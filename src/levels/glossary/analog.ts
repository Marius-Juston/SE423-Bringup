import type { GlossaryEntry } from "../types";

// Terms first taught in chapters 7 to 11 (DAC, ADC, PWM, actuators, encoders).
// `level` is the level that explains the term.
export const glossary: GlossaryEntry[] = [
  {
    term: "acquisition window",
    meaning:
      "How long the sampling capacitor stays connected to the pin: (ACQPS + 1) system clock cycles of 5 ns.",
    level: "adc-single",
  },
  {
    term: "Action qualifier (AQCTLA)",
    meaning:
      "The ePWM register that says what the pin does at each counter event: nothing (0), go low (1), go high (2) or toggle (3).",
    level: "pwm-sawtooth",
  },
  {
    term: "ADC (analog-to-digital converter)",
    meaning:
      "The part of the chip that measures the voltage on a pin and gives your program a number.",
    level: "adc-brief",
  },
  {
    term: "Amplifier (motor)",
    meaning:
      "A circuit that takes the weak signal of a pin and switches the strong battery current a motor needs. The pin only tells it what to do.",
    level: "act-brief",
  },
  {
    term: "Analog",
    meaning:
      "A voltage that can take any value in a range, not just high or low. A digital pin has two levels; an analog signal has every level in between.",
    level: "dac-brief",
  },
  {
    term: "backward difference",
    meaning:
      "A way to get speed from positions: (position now - position one sample ago) / time between the samples.",
    level: "enc-speed",
  },
  {
    term: "binary search",
    meaning:
      "Finding a value by always asking about the middle of what is left, so each answer halves the range.",
    level: "adc-sar",
  },
  {
    term: "Buffer",
    meaning:
      "A circuit that copies the voltage at its input to its output and supplies the current itself, so that whatever is connected does not pull the voltage down.",
    level: "dac-brief",
  },
  {
    term: "calibration",
    meaning:
      "Measuring a sensor's own error, such as its offset, so the program can remove it.",
    level: "adc-gyro",
  },
  {
    term: "Carrier frequency",
    meaning:
      "How many PWM cycles happen per second: 1 divided by the period. A period of 100 us is 10 kHz.",
    level: "pwm-brief",
  },
  {
    term: "channel (ADC)",
    meaning:
      "The number of an ADC input pin. Channel 4 of ADCA is the pin ADCINA4.",
    level: "adc-soc",
  },
  {
    term: "CLKDIV",
    meaning:
      "A 3-bit field of TBCTL that slows the ePWM counter. It holds a code, not the divider: the clock is divided by 2 to the power of the code, so 2 means divide by 4 and 5 means divide by 32.",
    level: "act-servo-numbers",
  },
  {
    term: "Clock",
    meaning:
      "A signal inside the chip that ticks at a fixed, known rate. Counting its ticks measures time.",
    level: "pwm-sawtooth",
  },
  {
    term: "Clock divider",
    meaning:
      "A circuit that passes on only every 2nd, 4th ... clock tick, which makes a counter run slower. The ePWM has two: HSPCLKDIV and CLKDIV.",
    level: "pwm-numbers",
  },
  {
    term: "CMPB, EPWMxB",
    meaning:
      "The second output of an ePWM module and its own compare register. A and B share one counter and one period, so they can differ in duty cycle but never in frequency.",
    level: "act-servo-pair",
  },
  {
    term: "comparator",
    meaning:
      "A circuit that only says which of two voltages is the higher one.",
    level: "adc-sar",
  },
  {
    term: "Compare value (CMPA)",
    meaning:
      "A number the ePWM module compares with its counter all the time. When they are equal, the pin can change. With the course's set-up the pin is high for CMPA counts of each period.",
    level: "pwm-sawtooth",
  },
  {
    term: "Control effort",
    meaning:
      "The course's name for a motor command: a number from -10 (full power backward) through 0 (stop) to 10 (full power forward). setEPWM1A and setEPWM2A turn it into a duty cycle.",
    level: "act-numbers",
  },
  {
    term: "Count",
    meaning:
      "One tick of a counter. An ePWM counter with the course's settings ticks at 50 MHz, so one count lasts 20 ns.",
    level: "pwm-numbers",
  },
  {
    term: "count (encoder)",
    meaning:
      "One edge of channel A or B. The robot's encoders give 4 x 500 = 2000 counts per motor turn.",
    level: "enc-math",
  },
  {
    term: "Counter",
    meaning:
      "A register that adds 1 to itself on every clock tick, so its value tells how much time has passed.",
    level: "pwm-sawtooth",
  },
  {
    term: "DAC (digital-to-analog converter)",
    meaning:
      "A circuit that turns a number into a voltage. You write a number to a register and a pin goes to the matching voltage and stays there.",
    level: "dac-brief",
  },
  {
    term: "Data sheet",
    meaning:
      "The manufacturer's document that lists a chip's electrical limits and timings, such as how long the DAC buffer takes to power up.",
    level: "dac-brief",
  },
  {
    term: "Dead time",
    meaning:
      "A short gap in which both transistors of a pair are off, so they can never conduct at the same moment.",
    level: "pwm-x-deadtime",
  },
  {
    term: "Debugger",
    meaning:
      "The tool on the PC that can pause a running program so you can look at its variables and registers.",
    level: "pwm-tbctl",
  },
  {
    term: "Direction input",
    meaning:
      "The input of the robot's motor amplifier that chooses which way round the battery is connected. The course drives it with PWM, so 50 % duty means the motor stands still.",
    level: "act-brief",
  },
  {
    term: "Duty cycle",
    meaning:
      "The fraction of each period that a signal is high: high time divided by period. High for 25 us of every 100 us is 25 %.",
    level: "pwm-brief",
  },
  {
    term: "edge",
    meaning:
      "The moment a digital signal changes level. A rising edge goes from low to high, a falling edge from high to low.",
    level: "enc-brief",
  },
  {
    term: "ePWM",
    meaning:
      "Enhanced PWM: one of the chip's 12 hardware modules that produce PWM signals by themselves once their registers are set.",
    level: "pwm-brief",
  },
  {
    term: "ePWM (as a trigger)",
    meaning:
      "A peripheral built around a counter that runs round and round. For the ADC it is a steady clock that sends a pulse (SOCA) once per round.",
    level: "adc-soc",
  },
  {
    term: "eQEP",
    meaning:
      "Enhanced quadrature encoder pulse module: hardware in the chip that watches channels A and B and keeps the count for you.",
    level: "enc-brief",
  },
  {
    term: "Event trigger (ETSEL, ETPS)",
    meaning:
      "The part of an ePWM module that turns counter events into interrupts or ADC start pulses.",
    level: "pwm-x-trigger",
  },
  {
    term: "Gain",
    meaning:
      "The factor a signal is multiplied by. A gain of 2 doubles it.",
    level: "dac-wrap",
  },
  {
    term: "gear ratio",
    meaning:
      "How many times the motor turns for one turn of the wheel. On the robot it is 20:1, so one wheel turn is 20 motor turns.",
    level: "enc-math",
  },
  {
    term: "Gray code",
    meaning:
      "A counting order in which only one bit changes per step. The encoder states 00, 10, 11, 01 are one.",
    level: "enc-states",
  },
  {
    term: "gyro drift",
    meaning:
      "The slow creep of an angle computed by adding up gyro rates, caused by a small leftover offset.",
    level: "adc-gyro",
  },
  {
    term: "H-bridge",
    meaning:
      "Four switches around a motor, drawn like the letter H. Closing one diagonal pair connects the motor to the battery one way round, the other pair the other way round, so the motor can turn in both directions.",
    level: "act-brief",
  },
  {
    term: "High side, low side",
    meaning:
      "In an H-bridge, the two switches that connect to the battery are the high side and the two that connect to ground are the low side. Closing both switches of one leg shorts the battery.",
    level: "act-hbridge",
  },
  {
    term: "hysteresis",
    meaning:
      "Two thresholds in place of one: on above the upper, off below the lower, unchanged in between. It stops flicker.",
    level: "adc-hysteresis",
  },
  {
    term: "incremental encoder",
    meaning:
      "An encoder that only reports changes. The count starts at 0 at power-on, wherever the shaft happens to be.",
    level: "enc-brief",
  },
  {
    term: "input qualification",
    meaning:
      "A filter on an input pin: the chip accepts a new level only after several samples in a row agree, which rejects short glitches.",
    level: "enc-init",
  },
  {
    term: "Load",
    meaning:
      "Whatever a pin or an amplifier drives: an LED, a motor, a buzzer.",
    level: "pwm-brief",
  },
  {
    term: "Lookup table",
    meaning:
      "An array filled once with results that are slow to compute, so that fast code such as an interrupt function only reads the entry it needs.",
    level: "dac-sine",
  },
  {
    term: "Low-pass filter",
    meaning:
      "Anything that lets slow changes through and averages fast ones away. A motor does this to a PWM signal.",
    level: "pwm-brief",
  },
  {
    term: "Mirrored motor",
    meaning:
      "The robot's two motors face opposite ways, so the right one needs the opposite command to drive the robot forward. Put the minus sign at the call, setEPWM2A(-u).",
    level: "act-setepwm",
  },
  {
    term: "Motor amplifier",
    meaning:
      "The circuit that switches battery power to a motor. A pin can only give a few milliamps, so the pin tells the amplifier what to do.",
    level: "pwm-brief",
  },
  {
    term: "noise",
    meaning:
      "Small random errors on every reading. Averaging many readings makes them smaller.",
    level: "adc-gyro",
  },
  {
    term: "offset",
    meaning:
      "The value a sensor gives when the thing it measures is zero. You subtract it before using the reading.",
    level: "adc-gyro",
  },
  {
    term: "optical encoder",
    meaning:
      "A sensor that measures rotation: a disc with slits turns between an LED and a light sensor, and each passing slit gives one pulse.",
    level: "enc-brief",
  },
  {
    term: "oversampling",
    meaning:
      "Measuring the same pin several times in a row and averaging, to reduce noise.",
    level: "adc-who",
  },
  {
    term: "photoresistor",
    meaning:
      "A resistor whose resistance changes with the light that falls on it. In a voltage divider it turns brightness into a voltage.",
    level: "adc-brief",
  },
  {
    term: "Piezo buzzer",
    meaning:
      "A small disc that clicks each time its voltage changes. Driven with a square wave, the clicks blend into a tone at the frequency of the wave.",
    level: "act-brief",
  },
  {
    term: "Pulse",
    meaning:
      "One stretch of time during which a signal is high.",
    level: "pwm-brief",
  },
  {
    term: "Pulse width",
    meaning:
      "How long a pulse stays high. For an RC servo it carries the angle: 4 % of the 20 ms period is -90 degrees, 8 % is 0 and 12 % is +90 degrees.",
    level: "act-brief",
  },
  {
    term: "PWM (pulse width modulation)",
    meaning:
      "Switching a pin on and off at a fixed rate and changing how long it stays on in each cycle. The load is too slow to follow, so it sees the average.",
    level: "pwm-brief",
  },
  {
    term: "QPEN",
    meaning:
      "The on switch of the eQEP position counter, a bit in QEPCTL. At 0 the counter is held in reset and always reads the same value.",
    level: "enc-qepctl",
  },
  {
    term: "QPOSCNT",
    meaning:
      "The eQEP's 32-bit position counter. It goes up one for every edge in one direction and down one in the other.",
    level: "enc-brief",
  },
  {
    term: "QPOSMAX",
    meaning:
      "The largest value the eQEP counter may reach. One step past it the counter starts again at 0. The course sets 0xFFFFFFFF, the full range.",
    level: "enc-init",
  },
  {
    term: "quadrature",
    meaning:
      "Two square waves, A and B, a quarter of a period (90 degrees) apart. Which one changes first tells the direction of rotation.",
    level: "enc-brief",
  },
  {
    term: "quantisation",
    meaning:
      "Turning a smooth value into a whole step number. The fraction that is dropped is the quantisation error, always less than one step.",
    level: "adc-brief",
  },
  {
    term: "R-2R ladder",
    meaning:
      "The resistor network inside a DAC, built from only two resistor values (R and 2R). Each bit's switch adds half as much voltage as the bit above it.",
    level: "dac-ladder",
  },
  {
    term: "radian",
    meaning:
      "A unit of angle. One full turn is 2 pi = 6.283 radians, so 1 radian is about 57 degrees. Distance rolled = wheel radius x angle in radians.",
    level: "enc-math",
  },
  {
    term: "Ramp limiter",
    meaning:
      "Code that lets a command change only by a small step per call, so a motor is never jumped from stop to full power. Also called a slew-rate limiter.",
    level: "act-x-slew",
  },
  {
    term: "rate gyro",
    meaning:
      "A sensor whose output voltage follows how fast the robot turns. It does not know the angle.",
    level: "adc-adcc",
  },
  {
    term: "RC servo",
    meaning:
      "A small motor with gears and its own electronics in one box. It turns an arm to the angle given by the width of a pulse that repeats every 20 ms, and holds it there.",
    level: "act-brief",
  },
  {
    term: "Reference voltage",
    meaning:
      "A fixed, accurate voltage a converter uses as its yardstick. On the course boards it is 3.0 V (VREFHI): the largest number stands for just under 3.0 V.",
    level: "dac-brief",
  },
  {
    term: "Resolution",
    meaning:
      "The smallest step a converter can make or tell apart. With 12 bits and a 3.0 V reference one step is 3.0 V / 4096 = 0.732 mV.",
    level: "dac-brief",
  },
  {
    term: "Resolution (PWM)",
    meaning:
      "The smallest step you can set. With 5000 counts per period, the duty cycle moves in steps of 1/5000 = 0.02 %.",
    level: "pwm-modes",
  },
  {
    term: "ripple",
    meaning:
      "A regular up-and-down wobble on a signal that should be steady.",
    level: "adc-average",
  },
  {
    term: "sample",
    meaning:
      "One measurement of a voltage, taken at one instant.",
    level: "adc-brief",
  },
  {
    term: "sample-and-hold",
    meaning:
      "A small capacitor is charged to the pin's voltage and then disconnected, so the voltage stays still while it is measured.",
    level: "adc-brief",
  },
  {
    term: "Saturate",
    meaning:
      "To stop a value at a limit instead of letting it run past, for example keeping CMPA between 0 and TBPRD.",
    level: "pwm-checkpoint",
  },
  {
    term: "Saturation",
    meaning:
      "Limiting a value to its allowed range: anything above the top becomes the top, anything below the bottom becomes the bottom.",
    level: "dac-setdaca",
  },
  {
    term: "Sawtooth",
    meaning:
      "A waveform that climbs in equal steps, drops straight back to the bottom and starts again.",
    level: "dac-ramp",
  },
  {
    term: "Shadow register",
    meaning:
      "A register you write that the chip copies into the active register a moment later. DACVALS is the shadow of DACVALA.",
    level: "dac-order",
  },
  {
    term: "shaft",
    meaning:
      "The rod of a motor or wheel that turns. An encoder is fixed to it to measure how far it has turned.",
    level: "enc-brief",
  },
  {
    term: "sin()",
    meaning:
      "The C library's sine function. It swings smoothly between -1 and +1 and repeats every time its argument, an angle in radians, grows by 2 x pi.",
    level: "dac-sine",
  },
  {
    term: "SOC (start of conversion)",
    meaning:
      "A slot of settings that describes one conversion: which trigger starts it, which pin it measures and how long it samples. Each ADC has 16.",
    level: "adc-soc",
  },
  {
    term: "Square wave",
    meaning:
      "A signal that is high for half of each period and low for the other half: a 50 % duty cycle.",
    level: "act-brief",
  },
  {
    term: "successive approximation (SAR)",
    meaning:
      "How the ADC finds its number: it tries one bit at a time from the top, and keeps the bit if the held voltage is at least the trial voltage.",
    level: "adc-sar",
  },
  {
    term: "SYSCLK",
    meaning:
      "The chip's main clock: 200 MHz, one tick every 5 ns.",
    level: "pwm-numbers",
  },
  {
    term: "threshold",
    meaning:
      "The level at which a decision flips, for example light on below 1.0 V.",
    level: "adc-hysteresis",
  },
  {
    term: "Time base (TBCTR, TBPRD)",
    meaning:
      "The counter of an ePWM module. TBCTR counts from 0 up to the value in TBPRD and starts again, and one such run is one PWM period.",
    level: "pwm-sawtooth",
  },
  {
    term: "Toggle (action)",
    meaning:
      "Action 3 of the action qualifier: flip the pin to the other level. One toggle per tooth of the counter gives a square wave whose period is two teeth.",
    level: "act-toggle",
  },
  {
    term: "trigger",
    meaning:
      "The event that tells a SOC to start now: a line of software, a CPU timer or a pulse from an ePWM counter.",
    level: "adc-soc",
  },
  {
    term: "Up-down count",
    meaning:
      "A counter mode in which the counter climbs to TBPRD and then counts back down to 0, a triangle. One period is 2 x TBPRD counts.",
    level: "pwm-modes",
  },
];
