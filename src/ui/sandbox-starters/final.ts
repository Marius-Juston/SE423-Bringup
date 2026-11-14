// The Sandbox's "final project" starting program for the robot board.
// Written for this game, with the structure of the course's final project
// starter: a 1 ms chain of interrupts (EPWM4 -> ADCC -> SPIB -> software
// interrupt) that reads the IMU and the encoders, keeps the robot's pose,
// steers through a list of points and drives the motors, with the LADAR and
// the CAN distance sensors as a guard. The OptiTrack, camera, LabVIEW and
// Raspberry Pi parts of the course project are left out (not simulated).
import type { SandboxStarter } from "./index";

export const starter: SandboxStarter & { stimuli: { at: number; set: string; value: number }[] } = {
  id: "final",
  label: "Robot through waypoints (final project starter)",
  kit: "robot",
  about:
    "After one second of gyro calibration the robot drives around a square of four points, using the encoders and the gyro for its pose, and stops while the LADAR or a CAN distance sensor sees something close ahead: watch it in the robot arena, place an object in its way, hold PB1 or PB2 for other LCD pages.",
  watch: ["statePos", "vref", "turn", "LeftVel", "RightVel", "LADARfront", "dis_1", "gyroz"],
  // The robot stands in the arena, so driving moves it and the LADAR sees the walls come closer.
  stimuli: [{ at: 0, set: "ROBOT_WORLD", value: 1 }],
  source: String.raw`// Final project starter for the robot board.
// Every 1 ms, one after the other:
//   EPWM4 starts the ADC conversions of ADCC
//   ADCC_ISR: asks the IMU (MPU-9250) for its readings over SPIB
//   SPIB_isr: the readings have arrived; requests the software interrupt 1
//   SWI1_HighestPriority: the control loop. Gyro and encoders give the
//       robot's pose, xy_control() steers to the next point, PIcontrol()
//       turns speed and turn commands into the two motor efforts
// Besides that:
//   Timer 1, every 100 ms: asks the LADAR for a scan
//   SWI2_MiddlePriority: after each scan, the distance ahead and to the right
//   can_isr: a distance from one of the two CAN sensors
//   main(): prints on the LCD five times a second
// xy_control, PIcontrol, the init_ and readEnc functions, setEPWM1A/2A and
// setupSpib come from the board's library (SE423Lib).

#define PI 3.1415926535897932384626433832795
#define LAUNCHPAD_CPU_FREQUENCY 200
#define FT_PER_RAD (1.235/12.0)   // feet the robot moves per radian of wheel turn
#define NUMWAYPOINTS 4
#define RX_MSG_OBJ_ID_1 1         // CAN mailbox for the distance of sensor 1
#define RX_MSG_OBJ_ID_2 2         // and of sensor 2

__interrupt void cpu_timer1_isr(void);
__interrupt void ADCC_ISR(void);
__interrupt void SPIB_isr(void);
__interrupt void SWI1_HighestPriority(void);
__interrupt void SWI2_MiddlePriority(void);
__interrupt void can_isr(void);

// Kept by the board's library.
extern datapts ladar_data[228];   // angle, distance_ping, distance_pong of each point
extern uint16_t LADARpingpong;    // which of the two the library is filling
extern uint16_t rxMsgData[8];     // the bytes of the last CAN message read

char G_command[] = "G04472503\n";   // LADAR: send points -120 to 120 degrees
uint16_t G_len = 11;
float LADARfront = 19;        // feet; 19 is more than the LADAR can measure
float LADARrightfront = 19;
uint16_t LADARi = 0;

uint32_t dis_1 = 4000;        // CAN distance sensors, millimetres
uint32_t dis_2 = 4000;

int16_t readdata[8];          // the eight words the IMU sends back
float gyroz = 0;              // turn rate, degrees per second
float gyroz_offset = 0;       // what the gyro shows while standing still
int32_t calibration_count = 0;
int16_t doneCal = 0;

float LeftWheel = 0;          // wheel angles, radians
float RightWheel = 0;
float LeftWheel_1 = 0;        // the angles 1 ms ago
float RightWheel_1 = 0;
float LeftVel = 0;            // wheel speeds, feet per second
float RightVel = 0;
float vref = 0;               // wanted speed, feet per second
float turn = 0;               // wanted turn; positive turns right
float uLeft = 0;              // motor efforts, -10 to 10
float uRight = 0;

pose ROBOTps = {0, 0, 0};     // where the robot thinks it is: feet, feet, radians
pose robotdest[NUMWAYPOINTS]; // the points to drive to, one after the other
uint16_t statePos = 0;        // which point is next

uint32_t timecount = 0;
uint16_t UARTPrint = 0;

void main(void)
{
    InitSysCtrl();   // clocks: always first
    InitGpio();
    InitSE423DefaultGPIO();   // LEDs, push buttons and chip selects of the robot board

    // CAN-B on GPIO17 (receive) and GPIO12 (transmit), 1 Mbit/s.
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);
    InitCANB();
    setCANBitRate(200000000, 1000000);
    CanbRegs.CAN_CTL.bit.IE0 = 1;   // CAN interrupt line 0 on
    CanbRegs.CAN_CTL.bit.EIE = 1;   // also for bus errors

    // Interrupts off while they are set up.
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    // Tell the chip which function runs for which interrupt.
    EALLOW;
    PieVectTable.TIMER1_INT = &cpu_timer1_isr;
    PieVectTable.SCIB_RX_INT = &RXBINT_recv_ready;   // the LCD
    PieVectTable.SCIB_TX_INT = &TXBINT_data_sent;
    PieVectTable.SCIC_RX_INT = &RXCINT_recv_ready;   // the LADAR
    PieVectTable.SCIC_TX_INT = &TXCINT_data_sent;
    PieVectTable.ADCC1_INT = &ADCC_ISR;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    // Two vectors the chip never uses itself: the course runs software
    // interrupts on them (PostSWI1() and the library's LADAR code request them).
    PieVectTable.EMIF_ERROR_INT = &SWI1_HighestPriority;
    PieVectTable.RAM_CORRECTABLE_ERROR_INT = &SWI2_MiddlePriority;
    PieVectTable.CANB0_INT = &can_isr;
    EDIS;

    // Timer 1 every 100 ms (the period is in microseconds).
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, LAUNCHPAD_CPU_FREQUENCY, 100000);
    CpuTimer1Regs.TCR.all = 0x4000;   // start with the interrupt enabled

    init_serialSCIB(&SerialB, 19200);   // the LCD
    init_serialSCIC(&SerialC, 19200);   // a LADAR just switched on talks at 19200 baud

    // The angle of each LADAR point never changes. Point 114 looks straight ahead.
    for (LADARi = 0; LADARi < 228; LADARi++) {
        ladar_data[LADARi].angle = ((3*LADARi + 44)*0.3515625 - 135)*0.01745329;
    }

    init_eQEPs();          // the wheel encoders
    init_EPWM1and2();      // the motor PWM, both motors stopped
    init_ADCsAndDACs();    // ADCC converts when EPWM4 says so, then interrupts
    setupSpib();           // SPIB for the IMU

    // EPWM4 only keeps time: every 50000 counts of its 50 MHz clock (1 ms)
    // it sends a start-of-conversion pulse (SOCA) to ADCC.
    EALLOW;
    EPwm4Regs.ETSEL.bit.SOCAEN = 0;
    EPwm4Regs.TBCTL.bit.CTRMODE = 3;    // counter stopped for now
    EPwm4Regs.ETSEL.bit.SOCASEL = 2;    // pulse when the counter reaches TBPRD
    EPwm4Regs.ETPS.bit.SOCAPRD = 1;
    EPwm4Regs.TBCTR = 0;
    EPwm4Regs.TBPHS.bit.TBPHS = 0;
    EPwm4Regs.TBCTL.bit.PHSEN = 0;
    EPwm4Regs.TBCTL.bit.CLKDIV = 0;
    EPwm4Regs.TBPRD = 50000;
    EPwm4Regs.ETSEL.bit.SOCAEN = 1;
    EDIS;

    IER |= M_INT1;    // ADCC
    IER |= M_INT6;    // SPIB
    IER |= M_INT8;    // SCIC
    IER |= M_INT9;    // SCIB and CAN-B
    IER |= M_INT12;   // the software interrupts
    IER |= M_INT13;   // Timer 1
    PieCtrlRegs.PIEIER1.bit.INTx3 = 1;     // ADCC1
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;     // SPIB receive
    PieCtrlRegs.PIEIER12.bit.INTx9 = 1;    // software interrupt 1
    PieCtrlRegs.PIEIER12.bit.INTx10 = 1;   // software interrupt 2
    PieCtrlRegs.PIEIER9.bit.INTx7 = 1;     // CAN-B
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;

    // A square, 5 ft on a side, around the place where the robot starts.
    // x is ahead of the robot as it stands at the start, y to its left.
    robotdest[0].x = 2.5;     robotdest[0].y = 2.5;
    robotdest[1].x = -2.5;    robotdest[1].y = 2.5;
    robotdest[2].x = -2.5;    robotdest[2].y = -2.5;
    robotdest[3].x = 2.5;     robotdest[3].y = -2.5;

    EPwm4Regs.TBCTL.bit.CTRMODE = 0;   // EPWM4 counts: the 1 ms chain starts

    EINT;   // interrupts on

    // Two CAN mailboxes: the distance messages of sensor 1 and of sensor 2.
    CANsetupMessageObject(CANB_BASE, RX_MSG_OBJ_ID_1, 0x060b0101, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE, 8);
    CANsetupMessageObject(CANB_BASE, RX_MSG_OBJ_ID_2, 0x060b0102, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE, 8);
    CanbRegs.CAN_CTL.bit.Init = 0;   // CAN-B joins the bus
    CanbRegs.CAN_CTL.bit.CCE = 0;

    // Tell the LADAR to change to 115200 baud, wait a second, then follow it.
    char S_command[19] = "S1152000124000\n";
    serial_sendSCIC(&SerialC, S_command, 19);
    DELAY_US(1000000);
    init_serialSCIC(&SerialC, 115200);

    while (1) {
        if (UARTPrint == 1) {
            if (readbuttons() == 0) {
                UART_printfLine(1, "Vrf:%.2f trn:%.2f", vref, turn);
                UART_printfLine(2, "F%.2f R%.2f", LADARfront, LADARrightfront);
            } else if (readbuttons() == 1) {   // PB1 held
                UART_printfLine(1, "x:%.2f y:%.2f", ROBOTps.x, ROBOTps.y);
                UART_printfLine(2, "th:%.2f next:%d", ROBOTps.theta, statePos);
            } else {                           // another button held
                UART_printfLine(1, "D1 %ld D2 %ld", dis_1, dis_2);
                UART_printfLine(2, "gyro %.2f", gyroz);
            }
            UARTPrint = 0;
        }
    }
}

// Every 1 ms, when ADCC has finished: ask the IMU for 8 words starting at
// its register 0x3A (status, acceleration x y z, temperature, gyro x y z).
__interrupt void ADCC_ISR(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;    // chip select of the IMU low
    SpibRegs.SPIFFRX.bit.RXFFIL = 8;         // interrupt when 8 words are back
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);   // read, starting at 0x3A
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;
    SpibRegs.SPITXBUF = 0;

    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// The 8 words of the IMU have arrived.
__interrupt void SPIB_isr(void)
{
    uint16_t k;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;   // chip select high: transfer over
    for (k = 0; k < 8; k++) {
        readdata[k] = SpibRegs.SPIRXBUF;
    }
    PostSWI1();   // run the control loop, at a lower priority than this function

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

// Every 100 ms: ask the LADAR for a scan.
__interrupt void cpu_timer1_isr(void)
{
    serial_sendSCIC(&SerialC, G_command, G_len);
    CpuTimer1.InterruptCount++;
}

// The control loop, every 1 ms.
__interrupt void SWI1_HighestPriority(void)
{
    // These lines let every more urgent interrupt interrupt this function.
    volatile Uint16 TempPIEIER = PieCtrlRegs.PIEIER12.all;
    IER |= M_INT12;
    IER &= MINT12;                         // only more urgent CPU interrupts
    PieCtrlRegs.PIEIER12.all &= MG12_9;    // only more urgent ones of group 12
    PieCtrlRegs.PIEACK.all = 0xFFFF;
    __asm("  NOP");
    EINT;

    // Word 7 is the gyro's Z axis: 32767 is 250 degrees per second.
    gyroz = readdata[7]*250.0/32767.0;

    if (doneCal == 0) {
        // First second: stand still and average what the gyro shows.
        gyroz_offset += gyroz;
        calibration_count++;
        if (calibration_count == 1000) {
            gyroz_offset = gyroz_offset/1000.0;
            doneCal = 1;
        }
    } else {
        gyroz = gyroz - gyroz_offset;
        LeftWheel = readEncLeft();
        RightWheel = readEncRight();
        LeftVel = FT_PER_RAD*(LeftWheel - LeftWheel_1)*1000;
        RightVel = FT_PER_RAD*(RightWheel - RightWheel_1)*1000;

        // Pose: the gyro gives the heading, the wheels the distance (0.001 s per step).
        ROBOTps.theta = ROBOTps.theta + gyroz*(PI/180.0)*0.001;
        ROBOTps.x = ROBOTps.x + 0.5*(LeftVel + RightVel)*cosf(ROBOTps.theta)*0.001;
        ROBOTps.y = ROBOTps.y + 0.5*(LeftVel + RightVel)*sinf(ROBOTps.theta)*0.001;

        // Steer to the next point. xy_control returns 1 when the robot is near it.
        if (xy_control(&vref, &turn, 1.0, ROBOTps.x, ROBOTps.y, robotdest[statePos].x,
                       robotdest[statePos].y, ROBOTps.theta, 0.25, 0.5)) {
            statePos = (statePos + 1) % NUMWAYPOINTS;
        }

        // Guard: something within 1 ft ahead (LADAR) or 300 mm (CAN sensor 1)? Wait.
        if ((LADARfront < 1.0) || (dis_1 < 300)) {
            vref = 0;
            turn = 0;
        }

        // Speed and turn commands to motor efforts, then to the PWM.
        PIcontrol(&uLeft, &uRight, vref, turn, LeftWheel, RightWheel);
        setEPWM1A(uLeft);
        setEPWM2A(-uRight);   // the right motor is mounted the other way round
        LeftWheel_1 = LeftWheel;
        RightWheel_1 = RightWheel;
    }

    timecount++;
    if ((timecount % 200) == 0) {
        if (doneCal == 0) {
            GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;   // blue LED while calibrating
        }
        GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;       // red LED always
        UARTPrint = 1;
    }

    // Put the interrupt enables back as they were.
    DINT;
    PieCtrlRegs.PIEIER12.all = TempPIEIER;
}

// Runs after each complete LADAR scan.
__interrupt void SWI2_MiddlePriority(void)
{
    volatile Uint16 TempPIEIER = PieCtrlRegs.PIEIER12.all;
    IER |= M_INT12;
    IER &= MINT12;
    PieCtrlRegs.PIEIER12.all &= MG12_10;
    PieCtrlRegs.PIEACK.all = 0xFFFF;
    __asm("  NOP");
    EINT;

    // The scan that just finished is the one LADARpingpong does not name.
    // Right front: the smallest of points 52 to 56. Front: 111 to 115.
    LADARrightfront = 19;
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

    DINT;
    PieCtrlRegs.PIEIER12.all = TempPIEIER;
}

// A CAN message arrived (or the bus status changed).
__interrupt void can_isr(void)
{
    uint32_t status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        status = CANgetStatus(CANB_BASE);   // reading the status clears it
    } else if (status == RX_MSG_OBJ_ID_1) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        dis_1 = 256*rxMsgData[1] + rxMsgData[0];   // bytes 0 and 1: millimetres
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
    } else if (status == RX_MSG_OBJ_ID_2) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_2, rxMsgData);
        dis_2 = 256*rxMsgData[1] + rxMsgData[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_2);
    }

    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
`,
};
