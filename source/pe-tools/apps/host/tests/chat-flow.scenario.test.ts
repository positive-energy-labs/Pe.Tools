import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Layer } from "effect";
import { createServer as createViteServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { configurePeaProductToolContext, peDo, peFind, peRead } from "@pe/mcps";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive, type RuntimeFactory } from "../src/mastra-runtime.ts";
import { isUserTurn } from "../../web/src/workbench/chat-state.ts";

const approvalFinalText = "APPROVAL_TURN_FINISHED";
const approvalToolValue = "MASTER_SCENARIO_TOOL";
const questionText = "Which Revit session should Pea use?";
const questionAnswer = "Revit 2025";
const questionFinalText = "QUESTION_TURN_FINISHED";
const findFinalText = "FIND_TURN_FINISHED";
const readFinalText = "READ_TURN_FINISHED";
const proposeFinalText = "PROPOSE_TURN_FINISHED";
const stopFinalText = "STOP_TURN_FINISHED";
const scopeSession = "pe.app-25";
const scopeDocument = "C:\\Models\\Scenario.rvt";
const abortedText = "VISIBLE_BEFORE_ABORT";
type AttributeElement = { getAttribute(name: string): string | null };
type ThreadMessage = Parameters<typeof isUserTurn>[0];

const preseeded = Array.from({ length: 30 }, (_, index) => ({
  id: `seed-${String(index + 1).padStart(2, "0")}`,
  role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `SEEDED_${String(index + 1).padStart(2, "0")}`,
}));

function scenarioRuntime(
  databasePath: string,
  preseed?: { threadId: string; messages: typeof preseeded },
): RuntimeFactory {
  return async (options) => {
    const world = resolvePeaWorld();
    // The three doors are the real product tools; only the model is deterministic.
    configurePeaProductToolContext({ hostBaseUrl: options.hostBaseUrl });
    return createDeterministicRuntime({
      databasePath,
      resourceId: world.id,
      tools: { pe_find: peFind, pe_read: peRead, pe_do: peDo },
      responses: [
        { toolCall: { name: "scenario_approval", input: { value: approvalToolValue } } },
        { text: approvalFinalText },
        {
          toolCall: {
            name: "ask_user",
            input: {
              question: questionText,
              options: [
                { label: "Revit 2024", description: "Use the older session" },
                { label: questionAnswer, description: "Use the current session" },
              ],
              selectionMode: "single_select",
            },
          },
        },
        { text: questionFinalText },
        { toolCall: { name: "pe_find", input: { limit: 8 } } },
        { text: findFinalText },
        { toolCall: { name: "pe_read", input: { key: "route:instances" } } },
        { text: readFinalText },
        {
          toolCall: {
            name: "pe_do",
            input: {
              key: "route:instances.propose",
              expectedRevision: 0,
              input: {
                patches: [
                  { path: ["staged"], value: { kind: "start", year: "2026", name: "scenario" } },
                ],
              },
            },
          },
        },
        { text: proposeFinalText },
        { toolCall: { name: "pe_do", input: { key: "route:instances.stop" } } },
        { text: stopFinalText },
        { text: abortedText, finishDelayMs: 10_000 },
      ],
      preseed,
    });
  };
}

async function waitForService(appBase: string, previousToken?: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const file = await readServiceFile(appBase, hostOwnership.serviceName);
    if (file && file.token !== previousToken) return file;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("service file did not appear");
}

async function launchHost(options: {
  databasePath: string;
  port: number;
  preseed?: { threadId: string; messages: typeof preseeded };
  previousToken?: string;
  vite: Awaited<ReturnType<typeof createViteServer>>;
}) {
  const nodeServer = createNodeServer();
  const appBase = productRoot();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      yield* Effect.raceFirst(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: false },
            includeInstallConverge: false,
            lifecycle: { handle, latch },
            mastraLayer: makeMastraRuntimeLive(
              { revit: false },
              undefined,
              scenarioRuntime(options.databasePath, options.preseed),
            ),
            nodeServer,
            port: options.port,
            viteServer: options.vite,
            webRoot: null,
          }),
        ),
        Deferred.await(latch),
      );
    }),
  );
  const done = Effect.runPromise(program);
  const service = await waitForService(appBase, options.previousToken);
  return { done, service };
}

async function stopHost(host: Awaited<ReturnType<typeof launchHost>>) {
  await fetch(`http://127.0.0.1:${host.service.port}/admin/shutdown`, {
    method: "POST",
    headers: { "x-pe-service-token": host.service.token },
  });
  await host.done;
}

test("the browser walks one durable chat lifecycle", async () => {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-chat-scenario-"));
  const databaseRoot = mkdtempSync(join(tmpdir(), "pe-chat-db-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;
  const databasePath = join(databaseRoot, "chat-flow.db");
  const threadId = crypto.randomUUID();
  const webRoot = resolve(import.meta.dirname, "..", "..", "web");
  const vite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    server: { hmr: false, middlewareMode: true },
  });
  let host: Awaited<ReturnType<typeof launchHost>> | undefined;
  let browser: { close(): Promise<void> } | undefined;

  try {
    host = await launchHost({
      databasePath,
      port: 0,
      preseed: { threadId, messages: preseeded },
      vite,
    });
    const baseUrl = `http://127.0.0.1:${host.service.port}`;
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
    if (!executablePath) throw new Error("chat scenario needs Chrome or Edge");
    const launched = await chromium.launch({ executablePath, headless: true });
    browser = launched;
    const page = await launched.newPage();
    const threadPath = `/pe/thread/${encodeURIComponent(threadId)}`;
    const bootRequests: string[] = [];
    let firstRowPainted = false;
    page.on("request", (request: { method(): string; url(): string }) => {
      if (firstRowPainted) return;
      const pathname = new URL(request.url()).pathname;
      const controllerBootCall =
        pathname.startsWith("/api/agent-controller/") && !pathname.endsWith("/stream");
      if (pathname === "/host/status" || pathname === threadPath || controllerBootCall)
        bootRequests.push(`${request.method()} ${pathname}`);
    });
    page.on("response", (response: { status(): number; url(): string }) => {
      if (new URL(response.url()).pathname === threadPath && response.status() === 200)
        firstRowPainted = true;
    });

    await page.goto(`${baseUrl}/chat?thread=${threadId}`, { waitUntil: "domcontentloaded" });
    let rows = page.getByRole("region", { name: /^(User|Assistant) message$/ });
    await rows.first().waitFor({ timeout: 15_000 });
    const initialRows = await rows.allTextContents();
    expect(initialRows).toHaveLength(preseeded.length);
    expect(
      initialRows.map(
        (text: string) => preseeded.find((message) => text.includes(message.text))?.text,
      ),
    ).toEqual(preseeded.map((message) => message.text));
    // R5: first transcript paint requires only host status, then the thread open/read.
    expect(bootRequests, "R5 first transcript paint request chain").toEqual([
      "GET /host/status",
      `GET ${threadPath}`,
    ]);

    const readThread = async () => {
      const response = await fetch(`${baseUrl}${threadPath}`);
      expect(response.status).toBe(200);
      return (await response.json()) as {
        access: string;
        messages: ThreadMessage[];
        models: { currentId?: string };
      };
    };
    const waitForRowText = (text: string) =>
      expect
        .poll(
          async () => (await rows.allTextContents()).some((row: string) => row.includes(text)),
          { timeout: 15_000 },
        )
        .toBe(true);
    const composer = page.getByRole("textbox", { name: "Message" });
    // The deterministic controller runs at the `ask` access level, so a door may prompt once;
    // approve it when it does, and stop when the turn's final text is on the page.
    const driveTurn = async (prompt: string, finalText: string) => {
      await composer.fill(prompt);
      await page.getByRole("button", { name: "Send message" }).click();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if ((await rows.allTextContents()).some((row: string) => row.includes(finalText))) {
          // Settled means the run ended, not just that the text painted; the next send needs that.
          await expect
            .poll(() => page.getByRole("button", { name: "Stop" }).count(), { timeout: 15_000 })
            .toBe(0);
          return;
        }
        const approve = page.getByRole("button", { name: "Approve" }).last();
        if ((await approve.count()) > 0) await approve.click().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      console.log(
        "DIAG thread tail",
        JSON.stringify((await readThread()).messages.slice(-1)).slice(0, 400),
      );
      throw new Error(`turn did not finish: ${finalText}`);
    };

    await composer.fill("APPROVAL_TURN");
    await page.getByRole("button", { name: "Send message" }).click();
    const approvalRow = page.getByRole("region", { name: "Assistant message" }).last();
    const approve = approvalRow.getByRole("button", { name: "Approve" });
    await approve.waitFor({ timeout: 15_000 });
    expect(await approvalRow.innerText()).toContain("Scenario Approval");
    await approve.click();
    await waitForRowText(approvalFinalText);
    // Display is stream-only now: the settled gate is proven by the DOM, not the body.
    await expect
      .poll(
        async () => ({
          stop: await page.getByRole("button", { name: "Stop" }).count(),
          gates: await page.getByRole("button", { name: /^(Approve|Deny)$/ }).count(),
        }),
        { timeout: 15_000 },
      )
      .toEqual({ stop: 0, gates: 0 });
    await expect
      .poll(async () => JSON.stringify((await readThread()).messages), { timeout: 15_000 })
      .toContain(`APPROVED:${approvalToolValue}`);

    await composer.fill("QUESTION_TURN");
    await page.getByRole("button", { name: "Send message" }).click();
    const questionRow = page.getByRole("region", { name: "Assistant message" }).last();
    await questionRow.getByRole("button", { name: "Approve" }).click();
    await waitForRowText(questionText);
    expect(await questionRow.innerText()).toContain("Use the current session");
    await questionRow.getByRole("button", { name: questionAnswer }).click();
    await waitForRowText(questionFinalText);
    await expect
      .poll(async () => JSON.stringify((await readThread()).messages), { timeout: 15_000 })
      .toContain(`User answered: ${questionAnswer}`);

    // Scope: the head sets it (PUT), the turn is admitted under that revision, the tool sees it,
    // and a route document lands under the same Scope key.
    const scopeUrl = `${baseUrl}/pe/scope/${encodeURIComponent(threadId)}`;
    expect(await (await fetch(scopeUrl)).json()).toEqual({
      scope: { kind: "none" },
      revision: 0,
    });
    const setScope = await fetch(scopeUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: { kind: "document", document: scopeDocument, pin: scopeSession },
        expectedRevision: 0,
      }),
    });
    expect(await setScope.json()).toEqual({
      ok: true,
      why: "set",
      head: {
        scope: { kind: "document", document: scopeDocument, pin: scopeSession },
        revision: 1,
      },
    });
    await expect
      .poll(() => page.getByTestId("scope-revision").innerText(), { timeout: 15_000 })
      .toBe("r1");
    // pe_find under that Scope: the map, the connected sessions (none), and the silent sources.
    await driveTurn("FIND_TURN", findFinalText);
    const findBody = JSON.stringify((await readThread()).messages);
    expect(findBody).toContain(`"pin":"${scopeSession}"`);
    expect(findBody).toContain('"revision":1');
    expect(findBody).toContain('"map":{');
    expect(findBody).toContain("route-command");
    // pe_read route:instances under that Scope: the document lands under the Scope key.
    await driveTurn("READ_TURN", readFinalText);
    expect(JSON.stringify((await readThread()).messages)).toContain('"key":"route:instances"');
    // pe_do route:instances.propose stages a start; the card shows r1 and the resolved target.
    await driveTurn("PROPOSE_TURN", proposeFinalText);
    await expect
      .poll(() => page.getByTestId("tool-revision").last().innerText(), { timeout: 15_000 })
      .toBe("r1");
    expect(await page.getByTestId("tool-target").last().innerText()).toContain(scopeSession);
    await expect
      .poll(async () => (await rows.allTextContents()).join("\n"), { timeout: 15_000 })
      .toContain("start scenario in Revit 2026");
    // pe_do route:instances.stop is human-only: refused with a hint, nothing runs.
    await driveTurn("STOP_TURN", stopFinalText);
    expect(JSON.stringify((await readThread()).messages)).toContain("human-only");
    const routeQuery = `doc=${encodeURIComponent(scopeDocument)}&pin=${scopeSession}`;
    expect(
      await (await fetch(`${baseUrl}/pe/route-state/instances?${routeQuery}`)).json(),
    ).toMatchObject({ revision: 1, doc: { staged: { kind: "start", name: "scenario" } } });
    const applied = await fetch(`${baseUrl}/pe/route-state/ops/apply?${routeQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patches: [{ path: ["bindings", "op"], value: { id: "revit.context.summary", label: "s" } }],
        expectedRevision: 0,
      }),
    });
    expect(await applied.json()).toMatchObject({ ok: true, revision: 1 });
    expect(await (await fetch(`${baseUrl}/pe/route-state/ops?${routeQuery}`)).json()).toMatchObject(
      {
        revision: 1,
        doc: { bindings: { op: { id: "revit.context.summary" } } },
      },
    );
    // The pin is a tiebreak, never identity: another pin reads the same document, another
    // document starts fresh.
    expect(
      await (
        await fetch(
          `${baseUrl}/pe/route-state/ops?pin=other&doc=${encodeURIComponent(scopeDocument)}`,
        )
      ).json(),
    ).toMatchObject({ revision: 1 });
    expect(
      await (
        await fetch(
          `${baseUrl}/pe/route-state/ops?doc=${encodeURIComponent("C:\\Models\\Other.rvt")}`,
        )
      ).json(),
    ).toMatchObject({ revision: 0 });

    await composer.fill("ABORT_TURN");
    await page.getByRole("button", { name: "Send message" }).click();
    await waitForRowText(abortedText);
    await page.getByRole("button", { name: "Stop" }).click();
    await expect
      .poll(async () => JSON.stringify((await readThread()).messages), { timeout: 15_000 })
      .toContain(abortedText);
    await expect
      .poll(() => page.getByRole("button", { name: "Stop" }).count(), { timeout: 15_000 })
      .toBe(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRowText(abortedText);
    expect(await page.getByRole("button", { name: /^(Approve|Deny)$/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Stop" }).count()).toBe(0);
    const beforeRestart = (await readThread()).messages;
    const beforeRestartKeys = await rows.evaluateAll((elements: AttributeElement[]) =>
      elements.map((element) => element.getAttribute("data-key")),
    );
    const firstHost = host;
    await stopHost(firstHost);
    host = undefined;
    host = await launchHost({
      databasePath,
      port: firstHost.service.port,
      previousToken: firstHost.service.token,
      vite,
    });
    const controllerHydrated = page.waitForResponse(
      (response: { status(): number; url(): string }) =>
        response.status() === 200 &&
        new URL(response.url()).pathname.startsWith("/api/agent-controller/") &&
        new URL(response.url()).pathname.endsWith("/threads"),
      { timeout: 15_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await controllerHydrated;
    await waitForRowText(abortedText);
    expect((await readThread()).messages).toEqual(beforeRestart);
    expect(
      await rows.evaluateAll((elements: AttributeElement[]) =>
        elements.map((element) => element.getAttribute("data-key")),
      ),
    ).toEqual(beforeRestartKeys);
    const accessPicker = page.getByRole("combobox", { name: "Access" });
    await accessPicker.click();
    await page.getByRole("option", { name: /Trusted/ }).click();
    await expect.poll(async () => (await readThread()).access, { timeout: 15_000 }).toBe("trusted");
    rows = page.getByRole("region", { name: /^(User|Assistant) message$/ });
    await waitForRowText(abortedText);
    const modelPicker = page.getByRole("combobox", { name: "Model" });
    const alternateOption = page.getByRole("option", { name: /alternate/i });
    await modelPicker.click();
    await alternateOption.click();
    await expect
      .poll(async () => (await readThread()).models.currentId, { timeout: 15_000 })
      .toBe("scenario/alternate");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => page.getByRole("combobox", { name: "Model" }).innerText())
      .toContain("alternate");
    await expect
      .poll(() => page.getByRole("combobox", { name: "Access" }).innerText())
      .toContain("Trusted");

    const finalBody = await readThread();
    const bodyRowIds = finalBody.messages
      .filter((message) => isUserTurn(message) || message.role === "assistant")
      .map((message) => message.id);
    const domRowIds = await rows.evaluateAll((elements: AttributeElement[]) =>
      elements.map((element) => element.getAttribute("data-key")),
    );
    expect(domRowIds).toEqual(bodyRowIds);
    expect(new Set(domRowIds).size).toBe(domRowIds.length);
  } finally {
    await browser?.close();
    if (host) await stopHost(host).catch(() => undefined);
    await vite.close();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    for (const directory of [databaseRoot, localAppData])
      try {
        rmSync(directory, { force: true, recursive: true, maxRetries: 50, retryDelay: 100 });
      } catch {
        // Windows can retain a just-closed LibSQL or browser handle past test teardown.
      }
  }
}, 75_000);
