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
import { createPeRoutes } from "../src/pe-routes.ts";
import { withInvocationContext } from "@pe/runtime/context";

async function fixture(
  root: string,
  salt = "first",
  native?: { key: string; cost: "Cheap" | "Bounded" },
  address = `/tool/${encodeURIComponent("route:@fixture/routes/tool/route.artifact")}`,
) {
  const data = {
    ...builtinData,
    key: "pod.fixture.tool",
    address,
    name: `Fixture ${salt}`,
    work: { schema: "work", route: "pod.fixture.tool", version: 2, migrations: {} },
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

test("host and browser refuse a fingerprinted raw-slash Pod address alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-pod-address-"));
  try {
    const artifact = await fixture(
      root,
      "address",
      undefined,
      "/tool/route:@fixture/routes/tool/route.artifact",
    );
    const lifecycle = createPackageLifecycle({
      packages: () => listPackages(join(root, "Pods")),
      decisionsPath: join(root, "enabled.json"),
    });
    const workspace = new RouteWorkspace({
      registrations: [],
      store: fileRouteDocumentStore(join(root, "Work")),
    });
    const routes = createPodRoutes(lifecycle, { workspace, trustPath: join(root, "trust.json") });
    try {
      const [row] = await routes.list();
      await expect(routes.trust(row!.key, artifact.fingerprint, true)).rejects.toThrow("identity");
      expect(workspace.admittedRoutes()).toEqual([]);
      const { admitPodArtifact: browserAdmit } =
        await import("../../web/src/route/pod-artifact.ts");
      await expect(
        browserAdmit(
          { ...row!, trusted: true },
          { fingerprint: artifact.fingerprint, artifact: artifact.wire },
          (bytes) => import(`data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`),
        ),
      ).rejects.toThrow("identity");
    } finally {
      routes.close();
      await lifecycle.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("Pod loader preserves native dependency cost through the linked catalog", async () => {
  const leaf = [...linkedCatalog().entries.values()].find(
    (entry) =>
      !entry.key.startsWith("command:") &&
      entry.cost === "Bounded" &&
      entry.cardinality === "One" &&
      entry.effect === "Read",
  )!;
  expect(leaf).toBeDefined();
  const root = await mkdtemp(join(tmpdir(), "pe-pod-native-link-"));
  try {
    const valid = await fixture(root, "linked", { key: leaf.key, cost: "Bounded" });
    expect((await admitPodArtifact(valid.wire, valid.fingerprint)).data.key).toBe(
      "pod.fixture.tool",
    );
    const understated = await fixture(root, "refused", { key: leaf.key, cost: "Cheap" });
    await expect(admitPodArtifact(understated.wire, understated.fingerprint)).rejects.toThrow(
      `roster: cost understates ${leaf.key}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

const currentWork = {
  version: 1,
  schemaVersion: 2,
  revision: 7,
  doc: { amount: 4, note: "first" },
  history: [],
};
async function setup(saved: unknown = currentWork, blockRead = false) {
  const root = await mkdtemp(join(tmpdir(), "pe-p2-"));
  try {
    const artifact = await fixture(root);
    const lifecycle = createPackageLifecycle({
      packages: () => listPackages(join(root, "Pods")),
      decisionsPath: join(root, "enabled.json"),
    });
    const disk = fileRouteDocumentStore(join(root, "Work"));
    const key = bindWork("pod.fixture.tool", null);
    await disk.setState({
      targetKey: workKey(key),
      route: key.route,
      value: saved,
    });
    const savedPath = join(root, "Work", (await readdir(join(root, "Work")))[0]!);
    const original = await readFile(savedPath, "utf8");
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let readStarted!: () => void;
    const reading = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const workspace = new RouteWorkspace({
      registrations: [],
      store: {
        ...disk,
        getState: async (query) => {
          if (blockRead && query.targetKey === workKey(key) && query.route === key.route) {
            readStarted();
            await gate;
          }
          return disk.getState(query);
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
      readStored: () =>
        withInvocationContext({ caller: { kind: "human", via: "local" } }, () =>
          createPeRoutes({ workspace, registrations: [] }).fetch(
            new Request(`http://host/pe/route-state/${key.route}`),
          ),
        ),
      routes,
      key,
      feed,
      unblock,
      reading,
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

test("trusted Pod transports complete evidence and opens fingerprint-bound current Work feeds", async () => {
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
    await vi.waitFor(() => expect(snapshot).toHaveLength(1));
    expect(snapshot[0]).toMatchObject({
      kind: "snapshot",
      value: { schemaVersion: 2, revision: 7, doc: { amount: 4, note: "first" } },
    });
    expect(JSON.parse(await readFile(f.savedPath, "utf8")).value.schemaVersion).toBe(2);
    await vi.waitFor(() =>
      expect(acks[0]).toMatchObject({
        kind: "snapshot",
        value: { revision: 7, doc: { amount: 4, note: "first" }, history: { from: 8, acks: [] } },
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

test("undecodable Pod Work refuses both feeds and preserves its stored bytes", async () => {
  const f = await setup({
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { oldAmount: 3 },
    history: [],
  });
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    const snapshot = f.feed("work"),
      acks = f.feed("work-acks");
    f.unblock();
    await vi.waitFor(() => expect(snapshot[0]).toMatchObject({ kind: "failure" }));
    await vi.waitFor(() => expect(acks[0]).toMatchObject({ kind: "failure" }));
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    await expect(f.workspace.read(f.key, f.key.route)).rejects.toMatchObject({
      code: "WorkUnreadable",
      key: f.key,
    });
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
    const next = await fixture(f.root, "replacement");
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

test("replacement during Work acquisition fences the retired feed", async () => {
  const f = await setup(currentWork, true);
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    const old = f.feed("work");
    await f.reading;
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    const next = await fixture(f.root, "replacement-before-ready");
    await f.lifecycle.refresh();
    await f.routes.trust(row!.key, next.fingerprint, true);
    f.unblock();
    const current = f.feed("work", next.fingerprint);
    await vi.waitFor(() =>
      expect(current[0]).toMatchObject({
        kind: "snapshot",
        value: { revision: 7, doc: { amount: 4, note: "first" } },
      }),
    );
    expect(old[0]?.kind).toBe("failure");
    expect(JSON.parse(await readFile(f.savedPath, "utf8")).value.doc.note).toBe("first");
  } finally {
    await f.close();
  }
}, 30_000);

test("Pea finds, reads, sets and opens a trusted Pod view through its one registration; withdrawal refuses", async () => {
  const { createPeRoutes } = await import("../src/pe-routes.ts");
  const { createRouteRegistrations } = await import("@pe/mcps");
  const { buildCapabilities } = await import("../../../packages/mcps/src/pea/capabilities.ts");
  const { peDo } = await import("../../../packages/mcps/src/pea/capability-tools.ts");
  const { fakeRuntimeHost } = await import("../../../packages/mcps/tests/runtime-host-fixture.ts");
  const { machineFixture } =
    await import("../../../packages/agent-contracts/tests/machine-fixture.ts");
  const { hostResourceObserver } = await import("../src/resource-adapters.ts");
  const { emptyThreadHead } = await import("@pe/agent-contracts");
  const root = await mkdtemp(join(tmpdir(), "pe-pod-view-"));
  const abort = new AbortController();
  const route = "pod.fixture.tool";
  const thread = "t1";
  try {
    const { fingerprint } = await fixture(root);
    const lifecycle = createPackageLifecycle({
      packages: () => listPackages(join(root, "Pods")),
      decisionsPath: join(root, "enabled.json"),
    });
    const app = createPeRoutes({
      registrations: createRouteRegistrations(),
      store: fileRouteDocumentStore(join(root, "Work")),
      heads: { observe: () => () => {} },
      observeHostResource: hostResourceObserver(),
    });
    const pods = createPodRoutes(lifecycle, {
      workspace: app.workspace,
      trustPath: join(root, "trust.json"),
    });
    // The host's capability provider wiring (pe-routes `admittedRoutes`), over this app's workspace.
    const rows = () =>
      buildCapabilities({
        ops: [],
        routes: [],
        packages: [],
        skills: [],
        admittedRoutes: () => app.workspace.admittedRoutes(),
      });
    fakeRuntimeHost("http://127.0.0.1:9");
    vi.stubEnv("PE_CONTEXT", `context-${thread}`);
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/pe/scope/self") return Response.json({ ...emptyThreadHead, thread });
      if (url.pathname === "/pe/capabilities")
        return Response.json({
          at: new Date().toISOString(),
          machine: machineFixture([]),
          sources: {},
          diagnostics: [],
          capabilities: rows(),
        });
      return app.fetch(input instanceof Request ? input : new Request(url, init));
    });
    const pe = (key: string, input: object) =>
      peDo.execute!(
        { key, input, timeoutSeconds: 30 } as never,
        { agent: { toolCallId: "call-1" } } as never,
      ) as Promise<Record<string, unknown>>;
    const stream = await app.fetch(
      new Request(
        `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "world" }]))}`,
        { signal: abort.signal },
      ),
    );
    const reader = stream.body!.getReader();
    const intents: Record<string, unknown>[] = [];
    void (async () => {
      let buffer = "";
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (chunk.done) return;
        buffer += new TextDecoder().decode(chunk.value);
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
          buffer = buffer.slice(end + 2);
          const value = data && JSON.parse(data).value;
          if (value?.type?.startsWith("route-view-")) intents.push(value);
        }
      }
    })();
    const instance = "00000000-0000-4000-8000-0000000000a1";
    // The browser owner: publishes its mounted Page as its codec writes it, and acks what rendered.
    const mounted = (page: Record<string, string>, openCommandId?: string) =>
      app.fetch(
        new Request(`http://host/pe/route-view/${route}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            route,
            thread,
            instance,
            surface: "route",
            page,
            context: {},
            facts: {},
            ...(openCommandId ? { openCommandId } : {}),
          }),
        }),
      );

    // Untrusted inventory publishes no rows and its channel refuses.
    expect(rows().some((row) => row.key.startsWith(`route:${route}.`))).toBe(false);
    expect((await mounted({ system: "" })).status).toBe(404);
    const [row] = await pods.list();
    await pods.trust(row!.key, fingerprint, true);
    await vi.waitFor(() =>
      expect(app.workspace.admittedRoutes().map((each) => each.key)).toContain(route),
    );
    expect(
      rows()
        .filter((each) => each.key.startsWith(`route:${route}.`))
        .map((each) => each.key),
    ).toEqual([`route:${route}.view`, `route:${route}.set-view`]);

    // Explicit open: the host links the registered address; the call waits for the matching rendered command.
    const opening = pe(`route:${route}.set-view`, { system: "owner-text" });
    await vi.waitFor(() =>
      expect(intents.some((each) => each.type === "route-view-open")).toBe(true),
    );
    const open = intents.find((each) => each.type === "route-view-open")!;
    expect(open).toMatchObject({
      route,
      thread,
      link: `/tool/${encodeURIComponent("route:@fixture/routes/tool/route.artifact")}`,
    });
    const page = { system: "", viewport: "" };
    expect((await mounted(page, open.commandId as string)).status).toBe(200);
    await vi.waitFor(() =>
      expect(intents.some((each) => each.type === "route-view-intent")).toBe(true),
    );
    const intent = intents.find((each) => each.type === "route-view-intent")!;
    // The owner codec's text crosses undecoded.
    expect(intent.patch).toEqual({ system: "owner-text" });
    await mounted({ ...page, system: "owner-text" }, open.commandId as string);
    const ack = await app.fetch(
      new Request(`http://host/pe/route-view/${route}/ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome: "rendered",
          instance,
          commandId: intent.commandId,
          revision: intent.revision,
          page: { ...page, system: "owner-text" },
          facts: {},
        }),
      }),
    );
    expect(ack.status).toBe(200);
    expect(await opening).toMatchObject({ ok: true });
    expect(await pe(`route:${route}.view`, {})).toMatchObject({ ok: true });

    // Withdrawal: discovery drops the rows, and execution through a stale row refuses at the live gate.
    const work = await readdir(join(root, "Work")).catch(() => []);
    await pods.trust(row!.key, fingerprint, false);
    await vi.waitFor(() =>
      expect(app.workspace.admittedRoutes().map((each) => each.key)).not.toContain(route),
    );
    expect(rows().some((each) => each.key.startsWith(`route:${route}.`))).toBe(false);
    expect((await mounted(page)).status).toBe(404);
    expect(await readdir(join(root, "Work")).catch(() => [])).toEqual(work);
    pods.close();
    await lifecycle.close();
  } finally {
    abort.abort();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("corrupt stored Work refuses direct reads and the file remains byte-for-byte inspectable", async () => {
  const f = await setup({
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { oldAmount: 3 },
    history: [],
  });
  try {
    const [row] = await f.routes.list();
    await f.routes.trust(row!.key, f.artifact.fingerprint, true);
    const refused = await f.readStored();
    expect(refused?.status).toBe(403);
    expect(await refused!.json()).toMatchObject({
      failure: { code: "WorkUnreadable", key: f.key, reason: expect.any(String) },
    });
    expect(await readFile(f.savedPath, "utf8")).toBe(f.original);
    const corrupt = "{not JSON";
    await writeFile(f.savedPath, corrupt);
    const corruptResponse = await f.readStored();
    expect(corruptResponse?.status).toBe(403);
    expect(await corruptResponse!.json()).toMatchObject({
      failure: { code: "WorkUnreadable", key: workKey(f.key), reason: expect.any(String) },
    });
    expect(await readFile(f.savedPath, "utf8")).toBe(corrupt);
  } finally {
    await f.close();
  }
}, 30_000);

test("G17 HTTP Start fresh accepts only older Work and preserves refused schema ages byte-for-byte", async () => {
  for (const age of ["current", "newer", "unknown", "older"] as const) {
    const schemaVersion = age === "older" ? 1 : age === "current" ? 2 : age === "newer" ? 3 : undefined;
    const f = await setup({ version: 1, ...(schemaVersion === undefined ? {} : { schemaVersion }),
      revision: 7, doc: { oldAmount: 3 }, history: [] });
    try {
      const [row] = await f.routes.list();
      await f.routes.trust(row!.key, f.artifact.fingerprint, true);
      const files = await readdir(join(f.root, "Work"));
      const response = await withInvocationContext({ caller: { kind: "human", via: "local" } }, () =>
        createPeRoutes({ workspace: f.workspace, registrations: [] }).fetch(
          new Request(`http://host/pe/route-state/${f.key.route}/start-fresh`, {
            method: "POST", headers: { "content-type": "application/json" }, body: "{}",
          }),
        ));
      expect(response, `${age}: reset is a registered HTTP door`).not.toBeNull();
      const body = await response!.json();
      if (age === "older") {
        expect(response!.status, JSON.stringify(body)).toBe(200);
        expect(body).toMatchObject({ ok: true, revision: 8 });
        expect(await (await f.readStored())!.json()).toMatchObject({ schemaVersion: 2, revision: 8 });
        const records = await Promise.all((await readdir(join(f.root, "Work")))
          .map(async name => JSON.parse(await readFile(join(f.root, "Work", name), "utf8"))));
        const original = JSON.parse(f.original);
        expect(records).toContainEqual({ ...original, route: `${f.key.route}:aside:1` });
      } else {
        expect(response!.status, `${age}: ${JSON.stringify(body)}`).toBe(403);
        expect(JSON.stringify(body)).toContain("Only a proven older schema permits Start fresh");
        expect(await readFile(f.savedPath, "utf8"), age).toBe(f.original);
        expect(await readdir(join(f.root, "Work")), age).toEqual(files);
      }
    } finally { await f.close(); }
  }
}, 60_000);
