// @vitest-environment jsdom
import { resolve } from "node:path";
import { readFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createElement, useSyncExternalStore } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import {
  bindWork,
  workKey,
  podRouteDescriptorSchema,
  routeFingerprint,
  workFingerprintSchema,
} from "@pe/agent-contracts";
import { createPackageLifecycle } from "../../../host/src/package-lifecycle";
import { listPackages } from "../../../host/src/packages";
import { createPodRoutes } from "../../../host/src/pod-routes";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { graphRoute, registeredReads } from "../../../host/src/reads/routes";
import { Publications } from "../../../host/src/reads/evaluator";
import { loadPodHostEntry, podArtifactSchema } from "../../../host/src/pod-artifact";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { mountTypedRoute } from "../shell/typed-mount";
import type { Readings } from "../host/resource-stream";
import type { UseSource } from "../shell/source-contract";
import { loadPodRoute } from "./pod-module";
import { registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { createPodRouteLoader } from "./pod-loader";
const root = resolve(process.cwd(), "../../../examples/pods/snowdon-circuits");
const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);
afterEach(cleanup);
async function fixture() {
  const manifest = JSON.parse(await readFile(resolve(root, "pod.json"), "utf8"));
  const member = manifest.routes[0];
  const row = podRouteDescriptorSchema.parse({
    ...member,
    key: `route:@snowdon-circuits/${member.artifact}`,
    packageId: "snowdon-circuits",
    workRoute: "pod.snowdon-circuits.voltage-drop",
    trusted: true,
  });
  return {
    row,
    envelope: {
      fingerprint: row.fingerprint,
      artifact: podArtifactSchema.parse(
        JSON.parse(await readFile(resolve(root, row.artifact), "utf8")),
      ),
    },
  };
}
test("published Snowdon browser and host bytes are verified before either registry changes", async () => {
  const { row, envelope } = await fixture();
  const loaded = await loadPodRoute(row, envelope, evaluate);
  const stop = registerTypedRoute(loaded.module, loaded.fingerprint);
  expect(publicRoutes.typed(row.workRoute)).toBe(loaded.module);
  expect(publicRoutes.get(row.workRoute)?.work?.admission?.fingerprint).toBe(row.fingerprint);
  expect(publicRoutes.byAddress(loaded.module.data.address)?.manifest.key).toBe(row.workRoute);
  stop();
  expect(publicRoutes.typed(row.workRoute)).toBeNull();
  for (const client of ["web", "host"]) {
    const changed = structuredClone(envelope);
    changed.artifact.executables.find((entry) => entry.client === client)!.members[0]!.bytes[0]! ^=
      1;
    const execute = vi.fn(evaluate);
    await expect(loadPodRoute(row, changed, execute)).rejects.toThrow("differ");
    await expect(loadPodHostEntry(changed.artifact, row.fingerprint)).rejects.toThrow("differ");
    expect(execute).not.toHaveBeenCalled();
    expect(publicRoutes.typed(row.workRoute)).toBeNull();
  }
});
test.each(["deactivation", "removal", "replacement"])(
  "typed Pod %s removes exactly its runtime registration",
  async (change) => {
    const { row, envelope } = await fixture(),
      replacement = structuredClone(envelope),
      dispose = vi.fn();
    const member = replacement.artifact.executables.find((entry) => entry.client === "web")!
      .members[0]!;
    member.bytes.push(...new TextEncoder().encode("\n// replacement"));
    (
      replacement.artifact.artifact.executables as {
        client: string;
        members: { sha256: string }[];
      }[]
    ).find((entry) => entry.client === "web")!.members[0]!.sha256 = createHash("sha256")
      .update(Uint8Array.from(member.bytes))
      .digest("hex");
    replacement.artifact.fingerprint = await routeFingerprint(replacement.artifact.artifact);
    replacement.fingerprint = `pod-bytes:${replacement.artifact.fingerprint}`;
    const loader = createPodRouteLoader(async (entry) => {
      const route = await loadPodRoute(
        entry,
        entry.fingerprint === row.fingerprint ? envelope : replacement,
        evaluate,
      );
      const stop = registerTypedRoute(route.module, route.fingerprint);
      return () => {
        stop();
        dispose();
      };
    });
    await loader.sync([row]);
    expect(publicRoutes.typed(row.workRoute)).not.toBeNull();
    await loader.sync(
      change === "replacement"
        ? [{ ...row, fingerprint: replacement.fingerprint }]
        : change === "removal"
          ? []
          : [{ ...row, trusted: false }],
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(publicRoutes.typed(row.workRoute) !== null).toBe(change === "replacement");
    loader.dispose();
    expect(publicRoutes.typed(row.workRoute)).toBeNull();
  },
);
async function harness(stale = false) {
  const dir = await mkdtemp(resolve(tmpdir(), "snowdon-typed-"));
  await cp(root, resolve(dir, "Pods/snowdon-circuits"), {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
  });
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(resolve(dir, "Pods")),
    decisionsPath: resolve(dir, "enabled.json"),
  });
  const store = fileRouteDocumentStore(resolve(dir, "Work")),
    workspace = new RouteWorkspace({ registrations: [], store });
  const routes = createPodRoutes(lifecycle, { workspace, trustPath: resolve(dir, "trust.json") });
  const [row] = await routes.list();
  if (!row) throw Error("Missing Snowdon");
  const key = bindWork(row.workRoute, null),
    inputs = { size: "10", length: 175, amps: 20, voltage: 208, phase: "3" };
  await store.setState({
    targetKey: workKey(key),
    route: key.route,
    value: { version: 1, schemaVersion: 2, revision: 7, doc: { version: 2, inputs }, history: [] },
  });
  await routes.trust(row.key, row.fingerprint, true);
  const trusted = (await routes.list())[0]!;
  const route = await loadPodRoute(
    trusted,
    await routes.bundle(trusted.key, trusted.fingerprint),
    evaluate,
  );
  const observe = observeResources(workspace, { observe: () => () => {} }),
    acquired: string[] = [],
    released: string[] = [];
  const source: Readings = {
    subscribe(request, deliver) {
      acquired.push(request.kind);
      const close = observe(
        stale && (request.kind === "work" || request.kind === "work-acks")
          ? {
              ...request,
              admission: {
                routeKey: key.route,
                fingerprint: workFingerprintSchema.parse(`pod-bytes:${"0".repeat(64)}`),
              },
            }
          : request,
        deliver,
      );
      return () => {
        close();
        released.push(request.kind);
      };
    },
    dirty() {
      throw Error("Unexpected recovery");
    },
  };
  const work = createWorkFeedClient(source, {
    write: (scope, write) => workspace.write(scope, scope.route, "human", write),
    submit: async () => {
      throw Error("No native command");
    },
  });
  let revision = 0;
  const publication: UseSource = {
    kind: "use",
    async open(ctx, deliver) {
      const owner = new Publications(),
        id = crypto.randomUUID();
      let generation = 0,
        closed = false;
      const refresh = async () => {
        const binding = graphRoute("reads.value", {
          read: `${row.workRoute}.calculation`,
          args: {},
          subscription: id,
          generation: generation++,
        });
        const packet = await binding.publish(owner, id, generation, {
          evaluation: id,
          origin: { kind: "test" },
          revision: () => revision,
          take: async (name, args) => {
            if (name !== "work") throw Error(`Unexpected input ${name}`);
            const input = args as { scope: typeof key; owner: string };
            return workspace.read(input.scope, input.owner);
          },
        });
        if (!closed && !ctx.signal.aborted)
          deliver({ kind: "complete", value: packet, revision: generation });
      };
      const stop = workspace.subscribeUncaptured(() => {
        revision++;
        void refresh();
      });
      await refresh();
      return () => {
        closed = true;
        stop();
      };
    },
  };
  const mount = mountTypedRoute(
    route.module,
    {
      target: { kind: "host" },
      fixture: null,
      work: { address: null, open: null },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      memory: () => ({}),
      custody: { current: () => true },
    },
    route.fingerprint,
    { work, sources: { [`${row.workRoute}.calculation`]: publication } },
  );
  return {
    dir,
    lifecycle,
    store,
    workspace,
    routes,
    row,
    route,
    key,
    inputs,
    acquired,
    released,
    mount,
    async close() {
      mount.dispose();
      routes.close();
      await lifecycle.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("Snowdon mounts typed over real host Work and tracked calculation, edits, undoes and redoes", async () => {
  const h = await harness();
  function View() {
    useSyncExternalStore(h.mount.subscribe, h.mount.revision, h.mount.revision);
    return createElement("div", null, String(h.mount.draw("calculation")));
  }
  const view = render(createElement(View));
  try {
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 175'),
    );
    expect(registeredReads.reads.has(`${h.row.workRoute}.calculation`)).toBe(true);
    let edit!: ReturnType<typeof h.mount.draw>;
    await act(async () => {
      edit = h.mount.draw("calculation", (ctx) =>
        ctx.cells.edit({ ...h.inputs, length: 300 }, { label: "Change length" }),
      );
      await edit;
    });
    await expect(edit).resolves.toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 300'),
    );
    expect(screen.getByText(/Copper voltage-drop worksheet/).textContent).toContain('"drop"');
    await act(() => h.mount.history.undo());
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 175'),
    );
    await act(() => h.mount.history.redo());
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 300'),
    );
    expect((await h.workspace.read(h.key, h.key.route))?.doc).toMatchObject({
      inputs: { length: 300 },
    });
  } finally {
    view.unmount();
    await h.close();
  }
  expect(registeredReads.reads.has(`${h.row.workRoute}.calculation`)).toBe(false);
  expect(h.acquired.filter((kind) => kind === "work" || kind === "work-acks").sort()).toEqual([
    "work",
    "work-acks",
  ]);
  expect(h.released.filter((kind) => kind === "work" || kind === "work-acks").sort()).toEqual([
    "work",
    "work-acks",
  ]);
});

test("a stale typed Pod remains read-only after refresh and retained return", async () => {
  const h = await harness(true);
  try {
    await vi.waitFor(() => expect(h.mount.owner(h.key.route)?.problem).toMatch(/older|reload/i));
    const count = h.acquired.filter((kind) => kind === "work" || kind === "work-acks").length;
    const edit = () =>
      h.mount.draw("calculation", (ctx) =>
        ctx.cells.edit({ ...h.inputs, length: 300 }, { label: "Stale edit" }),
      );
    expect(await edit()).toMatchObject({ code: "unavailable" });
    h.mount.refresh();
    h.mount.release();
    const stop = h.mount.subscribe(() => {});
    try {
      expect(await edit()).toMatchObject({ code: "unavailable" });
    } finally {
      stop();
    }
    expect(h.acquired.filter((kind) => kind === "work" || kind === "work-acks")).toHaveLength(
      count,
    );
    expect((await h.workspace.read(h.key, h.key.route))?.doc).toMatchObject({ inputs: h.inputs });
  } finally {
    await h.close();
  }
});
