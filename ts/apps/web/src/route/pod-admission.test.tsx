// @vitest-environment jsdom
import { resolve } from "node:path";
import { readFile, cp, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { routeFingerprint } from "../../../../packages/agent-contracts/src/route-module";
import { tmpdir } from "node:os";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey } from "@pe/agent-contracts";
import { createPackageLifecycle } from "../../../host/src/package-lifecycle";
import { listPackages } from "../../../host/src/packages";
import { createPodRoutes } from "../../../host/src/pod-routes";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { Readings } from "../readings";
import type { AdmittedMount } from "../shell/admitted-mount";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { createElement, useSyncExternalStore } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { podRouteDescriptorSchema } from "@pe/agent-contracts";
import { admitPodArtifact } from "./pod-artifact";
import { publicRoutes, registerRoute } from "./builtin-routes";
import { createPodRouteLoader } from "./pod-loader";
import { createRouteShell } from "../shell/admitted-mount";
import { AdmittedPane } from "../shell/admitted-place.test-fixture";
import { admittedSources } from "../shell/admitted-sources";
import { sourceRouteServices } from "../shell/source-route-services";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";

const root = resolve(process.cwd(), "../../../examples/pods/snowdon-circuits");
const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);
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
  const artifact = JSON.parse(await readFile(resolve(root, row.artifact), "utf8"));
  return { row, envelope: { fingerprint: row.fingerprint, artifact } };
}
afterEach(cleanup);

test("published fixture bytes admit and tampering refuses before evaluation or registration", async () => {
  const { row, envelope } = await fixture();
  const route = await admitPodArtifact(row, envelope, evaluate);
  expect(route.fingerprint).toBe(row.fingerprint.slice(10));
  expect(route.workFingerprint).toBe(row.fingerprint);
  const dispose = registerRoute(route);
  // One registration: the same handle mounts, is discovered, and carries its hosted Work.
  expect(publicRoutes.admitted(row.workRoute)).toBe(route);
  expect(publicRoutes.get(row.workRoute)).toMatchObject({ admitted: route, work: { route: route.resolvedWork!.spec.route } });
  expect(publicRoutes.byAddress(route.data.address)?.admitted).toBe(route);
  dispose();
  expect(publicRoutes.admitted(row.workRoute)).toBeNull();
  expect(publicRoutes.get(row.workRoute)).toBeUndefined();
  expect(() => registerRoute(route)).toThrow("retired");
  const tampered = structuredClone(envelope);
  tampered.artifact.executables[0].members[0].bytes[0] ^= 1;
  const execute = vi.fn(evaluate);
  await expect(admitPodArtifact(row, tampered, execute)).rejects.toThrow("differ");
  expect(execute).not.toHaveBeenCalled();
  await expect(
    admitPodArtifact({ ...row, fingerprint: `pod-bytes:${"0".repeat(64)}` }, envelope, execute),
  ).rejects.toThrow("inventory");
  expect(publicRoutes.admitted(row.workRoute)).toBeNull();
});

test.each(["deactivation", "removal", "replacement"])(
  "admitted Pod renders through AdmittedPane and %s releases its Work feed",
  async (change) => {
    const { row, envelope } = await fixture();
    const releases = vi.fn();
    const fingerprints: unknown[] = [];
    const replacement = structuredClone(envelope);
    const member = replacement.artifact.executables[0].members[0];
    member.bytes.push(...new TextEncoder().encode("\n// replacement closure"));
    replacement.artifact.artifact.executables[0].members[0].sha256 = createHash("sha256")
      .update(Uint8Array.from(member.bytes))
      .digest("hex");
    replacement.artifact.fingerprint = await routeFingerprint(replacement.artifact.artifact);
    replacement.fingerprint = `pod-bytes:${replacement.artifact.fingerprint}`;
    const loader = createPodRouteLoader(async (entry) =>
      registerRoute(
        await admitPodArtifact(
          entry,
          entry.fingerprint === row.fingerprint ? envelope : replacement,
          evaluate,
        ),
      ),
    );
    await loader.sync([row]);
    const route = publicRoutes.admitted(row.workRoute)!;
    const door = createFixtureWorkDoor(
      {
        route: route.data.key,
        title: route.data.name,
        description: "Pod fixture",
        schema: route.resolvedWork!.schema,
      },
      { version: 2, inputs: { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" } },
    );
    const services = {
      ...sourceRouteServices(admittedSources(route)),
      work: {
        ...door,
        open(scope) {
          fingerprints.push(scope.fingerprint);
          const feed = door.open(scope);
          return {
            subscribe(deliver, end) {
              const close = feed.subscribe(deliver, end);
              return () => {
                close();
                releases();
              };
            },
          };
        },
      },
    } satisfies Parameters<typeof createRouteShell>[0];
    const shell = createRouteShell(services);
    const address = { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} };
    function View() {
      useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
      const current = publicRoutes.admitted(row.workRoute);
      return current
        ? createElement(AdmittedPane, { shell, route: current, address })
        : null;
    }
    render(createElement(View));
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"drop"'),
    );
    expect(fingerprints).toEqual([route.workFingerprint]);
    if (change === "replacement") {
      await act(() => loader.sync([{ ...row, fingerprint: replacement.fingerprint }]));
      await vi.waitFor(() =>
        expect(screen.getByText(/Authored inputs/).textContent).toContain('"drop"'),
      );
      expect(publicRoutes.admitted(row.workRoute)?.workFingerprint).toBe(replacement.fingerprint);
      expect(releases).toHaveBeenCalledOnce();
      expect(fingerprints).toEqual([row.fingerprint, replacement.fingerprint]);
      await act(() => loader.sync([]));
      expect(releases).toHaveBeenCalledTimes(2);
    } else {
      await act(() => loader.sync(change === "removal" ? [] : [{ ...row, trusted: false }]));
      expect(releases).toHaveBeenCalledOnce();
    }
    expect(screen.queryByText(/Authored inputs/)).toBeNull();
    expect(publicRoutes.admitted(row.workRoute)).toBeNull();
    loader.dispose();
  },
);

async function hostHarness() {
  const dir = await mkdtemp(resolve(tmpdir(), "p3-snowdon-"));
  await cp(root, resolve(dir, "Pods/snowdon-circuits"), { recursive: true });
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(resolve(dir, "Pods")),
    decisionsPath: resolve(dir, "enabled.json"),
  });
  const store = fileRouteDocumentStore(resolve(dir, "Work"));
  const workspace = new RouteWorkspace({ registrations: [], store });
  const routes = createPodRoutes(lifecycle, { workspace, trustPath: resolve(dir, "trust.json") });
  const [row] = await routes.list();
  const key = bindWork(row!.workRoute, null);
  const inputs = { size: "10", length: 175, amps: 20, voltage: 208, phase: "3" };
  await store.setState({
    targetKey: workKey(key),
    route: key.route,
    value: { version: 1, schemaVersion: 1, revision: 7, doc: { state: { inputs } }, history: [] },
  });
  await routes.trust(row!.key, row!.fingerprint, true);
  const trusted = (await routes.list())[0]!;
  const route = await admitPodArtifact(
    trusted,
    await routes.bundle(trusted.key, trusted.fingerprint),
    evaluate,
  );
  const observe = observeResources(workspace, { observe: () => () => {} });
  const acquired: string[] = [],
    released: string[] = [];
  const source: Readings = {
    subscribe(request, deliver) {
      acquired.push(request.kind);
      const close = observe(request, deliver);
      return () => {
        close();
        released.push(request.kind);
      };
    },
    dirty() {
      throw Error("Unexpected feed recovery in contiguous Snowdon drive");
    },
  };
  const ports = {
    write: (
      key: Parameters<typeof workspace.write>[0],
      write: Parameters<typeof workspace.write>[3],
    ) => workspace.write(key, key.route, "human", write),
    submit: async () => {
      throw Error("No native command in Snowdon calculator");
    },
  };
  return {
    dir,
    lifecycle,
    store,
    workspace,
    routes,
    route,
    trusted,
    key,
    inputs,
    acquired,
    released,
    source,
    ports,
    async close() {
      routes.close();
      await lifecycle.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
function settle(observation: Observation<WorkWriteOutcome>) {
  return new Promise<WorkWriteOutcome>((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
}
const address = () => ({
  read: () => new URLSearchParams(),
  write() {},
  subscribe: () => () => {},
});

test("Snowdon real host + React mount migrates v1, renders subject/calculation, edits, undoes and redoes", async () => {
  const h = await hostHarness();
  let mount!: AdmittedMount;
  const base = createRouteShell({
    ...sourceRouteServices(admittedSources(h.route)),
    work: createWorkFeedClient(h.source, h.ports),
  });
  const shell = {
    mount(...args: Parameters<typeof base.mount>) {
      mount = base.mount(...args);
      return mount;
    },
  } as typeof base;
  const view = render(
    createElement(AdmittedPane, { shell, route: h.route, address: address() }),
  );
  try {
    await vi.waitFor(() =>
      expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 175'),
    );
    expect(screen.getAllByText("Copper voltage-drop worksheet").length).toBeGreaterThan(0);
    expect(screen.getByText(/Authored inputs/).textContent).toContain('"drop"');
    expect(await h.store.getState({ targetKey: workKey(h.key), route: h.key.route })).toMatchObject(
      { schemaVersion: 2, revision: 8, doc: { version: 2, inputs: h.inputs } },
    );
    await act(async () => {
      expect(
        await settle(
          mount.invoke("input", { ...h.inputs, length: 300 }) as Observation<WorkWriteOutcome>,
        ),
      ).toMatchObject({ kind: "accepted" });
    });
    expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 300');
    await act(async () => {
      await mount.history!.undo();
    });
    expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 175');
    await act(async () => {
      await mount.history!.redo();
    });
    expect(screen.getByText(/Authored inputs/).textContent).toContain('"length": 300');
    expect(h.acquired.filter((kind) => kind === "work" || kind === "work-acks").sort()).toEqual(["work", "work-acks"]);
    view.unmount();
    expect(h.released.filter((kind) => kind === "work" || kind === "work-acks").sort()).toEqual(["work", "work-acks"]);
  } finally {
    view.unmount();
    await h.close();
  }
});

test("stale Pod tab shows reload and cannot reacquire Work feeds after Page changes or remount", async () => {
  const h = await hostHarness();
  let mount!: AdmittedMount;
  const staleSource: Readings = {
    ...h.source,
    subscribe(request, deliver) {
      return h.source.subscribe(
        {
          ...request,
          admission: { routeKey: h.route.data.key, fingerprint: `pod-bytes:${"0".repeat(64)}` },
        } as Parameters<Readings["subscribe"]>[0],
        deliver,
      );
    },
  };
  const base = createRouteShell({
    ...sourceRouteServices(admittedSources(h.route)),
    work: createWorkFeedClient(staleSource, h.ports),
  });
  const shell = {
    mount(...args: Parameters<typeof base.mount>) {
      mount = base.mount(...args);
      return mount;
    },
  } as typeof base;
  const view = render(
    createElement(AdmittedPane, { shell, route: h.route, address: address() }),
  );
  try {
    await vi.waitFor(() => expect(screen.getByText(/older version.*reload/)).toBeTruthy());
    const workFeeds = () => h.acquired.filter((kind) => kind === "work" || kind === "work-acks");
    const count = workFeeds().length;
    act(() => {
      mount.controls.subject(null);
    });
    expect(screen.getByText(/older version.*reload/)).toBeTruthy();
    view.unmount();
    render(
      createElement(AdmittedPane, {
        shell,
        route: h.route,
        address: address(),
      }),
    );
    await vi.waitFor(() => expect(screen.getByText(/older version.*reload/)).toBeTruthy());
    expect(workFeeds()).toHaveLength(count);
  } finally {
    cleanup();
    await h.close();
  }
});

test("Pod discovery and tools have no legacy graph mount or member-hash door", async () => {
  for (const name of ["pod-routes.tsx", "pod-artifact.ts", "route-discovery.ts"]) {
    const source = await readFile(resolve(process.cwd(), "src/route", name), "utf8");
    expect(source).not.toMatch(
      /makePodRoute|registerLegacyModule|mountRoute\(|verifyBundle|row\.sha256|row\.sourcePath/,
    );
  }
  const tool = await readFile(resolve(process.cwd(), "src/routes/tool.$key.tsx"), "utf8");
  // The tool page mounts the registered handle itself, never a discovery row's hosted adapter.
  expect(tool).not.toMatch(/\.hosted|row\.sha256|row\.sourcePath/);
  await expect(readFile(resolve(process.cwd(), "src/route/pod-view.tsx"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
