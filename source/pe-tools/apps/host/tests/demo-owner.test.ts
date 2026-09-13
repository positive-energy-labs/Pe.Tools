import { mkdtemp, readFile, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import {
  address,
  exportSeed,
  importSeed,
  familyCaptureSchema,
  type DemoSeed,
} from "@pe/agent-contracts";
import { Context, Layer } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { RouteWorkspace, resourceResponse } from "@pe/runtime";
import { readingKey, settingsRouteState } from "@pe/agent-contracts";
import { demoRoutes, createDemoOwner } from "../src/demo-owner.ts";
import { assertDemoPath } from "../src/demo-settings.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release();
});
const family = (
  scenario: Extract<DemoSeed, { route: "family" }>["scenario"] = "success",
): DemoSeed => ({
  version: 1,
  namespace: "isolated-demo",
  route: "family",
  seedAddress: address("C:/production/family.rfa"),
  failure: { kind: "none" },
  originalEvidence: { id: "production-unknown", state: "unknown" },
  work: {
    key: { route: "family", target: null, work: "production" },
    revision: 12,
    candidate: { basis: null, fields: { "/family/name": { staged: { value: "Saved Demo" } } } },
  },
  readings: {
    captures: [],
    files: [
      {
        documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "box" },
        rawContent: JSON.stringify({
          family: {
            name: "Box",
            category: "Generic Models",
            template: "Generic Model",
            placement: "Unhosted",
          },
          types: {},
          parameters: {},
        }),
      },
    ],
  },
  page: { inputBuffer: null, armed: true },
  scenario,
});
async function setup(seed = family()) {
  const parent = await mkdtemp(join(tmpdir(), "pe-demo-test-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const owner = await createDemoOwner(parent, seed);
  cleanup.push(() => owner.dispose());
  const fetch = (path: string, body?: unknown, method = body ? "POST" : "GET") =>
    owner.fetch(
      new Request(`http://demo${path}`, {
        method,
        ...(body
          ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
          : {}),
      }),
    );
  return { owner, parent, fetch };
}
test("admitted demo launch uses only its labelled leaf and rejects escape or real IO fallback", async () => {
  const f = await setup();
  const submit = async (suffix: string, key: string, path: string) => {
    const id = `${f.owner.id}:${suffix}`;
    const response = await f.fetch("/actions", {
      id,
      kind: "operation",
      key,
      actor: "human",
      destination: { kind: "host" },
      input: { path },
      bases: {},
    });
    expect(response.ok).toBe(true);
    return f.owner.journal.wait(id);
  };
  expect(await submit("launch", "rhvac.launch", f.owner.r10Path)).toMatchObject({
    state: "succeeded",
    result: { simulated: true, launched: false },
  });
  await expect(readFile(f.owner.r10Path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await submit("escape", "rhvac.launch", join(f.parent, "production.r10"))).toMatchObject({
    state: "failed",
  });
  expect(await submit("fallback", "host.shell.open", f.owner.r10Path)).toMatchObject({
    state: "failed",
    error: expect.stringContaining("Unsupported simulated local operation"),
  });
});
async function save(f: Awaited<ReturnType<typeof setup>>) {
  const work = await f.owner.work.read(f.owner.scope, "settings");
  const basis = (
    work!.doc as { basis: { path: string; documentId: unknown; versionToken: string } }
  ).basis;
  const response = await f.fetch("/actions", {
    id: `${f.owner.id}:save`,
    kind: "workflow",
    key: "settings.write",
    actor: "human",
    destination: { kind: "host" },
    input: {
      path: basis.path,
      documentId: basis.documentId,
      workspaceId: f.owner.scope.work,
      write: { kind: "save", versionToken: basis.versionToken },
    },
    bases: { work: { key: f.owner.scope, revision: work!.revision } },
  });
  expect(response.status).toBeLessThan(300);
  return f.owner.journal.wait(`${f.owner.id}:save`);
}
test.each(["success", "token-conflict", "publication-refusal"] as const)(
  "HTTP / disk journal / real Settings: %s",
  async (scenario) => {
    const f = await setup(family(scenario));
    const row = await save(f);
    expect(row.state).toBe(
      scenario === "success"
        ? "succeeded"
        : scenario === "token-conflict"
          ? "failed"
          : "incomplete",
    );
    const path = (await f.owner.settings.settingsAddress(f.owner.documentId!)).path;
    const file = JSON.parse(await readFile(path, "utf8"));
    expect(file.family.name).toBe(scenario === "token-conflict" ? "Box" : "Saved Demo");
    const stored = JSON.parse(await readFile(join(f.owner.root, "journal.json"), "utf8"));
    expect(JSON.stringify(stored)).toContain(`${f.owner.id}:save`);
    if (scenario === "publication-refusal")
      expect(JSON.stringify(await f.owner.work.read(f.owner.scope, "settings"))).toContain(
        "Later local edit",
      );
  },
);
test("Build freezes original saved/composed basis and labels simulated outcome; production output is refused", async () => {
  const seed = family();
  if (seed.route === "family") seed.work.candidate.fields = {};
  const f = await setup(seed);
  const opened = await f.owner.settings.openSettings({
    documentId: f.owner.documentId!,
    mode: "file",
    includeComposedContent: true,
  });
  const build = (suffix: string, outputPath?: string) =>
    f.fetch("/actions", {
      id: `${f.owner.id}:${suffix}`,
      kind: "workflow",
      key: "family.build",
      actor: "human",
      destination: { kind: "document", ref: f.owner.target },
      input: {
        documentId: f.owner.documentId,
        workspaceId: f.owner.scope.work,
        fileVersion: opened.metadata.versionToken!.value,
        ...(outputPath ? { outputPath } : {}),
      },
      bases: {},
    });
  expect((await build("build")).status).toBeLessThan(300);
  const row = await f.owner.journal.wait(`${f.owner.id}:build`);
  expect(row.state).toBe("succeeded");
  expect(JSON.stringify(row)).toContain("No RFA was created");
  expect(JSON.stringify(row)).toContain(opened.metadata.versionToken!.value);
  await build("escape", join(f.parent, "production.rfa"));
  const escaped = await f.owner.journal.wait(`${f.owner.id}:escape`);
  expect(escaped.state).toBe("failed");
});
test("resolved links, file-mode Settings, request identity and dispose cannot cross root", async () => {
  const f = await setup();
  const production = join(f.parent, "production");
  await mkdir(production);
  await writeFile(join(production, "keep.json"), "KEEP");
  await symlink(production, join(f.owner.root, "link"), "junction");
  await expect(
    assertDemoPath(f.owner.root, join(f.owner.root, "link/keep.json")),
  ).rejects.toThrow();
  await expect(
    f.owner.settings.openSettings({
      documentId: { moduleKey: "link", rootKey: "", relativePath: "keep" },
      mode: "file",
    }),
  ).rejects.toThrow();
  expect(
    (await f.fetch("/actions", { id: "production-unknown", destination: { kind: "host" } })).status,
  ).toBe(409);
  await f.owner.dispose();
  expect(await readFile(join(production, "keep.json"), "utf8")).toBe("KEEP");
});
test("typed seed codec preserves dates/maps/sets and unknown original evidence; import never executes", async () => {
  const seed = family();
  seed.originalEvidence = {
    date: new Date("2026-09-09T00:00:00Z"),
    map: new Map([["x", new Set([1, 2])]]),
    unknown: { id: "production", state: "unknown" },
  };
  const decoded = importSeed(exportSeed(seed));
  expect(decoded).toEqual(seed);
  const f = await setup(decoded);
  expect(await f.owner.journal.list()).toEqual([]);
  expect(f.owner.scope).not.toEqual(seed.work.key);
  expect(f.owner.at).not.toBe(seed.seedAddress);
});

test("demo Family reads and Apply use immutable local plan hash and composed-basis policy", async () => {
  const seed = family();
  if (seed.route !== "family") throw Error("Family seed expected");
  seed.work.candidate.fields = {};
  seed.readings.files[0]!.rawContent =
    '{"family":{"$include":"@local/fragments/details"},"parameters":{},"types":{}}';
  seed.readings.files.push({
    documentId: { ...seed.readings.files[0]!.documentId, relativePath: "fragments/details" },
    rawContent:
      '{"name":"Box","category":"Generic Models","template":"Generic Model","placement":"Unhosted"}',
  });
  const f = await setup(seed);
  const opened = await f.owner.settings.openSettings({
    documentId: f.owner.documentId!,
    mode: "file",
    includeComposedContent: true,
  });
  const planned = await f.fetch("/family/readings", {
    key: "family.plan",
    scope: f.owner.scope,
    target: f.owner.target,
    input: {
      documentId: f.owner.documentId,
      workspaceId: f.owner.scope.work,
      fileVersion: opened.metadata.versionToken!.value,
    },
  });
  expect(planned.status).toBe(200);
  const plan = familyCaptureSchema.parse(await planned.json());
  if (plan.provenance.kind !== "live" || plan.reading.kind !== "plan")
    throw Error("Live plan expected");
  expect(plan.provenance.target).toEqual(f.owner.target);
  expect(plan.reading.value.entry.planHash).toMatch(/^[a-f0-9]{64}$/);
  const apply = async (suffix: string, hash: string) => {
    expect(
      (
        await f.fetch("/actions", {
          id: `${f.owner.id}:${suffix}`,
          kind: "workflow",
          key: "family.apply",
          actor: "human",
          destination: { kind: "document", ref: f.owner.target },
          input: { planId: plan.id, expectedPlanHash: hash },
          bases: {},
        })
      ).status,
    ).toBeLessThan(300);
    return f.owner.journal.wait(`${f.owner.id}:${suffix}`);
  };
  const wrongHash = await apply("wrong-hash", "wrong");
  expect(wrongHash.state).toBe("failed");
  expect(wrongHash.steps).toEqual([]);
  const success = await apply("applied", plan.reading.value.entry.planHash);
  expect(success.state).toBe("succeeded");
  expect(JSON.stringify(success)).toContain("No Revit mutation or RFA output");
  const dependency = await f.owner.settings.settingsAddress(seed.readings.files[1]!.documentId);
  await writeFile(dependency.path, '{"name":"Changed dependency"}');
  const stale = await apply("stale-composition", plan.reading.value.entry.planHash);
  expect(stale.state).toBe("failed");
  expect(stale.steps).toEqual([]);
  expect(JSON.stringify(stale)).toContain("original file/composed plan basis changed");
  const mainAfter = await f.owner.settings.openSettings({
    documentId: f.owner.documentId!,
    mode: "file",
    includeComposedContent: true,
  });
  expect(mainAfter.metadata.versionToken).toEqual(opened.metadata.versionToken);
});

test("same HTTP router separates production Work and two demo resource owners; reset cannot retire production", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pe-demo-namespaces-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const productionFile = join(parent, "production-work.json");
  const scope = { route: "settings", target: null, work: "production" };
  const production = new RouteWorkspace({
    registrations: [{ spec: settingsRouteState, handlers: {} }],
    store: {
      getState: async () => {
        try {
          return JSON.parse(await readFile(productionFile, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
      },
      setState: async ({ value }) => {
        await writeFile(productionFile, JSON.stringify(value));
      },
    },
  });
  await production.apply(
    scope,
    "settings",
    "human",
    [{ path: ["fields"], value: { "/private": { staged: { value: "production sentinel" } } } }],
    0,
  );
  const before = await readFile(productionFile, "utf8");
  const productionRoute = HttpRouter.add(
    "GET",
    "/pe/resources",
    HttpEffect.fromWebHandler(async (request) =>
      resourceResponse(request, (key, publish) => {
        if (key.kind !== "work") throw Error("Work only");
        return production.observe(key, key.route, (result) =>
          publish(
            "error" in result
              ? { kind: "failure", key: readingKey(key), error: result.error }
              : { kind: "snapshot", key: readingKey(key), value: result.value },
          ),
        );
      }),
    ),
  );
  const web = HttpRouter.toWebHandler(
    Layer.merge(productionRoute, demoRoutes(join(parent, "demos"))),
    { disableLogger: true, memoMap: Layer.makeMemoMapUnsafe() },
  );
  cleanup.push(() => web.dispose());
  const send = (path: string, init?: RequestInit) =>
    web.handler(new Request(`http://demo${path}`, init), Context.empty() as never);
  const create = async () =>
    (
      await send("/demo/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: exportSeed(family()) }),
      })
    ).json() as Promise<{ id: string; base: string; scope: { route: string; target: null; work: string } }>;
  const a = await create(),
    b = await create();
  const reading = async (base: string, requested: typeof scope) => {
    const response = await send(
      `${base}/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "work", ...requested }]))}`,
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      return JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    } finally {
      await reader.cancel();
    }
  };
  expect(await reading(a.base, scope)).toMatchObject({ kind: "failure" });
  expect(await reading(a.base, b.scope)).toMatchObject({ kind: "failure" });
  expect(await reading(a.base, a.scope)).toMatchObject({ kind: "snapshot" });
  expect(JSON.stringify(await reading("", scope))).toContain("production sentinel");
  expect((await send(a.base, { method: "DELETE" })).status).toBe(200);
  expect(await reading(b.base, b.scope)).toMatchObject({ kind: "snapshot" });
  expect(await readFile(productionFile, "utf8")).toBe(before);
});
