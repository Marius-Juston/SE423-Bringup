import type { Chapter } from "../types";

// ------------------------------------------------------------------ data
// Small test images and maps are written into each level's code as plain
// C arrays, generated here from pictures made of letters.

const cArray = (type: string, name: string, size: string, vals: number[], perLine: number): string => {
  const width = Math.max(...vals.map((v) => String(v).length));
  const lines: string[] = [];
  for (let i = 0; i < vals.length; i += perLine)
    lines.push("    " + vals.slice(i, i + perLine).map((v) => String(v).padStart(width)).join(", "));
  return `${type} ${name}[${size}] = {\n${lines.join(",\n")}\n};`;
};

const cells = (picture: string[]): string[] => picture.flatMap((row) => row.split(" "));

/** 0/1 mask from a picture of "." and "1". */
const maskArray = (name: string, picture: string[]) =>
  cArray("uint16_t", name, "NPIX", cells(picture).map((c) => (c === "1" ? 1 : 0)), picture[0].split(" ").length);

// Colours of the camera test image, as (R, G, B) from 0 to 255.
const RGB: Record<string, [number, number, number]> = {
  ".": [160, 160, 160], // grey floor in the light
  ",": [64, 64, 64], // grey floor in the shadow
  O: [255, 128, 0], // orange golf ball in the light
  o: [102, 51, 0], // the same ball in the shadow
  B: [0, 90, 255], // blue golf ball
  Y: [230, 200, 40], // yellow tape
  R: [230, 20, 40], // red cone
  W: [180, 150, 120], // wooden wall: orange hue, but pale
};

const BALL_IMAGE = [
  ". . . . . . . . , , , ,",
  ". B B . . . . . , , , ,",
  ". B B . . . O O o o , ,",
  ". . . . . . O O o o , ,",
  "W W . . . . O O o o , ,",
  "W W . Y . . . O o , , ,",
  ". . . . . R . . , , , ,",
  ". . . . . . . . , , , ,",
];

const rgbArrays = (picture: string[]) =>
  [0, 1, 2]
    .map((ch) => cArray("uint16_t", `img_${"rgb"[ch]}`, "NPIX", cells(picture).map((c) => RGB[c][ch]), 12))
    .join("\n\n");

const IMG_DEFS = `#define ROWS 8
#define COLS 12
#define NPIX (ROWS * COLS)`;

// The finished conversion, reused by the levels after it.
const HSL_BODY = `    float hi, lo, d;

    r = r / 255.0f;
    g = g / 255.0f;
    b = b / 255.0f;

    // Largest and smallest of the three channels
    hi = r;
    if (g > hi) hi = g;
    if (b > hi) hi = b;
    lo = r;
    if (g < lo) lo = g;
    if (b < lo) lo = b;
    d = hi - lo;

    *l = (hi + lo) / 2.0f;
`;

const HSL_FN = `// (r, g, b) from 0 to 255  ->  hue in degrees (0 to 360), saturation and lightness from 0 to 1
void rgb_to_hsl(float r, float g, float b, float *h, float *s, float *l)
{
${HSL_BODY}
    if (d == 0.0f) {
        *h = 0.0f;      // grey: no colour, so no hue
        *s = 0.0f;
        return;
    }
    *s = d / (1.0f - fabs(2.0f * (*l) - 1.0f));
    if (hi == r) {
        *h = 60.0f * ((g - b) / d);
    } else if (hi == g) {
        *h = 60.0f * ((b - r) / d + 2.0f);
    } else {
        *h = 60.0f * ((r - g) / d + 4.0f);
    }
    if (*h < 0.0f) {
        *h = *h + 360.0f;
    }
}`;

const hslProgram = (rest: string) => `float hA, sA, lA;   // orange ball in the light
float hB, sB, lB;   // the same ball in the shadow
float hC, sC, lC;   // blue ball
float hD, sD, lD;   // green marker
float hE, sE, lE;   // red cone
float hF, sF, lF;   // grey floor

// (r, g, b) from 0 to 255  ->  hue in degrees (0 to 360), saturation and lightness from 0 to 1
void rgb_to_hsl(float r, float g, float b, float *h, float *s, float *l)
{
${HSL_BODY}
${rest}
}

void main(void)
{
    rgb_to_hsl(255.0f, 128.0f, 0.0f, &hA, &sA, &lA);
    rgb_to_hsl(102.0f, 51.0f, 0.0f, &hB, &sB, &lB);
    rgb_to_hsl(0.0f, 90.0f, 255.0f, &hC, &sC, &lC);
    rgb_to_hsl(40.0f, 200.0f, 120.0f, &hD, &sD, &lD);
    rgb_to_hsl(230.0f, 20.0f, 40.0f, &hE, &sE, &lE);
    rgb_to_hsl(128.0f, 128.0f, 128.0f, &hF, &sF, &lF);
    while (1) {}
}
`;

// ---- threshold + moments on the ball image
const targetProgram = (body: string) => `${IMG_DEFS}

#define H_MIN 15.0f       // orange: hue from 15 to 45 degrees ...
#define H_MAX 45.0f
#define S_MIN 0.5f        // ... and a strong colour
#define CENTRE_COL 6.0f   // middle of the image (COLS / 2)
#define KP_TURN 0.5f

${rgbArrays(BALL_IMAGE)}

uint16_t mask[NPIX];      // 1 where the pixel is the target colour
uint16_t area = 0;        // M00: number of pixels in the mask
float cx = 0;             // centroid column
float cy = 0;             // centroid row
float turn = 0;           // turn command

${HSL_FN}

void find_target(void)
{
${body}
}

void main(void)
{
    find_target();
    while (1) {}
}
`;

const BALL_MASK = [
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
  ". . . . . . 1 1 1 1 . .",
  ". . . . . . 1 1 1 1 . .",
  ". . . . . . 1 1 1 1 . .",
  ". . . . . . . 1 1 . . .",
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
];

const CORNER_MASK = [
  ". . . . . . . . . . . .",
  ". . . . . . . . 1 1 1 1",
  ". . . . . . . . 1 1 1 1",
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
  ". . . . . . . . . . . .",
];

const momentsProgram = (picture: string[], o: { decl: string; sums: string; divide: string }) => `${IMG_DEFS}

#define CENTRE_COL 6.0f   // middle of the image (COLS / 2)
#define KP_TURN 0.5f

// The mask after thresholding: 1 = target colour
${maskArray("mask", picture)}

uint16_t area = 0;        // M00
float cx = 0;             // centroid column: M10 / M00
float cy = 0;             // centroid row:    M01 / M00
float turn = 0;           // positive = turn left, negative = turn right

void find_centroid(void)
{
    int row, col;
${o.decl}

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            if (mask[row * COLS + col] == 1) {
${o.sums}
            }
        }
    }

    area = m00;
    if (m00 > 0) {
${o.divide}
        turn = KP_TURN * (CENTRE_COL - cx);
    }
}

void main(void)
{
    find_centroid();
    while (1) {}
}
`;

// ---- hue wrap-around
const RED_HUE: Record<string, [number, number]> = {
  ".": [0, 0], // grey floor: hue 0 by convention, saturation 0
  a: [352, 85],
  b: [357, 90],
  c: [2, 90],
  d: [8, 80],
  O: [30, 90], // orange ball
  M: [320, 80], // magenta marker
};
const RED_IMAGE = [
  ". . . . . . . .",
  ". . a b c d . .",
  ". . b c a c . M",
  ". . d a b b . M",
  ". O . . . . . .",
  ". O . . . . . .",
];
const redProgram = (test: string) => `#define ROWS 6
#define COLS 8
#define NPIX (ROWS * COLS)

#define H_MIN 340         // red: from 340 degrees ...
#define H_MAX 20          // ... through 0 to 20 degrees
#define S_MIN 50          // percent

// Hue of every pixel in degrees, and saturation in percent
${cArray("uint16_t", "hue", "NPIX", cells(RED_IMAGE).map((c) => RED_HUE[c][0]), 8)}

${cArray("uint16_t", "sat", "NPIX", cells(RED_IMAGE).map((c) => RED_HUE[c][1]), 8)}

uint16_t mask[NPIX];
uint16_t area = 0;
float cx = 0;
float cy = 0;

void find_red(void)
{
    int row, col, i;
    float m00 = 0, m10 = 0, m01 = 0;

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            i = row * COLS + col;
            if (${test}) {
                mask[i] = 1;
                m00 += 1;
                m10 += col;
                m01 += row;
            } else {
                mask[i] = 0;
            }
        }
    }

    area = (uint16_t)m00;
    if (m00 > 0) {
        cx = m10 / m00;
        cy = m01 / m00;
    }
}

void main(void)
{
    find_red();
    while (1) {}
}
`;

// ---- blobs
const BLOB_MASK = [
  ". . . . . . . . . . 1 .",
  ". 1 1 1 . . . . . . . .",
  ". 1 1 1 . . . . . . . .",
  ". 1 1 1 1 . . . 1 1 . .",
  ". . . . . 1 . . 1 1 . .",
  ". . . . . . . . 1 1 . .",
  ". 1 1 . . . . . . . . .",
  ". . . . . . . . . . . .",
];

const blobProgram = (body: string) => `${IMG_DEFS}
#define MIN_AREA 4        // blobs smaller than this are noise

${maskArray("mask", BLOB_MASK)}

uint16_t label[NPIX];     // 0 = not visited yet, otherwise the blob number
int stack[NPIX];          // pixels waiting to be visited

uint16_t numRaw = 0;      // all blobs, noise included
uint16_t numBlobs = 0;    // blobs with at least MIN_AREA pixels
uint16_t bestArea = 0;    // area of the largest blob
float bestCx = 0;         // its centroid column
float bestCy = 0;         // its centroid row

void find_blobs(void)
{
${body}
}

void main(void)
{
    find_blobs();
    while (1) {}
}
`;

const TWO_PASS_MASK = [
  ". . . . . . . . . . . .",
  ". 1 . . 1 . . 1 1 1 . .",
  ". 1 . . 1 . . . . 1 . .",
  ". 1 1 1 1 . . 1 . 1 . .",
  ". . . . . . . 1 1 1 . .",
  ". . 1 . . . . . . . . .",
  ". 1 1 1 . . 1 . 1 . . .",
  ". . 1 . . . 1 1 1 . . .",
];

const twoPassProgram = (fns: string) => `${IMG_DEFS}

${maskArray("mask", TWO_PASS_MASK)}

uint16_t label[NPIX];     // 0 = background, otherwise the blob's label
uint16_t numBlobs = 0;    // number of blobs found
uint16_t labelsOk = 0;    // set by check_labels()

${fns}

// Checks the result. Do not change.
int check_labels(void)
{
    int row, col, i;

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            i = row * COLS + col;
            if (mask[i] == 0) {
                if (label[i] != 0) return 0;          // background must stay 0
            } else {
                if (label[i] == 0) return 0;          // every object pixel needs a label
                // touching pixels belong to the same blob
                if (col + 1 < COLS && mask[i + 1] == 1 && label[i + 1] != label[i]) return 0;
                if (row + 1 < ROWS && mask[i + COLS] == 1 && label[i + COLS] != label[i]) return 0;
            }
        }
    }
    // one pixel of each of the four shapes: all different
    if (label[1 * COLS + 1] == label[1 * COLS + 7]) return 0;
    if (label[1 * COLS + 1] == label[5 * COLS + 2]) return 0;
    if (label[1 * COLS + 1] == label[6 * COLS + 6]) return 0;
    if (label[1 * COLS + 7] == label[5 * COLS + 2]) return 0;
    if (label[1 * COLS + 7] == label[6 * COLS + 6]) return 0;
    if (label[5 * COLS + 2] == label[6 * COLS + 6]) return 0;
    return 1;
}

void main(void)
{
    label_blobs();
    labelsOk = check_labels();
    while (1) {}
}
`;

// ------------------------------------------------------------------ planning
const mapText = (rows: string[]) => rows.map((r) => `    "${r}"`).join("\n");

const MAZE = ["000x000", "0x0x0x0", "0x000x0", "0xxxxx0", "000000x", "0x0x0x0"];
const TRAP = ["00xx0x0", "00000x0", "000x0x0", "000x000", "0000000", "0000x00"];
const OPEN_FLOOR = ["0x0x000", "0000000", "00x0000", "00000x0", "0x0x000", "0000000"];

const GRID_DEFS = (rows: string[]) => `#define ROWS 6
#define COLS 7
#define NCELLS (ROWS * COLS)

// The map as the course code stores it: one row after the other.
// 'x' is an obstacle, '0' is free. Cell (row, col) is map[row * COLS + col].
char map[NCELLS + 1] =
${mapText(rows)};`;

const CAN_TRAVEL = `// 1 if (row, col) is on the map and free
int canTravel(int row, int col)
{
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        return 0;
    }
    if (map[row * COLS + col] == 'x') {
        return 0;
    }
    return 1;
}`;

const bfsProgram = (o: { qmax?: number; extra?: string; body: string; main: string; globals: string }) => `${GRID_DEFS(MAZE)}

int queue[${o.qmax ?? "NCELLS"}];      // the frontier: cells waiting to be expanded
int dist[NCELLS];       // steps from the start, -1 = not reached yet
${o.globals}

${CAN_TRAVEL}

// Number of steps of the shortest path, or -1 if there is none
int bfs(int rowStart, int colStart, int rowEnd, int colEnd)
{
${o.body}
}

void main(void)
{
${o.main}
    while (1) {}
}
`;

const BFS_SOLUTION_BODY = `    int dRow[4] = {-1, 0, 0, 1};
    int dCol[4] = {0, -1, 1, 0};
    int head = 0;
    int tail = 0;
    int goal = rowEnd * COLS + colEnd;
    int i, k, cur, row, col, next;

    for (i = 0; i < NCELLS; i++) {
        dist[i] = -1;
    }
    cur = rowStart * COLS + colStart;
    dist[cur] = 0;
    queue[tail] = cur;
    tail++;

    while (head < tail) {
        cur = queue[head];
        head++;
        if (cur == goal) {
            return dist[cur];       // early exit
        }
        for (k = 0; k < 4; k++) {
            row = cur / COLS + dRow[k];
            col = cur % COLS + dCol[k];
            if (canTravel(row, col)) {
                next = row * COLS + col;
                if (dist[next] == -1) {
                    dist[next] = dist[cur] + 1;
                    queue[tail] = next;
                    tail++;
                }
            }
        }
    }
    return -1;`;

const ASTAR_GLOBALS = `int g[NCELLS];          // cost of the best path found so far from the start to each cell
int parent[NCELLS];     // the cell we came from, -1 for the start
int state[NCELLS];      // 0 = not seen, 1 = in the open set, 2 = closed
int pathRow[NCELLS];    // the path, from the goal back to the start
int pathCol[NCELLS];
int pathLen = 0;
int expanded = 0;       // cells taken out of the open set`;

const CHECK_PATH = `// Number of steps of the path in pathRow/pathCol, or -1 if it is not a
// connected path of free cells from the goal back to the start. Do not change.
int check_path(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int i, d;

    if (pathLen < 1) return -1;
    if (pathRow[0] != rowEnd || pathCol[0] != colEnd) return -1;
    if (pathRow[pathLen - 1] != rowStart || pathCol[pathLen - 1] != colStart) return -1;
    for (i = 0; i < pathLen; i++) {
        if (canTravel(pathRow[i], pathCol[i]) == 0) return -1;
        if (i > 0) {
            d = abs(pathRow[i] - pathRow[i - 1]) + abs(pathCol[i] - pathCol[i - 1]);
            if (d != 1) return -1;
        }
    }
    return pathLen - 1;
}`;

interface AstarParts {
  rows: string[];
  heuristic: string;
  walk: string;
  f: string;
  noPath: string;
  newG: string;
  setParent: string;
  globals: string;
  main: string;
}

const astarProgram = (p: AstarParts) => `${GRID_DEFS(p.rows)}

${ASTAR_GLOBALS}
${p.globals}

${CAN_TRAVEL}

// Estimate of the remaining cost from a cell to the goal
int heuristic(int rowCurr, int colCurr, int rowGoal, int colGoal)
{
${p.heuristic}
}

// Follows the parents from the goal back to the start and stores the cells
// in pathRow / pathCol (so the path is in reverse order, as in the course code)
void reconstructPath(int rowEnd, int colEnd)
{
    int cur = rowEnd * COLS + colEnd;

    pathLen = 0;
    while (cur != -1) {
        pathRow[pathLen] = cur / COLS;
        pathCol[pathLen] = cur % COLS;
        pathLen++;
${p.walk}
    }
}

// Returns 1 if a path was found, 0 if there is no path, 2 if start == goal
int astar(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int dRow[4] = {-1, 0, 0, 1};
    int dCol[4] = {0, -1, 1, 0};
    int goal = rowEnd * COLS + colEnd;
    int bestF = 0;
    int i, k, cur, f, row, col, next, newG;

    for (i = 0; i < NCELLS; i++) {
        g[i] = 0;
        parent[i] = -1;
        state[i] = 0;
    }
    expanded = 0;
    pathLen = 0;
    if (rowStart == rowEnd && colStart == colEnd) {
        return 2;
    }
    state[rowStart * COLS + colStart] = 1;      // the open set starts with the start cell

    while (1) {
        // Take the open cell with the smallest f = g + h
        cur = -1;
        for (i = 0; i < NCELLS; i++) {
            if (state[i] == 1) {
${p.f}
                if (cur == -1 || f < bestF) {
                    cur = i;
                    bestF = f;
                }
            }
        }
        if (cur == -1) {
${p.noPath}
        }
        if (cur == goal) {
            reconstructPath(rowEnd, colEnd);
            return 1;
        }
        state[cur] = 2;                         // closed: its best path is known
        expanded++;

        // Look at the four neighbours
        for (k = 0; k < 4; k++) {
            row = cur / COLS + dRow[k];
            col = cur % COLS + dCol[k];
            if (canTravel(row, col)) {
                next = row * COLS + col;
${p.newG}
                if (state[next] == 0 || (state[next] == 1 && newG < g[next])) {
                    g[next] = newG;
${p.setParent}
                    state[next] = 1;
                }
            }
        }
    }
}

${CHECK_PATH}

void main(void)
{
${p.main}
    while (1) {}
}
`;

const ASTAR_OK = {
  heuristic: `    return abs(rowCurr - rowGoal) + abs(colCurr - colGoal);`,
  walk: `        cur = parent[cur];`,
  f: `                f = g[i] + heuristic(i / COLS, i % COLS, rowEnd, colEnd);`,
  noPath: `            return 0;                           // open set empty: no path`,
  newG: `                newG = g[cur] + 1;`,
  setParent: `                    parent[next] = cur;`,
};

const ASTAR_MAIN = `    hTest = heuristic(1, 5, 4, 1);
    retOpen = astar(4, 0, 0, 6);
    stepsOpen = check_path(4, 0, 0, 6);

    // A straight corridor: the heuristic should keep the search in it
    astar(4, 0, 4, 5);
    expandedLine = expanded;

    // HW6: add an obstacle so that no path is left, and check that A* says so
    map[2 * COLS + 3] = 'x';
    retBlocked = astar(4, 0, 0, 6);`;

const ASTAR_RESULT_GLOBALS = `
int hTest = -1;         // heuristic(1, 5, 4, 1)
int retOpen = -1;       // return value on the open map
int stepsOpen = -1;     // steps of the path that was written
int expandedLine = -1;  // cells expanded on the straight run from (4, 0) to (4, 5)
int retBlocked = -1;    // return value once the gap is closed`;

const TRAP_MAIN = `    retValue = astar(5, 0, 0, 6);
    steps = check_path(5, 0, 0, 6);`;
const TRAP_GLOBALS = `
int retValue = -1;
int steps = -1;         // steps of the path A* returned`;

// ---- A* with diagonal moves
const astar8Program = (fns: string) => `${GRID_DEFS(OPEN_FLOOR)}

#define COST_STRAIGHT 10
#define COST_DIAGONAL 14

${ASTAR_GLOBALS}

int retOpen = -1;       // astar8 on the open map
int costOpen = -1;      // cost of the path it wrote
int expandedOpen = -1;
int retBlocked = -1;    // astar8 after the map is closed off

${CAN_TRAVEL}

${fns}

// Cost of the path in pathRow/pathCol (goal back to start), or -1 if it is
// not a legal path. Do not change.
int check_path8(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int i, dr, dc;
    int cost = 0;

    if (pathLen < 1) return -1;
    if (pathRow[0] != rowEnd || pathCol[0] != colEnd) return -1;
    if (pathRow[pathLen - 1] != rowStart || pathCol[pathLen - 1] != colStart) return -1;
    for (i = 0; i < pathLen; i++) {
        if (canTravel(pathRow[i], pathCol[i]) == 0) return -1;
        if (i > 0) {
            dr = abs(pathRow[i] - pathRow[i - 1]);
            dc = abs(pathCol[i] - pathCol[i - 1]);
            if (dr > 1 || dc > 1 || (dr == 0 && dc == 0)) return -1;
            if (dr == 1 && dc == 1) {
                // no cutting corners
                if (canTravel(pathRow[i], pathCol[i - 1]) == 0) return -1;
                if (canTravel(pathRow[i - 1], pathCol[i]) == 0) return -1;
                cost += COST_DIAGONAL;
            } else {
                cost += COST_STRAIGHT;
            }
        }
    }
    return cost;
}

void main(void)
{
    retOpen = astar8(5, 0, 0, 6);
    costOpen = check_path8(5, 0, 0, 6);
    expandedOpen = expanded;

    // wall the goal in
    map[0 * COLS + 5] = 'x';
    map[1 * COLS + 5] = 'x';
    map[1 * COLS + 6] = 'x';
    retBlocked = astar8(5, 0, 0, 6);
    while (1) {}
}
`;

// ---- occupancy grid
const occProgram = (body: string) => `#define NCELLS 8
#define L_OCC 0.85f       // log-odds of "occupied" for one hit   (p = 0.70)
#define L_FREE -0.41f     // log-odds of "occupied" for one miss  (p = 0.40)
#define L_0 0.0f          // prior: p = 0.5, nothing known

// One row of the map, straight ahead of the LIDAR. Cell 0 is nearest.
float logodds[NCELLS] = {0, 0, 0, 0, 0, 0, 0, 0};

// Five scans. Each gives the index of the cell where the beam hit something.
int scan_hit[5] = {5, 5, 5, 3, 5};

float pWall = 0;          // probability that cell 5 is occupied
float pNear = 0;          // cell 2
float pOnce = 0;          // cell 3
float pBehind = 0;        // cell 7

// Probability from log-odds
float prob(float l)
{
${body.split("//SPLIT")[0].trimEnd()}
}

// One beam: every cell before 'hit' was seen free, cell 'hit' was seen occupied,
// cells behind it were not seen at all
void update_row(int hit)
{
${body.split("//SPLIT")[1].replace(/^\n/, "").trimEnd()}
}

void main(void)
{
    int k;

    for (k = 0; k < 5; k++) {
        update_row(scan_hit[k]);
    }
    pWall = prob(logodds[5]);
    pNear = prob(logodds[2]);
    pOnce = prob(logodds[3]);
    pBehind = prob(logodds[7]);
    while (1) {}
}
`;

// ---- checkpoint scene
const SCENE: Record<string, [number, number]> = {
  ".": [0, 5], // floor
  B: [225, 80], // blue obstacle
  b: [205, 70], // blue obstacle, another shade
  O: [28, 90], // orange target
  Y: [55, 85], // yellow tape
  R: [350, 80], // red cone
  W: [30, 20], // pale wood
  P: [220, 20], // pale blue reflection on the floor
};
const SCENE_PIC = [". . . B . . O .", ". W . B . b b .", ". . . B . . . .", ". b . . . B Y .", ". b P . . B . .", ". . . R . . . ."];

const sceneProgram = (o: { fns: string; main: string }) => `#define ROWS 6
#define COLS 8
#define NCELLS (ROWS * COLS)

#define START_ROW 5       // the robot's cell
#define START_COL 0

// What the camera sees, already reduced to one colour per floor cell:
// hue in degrees and saturation in percent
${cArray("uint16_t", "scene_h", "NCELLS", cells(SCENE_PIC).map((c) => SCENE[c][0]), 8)}

${cArray("uint16_t", "scene_s", "NCELLS", cells(SCENE_PIC).map((c) => SCENE[c][1]), 8)}

char map[NCELLS];         // you fill this in: 'x' = obstacle, '0' = free
int queue[NCELLS];
int dist[NCELLS];

int targetRow = -1;       // cell of the orange target
int targetCol = -1;
int numObstacles = 0;     // number of 'x' cells in the map
int steps = -1;           // length of the shortest path to the target, -1 if none

${o.fns}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

${o.main}
    while (1) {}
}
`;

const range = (v: number, tol = 0.01) => ({ min: v - tol, max: v + tol });

export const ch19: Chapter = {
  id: "vision-planning",
  number: 19,
  title: "Seeing and planning",
  blurb: "Colour, blobs and centroids, then BFS, A* and occupancy grids.",
  requires: ["bits"],
  course: ["L17", "L18", "L24-25", "HW5", "HW6"],
  levels: [
    {
      id: "vis-brief",
      kind: "brief",
      title: "From pixels to a turn command",
      goal: "Learn how a camera image becomes a number the robot can steer with.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
The robot's camera has to answer one question many times per second: **where is the golf ball?** The answer is found in four stages.

**Sensor**, then **filtering**, then **features**, then **control**.

## Sensor: the Bayer filter
A camera pixel measures brightness only. To see colour, each pixel sits behind a tiny red, green or blue filter. The usual layout is the **Bayer** pattern: in every 2 x 2 block there are **two green**, one red and one blue pixel, because the eye is most sensitive to green. The two missing colours of each pixel are estimated by averaging its neighbours. This is called **demosaicing**. After it, every pixel has three numbers (R, G, B), usually from 0 to 255.

RGB is **additive**: red plus green light gives yellow, all three give white.

## Filtering: which pixels have the ball's colour?
A first idea is a threshold on RGB, such as "R above 200". It fails as soon as a shadow falls on the ball: all three numbers drop, and R is no longer above 200.

**HSL** describes the same colour with three numbers that mean something:

- **Hue** H: the colour itself, as an angle. 0 degrees is red, 120 green, 240 blue, and 360 is red again.
- **Saturation** S: how strong the colour is. 0 is grey, 1 is pure colour.
- **Lightness** L: how bright. 0 is black, 1 is white.

A shadow changes L and leaves H almost unchanged. So you threshold on H (and ask for enough S, because grey has no meaningful hue). The result is a **mask**: an image of 1s and 0s, 1 where the pixel has the target colour.

With R, G, B scaled to 0..1, max and min the largest and smallest of the three, and d = max - min:

- L = (max + min) / 2
- S = d / (1 - |2L - 1|), and S = 0 when d = 0
- H = 60 x (G - B) / d when R is the largest (add 360 if the result is negative)
- H = 60 x ((B - R) / d + 2) when G is the largest
- H = 60 x ((R - G) / d + 4) when B is the largest

Try it in the figure: press Shadow and watch R, G and B all change while the hue stays where it was.

{{figure:hsl-picker}}

The lecture slides show HSV, a close relative that uses V = max where HSL uses L. The OpenMV camera code in the lab thresholds in LAB, another space that separates lightness from colour. The idea is the same in all three.

## Features: blobs and moments
A **blob** is a group of mask pixels that touch each other. Small blobs are noise and are thrown away by an **area filter**. For the blob that remains, three sums called **moments** describe it:

- M00 = number of pixels (the **area**)
- M10 = sum of the column numbers of its pixels
- M01 = sum of the row numbers of its pixels

The **centroid**, the blob's centre, is at column M10 / M00 and row M01 / M00.

Try it in the figure: paint pixels and watch the moments, the centroid and the turn command follow. Then switch the area filter off.

{{figure:blob-centroid}}

## Control
If the centroid is to the right of the image centre, the ball is to the right, so turn right. For a 640-pixel-wide image the centre is column 320, and a simple controller is

\`\`\`c
turn = Kp * (320 - cx);
\`\`\`
`,
      questions: [
        {
          prompt: "In a Bayer sensor, how do the numbers of red, green and blue pixels compare?",
          options: ["Equal numbers of each", "Twice as many green as red, and as many blue as red", "Twice as many red as green", "Only green pixels, colour is computed"],
          answer: 1,
          why: "Each 2 x 2 block holds two green, one red and one blue pixel.",
        },
        {
          prompt: "A shadow falls on half of the orange ball. Which test still finds the whole ball?",
          options: ["R > 200", "R + G + B > 300", "Hue between 15 and 45 degrees, with saturation above 0.5", "Lightness above 0.4"],
          answer: 2,
          why: "The shadow lowers R, G, B and the lightness. The hue, the ratio between the channels, stays the same.",
        },
        {
          prompt: "A blob has M00 = 20, M10 = 900 and M01 = 300. Where is its centroid?",
          options: ["Column 45, row 15", "Column 15, row 45", "Column 900, row 300", "Column 20, row 20"],
          answer: 0,
          why: "Column = M10 / M00 = 900 / 20 = 45. Row = M01 / M00 = 300 / 20 = 15.",
        },
      ],
      takeaway: "Threshold on hue to get a mask, keep the big blob, take its centroid from the moments, and steer on the centroid's offset from the image centre.",
    },
    {
      id: "vis-hsl-calc",
      kind: "calc",
      title: "The same ball, lit and in shadow",
      goal: "Convert three pixels from RGB to HSL by hand and see what a shadow changes.",
      refs: [{ course: "L17" }],
      brief: `
Three pixels, with R, G, B already scaled to the range 0 to 1:

- **Pixel 1**, the orange ball in the light: R = 0.8, G = 0.4, B = 0.0
- **Pixel 2**, the same ball in a shadow, every channel halved: R = 0.4, G = 0.2, B = 0.0
- **Pixel 3**, the blue ball: R = 0.2, G = 0.4, B = 0.8

## The formulas
Let max and min be the largest and smallest of R, G, B and d = max - min.

- L = (max + min) / 2
- S = d / (1 - |2L - 1|)
- H depends on which channel is the largest:
  - R largest: H = 60 x (G - B) / d
  - G largest: H = 60 x ((B - R) / d + 2)
  - B largest: H = 60 x ((R - G) / d + 4)

H is in degrees. If it comes out negative, add 360.

Work out the fields, then compare pixel 1 and pixel 2.

The figure computes the same formulas for any pixel (its sliders run from 0 to 255, so 0.8 is 204). Use it to check your working, and to see which branch of the hue formula applies.

{{figure:hsl-picker}}
`,
      fields: [
        { id: "l1", label: "Pixel 1: lightness L", answer: 0.4, tolPct: 1, why: "max = 0.8, min = 0. L = (0.8 + 0) / 2 = 0.4." },
        { id: "s1", label: "Pixel 1: saturation S", answer: 1, tolPct: 1, why: "d = 0.8. S = 0.8 / (1 - |0.8 - 1|) = 0.8 / 0.8 = 1." },
        { id: "h1", label: "Pixel 1: hue H", unit: "degrees", answer: 30, tolPct: 1, why: "R is the largest: H = 60 x (0.4 - 0) / 0.8 = 30. Orange, between red (0) and yellow (60)." },
        { id: "l2", label: "Pixel 2: lightness L", answer: 0.2, tolPct: 1, why: "max = 0.4, min = 0. L = 0.2: half as light as pixel 1." },
        { id: "h2", label: "Pixel 2: hue H", unit: "degrees", answer: 30, tolPct: 1, why: "H = 60 x (0.2 - 0) / 0.4 = 30. Halving every channel halves G - B and d alike, so the hue does not move." },
        { id: "s3", label: "Pixel 3: saturation S", answer: 0.6, tolPct: 1, why: "max = 0.8, min = 0.2, d = 0.6, L = 0.5. S = 0.6 / (1 - 0) = 0.6." },
        { id: "h3", label: "Pixel 3: hue H", unit: "degrees", answer: 220, tolPct: 1, why: "B is the largest: H = 60 x ((0.2 - 0.4) / 0.6 + 4) = 60 x 3.667 = 220. A little before pure blue at 240." },
      ],
      hints: [
        "Start every pixel with max, min and d.",
        "For pixel 2, |2L - 1| = |0.4 - 1| = 0.6.",
        "Pixel 3: (R - G) / d = -0.2 / 0.6 = -0.333, plus 4 is 3.667, times 60.",
      ],
      takeaway: "The shadow halved R and L, and left H at 30 degrees. That is why you threshold on hue.",
    },
    {
      id: "vis-rgb2hsl",
      kind: "code",
      mode: "complete",
      title: "rgb_to_hsl",
      goal: "Finish the function that converts one pixel from RGB to hue, saturation and lightness.",
      refs: [{ course: "L17" }],
      brief: `
\`rgb_to_hsl\` takes one pixel as three floats from 0 to 255 and returns three results. A C function returns only one value, so the results go back through **pointers**: the caller passes the addresses \`&h, &s, &l\`, and the function writes with \`*h = ...\`.

The first part is done: scale to 0..1, find the largest (\`hi\`) and smallest (\`lo\`) channel, \`d = hi - lo\`, and the lightness.

## Your part
1. **Grey.** If \`d\` is 0, all three channels are equal. There is no colour: set \`*h\` and \`*s\` to 0 and return. Without this test the next lines divide by zero.
2. **Saturation.** \`d / (1 - |2L - 1|)\`. The absolute value of a float is \`fabs()\`.
3. **Hue**, depending on which channel is the largest:
   - \`hi == r\`: \`60 * ((g - b) / d)\`
   - \`hi == g\`: \`60 * ((b - r) / d + 2)\`
   - otherwise: \`60 * ((r - g) / d + 4)\`
4. If the hue is negative, add 360.

Write float constants with an \`f\`, as in \`60.0f\`.

\`main\` converts six test pixels. Compare the lit and the shadowed orange ball (A and B) in the watch list when it works.
`,
      kit: "robot",
      durationMs: 5,
      starter: hslProgram(`    // TODO 1: grey (d == 0): hue 0, saturation 0, return

    // TODO 2: saturation
    *s = 0.0f;

    // TODO 3: hue from the largest channel
    *h = 0.0f;

    // TODO 4: a negative hue gets 360 added
`),
      solution: hslProgram(`    if (d == 0.0f) {
        *h = 0.0f;      // grey: no colour, so no hue
        *s = 0.0f;
        return;
    }
    *s = d / (1.0f - fabs(2.0f * (*l) - 1.0f));
    if (hi == r) {
        *h = 60.0f * ((g - b) / d);
    } else if (hi == g) {
        *h = 60.0f * ((b - r) / d + 2.0f);
    } else {
        *h = 60.0f * ((r - g) / d + 4.0f);
    }
    if (*h < 0.0f) {
        *h = *h + 360.0f;
    }`),
      checks: [
        { kind: "var", name: "hA", ...range(30.12, 0.1), label: "Orange in the light (255, 128, 0): hue about 30 degrees" },
        { kind: "var", name: "sA", ...range(1), label: "Orange in the light: saturation 1" },
        { kind: "var", name: "hB", ...range(30, 0.1), label: "Orange in the shadow (102, 51, 0): hue still 30 degrees" },
        { kind: "var", name: "lB", ...range(0.2), label: "Orange in the shadow: lightness 0.2" },
        { kind: "var", name: "hC", ...range(218.82, 0.1), label: "Blue (0, 90, 255): hue about 219 degrees", hint: "Blue is the largest channel: 60 * ((r - g) / d + 4)." },
        { kind: "var", name: "hD", ...range(150, 0.1), label: "Green (40, 200, 120): hue 150 degrees", hint: "Green is the largest channel: 60 * ((b - r) / d + 2)." },
        { kind: "var", name: "sD", ...range(0.6667), label: "Green (40, 200, 120): saturation 0.667" },
        { kind: "var", name: "hE", ...range(354.29, 0.1), label: "Red (230, 20, 40): hue about 354 degrees", hint: "The formula gives about -5.7. Add 360 to a negative hue." },
        { kind: "var", name: "sF", ...range(0, 0.001), label: "Grey (128, 128, 128): saturation 0 and no division by zero" },
        { kind: "var", name: "hF", ...range(0, 0.001), label: "Grey: hue 0" },
      ],
      watch: ["hA", "sA", "lA", "hB", "sB", "lB", "hC", "hD", "hE"],
      hints: [
        "Do the grey test first, with a `return;` inside it.",
        "`*s = d / (1.0f - fabs(2.0f * (*l) - 1.0f));`",
        "`if (hi == r) { *h = 60.0f * ((g - b) / d); } else if (hi == g) { ... + 2.0f ... } else { ... + 4.0f ... }` and then `if (*h < 0.0f) *h = *h + 360.0f;`",
      ],
      takeaway: "The lit and the shadowed ball differ in lightness (0.5 and 0.2) and share hue 30. Red sits at both ends of the hue circle, which will matter later.",
    },
    {
      id: "vis-target",
      kind: "code",
      mode: "write",
      title: "Find the ball",
      goal: "Threshold a small camera image into a mask, compute area and centroid from the moments, and turn towards the ball.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
The image is 8 rows by 12 columns, stored as three arrays \`img_r\`, \`img_g\`, \`img_b\`. Pixel (row, col) is element \`row * COLS + col\`. It shows a grey floor, an orange golf ball that is half in shadow, a blue ball, yellow tape, a red cone and a pale wooden wall. \`rgb_to_hsl\` from the last level is included.

Write \`find_target()\`.

## 1. Mask
For every pixel, convert to HSL. The pixel belongs to the target when

- its hue is between \`H_MIN\` and \`H_MAX\` (15 to 45 degrees), **and**
- its saturation is at least \`S_MIN\` (0.5). The wooden wall has an orange hue too, but it is pale.

Store 1 or 0 in \`mask[]\`.

## 2. Moments
While you scan, add up for the pixels in the mask:

- M00: 1 per pixel
- M10: the pixel's **column**
- M01: the pixel's **row**

Use \`float\` sums.

## 3. Results
- \`area\` = M00
- \`cx\` = M10 / M00 and \`cy\` = M01 / M00. Only divide when M00 is above 0: an image without the ball must not divide by zero.
- \`turn = KP_TURN * (CENTRE_COL - cx);\` With this sign, a ball to the **right** of the centre gives a **negative** command, a turn to the right (clockwise).

You can pass an array element straight to \`rgb_to_hsl\`. It is converted to float.

The figure does steps 2 and 3 on a mask you paint yourself: M10 only looks at columns, M01 only at rows.

{{figure:blob-centroid}}
`,
      kit: "robot",
      durationMs: 20,
      starter: targetProgram(`    // 1. mask  2. moments  3. area, cx, cy, turn`),
      solution: targetProgram(`    int row, col, i;
    float h, s, l;
    float m00 = 0, m10 = 0, m01 = 0;

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            i = row * COLS + col;
            rgb_to_hsl(img_r[i], img_g[i], img_b[i], &h, &s, &l);
            if (h >= H_MIN && h <= H_MAX && s >= S_MIN) {
                mask[i] = 1;
                m00 += 1;
                m10 += col;
                m01 += row;
            } else {
                mask[i] = 0;
            }
        }
    }

    area = (uint16_t)m00;
    if (m00 > 0) {
        cx = m10 / m00;
        cy = m01 / m00;
        turn = KP_TURN * (CENTRE_COL - cx);
    } else {
        turn = 0;
    }`),
      checks: [
        { kind: "var", name: "area", equals: 14, label: "The mask holds the 14 pixels of the orange ball, lit and shadowed", hint: "7: a brightness test crept in. 18: the pale wall is included, check the saturation. More: check the hue limits." },
        { kind: "var", name: "cx", ...range(7.5), label: "Centroid column is 7.5", hint: "M10 sums the column numbers." },
        { kind: "var", name: "cy", ...range(3.2857), label: "Centroid row is about 3.29", hint: "M01 sums the row numbers. Use float sums so the division keeps its fraction." },
        { kind: "var", name: "turn", ...range(-0.75), label: "turn is -0.75: the ball is right of centre, so turn right" },
      ],
      watch: ["area", "cx", "cy", "turn"],
      hints: [
        "Two nested loops over row and col, with `i = row * COLS + col;`.",
        "`rgb_to_hsl(img_r[i], img_g[i], img_b[i], &h, &s, &l);` then `if (h >= H_MIN && h <= H_MAX && s >= S_MIN)`.",
        "Inside the if: `mask[i] = 1; m00 += 1; m10 += col; m01 += row;`. After the loops: `area = (uint16_t)m00;` and, if m00 > 0, the two divisions and the turn line.",
      ],
      takeaway: "Seven of the fourteen ball pixels are in shadow, and the hue test finds them all. One pass over the image gives mask, area and centroid together.",
    },
    {
      id: "vis-intdiv",
      kind: "code",
      mode: "debug",
      title: "The centroid that snaps to whole pixels",
      goal: "The robot steers in steps. Find out why the centroid loses its fraction.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
This version works on a finished mask and keeps the moments in integers, which is sensible: they are counts and sums of whole numbers.

The ball's centroid should be at column **7.5**, row **3.29**. The program reports column 7, row 3, and the turn command is -0.5 where it should be -0.75. On the robot this shows as steering that moves in jumps: the command only changes when the centroid crosses a whole pixel.

\`cx\` and \`cy\` are floats. So where does the fraction go?

In C, the type of a division is decided by its **operands**, not by the variable that receives the result. Look at the two divisions.
`,
      kit: "robot",
      durationMs: 5,
      starter: momentsProgram(BALL_MASK, {
        decl: "    uint16_t m00 = 0, m10 = 0, m01 = 0;",
        sums: `                m00 += 1;
                m10 += col;
                m01 += row;`,
        divide: `        cx = m10 / m00;
        cy = m01 / m00;`,
      }),
      solution: momentsProgram(BALL_MASK, {
        decl: "    uint16_t m00 = 0, m10 = 0, m01 = 0;",
        sums: `                m00 += 1;
                m10 += col;
                m01 += row;`,
        divide: `        cx = (float)m10 / (float)m00;
        cy = (float)m01 / (float)m00;`,
      }),
      checks: [
        { kind: "var", name: "cx", ...range(7.5), label: "Centroid column is 7.5", hint: "7 means the division was done in integers: 105 / 14 = 7 remainder 7." },
        { kind: "var", name: "cy", ...range(3.2857), label: "Centroid row is about 3.29" },
        { kind: "var", name: "turn", ...range(-0.75), label: "turn is -0.75" },
        { kind: "var", name: "area", equals: 14, label: "The area is still 14" },
      ],
      watch: ["area", "cx", "cy", "turn"],
      hints: [
        "`m10` and `m00` are both `uint16_t`. What does 105 / 14 give in integer arithmetic?",
        "The division is finished, and truncated, before the result is converted to float for `cx`.",
        "Convert an operand first: `cx = (float)m10 / (float)m00;` and the same for `cy`. Declaring the sums as float also works.",
      ],
      takeaway: "int / int is an int, whatever it is assigned to. Cast before dividing. On this chip also remember that a 16-bit sum of column numbers overflows on a full-size image: 640 x 480 needs 32-bit or float sums.",
    },
    {
      id: "plan-fgh",
      kind: "calc",
      title: "g, h and f",
      goal: "Compute heuristics and f = g + h for a few cells and decide which one A* expands next.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
Once the robot knows where the ball is, it needs a route around the obstacles. The course floor is a **grid map**: cells that are free or blocked. The robot moves between neighbouring cells. With **4-connectivity** it moves up, down, left or right, and each step costs 1.

## Three searches
All three keep a **frontier** (cells found but not yet expanded) and a **came_from** table (for each cell, the cell it was reached from), and all stop early when the goal comes off the frontier.

- **Breadth-first search (BFS)**: the frontier is a queue, first in, first out. It spreads in rings around the start and finds the path with the fewest steps.
- **Dijkstra**: the frontier is a priority queue ordered by **g**, the cost so far (cost_so_far). It handles steps of different cost. With equal costs it behaves like BFS.
- **A***: ordered by **f = g + h**, where **h** is a **heuristic**: a quick estimate of the cost still to go. A* expands the cells that look best overall, so it reaches the goal after far fewer expansions.

**Greedy best-first** search orders by h alone. It is fast and heads straight for the goal, but the path it finds is not always the shortest.

Try it in the figure: step BFS, Greedy and A* on the same map and watch which frontier cell each one takes next. The map "greedy trap" shows greedy search finding a longer path.

{{figure:search-explorer}}

## The heuristic
For a cell and a goal that are dr rows and dc columns apart:

- **Manhattan** distance: dr + dc
- **Euclidean** distance: the square root of (dr x dr + dc x dc)

A* returns a shortest path if h **never overestimates** the true remaining cost. Such a heuristic is called **admissible**. On a 4-connected grid both distances are admissible: no path can be shorter than the Manhattan distance, and the Euclidean distance is smaller still. Manhattan is the better of the two here because it is closer to the truth, so A* expands fewer cells.

## The exercise
The goal is the cell at **row 2, column 6**. Three cells are on the frontier:

- **A** at row 2, column 3, reached with g = 5
- **B** at row 0, column 5, reached with g = 4
- **C** at row 4, column 4, reached with g = 4

Use the Manhattan distance for f.
`,
      fields: [
        { id: "hman", label: "A cell is 3 rows and 4 columns from the goal. Manhattan distance", answer: 7, why: "3 + 4 = 7." },
        { id: "heuc", label: "The same cell: Euclidean distance", answer: 5, tolPct: 1, why: "The square root of 9 + 16 = 25 is 5. Never larger than the Manhattan distance." },
        { id: "fa", label: "f of cell A", answer: 8, why: "h = 0 rows + 3 columns = 3. f = 5 + 3 = 8." },
        { id: "fb", label: "f of cell B", answer: 7, why: "h = 2 rows + 1 column = 3. f = 4 + 3 = 7." },
        { id: "fc", label: "f of cell C", answer: 8, why: "h = 2 rows + 2 columns = 4. f = 4 + 4 = 8." },
        { id: "next", label: "Which cell does A* expand next? (1 = A, 2 = B, 3 = C)", answer: 2, why: "B has the smallest f. Note that A is closest to the goal (greedy would pick A or B on h alone) and B and C tie on g (Dijkstra could pick either)." },
      ],
      hints: ["h for each cell: rows apart plus columns apart, to row 2, column 6.", "f = g + h. A* takes the smallest f."],
      takeaway: "g is what the path has cost, h is what it will probably still cost, and A* always continues the path with the smallest total.",
    },
    {
      id: "plan-bfs",
      kind: "code",
      mode: "write",
      title: "Breadth-first search",
      goal: "Write BFS with an array as the queue and return the length of the shortest path on a grid.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
The map is stored as in the course's A* code: a single array of characters, one row after the other. \`'x'\` is an obstacle and \`'0'\` is free. \`canTravel(row, col)\` tells you whether a cell is on the map and free.

\`\`\`
000x000
0x0x0x0
0x000x0
0xxxxx0
000000x
0x0x0x0
\`\`\`

Write \`bfs(rowStart, colStart, rowEnd, colEnd)\`. It returns the number of steps of the shortest path, or **-1** when the goal cannot be reached.

## The algorithm
A cell is identified by one number, \`row * COLS + col\`. From it, \`row = cell / COLS\` and \`col = cell % COLS\`.

1. Set \`dist[]\` to -1 everywhere: "not reached". \`dist\` is both the visited mark and the answer.
2. Put the start cell in the queue with \`dist = 0\`.
3. While the queue is not empty:
   - take the **oldest** cell out,
   - if it is the goal, return its \`dist\` (the early exit),
   - for each of its four neighbours that \`canTravel\` and that has \`dist == -1\`: set its \`dist\` to the current cell's \`dist + 1\` and add it to the queue.
4. The queue ran empty: return -1.

## The queue
An array and two indexes are enough, because each cell enters the queue at most once:

\`\`\`c
queue[tail] = cell;  tail++;     // add at the back
cell = queue[head];  head++;     // take from the front
\`\`\`

The queue is empty when \`head == tail\`.

The figure runs this loop on this map, with the same neighbour order: choose BFS, press Step and follow the queue. Move the start to the top left corner to match the tests.

{{figure:search-explorer}}

For the four neighbours, two small arrays save you from writing the same code four times:

\`\`\`c
int dRow[4] = {-1, 0, 0, 1};
int dCol[4] = {0, -1, 1, 0};
\`\`\`

\`main\` calls your function for four goals, always from the top left corner.
`,
      kit: "robot",
      durationMs: 30,
      starter: bfsProgram({
        globals: `
int lenNear = -2;       // to (0, 2)
int lenRound = -2;      // to (0, 4): around the wall
int lenFar = -2;        // to (4, 5)
int lenNone = -2;       // to (5, 6): walled in`,
        body: `    return 0;`,
        main: `    lenNear = bfs(0, 0, 0, 2);
    lenRound = bfs(0, 0, 0, 4);
    lenFar = bfs(0, 0, 4, 5);
    lenNone = bfs(0, 0, 5, 6);`,
      }),
      solution: bfsProgram({
        globals: `
int lenNear = -2;       // to (0, 2)
int lenRound = -2;      // to (0, 4): around the wall
int lenFar = -2;        // to (4, 5)
int lenNone = -2;       // to (5, 6): walled in`,
        body: BFS_SOLUTION_BODY,
        main: `    lenNear = bfs(0, 0, 0, 2);
    lenRound = bfs(0, 0, 0, 4);
    lenFar = bfs(0, 0, 4, 5);
    lenNone = bfs(0, 0, 5, 6);`,
      }),
      checks: [
        { kind: "var", name: "lenNear", equals: 2, label: "(0, 0) to (0, 2): 2 steps" },
        { kind: "var", name: "lenRound", equals: 8, label: "(0, 0) to (0, 4): 8 steps, around the wall", hint: "4 would be the Manhattan distance, straight through the obstacle: use canTravel." },
        { kind: "var", name: "lenFar", equals: 9, label: "(0, 0) to (4, 5): 9 steps" },
        { kind: "var", name: "lenNone", equals: -1, label: "(0, 0) to (5, 6): no path, returns -1", hint: "When the queue runs empty without meeting the goal, return -1." },
      ],
      watch: ["lenNear", "lenRound", "lenFar", "lenNone"],
      hints: [
        "Reset dist[] at the start of every call: the function is called four times.",
        "Loop `while (head < tail)`. Take `cur = queue[head]; head++;`, test for the goal, then loop k from 0 to 3 over the neighbours.",
        "Neighbour: `row = cur / COLS + dRow[k]; col = cur % COLS + dCol[k];` and if `canTravel(row, col)` and `dist[row * COLS + col] == -1`, set its dist and append it.",
      ],
      takeaway: "BFS reaches every cell first along a shortest path, so the first dist written is final. That is also why one visit per cell is enough.",
    },
    {
      id: "plan-astar",
      kind: "code",
      mode: "complete",
      title: "A*, the homework way",
      goal: "Fill in the six missing pieces of A*, including the answer when there is no path.",
      refs: [{ course: "HW6" }, { course: "L18" }],
      brief: `
Homework 6 hands you a nearly complete A* and asks you to fill in numbered items. This level does the same on a smaller scale. The map is the one from the last level. The robot's version runs on the Raspberry Pi and keeps the open set in a heap. Here the open set is found by scanning an array, which is slower and easier to read.

Each cell has

- \`g[]\`: the cost of the best path found so far from the start,
- \`parent[]\`: the cell that path came from (-1 for the start),
- \`state[]\`: 0 not seen yet, 1 in the **open set** (found, waiting), 2 **closed** (expanded, finished).

The loop: take the open cell with the smallest f. If it is the goal, rebuild the path and return 1. Otherwise close it and look at its neighbours. A neighbour that is new, or that is now reached more cheaply than before, gets the new \`g\` and the new \`parent\` and goes into the open set.

The figure runs this loop on this map from (4, 0) to (0, 6): choose A* and press Step. The map "walled in" is the last test, where the open set runs empty.

{{figure:search-explorer}}

## The six items
1. \`heuristic\`: the **Manhattan** distance, \`abs()\` of the row difference plus \`abs()\` of the column difference.
2. \`f = g + h\` for open cell \`i\`. Its row is \`i / COLS\`, its column \`i % COLS\`.
3. The open set is empty and the goal was never reached: there is **no path**. Return 0. Homework 6 asks you to check exactly this case.
4. \`newG\`: the cost of reaching \`next\` through \`cur\`. Every step costs 1.
5. Remember where \`next\` was reached from.
6. In \`reconstructPath\`: step from a cell to its parent.

\`main\` runs A* from (4, 0) to (0, 6), then along the straight corridor from (4, 0) to (4, 5), and finally blocks the only gap in the wall and tries (0, 6) again.

The course's own \`heuristic()\` returns the straight-line (Euclidean) distance, although the comment above it describes the sum of the differences. Both never overestimate on this grid, so both give a shortest path.
`,
      kit: "robot",
      durationMs: 40,
      starter: astarProgram({
        rows: MAZE,
        globals: ASTAR_RESULT_GLOBALS,
        main: ASTAR_MAIN,
        heuristic: `    // 1. Return the Manhattan distance between the two cells
    return 0;`,
        walk: `        // 6. Step to the parent of cur (this line ends the walk at once)
        cur = -1;`,
        f: `                // 2. f = g + h for cell i
                f = 0;`,
        noPath: `            // 3. The open set is empty. Which value reports "no path"?
            return 1;`,
        newG: `                // 4. Cost of reaching 'next' through 'cur'
                newG = 0;`,
        setParent: `                    // 5. 'next' was reached from 'cur'
                    parent[next] = -1;`,
      }),
      solution: astarProgram({ rows: MAZE, globals: ASTAR_RESULT_GLOBALS, main: ASTAR_MAIN, ...ASTAR_OK }),
      checks: [
        { kind: "var", name: "hTest", equals: 7, label: "heuristic(1, 5, 4, 1) is 7 (3 rows + 4 columns)" },
        { kind: "var", name: "retOpen", equals: 1, label: "A* reports a path on the open map" },
        { kind: "var", name: "stepsOpen", equals: 14, label: "The path written to pathRow / pathCol is connected and 14 steps long", hint: "-1 means the stored path is not a chain of neighbouring free cells from goal to start: check items 5 and 6." },
        { kind: "var", name: "retBlocked", equals: 0, label: "With the gap closed, A* returns 0: no path" },
        { kind: "var", name: "expandedLine", min: 1, max: 8, label: "On the straight run along row 4, A* expands at most 8 cells", hint: "f must include the heuristic (item 2). Without it the search also spreads up the left column." },
      ],
      watch: ["hTest", "retOpen", "stepsOpen", "expandedLine", "retBlocked", "pathLen"],
      hints: [
        "Items 1, 2 and 4 are one expression each: `abs(rowCurr - rowGoal) + abs(colCurr - colGoal)`, `g[i] + heuristic(i / COLS, i % COLS, rowEnd, colEnd)`, `g[cur] + 1`.",
        "Item 5 is `parent[next] = cur;` and item 6 is `cur = parent[cur];`.",
        "Item 3: `return 0;`",
      ],
      takeaway: "An empty open set is the algorithm's way of saying the goal is unreachable. The caller must check the return value before it uses the path.",
    },
    {
      id: "vis-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "See it, then plan the way",
      goal: "Find the orange target in a colour grid, turn the blue cells into obstacles, and plan the shortest path to the target.",
      refs: [{ course: "L17" }, { course: "L18" }, { course: "HW5" }, { course: "HW6" }],
      brief: `
The camera looks down at a floor of 6 by 8 cells. For every cell you get a hue in degrees (\`scene_h\`) and a saturation in percent (\`scene_s\`). The robot stands in cell (\`START_ROW\`, \`START_COL\`), the bottom left corner.

## 1. Read the scene
A colour only counts when it is strong: saturation of **50 or more**.

- **Orange**, hue 15 to 45: the target, one cell. Store its position in \`targetRow\` and \`targetCol\`.
- **Blue**, hue 200 to 260: an obstacle.

Everything else is free floor: grey, yellow tape, a red cone, pale wood and a pale blue reflection are in the picture to test your thresholds.

Fill \`map[]\` with \`'x'\` for obstacles and \`'0'\` for free cells, and count the obstacles in \`numObstacles\`.

## 2. Plan
Find the length of the shortest 4-connected path from the robot to the target and store it in \`steps\`. BFS from two levels ago does this. \`queue[]\` and \`dist[]\` are declared for you. Store -1 if there is no target or no path.

## 3. Report
If a path exists, switch **LED1** on. Its pin is already set up as an output and switched off. One line does it:

\`\`\`c
GpioDataRegs.GPASET.bit.GPIO22 = 1;
\`\`\`

Write your functions above \`main\` and call them where the comment is.
`,
      kit: "robot",
      durationMs: 40,
      starter: sceneProgram({
        fns: `// Your functions go here`,
        main: `    // 1. read the scene  2. plan  3. report
`,
      }),
      solution: sceneProgram({
        fns: `int canTravel(int row, int col)
{
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        return 0;
    }
    if (map[row * COLS + col] == 'x') {
        return 0;
    }
    return 1;
}

void read_scene(void)
{
    int i;

    numObstacles = 0;
    for (i = 0; i < NCELLS; i++) {
        map[i] = '0';
        if (scene_s[i] >= 50) {
            if (scene_h[i] >= 200 && scene_h[i] <= 260) {
                map[i] = 'x';
                numObstacles++;
            } else if (scene_h[i] >= 15 && scene_h[i] <= 45) {
                targetRow = i / COLS;
                targetCol = i % COLS;
            }
        }
    }
}

int bfs(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int dRow[4] = {-1, 0, 0, 1};
    int dCol[4] = {0, -1, 1, 0};
    int head = 0;
    int tail = 0;
    int goal = rowEnd * COLS + colEnd;
    int i, k, cur, row, col, next;

    for (i = 0; i < NCELLS; i++) {
        dist[i] = -1;
    }
    cur = rowStart * COLS + colStart;
    dist[cur] = 0;
    queue[tail] = cur;
    tail++;

    while (head < tail) {
        cur = queue[head];
        head++;
        if (cur == goal) {
            return dist[cur];
        }
        for (k = 0; k < 4; k++) {
            row = cur / COLS + dRow[k];
            col = cur % COLS + dCol[k];
            if (canTravel(row, col)) {
                next = row * COLS + col;
                if (dist[next] == -1) {
                    dist[next] = dist[cur] + 1;
                    queue[tail] = next;
                    tail++;
                }
            }
        }
    }
    return -1;
}`,
        main: `    read_scene();
    if (targetRow >= 0) {
        steps = bfs(START_ROW, START_COL, targetRow, targetCol);
    }
    if (steps >= 0) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }`,
      }),
      checks: [
        { kind: "var", name: "targetRow", equals: 0, label: "The target is in row 0" },
        { kind: "var", name: "targetCol", equals: 6, label: "The target is in column 6", hint: "The pale wood at (1, 1) has an orange hue and a saturation of only 20." },
        { kind: "var", name: "numObstacles", equals: 9, label: "The map has 9 obstacle cells", hint: "10: the pale blue reflection is not an obstacle. Fewer: both shades of blue (hue 205 and 225) count." },
        { kind: "var", name: "steps", equals: 11, label: "The shortest path to the target has 11 steps" },
        { kind: "led", led: "LED1", at: 39, on: true, label: "LED1 is on: a path was found" },
      ],
      watch: ["targetRow", "targetCol", "numObstacles", "steps"],
      hints: [
        "One loop over the 48 cells does step 1: test the saturation first, then the two hue ranges.",
        "Copy canTravel and bfs from the BFS level. They work unchanged once map[] is filled, because ROWS, COLS and NCELLS are defined here too.",
        "In main: read the scene, `steps = bfs(START_ROW, START_COL, targetRow, targetCol);`, then `if (steps >= 0)` set GPIO22.",
      ],
      takeaway: "Perception turns pixels into a map and a goal. Planning turns the map and the goal into a path. The robot's software has the same two halves.",
    },
    {
      id: "vis-bayer",
      kind: "calc",
      tier: "practice",
      title: "Counting Bayer pixels",
      goal: "Count the colour sites of a Bayer sensor and demosaic one pixel by averaging its neighbours.",
      refs: [{ course: "L17" }],
      brief: `
A 640 x 480 sensor has 307200 photosites. Each one sits behind one colour filter in the Bayer pattern, which repeats this 2 x 2 block:

\`\`\`
G R
B G
\`\`\`

So a **red** site has green neighbours above, below, left and right, and blue neighbours on its four diagonals.

**Demosaicing** fills in the two colours a site did not measure. The simplest method is the average of the nearest sites of that colour.

Around one red site the sensor measured:

- green, the four direct neighbours: 118, 122, 130, 110
- blue, the four diagonal neighbours: 60, 64, 52, 56
`,
      fields: [
        { id: "green", label: "Number of green sites on the 640 x 480 sensor", answer: 153600, why: "Two of every four sites: 307200 / 2." },
        { id: "red", label: "Number of red sites", answer: 76800, why: "One of every four sites: 307200 / 4. Blue has the same number." },
        { id: "g", label: "Green value estimated at the red site", answer: 120, why: "(118 + 122 + 130 + 110) / 4 = 120." },
        { id: "b", label: "Blue value estimated at the red site", answer: 58, why: "(60 + 64 + 52 + 56) / 4 = 58." },
      ],
      hints: ["Count the letters in the 2 x 2 block.", "An average of four values: add them and divide by 4."],
      takeaway: "Two thirds of every RGB image are estimates. Fine detail and sharp colour edges are where demosaicing shows.",
    },
    {
      id: "vis-hue-wrap",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Red is at both ends",
      goal: "The red cone is never found. Fix the hue test for a colour that wraps around 360 degrees.",
      refs: [{ course: "L17" }],
      brief: `
Hue is an angle, and red sits where the circle closes: a red object has pixels with hues such as 352, 357, 2 and 8 degrees. They are all within a few degrees of each other.

This program looks for the red cone with "hue from 340 through 0 to 20, saturation at least 50 percent". It finds **nothing**: \`area\` is 0.

Read the condition as the computer does. Can a number be at least 340 **and** at most 20?

Try it in the figure: pick Red cone and see where its hue lands on the circle, just before the seam where 360 becomes 0.

{{figure:hsl-picker}}

Fix the test. Keep the saturation requirement: the grey floor has hue 0 by convention, and only its low saturation keeps it out of the mask. The image also holds an orange ball (hue 30) and a magenta marker (hue 320), which must stay out.
`,
      kit: "robot",
      durationMs: 5,
      starter: redProgram("hue[i] >= H_MIN && hue[i] <= H_MAX && sat[i] >= S_MIN"),
      solution: redProgram("(hue[i] >= H_MIN || hue[i] <= H_MAX) && sat[i] >= S_MIN"),
      checks: [
        { kind: "var", name: "area", equals: 12, label: "The mask holds the 12 pixels of the red cone", hint: "0: no hue is both above 340 and below 20. More than 12: the floor got in, so the saturation test must apply to both halves of the range." },
        { kind: "var", name: "cx", ...range(3.5), label: "Centroid column is 3.5" },
        { kind: "var", name: "cy", ...range(2), label: "Centroid row is 2" },
      ],
      watch: ["area", "cx", "cy"],
      hints: [
        "A range that passes through 0 is two ranges: 340 to 360, and 0 to 20.",
        "Join the two hue tests with OR, and keep AND for the saturation.",
        "`(hue[i] >= H_MIN || hue[i] <= H_MAX) && sat[i] >= S_MIN`. The brackets matter: && binds tighter than ||.",
      ],
      takeaway: "When H_MIN is larger than H_MAX the range wraps, and the test becomes OR. Averaging hues near red needs the same care: the mean of 350 and 10 is 0, not 180.",
    },
    {
      id: "vis-rowcol",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The robot turns away",
      goal: "The ball is on the right and the robot turns left. Find the mix-up between rows and columns.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
The ball is in the top right corner of the image: columns 8 to 11, rows 1 and 2. Its centroid should be at column **9.5**, row **1.5**, and the turn command should be negative (turn right).

The program reports the centroid at column 1.5, row 9.5, in an image that has only 8 rows. The robot turns left, away from the ball.

An image has two axes and it is easy to cross them:

- **x** runs along a row, so x is the **column** number. M10 sums x.
- **y** runs down the image, so y is the **row** number. M01 sums y.

Find where they are swapped.
`,
      kit: "robot",
      durationMs: 5,
      starter: momentsProgram(CORNER_MASK, {
        decl: "    float m00 = 0, m10 = 0, m01 = 0;",
        sums: `                m00 += 1;
                m10 += row;
                m01 += col;`,
        divide: `        cx = m10 / m00;
        cy = m01 / m00;`,
      }),
      solution: momentsProgram(CORNER_MASK, {
        decl: "    float m00 = 0, m10 = 0, m01 = 0;",
        sums: `                m00 += 1;
                m10 += col;
                m01 += row;`,
        divide: `        cx = m10 / m00;
        cy = m01 / m00;`,
      }),
      checks: [
        { kind: "var", name: "cx", ...range(9.5), label: "Centroid column is 9.5" },
        { kind: "var", name: "cy", ...range(1.5), label: "Centroid row is 1.5" },
        { kind: "var", name: "turn", ...range(-1.75), label: "turn is -1.75: turn right, towards the ball" },
      ],
      watch: ["cx", "cy", "turn"],
      hints: [
        "A centroid row of 9.5 in an 8-row image cannot be right. Which sum produced it?",
        "M10 belongs to x, the column. M01 belongs to y, the row.",
        "Swap them: `m10 += col;` and `m01 += row;`.",
      ],
      takeaway: "x is the column and y is the row. A result outside the image is the quickest sign that the two were crossed.",
    },
    {
      id: "vis-blobs",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Blobs and the area filter",
      goal: "Group the mask pixels into blobs with a flood fill, drop the small ones, and report the largest.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
A real mask is never clean. A few stray pixels pass the threshold, and their weight pulls the centroid of "all mask pixels" away from the ball. The cure is to treat the mask as separate **blobs** and ignore the small ones.

The figure starts with this level's mask. Switch the area filter off and see the specks drag the centroid away, then move MIN_AREA.

{{figure:blob-centroid}}

A blob is a **connected component**: a set of mask pixels joined through neighbours. Here neighbours are the four pixels above, below, left and right (4-connectivity). Two pixels that touch only at a corner are **not** connected.

## Flood fill with a stack
Scan the image. When you meet a mask pixel that has no label yet, it starts a new blob:

1. Give it the next label number and push it on the stack.
2. While the stack is not empty: pop a pixel, add it to this blob's moments, and push each of its four neighbours that is inside the image, in the mask and not yet labelled. **Label a pixel when you push it**, so that it is never pushed twice.
3. The stack is empty: the blob is complete. Decide what to do with it.

\`\`\`c
stack[sp] = pixel;  sp++;        // push
sp--;  pixel = stack[sp];        // pop
\`\`\`

A recursive flood fill does the same with the call stack. On a microcontroller with a small stack, your own array is the safer choice.

## Write find_blobs()
- \`numRaw\`: the number of blobs of any size.
- \`numBlobs\`: the number of blobs with **at least** \`MIN_AREA\` pixels.
- \`bestArea\`, \`bestCx\`, \`bestCy\`: area and centroid (column, row) of the largest blob.

The mask has two real objects and three specks of noise, one of which touches the big object at a corner.
`,
      kit: "robot",
      durationMs: 30,
      starter: blobProgram(`    // Scan, flood fill each new blob with the stack, keep the big ones`),
      solution: blobProgram(`    int dRow[4] = {-1, 0, 0, 1};
    int dCol[4] = {0, -1, 1, 0};
    int start, sp, cur, row, col, k, next;
    int lab = 0;
    float m00, m10, m01;

    numRaw = 0;
    numBlobs = 0;
    bestArea = 0;
    for (start = 0; start < NPIX; start++) {
        label[start] = 0;
    }

    for (start = 0; start < NPIX; start++) {
        if (mask[start] == 1 && label[start] == 0) {
            lab++;
            numRaw++;
            m00 = 0;
            m10 = 0;
            m01 = 0;
            sp = 0;
            label[start] = lab;
            stack[sp] = start;
            sp++;

            while (sp > 0) {
                sp--;
                cur = stack[sp];
                m00 += 1;
                m10 += cur % COLS;
                m01 += cur / COLS;
                for (k = 0; k < 4; k++) {
                    row = cur / COLS + dRow[k];
                    col = cur % COLS + dCol[k];
                    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
                        next = row * COLS + col;
                        if (mask[next] == 1 && label[next] == 0) {
                            label[next] = lab;
                            stack[sp] = next;
                            sp++;
                        }
                    }
                }
            }

            if (m00 >= MIN_AREA) {
                numBlobs++;
                if (m00 > bestArea) {
                    bestArea = (uint16_t)m00;
                    bestCx = m10 / m00;
                    bestCy = m01 / m00;
                }
            }
        }
    }`),
      checks: [
        { kind: "var", name: "numRaw", equals: 5, label: "5 blobs in total: two objects and three specks", hint: "4: a pixel that touches only at a corner is a blob of its own. Many more: label pixels when you push them." },
        { kind: "var", name: "numBlobs", equals: 2, label: "2 blobs pass the area filter" },
        { kind: "var", name: "bestArea", equals: 10, label: "The largest blob has 10 pixels", hint: "11: the pixel at (4, 5) touches the blob only at a corner. With 4-connectivity it is not part of it." },
        { kind: "var", name: "bestCx", ...range(2.2), label: "Its centroid column is 2.2" },
        { kind: "var", name: "bestCy", ...range(2.1), label: "Its centroid row is 2.1" },
      ],
      watch: ["numRaw", "numBlobs", "bestArea", "bestCx", "bestCy"],
      hints: [
        "Outer loop over all pixels. A new blob starts at a pixel with `mask == 1` and `label == 0`.",
        "Inside: reset the three moments and sp, label and push the start pixel, then `while (sp > 0)` pop, add to the moments and push unlabelled mask neighbours (label them as you push).",
        "After the while loop: `if (m00 >= MIN_AREA) { numBlobs++; if (m00 > bestArea) { ...store area and centroid... } }`.",
      ],
      takeaway: "Label, then measure, then filter. The area filter costs one comparison and removes most false detections.",
    },
    {
      id: "plan-compare",
      kind: "quiz",
      tier: "practice",
      title: "Which search?",
      goal: "Compare breadth-first search, Dijkstra, greedy best-first and A*.",
      refs: [{ course: "L18" }],
      brief: `
Four searches, one skeleton. They differ only in **which frontier cell is expanded next**.

- **BFS**: the oldest one (a queue). Shortest path when every step costs the same.
- **Dijkstra**: the one with the smallest cost so far, g (a priority queue). Shortest path for any non-negative step costs. It explores in all directions.
- **Greedy best-first**: the one with the smallest estimate to the goal, h. Fast, and easily led into a dead end. The path is not guaranteed to be the shortest.
- **A***: the one with the smallest f = g + h. Shortest path whenever h is **admissible** (never more than the true remaining cost), usually with far fewer expansions than Dijkstra.

Two limits explain how they relate. With h = 0 everywhere, A* **is** Dijkstra. With a heuristic that is much too large, g hardly matters and A* behaves like greedy search.

In the figure, pick the map "greedy trap" and compare the table: every step costs 1 there, so BFS stands in for Dijkstra.

{{figure:search-explorer}}

The maps also differ in connectivity. On a **4-connected** grid a cell has up to four neighbours. On an **8-connected** grid the diagonals are neighbours too, and a diagonal step is longer: about 1.41 cells.
`,
      questions: [
        {
          prompt: "Every step costs 1. Which statement about BFS and Dijkstra is true?",
          options: [
            "Only Dijkstra finds a shortest path",
            "Both find a shortest path, and they expand cells in essentially the same order",
            "BFS is faster because it uses the heuristic",
            "Neither finds a shortest path",
          ],
          answer: 1,
          why: "With equal step costs, ordering by g is ordering by the number of steps, which is what a queue does.",
        },
        {
          prompt: "Driving over carpet costs 3 per cell and over tile 1. Which search still finds the cheapest path and uses the goal's position to save work?",
          options: ["BFS", "Greedy best-first", "A* with an admissible heuristic", "None of them"],
          answer: 2,
          why: "BFS counts steps, not cost. Greedy ignores the cost so far. A* orders by g + h and stays optimal with an admissible h.",
        },
        {
          prompt: "What makes a heuristic admissible?",
          options: [
            "It is always at least as large as the true remaining cost",
            "It is never larger than the true remaining cost",
            "It is exactly the Euclidean distance",
            "It is zero at the start",
          ],
          answer: 1,
          why: "Admissible means it never overestimates. Then A* cannot discard the best path because it looked too expensive.",
        },
        {
          prompt: "On an 8-connected grid, a diagonal step costs 1.41 and a straight step 1. Is the Manhattan distance still admissible?",
          options: [
            "Yes, always",
            "No: two cells one diagonal step apart have Manhattan distance 2 and a true cost of 1.41",
            "Only on square maps",
            "Only when there are no obstacles",
          ],
          answer: 1,
          why: "Manhattan now overestimates. The Euclidean distance, or the diagonal (octile) distance, stays admissible.",
        },
        {
          prompt: "You set h = 0 for every cell in A*. What do you get?",
          options: ["Greedy best-first search", "Dijkstra's algorithm", "A search that never ends", "A random path"],
          answer: 1,
          why: "f = g + 0 = g: cells are expanded by cost so far. Still optimal, just more expansions.",
        },
      ],
      hints: ["Ask of each search: what does it sort the frontier by?", "Admissible = never too large."],
      takeaway: "BFS sorts by age, Dijkstra by g, greedy by h, A* by g + h. A* is Dijkstra with a sense of direction.",
    },
    {
      id: "plan-order",
      kind: "order",
      tier: "practice",
      title: "One round of A*",
      goal: "Put the steps of the A* loop in order.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
A* keeps two sets. The **open set** holds cells that have been found and wait to be expanded. The **closed set** holds cells that are finished.

Each cell remembers g (cost from the start), f = g + h, and its parent.

Order the steps of the algorithm from the first action to the final answer. The loop body is: pick, test for the goal, close, look at the neighbours. The "no path" answer can only be given at the very end, when there is nothing left to pick.
`,
      steps: [
        "Put the start cell in the open set with g = 0",
        "Take the cell with the smallest f = g + h out of the open set",
        "If it is the goal: follow the parents back to the start and return the path",
        "Otherwise put it in the closed set",
        "For each free neighbour that is not closed, compute the cost g of reaching it through this cell",
        "If the neighbour is new, or this g is smaller than its old one: store g, f and this cell as its parent, and put it in the open set",
        "Go back and take the next cell, for as long as the open set is not empty",
        "The open set is empty and the goal was never taken out: report that there is no path",
      ],
      hints: [
        "The first step sets up the open set, the last reports failure.",
        "A cell is tested for being the goal when it is taken OUT of the open set, before it is closed.",
        "Start, take smallest f, goal test, close, neighbour cost, update neighbour, repeat, no path.",
      ],
      takeaway: "The goal test happens when a cell leaves the open set, not when it is first seen. Only then is its cost known to be the smallest.",
    },
    {
      id: "plan-overestimate",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The heuristic that was too sure",
      goal: "A* returns a path that is longer than necessary. Find out why and fix the heuristic.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
Someone changed the heuristic to the straight-line distance and, to save time, left out the square root. The search still finds a path from (5, 0) to (0, 6). It has **15** steps. The shortest path has **11**.

\`\`\`
00xx0x0
00000x0
000x0x0
000x000
0000000
0000x00
\`\`\`

A* is only guaranteed to be optimal when the heuristic **never overestimates** the remaining cost. Take a cell that is 3 rows and 4 columns from the goal. The true remaining cost is at least 7 steps. What does this heuristic say?

With an estimate that is far too large, f is dominated by h. The search rushes towards cells that are close to the goal as the crow flies, closes them along a poor route, and reaches the goal before the better route is ever tried.

Fix \`heuristic()\` so that it is admissible. The rest of the code is correct.
`,
      kit: "robot",
      durationMs: 40,
      starter: astarProgram({
        rows: TRAP,
        globals: TRAP_GLOBALS,
        main: TRAP_MAIN,
        ...ASTAR_OK,
        heuristic: `    int dRow = rowCurr - rowGoal;
    int dCol = colCurr - colGoal;

    return dRow * dRow + dCol * dCol;`,
      }),
      solution: astarProgram({ rows: TRAP, globals: TRAP_GLOBALS, main: TRAP_MAIN, ...ASTAR_OK }),
      checks: [
        { kind: "var", name: "retValue", equals: 1, label: "A* finds a path" },
        { kind: "var", name: "steps", equals: 11, label: "The path is a shortest one: 11 steps", hint: "15 steps: the heuristic still overestimates. 3 rows and 4 columns away it must not say more than 7." },
      ],
      watch: ["retValue", "steps", "expanded"],
      hints: [
        "3 rows and 4 columns away, the code returns 9 + 16 = 25. No path needs 25 steps.",
        "Any estimate that is never above the true cost works: the Manhattan distance, or the real Euclidean distance with sqrt().",
        "`return abs(rowCurr - rowGoal) + abs(colCurr - colGoal);`",
      ],
      takeaway: "An overestimating heuristic makes A* fast and wrong. It still returns a path, so nothing tells you the path is too long.",
    },
    {
      id: "plan-visited",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The search that goes in circles",
      goal: "This BFS fills its queue and gives up on a short path. Add what stops it from revisiting cells.",
      refs: [{ course: "L18" }],
      brief: `
This BFS should find the 9-step path from (0, 0) to (4, 5) on the map you know. It returns **-1**, "no path".

The queue has room for 200 entries, far more than the 42 cells of the map, and a guard stops the search from writing past its end. The counter \`pushes\` shows how many times a cell was added to the queue. Run it and look.

From a cell, one neighbour is always the cell you just came from. If nothing stops it, the search steps back, then forward again, and the number of queue entries multiplies with every ring.

BFS needs a **visited** mark: a cell enters the queue only the first time it is reached. Here \`dist[]\` can serve as that mark, because it starts at -1 everywhere.
`,
      kit: "robot",
      durationMs: 30,
      starter: bfsProgram({
        qmax: 200,
        globals: `
int pushes = 0;         // how many times a cell was put in the queue
int lenFar = -2;        // to (4, 5)`,
        main: `    lenFar = bfs(0, 0, 4, 5);`,
        body: `    int dRow[4] = {-1, 0, 0, 1};
    int dCol[4] = {0, -1, 1, 0};
    int head = 0;
    int tail = 0;
    int goal = rowEnd * COLS + colEnd;
    int i, k, cur, row, col, next;

    for (i = 0; i < NCELLS; i++) {
        dist[i] = -1;
    }
    cur = rowStart * COLS + colStart;
    dist[cur] = 0;
    queue[tail] = cur;
    tail++;

    while (head < tail) {
        cur = queue[head];
        head++;
        if (cur == goal) {
            return dist[cur];
        }
        for (k = 0; k < 4; k++) {
            row = cur / COLS + dRow[k];
            col = cur % COLS + dCol[k];
            if (canTravel(row, col)) {
                next = row * COLS + col;
                if (tail < 200) {
                    dist[next] = dist[cur] + 1;
                    queue[tail] = next;
                    tail++;
                    pushes++;
                }
            }
        }
    }
    return -1;`,
      }),
      solution: bfsProgram({
        qmax: 200,
        globals: `
int pushes = 0;         // how many times a cell was put in the queue
int lenFar = -2;        // to (4, 5)`,
        main: `    lenFar = bfs(0, 0, 4, 5);`,
        body: BFS_SOLUTION_BODY.replace("                    tail++;\n                }", "                    tail++;\n                    pushes++;\n                }").replace(
          "if (dist[next] == -1) {",
          "if (dist[next] == -1 && tail < 200) {",
        ),
      }),
      checks: [
        { kind: "var", name: "lenFar", equals: 9, label: "(0, 0) to (4, 5): 9 steps" },
        { kind: "var", name: "pushes", max: 41, label: "No cell enters the queue twice (at most 41 pushes)", hint: "Only push a neighbour whose dist is still -1." },
      ],
      watch: ["pushes", "lenFar"],
      hints: [
        "pushes reaches 199: the queue is full of repeats long before the search gets 9 steps away.",
        "A neighbour that already has a distance has been reached before, along a path at least as short.",
        "Wrap the push in `if (dist[next] == -1)`, or add that test to the existing `if`.",
      ],
      takeaway: "Without a visited mark a graph search re-expands the same cells without end. In BFS the first visit is also the shortest, so later visits are pure waste.",
    },
    {
      id: "map-logodds",
      kind: "calc",
      tier: "practice",
      title: "Log-odds",
      goal: "Convert between probability and log-odds and apply the occupancy update by hand.",
      refs: [{ course: "L24-25" }],
      brief: `
The maps so far were given. A robot that builds its own map keeps, for every cell, the **probability p** that the cell is occupied, and corrects it with every LIDAR beam. This is an **occupancy grid**.

Multiplying probabilities again and again is awkward, and they get stuck near 0 and 1. The map therefore stores the **log-odds**

l = ln( p / (1 - p) )

where ln is the natural logarithm. p = 0.5 gives l = 0, "no idea". Positive means probably occupied, negative probably free. The way back is

p = 1 - 1 / (1 + e^l)

In log-odds, taking in a new measurement is one addition:

l_new = l_old + l_sensor - l_0

- l_sensor is the log-odds of what the sensor just said about the cell,
- l_0 is the log-odds of the prior, the belief before any measurement. With a prior of 0.5, l_0 = 0.

Try it in the figure, which uses the sensor model of the exercise below: send hits and pass-throughs and watch the log-odds add up while the probability follows.

{{figure:log-odds}}

## The exercise
A cell starts at p = 0.5. The sensor model says: when the beam **ends** in a cell, the cell is occupied with p = 0.8. When the beam **passes through** a cell, the cell is occupied with p = 0.3.
`,
      fields: [
        { id: "locc", label: "l_sensor for a hit (p = 0.8)", answer: 1.386, tolPct: 1, why: "ln(0.8 / 0.2) = ln 4 = 1.386." },
        { id: "lfree", label: "l_sensor for a pass-through (p = 0.3)", answer: -0.847, tolPct: 1, why: "ln(0.3 / 0.7) = -0.847. Negative: evidence for free." },
        { id: "l2", label: "Log-odds of the cell after two hits", answer: 2.773, tolPct: 1, why: "0 + 1.386 + 1.386 = 2.773 (l_0 = 0)." },
        { id: "p2", label: "Probability after two hits", answer: 0.941, tolPct: 1, why: "p = 1 - 1 / (1 + e^2.773) = 1 - 1/17 = 0.941." },
        { id: "l3", label: "Log-odds after two hits and one pass-through", answer: 1.925, tolPct: 1, why: "2.773 - 0.847 = 1.925." },
        { id: "p3", label: "Probability after two hits and one pass-through", answer: 0.873, tolPct: 1, why: "p = 1 - 1 / (1 + e^1.925) = 0.873. One contrary reading lowers the belief and does not erase it." },
      ],
      hints: ["Odds are p / (1 - p): 0.8 gives 4, 0.3 gives 0.4286.", "Updates add. With l_0 = 0 the cell's log-odds is the sum of all l_sensor values.", "e^2.773 is 16."],
      takeaway: "In log-odds, evidence adds. A cell needs several agreeing beams to become certain and several contrary ones to change its mind.",
    },
    {
      id: "map-row",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "One beam across the map",
      goal: "Apply LIDAR hits and misses to a row of occupancy cells in log-odds and convert the result to probabilities.",
      refs: [{ course: "L24-25" }],
      brief: `
One row of 8 map cells lies straight ahead of the LIDAR, cell 0 nearest. Every scan returns the index of the cell where the beam was stopped. That tells you three things:

- the cells **before** it let the beam through: evidence for free (a **miss**),
- the cell **itself** stopped the beam: evidence for occupied (a **hit**),
- the cells **behind** it were not seen: no evidence, no change.

Each cell stores log-odds, starting at 0 (p = 0.5).

The figure shows one such cell. It uses p = 0.8 for a hit and 0.3 for a miss; this level's constants are weaker (L_OCC and L_FREE), the adding is the same.

{{figure:log-odds}}

## Write
\`update_row(hit)\`: for every cell that was seen, apply

\`\`\`c
logodds[i] = logodds[i] + l_sensor - L_0;
\`\`\`

with \`L_FREE\` as l_sensor for a miss and \`L_OCC\` for the hit cell.

\`prob(l)\`: return the probability \`1 - 1 / (1 + e^l)\`. The exponential function is \`exp()\`.

\`main\` applies five scans. Four of them end at cell 5, a wall. One ends at cell 3: something crossed the beam for a moment.
`,
      kit: "robot",
      durationMs: 5,
      starter: occProgram(`    return 0.5f;
//SPLIT
    // misses before 'hit', a hit at 'hit', nothing behind it`),
      solution: occProgram(`    return 1.0f - 1.0f / (1.0f + exp(l));
//SPLIT
    int i;

    for (i = 0; i < hit; i++) {
        logodds[i] = logodds[i] + L_FREE - L_0;
    }
    logodds[hit] = logodds[hit] + L_OCC - L_0;`),
      checks: [
        { kind: "var", name: "pWall", ...range(0.9677, 0.003), label: "Cell 5, hit four times: about 0.97", hint: "The scan that ended at cell 3 says nothing about cell 5: it is behind the hit." },
        { kind: "var", name: "pNear", ...range(0.1141, 0.003), label: "Cell 2, passed five times: about 0.11" },
        { kind: "var", name: "pOnce", ...range(0.3122, 0.003), label: "Cell 3, passed four times and hit once: about 0.31" },
        { kind: "var", name: "pBehind", ...range(0.5, 0.003), label: "Cell 7, never seen: still 0.5", hint: "Cells behind the hit must not change." },
      ],
      watch: ["pWall", "pNear", "pOnce", "pBehind"],
      hints: [
        "update_row: a loop over the cells 0 to hit - 1 for the misses, then one line for the hit cell.",
        "`logodds[i] = logodds[i] + L_FREE - L_0;` in the loop and `logodds[hit] = logodds[hit] + L_OCC - L_0;` after it.",
        "prob: `return 1.0f - 1.0f / (1.0f + exp(l));`",
      ],
      takeaway: "The one stray reading at cell 3 was outvoted by four beams passing through it. The map forgets passing obstacles and keeps walls.",
    },
    {
      id: "map-mcl",
      kind: "quiz",
      tier: "practice",
      title: "Where on the map am I?",
      goal: "Check the ideas behind occupancy grids and Monte Carlo localisation.",
      refs: [{ course: "L24-25" }],
      brief: `
Mapping needs to know where the robot is. Localisation needs a map. Doing both at once is called **SLAM**, simultaneous localisation and mapping. Two ideas from the lecture, in outline.

## Occupancy grid
The world is cut into cells, each with a probability of being occupied, stored as log-odds and updated by addition: l_new = l_old + l_sensor - l_0.

## Monte Carlo localisation
The robot's belief about its own pose is represented by many guesses, called **particles**. Each particle is one possible pose.

1. **Start.** If the robot has no idea where it is, the belief is **uniform**: with |X| possible poses, each has probability 1 / |X|. The particles are spread evenly over the map.
2. **Move.** When the robot drives, every particle is moved the same way, plus a little random noise, because odometry is not exact.
3. **Weigh.** Each particle is scored: if the robot were at this pose, how well would the LIDAR scan it just took match the map?
4. **Resample.** A new set of particles is drawn from the old one, with a chance proportional to the weight. Good guesses are copied several times, poor ones disappear.

Repeated, the cloud of particles contracts around the true pose.
`,
      questions: [
        {
          prompt: "A map has 400 free cells and the robot could be in any of them, facing one of 4 directions. What is the initial probability of each pose in a uniform belief?",
          options: ["1 / 400", "1 / 1600", "1 / 4", "0.5"],
          answer: 1,
          why: "|X| = 400 x 4 = 1600 poses, each with probability 1 / |X|.",
        },
        {
          prompt: "What does the resampling step do?",
          options: [
            "It moves every particle to the best pose",
            "It draws a new set of particles, favouring those with high weight",
            "It deletes the map",
            "It adds noise to the LIDAR scan",
          ],
          answer: 1,
          why: "Particles that explain the measurement well are duplicated, the others die out. The number of particles stays the same.",
        },
        {
          prompt: "A cell has log-odds 0. What does the map know about it?",
          options: ["It is certainly free", "It is certainly occupied", "Nothing: the probability is 0.5", "It is outside the map"],
          answer: 2,
          why: "l = ln(p / (1 - p)) is 0 exactly when p = 0.5.",
        },
        {
          prompt: "Why is noise added when the particles are moved?",
          options: [
            "To make the program slower",
            "Because the wheels slip and odometry is uncertain, so the true motion is not exactly the commanded one",
            "Because the LIDAR is noisy",
            "To keep the particles on the grid",
          ],
          answer: 1,
          why: "The spread of the particles must cover where the robot could really be after the move, or the true pose is lost.",
        },
      ],
      hints: ["Count poses: positions times headings.", "Weights say how well a guess explains the scan. Resampling acts on the weights."],
      takeaway: "A grid of log-odds answers what the world looks like, a cloud of weighted guesses answers where the robot is in it.",
    },
    {
      id: "plan-astar8",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A* with diagonal moves",
      goal: "Write A* on an 8-connected grid with diagonal cost, no corner cutting, and a heuristic that stays admissible.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
The robot can drive diagonally. Write \`astar8()\` for the map below, from (5, 0) to (0, 6).

\`\`\`
0x0x000
0000000
00x0000
00000x0
0x0x000
0000000
\`\`\`

## Rules
- Eight neighbours. A straight step costs \`COST_STRAIGHT\` (10), a diagonal step \`COST_DIAGONAL\` (14, ten times 1.41 rounded down). Integers keep the arithmetic exact.
- **No corner cutting.** A diagonal step from (r, c) to (r + dr, c + dc) is allowed only if both cells it passes between, (r + dr, c) and (r, c + dc), are free. A robot with a real width would hit the obstacle's corner.
- Return 1 and fill \`pathRow\`, \`pathCol\`, \`pathLen\` (from the goal back to the start), return 0 when there is no path, 2 when start and goal are the same cell. Count the cells you close in \`expanded\`.

## The heuristic
The Manhattan distance overestimates when diagonals are allowed. You need a heuristic that never exceeds the true cost with **these** step costs, and that is as large as it can be within that limit, so that few cells are expanded. Think about the cheapest way to cover dr rows and dc columns on an empty grid: how many diagonal steps, how many straight ones?

## Tests
The path must be legal and have the smallest possible cost. The search must not expand more than 20 cells on the open map. \`main\` then walls the goal in and expects 0.

Only the data, \`canTravel\` and the path checker are given.
`,
      kit: "robot",
      durationMs: 60,
      starter: astar8Program(`// Returns 1 if a path was found, 0 if there is no path, 2 if start == goal
int astar8(int rowStart, int colStart, int rowEnd, int colEnd)
{
    return 0;
}`),
      solution: astar8Program(`// Cheapest cost on an empty grid: diagonal steps for the shorter side,
// straight steps for the rest
int heuristic8(int rowCurr, int colCurr, int rowGoal, int colGoal)
{
    int dr = abs(rowCurr - rowGoal);
    int dc = abs(colCurr - colGoal);

    if (dr < dc) {
        return COST_DIAGONAL * dr + COST_STRAIGHT * (dc - dr);
    }
    return COST_DIAGONAL * dc + COST_STRAIGHT * (dr - dc);
}

// Returns 1 if a path was found, 0 if there is no path, 2 if start == goal
int astar8(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int dRow[8] = {-1, 0, 0, 1, -1, -1, 1, 1};
    int dCol[8] = {0, -1, 1, 0, -1, 1, -1, 1};
    int goal = rowEnd * COLS + colEnd;
    int bestF = 0;
    int i, k, cur, f, row, col, next, newG, ok;

    for (i = 0; i < NCELLS; i++) {
        g[i] = 0;
        parent[i] = -1;
        state[i] = 0;
    }
    expanded = 0;
    pathLen = 0;
    if (rowStart == rowEnd && colStart == colEnd) {
        return 2;
    }
    state[rowStart * COLS + colStart] = 1;

    while (1) {
        cur = -1;
        for (i = 0; i < NCELLS; i++) {
            if (state[i] == 1) {
                f = g[i] + heuristic8(i / COLS, i % COLS, rowEnd, colEnd);
                if (cur == -1 || f < bestF) {
                    cur = i;
                    bestF = f;
                }
            }
        }
        if (cur == -1) {
            return 0;
        }
        if (cur == goal) {
            while (cur != -1) {
                pathRow[pathLen] = cur / COLS;
                pathCol[pathLen] = cur % COLS;
                pathLen++;
                cur = parent[cur];
            }
            return 1;
        }
        state[cur] = 2;
        expanded++;

        for (k = 0; k < 8; k++) {
            row = cur / COLS + dRow[k];
            col = cur % COLS + dCol[k];
            ok = canTravel(row, col);
            if (ok && k >= 4) {
                // diagonal: both cells beside the step must be free
                if (canTravel(row, cur % COLS) == 0 || canTravel(cur / COLS, col) == 0) {
                    ok = 0;
                }
            }
            if (ok) {
                next = row * COLS + col;
                if (k >= 4) {
                    newG = g[cur] + COST_DIAGONAL;
                } else {
                    newG = g[cur] + COST_STRAIGHT;
                }
                if (state[next] == 0 || (state[next] == 1 && newG < g[next])) {
                    g[next] = newG;
                    parent[next] = cur;
                    state[next] = 1;
                }
            }
        }
    }
}`),
      checks: [
        { kind: "var", name: "retOpen", equals: 1, label: "A path is found on the open map" },
        { kind: "var", name: "costOpen", equals: 92, label: "The path is legal (no corner cut) and has the smallest possible cost", hint: "-1: the stored path is not legal, often a cut corner. More than 92: the path is legal but not the cheapest, so check the step costs, and that the heuristic never overestimates (the Manhattan distance does)." },
        { kind: "var", name: "expandedOpen", min: 1, max: 20, label: "At most 20 cells are expanded", hint: "A heuristic of 0 is admissible and expands nearly the whole map. Use diagonal steps for the shorter side and straight steps for the rest." },
        { kind: "var", name: "retBlocked", equals: 0, label: "With the goal walled in, astar8 returns 0" },
      ],
      watch: ["retOpen", "costOpen", "expandedOpen", "retBlocked", "pathLen"],
      hints: [
        "Start from the 4-connected A* and extend the neighbour tables to eight entries. Keep the four straight moves first, so that `k >= 4` means diagonal.",
        "For a diagonal move to (row, col) from cur, the two cells to test are (row, cur's column) and (cur's row, col).",
        "With dr and dc the absolute differences and m the smaller of the two: h = 14 x m + 10 x (larger - m).",
      ],
      takeaway: "A heuristic is admissible for a particular set of moves and costs. Change the moves and it has to be derived again: here it is the cost of the best path on an empty grid.",
    },
    {
      id: "vis-twopass",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Two-pass labelling",
      goal: "Label the blobs of a mask in two raster scans with an equivalence table, without a stack or a queue.",
      refs: [{ course: "L17" }],
      brief: `
A flood fill jumps around the image and needs a stack as large as the biggest blob. A camera delivers pixels row by row, and the classic way to label blobs in that order needs only the row above. It is the **two-pass** algorithm.

## Pass 1: provisional labels
Scan the image row by row, left to right. For each mask pixel look at two neighbours that have already been labelled: the pixel **above** and the pixel to the **left**.

- Neither has a label: this pixel starts a new provisional label.
- One has a label: copy it.
- Both have labels: copy one. If the two differ, you have just learned that two labels belong to the **same** blob. Record that in an **equivalence table**.

A U shape shows why this is needed: its two arms get different labels at the top, and only the bottom row reveals that they are joined.

## The equivalence table
Keep an array \`parent[]\` with one entry per provisional label, where a label that stands for itself has \`parent[x] == x\`. To find the representative (the **root**) of a label, follow \`parent\` until it stops changing. To record that two labels are equivalent, find both roots and make one the parent of the other. This structure is known as union-find.

## Pass 2: final labels
Replace every label by its root. The number of blobs is the number of roots.

## Write label_blobs()
Fill \`label[]\` (0 for background, the same non-zero value for all pixels of one blob, different values for different blobs) and set \`numBlobs\`. 4-connectivity. \`check_labels()\` verifies the result. Size your table for the worst case: at most every second pixel can start a new label.

The mask has four shapes, chosen so that three of them need a merge.
`,
      kit: "robot",
      durationMs: 30,
      starter: twoPassProgram(`void label_blobs(void)
{
}`),
      solution: twoPassProgram(`uint16_t parent[NPIX / 2 + 2];   // equivalence table: parent[x] == x for a root

int find_root(int x)
{
    while (parent[x] != x) {
        x = parent[x];
    }
    return x;
}

void label_blobs(void)
{
    int row, col, i, up, left, a, b;
    int next = 1;

    // Pass 1: provisional labels and equivalences
    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            i = row * COLS + col;
            label[i] = 0;
            if (mask[i] == 1) {
                up = 0;
                left = 0;
                if (row > 0) {
                    up = label[i - COLS];
                }
                if (col > 0) {
                    left = label[i - 1];
                }
                if (up == 0 && left == 0) {
                    parent[next] = next;
                    label[i] = next;
                    next++;
                } else if (left == 0) {
                    label[i] = up;
                } else if (up == 0) {
                    label[i] = left;
                } else {
                    a = find_root(up);
                    b = find_root(left);
                    if (a < b) {
                        parent[b] = a;
                        label[i] = a;
                    } else {
                        parent[a] = b;
                        label[i] = b;
                    }
                }
            }
        }
    }

    // Pass 2: every label becomes its root
    for (i = 0; i < NPIX; i++) {
        if (label[i] != 0) {
            label[i] = find_root(label[i]);
        }
    }

    numBlobs = 0;
    for (a = 1; a < next; a++) {
        if (parent[a] == a) {
            numBlobs++;
        }
    }
}`),
      checks: [
        { kind: "var", name: "numBlobs", equals: 4, label: "4 blobs are found", hint: "8: the provisional labels were counted. Count only the roots of the equivalence table." },
        { kind: "var", name: "labelsOk", equals: 1, label: "Touching pixels share a label, separate shapes have different labels", hint: "Run pass 2 over the whole image: both arms of the U must end with the same label." },
        { kind: "source", mustNotMatch: "\\b(stack|queue)\\b", label: "No stack and no queue" },
      ],
      watch: ["numBlobs", "labelsOk"],
      hints: [
        "Pass 1 needs `up = label[i - COLS]` (if row > 0) and `left = label[i - 1]` (if col > 0), then the four cases.",
        "When both neighbours are labelled, take the roots of both. If they differ, set the parent of the larger root to the smaller one.",
        "Pass 2: `label[i] = find_root(label[i]);` for every labelled pixel. Then count the labels x with `parent[x] == x`.",
      ],
      takeaway: "Two sequential passes and a small table do the work of a flood fill. This is the form used on streaming hardware, where pixels arrive once, in order.",
    },
  ],
};
