import { createServer } from "node:http";
import * as filesystem from "node:fs/promises";
import * as store from "@pe/host-contracts/kinds";
import { mkdir,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout as realClearTimeout,setTimeout as realSetTimeout } from "node:timers";
import { afterEach,beforeEach,expect,test,vi } from "vite-plus/test";
import { mkdtemp,stateFixture,stateMachine } from "../../../tests/isolated-home/storage.ts";
import {
bindPackageLifecycle,
createPackageLifecycle,
requirePackageEnabled,
} from "../src/package-lifecycle.ts";
import * as packages from "../src/packages.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { createPluginsHandler } from "../src/plugins-handler.ts";
import { exportPod,installArchive,writeZip } from "../src/pod-transfer.ts";

test("a detached initial census can fail after close without an unhandled rejection", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let failed = false;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      entered.resolve();
      await release.promise;
      failed = true;
      throw Error("home disappeared during shutdown");
    },
  });
  await entered.promise;
  await lifecycle.close();
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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
      const listing = await packages.listPackages({ podsRoots: join(root, "user/Pods") });
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
      const listing = await packages.listPackages({ podsRoots: join(root, "user/Pods") });
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
async function put(home: string, path: string, bytes: string) {
  const target = join(home, "Pods", path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, bytes);
}
async function inventory() {
  const response = await createPluginsHandler(
    content,
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
  bindPackageLifecycle(content.lifecycle);
  await content.lifecycle.ready;
});
afterEach(async () => {
  vi.useRealTimers();
  await content.lifecycle.close();
  bindPackageLifecycle(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
test("an unknown Pod waits at most five seconds for a stalled refresh", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      if (++calls > 1) {
        entered.resolve();
        await release.promise;
      }
      return { packages: [], unreadable: [] };
    },
  });
  await lifecycle.ready;
  bindPackageLifecycle(lifecycle);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const refusal = expect(requirePackageEnabled("missing")).rejects.toThrow("inactive");
    await entered.promise;
    await vi.advanceTimersByTimeAsync(5000);
    await refusal;
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    vi.useRealTimers();
    await lifecycle.close();
    bindPackageLifecycle(content.lifecycle);
  }
});

test("a known Page answers while an unrelated late Pod waits for discovery", async () => {
  await put(join(root, "user"), "existing/pages/tour/index.html", "<title>Existing tour</title>");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      const listing = await packages.listPackages({ podsRoots: join(root, "user/Pods") });
      if (++calls > 1) {
        entered.resolve();
        await release.promise;
      }
      return listing;
    },
  });
  await lifecycle.ready;
  bindPackageLifecycle(lifecycle);
  const scan = lifecycle.requestRefresh();
  await entered.promise;
  await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
  const handle = createPagesHandler(join(root, "user/Pages"), packages.productPodsRoots(),
    undefined, undefined, stateFixture(join(root, "page-state")));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let timer: ReturnType<typeof realSetTimeout> | undefined;
  const opening = handle(new Request("http://host/pages/existing--tour/"));
  try {
    const response = await Promise.race([
      opening,
      new Promise<never>((_, reject) => {
        timer = realSetTimeout(() => reject(Error("Known Page waited for unrelated discovery")), 1000);
      }),
    ]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Existing tour");
    expect(lifecycle.active("late")).toBe(false);
  } finally {
    realClearTimeout(timer);
    release.resolve();
    vi.useRealTimers();
    await scan;
    await opening;
    await lifecycle.close();
    bindPackageLifecycle(content.lifecycle);
  }
});

test("a missed door queues fresh discovery behind a scan captured before arrival", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      ++calls;
      if (calls === 2) {
        entered.resolve();
        await release.promise;
      }
      if (calls <= 2) return { packages: [], unreadable: [] };
      return packages.listPackages({ podsRoots: join(root, "user/Pods") });
    },
  });
  await lifecycle.ready;
  bindPackageLifecycle(lifecycle);
  try {
    lifecycle.requestRefresh();
    await entered.promise;
    await put(join(root, "user"), "late/pod.json", '{"id":"late"}');
    const opening = requirePackageEnabled("late");
    await new Promise((resolve) => setImmediate(resolve));
    release.resolve();
    await expect(opening).resolves.toBeUndefined();
    expect(calls).toBe(3);
  } finally {
    release.resolve();
    await lifecycle.close();
    bindPackageLifecycle(content.lifecycle);
  }
});

test("unchanged refreshes reuse the full listing", async () => {
  const scans: string[] = [];
  packages.bindPackageScanLogger(line => { if (line.startsWith("Pod folder scan start ")) scans.push(line); });
  try {
    await content.lifecycle.refresh();
    await content.lifecycle.refresh();
    expect(scans).toEqual([]);
  } finally { packages.bindPackageScanLogger(() => {}); }
});

test("an action after discovery captures bytes gets its own fresh reconciliation", async () => {
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: async () => {
      const listing = await packages.listPackages({ podsRoots: join(root, "user/Pods") });
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
    await expect(requirePackageEnabled("late")).resolves.toBeUndefined();
  });
  test(`${tier}: first Page request admits a late Pod without reload`, async () => {
    await arrive();
    await put(
      tier === "firm" ? firm : join(root, "user"),
      "late/pages/tour/index.html",
      "<title>Late tour</title>",
    );
    const handle = createPagesHandler(
      join(root, "user/Pages"),
      packages.productPodsRoots(),
      undefined,
      undefined,
      stateFixture(join(root, "page-state")),
    );
    const response = await handle(new Request("http://host/pages/late--tour/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Late tour");
  });

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
  const reading = Promise.all([inventory()]).then(() => {
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

test("control: a firm Pod present before startup is listed and active", async () => {
  await content.lifecycle.close();
  await put(firm, "firm-control/pod.json", '{"id":"firm-control"}');
  content = createContributionContent({
    worldRoot: stateFixture(join(root, "world")),
    decisionsMachine: stateMachine(root),
  });
  bindPackageLifecycle(content.lifecycle);
  await content.lifecycle.ready;
  await expect.poll(inventory).toContainEqual(expect.objectContaining({ id: "pod:firm-control" }));
  expect(content.lifecycle.active("firm-control")).toBe(true);
});

test("a slow filesystem scan leaves inventory and unrelated HTTP reads available", async () => {
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
  const handler = createPluginsHandler(content);
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
    expect(result[2]).toEqual({ status: "ok" });
    expect(scan).toHaveBeenCalledTimes(1);
    await expect(requirePackageEnabled("existing")).resolves.toBeUndefined();
    let answered = false;
    const opening = requirePackageEnabled("late").then(() => {
      answered = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(answered).toBe(false);
    expect(scan).toHaveBeenCalledTimes(1);
    release.resolve();
    await expect(opening).resolves.toBeUndefined();
  } finally {
    release.resolve();
    await content.lifecycle.refresh();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(await inventory()).toContainEqual(expect.objectContaining({ id: "pod:late" }));
  await expect(requirePackageEnabled("late")).resolves.toBeUndefined();
});
