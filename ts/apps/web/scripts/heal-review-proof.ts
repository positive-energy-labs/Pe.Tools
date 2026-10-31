// With Vite only running: node scripts/heal-review-proof.ts <origin>
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const store = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
const installed = (await readdir(store)).find((name) => name.startsWith("playwright-core@"));
assert(installed, "playwright-core must already be installed");
const { chromium } = require(resolve(store, installed, "node_modules/playwright-core"));
const origin = process.argv[2];
assert(origin, "Pass the Vite origin");
const output = resolve(import.meta.dirname, "../../../../.artifacts/runs/heal-review-20261030");
await mkdir(output, { recursive: true });
const html = resolve(output, "review.html");
const documentHtml = `<!doctype html><html data-pe><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/styles.css"></head>
<body><div id="root" style="height:100vh"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module" src="/scripts/heal-review.fixture.tsx"></script></body></html>`;
await writeFile(html, documentHtml);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
let activePage;
try {
  for (const width of [1280, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    activePage = page;
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route(
      "**/__heal-review-proof.html",
      (route: { fulfill(options: unknown): Promise<void> }) =>
        route.fulfill({ contentType: "text/html", body: documentHtml }),
    );
    await page.goto(`${origin}/__heal-review-proof.html`);
    const systems = page.locator('[data-pane-id="e-systems"]');
    await systems.getByText("FA 53", { exact: true }).waitFor({ state: "attached" });
    const row = page.locator('[data-pane-id="e-inbox"] [data-key="heal:g6953999"]');
    await row.locator(".dl-row-title").click();
    const controls = page.locator('[data-inbox-detail="heal:g6953999"]');
    for (const cancel of ["click", "Escape"]) {
      await controls.getByRole("button", { name: "Heal", exact: true }).click();
      const review = page.getByLabel("Heal review", { exact: true });
      const button = review.getByRole("button", { name: "Cancel Heal", exact: true });
      await button.waitFor({ state: "visible" });
      const hit = await button.evaluate((element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          topmost: top === element || element.contains(top),
          top: top?.outerHTML,
          box: box.toJSON(),
        };
      });
      assert(hit.topmost, `Cancel is overlapped: ${JSON.stringify(hit)}`);
      if (cancel === "click") await button.click();
      else await page.keyboard.press("Escape");
      await review.waitFor({ state: "detached" });
      const actions: string[] = await page.evaluate(() =>
        (
          globalThis as unknown as { healProof: { actions: { key: string }[] } }
        ).healProof.actions.map((a) => a.key),
      );
      assert(
        actions.every((key) => key === "ducts.preview-heal"),
        "Cancel dispatched a commit",
      );
      results.push({ width, cancel, hit, actions, errors });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify(results, null, 2));
  console.log(`PASS: Cancel topmost and click/Escape cancellation at both widths. ${output}`);
} catch (error) {
  if (activePage) {
    await writeFile(resolve(output, "failure.html"), await activePage.content());
    await activePage.screenshot({ path: resolve(output, "failure.png") });
  }
  throw error;
} finally {
  await browser.close();
}
