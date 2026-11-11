// The F1 runner's settledness read, on the markup the kernel draws (slice 6.1), in real Chrome.
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { openBrowser, type BrowserPage, type BrowserSession } from "@pe/browser";
import { marks, settled } from "./marks.ts";

// A hidden retained Place (inert), the shown Place (URL flushed), and the Pea pane's thread list:
// a persistent listbox whose rows are options, drawn whenever a thread exists.
const PAGE = `
  <div data-route-tab="old" inert><section data-url-settled><div aria-label="tools" aria-busy="true">Pricing</div></section></div>
  <div data-route-tab="shown"><section data-url-settled>
    <div aria-label="tools"><div id="roster" role="listbox" aria-label="fans"><div role="option">FC-1 / port 1</div></div></div>
  </section></div>
  <aside aria-label="Pea"><div role="listbox" aria-label="Threads"><div role="option">Thread 1</div></div></aside>
  <div id="layer" data-slot="popover-content" data-closed><div role="option">Chadds.rvt</div></div>`;

let browser: BrowserSession;
let page: BrowserPage;
beforeAll(async () => {
  browser = await openBrowser({ mode: "headless" });
  page = await browser.page({ url: "about:blank" });
  await page.evaluate((html: string) => (document.body.innerHTML = html).length, PAGE);
});
afterAll(() => browser?.close());

const set = (id: string, name: string, value: string | null) =>
  page.evaluate(
    (id: string, name: string, value: string | null) => {
      const e = document.getElementById(id)!;
      if (value === null) e.removeAttribute(name);
      else e.setAttribute(name, value);
      return null;
    },
    id,
    name,
    value,
  );

test("a settled shown Place is settled beside a Pea thread list and a busy hidden Place", async () => {
  const m = await marks(page);
  expect(m).toEqual({ busy: false, urlSettled: true, picker: false });
  expect(settled(m)).toBe(true);
});

test("a busy pane is not settled, whatever it says", async () => {
  await set("roster", "aria-busy", "true");
  const m = await marks(page);
  expect(m.busy).toBe(true);
  expect(settled(m)).toBe(false);
  await set("roster", "aria-busy", null);
  expect(settled(await marks(page))).toBe(true);
});

test("only an open overlay's options are a picker", async () => {
  await set("layer", "data-closed", null);
  await set("layer", "data-open", "");
  const m = await marks(page);
  expect(m.picker).toBe(true);
  expect(settled(m)).toBe(false);
});
