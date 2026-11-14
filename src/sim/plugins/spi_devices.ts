// The two slave devices on the robot's SPIB bus (GPIO63 SIMO, GPIO64 SOMI,
// GPIO65 CLK), each with its own chip select:
//
// MPU-9250 inertial measurement unit, chip select GPIO66. Three documents:
//   PS  "MPU-9250 Product Specification" (PS-MPU-9250A-01 rev 1.1)
//   RM  "MPU-9250 Register Map and Descriptions" (RM-MPU-9250A-00 rev 1.4)
//   AD  the course's "MPU-9250 Addendum": PS 1.3, 7.5 and 9.1 again, then
//       "SPI Timing Diagrams and Programming Tips", 7 pages (AD p1..p7)
//
// The serial port (PS 7.5, AD p1..p7)
// - Every transfer starts with one byte: bit 7 = 1 to read, 0 to write, bits
//   6..0 the register address. The bytes that follow are data, and the
//   address goes up by one after each (burst access). A transfer is 16 or
//   more clocks (PS 7.5 item 5). With the course's 16-bit words the first
//   word is address + first data byte (AD p1).
// - Data is latched on the rising edge of SCLK and changes on the falling
//   edge (PS 7.5 items 2, 3); the clock may idle low or high. In the
//   F28379D's bits that is CLKPOLARITY = 0, CLK_PHASE = 1 (the course's
//   setting, AD p1) or CLKPOLARITY = 1, CLK_PHASE = 0.
// - SCLK up to 1 MHz for all registers; the sensor and interrupt registers
//   (0x3A..0x48) may be read at up to 20 MHz (PS 1.3, Table 5).
// - The chip select frames a transfer: low at the start, high at the end
//   (PS 7.5). While it stays low every further byte is data for the next
//   register, never a new address.
//
// Registers (RM 3 and 4)
// - Reset values are 0x00 except PWR_MGMT_1 (0x6B) = 0x01 and WHO_AM_I (0x75)
//   = 0x71 (RM 3). (The WHO_AM_I page, RM 4.38, prints "Reset value: 0x68"
//   above "The default value of the register is 0x71"; 0x71 is right for the
//   MPU-9250.) RM 4.34: a part whose PU_SLEEP_MODE bit is set powers up with
//   SLEEP = 1 and CLKSEL[0] = 0 (0x40); the input IMU_PU_SLEEP = 1 gives
//   such a part, for a level about waking the chip.
// - ACCEL_XOUT_H (0x3B) .. GYRO_ZOUT_L (0x48), RM 4.22 to 4.24: accel X, Y, Z,
//   temperature, gyro X, Y, Z as signed 16-bit values, high byte first. Full
//   scale from ACCEL_CONFIG (0x1C) bits 4:3 (+-2, 4, 8, 16 g; RM 4.7) and
//   GYRO_CONFIG (0x1B) bits 4:3 (+-250, 500, 1000, 2000 deg/s; RM 4.6):
//   raw = value * 32768 / range. TEMP_OUT = (degC - 21) * 333.87 (RM 4.23,
//   PS Table 4). All fourteen bytes read under one chip select come from the
//   same sample ("SyncR").
// - Output data rate and filter (RM 4.4, 4.5, 4.6, 4.8; PS Table 4). The
//   sensor registers change only when a new sample is made; reads in between
//   return the same sample. Gyro and temperature, by Fchoice (the inverse of
//   GYRO_CONFIG bits 1:0) and CONFIG (0x1A) DLPF_CFG:
//     Fchoice x0: 8800 Hz at 32 kHz.  Fchoice 01: 3600 Hz at 32 kHz.
//     Fchoice 11, DLPF_CFG 0..7: 250 Hz at 8 kHz; 184, 92, 41, 20, 10, 5 Hz
//     at 1 kHz; 3600 Hz at 8 kHz.
//   Accelerometer, by ACCEL_CONFIG2 (0x1D) bit 3 accel_fchoice_b and bits 2:0
//   A_DLPFCFG: bit 3 set: 1130 Hz at 4 kHz; else 460, 184, 92, 41, 20, 10, 5,
//   460 Hz at 1 kHz. Where the internal rate is 1 kHz and the gyro's filter
//   is one of the six 1 kHz settings, the rate is 1 kHz / (1 + SMPLRT_DIV)
//   (0x19); otherwise the divider has no effect (RM 4.4 note).
//   The filter is modelled as a first-order low-pass with the table's
//   bandwidth (time constant 1 / (2 pi f)), state per axis, for the settings
//   of 184 Hz and below. The wider settings pass the value unchanged: their
//   lag is under a millisecond. (So the reset settings give the value the
//   sensor feels at the sample instant.)
// - PWR_MGMT_1 (0x6B, RM 4.34): H_RESET (bit 7) restores every register and
//   clears itself; SLEEP (bit 6) and CLKSEL = 7 stop the sensors, whose
//   registers then hold the last sample. After waking, the gyro delivers
//   samples again after 35 ms and the accelerometer after 20 ms (PS Tables 1
//   and 2, "from sleep mode"). After H_RESET the chip starts as from power-up:
//   no register access for 11 ms (PS Table 4, start-up time for register
//   read/write, typical), gyro data after 35 ms and accelerometer data after
//   30 ms (PS 4.23); the sensor registers read 0 until then.
// - PWR_MGMT_2 (0x6C, RM 4.35): an axis whose DISABLE bit is set reads 0.
// - Gyro offset registers XG_OFFS_USR.. (0x13..0x18, RM 4.3): 16 bits per
//   axis, in steps of 4 / 131 = 0.0305 deg/s whatever the range, SUBTRACTED
//   from the measurement as RM 4.3 says. Accelerometer offset registers
//   (0x77, 0x78; 0x7A, 0x7B; 0x7D, 0x7E; RM 4.39): bits 15..1 are a signed
//   15-bit number in steps of 0.98 mg whatever the range, ADDED to the
//   measurement. They reset to 0 (RM); a real part holds its factory trim
//   there, so on a real part "0" is that trim.
// - USER_CTRL (0x6A, RM 4.33): I2C_IF_DIS, FIFO_RST, I2C_MST_RST and
//   SIG_COND_RST read back 0; SIG_COND_RST clears the sensor registers until
//   the next sample. SIGNAL_PATH_RESET (0x68) reads back 0.
// - INT_STATUS (0x3A, RM 4.21) bit 0 RAW_DATA_RDY_INT is 1 when a sample was
//   made since the bit was last cleared. Reading INT_STATUS clears it; with
//   INT_ANYRD_2CLEAR (INT_PIN_CFG 0x37 bit 4, RM 4.19) any read does. The INT
//   pin is not wired to the F28379D on the robot, so INT_ENABLE is stored
//   only.
//
// What the sensor feels
// - Inputs IMU_AX_G, IMU_AY_G, IMU_AZ_G (g; default 0, 0, 1), IMU_TEMP_C
//   (25), IMU_GX_DPS, IMU_GY_DPS, IMU_GZ_DPS (deg/s; 0): bench knobs and
//   test stimuli.
// - While the robot world is on (ROBOT_WORLD = 1, robot_world.ts) the robot's
//   own motion is added, for every program: gyro Z = turn rate; accel X =
//   forward acceleration; accel Y = speed times turn rate (the centripetal
//   acceleration). Assumed mounting, the course material at hand does not
//   state it: the chip lies flat, +X to the robot's nose, +Y to its left, +Z
//   up (PS 9.1, Figure 4: right-handed axes, rotation positive by the
//   right-hand rule), so a left (counter-clockwise) turn is a positive gyro Z
//   and a positive accel Y, and speeding up forward is a positive accel X.
//   The speeds are the wheels' (LEFT_/RIGHT_WHEEL_RADPS), read at each 1 ms
//   step of the robot world; a crashed robot stands still. The values the
//   robot adds are published as outputs IMU_AX_G, IMU_AY_G and IMU_GZ_DPS,
//   which also takes those three knobs off the bench (they would fight it).
// - A real part, only while the input IMU_REAL is 1 (the Sandbox sets it for
//   the robot board; levels opt in): a fixed offset per axis inside PS Table
//   1 "initial ZRO tolerance" (+-5 deg/s) and Table 2 "zero-g initial
//   calibration tolerance" (+-60 mg X and Y, +-80 mg Z), and noise on every
//   sample: 0.01 deg/s per root hertz and 300 ug per root hertz (PS Tables 1
//   and 2) times the root of the selected bandwidth, which gives the table's
//   0.1 deg/s rms at 92 Hz. Filtered settings give noise that is correlated
//   from sample to sample with the filter's time constant. The generators
//   are seeded (mulberry32), one per axis, and advance once per sample made,
//   so a run repeats exactly. The inputs IMU_BIAS_GX_DPS, .._GY_, .._GZ_ and
//   IMU_BIAS_AX_G, .._AY_, .._AZ_ replace an axis's offset when set.
// - Outputs IMU_RATE_HZ, IMU_GYRO_BW_HZ, IMU_ACCEL_BW_HZ: the data rate of
//   the gyro and the two bandwidths, published when a configuration register
//   is written. MPU_WRITE_FRAMES: the number of transfers (chip-select
//   pulses) that wrote at least one register, for a check that a burst was
//   one transfer.
//
// Diagnostics for what the real chip hides:
//   mpu-too-fast      a configuration register clocked above 1 MHz
//   mpu-short-frame   chip select raised after fewer than 16 clocks
//   mpu-cs-held       a word long after the previous one with the chip select
//                     still low: it is data for the next register (AD: raise
//                     SS after every transfer)
//   mpu-cs-gap        chip select high for under 1 us between two transfers.
//                     The documents give no minimum; AD's code waits 10 us.
//                     Warning only, the transfer is carried out.
//   (These four are not given while SPIB is in loopback, SPICCR.SPILBK = 1:
//   the program is then talking to itself, as chapter 12 does.)
//   mpu-split-value   a read that ends on the high byte of a measurement, so
//                     the 16-bit words are not aligned (AD p4: start one
//                     register earlier)
//   mpu-read-only     a write to the measurement registers 0x3B..0x60, the
//                     sign of a forgotten read bit. (Writes to INT_STATUS
//                     0x3A and WHO_AM_I 0x75 are ignored in silence: the
//                     course's own set-up makes them.)
//   mpu-asleep, mpu-waking, mpu-starting, mpu-axis-off: a measurement read
//                     while the chip sleeps, before its sensors have started,
//                     a register access during start-up after H_RESET, a
//                     disabled axis read.
//
// Not modelled: the magnetometer (AK8963 behind the auxiliary I2C master)
// and the FIFO, neither is small; the DMP, self-test, wake-on-motion, the
// low-power accelerometer cycle and GYRO_STANDBY; the INT pin; the real
// filters' order and delay (first order here); scale-factor tolerance,
// cross-axis sensitivity, nonlinearity and drift with temperature; clock
// accuracy by CLKSEL; switching to I2C when I2C_IF_DIS is not set (PS 7.1
// recommends setting it; on the simulated bus the chip never mistakes SPI
// for I2C); power-up itself: at time 0 the chip has long been powered.
//
// DAN28027 co-processor (a TI F28027 on the robot board), chip select GPIO29.
// From its firmware (F28027Code/PWMF28027/PWMF28027.c, SPI_RXint): 16-bit
// words, clock mode CLKPOLARITY = 0, CLK_PHASE = 1. The master sends 0x00DA,
// then two PWM compare values (limited to 0..3000). The firmware answers one
// word late, because it loads each reply in its receive interrupt: the
// master reads [whatever was left, ADC0, ADC2]. It needs a few microseconds
// for that between words, which is why the course sets SPIFFCT.TXDLY = 16
// for this device; without the gap the replies arrive a word late.
// Its two analog inputs are the signal-bus inputs DAN_ADC1 and DAN_ADC2 in
// volts (12 bits over 3.3 V). In the robot world they are the outputs of the
// two Sharp infrared distance sensors (robot_sensors.ts, which says what is
// assumed about that wiring).

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import { registerSpiDevice, type SpiDevice } from "./spi";
import { gauss, WHEEL_BASE } from "./plant";
import { FT_PER_WHEEL_RAD, type RobotWorld } from "./robot_world";

export const MPU_CS_PIN = 66;
export const DAN_CS_PIN = 29;
/** Time the DAN28027's receive interrupt needs to load its next reply, ns. */
const DAN_ISR_NS = 4000;
/** F28027 ADC: 12 bits over 0..3.3 V. */
const DAN_VREF = 3.3;

/**
 * A device that works in words of `unit` bits, whatever word size the master
 * uses: `next` says what the device shifts out during its next word (no side
 * effects), `receive` is called once that word is complete.
 */
function shifter(unit: number, next: (t: number) => number, receive: (word: number, tEnd: number, bitNs: number) => void) {
  let acc = 0;
  let count = 0;
  let reply = 0;
  return {
    unitBits: unit,
    reset() {
      acc = 0;
      count = 0;
    },
    peek: (t: number) => (count === 0 ? next(t) : reply),
    transfer(out: number, bits: number, t: number, tEnd: number): number {
      const bitNs = (tEnd - t) / bits;
      let res = 0;
      for (let i = bits - 1; i >= 0; i--) {
        if (count === 0) reply = next(t + (bits - 1 - i) * bitNs);
        res = (res << 1) | ((reply >>> (unit - 1 - count)) & 1);
        acc = (acc << 1) | ((out >>> i) & 1);
        if (++count === unit) {
          receive(acc, t + (bits - i) * bitNs, bitNs);
          acc = 0;
          count = 0;
        }
      }
      return res >>> 0;
    },
  };
}

/** Signal-bus inputs of the MPU-9250, in the order of its sensor registers. */
export const IMU_INPUTS = ["IMU_AX_G", "IMU_AY_G", "IMU_AZ_G", "IMU_TEMP_C", "IMU_GX_DPS", "IMU_GY_DPS", "IMU_GZ_DPS"];

/** The MPU-9250 as the bench shows it. Index order: accel X, Y, Z (g), temperature (degC), gyro X, Y, Z (deg/s). */
export interface ImuState {
  /** What the sensor feels now: the knobs and stimuli plus, in the robot world, the robot's motion. */
  feels: number[];
  /** The last sample the chip made (with offset and noise for a real part), before the offset registers and the range. */
  sample: number[];
  /** Number of samples made (gyro and accelerometer together). */
  samples: number;
  /** "robot" while the robot world moves accel X, accel Y and gyro Z. */
  source: "knobs" | "robot";
  asleep: boolean;
  /** Gyro data rate and the two filter bandwidths, from the configuration registers. */
  rateHz: number;
  gyroBwHz: number;
  accelBwHz: number;
}

export interface SpiDevicesState {
  /** MPU-9250 register file (sensor outputs are computed when read). */
  mpuRegs: Uint8Array;
  imu: ImuState;
  /** Register writes the MPU-9250 received: [address, value]. */
  mpuWrites: [number, number][];
  /** Complete commands the DAN28027 received. */
  danCommands: number;
}

function install(b: Board): void {
  const state: SpiDevicesState = {
    mpuRegs: new Uint8Array(128),
    imu: { feels: [0, 0, 1, 25, 0, 0, 0], sample: [0, 0, 1, 25, 0, 0, 0], samples: 0, source: "knobs", asleep: false, rateHz: 8000, gyroBwHz: 250, accelBwHz: 460 },
    mpuWrites: [],
    danCommands: 0,
  };
  b.plugins.set("spi_devices", state);

  // ---------------- MPU-9250 ----------------
  const regs = state.mpuRegs;
  const imu = state.imu;
  const MS = 1e6;
  const real = () => (b.inputs.get("IMU_REAL") ?? 0) !== 0;
  const powerOn = () => {
    regs.fill(0);
    // RM 4.34: PU_SLEEP_MODE goes to SLEEP, its inverse to CLKSEL[0].
    regs[0x6b] = b.inputs.get("IMU_PU_SLEEP") ? 0x40 : 0x01;
    regs[0x75] = 0x71;
  };
  powerOn();
  b.onInput("IMU_PU_SLEEP", (_v, t) => {
    if (t === 0 && state.mpuWrites.length === 0) powerOn();
  });

  // Channels: 0..2 accelerometer X, Y, Z (g), 3 temperature (degC), 4..6 gyro X, Y, Z (deg/s).
  const DEFAULTS = [0, 0, 1, 25, 0, 0, 0];
  /** What the knobs and stimuli say. */
  const knob = [...DEFAULTS];
  /** What the robot's own motion adds (accel X, accel Y, gyro Z). */
  const robot = [0, 0, 0, 0, 0, 0, 0];
  /** What the sensor feels: knob + robot. */
  const x = imu.feels;
  /** Filter state, noise state and the latched sample, in physical units. */
  const y = [...DEFAULTS];
  const noise = [0, 0, 0, 0, 0, 0, 0];
  const p = imu.sample;
  const gens = IMU_INPUTS.map((_n, i) => gauss(0x9250a000 + i));
  /** PS Tables 1 and 2: offsets inside the initial tolerances, fixed for this part. */
  const BIAS = [0.025, -0.018, 0.04, 0, 2.1, -1.4, 0.9];
  const BIAS_INPUTS = ["IMU_BIAS_AX_G", "IMU_BIAS_AY_G", "IMU_BIAS_AZ_G", "", "IMU_BIAS_GX_DPS", "IMU_BIAS_GY_DPS", "IMU_BIAS_GZ_DPS"];
  /** PS Tables 1 and 2: noise density per root hertz (g, -, deg/s). */
  const DENSITY = [300e-6, 300e-6, 300e-6, 0, 0.01, 0.01, 0.01];

  interface Group {
    /** Channels of this group. */
    ch: number[];
    /** Time the filter states are valid at, ns. */
    t: number;
    /** Index of the last sample made. */
    slot: number;
    /** Sample period, ns; bandwidth per channel, Hz. */
    ts: number;
    bw: number[];
    /** No samples before this time (start-up). */
    onAt: number;
  }
  const gyro: Group = { ch: [3, 4, 5, 6], t: 0, slot: -1, ts: 125_000, bw: [4000, 250, 250, 250], onAt: 0 };
  const accel: Group = { ch: [0, 1, 2], t: 0, slot: -1, ts: MS, bw: [460, 460, 460], onAt: 0 };
  /** No register access before this time (start-up after H_RESET). */
  let regAt = 0;
  const GYRO_BW = [250, 184, 92, 41, 20, 10, 5, 3600];
  const TEMP_BW = [4000, 188, 98, 42, 20, 10, 5, 4000];
  const ACCEL_BW = [460, 184, 92, 41, 20, 10, 5, 460];
  /** Reads the rate and the bandwidths out of the registers (RM 4.4, 4.5, 4.6, 4.8). */
  const configure = () => {
    const fb = regs[0x1b] & 3;
    const dlpf = regs[0x1a] & 7;
    const div = 1 + regs[0x19];
    let divides = false;
    if (fb & 1) [gyro.ts, gyro.bw] = [31_250, [4000, 8800, 8800, 8800]];
    else if (fb & 2) [gyro.ts, gyro.bw] = [31_250, [4000, 3600, 3600, 3600]];
    else {
      divides = dlpf >= 1 && dlpf <= 6;
      gyro.ts = divides ? div * MS : 125_000;
      gyro.bw = [TEMP_BW[dlpf], GYRO_BW[dlpf], GYRO_BW[dlpf], GYRO_BW[dlpf]];
    }
    if (regs[0x1d] & 8) [accel.ts, accel.bw] = [250_000, [1130, 1130, 1130]];
    else {
      const f = ACCEL_BW[regs[0x1d] & 7];
      [accel.ts, accel.bw] = [divides ? div * MS : MS, [f, f, f]];
    }
    imu.rateHz = 1e9 / gyro.ts;
    imu.gyroBwHz = gyro.bw[1];
    imu.accelBwHz = accel.bw[0];
  };
  configure();
  const asleep = () => (regs[0x6b] & 0x40) !== 0 || (regs[0x6b] & 7) === 7;
  /** Time constant in ns of a bandwidth; 0 = passes unchanged (see the header). */
  const tau = (bw: number) => (bw <= 184 ? 1e9 / (2 * Math.PI * bw) : 0);
  const advance = (g: Group, t: number) => {
    const dt = t - g.t;
    if (dt < 0) return;
    g.ch.forEach((c, k) => {
      const tc = tau(g.bw[k]);
      y[c] = tc > 0 && dt < 40 * tc ? y[c] + (x[c] - y[c]) * (1 - Math.exp(-dt / tc)) : x[c];
    });
    g.t = t;
  };
  /** Makes the sample of instant `s`: the filter's value plus, for a real part, offset and noise. */
  const latch = (g: Group, slot: number) => {
    const m = slot - g.slot;
    g.slot = slot;
    const noisy = real();
    g.ch.forEach((c, k) => {
      let v = y[c];
      if (noisy && DENSITY[c] > 0) {
        const sigma = DENSITY[c] * Math.sqrt(g.bw[k]);
        const tc = tau(g.bw[k]);
        const a = tc > 0 ? Math.exp((-m * g.ts) / tc) : 0;
        noise[c] = a * noise[c] + Math.sqrt(1 - a * a) * sigma * gens[c]();
        v += noise[c] + (b.inputs.get(BIAS_INPUTS[c]) ?? BIAS[c]);
      }
      p[c] = v;
    });
    imu.samples++;
    b.mem.writes++;
  };
  /**
   * Brings the sensor up to time t: makes the newest sample due, then moves
   * the filters on. `before` leaves out a sample due at t itself (the input
   * that is about to change belongs to it).
   */
  const sync = (t: number, before = false) => {
    const off = asleep();
    for (const g of [gyro, accel]) {
      let slot = Math.floor(t / g.ts);
      if (before && slot * g.ts === t) slot--;
      const s = slot * g.ts;
      if (off || s < g.onAt) {
        // Sensors off: nothing is sampled, the registers hold; the filters start afresh later.
        g.ch.forEach((c) => (y[c] = x[c]));
        g.t = Math.max(g.t, t);
        g.slot = Math.max(g.slot, slot);
        continue;
      }
      if (slot > g.slot) {
        advance(g, Math.max(s, g.t));
        latch(g, slot);
      }
      advance(g, t);
    }
  };
  const feel = (i: number, t: number) => {
    const v = knob[i] + robot[i];
    if (v === x[i]) return;
    sync(t, true);
    x[i] = v;
    b.mem.writes++;
  };
  IMU_INPUTS.forEach((name, i) =>
    b.onInput(name, (v, t) => {
      knob[i] = Number.isFinite(v) ? v : DEFAULTS[i];
      feel(i, t);
    }),
  );

  // The robot's own motion, sampled at each step of the robot world (it sets the LIDAR's pose every 1 ms).
  const G_FT = 32.174;
  let prevT = -1;
  let prevV = 0;
  const world = () => (b.plugins.get("robot-world") as RobotWorld | undefined)?.on === true;
  const drive = (ax: number, ay: number, gz: number, t: number) => {
    [robot[0], robot[1], robot[6]] = [ax, ay, gz];
    for (const i of [0, 1, 6]) feel(i, t);
    b.publish("IMU_AX_G", +ax.toFixed(4), t);
    b.publish("IMU_AY_G", +ay.toFixed(4), t);
    b.publish("IMU_GZ_DPS", +gz.toFixed(3), t);
  };
  b.onInput("LIDAR_THETA_RAD", (_v, t) => {
    if (!world()) {
      if (imu.source === "robot") {
        imu.source = "knobs";
        drive(0, 0, 0, t);
      }
      return;
    }
    const still = b.output("ROBOT_CRASHED") === 1;
    const vl = still ? 0 : (b.inputs.get("LEFT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
    const vr = still ? 0 : (b.inputs.get("RIGHT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
    const v = (vl + vr) / 2;
    const w = (vr - vl) / WHEEL_BASE;
    const dt = (t - prevT) / 1e9;
    // The first step and a step after a pause have no earlier speed to compare with.
    const a = imu.source === "robot" && dt > 0 && dt < 0.005 ? Math.max(-16 * G_FT, Math.min(16 * G_FT, (v - prevV) / dt)) : 0;
    if (imu.source !== "robot") {
      imu.source = "robot";
      // Two entries in each history: the bench then takes the three knobs away at once.
      for (const n of ["IMU_AX_G", "IMU_AY_G", "IMU_GZ_DPS"]) b.publish(n, 1e-4, t - 1);
    }
    prevT = t;
    prevV = v;
    drive(a / G_FT, (v * w) / G_FT, (w * 180) / Math.PI, t);
  });
  b.onInput("ROBOT_WORLD", (v, t) => {
    if (!v && imu.source === "robot") {
      imu.source = "knobs";
      drive(0, 0, 0, t);
    }
  });

  const int16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v))) & 0xffff;
  const s16 = (hi: number, lo: number) => (((hi << 8) | lo) << 16) >> 16;
  /** The counts in the sensor registers for one channel: the sample, the offset registers, the range. */
  const counts = (i: number): number => {
    if (i === 3) return int16((p[3] - 21) * 333.87);
    if (i < 3) {
      if (regs[0x6c] & (0x20 >> i)) return 0;
      // RM 4.39: bits 15..1, 0.98 mg a step, in every range.
      const offs = (s16(regs[0x77 + 3 * i], regs[0x78 + 3 * i]) >> 1) * 0.00098;
      return int16(((p[i] + offs) * 32768) / (2 << ((regs[0x1c] >> 3) & 3)));
    }
    if (regs[0x6c] & (4 >> (i - 4))) return 0;
    // RM 4.3: 4 / 131 deg/s a step in every range, subtracted.
    const offs = (s16(regs[0x13 + 2 * (i - 4)], regs[0x14 + 2 * (i - 4)]) * 4) / 131;
    return int16(((p[i] - offs) * 32768) / (250 << ((regs[0x1b] >> 3) & 3)));
  };
  /** The fourteen sensor bytes of this chip-select frame: one sample (RM: "SyncR"). */
  let frame: number[] | null = null;
  /** One remark about the sensors or the registers per chip-select frame is enough. */
  let remarked = false;
  const remark = (code: string, msg: string) => {
    if (remarked) return;
    remarked = true;
    b.warn(b.line, code, msg);
  };
  /** Gyro sample the data-ready flag was last cleared at. */
  let readySlot = -1;
  const SENSOR_NAMES = ["ACCEL_XOUT", "ACCEL_YOUT", "ACCEL_ZOUT", "TEMP_OUT", "GYRO_XOUT", "GYRO_YOUT", "GYRO_ZOUT"];
  const readReg = (a: number, t: number): number => {
    if (t < regAt) {
      remark("mpu-starting", `The MPU-9250 was read ${((t - (regAt - 11 * MS)) / MS).toFixed(1)} ms after its reset (H_RESET, bit 7 of PWR_MGMT_1). It starts up as after power-on and answers no register for 11 ms (product specification, Table 4, start-up time for register read/write; 100 ms at most), so this read returned 0. Wait after the reset: DELAY_US(100000);`);
      return 0;
    }
    if (a >= 0x3b && a <= 0x48) {
      const i = (a - 0x3b) >> 1;
      // A knob for an axis the program reads; a lone low byte is the word thrown away before one (AD p4).
      if (!((a - 0x3b) & 1)) b.inputsUsed.add(IMU_INPUTS[i]);
      if (!frame) {
        sync(t);
        frame = IMU_INPUTS.map((_n, k) => counts(k));
        if (regs[0x37] & 0x10) readySlot = gyro.slot;
      }
      const g = i < 3 ? accel : gyro;
      const what = i < 3 ? "accelerometer" : i === 3 ? "temperature sensor" : "gyro";
      if (asleep())
        remark("mpu-asleep", `${SENSOR_NAMES[i]} was read while the MPU-9250 is ${(regs[0x6b] & 0x40) !== 0 ? "asleep (PWR_MGMT_1, register 0x6B, bit 6 SLEEP = 1)" : "without a clock (PWR_MGMT_1, register 0x6B, CLKSEL = 7)"}. Its sensors are off, so the register holds an old value that never changes. Wake the chip first: write 0x01 to register 0x6B (awake, best clock), then wait 35 ms for the gyro to start (register map 4.34; product specification, Table 1).`);
      else if (t < g.onAt)
        remark("mpu-waking", `${SENSOR_NAMES[i]} was read before the ${what} had started. After waking or a reset the gyro needs 35 ms and the accelerometer 20 to 30 ms before the first measurement (product specification, Tables 1 and 2, 4.23); until then the register holds an old value or 0. Wait before the first read: DELAY_US(50000);`);
      else if (i !== 3 && regs[0x6c] & (i < 3 ? 0x20 >> i : 4 >> (i - 4)))
        remark("mpu-axis-off", `${SENSOR_NAMES[i]} was read, but that axis is switched off in PWR_MGMT_2 (register 0x6C = 0x${regs[0x6c].toString(16).toUpperCase().padStart(2, "0")}), so it reads 0. Bits 5 to 3 switch off accelerometer X, Y, Z and bits 2 to 0 gyro X, Y, Z (register map 4.35): write 0x00 to 0x6C to measure on all axes.`);
      const v = frame[i];
      return (a - 0x3b) & 1 ? v & 0xff : v >> 8;
    }
    if (a === 0x3a) {
      sync(t);
      const ready = gyro.slot > readySlot ? 1 : 0;
      readySlot = gyro.slot;
      return ready;
    }
    if (regs[0x37] & 0x10) readySlot = Math.max(readySlot, gyro.slot);
    return regs[a];
  };
  const hex = (n: number, d = 2) => `0x${n.toString(16).toUpperCase().padStart(d, "0")}`;
  const writeReg = (a: number, v: number, t: number) => {
    state.mpuWrites.push([a, v]);
    b.mem.writes++;
    if (t < regAt) {
      remark("mpu-starting", `Register ${hex(a)} of the MPU-9250 was written ${((t - (regAt - 11 * MS)) / MS).toFixed(1)} ms after its reset (H_RESET, bit 7 of PWR_MGMT_1). It starts up as after power-on and takes no register access for 11 ms (product specification, Table 4, start-up time for register read/write; 100 ms at most), so this write was lost. Wait after the reset: DELAY_US(100000);`);
      return;
    }
    if (a >= 0x3b && a <= 0x60) {
      remark("mpu-read-only", `${hex(v)} was written to register ${hex(a)} of the MPU-9250${a <= 0x48 ? ` (${SENSOR_NAMES[(a - 0x3b) >> 1]}_${(a - 0x3b) & 1 ? "L" : "H"})` : ""}, which holds a measurement and cannot be written: the chip ignored it. The first byte of a transfer is the address, and its top bit says read (1) or write (0). To read, set bit 15 of the first word: SpibRegs.SPITXBUF = 0x8000 | ${hex(a << 8, 4)}; (addendum, page 4).`);
      return;
    }
    // INT_STATUS and WHO_AM_I are read-only too; the course's set-up writes them, to no effect.
    if (a === 0x3a || a === 0x75) return;
    sync(t);
    if (a === 0x6b) {
      if (v & 0x80) {
        // H_RESET: every register back to its default, the chip starts as from power-up.
        powerOn();
        p.fill(0);
        regAt = t + 11 * MS;
        gyro.onAt = t + 35 * MS;
        accel.onAt = t + 30 * MS;
      } else {
        const was = asleep();
        regs[a] = v;
        if (was && !asleep()) {
          gyro.onAt = t + 35 * MS;
          accel.onAt = t + 20 * MS;
        }
      }
    } else if (a === 0x6a) {
      regs[a] = v & 0xe8; // bits 4, 2, 1, 0 clear themselves
      if (v & 1) p.fill(0);
    } else if (a === 0x68) regs[a] = 0;
    else regs[a] = v;
    if (a >= 0x19 && a <= 0x1d) {
      configure();
      b.publish("IMU_RATE_HZ", +imu.rateHz.toFixed(3), t);
      b.publish("IMU_GYRO_BW_HZ", imu.gyroBwHz, t);
      b.publish("IMU_ACCEL_BW_HZ", imu.accelBwHz, t);
    } else if (a === 0x6b) configure();
    imu.asleep = asleep();
  };
  imu.asleep = asleep();

  let addrPhase = true;
  let reading = false;
  let addr = 0;
  /** Bits clocked in this chip-select frame, when its last word ended, and the last sensor register read. */
  let frameBits = 0;
  let lastWordEnd = -1;
  let lastRead = -1;
  let deselectedAt = -1;
  let selected = false;
  /** Did this chip-select frame write a register, and how many frames have. */
  let wrote = false;
  let writeFrames = 0;
  /** With loopback on the master hears itself, not the chip: the program is not talking to the MPU-9250. */
  const talking = () => b.dev.get("SpibRegs.SPICCR", "SPILBK") !== 1;
  const mpu = shifter(
    8,
    (t) => (addrPhase || !reading ? 0x00 : readReg(addr, t)),
    (byte, t, bitNs) => {
      frameBits += 8;
      if (addrPhase) {
        addrPhase = false;
        reading = (byte & 0x80) !== 0;
        addr = byte & 0x7f;
        return;
      }
      if (bitNs > 0 && bitNs < 999 && !(reading && addr >= 0x3a && addr <= 0x48))
        b.warn(b.line, "mpu-too-fast", `The MPU-9250 was clocked at ${(1000 / bitNs).toFixed(1)} MHz. Its limit is 1 MHz (only the sensor registers may be read faster). The bit rate is LSPCLK / (SPIBRR + 1) with LSPCLK = 50 MHz: make SpibRegs.SPIBRR.bit.SPI_BIT_RATE large enough for 1 MHz or less. The library's setupSpib() sets 1 MHz.`);
      if (reading) lastRead = addr;
      else {
        writeReg(addr, byte, t);
        wrote = true;
      }
      addr = (addr + 1) & 0x7f;
    },
  );
  const mpuDevice: SpiDevice = {
    name: "MPU-9250",
    csPin: MPU_CS_PIN,
    mode: [{ polarity: 0, phase: 1 }, { polarity: 1, phase: 0 }],
    unitBits: 8,
    peek: mpu.peek,
    transfer(out, bits, t, tEnd) {
      // A whole word long after the last one, under the same chip select: the program meant a new transfer.
      if (bits >= 8 && lastWordEnd >= 0 && t - lastWordEnd > 200_000 && !addrPhase && talking())
        b.warn(b.line, "mpu-cs-held", `This word reached the MPU-9250 ${((t - lastWordEnd) / 1000).toFixed(0)} us after the previous one with its chip select (GPIO66) still low. The chip takes the first byte after the chip select falls as the address and every later byte as data, so ${hex(out, bits > 8 ? 4 : 2)} was ${reading ? "ignored and the read went on at" : "written as data to"} register ${hex(addr)}${bits > 8 ? " and the next one" : ""}, not understood as a new command. End every transfer: GpioDataRegs.GPCSET.bit.GPIO66 = 1; once its words have been received (addendum, pages 2 to 5: "SS must be pulled high").`);
      const r = mpu.transfer(out, bits, t, tEnd);
      lastWordEnd = tEnd;
      return r;
    },
    select() {
      selected = true;
      mpu.reset();
      addrPhase = true;
      frame = null;
      remarked = false;
      frameBits = 0;
      lastWordEnd = -1;
      lastRead = -1;
      if (deselectedAt >= 0 && b.now - deselectedAt < 1000 && talking())
        b.warn(b.line, "mpu-cs-gap", `The MPU-9250's chip select (GPIO66) went low again ${b.now - deselectedAt} ns after it went high. The chip needs the chip select high for a moment to see that one transfer has ended and the next begins. The course's code waits between transfers (addendum, pages 2 and 3): put DELAY_US(10); after reading SPIRXBUF.`);
    },
    deselect() {
      selected = false;
      deselectedAt = b.now;
      if (wrote) b.publish("MPU_WRITE_FRAMES", ++writeFrames);
      wrote = false;
      if (!talking()) return;
      if (frameBits > 0 && frameBits < 16)
        b.warn(b.line, "mpu-short-frame", `The MPU-9250's chip select (GPIO66) went high after ${frameBits} clock cycles. A transfer needs 16 or more: one address byte, then at least one data byte (product specification 7.5, item 5), so nothing was read or written. Send the address and the data under one chip select; with the course's 16-bit words (SpibRegs.SPICCR.bit.SPICHAR = 0xF) one word holds both.`);
      // The last byte read was the high byte of a measurement (0x3B, 0x3D .. 0x47): its low byte is missing.
      else if (reading && lastRead >= 0x3b && lastRead <= 0x47 && lastRead & 1 && frameBits >= 32) {
        const n = SENSOR_NAMES[(lastRead - 0x3b) >> 1];
        b.warn(b.line, "mpu-split-value", `This read of the MPU-9250 ended on ${n}_H (register ${hex(lastRead)}), the high byte of a measurement, without its low byte. With 16-bit words that means every word received holds the low byte of one measurement and the high byte of the next. Start the read one register earlier, at an even address, and throw the first word away: then each later word is one whole measurement (addendum, page 4).`);
      }
    },
  };
  registerSpiDevice(b, mpuDevice);
  // "Chip select low" written while it is low already, after a whole transfer: the last one was never ended.
  {
    const h = b.dev.reg("GpioDataRegs.GPCCLEAR").hook;
    const prev = h.after;
    h.after = (v, before) => {
      const again = (v & (1 << (MPU_CS_PIN - 64))) !== 0 && selected && frameBits >= 16 && talking();
      prev?.(v, before);
      if (again)
        b.warn(b.line, "mpu-cs-held", `GPIO66 was pulled low to start a transfer with the MPU-9250, but it was still low from the transfer before. The chip takes the first byte after the chip select falls as the address and every later byte as data, so what follows is ${reading ? "ignored and the read goes on at" : "written as data to"} register ${hex(addr)} and the ones after it, not understood as a new command. End every transfer: GpioDataRegs.GPCSET.bit.GPIO66 = 1; once its words have been received (addendum, pages 2 to 5: "SS must be pulled high").`);
    };
  }

  // ---------------- DAN28027 ----------------
  // State of the firmware's SPI_RXint().
  let inside = false;
  let sendIndex = 0;
  const send = [0, 0, 0];
  const recv = [0, 0];
  /** Words the firmware has written to its SPITXBUF, with the time each was loaded. */
  const txq: { v: number; ready: number }[] = [{ v: 0, ready: 0 }];
  /** Its shift register: with nothing loaded, the word just received goes back out. */
  let spidat = 0;
  let fromQueue = false;
  const adc = (name: string) => Math.max(0, Math.min(4095, Math.round((b.input(name, 0) / DAN_VREF) * 4096)));
  const dan = shifter(
    16,
    (t) => {
      fromQueue = txq.length > 0 && txq[0].ready <= t;
      return fromQueue ? txq[0].v : spidat;
    },
    (word, tEnd) => {
      if (fromQueue) txq.shift();
      else if (txq.length)
        b.warn(b.line, "dan-too-fast", "The DAN28027 had not loaded its reply yet when the next word started, so it sent the previous word back instead and its answers now arrive one word late. It loads each reply in its receive interrupt and needs a gap between words: set SpibRegs.SPIFFCT.bit.TXDLY = 16; before talking to it (and back to 0 for the MPU-9250).");
      spidat = word;
      b.mem.writes++;
      const load = (v: number) => txq.push({ v, ready: tEnd + DAN_ISR_NS });
      if (!inside) {
        if (word === 0x00da) {
          inside = true;
          send[0] = adc("DAN_ADC1");
          send[1] = adc("DAN_ADC2");
          send[2] = 0;
          load(send[0]);
          sendIndex = 1;
        }
        return;
      }
      load(send[sendIndex]);
      recv[sendIndex - 1] = word;
      if (++sendIndex >= 3) {
        inside = false;
        const limit = (w: number) => Math.max(0, Math.min(3000, (w << 16) >> 16));
        state.danCommands++;
        b.publish("DAN_PWM1", limit(recv[0]), tEnd);
        b.publish("DAN_PWM2", limit(recv[1]), tEnd);
        b.publish("DAN_COMMANDS", state.danCommands, tEnd);
      }
    },
  );
  registerSpiDevice(b, {
    name: "DAN28027",
    csPin: DAN_CS_PIN,
    mode: { polarity: 0, phase: 1 },
    unitBits: 16,
    peek: dan.peek,
    transfer: dan.transfer,
    // SPISTE high stops the slave's shift register (TRM 18.3.3).
    select: dan.reset,
  });
}

export const plugin: SimPlugin = {
  name: "spi_devices",
  // After "spi" (alphabetical), so the bus exists; registerSpiDevice does not depend on it either way.
  order: 1,
  install,
  parts: {
    robot: [
      { kind: "knob", id: "IMU_GZ", label: "Turn rate about Z (gyro)", input: "IMU_GZ_DPS", min: -250, max: 250, step: 1, initial: 0, unit: "deg/s" },
      { kind: "knob", id: "IMU_GX", label: "Turn rate about X (gyro)", input: "IMU_GX_DPS", min: -250, max: 250, step: 1, initial: 0, unit: "deg/s" },
      { kind: "knob", id: "IMU_GY", label: "Turn rate about Y (gyro)", input: "IMU_GY_DPS", min: -250, max: 250, step: 1, initial: 0, unit: "deg/s" },
      { kind: "knob", id: "IMU_AX", label: "Acceleration X", input: "IMU_AX_G", min: -2, max: 2, step: 0.01, initial: 0, unit: "g" },
      { kind: "knob", id: "IMU_AY", label: "Acceleration Y", input: "IMU_AY_G", min: -2, max: 2, step: 0.01, initial: 0, unit: "g" },
      { kind: "knob", id: "IMU_AZ", label: "Acceleration Z", input: "IMU_AZ_G", min: -2, max: 2, step: 0.01, initial: 1, unit: "g" },
      { kind: "knob", id: "DAN_ADC1", label: "DAN28027 ADC input 1", input: "DAN_ADC1", min: 0, max: 3.3, step: 0.01, initial: 0, unit: "V" },
      { kind: "knob", id: "DAN_ADC2", label: "DAN28027 ADC input 2", input: "DAN_ADC2", min: 0, max: 3.3, step: 0.01, initial: 0, unit: "V" },
      { kind: "meter", id: "DAN_PWM1", label: "DAN28027 PWM 1 compare", output: "DAN_PWM1", unit: "counts", digits: 0 },
      { kind: "meter", id: "DAN_PWM2", label: "DAN28027 PWM 2 compare", output: "DAN_PWM2", unit: "counts", digits: 0 },
    ],
  },
};
