import { pictureCaptures } from "./effect-test.ts";
import { acknowledgedReadBridge, detachedBridge, sessionView } from "./effect-test.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { HostDocumentMarks } from "../src/document-marks.ts";
import { nativeReadRoot } from "../src/app.ts";
import { SdkDriver } from "../src/sdk-session.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { RevitBridge } from "../src/bridge.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test } from "vite-plus/test";
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

test("a full picture service refuses /call without advertising an unkept capture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-full-"));
  const path = join(dir, "image.png");
  await writeFile(path, "png");
  const scope = { bridgeSessionId: "bridge-a", openDocumentId: "open-a" };
  const bridge = acknowledgedReadBridge(detachedBridge({
    list: Effect.succeed([sessionView({
      sessionId: scope.bridgeSessionId, connected: true, ...hostOwnership,
      processId: 42, processStartUtcUnixMs: 1000,
      state: { openDocuments: [{ openId: scope.openDocumentId, title: "HVAC", address: "C:/HVAC.rvt", isFamilyDocument: false }] },
    })]),
    invoke: () => Effect.succeed({
      value: { view: { kind: "View", documentKey: "fixture", elementId: 7, label: "L1" }, filePath: path, byteSize: 3, width: 1500, height: 1500, registrationRefusal: "NoCrop" },
      target: { session: scope.bridgeSessionId, document: "C:/HVAC.rvt" },
    }),
  }));
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now);
  let store!: PictureCaptureStore["Service"];
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(
      makeCallRoute(journal, undefined, { sdk: sdkSessions }),
      Layer.effectDiscard(Effect.map(PictureCaptureStore, (value) => { store = value; })),
    ).pipe(
      nativeReadRoot(Layer.succeed(SdkDriver, (args) => Effect.promise(() => sdkSessions(args)))),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(dir, "store"), 0)),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ), { disableLogger: true },
  );
  try {
    const response = await web.handler(new Request("http://host/call", {
      method: "POST", headers: { "content-type": "application/json", "x-pe-bridge-session-id": scope.bridgeSessionId, "x-pe-open-document-id": scope.openDocumentId },
      body: JSON.stringify({ key: "revit.context.view-image", request: {} }),
    }), Context.make(RequestIdentity, admittedRequestIdentity({ kind: "human", via: "local" }, scope)));
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("Picture store is full") });
    expect(response.headers.get("x-pe-capture-id")).toBeNull();
    expect(await store.list()).toEqual([]);
  } finally {
    await journal.close();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
