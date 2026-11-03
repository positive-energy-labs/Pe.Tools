import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey, type ReadingFrame } from "@pe/agent-contracts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { builtinData } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import { buildRouteArtifact } from "../../web/route-module-hash.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { listPackages } from "../src/packages.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
import { createPluginsHandler } from "../src/plugins-handler.ts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { admitPodArtifact } from "../src/pod-artifact.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

async function fixture(root: string, fail = false, salt = "first") {
  const data = {
    ...builtinData,
    key: "pod.fixture.tool",
    address: "/pod/fixture/tool",
    work: { schema: "work", route: "pod.fixture.tool", version: 2, migrations: { "1": "upgrade" } },
  };
  const entry = join(root, "entry.ts");
  const imports = fileURLToPath(
    new URL("../../../packages/agent-contracts/src/route-kernel.fixtures.ts", import.meta.url),
  ).replaceAll("\\", "/");
  await writeFile(
    entry,
    `import { builtinModule } from ${JSON.stringify(imports)};
export const module = { ...builtinModule, data: ${JSON.stringify(data)}, bodies: {
...Object.fromEntries(Object.entries(builtinModule.bodies).map(([key, body]) => [key, {...body, source: {module:'route.js', export:key}}])),
upgrade: {kind:'migration', slot:'work.migrations.1', source:{module:'route.js',export:'upgrade'}, run(raw) { ${fail ? "raw.oldAmount = 999; throw Error('broken upgrade');" : `return {amount: raw.oldAmount + 1, note: '${salt}'};`} }}
}};`,
  );
  const artifact = await buildRouteArtifact({
    entry,
    root,
    data,
    contracts: [{ id: "test-contract", bytes: new TextEncoder().encode("fixture-contract") }],
  });
  const wire = JSON.parse(
    JSON.stringify(artifact, (_key, value) => (value instanceof Uint8Array ? [...value] : value)),
  );
  const directory = join(root, "Pods/fixture/routes/tool");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "route.artifact"), JSON.stringify(wire));
  const fingerprint = `pod-bytes:${artifact.fingerprint}`;
  await writeFile(
    join(root, "Pods/fixture/pod.json"),
    JSON.stringify({
      id: "fixture",
      routes: [
        {
          artifact: "routes/tool/route.artifact",
          fingerprint,
          name: "Fixture",
          description: "host admission probe",
        },
      ],
    }),
  );
  return { wire, fingerprint: workFingerprintSchema.parse(fingerprint) };
}

async function setup(fail = false) {
  const root = await mkdtemp(join(tmpdir(), "pe-p2-"));
  try {
    const artifact = await fixture(root, fail);
    const lifecycle = createPackageLifecycle({
      packages: () => listPackages(join(root, "Pods")),
      decisionsPath: join(root, "enabled.json"),
    });
    const disk = fileRouteDocumentStore(join(root, "Work"));
    const key = bindWork("pod.fixture.tool", null);
    await disk.setState({
      targetKey: workKey(key),
      route: key.route,
      value: { version: 1, schemaVersion: 1, revision: 7, doc: { oldAmount: 3 }, history: [] },
    });
    const savedPath = join(root, "Work", (await readdir(join(root, "Work")))[0]!);
    const original = await readFile(savedPath, "utf8");
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const workspace = new RouteWorkspace({
      registrations: [],
      store: {
        ...disk,
        listState: async () => {
          await gate;
          return disk.listState!();
        },
      },
    });
    const releasedSnapshots = vi.fn(),
      releasedAcks = vi.fn();
    const observeWork = workspace.observe.bind(workspace),
      observeAcks = workspace.observeAccepted.bind(workspace);
    const snapshotOpens = vi.spyOn(workspace, "observe").mockImplementation((...args) => {
      const release = observeWork(...args);
      return () => {
        releasedSnapshots();
        release();
      };
    });
    const ackOpens = vi.spyOn(workspace, "observeAccepted").mockImplementation((...args) => {
      const release = observeAcks(...args);
      return () => {
        releasedAcks();
        release();
      };
    });
    const routes = createPodRoutes(lifecycle, { workspace, trustPath: join(root, "trust.json") });
    const releases: (() => void)[] = [];
    const observe = observeResources(workspace, { observe: () => () => {} });
    const feed = (kind: "work" | "work-acks", fingerprint = artifact.fingerprint) => {
      const frames: ReadingFrame[] = [];
      const admission = { routeKey: key.route, fingerprint };
      releases.push(
        observe(
          kind === "work" ? { ...key, kind, admission } : { kind, work: key, admission },
          (frame) => frames.push(frame),
        ),
      );
      return frames;
    };
    return {
      root,
      artifact,
      lifecycle,
      workspace,
      routes,
      key,
      feed,
      unblock,
      savedPath,
      original,
      snapshotOpens,
      ackOpens,
      releasedSnapshots,
      releasedAcks,
      close: async () => {
        unblock();
        releases.forEach((release) => release());
        routes.close();
        await lifecycle.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

test("trusted Pod transports complete evidence and opens fingerprint-bound feeds only after persisted migration", async () => {
  const f = await setup();
  try {
    const [row] = await f.routes.list();
    expect(row?.trusted).toBe(false);
    await expect(f.routes.bundle(row!.key, f.artifact.fingerprint)).rejects.toThrow("trust");
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    expect(f.workspace.requiresAdmission(f.key.route)).toBe(true);
    expect(await f.routes.bundle(row!.key, f.artifact.fingerprint)).toEqual({
      fingerprint: f.artifact.fingerprint,
      artifact: f.artifact.wire,
    });
    const handler = createPluginsHandler(
      { lifecycle: f.lifecycle } as Parameters<typeof createPluginsHandler>[0],
      f.routes,
    );
    const response = await handler(
      new Request(
        `http://host${peRouteUrl("plugins.routeBundle", { params: { key: row!.key, hash: f.artifact.fingerprint } })}`,
      ),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      fingerprint: f.artifact.fingerprint,
      artifact: f.artifact.wire,
    });
    const tampered = structuredClone(f.artifact.wire);
    tampered.executables[0].members[0].bytes.push(32);
    await expect(admitPodArtifact(tampered, f.artifact.fingerprint)).rejects.toThrow(
      "bytes or fingerprint differ",
    );
    const snapshot = f.feed("work"),
      acks = f.feed("work-acks");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(snapshot).toEqual([]);
    expect(acks).toEqual([]);
    expect(f.snapshotOpens).not.toHaveBeenCalled();
    expect(f.ackOpens).not.toHaveBeenCalled();
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    f.unblock();
    await vi.waitFor(() => expect(snapshot).toHaveLength(1));
    expect(snapshot[0]).toMatchObject({
      kind: "snapshot",
      value: { schemaVersion: 2, revision: 8, doc: { amount: 4, note: "first" } },
    });
    expect(JSON.parse(await readFile(f.savedPath, "utf8")).value.schemaVersion).toBe(2);
    expect(f.snapshotOpens).toHaveBeenCalledOnce();
    expect(f.ackOpens).toHaveBeenCalledOnce();
    const stale = f.feed("work", workFingerprintSchema.parse(`pod-bytes:${"0".repeat(64)}`));
    await vi.waitFor(() =>
      expect(stale[0]).toMatchObject({
        kind: "failure",
        failure: { kind: "registration-mismatch" },
      }),
    );
    await f.lifecycle.setEnabled("pod:fixture", false);
    expect(f.workspace.requiresAdmission(f.key.route)).toBe(false);
    expect(f.workspace.list()).toEqual([]);
    await vi.waitFor(() =>
      expect(snapshot[1]).toMatchObject({
        kind: "failure",
        failure: { code: "WorkRouteUnregistered" },
      }),
    );
    expect(acks[0]).toMatchObject({ kind: "failure", failure: { code: "WorkRouteUnregistered" } });
    expect(f.releasedSnapshots).toHaveBeenCalledOnce();
    expect(f.releasedAcks).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
}, 30_000);

test("failed Pod migration preserves exact v1 bytes and refuses both feeds", async () => {
  const f = await setup(true);
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    const snapshot = f.feed("work"),
      acks = f.feed("work-acks");
    f.unblock();
    await vi.waitFor(() =>
      expect(snapshot[0]).toMatchObject({ kind: "failure", failure: { kind: "migration-failed" } }),
    );
    expect(acks[0]).toMatchObject({ kind: "failure", failure: { kind: "migration-failed" } });
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
  } finally {
    await f.close();
  }
}, 30_000);

test("replacement retires old feeds and requires trust in the new closure; removal releases registration", async () => {
  const f = await setup();
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    f.unblock();
    const frames = f.feed("work");
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    const next = await fixture(f.root, false, "replacement");
    await f.lifecycle.refresh();
    expect(f.workspace.list()).toEqual([]);
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    await f.routes.trust(row!.key, next.fingerprint, true);
    expect(f.workspace.requiresAdmission(f.key.route)).toBe(true);
    const current = f.feed("work", next.fingerprint);
    await vi.waitFor(() => expect(current[0]?.kind).toBe("snapshot"));
    const stale = f.feed("work");
    await vi.waitFor(() =>
      expect(stale[0]).toMatchObject({
        failure: { kind: "registration-mismatch", expected: next.fingerprint },
      }),
    );
    await rm(join(f.root, "Pods/fixture"), { recursive: true });
    await f.lifecycle.refresh();
    expect(f.workspace.list()).toEqual([]);
    await vi.waitFor(() => expect(current[1]?.kind).toBe("failure"));
    expect(frames).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30_000);
