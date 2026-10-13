/**
 * First-run import of shipped pods: ordinary import, once per archive, never over a user's pod.
 * The shipped archive is written by the production exporter, never a fixture zip writer.
 */
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureStore } from "../src/captures-route.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { exportPod } from "../src/pod-transfer.ts";

let root: string;
let shipped: string;
let pods: string;
let ledger: string;
let captures: CaptureStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-installed-pods-"));
  shipped = join(root, "app", "pods");
  pods = join(root, "Documents", "Pods");
  ledger = join(root, "state", "shipped-pods.json");
  captures = new CaptureStore(join(root, "captures"));
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
afterEach(() => rm(root, { recursive: true, force: true }));

const boot = () => importShippedPods({ shippedRoot: shipped, ledger, podsRoot: pods, captures });

test("first boot imports the shipped pod; a restart offers nothing again, even after the user deletes it", async () => {
  const first = await boot();
  expect(first.outcomes.map((o) => o.outcome)).toEqual(["imported"]);
  expect((await listPackages(pods)).packages.map((p) => [p.id, p.folder])).toEqual([
    ["example", "example"],
  ]);
  expect(JSON.parse(await readFile(join(pods, "example", "imported.json"), "utf8")).locator).toBe(
    join(shipped, "example.zip"),
  );

  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["offered-before"]);
  await rm(join(pods, "example"), { recursive: true });
  expect((await boot()).outcomes.map((o) => o.outcome)).toEqual(["offered-before"]);
  expect((await listPackages(pods)).packages).toEqual([]);
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

test("a source-lane host ships nothing and writes no ledger", async () => {
  const report = await importShippedPods({ shippedRoot: null, ledger, podsRoot: pods, captures });
  expect(report).toEqual({ shippedRoot: null, outcomes: [] });
  await expect(readFile(ledger)).rejects.toThrow();
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
