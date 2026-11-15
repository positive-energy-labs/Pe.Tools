// Kept reproducers from REVIEW-63beb79e-ev/review63.test.ts, with the owner's rulings.
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as realSetTimeout } from "node:timers";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages, onePackage } from "../src/packages.ts";
import { captureIndexedPackage, packageDiscoveryTimeoutMs, stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateTree } from "@pe/host-contracts/service-identity";

vi.mock("node:fs/promises", async original => ({ ...(await original<typeof import("node:fs/promises")>()) }));
const cleanup: string[] = [];
afterEach(async () => {
  stopPackageDiscovery(); vi.restoreAllMocks(); vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-home-review-")); cleanup.push(root);
  const homes: [string, string] = [join(root, "A", "Pods"), join(root, "B", "Pods")];
  for (const [home, id] of [[homes[0], "healthy"], [homes[1], "blocked"]] as const) {
    await fs.mkdir(join(home, id, "pages", "hello"), { recursive: true });
    await fs.writeFile(join(home, id, "pod.json"), JSON.stringify({ id }));
    await fs.writeFile(join(home, id, "pages", "hello", "index.html"), `<title>${id}</title>`);
  }
  await listPackages({ podsRoots: homes });
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const original = fs.readdir;
  vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === homes[1] && !args[1]) { entered.resolve(); await release.promise; }
    return original(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { root, homes, release, entered };
}

test.each(["Page", "capture"])("review: owner rule healthy admitted A's %s never waits for B's deadline", async door => {
  const { root, homes, entered, release } = await fixture();
  const pages = createPagesHandler([], homes, undefined, undefined, stateTree(root).directory("page-state"));
  let answered = false;
  const work = (door === "Page" ? pages(new Request("http://host/pages/healthy--hello/"))
    .then(response => expect(response.status).toBe(200)) : capturePackage("healthy", homes)
    .then(pod => expect(pod.id).toBe("healthy"))).then(() => { answered = true; });
  await entered.promise;
  await new Promise(resolve => realSetTimeout(resolve, 100));
  await vi.advanceTimersByTimeAsync(1_000);
  try { expect(answered).toBe(true); }
  finally { release.resolve(); await work; }
});

test("review: a twin in hung B is known only when B publishes its recovered identity census", async () => {
  const { homes, entered, release } = await fixture();
  await fs.writeFile(join(homes[1], "blocked", "pod.json"), '{"id":"healthy"}');
  const first = capturePackage("healthy", homes);
  await entered.promise;
  await new Promise(resolve => realSetTimeout(resolve, 50));
  await vi.advanceTimersByTimeAsync(packageDiscoveryTimeoutMs);
  try {
    expect((await first).id).toBe("healthy");
    release.resolve(); vi.useRealTimers();
    await listPackages({ podsRoots: homes, wait: "background" });
    await expect(capturePackage("healthy", homes)).rejects.toThrow(/claimed/);
  } finally { stopPackageDiscovery(); release.resolve(); }
});

test("review: a byte return rejects an A generation superseded after that request's A work completed", async () => {
  const { homes, release } = await fixture(); vi.useRealTimers();
  const selected = Promise.withResolvers<void>(), returnSnapshot = Promise.withResolvers<void>();
  const first = captureIndexedPackage("healthy", homes, async roots => {
    const snapshot = await listPackages({ podsRoots: roots, packageId: "healthy" });
    selected.resolve(); await returnSnapshot.promise; return snapshot;
  });
  const refused = expect(first).rejects.toMatchObject({ code: "pod.discovery.exceeded" });
  try {
    await selected.promise;
    await fs.writeFile(join(homes[0], "healthy", "pages", "hello", "index.html"), "new A generation");
    await listPackages({ podsRoots: homes[0], packageId: "healthy" });
    returnSnapshot.resolve(); await refused;
  } finally { stopPackageDiscovery(); release.resolve(); returnSnapshot.resolve(); }
});

test.each([
  { door: "selection", cold: true }, { door: "Page", cold: true },
  { door: "selection", cold: false }, { door: "Page", cold: false },
])("review: a hung home's unknown identity refuses through $door, cold=$cold", async ({ door, cold }) => {
  const { root, homes, entered, release } = await fixture();
  if (cold) { stopPackageDiscovery(); await listPackages({ podsRoots: homes[0] }); }
  else await fs.writeFile(join(homes[1], "blocked", "pod.json"), '{"id":"new"}');
  const id = cold ? "blocked" : "new";
  let result: unknown;
  let status: number | undefined;
  const pages = createPagesHandler([], homes, undefined, undefined, stateTree(root).directory("cold-page-state"));
  const work = (door === "Page" ? pages(new Request(`http://host/pages/${id}--hello/`))
    .then(async response => { status = response.status; result = await response.json(); })
    : listPackages({ podsRoots: homes, packageId: id, wait: "background" })
      .then(listing => onePackage(listing, id)).catch(error => { result = error; }));
  await entered.promise;
  await new Promise(resolve => realSetTimeout(resolve, 50));
  await vi.advanceTimersByTimeAsync(packageDiscoveryTimeoutMs);
  try {
    await work;
    if (door === "Page") expect(status).toBe(503);
    expect(result).toMatchObject({ code: "pod.discovery.exceeded", message: expect.stringContaining(homes[1]) });
  }
  finally { stopPackageDiscovery(); release.resolve(); }
});
