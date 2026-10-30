// With Vite only running: node scripts/heal-click-proof.ts <origin> [before|after]
import assert from "node:assert/strict";
import { mkdir, readdir, appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const store = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
const installed = (await readdir(store)).find((name) => name.startsWith("playwright-core@"));
assert(installed);
const { chromium } = require(resolve(store, installed, "node_modules/playwright-core"));
const output = resolve(import.meta.dirname, "../../../../.artifacts/runs/heal-review-20261030");
await mkdir(output, { recursive: true });
const phase = process.argv[3] ?? "after";
const browser = await chromium.launch({ channel: "msedge", headless: false });
try {
  for (const width of [260, 340]) {
    for (const subject of [
      "RA 37 · Level 2 return air main",
      "RA 37 · Level 2 return air main serving the east wing mechanical equipment and corridor terminals",
    ]) {
      const page = await browser.newPage({
        viewport: { width: Number(process.argv[4] ?? 1280), height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route(
        "**/__heal-click.html",
        (route: { fulfill(options: unknown): Promise<void> }) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html data-pe><head>
      <link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" style="height:100vh"></div>
      <script type="module">import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
      <script type="module" src="/scripts/heal-review.fixture.tsx"></script></body></html>`,
          }),
      );
      await page.goto(`${process.argv[2]}/__heal-click.html`);
      const row = page.locator('[data-pane-id="e-inbox"] [data-key="heal:g6953999"]');
      await row.waitFor({ state: "visible", timeout: 30000 });
      await page.addStyleTag({
        content: `[data-pane-id="e-inbox"] { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; flex: 0 0 ${width}px !important; }`,
      });
      const paneWidth = await page
        .locator('[data-pane-id="e-inbox"]')
        .evaluate((element: HTMLElement) => element.getBoundingClientRect().width);
      assert.equal(paneWidth, width);
      await row.locator(".dl-row-title").evaluate((element: HTMLElement, subject: string) => {
        const text = document.createElement("span");
        text.dataset.subjectText = "";
        text.textContent = `Heal RA 37: 2 caps · ${subject}`;
        element.replaceChildren(text);
      }, subject);
      const button = row.locator('[data-graph-verb="heal-preview"]');
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-key="heal:g6953999"] [data-graph-verb="heal-preview"]')
            ?.getAttribute("aria-disabled") !== "true",
      );
      assert.equal(await row.getAttribute("aria-expanded"), "false");
      const rest = await button.boundingBox();
      assert(rest);
      await row.hover();
      const box = await button.boundingBox();
      assert(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(100);
      const hit = await button.evaluate((element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const actions = element.closest(".dl-row-actions")!.getBoundingClientRect();
        const meta = element.closest(".dl-row-meta")!.getBoundingClientRect();
        const title = element
          .closest(".dl-row-line")!
          .querySelector(".dl-row-title")!
          .getBoundingClientRect();
        return {
          box: rect.toJSON(),
          titleWidth: title.width,
          titleClientWidth: element.closest(".dl-row-line")!.querySelector(".dl-row-title")!
            .clientWidth,
          titleScrollWidth: element.closest(".dl-row-line")!.querySelector(".dl-row-title")!
            .scrollWidth,
          isButton:
            document
              .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              ?.closest("button") === element,
          edgeHits: [1, rect.width / 2, rect.width - 1].map((x) =>
            element.contains(document.elementFromPoint(rect.x + x, rect.y + rect.height / 2)),
          ),
          actionsFit: actions.left >= meta.left && actions.right <= meta.right,
          titleClear: title.right <= actions.left,
          top: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.outerHTML,
          ancestors: Array.from(
            (function* () {
              for (let node: HTMLElement | null = element; node; node = node.parentElement)
                yield node;
            })(),
          )
            .slice(0, 8)
            .map((node) => ({
              class: node.className,
              box: node.getBoundingClientRect().toJSON(),
              overflow: getComputedStyle(node).overflow,
            })),
        };
      });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1500);
      const actions = await page.evaluate(
        () =>
          (globalThis as unknown as { healProof: { actions: { key: string }[] } }).healProof
            .actions,
      );
      const expanded = await row.getAttribute("aria-expanded");
      const planned = await page.getByText(/\d+ planned/).allTextContents();
      await appendFile(
        resolve(output, "H6-click.txt"),
        JSON.stringify({
          when: new Date().toISOString(),
          phase,
          width,
          subject,
          paneWidth,
          rest,
          hit,
          actions,
          expanded,
          planned,
          errors,
        }) + "\n",
      );
      if (phase !== "before") {
        assert(hit.titleWidth >= 30, "the title retains a readable floor");
        assert(hit.box.width <= 24, "header actions are icon-sized");
        assert.equal(hit.isButton, true, "the button owns its centre hit target");
        assert.deepEqual(
          hit.edgeHits,
          [true, true, true],
          "the button is hittable across its full width",
        );
        assert.equal(hit.actionsFit, true, "meta reserves the full action width");
        assert.equal(hit.titleClear, true, "the title never overlaps actions");
        assert.deepEqual(box, rest, "revealing actions does not move the button");
        assert.equal(hit.box.x, rest.x);
        assert.equal(hit.box.y, rest.y);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].key, "ducts.preview-heal");
        assert.equal(expanded, "false");
        assert(planned.length > 0, "planned text appears after one physical click");
        assert.deepEqual(errors, []);
      }
      console.log(
        JSON.stringify({
          phase,
          width,
          subject,
          hit: hit.isButton,
          actions: actions.length,
          expanded,
          planned,
          errors,
        }),
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
