// The two slave devices on the robot's SPIB bus (GPIO63 SIMO, GPIO64 SOMI,
// GPIO65 CLK), each with its own chip select:
//
// MPU-9250 inertial measurement unit, chip select GPIO66. From the "MPU-9250
// Register Map and Descriptions" (RM-MPU-9250A-00 rev 1.4) and the course's
// SPI notes (HW3):
// - Every transfer starts with one byte: bit 7 = 1 to read, 0 to write, bits
//   6..0 the register address. The bytes that follow are data, and the
//   address goes up by one after each (burst access). With the course's
//   16-bit words the first word is address + first data byte.
// - Reset values are 0x00 except PWR_MGMT_1 (0x6B) = 0x01 and WHO_AM_I (0x75)
//   = 0x71. (The register's own page prints "Reset value: 0x68" above the
//   sentence "The default value of the register is 0x71"; 0x71 is right for
//   the MPU-9250, 0x68 belongs to the older MPU-6050.)
// - ACCEL_XOUT_H (0x3B) .. GYRO_ZOUT_L (0x48): accel X, Y, Z, temperature,
//   gyro X, Y, Z as signed 16-bit values, high byte first. Full scale from
//   ACCEL_CONFIG (0x1C) bits 4:3 (+-2, 4, 8, 16 g) and GYRO_CONFIG (0x1B)
//   bits 4:3 (+-250, 500, 1000, 2000 deg/s): raw = value * 32768 / range.
//   TEMP_OUT = (degC - 21) * 333.87.
// - Data is latched on the rising edge of SCLK and changes on the falling
//   edge; the clock may idle low or high. In the F28379D's bits that is
//   CLKPOLARITY = 0, CLK_PHASE = 1 (the course's setting) or CLKPOLARITY = 1,
//   CLK_PHASE = 0.
// - SCLK up to 1 MHz (20 MHz only for reading the sensor registers).
// Not modelled: the digital low-pass filter and sample rate divider, sleep
// mode, the FIFO, the magnetometer, and the offset registers (stored, but
// they do not move the outputs).
//
// DAN28027 co-processor (a TI F28027 on the robot board), chip select GPIO29.
// From its firmware (F28027Code/PWMF28027/PWMF28027.c, SPI_RXint): 16-bit
// words, clock mode CLKPOLARITY = 0, CLK_PHASE = 1. The master sends 0x00DA,
// then two PWM compare values (limited to 0..3000). The firmware answers one
// word late, because it loads each reply in its receive interrupt: the
// master reads [whatever was left, ADC0, ADC2]. It needs a few microseconds
// for that between words, which is why the course sets SPIFFCT.TXDLY = 16
// for this device; without the gap the replies arrive a word late.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import { registerSpiDevice, type SpiDevice } from "./spi";

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

const int16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x))) & 0xffff;

export interface SpiDevicesState {
  /** MPU-9250 register file (sensor outputs are computed when read). */
  mpuRegs: Uint8Array;
  /** Register writes the MPU-9250 received: [address, value]. */
  mpuWrites: [number, number][];
  /** Complete commands the DAN28027 received. */
  danCommands: number;
}

function install(b: Board): void {
  const state: SpiDevicesState = { mpuRegs: new Uint8Array(128), mpuWrites: [], danCommands: 0 };
  b.plugins.set("spi_devices", state);

  // ---------------- MPU-9250 ----------------
  const regs = state.mpuRegs;
  const powerOn = () => {
    regs.fill(0);
    regs[0x6b] = 0x01;
    regs[0x75] = 0x71;
  };
  powerOn();
  const sensor = (i: number): number => {
    const accel = 2 << ((regs[0x1c] >> 3) & 3);
    const gyro = 250 << ((regs[0x1b] >> 3) & 3);
    switch (i) {
      case 0: return int16((b.input("IMU_AX_G", 0) * 32768) / accel);
      case 1: return int16((b.input("IMU_AY_G", 0) * 32768) / accel);
      case 2: return int16((b.input("IMU_AZ_G", 1) * 32768) / accel);
      case 3: return int16((b.input("IMU_TEMP_C", 25) - 21) * 333.87);
      case 4: return int16((b.input("IMU_GX_DPS", 0) * 32768) / gyro);
      case 5: return int16((b.input("IMU_GY_DPS", 0) * 32768) / gyro);
      default: return int16((b.input("IMU_GZ_DPS", 0) * 32768) / gyro);
    }
  };
  const readReg = (a: number): number => {
    if (a >= 0x3b && a <= 0x48) {
      const v = sensor((a - 0x3b) >> 1);
      return (a - 0x3b) & 1 ? v & 0xff : v >> 8;
    }
    if (a === 0x3a) return 0x01; // INT_STATUS: raw data ready
    return regs[a];
  };
  let addrPhase = true;
  let reading = false;
  let addr = 0;
  const mpu = shifter(
    8,
    () => (addrPhase || !reading ? 0x00 : readReg(addr)),
    (byte, _t, bitNs) => {
      if (addrPhase) {
        addrPhase = false;
        reading = (byte & 0x80) !== 0;
        addr = byte & 0x7f;
        return;
      }
      if (bitNs > 0 && bitNs < 999 && !(reading && addr >= 0x3a && addr <= 0x48))
        b.warn(b.line, "mpu-too-fast", `The MPU-9250 was clocked at ${(1000 / bitNs).toFixed(1)} MHz. Its limit is 1 MHz (only the sensor registers may be read faster). The bit rate is LSPCLK / (SPIBRR + 1) with LSPCLK = 50 MHz: make SpibRegs.SPIBRR.bit.SPI_BIT_RATE large enough for 1 MHz or less. The library's setupSpib() sets 1 MHz.`);
      if (!reading) {
        state.mpuWrites.push([addr, byte]);
        b.mem.writes++;
        if (addr === 0x6b && byte & 0x80) powerOn(); // H_RESET
        else if (!((addr >= 0x3a && addr <= 0x60) || addr === 0x75)) regs[addr] = byte; // those are read-only
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
    transfer: mpu.transfer,
    select() {
      mpu.reset();
      addrPhase = true;
    },
  };
  registerSpiDevice(b, mpuDevice);

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
