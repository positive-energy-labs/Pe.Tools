import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { afterEach, expect, test } from "vite-plus/test";
import { captureListSchema } from "@pe/agent-contracts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { CaptureStore, capturesRoute } from "../src/captures-route.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release();
});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The real /call and /captures routes over one temp store; only native execution is substituted. */
async function host(
  exports: Record<string, Buffer>,
  registered = true,
  /** What Revit's registration claims the bytes hash to, when it is not the bytes on disk. */
  claimed: Record<string, Buffer> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "pe-captures-"));
  const store = new CaptureStore(join(dir, "store"));
  const bridge = {
    list: Effect.succeed([
      {
        sessionId: "bridge-a",
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            {
              openId: "open-a",
              address: "C:/HVAC.rvt",
              title: "HVAC.rvt",
              isFamilyDocument: false,
            },
          ],
        },
      },
    ]),
    invoke: (key: string, input: { target?: { name?: string } }) =>
      Effect.promise(async () => {
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [{ key: "revit.context.view-image", intent: "Read", needs: "document" }],
            },
            target: null,
          };
        const name = input.target?.name ?? "L1";
        const filePath = join(dir, `${name}.png`);
        await writeFile(filePath, exports[name]!);
        return {
          value: {
            view: { kind: "View", elementId: 7, label: `Floor Plan: ${name}` },
            filePath,
            byteSize: exports[name]!.length,
            pixelSize: 1500,
            ...(registered
              ? {
                  registration: {
                    width: 10,
                    height: 10,
                    imageSha256: sha(claimed[name] ?? exports[name]!),
                    topLeft: [0, 1],
                    topRight: [1, 1],
                    bottomLeft: [0, 0],
                  },
                }
              : { registrationRefusal: "NoCrop" }),
          },
          target: { session: "bridge-a", document: "C:/HVAC.rvt" },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const spa = () => Effect.succeed(HttpServerResponse.text("spa"));
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(
      makeCallRoute(undefined, undefined, { captureStore: store }),
      capturesRoute(spa, () => store),
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  cleanup.push(
    () => rm(dir, { recursive: true, force: true }),
    () => web.dispose(),
  );
  const fetch = (path: string, init?: RequestInit) =>
    web.handler(new Request(`http://host${path}`, init), Context.empty() as never);
  const capture = (request: unknown, headers: Record<string, string> = {}) =>
    fetch("/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pe-bridge-session-id": "bridge-a",
        "x-pe-open-document-id": "open-a",
        ...headers,
      },
      body: JSON.stringify({ key: "revit.context.view-image", request }),
    });
  return { dir, store, fetch, capture };
}

test("every view-image answer through /call keeps one blob per sha and one receipt per taking", async () => {
  const l1 = Buffer.from("png-l1");
  const { dir, fetch, capture } = await host({ L1: l1, L2: Buffer.from("png-l2") });

  const first = await capture(
    { target: { name: "L1" }, focus: { elementIds: [1, 2] } },
    { "x-pe-origin": "web:/rooms" },
  );
  expect(first.status, await first.clone().text()).toBe(200);
  const id = first.headers.get("x-pe-capture-id");
  expect(first.headers.get("x-pe-capture-url")).toBe(`/captures/${sha(l1)}.png`);
  expect((await capture({ target: { name: "L1" } }, { "x-pe-action-actor": "agent" })).status).toBe(
    200,
  );
  expect((await capture({ target: { name: "L2" } })).status).toBe(200);

  expect((await readdir(join(dir, "store", "blobs"))).sort()).toHaveLength(2);
  const lines = (await readFile(join(dir, "store", "receipts.jsonl"), "utf8")).trim().split("\n");
  expect(lines).toHaveLength(3);

  const listed = await fetch("/captures", { headers: { accept: "application/json" } });
  const { captures } = captureListSchema.parse(await listed.json());
  expect(captures.map((c) => [c.view.name, c.origin])).toEqual([
    ["Floor Plan: L2", "human"],
    ["Floor Plan: L1", "agent"],
    ["Floor Plan: L1", "web:/rooms"],
  ]);
  expect(captures[2]).toMatchObject({
    id,
    sha: sha(l1),
    document: { openId: "open-a", title: "HVAC.rvt" },
    view: { id: 7 },
    focus: { elementIds: [1, 2] },
    registration: { imageSha256: sha(l1) },
    byteSize: l1.length,
    url: `/captures/${sha(l1)}.png`,
  });

  const blob = await fetch(`/captures/${sha(l1)}.png`);
  expect(blob.status).toBe(200);
  expect(blob.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(l1);
});

test("an unregistered taking is kept under the hash of its bytes", async () => {
  const sheet = Buffer.from("png-sheet");
  const { fetch, capture } = await host({ A101: sheet }, false);
  const response = await capture({ target: { name: "A101" } });
  expect(response.headers.get("x-pe-capture-url")).toBe(`/captures/${sha(sheet)}.png`);
  const { captures } = captureListSchema.parse(await (await fetch("/captures")).json());
  expect(captures[0]).toMatchObject({ sha: sha(sheet), registration: null, focus: null });
});

test("a PNG that no longer matches its registration fails the call and keeps nothing", async () => {
  const { dir, fetch, capture } = await host({ L1: Buffer.from("overwritten") }, true, {
    L1: Buffer.from("png-l1"),
  });
  const response = await capture({ target: { name: "L1" } });
  expect(response.status).toBe(500);
  expect(response.headers.get("x-pe-capture-id")).toBeNull();
  expect(await response.text()).toContain("not the registration's");
  await expect(readdir(join(dir, "store"))).rejects.toThrow();
  expect(await (await fetch("/captures")).json()).toEqual({ captures: [] });
});

test("/captures serves the store only: a navigation is the SPA, a caller path never reaches the filesystem", async () => {
  const { dir, fetch } = await host({});
  expect(await (await fetch("/captures", { headers: { accept: "text/html" } })).text()).toBe("spa");
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
});
