import { mkdtemp, readFile, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { address, exportSeed, type DemoSeed } from "@pe/agent-contracts";
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
    key: { binding: "workspace" as const, route: "family", target: null, work: "production" },
    revision: 12,
    candidate: { basis: null, fields: { "/family/name": { staged: { value: "Saved Demo" } } } },
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
test("admitted demo launch uses only its labelled leaf and rejects escape or real IO fallback", async () => {
  const f = await setup();
  const submit = async (suffix: string, key: string, path: string) => {
    const id = `${f.owner.id}:${suffix}`;
    const response = await f.fetch("/actions", {
      id,
      kind: "operation",
      key,
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
      scope: { binding: "workspace"; route: string; target: null; work: string };
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
