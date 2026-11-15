import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { preview, type PreviewServer } from "vite";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The wiring bench of the Sandbox's homework board, through the real
// interface: once with the keyboard only, once with the mouse. A program
// lights an LED and copies a push button to another LED; the bench must
// show both, show a fault's symptom, take a device on a free pin, and keep
// all of it across a reload.
//   npx vite build && npx vitest run --config vitest.e2e.config.ts tests/e2e/wiring.e2e.ts

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    const sub = readdirSync(join(cache, d)).find((x) => x.startsWith("chrome"));
    if (sub && existsSync(join(cache, d, sub, "chrome"))) return join(cache, d, sub, "chrome");
  }
  throw new Error("No Chromium found. Run `npx playwright install chromium` or set CHROME.");
}

// LED7 (GPIO131) is on; LED3 (GPIO95) is on while PB2 (GPIO5) is held.
const PROGRAM = `void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(131, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(131, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(95, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(95, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(5, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(5, GPIO_INPUT, GPIO_PULLUP);
    GpioDataRegs.GPESET.bit.GPIO131 = 1;
    while (1) {
        if (GpioDataRegs.GPADAT.bit.GPIO5 == 0) GpioDataRegs.GPCSET.bit.GPIO95 = 1;
        else GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
        DELAY_US(500);
    }
}
`;

let server: PreviewServer;
let browser: Browser;
let page: Page;
let url = "";
const errors: string[] = [];

async function openSandbox(): Promise<void> {
  await page.goto(`${url}#/sandbox`);
  // The game reads what is stored when it loads.
  await page.reload();
  await page.waitForSelector(".wb");
}

beforeAll(async () => {
  server = await preview({ preview: { port: 4184, strictPort: false }, logLevel: "silent" });
  url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ executablePath: findChrome() });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(url);
  await page.evaluate((code) => {
    localStorage.setItem("bringup-save-v1", JSON.stringify({ version: 1, passed: {}, hints: {}, code: { "sandbox-redboard": code }, unlockAll: true }));
    localStorage.setItem("bringup-ui-v1", JSON.stringify({ "sandbox-kit": "redboard", "sandbox-program": "blink", "panel-sandbox-about": true }));
    localStorage.removeItem("bringup-bench-v1");
  }, PROGRAM);
  await openSandbox();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

const now = (id: string) => page.locator(`[data-now="${id}"]`);
/** What the list "The bench in words" says about a part. */
const words = (label: string) => page.locator('[data-wb="words"] li').filter({ hasText: new RegExp(`^${label}:`) });
const run = () => page.getByRole("button", { name: "Run", exact: true });
const stop = () => page.getByRole("button", { name: "Stop", exact: true });

/** Chooses an option of a list with the arrow keys, as a keyboard user does. `_text` is what the option says. */
async function typeChoice(select: ReturnType<Page["locator"]>, _text: string, value: string): Promise<void> {
  await select.focus();
  await page.keyboard.press("Home");
  for (let n = 0; n < 120 && (await select.inputValue()) !== value; n++) await page.keyboard.press("ArrowDown");
  expect(await select.inputValue()).toBe(value);
}

describe("wiring bench", () => {
  it("opens with the board fully built and nothing attached", async () => {
    await expect.poll(() => page.locator("[data-faults]").getAttribute("data-faults")).toBe("0");
    expect(await page.locator(".wb-board").getAttribute("aria-label")).toMatch(/0 devices attached/);
    expect(await page.locator(".wb-part").count()).toBeGreaterThan(30);
    expect(await now("LED1").textContent()).toBe("no program running");
  });

  it("with the keyboard: runs the program, sees the LED light and the button read", async () => {
    const part = page.locator('[data-wb="part"]');
    await typeChoice(part, "LED7", "LED7");
    await run().focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => now("LED7").textContent()).toBe("on");
    // The words list is the text form of the picture: open it with the keyboard.
    await page.locator('[data-wb="words"] > summary').focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => words("LED3").textContent()).toMatch(/Now: off/);
    // Hold PB2 with the space bar.
    await typeChoice(part, "PB2", "PB2");
    await page.locator('[data-card="PB2"] button').focus();
    await page.keyboard.down("Space");
    await expect.poll(() => now("PB2").textContent()).toMatch(/pressed \(the pin reads 0\)/);
    await expect.poll(() => words("LED3").textContent()).toMatch(/Now: on/);
    await page.keyboard.up("Space");
    await expect.poll(() => words("LED3").textContent()).toMatch(/Now: off/);
    await expect.poll(() => now("PB2").textContent()).toMatch(/released \(the pin reads 1\)/);
  });

  it("with the keyboard: a fault switch shows its symptom while the program runs, and Undo takes it back", async () => {
    await typeChoice(page.locator('[data-wb="part"]'), "LED7", "LED7");
    await typeChoice(page.locator('[data-card="LED7"] [data-option="fitted"]'), "Not", "no");
    await expect.poll(() => now("LED7").textContent()).toBe("not soldered");
    await expect.poll(() => page.locator("[data-faults]").getAttribute("data-faults")).toBe("1");
    await page.getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => now("LED7").textContent()).toBe("on");
    await page.getByRole("button", { name: "Redo" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => now("LED7").textContent()).toBe("not soldered");
  });

  it("with the keyboard: attaches a device, is told what is wrong, and fixes it", async () => {
    await page.locator('[data-wb="add"] > summary').focus();
    await page.keyboard.press("Enter");
    await typeChoice(page.locator('[data-wb="kind"]'), "RC", "servo");
    await page.getByRole("button", { name: "Add RC servo" }).focus();
    await page.keyboard.press("Enter");
    const card = page.locator('[data-card="X1"]');
    await expect.poll(() => card.count()).toBe(1);
    const issues = page.locator(".wb-issues li");
    await expect.poll(() => issues.count()).toBe(3);
    await typeChoice(card.locator('[data-terminal="sig"]'), "GPIO52", "GPIO52");
    await expect.poll(async () => (await issues.allTextContents()).join(" ")).toMatch(/GPIO52 has no ePWM output/);
    await typeChoice(card.locator('[data-terminal="sig"]'), "GPIO10", "GPIO10");
    await typeChoice(card.locator('[data-terminal="pwr"]'), "Battery", "BAT");
    await typeChoice(card.locator('[data-terminal="gnd"]'), "GND", "GND");
    await expect.poll(() => issues.count()).toBe(0);
    expect(await page.locator(".wb-board").getAttribute("aria-label")).toMatch(/1 devices attached/);
  });

  it("keeps the bench across a reload", async () => {
    await page.reload();
    await page.waitForSelector(".wb");
    await expect.poll(() => page.locator("[data-faults]").getAttribute("data-faults")).toBe("1");
    await page.locator('[data-wb="table"] > summary').click();
    expect(await page.locator('[data-wb="table"] tbody tr').count()).toBe(3);
    expect(await page.locator('[data-wb="table"] tbody tr').first().textContent()).toMatch(/RC servo 1.*signal wire.*GPIO10.*pin 76, J8\.6/);
    expect(await page.locator('[data-wb="table"] [role="img"]').getAttribute("aria-label")).toMatch(/RC servo 1 signal wire: GPIO10/);
  });

  it("with the mouse: picks parts in the picture, clears the fault, holds the button, removes the device", async () => {
    await page.locator('.wb-part[data-part="LED7"]').click();
    await expect.poll(() => page.locator('[data-wb="part"]').inputValue()).toBe("LED7");
    await page.locator('[data-card="LED7"] [data-option="fitted"]').selectOption("yes");
    await run().click();
    await expect.poll(() => now("LED7").textContent()).toBe("on");
    await page.locator('[data-wb="words"] > summary').click();
    await page.locator('.wb-part[data-part="PB2"]').click();
    const hold = page.locator('[data-card="PB2"] button');
    await hold.scrollIntoViewIfNeeded();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => words("LED3").textContent()).toMatch(/Now: on/);
    await page.mouse.up();
    await expect.poll(() => words("LED3").textContent()).toMatch(/Now: off/);
    await stop().click();
    await expect.poll(() => now("PB2").textContent()).toBe("released");
    // The attached servo's tag in the picture selects it.
    await page.locator('.wb-part[data-part="X1"]').first().click({ force: true });
    await expect.poll(() => page.locator('[data-wb="part"]').inputValue()).toBe("X1");
    await page.getByRole("button", { name: "Remove RC servo 1" }).click();
    await expect.poll(() => page.locator('[data-wb="table"] tbody tr').count()).toBe(0);
    await page.getByRole("button", { name: "Reset the bench" }).isDisabled();
  });

  it("lights up what is connected: from a part to its pin, and from a pin to its parts", async () => {
    const info = page.locator('[data-wb="info"]');
    const lit = () => page.locator("[data-light]").getAttribute("data-light");
    const centre = async (sel: string) => {
      const b = (await page.locator(sel).boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2] as const;
    };
    // Hover: the mouse over LED3 lights its net and names the pin, through its inverter chip.
    await page.locator(".wb-scroll").scrollIntoViewIfNeeded();
    const [lx, ly] = await centre('.wb-part[data-part="LED3"]');
    await page.mouse.move(lx, ly);
    await expect.poll(() => info.textContent()).toMatch(/^LED3: GPIO95, pin 42, J5\.2 through IC1\./);
    expect(await lit()).toBe("GPIO95");
    // Moving away ends it: hovering alone keeps nothing.
    await page.mouse.move(5, 5);
    await expect.poll(() => info.textContent()).not.toMatch(/LED3/);
    // A click keeps it; Escape clears it.
    await page.mouse.click(lx, ly);
    await page.mouse.move(5, 5);
    await expect.poll(() => info.textContent()).toMatch(/^LED3: GPIO95/);
    await page.locator('[data-keys="parts"]').focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => info.textContent()).toMatch(/^Point at a part/);
    // Focus: the arrow keys move through the parts, and the sentence follows.
    await page.keyboard.press("ArrowRight");
    const first = await info.textContent();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => info.textContent()).not.toBe(first);
    expect(await info.textContent()).toMatch(/GPIO\d+|battery|3V3|5V|not on the LaunchPad/);
    // From a pin to its parts: the arrow keys walk the LaunchPad's pins as a grid.
    await page.locator('[data-keys="pins"]').focus();
    await expect.poll(() => info.textContent()).toMatch(/^Pin 1, J1\.1: 3V3\. A supply/);
    for (let k = 0; k < 7; k++) await page.keyboard.press("ArrowDown");
    await expect.poll(() => info.textContent()).toBe("Pin 8, J1.8: GPIO22. Connected: LED1 (through IC1). Can carry EPWM12A.");
    expect(await lit()).toBe("GPIO22");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => info.textContent()).toBe("Pin 9, J1.9: GPIO105. Nothing connected. Free for a device of yours.");
    // The same from the table of pins, filtered to the free ones.
    await page.locator('[data-wb="pins"] > summary').click();
    expect(await page.locator('[data-wb="pin-table"] tbody tr').count()).toBe(80);
    await page.locator('[data-wb="pin-filter"]').fill("GPIO22");
    await expect.poll(() => page.locator('[data-wb="pin-table"] tbody tr').count()).toBe(1);
    expect(await page.locator('[data-wb="pin-table"] tbody tr').textContent()).toMatch(/8, J1\.8.*GPIO22.*EPWM12A.*LED1 \(through IC1\)/);
    await page.locator('[data-wb="pin-filter"]').fill("");
    await page.locator('[data-wb="pin-free"]').check();
    const free = await page.locator('[data-wb="pin-table"] tbody tr').allTextContents();
    expect(free.length).toBeGreaterThan(10);
    expect(free.every((t) => /nothing: free$/.test(t))).toBe(true);
    // All connections at once, with their legend.
    await page.locator('[data-wb="routes"]').check();
    await expect.poll(() => page.locator(".wb-routes-guide path").count()).toBeGreaterThan(40);
    expect(await page.locator(".wb-legend li").count()).toBe(13);
    await page.locator('[data-wb="routes"]').uncheck();
  });

  it("holds a button from the picture, with the mouse and with the space bar", async () => {
    await run().click();
    const pb = page.locator('.wb-part[data-part="PB2"]');
    await page.locator(".wb-scroll").scrollIntoViewIfNeeded();
    const b = (await pb.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await expect.poll(() => pb.getAttribute("data-state")).toMatch(/^pressed/);
    await expect.poll(() => page.locator('.wb-part[data-part="LED3"]').getAttribute("data-state")).toBe("on");
    await page.mouse.up();
    await expect.poll(() => pb.getAttribute("data-state")).toMatch(/^released/);
    await expect.poll(() => page.locator('.wb-part[data-part="LED3"]').getAttribute("data-state")).toBe("off");
    // The keyboard: PB2 is chosen, so the parts group is on it; Space holds it.
    await page.locator('[data-keys="parts"]').focus();
    await page.keyboard.down("Space");
    await expect.poll(() => pb.getAttribute("data-state")).toMatch(/^pressed/);
    await page.keyboard.up("Space");
    await expect.poll(() => pb.getAttribute("data-state")).toMatch(/^released/);
    // The joystick and the light move their ADC inputs while the program runs.
    await page.locator('[data-wb="part"]').selectOption("JOY");
    await page.locator('[data-card="JOY"] input[type="range"]').first().fill("100");
    await expect.poll(() => now("JOY").textContent()).toMatch(/^X 3\.30 V/);
    await page.locator('[data-wb="part"]').selectOption("LDR");
    await page.locator('[data-card="LDR"] input[type="range"]').fill("0");
    await expect.poll(() => now("LDR").textContent()).toMatch(/^0\.04 V on ADCINA4/);
    await stop().click();
  });

  it("zooms inside its own box, and nothing spills out of the page", async () => {
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const scroll = page.locator(".wb-scroll");
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await scroll.getAttribute("role")).toBe("region");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
