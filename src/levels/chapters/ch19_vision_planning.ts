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
float turn = 0;           // turn command: positive = turn right

// Results of the three test images, copied by main
int area1 = -1, maskCount = 0;
float cx1 = 0, cy1 = 0, turn1 = 0;      // the image above
int area2 = -1;
float cx2 = 0, turn2 = 0;               // mirrored: the ball is on the left
int area3 = -1;
float turn3 = 9;                        // the ball is gone

${HSL_FN}

void find_target(void)
{
${body}
}

// Swaps left and right in the image. Do not change.
void mirror_image(void)
{
    int row, col, a, b;
    uint16_t t;

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS / 2; col++) {
            a = row * COLS + col;
            b = row * COLS + (COLS - 1 - col);
            t = img_r[a]; img_r[a] = img_r[b]; img_r[b] = t;
            t = img_g[a]; img_g[a] = img_g[b]; img_g[b] = t;
            t = img_b[a]; img_b[a] = img_b[b]; img_b[b] = t;
        }
    }
}

void main(void)
{
    int i;

    find_target();
    area1 = area; cx1 = cx; cy1 = cy; turn1 = turn;
    for (i = 0; i < NPIX; i++) {
        if (mask[i] == 1) {
            maskCount++;
        }
    }

    mirror_image();
    find_target();
    area2 = area; cx2 = cx; turn2 = turn;

    // The ball is taken away: only grey floor is left
    for (i = 0; i < NPIX; i++) {
        img_r[i] = 160; img_g[i] = 160; img_b[i] = 160;
    }
    find_target();
    area3 = area; turn3 = turn;
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
float turn = 0;           // turn command: positive = turn right

// Results copied by main: the mask above, then the same mask mirrored left to right
int area1 = -1;
float cx1 = 0, cy1 = 0, turn1 = 0;
float cx2 = 0, cy2 = 0, turn2 = 0;

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
        turn = KP_TURN * (cx - CENTRE_COL);
    }
}

void main(void)
{
    int row, col, a, b;
    uint16_t t;

    find_centroid();
    area1 = area; cx1 = cx; cy1 = cy; turn1 = turn;

    // Mirror the mask left to right and measure again
    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS / 2; col++) {
            a = row * COLS + col;
            b = row * COLS + (COLS - 1 - col);
            t = mask[a]; mask[a] = mask[b]; mask[b] = t;
        }
    }
    find_centroid();
    cx2 = cx; cy2 = cy; turn2 = turn;
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
  p: [350, 20], // pale pink reflection: a red hue, but hardly any colour
};
const RED_IMAGE = [
  ". . . . . . . .",
  ". . a b c d . .",
  ". . b c a c . M",
  ". . d a b b . M",
  ". O . . . . . .",
  ". O . . . p . .",
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

// Results copied by main: the image above, then with the cone's left edge washed out
int area1 = -1, area2 = -1;
float cx1 = 0, cy1 = 0, cx2 = 0, cy2 = 0;

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
    int row;

    find_red();
    area1 = area; cx1 = cx; cy1 = cy;

    // Glare washes out column 2: same hue, hardly any colour left
    for (row = 0; row < ROWS; row++) {
        sat[row * COLS + 2] = 10;
    }
    find_red();
    area2 = area; cx2 = cx; cy2 = cy;
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
#define MIN_AREA 6        // blobs smaller than this are noise

${maskArray("mask", BLOB_MASK)}

uint16_t label[NPIX];     // 0 = not visited yet, otherwise the blob number
int stack[NPIX];          // pixels waiting to be visited

uint16_t numRaw = 0;      // all blobs, noise included
uint16_t numBlobs = 0;    // blobs with at least MIN_AREA pixels
uint16_t bestArea = 0;    // area of the largest blob
float bestCx = 0;         // its centroid column
float bestCy = 0;         // its centroid row

// Results copied by main: the mask above, then with one more pixel set
int numRaw1 = -1, numBlobs1 = -1, bestArea1 = -1;
float bestCx1 = 0, bestCy1 = 0;
int numRaw2 = -1, bestArea2 = -1;
float bestCx2 = 0, bestCy2 = 0;

void find_blobs(void)
{
${body}
}

void main(void)
{
    find_blobs();
    numRaw1 = numRaw; numBlobs1 = numBlobs; bestArea1 = bestArea;
    bestCx1 = bestCx; bestCy1 = bestCy;

    // One more pixel at (4, 4): it joins a speck to the big blob
    mask[4 * COLS + 4] = 1;
    find_blobs();
    numRaw2 = numRaw; bestArea2 = bestArea;
    bestCx2 = bestCx; bestCy2 = bestCy;
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

// Results copied by main: the mask above, then with a pixel that joins two shapes
int numBlobs1 = -1, labelsOk1 = -1;
int numBlobs2 = -1, labelsOk2 = -1;

${fns}

// Checks the result. joined = 1: the first and the third shape are now one. Do not change.
int check_labels(int joined)
{
    int row, col, i, a, b, c, d;

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
    // one pixel of each of the four shapes
    a = label[1 * COLS + 1];
    b = label[1 * COLS + 7];
    c = label[5 * COLS + 2];
    d = label[6 * COLS + 6];
    if (a == b || a == d || b == c || b == d || c == d) return 0;
    if (joined == 0 && a == c) return 0;
    if (joined == 1 && a != c) return 0;
    return 1;
}

void main(void)
{
    label_blobs();
    numBlobs1 = numBlobs;
    labelsOk1 = check_labels(0);

    // One more pixel at (4, 2): it joins the first shape to the third
    mask[4 * COLS + 2] = 1;
    label_blobs();
    numBlobs2 = numBlobs;
    labelsOk2 = check_labels(1);
    while (1) {}
}
`;

// ------------------------------------------------------------------ planning
const mapText = (rows: string[]) => rows.map((r) => `    "${r}"`).join("\n");

const MAZE = ["000x000", "0x0x0x0", "0x000x0", "0xxxxx0", "000000x", "0x0x0x0"];
const TRAP = ["00xx0x0", "00000x0", "000x0x0", "000x000", "0000000", "0000x00"];
// A wall with two gaps: the near one (column 2) is deep mud, the far one (column 4) is dry.
const MUD = ["0000000", "0000000", "xxmx0xx", "0000000", "0000000", "0000000"];
const OPEN_FLOOR = ["0x0x000", "0000000", "00x0000", "00000x0", "0x0x000", "0000000"];

const GRID_DEFS = (rows: string[]) => `#define ROWS 6
#define COLS 7
#define NCELLS (ROWS * COLS)

// The map as the course code stores it: one row after the other.
// 'x' is an obstacle, '0' is free${rows.some((r) => r.includes("m")) ? ", 'm' is mud (free, but slow)" : ""}.
// Cell (row, col) is map[row * COLS + col].
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

const STEP_COST = `#define MUD_COST 6

// Cost of driving INTO cell (row, col): 1 on a dry cell, MUD_COST through mud ('m')
int stepCost(int row, int col)
{
    if (map[row * COLS + col] == 'm') {
        return MUD_COST;
    }
    return 1;
}`;

const CHECK_PATH = `// Cost of the path in pathRow/pathCol, or -1 if it is not a connected
// path of free cells from the goal back to the start. Do not change.
int check_path(int rowStart, int colStart, int rowEnd, int colEnd)
{
    int i, d;
    int cost = 0;

    if (pathLen < 1) return -1;
    if (pathRow[0] != rowEnd || pathCol[0] != colEnd) return -1;
    if (pathRow[pathLen - 1] != rowStart || pathCol[pathLen - 1] != colStart) return -1;
    for (i = 0; i < pathLen; i++) {
        if (canTravel(pathRow[i], pathCol[i]) == 0) return -1;
        if (i > 0) {
            d = abs(pathRow[i] - pathRow[i - 1]) + abs(pathCol[i] - pathCol[i - 1]);
            if (d != 1) return -1;
            cost += stepCost(pathRow[i - 1], pathCol[i - 1]);
        }
    }
    return cost;
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

${STEP_COST}

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
  newG: `                newG = g[cur] + stepCost(row, col);`,
  setParent: `                    parent[next] = cur;`,
};

const ASTAR_MAIN = `    hTest = heuristic(1, 5, 4, 1);

    // 1. Two ways through the wall: the short one is muddy
    retDry = astar(5, 1, 0, 1);
    gDry = g[0 * COLS + 1];
    costDry = check_path(5, 1, 0, 1);

    // 2. A straight run along the bottom row: the heuristic should keep the search in it
    astar(5, 0, 5, 6);
    expandedLine = expanded;

    // 3. The dry gap is closed: the mud is now the only way
    map[2 * COLS + 4] = 'x';
    retMud = astar(5, 1, 0, 1);
    costMud = check_path(5, 1, 0, 1);

    // 4. Both gaps closed
    map[2 * COLS + 2] = 'x';
    retBlocked = astar(5, 1, 0, 1);`;

const ASTAR_RESULT_GLOBALS = `
int hTest = -1;         // heuristic(1, 5, 4, 1)
int retDry = -1;        // return value with both gaps open
int gDry = -1;          // g of the goal cell after that search
int costDry = -1;       // cost of the path that was written
int expandedLine = -1;  // cells expanded on the straight run from (5, 0) to (5, 6)
int retMud = -1;        // return value with only the muddy gap left
int costMud = -1;
int retBlocked = -1;    // return value once both gaps are closed`;

const TRAP_MAIN = `    retValue = astar(5, 0, 0, 6);
    steps = check_path(5, 0, 0, 6);
    expandedFirst = expanded;

    astar(3, 2, 2, 6);
    steps2 = check_path(3, 2, 2, 6);`;
const TRAP_GLOBALS = `
int retValue = -1;
int steps = -1;         // steps of the path A* returned from (5, 0) to (0, 6)
int expandedFirst = -1; // cells it expanded on the way
int steps2 = -1;        // steps of a second path`;

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
const SCENE_PIC = [". . . B . B O .", ". W . B . b b .", ". . . B . . . .", ". b . . . B Y .", ". b P . . B . .", ". . . R . . . ."];

const sceneProgram = (fns: string) => `#define ROWS 6
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

int targetRow = -1;       // cell of the orange target, -1 if there is none
int targetCol = -1;
int numObstacles = 0;     // number of 'x' cells in the map
int steps = -1;           // length of the shortest path to the target, -1 if none

// Results of the three scenes, copied by main
int row1 = -9, col1 = -9, obstacles1 = -9, steps1 = -9;
int row2 = -9, col2 = -9, obstacles2 = -9, steps2 = -9;
int obstacles3 = -9, steps3 = -9;

${fns}

// Repaints one cell of the scene. Do not change.
void paint(int row, int col, uint16_t hue, uint16_t sat)
{
    scene_h[row * COLS + col] = hue;
    scene_s[row * COLS + col] = sat;
}

// Do not change main.
void main(void)
{
    InitSysCtrl();
    InitGpio();

    // LED1, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

    // Scene 1: as above
    look_and_plan();
    row1 = targetRow; col1 = targetCol; obstacles1 = numObstacles; steps1 = steps;
    DELAY_US(10000);

    // Scene 2: the target is moved to (1, 4) and the blue box at (0, 5) is taken away
    paint(0, 6, 0, 5);
    paint(1, 4, 28, 90);
    paint(0, 5, 0, 5);
    look_and_plan();
    row2 = targetRow; col2 = targetCol; obstacles2 = numObstacles; steps2 = steps;
    DELAY_US(10000);

    // Scene 3: two blue boxes close the target in
    paint(0, 5, 225, 80);
    paint(2, 4, 205, 70);
    look_and_plan();
    obstacles3 = numObstacles; steps3 = steps;
    while (1) {}
}
`;

// ---- following the ball with the numbers the camera sends
const followProgram = (body: string) => `#define CENTRE_COL 80.0f   // the image is 160 columns wide
#define MIN_AREA 50.0f     // smaller blobs are glare, not the ball
#define KP_VISION 0.01f
#define TURN_MAX 0.6f

// The two commands for the wheels, as in the wall follower:
float vref = 0;            // forward speed, ft/s
float turn = 0;            // positive: left wheel faster, the robot turns RIGHT

// Results of the test frames, copied by main
float turnRight = 9, turnLeft = 9, turnFar = 9, turnCentre = 9, vrefCentre = 9;
float turnNone = 9, vrefNone = 9, turnGlare = 9, vrefGlare = 9;

// Called for every camera frame with the area (pixels) and the centroid
// column of the largest blob. The camera sends 0, 0 when it found nothing.
void follow(float area, float col)
{
${body}
}

void main(void)
{
    follow(300.0f, 120.0f);     // ball on the right
    turnRight = turn;
    follow(280.0f, 30.0f);      // ball on the left
    turnLeft = turn;
    follow(350.0f, 5.0f);       // ball at the left edge
    turnFar = turn;
    follow(400.0f, 80.0f);      // ball straight ahead
    turnCentre = turn;
    vrefCentre = vref;
    follow(0.0f, 0.0f);         // nothing found
    turnNone = turn;
    vrefNone = vref;
    follow(12.0f, 150.0f);      // a speck of glare on the right
    turnGlare = turn;
    vrefGlare = vref;
    while (1) {}
}
`;

// Statement budgets of the stars (reference solutions: 7061 and 4069 statements).
const STEPS_TARGET = 7400;
const STEPS_BFS = 4800;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const range = (v: number, tol = 0.01) => ({ min: round6(v - tol), max: round6(v + tol) });

export const ch19: Chapter = {
  id: "vision-planning",
  number: 19,
  title: "Seeing and planning",
  blurb: "Colour, blobs and centroids, then BFS, A* and occupancy grids.",
  requires: ["sensors"],
  course: ["L17", "L18", "L22-23", "L24-25", "HW5", "HW6"],
  levels: [
    {
      id: "vis-brief",
      kind: "brief",
      title: "From pixels to a turn command",
      goal: "Learn how a camera image becomes a number the robot can steer with.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
The robot's camera answers one question many times per second: **where is the golf ball?** This chapter builds the answer in small steps, then plans a route to the ball.

## A picture is numbers
A camera image is a grid of small squares called **pixels**. Each pixel holds three numbers from 0 to 255: how much **red**, **green** and **blue** light it received (R, G, B). (255, 128, 0) is orange, (160, 160, 160) is grey, (0, 0, 0) is black.

## Which pixels are the ball?
The obvious test, "R above 200", fails as soon as a shadow falls on the ball: all three numbers drop together. So the same colour is written a second way, called **HSL**:

- **Hue** H: which colour it is, as a position on a colour circle in degrees. 0 is red, 120 green, 240 blue, and 360 is red again.
- **Saturation** S: how strong the colour is. 0 is grey, 1 is pure colour.
- **Lightness** L: 0 is black, 1 is white.

A shadow lowers L and leaves H almost unchanged. Press Shadow in the figure: R, G and B all change, and the hue stays.

{{figure:hsl-picker}}

So the test is on H, and it asks for enough S as well, because grey has no real hue. A test that compares a number with a fixed limit is called a **threshold**. The result is a **mask**: a second grid with 1 where the pixel has the target colour and 0 everywhere else.

## From the mask to the wheels
1. Count the 1s: the **area**. A few scattered 1s are noise, not a ball.
2. Find the middle of the 1s: the **centroid**.
3. Steer: if the centroid is right of the middle of the image, turn right.

The next levels take these one at a time: how a grid is stored in C, the centroid, then the whole function.

The lecture's HSV and the lab camera's LAB thresholds rest on the same idea as HSL.
`,
      questions: [
        {
          prompt: "A pixel holds R = 200, G = 200, B = 200. What does it look like?",
          options: ["Bright red", "Light grey: the three colours are equally strong", "Black", "Orange"],
          answer: 1,
          why: "Equal amounts of red, green and blue give no colour at all, only brightness: grey. Its saturation is 0.",
        },
        {
          prompt: "A shadow falls on half of the orange ball. Which test still finds the whole ball?",
          options: ["R > 200", "R + G + B > 300", "Hue between 15 and 45 degrees, with saturation above 0.5", "Lightness above 0.4"],
          answer: 2,
          why: "The shadow lowers R, G, B and the lightness. The hue depends on the ratio between the three numbers, which stays the same.",
        },
        {
          prompt: "The mask of an image holds 1 at 14 pixels and 0 at all the others. What does that tell you?",
          options: [
            "The image is 14 pixels wide",
            "14 pixels passed the colour test: the area of the target is 14",
            "The ball is at column 14",
            "The image has 14 colours",
          ],
          answer: 1,
          why: "The mask marks the pixels that have the target colour. Counting its 1s gives the area.",
        },
      ],
      takeaway: "A pixel is three numbers. Threshold its hue and saturation to get a mask, find the middle of the mask, and steer on how far that is from the middle of the image.",
    },
    {
      id: "vis-grid",
      kind: "calc",
      title: "Maths you need: a grid in one array",
      goal: "Convert between the row and column of a pixel and its place in the array that stores the image.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
An image has rows and columns. C memory is one long line. So the image is stored **row after row** in one array: all of row 0, then all of row 1, and so on. The maps later in this chapter are stored the same way.

Rows are counted from the top and columns from the left, both from 0. For an image with \`COLS\` columns:

\`\`\`c
i = row * COLS + col;    // from (row, col) to the place in the array
\`\`\`

Why: before the pixel lie \`row\` complete rows of \`COLS\` pixels each, and then \`col\` pixels of its own row.

**Worked example**, 6 columns: the pixel in row 1, column 2 has 1 complete row before it (6 pixels) and 2 pixels before it in its own row. i = 1 x 6 + 2 = 8.

The way back uses integer division, which drops the remainder, and \`%\`, which keeps only the remainder:

\`\`\`c
row = i / COLS;    // 8 / 6 = 1
col = i % COLS;    // 8 % 6 = 2
\`\`\`

Click cells in the figure and watch all three lines.

{{figure:math-grid}}

To visit every pixel, the code uses two loops, one inside the other. The outer loop goes down the rows, the inner one along each row:

\`\`\`c
for (row = 0; row < ROWS; row++) {
    for (col = 0; col < COLS; col++) {
        i = row * COLS + col;
        // ... use img[i] ...
    }
}
\`\`\`

## The exercise
The camera image of this chapter has **8 rows and 12 columns**.
`,
      fields: [
        { id: "n", label: "Number of elements in the array that stores the image", answer: 96, why: "8 rows of 12 pixels: 8 x 12 = 96. In the code this is NPIX = ROWS * COLS." },
        { id: "idx", label: "Index of the pixel in row 3, column 7", answer: 43, why: "3 complete rows are before it: 3 x 12 = 36. Then 7 more: 36 + 7 = 43." },
        { id: "last", label: "Index of the last pixel (row 7, column 11)", answer: 95, why: "7 x 12 + 11 = 95. The array has 96 elements, numbered 0 to 95." },
        { id: "row", label: "Row of array element 30", answer: 2, why: "30 / 12 = 2 in integer division (2 x 12 = 24, and 36 would be too much)." },
        { id: "col", label: "Column of array element 30", answer: 6, why: "30 % 12 = 6: what is left after the 24 pixels of rows 0 and 1." },
      ],
      hints: [
        "Count the complete rows that come before the pixel. Each one holds 12 pixels.",
        "Index = row x 12 + column. For the way back, ask how many times 12 fits into the index (the row) and what is left over (the column).",
        "Row 3, column 7: 3 x 12 + 7. Element 30: 30 = 2 x 12 + 6.",
      ],
      takeaway: "`i = row * COLS + col` going in, `row = i / COLS` and `col = i % COLS` coming back. Always COLS, never ROWS: a row is COLS pixels long.",
    },
    {
      id: "vis-centroid",
      kind: "calc",
      title: "Maths you need: the average position",
      goal: "Compute the centroid of a few mask pixels as the average of their columns and of their rows.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
The robot steers on **where** the ball is in the image. A ball covers many pixels, so "where" means the middle of them: the **centroid**. It is the **average** position of the pixels in the mask.

The average of several numbers is their sum divided by how many there are. The average of 2, 3 and 7 is (2 + 3 + 7) / 3 = 4.

For the mask, do that twice: once with the column numbers of its pixels, once with their row numbers.

**Worked example.** Four pixels are 1: (row 1, column 2), (row 1, column 3), (row 2, column 2) and (row 2, column 3).

- How many: 4
- Column numbers added up: 2 + 3 + 2 + 3 = 10. Average column: 10 / 4 = 2.5
- Row numbers added up: 1 + 1 + 2 + 2 = 6. Average row: 6 / 4 = 1.5

The centroid is at column 2.5, row 1.5: in the middle of the four pixels. The figure starts with this example. Click pixels on and off and watch the dot.

{{figure:math-centroid}}

The lecture and the lab camera call the three sums **moments** and give them names:

- **M00**: the number of pixels in the mask. This is also the **area**.
- **M10**: the sum of their column numbers.
- **M01**: the sum of their row numbers.

So the centroid column is M10 / M00 and the centroid row is M01 / M00.

Two things to try in the figure:

- Press "Add a far pixel". One stray pixel pulls the centroid away from the ball. That is why noise in the mask matters.
- Press Clear. With no pixel, M00 is 0 and there is nothing to divide by.

## The exercise
A mask has 1s at five pixels: (row 2, column 4), (row 2, column 5), (row 2, column 6), (row 3, column 5) and (row 4, column 5).
`,
      fields: [
        { id: "m00", label: "M00, the area", answer: 5, why: "Five pixels are 1." },
        { id: "m10", label: "M10, the column numbers added up", answer: 25, why: "4 + 5 + 6 + 5 + 5 = 25." },
        { id: "m01", label: "M01, the row numbers added up", answer: 13, why: "2 + 2 + 2 + 3 + 4 = 13." },
        { id: "cx", label: "Centroid column", answer: 5, tolPct: 1, why: "M10 / M00 = 25 / 5 = 5. The shape is a T, symmetric about column 5." },
        { id: "cy", label: "Centroid row", answer: 2.6, tolPct: 1, why: "M01 / M00 = 13 / 5 = 2.6. Not a whole number: the centroid lies between rows 2 and 3, nearer the bar of the T." },
        { id: "big", label: "Another blob has M00 = 20 and M10 = 900. Its centroid column", answer: 45, tolPct: 1, why: "900 / 20 = 45. You do not need the pixels, only the sums." },
        { id: "off", label: "A centroid is at column 7.5 in an image whose middle is column 6. How far right of the middle is it?", unit: "columns", answer: 1.5, tolPct: 1, why: "7.5 - 6 = 1.5. Positive: the ball is to the right. This difference is what the robot steers on in the next level." },
      ],
      hints: [
        "Write the five pixels in two lists: their columns (4, 5, 6, 5, 5) and their rows (2, 2, 2, 3, 4).",
        "Add up each list. The count is 5.",
        "Centroid column = 25 / 5. Centroid row = 13 / 5.",
      ],
      takeaway: "The centroid is an average: add up the columns and divide by the count, the same for the rows. M00, M10 and M01 are just the names of the count and the two sums.",
    },
    {
      id: "vis-target",
      kind: "code",
      mode: "complete",
      title: "Find the ball",
      goal: "Threshold a small camera image into a mask, compute area and centroid from the moments, and turn towards the ball.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
Now put the pieces together. The image is 8 rows by 12 columns, stored as three arrays \`img_r\`, \`img_g\` and \`img_b\`, each with one number per pixel. It shows a grey floor, an orange golf ball that is half in shadow, a blue ball, yellow tape, a red cone and a pale wooden wall.

Complete \`find_target()\`, about 100 lines down in the editor, below the image data. This is what the lab's first camera script does, pixel by pixel.

**Given, do not change:** the two loops over every pixel, and the call of \`rgb_to_hsl()\`. After that call \`h\` holds the pixel's hue in degrees and \`s\` its saturation from 0 to 1. The function hands back three results through pointers, which is why the call passes \`&h, &s, &l\`. Its inside is the practice level "rgb_to_hsl".

## 1. Mask
The pixel belongs to the target when

- its hue is between \`H_MIN\` and \`H_MAX\` (15 to 45 degrees), **and**
- its saturation is at least \`S_MIN\` (0.5). The wooden wall has an orange hue too, but it is pale.

"Between" is two comparisons in C: \`h >= H_MIN && h <= H_MAX\`. Store 1 or 0 in \`mask[i]\`.

## 2. Moments
For every pixel that is in the mask, add 1 to \`m00\`, its **column** to \`m10\` and its **row** to \`m01\`. The sums are \`float\`, so that the divisions keep their fraction.

## 3. Results, after the loops
- \`area\` = M00
- \`cx\` = M10 / M00 and \`cy\` = M01 / M00
- \`turn = KP_TURN * (cx - CENTRE_COL);\`

\`turn\` is the turn command you used in the wall follower: a **positive** value makes the left wheel faster, so the robot turns **right**. \`cx - CENTRE_COL\` says how far the ball is from the middle of the image. \`KP_TURN\` is a constant that sets how strongly the robot reacts, called a **gain**. Check the sign with one number: a ball at column 9 gives 0.5 x (9 - 6) = +1.5, a right turn, towards the ball.

An image without the ball has M00 = 0, and a division by 0 gives garbage. Divide only when M00 is above 0, and set \`turn\` to 0 otherwise.

\`main\` runs your function on three images: the one in the code, the same one mirrored (ball on the left), and one with only floor.
`,
      kit: "robot",
      durationMs: 40,
      starter: targetProgram(`    int row, col, i;
    float h, s, l;                      // one pixel: hue, saturation, lightness
    float m00 = 0, m10 = 0, m01 = 0;    // the three sums, 0 on every call

    for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
            i = row * COLS + col;
            rgb_to_hsl(img_r[i], img_g[i], img_b[i], &h, &s, &l);   // given

            // TODO 1: mask[i] = 1 if h and s say "target colour", else 0
            // TODO 2: for a target pixel, add to m00, m10 and m01
            mask[i] = 0;    // replace this line
        }
    }

    // TODO 3: area. Then, only if m00 is above 0: cx, cy and turn.
    //         Otherwise turn = 0.`),
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
        turn = KP_TURN * (cx - CENTRE_COL);
    } else {
        turn = 0;
    }`),
      checks: [
        { kind: "var", name: "area1", equals: 14, label: "Image 1: area is 14, the whole orange ball, lit and shadowed", hint: "0: nothing is stored in mask[] or added to m00 yet, or area is never set. 7: a brightness test crept in. 18: the pale wall is included, so also ask for s >= S_MIN. 20: C has no `15 <= h <= 45`, write two comparisons joined with &&. 96: every pixel counts, so look for a `;` directly after `if (...)`." },
        { kind: "var", name: "maskCount", equals: 14, label: "Image 1: mask[] holds 14 ones", hint: "0 while the area is right: the starter's line `mask[i] = 0;` still runs after your if and wipes the 1. Store 1 for a target pixel and 0 only in the else branch. Otherwise fix the area first." },
        { kind: "var", name: "cx1", ...range(7.5), label: "Image 1: centroid column is 7.5", hint: "Fix the area first. Exactly 7: the sums are integers, so the division dropped the fraction. Keep m00, m10 and m01 as float. About 3.29: rows and columns are swapped, m10 adds col. 0: cx is never set." },
        { kind: "var", name: "cy1", ...range(3.2857), label: "Image 1: centroid row is about 3.29", hint: "Fix the area first. Exactly 3: integer sums, keep them float. 7.5: rows and columns are swapped, m01 adds row." },
        { kind: "var", name: "turn1", ...range(0.75), label: "Image 1: turn is +0.75, the ball is right of centre", hint: "-0.75: the sign is reversed, use cx - CENTRE_COL. Any other value: fix the centroid column first, turn follows from it." },
        { kind: "var", name: "area2", equals: 14, label: "Image 2 (mirrored): area is still 14", hint: "If image 1 is right and this is 28, the sums did not start at 0 on the second call: keep them as local variables set to 0." },
        { kind: "var", name: "cx2", ...range(3.5), label: "Image 2: centroid column is 3.5", hint: "Fix image 1 first: the same code runs on both images." },
        { kind: "var", name: "turn2", ...range(-1.25), label: "Image 2: turn is -1.25, the ball is left of centre", hint: "0.5 x (3.5 - 6) = -1.25. Fix image 1 first: the same code runs on both images." },
        { kind: "var", name: "area3", equals: 0, label: "Image 3 (floor only): area is 0", hint: "Set area from m00 on every call, also when m00 is 0." },
        { kind: "var", name: "turn3", ...range(0, 0.001), label: "Image 3: turn is 0, and nothing was divided by zero", hint: "NaN means \"not a number\": the result of 0 / 0. Divide only when m00 is above 0, and set turn to 0 otherwise. A value left over from image 2 means the else branch is missing." },
      ],
      bonus: [
        { kind: "max-steps", max: STEPS_TARGET, label: "Lean: mask and moments in one loop over each image, at most 7400 statements in all", hint: "A second loop over the image for the moments costs about 200 extra statements per image." },
      ],
      watch: ["area", "cx", "cy", "turn", "area1", "cx1", "turn1", "cx2", "turn2", "turn3"],
      hints: [
        "TODO 1 and 2 are one `if` with an `else`, placed after the given call. The condition has three parts joined with `&&`: h at least H_MIN, h at most H_MAX, s at least S_MIN.",
        "`if (h >= H_MIN && h <= H_MAX && s >= S_MIN) { ... } else { mask[i] = 0; }`. In the if branch set the mask to 1 and add to the three sums: 1, the column, the row.",
        "Inside the if: `mask[i] = 1; m00 += 1; m10 += col; m01 += row;` (else `mask[i] = 0;`). After the loops: `area = (uint16_t)m00;` and, if m00 > 0, the two divisions and the turn line, else `turn = 0;`.",
      ],
      takeaway: "Seven of the fourteen ball pixels are in shadow, and the hue test finds them all. One pass over the image gives mask, area and centroid together, and the test for M00 = 0 keeps an empty image from steering the robot.",
    },
    {
      id: "vis-follow",
      kind: "code",
      mode: "debug",
      title: "Follow the ball",
      goal: "The robot turns away from the ball and spins when there is none. Fix the code that turns the camera's numbers into vref and turn.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
On the robot you do not process pixels yourself. The camera does what you just wrote, with one refinement: it groups mask pixels that touch into **blobs** and measures each blob on its own. For the largest blob it sends the **area** in pixels and the **column** and row of the centroid. When it finds nothing it sends zeros. One camera picture is called a **frame**. It is 160 columns wide, so the centre is column 80.

\`follow()\` runs once per frame and sets the two commands for the wheels, the same two as in the wall follower:

- \`vref\`: the forward speed.
- \`turn\`: **positive makes the left wheel faster, so the robot turns right.**

## What it should do
- **A ball is in view** (area at least \`MIN_AREA\`): drive at 1.0 ft/s and steer towards it: \`turn\` is \`KP_VISION\` times the distance of the centroid from the centre column, limited to the range from -\`TURN_MAX\` to \`TURN_MAX\`.
- **No ball** (area below \`MIN_AREA\`): stop. \`vref = 0\` and \`turn = 0\`. A few lit pixels are glare, not a ball. Ignoring blobs that are too small is called an **area filter**.

## What it does
Two things go wrong on the floor:

1. The robot turns **away** from the ball.
2. When the ball leaves the picture, the robot does not stop. It drives a hard left circle.

For the second one, work out what the turn line computes when the camera sends area 0 and column 0.

On the real robot the ball also leaves the picture just before the robot drives over it, so "no ball" needs more thought than "stop". Deciding what to do then is part of your state machine.
`,
      kit: "robot",
      durationMs: 5,
      starter: followProgram(`    turn = KP_VISION * (CENTRE_COL - col);
    if (turn > TURN_MAX) turn = TURN_MAX;
    if (turn < -TURN_MAX) turn = -TURN_MAX;
    vref = 1.0f;`),
      solution: followProgram(`    if (area >= MIN_AREA) {
        turn = KP_VISION * (col - CENTRE_COL);
        if (turn > TURN_MAX) turn = TURN_MAX;
        if (turn < -TURN_MAX) turn = -TURN_MAX;
        vref = 1.0f;
    } else {
        turn = 0.0f;
        vref = 0.0f;
    }`),
      checks: [
        { kind: "var", name: "turnRight", ...range(0.4), label: "Ball at column 120: turn is +0.4, to the right", hint: "-0.4: the sign is reversed. A ball on the right has a column above 80 and needs a positive turn: 0.01 x (120 - 80)." },
        { kind: "var", name: "turnLeft", ...range(-0.5), label: "Ball at column 30: turn is -0.5, to the left", hint: "+0.5: the sign is reversed. 0.01 x (30 - 80) = -0.5." },
        { kind: "var", name: "turnFar", ...range(-0.6), label: "Ball at column 5: turn is limited to -0.6", hint: "-0.75: the two lines that limit turn to TURN_MAX are gone. +0.6: the sign is reversed." },
        { kind: "var", name: "turnCentre", ...range(0, 0.001), label: "Ball at column 80: turn is 0" },
        { kind: "var", name: "vrefCentre", ...range(1), label: "Ball in view: vref is 1.0", hint: "Set vref to 1.0 in the branch where a ball is in view." },
        { kind: "var", name: "turnNone", ...range(0, 0.001), label: "Nothing found (area 0, column 0): turn is 0", hint: "Column 0 is not a ball at the left edge. Test the area before you use the column." },
        { kind: "var", name: "vrefNone", ...range(0, 0.001), label: "Nothing found: vref is 0", hint: "vref keeps its last value until you change it. Set it to 0 in the branch for \"no ball\"." },
        { kind: "var", name: "turnGlare", ...range(0, 0.001), label: "A blob of 12 pixels is ignored: turn is 0", hint: "Compare the area with MIN_AREA, not with 0." },
        { kind: "var", name: "vrefGlare", ...range(0, 0.001), label: "A blob of 12 pixels is ignored: vref is 0", hint: "12 is below MIN_AREA: this frame must take the \"no ball\" branch and stop." },
      ],
      watch: ["turnRight", "turnLeft", "turnFar", "turnNone", "vrefNone", "turnGlare"],
      hints: [
        "First bug: put in column 120, a ball on the right. Which sign does turn get, and which way does a negative turn steer?",
        "Second bug: with area 0 the camera sends column 0, and the code steers on it as if it were a ball. The function never looks at `area`.",
        "`if (area >= MIN_AREA) { turn = KP_VISION * (col - CENTRE_COL); ...limit it...; vref = 1.0f; } else { turn = 0.0f; vref = 0.0f; }`",
      ],
      takeaway: "Check that there is a target before you steer on it, and check the sign of a new control law once by hand with one number.",
    },
    {
      id: "plan-queue",
      kind: "calc",
      title: "Maths you need: a queue",
      goal: "Follow a queue made of an array and two indexes: what goes in first comes out first.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
The robot now knows where the ball is. Next it needs a route around the obstacles. The search for a route has to remember which places it still has to look at, **in the order it found them**. The tool for that is a **queue**.

A queue is a waiting line. New arrivals join at the back, and the one that has waited longest leaves from the front: **first in, first out**.

In C a queue is an array and two indexes:

- \`tail\`: the next free place at the back.
- \`head\`: the place of the oldest element still waiting.

\`\`\`c
int queue[8];
int head = 0;
int tail = 0;

queue[tail] = 17;  tail++;     // add 17 at the back
queue[tail] = 4;   tail++;     // add 4 behind it
x = queue[head];   head++;     // take the oldest: x is 17
\`\`\`

Nothing is moved or erased. Taking an element only moves \`head\` past it.

**Worked example.** After the three lines above, \`tail\` is 2 (two were added) and \`head\` is 1 (one was taken). \`tail - head\` = 1 element is still waiting: \`queue[1]\`, the 4.

The queue is **empty** when \`head == tail\`: everything that was added has been taken.

Try it in the figure: add three, take two, and say which letter comes out before you press.

{{figure:math-queue}}

## The exercise
A queue starts empty, with \`head = 0\` and \`tail = 0\`. The program adds 5, then 9, then 2. It takes one element. It adds 7. It takes one more element.
`,
      fields: [
        { id: "first", label: "The first element taken", answer: 5, why: "5 was added first, so it leaves first." },
        { id: "second", label: "The second element taken", answer: 9, why: "After 5, the oldest one waiting is 9. The 7 that was added in between joined at the back." },
        { id: "head", label: "head at the end", answer: 2, why: "head counts the elements taken: two." },
        { id: "tail", label: "tail at the end", answer: 4, why: "tail counts the elements added: 5, 9, 2 and 7." },
        { id: "wait", label: "Number of elements still waiting", answer: 2, why: "tail - head = 4 - 2 = 2: the 2 and the 7." },
        { id: "next", label: "The element that would be taken next", answer: 2, why: "queue[head] = queue[2], the third one added: 2." },
      ],
      hints: [
        "Write the array down: queue[0] = 5, queue[1] = 9, queue[2] = 2, and later queue[3] = 7.",
        "Every add moves tail one place on. Every take reads queue[head] and moves head one place on.",
        "Takes: queue[0] = 5, then queue[1] = 9. Afterwards head = 2 and tail = 4.",
      ],
      takeaway: "Add at tail, take at head, empty when they are equal. A queue hands things back in the order they arrived, which is what makes the next level's search find the shortest path.",
    },
    {
      id: "plan-bfs",
      kind: "code",
      mode: "write",
      title: "Breadth-first search",
      goal: "Write BFS with an array as the queue and return the length of the shortest path on a grid.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
The floor is stored as a **grid map**: a grid of cells, each free or blocked, in one array like the image. The robot steps from a cell to a free **neighbour**: up, down, left or right.

**Breadth-first search (BFS)** finds the shortest route by exploring in rings around the start: first every cell 1 step away, then every cell 2 steps away, and so on. When a ring reaches the goal, its number is the length of the shortest path.

The queue keeps the rings in order: cells found earlier are nearer to the start, and the queue hands them back first. To **expand** a cell means to take it out of the queue and look at its four neighbours. Choose BFS in the figure, press Step and watch the queue.

{{figure:search-explorer}}

## The map
\`'x'\` is an obstacle, \`'0'\` is free. \`canTravel(row, col)\` is given: it returns 1 for a free cell and 0 for an obstacle or a place outside the map. A cell is named by one number, its index \`row * COLS + col\`.

\`\`\`
000x000
0x0x0x0
0x000x0
0xxxxx0
000000x
0x0x0x0
\`\`\`

## Write bfs()
It returns the number of steps of the shortest path, or **-1** when the goal cannot be reached. The starter declares the variables. \`dist[]\` holds each cell's number of steps from the start, and -1 means "not reached yet".

1. Set \`dist[]\` to -1 everywhere.
2. Give the start cell \`dist\` 0 and add it to the queue.
3. While the queue is not empty (\`head < tail\`):
   - take the oldest cell out: \`cur\`,
   - if \`cur\` is the goal, return \`dist[cur]\`,
   - for each of its four neighbours that \`canTravel\` and still has \`dist\` -1: set its \`dist\` to \`dist[cur] + 1\` and add it to the queue.
4. The queue ran empty: return -1.

The test "still -1" matters. Without it the search steps back to cells it already knows, again and again.

## The four neighbours
\`dRow\` and \`dCol\` hold the row and column change of the four directions (up, left, right, down), so one loop visits them all:

\`\`\`c
for (k = 0; k < 4; k++) {
    row = cur / COLS + dRow[k];
    col = cur % COLS + dCol[k];
    // (row, col) is one neighbour of cur
}
\`\`\`

Example: \`cur\` = 9 is row 1, column 2 on this 7-column map. k = 0 gives row 0, column 2, the cell above.

\`main\` searches four goals from the top left corner, then removes two walls and asks for the way from (4, 0) to (0, 4).
`,
      kit: "robot",
      durationMs: 30,
      starter: bfsProgram({
        globals: `
int lenNear = -2;       // to (0, 2)
int lenRound = -2;      // to (0, 4): around the wall
int lenFar = -2;        // to (4, 5)
int lenNone = -2;       // to (5, 6): walled in
int lenOpen = -2;       // (4, 0) to (0, 4) with two walls removed`,
        body: `    int dRow[4] = {-1, 0, 0, 1};    // up, left, right, down: row change
    int dCol[4] = {0, -1, 1, 0};    // and column change
    int head = 0;                   // queue: the oldest waiting cell
    int tail = 0;                   // queue: the next free place
    int goal = rowEnd * COLS + colEnd;
    int i, k, cur, row, col, next;

    // 1. dist[] = -1 everywhere
    // 2. the start cell: dist 0, add it to the queue
    // 3. while the queue is not empty:
    //      take the oldest cell, test for the goal,
    //      then look at its four neighbours
    // 4. no path
    return 0;`,
        main: `    lenNear = bfs(0, 0, 0, 2);
    lenRound = bfs(0, 0, 0, 4);
    lenFar = bfs(0, 0, 4, 5);
    lenNone = bfs(0, 0, 5, 6);

    // Two walls removed: now several routes lead to (0, 4)
    map[2 * COLS + 1] = '0';
    map[2 * COLS + 5] = '0';
    lenOpen = bfs(4, 0, 0, 4);`,
      }),
      solution: bfsProgram({
        globals: `
int lenNear = -2;       // to (0, 2)
int lenRound = -2;      // to (0, 4): around the wall
int lenFar = -2;        // to (4, 5)
int lenNone = -2;       // to (5, 6): walled in
int lenOpen = -2;       // (4, 0) to (0, 4) with two walls removed`,
        body: BFS_SOLUTION_BODY,
        main: `    lenNear = bfs(0, 0, 0, 2);
    lenRound = bfs(0, 0, 0, 4);
    lenFar = bfs(0, 0, 4, 5);
    lenNone = bfs(0, 0, 5, 6);

    // Two walls removed: now several routes lead to (0, 4)
    map[2 * COLS + 1] = '0';
    map[2 * COLS + 5] = '0';
    lenOpen = bfs(4, 0, 0, 4);`,
      }),
      checks: [
        { kind: "var", name: "lenNear", equals: 2, label: "(0, 0) to (0, 2): 2 steps", hint: "0 in every test: the function still ends in the starter's `return 0;`. 0 here only: a new cell gets dist[cur] + 1, and a cell that already has a dist must not get another (test dist == -1 before you write). -1: the loop never meets the goal. Did the start cell go into the queue, and does the loop run while head < tail?" },
        { kind: "var", name: "lenRound", equals: 8, label: "(0, 0) to (0, 4): 8 steps, around the wall", hint: "4: the search walked straight through the obstacle, so test canTravel(row, col) before you use a neighbour. -1 while the first search works: set dist[] back to -1 at the start of every call. Another small number: the row is cur / COLS and the column cur % COLS, COLS in both." },
        { kind: "var", name: "lenFar", equals: 9, label: "(0, 0) to (4, 5): 9 steps", hint: "Fix the two searches above first. A smaller number means the search crossed a wall or the edge of the map: check canTravel and COLS." },
        { kind: "var", name: "lenNone", equals: -1, label: "(0, 0) to (5, 6): no path, returns -1", hint: "When the queue runs empty without meeting the goal, return -1. If the loop is `while (1)`, it never notices the empty queue and reads past the end of the array: use `while (head < tail)`." },
        { kind: "var", name: "lenOpen", equals: 8, label: "With two walls removed, (4, 0) to (0, 4): 8 steps, the shortest of several routes", hint: "A longer answer means the cells are not taken out oldest first. Taking the newest cell (a stack) finds a path, but not the shortest." },
      ],
      bonus: [
        { kind: "max-steps", max: STEPS_BFS, label: "Early exit: the five searches take at most 4800 statements", hint: "Return dist[cur] as soon as the goal is taken out of the queue. Without this early exit every call explores the whole map before it answers. Hundreds of thousands of statements: cells enter the queue again and again, so test dist == -1." },
      ],
      watch: ["lenNear", "lenRound", "lenFar", "lenNone", "lenOpen"],
      hints: [
        "Steps 1 and 2 first: a `for` loop that sets every `dist[i]` to -1, then `cur = rowStart * COLS + colStart; dist[cur] = 0; queue[tail] = cur; tail++;`.",
        "Step 3: `while (head < tail) {` take `cur = queue[head]; head++;`, then `if (cur == goal) return dist[cur];`, then the loop over k from the brief.",
        "Inside the k loop: `if (canTravel(row, col)) { next = row * COLS + col; if (dist[next] == -1) { dist[next] = dist[cur] + 1; queue[tail] = next; tail++; } }`. After the while loop: `return -1;`.",
      ],
      takeaway: "BFS reaches every cell first along a shortest path, so the first dist written is final and one visit per cell is enough. Places joined by steps, like these cells and their neighbours, are called a **graph**, and BFS is the simplest graph search.",
    },
    {
      id: "plan-fgh",
      kind: "calc",
      title: "g, h and f",
      goal: "Compute heuristics and f = g + h for a few cells and decide which one A* expands next.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
BFS spreads in every direction, also away from the goal. **A*** (say "A star") looks first where the goal will probably be reached soonest. The cells that were found and are still waiting to be expanded are called the **frontier**. BFS takes the oldest one. A* keeps two numbers for each:

- **g**: the cost of the path found so far from the start to this cell. With every step costing 1, g is the number of steps (BFS called it \`dist\`).
- **h**: a **heuristic**, a quick guess of the cost still to go, computed as if there were no obstacles.

A* always expands the frontier cell with the smallest **f = g + h**: the estimated cost of the whole trip through that cell.

Step BFS and A* in the figure and watch which frontier cell each one takes next. Greedy, the third search there, uses h alone: on the map "greedy trap" that gives a longer path.

{{figure:search-explorer}}

## The heuristic
For a cell that is dr rows and dc columns away from the goal (count both as positive numbers):

- **Manhattan** distance: dr + dc, the number of steps on an empty grid
- **Euclidean** distance: the straight line, the square root of (dr x dr + dc x dc) by Pythagoras

A* returns a shortest path when h **never overestimates** the true remaining cost. Such a heuristic is called **admissible**. The reason: a cell on the best path then never looks more expensive than that path really is, so A* cannot finish along a worse path first. Both distances are admissible when the robot moves in four directions. Manhattan is closer to the truth, so A* expands fewer cells with it.

**Worked example.** The goal is at row 2, column 6. A cell at row 5, column 1 was reached in 3 steps. It is 3 rows and 5 columns away: h = 3 + 5 = 8, and f = 3 + 8 = 11.

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
        { id: "next", label: "Which cell does A* expand next? (1 = A, 2 = B, 3 = C)", answer: 2, why: "B has the smallest f. Greedy search would see A and B as equally good (h = 3), and Dijkstra would see B and C as equally good (g = 4)." },
      ],
      hints: [
        "h for each cell: rows apart plus columns apart, to row 2, column 6.",
        "Cell A is in the goal's row (0 rows apart) and 3 columns away: h = 3. Then f = g + h.",
        "f is 5 + 3 for A, 4 + 3 for B and 4 + 4 for C. A* takes the smallest f.",
      ],
      takeaway: "g is what the path has cost, h is what it will probably still cost, and A* always continues the path with the smallest total.",
    },
    {
      id: "plan-astar",
      kind: "code",
      mode: "complete",
      title: "A* through the mud",
      goal: "Fill in the six missing pieces of A* on a map where some cells cost more to cross, including the answer when there is no path.",
      refs: [{ course: "L18" }, { course: "HW6" }],
      brief: `
Floors are not all alike: mud or carpet costs more than tile. BFS only counts steps. A* handles any step cost, because g adds up **cost**.

\`\`\`
0000000
0000000
xxmx0xx
0000000
0000000
0000000
\`\`\`

The wall has two gaps. The near one is mud (\`'m'\`): driving into it costs \`MUD_COST\` (6). Every other step costs 1. \`stepCost(row, col)\` returns the cost of entering a cell.

The whole function is given except six lines. Each cell has

- \`g[]\`: the cost of the best path found so far from the start,
- \`parent[]\`: the cell that path came from (-1 for the start). Following the parents from the goal back to the start gives the path itself,
- \`state[]\`: 0 not seen yet, 1 in the **open set** (the frontier), 2 **closed** (expanded, finished).

The loop: take the open cell with the smallest f. If it is the goal, follow the parents back and return 1. Otherwise close it and look at its neighbours. A neighbour that is new, or that is now reached more cheaply than before, gets the new \`g\` and the new \`parent\` and goes into the open set.

## The six gaps
1. \`heuristic\`: the **Manhattan** distance. \`abs(x)\` gives a whole number without its sign: \`abs(-3)\` is 3. It turns "rows apart" into a positive count whichever cell is higher. The estimate stays admissible with mud, because no step costs less than 1.
2. \`f = g + h\` for open cell \`i\`. Its row is \`i / COLS\`, its column \`i % COLS\`.
3. The open set is empty and the goal was never reached: there is **no path**. Return 0.
4. \`newG\`: the cost of reaching \`next\` through \`cur\`.
5. Remember where \`next\` was reached from.
6. In \`reconstructPath\`: step from a cell to its parent.

\`main\` plans from (5, 1) to (0, 1), then closes the dry gap and plans again, and finally closes the mud gap too.

The robot's own planner runs this loop with every step costing 1. The A* mode of the figure in the last two levels runs it too.
`,
      kit: "robot",
      durationMs: 40,
      starter: astarProgram({
        rows: MUD,
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
      solution: astarProgram({ rows: MUD, globals: ASTAR_RESULT_GLOBALS, main: ASTAR_MAIN, ...ASTAR_OK }),
      checks: [
        { kind: "var", name: "hTest", equals: 7, label: "heuristic(1, 5, 4, 1) is 7 (3 rows + 4 columns)", hint: "Gap 1. A value of 1 or -1: the differences were added with their signs. Put abs() around each difference, then add." },
        { kind: "var", name: "retDry", equals: 1, label: "A* reports a path from (5, 1) to (0, 1)" },
        { kind: "var", name: "gDry", equals: 11, label: "g of the goal is 11: g adds up the cost of every step from the start", hint: "Gap 4. 1: newG is only the cost of the last step. Add it to the cost so far, g[cur]. 0: newG is still 0. 7 or 12: every step was counted as 1, use stepCost(row, col)." },
        { kind: "var", name: "costDry", equals: 11, label: "The path goes round through the dry gap: cost 11", hint: "12: the path goes through the mud, so g does not add up the real cost (gaps 2 and 4). -1: the stored path is not a chain of neighbouring free cells from goal to start (gap 5: the parent of next is cur; gap 6: step to parent[cur])." },
        { kind: "var", name: "expandedLine", min: 1, max: 8, label: "On the straight run along the bottom row, A* expands at most 8 cells", hint: "Gap 2. f must be g[i] plus the heuristic. Without the heuristic the search spreads over the whole floor. If it is there, check its arguments: the row of cell i is i / COLS and its column is i % COLS, in that order." },
        { kind: "var", name: "retMud", equals: 1, label: "With the dry gap closed there is still a path" },
        { kind: "var", name: "costMud", equals: 12, label: "It goes through the mud: cost 12", hint: "-1: the path is not stored correctly (gaps 5 and 6). Another number: g does not add up the step costs (gap 4)." },
        { kind: "var", name: "retBlocked", equals: 0, label: "With both gaps closed, A* returns 0: no path", hint: "Gap 3. The function's comment says what each return value means: 1 is \"found\"." },
      ],
      watch: ["hTest", "retDry", "gDry", "costDry", "expandedLine", "retMud", "costMud", "retBlocked"],
      hints: [
        "Gaps 1, 2 and 4 are one expression each, and each uses a function that is already there: abs(), heuristic(), stepCost(). If the run stops with \"This code never finishes\", the parents do not lead back to the start: look at gap 5.",
        "Gap 2 adds g[i] and the heuristic from cell i to (rowEnd, colEnd). Gap 4 adds the cost so far at cur and the cost of entering (row, col). Gap 3 must differ from the 1 that means found.",
        "Gap 1: `return abs(rowCurr - rowGoal) + abs(colCurr - colGoal);` Gap 2: `f = g[i] + heuristic(i / COLS, i % COLS, rowEnd, colEnd);` Gap 3: `return 0;` Gap 4: `newG = g[cur] + stepCost(row, col);` Gap 5: `parent[next] = cur;` Gap 6: `cur = parent[cur];`",
      ],
      takeaway: "The path with the fewest steps crossed the mud and cost 12. A* found the longer, cheaper one. An empty open set means the goal is unreachable: the caller must check the return value before it uses the path.",
    },
    {
      id: "map-log",
      kind: "calc",
      title: "Maths you need: the logarithm",
      goal: "Use the one property of the logarithm the robot's map depends on: it turns multiplying into adding.",
      refs: [{ course: "L24-25" }],
      brief: `
The last topic of this chapter is a map the robot builds itself. Its arithmetic needs one tool from beyond school algebra: the **logarithm**. This level is only about that tool.

Some quantities grow by **multiplying**: 1, 3, 9, 27, 81. The logarithm of a number says how many multiplying steps it is away from 1. On a ruler of logarithms those five numbers are evenly spaced.

The **natural logarithm**, written **ln**, counts steps of the factor e = 2.718..., a fixed number like pi. You never work it out by hand: a calculator has an \`ln\` key, and C has \`log()\`. What you need are its rules:

- **ln(a x b) = ln a + ln b.** Multiplying numbers adds their logarithms.
- **ln 1 = 0.** Multiplying by 1 changes nothing.
- A number above 1 has a positive logarithm, a number between 0 and 1 a negative one: ln(1 / a) = -ln a.
- **exp()** undoes ln: exp(ln a) = a. It is written e^x, it is the \`e^x\` key, and \`exp()\` in C.

**Worked example.** ln 2 = 0.693 and ln 3 = 1.099. Their sum is 1.792, and that is ln 6, because 2 x 3 = 6. Going back: exp(1.792) = 6.

Try pairs in the figure, also 1/4 times 4.

{{figure:math-log}}

Why the robot cares: its map multiplies a number by a factor for every LIDAR beam, thousands of times. With logarithms each of those is one addition, and the stored numbers stay small.

## The exercise
Use these values: ln 2 = 0.693, ln 3 = 1.099, ln 9 = 2.197. The rules are enough: no calculator needed.
`,
      fields: [
        { id: "ln18", label: "ln 18", answer: 2.89, tolPct: 1, why: "18 = 2 x 9, so ln 18 = ln 2 + ln 9 = 0.693 + 2.197 = 2.890." },
        { id: "ln4", label: "ln 4", answer: 1.386, tolPct: 1, why: "4 = 2 x 2, so ln 4 = 0.693 + 0.693 = 1.386." },
        { id: "lnq", label: "ln 0.25 (0.25 is 1 / 4)", answer: -1.386, tolPct: 1, why: "ln(1 / 4) = -ln 4 = -1.386. Numbers below 1 have negative logarithms." },
        { id: "ln81", label: "ln 81", answer: 4.394, tolPct: 1, why: "81 = 9 x 9, so ln 81 = 2.197 + 2.197 = 4.394." },
        { id: "exp", label: "exp(4.394), also written e^4.394", answer: 81, tolPct: 1, why: "exp undoes ln, and ln 81 = 4.394. So exp(4.394) = 81." },
      ],
      hints: [
        "Write each number as a product of 2s, 3s and 9s, then add the logarithms of the factors.",
        "18 = 2 x 9. 4 = 2 x 2. 81 = 9 x 9. And 1 / 4 has the logarithm of 4 with a minus sign.",
        "The last field needs no arithmetic: exp() takes you back from a logarithm to its number, and you just found the number whose logarithm is 4.394.",
      ],
      takeaway: "ln turns a product into a sum, and exp turns the sum back. ln 1 = 0, numbers above 1 are positive, numbers below 1 negative.",
    },
    {
      id: "map-logodds",
      kind: "calc",
      title: "Log-odds",
      goal: "Convert between probability and log-odds and apply the occupancy update by hand.",
      refs: [{ course: "L24-25" }],
      brief: `
The maps so far were given. A robot that builds its own map keeps, for every cell, a **probability** p that the cell is occupied. A probability is a number from 0 (certainly not) to 1 (certainly): 0.5 means "no idea", near 1 is a wall, near 0 is free floor. Such a map is an **occupancy grid**, and every LIDAR beam corrects it.

## Odds
The same belief can be written as **odds**: how many times more likely "occupied" is than "free".

odds = p / (1 - p)

p = 0.8 gives 0.8 / 0.2 = 4, "four to one". p = 0.5 gives 1, an even chance. p = 0.2 gives 0.25.

Odds are handy because new evidence simply **multiplies** them: a reading that speaks 9 to 1 for a wall multiplies the cell's odds by 9.

## Log-odds
Thousands of multiplications are slow, and the numbers run away towards 0 or become huge. So the map stores the logarithm of the odds, the **log-odds** l, and adds:

l = ln( p / (1 - p) )

p = 0.5 gives l = ln 1 = 0. Positive means probably occupied, negative probably free. The way back to a probability is

p = 1 - 1 / (1 + e^l)

Taking in one measurement is one addition:

l_new = l_old + l_sensor - l_0

- l_sensor is the log-odds of what the sensor just said about the cell,
- l_0 is the log-odds of the belief before any measurement, the **prior**. With a prior of 0.5, l_0 = 0.

**Worked example.** The sensor says "occupied with p = 0.8": odds 4, l_sensor = ln 4 = 1.386. A cell at l = 0 goes to 1.386 after one such beam and to 2.772 after two. Back to a probability: e^2.772 = 16, so p = 1 - 1 / 17 = 0.941.

The figure does this for one cell, with 0.8 for a hit and 0.3 for a pass-through. Send beams and watch the log-odds add up while the probability follows.

{{figure:log-odds}}

## The exercise
A cell starts at p = 0.5. This sensor is surer of itself. When the beam **ends** in a cell (a hit), the cell is occupied with p = 0.9. When the beam **passes through** a cell, it is occupied with p = 0.2.

You need: ln 9 = 2.197, ln 0.25 = -1.386, e^4.394 = 81, e^3.008 = 20.25.
`,
      fields: [
        { id: "locc", label: "l_sensor for a hit (p = 0.9)", answer: 2.197, tolPct: 1, why: "ln(0.9 / 0.1) = ln 9 = 2.197." },
        { id: "lfree", label: "l_sensor for a pass-through (p = 0.2)", answer: -1.386, tolPct: 1, why: "ln(0.2 / 0.8) = ln 0.25 = -1.386. Negative: evidence for free." },
        { id: "l2", label: "Log-odds of the cell after two hits", answer: 4.394, tolPct: 1, why: "0 + 2.197 + 2.197 = 4.394 (l_0 = 0)." },
        { id: "p2", label: "Probability after two hits", answer: 0.988, tolPct: 0.3, why: "e^4.394 = 81, so p = 1 - 1/82 = 0.988." },
        { id: "l3", label: "Log-odds after two hits and one pass-through", answer: 3.008, tolPct: 1, why: "4.394 - 1.386 = 3.008." },
        { id: "p3", label: "Probability after two hits and one pass-through", answer: 0.953, tolPct: 0.3, why: "e^3.008 = 20.25, so p = 1 - 1/21.25 = 0.953. One contrary reading lowers the belief and does not erase it." },
      ],
      hints: [
        "Odds are p / (1 - p): 0.9 gives 0.9 / 0.1 = 9, and 0.2 gives 0.2 / 0.8 = 0.25. Their logarithms are in the list at the end of the brief.",
        "Updates add. With l_0 = 0 the cell's log-odds is the sum of all l_sensor values: two hits are 2.197 + 2.197.",
        "For the probability use p = 1 - 1 / (1 + e^l) with e^4.394 = 81 and e^3.008 = 20.25: 1 - 1 / 82 and 1 - 1 / 21.25.",
      ],
      takeaway: "In log-odds, evidence adds. A cell needs several agreeing beams to become certain and several contrary ones to change its mind.",
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

Write \`look_and_plan()\`. \`main\` calls it three times and changes the scene in between, so start every call from scratch.

## 1. Read the scene
A colour only counts when it is strong: saturation of **50 or more**.

- **Orange**, hue 15 to 45: the target, one cell. Store its position in \`targetRow\` and \`targetCol\`, or -1 in both if there is none.
- **Blue**, hue 200 to 260: an obstacle.

Everything else is free floor: grey, yellow tape, a red cone, pale wood and a pale blue reflection are in the picture to test your thresholds. "Hue 15 to 45" is two comparisons joined with \`&&\`, as in "Find the ball".

Fill \`map[]\` with \`'x'\` for obstacles and \`'0'\` for free cells, and count the obstacles in \`numObstacles\`.

## 2. Plan
Store the length of the shortest 4-connected path from the robot to the target in \`steps\`, or -1 if there is no target or no path. This is the job of your \`bfs()\` from the level "Breadth-first search": paste it and \`canTravel()\` where the comment says. They work unchanged, because \`ROWS\`, \`COLS\`, \`map\`, \`queue\` and \`dist\` exist here too.

## 3. Report
Switch **LED1** on if a path exists and off if not. Its pin is already set up as an output.

\`\`\`c
GpioDataRegs.GPASET.bit.GPIO22 = 1;      // on
GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;    // off
\`\`\`
`,
      kit: "robot",
      durationMs: 40,
      starter: sceneProgram(`// Paste canTravel() and bfs() from the level "Breadth-first search" here.

// 1. read the scene  2. plan  3. report
void look_and_plan(void)
{
}`),
      solution: sceneProgram(`int canTravel(int row, int col)
{
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        return 0;
    }
    if (map[row * COLS + col] == 'x') {
        return 0;
    }
    return 1;
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
}

void look_and_plan(void)
{
    int i;

    targetRow = -1;
    targetCol = -1;
    numObstacles = 0;
    steps = -1;
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

    if (targetRow >= 0) {
        steps = bfs(START_ROW, START_COL, targetRow, targetCol);
    }
    if (steps >= 0) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }
}`),
      checks: [
        { kind: "var", name: "row1", equals: 0, label: "Scene 1: the target is in row 0", hint: "-1: no cell passed the orange test (hue 15 to 45 and saturation at least 50), or targetRow was never set. The row of cell i is i / COLS. 1: the pale wood was taken for the target, check the saturation." },
        { kind: "var", name: "col1", equals: 6, label: "Scene 1: the target is in column 6", hint: "The pale wood at (1, 1) has an orange hue and a saturation of only 20." },
        { kind: "var", name: "obstacles1", equals: 10, label: "Scene 1: the map has 10 obstacle cells", hint: "11: the pale blue reflection is not an obstacle. Fewer: both shades of blue (hue 205 and 225) count." },
        { kind: "var", name: "steps1", equals: 13, label: "Scene 1: the shortest path has 13 steps", hint: "11 is the distance without obstacles. The path has to go round the blue boxes." },
        { kind: "led", led: "LED1", at: 5, on: true, label: "Scene 1: LED1 is on, a path was found", hint: "Switch the LED on with GPASET when steps is 0 or more." },
        { kind: "var", name: "row2", equals: 1, label: "Scene 2: the target is now in row 1", hint: "Start every call from scratch: the old target is gone." },
        { kind: "var", name: "col2", equals: 4, label: "Scene 2: the target is in column 4", hint: "The column of cell i is i % COLS. Start every call from scratch." },
        { kind: "var", name: "obstacles2", equals: 9, label: "Scene 2: 9 obstacle cells", hint: "Set numObstacles to 0 at the start of every call." },
        { kind: "var", name: "steps2", equals: 8, label: "Scene 2: the shortest path has 8 steps", hint: "A blue box was taken away: write '0' into map[] for every cell that is not an obstacle, so that old 'x' marks do not stay." },
        { kind: "var", name: "obstacles3", equals: 11, label: "Scene 3: 11 obstacle cells", hint: "Fix scenes 1 and 2 first. A count that keeps growing means numObstacles is not set to 0 at the start of every call." },
        { kind: "var", name: "steps3", equals: -1, label: "Scene 3: the target is closed in, steps is -1", hint: "bfs() returns -1 when the queue runs empty. Store what it returns in steps." },
        { kind: "led", led: "LED1", at: 35, on: false, label: "Scene 3: LED1 is off, there is no path", hint: "Switch the LED off with GPACLEAR when steps is -1." },
      ],
      watch: ["targetRow", "targetCol", "numObstacles", "steps", "steps1", "steps2", "steps3"],
      hints: [
        "One loop over the 48 cells does step 1: reset the results, then test the saturation first and the two hue ranges after it.",
        "Then `if (targetRow >= 0) steps = bfs(START_ROW, START_COL, targetRow, targetCol);` and set or clear GPIO22 on `steps >= 0`.",
        "If you no longer have your BFS: set dist[] to -1, put the start in queue[] with dist 0, then `while (head < tail)` take `cur = queue[head]; head++;`, return dist[cur] at the goal, and for the four neighbours that canTravel and have dist -1 set dist to dist[cur] + 1 and append them. Return -1 after the loop.",
      ],
      takeaway: "Perception turns pixels into a map and a goal. Planning turns the map and the goal into a path. The robot's software has the same two halves.",
    },
    {
      id: "vis-hsl-calc",
      kind: "calc",
      tier: "practice",
      title: "The same ball, lit and in shadow",
      goal: "Convert three pixels from RGB to HSL by hand and see what a shadow changes.",
      refs: [{ course: "L17" }],
      brief: `
The camera gives R, G and B. The colour test needs H, S and L. Here you do that conversion by hand, the way \`rgb_to_hsl\` does it.

Three pixels, with R, G, B already divided by 255, so each is between 0 and 1:

- **Pixel 1**, the orange ball in the light: R = 0.8, G = 0.4, B = 0.0
- **Pixel 2**, the same ball in a shadow, every channel halved: R = 0.4, G = 0.2, B = 0.0
- **Pixel 3**, the blue ball: R = 0.2, G = 0.4, B = 0.8

## The formulas
Let max and min be the largest and smallest of R, G, B, and d = max - min. A grey pixel has d = 0. The more colourful the pixel, the further its channels are apart.

- **Lightness** is halfway between the brightest and the darkest channel: L = (max + min) / 2
- **Saturation** compares the spread d with the largest spread that is possible at this lightness: S = d / (1 - |2L - 1|). The bars mean the **absolute value**: the number without its sign, so |-0.2| is 0.2 and |0.2| is 0.2.
- **Hue** starts at the angle of the largest channel (red 0, green 120, blue 240) and leans up to 60 degrees towards the stronger of the other two:
  - R largest: H = 60 x (G - B) / d
  - G largest: H = 60 x ((B - R) / d + 2)
  - B largest: H = 60 x ((R - G) / d + 4)

H is in degrees. If it comes out negative, add 360.

**Worked example**, R = 0.6, G = 0.9, B = 0.3: max = 0.9 (green), min = 0.3, d = 0.6. L = (0.9 + 0.3) / 2 = 0.6. S = 0.6 / (1 - |1.2 - 1|) = 0.6 / 0.8 = 0.75. G is the largest: H = 60 x ((0.3 - 0.6) / 0.6 + 2) = 60 x 1.5 = 90, a yellowish green.

Work out the fields, then compare pixel 1 and pixel 2.
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
        "Pixel 3 has L = 0.5, so 1 - |2L - 1| is 1 and S is simply d.",
        "Pixel 3: (R - G) / d = -0.2 / 0.6 = -0.333, plus 4 is 3.667, times 60.",
      ],
      takeaway: "The shadow halved R and L, and left H at 30 degrees. That is why you threshold on hue. The figure in the briefing computes these formulas for any pixel.",
    },
    {
      id: "vis-rgb2hsl",
      kind: "code",
      mode: "complete",
      tier: "practice",
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
        "The saturation is one line with `fabs()`; the lightness is already in `*l`. The hue is an if / else if / else on which channel equals `hi`.",
        "`*s = d / (1.0f - fabs(2.0f * (*l) - 1.0f));` then `if (hi == r) { *h = 60.0f * ((g - b) / d); } else if (hi == g) { ... + 2.0f ... } else { ... + 4.0f ... }` and `if (*h < 0.0f) *h = *h + 360.0f;`",
      ],
      takeaway: "The lit and the shadowed ball differ in lightness (0.5 and 0.2) and share hue 30. Red sits at both ends of the hue circle, which matters in the level \"Red is at both ends\".",
    },
    {
      id: "vis-intdiv",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "The centroid that snaps to whole pixels",
      goal: "The robot steers in steps. Find out why the centroid loses its fraction.",
      refs: [{ course: "L17" }, { course: "HW5" }],
      brief: `
This version works on a finished mask and keeps the moments in integers, which is sensible: they are counts and sums of whole numbers.

The ball's centroid should be at column **7.5**, row **3.29**. The program reports column 7, row 3, and the turn command is 0.5 where it should be 0.75. On the robot this shows as steering that moves in jumps: the command only changes when the centroid crosses a whole pixel.

\`cx\` and \`cy\` are floats. So where does the fraction go?

In C, the type of a division is decided by its **operands**, not by the variable that receives the result. Look at the two divisions.

\`main\` measures the mask twice: as shown, and mirrored left to right.
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
        { kind: "var", name: "cx1", ...range(7.5), label: "Centroid column is 7.5", hint: "7 means the division was done in integers: 105 / 14 = 7 remainder 7." },
        { kind: "var", name: "cy1", ...range(3.2857), label: "Centroid row is about 3.29" },
        { kind: "var", name: "turn1", ...range(0.75), label: "turn is 0.75" },
        { kind: "var", name: "area1", equals: 14, label: "The area is still 14" },
        { kind: "var", name: "cx2", ...range(3.5), label: "Mirrored mask: centroid column is 3.5" },
        { kind: "var", name: "turn2", ...range(-1.25), label: "Mirrored mask: turn is -1.25" },
      ],
      watch: ["area1", "cx1", "cy1", "turn1", "cx2", "turn2"],
      hints: [
        "`m10` and `m00` are both `uint16_t`. What does 105 / 14 give in integer arithmetic?",
        "The division is finished, and truncated, before the result is converted to float for `cx`.",
        "Convert an operand first: `cx = (float)m10 / (float)m00;` and the same for `cy`. Declaring the sums as float also works.",
      ],
      takeaway: "int / int is an int, whatever it is assigned to. Cast before dividing. On this chip also remember that a 16-bit sum of column numbers overflows on a full-size image: 640 x 480 needs 32-bit or float sums.",
    },
    {
      id: "vis-bayer",
      kind: "calc",
      tier: "practice",
      title: "Counting Bayer pixels",
      goal: "Count the colour sites of a Bayer sensor and demosaic one pixel by averaging its neighbours.",
      refs: [{ course: "L17" }],
      brief: `
So far every pixel came with R, G and B. The sensor does not deliver that. A camera pixel measures brightness only, so each one sits behind a red, a green or a blue filter and measures just that colour. The layout of the filters is the **Bayer** pattern.

A 640 x 480 sensor has 307200 pixels. The pattern repeats this 2 x 2 block:

\`\`\`
G R
B G
\`\`\`

So a **red** pixel (a red "site") has green neighbours above, below, left and right, and blue neighbours on its four diagonals.

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

Fix the test. Keep the saturation requirement for the whole range: the grey floor has hue 0 by convention, a pale pink reflection has hue 350, and only their low saturation keeps them out of the mask. The image also holds an orange ball (hue 30) and a magenta marker (hue 320), which must stay out.

\`main\` runs the search twice. The second time glare has washed out the cone's left edge.
`,
      kit: "robot",
      durationMs: 5,
      starter: redProgram("hue[i] >= H_MIN && hue[i] <= H_MAX && sat[i] >= S_MIN"),
      solution: redProgram("(hue[i] >= H_MIN || hue[i] <= H_MAX) && sat[i] >= S_MIN"),
      checks: [
        { kind: "var", name: "area1", equals: 12, label: "The mask holds the 12 pixels of the red cone", hint: "0: no hue is both above 340 and below 20. More than 12: the floor or the pale reflection got in, so the saturation test must apply to both halves of the range." },
        { kind: "var", name: "cx1", ...range(3.5), label: "Centroid column is 3.5" },
        { kind: "var", name: "cy1", ...range(2), label: "Centroid row is 2" },
        { kind: "var", name: "area2", equals: 9, label: "With column 2 washed out, 9 pixels are left", hint: "12 or more: pixels with a red hue and too little saturation are still accepted." },
        { kind: "var", name: "cx2", ...range(4), label: "Their centroid column is 4" },
      ],
      watch: ["area1", "cx1", "cy1", "area2", "cx2"],
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
The ball is in the top right corner of the image: columns 8 to 11, rows 1 and 2. Its centroid should be at column **9.5**, row **1.5**, and the turn command should be positive (turn right).

The program reports the centroid at column 1.5, row 9.5, in an image that has only 8 rows. The robot turns left, away from the ball.

An image has two axes and it is easy to cross them:

- **x** runs along a row, so x is the **column** number. M10 sums x.
- **y** runs down the image, so y is the **row** number. M01 sums y.

Find where they are swapped. \`main\` measures the mask twice: as shown, and mirrored left to right.
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
        { kind: "var", name: "cx1", ...range(9.5), label: "Centroid column is 9.5" },
        { kind: "var", name: "cy1", ...range(1.5), label: "Centroid row is 1.5" },
        { kind: "var", name: "turn1", ...range(1.75), label: "turn is 1.75: turn right, towards the ball" },
        { kind: "var", name: "cx2", ...range(1.5), label: "Mirrored mask: centroid column is 1.5" },
        { kind: "var", name: "cy2", ...range(1.5), label: "Mirrored mask: centroid row is still 1.5" },
        { kind: "var", name: "turn2", ...range(-2.25), label: "Mirrored mask: turn is -2.25, to the left" },
      ],
      watch: ["cx1", "cy1", "turn1", "cx2", "cy2", "turn2"],
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

A **stack** is the opposite of a queue: the element added last comes out first, like a pile of plates. For a flood fill the order does not matter, and a stack needs one index only.

## Write find_blobs()
- \`numRaw\`: the number of blobs of any size.
- \`numBlobs\`: the number of blobs with **at least** \`MIN_AREA\` pixels (6 here: the smaller object just passes).
- \`bestArea\`, \`bestCx\`, \`bestCy\`: area and centroid (column, row) of the largest blob.

The mask has two real objects and three specks of noise, one of which touches the big object at a corner. \`main\` calls your function twice, the second time with one more pixel set, so clear \`label[]\` and the counters at the start.
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
        { kind: "var", name: "numRaw1", equals: 5, label: "5 blobs in total: two objects and three specks", hint: "4: a pixel that touches only at a corner is a blob of its own. Many more: label pixels when you push them." },
        { kind: "var", name: "numBlobs1", equals: 2, label: "2 blobs pass the area filter", hint: "1: a blob of exactly MIN_AREA pixels passes. The test is 'at least'." },
        { kind: "var", name: "bestArea1", equals: 10, label: "The largest blob has 10 pixels", hint: "11: the pixel at (4, 5) touches the blob only at a corner. With 4-connectivity it is not part of it." },
        { kind: "var", name: "bestCx1", ...range(2.2), label: "Its centroid column is 2.2" },
        { kind: "var", name: "bestCy1", ...range(2.1), label: "Its centroid row is 2.1" },
        { kind: "var", name: "numRaw2", equals: 4, label: "With a pixel added at (4, 4): 4 blobs, a speck has joined the big one", hint: "Clear label[] and the counters at the start of find_blobs." },
        { kind: "var", name: "bestArea2", equals: 12, label: "The largest blob now has 12 pixels" },
        { kind: "var", name: "bestCx2", ...range(2.5833), label: "Its centroid column is about 2.58" },
        { kind: "var", name: "bestCy2", ...range(2.4167), label: "Its centroid row is about 2.42" },
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
      id: "vis-depth",
      kind: "calc",
      tier: "practice",
      title: "How far away is it?",
      goal: "Compute distance from the apparent size of a known object and from the disparity between two cameras.",
      refs: [{ course: "L17" }, { course: "L22-23" }],
      brief: `
The centroid says where the ball is in the image, not how far away it is. One camera loses depth: every point along a line of sight lands on the same pixel. Either of two extra facts brings the distance back.

## A known size
A pinhole camera makes similar triangles. An object of real width W at distance Z appears w pixels wide:

w = f x W / Z, and turned around, Z = f x W / w

f is the **focal length in pixels**, a constant of the camera found once by calibration. Twice as far, half as wide. The blob **area** the camera reports falls with the square of the distance, because width and height both shrink.

## A second camera
Two cameras side by side, a distance B apart (the **baseline**), see the same point in slightly different columns. The difference in columns is the **disparity** d. Near things shift a lot between the two images, far things hardly at all:

Z = f x B / d

## The exercise
Both cameras have f = 200 pixels. A golf ball is 43 mm wide. The stereo pair has a baseline of 60 mm.
`,
      fields: [
        { id: "z1", label: "The ball appears 20 pixels wide. Distance Z", unit: "mm", answer: 430, tolPct: 1, why: "Z = f x W / w = 200 x 43 / 20 = 430 mm." },
        { id: "w2", label: "Width of the ball in the image at 860 mm", unit: "pixels", answer: 10, tolPct: 1, why: "w = 200 x 43 / 860 = 10 pixels. Twice the distance, half the width." },
        { id: "a2", label: "The blob has 300 pixels at 430 mm. Area at 860 mm", unit: "pixels", answer: 75, tolPct: 2, why: "Width and height both halve, so the area drops to a quarter: 300 / 4 = 75." },
        { id: "z3", label: "Stereo: a point has a disparity of 8 pixels. Distance Z", unit: "mm", answer: 1500, tolPct: 1, why: "Z = f x B / d = 200 x 60 / 8 = 1500 mm." },
        { id: "d4", label: "Disparity of a point 3000 mm away", unit: "pixels", answer: 4, tolPct: 1, why: "d = f x B / Z = 200 x 60 / 3000 = 4 pixels." },
        { id: "z5", label: "That point is matched one pixel off, d = 3. Distance the robot computes", unit: "mm", answer: 4000, tolPct: 1, why: "Z = 200 x 60 / 3 = 4000 mm: one pixel of error moved the point by a whole metre. Stereo depth is precise nearby and rough far away." },
      ],
      hints: ["Keep the units apart: f, w and d are in pixels, W, B and Z in millimetres.", "Area is width times height, and both scale with 1 / Z.", "Z = 200 x 43 / w for the ball, Z = 200 x 60 / d for the stereo pair."],
      takeaway: "Size and disparity both shrink as 1 / Z, so both methods lose precision with distance. For a ball on the floor there is a third way: the further away it is, the higher it sits in the image, so a table of measured rows and distances works too.",
    },
    {
      id: "plan-bug",
      kind: "quiz",
      tier: "practice",
      title: "Planning without a map: the Bug algorithms",
      goal: "Compare Bug 0, Bug 1 and Bug 2, the planners that only need to feel the obstacle in front of them.",
      refs: [{ course: "L18" }, { course: "L14" }],
      brief: `
BFS and A* need a map. A **Bug algorithm** needs none: only the position of the goal and a sensor that feels the obstacle the robot is touching. Your wall follower is the second half of one already.

All three drive **straight towards the goal** until an obstacle is in the way, then follow its edge. They differ in when they let go of it.

- **Bug 0**: leave as soon as the way towards the goal is free again. Simple, and inside a C-shaped obstacle it can circle forever.
- **Bug 1**: go **all the way round** the obstacle and remember the point of the edge that was closest to the goal. Go back to that point and leave from there. In the worst case the robot drives one and a half times round every obstacle.
- **Bug 2**: remember the straight line from the start to the goal, the **m-line**. Follow the edge until you cross the m-line again at a point closer to the goal than where you hit the obstacle, then carry on along the line. Usually shorter than Bug 1. On a winding obstacle it can meet the same edge several times.

Bug 1 and Bug 2 are **complete**: they reach the goal whenever a path exists, and they notice when none does. None of the three finds the shortest path, because they know only what they have touched.
`,
      questions: [
        {
          prompt: "What do the Bug algorithms need that the robot always has, and what do they do without?",
          options: [
            "They need a full map and do without sensors",
            "They need the goal's position and a local obstacle sensor, and do without a map",
            "They need a heuristic and do without a goal",
            "They need a camera and do without wheels",
          ],
          answer: 1,
          why: "A bug drives at the goal and follows whatever it bumps into. It never stores the obstacles.",
        },
        {
          prompt: "A robot drives once round the whole obstacle, then returns to the point of the edge nearest the goal and leaves. Which algorithm is it running?",
          options: ["Bug 0", "Bug 1", "Bug 2", "A*"],
          answer: 1,
          why: "Bug 1 surveys the complete edge before it decides where to leave.",
        },
        {
          prompt: "When does Bug 2 leave an obstacle?",
          options: [
            "As soon as it can see the goal",
            "After one full lap",
            "When it crosses the start-to-goal line again, closer to the goal than where it hit the obstacle",
            "After a fixed time",
          ],
          answer: 2,
          why: "The m-line is its only memory. The condition 'closer than the hit point' keeps it from going back and forth.",
        },
        {
          prompt: "The goal is 10 ft away in a straight line. One obstacle with an edge 8 ft long is in the way. What is the longest path Bug 1 can need?",
          options: ["10 ft", "18 ft", "22 ft", "26 ft"],
          answer: 2,
          why: "The straight distance plus one and a half laps: 10 + 1.5 x 8 = 22 ft. One lap to survey, up to half a lap to return to the best point.",
        },
        {
          prompt: "The course floor is known in advance. Why plan with A* and not with a bug?",
          options: [
            "A* needs no map",
            "With a map, A* finds the shortest path before the robot moves. A bug finds some path by driving it",
            "Bugs cannot follow walls",
            "A* needs no goal",
          ],
          answer: 1,
          why: "Use what you know. A bug is the fallback when the map is missing or wrong, for example when a new obstacle blocks the planned path.",
        },
      ],
      hints: ["Ask of each bug: what does it remember while it follows the edge?", "Bug 0 nothing, Bug 1 the closest point of the whole edge, Bug 2 the line from start to goal."],
      takeaway: "A bug is goal seeking plus wall following. It trades path length for needing no map, which makes it a good partner for a planner whose map can be out of date.",
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
- **Dijkstra**: the one with the smallest cost so far, g. Shortest path for any non-negative step costs. It explores in all directions.
- **Greedy best-first**: the one with the smallest estimate to the goal, h. Fast, and easily led into a dead end. The path is not guaranteed to be the shortest.
- **A***: the one with the smallest f = g + h. Shortest path whenever h is **admissible** (never more than the true remaining cost), usually with far fewer expansions than Dijkstra.

Two limits explain how they relate. With h = 0 everywhere, A* **is** Dijkstra. With a heuristic that is much too large, g hardly matters and A* behaves like greedy search.

One condition is stricter than admissible. Code that never reopens a closed cell, like this chapter's, also needs a **consistent** heuristic: from a cell to its neighbour, h may not drop by more than the step costs. The Manhattan and Euclidean distances are consistent.

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
      takeaway: "The goal test happens when a cell leaves the open set, not when it is first seen. Only then is its cost known to be the smallest. The course's planner stops as soon as the goal shows up as a neighbour, which is safe there because every step costs 1.",
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

Fix \`heuristic()\` so that it is admissible. The rest of the code is correct. \`main\` also plans a second route, from (3, 2) to (2, 6).
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
        { kind: "var", name: "steps", equals: 11, label: "(5, 0) to (0, 6): the path is a shortest one, 11 steps", hint: "15 steps: the heuristic still overestimates. 3 rows and 4 columns away it must not say more than 7." },
        { kind: "var", name: "steps2", equals: 7, label: "(3, 2) to (2, 6): 7 steps", hint: "9 steps: the heuristic still overestimates." },
      ],
      bonus: [
        { kind: "var", name: "expandedFirst", min: 1, max: 27, label: "Still well guided: at most 27 cells expanded on the first route", hint: "A heuristic of 0 or the straight-line distance is admissible but further from the truth, so more cells are expanded. On a 4-connected grid the Manhattan distance is the largest estimate that never overestimates." },
      ],
      watch: ["retValue", "steps", "steps2", "expandedFirst"],
      hints: [
        "3 rows and 4 columns away, the code returns 9 + 16 = 25. No path needs 25 steps.",
        "An estimate that is never above the true cost works: the real Euclidean distance with sqrt(), or the Manhattan distance, which is closer to the truth.",
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
This BFS should find the 9-step path from (0, 0) to (4, 5) on the map you know, and then the 8-step path to (0, 4). It returns **-1**, "no path", both times.

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
int lenFar = -2;        // to (4, 5)
int lenRound = -2;      // to (0, 4)`,
        main: `    lenFar = bfs(0, 0, 4, 5);
    lenRound = bfs(0, 0, 0, 4);`,
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
int lenFar = -2;        // to (4, 5)
int lenRound = -2;      // to (0, 4)`,
        main: `    lenFar = bfs(0, 0, 4, 5);
    lenRound = bfs(0, 0, 0, 4);`,
        body: BFS_SOLUTION_BODY.replace("                    tail++;\n                }", "                    tail++;\n                    pushes++;\n                }").replace(
          "if (dist[next] == -1) {",
          "if (dist[next] == -1 && tail < 200) {",
        ),
      }),
      checks: [
        { kind: "var", name: "lenFar", equals: 9, label: "(0, 0) to (4, 5): 9 steps" },
        { kind: "var", name: "lenRound", equals: 8, label: "(0, 0) to (0, 4): 8 steps" },
        { kind: "var", name: "pushes", max: 82, label: "No cell enters the queue twice (at most 41 pushes per search)", hint: "Only push a neighbour whose dist is still -1." },
      ],
      watch: ["pushes", "lenFar", "lenRound"],
      hints: [
        "pushes reaches 199: the queue is full of repeats long before the search gets 9 steps away.",
        "A neighbour that already has a distance has been reached before, along a path at least as short.",
        "Wrap the push in `if (dist[next] == -1)`, or add that test to the existing `if`.",
      ],
      takeaway: "Without a visited mark a graph search re-expands the same cells without end. In BFS the first visit is also the shortest, so later visits are pure waste.",
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
      title: "SLAM in three ideas",
      goal: "Check the ideas behind scan matching, Monte Carlo localisation and loop closure.",
      refs: [{ course: "L24-25" }],
      brief: `
Mapping needs to know where the robot is. Finding out where the robot is (**localisation**) needs a map. Doing both at once is **SLAM**, simultaneous localisation and mapping.

The robot's **pose** is its position and the direction it faces. It can estimate its pose by adding up how far its wheels have turned, which is called **odometry**. That alone will not do: every small error is added to the next pose and never taken out again. Three ideas from the lecture, in outline.

## Scan matching (ICP)
Two LIDAR scans taken a moment apart show the same walls, shifted and turned by the robot's own motion. **Iterative closest point** recovers that motion: pair every point of the new scan with the nearest point of the old one, compute the turn and the shift that bring the pairs together, apply them, and repeat until nothing moves. It needs a starting guess that is roughly right (odometry gives one), and it commits to a single answer.

## Monte Carlo localisation
When the robot could be in several places, keep many guesses, called **particles**. Each is one possible pose.

1. **Start.** With no idea at all the belief is **uniform**: every pose is equally likely. If there are |X| possible poses (|X| is just their number), each has probability 1 / |X|, so that all of them together add up to 1.
2. **Move.** Every particle is moved as the odometry says, plus a little random noise.
3. **Weigh.** If the robot were at this pose, how well would the scan it just took match the map?
4. **Resample.** Draw a new set, with a chance proportional to the weight. Good guesses are copied, poor ones disappear.

## Pose graph and loop closure
Scan matching still drifts over a long drive. A **pose graph** stores the robot's poses as nodes, joined by edges that say "this pose is this far from that one", like springs. When the robot recognises a place it has been before, this **loop closure** adds a spring between two poses that are far apart in time, and a program called an optimiser spreads the collected error over the whole loop.
`,
      questions: [
        {
          prompt: "What does one round of ICP do?",
          options: [
            "It draws new particles",
            "It pairs each point with its nearest neighbour in the other scan and computes the rotation and shift that best align the pairs",
            "It adds log-odds to the map",
            "It measures the wheel speeds",
          ],
          answer: 1,
          why: "Closest points, then the best turn and shift for those pairs. The pairs improve as the scans come closer, which is why it iterates.",
        },
        {
          prompt: "ICP is started with a guess that is 90 degrees wrong in a square room. What is the likely result?",
          options: [
            "It still finds the true motion",
            "It settles on a wrong alignment that looks good locally, and it cannot tell",
            "It reports an error",
            "It runs forever",
          ],
          answer: 1,
          why: "ICP only improves the guess it was given. In a symmetric room a turned scan fits the walls just as well. This is why a filter with many hypotheses is used to recover.",
        },
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
          prompt: "Why is noise added when the particles are moved?",
          options: [
            "To make the program slower",
            "Because the wheels slip and odometry is uncertain, so the true motion is not exactly the measured one",
            "Because the LIDAR is noisy",
            "To keep the particles on the grid",
          ],
          answer: 1,
          why: "The spread of the particles must cover where the robot could really be after the move, or the true pose is lost.",
        },
        {
          prompt: "After a long loop through the building the robot is back at its start, but its map shows the first corridor twice, side by side. What repairs the map?",
          options: [
            "A finer grid",
            "A loop closure: an edge between the first and the last pose, after which the optimiser corrects all poses in between",
            "More particles",
            "A faster LIDAR",
          ],
          answer: 1,
          why: "The doubled wall is drift that built up round the loop. Knowing that the two ends are the same place tells the robot how large the drift was, and the pose graph spreads the correction.",
        },
      ],
      hints: ["ICP gives one answer, particles keep many, the pose graph fixes the past.", "Count poses: positions times headings."],
      takeaway: "Scan matching tracks the motion from one scan to the next, particles recover when the robot is lost, and loop closure removes the drift that both leave behind.",
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
      bonus: [
        { kind: "var", name: "expandedOpen", min: 1, max: 13, label: "The tightest heuristic: at most 13 cells expanded", hint: "The straight-line distance and the larger of dr and dc are admissible too, but smaller than the true cost on an empty grid, so they expand more cells." },
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
      goal: "Label the blobs of a mask in two row-by-row scans with an equivalence table, without a stack or a queue.",
      refs: [{ course: "L17" }],
      brief: `
A flood fill (the practice level "Blobs and the area filter") jumps around the image and needs a stack as large as the biggest blob. A camera delivers pixels row by row, and the classic way to label blobs in that order needs only the row above. It is the **two-pass** algorithm.

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

The mask has four shapes, chosen so that three of them need a merge. \`main\` labels it twice, the second time with one more pixel that joins two shapes.
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
        { kind: "var", name: "numBlobs1", equals: 4, label: "4 blobs are found", hint: "8: the provisional labels were counted. Count only the roots of the equivalence table." },
        { kind: "var", name: "labelsOk1", equals: 1, label: "Touching pixels share a label, separate shapes have different labels", hint: "Run pass 2 over the whole image: both arms of the U must end with the same label." },
        { kind: "var", name: "numBlobs2", equals: 3, label: "With a pixel added that joins two shapes: 3 blobs", hint: "Start every call with an empty table and label 1." },
        { kind: "var", name: "labelsOk2", equals: 1, label: "The two joined shapes now share one label" },
        { kind: "source", mustNotMatch: "\\b(stack|queue)\\b", label: "No stack and no queue" },
      ],
      watch: ["numBlobs1", "labelsOk1", "numBlobs2", "labelsOk2"],
      hints: [
        "Pass 1 needs `up = label[i - COLS]` (if row > 0) and `left = label[i - 1]` (if col > 0), then the four cases.",
        "When both neighbours are labelled, take the roots of both. If they differ, set the parent of the larger root to the smaller one.",
        "Pass 2: `label[i] = find_root(label[i]);` for every labelled pixel. Then count the labels x with `parent[x] == x`.",
      ],
      takeaway: "Two sequential passes and a small table do the work of a flood fill. This is the form used on streaming hardware, where pixels arrive once, in order.",
    },
  ],
};
