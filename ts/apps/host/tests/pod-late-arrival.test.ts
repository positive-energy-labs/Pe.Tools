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
import { bindPackageLifecycle, createPackageLifecycle, requirePackageEnabled } from "../src/package-lifecycle.ts";
import * as filesystem from "node:fs/promises";
import * as packages from "../src/packages.ts";
import { createServer } from "node:http";

vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
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
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root), packages: async () => {
    const listing = await packages.listPackages(join(root, "user/Pods"));
    if (++calls === 2) { captured.resolve(); await release.promise; }
    return listing;
  } });
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
  const { lstat: original } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
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
