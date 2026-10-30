// With Vite running: node scripts/layout-proof.ts http://127.0.0.1:5197 [before|after]
import assert from "node:assert/strict";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const store = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
const installed = (await readdir(store)).find((name) => name.startsWith("playwright-core@"));
assert(installed, "playwright-core must already be installed in the workspace");
const { chromium } = require(resolve(store, installed, "node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://127.0.0.1:5197";
const phase = process.argv[3] ?? "after";
const output = resolve(
  import.meta.dirname,
  "../../../../.artifacts/runs/shell-close-20261029/L1b-layout.txt",
);
await mkdir(resolve(output, ".."), { recursive: true });

function measureDocument() {
  const box = (el: Element) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  };
  const visibleRail = (el: HTMLElement) => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (!parent.hasAttribute("data-pane-side")) continue;
      const split = parent.parentElement;
      if (!split || split.dataset.paneFolded !== parent.dataset.paneSide) continue;
      const rail = split.querySelector<HTMLElement>(
        `:scope > [data-pane-rail-side="${parent.dataset.paneSide}"]`,
      );
      if (rail && box(rail).width > 0 && box(rail).height > 0) return rail.textContent;
    }
    return null;
  };
  return {
    panes: [...document.querySelectorAll<HTMLElement>("[data-pane-id]")].map((el) => ({
      id: el.dataset.paneId,
      rect: box(el),
      rail: visibleRail(el),
    })),
    splits: [...document.querySelectorAll<HTMLElement>('[data-slot="pane-split"]')].map((el) => ({
      id: el.dataset.layoutSplit,
      axis: el.dataset.axis,
      folded: el.dataset.paneFolded,
      stacked: el.dataset.paneStacked,
      tracks: getComputedStyle(el).gridTemplateColumns,
      rect: box(el),
      sides: [...el.querySelectorAll<HTMLElement>(":scope > [data-pane-side]")].map((side) => ({
        side: side.dataset.paneSide,
        rect: box(side),
        minimum: Number(
          side.dataset.paneSide === el.dataset.paneTarget
            ? el.dataset.paneMinSize
            : el.dataset.paneMinOtherSize,
        ),
      })),
    })),
    rails: [...document.querySelectorAll<HTMLElement>('[data-slot="pane-rail"]')].map((el) => ({
      title: el.textContent,
      rect: box(el),
    })),
    saved: {
      tools: localStorage.getItem("pe.toolsWidth"),
      threads: localStorage.getItem("pe.sideWidth"),
    },
  };
}

function check(measurement: ReturnType<typeof measureDocument>) {
  for (const pane of measurement.panes) {
    assert(
      (pane.rect.width > 0 && pane.rect.height > 0) || pane.rail,
      `${pane.id} disappeared without a named rail`,
    );
  }
  for (const split of measurement.splits) {
    if (split.axis !== "horizontal" || split.rect.width === 0) continue;
    for (const side of split.sides) {
      if (split.folded === side.side) continue;
      assert(
        side.rect.width + 1 >= side.minimum,
        `${split.id}/${side.side}: ${side.rect.width} < ${side.minimum}`,
      );
    }
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [1280, 1600, 1920]) {
    for (const stage of ["network", "sheet"]) {
      for (const saved of width === 1600 ? [null, 0, 10000] : [null]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        try {
          if (saved !== null)
            await context.addInitScript((size: number) => {
              localStorage.setItem("pe.toolsWidth", String(size));
              localStorage.setItem("pe.sideWidth", String(size));
              localStorage.setItem(
                "pe.route.ducts.layout",
                JSON.stringify({
                  "e-systems": { sizes: { '["sidebar","e-systems"]': size } },
                  "e-inbox": { sizes: { '["drawing","e-inbox"]': size } },
                  "sheet-roster": { sizes: { '["sheet-layout","sheet-roster"]': size } },
                  "sheet-picture": { sizes: { '["sheet-main","sheet-picture"]': size } },
                  "sheet-inputs": { sizes: { '["sheet-side","sheet-inputs"]': size } },
                }),
              );
            }, saved);
          const page = await context.newPage();
          const errors: string[] = [],
            hostRequests: string[] = [];
          page.on("pageerror", (error: Error) => errors.push(error.message));
          page.on("request", (request: { url(): string }) => {
            if (
              /\/(call|host\/status|pe\/(environment|resources))(\?|$)/.test(
                new URL(request.url()).pathname,
              )
            )
              hostRequests.push(request.url());
          });
          await page.goto(
            `${origin}/ducts?fixture=scene${stage === "sheet" ? "&stage=sheet&fan=14577391%3A2" : ""}`,
          );
          await page
            .locator(`[data-pane-id="${stage === "network" ? "e-picture" : "sheet-picture"}"]`)
            .waitFor({ state: "attached", timeout: 20000 })
            .catch(async (error: Error) => {
              console.error({
                errors,
                body: await page.locator("body").innerText(),
                error: error.message,
              });
              throw error;
            });
          const record = async (action: string) => {
            await page.waitForTimeout(1000);
            const measurement = (await page.evaluate(measureDocument)) as ReturnType<
              typeof measureDocument
            >;
            assert(measurement.panes.length, await page.locator("body").innerText());
            await appendFile(
              output,
              `${JSON.stringify({ phase, width, stage, saved, action, url: page.url(), measurement, errors, hostRequests })}\n`,
            );
            console.log(
              JSON.stringify({
                phase,
                width,
                stage,
                saved,
                action,
                panes: measurement.panes.map(({ id, rect, rail }) => ({ id, ...rect, rail })),
              }),
            );
            if (phase !== "before") check(measurement);
            assert.deepEqual(errors, []);
            assert.deepEqual(hostRequests, []);
            if (saved !== null)
              assert.equal(
                measurement.saved.tools,
                String(saved),
                "fitting overwrote the preference",
              );
            return measurement;
          };
          await record("default-chat-open");
          const toolsRail = page.getByRole("button", { name: "Expand tools", exact: true });
          if (await toolsRail.isVisible()) {
            await toolsRail.click();
            await record("expand-tools");
          }
          if (phase !== "before") {
            const panes = (
              (await page.evaluate(measureDocument)) as ReturnType<typeof measureDocument>
            ).panes;
            for (const [id, minimum] of stage === "network"
              ? ([
                  ["e-picture", 360],
                  ["e-inbox", 260],
                ] as const)
              : ([["sheet-picture", 360]] as const)) {
              assert(
                panes.find((pane) => pane.id === id)!.rect.width >= minimum,
                `${id} did not open at its floor`,
              );
            }
          }
          if (width === 1920 && stage === "network" && phase !== "before") {
            await page.setViewportSize({ width: 1280, height: 1000 });
            await record("shrink-to-1280");
            await page.setViewportSize({ width: 1920, height: 1000 });
            const restored = await record("grow-to-1920");
            assert(
              !restored.splits.find((split) => split.id === '["route-dock","tools"]')?.folded,
              "responsive fold persisted after room returned",
            );
          }
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
