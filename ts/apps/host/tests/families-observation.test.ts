import { nativeReadRoot } from "../src/app.ts";
import { testHostInputs } from "./effect-test.ts";
import { detachedBridge, sessionView, captureStore } from "./effect-test.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test } from "vite-plus/test";
import { address, bindWork, familiesRouteState } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { RevitBridge } from "../src/bridge.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { asCaller, human } from "./callers.ts";
import { familiesReader } from "./effect-test.ts";

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
  let storedWork: unknown = {
    version: 1,
    schemaVersion: 1,
    revision: 0,
    doc: familiesRouteState.schema.parse({ scope: { edit: { value: filter } } }),
    history: [],
  };
  const workspace = new RouteWorkspace({
    registrations: [{ spec: familiesRouteState }],
    store: {
      getState: async () => structuredClone(storedWork),
      setState: async ({ value }) => {
        storedWork = structuredClone(value);
      },
    },
  });
  const bridge = detachedBridge({
    list: Effect.sync(() =>
      connected
        ? [
            sessionView({
              sessionId: target.session,
              connected: true,
              processId: 42,
              processStartUtcUnixMs: 1000,
              lane: hostOwnership.lane,
              sourceRoot: hostOwnership.sourceRoot,
              serviceName: hostOwnership.serviceName,
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
            }),
          ]
        : [],
    ),
    invoke: (key: string, input: any) =>
      Effect.promise(async () => {
        if (key === "host.ops.catalog")
          return {
            target: { session: "bridge-a", document: null },
            value: {
              operations: [
                {
                  subject: "None",
                  touches: "Metadata",
                  effect: "Read",
                  cardinality: "One",
                  costTier: "Cheap",
                  key: "revit.matrix.loaded-families",
                  intent: "Read",
                  needs: "project-document",
                },
              ],
            },
          };
        if (key === "revit.matrix.loaded-families") {
          if (input.phase === "Prepare") {
            matrixCalls++;
            if (fail) throw Error("native failed");
            return {
              target: { session: "bridge-a", document: null },
              value: {
                families: [],
                issues: [],
                source: {
                  families: result.families.map((f) => ({ ...f, typeCount: 1, types: [] })),
                  revitVersion: "2025",
                  version: "v1",
                  copyRefusal: "Reading unsaved changes in this instance.",
                },
              },
            };
          }
          if (input.phase === "Extract")
            return {
              target: { session: "bridge-a", document: null },
              value: { families: result.families, issues: [], elapsedMs: 1 },
            };
          return { target: { session: "bridge-a", document: null }, value: result };
        }
        throw Error(`Unexpected ${key}`);
      }),
  });
  const families = await familiesReader();
  const handlers = new Map<TakeoffCaptures, ReturnType<typeof HttpRouter.toWebHandler>>();
  const journals = new Map<TakeoffCaptures, ActionJournal>();
  const handler = (captures: TakeoffCaptures) => {
    let current = handlers.get(captures);
    if (!current) {
      const journal = new ActionJournal(join(dir, `actions-${handlers.size}.json`), Date.now);
      journals.set(captures, journal);
      current = HttpRouter.toWebHandler(
        makeCallRoute(
          journal,
          captures,
          {
            sdk: sdkSessions,
            workspace,
          },
          { families },
        )
          .pipe(nativeReadRoot())
          .pipe(Layer.provide(testHostInputs))
          .pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
        { disableLogger: true },
      );
      handlers.set(captures, current);
    }
    return current;
  };
  const call = (captures: TakeoffCaptures, request: Request) =>
    asCaller(human, handler(captures).handler)(request, Context.empty() as never);
  const url = "http://host/families/readings";
  const post = async (captures: TakeoffCaptures, document = target, expectedRevision?: number) => {
    const id = randomUUID();
    const revision = expectedRevision ?? (await workspace.view(work, "families"))!.revision;
    const response = await call(
      captures,
      new Request("http://host/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          key: "families.read",
          target: { kind: "document", ref: document },
          input: { work: { key: work, revision }, readId: randomUUID() },
        }),
      }),
    );
    if (!response.ok) return response;
    const row = await journals.get(captures)!.wait(id);
    return row?.state === "succeeded"
      ? Response.json(row.result)
      : Response.json({ error: row && "error" in row ? row.error : row?.state ?? "missing receipt" }, { status: 409 });
  };
  const get = (captures: TakeoffCaptures) =>
    call(captures, new Request(`${url}?work=${encodeURIComponent(JSON.stringify(work))}`));
  try {
    const captures = captureStore(dir, cachePath);
    const legacy = await captures.saveFamilies({
      work,
      document: target,
      filter,
      capturedAt: "2026-09-22T12:00:00.000Z",
      result,
    });
    const first = await post(captures);
    expect(first.status, await first.clone().text()).toBe(200);
    const { envelope, ...saved } = await first.json();
    expect(envelope).toEqual({ revision: 1 });
    expect(saved).toMatchObject({ document: target, documentTitle: "Air.rvt", filter, result });
    expect(saved.capturedAt).toEqual(expect.any(String));
    expect(saved.completedAt).toEqual(expect.any(String));
    const rebuilt = captureStore(dir, cachePath);
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
    const failed = await post(rebuilt);
    expect(failed.status).toBe(409);
    expect((await rebuilt.displayedFamilies(work))?.progress).toMatchObject({
      state: "failed",
      message: "native failed",
    });
    expect((await rebuilt.latestFamilies(work))?.id).toBe(saved.id);
    expect((await post(rebuilt, { ...target, openId: "other" })).status).toBe(409);
    expect((await rebuilt.latestFamilies(work))?.id).toBe(saved.id);
    expect(matrixCalls).toBe(2);
    await writeFile(join(dir, "families", `${legacy.id}.json`), "not JSON");
    expect(
      (await call(rebuilt, new Request(`${url}?id=${legacy.id}&format=reference`))).status,
    ).toBe(409);

    fail = false;
    const completed = await post(rebuilt, target, 1);
    expect(completed.status).toBe(200);
    const observed = await completed.json();
    expect(observed).toMatchObject({
      progress: { state: "complete" },
      envelope: { revision: 2 },
    });
    const before = await workspace.readRaw(work, "families");
    fail = true;
    const partial = await post(rebuilt, target, 2);
    expect(partial.status).toBe(409);
    expect((await rebuilt.displayedFamilies(work))?.progress?.state).toBe("failed");
    expect(await workspace.readRaw(work, "families")).toEqual(before);
    expect(
      await workspace.apply(work, "families", "human", [{ path: ["takenAt"], value: "forged" }], 2),
    ).toMatchObject({ ok: false });
    expect(
      await workspace.apply(
        work,
        "families",
        "pea",
        [{ path: ["scope", "edit"], value: { value: filter } }],
        2,
      ),
    ).toMatchObject({ ok: true, revision: 3 });
    fail = false;
    expect((await post(rebuilt, target, 2)).status).toBe(409);
    expect(await workspace.readRaw(work, "families")).toMatchObject({
      revision: 3,
      doc: { takenAt: observed.capturedAt },
    });
  } finally {
    for (const current of handlers.values()) await current.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("targeted readback cannot replace a newer manual read or claim error coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-families-readback-"));
  try {
    const captures = captureStore(dir);
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
