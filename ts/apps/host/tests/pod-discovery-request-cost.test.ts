import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages, readPackage } from "../src/packages.ts";
import { rememberCaptureRoots, stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { bindPackageLifecycle, createPackageLifecycle } from "../src/package-lifecycle.ts";
import { stateTree } from "@pe/host-contracts/service-identity";
import { createContributionContent, createPeRoutes } from "../src/pe-routes.ts";
import { createPluginsHandler } from "../src/plugins-handler.ts";
import { servePeRoute } from "@pe/agent-contracts/pe-api";
import { contentRootsRefreshMs } from "../src/content-roots.ts";
import { freezeScript } from "../src/operation-script.ts";

const reinstall = vi.hoisted((): { hold: { entered: () => void; wait: Promise<void> } | undefined } => ({ hold: undefined }));
vi.mock("@pe/agent-contracts", async original => {
  const actual = await original<typeof import("@pe/agent-contracts")>();
  return { ...actual, createPluginRuntime: (...args: Parameters<typeof actual.createPluginRuntime>) => {
    const runtime = actual.createPluginRuntime(...args);
    return { ...runtime, install: (plugin: Parameters<typeof runtime.install>[0], enabled?: boolean) =>
      runtime.install({ ...plugin, setup: async context => {
        if (plugin.id === "pod:requested" && reinstall.hold) {
          reinstall.hold.entered();
          await reinstall.hold.wait;
        }
        return plugin.setup(context);
      } }, enabled) };
  } };
});

vi.mock("node:fs/promises", async original => ({ ...(await original<typeof import("node:fs/promises")>()) }));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  stopPackageDiscovery();
  bindPackageLifecycle(undefined);
  reinstall.hold = undefined;
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-request-cost-"));
  roots.push(root);
  const pods = join(root, "Pods");
  const page = (id: string) => join(pods, id, "pages", "hello", "index.html");
  for (const id of ["requested", "other", "untouched"]) {
    await fs.mkdir(join(page(id), ".."), { recursive: true });
    await fs.writeFile(join(pods, id, "pod.json"), JSON.stringify({ id }));
    await fs.writeFile(page(id), `<title>${id}</title>`);
  }
  const handler = createPagesHandler([], pods, undefined, undefined, stateFixture(join(root, "state")));
  const request = (id = "requested") => handler(new Request(`http://host/pages/${id}--hello/`));
  expect((await request()).status).toBe(200);
  return { root, pods, page, request };
}

// Mutant: a Page asks for a whole-home member witness instead of its own Pod and every identity.
test("a Page validates its own members and every manifest, never unrelated members", async () => {
  const { pods, page, request } = await fixture();
  const stats = vi.spyOn(fs, "lstat");
  await fs.writeFile(page("requested"), "<title>fresh requested</title>");
  expect(await (await request()).text()).toContain("fresh requested");
  const paths = stats.mock.calls.map(([path]) => String(path));
  expect(paths).toContain(join(pods, "other", "pod.json"));
  expect(paths).not.toContain(page("other"));
  expect(paths).not.toContain(page("untouched"));
  await fs.writeFile(join(pods, "requested", "Run.csx"), "Result(3);");
  const fresh = await readPackage("requested", { podsRoots: pods });
  expect(Buffer.from(fresh.members.find(member => member.path === "Run.csx")!.bytes).toString()).toBe("Result(3);");
  // An in-place identity edit elsewhere still revokes the requested id's unique claim.
  await fs.writeFile(join(pods, "other", "pod.json"), '{"id":"requested"}');
  expect((await request()).status).toBe(404);
});

test("simultaneous Page edits and alternating requests each see their own fresh bytes", async () => {
  const { page, request } = await fixture();
  for (let revision = 0; revision < 3; revision++) {
    for (const id of ["requested", "other"])
      await fs.writeFile(page(id), `<title>${id} revision ${revision}</title>`);
    const responses = await Promise.all([request(), request("other")]);
    expect(await responses[0]!.text()).toContain(`requested revision ${revision}`);
    expect(await responses[1]!.text()).toContain(`other revision ${revision}`);
  }
});

test("an existing Page never becomes not-found during its lifecycle reinstall", async () => {
  const { root, pods, page } = await fixture();
  const lifecycle = createPackageLifecycle({ machine: stateTree(join(root, "machine")), packages: () => listPackages({ podsRoots: pods }) });
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  try {
    await lifecycle.ready;
    bindPackageLifecycle(lifecycle);
    await fs.writeFile(page("requested"), "<title>reinstalled fresh</title>");
    reinstall.hold = { entered: () => entered.resolve(), wait: gate.promise };
    const refreshing = lifecycle.refresh();
    await entered.promise;
    const handler = createPagesHandler([], [pods], undefined, undefined, stateFixture(join(root, "state")));
    const response = handler(new Request("http://host/pages/requested--hello/target"));
    await new Promise(ok => setTimeout(ok, 100));
    gate.resolve();
    expect((await response).status).toBe(200);
    await refreshing;
  } finally {
    gate.resolve();
    reinstall.hold = undefined;
    await lifecycle.close();
  }
});

test("a new Pod requested before the inventory cadence is discovered immediately", async () => {
  const { root, pods, page } = await fixture();
  const lifecycle = createPackageLifecycle({ machine: stateTree(root), packages: options => listPackages({ ...options, podsRoots: pods }) });
  try {
    await lifecycle.ready;
    bindPackageLifecycle(lifecycle);
    await fs.mkdir(join(page("new"), ".."), { recursive: true });
    await fs.writeFile(join(pods, "new", "pod.json"), '{"id":"new"}');
    await fs.writeFile(page("new"), "<title>dropped on drive</title>");
    await fs.writeFile(join(pods, "new", "Run.csx"), "Result(1);");
    expect(Buffer.from((await capturePackage("new", pods)).members.find(member => member.path === "Run.csx")!.bytes).toString()).toBe("Result(1);");
    const stats = vi.spyOn(fs, "lstat");
    const handler = createPagesHandler([], [pods], undefined, undefined, stateFixture(join(root, "state")));
    expect(await (await handler(new Request("http://host/pages/new--hello/"))).text()).toContain("dropped on drive");
    expect(stats.mock.calls.map(([path]) => String(path))).not.toContain(page("other"));
    await fs.writeFile(join(pods, "new", "Run.csx"), "Result(2);");
    expect(Buffer.from((await capturePackage("new", pods)).members.find(member => member.path === "Run.csx")!.bytes).toString()).toBe("Result(2);");
  } finally { await lifecycle.close(); }
});

test("whole inventory reads use the cadence and explicit refresh sees a newly dropped Pod", async () => {
  const { root, pods, page } = await fixture();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const content = createContributionContent({ worldRoot: stateTree(root).directory("agent"),
    decisionsMachine: stateTree(join(root, "machine")),
    packages: options => listPackages({ ...options, podsRoots: pods }) });
  try {
    await content.lifecycle.ready;
    bindPackageLifecycle(content.lifecycle);
    const plugins = createPluginsHandler(content);
    const inventory = () => servePeRoute(new Request("http://host/pe/plugins"), plugins);
    const stats = vi.spyOn(fs, "lstat");
    expect((await inventory()).status).toBe(200);
    expect(stats).not.toHaveBeenCalled();
    await fs.mkdir(join(page("dropped"), ".."), { recursive: true });
    await fs.writeFile(join(pods, "dropped", "pod.json"), '{"id":"dropped"}');
    await fs.writeFile(page("dropped"), "<title>new inventory</title>");
    expect(await (await inventory()).text()).not.toContain("pod:dropped");
    await content.lifecycle.refresh();
    expect(await (await inventory()).text()).toContain("pod:dropped");
    await fs.writeFile(page("dropped"), "<title>timer refresh after explicit refresh</title>");
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
    await expect.poll(() => Buffer.from(content.lifecycle.packages().find(pod => pod.id === "dropped")!
      .members.find(member => member.path === "pages/hello/index.html")!.bytes).toString()).toContain("timer refresh");
    const handler = createPagesHandler([], [pods], undefined, undefined, stateTree(root).directory("page-state"));
    expect((await handler(new Request("http://host/pages"))).status).toBe(200);
  } finally { await content.close(); }
});

test("a recovered first admission is retried by an unknown key before the cadence", async () => {
  const { pods, page, request } = await fixture();
  await fs.mkdir(join(page("new"), ".."), { recursive: true });
  await fs.writeFile(join(pods, "new", "pod.json"), '{"id":"new"}');
  await fs.writeFile(page("new"), "<title>new after temporary refusal</title>");
  const original = fs.open;
  const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === page("new")) throw Object.assign(Error("temporary"), { code: "EBUSY" });
    return original(...args);
  });
  expect((await listPackages({ podsRoots: pods })).unreadable).toEqual([expect.objectContaining({ folder: "new" })]);
  opened.mockClear();
  expect((await request()).status).toBe(200);
  expect(opened).not.toHaveBeenCalled();
  opened.mockRestore();
  expect((await capturePackage("new", pods)).id).toBe("new");
  expect(await (await request("new")).text()).toContain("new after temporary refusal");
});

test("one failed member metadata walk loses reuse only for that Pod", async () => {
  const { pods, page } = await fixture();
  const original = fs.lstat;
  vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
    if (String(args[0]) === page("other")) throw Object.assign(Error("placeholder"), { code: "EIO" });
    return original(...args);
  });
  const opened = vi.spyOn(fs, "open");
  const listing = await listPackages({ podsRoots: pods });
  expect(listing.packages.find(pod => pod.id === "other")?.discoveryFailure).toBeTruthy();
  expect(opened.mock.calls.map(([path]) => String(path))).not.toContain(page("untouched"));
});

test("an unavailable neighbour's capture is retried only when that Pod is used", async () => {
  const { pods, page, request } = await fixture();
  await fs.writeFile(page("other"), "<title>changed but locked</title>");
  const original = fs.open;
  const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === page("other")) throw Object.assign(Error("locked"), { code: "EBUSY" });
    return original(...args);
  });
  expect((await listPackages({ podsRoots: pods })).packages.find(pod => pod.id === "other")?.discoveryFailure).toBeTruthy();
  opened.mockClear();
  await fs.writeFile(page("requested"), "<title>healthy edit beside locked Pod</title>");
  expect(await (await request()).text()).toContain("healthy edit beside locked Pod");
  expect(opened.mock.calls.map(([path]) => String(path))).not.toContain(page("other"));
  opened.mockClear();
  expect((await request()).status).toBe(200);
  expect(opened).not.toHaveBeenCalled();
  const response = await request("other");
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("pod.discovery.exceeded");
  expect(opened.mock.calls.map(([path]) => String(path))).toContain(page("other"));
});

test.each(["before", "after"])("a failed Pod keeps its marker when its capture ends %s a peer's capture", async order => {
  const { pods, page, request } = await fixture();
  await fs.writeFile(join(pods, "requested", "Run.csx"), "Result(1);");
  await fs.writeFile(join(pods, "requested", "pod.json"), '{"id":"requested","entrypoints":[{"sourcePath":"Run.csx"}]}');
  await listPackages({ podsRoots: pods });
  rememberCaptureRoots(pods);
  const sealed = await capturePackage("requested", pods);
  const failedGate = Promise.withResolvers<void>(), failedEntered = Promise.withResolvers<void>();
  const peerGate = Promise.withResolvers<void>(), peerEntered = Promise.withResolvers<void>();
  const original = fs.open;
  let heldFailed = false, heldPeer = false;
  const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === page("requested") && !heldFailed) {
      heldFailed = true;
      failedEntered.resolve();
      await failedGate.promise;
      throw Object.assign(Error("busy"), { code: "EBUSY" });
    }
    if (order === "before" && String(args[0]) === page("other") && !heldPeer) {
      heldPeer = true;
      peerEntered.resolve();
      await peerGate.promise;
    }
    return original(...args);
  });
  try {
    await fs.writeFile(page("requested"), "<title>failing changed Page</title>");
    const failing = request();
    await failedEntered.promise;
    await fs.writeFile(page("other"), "<title>fresh peer</title>");
    const peer = request("other");
    if (order === "before") {
      await peerEntered.promise;
      failedGate.resolve();
      expect((await failing).status).toBe(503);
      peerGate.resolve();
      expect(await (await peer).text()).toContain("fresh peer");
    } else {
      expect(await (await peer).text()).toContain("fresh peer");
      failedGate.resolve();
      expect((await failing).status).toBe(503);
    }
    opened.mockImplementation(async (...args) => {
      if (String(args[0]) === page("requested")) throw Object.assign(Error("still busy"), { code: "EBUSY" });
      return original(...args);
    });
    await expect(capturePackage("requested", pods)).rejects.toMatchObject({ code: "pod.discovery.exceeded" });
    await expect(freezeScript({ sourcePath: "Run.csx", sourceBundle: sealed.sourceBundle }))
      .rejects.toMatchObject({ status: 503, refusal: { code: "pod.discovery.exceeded" } });
    opened.mockRestore();
    expect(await (await request()).text()).toContain("failing changed Page");
  } finally { failedGate.resolve(); peerGate.resolve(); }
});

test("an older failed capture cannot replace a newer successful capture of that Pod", async () => {
  const { pods, page, request } = await fixture();
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = fs.open;
  let held = false;
  const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === page("requested") && !held) {
      held = true;
      entered.resolve();
      await gate.promise;
      throw Object.assign(Error("older busy read"), { code: "EBUSY" });
    }
    return original(...args);
  });
  try {
    await fs.writeFile(page("requested"), "<title>older pending</title>");
    const older = request();
    await entered.promise;
    await fs.writeFile(page("requested"), "<title>newer successful observation wins</title>");
    expect(await (await request()).text()).toContain("newer successful observation wins");
    gate.resolve();
    expect((await older).status).toBe(503);
    opened.mockRestore();
    const pod = await capturePackage("requested", pods);
    expect(Buffer.from(pod.members.find(member => member.path === "pages/hello/index.html")!.bytes).toString())
      .toContain("newer successful observation wins");
  } finally { gate.resolve(); }
});

test("a named contribution read sees edited script bytes before the inventory cadence", async () => {
  const { root, pods } = await fixture();
  await fs.writeFile(join(pods, "requested", "Run.csx"), "Result(1);");
  await fs.writeFile(join(pods, "requested", "pod.json"), '{"id":"requested","entrypoints":[{"sourcePath":"Run.csx"}]}');
  const content = createContributionContent({ worldRoot: stateTree(root).directory("agent"), homeRoot: root,
    decisionsMachine: stateTree(join(root, "machine")), packages: options => listPackages({ ...options, podsRoots: pods }) });
  try {
    await content.read();
    const app = createPeRoutes({ registrations: [], store: { getState: async () => null, setState: async () => {} },
      heads: { observe: () => () => {} }, contributionRead: content.member });
    const read = () => app.fetch(new Request("http://host/pe/contributions?key=script%3A%40requested%2FRun.csx"));
    expect(await (await read()).json()).toMatchObject({ content: "Result(1);" });
    await fs.writeFile(join(pods, "requested", "Run.csx"), "Result(2);");
    expect(await (await read()).json()).toMatchObject({ content: "Result(2);" });
  } finally { await content.close(); }
});

test("an incomplete root listing cannot remove an admitted Pod that still has its manifest", async () => {
  const { pods, page, request } = await fixture();
  const original = fs.readdir;
  const listing = vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
    const entries = await original(...args);
    return String(args[0]) === pods && typeof args[1] === "object" && args[1]?.withFileTypes
      ? entries.filter(entry => String(entry.name) !== "requested") : entries;
  });
  await fs.writeFile(page("other"), "<title>fresh beside incomplete enumeration</title>");
  expect(await (await request("other")).text()).toContain("fresh beside incomplete enumeration");
  await expect(capturePackage("requested", pods)).rejects.toMatchObject({ code: "pod.discovery.exceeded" });
  const refused = await request();
  expect(refused.status).toBe(503);
  expect(await refused.text()).toContain("pod.discovery.exceeded");
  listing.mockRestore();
  expect((await request()).status).toBe(200);
  await fs.rm(join(pods, "requested"), { recursive: true });
  expect((await request()).status).toBe(404);
});
