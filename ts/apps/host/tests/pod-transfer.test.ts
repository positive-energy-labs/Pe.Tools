/**
 * Host-local pod reads and archive transport over the production `/call` route. No Revit: the
 * bridge is a stub that fails the test if anything reaches it.
 */
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpRouter } from "effect/unstable/http";
import type { Caller } from "@pe/agent-contracts";
import { documentsRootEnvVar } from "@pe/host-contracts/product-paths";
import { withInvocationContext } from "@pe/mcps/context";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { human } from "./callers.ts";

let root: string;
let pods: string;
let web: ReturnType<typeof HttpRouter.toWebHandler>;
const nativeCalls: string[] = [];
const previousDocuments = process.env[documentsRootEnvVar];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-pod-transfer-"));
  process.env[documentsRootEnvVar] = join(root, "Documents");
  pods = join(root, "Documents", "Pe.Tools", "Pods");
  const bridge = {
    list: Effect.succeed([]),
    invoke: (key: string) => {
      nativeCalls.push(key);
      return Effect.die(`native call ${key}`);
    },
  } as unknown as RevitBridge["Service"];
  web = HttpRouter.toWebHandler(
    makeCallRoute(
      new ActionJournal(join(root, "journal.json")),
      new TakeoffCaptures(join(root, "captures")),
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
});
afterEach(async () => {
  await web.dispose();
  if (previousDocuments === undefined) delete process.env[documentsRootEnvVar];
  else process.env[documentsRootEnvVar] = previousDocuments;
  nativeCalls.length = 0;
  await rm(root, { recursive: true, force: true });
});

const call = (key: string, request?: unknown, as: Caller = human) =>
  withInvocationContext({ caller: as }, async () => {
    const response = await web.handler(
      new Request("http://host/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request === undefined ? { key } : { key, request }),
      }),
      Context.empty() as never,
    );
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  });

async function writePod(folder: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(pods, folder, path, ".."), { recursive: true });
    await writeFile(join(pods, folder, path), content);
  }
}

const mixed = {
  "pod.json": JSON.stringify({
    schemaVersion: 2,
    id: "ducts",
    name: "Ducts",
    version: "1.0.0",
    entrypoints: [{ id: "census", sourcePath: "src/Census.cs", name: "Census" }],
  }),
  "src/Census.cs": "public sealed class Census : PeScriptContainer { }",
  "pages/tour/index.html": "<title>Tour</title>",
  "pages/tour/.state/binding.json": '{"default":{}}',
  "settings/checks.json": "{}",
  "output/run-1/receipt.json": "{}",
};

test("pod.capture answers the admitted bundle by manifest id from a renamed folder, with no native call", async () => {
  await writePod("Renamed In Explorer", mixed);

  const captured = await call("pod.capture", { pod: "ducts" });

  expect(captured.status).toBe(200);
  expect(captured.json.folder).toBe("Renamed In Explorer");
  expect(captured.json.sourceBundle.files.map((f: { path: string }) => f.path).sort()).toEqual([
    "pages/tour/index.html",
    "pod.json",
    "settings/checks.json",
    "src/Census.cs",
  ]);
  expect(captured.json.contributions.map((c: { key: string }) => c.key).sort()).toEqual([
    "member:@ducts/settings/checks.json",
    "page:@ducts/pages/tour",
    "script:@ducts/src/Census.cs",
  ]);
  expect((await call("pod.capture", { pod: "missing" })).status).toBe(404);
  expect(nativeCalls).toEqual([]);
});

test("pod.list carries each pod's canonical contribution keys", async () => {
  await writePod("Renamed In Explorer", mixed);

  const listed = await call("pod.list");

  expect(listed.status).toBe(200);
  expect(
    listed.json.pods[0].contributions.map((c: { key: string }) => c.key).sort(),
  ).toEqual(["member:@ducts/settings/checks.json", "page:@ducts/pages/tour", "script:@ducts/src/Census.cs"]);
  expect(nativeCalls).toEqual([]);
});
