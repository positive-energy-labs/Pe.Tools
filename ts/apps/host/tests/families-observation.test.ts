import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RevitBridge } from "../src/bridge.ts";

const target = { session: "session-a", openId: "open-a" };
const work = bindWork("families", address("C:\\Models\\Air.rvt"), undefined, target);
const filter = {
  categoryNames: ["Air Terminals"],
  familyNames: [],
  placementScope: "AllLoaded" as const,
};
const result = {
  families: [
    {
      familyId: 1,
      familyUniqueId: "uid-1",
      familyName: "Diffuser",
      categoryName: "Air Terminals",
      typeNames: ["24x24"],
      parameters: [
        {
          definition: { identity: { key: "name:Model", kind: "NameFallback", name: "Model" } },
          kind: "FamilyParameter",
          scope: "Family",
          storageType: "String",
          formulaState: "None",
          valuesPerType: { "24x24": "D-1" },
        },
      ],
      issues: [],
      isPartial: false,
      placedInstanceCount: 0,
    },
  ],
  issues: [{ code: "FamilyEditWarning", severity: "Warning", message: "constraint" }],
  page: { totalCount: 1, returnedCount: 1, isTruncated: false },
};

test("Families observation survives owner reconstruction; failed and wrong-document reads preserve the completed result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-families-observations-"));
  let matrixCalls = 0;
  let fail = false;
  let connected = true;
  const bridge = {
    list: Effect.sync(() =>
      connected
        ? [
            {
              sessionId: target.session,
              state: {
                openDocuments: [
                  {
                    openId: target.openId,
                    address: work.binding === "address" ? work.target : null,
                    title: "Air.rvt",
                    isFamilyDocument: false,
                  },
                ],
              },
            },
          ]
        : [],
    ),
    invoke: (key: string) =>
      Effect.promise(async () => {
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [
                {
                  key: "revit.matrix.loaded-families",
                  intent: "Read",
                  needs: "project-document",
                },
              ],
            },
          };
        if (key === "revit.matrix.loaded-families") {
          matrixCalls++;
          if (fail) throw Error("native failed");
          return { value: result };
        }
        throw Error(`Unexpected ${key}`);
      }),
    subscribe: () => () => {},
  } as unknown as RevitBridge["Service"];
  const handler = (captures: TakeoffCaptures) =>
    HttpRouter.toWebHandler(
      makeCallRoute(undefined, captures).pipe(
        Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
      ),
      { disableLogger: true },
    );
  const call = (captures: TakeoffCaptures, request: Request) =>
    handler(captures).handler(request, Context.empty() as never);
  const url = "http://host/families/readings";
  const headers = {
    "content-type": "application/json",
    "x-pe-bridge-session-id": target.session,
    "x-pe-open-document-id": target.openId,
  };
  const post = (captures: TakeoffCaptures, document = target) =>
    call(
      captures,
      new Request(url, {
        method: "POST",
        headers: { ...headers, "x-pe-open-document-id": document.openId },
        body: JSON.stringify({ work, filter }),
      }),
    );
  const get = (captures: TakeoffCaptures) =>
    call(captures, new Request(`${url}?work=${encodeURIComponent(JSON.stringify(work))}`));
  try {
    const captures = new TakeoffCaptures(dir);
    const legacy = await captures.saveFamilies({
      work,
      document: target,
      filter,
      capturedAt: "2026-09-22T12:00:00.000Z",
      result,
    });
    const first = await post(captures);
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved).toMatchObject({ document: target, documentTitle: "Air.rvt", filter, result });
    expect(saved.capturedAt).toEqual(expect.any(String));
    expect(saved.completedAt).toEqual(expect.any(String));
    const rebuilt = new TakeoffCaptures(dir);
    expect(await (await get(rebuilt)).json()).toEqual(saved);
    const archiveResponse = await call(rebuilt, new Request(url));
    expect(archiveResponse.status).toBe(200);
    const archive = await archiveResponse.json();
    expect(
      archive
        .map((row: { id: string }) => row.id)
        .sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual([legacy.id, saved.id].sort((a, b) => a.localeCompare(b)));
    expect(archive[0].completedAt >= archive[1].completedAt).toBe(true);
    expect(archive.find((row: { id: string }) => row.id === legacy.id)).not.toHaveProperty(
      "documentTitle",
    );
    expect(archive[0]).not.toHaveProperty("result");
    expect(await (await call(rebuilt, new Request(`${url}?id=${legacy.id}`))).json()).toEqual(
      legacy,
    );
    expect((await call(rebuilt, new Request(`${url}?id=..%2Fsecret`))).status).toBe(409);
    connected = false;
    expect(await (await call(rebuilt, new Request(url))).json()).toEqual(archive);
    expect(await (await call(rebuilt, new Request(`${url}?id=${legacy.id}`))).json()).toEqual(
      legacy,
    );
    expect(matrixCalls).toBe(1);
    connected = true;
    fail = true;
    expect((await post(rebuilt)).status).toBe(409);
    expect(await (await get(rebuilt)).json()).toEqual(saved);
    expect((await post(rebuilt, { ...target, openId: "other" })).status).toBe(409);
    expect(await (await get(rebuilt)).json()).toEqual(saved);
    expect(matrixCalls).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("targeted readback cannot replace a newer manual read or claim error coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-families-readback-"));
  try {
    const captures = new TakeoffCaptures(dir);
    const base = await captures.saveFamilies({
      work,
      document: target,
      filter,
      capturedAt: "2026-09-23T01:00:00.000Z",
      result,
    });
    const broken = {
      ...result,
      families: result.families.map((family) => ({
        ...family,
        issues: [{ code: "CollectorError", severity: "Error", message: "values unreadable" }],
      })),
    };
    await expect(
      captures.saveFamiliesReadback(
        base.id,
        target,
        ["Diffuser"],
        "2026-09-23T01:05:00.000Z",
        broken,
      ),
    ).rejects.toThrow(/completely/);
    const manual = await captures.saveFamilies({
      work,
      document: target,
      filter,
      capturedAt: "2026-09-23T01:06:00.000Z",
      result,
    });
    await expect(
      captures.saveFamiliesReadback(
        base.id,
        target,
        ["Diffuser"],
        "2026-09-23T01:07:00.000Z",
        result,
      ),
    ).rejects.toThrow(/newer Families reading/);
    expect((await captures.latestFamilies(work))?.id).toBe(manual.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
