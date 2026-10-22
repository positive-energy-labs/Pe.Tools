/** Browser proof against the real host: capture → plan → apply with filed receipts read back on `/pods`. */
import { existsSync, mkdtempSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { devHostProxy } from "../../web/dev-proxy.ts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { address, bindWork } from "@pe/agent-contracts";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { hostTakeoffCaptures } from "../src/takeoff-captures.ts";

const webRoot = resolve(import.meta.dirname, "..", "..", "web");

async function waitForService(appBase: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const file = await readServiceFile(appBase, hostOwnership.serviceName);
    if (file) return file;
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error("service file did not appear");
}

let baseUrl = "";
// The host's own origin: `/admin/shutdown` is not one of the paths `devHostProxy` forwards, so
// posting it at `baseUrl` (the browser's vite server) 404s and `hostDone` never settles.
let hostUrl = "";
// biome-ignore lint/suspicious/noExplicitAny: the page type is not threaded through here.
let browser: { close(): Promise<void>; newPage(): Promise<any> } | undefined;
let hostDone: Promise<unknown> | undefined;
let serviceToken = "";
let browserVite: Awaited<ReturnType<typeof createViteServer>> | undefined;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "pe-demo-lane-"));
  const nodeServer = createNodeServer();
  // The dev host's shape: the frontend origin is recorded once the browser's Vite listens.
  const webUrl = Effect.runSync(Deferred.make<string>());
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            lifecycle: { handle, latch },
            nodeServer,
            port: 0,
            webRoot: null,
            webUrl,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  hostDone = Effect.runPromise(program);
  const service = await waitForService(productRoot());
  serviceToken = service.token;
  hostUrl = `http://127.0.0.1:${service.port}`;
  browserVite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      // This Vite reads port 0 as "unset" and starts at 5173, and the app config is strictPort, so a
      // running dev server made the suite fail. Let it walk to the next free port instead.
      strictPort: false,
      hmr: false,
      proxy: devHostProxy(`http://127.0.0.1:${service.port}`),
    },
  });
  await browserVite.listen();
  baseUrl = browserVite.resolvedUrls!.local[0]!.replace(/\/$/, "");
  Effect.runSync(Deferred.succeed(webUrl, baseUrl));
  const { chromium } = await import("playwright-core");
  const executablePath = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  if (!executablePath) throw new Error("the demo lane needs Chrome or Edge");
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await fetch(`${hostUrl}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": serviceToken },
  }).catch(() => undefined);
  await hostDone;
  await browserVite?.close();
}, 200_000);

// biome-ignore lint/suspicious/noExplicitAny: the page type is not threaded through here.
type Page = any;

const SCRATCH = process.env.PE_DEMO_LANE_SHOTS;

/** The app bar folds the Situation into a drawer that is inert until pinned (Ctrl+.); pin it so
 * its head, verbs and ladder are on the page. Pinning is page state, so every load pins again. */
async function pinSituation(page: Page) {
  const door = page.getByRole("button", { name: "Show Situation", exact: true });
  await expect.poll(() => door.getAttribute("aria-disabled"), { timeout: 30_000 }).toBeNull();
  if ((await door.getAttribute("aria-pressed")) !== "true") await door.click();
  await expect.poll(() => page.getByRole("region", { name: "Situation drawer" }).count()).toBe(1);
}

async function go(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await pinSituation(page);
}

async function openLive(page: Page, path: string, query: string) {
  await page.goto(`${baseUrl}${path}?${query}`, { waitUntil: "domcontentloaded" });
  // The lane creates the owner, then reloads bound to its one session.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("target"), { timeout: 30_000 })
    .toMatch(/^demo-/);
  await pinSituation(page);
  return new URL(page.url()).searchParams.get("target")!;
}

const verb = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^${label}`) }).first();

async function run(page: Page, label: string) {
  const button = verb(page, label);
  await expect.poll(() => button.isEnabled(), { timeout: 30_000 }).toBe(true);
  await button.click();
}

/** The plan sheet gates apply: its `apply N rows` is the only apply button (w8-revit trip 5). */
async function applySheet(page: Page) {
  const button = page
    .getByRole("region", { name: "Confirmation sheet" })
    .getByRole("button", { name: /^apply \d+ rows?/ });
  await expect.poll(() => button.isEnabled(), { timeout: 30_000 }).toBe(true);
  await button.click();
}

async function landed(page: Page, pattern: RegExp) {
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).searchParams.get("path") ?? ""), {
      timeout: 30_000,
    })
    .toMatch(pattern);
  return decodeURIComponent(new URL(page.url()).searchParams.get("path")!);
}

/** The page log drew a row for the verb whose hover says `says`: the row ends in the label, hover says the rest. */
async function logged(page: Page, label: string, says: string) {
  // The head's log is folded to its newest row (MAP ruling 21); any tab press opens the column.
  const situation = page.locator('section[aria-label="Situation"]');
  const allTab = situation.locator('[aria-description="all entries"]');
  if (await allTab.count()) await allTab.first().click();
  const rows = situation.locator(`li[aria-description$=" · ${says}"]`);
  const row = rows.filter({ hasText: new RegExp(`${label}$`) });
  await expect.poll(() => row.count(), { timeout: 30_000 }).toBeGreaterThan(0);
}

/** The table query becomes exactly `text`: every query chip is removed, then its words are typed. */
async function setQuery(page: Page, text: string) {
  const box = page.getByRole("combobox", { name: "table query" });
  const remove = page.locator(
    '[data-slot="query-box"] [aria-description^="A word of the query"] button[aria-label^="Remove the"]',
  );
  while (await remove.count()) await remove.first().click();
  await box.fill(text ? `${text} ` : "");
  await box.press("Escape");
}

/** `/pods` for the member: the run receipt the apply filed, as the page draws it. */
async function receiptOnPods(page: Page, pod: string, path: string, operation: string) {
  await page.goto(
    `${baseUrl}/pods?demo=browse&live=1&pod=${encodeURIComponent(pod)}&path=${encodeURIComponent(path)}`,
    { waitUntil: "domcontentloaded" },
  );
  const body = page.locator("body");
  await expect.poll(() => body.innerText(), { timeout: 30_000 }).toContain(operation);
  return body.innerText();
}

/** Runs one loop; returns what `/pods` showed and the workflow keys the page admitted, in order. */
async function liveLoop(name: string, loop: (page: Page) => Promise<string>) {
  const page = await browser!.newPage();
  const errors: string[] = [];
  const workflows: string[] = [];
  page.on("pageerror", (error: { message: string }) => errors.push(`page error: ${error.message}`));
  page.on("request", (request: { method(): string; url(): string; postDataJSON(): unknown }) => {
    if (request.method() !== "POST" || !/\/demo\/instances\/[^/]+\/actions$/.test(request.url()))
      return;
    const admission = request.postDataJSON() as { kind: string; key: string };
    if (admission.kind === "workflow") workflows.push(admission.key);
  });
  try {
    const shown = await loop(page);
    if (SCRATCH) await page.screenshot({ path: join(SCRATCH, `${name}.png`), fullPage: true });
    expect(errors, `${name} threw`).toEqual([]);
    return { shown, workflows };
  } catch (error) {
    if (SCRATCH) {
      await page.screenshot({ path: join(SCRATCH, `${name}-failed.png`), fullPage: true });
      console.log(`${name} failed at ${page.url()}\n${await page.locator("body").innerText()}`);
    }
    throw error;
  } finally {
    await page.close();
  }
}

test("live /schedules: capture then apply files a run receipt", async () => {
  const { shown, workflows } = await liveLoop("schedules", async (page) => {
    const pod = await openLive(page, "/schedules", "demo=capture&live=1");
    // The user can see the session is simulated: the ladder popup's breadcrumb names the resolved
    // demo document (the document word left the sentence, MAP ruling 28), never "choose a session".
    await page.getByRole("button", { name: "Open page palette" }).click();
    const ladder = page.locator("[data-open]").filter({ hasText: "Isolated demo (simulated)" });
    await expect.poll(() => ladder.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => ladder.first().isVisible()).toBe(true);
    expect(await page.locator("body").innerText()).not.toContain("choose a session");
    await page.keyboard.press("Escape");
    await go(page, `${page.url()}&pod=${pod}`);
    // The schedule list is the Situation's Ladder, opened by Ctrl K (MAP rulings 19, 23).
    await page.getByRole("button", { name: "Open page palette" }).click();
    await page
      .getByRole("option", { name: /DX Fan Coil Unit Schedule/ })
      .first()
      .click();
    await run(page, "capture schedule");
    const path = await landed(page, /^settings\/schedules\/schedule-481223-.*\.json$/);
    // Apply is an Applying verb; with no cell staged it names the opened spec (ruling 41).
    await go(page, `${page.url()}&stage=apply`);
    await run(page, "apply spec");
    await logged(page, "apply", "ran");
    return receiptOnPods(page, pod, path, "schedule.apply");
  });
  expect(shown).toContain("Succeeded");
  // Every capture writes a run: the capture's own run sits on this member beside the apply's.
  expect(shown).toContain("schedule.capture");
  expect(workflows).toEqual(["schedule.capture", "schedule.apply"]);
}, 180_000);

test("live /family: capture, then apply twice (plan, send) files a run receipt", async () => {
  const { shown, workflows } = await liveLoop("family", async (page) => {
    const pod = await openLive(page, "/family", "demo=capture&live=1");
    await go(page, `${page.url()}&pod=${pod}`);
    await run(page, "capture family");
    const path = await landed(page, /^settings\/family\/Simulated-demo-family-.*\.json$/);
    // The capture's receipt is a log row whose label opens the member it filed.
    await logged(page, "captured 1 family", path);
    if (SCRATCH) await page.screenshot({ path: join(SCRATCH, "family-captured.png") });
    // Apply is an Applying verb: press 1 plans and opens the sheet (ruling 35).
    await go(page, `${page.url()}&stage=apply`);
    await run(page, "apply");
    await applySheet(page);
    // The log prints the verb the user pressed, never the action key (w4-revit defect 9).
    await logged(page, "apply", "ran");
    // The owner answers the lamp's host-status read, so the head names no broken host.
    expect(await page.locator("body").innerText()).not.toContain("unreachable");
    return receiptOnPods(page, pod, path, "family.apply");
  });
  expect(shown).toContain("Succeeded");
  // The capture filed a run of its own on this member: that run holds the unmodeled facts.
  expect(shown).toContain("family.capture");
  // The seeded draft already holds a reading, so arrival reads nothing; the one capture saves it.
  expect(workflows).toEqual(["family.capture", "family.plan", "family.apply"]);
}, 180_000);

async function readMechanicalFamilies(page: Page, expectedValue = "Fan Coil Unit - Ducted model") {
  await page.getByRole("button", { name: "Choose category" }).click();
  await page
    .getByRole("option", { name: /Mechanical Equipment/ })
    .first()
    .click();
  // The multi-pick list stays open and, in the docked Situation, covers the verbs; Esc folds it.
  await page.keyboard.press("Escape");
  await run(page, "read families");
  await expectModelValue(page, "Fan Coil Unit - Ducted", expectedValue);
}

const modelCell = (page: Page, family: string) =>
  page
    .getByRole("gridcell", { name: `PE_G___Model · ${family} · Type 1`, exact: true })
    .locator("input");

const expectModelValue = (page: Page, family: string, value: string) =>
  expect.poll(() => modelCell(page, family).inputValue(), { timeout: 30_000 }).toBe(value);

test("/families Archived inspects a saved reading without a target or Revit connection", async () => {
  const work = bindWork("families", address("C:/archive/Offline.rvt"));
  const parameter = (name: string, value: string) => ({
    definition: {
      identity: { key: `name:${name}`, kind: "NameFallback", name },
      isInstance: false,
    },
    kind: "FamilyParameter",
    scope: "Family",
    storageType: "String",
    formulaState: "None",
    valuesPerType: { "24x24": value },
  });
  const saved = await hostTakeoffCaptures().saveFamilies({
    work,
    document: { session: "closed-session", openId: "closed-document" },
    filter: { categoryNames: ["Air Terminals"], familyNames: [], placementScope: "AllLoaded" },
    capturedAt: "2026-09-22T12:00:00.000Z",
    result: {
      families: [
        {
          familyId: 1,
          familyUniqueId: "offline-family",
          familyName: "Offline diffuser",
          categoryName: "Air Terminals",
          typeNames: ["24x24"],
          parameters: [parameter("Model", "ARCH-1"), parameter("Only unplaced", "Unplaced")],
          issues: [],
          isPartial: false,
          placedInstanceCount: 0,
        },
        {
          familyId: 2,
          familyUniqueId: "placed-family",
          familyName: "Placed_Diffuser-2",
          categoryName: "Air Terminals",
          typeNames: ["24x24"],
          parameters: [parameter("Model", "ARCH-2")],
          issues: [],
          isPartial: false,
          placedInstanceCount: 2,
        },
      ],
      issues: [{ code: "FamilyEditWarning", severity: "Warning", message: "saved warning" }],
      page: { totalCount: 2, returnedCount: 2, isTruncated: false },
    },
  });
  const { shown } = await liveLoop("families-archive-offline", async (page) => {
    const writes: string[] = [];
    page.on("request", (request: { method(): string; url(): string; postDataJSON(): unknown }) => {
      if (request.method() !== "POST") return;
      if (request.url().includes("/families/readings")) writes.push("families.read");
      if (request.url().includes("/pe/route-state/")) writes.push("work.write");
      if (request.url().endsWith("/actions")) writes.push("action.write");
      if (request.url().endsWith("/call"))
        writes.push((request.postDataJSON() as { key?: string }).key ?? "unknown call");
    });
    await go(page, `${baseUrl}/families?stage=archived`);
    await expect
      .poll(
        () =>
          page.getByRole("columnheader", { name: "Offline diffuser · 24x24", exact: true }).count(),
        { timeout: 30_000 },
      )
      .toBe(1);
    const rules = page.getByRole("combobox", { name: "table query" });
    await setQuery(page, "!absent placed>0");
    await expect
      .poll(() =>
        page.getByRole("columnheader", { name: "Offline diffuser · 24x24", exact: true }).count(),
      )
      .toBe(0);
    expect(await page.getByRole("rowheader", { name: "Only unplaced", exact: true }).count()).toBe(
      0,
    );
    await setQuery(page, "fams>=2");
    expect(await page.getByRole("rowheader", { name: "Only unplaced", exact: true }).count()).toBe(
      0,
    );
    await setQuery(page, "!empty !absent family!=Placed_Diffuser-2");
    expect(
      await page
        .getByRole("columnheader", { name: "Placed_Diffuser-2 · 24x24", exact: true })
        .count(),
    ).toBe(0);
    await page
      .getByRole("button", {
        name: 'Remove the "family is not Placed_Diffuser-2" narrowing',
      })
      .click();
    await expect
      .poll(() =>
        page.getByRole("columnheader", { name: "Placed_Diffuser-2 · 24x24", exact: true }).count(),
      )
      .toBe(1);
    await setQuery(page, 'family!="Offline diffuser"');
    expect(
      await page
        .getByRole("columnheader", { name: "Offline diffuser · 24x24", exact: true })
        .count(),
    ).toBe(0);
    // An empty, focused box offers every field (MAP ruling 22).
    await rules.fill("");
    await rules.click();
    await expect.poll(() => page.getByRole("option", { name: /^fams/ }).count()).toBe(1);
    await setQuery(page, "!empty !absent");
    const savedCell = page.getByRole("gridcell", {
      name: "Model · Offline diffuser · 24x24",
      exact: true,
    });
    await expect.poll(() => savedCell.innerText()).toContain("ARCH-1");
    expect(await savedCell.locator("input").count()).toBe(0);
    const body = await page.locator("body").innerText();
    expect(new URL(page.url()).searchParams.get("target")).toBeNull();
    expect(body).toContain("Offline.rvt");
    expect(await page.getByRole("textbox").count()).toBe(0);
    expect(
      await page.getByRole("button", { name: /^read families|^plan|^apply families/ }).count(),
    ).toBe(0);
    // The shared shell may list Pods; Archive itself dispatches no native or Work action.
    expect(writes.every((key) => key === "pod.list")).toBe(true);
    expect(writes).not.toContain("families.read");
    expect(writes).not.toContain("work.write");
    expect(writes.filter((key) => key.startsWith("revit.") || key === "family.open")).toEqual([]);
    return saved.id;
  });
  expect(shown).toBe(saved.id);
}, 180_000);

/**
 * THE EDITABLE TABLE, on keyed cells. Two cells are typed across two families: a typed value
 * stages directly, and it survives a reload. Typing one back to Revit's value clears its stage.
 * PLAN takes the staged cell only, generates one patch draft for that family, files nothing, and
 * plans exactly that family's id from the draft's bytes. Apply names that plan; after the native
 * apply succeeds the host retires the unchanged staged cell, and `/pods` shows the run under the
 * draft's name as a supplied draft, not a saved member.
 */
test("live /families: retained readback supports repeat and consecutive family plans", async () => {
  const { shown, workflows } = await liveLoop("families-table", async (page) => {
    let fullReads = 0;
    page.on("request", (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && request.url().includes("/families/readings")) fullReads++;
    });
    const pod = await openLive(page, "/families", "demo=edit&live=1");
    await go(page, `${page.url()}&pod=${pod}`);
    await readMechanicalFamilies(page);
    // The read dirties the matrix Reading: the log grows its tab (MAP ruling 3).
    await expect
      .poll(() => page.locator('[aria-label="log kind"] button').allInnerTexts(), {
        timeout: 30_000,
      })
      .toContain("matrix");
    if (SCRATCH)
      await page
        .locator('section[aria-label="Situation"]')
        .screenshot({ path: join(SCRATCH, "families-read.png") });
    // The Situation's Work sentence ("2 cells staged by you, 1 proposed by Pea · …"); none when
    // nothing is pending.
    const band = (open: number, staged: number) => {
      const says = [
        staged ? `${staged} cell${staged === 1 ? "" : "s"} staged by you` : "",
        open ? `${open} proposed by Pea` : "",
      ].filter(Boolean);
      return expect
        .poll(() => page.locator('[data-slot="situation-band"]').innerText(), { timeout: 30_000 })
        .toMatch(
          says.length ? new RegExp(`^${says.join(", ")}( ·|$)`) : /^(?![\s\S]*by (you|Pea))/,
        );
    };
    const type = async (family: string, current: string, next: string) => {
      const cell = modelCell(page, family);
      await expectModelValue(page, family, current);
      await cell.fill(next);
      await cell.press("Enter");
      // Edit one cell at a time, as a person does, and wait for Work to show each value.
      await expectModelValue(page, family, next);
    };
    let typed = 0;
    for (const [family, next] of [
      ["Fan Coil Unit - Ducted", "FXMQ20"],
      ["Heat Pump - Split", "RXL30"],
    ]) {
      await type(family, `${family} model`, next!);
      typed += 1;
      await band(0, typed);
    }
    // Staged cells are Work, not page memory: a reload still finds them.
    await page.reload({ waitUntil: "domcontentloaded" });
    await pinSituation(page);
    await band(0, 2);
    const auditUrl = new URL(page.url());
    auditUrl.searchParams.set("stage", "audit");
    await go(page, auditUrl.href);
    // The host's retained matrix restores without another expensive Read.
    await expectModelValue(page, "Fan Coil Unit - Ducted", "FXMQ20");
    // Typing a cell back to Revit's value clears its stage: it shows Revit's value again.
    await type("Heat Pump - Split", "RXL30", "Heat Pump - Split model");
    await band(0, 1);
    await expectModelValue(page, "Heat Pump - Split", "Heat Pump - Split model");
    if (SCRATCH)
      await page.screenshot({ path: join(SCRATCH, "families-table-staged.png"), fullPage: true });
    await run(page, "apply");
    if (SCRATCH)
      await page.screenshot({ path: join(SCRATCH, "families-table-plan.png"), fullPage: true });
    let releaseReadback!: () => void;
    const heldReadback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    let readbackRequested = false;
    await page.route(
      "**/families/readings?*",
      async (route: { request(): { url(): string }; continue(): Promise<void> }) => {
        if (!route.request().url().includes("id=")) return route.continue();
        readbackRequested = true;
        await heldReadback;
        await route.continue();
      },
    );
    await applySheet(page);
    await expect.poll(() => readbackRequested, { timeout: 30_000 }).toBe(true);
    await page.getByRole("combobox", { name: "table query" }).fill("parameter~model ");
    releaseReadback();
    // The owner changes simulated native state; the Host's targeted matrix readback, not the
    // staged input, supplies the value that the table draws after apply.
    await expectModelValue(page, "Fan Coil Unit - Ducted", "FXMQ20");
    // The apply is one log row; the simulated engine writes no bundle, so it links nothing.
    await logged(page, "apply 1 family · 1 converged", "no artifacts on disk");
    if (SCRATCH) await page.screenshot({ path: join(SCRATCH, "families-applied.png") });
    await expect
      .poll(() =>
        page.getByRole("button", { name: "parameter contains model", exact: true }).count(),
      )
      .toBe(1);
    // The retained post-apply observation keeps the original Work baseline. Plan two separate
    // families from it; applying the first must not make the second plan unusable.
    await type("Fan Coil Unit - Ducted", "FXMQ20", "FXMQ21");
    await type("Heat Pump - Split", "Heat Pump - Split model", "RXL31");
    await band(0, 2);
    await run(page, "apply");
    await applySheet(page);
    await expectModelValue(page, "Fan Coil Unit - Ducted", "FXMQ21");
    await expectModelValue(page, "Heat Pump - Split", "RXL31");
    await band(0, 0);
    expect(fullReads).toBe(1);
    // Plan filed no spec nobody authored: the page names no member.
    expect(new URL(page.url()).searchParams.get("path") ?? "").toBe("");
    await logged(page, "apply", "ran");
    // The applied, unchanged staged cell retired: the sentence is gone; the receipt is the record.
    await band(0, 0);
    // The run is filed under the draft's name; `/pods` browses members, and none was filed.
    // A string, so vitest leaves the page's own dynamic import alone.
    const runs = (await page.evaluate(
      `import("/src/host/pods.ts").then((m) => m.listRuns(${JSON.stringify(pod)}, "staged/Fan-Coil-Unit---Ducted.json"))`,
    )) as { receipt: unknown }[];
    const members = await receiptOnPods(page, pod, "", "Members");
    expect(members).not.toContain("staged");
    return JSON.stringify(runs.map((r) => r.receipt));
  });
  expect(JSON.parse(shown)).toEqual([
    expect.objectContaining({
      operation: "families.apply",
      outcome: "Succeeded",
      podId: null,
      origin: "SuppliedDraft",
      memberPath: null,
      memberSha256: null,
    }),
    expect.objectContaining({
      operation: "families.apply",
      outcome: "Succeeded",
      podId: null,
      origin: "SuppliedDraft",
      memberPath: null,
      memberSha256: null,
    }),
  ]);
  // The second review planned and applied both families from the retained readback.
  expect(workflows).toEqual([
    "families.plan",
    "families.apply",
    "families.plan",
    "families.plan",
    "families.apply",
    "families.apply",
  ]);
}, 180_000);
