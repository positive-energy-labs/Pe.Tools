import { mkdtemp, readFile, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { address, exportSeed, importSeed, type DemoSeed } from "@pe/agent-contracts";
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
        member: { pod: "demo", path: "settings/models/box.json" },
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
  const work = await f.owner.work.read(f.owner.scope, settingsRouteState.route);
  const basis = (work!.doc as { basis: { member: unknown; sha256: string } }).basis;
  const response = await f.fetch("/actions", {
    id: `${f.owner.id}:save`,
    kind: "workflow",
    key: "settings.write",
    actor: "human",
    destination: { kind: "host" },
    input: { member: basis.member, write: { kind: "save", sha256: basis.sha256 } },
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
    const path = await f.owner.settings.memberPath(f.owner.member!);
    const file = JSON.parse(await readFile(path, "utf8"));
    expect(file.family.name).toBe(scenario === "token-conflict" ? "Box" : "Saved Demo");
    const stored = JSON.parse(await readFile(join(f.owner.root, "journal.json"), "utf8"));
    expect(JSON.stringify(stored)).toContain(`${f.owner.id}:save`);
    if (scenario === "publication-refusal")
      expect(
        JSON.stringify(await f.owner.work.read(f.owner.scope, settingsRouteState.route)),
      ).toContain("Later local edit");
  },
);
test("Build freezes original saved/composed basis and labels simulated outcome; production output is refused", async () => {
  const seed = family();
  if (seed.route === "family") seed.work.candidate.fields = {};
  const f = await setup(seed);
  const opened = await f.owner.settings.readMember(f.owner.member!);
  const build = (suffix: string, outputPath?: string) =>
    f.fetch("/actions", {
      id: `${f.owner.id}:${suffix}`,
      kind: "workflow",
      key: "family.build",
      actor: "human",
      destination: { kind: "document", ref: f.owner.target },
      input: {
        source: { ...f.owner.member!, sha256: opened.sha256 },
        ...(outputPath ? { outputPath } : {}),
      },
      bases: {},
    });
  expect((await build("build")).status).toBeLessThan(300);
  const row = await f.owner.journal.wait(`${f.owner.id}:build`);
  expect(row.state).toBe("succeeded");
  expect(JSON.stringify(row)).toContain("No RFA was created");
  expect(JSON.stringify(row)).toContain(opened.sha256);
  await build("escape", join(f.parent, "production.rfa"));
  const escaped = await f.owner.journal.wait(`${f.owner.id}:escape`);
  expect(escaped.state).toBe("failed");
});
test("resolved links, pod members, request identity and dispose cannot cross root", async () => {
  const f = await setup();
  const production = join(f.parent, "production");
  await mkdir(production);
  await writeFile(join(production, "keep.json"), "KEEP");
  await symlink(production, join(f.owner.root, "link"), "junction");
  await expect(
    assertDemoPath(f.owner.root, join(f.owner.root, "link/keep.json")),
  ).rejects.toThrow();
  await expect(f.owner.settings.readMember({ pod: "link", path: "keep.json" })).rejects.toThrow();
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

test("demo Family capture files a new member and returns what the capture saw", async () => {
  const f = await setup();
  const response = await f.fetch("/actions", {
    id: `${f.owner.id}:capture`,
    kind: "workflow",
    key: "family.capture",
    actor: "agent",
    destination: { kind: "document", ref: f.owner.target },
    input: { pod: f.owner.member!.pod },
    bases: {},
  });
  expect(response.status).toBeLessThan(300);
  const row = await f.owner.journal.wait(`${f.owner.id}:capture`);
  expect(row.state, JSON.stringify(row)).toBe("succeeded");
  const result = (
    row as {
      result: {
        member: { pod: string; path: string; sha256: string };
        evidence: { coverage: Record<string, string>; unmodeledCount: number; origin: string };
      };
    }
  ).result;
  expect(result.member.path).toMatch(/^settings\/family\/Simulated-demo-family-.*\.json$/);
  expect(result.evidence).toMatchObject({ origin: "capture", unmodeledCount: 0 });
  expect(result.evidence.coverage.simulation).toBeTruthy();
  const written = JSON.parse(
    await readFile(await f.owner.settings.memberPath(result.member), "utf8"),
  );
  expect(written.$schema).toMatch(/\/schemas\/settings\/FamilyFoundry\/models\.json$/);
});

test("demo Family apply confirms a plan, applies that exact hash, and refuses changed bytes", async () => {
  const seed = family();
  if (seed.route !== "family") throw Error("Family seed expected");
  seed.work.candidate.fields = {};
  const f = await setup(seed);
  const opened = await f.owner.settings.readMember(f.owner.member!);
  const source = { ...f.owner.member!, sha256: opened.sha256 };
  const apply = async (suffix: string, planHash?: string) => {
    expect(
      (
        await f.fetch("/actions", {
          id: `${f.owner.id}:${suffix}`,
          kind: "workflow",
          key: "family.apply",
          actor: "human",
          destination: { kind: "document", ref: f.owner.target },
          input: { source, ...(planHash ? { planHash } : {}) },
          bases: {},
        })
      ).status,
    ).toBeLessThan(300);
    return f.owner.journal.wait(`${f.owner.id}:${suffix}`);
  };
  const confirm = await apply("confirm");
  expect(confirm.state).toBe("succeeded");
  const planHash = (confirm as { result: { plan: { planHash: string } } }).result.plan.planHash;
  expect(planHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await apply("wrong-hash", "wrong")).state).toBe("failed");
  const success = await apply("applied", planHash);
  expect(success.state).toBe("succeeded");
  expect(JSON.stringify(success)).toContain("No Revit mutation, RFA output, or run receipt");
  await writeFile(await f.owner.settings.memberPath(f.owner.member!), '{"family":{}}');
  const stale = await apply("stale-member", planHash);
  expect(stale.state).toBe("failed");
  expect(stale.steps).toEqual([]);
  expect(JSON.stringify(stale)).toContain("changed after it was reviewed");
});

test("same HTTP router separates production Work and two demo resource owners; reset cannot retire production", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pe-demo-namespaces-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const productionFile = join(parent, "production-work.json");
  const scope = { route: settingsRouteState.route, target: null, work: "production" };
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
    settingsRouteState.route,
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
    ).json() as Promise<{
      id: string;
      base: string;
      scope: { route: string; target: null; work: string };
    }>;
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
