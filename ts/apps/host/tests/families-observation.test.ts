import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const cachePath = join(dir, "parameters-service-cache.json");
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
    const captures = new TakeoffCaptures(dir, cachePath);
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
    const rebuilt = new TakeoffCaptures(dir, cachePath);
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
    const referenceResponse = await call(
      rebuilt,
      new Request(`${url}?id=${saved.id}&format=reference`),
    );
    expect(referenceResponse.status).toBe(200);
    const reference = await referenceResponse.json();
    expect(reference).toMatchObject({
      id: saved.id,
      work,
      document: target,
      documentTitle: "Air.rvt",
      filter,
      capturedAt: saved.capturedAt,
      completedAt: saved.completedAt,
      familyCount: 1,
      typeCount: 1,
      issueCount: 1,
      familyIssueCount: 0,
      partialFamilyCount: 0,
      page: result.page,
      apsParametersCache: { source: "parameters-service-cache", status: "missing" },
    });
    expect(reference).not.toHaveProperty("result");
    expect(reference.valueSemantics).toContain("display strings");
    const savedBytes = await readFile(reference.artifact.path);
    expect(reference.artifact).toEqual({
      path: join(dir, "families", `${saved.id}.json`),
      url: `/families/readings?id=${saved.id}&format=artifact`,
      sha256: createHash("sha256").update(savedBytes).digest("hex"),
      sizeBytes: savedBytes.length,
      format: "json",
    });
    const artifactResponse = await call(
      rebuilt,
      new Request(`http://host${reference.artifact.url}`),
    );
    expect(artifactResponse.status).toBe(200);
    expect(Buffer.from(await artifactResponse.arrayBuffer())).toEqual(savedBytes);
    expect(
      (await call(rebuilt, new Request(`${url}?id=..%2Fsecret&format=reference`))).status,
    ).toBe(409);

    const cacheBytes = Buffer.from('{"Results":[{"Id":"p"}],"Pagination":{}}');
    await writeFile(cachePath, cacheBytes);
    const withCache = await (
      await call(rebuilt, new Request(`${url}?id=${saved.id}&format=reference`))
    ).json();
    expect(withCache.apsParametersCache).toMatchObject({
      source: "parameters-service-cache",
      status: "ready",
      modifiedAt: expect.any(String),
      artifact: {
        path: cachePath,
        sha256: createHash("sha256").update(cacheBytes).digest("hex"),
        sizeBytes: cacheBytes.length,
        format: "json",
      },
    });
    const cacheUrl = withCache.apsParametersCache.artifact.url;
    expect(cacheUrl).toContain(`id=${saved.id}&format=parameters-cache&sha256=`);
    const cacheResponse = await call(rebuilt, new Request(`http://host${cacheUrl}`));
    expect(cacheResponse.status).toBe(200);
    expect(Buffer.from(await cacheResponse.arrayBuffer())).toEqual(cacheBytes);
    expect(
      (await call(rebuilt, new Request(`${url}?id=${saved.id}&format=parameters-cache`))).status,
    ).toBe(409);
    await writeFile(cachePath, '{"Results":[]}');
    expect((await call(rebuilt, new Request(`http://host${cacheUrl}`))).status).toBe(409);
    await writeFile(cachePath, "not JSON");
    const malformed = await (
      await call(rebuilt, new Request(`${url}?id=${saved.id}&format=reference`))
    ).json();
    expect(malformed.apsParametersCache).toMatchObject({ status: "malformed" });
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
    await writeFile(join(dir, "families", `${legacy.id}.json`), "not JSON");
    expect(
      (await call(rebuilt, new Request(`${url}?id=${legacy.id}&format=reference`))).status,
    ).toBe(409);
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
    const verified = await captures.saveFamiliesReadback(
      manual.id,
      target,
      ["Diffuser"],
      "2026-09-23T01:08:00.000Z",
      result,
    );
    const reference = await captures.familiesReference(verified.id);
    expect(reference.readback).toEqual({
      sourceId: manual.id,
      verifiedFamilies: [{ name: "Diffuser", at: "2026-09-23T01:08:00.000Z" }],
    });
    expect(reference.capturedAt).toBe(manual.capturedAt);
    expect(reference.completedAt).toBe(verified.completedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
