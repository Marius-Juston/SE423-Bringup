// The things the PWM pins drive on the course boards: the robot's two DC
// motors through the H-bridge amplifier, RC servos and the piezo buzzer.
// These are world models: they only look at pin levels, so they work with
// any code that produces the right waveform (ePWM, or a pin toggled by
// hand).
//
// - DC motors (Lab 3, exercise 2): one PWM signal drives the amplifier's
//   direction input, so 50 % duty is zero average voltage (stopped), 100 %
//   is full voltage one way and 0 % full voltage the other way. EPWM1A
//   (GPIO0) is the left motor and EPWM2A (GPIO2) the right motor. The
//   motors are mounted mirrored, so the right wheel drives the robot
//   forward for a duty cycle below 50 % (the course code calls
//   setEPWM1A(uLeft); setEPWM2A(-uRight);). Each wheel is a first-order
//   system with a Coulomb friction dead zone (Lab 3, exercise 4).
//   Outputs "LEFT_WHEEL_RADPS" / "RIGHT_WHEEL_RADPS" (positive = robot
//   forward), also fed back as inputs of the same names for the encoders.
// - RC servos (HW4, SE423Lib.c): a pulse repeated at 50 Hz; 0.8 ms (4 %)
//   is -90 degrees, 1.6 ms (8 %) is 0 and 2.4 ms (12 %) is +90. "SERVO1_DEG"
//   is GPIO14 (EPWM8A), "SERVO2_DEG" GPIO15 (EPWM8B); the robot's servo
//   pins from SE423Lib.c are "SERVO3A_DEG" (GPIO4), "SERVO3B_DEG" (GPIO5),
//   "SERVO5A_DEG" (GPIO8), "SERVO5B_DEG" (GPIO9), "SERVO6A_DEG" (GPIO10).
// - Buzzer (HW3): a square wave on GPIO16 (EPWM9A). "BUZZER_HZ" is its
//   frequency while it is audible (20 Hz to 20 kHz), else 0.
//
// The duty cycle seen by a model is measured over whole PWM periods
// (rising edge to rising edge), as an averaging load does.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import type { Part } from "../world/kits";

const MS = 1e6;

/** Wheel speed at 100 % duty with no load, rad/s. */
export const WHEEL_MAX_RADPS = 30;
/** Motor and gearbox time constant, s. */
export const MOTOR_TAU_S = 0.05;
/** Command (2 x duty - 1) below which Coulomb friction holds the wheel still. */
export const MOTOR_DEAD_ZONE = 0.04;
const STEP_NS = 1 * MS;

/** Pulse widths of the course's RC servos, ms. */
export const SERVO_CENTER_MS = 1.6;
export const SERVO_MS_PER_90 = 0.8;
/** Repetition rates an RC servo accepts, Hz. */
const SERVO_MIN_HZ = 40;
const SERVO_MAX_HZ = 60;

/** Measures a PWM signal on a pin from its edges. */
class PwmIn {
  lastRise = -1;
  lastFall = -1;
  /** Last complete period and its high time, ns. */
  period = 0;
  high = 0;

  edge(level: number, t: number): boolean {
    if (level === 1) {
      const complete = this.lastRise >= 0 && this.lastFall > this.lastRise;
      if (complete) {
        this.period = t - this.lastRise;
        this.high = this.lastFall - this.lastRise;
      }
      this.lastRise = t;
      return complete;
    }
    this.lastFall = t;
    return false;
  }

  /** The signal has stopped switching. */
  stale(t: number): boolean {
    return this.period === 0 || t - Math.max(this.lastRise, this.lastFall) > 2 * this.period;
  }

  /** Fraction of time high: from the last period, or the level once switching has stopped. */
  duty(t: number, level: number): number {
    if (!this.stale(t)) return this.high / this.period;
    return level === 1 ? 1 : 0;
  }
}

/** Steady-state wheel speed for a duty cycle (0..1), rad/s, before the mounting sign. */
export function wheelTarget(duty: number): number {
  const c = 2 * duty - 1;
  const mag = Math.abs(c);
  if (mag <= MOTOR_DEAD_ZONE) return 0;
  return (Math.sign(c) * WHEEL_MAX_RADPS * (mag - MOTOR_DEAD_ZONE)) / (1 - MOTOR_DEAD_ZONE);
}

/** Servo angle for a pulse width, degrees, limited by the mechanical stops. */
export function servoAngle(pulseMs: number): number {
  return Math.max(-90, Math.min(90, ((pulseMs - SERVO_CENTER_MS) / SERVO_MS_PER_90) * 90));
}

interface Motor {
  pin: number;
  name: string;
  /** +1: duty above 50 % drives the robot forward; -1: mirrored. */
  sign: number;
  pwm: PwmIn;
  w: number;
}

const SERVOS: { pin: number; name: string }[] = [
  { pin: 14, name: "SERVO1_DEG" },
  { pin: 15, name: "SERVO2_DEG" },
  { pin: 4, name: "SERVO3A_DEG" },
  { pin: 5, name: "SERVO3B_DEG" },
  { pin: 8, name: "SERVO5A_DEG" },
  { pin: 9, name: "SERVO5B_DEG" },
  { pin: 10, name: "SERVO6A_DEG" },
];
const BUZZER_PIN = 16;

function install(b: Board): void {
  // ----- DC motors -----
  const motors: Motor[] = [
    { pin: 0, name: "LEFT_WHEEL_RADPS", sign: 1, pwm: new PwmIn(), w: 0 },
    { pin: 2, name: "RIGHT_WHEEL_RADPS", sign: -1, pwm: new PwmIn(), w: 0 },
  ];
  // Only the robot has motors. On the other boards GPIO0 and GPIO2 are free pins.
  if (b.kit !== "robot") motors.length = 0;
  for (const m of motors) b.publish(m.name, 0, 0);
  const alpha = 1 - Math.exp(-STEP_NS / 1e9 / MOTOR_TAU_S);
  let loop: ReturnType<Board["at"]> | null = null;
  const step = (t: number) => {
    loop = null;
    let busy = false;
    for (const m of motors) {
      const level = b.gpio.level[m.pin];
      // A pin that nothing drives gives the amplifier no command: the motor coasts to a stop.
      // No two real motors are alike: MOTOR_RIGHT_GAIN (default 1) makes the right one weaker or stronger.
      const gain = m.pin === 2 ? (b.inputs.get("MOTOR_RIGHT_GAIN") ?? 1) : 1;
      const target = level < 0 ? 0 : m.sign * gain * wheelTarget(m.pwm.duty(t, level));
      m.w += (target - m.w) * alpha;
      if (Math.abs(target - m.w) < 1e-4) m.w = target;
      else busy = true;
      if (!m.pwm.stale(t)) busy = true;
      const v = Math.round(m.w * 1e4) / 1e4;
      if (v !== b.output(m.name)) {
        b.publish(m.name, v, t);
        b.setInput(m.name, v, t);
      }
    }
    // Sleep while both wheels are steady and neither pin is switching; an edge wakes the model.
    if (busy) loop = b.at(t + STEP_NS, step);
  };

  // ----- RC servos -----
  const servos = SERVOS.map((s) => ({ ...s, pwm: new PwmIn() }));

  // ----- buzzer -----
  const buzzer = new PwmIn();
  let watchdog: ReturnType<Board["at"]> | null = null;
  const silence = (t: number) => {
    watchdog = null;
    if (buzzer.stale(t)) b.publish("BUZZER_HZ", 0, t);
    else watchdog = b.at(Math.max(buzzer.lastRise, buzzer.lastFall) + 2 * buzzer.period + 1, silence);
  };
  b.publish("BUZZER_HZ", 0, 0);

  b.gpio.listeners.push((pin, level, t) => {
    if (pin === BUZZER_PIN) {
      if (buzzer.edge(level, t)) {
        const hz = 1e9 / buzzer.period;
        b.publish("BUZZER_HZ", hz >= 20 && hz <= 20000 ? Math.round(hz * 10) / 10 : 0, t);
        if (!watchdog) watchdog = b.at(t + 2 * buzzer.period + 1, silence);
      }
      return;
    }
    if (pin === 0 || pin === 2) {
      motors[pin >> 1]?.pwm.edge(level, t);
      if (!loop) loop = b.at(t + STEP_NS, step);
      return;
    }
    if (pin > 15) return;
    const s = servos.find((x) => x.pin === pin);
    if (!s) return;
    s.pwm.edge(level, t);
    // A pulse just ended: the servo takes it if pulses arrive at an RC rate.
    if (level === 0 && s.pwm.period > 0 && s.pwm.lastRise >= 0) {
      const hz = 1e9 / s.pwm.period;
      if (hz >= SERVO_MIN_HZ && hz <= SERVO_MAX_HZ) b.publish(s.name, Math.round(servoAngle((t - s.pwm.lastRise) / MS) * 100) / 100, t);
    }
  });
}

const meter = (id: string, label: string, unit: string, digits: number): Part => ({ kind: "meter", id, label, output: id, unit, digits });
const servoMeters = [meter("SERVO1_DEG", "RC servo 1 (EPWM8A)", "deg", 1), meter("SERVO2_DEG", "RC servo 2 (EPWM8B)", "deg", 1)];
const buzzerMeter = meter("BUZZER_HZ", "Buzzer tone", "Hz", 1);

export const plugin: SimPlugin = {
  name: "actuators",
  // After the peripherals, so their pin drivers exist.
  order: 10,
  install,
  parts: {
    robot: [
      meter("LEFT_WHEEL_RADPS", "Left wheel speed", "rad/s", 2),
      meter("RIGHT_WHEEL_RADPS", "Right wheel speed", "rad/s", 2),
      ...servoMeters,
      buzzerMeter,
    ],
    redboard: [...servoMeters, buzzerMeter],
  },
};
