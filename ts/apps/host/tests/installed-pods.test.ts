import { notices as storedNotices } from "@pe/host-contracts/kinds";
import { authoredFixture, ledgerFixture } from "./storage.ts";
import { stateMachine } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { pictureCaptures } from "./effect-test.ts";
/**
 * First-run import of shipped pods: ordinary import, once per archive, never over a user's pod.
 * The shipped archive is written by the production exporter, never a fixture zip writer.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PictureCaptures } from "../src/captures-route.ts";

import { importShippedPods } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { exportPod, importPod, importRecordFile, readZip, writeZip } from "../src/pod-transfer.ts";
import * as settings from "../src/settings.ts";
import * as store from "@pe/host-contracts/kinds";
import { productPodsRootPath } from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { shippedPodUpdateRefusals } from "../src/shipped-pod-status.ts";
import * as packages from "../src/packages.ts";

test("cancelled startup never creates a home after its held listing returns", async () => {
  const stop = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const list = packages.listPackages;
  vi.spyOn(packages, "listPackages").mockImplementationOnce(async (...args) => {
    entered.resolve(); await release.promise; return list(...args);
  });
  const pending = importShippedPods({ shippedRoot: shipped, ledger: ledgerFixture(ledger), podsRoot: pods, captures, signal: stop.signal });
  await entered.promise;
  stop.abort();
  release.resolve();
  await expect(pending).rejects.toThrow();
  expect(existsSync(pods)).toBe(false);
});

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

const boot = () => importShippedPods({ shippedRoot: shipped, ledger: ledgerFixture(ledger), podsRoot: pods, captures });

test("a torn import resumes missing members and publishes its manifest last", async () => {
  const directory = join(pods, "example");
  const member = join(directory, "pages", "tour", "index.html");
  await mkdir(dirname(member), { recursive: true });
  await writeFile(member, "<title>Tour</title>");
  const writes = vi.spyOn(store, "writeHome");
  await expect(importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures }))
    .resolves.toMatchObject({ id: "example" });
  expect(await readFile(join(directory, "pod.json"), "utf8")).toContain('"example"');
  expect(writes.mock.calls.map(([file]) => file.path)).toEqual([join(directory, "pod.json")]);
});

test.each(["different", "extra"])("a torn folder with a %s file refuses with its address and remedy", async (kind) => {
  const directory = join(pods, "example");
  const member = join(directory, kind === "extra" ? "notes.txt" : "pages/tour/index.html");
  await mkdir(dirname(member), { recursive: true });
  await writeFile(member, "mine");
  const result = importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures });
  await expect(result).rejects.toThrow(directory);
  await expect(result).rejects.toThrow(kind === "extra" ? "notes.txt" : "pages/tour/index.html");
  await expect(result).rejects.toThrow(/remove or rename/i);
  expect(await readFile(member, "utf8")).toBe("mine");
});

test("a shipped example resumes a torn folder on restart, even if previously recorded present", async () => {
  const entries = readZip(await readFile(join(shipped, "example.zip")));
  const member = join(pods, "example", "pages", "tour", "index.html");
  await mkdir(dirname(member), { recursive: true });
  await writeFile(member, entries.get("pages/tour/index.html")!);
  expect((await boot()).outcomes).toMatchObject([{ outcome: "imported" }]);
  await rm(join(pods, "example", "pod.json"));
  expect((await boot()).outcomes).toMatchObject([{ outcome: "imported" }]);
  expect(await readFile(join(pods, "example", "pod.json"), "utf8")).toContain('"example"');
});

test.each(["io", "cas"] as const)("import rolls back a second-member failure (%s) and a retry succeeds", async (mode) => {
  const write = store.writeHome;
  let count = 0;
  const spy = vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    if (++count === 2) {
      if (mode === "io") throw Error("injected second-member failure");
      return { ok: false, kind: "conflict", actualSha256: null };
    }
    return write(...args);
  });
  const start = () => importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures });
  await expect(start()).rejects.toThrow(mode === "io" ? "injected second-member failure" : "Pod member changed during import");
  expect(await readdir(pods)).toEqual([]);
  spy.mockRestore();
  await expect(start()).resolves.toMatchObject({ id: "example" });
});

test.each([true, false])("a throwing second write rolls back only matching bytes (%s)", async (matching) => {
  const write = store.writeHome;
  let count = 0;
  let torn = "";
  vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    if (++count !== 2) return write(...args);
    torn = args[0].path;
    write(...args);
    if (!matching) writeFileSync(torn, "concurrent edit");
    throw Error("injected torn write");
  });
  const result = importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures });
  await expect(result).rejects.toThrow("injected torn write");
  if (matching) {
    await expect(readFile(torn)).rejects.toThrow(/ENOENT/);
    expect(await readdir(pods)).toEqual([]);
  } else {
    await expect(result).rejects.toThrow(torn);
    expect(await readFile(torn, "utf8")).toBe("concurrent edit");
  }
});

test("rollback names a directory kept because a concurrent writer added a file", async () => {
  const write = store.writeHome;
  let count = 0;
  let directory = "";
  vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    if (++count === 2) {
      directory = dirname(args[0].path);
      writeFileSync(join(directory, "later.txt"), "mine");
      throw Error("injected write failure");
    }
    return write(...args);
  });
  const result = importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures });
  await expect(result).rejects.toThrow("ENOTEMPTY");
  await expect(result).rejects.toThrow(directory);
  expect(await readFile(join(directory, "later.txt"), "utf8")).toBe("mine");
});

test("a shipped update dropping a member posts one stored keep notice across restarts", async () => {
  await boot();
  const directory = join(pods, "example");
  const original = (await listPackages(pods)).packages.find(p => p.id === "example")!;
  const before = await readFile(join(directory, "pages", "tour", "index.html"));
  const manifest = join(root, "examples", "example", "pod.json");
  await writeFile(manifest, (await readFile(manifest, "utf8")).replace("1.0.0", "2.0.0"));
  await rm(join(root, "examples", "example", "pages"), { recursive: true });
  await rm(join(shipped, "example.zip"));
  await exportPod({ pod: "example", archivePath: join(shipped, "example.zip") },
    { podsRoot: join(root, "examples"), captures });
  await boot();
  await boot();
  const notices = storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === directory);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ class: "keep", reason: expect.stringContaining("removes members") });
  expect(await readFile(join(directory, "pages", "tour", "index.html"))).toEqual(before);
  for (const member of original.members)
    expect(await readFile(join(directory, member.path))).toEqual(Buffer.from(member.bytes));
  expect((await listPackages(pods)).packages.find(p => p.id === "example")!.version).toBe("1.0.0");
});

test.each(["io", "cas"] as const)("update rolls back a second-member failure (%s) byte for byte and a retry succeeds", async (mode) => {
  await boot();
  const original = (await listPackages(pods)).packages.find(p => p.id === "example")!;
  await writeFile(join(root, "examples", "example", "pages", "tour", "index.html"), "<title>Updated</title>");
  await rm(join(shipped, "example.zip"));
  await exportPod({ pod: "example", archivePath: join(shipped, "example.zip") },
    { podsRoot: join(root, "examples"), captures });
  const write = store.writeHome;
  let count = 0;
  const spy = vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    if (++count === 2) {
      if (mode === "io") throw Error("injected second-member failure");
      return { ok: false, kind: "conflict", actualSha256: null };
    }
    return write(...args);
  });
  expect((await boot()).outcomes).toMatchObject([{ outcome: "present" }]);
  for (const member of original.members)
    expect(await readFile(join(original.directory, member.path))).toEqual(Buffer.from(member.bytes));
  spy.mockRestore();
  expect((await boot()).outcomes).toMatchObject([{ outcome: "updated" }]);
});

test.each(["import", "update"] as const)("%s rollback keeps and names a concurrent edit", async (mode) => {
  if (mode === "update") {
    await boot();
    await writeFile(join(root, "examples", "example", "pages", "tour", "index.html"), "<title>Updated</title>");
    await rm(join(shipped, "example.zip"));
    await exportPod({ pod: "example", archivePath: join(shipped, "example.zip") },
      { podsRoot: join(root, "examples"), captures });
  }
  const write = store.writeHome;
  let count = 0;
  let first = "";
  vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    if (++count === 1) first = args[0].path;
    if (count === 2) {
      writeFileSync(first, "concurrent edit");
      throw Error("injected second-member failure");
    }
    return write(...args);
  });
  if (mode === "import") {
    const result = importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures });
    await expect(result).rejects.toThrow("rollback kept:");
    await expect(result).rejects.toThrow(first);
  } else {
    await boot();
    expect(shippedPodUpdateRefusals.get("example")).toContain(first);
  }
  expect(await readFile(first, "utf8")).toBe("concurrent edit");
});

test("host-start examples use the override home and the write door, never the Documents home", async () => {
  const override = join(root, "override");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", override);
  const writes = vi.spyOn(store, "writeHome");
  // Observe resolution before any import: a real-home mutant fails without touching personal files.
  expect(productPodsRootPath()).toBe(join(override, "Pods"));
  const report = await importShippedPods({ shippedRoot: shipped, ledger: ledgerFixture(ledger), captures });
  expect(report.outcomes).toMatchObject([{ outcome: "imported" }]);
  expect(await readFile(join(override, "Pods", "example", "pod.json"), "utf8")).toContain('"example"');
  expect(writes.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(writes.mock.calls.every(([file]) => file.path.startsWith(override + "/") || file.path.startsWith(override + "\\"))).toBe(true);
});

test("host-start missing example source posts one notice and never throws", async () => {
  const missing = join(root, "missing-examples");
  const start = () => importShippedPods({ shippedRoot: missing, ledger: ledgerFixture(ledger), podsRoot: pods, captures });
  await expect(start()).resolves.toMatchObject({ outcomes: [] });
  await start();
  expect(storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === missing))
    .toMatchObject([{ class: "keep", place: "Shipped examples" }]);
  expect(storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === missing)).toHaveLength(1);
});

test("a dev host with a missing checkout example directory still starts with one notice", async () => {
  const sourceRoot = hostOwnership.sourceRoot;
  const missingCheckout = join(root, "missing-checkout");
  Object.defineProperty(hostOwnership, "sourceRoot", { value: missingCheckout });
  try {
    const start = () => importShippedPods({ ledger: ledgerFixture(ledger), podsRoot: pods, captures });
    await expect(start()).resolves.toMatchObject({ outcomes: [] });
    await start();
    expect(storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === join(missingCheckout, "examples", "pods")))
      .toHaveLength(1);
  } finally {
    Object.defineProperty(hostOwnership, "sourceRoot", { value: sourceRoot });
  }
});

test("a shipped update uses home CAS without moving the pod, and keeps a later user edit", async () => {
  await boot();
  const member = join(pods, "example", "pages", "tour", "index.html");
  const writes = vi.spyOn(store, "writeHome");
  const update = async (html: string) => {
    await writeFile(join(root, "examples", "example", "pages", "tour", "index.html"), html);
    await rm(join(shipped, "example.zip"));
    await exportPod({ pod: "example", archivePath: join(shipped, "example.zip") },
      { podsRoot: join(root, "examples"), captures });
    return boot();
  };
  expect((await update("<title>Updated</title>")).outcomes).toMatchObject([{ outcome: "updated" }]);
  expect(await readFile(member, "utf8")).toBe("<title>Updated</title>");
  expect(writes.mock.calls.some(([file, , sha]) => file.path === member && sha !== null)).toBe(true);
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
  const record = await readFile(importRecordFile("example", { machine: stateMachine(dirname(ledger)) }).path, "utf8");
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
    storedNotices(ledgerFixture(ledger).machine).filter((notice) => notice.path === ledger);
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

test("rollback undoes repeated writes to one member newest first", async () => {
  const path = join(root, "member.txt");
  await writeFile(path, "original");
  const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
  expect(store.writeHome(authoredFixture(path), "first", hash("original")).ok).toBe(true);
  expect(store.writeHome(authoredFixture(path), "second", hash("first")).ok).toBe(true);
  expect(settings.rollbackHomeMembers([
    { file: authoredFixture(path), sha256: hash("first"), prior: Buffer.from("original") },
    { file: authoredFixture(path), sha256: hash("second"), prior: Buffer.from("first") },
  ])).toEqual([]);
  expect(await readFile(path, "utf8")).toBe("original");
});

test("a failed last non-manifest write never exposes a manifest during import", async () => {
  const entries = readZip(await readFile(join(shipped, "example.zip")));
  // The ZIP writer sorts pod.json before z-last.txt; publication must move the manifest last.
  const ordered = new Map([["pod.json", entries.get("pod.json")!] as const,
    ...[...entries].filter(([path]) => path !== "pod.json"),
    ["z-last.txt", Buffer.from("last")] as const]);
  await writeFile(join(shipped, "example.zip"), writeZip(ordered));
  const directory = join(pods, "example");
  const manifest = join(directory, "pod.json");
  const write = store.writeHome;
  const observations: boolean[] = [];
  const spy = vi.spyOn(store, "writeHome").mockImplementation((...args) => {
    observations.push(existsSync(manifest));
    if (args[0].path === join(directory, "z-last.txt")) throw Error("last member failed");
    const result = write(...args);
    observations.push(existsSync(manifest));
    return result;
  });
  await expect(importPod({ archivePath: join(shipped, "example.zip") }, { podsRoot: pods, captures }))
    .rejects.toThrow("last member failed");
  expect(spy.mock.calls.map(([file]) => file.path)).toEqual([
    join(directory, "pages", "tour", "index.html"), join(directory, "z-last.txt"),
  ]);
  expect(observations.every(present => !present)).toBe(true);
  expect(existsSync(manifest)).toBe(false);
});

test("the shipped census resumes a manifest-free folder recorded present by an old host", async () => {
  const bytes = await readFile(join(shipped, "example.zip"));
  const hash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(dirname(ledger), { recursive: true });
  await writeFile(ledger, JSON.stringify({ offered: {
    [hash]: { archive: "example.zip", at: new Date().toISOString(), outcome: "present" },
  } }));
  const member = join(pods, "example", "pages", "tour", "index.html");
  await mkdir(dirname(member), { recursive: true });
  await writeFile(member, readZip(bytes).get("pages/tour/index.html")!);
  expect((await listPackages(pods)).packages.some(p => p.id === "example")).toBe(false);
  expect((await boot()).outcomes).toMatchObject([{ outcome: "imported", id: "example" }]);
  expect((await listPackages(pods)).packages.some(p => p.id === "example")).toBe(true);
});

test("an unrelated manifest-free example folder is kept with one notice across censuses", async () => {
  const directory = join(pods, "example");
  const member = join(directory, "notes.txt");
  await mkdir(directory, { recursive: true });
  await writeFile(member, "mine");
  await boot();
  await boot();
  expect(await readdir(directory)).toEqual(["notes.txt"]);
  expect(await readFile(member, "utf8")).toBe("mine");
  expect(storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === directory))
    .toMatchObject([{ class: "keep", reason: expect.stringContaining("notes.txt") }]);
  expect(storedNotices(ledgerFixture(ledger).machine).filter(n => n.path === directory)).toHaveLength(1);
});
