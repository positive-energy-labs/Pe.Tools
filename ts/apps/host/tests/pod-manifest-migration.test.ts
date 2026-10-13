import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { listPackages } from "../src/packages.ts";
import { migratePodManifests } from "../src/pod-manifest-migration.ts";

let home: string;
let pods: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pe-manifest-migration-"));
  pods = join(home, "Pods");
  await mkdir(join(pods, "renamed", "src"), { recursive: true });
  await writeFile(join(pods, "renamed", "src", "Run.cs"), "class Run {}");
});
afterEach(() => rm(home, { recursive: true, force: true }));

test("explicit startup migration backs up exact bytes, preserves fields, and is idempotent", async () => {
  const manifest = join(pods, "renamed", "pod.json");
  const old = Buffer.from(
    '\uFEFF{\r\n  "id": "legacy", "custom": 7, "entrypoints": [{"id": "run", "sourcePath": "src/Run.cs", "name": "Run"}]\r\n}\r\n',
  );
  await writeFile(manifest, old);
  expect((await listPackages(pods)).packages[0]!.diagnostics).toContainEqual(
    expect.objectContaining({ code: "InvalidEntrypoint" }),
  );
  expect(await readFile(manifest)).toEqual(old);
  const changes = await migratePodManifests(pods);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ id: "legacy", manifestPath: manifest, removed: 1 });
  expect(changes[0]!.backupPath).toContain(join(home, ".backups", "pods", "legacy-"));
  expect(await readFile(changes[0]!.backupPath)).toEqual(old);
  expect(JSON.parse(await readFile(manifest, "utf8"))).toEqual({
    id: "legacy",
    custom: 7,
    entrypoints: [{ sourcePath: "src/Run.cs", name: "Run" }],
  });
  expect((await listPackages(pods)).packages[0]!.diagnostics).toEqual([]);
  const after = await readFile(manifest);
  expect(await migratePodManifests(pods)).toEqual([]);
  expect(await readFile(manifest)).toEqual(after);
  expect(await readdir(join(home, ".backups", "pods"))).toHaveLength(1);
});

test("id without sourcePath and other unknown fields remain strict reader diagnostics", async () => {
  const manifest = join(pods, "renamed", "pod.json");
  const value = {
    id: "legacy",
    entrypoints: [
      { id: "missing" },
      { id: "run", sourcePath: "src/Run.cs", permissionMode: "ReadOnly" },
    ],
  };
  await writeFile(manifest, JSON.stringify(value));
  await migratePodManifests(pods);
  expect(JSON.parse(await readFile(manifest, "utf8"))).toEqual({
    ...value,
    entrypoints: [{ id: "missing" }, { sourcePath: "src/Run.cs", permissionMode: "ReadOnly" }],
  });
  expect(
    (await listPackages(pods)).packages[0]!.diagnostics.filter(
      (d) => d.code === "InvalidEntrypoint",
    ),
  ).toHaveLength(2);
});

test("a failed backup cannot change the manifest, and directory links are never migrated", async () => {
  const manifest = join(pods, "renamed", "pod.json");
  const old = '{"id":"legacy","entrypoints":[{"id":"run","sourcePath":"src/Run.cs"}]}';
  await writeFile(manifest, old);
  await writeFile(join(home, ".backups"), "occupied");
  await expect(migratePodManifests(pods)).rejects.toThrow();
  expect(await readFile(manifest, "utf8")).toBe(old);
  await rm(join(home, ".backups"));
  const outside = join(home, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "pod.json"), old);
  await symlink(outside, join(pods, "linked"), "junction");
  await migratePodManifests(pods);
  expect(await readFile(join(outside, "pod.json"), "utf8")).toBe(old);
});

test("malformed manifests stay untouched and a linked backup root cannot receive writes", async () => {
  const manifest = join(pods, "renamed", "pod.json");
  await writeFile(manifest, "{bad json");
  expect(await migratePodManifests(pods)).toEqual([]);
  expect(await readFile(manifest, "utf8")).toBe("{bad json");
  const old = '{"id":"legacy","entrypoints":[{"id":"run","sourcePath":"src/Run.cs"}]}';
  await writeFile(manifest, old);
  const outside = join(home, "outside");
  await mkdir(outside);
  await symlink(outside, join(home, ".backups"), "junction");
  await expect(migratePodManifests(pods)).rejects.toThrow(/cannot be a link/);
  expect(await readFile(manifest, "utf8")).toBe(old);
  expect(await readdir(outside)).toEqual([]);
});
