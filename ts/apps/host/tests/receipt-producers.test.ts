import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Layer } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { mintContext } from "../src/control.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { createThreadReceiptAdapter } from "../src/receipt-export.ts";
import { createHarnessThreads } from "../src/harness/threads.ts";
import { createProviders } from "../src/harness/providers.ts";
import { createUpdateReader, UpdateReader } from "../src/update-reader.ts";
import { updateRoutes } from "../src/update-route.ts";
import { HostLifecycle } from "../src/host-lifecycle.ts";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { PostHog } from "posthog-node";

test("real HTTP feedback retains content and caller before body; diagnostics cannot claim the exception", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-feedback-http-"));
  const journal = new ActionJournal(join(dir, "journal.json"), () => receiptGoldenEnvelope.stamp);
  const delivered: { properties: unknown; timestamp: string }[] = [];
  const module = await import("../src/receipt-export.ts");
  let refuse = true;
  const client = new PostHog("explicit-test-key", {
    disableCompression: true,
    disableGeoip: true,
    fetchRetryCount: 0,
    flushInterval: 0,
    enableExceptionAutocapture: false,
    fetch: async (_url, options) => {
      delivered.push((JSON.parse(String(options.body)) as { batch: typeof delivered }).batch[0]!);
      return new Response("{}", { status: refuse ? 503 : 200 });
    },
  });
  const telemetry = module.createReceiptExport({
    journal,
    root: dir,
    stamps: {
      host: receiptGoldenEnvelope.stamp!,
      web: { ...receiptGoldenEnvelope.stamp!, component: "web" },
    },
    client,
  });
  const routes = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: { observe: () => () => {} },
    telemetry,
  });
  const server = createServer();
  const port = () => {
    const a = server.address();
    return a && typeof a !== "string" ? a.port : 0;
  };
  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              port,
              frontendOrigin: () => undefined,
              share: {
                read: async () => {
                  throw Error("local only");
                },
                observe: () => {},
              },
            }),
            HttpRouter.add("*", "/pe/*", HttpEffect.fromWebHandler(routes.fetch)),
          ),
          { disableLogger: true },
        ).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 }))),
      ),
      Deferred.await(latch),
    ),
  );
  try {
    for (let i = 0; !port() && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    const post = (path: string, body?: unknown, token?: string) =>
      fetch(`http://127.0.0.1:${port()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pe-web-build": receiptGoldenEnvelope.stamp!.build,
          ...(token ? { [HOST_CONTEXT_HEADER]: token } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const human = mintContext({ kind: "human", via: "cli" });
    const feedback = {
      comment: "retain full content",
      url: "https://private/path",
      selector: "#picked",
      component: "Picker",
      components: ["Picker"],
      html: "<p>sentinel</p>",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      viewport: { width: 5, height: 6, dpr: 1 },
      picture: "data:image/png;base64,aGVsbG8=",
      picture_error: null,
    };
    expect((await post("/pe/feedback", feedback)).status).toBe(403);
    expect(
      (await post("/pe/feedback", feedback, mintContext({ kind: "pea", thread: "t" }))).status,
    ).toBe(403);
    const kept = await post("/pe/feedback", feedback, human);
    expect(kept.status).toBe(200);
    const reply = (await kept.json()) as { feedbackId: string; delivery: string; error?: string };
    expect(reply).toMatchObject({ feedbackId: expect.any(String), delivery: "failed" });
    const receipts = await journal.read({ kinds: ["feedback"] });
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0]!;
    expect(receipt.body.kind).toBe("feedback");
    if (receipt.body.kind !== "feedback") throw Error("missing note");
    expect(JSON.parse(readFileSync(receipt.body.localRef.path, "utf8")).feedback).toEqual(feedback);
    refuse = false;
    expect(
      await (await post(`/pe/feedback/${reply.feedbackId}/deliver`, undefined, human)).json(),
    ).toEqual({ feedbackId: reply.feedbackId, delivery: "accepted" });
    expect(await journal.read({ kinds: ["feedback"] })).toHaveLength(1);
    expect(delivered).toHaveLength(2);
    expect(delivered[0]!.properties).toEqual(delivered[1]!.properties);
    expect(delivered[0]!.timestamp).toEqual(delivered[1]!.timestamp);
    const batch = {
      browserSessionId: randomUUID(),
      dropped: 2,
      facts: [
        { at: "2026-10-13T16:00:00.000Z", body: { kind: "diagnostic", code: "pane.failed" } },
      ],
    };
    expect((await post("/pe/diagnostics", batch, human)).status).toBe(200);
    expect((await journal.read({ kinds: ["diagnostic"] }))[0]!.join.browserSessionId).toBe(
      batch.browserSessionId,
    );
    expect(
      (await post("/pe/diagnostics", { ...batch, stamp: receiptGoldenEnvelope.stamp }, human))
        .status,
    ).toBe(400);
    expect(
      (
        await post(
          "/pe/diagnostics",
          {
            ...batch,
            facts: [{ ...batch.facts[0], body: { kind: "feedback", explicitHumanSubmit: true } }],
          },
          human,
        )
      ).status,
    ).toBe(400);
    const stale = await fetch(`http://127.0.0.1:${port()}/pe/diagnostics`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HOST_CONTEXT_HEADER]: human,
        "x-pe-web-build": "stale-bundle",
      },
      body: JSON.stringify({ ...batch, dropped: 0 }),
    });
    expect(stale.status).toBe(200);
    expect((await journal.read({ kinds: ["diagnostic"] })).at(-1)!.stamp).toBeNull();
  } finally {
    Effect.runSync(Deferred.succeed(latch, undefined));
    server.closeAllConnections();
    await done.catch(() => {});
    await telemetry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("real HTTP prompt and permission produce joined receipts; remote automatic-update writes are refused before effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-producer-http-"));
  const previous = {
    local: process.env.LOCALAPPDATA,
    adapter: process.env.PE_HARNESS_ADAPTER_CLAUDE,
    docs: process.env.PE_TOOLS_DOCUMENTS_ROOT,
  };
  process.env.LOCALAPPDATA = dir;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = dir;
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
  const journal = new ActionJournal(join(dir, "journal.json"), () => receiptGoldenEnvelope.stamp);
  const module = await import("../src/receipt-export.ts");
  const telemetry = module.createReceiptExport({
    journal,
    root: dir,
    stamps: { host: { ...receiptGoldenEnvelope.stamp!, component: "host" }, web: null },
  });
  const providers = createProviders({
    probeOnStart: false,
    shellPath: async () => process.env.PATH ?? "",
  });
  const adapter = createThreadReceiptAdapter(telemetry, () => threads.receiptSnapshot());
  const threads = createHarnessThreads({
    root: join(dir, "threads"),
    worldRoot: dir,
    providers,
    mcpServer: () => ({ name: "pea", command: "unused", args: [], env: [] }),
    receiptFact: adapter.accept,
  });
  const pe = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: threads.heads,
    telemetry,
  });
  const updates = createUpdateReader({
    path: join(dir, "update.json"),
    automaticOffPath: join(dir, "automatic-off"),
    installed: false,
    pid: 1,
    run: async () => {
      throw Error("No SDK in this test");
    },
  });
  const server = createServer();
  const port = () => {
    const a = server.address();
    return a && typeof a !== "string" ? a.port : 0;
  };
  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              port,
              frontendOrigin: () => undefined,
              share: {
                read: async () => ({
                  desired: "on",
                  state: "on",
                  url: "https://box.tailabc.ts.net",
                  allowRemoteAdministration: false,
                  refusal: null,
                  callers: [],
                  refused: [],
                }),
                observe: () => {},
              },
            }),
            updateRoutes,
            HttpRouter.add(
              "*",
              "/pe/*",
              HttpEffect.fromWebHandler((r) =>
                new URL(r.url).pathname.startsWith("/pe/threads") ? threads.fetch(r) : pe.fetch(r),
              ),
            ),
          ),
          { disableLogger: true },
        ).pipe(
          Layer.provide(Layer.succeed(UpdateReader, updates)),
          Layer.provide(
            Layer.succeed(HostLifecycle, {
              latch,
              handle: Effect.runSync(Deferred.make<ServiceHostHandle>()),
            }),
          ),
          Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
        ),
      ),
      Deferred.await(latch),
    ),
  );
  const token = mintContext({ kind: "human", via: "cli" });
  try {
    for (let i = 0; !port() && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    const base = `http://127.0.0.1:${port()}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", [HOST_CONTEXT_HEADER]: token },
        body: JSON.stringify(body),
      });
    const created = await post("/pe/threads", { providerId: "claude", title: "local thread" });
    expect(created.status, await created.clone().text()).toBe(200);
    const id = ((await created.json()) as { id: string }).id;
    const prompt = await post(`/pe/threads/${id}/prompt`, { text: "ask permission" });
    expect(prompt.status, await prompt.clone().text()).toBe(200);
    await expect.poll(async () => (await journal.read({ kinds: ["permission"] })).length).toBe(1);
    const asked = (await journal.read({ kinds: ["permission"] }))[0]!;
    const context = adapter.context.permission(asked)!;
    expect(
      (
        await post(`/pe/threads/${id}/permission`, {
          requestId: context.requestId,
          optionId: "yes",
        })
      ).status,
    ).toBe(200);
    await expect.poll(async () => (await journal.read({ kinds: ["turn"] })).length).toBe(2);
    const rows = (await (
      await fetch(`${base}/pe/receipt-facts?thread=${id}`)
    ).json()) as import("@pe/agent-contracts").Receipt[];
    expect(rows.filter((r) => r.body.kind === "permission").map((r) => r.join.requestId)).toEqual([
      asked.join.requestId,
      asked.join.requestId,
    ]);
    expect(
      rows
        .filter((r) => r.body.kind === "turn")
        .map((r) => (r.body.kind === "turn" ? r.body.phase : null)),
    ).toEqual(["started", "finished"]);
    const remote = await new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        `${base}/host/update/automatic`,
        {
          method: "POST",
          headers: {
            host: "box.tailabc.ts.net",
            "tailscale-user-login": "remote-user",
            "content-type": "application/json",
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(Buffer.from(c)));
          r.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: r.statusCode })));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ enabled: false }));
    });
    expect(remote.status, await remote.clone().text()).toBe(403);
    expect(updates.current().automatic).toBe(true);
    expect((await post("/host/update/automatic", { enabled: false })).status).toBe(200);
    expect(updates.current().automatic).toBe(false);
  } finally {
    Effect.runSync(Deferred.succeed(latch, undefined));
    server.closeAllConnections();
    await done.catch(() => {});
    await threads.close();
    await telemetry.close();
    if (previous.local === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous.local;
    if (previous.adapter === undefined) delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
    else process.env.PE_HARNESS_ADAPTER_CLAUDE = previous.adapter;
    if (previous.docs === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = previous.docs;
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
