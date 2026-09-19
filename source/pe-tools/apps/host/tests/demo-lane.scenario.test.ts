/**
 * THE PROOF LANE, in a real browser against the real host. Two halves:
 *
 * - Frozen: every route manifest that declares `seeds`, every `[action, seed]` pair. `?demo=<action>`
 *   mounts the seed read-only (`useRoute` refuses every action with "frozen seed is read-only"), so
 *   this proves render and parity: the head renders, every verb is disabled with that sentence,
 *   nothing throws and nothing is POSTed. Seeds are enumerated from the manifests themselves.
 * - Live: `?demo=<seed>&live=1` routes the page's host traffic to a simulated demo owner, so one
 *   capture → (plan →) apply loop per product route runs end to end and `/pods` shows its receipt.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { devHostProxy } from "../../web/dev-proxy.ts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive } from "../src/mastra-runtime.ts";

type AnyManifest = {
  key: string;
  name: string;
  actions: Record<string, { label: string }>;
  seeds?: Record<string, { title: string }>;
};

/**
 * The manifests are loaded THROUGH VITE, not imported: `apps/host` compiles on nodenext and a web
 * module's extensionless `#/` specifier does not resolve there (see review-0910/reconcile.md). One
 * dev server, loaded once at collection time, gives the same objects the browser will mount — so a
 * new seed on any manifest is a new test here with no edit to this file.
 */
const webRoot = resolve(import.meta.dirname, "..", "..", "web");
const vite = await createViteServer({
  root: webRoot,
  configFile: join(webRoot, "vite.config.ts"),
  server: { hmr: false, middlewareMode: true },
});
const load = async (module: string): Promise<Record<string, unknown>> =>
  (await vite.ssrLoadModule(module)) as Record<string, unknown>;
type Factory = (deps: unknown) => AnyManifest;

/** Route path per manifest; `key` is the manifest's word, the path is the router's. */
const ROUTES: readonly { path: string; manifest: AnyManifest }[] = [
  {
    path: "/chat",
    manifest: ((await load("/src/chat/manifest.ts")).chatManifest as Factory)({ thread: "" }),
  },
  {
    path: "/instances",
    manifest: (await load("/src/instances/manifest.ts")).instancesManifest as AnyManifest,
  },
  { path: "/takeoffs", manifest: (await load("/src/takeoff/manifest.ts")).manifest as AnyManifest },
  {
    path: "/family",
    manifest: ((await load("/src/route/family/manifest.ts")).familyManifest as () => AnyManifest)(),
  },
  {
    path: "/families",
    manifest: (await load("/src/families/manifest.ts")).manifest as AnyManifest,
  },
  {
    path: "/schedules",
    manifest: (
      (await load("/src/route/schedules/manifest.ts")).schedulesManifest as () => AnyManifest
    )(),
  },
];

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
// biome-ignore lint/suspicious/noExplicitAny: playwright-core is imported by URL, untyped here.
let browser: { close(): Promise<void>; newPage(): Promise<any> } | undefined;
let hostDone: Promise<unknown> | undefined;
let serviceToken = "";
let browserVite: Awaited<ReturnType<typeof createViteServer>> | undefined;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "pe-demo-lane-"));
  const databasePath = join(mkdtempSync(join(tmpdir(), "pe-demo-db-")), "demo-lane.db");
  const nodeServer = createNodeServer();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            lifecycle: { handle, latch },
            // The demo lane never asks the model anything; the runtime only has to boot.
            mastraLayer: makeMastraRuntimeLive({ revit: false }, undefined, async () =>
              createDeterministicRuntime({
                databasePath,
                resourceId: resolvePeaWorld().id,
                responses: [],
              }),
            ),
            nodeServer,
            port: 0,
            webRoot: null,
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
      port: 0,
      hmr: false,
      proxy: devHostProxy(`http://127.0.0.1:${service.port}`),
    },
  });
  await browserVite.listen();
  baseUrl = browserVite.resolvedUrls!.local[0]!.replace(/\/$/, "");
  const playwrightUrl = pathToFileURL(
    resolve(
      import.meta.dirname,
      "../../../node_modules/.pnpm/node_modules/playwright-core/index.mjs",
    ),
  );
  const { chromium } = await import(playwrightUrl.href);
  const executablePath = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  if (!executablePath) throw new Error("the demo lane needs Chrome or Edge");
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await fetch(`${hostUrl}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": serviceToken },
  }).catch(() => undefined);
  await hostDone;
  await browserVite?.close();
  await vite.close();
}, 200_000);

for (const { path, manifest } of ROUTES)
  for (const [action, seed] of Object.entries(manifest.seeds ?? {})) {
    if (!seed) continue;
    test(`${manifest.key} ?demo=${action}`, async () => {
      const page = await browser!.newPage();
      // What the demo lane must not do: throw, log an error, or write anything. Route BODIES
      // outside the primitive still issue live host queries that 4xx/5xx without Revit, and the
      // browser logs one resource line per such response; those are not the primitive's.
      const errors: string[] = [];
      const posts: string[] = [];
      page.on("pageerror", (error: { message: string }) =>
        errors.push(`page error: ${error.message}`),
      );
      page.on("console", (message: { type(): string; text(): string }) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
          errors.push(message.text());
      });
      // The two write lanes: a semantic action's receipt (`/actions`) and a route-state write
      // (`/route-state/...`). Route BODIES outside the primitive still POST `/call` to read the
      // live host under a seed; that is an owed cut, not a write, so it is not asserted here.
      page.on("request", (request: { method(): string; url(): string }) => {
        const url = request.url();
        if (request.method() === "POST" && /\/(actions|route-state)/.test(url)) posts.push(url);
      });
      try {
        await page.goto(`${baseUrl}${path}?demo=${encodeURIComponent(action)}`, {
          waitUntil: "domcontentloaded",
        });
        // 1. The head is drawn: the shell's own landmark, or the Situation an entity route
        // draws in its place, whatever the body prints as a title.
        const head = page
          .getByRole("region", { name: `${manifest.name} route` })
          .or(page.getByRole("region", { name: "Situation" }));
        await expect.poll(() => head.count(), { timeout: 30_000 }).toBeGreaterThan(0);
        // 2. Where the route draws the shared Situation's verb row (the rest still wear the
        // shell head), its meter says the seeded Work revision: a seed IS the Work, so r0.
        const body = page.locator("body");
        if ((await page.getByRole("button", { name: /verbs$/ }).count()) > 0)
          await expect.poll(() => body.innerText(), { timeout: 15_000 }).toContain("r0");
        // 3. Every verb the head draws is disabled by the one sentence the primitive refuses a
        // seed with. Nothing here can run, so nothing here is clicked.
        let checked = 0;
        for (const [name, spec] of Object.entries(manifest.actions)) {
          // A verb's name is its label and its count; body buttons may share the first word.
          const verb = head
            .first()
            .getByRole("button", { name: new RegExp(`^${spec.label}(?: ?d+)?$`) })
            .first();
          if ((await verb.count()) === 0) continue;
          checked += 1;
          expect(
            await verb.getAttribute("aria-disabled"),
            `${manifest.key}.${name} is operable under a frozen seed`,
          ).toBe("true");
          // The title is the refusal, then the verb's chord when it has one.
          expect(
            await verb.getAttribute("title"),
            `${manifest.key}.${name} refusal sentence`,
          ).toMatch(/^frozen seed is read-only(?: · |$)/);
        }
        expect(checked, `${manifest.key}.${action} drew no verb to check`).toBeGreaterThan(0);
        expect(errors, `${manifest.key}.${action} threw or logged`).toEqual([]);
        expect(posts, `${manifest.key}.${action} wrote under a frozen seed`).toEqual([]);
      } finally {
        await page.close();
      }
    }, 120_000);
  }

/**
 * THE LIVE LANE. `?demo=<seed>&live=1` runs the route's real code against a simulated demo owner:
 * capture files a new member into the owner's pod, apply files `output/<run>/receipt.json` there,
 * and `/pods` shows that receipt for the member. One loop per product route.
 */
// biome-ignore lint/suspicious/noExplicitAny: playwright-core is imported by URL, untyped here.
type Page = any;

const SCRATCH = process.env.PE_DEMO_LANE_SHOTS;

async function openLive(page: Page, path: string, query: string) {
  await page.goto(`${baseUrl}${path}?${query}`, { waitUntil: "domcontentloaded" });
  // The lane creates the owner, then reloads bound to its one session.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("target"), { timeout: 30_000 })
    .toMatch(/^demo-/);
  return new URL(page.url()).searchParams.get("target")!;
}

const verb = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^${label}`) }).first();

async function run(page: Page, label: string) {
  const button = verb(page, label);
  await expect
    .poll(
      async () =>
        `${await button.getAttribute("aria-disabled")} ${await button.getAttribute("title")}`,
      {
        timeout: 30_000,
      },
    )
    .toMatch(/^false /);
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
    const pod = await openLive(page, "/schedules", "demo=push&live=1");
    // The Situation's ladder names the resolved target, not "choose a session".
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 30_000 })
      .toContain("Auditing schedule in Isolated demo (simulated)");
    await page.goto(`${page.url()}&pod=${pod}`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("option", { name: /DX Fan Coil Unit Schedule/ })
      .first()
      .click();
    await run(page, "capture schedule");
    const path = await landed(page, /^settings\/schedules\/schedule-481223-.*\.json$/);
    await run(page, "apply schedule");
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 30_000 })
      .toContain("apply schedule ran");
    return receiptOnPods(page, pod, path, "schedule.apply");
  });
  expect(shown).toContain("Succeeded");
  // Every capture writes a run: the capture's own run sits on this member beside the apply's.
  expect(shown).toContain("schedule.capture");
  expect(workflows).toEqual(["schedule.capture", "schedule.apply"]);
}, 180_000);

test("live /family: capture, plan, apply files a run receipt", async () => {
  const { shown, workflows } = await liveLoop("family", async (page) => {
    const pod = await openLive(page, "/family", "demo=capture&live=1");
    await page.goto(`${page.url()}&pod=${pod}`, { waitUntil: "domcontentloaded" });
    await run(page, "capture family");
    const path = await landed(page, /^settings\/family\/Simulated-demo-family-.*\.json$/);
    await run(page, "plan");
    await applySheet(page);
    // The log prints the verb the user pressed, never the action key (w4-revit defect 9).
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 30_000 })
      .toContain("apply family ran");
    // The owner answers the lamp's host-status read, so the head names no broken host.
    expect(await page.locator("body").innerText()).not.toContain("unreachable");
    return receiptOnPods(page, pod, path, "family.apply");
  });
  expect(shown).toContain("Succeeded");
  // The capture filed a run of its own on this member: that run holds the unmodeled facts.
  expect(shown).toContain("family.capture");
  // The first capture is the audit's live read into the draft (no pod); the second saves the draft.
  expect(workflows).toEqual(["family.capture", "family.capture", "family.plan", "family.apply"]);
}, 180_000);

/**
 * w8-revit trip 9: the page dispatched the loaded-families catalog twice a second. Over a quiet
 * wait the page reads categories once from field-options and the matrix once, and one scope change
 * reads the catalog once. Counted on the wire, by op key.
 */
test("live /families: one catalog read per scope change, none while idle", async () => {
  const { shown } = await liveLoop("families-reads", async (page) => {
    const calls: string[] = [];
    page.on("request", (request: { method(): string; url(): string; postDataJSON(): unknown }) => {
      if (request.method() === "POST" && request.url().endsWith("/call"))
        calls.push((request.postDataJSON() as { key: string }).key);
    });
    await openLive(page, "/families", "demo=edit&live=1");
    const count = (key: string) => calls.filter((call) => call === key).length;
    // The categories picker is a ListPopup: its trigger opens a list whose search owns typing.
    const trigger = page.getByRole("button", { name: "draft categories" });
    await expect.poll(() => trigger.count(), { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(3_000);
    const idle = {
      options: count("revit.catalog.field-options"),
      catalog: count("revit.catalog.loaded-families"),
      matrix: count("revit.matrix.loaded-families"),
    };
    await trigger.click();
    const search = page.getByLabel("draft categories search");
    await search.fill("Mech");
    await search.press("Enter");
    await expect
      .poll(() => count("revit.catalog.loaded-families"), { timeout: 10_000 })
      .toBe(idle.catalog + 1);
    await page.waitForTimeout(3_000);
    return JSON.stringify({
      idle,
      afterScope: {
        options: count("revit.catalog.field-options"),
        catalog: count("revit.catalog.loaded-families"),
        matrix: count("revit.matrix.loaded-families"),
      },
    });
  });
  console.log(`families-reads ${shown}`);
  const { idle, afterScope } = JSON.parse(shown) as Record<string, Record<string, number>>;
  expect(idle!.options).toBe(1);
  expect(idle!.catalog).toBe(0);
  expect(idle!.matrix).toBe(1);
  expect(afterScope).toEqual({ ...idle, catalog: 1 });
}, 180_000);

/**
 * THE EDITABLE TABLE, on keyed cells. Two cells are typed across two families: a typed value
 * stages directly, and it survives a reload. Typing one back to Revit's value clears its stage.
 * PLAN takes the staged cell only, generates one patch draft for that family, files nothing, and
 * plans exactly that family's id from the draft's bytes. Apply names that plan; after the native
 * apply succeeds the host retires the unchanged staged cell, and `/pods` shows the run under the
 * draft's name as a supplied draft, not a saved member.
 */
test("live /families: typed cells stage, one is typed back, plan and apply retire the other", async () => {
  const { shown, workflows } = await liveLoop("families-table", async (page) => {
    const pod = await openLive(page, "/families", "demo=edit&live=1");
    await page.goto(`${page.url()}&pod=${pod}`, { waitUntil: "domcontentloaded" });
    const body = page.locator("body");
    const band = (open: number, staged: number) =>
      expect
        .poll(() => page.locator('section[aria-label="proposals"]').innerText(), {
          timeout: 30_000,
        })
        .toMatch(new RegExp(`${open} open[\\s\\S]*${staged} staged`));
    const type = async (current: string, next: string) => {
      const cell = page.locator(`input[value="${current}"]`).first();
      await expect.poll(() => cell.count(), { timeout: 30_000 }).toBe(1);
      await cell.fill(next);
      await cell.press("Enter");
      // Edit one cell at a time, as a person does: the table rebuilds when Work lands, and text
      // typed into a cell mid-rebuild is lost with the input (owed, not a Work loss).
      await expect
        .poll(() => page.locator(`input[value="${next}"]`).count(), { timeout: 30_000 })
        .toBe(1);
    };
    let typed = 0;
    for (const [family, next] of [
      ["Fan Coil Unit - Ducted", "FXMQ20"],
      ["Heat Pump - Split", "RXL30"],
    ]) {
      await type(`${family} model`, next!);
      typed += 1;
      await band(0, typed);
    }
    // Staged cells are Work, not page memory: a reload still finds them.
    await page.reload({ waitUntil: "domcontentloaded" });
    await band(0, 2);
    // Typing a cell back to Revit's value clears its stage: it shows Revit's value again.
    await type("RXL30", "Heat Pump - Split model");
    await band(0, 1);
    await expect.poll(() => page.locator('input[value="Heat Pump - Split model"]').count()).toBe(1);
    if (SCRATCH)
      await page.screenshot({ path: join(SCRATCH, "families-table-staged.png"), fullPage: true });
    await run(page, "plan");
    if (SCRATCH)
      await page.screenshot({ path: join(SCRATCH, "families-table-plan.png"), fullPage: true });
    await applySheet(page);
    // Plan filed no spec nobody authored: the page names no member.
    expect(new URL(page.url()).searchParams.get("path") ?? "").toBe("");
    await expect.poll(() => body.innerText(), { timeout: 30_000 }).toContain("apply families ran");
    // The applied, unchanged staged cell retired: the band reads empty (it stays mounted, so the
    // grid never moves, F-R4-1); the receipt is the record.
    await band(0, 0);
    // The run is filed under the draft's name; `/pods` browses members, and none was filed.
    // A string, so vitest leaves the page's own dynamic import alone.
    const runs = (await page.evaluate(
      `import("/src/host/pods.ts").then((m) => m.listRuns(${JSON.stringify(pod)}, "staged/Fan-Coil-Unit---Ducted.json"))`,
    )) as { receipt: unknown }[];
    const members = await receiptOnPods(page, pod, "", "MEMBERS");
    expect(members).not.toContain("staged");
    return JSON.stringify(runs.map((r) => r.receipt));
  });
  expect(JSON.parse(shown)).toEqual([
    expect.objectContaining({
      operation: "families.apply",
      outcome: "Succeeded",
      origin: "SuppliedDraft",
      memberSha256: null,
    }),
  ]);
  // One plan and one apply for the one staged family: the cleared one never reached the wire.
  expect(workflows).toEqual(["families.plan", "families.apply"]);
}, 180_000);

test("live /families: capture, plan, apply files a run receipt", async () => {
  const { shown, workflows } = await liveLoop("families", async (page) => {
    const pod = await openLive(page, "/families", "demo=capture&live=1");
    await page.goto(`${page.url()}&pod=${pod}`, { waitUntil: "domcontentloaded" });
    // A row click picks it into the capture set (the master table's selection).
    await page.getByRole("row").filter({ hasText: "Fan Coil Unit - Ducted" }).first().click();
    await run(page, "capture families");
    const path = await landed(page, /^settings\/families\/Fan-Coil-Unit-+Ducted-.*\.json$/);
    // The captured family model is itself a families spec: plan and apply it.
    await run(page, "plan");
    await applySheet(page);
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 30_000 })
      .toContain("apply families ran");
    return receiptOnPods(page, pod, path, "families.apply");
  });
  expect(shown).toContain("Succeeded");
  expect(workflows).toEqual(["families.capture", "families.plan", "families.apply"]);
}, 180_000);
