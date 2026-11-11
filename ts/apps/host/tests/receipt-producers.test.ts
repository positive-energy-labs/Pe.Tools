import { journalAt } from "./effect-test.ts";
import { NodeHttpServer } from "@effect/platform-node";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { Deferred, Effect, Layer } from "effect";
import { HttpEffect, HttpRouter } from "effect/http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostHog } from "posthog-node";
import { expect, test } from "vite-plus/test";
import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { receiptBuildStamp } from "../src/build-stamp.ts";
import { mintContext } from "../src/control.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";

test("real HTTP feedback retains content and caller before body; diagnostics cannot claim the exception", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-feedback-http-"));
  const journal = journalAt(join(dir, "journal.json"), Date.now, () => receiptGoldenEnvelope.stamp);
  const delivered: { properties: unknown; timestamp: string }[] = [];
  const module = await import("../src/receipt-export.ts");
  // The web stamp is the shared build stamp admitted by the host, the same one hostFetch sends as its header.
  const webStamp = module.admitBuild(
    "web",
    receiptBuildStamp("dev"),
    receiptGoldenEnvelope.stamp!.installId,
    receiptGoldenEnvelope.stamp!.processSessionId,
  )!;
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
      web: webStamp,
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
  // effect-edge: island, phase 5
  const latch = Effect.runSync(Deferred.make<void>());
  // effect-edge: island, phase 5
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              port,
              frontendOrigin: Effect.succeed(undefined),
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
          "x-pe-web-build": webStamp.build,
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
    // effect-edge: island, phase 5
    Effect.runSync(Deferred.succeed(latch, undefined));
    server.closeAllConnections();
    await done.catch(() => {});
    await telemetry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("real HTTP refusals, from admission and from a door, export refusal_count with only their closed code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-refusal-http-"));
  const journal = journalAt(join(dir, "journal.json"), Date.now, () => receiptGoldenEnvelope.stamp);
  const sent: { event: string; properties: Record<string, unknown> }[] = [];
  const module = await import("../src/receipt-export.ts");
  const telemetry = module.createReceiptExport({
    journal,
    root: dir,
    stamps: { host: receiptGoldenEnvelope.stamp!, web: null },
    send: async (e) => {
      sent.push(e);
    },
  });
  const server = createServer();
  const port = () => {
    const a = server.address();
    return a && typeof a !== "string" ? a.port : 0;
  };
  // effect-edge: island, phase 5
  const latch = Effect.runSync(Deferred.make<void>());
  // A door's own 403: one with a closed code, one naming a code outside the contract.
  const door = (code: string) =>
    HttpEffect.fromWebHandler(async () =>
      Response.json(
        { error: "private reason text" },
        { status: 403, headers: { "x-pe-refusal": code } },
      ),
    );
  // effect-edge: island, phase 5
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              port,
              frontendOrigin: Effect.succeed(undefined),
              telemetry,
              share: {
                read: async () => {
                  throw Error("local only");
                },
                observe: () => {},
              },
            }),
            HttpRouter.add("GET", "/door/grant", door("grant.required")),
            HttpRouter.add("GET", "/door/odd", door("private.made-up")),
            HttpRouter.add(
              "*",
              "/pe/*",
              HttpEffect.fromWebHandler(async () => Response.json({})),
            ),
          ),
          { disableLogger: true },
        ).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 }))),
      ),
      Deferred.await(latch),
    ),
  );
  try {
    for (let i = 0; !port() && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    const base = `http://127.0.0.1:${port()}`;
    // The coworker's refusal: an anonymous write is refused at admission, before any door.
    expect((await fetch(`${base}/pe/threads`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${base}/pe/x`, { headers: { origin: "http://elsewhere" } })).status).toBe(
      403,
    );
    expect((await fetch(`${base}/door/grant`)).status).toBe(403);
    expect((await fetch(`${base}/door/odd`)).status).toBe(403);
    await expect.poll(() => sent.length).toBe(4);
    expect(sent.map((e) => e.event)).toEqual(Array(4).fill("refusal_count"));
    expect(sent.map((e) => e.properties.reason_code)).toEqual([
      "context.missing",
      "runtime.owner-missing",
      "grant.required",
      "refused",
    ]);
    expect(sent.every((e) => e.properties.count === 1)).toBe(true);
    expect(JSON.stringify(sent)).not.toMatch(/private|elsewhere|threads/);
  } finally {
    // effect-edge: island, phase 5
    Effect.runSync(Deferred.succeed(latch, undefined));
    server.closeAllConnections();
    await done.catch(() => {});
    await telemetry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
