import { pictureCaptures } from "./effect-test.ts";
/**
 * First-run import of shipped pods: ordinary import, once per archive, never over a user's pod.
 * The shipped archive is written by the production exporter, never a fixture zip writer.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readStoredNotices } from "@pe/host-contracts/store";
import { PictureCaptures } from "../src/captures-route.ts";
import { storedNoticesPath } from "../src/notice-feed.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { exportPod, importRecordPath } from "../src/pod-transfer.ts";
import * as settings from "../src/settings.ts";
import { productPodsRootPath } from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";

let root: string;
let shipped: string;
let pods: string;
let ledger: string;
let captures: PictureCaptures;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-installed-pods-"));
  shipped = join(root, "app", "pods");
  pods = join(root, "Documents", "Pods");
  ledger = join(root, "state", "shipped-pods.json");
  captures = pictureCaptures(join(root, "captures"));
  const source = join(root, "examples");
  await mkdir(join(source, "example", "pages", "tour"), { recursive: true });
  await writeFile(
    join(source, "example", "pod.json"),
    JSON.stringify({
      schemaVersion: 2,
      id: "example",
      name: "Example",
      version: "1.0.0",
      entrypoints: [],
    }),
  );
  await writeFile(join(source, "example", "pages", "tour", "index.html"), "<title>Tour</title>");
  await exportPod(
    { pod: "example", archivePath: join(shipped, "example.zip") },
    { podsRoot: source, captures },
  );
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); return rm(root, { recursive: true, force: true }); });

const boot = () => importShippedPods({ shippedRoot: shipped, ledger, podsRoot: pods, captures });

test("host-start examples use the override home and the write door, never the Documents home", async () => {
  const override = join(root, "override");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", override);
  const writes = vi.spyOn(settings, "writeHome");
  // Observe resolution before any import: a real-home mutant fails without touching personal files.
  expect(productPodsRootPath()).toBe(join(override, "Pods"));
  const report = await importShippedPods({ shippedRoot: shipped, ledger, captures });
  expect(report.outcomes).toMatchObject([{ outcome: "imported" }]);
  expect(await readFile(join(override, "Pods", "example", "pod.json"), "utf8")).toContain('"example"');
  expect(writes.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(writes.mock.calls.every(([path]) => path.startsWith(override + "/") || path.startsWith(override + "\\"))).toBe(true);
});

test("host-start missing example source posts one notice and never throws", async () => {
  const missing = join(root, "missing-examples");
  const start = () => importShippedPods({ shippedRoot: missing, ledger, podsRoot: pods, captures });
  await expect(start()).resolves.toMatchObject({ outcomes: [] });
  await start();
  expect(readStoredNotices(storedNoticesPath()).filter(n => n.path === missing))
    .toMatchObject([{ class: "keep", place: "Shipped examples" }]);
  expect(readStoredNotices(storedNoticesPath()).filter(n => n.path === missing)).toHaveLength(1);
});

test("a dev host with a missing checkout example directory still starts with one notice", async () => {
  const sourceRoot = hostOwnership.sourceRoot;
  const missingCheckout = join(root, "missing-checkout");
  Object.defineProperty(hostOwnership, "sourceRoot", { value: missingCheckout });
  try {
    const start = () => importShippedPods({ ledger, podsRoot: pods, captures });
    await expect(start()).resolves.toMatchObject({ outcomes: [] });
    await start();
    expect(readStoredNotices(storedNoticesPath()).filter(n => n.path === join(missingCheckout, "examples", "pods")))
      .toHaveLength(1);
  } finally {
    Object.defineProperty(hostOwnership, "sourceRoot", { value: sourceRoot });
  }
});

test("a shipped update uses home CAS without moving the pod, and keeps a later user edit", async () => {
  await boot();
  const member = join(pods, "example", "pages", "tour", "index.html");
  const writes = vi.spyOn(settings, "writeHome");
  const update = async (html: string) => {
    await writeFile(join(root, "examples", "example", "pages", "tour", "index.html"), html);
    await rm(join(shipped, "example.zip"));
    await exportPod({ pod: "example", archivePath: join(shipped, "example.zip") },
      { podsRoot: join(root, "examples"), captures });
    return boot();
  };
  expect((await update("<title>Updated</title>")).outcomes).toMatchObject([{ outcome: "updated" }]);
  expect(await readFile(member, "utf8")).toBe("<title>Updated</title>");
  expect(writes.mock.calls.some(([path, , sha]) => path === member && sha !== null)).toBe(true);
  await writeFile(member, "<title>Mine</title>");
  expect((await update("<title>New version</title>")).outcomes).toMatchObject([{ outcome: "present" }]);
  expect(await readFile(member, "utf8")).toBe("<title>Mine</title>");
});

test("first boot imports the shipped pod; a restart offers nothing again, even after the user deletes it", async () => {
  const first = await boot();
  expect(first.outcomes.map((o) => o.outcome)).toEqual(["imported"]);
  expect((await listPackages(pods)).packages.map((p) => [p.id, p.folder])).toEqual([
    ["default", "default"],
    ["example", "example"],
  ]);
  // The import record is machine state beside the ledger this owner named, never in the pod, and it
  // names its archive by file name: no machine path is stored.
  await expect(readFile(join(pods, "example", "imported.json"))).rejects.toThrow();
  const record = await readFile(importRecordPath("example", { stateRoot: dirname(ledger) }), "utf8");
  expect(JSON.parse(record).archive).toBe("example.zip");
  expect(record).not.toContain(JSON.stringify(shipped).slice(1, -1));

  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["offered-before"]);
  await rm(join(pods, "example"), { recursive: true });
  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["offered-before"]);
  expect((await listPackages(pods)).packages.map((p) => p.id)).toEqual(["default"]);
});

test("a user's pod with the shipped id, or a folder with its name, is never overwritten", async () => {
  await mkdir(join(pods, "Mine"), { recursive: true });
  const mine = JSON.stringify({
    schemaVersion: 2,
    id: "example",
    name: "Edited",
    version: "9",
    entrypoints: [],
  });
  await writeFile(join(pods, "Mine", "pod.json"), mine);

  const report = await boot();

  expect(report.outcomes).toMatchObject([{ outcome: "present", id: "example" }]);
  expect(await readFile(join(pods, "Mine", "pod.json"), "utf8")).toBe(mine);

  await rm(join(pods, "Mine"), { recursive: true });
  await rm(ledger);
  await mkdir(join(pods, "example"), { recursive: true });
  await writeFile(join(pods, "example", "notes.txt"), "mine");
  expect((await boot()).outcomes).toMatchObject([{ outcome: "present", id: "example" }]);
  expect(await readFile(join(pods, "example", "notes.txt"), "utf8")).toBe("mine");
});

test("the real examples stage and first-boot import unchanged: same members, project bytes kept, four kinds of keys", async () => {
  const examples = join(import.meta.dirname, "..", "..", "..", "..", "examples", "pods");
  const source = (await listPackages(examples)).packages.find((p) => p.id === "snowdon-ducts")!;
  const staged = await exportPod(
    { pod: "snowdon-ducts", archivePath: join(shipped, "snowdon-ducts.zip") },
    { podsRoot: examples, captures },
  );
  expect(staged.transforms).toEqual([]);
  expect(staged.vendored).toEqual([]);
  expect(staged.captures).toEqual([]);

  const report = await boot();

  expect(report.outcomes.map((o) => o.outcome)).toEqual(["imported", "imported"]);
  const landed = (await listPackages(pods)).packages.find((p) => p.id === "snowdon-ducts")!;
  expect(landed.members.map((m) => [m.path, m.sha256])).toEqual(
    source.members.map((m) => [m.path, m.sha256]),
  );
  expect(new Set(landed.contributions.map((c) => c.kind))).toEqual(
    new Set(["script", "page", "skill", "member"]),
  );
});

test("a ledger that does not decode is discarded with one notice, and the shipped pod is offered again", async () => {
  const posted = () =>
    readStoredNotices(storedNoticesPath()).filter((notice) => notice.path === ledger);
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(ledger, "{ this is not JSON");

  // Before ADR 0039 the read's fallback covered a missing ledger only, and this boot threw.
  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["imported"]);
  expect(JSON.parse(await readFile(ledger, "utf8")).offered).toBeTypeOf("object");
  expect(posted()).toMatchObject([{ class: "discard", place: "Shipped Pods ledger" }]);

  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["offered-before"]);
  expect(posted()).toHaveLength(1);
});

test("the wait for the shipped-pod import is bounded: a run that never settles does not hang a reader", async () => {
  const { settledWithin } = await import("../src/installed-pods.ts");
  const started = Date.now();
  await settledWithin(new Promise(() => {}), 30);
  expect(Date.now() - started).toBeLessThan(2_000);
  // A failed run is over too, and no run is no wait.
  await settledWithin(Promise.reject(Error("refused")), 60_000);
  await settledWithin(undefined, 60_000);
});
