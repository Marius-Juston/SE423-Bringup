import type { Chapter } from "../types";

// ---------------------------------------------------------------- I2C code

// I2CB set-up used by the I2C levels: pins, then the clock (TRM 20.1.4, 20.1.5).
const I2C_INIT = `// I2CB: SDAB on GPIO40, SCLB on GPIO41 (mux position 6), SCL at 100 kHz
void init_I2CB(void)
{
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(41, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);

    I2cbRegs.I2CMDR.bit.IRS = 0;    // keep the module in reset while it is set up
    I2cbRegs.I2CPSC.all = 19;       // module clock = 200 MHz / (19 + 1) = 10 MHz
    I2cbRegs.I2CCLKL = 45;          // SCL low  = (45 + 5) / 10 MHz = 5 us
    I2cbRegs.I2CCLKH = 45;          // SCL high = (45 + 5) / 10 MHz = 5 us
    I2cbRegs.I2CMDR.bit.IRS = 1;    // out of reset
}`;

const readTemperature = (o: { sar: string; cnt: string; mode: string; combine: string; todo: boolean }) => `// Reads the two temperature bytes of the sensor at address 0x48.
void read_temperature(void)
{
    uint16_t msb;
    uint16_t lsb;

${o.todo ? "    // TODO 1: the sensor's 7-bit address, and how many bytes to read\n" : ""}    I2cbRegs.I2CSAR.all = ${o.sar};
    I2cbRegs.I2CCNT = ${o.cnt};
${o.todo ? "    // TODO 2: START as a master-receiver, with a STOP after the last byte\n" : ""}    I2cbRegs.I2CMDR.all = ${o.mode};

    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}    // first byte has arrived
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}    // second byte has arrived
    lsb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}     // the STOP is on the bus

${o.todo ? "    // TODO 3: put the bytes together (msb first), then convert to degrees C\n" : ""}${o.combine}
    readings++;
}`;

const i2cRead = (fn: string) => `int16_t tempRaw = 0;     // the 16 bits the sensor sent
float tempC = 0;         // degrees C
uint16_t readings = 0;

${I2C_INIT}

${fn}

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_I2CB();

    while (1) {
        read_temperature();
        DELAY_US(2000);
    }
}
`;

const nackMain = (body: string) => `float tempA = -1000;     // sensor at 0x48
float tempB = -1000;     // sensor at 0x49 (not fitted yet)
uint16_t okA = 0;
uint16_t okB = 0;
uint16_t missA = 0;
uint16_t missB = 0;
uint16_t answered = 0;   // result of the last read_temp(): 1 = a sensor answered

${I2C_INIT}

// Reads the temperature of the sensor at 'address' into *degC and sets
// answered = 1. If nothing acknowledges the address: sets answered = 0.
void read_temp(uint16_t address, float *degC)
{
${body}
}

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_I2CB();

    while (1) {
        read_temp(0x48, &tempA);
        if (answered) okA++;
        else missA++;
        read_temp(0x49, &tempB);
        if (answered) okB++;
        else missB++;
        DELAY_US(1000);
    }
}
`;

const i2cDebug = (address: string, mode: string, comment: string) => `#define TMP_ADDRESS ${address}    ${comment}

int16_t tempRaw = 0;
float tempC = 0;
uint16_t readings = 0;
uint16_t nacks = 0;

${I2C_INIT}

void read_temperature(void)
{
    uint16_t msb;
    uint16_t lsb;

    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CSAR.all = TMP_ADDRESS;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = ${mode};

    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {
        if (I2cbRegs.I2CSTR.bit.NACK == 1) {
            // Nobody answered: give the bus back and clear the flag
            I2cbRegs.I2CMDR.bit.STP = 1;
            I2cbRegs.I2CSTR.all = 0x0002;
            nacks++;
            return;
        }
    }
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    lsb = I2cbRegs.I2CDRR.all;

    tempRaw = (msb << 8) | lsb;
    tempC = tempRaw / 256.0;
    readings++;
}

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_I2CB();

    while (1) {
        read_temperature();
        DELAY_US(2000);
    }
}
`;

const i2cStuck = (wait: string, readMode: string) => `int16_t tempRaw = 0;
float tempC = 0;
uint16_t seconds = 0;
uint16_t cycles = 0;

${I2C_INIT}

// Temperature sensor at 0x48: two bytes, msb first
void read_temperature(void)
{
    uint16_t msb;
    uint16_t lsb;

    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    while (I2cbRegs.I2CSTR.bit.BB == 1) {}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;               // START, STOP, master, receive
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    lsb = I2cbRegs.I2CDRR.all;
    tempRaw = (msb << 8) | lsb;
    tempC = tempRaw / 256.0;
}

// Clock chip at 0x68: write the register number 0, then read that register
void read_seconds(void)
{
    uint16_t bcd;

${wait}    I2cbRegs.I2CSAR.all = 0x68;
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CDXR.all = 0x00;                 // register 0: seconds
    I2cbRegs.I2CMDR.all = 0x2620;               // START, master, transmit. No STOP:
    while (I2cbRegs.I2CSTR.bit.ARDY == 0) {}    // a repeated START follows
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CMDR.all = ${readMode};               // repeated START, master, receive
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    bcd = I2cbRegs.I2CDRR.all;
    seconds = 10 * (bcd >> 4) + (bcd & 0x0F);
}

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_I2CB();

    while (1) {
        read_temperature();
        read_seconds();
        cycles++;
        DELAY_US(1000);
    }
}
`;

// ---------------------------------------------------------------- CAN code

// LED1 to LED5 of the robot board as outputs, off.
const LEDS_INIT = `    // LED1 to LED5: outputs, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(95, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(95, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(97, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(97, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(111, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(111, GPIO_OUTPUT, GPIO_PUSHPULL);
`;

// The CAN part of main() in the final project starter, up to the PIE set-up.
const CAN_PINS_INIT = `    //GPIO17 - CANRXB
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    //GPIO12 - CANTXB
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);

    // Initialize the CAN controller, bit rate 1000 kbps
    InitCANB();
    setCANBitRate(200000000, 1000000);
    // Interrupt line 0, error and status change interrupts
    CanbRegs.CAN_CTL.bit.IE0 = 1;
    CanbRegs.CAN_CTL.bit.EIE = 1;

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

const CAN_START = `    // Start CAN module operations
    CanbRegs.CAN_CTL.bit.Init = 0;     // 0 = take part in the bus traffic
    CanbRegs.CAN_CTL.bit.CCE = 0;      // 0 = lock the bit-rate settings`;

const msgObject = (n: number, id: string) => `    CANsetupMessageObject(CANB_BASE, RX_MSG_OBJ_ID_${n}, ${id}, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE,
                          RX_MSG_DATA_LENGTH);`;

const canReceive = (o: { pie: string; object: string; decode: string; ack: string }) => `#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1  // measurement from sensor 1

__interrupt void can_isr(void);

volatile uint32_t rxMsgCount_1 = 0;
extern uint16_t rxMsgData[8];    // defined in F28379dCAN.c: one received byte per element
uint32_t dis_raw_1[2];
uint32_t dis_1 = 0;              // distance in mm
uint32_t measure_status_1 = 0;

void main(void)
{
    InitSysCtrl();
    InitGpio();

${CAN_PINS_INIT}

    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    EDIS;

${o.pie}

    // Enable the CAN interrupt signal
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;

${o.object}

${CAN_START}

    while (1) {
    }
}

__interrupt void can_isr(void)
{
    int i = 0;
    uint32_t status;

    // Read the CAN interrupt status to find the cause of the interrupt
    status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        // Controller status interrupt: reading the status clears it
        status = CANgetStatus(CANB_BASE);
    } else if (status == RX_MSG_OBJ_ID_1) {
        // Get the received message
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        for (i = 0; i < 2; i++) {
            dis_raw_1[i] = rxMsgData[i];
        }
${o.decode}
        measure_status_1 = rxMsgData[2];

        // Clear the message object interrupt
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
        rxMsgCount_1++;
    }

    // Clear the global interrupt flag for the CAN interrupt line
    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
${o.ack}
}
`;

const CAN_PIE_ENABLE = `    // Enable CANB in the PIE: Group 9 interrupt 7
    PieCtrlRegs.PIEIER9.bit.INTx7 = 1;
    IER |= M_INT9;`;

const canLeds = (isr: string, show: string) => `#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1  // measurement from sensor 1
#define RX_MSG_OBJ_ID_2       2  // measurement from sensor 2

__interrupt void can_isr(void);

extern uint16_t rxMsgData[8];
uint32_t dis_1 = 0;              // sensor 1 distance, mm
uint32_t dis_2 = 0;              // sensor 2 distance, mm
uint16_t newData = 0;            // set by can_isr when a distance has arrived

// Shows the distances on the LEDs
void show_distance(void)
{
${show}
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

${LEDS_INIT}
${CAN_PINS_INIT}

    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    EDIS;

${CAN_PIE_ENABLE}
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;

${msgObject(1, "0x060b0101")}
${msgObject(2, "0x060b0102")}

${CAN_START}

    while (1) {
        if (newData == 1) {
            newData = 0;
            show_distance();
        }
    }
}

__interrupt void can_isr(void)
{
${isr}
}
`;

const CAN_LEDS_ISR = `    uint32_t status;

    status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        status = CANgetStatus(CANB_BASE);
    } else if (status == RX_MSG_OBJ_ID_1) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        dis_1 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
        newData = 1;
    } else if (status == RX_MSG_OBJ_ID_2) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_2, rxMsgData);
        dis_2 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_2);
        newData = 1;
    }

    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);`;

const CAN_LEDS_SHOW = `    if (dis_1 < 1000) GpioDataRegs.GPASET.bit.GPIO22 = 1;
    else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    if (dis_1 < 600) GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    else GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    if (dis_1 < 300) GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    else GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    if (dis_2 < 300) GpioDataRegs.GPDSET.bit.GPIO111 = 1;
    else GpioDataRegs.GPDCLEAR.bit.GPIO111 = 1;`;

// Checkpoint: CAN distance (interrupt) + I2C temperature (polled) + serial report.
const checkpoint = (o: { object: string; isr: string; read: string; report: string }) => `#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1  // measurement from sensor 1

__interrupt void can_isr(void);

extern uint16_t rxMsgData[8];
uint32_t dis_1 = 0;              // sensor 1 distance, mm
uint16_t newDistance = 0;        // set by can_isr
int16_t tempRaw = 0;
float tempC = 0;                 // degrees C

${I2C_INIT}

// Reads the temperature sensor at I2C address 0x48 into tempC
void read_temperature(void)
{
${o.read}
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

${CAN_PINS_INIT}

    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;
    EDIS;

    init_serialSCIA(&SerialA, 115200);
    init_I2CB();

${CAN_PIE_ENABLE}
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;

${o.object}

${CAN_START}

    while (1) {
${o.report}
    }
}

__interrupt void can_isr(void)
{
${o.isr}
}
`;

const CHECKPOINT_READ = `    uint16_t msb;
    uint16_t lsb;

    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    lsb = I2cbRegs.I2CDRR.all;
    tempRaw = (msb << 8) | lsb;
    tempC = tempRaw / 256.0;`;

const CHECKPOINT_ISR = `    uint32_t status;

    status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        status = CANgetStatus(CANB_BASE);
    } else if (status == RX_MSG_OBJ_ID_1) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        dis_1 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
        newDistance = 1;
    }

    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);`;

// ------------------------------------------------------------ expert code

const BITBANG_STARTER = `uint16_t acks = 0;       // bytes the sensor acknowledged

// Release (1) or pull low (0) a bus line
void sda(uint16_t level)
{
}

void scl(uint16_t level)
{
}

// Sends one byte, most significant bit first, then clocks the ACK bit.
// Returns 1 if the receiver acknowledged.
uint16_t send_byte(uint16_t byte)
{
    return 0;
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Pins, START, four bytes, STOP

    while (1) {
    }
}
`;

const BITBANG_SOLUTION = `uint16_t acks = 0;       // bytes the sensor acknowledged

// Release (1) or pull low (0) a bus line
void sda(uint16_t level)
{
    if (level) GpioDataRegs.GPBSET.bit.GPIO40 = 1;
    else GpioDataRegs.GPBCLEAR.bit.GPIO40 = 1;
}

void scl(uint16_t level)
{
    if (level) GpioDataRegs.GPBSET.bit.GPIO41 = 1;
    else GpioDataRegs.GPBCLEAR.bit.GPIO41 = 1;
}

// Sends one byte, most significant bit first, then clocks the ACK bit.
// Returns 1 if the receiver acknowledged.
uint16_t send_byte(uint16_t byte)
{
    int16_t i;
    uint16_t ack;

    for (i = 7; i >= 0; i--) {
        sda((byte >> i) & 1);       // SDA changes while SCL is low
        DELAY_US(5);
        scl(1);                     // the device samples here
        DELAY_US(5);
        scl(0);
    }
    sda(1);                         // release SDA for the ninth clock
    DELAY_US(5);
    scl(1);
    DELAY_US(5);
    ack = (GpioDataRegs.GPBDAT.bit.GPIO40 == 0);
    scl(0);
    return ack;
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Latches high first, so the lines stay released when the pins become outputs
    GpioDataRegs.GPBSET.bit.GPIO40 = 1;
    GpioDataRegs.GPBSET.bit.GPIO41 = 1;
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(40, GPIO_OUTPUT, GPIO_OPENDRAIN | GPIO_PULLUP);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(41, GPIO_OUTPUT, GPIO_OPENDRAIN | GPIO_PULLUP);
    DELAY_US(10);

    // START: SDA falls while SCL is high
    sda(0);
    DELAY_US(5);
    scl(0);

    acks += send_byte(0x90);        // address 0x48, write
    acks += send_byte(0x03);        // register 3: high limit
    acks += send_byte(0x1E);        // 30 degrees
    acks += send_byte(0x80);        // + 0.5 degrees

    // STOP: SDA rises while SCL is high
    sda(0);
    DELAY_US(5);
    scl(1);
    DELAY_US(5);
    sda(1);

    while (1) {
    }
}
`;

const SCAN_STARTER = `uint16_t found[8];       // addresses that answered
uint16_t count = 0;      // how many
uint16_t scanDone = 0;   // set to 1 when the last address has been tried

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_serialSCIA(&SerialA, 115200);

    while (1) {
    }
}
`;

const SCAN_SOLUTION = `uint16_t found[8];       // addresses that answered
uint16_t count = 0;      // how many
uint16_t scanDone = 0;   // set to 1 when the last address has been tried

void init_I2CB(void)
{
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(41, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);

    I2cbRegs.I2CMDR.bit.IRS = 0;
    I2cbRegs.I2CPSC.all = 19;       // 10 MHz module clock
    I2cbRegs.I2CCLKL = 10;          // (10 + 5) + (5 + 5) = 25 -> 400 kHz
    I2cbRegs.I2CCLKH = 5;
    I2cbRegs.I2CMDR.bit.IRS = 1;
}

// Returns 1 if a device acknowledges this address
uint16_t probe(uint16_t address)
{
    uint16_t unused;

    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CSAR.all = address;
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CMDR.all = 0x2C20;               // read one byte, then STOP
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {
        if (I2cbRegs.I2CSTR.bit.NACK == 1) {
            I2cbRegs.I2CMDR.bit.STP = 1;
            I2cbRegs.I2CSTR.all = 0x0002;
            return 0;
        }
    }
    unused = I2cbRegs.I2CDRR.all;
    return 1;
}

void main(void)
{
    uint16_t address;
    uint16_t i;

    InitSysCtrl();
    InitGpio();
    init_serialSCIA(&SerialA, 115200);
    init_I2CB();

    for (address = 0x08; address <= 0x77; address++) {
        if (probe(address)) {
            if (count < 8) found[count] = address;
            count++;
        }
    }
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    scanDone = 1;

    for (i = 0; i < count && i < 8; i++) {
        serial_printf(&SerialA, "0x%02X\\r\\n", found[i]);
    }
    serial_printf(&SerialA, "%d devices\\r\\n", count);

    while (1) {
    }
}
`;

const MEDIAN_HEAD = `#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1  // measurement from sensor 1
#define RX_MSG_OBJ_ID_2       2  // measurement from sensor 2

__interrupt void can_isr(void);
__interrupt void cpu_timer0_isr(void);

extern uint16_t rxMsgData[8];
uint32_t dis1_med = 0;           // median of the last three distances of sensor 1, mm
uint32_t dis_2 = 0;              // latest distance of sensor 2, mm
uint16_t sensor2_ok = 0;         // 1 while sensor 2 is sending
`;

const MEDIAN_MAIN_TOP = `void main(void)
{
    InitSysCtrl();
    InitGpio();

    // LED1: output, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);

${CAN_PINS_INIT}

    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;
`;

const MEDIAN_STARTER = `${MEDIAN_HEAD}
${MEDIAN_MAIN_TOP}
    // Timer, interrupt enables, message objects, start of the CAN module

    while (1) {
    }
}

__interrupt void cpu_timer0_isr(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void can_isr(void)
{
}
`;

const MEDIAN_SOLUTION = `${MEDIAN_HEAD}
uint32_t last3[3];               // the last three distances of sensor 1
uint16_t next = 0;               // where the next one goes
uint16_t silent2_ms = 0;         // time since sensor 2's last frame

// Middle value of three
uint32_t median3(uint32_t a, uint32_t b, uint32_t c)
{
    if (a > b) {
        if (b > c) return b;
        if (a > c) return c;
        return a;
    }
    if (a > c) return a;
    if (b > c) return c;
    return b;
}

${MEDIAN_MAIN_TOP}
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 10000);     // every 10 ms
    CpuTimer0Regs.TCR.all = 0x4000;

    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;          // timer 0
    PieCtrlRegs.PIEIER9.bit.INTx7 = 1;          // CANB0
    IER |= M_INT1;
    IER |= M_INT9;
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;

${msgObject(1, "0x060b0101")}
${msgObject(2, "0x060b0102")}

${CAN_START}

    while (1) {
    }
}

__interrupt void cpu_timer0_isr(void)
{
    if (silent2_ms <= 250) {
        silent2_ms += 10;
    }
    if (silent2_ms > 250) {
        sensor2_ok = 0;
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void can_isr(void)
{
    uint32_t status;

    status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        status = CANgetStatus(CANB_BASE);
    } else if (status == RX_MSG_OBJ_ID_1) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        last3[next] = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        next++;
        if (next == 3) next = 0;
        dis1_med = median3(last3[0], last3[1], last3[2]);
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
    } else if (status == RX_MSG_OBJ_ID_2) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_2, rxMsgData);
        dis_2 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        silent2_ms = 0;
        sensor2_ok = 1;
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_2);
    }

    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);
}
`;

// ---- set-up from empty functions: bus-i2c-setup and bus-can-setup ----
const i2cSetup = (init: string, read: string) => `int16_t tempRaw = 0;     // the 16 bits the sensor sent
float tempC = 0;         // degrees C
uint16_t readings = 0;

// I2CB: SDAB on GPIO40, SCLB on GPIO41, SCL at 100 kHz
void init_I2CB(void)
{
${init}
}

// Reads the two temperature bytes of the sensor at address 0x48.
void read_temperature(void)
{
${read}
}

void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_I2CB();

    while (1) {
        read_temperature();
        DELAY_US(2000);
    }
}
`;

const I2C_SETUP_INIT = `    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(41, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);

    I2cbRegs.I2CMDR.bit.IRS = 0;    // keep the module in reset while it is set up
    I2cbRegs.I2CPSC.all = 19;       // module clock = 200 MHz / (19 + 1) = 10 MHz
    I2cbRegs.I2CCLKL = 45;          // SCL low  = (45 + 5) / 10 MHz = 5 us
    I2cbRegs.I2CCLKH = 45;          // SCL high = (45 + 5) / 10 MHz = 5 us
    I2cbRegs.I2CMDR.bit.IRS = 1;    // out of reset`;

const I2C_SETUP_READ = `    uint16_t msb;
    uint16_t lsb;

    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;               // START, STOP, master, receiver, out of reset

    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}    // first byte has arrived
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}    // second byte has arrived
    lsb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}     // the STOP is on the bus

    tempRaw = (msb << 8) | lsb;
    tempC = tempRaw / 256.0;
    readings++;`;

const canSetup = (body: string) => `#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1  // measurement from sensor 1

__interrupt void can_isr(void);

volatile uint32_t rxMsgCount_1 = 0;
extern uint16_t rxMsgData[8];    // defined in F28379dCAN.c: one received byte per element
uint32_t dis_1 = 0;              // distance in mm

void main(void)
{
    InitSysCtrl();
    InitGpio();

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

${body}

    while (1) {
    }
}

// Given: the interrupt function of "Hear sensor 1"
__interrupt void can_isr(void)
{
    uint32_t status;

    status = CANgetInterruptCause(CANB_BASE);

    if (status == CAN_INT_INT0ID_STATUS) {
        status = CANgetStatus(CANB_BASE);
    } else if (status == RX_MSG_OBJ_ID_1) {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        dis_1 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);
        rxMsgCount_1++;
    }

    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);
}
`;

const CAN_SETUP_BODY = `    //GPIO17 - CANRXB
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    //GPIO12 - CANTXB
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);

    // Initialize the CAN controller, bit rate 1000 kbps
    InitCANB();
    setCANBitRate(200000000, 1000000);
    // Interrupt line 0, error and status change interrupts
    CanbRegs.CAN_CTL.bit.IE0 = 1;
    CanbRegs.CAN_CTL.bit.EIE = 1;

    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    EDIS;

${CAN_PIE_ENABLE}
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;

    // Measured distance from sensor 1
${msgObject(1, "0x060b0101")}

${CAN_START}`;

export const ch14: Chapter = {
  id: "buses",
  number: 14,
  title: "I2C and CAN",
  blurb: "Shared buses, addresses and arbitration.",
  requires: ["serial"],
  course: ["L10", "HW4"],
  levels: [
    {
      id: "bus-brief",
      kind: "brief",
      title: "Many devices, two wires",
      goal: "See why a shared bus saves pins and how I2C and CAN compare with UART and SPI, then answer three questions.",
      refs: [{ course: "L10" }, { trm: "20.1" }, { trm: "22.1" }],
      brief: `
A UART joins two devices. A robot has many sensors, and a pair of pins for each would use up the chip. A **bus** is a set of wires that all devices share: every device hears everything, and the **protocol** (the agreed rules) decides who may talk and who is meant. On most buses one device, the **master**, starts every transfer, and the others, the **slaves**, only answer.

This chapter covers **I2C**, for chips on the same board, and **CAN**, for boxes joined by a cable.

## Four ways to send bits
- **UART**: 2 wires, 2 devices. No clock wire: both ends agree on the baud rate (**asynchronous**).
- **SPI** (the SPI chapter): a clock wire, data out and data in, plus **one chip-select wire per slave**, which the master pulls low to pick that slave. The master makes the clock, which tells the receiver when to read each bit (**synchronous**).
- **I2C**: 2 wires for **all** devices: **SDA** (data) and **SCL** (clock). The master makes the clock. The slave is chosen by a **7-bit address** sent as the first byte. 100 kbit/s, or 400 kbit/s in fast mode.
- **CAN**: 2 wires (CANH and CANL) for all devices, carrying one signal as a voltage **difference**, which resists electrical noise. No clock wire, no master and no device addresses: each message carries an **identifier** that says what it contains. Up to 1 Mbit/s.

UART and SPI are **full duplex**: both directions at the same time. I2C and CAN are **half duplex**: one direction at a time on the same wires.

Compare them in the figure: add a device and count the wires.

{{figure:bus-compare}}

## What makes sharing possible
If one device drove a shared wire to 3.3 V while another drove it to 0 V, that would be a short circuit. I2C and CAN avoid this in the same way: a device can only pull the bus to **0**. To send a 1 it lets go, and a pull-up resistor returns the bus to 1. A 0 from anyone wins. An output built this way is called **open-drain**.

Try it in the figure: let two devices pull the same line low, then release one of them.

{{figure:i2c-bus}}

## On the robot
- I2CB is on GPIO40 (SDAB) and GPIO41 (SCLB). In this game a temperature sensor answers at address 0x48 and a clock chip at 0x68.
- CAN-B is on GPIO12 (CANTXB) and GPIO17 (CANRXB). The final project reads two distance sensors through it.
`,
      questions: [
        {
          prompt: "A robot has 15 sensors and one master. How many pins of the microcontroller does each bus need?",
          options: [
            "SPI 4, I2C 2",
            "SPI 18 (3 shared + 15 chip selects), I2C 2",
            "SPI 18, I2C 30 (2 per sensor)",
            "SPI 15, I2C 15",
          ],
          answer: 1,
          why: "SPI shares clock and the two data wires but needs one chip-select per slave: 3 + 15 = 18. I2C uses SDA and SCL for all of them, because the slave is chosen by an address sent on the bus.",
        },
        {
          prompt: "Which two of the four have no clock wire?",
          options: ["SPI and I2C", "UART and I2C", "UART and CAN", "SPI and CAN"],
          answer: 2,
          why: "UART and CAN are asynchronous: each end times the bits from an agreed bit rate. SPI and I2C are synchronous: the master sends a clock.",
        },
        {
          prompt: "Two devices on a shared bus send at the same moment, one a 0 and one a 1. Why is nothing damaged on I2C or CAN?",
          options: [
            "The devices are too slow to notice",
            "A device only ever pulls the bus to 0; for a 1 it lets go, so the bus simply shows 0",
            "The one sending 1 uses a higher voltage and wins",
            "A fuse on the bus opens",
          ],
          answer: 1,
          why: "Nobody drives the bus high. The device sending 1 has let go, the one sending 0 pulls low, and the bus is 0. No output fights another.",
        },
      ],
      takeaway: "SPI spends one pin per device; I2C and CAN spend two wires in total, and pay with addresses, identifiers and rules for taking turns.",
    },
    {
      id: "bus-i2c-start",
      kind: "timing",
      title: "START, address, ACK, STOP",
      goal: "Draw SDA while the master calls the sensor at address 0x48 for writing and then stops.",
      refs: [{ course: "L10" }, { trm: "20.3.2" }, { trm: "20.3.4" }, { trm: "20.3.5" }],
      brief: `
SCL is drawn for you. Draw **SDA**. Each bit takes two cells: SCL low, then SCL high.

The rules:

- **Idle**: both lines are high.
- **START** (S): SDA falls **while SCL is high**.
- **Data bits**: SDA may change only while SCL is **low**. It must hold still while SCL is high, because that is when the receiver reads it. So the two cells of one bit have the same SDA level.
- The first byte is the **7-bit address, most significant bit first**, then the **R/W bit**: 0 = the master writes, 1 = the master reads.
- **ACK** (ninth clock): the master lets go of SDA and the addressed device pulls it **low** to say "I am here". SDA staying high is a NACK: nobody answered.
- **STOP** (P): SDA rises **while SCL is high**. So SDA must be low first.

See the rules at work in the figure: choose "step through a transfer" and watch who pulls SDA at each bit.

{{figure:i2c-bus}}

The address is 0x48 = \`100 1000\` (7 bits). The master wants to **write**. The sensor is there and acknowledges.

The columns are: idle, S, address bits 6 to 0, W (the R/W bit), A (the ACK bit), then the STOP: one cell with SCL low, one with SCL high, and idle again.
`,
      slots: ["idle", "S", "6", "6", "5", "5", "4", "4", "3", "3", "2", "2", "1", "1", "0", "0", "W", "W", "A", "A", "-", "P", "idle"],
      rows: [
        {
          name: "SCL",
          editable: false,
          initial: [1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
          answer: [1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
        },
        {
          name: "SDA",
          editable: true,
          initial: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          answer: [1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        },
      ],
      hints: [
        "S is low: SDA has fallen while SCL is still high. The last cell is high again: SDA rose while SCL was high, which is the STOP.",
        "Address bits 6 to 0 are 1, 0, 0, 1, 0, 0, 0. Fill both cells of each bit with the same level.",
        "High cells: idle, both cells of bit 6, both cells of bit 3, the last idle. Everything else is low, including W (write), A (the sensor's ACK) and the two STOP cells.",
      ],
      takeaway: "Data changes while SCL is low. SDA moving while SCL is high is never data: falling is a START, rising is a STOP.",
    },
    {
      id: "bus-i2c-read",
      kind: "code",
      mode: "complete",
      title: "Read the temperature",
      goal: "Complete read_temperature() so it fetches two bytes from the sensor at 0x48 and converts them to degrees C.",
      refs: [{ course: "L10" }, { trm: "20.3.3" }, { trm: "20.6.2" }, { trm: "20.2" }],
      brief: `
The robot kit in this game has a temperature sensor on the I2C bus at address **0x48**. Use the temperature knob next to the board to change what it measures.

## One register starts a transfer
One write to the mode register \`I2CMDR\` starts a whole transfer. The I2C module then makes the START, the address byte, the clock, the ACK bits and the STOP by itself. The bits that matter:

- **STT** (bit 13): make a START now
- **STP** (bit 11): make a STOP after \`I2CCNT\` bytes
- **MST** (bit 10): be the master
- **TRX** (bit 9): 1 = transmit (R/W bit 0), 0 = receive (R/W bit 1)
- **IRS** (bit 5): 1 = module out of reset. It must stay 1.

Bit n is worth 2^n, so a mode word is a sum. Example: bits 10 and 5 alone are 0x0400 + 0x0020 = 0x0420.

## What is already written
\`init_I2CB()\` switches GPIO40 and GPIO41 to the I2C module, turns on their **internal pull-ups** (this board has no external pull-up resistors) and sets SCL to 100 kHz.

\`read_temperature()\` already waits for the bytes with loops of the form \`while (flag == 0) {}\`: an empty body, repeated until the flag changes. If the transfer never starts, the program stays in such a loop for ever. (The course has no I2C starter code. This follows the reference manual.)

- \`I2CSTR.bit.RRDY\` becomes 1 when a received byte is in \`I2CDRR\`. Reading \`I2CDRR\` clears it.
- \`I2CMDR.bit.STP\` stays 1 until the STOP is on the bus.

## Your task
1. Put the sensor's **7-bit address** in \`I2CSAR\` (the module shifts it and adds the R/W bit itself) and the number of bytes to read, **2**, in \`I2CCNT\`.
2. Write the mode word to \`I2CMDR\`: master, receiver, START, STOP, out of reset. Work out the hex value from the bit numbers.
3. The sensor sends the **most significant byte first**. Put the two bytes together into the 16-bit \`tempRaw\`. The sensor counts in steps of 1/256 of a degree, so **degrees C = tempRaw / 256**: 25 degrees arrives as 0x19 then 0x00, tempRaw = 0x1900 = 6400, and 6400 / 256 = 25. Divide by \`256.0\`, not \`256\`, so the result keeps its fraction.

\`tempRaw\` is an \`int16_t\`, so temperatures below zero come out negative. The tests set the knob to 30.5 and then to -4 degrees C.
`,
      kit: "robot",
      starter: i2cRead(
        readTemperature({ sar: "0", cnt: "0", mode: "0x0020", combine: "    tempRaw = 0;\n    tempC = 0;", todo: true }),
      ),
      solution: i2cRead(
        readTemperature({
          sar: "0x48",
          cnt: "2",
          mode: "0x2C20",
          combine: "    tempRaw = (msb << 8) | lsb;\n    tempC = tempRaw / 256.0;",
          todo: false,
        }),
      ),
      durationMs: 16,
      stimuli: [
        { at: 5, set: "TEMP_C", value: 30.5 },
        { at: 10, set: "TEMP_C", value: -4 },
      ],
      checks: [
        {
          kind: "var", name: "readings", min: 4,
          label: "read_temperature() finishes again and again",
          hint: "If readings stays 0 the code is stuck in a wait loop: no byte arrives. The next four checks say which setting is wrong. If they all pass, the START bit (bit 13, 0x2000) or the master bit (bit 10, 0x0400) is missing from the mode word.",
        },
        { kind: "reg", reg: "I2cbRegs.I2CSAR", equals: 0x48, label: "I2CSAR holds the 7-bit address 0x48", hint: "Write the address as it is, 0x48. The module shifts it and adds the R/W bit itself. 0x90 or 0x91 is the byte on the wire, and nobody answers to that as an address." },
        { kind: "reg", reg: "I2cbRegs.I2CCNT", equals: 2, label: "I2CCNT asks for 2 bytes", hint: "The function waits for two bytes. With a count of 0 or 1 the second byte never comes." },
        { kind: "reg", reg: "I2cbRegs.I2CMDR", field: "TRX", equals: 0, label: "Mode word: receiver (bit 9 is 0)", hint: "With TRX = 1 the module addresses the sensor for writing and waits for data from you. To read, leave bit 9 (0x0200) at 0." },
        { kind: "reg", reg: "I2cbRegs.I2CMDR", field: "IRS", equals: 1, label: "Mode word: the module stays out of reset (bit 5)", hint: "A mode word without 0x0020 puts the I2C module back in reset, and nothing is sent." },
        { kind: "var", name: "tempC", at: 4, equals: 25, label: "tempC is 25 at the start", hint: "25 degrees arrives as 0x19, 0x00. tempRaw should be 0x1900 = 6400, and 6400 / 256 = 25. A value near 0.1 means the bytes are the wrong way round: the first byte, msb, goes on top." },
        { kind: "var", name: "tempC", at: 9, equals: 30.5, label: "tempC follows the knob to 30.5", hint: "Dividing by 256 (an integer) drops the half degree. Use 256.0." },
        { kind: "var", name: "tempC", at: 14, equals: -4, label: "tempC follows the knob to -4" },
        { kind: "signal", name: "I2C_STOPS", min: 4, label: "Every read ends with a STOP on the bus", hint: "Bit 11 of I2CMDR, STP, makes the module end the transfer with a STOP." },
      ],
      watch: ["tempRaw", "tempC", "readings"],
      inspect: ["I2cbRegs.I2CMDR", "I2cbRegs.I2CSTR", "I2cbRegs.I2CSAR", "I2cbRegs.I2CCNT"],
      hints: [
        "The address goes in as 0x48, not shifted. The byte count is 2.",
        "The mode word has bits 13, 11, 10 and 5 set: 0x2000 + 0x0800 + 0x0400 + 0x0020 = 0x2C20.",
        "`tempRaw = (msb << 8) | lsb;` then `tempC = tempRaw / 256.0;`",
      ],
      takeaway: "Address, count, one write to I2CMDR, then wait for RRDY once per byte. The module makes the START, the ACK bits and the STOP by itself.",
    },
    {
      id: "bus-can-frame",
      kind: "order",
      title: "Anatomy of a CAN frame",
      goal: "Put the parts of a CAN data frame in the order they appear on the bus.",
      refs: [{ course: "L10" }, { trm: "22.1" }, { trm: "22.14.1" }],
      brief: `
CAN (Controller Area Network) was made for cars: long cables, electrical noise, and many control units that must all hear each other. The bus is one twisted pair of wires, CANH and CANL. A small **transceiver** chip sits between the pair and the microcontroller's two pins, CANTX and CANRX.

The bus has two states, built the same way as on I2C:

- **dominant** = 0: a node drives the bus
- **recessive** = 1: nobody drives, and resistors return the bus to rest

A device on a CAN bus is called a **node**. There is no clock wire and no master. Any node may send when the bus is idle. A message is called a **frame**. It has no destination address. Instead it begins with an **identifier** that says what the message **is** ("distance from sensor 1"). Every node hears every frame and decides from the identifier whether it cares.

A data frame, in the order it is sent:

- the bus idles recessive, so a frame must begin with a dominant bit, the start of frame
- then the identifier: 11 bits in a standard frame, 29 bits in an **extended** frame (the course's sensors use 29)
- a control field, whose **DLC** (data length code) says how many data bytes follow
- 0 to 8 data bytes
- a **CRC**, a 15-bit checksum: a number the sender computes from all the bits before it. Each receiver computes it again, and a different result means the frame was damaged
- the **ACK** slot: the sender lets go, and every node that received the frame without error pulls the bus dominant
- the end of frame: seven recessive bits

Choose a field in the figure to see what it is for, and move the distance to watch the data bytes change.

{{figure:can-frame}}

Order the parts.
`,
      steps: [
        "Start of frame: one dominant (0) bit",
        "Identifier: what the message is, 11 or 29 bits",
        "Control field with the DLC: the number of data bytes, 0 to 8",
        "The data bytes",
        "CRC: the sender's checksum",
        "ACK slot: receivers pull the bus dominant to confirm",
        "End of frame: seven recessive (1) bits",
      ],
      hints: [
        "A receiver must know what the message is and how long it is before the data arrives.",
        "The checksum can only come after the data it protects, and the confirmation after the checksum.",
        "Start of frame, identifier, control (DLC), data, CRC, ACK, end of frame.",
      ],
      takeaway: "A CAN frame says what it is, not who it is for. Checksum and acknowledge are part of every frame, done by the hardware.",
    },
    {
      id: "bus-can-quiz",
      kind: "quiz",
      title: "The lower identifier wins",
      goal: "Answer four questions about identifiers, arbitration and acknowledgement on CAN.",
      refs: [{ course: "L10" }, { trm: "22.1" }, { trm: "22.11.6" }, { trm: "22.10.3" }],
      brief: `
## Arbitration
Two nodes may start a frame in the same instant. Both send their identifier, most significant bit first, and both **read the bus back** after every bit. A node that sent recessive (1) but reads dominant (0) knows that someone else is driving the bus. It has lost. It stops sending at once and becomes a receiver.

The frame of the winner is not damaged, and no time is lost. Since 0 beats 1, **the lower identifier wins**: the identifier is also the priority of the message.

Try it in the figure: set two identifiers and see which node gives way, and at which bit.

{{figure:can-arbitration}}

## Acknowledge
The ACK bit is pulled dominant by **every** node that received the frame correctly, not by one addressed device. A sender that sees no ACK knows that nobody heard it, and sends the frame again.

## Message objects
The CAN module in the F28379D holds 32 **message objects** (TI's library calls them mailboxes). Each is set up with an identifier and a direction (receive or send). When a frame arrives, the module compares its identifier with the receive objects, lowest object number first, and stores the frame in the first one that matches. A frame that matches none is acknowledged on the bus and then dropped. Your code is only interrupted for the messages it asked for.

The course's distance sensors (SEN-36005) send extended frames at 1 Mbit/s. Their identifier is **0x060B01ss** for the measured distance, where **ss** is the sensor's device number. The robot's two sensors are numbers 1 and 2.
`,
      questions: [
        {
          prompt: "Sensor 1 (identifier 0x060B0101) and sensor 2 (0x060B0102) start a frame in the same instant. What happens?",
          options: [
            "Both frames are destroyed and both retry after a random time",
            "Sensor 1's frame goes through undamaged; sensor 2 notices it lost, stops, and sends afterwards",
            "Sensor 2 wins because its identifier is larger",
            "The microcontroller decides which one may send",
          ],
          answer: 1,
          why: "The identifiers are equal until the last two bits: 01 against 10. At the first of them sensor 2 sends recessive (1) and reads dominant (0), so it withdraws. The lower identifier wins and nothing is lost.",
        },
        {
          prompt: "Which level is dominant on a CAN bus?",
          options: ["1, because the bus idles at 1", "0", "Whichever was sent first", "Neither, they are equal"],
          answer: 1,
          why: "A node drives the bus for a 0 and lets go for a 1. As on I2C, a 0 from any node overrides a 1 from all the others.",
        },
        {
          prompt: "Who sends the ACK bit of a CAN frame?",
          options: [
            "Only the node the frame is addressed to",
            "The sender itself",
            "Every node that received the frame without an error",
            "The node with the lowest identifier",
          ],
          answer: 2,
          why: "A frame has no destination. Any node that checked the CRC and found the frame good pulls the ACK slot dominant.",
        },
        {
          prompt: "Message object 1 is set up to receive identifier 0x060B0101. A frame with identifier 0x060B0201 arrives. What does your program see?",
          options: [
            "An interrupt, with the frame's data in message object 1",
            "An error interrupt",
            "Nothing: the frame matches no message object and is dropped",
            "The frame is stored in the next free message object",
          ],
          answer: 2,
          why: "Without a mask every identifier bit must match. This frame (the sensor's quality message) is ignored, which is exactly what a filter is for.",
        },
      ],
      takeaway: "On CAN the identifier is the name of the message, its priority, and the filter key, all at once.",
    },
    {
      id: "bus-can-receive",
      kind: "code",
      mode: "complete",
      title: "Hear sensor 1",
      goal: "Set up a message object for sensor 1's distance, enable the CAN interrupt, and decode the distance.",
      refs: [{ course: "L10" }, { trm: "22.10.3" }, { trm: "22.6" }, { trm: "22.11.9" }, { trm: "3.4.5" }],
      brief: `
This is the CAN code of the final project starter, reduced to one sensor. The course file \`F28379dCAN.c\` supplies the functions whose names start with \`CAN\`, and the array \`rxMsgData\` (\`extern\` in front of a variable means "it is defined in another file"). Everything outside the three TODOs is given: read it once with this list.

## What is already written
- GPIO17 and GPIO12 are switched to CANRXB and CANTXB (mux position 2).
- \`InitCANB()\` resets the CAN module and empties all 32 message objects. \`setCANBitRate(200000000, 1000000)\` sets 1 Mbit/s.
- \`can_isr\` is in the vector table as \`CANB0_INT\`, and the CAN module's own interrupt enables are set.
- \`can_isr\` asks which message object caused the interrupt, copies its 8 data bytes into \`rxMsgData\` (one byte per array element), clears the message object's interrupt, clears the CAN module's global flag and acknowledges the PIE group. \`InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);\` is the library's spelling of \`PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;\`.
- \`CanbRegs.CAN_CTL.bit.Init = 0;\` then lets the module take part in the bus traffic.

## Your task
1. **Interrupt.** CANB0 is **PIE group 9, interrupt 7**. Set its \`PIEIER9\` bit, and the group's bit in \`IER\`.

2. **Message object.** Call \`CANsetupMessageObject\` so that object number \`RX_MSG_OBJ_ID_1\` receives sensor 1's distance message:

\`\`\`c
CANsetupMessageObject(CANB_BASE,
    objectNumber, identifier,
    CAN_MSG_FRAME_EXT,
    CAN_MSG_OBJ_TYPE_RX, 0,
    CAN_MSG_OBJ_RX_INT_ENABLE,
    RX_MSG_DATA_LENGTH);
\`\`\`

The identifier is 0x060B0101. \`CAN_MSG_FRAME_EXT\` says it has 29 bits, the 0 is "no mask", and \`CAN_MSG_OBJ_RX_INT_ENABLE\` asks for an interrupt when a frame is stored.

3. **Decode.** The first two data bytes are the distance in millimetres, **least significant byte first**: byte 0 counts ones, byte 1 counts 256s. Example: byte 0 = 0x2C = 44 and byte 1 = 0x01 make 256 x 1 + 44 = 300 mm. In \`can_isr\`, compute \`dis_1\` from \`dis_raw_1[0]\` and \`dis_raw_1[1]\`.

The figure shows the frame your code receives: bytes 0 and 1 are the distance.

{{figure:can-frame}}

The sensor sends every 100 ms. The tests turn its knob to 1234 mm and then to 300 mm.
`,
      kit: "robot",
      starter: canReceive({
        pie: "    // TODO 1: enable CANB0 in the PIE (group 9, interrupt 7) and group 9 in IER",
        object: "    // TODO 2: message object RX_MSG_OBJ_ID_1 receives identifier 0x060b0101",
        decode: "        // TODO 3: distance in mm, low byte first\n        dis_1 = 0;",
        ack: "    // Acknowledge this interrupt located in group 9\n    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);",
      }),
      solution: canReceive({
        pie: CAN_PIE_ENABLE,
        object: `    // Measured distance from sensor 1\n${msgObject(1, "0x060b0101")}`,
        decode: "        dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];",
        ack: "    // Acknowledge this interrupt located in group 9\n    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);",
      }),
      durationMs: 330,
      stimuli: [
        { at: 60, set: "CAN_DIST1_MM", value: 1234 },
        { at: 160, set: "CAN_DIST1_MM", value: 300 },
      ],
      checks: [
        {
          kind: "signal", name: "CAN_RX_FRAMES", min: 3,
          label: "Sensor 1's frames are stored in a message object",
          hint: "No frame matched a message object. Check the identifier (0x060b0101), CAN_MSG_FRAME_EXT, and that the object is set up before Init is cleared.",
        },
        {
          kind: "isr", fn: "can_isr", min: 3,
          label: "can_isr runs for every frame",
          hint: "The frame is stored but no interrupt reaches the CPU: PieCtrlRegs.PIEIER9.bit.INTx7 = 1; and IER |= M_INT9;",
        },
        { kind: "var", name: "dis_1", at: 50, equals: 500, label: "dis_1 is 500 mm at the start", hint: "500 is 0x01F4: byte 0 = 0xF4 = 244, byte 1 = 1. 256 x 1 + 244. If you see 62465, the two bytes are swapped. If you see 1200, that is sensor 2: the identifier must end in 01." },
        { kind: "var", name: "dis_1", at: 150, equals: 1234, label: "dis_1 follows the knob to 1234 mm" },
        { kind: "var", name: "dis_1", at: 250, equals: 300, label: "dis_1 follows the knob to 300 mm" },
        { kind: "var", name: "measure_status_1", equals: 0, label: "The ranging status is 0: valid" },
      ],
      watch: ["dis_1", "rxMsgCount_1", "measure_status_1"],
      inspect: ["CanbRegs.CAN_CTL", "CanbRegs.CAN_INT", "CanbRegs.CAN_NDAT_21", "PieCtrlRegs.PIEIER9"],
      hints: [
        "The interrupt enables follow the pattern of every PIE interrupt: `PieCtrlRegs.PIEIER9.bit.INTx7 = 1;` and `IER |= M_INT9;`",
        "The call in the brief is complete except for two arguments: the object number RX_MSG_OBJ_ID_1 and the identifier 0x060b0101.",
        "The high byte counts 256s: `dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];`",
      ],
      takeaway: "Three things make a CAN message arrive: a message object with the right identifier, the interrupt path (message object, CAN module, PIE, CPU), and Init = 0.",
    },
    {
      id: "bus-can-leds",
      kind: "code",
      mode: "write",
      title: "Parking sensor",
      goal: "Write can_isr and show_distance() so the LEDs show how close an obstacle is to the two sensors.",
      refs: [{ course: "L10" }, { trm: "22.6" }, { trm: "22.11.9" }, { trm: "3.4.5" }],
      brief: `
Both distance sensors are in use now: message object 1 receives sensor 1 (identifier 0x060B0101), message object 2 receives sensor 2 (0x060B0102). All the set-up is written.

## Your task: can_isr
Write the whole function. One interrupt serves both message objects, so first find out which one it is:

1. \`status = CANgetInterruptCause(CANB_BASE);\` returns the number of the message object, or \`CAN_INT_INT0ID_STATUS\` for a status interrupt (the module reports a change of its own state, such as a bus error).
2. For \`CAN_INT_INT0ID_STATUS\`: call \`CANgetStatus(CANB_BASE);\`. Reading the status clears that interrupt.
3. For \`RX_MSG_OBJ_ID_1\`: \`CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);\`, compute \`dis_1\` from \`rxMsgData[0]\` and \`rxMsgData[1]\`, then \`CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);\` and set \`newData = 1\`.
4. The same for \`RX_MSG_OBJ_ID_2\` and \`dis_2\`.
5. At the end, always: \`CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);\` and \`InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);\`

\`rxMsgData\` is an array of 16-bit values. Write \`256 * (uint32_t)rxMsgData[1]\` so the multiplication is done in 32 bits.

## Your task: show_distance()
\`main()\` calls it each time \`newData\` was set. Sensor 1 drives a bar of three LEDs, sensor 2 one warning LED:

- **LED1** (GPIO22, port A) on when \`dis_1\` is below 1000 mm
- **LED2** (GPIO94, port C) on when \`dis_1\` is below 600 mm
- **LED3** (GPIO95, port C) on when \`dis_1\` is below 300 mm
- **LED5** (GPIO111, port D) on when \`dis_2\` is below 300 mm

An LED must go off again when its condition no longer holds.
`,
      kit: "robot",
      starter: canLeds("    // Find the cause, read the message, clear the interrupt, acknowledge", "    // LED1 to LED3 from dis_1, LED5 from dis_2"),
      solution: canLeds(CAN_LEDS_ISR, CAN_LEDS_SHOW),
      durationMs: 360,
      stimuli: [
        { at: 60, set: "CAN_DIST1_MM", value: 250 },
        { at: 60, set: "CAN_DIST2_MM", value: 200 },
        { at: 160, set: "CAN_DIST1_MM", value: 800 },
        { at: 160, set: "CAN_DIST2_MM", value: 299 },
        { at: 260, set: "CAN_DIST1_MM", value: 1500 },
        { at: 260, set: "CAN_DIST2_MM", value: 300 },
      ],
      checks: [
        {
          kind: "isr", fn: "can_isr", min: 6,
          label: "can_isr runs for every frame of both sensors",
          hint: "If it ran once only, the PIE group was not acknowledged or the CAN module's global flag was not cleared. If it ran hundreds of times, the message object's interrupt was not cleared.",
        },
        { kind: "var", name: "dis_1", at: 50, equals: 500, label: "dis_1 is 500 mm at the start" },
        { kind: "var", name: "dis_2", at: 50, equals: 1200, label: "dis_2 is 1200 mm at the start" },
        { kind: "led", led: "LED1", at: 50, on: true, label: "500 mm: LED1 on" },
        { kind: "led", led: "LED2", at: 50, on: true, label: "500 mm: LED2 on" },
        { kind: "led", led: "LED3", at: 50, on: false, label: "500 mm: LED3 off" },
        { kind: "led", led: "LED5", at: 50, on: false, label: "Sensor 2 at 1200 mm: LED5 off" },
        { kind: "led", led: "LED3", at: 150, on: true, label: "250 mm: LED3 on as well" },
        { kind: "led", led: "LED5", at: 150, on: true, label: "Sensor 2 at 200 mm: LED5 on" },
        { kind: "led", led: "LED1", at: 250, on: true, label: "800 mm: LED1 still on" },
        { kind: "led", led: "LED2", at: 250, on: false, label: "800 mm: LED2 off again" },
        { kind: "led", led: "LED3", at: 250, on: false, label: "800 mm: LED3 off again" },
        { kind: "led", led: "LED5", at: 250, on: true, label: "Sensor 2 at 299 mm: LED5 on" },
        { kind: "led", led: "LED1", at: 350, on: false, label: "1500 mm: LED1 off" },
        { kind: "led", led: "LED5", at: 350, on: false, label: "Sensor 2 at 300 mm: LED5 off", hint: "Below 300 means dis_2 < 300, not <= 300." },
        { kind: "no-diagnostic", code: "can-int-stuck", label: "Every message object interrupt is cleared", hint: "Call CANclearInterruptStatus(CANB_BASE, ...) with the number of the message object you just read." },
      ],
      bonus: [
        { kind: "isr-time", fn: "can_isr", maxUs: 1, label: "can_isr takes less than 1 microsecond", hint: "Store the distance and set newData in can_isr. Leave the LEDs to show_distance()." },
      ],
      watch: ["dis_1", "dis_2", "newData"],
      inspect: ["CanbRegs.CAN_INT", "CanbRegs.CAN_NDAT_21", "PieCtrlRegs.PIEACK"],
      hints: [
        "Use `if (status == CAN_INT_INT0ID_STATUS) { ... } else if (status == RX_MSG_OBJ_ID_1) { ... } else if (status == RX_MSG_OBJ_ID_2) { ... }` and put the two clearing calls after the whole chain.",
        "`dis_1 = 256 * (uint32_t)rxMsgData[1] + rxMsgData[0];`",
        "In show_distance: `if (dis_1 < 1000) GpioDataRegs.GPASET.bit.GPIO22 = 1; else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;` and the same pattern with GPCSET / GPCCLEAR for GPIO94 and GPIO95, GPDSET / GPDCLEAR for GPIO111.",
      ],
      takeaway: "A CAN interrupt has three things to clear, from the inside out: the message object's flag, the module's global flag, and the PIE group.",
    },
    {
      id: "bus-can-debug",
      kind: "code",
      mode: "debug",
      title: "64 millimetres, for ever",
      goal: "Find the three mistakes that make this program report a distance that never changes.",
      refs: [{ course: "L10" }, { trm: "22.6" }, { trm: "22.11.6" }, { trm: "3.4.5" }],
      brief: `
This program should track sensor 1's distance in \`dis_1\`. It shows 64 mm, whatever the knob says, and \`rxMsgCount_1\` stops at 1.

There are **three** mistakes. Each hides behind the one before:

- An interrupt function that runs **once and never again** has left something unacknowledged. Compare how \`can_isr\` ends with the last two levels. CANB0 is in PIE **group 9**.
- A value that **does not react** to the sensor may not come from the message you think. The sensor sends two messages right after each other: measured distance (0x060B01ss) and measurement quality (0x060B02ss).
- A value that reacts but is **absurdly large** has its bytes the wrong way round. Bytes 0 and 1 are the distance, least significant byte first.

The tests turn the knob to 1234 mm and then to 300 mm.
`,
      kit: "robot",
      starter: canReceive({
        pie: CAN_PIE_ENABLE,
        object: `    // Measured distance from sensor 1\n${msgObject(1, "0x060b0201")}`,
        decode: "        dis_1 = 256*dis_raw_1[0] + dis_raw_1[1];",
        ack: "    // Acknowledge this interrupt\n    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;",
      }),
      solution: canReceive({
        pie: CAN_PIE_ENABLE,
        object: `    // Measured distance from sensor 1\n${msgObject(1, "0x060b0101")}`,
        decode: "        dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];",
        ack: "    // Acknowledge this interrupt located in group 9\n    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);",
      }),
      durationMs: 330,
      stimuli: [
        { at: 60, set: "CAN_DIST1_MM", value: 1234 },
        { at: 160, set: "CAN_DIST1_MM", value: 300 },
      ],
      checks: [
        {
          kind: "isr", fn: "can_isr", min: 3,
          label: "can_isr runs for every frame",
          hint: "PIEACK_GROUP1 is the timers' group. CANB0 is INT9.7: PieCtrlRegs.PIEACK.all = PIEACK_GROUP9; or InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);",
        },
        {
          kind: "source", mustMatch: "0x060[bB]0101",
          label: "Message object 1 listens for the measured distance of sensor 1",
          hint: "0x060b0201 is sensor 1's quality message. The measured distance is 0x060b0101.",
        },
        { kind: "var", name: "dis_1", at: 50, equals: 500, label: "dis_1 is 500 mm at the start", hint: "62465 instead of 500 means the two bytes are swapped: the high byte is dis_raw_1[1]." },
        { kind: "var", name: "dis_1", at: 150, equals: 1234, label: "dis_1 follows the knob to 1234 mm" },
        { kind: "var", name: "dis_1", at: 250, equals: 300, label: "dis_1 follows the knob to 300 mm" },
      ],
      watch: ["dis_1", "rxMsgCount_1"],
      inspect: ["PieCtrlRegs.PIEACK", "CanbRegs.CAN_INT", "CanbRegs.CAN_GLB_INT_FLG"],
      hints: [
        "Start at the end of can_isr: which PIE group does it acknowledge, and which group is CANB0 in?",
        "Then the identifier in CANsetupMessageObject: the third byte must be 01 (measured distance), not 02 (quality).",
        "Last, the decode line: `dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];`",
      ],
      takeaway: "Runs once: acknowledge. Never changes: wrong message. Absurd value: byte order. The symptom tells you where to look.",
    },
    {
      id: "bus-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: two buses, one report",
      goal: "Each time sensor 1 sends a distance over CAN, read the temperature over I2C and print both on the serial terminal.",
      refs: [{ course: "L10" }, { course: "HW4" }, { trm: "20.6.2" }, { trm: "22.6" }, { trm: "19.11" }],
      brief: `
Put the chapter together. The robot reports what it measures: a distance from the CAN bus and a temperature from the I2C bus, on the serial terminal you know from the serial chapter.

All set-up of pins, clocks and the PIE is written, and so are \`init_I2CB()\` and \`init_serialSCIA\`. Four parts are yours:

1. **Message object.** Set up \`RX_MSG_OBJ_ID_1\` for sensor 1's measured distance (identifier 0x060B0101), with the receive interrupt, as in "Hear sensor 1".
2. **can_isr.** Find the cause. For message object 1: read the message, compute \`dis_1\`, clear the object's interrupt and set \`newDistance = 1\`. For a status interrupt call \`CANgetStatus\`. End with the global clear and the group 9 acknowledge.
3. **read_temperature().** A 2-byte read from address 0x48 into \`tempC\`, as in "Read the temperature". Wait for \`I2CMDR.bit.STP\` to be 0 before starting.
4. **The report.** In \`while (1)\`: when \`newDistance\` is 1, set it back to 0, call \`read_temperature()\` and print one line:

\`\`\`c
serial_printf(&SerialA, "T %.1f C, D %ld mm\\r\\n", tempC, dis_1);
\`\`\`

So a line looks like \`T 25.0 C, D 500 mm\`. The sensor sends every 100 ms, so that is how often a line appears. Printing takes milliseconds: it belongs in \`main()\`, never in the interrupt function. The same is true for the I2C read, which waits for the bus.

The tests change both knobs while the program runs.
`,
      kit: "robot",
      starter: checkpoint({
        object: "    // 1: message object RX_MSG_OBJ_ID_1 for identifier 0x060b0101",
        isr: "    // 2: cause, message, dis_1, newDistance, clear, acknowledge",
        read: "    // 3: two bytes from address 0x48, then tempC = tempRaw / 256.0",
        report: "        // 4: on newDistance, read the temperature and print the line",
      }),
      solution: checkpoint({
        object: msgObject(1, "0x060b0101"),
        isr: CHECKPOINT_ISR,
        read: CHECKPOINT_READ,
        report: `        if (newDistance == 1) {
            newDistance = 0;
            read_temperature();
            serial_printf(&SerialA, "T %.1f C, D %ld mm\\r\\n", tempC, dis_1);
        }`,
      }),
      durationMs: 350,
      stimuli: [
        { at: 120, set: "TEMP_C", value: 31.5 },
        { at: 120, set: "CAN_DIST1_MM", value: 1234 },
        { at: 220, set: "TEMP_C", value: -7.5 },
        { at: 220, set: "CAN_DIST1_MM", value: 80 },
      ],
      checks: [
        { kind: "isr", fn: "can_isr", min: 4, label: "can_isr runs for every distance frame", hint: "Message object, CANclearInterruptStatus, CANclearGlobalInterruptStatus, InterruptclearACKGroup(INTERRUPT_ACK_GROUP9)." },
        { kind: "signal", name: "I2C_STOPS", min: 4, label: "The temperature is read over I2C once per frame", hint: "Address 0x48, count 2, mode word 0x2C20, then wait for RRDY twice." },
        {
          kind: "serial", matches: "^T 25\\.0 C, D 500 mm\\r\\nT 25\\.0 C, D 500 mm\\r\\n",
          label: "The first two lines read: T 25.0 C, D 500 mm",
          hint: "The format is \"T %.1f C, D %ld mm\\r\\n\" with tempC and dis_1.",
        },
        { kind: "serial", includes: "T 31.5 C, D 1234 mm\r\n", label: "The third line follows both knobs: T 31.5 C, D 1234 mm" },
        { kind: "serial", includes: "T -7.5 C, D 80 mm\r\n", label: "The fourth line shows a negative temperature: T -7.5 C, D 80 mm", hint: "tempRaw must be an int16_t, and the division by 256.0." },
        { kind: "serial-period", periodMs: 100, label: "One line per frame: every 100 ms", hint: "A line every millisecond or two means newDistance is never set back to 0 in main()." },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside the interrupt function", hint: "Set newDistance = 1 in can_isr and print from while (1)." },
        { kind: "isr-time", fn: "can_isr", maxUs: 50, label: "can_isr does not wait for the I2C bus (it returns within 50 us)", hint: "An I2C read takes about 300 us of waiting. Call read_temperature() from while (1) in main(), not from can_isr." },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the values", hint: "dis_1 is 32 bits wide: %ld. tempC is a float: %.1f." },
      ],
      bonus: [
        { kind: "isr-time", fn: "can_isr", maxUs: 5, label: "can_isr takes less than 5 microseconds", hint: "Store dis_1, set the flag, clear and acknowledge. Nothing else." },
      ],
      watch: ["dis_1", "tempC", "newDistance"],
      inspect: ["I2cbRegs.I2CSTR", "CanbRegs.CAN_INT"],
      hints: [
        "Each part is a level you have done: the object and decode from \"Hear sensor 1\", the ISR from \"Parking sensor\", the read from \"Read the temperature\".",
        "can_isr only stores dis_1 and sets newDistance. main() does the slow work: `if (newDistance == 1) { newDistance = 0; read_temperature(); serial_printf(...); }`",
        "In read_temperature: wait for STP == 0, `I2CSAR.all = 0x48`, `I2CCNT = 2`, `I2CMDR.all = 0x2C20`, wait for RRDY and read I2CDRR twice, `tempRaw = (msb << 8) | lsb; tempC = tempRaw / 256.0;`",
      ],
      takeaway: "CAN delivers by interrupt, I2C is asked when you want an answer, and the serial port reports. The interrupt function stays short; main() does the waiting.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "bus-i2c-wiring",
      kind: "wiring",
      tier: "practice",
      title: "Two devices, two resistors",
      goal: "Wire a temperature sensor and a clock chip to the I2C bus, with its two pull-up resistors.",
      refs: [{ course: "L10" }, { trm: "20.2" }, { trm: "20.3.1" }],
      brief: `
An I2C pin is an **open-drain** output: inside the chip, one transistor (an electronic switch) can connect the pin to ground. There is no transistor to 3.3 V. So a device can pull a line **low**, or **let go** of it. It cannot drive it high.

Something else must bring a released line back to 1: a **pull-up resistor** from the line to 3.3 V. The bus has two lines, so it has two resistors, **one for the whole bus**, not one per device.

Every device connects to the **same** two lines: all SDA pins together, all SCL pins together. Nothing is chained from one device to the next.

The figure shows the finished bus at work: close any switch and the whole line goes low.

{{figure:i2c-bus}}

Already in place (grey):

- the microcontroller's SDAB (GPIO40) and SCLB (GPIO41) are on the two bus lines
- the lower end of R1 is on the SDA line, the lower end of R2 on the SCL line

Add the six missing wires.
`,
      nodes: [
        { id: "v33", label: "3.3 V", x: 50, y: 5 },
        { id: "gnd", label: "GND", x: 90, y: 5 },
        { id: "r1", label: "R1 upper end", x: 40, y: 14, side: "left" },
        { id: "r2", label: "R2 upper end", x: 60, y: 14, side: "right" },
        { id: "sda", label: "SDA line", x: 40, y: 28, side: "right" },
        { id: "scl", label: "SCL line", x: 60, y: 40, side: "right" },
        { id: "msda", label: "GPIO40 (SDAB)", x: 10, y: 28, side: "top" },
        { id: "mscl", label: "GPIO41 (SCLB)", x: 10, y: 40, side: "bottom" },
        { id: "tsda", label: "Sensor SDA", x: 22, y: 54, side: "bottom" },
        { id: "tscl", label: "Sensor SCL", x: 42, y: 54, side: "bottom" },
        { id: "csda", label: "Clock SDA", x: 64, y: 54, side: "bottom" },
        { id: "cscl", label: "Clock SCL", x: 84, y: 54, side: "bottom" },
      ],
      parts: [
        { kind: "resistor", a: "r1", b: "sda", label: "R1" },
        { kind: "resistor", a: "r2", b: "scl", label: "R2" },
      ],
      fixed: [
        ["r1", "sda"],
        ["r2", "scl"],
        ["msda", "sda"],
        ["mscl", "scl"],
      ],
      wires: [
        ["v33", "r1"],
        ["v33", "r2"],
        ["tsda", "sda"],
        ["tscl", "scl"],
        ["csda", "sda"],
        ["cscl", "scl"],
      ],
      mistakes: [
        { wire: ["gnd", "r1"], why: "That makes R1 a pull-down: SDA would sit at 0 all the time. A released line must return to 1, so the resistor goes to 3.3 V." },
        { wire: ["gnd", "r2"], why: "That makes R2 a pull-down: SCL would sit at 0 all the time. A released line must return to 1, so the resistor goes to 3.3 V." },
        { wire: ["tsda", "scl"], why: "SDA pins go on the SDA line. Crossed over, the sensor would take the clock for data." },
        { wire: ["tscl", "sda"], why: "SCL pins go on the SCL line. Crossed over, the sensor would take the data for a clock." },
        { wire: ["csda", "scl"], why: "SDA pins go on the SDA line. Crossed over, the clock chip would take the clock for data." },
        { wire: ["cscl", "sda"], why: "SCL pins go on the SCL line. Crossed over, the clock chip would take the data for a clock." },
        { wire: ["tsda", "csda"], why: "Electrically that could work, but draw the bus as it is: every device goes to the SDA line." },
        { wire: ["tscl", "cscl"], why: "Electrically that could work, but draw the bus as it is: every device goes to the SCL line." },
        { wire: ["v33", "sda"], why: "A wire straight to 3.3 V has no resistance: the first device that pulls SDA low would short the supply to ground. The connection to 3.3 V goes through R1." },
        { wire: ["v33", "scl"], why: "A wire straight to 3.3 V has no resistance: the first device that pulls SCL low would short the supply to ground. The connection to 3.3 V goes through R2." },
      ],
      hints: [
        "A pull-up goes up: both resistors' free ends go to 3.3 V.",
        "Each device has one wire to the SDA line and one to the SCL line.",
        "3.3 V to R1 and to R2. Sensor SDA and Clock SDA to the SDA line. Sensor SCL and Clock SCL to the SCL line.",
      ],
      takeaway: "Open-drain outputs plus one pull-up per line make a wired-AND: the line is 1 only when every device has let go. The simulated board has no external resistors, so the code switches on the pins' internal pull-ups instead.",
    },
    {
      id: "bus-i2c-quiz",
      kind: "quiz",
      tier: "practice",
      title: "Who pulls the line?",
      goal: "Answer four questions about open-drain lines, the ACK bit and two masters starting at once.",
      refs: [{ course: "L10" }, { trm: "20.3.5" }, { trm: "20.3.7" }, { trm: "20.3.8" }],
      brief: `
Because every device can only pull low or let go, each line behaves like an AND gate made of wire: it is 1 only if **all** devices have let go. This **wired-AND** gives I2C three things for free.

**The ACK bit.** After every 8 bits, whoever was **receiving** pulls SDA low during a ninth clock. After the address byte that is the addressed slave. When the master reads data from a slave, the master is the receiver, so the master acknowledges each byte, and answers the **last** byte it wants with a NACK (SDA left high) to tell the slave to stop sending.

**Clock synchronisation.** A device may hold SCL low. SCL only goes high when everyone has let go, so the slowest device sets the low time. A slave uses this to make a fast master wait.

**Arbitration.** I2C allows more than one master. If two start at the same moment, both send their address byte and both **read SDA back** after every bit. A master that sent a 1 (let go) but reads a 0 knows someone else is pulling the line. It has lost: it stops at once and tries again later. The other master notices nothing, and its message is not damaged.

Try it in the figure: give the two masters different addresses and step through the bits.

{{figure:i2c-arbitration}}
`,
      questions: [
        {
          prompt: "Three devices are on SDA. Two have let go, one pulls low. What level is the line?",
          options: ["High: two against one", "Low: one device pulling low is enough", "About 2.2 V, two thirds of 3.3 V", "It flips back and forth"],
          answer: 1,
          why: "Wired-AND: the line is high only when all devices have let go. A pull-up resistor cannot win against a transistor to ground.",
        },
        {
          prompt: "The master sends the address byte for a write. Who drives SDA during the ninth clock?",
          options: [
            "The master, to confirm it has finished",
            "The slave with that address pulls SDA low; if no such slave exists SDA stays high",
            "Every slave on the bus pulls SDA low",
            "Nobody, the ninth clock is a pause",
          ],
          answer: 1,
          why: "The receiver of the byte acknowledges. Only the slave whose address matches answers. With no such slave the pull-up keeps SDA high: a NACK, which is how the master learns that nobody is there.",
        },
        {
          prompt: "The master is reading two bytes from a sensor. What does the master do in the ninth clock of each byte?",
          options: [
            "ACK both bytes",
            "NACK both bytes",
            "ACK the first byte, NACK the second",
            "Nothing: only slaves acknowledge",
          ],
          answer: 2,
          why: "The receiver acknowledges, and here the master is the receiver. ACK means \"send more\". The NACK after the last byte tells the sensor to let go of SDA, so the master can make the STOP.",
        },
        {
          prompt: "Masters A and B start at the same instant. A calls address 0x48 (100 1000), B calls 0x44 (100 0100). Who wins, and why?",
          options: [
            "A, because its address is higher",
            "B: at the fourth bit A lets go for a 1 but reads the 0 that B is pulling, so A stops",
            "Neither: both messages are destroyed and both retry",
            "Whichever has the faster clock",
          ],
          answer: 1,
          why: "The first three bits (1, 0, 0) match. At the fourth, A sends 1 and B sends 0. The line is 0. A reads back a level it did not send and withdraws. The lower number wins, and B's bits were never disturbed.",
        },
      ],
      takeaway: "A 0 always beats a 1 on the wire. I2C uses that for the ACK, for slowing the clock and for arbitration.",
    },
    {
      id: "bus-i2c-calc",
      kind: "calc",
      tier: "practice",
      title: "Address bytes and clock dividers",
      goal: "Work out the first byte on the bus and the SCL frequency the clock registers give.",
      refs: [{ trm: "20.1.4" }, { trm: "20.1.5" }, { trm: "20.3.5" }, { course: "L10" }],
      brief: `
## The address byte
The first byte after a START is the 7-bit address shifted left by one, with the R/W bit in bit 0:

**byte = (address << 1) | R/W**, with R/W = 0 to write and 1 to read.

On a logic analyser you see this byte. In the register \`I2CSAR\` you write the **7-bit address**: the chip does the shift and adds the R/W bit itself.

## The clock
The I2C module divides the 200 MHz system clock twice.

1. The prescaler makes the **module clock**: **200 MHz / (I2CPSC + 1)**. The reference manual requires it to be between **7 and 12 MHz**.
2. SCL is made from the module clock. Its low time is (I2CCLKL + d) module clock periods and its high time is (I2CCLKH + d) periods:

**SCL frequency = module clock / ((I2CCLKL + d) + (I2CCLKH + d))**

The extra **d** is 5 when I2CPSC is greater than 1 (it is 7 for I2CPSC = 0 and 6 for I2CPSC = 1).

Example: I2CPSC = 19 gives 200 / 20 = 10 MHz. With I2CCLKL = 10 and I2CCLKH = 5 one SCL period is (10 + 5) + (5 + 5) = 25 module clock periods: 10 MHz / 25 = 400 kHz.

The I2C module is specified for 10 kbit/s to 400 kbit/s.

## The lecture's numbers
The lecture's \`I2CA_Init\`, taken from TI's example, uses I2CPSC = 16, I2CCLKL = 10, I2CCLKH = 5. Work out what that gives in the last two fields.
`,
      fields: [
        {
          id: "wr",
          label: "Address byte to write to the device at 0x48",
          format: "hex",
          answer: 0x90,
          why: "0x48 << 1 = 0x90, and R/W = 0 for a write.",
        },
        {
          id: "rd",
          label: "Address byte to read from the device at 0x48",
          format: "hex",
          answer: 0x91,
          why: "0x90 with R/W = 1 in bit 0: 0x91.",
        },
        {
          id: "mod",
          label: "Module clock with I2CPSC = 19",
          unit: "MHz",
          answer: 10,
          why: "200 MHz / (19 + 1) = 10 MHz, inside the 7 to 12 MHz range.",
        },
        {
          id: "scl100",
          label: "SCL frequency with I2CPSC = 19, I2CCLKL = 45, I2CCLKH = 45",
          unit: "kHz",
          answer: 100,
          tolPct: 0.5,
          why: "d = 5. (45 + 5) + (45 + 5) = 100 module clock periods per SCL period: 10 MHz / 100 = 100 kHz.",
        },
        {
          id: "lecmod",
          label: "Lecture values: module clock with I2CPSC = 16",
          unit: "MHz",
          answer: 11.765,
          tolPct: 0.5,
          why: "200 MHz / 17 = 11.76 MHz, just inside the allowed range.",
        },
        {
          id: "lecscl",
          label: "Lecture values: SCL frequency with I2CCLKL = 10, I2CCLKH = 5",
          unit: "kHz",
          answer: 470.6,
          tolPct: 0.5,
          why: "(10 + 5) + (5 + 5) = 25 periods: 11.76 MHz / 25 = 470.6 kHz. That is above the 400 kHz the reference manual gives as the fastest rate. With I2CPSC = 19 the same dividers give exactly 400 kHz.",
        },
      ],
      hints: [
        "Shift the address left one place (multiply by 2), then add the R/W bit.",
        "Find the module clock first: 200 / (I2CPSC + 1) in MHz. Then add d = 5 to both divider values.",
        "100 kHz case: 10 MHz / (50 + 50). Lecture case: (200 / 17) MHz / (15 + 10).",
      ],
      takeaway: "I2CSAR holds the 7-bit address, the bus shows it shifted with R/W added. Check the module clock (7 to 12 MHz) before the SCL dividers.",
    },
    {
      id: "bus-i2c-mode",
      kind: "register",
      tier: "practice",
      title: "The mode word",
      goal: "Set the bits of I2CMDR that start a write: master, transmitter, START, and a STOP at the end.",
      refs: [{ trm: "20.6.2" }, { trm: "20.3.3" }, { course: "L10" }],
      brief: `
\`I2CMDR\` is the mode register: one write to it starts a whole transfer. "Read the temperature" used 0x2C20 to **read**. A master that **writes** to a device, for example to set a sensor's alarm limit, needs one more bit.

The bits that matter:

- **IRS** (bit 5): 1 takes the module out of reset. It is already set here and must stay set.
- **MST** (bit 10): 1 = master. The module makes the clock.
- **TRX** (bit 9): 1 = transmitter (the R/W bit sent is 0, write). 0 = receiver (R/W = 1, read).
- **STT** (bit 13): 1 = generate a START now. The chip clears it again.
- **STP** (bit 11): 1 = generate a STOP when the number of bytes in \`I2CCNT\` has been transferred. The chip clears it once the STOP is on the bus.

Set the register so the module **writes** as a master and ends with a STOP.
`,
      reg: "I2cbRegs.I2CMDR",
      initial: 0x0020,
      targets: [
        { field: "STT", value: 1 },
        { field: "STP", value: 1 },
        { field: "MST", value: 1 },
        { field: "TRX", value: 1 },
      ],
      code: "I2cbRegs.I2CMDR.all = 0x2E20;   // START, STOP, master, transmitter, out of reset",
      hints: [
        "Four bits to set, one to leave alone. Writing means TRX is 1.",
        "Set STT (bit 13), STP (bit 11), MST (bit 10) and TRX (bit 9). Keep IRS (bit 5).",
        "The value is 0x2E20. The lecture's 0x6E20 also sets FREE (bit 14), which only matters at a debugger breakpoint.",
      ],
      takeaway: "0x2C20 reads, 0x2E20 (or the lecture's 0x6E20) writes. The only difference that reaches the bus is TRX, which becomes the R/W bit.",
    },
    {
      id: "bus-i2c-nack",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Is anybody there?",
      goal: "Write read_temp() so it reads a sensor at any address and reports when no device answers.",
      refs: [{ course: "L10" }, { trm: "20.3.4" }, { trm: "20.6.2" }, { trm: "20.4.1" }],
      brief: `
The robot is meant to get a second temperature sensor at address **0x49**. It is not fitted yet. \`main()\` already asks both addresses in turn.

With the code of "Read the temperature", the read of 0x49 would wait for ever: no device pulls SDA low in the ninth clock, so no byte ever arrives.

See it in the figure: choose "step through a transfer" and the address 0x49.

{{figure:i2c-bus}}

## What the chip does on a NACK
When the address is not acknowledged the module sets \`I2CSTR.bit.NACK\` and **stops where it is, holding the bus**: SCL stays low and the bus stays busy. The program must do two things:

- write \`I2CMDR.bit.STP = 1\` so the module makes a STOP and frees the bus
- clear the flag. The flags in \`I2CSTR\` are cleared by **writing a 1** to them: \`I2cbRegs.I2CSTR.all = 0x0002;\` clears NACK (bit 1). Do not use \`.bit.NACK = 1\` here: that reads the whole register and writes it back, which clears every other flag that happens to be set.

## Your task
Write the body of \`void read_temp(uint16_t address, float *degC)\`. It reports through the global \`answered\`:

1. Wait until the previous transfer's STOP is finished: \`while (I2cbRegs.I2CMDR.bit.STP == 1) {}\`. Starting a transfer on top of a STOP that is still on the bus is an error.
2. Set address and count, start a 2-byte read with STOP (mode word 0x2C20).
3. While waiting for the first byte, also watch \`NACK\`. If it is set: STOP, clear the flag, set \`answered = 0\` and \`return\`.
4. Otherwise read both bytes, store the temperature in degrees C through the pointer (\`*degC = ...\`), and set \`answered = 1\`.

A variable that is never written keeps its starting value: \`tempB\` must stay at -1000.
`,
      kit: "robot",
      starter: nackMain("    answered = 0;"),
      solution: nackMain(`    uint16_t msb;
    uint16_t lsb;
    int16_t raw;

    while (I2cbRegs.I2CMDR.bit.STP == 1) {}     // previous STOP finished
    I2cbRegs.I2CSAR.all = address;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;               // START, STOP, master, receive

    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {
        if (I2cbRegs.I2CSTR.bit.NACK == 1) {
            I2cbRegs.I2CMDR.bit.STP = 1;        // free the bus
            I2cbRegs.I2CSTR.all = 0x0002;       // clear NACK
            answered = 0;
            return;
        }
    }
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    lsb = I2cbRegs.I2CDRR.all;

    raw = (msb << 8) | lsb;
    *degC = raw / 256.0;
    answered = 1;`),
      durationMs: 14,
      stimuli: [
        { at: 4, set: "TEMP_C", value: 60.25 },
        { at: 8, set: "TEMP_C", value: -12.5 },
      ],
      checks: [
        { kind: "var", name: "okA", min: 6, label: "The sensor at 0x48 is read again and again", hint: "If this stops at 1, the second call never gets going. After a NACK the bus stays busy until you write STP = 1." },
        { kind: "var", name: "missB", min: 6, label: "Every read of 0x49 ends with answered = 0", hint: "Watch I2CSTR.bit.NACK inside the loop that waits for RRDY." },
        { kind: "var", name: "okB", equals: 0, label: "0x49 is never reported as present" },
        { kind: "var", name: "missA", equals: 0, label: "0x48 is never reported as missing", hint: "A NACK flag left set from the 0x49 read makes the next read of 0x48 look like a failure. Clear it: I2cbRegs.I2CSTR.all = 0x0002;" },
        { kind: "var", name: "tempA", at: 3, equals: 25, label: "tempA is 25 at the start" },
        { kind: "var", name: "tempA", at: 7, equals: 60.25, label: "tempA follows the knob to 60.25" },
        { kind: "var", name: "tempA", at: 12, equals: -12.5, label: "tempA follows the knob to -12.5", hint: "Put the two bytes into an int16_t before dividing, so the sign survives." },
        { kind: "var", name: "tempB", equals: -1000, label: "tempB is left alone" },
        { kind: "no-diagnostic", code: "i2c-busy", label: "No transfer is started while another is on the bus", hint: "Begin read_temp with: while (I2cbRegs.I2CMDR.bit.STP == 1) {}" },
      ],
      watch: ["tempA", "tempB", "answered", "okA", "missA", "okB", "missB"],
      inspect: ["I2cbRegs.I2CSTR", "I2cbRegs.I2CMDR"],
      hints: [
        "Start from the body of read_temperature() in \"Read the temperature\", with `address` in place of 0x48 and the STP wait moved to the top.",
        "Inside `while (I2cbRegs.I2CSTR.bit.RRDY == 0) { ... }` add `if (I2cbRegs.I2CSTR.bit.NACK == 1) { ... return; }`.",
        "In the NACK branch: `I2cbRegs.I2CMDR.bit.STP = 1;` then `I2cbRegs.I2CSTR.all = 0x0002;` then `answered = 0; return;`. At the end: `raw = (msb << 8) | lsb; *degC = raw / 256.0; answered = 1;`",
      ],
      takeaway: "A NACK is information, not a failure: it is how a master finds out what is on the bus. Always send the STOP afterwards, or the bus stays busy.",
    },
    {
      id: "bus-i2c-debug",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "0x91 on the analyser",
      goal: "Find the two mistakes that keep this program from ever reading the sensor at 0x48.",
      refs: [{ course: "L10" }, { trm: "20.3.5" }, { trm: "20.6.2" }],
      brief: `
A teammate watched a working board with a logic analyser, saw the first byte **0x91** = \`1001 0001\` on the bus, and wrote this program from it. The mode word came from the lecture's \`I2CA_WriteData\` example.

It never produces a temperature: \`readings\` stays 0.

There are **two** mistakes, both in \`read_temperature()\`. Fix one and the symptom changes:

- Watch \`nacks\`. If it counts up, nobody answers at the address the chip is calling.
- If \`nacks\` stays 0 and \`readings\` stays 0 as well, the sensor did answer, but the two sides disagree about who sends the data.

Remember what the byte on the bus is made of, and which bit of \`I2CMDR\` decides the R/W bit:

- **STT** bit 13, **STP** bit 11, **MST** bit 10, **TRX** bit 9, **IRS** bit 5, and FREE bit 14 (only matters at a breakpoint)
`,
      kit: "robot",
      starter: i2cDebug("0x91", "0x6E20", "// first byte seen on the logic analyser"),
      solution: i2cDebug("0x48", "0x2C20", "// 7-bit address (0x91 on the bus = 0x48 << 1, + read bit)"),
      durationMs: 16,
      stimuli: [
        { at: 5, set: "TEMP_C", value: 41.5 },
        { at: 10, set: "TEMP_C", value: -20 },
      ],
      checks: [
        {
          kind: "var", name: "nacks", equals: 0,
          label: "The sensor acknowledges its address every time",
          hint: "0x91 is the byte on the wire: the address shifted left, plus the read bit. I2CSAR wants the 7-bit address, 0x91 >> 1.",
        },
        {
          kind: "var", name: "readings", min: 4,
          label: "Readings keep arriving",
          hint: "0x6E20 has TRX (bit 9) set: the chip addresses the sensor for writing and then waits for you to give it data to send. A read needs TRX = 0.",
        },
        { kind: "var", name: "tempC", at: 4, equals: 25, label: "tempC is 25 at the start" },
        { kind: "var", name: "tempC", at: 9, equals: 41.5, label: "tempC follows the knob to 41.5" },
        { kind: "var", name: "tempC", at: 14, equals: -20, label: "tempC follows the knob to -20" },
      ],
      watch: ["nacks", "readings", "tempC"],
      inspect: ["I2cbRegs.I2CSAR", "I2cbRegs.I2CMDR", "I2cbRegs.I2CSTR"],
      hints: [
        "0x91 = 1001 0001. The lowest bit is the R/W bit. What are the seven bits above it, as a number?",
        "TMP_ADDRESS must be 0x48. The chip shifts it and adds the R/W bit by itself.",
        "The mode word for a read is 0x2C20. 0x6E20 is the lecture's word for a write: it has TRX set.",
      ],
      takeaway: "I2CSAR takes the 7-bit address; the analyser shows the 8-bit address byte. And the R/W bit is not yours to write: it is the opposite of TRX.",
    },
    {
      id: "bus-i2c-decode",
      kind: "calc",
      tier: "practice",
      title: "Read the analyser",
      goal: "Decode a captured I2C transfer: the address, the direction, the ACK and a data byte.",
      refs: [{ course: "L10" }, { trm: "20.3.5" }],
      brief: `
A logic analyser on the robot's I2C bus recorded one transfer. It lists the level of **SDA at each rising edge of SCL**, which is when the receiver reads a bit.

After the START:

- clocks 1 to 9: \`1 1 0 1 0 0 0 1 0\`
- clocks 10 to 18: \`0 1 0 1 0 1 1 0 1\`

then a STOP.

Remember the layout: 7 address bits (most significant first), the R/W bit, the ACK bit (0 = acknowledged). Then 8 data bits and another ACK bit.

The device answering is the board's clock chip. Its register 0 holds the seconds in **BCD** (binary coded decimal): the upper 4 bits are the tens digit and the lower 4 bits the ones digit.
`,
      fields: [
        { id: "addr", label: "7-bit address", format: "hex", answer: 0x68, why: "The first seven bits are 110 1000 = 0x68, the clock chip." },
        { id: "rw", label: "R/W bit (0 or 1)", answer: 1, why: "The eighth bit is 1: the master reads." },
        { id: "byte", label: "The whole first byte as the analyser would label it", format: "hex", answer: 0xd1, why: "1101 0001 = 0xD1 = (0x68 << 1) | 1." },
        { id: "ack", label: "Ninth bit: was the address acknowledged? (1 = yes, 0 = no)", answer: 1, why: "SDA is 0 in the ninth clock: the device pulled it low. A 0 there is an ACK." },
        { id: "data", label: "The data byte", format: "hex", answer: 0x56, why: "Clocks 10 to 17: 0101 0110 = 0x56." },
        { id: "sec", label: "Seconds on the clock", unit: "s", answer: 56, why: "BCD: upper digit 5, lower digit 6. Read as plain binary 0x56 would be 86, which no clock shows." },
        { id: "mack", label: "Eighteenth bit: did the master acknowledge the data byte? (1 = yes, 0 = no)", answer: 0, why: "SDA stayed 1: a NACK. The master read the only byte it wanted, and the NACK tells the device to stop sending." },
      ],
      hints: [
        "Split the first nine bits as 7 + 1 + 1.",
        "1101000 is 0x68. With the R/W bit appended it is 1101 0001.",
        "The second group is 0101 0110, then a 1. In BCD, 0x56 means fifty-six.",
      ],
      takeaway: "Seven bits of address, one of direction, one of ACK. A 0 in the ninth clock means yes.",
    },
    {
      id: "bus-i2c-stuck",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The bus that stays busy",
      goal: "Find the two mistakes in read_seconds() that bring the program to a halt.",
      refs: [{ course: "L10" }, { trm: "20.3.4" }, { trm: "20.6.2" }],
      brief: `
This program reads the temperature sensor (0x48) and then the seconds from the clock chip (0x68), over and over. \`read_temperature()\` is correct. \`read_seconds()\` has **two** mistakes. With both, the program stops inside its first pass. With only the first one fixed, it completes one pass and stops in the second: \`cycles\` stays at 1.

## How the clock chip is read
The chip has several registers. To read one, the master first **writes** the register number, then **reads**. Between the two parts it sends no STOP, so no other master can get in between. Instead it sends a second START, a **repeated START**:

- part 1: mode word 0x2620 = START, master, transmit, **no STOP**. When the byte is sent the chip sets \`I2CSTR.bit.ARDY\` and waits, holding the bus.
- part 2: a new mode word with START makes the repeated START and the read.

## Two rules from the lecture
The lecture's \`I2CA_WriteData\` begins with two checks before it touches the bus:

- \`I2CMDR.bit.STP\` must be 0: the STOP of the previous transfer is finished.
- \`I2CSTR.bit.BB\` must be 0: the bus is not busy. BB is 1 from a START until the next STOP.

Every transfer has to end with a STOP, or the bus stays busy for ever.

Read the message under the editor: it names the first problem and its line.
`,
      kit: "robot",
      starter: i2cStuck("", "0x2420"),
      solution: i2cStuck("    while (I2cbRegs.I2CMDR.bit.STP == 1) {}\n    while (I2cbRegs.I2CSTR.bit.BB == 1) {}\n", "0x2C20"),
      durationMs: 14,
      checks: [
        {
          kind: "no-diagnostic", code: "i2c-busy",
          label: "No transfer is started while another is on the bus",
          hint: "read_temperature() returns as soon as it has its second byte, while its STOP is still going out. read_seconds() must wait: while (I2cbRegs.I2CMDR.bit.STP == 1) {}",
        },
        {
          kind: "var", name: "cycles", min: 5,
          label: "The loop keeps running",
          hint: "After the first pass the bus stays busy (BB = 1), so read_temperature() waits for ever. The read in read_seconds() never sends a STOP: 0x2420 has no STP bit (bit 11).",
        },
        { kind: "var", name: "seconds", equals: 56, label: "seconds is 56" },
        { kind: "var", name: "tempC", equals: 25, label: "tempC is 25" },
        { kind: "signal", name: "I2C_STOPS", min: 10, label: "Both transfers end with a STOP each time" },
      ],
      watch: ["cycles", "seconds", "tempC"],
      inspect: ["I2cbRegs.I2CSTR", "I2cbRegs.I2CMDR"],
      hints: [
        "First mistake: read_seconds() starts without waiting. Copy the two wait loops from the top of read_temperature().",
        "Second mistake: compare the mode word of the read part, 0x2420, with the one in read_temperature().",
        "The read part must be `I2cbRegs.I2CMDR.all = 0x2C20;` (STP, bit 11, set). The first part stays 0x2620: no STOP there is intended.",
      ],
      takeaway: "Check STP and BB before every transfer, and end every transfer with a STOP. A missing STOP shows up later, in code that is correct.",
    },
    {
      id: "bus-can-calc",
      kind: "calc",
      tier: "practice",
      title: "Two bytes of distance",
      goal: "Decode the distance bytes of a sensor frame and work out the numbers behind setCANBitRate.",
      refs: [{ trm: "22.12.1" }, { course: "L10" }],
      brief: `
## The distance message
The sensor's "measured distance" frame has 8 data bytes. The first three:

- **byte 0** and **byte 1**: the distance in millimetres, **least significant byte first** (little-endian)
- **byte 2**: the ranging status, 0 when the measurement is valid

So the distance is **256 x byte 1 + byte 0**. The course starter writes it as \`dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];\`

## The bit rate
A CAN node has no clock wire to follow, so it counts time. One bit is divided into a number of equal **time quanta**. The length of a quantum is the CAN clock (200 MHz, the system clock) divided by a prescaler:

**bit rate = CAN clock / (prescaler x time quanta per bit)**

The course calls \`setCANBitRate(200000000, 1000000);\`. For 1 Mbit/s it chooses **10** time quanta per bit and works out the prescaler.

A frame with a 29-bit identifier and 8 data bytes is 128 bits long (the hardware adds a few extra bits on the wire).
`,
      fields: [
        {
          id: "dist",
          label: "A frame arrives with byte 0 = 0xD2 and byte 1 = 0x04. Distance",
          unit: "mm",
          answer: 1234,
          why: "256 x 4 + 210 = 1234. 0xD2 is 210.",
        },
        {
          id: "swapped",
          label: "What a program that swaps the two bytes would report for the same frame",
          unit: "mm",
          answer: 53764,
          why: "256 x 210 + 4 = 53764: more than 53 metres. A reading far outside the sensor's range is the mark of a byte-order mistake.",
        },
        {
          id: "b0",
          label: "The sensor measures 300 mm. Value of byte 0",
          format: "hex",
          answer: 0x2c,
          why: "300 = 0x012C. The low byte, 0x2C, is sent first; byte 1 is 0x01.",
        },
        {
          id: "id",
          label: "Identifier of the distance message of the sensor with device number 2",
          format: "hex",
          answer: 0x060b0102,
          why: "0x060B01ss with ss = 02.",
        },
        {
          id: "presc",
          label: "Prescaler for 1 Mbit/s from 200 MHz with 10 time quanta per bit",
          answer: 20,
          why: "200 000 000 / (20 x 10) = 1 000 000. One time quantum is 100 ns and one bit 1 us.",
        },
        {
          id: "tframe",
          label: "Time on the bus for a 128-bit frame at 1 Mbit/s",
          unit: "us",
          answer: 128,
          why: "128 bits x 1 us. The sensors send every 100 ms, so the bus is idle almost all the time.",
        },
      ],
      hints: [
        "Byte 1 counts 256s, byte 0 counts ones. Convert the hex bytes to decimal first.",
        "Write 300 in hex with four digits. The right-hand pair is byte 0.",
        "Prescaler = 200 000 000 / (1 000 000 x 10).",
      ],
      takeaway: "Little-endian: low byte first. When a 16-bit value from a bus looks absurd, try the bytes the other way round.",
    },
    {
      id: "bus-i2c-setup",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "I2C from two empty functions",
      goal: "Write init_I2CB() and read_temperature() yourself: pins, clock, reset, then a two-byte read.",
      refs: [{ course: "L10" }, { trm: "20.1.4" }, { trm: "20.1.5" }, { trm: "20.3.3" }, { trm: "20.2" }],
      brief: `
In "Read the temperature" both functions were written and you filled in four values. Here both are empty. The course has no I2C starter file, so on the robot you would write exactly this.

## init_I2CB()
1. **Pins.** GPIO40 is SDAB and GPIO41 is SCLB, both at mux position **6**. Each also needs its internal pull-up, because the board has no pull-up resistors, and no input filter:
\`\`\`c
GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP | GPIO_ASYNC);
\`\`\`
2. **Into reset:** \`I2cbRegs.I2CMDR.bit.IRS = 0;\` The clock settings only take effect when the module comes out of reset.
3. **Module clock:** \`I2cbRegs.I2CPSC.all\`. The module wants about 10 MHz: 200 MHz / (I2CPSC + 1).
4. **SCL:** \`I2cbRegs.I2CCLKL\` and \`I2cbRegs.I2CCLKH\`. SCL is low for (I2CCLKL + 5) module clock periods and high for (I2CCLKH + 5). For 100 kHz each half lasts 5 us.
5. **Out of reset:** \`IRS = 1\`.

## read_temperature()
1. \`I2cbRegs.I2CSAR.all\`: the 7-bit address, 0x48. \`I2cbRegs.I2CCNT\`: 2 bytes.
2. \`I2cbRegs.I2CMDR.all\`: one mode word. START (bit 13), STOP (bit 11), master (bit 10), receiver (bit 9 stays 0), out of reset (bit 5).
3. Twice: wait until \`I2cbRegs.I2CSTR.bit.RRDY\` is 1, then read a byte from \`I2cbRegs.I2CDRR.all\`. The first byte is the most significant.
4. Wait until \`I2cbRegs.I2CMDR.bit.STP\` is 0: the STOP is on the bus.
5. \`tempRaw\` from the two bytes, \`tempC = tempRaw / 256.0\`, and count in \`readings\`.

A wait is a loop with an empty body: \`while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}\`. You need two local variables for the bytes.

The tests set the temperature to 30.5 and then to -4 degrees C.
`,
      kit: "robot",
      starter: i2cSetup("    // TODO: pins, reset, clock, out of reset", "    // TODO: address, count, mode word, two bytes, STOP, convert"),
      solution: i2cSetup(I2C_SETUP_INIT, I2C_SETUP_READ),
      durationMs: 16,
      stimuli: [
        { at: 5, set: "TEMP_C", value: 30.5 },
        { at: 10, set: "TEMP_C", value: -4 },
      ],
      checks: [
        { kind: "no-diagnostic", code: "i2c-mux", label: "init 1: GPIO40 and GPIO41 are switched to I2CB", hint: "GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6); and the same for 41." },
        { kind: "no-diagnostic", code: "i2c-pullup", label: "init 1: both lines have a pull-up", hint: "I2C pins only pull low. Without GPIO_PULLUP in GPIO_SetupPinOptions the line never goes high." },
        { kind: "reg", reg: "I2cbRegs.I2CPSC", equals: 19, label: "init 3: the module clock is 10 MHz", hint: "200 MHz / (I2CPSC + 1) = 10 MHz." },
        { kind: "no-diagnostic", code: "i2c-psc-late", label: "init 2: the prescaler is written while the module is in reset", hint: "IRS = 0 comes before I2CPSC, IRS = 1 after the clock settings." },
        { kind: "reg", reg: "I2cbRegs.I2CCLKL", equals: 45, label: "init 4: SCL is low for 5 us", hint: "(I2CCLKL + 5) periods of 0.1 us make 5 us." },
        { kind: "reg", reg: "I2cbRegs.I2CCLKH", equals: 45, label: "init 4: SCL is high for 5 us", hint: "(I2CCLKH + 5) periods of 0.1 us make 5 us." },
        { kind: "reg", reg: "I2cbRegs.I2CMDR", field: "IRS", equals: 1, label: "init 5: the module is out of reset, and stays out", hint: "IRS = 1 at the end of init_I2CB(). A mode word without 0x0020 puts the module back in reset." },
        { kind: "reg", reg: "I2cbRegs.I2CSAR", equals: 0x48, label: "read 1: I2CSAR holds the 7-bit address 0x48", hint: "Write the address as it is. The module shifts it and adds the R/W bit itself." },
        { kind: "reg", reg: "I2cbRegs.I2CCNT", equals: 2, label: "read 1: I2CCNT asks for 2 bytes", hint: "With a count of 0 or 1 the second byte never comes." },
        { kind: "reg", reg: "I2cbRegs.I2CMDR", field: "TRX", equals: 0, label: "read 2: the mode word says receiver", hint: "Bit 9 (0x0200) must stay 0 to read." },
        { kind: "signal", name: "I2C_SCL_HZ", equals: 100000, tol: 500, label: "SCL runs at 100 kHz", hint: "No value: no transfer ever started. The mode word needs START (0x2000) and master (0x0400), and the checks above must be green." },
        {
          kind: "var", name: "readings", min: 4,
          label: "read_temperature() finishes again and again",
          hint: "0: the function is stuck in a wait loop, because no byte arrives. Fix the first red check above.",
        },
        { kind: "var", name: "tempC", at: 4, equals: 25, label: "tempC is 25 at the start", hint: "25 degrees arrives as 0x19, 0x00: tempRaw = (msb << 8) | lsb = 6400. A value near 0.1 means the bytes are swapped." },
        { kind: "var", name: "tempC", at: 9, equals: 30.5, label: "tempC follows the knob to 30.5", hint: "Divide by 256.0, not 256, to keep the half degree." },
        { kind: "var", name: "tempC", at: 14, equals: -4, label: "tempC follows the knob to -4", hint: "tempRaw must stay an int16_t so that values below zero come out negative." },
        { kind: "signal", name: "I2C_STOPS", min: 4, label: "Every read ends with a STOP on the bus", hint: "Bit 11 of the mode word, 0x0800." },
        { kind: "no-diagnostic", code: "i2c", label: "The I2C module reports no problem" },
      ],
      watch: ["tempRaw", "tempC", "readings"],
      inspect: ["I2cbRegs.I2CMDR", "I2cbRegs.I2CSTR", "I2cbRegs.I2CPSC", "I2cbRegs.I2CCLKL", "I2cbRegs.I2CSAR", "I2cbRegs.I2CCNT"],
      hints: [
        "Write init_I2CB() first and run: the init checks turn green before read_temperature() does anything.",
        "I2CPSC = 19. 5 us is 50 periods of 0.1 us, so I2CCLKL = I2CCLKH = 45. The mode word is 0x2000 + 0x0800 + 0x0400 + 0x0020 = 0x2C20.",
        "`msb = I2cbRegs.I2CDRR.all;` after the first wait, `lsb = I2cbRegs.I2CDRR.all;` after the second, then `tempRaw = (msb << 8) | lsb;` and `tempC = tempRaw / 256.0;`",
      ],
      takeaway: "I2C set-up is small: two pins with pull-ups, a prescaler and two clock counts written in reset. A read is address, count, one mode word, and a wait per byte.",
    },
    {
      id: "bus-can-setup",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "The CAN set-up, typed once",
      goal: "Write the whole CAN receive set-up in main(): pins, bit rate, interrupt path, message object, start.",
      refs: [{ course: "L10" }, { trm: "22.4.1" }, { trm: "22.10.3" }, { trm: "22.6" }, { trm: "3.4.5" }],
      brief: `
The final project starter gives you the CAN set-up, and you only change it. Type it once anyway: when a second sensor has to be added, you need to know what each line is for and why the order matters. \`can_isr\` is given.

Write these seven steps after the PIE start-up lines, in this order:

1. **Pins.** GPIO17 is CANRXB and GPIO12 is CANTXB, both at mux position **2**:
\`\`\`c
GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);
\`\`\`
2. **Module and bit rate.** \`InitCANB();\` then \`setCANBitRate(200000000, 1000000);\` The first number is the system clock in Hz, the second the bit rate: 1 Mbit/s, what the sensors send at.
3. **The module's interrupt enables:** \`CanbRegs.CAN_CTL.bit.IE0 = 1;\` and \`CanbRegs.CAN_CTL.bit.EIE = 1;\`
4. **Vector:** \`PieVectTable.CANB0_INT = &can_isr;\` between \`EALLOW;\` and \`EDIS;\`.
5. **Enables:** CANB0 is INT9.7, so \`PIEIER9\` and \`IER\`. Then \`CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;\` and \`EINT;\`
6. **Message object** number \`RX_MSG_OBJ_ID_1\` for sensor 1's identifier, 0x060B0101. It is the call from "Hear sensor 1":
\`\`\`c
CANsetupMessageObject(CANB_BASE, objectNumber, identifier,
    CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_RX, 0,
    CAN_MSG_OBJ_RX_INT_ENABLE, RX_MSG_DATA_LENGTH);
\`\`\`
7. **Start:** \`CanbRegs.CAN_CTL.bit.Init = 0;\` and \`CanbRegs.CAN_CTL.bit.CCE = 0;\`

## Why this order
\`InitCANB()\` leaves the module stopped (\`Init = 1\`) and empties every message object, so it comes before the object. The bit rate belongs to the stopped module too, so it follows at once. Step 7 comes last: from then on frames arrive.

The sensor sends every 100 ms. The tests move it to 1234 mm, then to 300 mm.
`,
      kit: "robot",
      starter: canSetup("    // TODO: the CAN set-up, steps 1 to 7"),
      solution: canSetup(CAN_SETUP_BODY),
      durationMs: 330,
      stimuli: [
        { at: 60, set: "CAN_DIST1_MM", value: 1234 },
        { at: 160, set: "CAN_DIST1_MM", value: 300 },
      ],
      checks: [
        { kind: "no-diagnostic", code: "can-rx-mux", label: "1. GPIO17 is switched to CANRXB", hint: "GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);" },
        { kind: "no-diagnostic", code: "can-tx-mux", label: "1. GPIO12 is switched to CANTXB", hint: "GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2); A receiver needs its transmit pin too: it acknowledges every frame." },
        { kind: "signal", name: "CAN_BITRATE", equals: 1000000, label: "2. The bit rate is 1 Mbit/s", hint: "No value: setCANBitRate was never called. A wrong value: the arguments are the system clock in Hz, then the bit rate." },
        { kind: "reg", reg: "CanbRegs.CAN_CTL", field: "IE0", equals: 1, label: "3. The module may use interrupt line 0", hint: "CanbRegs.CAN_CTL.bit.IE0 = 1; after InitCANB(), which resets the module." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER9", field: "INTx7", equals: 1, label: "5. CANB0 is enabled in the PIE", hint: "PieCtrlRegs.PIEIER9.bit.INTx7 = 1; and IER |= M_INT9;" },
        { kind: "reg", reg: "CanbRegs.CAN_GLB_INT_EN", field: "GLBINT0_EN", equals: 1, label: "5. The module's global interrupt switch is on", hint: "CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;" },
        {
          kind: "signal", name: "CAN_RX_FRAMES", min: 3,
          label: "6. Sensor 1's frames are stored in the message object",
          hint: "No frame matched. Check the identifier 0x060b0101 and CAN_MSG_FRAME_EXT, and that the call comes after InitCANB(), which empties every object.",
        },
        { kind: "reg", reg: "CanbRegs.CAN_CTL", field: "Init", equals: 0, label: "7. The module takes part in the bus traffic", hint: "CanbRegs.CAN_CTL.bit.Init = 0; as the last step." },
        { kind: "isr", fn: "can_isr", min: 3, label: "can_isr runs for every frame", hint: "Frames are stored but no interrupt reaches the CPU: one of the enables of steps 3 to 5 is missing, or EINT." },
        { kind: "var", name: "dis_1", at: 50, equals: 500, label: "dis_1 is 500 mm at the start", hint: "1200 is sensor 2: the identifier must end in 01." },
        { kind: "var", name: "dis_1", at: 250, equals: 300, label: "dis_1 follows the sensor to 300 mm" },
        { kind: "no-diagnostic", code: "eallow", label: "The vector is written between EALLOW; and EDIS;" },
        { kind: "no-diagnostic", code: "can", label: "The CAN module reports no problem" },
      ],
      watch: ["dis_1", "rxMsgCount_1"],
      inspect: ["CanbRegs.CAN_CTL", "CanbRegs.CAN_INT", "CanbRegs.CAN_GLB_INT_EN", "PieCtrlRegs.PIEIER9"],
      hints: [
        "Seven steps, about twenty lines, and most are spelled out in the brief. Run after each step: the checks carry the step numbers.",
        "Step 5: `PieCtrlRegs.PIEIER9.bit.INTx7 = 1;` `IER |= M_INT9;` Step 6: the object number is RX_MSG_OBJ_ID_1 and the identifier 0x060b0101.",
        "The finished block is in \"Hear sensor 1\", from the comment //GPIO17 down to the two CAN_CTL lines before while(1).",
      ],
      takeaway: "Pins, InitCANB, bit rate, interrupt path, message objects, then Init = 0. Adding a sensor is one more message object and one more branch in can_isr.",
    },

    // ------------------------------------------------------------------ expert
    {
      id: "bus-i2c-bitbang",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "I2C by hand",
      goal: "Without the I2C module, drive GPIO40 and GPIO41 yourself to set the sensor's high-temperature limit to 30.5 degrees C.",
      refs: [{ course: "L10" }, { trm: "20.3.2" }, { trm: "20.3.4" }, { trm: "8.3" }, { trm: "8.8" }],
      brief: `
I2C is simple enough to produce with two ordinary GPIO pins. This is called **bit-banging**. Doing it once shows exactly what the I2C module does for you.

## The sensor's registers
The temperature sensor at 0x48 has four registers. A write transfer is: the address byte, then a **pointer** byte that selects the register, then the register's two bytes, most significant first. Register **3** is the high-temperature limit, in the same format as the temperature (degrees x 256).

So the transfer is: START, four bytes, STOP. Work out the four bytes for a limit of **30.5 degrees C**.

## The pins
Use GPIO40 as SDA and GPIO41 as SCL, as **GPIO outputs** (mux position 0), not through the I2C module.

- The pins must be **open-drain** with the pull-up on: \`GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_OPENDRAIN | GPIO_PULLUP);\`. An open-drain output with a 1 in its latch lets go of the pin. With a 0 it pulls low.
- A push-pull output would drive 3.3 V against the sensor's ACK: a short circuit.
- A pin that becomes an output drives whatever its latch holds, and the latch is 0 after reset. Decide what the bus should see at that moment.
- Use the SET and CLEAR registers. To read the ACK, read the pin: \`GpioDataRegs.GPBDAT.bit.GPIO40\`.

## Timing
Keep every SCL low time and high time at 5 microseconds or more (\`DELAY_US(5)\`): 100 kHz. Change SDA only while SCL is low, except for START and STOP.

## Your task
Write \`sda()\`, \`scl()\`, \`send_byte()\` and the transfer in \`main()\`. Count the acknowledged bytes in \`acks\`: all four must be acknowledged. Leave both lines released at the end.
`,
      kit: "robot",
      starter: BITBANG_STARTER,
      solution: BITBANG_SOLUTION,
      durationMs: 3,
      checks: [
        { kind: "signal", name: "I2C_ADDR_ACKS", equals: 1, label: "The sensor recognises its address after one START", hint: "The first byte is (0x48 << 1) | 0 = 0x90, most significant bit first. SDA must fall while SCL is high before it." },
        { kind: "signal", name: "TMP_POINTER", equals: 3, label: "The pointer byte selects register 3" },
        { kind: "signal", name: "TMP_THIGH_C", equals: 30.5, label: "The sensor's high limit is 30.5 degrees C", hint: "30.5 x 256 = 7808 = 0x1E80: send 0x1E, then 0x80." },
        { kind: "var", name: "acks", equals: 4, label: "acks counts all four bytes", hint: "Release SDA, raise SCL, wait, then read GPBDAT.bit.GPIO40 while SCL is still high. 0 means acknowledged." },
        { kind: "signal", name: "I2C_STOPS", equals: 1, label: "The transfer ends with one STOP", hint: "SDA low while SCL is low, SCL high, then SDA high." },
        { kind: "pin", pin: 40, at: 2.9, level: 1, label: "SDA is released at the end" },
        { kind: "pin", pin: 41, at: 2.9, level: 1, label: "SCL is released at the end" },
        { kind: "no-diagnostic", code: "short", label: "No output fights the sensor", hint: "Both pins must be open-drain: GPIO_OPENDRAIN | GPIO_PULLUP." },
        { kind: "source", mustNotMatch: "I2c[ab]Regs", label: "The I2C module is not used" },
        { kind: "no-dat-write", label: "Outputs are changed with SET and CLEAR only" },
      ],
      watch: ["acks"],
      hints: [
        "Set both latches to 1 (GPBSET) before making the pins outputs, so the bus stays idle. Then START is: sda(0), wait, scl(0).",
        "send_byte: for bits 7 down to 0: set SDA, wait, SCL high, wait, SCL low. Then release SDA, wait, SCL high, wait, read the pin, SCL low.",
        "The bytes are 0x90, 0x03, 0x1E, 0x80. STOP is: sda(0), wait, scl(1), wait, sda(1).",
      ],
      takeaway: "Open-drain pins, a pull-up, and three rules (START, STOP, data stable while SCL is high) are all of I2C's physical layer.",
    },
    {
      id: "bus-i2c-scan",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Bus scan",
      goal: "Set up I2CB from the registers, try every valid address, and print which devices answer.",
      refs: [{ course: "L10" }, { trm: "20.1.4" }, { trm: "20.1.5" }, { trm: "20.2" }, { trm: "20.6.2" }],
      brief: `
A bus scan is the first thing to run on a new board: call every address and note which ones are acknowledged.

Nothing is given this time except the serial port.

## Requirements
- Set up I2CB yourself: GPIO40 (SDAB) and GPIO41 (SCLB) at mux position 6 with their pull-ups on, a module clock between 7 and 12 MHz, the prescaler written while \`IRS\` is 0, and SCL no faster than 400 kHz.
- Try the addresses **0x08 to 0x77**, in rising order. The 16 addresses below and above that range are reserved by the I2C standard and must not be called.
- An address counts as present when it is acknowledged. A simple probe is to read one byte from it.
- Every probe must end with a STOP, also after a NACK.
- Store the addresses that answered in \`found[]\`, their number in \`count\`, and set \`scanDone = 1\` when the last probe's STOP is finished.
- **Then** print one line per device and a summary:

\`\`\`c
serial_printf(&SerialA, "0x%02X\\r\\n", found[i]);
serial_printf(&SerialA, "%d devices\\r\\n", count);
\`\`\`

The star is for speed: at 400 kHz the whole scan fits in 4 ms.
`,
      kit: "robot",
      starter: SCAN_STARTER,
      solution: SCAN_SOLUTION,
      durationMs: 30,
      checks: [
        { kind: "serial", equals: "0x48\r\n0x68\r\n2 devices\r\n", label: "The terminal lists 0x48 and 0x68, then: 2 devices" },
        { kind: "var", name: "count", equals: 2, label: "count is 2" },
        { kind: "var", name: "scanDone", equals: 1, label: "scanDone is set" },
        { kind: "signal", name: "I2C_ADDR_NACKS", equals: 110, label: "Exactly the 110 empty addresses from 0x08 to 0x77 were called and not acknowledged", hint: "112 addresses, 2 devices. More means reserved addresses were called or an address was tried twice." },
        { kind: "signal", name: "I2C_STOPS", equals: 112, label: "Every probe ends with a STOP", hint: "After a NACK: I2cbRegs.I2CMDR.bit.STP = 1; then clear the flag with I2cbRegs.I2CSTR.all = 0x0002;" },
        { kind: "signal", name: "I2C_SCL_HZ", max: 400000, label: "SCL is not faster than 400 kHz" },
      ],
      bonus: [
        { kind: "var", name: "scanDone", at: 4, equals: 1, label: "The scan is finished within 4 ms", hint: "That needs SCL at 400 kHz: with a 10 MHz module clock, (I2CCLKL + 5) + (I2CCLKH + 5) = 25." },
      ],
      watch: ["count", "scanDone"],
      inspect: ["I2cbRegs.I2CSTR", "I2cbRegs.I2CMDR", "I2cbRegs.I2CPSC"],
      hints: [
        "Write a function that probes one address and returns 1 or 0. It is read_temp() from \"Is anybody there?\" with a count of 1.",
        "Clock: I2CPSC = 19 gives 10 MHz. I2CCLKL = 10 and I2CCLKH = 5 give 10 MHz / 25 = 400 kHz. Write them while IRS is 0.",
        "Loop `for (address = 0x08; address <= 0x77; address++)`. After the loop wait for STP == 0, set scanDone, then print.",
      ],
      takeaway: "A NACK costs one byte time. Scanning 112 addresses at 400 kHz takes about 3 ms, so a robot can check at power-up that all its sensors are there.",
    },
    {
      id: "bus-can-median",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Trust, but filter",
      goal: "Take the median of sensor 1's last three distances, and detect when sensor 2 stops sending.",
      refs: [{ course: "L10" }, { trm: "22.6" }, { trm: "22.10.3" }, { trm: "3.4.5" }],
      brief: `
Real distance sensors glitch: one reading in many is far off. And cables come loose: a sensor that falls silent leaves its last value behind, which looks perfectly healthy. A robot that drives by these values must handle both.

The pins, the CAN bit rate, the PIE and the two vectors are set up. The rest is yours: the timer, the interrupt enables, the message objects, starting the CAN module, and both interrupt functions.

## Sensor 1: median of three
Keep the last three distances of sensor 1 (identifier 0x060B0101). After each new one, store the **median** (the middle value of the three) in \`dis1_med\`. Start with the three stored values at 0. A single wild reading never reaches the output.

## Sensor 2: time-out
Store sensor 2's distance (identifier 0x060B0102) in \`dis_2\`. The sensor sends every 100 ms. If **more than 250 ms** pass without a frame from it:

- \`sensor2_ok\` becomes 0 and **LED1** (GPIO22) goes on

When a frame arrives again, \`sensor2_ok\` becomes 1 and LED1 goes off.

CAN cannot tell you that something did **not** happen. Use CPU timer 0 for that: \`ConfigCpuTimer(&CpuTimer0, 200, period in microseconds)\`, \`CpuTimer0Regs.TCR.all = 0x4000;\`, PIE group 1 interrupt 7. Choose its period to suit the star: the loss must be flagged no later than 265 ms after the last frame.

The tests give sensor 1 one wild reading of 3000 mm, unplug sensor 2 for a while and plug it in again.
`,
      kit: "robot",
      starter: MEDIAN_STARTER,
      solution: MEDIAN_SOLUTION,
      durationMs: 950,
      stimuli: [
        { at: 150, set: "CAN_DIST1_MM", value: 520 },
        { at: 300, set: "CAN_DIST1_MM", value: 3000 },
        { at: 310, set: "CAN_DIST1_MM", value: 540 },
        { at: 400, set: "CAN_DIST2_MM", value: -1 },
        { at: 800, set: "CAN_DIST2_MM", value: 900 },
      ],
      checks: [
        { kind: "isr", fn: "can_isr", min: 15, label: "can_isr runs for the frames of both sensors" },
        { kind: "var", name: "dis1_med", at: 50, equals: 0, label: "After one reading the median of (0, 0, 500) is 0" },
        { kind: "var", name: "dis1_med", at: 250, equals: 500, label: "The median settles at 500 mm" },
        { kind: "var", name: "dis1_med", at: 350, equals: 520, label: "The 3000 mm glitch does not reach dis1_med", hint: "The last three readings are 500, 520 and 3000. Their median is 520." },
        { kind: "var", name: "dis1_med", at: 450, equals: 540, label: "After the glitch: 540 mm", hint: "The last three are 520, 3000, 540. Sorted: 520, 540, 3000." },
        { kind: "var", name: "dis1_med", at: 700, equals: 540, label: "The median stays at 540 mm" },
        { kind: "var", name: "dis_2", at: 350, equals: 1200, label: "dis_2 is 1200 mm while sensor 2 sends" },
        { kind: "var", name: "sensor2_ok", at: 350, equals: 1, label: "sensor2_ok is 1 while sensor 2 sends" },
        { kind: "led", led: "LED1", at: 500, on: false, label: "170 ms of silence: LED1 still off" },
        { kind: "led", led: "LED1", at: 650, on: true, label: "Sensor 2 silent for more than 250 ms: LED1 on" },
        { kind: "var", name: "sensor2_ok", at: 650, equals: 0, label: "sensor2_ok is 0 while sensor 2 is silent" },
        { kind: "led", led: "LED1", at: 900, on: false, label: "Sensor 2 back: LED1 off" },
        { kind: "var", name: "sensor2_ok", at: 900, equals: 1, label: "sensor2_ok is 1 again" },
        { kind: "var", name: "dis_2", at: 900, equals: 900, label: "dis_2 shows the new distance, 900 mm" },
      ],
      bonus: [
        { kind: "led", led: "LED1", at: 596, on: true, label: "The loss is flagged within 265 ms of the last frame", hint: "Sensor 2's last frame ends at 330.1 ms. A timer period of 10 ms or less finds the 250 ms limit in time." },
      ],
      watch: ["dis1_med", "dis_2", "sensor2_ok"],
      inspect: ["CanbRegs.CAN_INT", "CpuTimer0Regs.TCR", "PieCtrlRegs.PIEIER1", "PieCtrlRegs.PIEIER9"],
      hints: [
        "Median of three without sorting: it is the value that is neither the largest nor the smallest. A few nested comparisons do it. Keep the three values in an array and overwrite the oldest.",
        "Let the timer interrupt add its period to a counter of milliseconds, and let can_isr set that counter to 0 when sensor 2's frame arrives. Above 250: flag the loss. Stop counting there, or the 16-bit counter wraps.",
        "Enables: PIEIER1.bit.INTx7 and PIEIER9.bit.INTx7, IER |= M_INT1 and M_INT9, CAN_GLB_INT_EN.bit.GLBINT0_EN, EINT. Then two CANsetupMessageObject calls, and Init = 0.",
      ],
      takeaway: "A bus tells you when data arrives. Only a timer tells you when it does not. Every value that comes over a bus needs both: a sanity filter and an age.",
    },
  ],
};
