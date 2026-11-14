import { mkdtemp, stateFixture, stateMachine } from "../../../tests/isolated-home/storage.ts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { routeFingerprint } from "../../../packages/agent-contracts/src/route-module.ts";
import { builtinData } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { createPluginsHandler } from "../src/plugins-handler.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
import {
  bindPackageLifecycle,
  createPackageLifecycle,
  requirePackageEnabled,
} from "../src/package-lifecycle.ts";
import * as filesystem from "node:fs/promises";
import * as packages from "../src/packages.ts";
import { createServer } from "node:http";
import { settle } from "./effect-test.ts";
import { writeMember, saveMember } from "../src/settings.ts";
import { installArchive, writeZip, exportPod } from "../src/pod-transfer.ts";
import * as store from "@pe/host-contracts/kinds";
import { RouteWorkspace } from "@pe/runtime";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";

test("a detached initial census can fail after close without an unhandled rejection", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let failed = false;
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root), packages: async () => {
    entered.resolve(); await release.promise; failed = true;
    throw Error("home disappeared during shutdown");
  } });
  await entered.promise;
  await lifecycle.close();
  release.resolve();
  await new Promise(resolve => setImmediate(resolve));
  expect(failed).toBe(true);
});

test("shutdown aborts optional bootstrap without waiting for its read", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const published = vi.fn();
  const owned = createContributionContent({
    worldRoot: stateFixture(join(root, "held-world")),
    decisionsMachine: stateMachine(root),
    packages: async () => ({ packages: [], unreadable: [] }),
    bootstrap: async (signal) => {
      started.resolve(signal);
      await release.promise;
      try {
        signal.throwIfAborted();
        published();
      } finally {
        resumed.resolve();
      }
    },
  });
  const signal = await started.promise;
  const closing = owned.close();
  try {
    expect(
      await Promise.race([
        closing.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100)),
      ]),
    ).toBe(true);
    expect(signal.aborted).toBe(true);
  } finally {
    release.resolve();
    await closing;
    await resumed.promise;
  }
  expect(published).not.toHaveBeenCalled();
});

test("shutdown abandons a held census and never publishes its late result", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = false;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      const listing = await packages.listPackages(join(root, "user/Pods"));
      if (hold) {
        entered.resolve();
        await release.promise;
      }
      return listing;
    },
  });
  await lifecycle.ready;
  await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
  hold = true;
  const scan = lifecycle.refresh();
  await entered.promise;
  const closing = lifecycle.close();
  try {
    expect(
      await Promise.race([
        closing.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100)),
      ]),
    ).toBe(true);
  } finally {
    release.resolve();
    await scan;
    await closing;
  }
  expect(lifecycle.inventory()).toEqual([]);
  expect(lifecycle.packages()).toEqual([]);
});

test("shutdown cancels byte checks before the deadline without waiting for open", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const route = (await routes.list()).find((r) => r.packageId === "late")!;
  await routes.trust(route.key, route.fingerprint, true);
  await content.lifecycle.refresh();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual.open(...args);
  });
  const checking = routes.bundle(route.key, route.fingerprint).then(
    () => null,
    (error) => error,
  );
  await entered.promise;
  routes.close();
  try {
    expect(
      await Promise.race([
        checking,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]),
    ).toMatchObject({ message: "Pod routes are closed" });
  } finally {
    release.resolve();
    await checking;
  }
});

test("a held new admission never queues later route inventory readers", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const d = (await routes.list()).find((r) => r.packageId === "late")!;
  await routes.trust(d.key, d.fingerprint, true);
  await content.lifecycle.refresh();
  const admitting = createPodRoutes(content.lifecycle, {
    machine: stateMachine(root),
    workspace: new RouteWorkspace({
      registrations: [],
      store: { getState: async () => null, setState: async () => {} },
    }),
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual.open(...args);
  });
  const first = admitting.list().then(
    () => null,
    (error) => error,
  );
  await entered.promise;
  try {
    const later = admitting.list();
    const result = await Promise.race([
      later,
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    expect(result).not.toBe("blocked");
    expect(await first).toMatchObject({ code: "pod.route.check.timeout", retryable: true });
  } finally {
    release.resolve();
    await first;
    admitting.close();
  }
});

test("a valid same-size manifest edit is refused by byte comparison", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const d = (await routes.list()).find((r) => r.packageId === "late")!;
  await routes.trust(d.key, d.fingerprint, true);
  await content.lifecycle.refresh();
  const path = join(root, "user/Pods/late/pod.json");
  const before = await filesystem.readFile(path, "utf8");
  const after = before.replace('"name":"Late"', '"name":"Fate"');
  expect(after.length).toBe(before.length);
  expect(JSON.parse(after).routes[0].name).toBe("Fate");
  await writeFile(path, after);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual.lstat(...args);
  });
  content.lifecycle.requestRefresh();
  await entered.promise;
  try {
    await expect(routes.bundle(d.key, d.fingerprint)).rejects.toThrow("bytes changed");
  } finally {
    release.resolve();
    await content.lifecycle.refresh();
  }
});

test("FINAL REVIEW: an action reconciliation must not block discovery reads", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { lstat: original } =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const action = content.lifecycle.refresh();
  await entered.promise;
  let answered = false;
  const reading = Promise.all([inventory(), routes.list()]).then(() => {
    answered = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(answered, "inventory must serve the completed census while action scans disk").toBe(
      true,
    );
  } finally {
    release.resolve();
    await action;
    await reading;
  }
});

test("FINAL REVIEW: a removed trusted Pod must not serve an admitted bundle", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const descriptor = (await routes.list()).find((route) => route.packageId === "late")!;
  await routes.trust(descriptor.key, descriptor.fingerprint, true);
  await content.lifecycle.refresh();
  await rm(join(root, "user/Pods/late"), { recursive: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { lstat: original } =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  content.lifecycle.requestRefresh();
  await entered.promise;
  try {
    await expect(routes.bundle(descriptor.key, descriptor.fingerprint)).rejects.toThrow();
  } finally {
    release.resolve();
    await content.lifecycle.refresh();
  }
});

test.each(["pod.json", "routes/tool/route.artifact"])(
  "cached trust refuses edited %s while discovery is held",
  async (path) => {
    await putRoute(join(root, "user"));
    await content.lifecycle.refresh();
    const descriptor = (await routes.list()).find((route) => route.packageId === "late")!;
    await routes.trust(descriptor.key, descriptor.fingerprint, true);
    await content.lifecycle.refresh();
    const target = join(root, "user/Pods/late", path);
    const changed = await filesystem.readFile(target);
    changed[changed.length - 1] = 32; // Same size; the last captured byte was a closing brace.
    await writeFile(target, changed);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { lstat: original } =
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    });
    content.lifecycle.requestRefresh();
    await entered.promise;
    try {
      await expect(routes.bundle(descriptor.key, descriptor.fingerprint)).rejects.toThrow();
      await expect(routes.trust(descriptor.key, descriptor.fingerprint, true)).rejects.toThrow();
    } finally {
      release.resolve();
      await content.lifecycle.refresh();
    }
  },
);

test("an export written inside a Pod reconciles its new archive member", async () => {
  await exportPod(
    { pod: "existing", archivePath: join(root, "user/Pods/existing/copy.zip") },
    { machine: stateMachine(root) },
  );
  expect(
    content.lifecycle
      .listing()
      .packages.find((p) => p.id === "existing")!
      .members.map((m) => m.path),
  ).toContain("copy.zip");
});

test("failed import reconciles rollback after its Pod was admitted", async () => {
  const writeState = store.writeState;
  let wasActive = false;
  vi.spyOn(store, "writeState").mockImplementation((...args) => {
    if (args[0].path.includes("pod-imports")) {
      wasActive = content.lifecycle.active("rollback");
      throw Error("import record failed after activation");
    }
    return writeState(...args);
  });
  const archive = writeZip(new Map([["pod.json", Buffer.from('{"id":"rollback"}')]]));
  await expect(
    installArchive(archive, "rollback.zip", undefined, { machine: stateMachine(root) }),
  ).rejects.toThrow("import record failed");
  expect(wasActive).toBe(true);
  expect(content.lifecycle.inventory()).not.toContainEqual(
    expect.objectContaining({ id: "pod:rollback" }),
  );
  expect(content.lifecycle.listing().packages.map((p) => p.id)).not.toContain("rollback");
});

test("REVIEW: host member write must reconcile before the next inventory", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { lstat: original } =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    if (String(args[0]) === join(root, "user", "Pods")) {
      entered.resolve();
      await release.promise;
    }
    return original(...args);
  });
  // Only the lifecycle's metadata scan uses the mocked import; the member door uses its own IO.
  content.lifecycle.requestRefresh();
  await entered.promise;
  let writeReturned = false;
  const writing = settle(
    writeMember({ pod: "existing", path: "settings/new.json", content: "{}" }),
  ).then((result) => {
    writeReturned = true;
    return result;
  });
  try {
    await expect
      .poll(() =>
        filesystem
          .readFile(join(root, "user/Pods/existing/settings/new.json"), "utf8")
          .catch(() => null),
      )
      .toBe("{}");
    // The bytes landed, but success must wait for the held census rather than use discovery.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writeReturned).toBe(false);
    release.resolve();
    await writing;
    await inventory();
    await routes.list();
    expect(
      content.lifecycle
        .listing()
        .packages.find((p) => p.id === "existing")!
        .members.map((m) => m.path),
    ).toContain("settings/new.json");
    await settle(
      saveMember({
        pod: "existing",
        path: "settings/new.json",
        content: '{"saved":true}',
        expectedSha256: createHash("sha256").update("{}").digest("hex"),
      }),
    );
    const saved = content.lifecycle
      .listing()
      .packages.find((p) => p.id === "existing")!
      .members.find((m) => m.path === "settings/new.json")!;
    expect(Buffer.from(saved.bytes).toString()).toBe('{"saved":true}');
  } finally {
    release.resolve();
    await writing;
    await content.lifecycle.refresh();
  }
});

test("REVIEW: late duplicate identity withdraws previously active Pod", async () => {
  await put(firm, "copy/pod.json", '{"id":"existing"}');
  await put(firm, "copy/README.md", "before");
  await content.lifecycle.refresh();
  expect(
    content.lifecycle
      .listing()
      .packages.every((p) => p.diagnostics.some((d) => d.code === "DuplicatePodId")),
  ).toBe(true);
  expect(content.lifecycle.active("existing")).toBe(false);
  await rm(join(firm, "Pods/copy"), { recursive: true });
  await content.lifecycle.refresh();
  expect(content.lifecycle.active("existing")).toBe(true);
});

test("REVIEW: discovery queued after an action cannot overwrite it", async () => {
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      const listing = await packages.listPackages(join(root, "user/Pods"));
      if (++calls === 2) {
        captured.resolve();
        await release.promise;
      }
      return listing;
    },
  });
  try {
    await lifecycle.ready;
    await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
    const action = lifecycle.refresh();
    await captured.promise;
    for (let i = 0; i < 10; i++) lifecycle.requestRefresh();
    release.resolve();
    await action;
    expect(lifecycle.active("late")).toBe(true);
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    await lifecycle.close();
  }
});

vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) };
});

let root: string;
let firm: string;
let content: ReturnType<typeof createContributionContent>;
let routes: ReturnType<typeof createPodRoutes>;
async function put(home: string, path: string, bytes: string) {
  const target = join(home, "Pods", path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, bytes);
}
async function inventory() {
  const response = await createPluginsHandler(
    content,
    routes,
  )(new Request("http://host/pe/plugins"));
  expect(response.status).toBe(200);
  return response.json();
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-late-pod-"));
  firm = join(root, "04 PE Software Files", "Pe.Tools");
  await mkdir(firm, { recursive: true });
  await writeFile(join(firm, "pe-home.json"), '{"tier":"firm"}');
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "user"));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.stubEnv("LOCALAPPDATA", join(root, "machine"));
  await put(join(root, "user"), "existing/pod.json", '{"id":"existing"}');
  await put(join(root, "user"), "existing/README.md", "before");
  content = createContributionContent({
    worldRoot: stateFixture(join(root, "world")),
    decisionsMachine: stateMachine(root),
  });
  routes = createPodRoutes(content.lifecycle, { machine: stateMachine(root) });
  bindPackageLifecycle(content.lifecycle);
  await content.lifecycle.ready;
});
test("control: a firm Pod present before startup is listed and active", async () => {
  await routes.close();
  await content.lifecycle.close();
  await put(firm, "firm-control/pod.json", '{"id":"firm-control"}');
  content = createContributionContent({
    worldRoot: stateFixture(join(root, "world")),
    decisionsMachine: stateMachine(root),
  });
  routes = createPodRoutes(content.lifecycle, { machine: stateMachine(root) });
  bindPackageLifecycle(content.lifecycle);
  await content.lifecycle.ready;
  await expect.poll(inventory).toContainEqual(expect.objectContaining({ id: "pod:firm-control" }));
  expect(content.lifecycle.active("firm-control")).toBe(true);
});
test("control: a user route present before startup is listed", async () => {
  routes.close();
  await content.lifecycle.close();
  await putRoute(join(root, "user"));
  content = createContributionContent({
    worldRoot: stateFixture(join(root, "world")),
    decisionsMachine: stateMachine(root),
  });
  routes = createPodRoutes(content.lifecycle, { machine: stateMachine(root) });
  bindPackageLifecycle(content.lifecycle);
  await content.lifecycle.ready;
  await expect
    .poll(() => routes.list())
    .toContainEqual(expect.objectContaining({ packageId: "late", trusted: false }));
});
afterEach(async () => {
  routes.close();
  await content.lifecycle.close();
  bindPackageLifecycle(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
test("unchanged refreshes reuse the full listing", async () => {
  const list = vi.spyOn(packages, "listPackages");
  await content.lifecycle.refresh();
  await content.lifecycle.refresh();
  expect(list).not.toHaveBeenCalled();
});

test("an action after discovery captures bytes gets its own fresh reconciliation", async () => {
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      const listing = await packages.listPackages(join(root, "user/Pods"));
      if (++calls === 2) {
        captured.resolve();
        await release.promise;
      }
      return listing;
    },
  });
  try {
    await lifecycle.ready;
    lifecycle.requestRefresh();
    await captured.promise;
    await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
    const action = lifecycle.refresh();
    release.resolve();
    await action;
    expect(lifecycle.active("late")).toBe(true);
    expect(calls).toBe(3);
  } finally {
    release.resolve();
    await lifecycle.close();
  }
});

test("a late Pod respects the same saved off choice as a startup Pod", async () => {
  await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
  await content.lifecycle.refresh();
  await content.lifecycle.setEnabled("pod:late", false);
  await put(join(root, "user"), "late/README.md", "edited while off");
  await content.lifecycle.refresh();
  expect(content.lifecycle.active("late")).toBe(false);
  expect(content.lifecycle.inventory()).toContainEqual(
    expect.objectContaining({ id: "pod:late", status: "disabled" }),
  );
});

test("removed members and Pods disappear after refresh", async () => {
  await rm(join(root, "user/Pods/existing/README.md"));
  await content.lifecycle.refresh();
  expect(
    content.lifecycle
      .packages()
      .find((p) => p.id === "existing")!
      .members.map((m) => m.path),
  ).not.toContain("README.md");
  await rm(join(root, "user/Pods/existing"), { recursive: true });
  await content.lifecycle.refresh();
  expect(await inventory()).not.toContainEqual(expect.objectContaining({ id: "pod:existing" }));
});

test("a slow filesystem scan leaves inventory, routes and unrelated HTTP reads available", async () => {
  await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { lstat: original } =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const scan = vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  scan.mockClear();
  const handler = createPluginsHandler(content, routes);
  const server = createServer(async (req, res) => {
    const response =
      req.url === "/health"
        ? Response.json({ status: "ok" })
        : await handler(new Request(`http://host${req.url}`));
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Expected TCP listener");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = fetch(`${base}/pe/plugins`).then((r) => r.json());
    await entered.promise;
    // All these must answer before the fake filesystem is released, including the initiating read.
    const answers = Promise.all([
      first,
      fetch(`${base}/pe/plugins`).then((r) => r.json()),
      routes.list(),
      fetch(`${base}/health`).then((r) => r.json()),
    ]);
    const result = await Promise.race([
      answers,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(Error("Reads waited for the filesystem scan")), 1000);
        void answers.finally(() => clearTimeout(timer)).catch(() => {});
      }),
    ]);
    expect(result[0]).not.toContainEqual(expect.objectContaining({ id: "pod:late" }));
    expect(result[1]).toEqual(result[0]);
    expect(result[3]).toEqual({ status: "ok" });
    expect(scan).toHaveBeenCalledTimes(1);
    await expect(requirePackageEnabled("late")).rejects.toThrow("inactive");
  } finally {
    release.resolve();
    await content.lifecycle.refresh();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(await inventory()).toContainEqual(expect.objectContaining({ id: "pod:late" }));
  await expect(requirePackageEnabled("late")).resolves.toBeUndefined();
});
for (const tier of ["user", "firm"] as const) {
  const arrive = () =>
    put(tier === "firm" ? firm : join(root, "user"), "late/pod.json", '{"id":"late"}');
  test(`${tier}: inventory discovers a Pod dropped after startup`, async () => {
    await arrive();
    await expect.poll(inventory).toContainEqual(expect.objectContaining({ id: "pod:late" }));
  });
  test(`${tier}: discovery activates without a toggle`, async () => {
    await arrive();
    await inventory();
    await expect
      .poll(async () => {
        await inventory();
        return content.lifecycle.active("late");
      })
      .toBe(true);
  });
  test(`${tier}: direct Pod door discovers and admits late arrival`, async () => {
    await arrive();
    await expect
      .poll(async () => {
        try {
          await requirePackageEnabled("late");
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
  });
  test(`${tier}: route inventory discovers an untrusted late route`, async () => {
    await arrive();
    await putRoute(tier === "firm" ? firm : join(root, "user"));
    await expect
      .poll(() => routes.list())
      .toContainEqual(expect.objectContaining({ packageId: "late", trusted: false }));
  });
}
async function putRoute(home: string) {
  const bytes = [101, 120, 112, 111, 114, 116];
  const sha256 = createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");
  const artifact = {
    version: 1 as const,
    data: builtinData,
    contracts: [{ id: "test", sha256 }],
    executables: [
      { client: "web" as const, entry: "route.js", members: [{ path: "route.js", sha256 }] },
    ],
  };
  const fingerprint = await routeFingerprint(artifact);
  await put(
    home,
    "late/routes/tool/route.artifact",
    JSON.stringify({
      artifact,
      fingerprint,
      contracts: [{ id: "test", bytes }],
      executables: [
        {
          client: "web",
          entry: "route.js",
          resolved: true,
          members: [{ path: "route.js", bytes }],
        },
      ],
    }),
  );
  await put(
    home,
    "late/pod.json",
    JSON.stringify({
      id: "late",
      routes: [
        {
          artifact: "routes/tool/route.artifact",
          fingerprint: `pod-bytes:${fingerprint}`,
          name: "Late",
          description: "Late route",
        },
      ],
    }),
  );
}
test("inventory read refreshes member bytes in a Pod present at startup", async () => {
  await put(join(root, "user"), "existing/README.md", "after");
  await inventory();
  await expect
    .poll(async () => {
      await inventory();
      return Buffer.from(
        content.lifecycle
          .packages()
          .find((p) => p.id === "existing")!
          .members.find((m) => m.path === "README.md")!.bytes,
      ).toString();
    })
    .toBe("after");
});

test("RECHECK: stalled open refuses with a retryable deadline", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const d = (await routes.list()).find((r) => r.packageId === "late")!;
  await routes.trust(d.key, d.fingerprint, true);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual.open(...args);
  });
  let answered = false;
  const request = routes
    .bundle(d.key, d.fingerprint)
    .then(
      () => null,
      (error) => error,
    )
    .finally(() => {
      answered = true;
    });
  await entered.promise;
  try {
    await new Promise((r) => setTimeout(r, 1200));
    expect(answered).toBe(true);
    expect(await request).toMatchObject({ code: "pod.route.check.timeout", retryable: true });
    const response = await createPluginsHandler(
      content,
      routes,
    )(
      new Request(
        "http://host" +
          peRouteUrl("plugins.routeBundle", { params: { key: d.key, hash: d.fingerprint } }),
      ),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "pod.route.check.timeout",
      retryable: true,
    });
  } finally {
    release.resolve();
    await request;
  }
});

test("RECHECK: manifest may disappear between check and bundle", async () => {
  await putRoute(join(root, "user"));
  await content.lifecycle.refresh();
  const d = (await routes.list()).find((r) => r.packageId === "late")!;
  await routes.trust(d.key, d.fingerprint, true);
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual.lstat(...args);
  });
  content.lifecycle.requestRefresh();
  await entered.promise;
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("route.artifact"))
      await rm(join(root, "user/Pods/late/pod.json"), { force: true });
    return actual.open(...args);
  });
  try {
    await expect(routes.bundle(d.key, d.fingerprint)).rejects.toThrow();
    await expect(actual.stat(join(root, "user/Pods/late/pod.json"))).rejects.toThrow();
  } finally {
    release.resolve();
    await content.lifecycle.refresh();
  }
});
