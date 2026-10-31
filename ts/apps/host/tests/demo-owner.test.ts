import { mkdtemp, readFile, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { address, exportSeed, type DemoSeed } from "@pe/agent-contracts";
import { Context, Layer } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { RouteWorkspace, resourceResponse } from "@pe/runtime";
import { readingKey, settingsRouteState, familiesRouteState } from "@pe/agent-contracts";
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
    key: { binding: "workspace" as const, route: "family", target: null, work: "production" },
    revision: 12,
    candidate: { basis: null, fields: { "/family/name": { edit: { value: "Saved Demo" } } } },
  },
  readings: {
    captures: [],
    files: [
      {
        member: { pod: "demo", path: "settings/models/box.json" },
        rawContent: JSON.stringify({
          // The page's origin, as the web lane seeds it; capture must not echo it.
          $schema: "http://localhost:3000/schemas/settings/FamilyFoundry/models.json",
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
test("seed observations publish once while browser edits cannot forge their basis", async () => {
  const f = await setup();
  const before = await (await f.fetch("/work")).json();
  expect(before).toMatchObject({
    revision: 1,
    doc: { basis: { member: f.owner.member, rawContent: expect.any(String) } },
  });
  const forged = await (
    await f.fetch(
      "/work",
      { revision: before.revision, patches: [{ path: ["basis"], value: null }] },
      "PATCH",
    )
  ).json();
  expect(forged).toMatchObject({ ok: false });
  expect(JSON.stringify(forged)).toContain("Host observations cannot be changed by an edit");
  expect(await (await f.fetch("/work")).json()).toEqual(before);

  const edited = await (
    await f.fetch(
      "/work",
      {
        revision: before.revision,
        patches: [{ path: ["fields", "/family/name", "edit"], value: { value: "Local edit" } }],
      },
      "PATCH",
    )
  ).json();
  expect(edited).toMatchObject({ ok: true, revision: before.revision + 1 });
  const after = await (await f.fetch("/work")).json();
  expect(after.doc.basis).toEqual(before.doc.basis);
  expect(after.doc.fields["/family/name"].edit).toMatchObject({ value: "Local edit", by: "human" });
});

test("demo Work instances count the portable editable cells through the production store", async () => {
  const f = await setup();
  const census = await f.owner.work.instances();
  expect(census).toMatchObject({ available: true, unreadable: 0, unindexed: 0 });
  expect(census.works.find((row) => row.route === "pods")).toMatchObject({
    unfinished: 1,
    proposals: 0,
    state: "ready",
  });
  const before = await (await f.fetch("/work")).json();
  expect(
    await (
      await f.fetch(
        "/work",
        {
          revision: before.revision,
          patches: [{ path: ["fields", "/family/name", "edit"], value: null }],
        },
        "PATCH",
      )
    ).json(),
  ).toMatchObject({ ok: true });
  expect((await f.owner.work.instances()).works.find((row) => row.route === "pods")).toMatchObject({
    unfinished: 0,
    proposals: 0,
  });
});

test("declared demo writes retain the press and replay the accepted inverse as restore", async () => {
  const f = await setup();
  const { scope, route } = f.owner;
  expect(scope.binding).toBe("workspace");
  if (scope.binding !== "workspace") throw Error("Expected isolated workspace");
  const path = `/pe/route-state/${route}/apply?work=${encodeURIComponent(scope.work)}`;
  const before = await f.owner.work.view(scope, route);
  if (!before) throw Error("Expected seeded demo Work");
  const applied = await (
    await f.fetch(path, {
      patches: [{ path: ["fields", "/family/name", "edit"], value: { value: "One press" } }],
      expectedRevision: before.revision,
      press: "demo-edit-press",
      kind: "apply",
    })
  ).json();
  expect(applied).toMatchObject({
    ok: true,
    write: { by: "human", kind: "apply", press: "demo-edit-press", undoable: true },
  });
  expect(applied.write.inverse.length).toBeGreaterThan(0);
  const restored = await (
    await f.fetch(path, {
      patches: applied.write.inverse,
      expectedRevision: applied.revision,
      press: null,
      kind: "restore",
    })
  ).json();
  expect(restored).toMatchObject({
    ok: true,
    write: { by: "human", kind: "restore", press: null },
  });
  expect((await f.owner.work.view(scope, route))?.doc).toEqual(before.doc);
});

test("admitted demo launch uses only its labelled leaf and rejects escape or real IO fallback", async () => {
  const f = await setup();
  const submit = async (suffix: string, key: string, path: string) => {
    const id = suffix;
    const response = await f.fetch("/actions", {
      id,
      key,
      target: { kind: "host" },
      input: { path },
    });
    expect(response.ok, await response.clone().text()).toBe(true);
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

test("simulated native outcomes carry the exact journal dispatch evidence", async () => {
  const f = await setup();
  const id = "native-capture";
  const response = await f.fetch("/actions", {
    id,
    key: "family.capture",
    target: { kind: "document", ref: f.owner.target },
    input: {},
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  const row = await f.owner.journal.wait(id);
  expect(row.state, JSON.stringify(row)).toBe("succeeded");
  expect(row.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "native",
        key: "family.capture",
        state: "succeeded",
        dispatchedAt: expect.any(String),
      }),
    ]),
  );
});
test("a simulated lost native result retains pre-effect dispatch evidence and stays unknown", async () => {
  const f = await setup(family("native-unknown"));
  const member = await f.owner.settings.readMember(f.owner.member!);
  const id = "lost-native-build";
  const response = await f.fetch("/actions", {
    id,
    key: "family.build",
    target: { kind: "document", ref: f.owner.target },
    input: { source: { ...f.owner.member, sha256: member.sha256 } },
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  const row = await f.owner.journal.wait(id);
  expect(row, JSON.stringify(row)).toMatchObject({ state: "unknown" });
  expect(row.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "native",
        key: "family.build",
        state: "unknown",
        dispatchedAt: expect.any(String),
      }),
    ]),
  );
  expect(row.steps.find((step) => step.key === "family.build")).not.toHaveProperty("notDispatched");
});

test("separate demo journals retain the same exact request ID without rewriting or sharing receipts", async () => {
  const first = await setup();
  const second = await setup();
  const id = "same-client-request";
  for (const f of [first, second]) {
    const response = await f.fetch("/actions", {
      id,
      key: "rhvac.launch",
      target: { kind: "host" },
      input: { path: f.owner.r10Path },
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    expect(await response.json()).toMatchObject({ id });
    expect(await f.owner.journal.wait(id)).toMatchObject({ id, state: "succeeded" });
    const rows = await (await f.fetch(`/actions?id=${id}`)).json();
    expect(rows).toMatchObject([{ id, input: { path: f.owner.r10Path } }]);
  }
  const changed = await first.fetch("/actions", {
    id,
    key: "rhvac.launch",
    target: { kind: "host" },
    input: { path: second.owner.r10Path },
  });
  expect(changed.status).toBe(409);
  expect((await changed.json()).message).toContain("conflicts with its admitted intent");
  const archive = await first.fetch("/actions", {
    id: "host-file-escape",
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "production", archivePath: join(first.parent, "outside.zip") },
  });
  expect(archive.status).toBe(409);
  expect(await first.owner.journal.list(undefined, "host-file-escape")).toEqual([]);
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
    (
      await f.fetch("/actions", {
        id: "production-unknown",
        key: "family.capture",
        target: { kind: "document", ref: { session: "production", openId: "production" } },
        input: {},
      })
    ).status,
  ).toBe(409);
  await f.owner.dispose();
  expect(await readFile(join(production, "keep.json"), "utf8")).toBe("KEEP");
});

test("completed Families readings use the production parts protocol for retained readback", async () => {
  const seed = family();
  const f = await setup({
    ...seed,
    route: "families",
    work: { ...seed.work, candidate: familiesRouteState.schema.parse({}) },
    readings: {
      profile: { patch: { families: {} } },
      member: { pod: "demo", path: "settings/patch.json" },
      families: ["Box"],
    },
    page: { armed: true },
    scenario: "success",
  });
  const response = await f.fetch("/families/readings", {
    work: f.owner.scope,
    filter: { categoryNames: ["Ducts"], familyNames: [], placementScope: "AllLoaded" },
  });
  const reading = await response.json();
  expect(response.ok).toBe(true);
  const parts = await f.fetch(`/families/readings?id=${reading.id}&format=parts`);
  expect(await parts.json()).toEqual({ reading, records: null });
});

test("same HTTP router separates production Work and two demo resource owners; reset cannot retire production", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pe-demo-namespaces-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const productionFile = join(parent, "production-work.json");
  const scope = {
    binding: "workspace" as const,
    route: settingsRouteState.route,
    target: null,
    work: "production",
  };
  const production = new RouteWorkspace({
    registrations: [{ spec: settingsRouteState }],
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
    [{ path: ["fields"], value: { "/private": { edit: { value: "production sentinel" } } } }],
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
      scope: { binding: "workspace"; route: string; target: null; work: string };
    }>;
  const a = await create(),
    b = await create();
  const reading = async (
    base: string,
    requested: typeof scope,
    kind: "work" | "family-readings" = "work",
  ) => {
    const response = await send(
      `${base}/pe/resources?keys=${encodeURIComponent(JSON.stringify([kind === "work" ? { kind, ...requested } : { kind, work: requested }]))}`,
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
  const familyScope = { ...a.scope, route: "family" };
  expect(await reading(a.base, familyScope)).toMatchObject({ kind: "snapshot" });
  expect(await reading(a.base, familyScope, "family-readings")).toMatchObject({ kind: "snapshot" });
  expect(await reading(b.base, familyScope, "family-readings")).toMatchObject({ kind: "failure" });
  expect(JSON.stringify(await reading("", scope))).toContain("production sentinel");
  expect((await send(a.base, { method: "DELETE" })).status).toBe(200);
  expect(await reading(b.base, b.scope)).toMatchObject({ kind: "snapshot" });
  expect(await readFile(productionFile, "utf8")).toBe(before);
});
