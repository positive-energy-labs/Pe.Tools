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
import { linkedCatalog, peRouteUrl } from "@pe/agent-contracts/pe-api";
import { admitPodArtifact } from "../src/pod-artifact.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

async function fixture(root: string, fail = false, salt = "first", native?: { key: string; cost: "Cheap" | "Bounded" }) {
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
export const module = { ...builtinModule, data: ${JSON.stringify(data)},
entries: {...builtinModule.entries, roster: {...builtinModule.entries.roster, ${native ? `native: [${JSON.stringify(native.key)}], axes: {...builtinModule.entries.roster.axes, cost: '${native.cost}'}` : ""}}}, bodies: {
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

test("Pod loader preserves native dependency cost through the linked catalog", async () => {
  const leaf = [...linkedCatalog().entries.values()].find(
    (entry) => !entry.key.startsWith("command:") && entry.cost === "Bounded" && entry.cardinality === "One" && entry.effect === "Read",
  )!;
  expect(leaf).toBeDefined();
  const root = await mkdtemp(join(tmpdir(), "pe-pod-native-link-"));
  try {
    const valid = await fixture(root, false, "linked", { key: leaf.key, cost: "Bounded" });
    expect((await admitPodArtifact(valid.wire, valid.fingerprint)).data.key).toBe("pod.fixture.tool");
    const understated = await fixture(root, false, "refused", { key: leaf.key, cost: "Cheap" });
    await expect(admitPodArtifact(understated.wire, understated.fingerprint)).rejects.toThrow(
      `roster: cost understates ${leaf.key}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

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
    const routes = createPodRoutes(lifecycle, { workspace, trustPath: join(root, "trust.json") });
    const releases: (() => void)[] = [];
    const observe = observeResources(workspace, { observe: () => () => {} });
    const feed = (
      kind: "work" | "work-acks",
      fingerprint: typeof artifact.fingerprint | null = artifact.fingerprint,
    ) => {
      const frames: ReadingFrame[] = [];
      const admission = fingerprint === null ? undefined : { routeKey: key.route, fingerprint };
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
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    f.unblock();
    await vi.waitFor(() => expect(snapshot).toHaveLength(1));
    expect(snapshot[0]).toMatchObject({
      kind: "snapshot",
      value: { schemaVersion: 2, revision: 8, doc: { amount: 4, note: "first" } },
    });
    expect(JSON.parse(await readFile(f.savedPath, "utf8")).value.schemaVersion).toBe(2);
    await vi.waitFor(() =>
      expect(acks[0]).toMatchObject({
        kind: "snapshot",
        value: { revision: 8, doc: { amount: 4, note: "first" }, history: { from: 9, acks: [] } },
      }),
    );
    // Missing, stale digest, and wrong source are independent hostile feed requests.
    for (const fingerprint of [
      null,
      workFingerprintSchema.parse(`pod-bytes:${"0".repeat(64)}`),
      workFingerprintSchema.parse(f.artifact.fingerprint.replace("pod-bytes:", "builtin-closure:")),
    ]) {
      for (const kind of ["work", "work-acks"] as const) {
        const stale = f.feed(kind, fingerprint);
        await vi.waitFor(() =>
          expect(stale[0]).toMatchObject({
            kind: "failure",
            failure:
              fingerprint === null
                ? { code: "WorkAdmissionRequired" }
                : { kind: "registration-mismatch" },
          }),
        );
      }
    }
    const persisted = await readFile(f.savedPath, "utf8");
    const reopened = f.feed("work");
    await vi.waitFor(() => expect(reopened[0]?.kind).toBe("snapshot"));
    expect(await readFile(f.savedPath, "utf8")).toBe(persisted);
    await f.lifecycle.setEnabled("pod:fixture", false);
    expect(f.workspace.requiresAdmission(f.key.route)).toBe(false);
    expect(f.workspace.list()).toEqual([]);
    await vi.waitFor(() =>
      expect(snapshot.at(-1)).toMatchObject({
        kind: "failure",
        failure: { code: "WorkRouteUnregistered" },
      }),
    );
    expect(acks.at(-1)).toMatchObject({
      kind: "failure",
      failure: { code: "WorkRouteUnregistered" },
    });
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

test("replacement during persisted Work census fences the retired migration", async () => {
  const f = await setup();
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    const old = f.feed("work");
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    const next = await fixture(f.root, false, "replacement-before-ready");
    await f.lifecycle.refresh();
    await f.routes.trust(row!.key, next.fingerprint, true);
    f.unblock();
    const current = f.feed("work", next.fingerprint);
    await vi.waitFor(() =>
      expect(current[0]).toMatchObject({
        kind: "snapshot",
        value: { revision: 8, doc: { amount: 4, note: "replacement-before-ready" } },
      }),
    );
    expect(old[0]?.kind).toBe("failure");
    expect(JSON.parse(await readFile(f.savedPath, "utf8")).value.doc.note).toBe(
      "replacement-before-ready",
    );
  } finally {
    await f.close();
  }
}, 30_000);
