import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import * as filesystem from "node:fs";
import * as paths from "@pe/host-contracts/product-paths";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { acquireContentRoots, contentRootsRefreshMs, contentRootsResolveTimeoutMs, contentRootsReady, contentHomes, contentRootsUnavailable, observeContentRoots } from "../src/content-roots.ts";
import { notices } from "@pe/host-contracts/kinds";
import { hostState } from "../src/host-ownership.ts";
import * as asyncFilesystem from "node:fs/promises";
import { listPackages, productPodsRoots } from "../src/packages.ts";
import { productPagesRoots } from "../src/page-libraries.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { serveRoutes, bootHost } from "./real-server.ts";
import { ownedSession } from "./callers.ts";
import { BRIDGE_CONTRACT_VERSION, BRIDGE_PATH, HOST_RUNTIME_SERVICE_QUERY } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";
import { detachedBridge } from "./effect-test.ts";
import { Effect, Layer } from "effect";
import { ActionJournalService } from "../src/receipt-services.ts";
import { getHostStatus } from "../src/local-ops.ts";
import { productPodsRootPath } from "../src/product-paths.ts";
import { exportPod } from "../src/pod-transfer.ts";
import { noticeRows } from "../src/notice-feed.ts";

vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
vi.mock("@pe/host-contracts/product-paths", async original => ({ ...await original<typeof import("@pe/host-contracts/product-paths")>() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const snapshot = (user: string, firm?: string) => new Map<string, paths.Home[]>([["", [
  { tier: "user", root: user }, ...(firm ? [{ tier: "firm" as const, root: firm }] : []),
]]]);

test("an unanswered Documents lookup keeps health and bridge up, refuses Pages, and heals on retry", async () => {
  const { root } = await rootsFixture();
  await mkdir(join(root, "Pages", "recovered"), { recursive: true });
  await writeFile(join(root, "Pages", "recovered", "index.html"), "<title>Recovered</title>");
  // The unresolved promise stands for reg.exe before it establishes any user identity.
  vi.spyOn(paths, "knownUserRoot").mockReturnValue(undefined);
  vi.spyOn(paths, "userRoot").mockImplementation(() => { throw Error("sync Documents lookup on startup"); });
  vi.spyOn(paths, "resolveHomes").mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(snapshot(root));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const started = performance.now();
  const host = await bootHost({ productHome: null });
  let socket: WebSocket | undefined;
  try {
    expect((await fetch(`${host.base}/host/status`)).status).toBe(200);
    const startupSchedulingMarginMs = 750;
    expect(performance.now() - started).toBeLessThan(contentRootsResolveTimeoutMs + startupSchedulingMarginMs);
    expect((await fetch(`${host.base}/host/install`)).status).toBe(200);
    const pages = await fetch(`${host.base}/pages`);
    expect(pages.status).toBe(503);
    expect(await pages.json()).toMatchObject({ code: "pod.home-unavailable", message: expect.stringContaining("Settings › Host › Content homes") });
    await expect(listPackages()).rejects.toMatchObject({ code: "pod.home-unavailable", status: 503 });
    const exportStarted = performance.now();
    await expect(exportPod({ pod: "missing", archivePath: join(root, "missing.zip") })).rejects.toMatchObject({
      code: "pod.home-unavailable", status: 503, message: expect.stringContaining("Settings › Host › Content homes"),
    });
    expect(performance.now() - exportStarted).toBeLessThan(contentRootsResolveTimeoutMs + startupSchedulingMarginMs);
    expect(() => productPodsRootPath()).toThrow("Settings › Host › Content homes");
    expect(paths.userRoot).not.toHaveBeenCalled();
    socket = new WebSocket(`${host.base.replace("http:", "ws:")}${BRIDGE_PATH}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`);
    await new Promise<void>((resolve, reject) => {
      socket?.addEventListener("open", () => resolve(), { once: true });
      socket?.addEventListener("error", reject, { once: true });
    });
    const ack = new Promise<unknown>(resolve => socket?.addEventListener("message", event => resolve(JSON.parse(String(event.data))), { once: true }));
    socket.send(JSON.stringify({ kind: "Registration", registration: {
      contractVersion: BRIDGE_CONTRACT_VERSION, processId: 42, processStartUtcUnixMs: 1000, ...ownedSession,
      state: { activeDocumentIsFamilyDocument: false, activeDocumentIsModelInCloud: false,
        activeDocumentIsWorkshared: false, activeDocumentObservedAtUnixMs: 1, hasActiveDocument: false,
        revitVersion: "controlled transport", runtimeFramework: "test", runtimeAssemblies: [], openDocuments: [] },
    } }));
    expect(await ack).toMatchObject({ registrationAck: { accepted: true } });
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
    expect((await fetch(`${host.base}/pages`)).status).toBe(200);
  } finally { socket?.close(); await host.close(); }
});

test("host status defaults to the cached snapshot and cannot call the sync home probe", async () => {
  const { root, firm } = await rootsFixture();
  vi.spyOn(paths, "resolveHomes").mockResolvedValue(snapshot(root, firm));
  const sync = vi.spyOn(paths, "homesFound").mockImplementation(() => { throw Error("sync home probe"); });
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    const status = await Effect.runPromise(getHostStatus({ connected: false }));
    expect(status.homes).toContainEqual(expect.objectContaining({ tier: "firm", path: firm }));
    expect(sync).not.toHaveBeenCalled();
  } finally { owner.close(); }
});

test("Pod export and its user-root door refuse a missing identity without a sync Documents lookup", async () => {
  const { root } = await rootsFixture();
  vi.spyOn(paths, "knownUserRoot").mockReturnValue(undefined);
  const sync = vi.spyOn(paths, "userRoot").mockImplementation(() => { throw Error("sync reg.exe lookup"); });
  vi.spyOn(paths, "resolveHomes").mockReturnValue(new Promise(() => {}));
  vi.useFakeTimers();
  const owner = acquireContentRoots();
  const answer = exportPod({ pod: "missing", archivePath: join(root, "missing.zip") }).catch(error => error);
  try {
    expect(() => productPodsRootPath()).toThrow("Settings › Host › Content homes");
    await vi.advanceTimersByTimeAsync(contentRootsResolveTimeoutMs);
    expect(await answer).toMatchObject({ code: "pod.home-unavailable", status: 503,
      message: expect.stringContaining("Settings › Host › Content homes") });
    expect(sync).not.toHaveBeenCalled();
  } finally { owner.close(); await answer; }
});

test("the first completed resolution posts the Settings notice once after settling", async () => {
  const { root, firm } = await rootsFixture();
  const release = Promise.withResolvers<Map<string, paths.Home[]>>();
  vi.spyOn(paths, "resolveHomes").mockImplementation((_pointers, options) => {
    options?.onFirm?.({ root: null, looked: [firm] });
    return release.promise;
  });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const owner = acquireContentRoots();
  const findings = () => notices(hostState()).filter(n => n.path === firm && n.reason === "Set your firm home in Settings");
  try {
    expect(findings()).toHaveLength(0);
    release.resolve(snapshot(root));
    await owner.ready;
    expect(findings()).toHaveLength(1);
    expect(findings()[0]?.reason).toBe("Set your firm home in Settings");
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
    expect(findings()).toHaveLength(1);
  } finally { release.resolve(snapshot(root)); owner.close(); }
});

test("a newly resolved user home notices earlier Work asynchronously and only once", async () => {
  const { root } = await rootsFixture();
  const work = join(root, "Work"), file = join(work, "nested", "old.json");
  await mkdir(join(work, "nested"), { recursive: true });
  await writeFile(file, "keep these bytes");
  vi.spyOn(paths, "knownUserRoot").mockReturnValue(undefined);
  const release = Promise.withResolvers<Map<string, paths.Home[]>>();
  vi.spyOn(paths, "resolveHomes").mockReturnValue(release.promise);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const owner = acquireContentRoots();
  const findings = () => notices(hostState()).filter(n => n.path === work);
  try {
    expect(findings()).toHaveLength(0);
    release.resolve(snapshot(root)); await owner.ready;
    await vi.waitFor(() => expect(findings()).toHaveLength(1));
    expect(findings()[0]?.reason).toContain("Work saved by an earlier version");
    expect(await readFile(file, "utf8")).toBe("keep these bytes");
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
    expect(findings()).toHaveLength(1);
  } finally { release.resolve(snapshot(root)); owner.close(); }
});

test("a firm home arriving late clears its unavailable warning and notifies the live feed", async () => {
  const { root, firm } = await rootsFixture();
  const release = Promise.withResolvers<Map<string, paths.Home[]>>();
  vi.spyOn(paths, "resolveHomes").mockReturnValue(release.promise);
  vi.useFakeTimers();
  const owner = acquireContentRoots(), changed = vi.fn(), stop = observeContentRoots(changed);
  const rows = () => noticeRows({ threads: [], receipts: [], works: [], held: [], machine: null,
    stored: notices(hostState()).filter(n => n.path === firm), firmHomeUnavailable: contentRootsUnavailable(),
  }, Date.now());
  try {
    await vi.advanceTimersByTimeAsync(contentRootsResolveTimeoutMs);
    expect(rows().some(row => row.says?.includes("Firm home unavailable"))).toBe(true);
    changed.mockClear();
    release.resolve(snapshot(root, firm));
    await vi.advanceTimersByTimeAsync(0);
    expect(contentRootsUnavailable()).toBe(false);
    expect(rows().some(row => row.says?.includes("Firm home unavailable"))).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  } finally { release.resolve(snapshot(root)); stop(); owner.close(); }
});
async function rootsFixture() {
  const root = await mkdtemp(join(tmpdir(), "pe-root-deadline-"));
  const firm = join(root, "firm");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  return { root, firm };
}

test("hung initial resolution releases startup and a Page on the user home at five seconds, then publishes its late result", async () => {
  const { root, firm } = await rootsFixture();
  await mkdir(join(root, "Pages", "fallback"), { recursive: true });
  await writeFile(join(root, "Pages", "fallback", "index.html"), "<title>User fallback</title>");
  const release = Promise.withResolvers<Map<string, paths.Home[]>>();
  vi.spyOn(paths, "resolveHomes").mockReturnValue(release.promise);
  vi.useFakeTimers();
  const owner = acquireContentRoots();
  let ready = false;
  void owner.ready.then(() => { ready = true; });
  const startup = serveRoutes(pagesRoute().pipe(Layer.provide(ActionJournalService.live(null))), detachedBridge());
  try {
    await vi.advanceTimersByTimeAsync(contentRootsResolveTimeoutMs);
    expect(ready).toBe(true);
    const server = await startup;
    try {
      expect((await (await fetch(`${server.base}/pages`)).json()).pages).toContainEqual(expect.objectContaining({ slug: "fallback" }));
    } finally { await server.close(); }
    expect(notices(hostState()).some(notice => notice.reason.includes(firm) && notice.reason.includes("unavailable"))).toBe(true);
    release.resolve(snapshot(root, firm));
    await vi.waitFor(() => expect(productPodsRoots()).toContain(join(firm, "Pods")));
  } finally { release.resolve(snapshot(root)); await startup.then(server => server.close()); owner.close(); }
});

test("a cold project binding also releases its request within the roots budget", async () => {
  const { root, firm } = await rootsFixture();
  vi.spyOn(paths, "resolveHomes").mockResolvedValue(snapshot(root, firm));
  const release = Promise.withResolvers<string | null>();
  vi.spyOn(paths, "resolveProjectHome").mockReturnValue(release.promise);
  vi.useFakeTimers();
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    let answered = false;
    const read = contentRootsReady("Projects/slow").then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(contentRootsResolveTimeoutMs);
    expect(answered).toBe(true);
    expect(contentHomes("Projects/slow")).toEqual(snapshot(root, firm).get(""));
    release.resolve(null); await read;
  } finally { release.resolve(null); owner.close(); }
});

test.each(["initial", "refresh"])("a failed %s resolve keeps the good roots and a later success heals it", async stage => {
  const { root, firm } = await rootsFixture();
  const good = snapshot(root, firm), recovered = snapshot(root, join(root, "recovered"));
  const resolve = vi.spyOn(paths, "resolveHomes");
  if (stage === "initial") resolve.mockRejectedValueOnce(Error("firm drive unavailable"));
  else resolve.mockResolvedValueOnce(good).mockRejectedValueOnce(Error("firm drive unavailable"));
  resolve.mockResolvedValue(recovered);
  vi.useFakeTimers();
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    if (stage === "refresh") {
      await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
      expect(contentHomes()).toEqual(good.get(""));
    }
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs);
    await contentRootsReady();
    expect(contentHomes()).toEqual(recovered.get(""));
  } finally { owner.close(); }
});

test("a timed-out refresh is retired for one working replacement and cannot later overwrite it", async () => {
  const { root, firm } = await rootsFixture();
  const hung = Promise.withResolvers<Map<string, paths.Home[]>>();
  const recovered = snapshot(root, join(root, "recovered"));
  const resolve = vi.spyOn(paths, "resolveHomes").mockResolvedValueOnce(snapshot(root, firm))
    .mockReturnValueOnce(hung.promise).mockResolvedValue(recovered);
  vi.useFakeTimers();
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs + contentRootsResolveTimeoutMs);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs - contentRootsResolveTimeoutMs);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(resolve.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(contentHomes()).toEqual(recovered.get(""));
    hung.resolve(snapshot(root, firm));
    await vi.advanceTimersByTimeAsync(0);
    expect(contentHomes()).toEqual(recovered.get(""));
  } finally { hung.resolve(snapshot(root)); owner.close(); }
});

test("a known firm refresh checks its folder without reading markers or listing directories", async () => {
  const { root, firm } = await rootsFixture();
  await mkdir(firm);
  await writeFile(join(firm, "pe-home.json"), '{"tier":"firm"}');
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  const access = vi.spyOn(asyncFilesystem, "access"), list = vi.spyOn(asyncFilesystem, "readdir");
  const read = vi.spyOn(asyncFilesystem, "readFile");
  expect((await paths.resolveHomes([])).get("")).toEqual(snapshot(root, firm).get(""));
  expect(access).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(read.mock.calls.filter(([path]) => String(path) === join(firm, "pe-home.json"))).toHaveLength(0);
});

test("Page, lifecycle and omitted-roots requests use one async snapshot and never call the sync resolver", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-async-homes-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", join(root, "not-mounted"));
  const resolve = vi.spyOn(paths, "resolveHomes");
  const owner = acquireContentRoots();
  await owner.ready;
  const lifecycle = createPackageLifecycle();
  const server = await serveRoutes(pagesRoute().pipe(Layer.provide(ActionJournalService.live(null))), detachedBridge());
  try {
    await lifecycle.ready;
    const sync = [vi.spyOn(paths, "homeDirs"), vi.spyOn(paths, "homes"), vi.spyOn(paths, "firmHome"),
      vi.spyOn(filesystem, "readFileSync"), vi.spyOn(filesystem, "existsSync"), vi.spyOn(filesystem, "readdirSync")];
    await listPackages();
    await lifecycle.refresh();
    expect((await fetch(`${server.base}/pages`)).status).toBe(200);
    for (const call of sync) expect(call).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
  } finally { await server.close(); await lifecycle.close(); owner.close(); }
});

test("one 30 second background resolution picks up a late firm home for both Pods and Pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-mount-homes-"));
  const firm = join(root, "firm");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const resolve = vi.spyOn(paths, "resolveHomes");
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    expect(productPodsRoots()).toEqual([join(root, "Pods")]);
    await mkdir(firm);
    await writeFile(join(firm, "pe-home.json"), '{"tier":"firm"}');
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs - 1);
    expect(productPagesRoots()).toEqual([join(root, "Pages")]);
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(productPodsRoots()).toContain(join(firm, "Pods")));
    expect(productPagesRoots()).toContain(join(firm, "Pages"));
    expect(resolve).toHaveBeenCalledTimes(2);
  } finally { owner.close(); }
});
