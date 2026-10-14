import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [url, output] = process.argv.slice(2);
if (!url || !output)
  throw new Error("node tests/browser.mjs <hosted-page-url> <evidence-directory>");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const evidence = {
  url,
  at: new Date().toISOString(),
  steps: [],
  screenshots: [],
  errors: [],
  warnings: [],
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push(message.text());
    if (message.type() === "warning") evidence.warnings.push(message.text());
  });
  await page.goto(url);
  await page.getByRole("grid", { name: "Conductor comparison" }).waitFor();
  await page.locator(".diagram svg:not([aria-hidden])").waitFor();
  assert.match(await page.getByTestId("Voltage drop").innerText(), /7\.75/);
  await page.getByRole("button", { name: "Use 8 AWG", exact: true }).click();
  await page.waitForFunction(() => window.pageState.state.size === "8");
  assert.match(await page.getByTestId("Voltage drop").innerText(), /4\.87/);
  evidence.steps.push("Table selects 8 AWG and changes 7.75 V to 4.87 V");
  await page.getByRole("button", { name: "Conductor size", exact: true }).click();
  await page.getByRole("option", { name: "6 AWG · copper", exact: true }).click();
  await page.waitForFunction(() => window.pageState.state.size === "6");
  evidence.steps.push("Real kit searchable picker chooses 6 AWG");
  await page.getByRole("button", { name: "Phase", exact: true }).click();
  await page.getByRole("option", { name: "1φ · two wire", exact: true }).click();
  await page.waitForFunction(() => window.pageState.state.phase === "1");
  await page.getByRole("spinbutton", { name: "Load · A", exact: true }).fill("0");
  await page.waitForFunction(() => window.pageState.state.amps === "0");
  assert.match(await page.getByTestId("Voltage drop").innerText(), /0\.00/);
  await page.getByRole("spinbutton", { name: "Supply · V", exact: true }).fill("0");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("Voltage drop").count(), 0);
  evidence.steps.push("Single-phase selection, zero-load result, invalid voltage hides results");
  await page.getByRole("button", { name: "Reset example", exact: true }).click();
  await page.getByRole("button", { name: "Calc trace", exact: true }).click();
  await page.getByText("ΔV = multiplier × K × I × L / CM", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByText("Editable Page source", { exact: true }).waitFor();
  assert.ok((await page.locator(".artifact-body").innerText()).includes("calculate"));
  await page.reload();
  await page.getByRole("button", { name: "Source", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Source", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  evidence.steps.push(
    "Trace and highlighted source tabs work; URL restores selected tab after reload",
  );
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.goto(`${url}#theme=${theme}`);
      await page.locator(".diagram svg:not([aria-hidden])").waitFor();
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        body: document.documentElement.scrollWidth,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      assert.ok(geometry.body <= geometry.width, `horizontal overflow at ${width}`);
      assert.equal(geometry.scheme, theme);
      const path = resolve(output, `voltage-drop-${width}-${theme}.png`);
      await page.screenshot({ path, fullPage: true });
      const bytes = (await stat(path)).size;
      assert.ok(bytes > 10_000);
      evidence.screenshots.push({ path, width, theme, bytes, geometry });
    }
  }
  const offline = await context.newPage();
  const external = [];
  await offline.route(/^https?:/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  const portable = pathToFileURL(
    resolve(import.meta.dirname, "../../../../examples/pages/voltage-drop/index.html"),
  );
  await offline.goto(portable.href);
  await offline.locator(".diagram svg:not([aria-hidden])").waitFor();
  await offline.getByRole("button", { name: "Use 8 AWG", exact: true }).click();
  await offline.waitForFunction(() => window.pageState.state.size === "8");
  assert.match(await offline.getByTestId("Voltage drop").innerText(), /4\.87/);
  assert.deepEqual(external, []);
  evidence.steps.push(
    "file:// Page calculates and renders Mermaid with HTTP(S) blocked; zero external requests",
  );
  assert.deepEqual(evidence.errors, []);
} finally {
  await browser.close();
  await writeFile(resolve(output, "browser-proof.json"), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
