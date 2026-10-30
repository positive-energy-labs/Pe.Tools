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
  "../../../../.artifacts/runs/shell-close-20261029/L2-layout.txt",
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
  for (const [width, height] of [
    [1280, 800],
    [1600, 900],
    [1920, 1080],
    [2400, 1350],
  ]) {
    for (const stage of ["network", "sheet"]) {
      const context = await browser.newContext({ viewport: { width, height } });
      try {
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
        // __root -> RouteDock -> ChatShell: the product dock and chat, with fresh device state.
        await page.locator("[data-chat-column]").waitFor({ state: "visible", timeout: 20000 });
        await page
          .locator(`[data-pane-id="${stage === "network" ? "e-picture" : "sheet-picture"}"]`)
          .waitFor({ state: "attached" });
        const record = async (action: string) => {
          await page.waitForTimeout(1000);
          const measurement = (await page.evaluate(measureDocument)) as ReturnType<
            typeof measureDocument
          >;
          await appendFile(
            output,
            `${JSON.stringify({ phase, width, height, stage, action, url: page.url(), measurement, errors, hostRequests })}\n`,
          );
          console.log(
            JSON.stringify({
              phase,
              width,
              stage,
              action,
              panes: measurement.panes.map(({ id, rect, rail }) => ({
                id,
                width: rect.width,
                height: rect.height,
                rail,
              })),
            }),
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(hostRequests, []);
          if (phase !== "before") {
            check(measurement);
            const pane = (id: string) => measurement.panes.find((p) => p.id === id)!;
            const picture = pane(stage === "network" ? "e-picture" : "sheet-picture");
            assert(
              picture.rect.width >= 360 && picture.rect.height >= 100 && !picture.rail,
              "the subject lost its floor",
            );
            assert(!pane("tools").rail, "the whole route folded before its support panes");
            assert(pane("pea").rect.width >= 280, "the real chat disappeared");
            if (stage === "network" && pane("e-systems").rail)
              assert.equal(pane("e-inbox").rail, "Rulings", "Systems yielded before Rulings");
          }
          return measurement;
        };
        await record("default-chat-open");
        if (phase !== "before" && width === 1920 && stage === "network") {
          // Grow the real tools dock, then shrink and restore without changing its preference.
          const dock = page
            .locator("[data-layout-split]")
            .filter({ has: page.locator('[data-pane-id="pea"]') });
          const seam = dock.locator(':scope > div > [role="separator"]');
          await seam.focus();
          for (let i = 0; i < 26; i++) await seam.press("ArrowLeft");
          const wide = await record("grow-tools");
          assert(!wide.panes.find((p) => p.id === "e-inbox")!.rail);
          await page.setViewportSize({ width: 1280, height: 800 });
          const narrow = await record("shrink-to-1280");
          await page.setViewportSize({ width: 1920, height: 1080 });
          const restored = await record("restore-1920");
          assert.equal(narrow.saved.tools, wide.saved.tools);
          assert.equal(restored.saved.tools, wide.saved.tools);
          assert(!restored.panes.find((p) => p.id === "e-inbox")!.rail);
        }
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
