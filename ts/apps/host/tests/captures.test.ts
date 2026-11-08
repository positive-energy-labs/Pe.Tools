import { existsSync } from "node:fs";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings } from "./native-recordings.ts";
import { z } from "zod";
import { bindWork, type Caller } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { bindControl } from "../src/control.ts";
import { testConsents } from "./effect-test.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { pictureCaptures } from "./effect-test.ts";
import { detachedBridge } from "./effect-test.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks } from "../src/document-marks.ts";
import { nativeReadRoot } from "../src/app.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { RevitBridge } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { PictureCaptureStore, capturesRoute } from "../src/captures-route.ts";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("/captures serves the store only: a navigation is the SPA, a caller path never reaches the filesystem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-captures-"));
  const store = pictureCaptures(join(dir, "store"));
  const web = HttpRouter.toWebHandler(
    capturesRoute(() => Effect.succeed(HttpServerResponse.text("spa"))),
  );
  const fetch = (path: string, init?: RequestInit) =>
    web.handler(new Request(`http://host${path}`, init), Context.make(PictureCaptureStore, store));
  try {
    const navigation = await fetch("/captures", { headers: { accept: "text/html" } });
    expect(await navigation.text(), `navigation status ${navigation.status}`).toBe("spa");
    expect(await (await fetch("/captures")).json()).toEqual({ captures: [] });
    const outside = Buffer.from("secret");
    await writeFile(join(dir, `${sha(outside)}.png`), outside);
    for (const path of [
      `/captures/${sha(outside)}.png`,
      `/captures/..%2F${sha(outside)}.png`,
      `/captures/${sha(outside).toUpperCase()}.png`,
      `/captures/${sha(outside)}`,
      `/captures/${sha(outside)}.png/x`,
    ])
      expect([400, 404]).toContain((await fetch(path)).status);
  } finally {
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

// This replay also needs the immutable captured PNG at its recorded path. No path/body synthesis.
test.skipIf(!existsSync((nativeRecordings("retained-view-image").responses["revit.context.view-image"] as { filePath: string }).filePath))(
  "a full picture service refuses recorded /call output without advertising an unkept capture (UNPROVEN if retained asset unavailable)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-full-"));
  const native = await fixtureNative(join(dir, "native"), "retained-view-image");
  const socket = await native.connect();
  const scope = { bridgeSessionId: socket.target.session, openDocumentId: socket.target.openId };
  const { bridge, journal } = native;
  let store!: PictureCaptureStore["Service"];
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(
      makeCallRoute(journal, undefined, { sdk: sdkSessions }),
      Layer.effectDiscard(
        Effect.map(PictureCaptureStore, (value) => {
          store = value;
        }),
      ),
    ).pipe(
      nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(dir, "store"), 0)),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  try {
    const response = await web.handler(
      new Request("http://host/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pe-bridge-session-id": scope.bridgeSessionId,
          "x-pe-open-document-id": scope.openDocumentId,
        },
        body: JSON.stringify({ key: "revit.context.view-image", request: {} }),
      }),
      Context.make(
        RequestIdentity,
        admittedRequestIdentity({ kind: "human", via: "local" }, scope),
      ),
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("Picture store is full"),
    });
    expect(response.headers.get("x-pe-capture-id")).toBeNull();
    expect(await store.list()).toEqual([]);
  } finally {
    await journal.close();
    await web.dispose();
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Work start validates seeds, waits for consent, and cannot overwrite a winner after consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-start-"));
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(dir, "work")),
  });
  workspace.register({
    spec: {
      route: "sample",
      title: "Sample",
      description: "Start witness",
      schema: z.object({ count: z.number() }),
    },
  });
  const events: ConsentEvent[] = [],
    runs = testConsents((_, event) => events.push(event));
  const run = { thread: "start-thread", turn: "start-turn" };
  runs.open(run);
  bindControl({ runs, acquired: () => null });
  const caller: Caller = {
    kind: "pea",
    context: "host-minted",
    thread: run.thread,
    run,
    root: run,
  };
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now, () => null, 1);
  const key = bindWork("sample", null, "one");
  const web = HttpRouter.toWebHandler(
    makeCallRoute(journal, undefined, { workspace, sdk: sdkSessions }).pipe(
      nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(dir, "pictures"))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(Layer.succeed(RevitBridge, detachedBridge())),
    ),
    { disableLogger: true },
  );
  const invoke = async (id: string, seed: unknown) => {
    const response = await withInvocationContext({ caller }, () =>
      web.handler(
        new Request("http://host/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            key: "work.start",
            target: { kind: "host" },
            input: { key, seed },
          }),
        }),
        Context.make(RequestIdentity, admittedRequestIdentity(caller, {})),
      ),
    );
    expect([200, 202], await response.clone().text()).toContain(response.status);
    return journal.wait(id);
  };
  try {
    expect((await invoke("invalid", { count: "wrong" })).state).toBe("failed");
    expect(await workspace.readRaw(key, "sample")).toBeNull();
    const pending = invoke("race", { count: 1 });
    const ask = await vi.waitFor(() => {
      const row = events.find((e) => e.kind === "permission_request");
      if (row?.kind !== "permission_request") throw Error("No consent request");
      return row;
    });
    expect(await workspace.readRaw(key, "sample")).toBeNull();
    expect(await workspace.start(key, { count: 2 }, "human")).toMatchObject({
      ok: true,
      revision: 1,
    });
    runs.decide(run.thread, ask.requestId, "allow_now");
    expect((await pending).state).toBe("failed");
    expect((await workspace.readRaw(key, "sample"))?.doc).toEqual({ count: 2 });
    const results = await Promise.all([
      workspace.start(key, { count: 3 }, "human"),
      workspace.start(key, { count: 4 }, "human"),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
  } finally {
    runs.closeAll();
    await web.dispose();
    await journal.close();
    await rm(dir, { recursive: true, force: true });
  }
});
