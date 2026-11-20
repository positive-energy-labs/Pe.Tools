import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { expect, test } from "vite-plus/test";
import { connectTypedPage, type TypedPage } from "./typed-page.ts";

const SYSTEMS = '[data-list-view][aria-label="systems"] [role="option"][data-key]';

async function click(page: TypedPage, selector: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await page.evaluate((selector) => {
          const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
            (element) =>
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility !== "hidden",
          );
          if (!element || element.matches(':disabled, [aria-disabled="true"]')) return null;
          const rect = element.getBoundingClientRect();
          const y = rect.top + Math.min(10, rect.height / 2);
          for (const ratio of [0.35, 0.5, 0.2, 0.65]) {
            const x = rect.left + rect.width * ratio;
            const hit = document.elementFromPoint(x, y);
            if (
              x > 0 &&
              y > 0 &&
              x < innerWidth &&
              y < innerHeight &&
              hit &&
              (hit === element || element.contains(hit)) &&
              (!element.matches('[role="option"]') ||
                !hit.closest('button, a, input, [role="button"]'))
            )
              return { x, y };
          }
          return null;
        }, selector);
        return point;
      },
      { timeout: 20_000, message: `Visible enabled control ${selector}` },
    )
    .not.toBeNull();
  if (!point) throw new Error(`Missing control ${selector}`);
  const box: { x: number; y: number } = point;
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...box,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...box,
    button: "left",
    clickCount: 1,
  });
}

async function openSystem(page: TypedPage, name: string) {
  const selector = `${SYSTEMS}[data-key=${JSON.stringify(name)}]`;
  const shown = await page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].some(
        (row) => row.getClientRects().length > 0,
      ),
    selector,
  );
  if (!shown) await click(page, 'button[aria-label^="Expand systems" i]');
  await click(page, selector);
}

function state(page: TypedPage) {
  return page.evaluate((selector) => {
    const url = new URL(location.href);
    const encoded = url.searchParams.get("system");
    const subject: unknown = encoded ? JSON.parse(encoded) : null;
    const system =
      subject && typeof subject === "object" && "ids" in subject && Array.isArray(subject.ids)
        ? subject.ids.filter((id): id is string => typeof id === "string")
        : [];
    const rows = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (row) => row.getClientRects().length > 0,
    );
    const selected = rows
      .filter((row) => row.getAttribute("aria-selected") === "true")
      .flatMap((row) => (row.dataset.key ? [row.dataset.key] : []))
      .sort();
    const pane = document.querySelector('[data-pane-id="e-picture"]');
    const picture = pane?.querySelector("[data-model-picture]");
    return {
      url: url.href,
      system,
      selected,
      rosterVisible: rows.length > 0,
      ready:
        document.readyState === "complete" &&
        (system.length
          ? !!picture?.getClientRects().length && !picture.matches('[data-reading="pending"]')
          : rows.length > 0 &&
            !!pane?.textContent?.includes("Choose a system to see its picture.")),
      alerts: [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.innerText),
    };
  }, SYSTEMS);
}

test("opening a second duct system retains the first through reload and browser history", async () => {
  const resultPath = process.env.E2E_RESULT_PATH;
  if (!resultPath) throw new Error("E2E_RESULT_PATH is required");
  const url = new URL(process.env.E2E_WEB!);
  expect(url.pathname).toBe("/duct-systems");
  expect(url.search).toBe("?fixture=navigation");
  expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
  const page = await connectTypedPage();
  const checkpoints: { label: string; state: Awaited<ReturnType<typeof state>> }[] = [];
  let sourceStartupMs: number | undefined;
  let failure: unknown;
  await mkdir(dirname(resultPath), { recursive: true });
  const assertScope = async (label: string, systems: string[]) => {
    await expect
      .poll(
        async () => {
          const current = await state(page);
          expect(current.alerts).toEqual([]);
          return {
            ready: current.ready,
            system: current.system,
          };
        },
        { timeout: 20_000, message: label },
      )
      .toEqual({
        ready: true,
        system: systems.map((name) => subjectCode({ keyKind: "system-name", key: name })),
      });
    if (systems.length && !(await state(page)).rosterVisible)
      await click(page, 'button[aria-label^="Expand systems" i]');
    await expect
      .poll(async () => (await state(page)).selected, {
        timeout: 20_000,
        message: `${label}: selected rows`,
      })
      .toEqual([...systems].sort());
    checkpoints.push({ label, state: await state(page) });
  };
  try {
    const startup = Date.now();
    const navigation = await page.send("Page.navigate", { url: url.href });
    expect(navigation.errorText).toBeUndefined();
    // Cold Vite loads the client graph and pricing worker after the launcher's HTML readiness.
    // Give source boot its own budget; selection and history transitions retain their 20s limit.
    await expect
      .poll(
        async () => {
          const current = await state(page);
          expect(current.alerts).toEqual([]);
          return current.ready;
        },
        { timeout: 60_000, message: "cold source workspace ready" },
      )
      .toBe(true);
    sourceStartupMs = Date.now() - startup;
    console.log(`SELECTION_SOURCE_STARTUP_MS=${sourceStartupMs}`);
    await assertScope("initial whole document", []);
    await openSystem(page, "SA Lab");
    await assertScope("open SA Lab", ["SA Lab"]);
    await openSystem(page, "SA Office");
    await assertScope("SA Office retains SA Lab", ["SA Lab", "SA Office"]);
    const beforeReload = page.loadCount();
    await page.send("Page.reload", { ignoreCache: true });
    await expect.poll(() => page.loadCount(), { timeout: 20_000 }).toBeGreaterThan(beforeReload);
    await assertScope("reload preserves both systems", ["SA Lab", "SA Office"]);
    for (const [direction, systems] of [
      [-1, ["SA Lab"]],
      [1, ["SA Lab", "SA Office"]],
    ] as const) {
      const history = await page.send("Page.getNavigationHistory");
      const entry = history.entries[history.currentIndex + direction];
      if (!entry || new URL(entry.url).origin !== url.origin)
        throw new Error("Missing owned browser history entry");
      await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
      await assertScope(
        direction < 0 ? "Back restores first system" : "Forward restores both systems",
        [...systems],
      );
    }
    expect(page.errors, "No uncaught browser exceptions").toEqual([]);
  } catch (error) {
    failure = error;
    await writeFile(
      join(dirname(resultPath), "failure-state.json"),
      JSON.stringify(
        {
          state: await state(page).catch(String),
          errors: page.errors,
          body: await page.evaluate(() => document.body.innerText).catch(String),
        },
        null,
        2,
      ),
    );
    const screenshot = await page
      .send("Page.captureScreenshot", { format: "png" })
      .catch(() => null);
    if (screenshot)
      await writeFile(
        join(dirname(resultPath), "failure.png"),
        Buffer.from(screenshot.data, "base64"),
      );
    throw error;
  } finally {
    try {
      await writeFile(
        resultPath,
        JSON.stringify(
          {
            result: failure ? "failed" : "passed",
            checkpoints,
            sourceStartupMs,
            error: failure instanceof Error ? failure.stack : failure,
            errors: page.errors,
          },
          null,
          2,
        ),
      );
    } finally {
      await page.close();
    }
  }
});
