import { describe, expect, it, vi } from "vite-plus/test";
import { createPodRouteLoader, verifyBundle } from "./pod-loader";
import { actionReceiptSchema, podRouteDescriptorSchema, bindWork } from "@pe/agent-contracts";
import { makePodRoute, type PodRouteBundle } from "./pod-view";
import { podRead } from "./pod-sources";
import { createGraphMount } from "#/shell/mount";
import { createFixtureMount } from "#/shell/fixture";
import { publicRoutes } from "./builtin-routes";
import { podPathWork, podPathName, podWorkPath } from "./pod-address";

const row = podRouteDescriptorSchema.parse({
  key: "route:@test/routes/tool/index.js",
  workRoute: "pod.test.tool",
  packageId: "test",
  name: "Tool",
  description: "Test",
  sourcePath: "routes/tool/index.js",
  sha256: "a".repeat(64),
  trusted: true,
});

describe("Pod route byte custody", () => {
  it("rejects a schema-valid receipt for a different document than the route action admitted", async () => {
    const { graph, adapters } = makePodRoute(row, {
      version: 1,
      initial: {},
      reducer: (state) => state,
      create: () => () => null,
    });
    const owner = createGraphMount(graph, {
      ...adapters,
      getSnapshot: () => ({
        target: { kind: "document", ref: { session: "s", openId: "original" } },
        work: {
          handle: { key: bindWork(row.workRoute, null, "calculator"), revision: 3 },
          doc: { version: 1 as const, state: {} },
        },
      }),
      subscribe: () => () => {},
      subscribeAcceptedDeltas: () => () => {},
      write: async () => {
        throw Error("Unexpected write");
      },
    });
    owner.view.setPage({
      request: { key: "revit.context.show-elements", input: { elementIds: [1] } },
    });
    vi.stubGlobal("fetch", async (_url: unknown, request: RequestInit) => {
      if (!request?.body) return Response.json([]);
      const sent = JSON.parse(request.body as string);
      return Response.json(
        actionReceiptSchema.parse({
          id: sent.id,
          key: sent.key,
          input: sent.input,
          target: { kind: "document", ref: { session: "s", openId: "different" } },
          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          state: "succeeded",
          result: {},
          steps: [],
          recovery: [],
          prepared: { state: "ready", value: {} },
          startedAt: "2026-10-14T00:00:00.000Z",
        }),
      );
    });
    try {
      expect((await owner.control("execute").run()).state).toBe("review");
      expect(await owner.control("execute").run()).toMatchObject({
        state: "failed",
        refusal: { message: expect.stringContaining("different intent or target") },
      });
    } finally {
      owner.dispose();
      vi.unstubAllGlobals();
    }
  });
  it("never imports untrusted bytes and disposes a changed or disabled route", async () => {
    const events: string[] = [];
    const loader = createPodRouteLoader(async (entry) => {
      events.push(`load:${entry.sha256.slice(0, 1)}`);
      return () => {
        events.push(`dispose:${entry.sha256.slice(0, 1)}`);
      };
    });
    await loader.sync([{ ...row, trusted: false }]);
    expect(events).toEqual([]);
    await loader.sync([row]);
    await loader.sync([podRouteDescriptorSchema.parse({ ...row, sha256: "b".repeat(64) })]);
    await loader.sync([]);
    expect(events).toEqual(["load:a", "dispose:a", "load:b", "dispose:b"]);
  });
  it("disposes an import that finishes after removal, without resurrecting it", async () => {
    let resolve!: (dispose: () => void) => void;
    let disposed = false;
    const loader = createPodRouteLoader(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = loader.sync([row]);
    await loader.sync([]);
    resolve(() => {
      disposed = true;
    });
    await pending;
    expect(disposed).toBe(true);
  });
  it("checks the received bytes against the trusted hash before import", async () => {
    const bytes = new TextEncoder().encode("export const version = 1;");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const trusted = podRouteDescriptorSchema.parse({ ...row, sha256 });
    await expect(verifyBundle(bytes, trusted.sha256)).resolves.toBeUndefined();
    await expect(
      verifyBundle(new TextEncoder().encode("export const version = 2;"), trusted.sha256),
    ).rejects.toThrow("changed");
  });
});

it("a verified Pod bundle registers one executable RouteGraph", async () => {
  const bytes = new TextEncoder().encode("verified Pod module");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const trusted = { ...row, sha256 };
  let imported = 0;
  const loader = createPodRouteLoader(async (entry) => {
    await verifyBundle(bytes, entry.sha256);
    imported++;
    const { graph, hosted } = makePodRoute(entry, {
      version: 1,
      initial: { value: 1 },
      reducer: (state, event) => ({ ...state, value: event.value }),
      create: () => () => null,
      fixtures: { edit: { title: "Edit", state: { value: 1 } } },
    });
    return publicRoutes.registerGraph(graph, hosted);
  });
  try {
    await loader.sync([{ ...trusted, trusted: false }]);
    expect(imported).toBe(0);
    await loader.sync([row]);
    expect(imported).toBe(0);
    expect(publicRoutes.get(row.workRoute)).toBeUndefined();
    await loader.sync([trusted]);
    const registration = publicRoutes.get(row.workRoute)!;
    expect(registration.graph).toBe(registration.manifest);
    expect(publicRoutes.entries().filter((r) => r.graph?.key === row.workRoute)).toHaveLength(1);
    const graph = registration.graph!;
    expect(podWorkPath(row.workRoute)).toBe(`/${graph.address}`);
    expect(podPathWork(`/${graph.address}`)).toBe(row.workRoute);
    expect(podPathName(`/${graph.address}`)).toBe(row.name);
    const owner = await createFixtureMount(graph, "edit", {
      binding: (_id, input) => ({ subject: null, args: input ?? {} }),
    });
    const release = owner.connect();
    try {
      expect((await owner.control("edit", { value: 7 }).run()).state).toBe("done");
      expect(owner.snapshot().work?.doc.state.value).toBe(7);
      await owner.restore("undo");
      expect(owner.snapshot().work?.doc.state.value).toBe(1);
    } finally {
      release();
      owner.dispose();
    }
  } finally {
    loader.dispose();
  }
  expect(podWorkPath(row.workRoute)).toBeUndefined();
});

it("refuses untrusted bundles before creating a graph", () => {
  const create = vi.fn();
  expect(() =>
    makePodRoute(
      { ...row, trusted: false },
      { version: 1, initial: {}, reducer: (s) => s, create },
    ),
  ).toThrow("Trust");
  expect(create).not.toHaveBeenCalled();
});

it("keeps raw execution and exports human-only, and refuses mutations through the read door", async () => {
  const { graph } = makePodRoute(row, {
    version: 1,
    initial: {},
    reducer: (s) => s,
    create: () => () => null,
  });
  expect(graph.verbs.execute).toMatchObject({ kind: "command", caller: "human", review: "shown" });
  expect(graph.verbs.export).toMatchObject({ kind: "command", caller: "human" });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      podRead.run(
        { key: "revit.context.show-elements", input: {} },
        { target: { kind: "document", ref: { session: "s", openId: "d" } }, work: null },
      ),
    ).rejects.toThrow("Mutations require action admission");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("the shipped Snowdon bundle exposes its calculator through the common fixture lane", async () => {
  const module = new URL(
    "../../../../../examples/pods/snowdon-circuits/routes/voltage-drop/index.js",
    import.meta.url,
  ).href;
  const bundle = (await import(/* @vite-ignore */ module)) as PodRouteBundle;
  const { graph, adapters } = makePodRoute(row, bundle);
  const owner = await createFixtureMount(graph, "calculator", adapters);
  try {
    expect(owner.snapshot().failure).toBeFalsy();
    expect(owner.snapshot().work?.doc.state).toMatchObject({
      reading: null,
      target: "3",
      inputs: { size: "10" },
    });
  } finally {
    owner.dispose();
  }
});
