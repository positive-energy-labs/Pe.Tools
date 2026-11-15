import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages, onePackage } from "../src/packages.ts";
import { packageDiscoveryTimeoutMs, stopPackageDiscovery } from "../src/pod-capture.ts";
import { requireIndexedPackageAvailable, rememberPackageCensus } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateTree } from "@pe/host-contracts/service-identity";
import { setTimeout as realSetTimeout } from "node:timers";

vi.mock("node:fs/promises", async original => ({ ...(await original<typeof import("node:fs/promises")>()) }));
const roots: string[] = [];
afterEach(async () => {
  stopPackageDiscovery();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(phase: "metadata" | "lstat" | "capture" = "metadata") {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-home-isolation-"));
  roots.push(root);
  const homes: [string, string] = [join(root, "A", "Pods"), join(root, "B", "Pods")];
  for (const { home, id } of [{ home: homes[0], id: "healthy" }, { home: homes[1], id: "blocked" }]) {
    const folder = join(home, id, "pages", "hello");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(join(home, id, "pod.json"), JSON.stringify({ id }));
    await fs.writeFile(join(folder, "index.html"), `<title>${id}</title>`);
  }
  const admission = await listPackages({ podsRoots: homes });
  if (phase === "capture") await fs.writeFile(join(homes[1], "blocked", "pages", "hello", "index.html"), "capture changed B");
  const pages = createPagesHandler([], homes, undefined, undefined, stateTree(root).directory("page-state"));
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = fs.readdir;
  vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
    const typed = !!(args[1] && typeof args[1] === "object" && args[1].withFileTypes);
    if (String(args[0]) === homes[1] && ((phase === "capture" && typed) || (phase === "metadata" && !typed))) {
      entered.resolve(); await release.promise;
    }
    return original(...args);
  });
  if (phase === "lstat") {
    const originalStat = fs.lstat;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      if (String(args[0]) === homes[1]) { entered.resolve(); await release.promise; }
      return originalStat(...args);
    });
  }
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { root, homes, pages, entered, release, admission };
}
async function withinBudget<T>(work: Promise<T>, entered: Promise<void>, release: () => void) {
  let result: { value: T } | { error: unknown } | undefined;
  const observed = work.then(value => { result = { value }; }, error => { result = { error }; });
  await entered;
  // Let native filesystem promises drain before advancing virtual deadline time.
  await new Promise(resolve => realSetTimeout(resolve, 50));
  await vi.advanceTimersByTimeAsync(packageDiscoveryTimeoutMs);
  await new Promise(resolve => realSetTimeout(resolve, 50));
  return { result, close: async () => {
    stopPackageDiscovery();
    release();
    await observed;
  } };
}

test.each(["Page", "capture"])("rule 1: healthy %s answers while another home's root listing never resolves", async door => {
  const { homes, pages, entered, release } = await fixture();
  const work = door === "Page"
    ? pages(new Request("http://host/pages/healthy--hello/")).then(async response => ({ status: response.status, body: await response.text() }))
    : capturePackage("healthy", homes).then(pod => ({ status: 200, body: pod.id }));
  const probe = await withinBudget(work, entered.promise, () => release.resolve());
  try { expect(probe.result).toMatchObject({ value: { status: 200 } }); }
  finally { await probe.close(); }
});

test("rule 2: a named census marks its own hung home unavailable within the budget, including background readers", async () => {
  const { homes, entered, release } = await fixture();
  const work = listPackages({ podsRoots: homes, packageId: "blocked", wait: "background" })
    .then(listing => onePackage(listing, "blocked"));
  const probe = await withinBudget(work, entered.promise, () => release.resolve());
  try { expect(probe.result).toMatchObject({ error: { code: "pod.discovery.exceeded" } }); }
  finally { await probe.close(); }
});

test("rule 2 control: the existing outer Page deadline already returns the typed refusal", async () => {
  const { pages, entered, release } = await fixture();
  const work = pages(new Request("http://host/pages/blocked--hello/"))
    .then(async response => ({ status: response.status, body: await response.json() }));
  const probe = await withinBudget(work, entered.promise, () => release.resolve());
  try { expect(probe.result).toMatchObject({ value: { status: 503, body: { code: "pod.discovery.exceeded" } } }); }
  finally { await probe.close(); }
});

test.each(["metadata", "lstat", "capture"] as const)("rule 3: inventory publishes healthy homes and a reason for hung %s", async phase => {
  const { homes, entered, release } = await fixture(phase);
  const probe = await withinBudget(listPackages({ podsRoots: homes, wait: "background" }), entered.promise, () => release.resolve());
  try {
    expect(probe.result).toMatchObject({ value: { packages: expect.arrayContaining([
      expect.objectContaining({ id: "healthy" }),
      expect.objectContaining({ id: "blocked", discoveryFailure: expect.any(String) }),
    ]) } });
  } finally { await probe.close(); }
});

test("overlapping views recover B against current A, without recapturing or rolling back A", async () => {
  const { root, homes, release } = await fixture();
  vi.useRealTimers();
  const third = join(root, "C", "Pods");
  await fs.mkdir(third, { recursive: true });
  const overlap = [...homes, third];
  try {
    const [ab, abc] = await Promise.all([listPackages({ podsRoots: homes }), listPackages({ podsRoots: overlap })]);
    for (const listing of [ab, abc]) {
      expect(onePackage(listing, "healthy").id).toBe("healthy");
      expect(() => onePackage(listing, "blocked")).toThrow(/Home work exceeded/);
    }
    const entry = join(homes[0], "healthy", "pages", "hello", "index.html");
    await fs.writeFile(entry, "<title>new A while B is hung</title>");
    const fresh = await listPackages({ podsRoots: homes, packageId: "healthy" });
    expect(Buffer.from(onePackage(fresh, "healthy").members.find(member => member.path.endsWith("index.html"))!.bytes).toString())
      .toContain("new A");
    release.resolve();
    await vi.waitFor(() => {
      expect(() => requireIndexedPackageAvailable("blocked", homes)).not.toThrow();
      expect(() => requireIndexedPackageAvailable("blocked", overlap)).not.toThrow();
    });
    const opened = vi.spyOn(fs, "open");
    for (const roots of [homes, overlap]) {
      const captured = await capturePackage("healthy", roots);
      expect(Buffer.from(captured.members.find(member => member.path.endsWith("index.html"))!.bytes).toString()).toContain("new A");
    }
    expect(opened.mock.calls.map(([path]) => String(path))).not.toContain(entry);
  } finally { stopPackageDiscovery(); release.resolve(); }
}, 20_000);

test("shutdown prevents a late root from recreating a derived view", async () => {
  const { homes, entered, release } = await fixture();
  const work = listPackages({ podsRoots: homes, wait: "background" });
  const probe = await withinBudget(work, entered.promise, () => release.resolve());
  await probe.close();
  await new Promise(resolve => realSetTimeout(resolve, 30));
  await expect(capturePackage("blocked", homes)).rejects.toThrow("before Pod discovery finishes");
});

test("a derived identity view cannot authorize bytes from a different home generation", async () => {
  const { homes, admission } = await fixture();
  rememberPackageCensus("stale-view", admission);
  await fs.writeFile(join(homes[0], "healthy", "pages", "hello", "index.html"), "new generation");
  await listPackages({ podsRoots: homes[0], packageId: "healthy" });
  expect(() => requireIndexedPackageAvailable("healthy", "stale-view")).toThrow(/Home generation changed/);
});
