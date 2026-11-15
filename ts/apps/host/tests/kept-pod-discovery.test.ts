import { afterEach, expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import * as syncFilesystem from "node:fs";
import * as pageExport from "../src/page-export.ts";
import * as diskSignature from "../src/pod-disk-signature.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, stateFixture, stateMachine } from "../../../tests/isolated-home/storage.ts";
import { ledgerFixture } from "./storage.ts";
import { pictureCaptures } from "./effect-test.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { exportPod } from "../src/pod-transfer.ts";
import { bindPackageScanLogger, capturePackage, listPackages } from "../src/packages.ts";
import * as packages from "../src/packages.ts";
import { discoverPackages, packagePodWorkTimeoutMs, stopPackageDiscovery } from "../src/pod-capture.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { serveRoutes } from "./real-server.ts";
import { detachedBridge } from "./effect-test.ts";
import { Effect, Layer } from "effect";
import { ActionJournalService } from "../src/receipt-services.ts";
import { HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/contracts";
import {
  bindPackageLifecycle,
  createPackageLifecycle,
  requirePackageEnabled,
} from "../src/package-lifecycle.ts";
import { shippedPodUpdateRefusals } from "../src/shipped-pod-status.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(),
}));
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("../src/page-export.ts", async (original) => ({ ...await original<typeof import("../src/page-export.ts")>() }));
vi.mock("../src/pod-disk-signature.ts", async (original) => ({ ...await original<typeof import("../src/pod-disk-signature.ts")>() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  bindPackageScanLogger(() => {});
  bindPackageLifecycle(undefined);
  shippedPodUpdateRefusals.clear();
  stopPackageDiscovery();
});

test.each(["edited", "missing-record"])(
  "a kept example (%s) stays in the catalog with executable bytes and one update notice",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "pe-kept-pod-"));
    const source = join(root, "examples");
    const folder = join(source, "example");
    await mkdir(join(folder, "pages", "tour"), { recursive: true });
    await mkdir(join(folder, "src"));
    await writeFile(
      join(folder, "pod.json"),
      JSON.stringify({
        id: "example",
        name: "Example",
        version: "1",
        entrypoints: [{ sourcePath: "src/Run.cs" }],
      }),
    );
    await writeFile(join(folder, "pages", "tour", "index.html"), "<title>Example</title>");
    await writeFile(join(folder, "src", "Run.cs"), 'Result("original");');
    const shippedRoot = join(root, "shipped");
    const archivePath = join(shippedRoot, "example.zip");
    const captures = pictureCaptures(join(root, "captures"));
    const podsRoot = join(root, "home", "Pods");
    const ledger = ledgerFixture(join(root, "shipped-pods.json"));
    const boot = () => importShippedPods({ shippedRoot, podsRoot, ledger, captures });
    await exportPod({ pod: "example", archivePath }, { podsRoot: source, captures });
    if (kind === "edited") await boot();
    else {
      await mkdir(join(podsRoot, "example", "src"), { recursive: true });
      await mkdir(join(podsRoot, "example", "pages", "tour"), { recursive: true });
      for (const path of ["pod.json", "src/Run.cs", "pages/tour/index.html"])
        await writeFile(join(podsRoot, "example", path), await readFile(join(folder, path)));
    }
    const mine = 'Result("my edit");';
    await writeFile(join(podsRoot, "example", "src", "Run.cs"), mine);
    await writeFile(join(folder, "src", "Run.cs"), 'Result("new example");');
    await rm(archivePath);
    await exportPod({ pod: "example", archivePath }, { podsRoot: source, captures });
    await boot();
    await boot();
    const content = createContributionContent({
      worldRoot: stateFixture(join(root, "agent")),
      homeRoot: join(root, "home"),
      decisionsMachine: stateMachine(root),
      packages: () => listPackages({ podsRoots: podsRoot }),
    });
    try {
      const catalog = await content.read();
      const pod = catalog.packages.find((p) => p.id === "example")!;
      expect(pod.contributions.map((c) => c.key)).toEqual(
        expect.arrayContaining(["script:@example/src/Run.cs", "page:@example/pages/tour"]),
      );
      const executable = await content.member("script:@example/src/Run.cs");
      expect(executable).toMatchObject({
        content: mine,
        sourceBundle: { files: expect.any(Array) },
      });
      expect(pod.diagnostics).toEqual([
        expect.objectContaining({
          code: "ShippedExampleUpdateKept",
          severity: "warning",
          message: expect.stringContaining("import the current example into a separate workspace"),
        }),
      ]);
      expect(pod.diagnostics[0]!.message).toContain("undo your local edits and the next start takes the update");
      const captured = await capturePackage("example", podsRoot);
      expect(
        Buffer.from(
          captured.sourceBundle.files.find((f) => f.path === "src/Run.cs")!.bytesBase64,
          "base64",
        ).toString(),
      ).toBe(mine);
      expect(await readFile(join(podsRoot, "example", "src", "Run.cs"), "utf8")).toBe(mine);
    } finally {
      await content.close();
    }
  },
);

test("folder scans log their folder, start and completed duration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-log-"));
  const lines: string[] = [];
  bindPackageScanLogger((line) => lines.push(line));
  expect(await listPackages({ podsRoots: root })).toEqual({ packages: [], unreadable: [] });
  expect(lines).toEqual([
    `Pod folder scan start folder=${JSON.stringify(root)}`,
    expect.stringMatching(/Pod folder scan end folder=.+ durationMs=\d+ outcome=completed/),
  ]);
});

test.each([5_000, 3_600_000])("late census expires after %i ms instead of masking a fresh reader", async (age) => {
  vi.useFakeTimers();
  const late = Promise.withResolvers<packages.PackageListing>();
  const first = discoverPackages("expiry", () => late.promise, "request");
  const refused = expect(first).rejects.toThrow("Pod discovery exceeded");
  await vi.advanceTimersByTimeAsync(5_000);
  await refused;
  late.resolve({ packages: [], unreadable: [{ folder: "old", message: "old" }] });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(age);
  const fresh = vi.fn(async () => ({ packages: [], unreadable: [] }));
  expect(await discoverPackages("expiry", fresh, "request")).toEqual({ packages: [], unreadable: [] });
  expect(fresh).toHaveBeenCalledOnce();
});

test("a lifecycle background reader cannot stamp a kept census with fresh disk metadata", async () => {
  vi.useFakeTimers();
  const late = Promise.withResolvers<packages.PackageListing>();
  const first = discoverPackages("metadata", () => late.promise, "request");
  const refused = expect(first).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5_000);
  await refused;
  late.resolve({ packages: [], unreadable: [{ folder: "old", message: "old" }] });
  await vi.advanceTimersByTimeAsync(0);
  const fresh = vi.fn(async () => ({ packages: [], unreadable: [] }));
  expect(await discoverPackages("metadata", fresh, "background")).toEqual({ packages: [], unreadable: [] });
  expect(fresh).toHaveBeenCalledOnce();
});

test("a scan at sixty seconds is aborted and replaced; its late completion cannot replace the new census", async () => {
  const { pods } = await reviewedPod();
  const oldListing = await listPackages({ podsRoots: pods });
  await filesystem.rename(join(pods, "review"), join(pods, "moved"));
  await writeFile(join(pods, "moved", "pod.json"), '{"id":"fresh"}');
  const freshListing = await listPackages({ podsRoots: pods });
  vi.useFakeTimers();
  const late = Promise.withResolvers<packages.PackageListing>();
  let signal: AbortSignal;
  const signature = async () => "[]";
  const first = discoverPackages("stuck", (_roots, stop) => { signal = stop; return late.promise; }, "request", signature);
  const refused = expect(first).rejects.toThrow();
  const backgroundRefused = expect(discoverPackages("stuck", () => late.promise, "background", signature)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5_000);
  await refused;
  await vi.advanceTimersByTimeAsync(55_000);
  const fresh = vi.fn(async () => freshListing);
  const replacement = discoverPackages("stuck", fresh, "request", signature);
  await replacement;
  expect(signal!.aborted).toBe(true);
  expect(fresh).toHaveBeenCalledOnce();
  const checked = () => discoverPackages("stuck", async () => { throw Error("fresh census was replaced"); }, "request", signature);
  expect(await checked()).toEqual(freshListing);
  late.resolve(oldListing); // This reader ignores AbortSignal, as a stuck native filesystem call can.
  await vi.advanceTimersByTimeAsync(0);
  await backgroundRefused;
  expect(await checked()).toEqual(freshListing);
});

test("scan diagnostics reach the host file even with unread stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-file-"));
  const file = packages.packageScanLog.in(stateFixture(join(root, "host", "fixture", "log")));
  const flush = bindPackageScanLogger(() => {}, file);
  await listPackages({ podsRoots: root });
  await flush();
  const log = await readFile(file.path, "utf8");
  expect(log).toContain("Pod folder scan start");
  expect(log).toMatch(/Pod folder scan end .*outcome=completed/);
});

test("the HTTP discovery deadline includes 1.2 s of target lookup before listing (D23)", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<packages.PackageListing>();
  vi.spyOn(packages, "listPackages").mockImplementation(() => { entered.resolve(); return release.promise; });
  const root = await mkdtemp(join(tmpdir(), "pe-http-discovery-"));
  const bridge = detachedBridge({ list: Effect.sleep("1200 millis").pipe(Effect.as([])) });
  const routes = pagesRoute(() => [], () => root).pipe(Layer.provide(ActionJournalService.live(null)));
  const server = await serveRoutes(routes, bridge);
  try {
    const started = performance.now();
    const response = await fetch(`${server.base}/pages/late--tour/`, { headers: { [HOST_RPC_DOCUMENT_HEADER]: "doc" } });
    const body = await response.json();
    // 250 ms permits socket and timer scheduling, not another discovery budget.
    expect(performance.now() - started).toBeLessThan(5_250);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "pod.discovery.exceeded", message: expect.stringContaining("5000 ms") });
  } finally {
    release.resolve({ packages: [], unreadable: [] });
    await server.close();
  }
});

async function reviewedPod() {
  const root = await mkdtemp(join(tmpdir(), "pe-w26-review-"));
  const pods = join(root, "Pods");
  const page = join(pods, "review", "pages", "tour");
  await mkdir(page, { recursive: true });
  await writeFile(join(pods, "review", "pod.json"), '{"id":"review"}');
  await writeFile(join(page, "index.html"), "<html><head><title>Review</title></head><body>v1</body></html>");
  return { root, pods, page };
}

test("three quick Page requests reuse one completed census until its disk signature changes", async () => {
  const { root, pods, page } = await reviewedPod();
  const actual = filesystem.readdir;
  let scans = 0;
  vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === pods && args[1] && typeof args[1] === "object" && args[1].withFileTypes) scans++;
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  const handler = createPagesHandler([], pods, undefined, undefined, stateFixture(join(root, "page-state")));
  for (const path of ["/pages", "/pages/review--tour/", "/pages"]) {
    expect((await handler(new Request(`http://host${path}`))).status).toBe(200);
    vi.setSystemTime(Date.now() + 1_000);
  }
  expect(scans).toBe(1);
  vi.setSystemTime(Date.now() + 60_000);
  expect((await handler(new Request("http://host/pages/review--tour/"))).status).toBe(200);
  expect(scans).toBe(1); // On-time answers have no late-answer TTL.
  await writeFile(join(page, "index.html"), "<title>Changed after the census</title>");
  expect(await (await handler(new Request("http://host/pages/review--tour/"))).text()).toContain("Changed after the census");
  expect(scans).toBe(2);
});

test("unchanged concurrent requests validate metadata but share one full scan", async () => {
  const { pods } = await reviewedPod();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actual = filesystem.open;
  let scans = 0;
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === join(pods, "review", "pod.json")) {
      scans++; entered.resolve(); await release.promise;
    }
    return actual(...args);
  });
  const metadata = vi.spyOn(diskSignature, "podsDiskSignature");
  const first = listPackages({ podsRoots: pods });
  await entered.promise;
  const others = [listPackages({ podsRoots: pods }), listPackages({ podsRoots: pods })];
  try {
    await vi.waitFor(() => expect(metadata.mock.settledResults.filter(result => result.type === "fulfilled")).toHaveLength(3));
    await new Promise(resolve => setImmediate(resolve));
    expect(scans).toBe(1);
  } finally { release.resolve(); await Promise.all([first, ...others]); }
});

test.each(["in-flight", "bounded"])("a request after an edit validates a %s scan against its arrival signature", async (kind) => {
  const { pods, page } = await reviewedPod();
  await mkdir(join(pods, "zz-blocker"));
  await writeFile(join(pods, "zz-blocker", "pod.json"), '{"id":"blocker"}');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actual = filesystem.open;
  let held = false;
  vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    if (!held && String(args[0]) === join(pods, "zz-blocker", "pod.json")) {
      held = true; entered.resolve(); await release.promise;
    }
    return actual(...args);
  });
  if (kind === "bounded") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const first = listPackages({ podsRoots: pods });
  const observed = first.catch(error => error);
  await entered.promise;
  const complete = discoverPackages(pods, async () => { throw Error("unexpected second reader"); }, "background");
  try {
    if (kind === "bounded") {
      await vi.advanceTimersByTimeAsync(packagePodWorkTimeoutMs);
      expect(await observed).toMatchObject({ unreadable: expect.arrayContaining([
        expect.objectContaining({ folder: "zz-blocker", message: expect.stringContaining("Pod work exceeded") }),
      ]) });
      release.resolve(); await complete;
    }
    await writeFile(join(page, "index.html"), "<title>v2 after request arrival</title>");
    const signatureRead = Promise.withResolvers<void>();
    const original = diskSignature.podsDiskSignature;
    vi.spyOn(diskSignature, "podsDiskSignature").mockImplementation(async (...args) => {
      const signature = await original(...args); signatureRead.resolve(); return signature;
    });
    const next = listPackages({ podsRoots: pods });
    await signatureRead.promise;
    await new Promise(resolve => setImmediate(resolve));
    release.resolve();
    const listing = await next;
    const html = listing.packages.find(pod => pod.id === "review")!.members.find(member => member.path.endsWith("index.html"))!;
    expect(Buffer.from(html.bytes).toString()).toContain("v2 after request arrival");
  } finally { release.resolve(); await complete; await observed; }
});

test("a changed signature leaves the old request running but cannot publish its old census", async () => {
  const { pods } = await reviewedPod();
  const old = await listPackages({ podsRoots: pods });
  await filesystem.rename(join(pods, "review"), join(pods, "fresh"));
  await writeFile(join(pods, "fresh", "pod.json"), '{"id":"fresh"}');
  const newer = await listPackages({ podsRoots: pods });
  const release = Promise.withResolvers<packages.PackageListing>();
  vi.useFakeTimers({ toFake: ["Date"] });
  let signal: AbortSignal;
  let disk = "old";
  const signature = async () => disk;
  const first = discoverPackages("superseded", (_roots, stop) => { signal = stop; return release.promise; }, "request", signature);
  await new Promise(resolve => setImmediate(resolve));
  disk = "new";
  expect(await discoverPackages("superseded", async () => newer, "background", signature)).toEqual(newer);
  expect(signal!.aborted).toBe(false);
  release.resolve(old);
  expect(await first).toEqual(old);
  expect(await discoverPackages("superseded", async () => { throw Error("unchanged listing rescanned"); }, "request", signature)).toEqual(newer);
});

test.each(["target", "export"])("a slow %s GET keeps its own rules after discovery answers", async (verb) => {
  const { pods } = await reviewedPod();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actualExport = pageExport.exportPage;
  if (verb === "export") vi.spyOn(pageExport, "exportPage").mockImplementation(async (input) => {
    entered.resolve();
    await release.promise;
    return actualExport(input);
  });
  const bridge = detachedBridge({ list: verb === "target" ? Effect.promise(async () => {
    entered.resolve();
    await release.promise;
    return [];
  }) : Effect.succeed([]) });
  const server = await serveRoutes(pagesRoute(() => [], () => pods).pipe(Layer.provide(ActionJournalService.live(null))), bridge);
  let response: Promise<Response> | undefined;
  try {
    let answered = false;
    response = fetch(`${server.base}/pages/review--tour/${verb}`).then(r => { answered = true; return r; });
    await entered.promise;
    await new Promise(resolve => setTimeout(resolve, 5_100));
    expect(answered).toBe(false);
    release.resolve();
    expect((await response).status).toBe(200);
  } finally {
    release.resolve();
    await response;
    await server.close();
  }
});

test("lifecycle does not stamp an older in-flight scan with the current disk signature", async () => {
  const { root, pods, page } = await reviewedPod();
  const old = await listPackages({ podsRoots: pods });
  const release = Promise.withResolvers<void>();
  const older = discoverPackages(pods, async () => { await release.promise; return old; }, "background").catch(() => undefined);
  await writeFile(join(page, "index.html"), "<title>v2, changed behind the pending scan</title>");
  vi.spyOn(packages, "productPodsRoots").mockReturnValue([pods]);
  const actualList = packages.listPackages;
  vi.spyOn(packages, "listPackages").mockImplementation((...args) => {
    release.resolve();
    return actualList(...args);
  });
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root) });
  try {
    await lifecycle.ready;
    await older;
    const html = () => Buffer.from(lifecycle.listing().packages[0]!.members.find(m => m.path.endsWith("index.html"))!.bytes).toString();
    expect(html()).toContain("v2, changed");
    await lifecycle.refresh();
    expect(html()).toContain("v2, changed");
  } finally { release.resolve(); await older; await lifecycle.close(); }
});

test("scan diagnostics do not write synchronously", async () => {
  const { root } = await reviewedPod();
  const file = packages.packageScanLog.in(stateFixture(join(root, "host-log")));
  const flush = bindPackageScanLogger(() => {}, file);
  onTestFinished(flush);
  const write = vi.spyOn(syncFilesystem, "writeFileSync");
  packages.logPackageDiscovery("Pod folder scan start folder=async");
  expect(write).not.toHaveBeenCalled();
  await vi.waitFor(async () => expect(await readFile(file.path, "utf8")).toContain("folder=async"));
});

test("scan diagnostics keep the newest 1000 lines and exclude request chatter", async () => {
  const { root } = await reviewedPod();
  const file = packages.packageScanLog.in(stateFixture(join(root, "host-log")));
  const flush = bindPackageScanLogger(() => {}, file);
  onTestFinished(flush);
  packages.logPackageDiscovery("request /pages, not a scan");
  for (let i = 0; i < 1_020; i++) packages.logPackageDiscovery(`Pod folder scan end folder=${i}`);
  packages.logPackageDiscovery("request /pages, after the scans");
  await flush();
  await vi.waitFor(async () => expect(await readFile(file.path, "utf8")).toContain("folder=1019"));
  const lines = (await readFile(file.path, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(1_000);
  expect(lines[0]).toContain("folder=20");
  expect(lines.join("\n")).not.toContain("request /pages");
});

test("Page roots discover a home mounted after composition once their short cache expires", async () => {
  const { pods } = await reviewedPod();
  let mounted = false;
  const server = await serveRoutes(pagesRoute(() => [], () => mounted ? [pods] : []).pipe(Layer.provide(ActionJournalService.live(null))), detachedBridge());
  try {
    expect((await (await fetch(`${server.base}/pages`)).json()).pages).toEqual([]);
    mounted = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5_001);
    const listing = await (await fetch(`${server.base}/pages`)).json();
    expect(listing.pages).toContainEqual(expect.objectContaining({ key: "page:@review/pages/tour" }));
  } finally { vi.useRealTimers(); await server.close(); }
});

test("lifecycle discovers a home mounted after its startup census", async () => {
  const { root, pods } = await reviewedPod();
  const roots = vi.spyOn(packages, "productPodsRoots").mockReturnValue([]);
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root) });
  try {
    await lifecycle.ready;
    expect(lifecycle.active("review")).toBe(false);
    roots.mockReturnValue([pods]);
    await lifecycle.refresh();
    expect(lifecycle.active("review")).toBe(true);
  } finally { await lifecycle.close(); }
});

test("unchanged lifecycle reads do not log fast metadata scans per request", async () => {
  const { root, pods } = await reviewedPod();
  vi.spyOn(packages, "productPodsRoots").mockReturnValue([pods]);
  const lines: string[] = [];
  bindPackageScanLogger(line => lines.push(line));
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root) });
  try {
    await lifecycle.ready;
    const before = lines.length;
    await lifecycle.refresh();
    await lifecycle.refresh();
    expect(lines).toHaveLength(before);
  } finally { await lifecycle.close(); }
});

test("a stalled folder listing bounds waiters, shares work, and publishes its late census", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-bound-"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const lines: string[] = [];
  bindPackageScanLogger((line) => lines.push(line));
  const actual = filesystem.readdir;
  const spy = vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === root) { entered.resolve(); await release.promise; }
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mkdir(join(root, "late"));
  await writeFile(join(root, "late", "pod.json"), '{"id":"late"}');
  const homes = [root, join(root, "next-home")];
  const scan = listPackages({ podsRoots: homes });
  const refused = expect(scan).rejects.toThrow("Pod discovery exceeded 5000 ms");
  const joined = expect(listPackages({ podsRoots: homes })).rejects.toThrow("Pod discovery exceeded 5000 ms");
  await entered.promise;
  await vi.advanceTimersByTimeAsync(5_000);
  await refused;
  await joined;
  release.resolve();
  await vi.waitFor(() => expect(lines.filter(line => line.startsWith("Pod folder scan end"))).toHaveLength(2));
  const folderScans = lines.filter(line => line.startsWith("Pod folder scan "));
  expect(folderScans).toHaveLength(4);
  expect(folderScans.filter(line => line.startsWith("Pod folder scan end"))).toEqual([
    expect.stringContaining("outcome=completed"), expect.stringContaining("outcome=completed"),
  ]);
  const calls = lines.filter(line => line.startsWith("Pod folder scan start")).length;
  expect((await listPackages({ podsRoots: homes })).packages.map(p => p.id)).toEqual(["late"]);
  expect(lines.filter(line => line.startsWith("Pod folder scan start"))).toHaveLength(calls);
  await listPackages({ podsRoots: homes });
  expect(lines.filter(line => line.startsWith("Pod folder scan start")).length).toBeGreaterThan(calls);
  expect((await capturePackage("late", homes)).id).toBe("late");
});

test("startup census timeout is observed before any reader attaches (D21 crash)", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-startup-crash-"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = filesystem.readdir;
  vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual(...args);
  });
  const notices: string[] = [];
  bindPackageScanLogger(line => notices.push(line));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root), packages: () => listPackages({ podsRoots: root }) });
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(5_000);
    await new Promise(resolve => setImmediate(resolve));
    expect(notices.some(line => line.includes("startup census failed"))).toBe(true);
    await expect(lifecycle.ready).resolves.toBeUndefined();
  } finally {
    release.resolve();
    await lifecycle.close();
    await lifecycle.ready.catch(() => {});
  }
});

test("host shutdown aborts an outstanding scan before publishing its census", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-shutdown-"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = filesystem.readdir;
  vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual(...args);
  });
  const scan = listPackages({ podsRoots: root });
  const refused = expect(scan).rejects.toThrow();
  await entered.promise;
  stopPackageDiscovery();
  release.resolve();
  await refused;
  await expect(capturePackage("late", root)).rejects.toThrow("before Pod discovery finishes");
});

test("a discovery-like message without the typed error is not an expiry refusal", async () => {
  const error = Error("Pod discovery exceeded an unrelated failure");
  vi.spyOn(packages, "listPackages").mockRejectedValueOnce(error);
  const root = await mkdtemp(join(tmpdir(), "pe-scan-tag-"));
  const handler = createPagesHandler([], root, undefined, undefined, stateFixture(join(root, "state")));
  await expect(handler(new Request("http://host/pages"))).rejects.toBe(error);
});

test("a slow startup scan publishes activation so the next Page request succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-page-retry-"));
  const home = join(root, "home");
  const pods = join(home, "Pods");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  await mkdir(join(pods, "late", "pages", "tour"), { recursive: true });
  await writeFile(join(pods, "late", "pod.json"), '{"id":"late"}');
  await writeFile(join(pods, "late", "pages", "tour", "index.html"), "<title>Late</title>");
  vi.spyOn(packages, "productPodsRoots").mockReturnValue([pods]);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = filesystem.readdir;
  let scans = 0;
  vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === pods && args[1] && typeof args[1] === "object" && args[1].withFileTypes) {
      scans++;
      entered.resolve();
      await release.promise;
    }
    return actual(...args);
  });
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root) });
  bindPackageLifecycle(lifecycle);
  await entered.promise;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const handler = createPagesHandler([], [pods], undefined, undefined, stateFixture(join(root, "page-state")));
  try {
    const opening = handler(new Request("http://host/pages/late--tour/"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await opening).status).toBe(503);
    release.resolve();
    await lifecycle.ready;
    expect(lifecycle.active("late")).toBe(true);
    expect((await handler(new Request("http://host/pages/late--tour/"))).status).toBe(200);
    expect(scans).toBe(1);
  } finally {
    release.resolve();
    await lifecycle.close();
  }
});

test("the five-second lifecycle discovery bound includes its initial census", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-ready-bound-"));
  const release = Promise.withResolvers<{ packages: []; unreadable: [] }>();
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: () => release.promise,
  });
  bindPackageLifecycle(lifecycle);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const opening = expect(requirePackageEnabled("late")).rejects.toMatchObject({ code: "pod.discovery.exceeded" });
    await vi.advanceTimersByTimeAsync(5_000);
    await opening;
  } finally {
    await lifecycle.close();
    release.resolve({ packages: [], unreadable: [] });
    await lifecycle.ready;
  }
});

test("host lifecycle shutdown does not await an unfinished filesystem scan", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-close-stalled-scan-"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<packages.PackageListing>();
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: () => { entered.resolve(); return release.promise; },
  });
  await entered.promise;
  try {
    const started = performance.now();
    await lifecycle.close();
    stopPackageDiscovery();
    expect(performance.now() - started).toBeLessThan(250);
  } finally {
    release.resolve({ packages: [], unreadable: [] });
    await lifecycle.ready;
  }
});

test.each(["/pages/late--tour/", "/pages"])("a first Page request %s answers by 5000 ms and never starts lifecycle after expiry", async (path) => {
  const root = await mkdtemp(join(tmpdir(), "pe-first-page-bound-"));
  const home = join(root, "home");
  const pods = join(home, "Pods");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  await mkdir(join(pods, "late", "pages", "tour"), { recursive: true });
  await writeFile(join(pods, "late", "pod.json"), '{"id":"late","entrypoints":[]}');
  await writeFile(join(pods, "late", "pages", "tour", "index.html"), "<title>Late</title>");
  const listing = await listPackages({ podsRoots: pods });
  const releaseCensus = Promise.withResolvers<{ packages: []; unreadable: [] }>();
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root), packages: () => releaseCensus.promise });
  bindPackageLifecycle(lifecycle);
  const ready = lifecycle.ready;
  const policy = vi.spyOn(lifecycle, "ready", "get").mockReturnValue(ready);
  const entered = Promise.withResolvers<void>();
  const releaseListing = Promise.withResolvers<typeof listing>();
  vi.spyOn(packages, "listPackages").mockImplementationOnce(() => {
    entered.resolve();
    return releaseListing.promise;
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const started = Date.now();
  let answered = false;
  const handler = createPagesHandler([], pods, undefined, undefined, stateFixture(join(root, "page-state")));
  const opening = handler(new Request(`http://host${path}`)).finally(() => { answered = true; });
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(answered).toBe(false);
    expect(policy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    const response = await opening;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "pod.discovery.exceeded",
      message: `Pod discovery exceeded 5000 ms listing ${pods}. Try again when the folder is available.`,
    });
    expect(Date.now() - started).toBe(5_000);
    releaseListing.resolve(listing);
    await new Promise((resolve) => setImmediate(resolve));
    expect(policy).not.toHaveBeenCalled();
  } finally {
    releaseListing.resolve(listing);
    await lifecycle.close();
    releaseCensus.resolve({ packages: [], unreadable: [] });
    await ready;
    await opening;
  }
});
