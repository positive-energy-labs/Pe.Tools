import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { gestures, openBrowser, type BrowserPage, type BrowserSession } from "../src/index.ts";
import { fixtureServer } from "./fixtures/server.ts";

let server: Awaited<ReturnType<typeof fixtureServer>>;
let browser: BrowserSession;
let page: BrowserPage;
const log = () => page.evaluate(() => document.getElementById("log")!.textContent);

beforeAll(async () => {
  server = await fixtureServer();
  browser = await openBrowser({ mode: "headless" });
  page = await browser.page({ url: `${server.url}/gestures` });
  await page.send("Runtime.enable");
  for (let end = Date.now() + 10_000; ; ) {
    if (
      await page.evaluate(
        () => document.readyState === "complete" && !!document.getElementById("log"),
      )
    )
      break;
    if (Date.now() > end) throw new Error("gestures fixture never loaded");
    await new Promise((done) => setTimeout(done, 50));
  }
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

test("gestures press only what a person could press and read typing back", async () => {
  const g = gestures(page);

  const enabled = await g.click({ role: "button", name: "Enabled action" });
  expect(enabled).toMatchObject({ outcome: "done", url: `${server.url}/gestures` });
  expect(await log()).toBe("enabled;");

  expect(await g.click({ name: "Disabled action" })).toMatchObject({
    outcome: "blocked",
    reason: "disabled",
  });
  expect(await log(), "a blocked press must not reach the handler").toBe("enabled;");

  expect(await g.click("#under")).toMatchObject({
    outcome: "blocked",
    reason: "covered",
    hit: "span#overlay",
  });
  expect(await log()).toBe("enabled;");

  // `within` scopes to the first shown region of that name, not a hidden earlier twin.
  expect(await g.click({ role: "button", name: "Scoped action", within: '[aria-label="Pane"]' })).toMatchObject({ outcome: "done" });
  expect(await log()).toBe("enabled;scoped;");

  expect(await g.type({ role: "textbox", name: "Doubling" }, "Duct")).toEqual({
    outcome: "mismatch",
    wanted: "Duct",
    got: "DDuct",
    url: `${server.url}/gestures`,
  });
});
