// The Sandbox's "LADAR" starting program for the robot board. Written for
// this game, with the structure of the course's LADAR starter project: a
// timer asks for scans, the library fills ladar_data, a software interrupt
// finds the distances ahead and to the right, main() prints them on the LCD.
// The Raspberry Pi link of the course project is left out (not simulated).
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter = {
  id: "ladar",
  label: "LADAR distances (LADAR starter)",
  kit: "robot",
  about:
    "Every 100 ms the program asks the LADAR for a scan and the LCD shows the distance to the wall ahead (F) and to the right front (R), in feet: place an object in the arena and watch F change.",
  watch: ["LADARfront", "LADARrightfront", "LADARpingpong", "numScans"],
  source: String.raw`// LADAR starter for the robot board.
// The LADAR measures 228 distances over 240 degrees and sends them on SCIC.
//   Timer 1, every 100 ms: asks the LADAR for a scan (G_command)
//   the library's SCIC receive function: stores each distance, in feet, in
//       ladar_data and requests a software interrupt when a scan is complete
//   SWI2_MiddlePriority: finds the smallest distance ahead and to the right
//   Timer 2, every 1 ms: asks main() for an LCD print every 100 ms
// The scans go in turn to distance_ping and distance_pong, so one of the two
// is always complete while the other is being filled. LADARpingpong says
// which one is being filled now.

#define LAUNCHPAD_CPU_FREQUENCY 200

__interrupt void cpu_timer1_isr(void);
__interrupt void cpu_timer2_isr(void);
__interrupt void SWI2_MiddlePriority(void);

// Kept by the board's library.
extern datapts ladar_data[228];   // angle, distance_ping, distance_pong of each point
extern char G_command[];          // "G04472503\n": points -120 to 120 degrees
extern uint16_t G_len;
extern uint16_t LADARpingpong;
extern float LADARfront;          // feet
extern float LADARrightfront;     // feet

uint16_t UARTPrint = 0;   // set by Timer 2, cleared by main() after it printed
uint32_t numScans = 0;
uint16_t LADARi = 0;

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

    // Tell the chip which function runs for which interrupt.
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.TIMER2_INT = &cpu_timer2_isr;
    // The board's library receives and sends the characters of the LADAR.
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;
    PieVectTable.SCIC_TX_INT = &TXCINT_data_sent;
    // A vector the chip never uses itself: the course runs a software
    // interrupt on it. The library requests it after each complete scan.
    PieVectTable.RAM_CORRECTABLE_ERROR_INT = &SWI2_MiddlePriority;
    EDIS;

    // The period is in microseconds.
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    ConfigCpuTimer(&CpuTimer2, LAUNCHPAD_CPU_FREQUENCY, 1000);
    CpuTimer1Regs.TCR.all = 0x4000;   // start with the interrupt enabled
    CpuTimer2Regs.TCR.all = 0x4000;

    // A LADAR that was just switched on talks at 19200 baud.
    init_serialSCIC(&SerialC, 19200);

    // The angle of each point never changes. Point 114 looks straight ahead.
    // 0.3515625 is 360/1024 (degrees per step), 0.01745329 is pi/180.
    for (LADARi = 0; LADARi < 228; LADARi++) {
        ladar_data[LADARi].angle = ((3*LADARi + 44)*0.3515625 - 135)*0.01745329;
    }

    IER |= M_INT8;    // SCIC
    IER |= M_INT12;   // the software interrupt
    IER |= M_INT13;   // Timer 1
    IER |= M_INT14;   // Timer 2
    PieCtrlRegs.PIEIER12.bit.INTx10 = 1;   // software interrupt: group 12, channel 10

    EINT;   // interrupts on

    // Tell the LADAR to change to 115200 baud, wait a second, then follow it.
    // Requests sent during that second are lost, as on the robot.
    char S_command[19] = "S1152000124000\n";
    serial_sendSCIC(&SerialC, S_command, 19);
    DELAY_US(1000000);
    init_serialSCIC(&SerialC, 115200);

    while (1) {
        if (UARTPrint == 1) {
            UART_printfLine(1, "Scans %ld", numScans);
            UART_printfLine(2, "F%.4f R%.4f", LADARfront, LADARrightfront);
            UARTPrint = 0;
        }
    }
}

// Every 100 ms: ask for a scan. The answer arrives over the next 41 ms.
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
    CpuTimer1.InterruptCount++;
}

// Every 1 ms.
__interrupt void cpu_timer2_isr(void)
{
    CpuTimer2.InterruptCount++;
    if ((CpuTimer2.InterruptCount % 100) == 0) {
        UARTPrint = 1;
    }
}

// Runs after each complete scan. It is slow, so the first lines let every
// more urgent interrupt (the timers, the serial ports) interrupt it.
__interrupt void SWI2_MiddlePriority(void)
{
    volatile Uint16 TempPIEIER = PieCtrlRegs.PIEIER12.all;
    IER |= M_INT12;
    IER &= MINT12;                          // only more urgent CPU interrupts
    PieCtrlRegs.PIEIER12.all &= MG12_10;    // only more urgent ones of group 12
    PieCtrlRegs.PIEACK.all = 0xFFFF;
    __asm("  NOP");
    EINT;

    numScans++;

    // The scan that just finished is the one LADARpingpong does not name.
    // Right front: the smallest of points 52 to 56. Front: 111 to 115.
    LADARrightfront = 19;   // more than the LADAR can measure
    LADARfront = 19;
    if (LADARpingpong == 1) {
        for (LADARi = 52; LADARi <= 56; LADARi++) {
            if (ladar_data[LADARi].distance_ping < LADARrightfront) {
                LADARrightfront = ladar_data[LADARi].distance_ping;
            }
        }
        for (LADARi = 111; LADARi <= 115; LADARi++) {
            if (ladar_data[LADARi].distance_ping < LADARfront) {
                LADARfront = ladar_data[LADARi].distance_ping;
            }
        }
    } else {
        for (LADARi = 52; LADARi <= 56; LADARi++) {
            if (ladar_data[LADARi].distance_pong < LADARrightfront) {
                LADARrightfront = ladar_data[LADARi].distance_pong;
            }
        }
        for (LADARi = 111; LADARi <= 115; LADARi++) {
            if (ladar_data[LADARi].distance_pong < LADARfront) {
                LADARfront = ladar_data[LADARi].distance_pong;
            }
        }
    }

    // Put back what the first lines changed.
    DINT;
    PieCtrlRegs.PIEIER12.all = TempPIEIER;
}
`,
};
