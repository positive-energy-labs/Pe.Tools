import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages, onePackage } from "../src/packages.ts";
import { packageDiscoveryTimeoutMs, stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateTree } from "@pe/host-contracts/service-identity";

vi.mock("node:fs/promises", async original => ({ ...(await original<typeof import("node:fs/promises")>()) }));
const roots: string[] = [];
afterEach(async () => {
  stopPackageDiscovery();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-home-isolation-"));
  roots.push(root);
  const homes: [string, string] = [join(root, "A", "Pods"), join(root, "B", "Pods")];
  for (const { home, id } of [{ home: homes[0], id: "healthy" }, { home: homes[1], id: "blocked" }]) {
    const folder = join(home, id, "pages", "hello");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(join(home, id, "pod.json"), JSON.stringify({ id }));
    await fs.writeFile(join(folder, "index.html"), `<title>${id}</title>`);
  }
  await listPackages({ podsRoots: homes });
  const pages = createPagesHandler([], homes, undefined, undefined, stateTree(root).directory("page-state"));
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = fs.readdir;
  vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === homes[1]) { entered.resolve(); await release.promise; }
    return original(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { homes, pages, entered, release };
}
async function withinBudget<T>(work: Promise<T>, entered: Promise<void>, release: () => void) {
  let result: { value: T } | { error: unknown } | undefined;
  const observed = work.then(value => { result = { value }; }, error => { result = { error }; });
  await entered;
  await vi.advanceTimersByTimeAsync(packageDiscoveryTimeoutMs);
  await new Promise(resolve => setImmediate(resolve));
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

test("rule 3: inventory publishes healthy homes and a reason for the hung home", async () => {
  const { homes, entered, release } = await fixture();
  const probe = await withinBudget(listPackages({ podsRoots: homes, wait: "background" }), entered.promise, () => release.resolve());
  try {
    expect(probe.result).toMatchObject({ value: { packages: expect.arrayContaining([
      expect.objectContaining({ id: "healthy" }),
      expect.objectContaining({ id: "blocked", discoveryFailure: expect.any(String) }),
    ]) } });
  } finally { await probe.close(); }
});
