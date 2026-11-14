import { afterEach, expect, test, vi } from "vite-plus/test";
import * as fs from "node:fs/promises";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePackage, listPackages } from "../src/packages.ts";
import { exportPod, writeZip } from "../src/pod-transfer.ts";
import { importPod, prepareImport } from "./pod-import.ts";
import { freezeScript } from "../src/operation-script.ts";
import { scriptPodSourceBounds, scriptPodMemberBounds } from "@pe/host-contracts/generated";

const roots: string[] = [];
vi.mock("node:fs/promises", async (actual) => {
  const module = await actual<typeof import("node:fs/promises")>();
  return { ...module, readFile: vi.fn(module.readFile) };
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.readFile).mockImplementation((await vi.importActual<typeof fs>("node:fs/promises")).readFile);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("gateway prepare refuses an oversized archive before reading its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-archive-bound-"));
  roots.push(root);
  const archivePath = join(root, "oversized.zip");
  const file = await open(archivePath, "w");
  try { await file.truncate(scriptPodMemberBounds.maxTotalBytes * 2 + 1); }
  finally { await file.close(); }
  const read = (await vi.importActual<typeof fs>("node:fs/promises")).readFile;
  const reads = vi.mocked(fs.readFile).mockImplementation((...args: Parameters<typeof read>) => {
    if (args[0] === archivePath) throw Error("whole archive read before bound");
    return read(...args);
  });
  await expect(prepareImport({ archivePath })).rejects.toMatchObject({
    name: "TransferRefused", status: 422,
    message: `Pod archive exceeds ${scriptPodMemberBounds.maxTotalBytes * 2} bytes.`,
  });
  expect(reads.mock.calls.some(([path]) => path === archivePath)).toBe(false);
});

test.each(["missing", "directory"])("gateway prepare gives typed 404 for %s archive", async (kind) => {
  const root = await mkdtemp(join(tmpdir(), "pe-archive-absent-"));
  roots.push(root);
  const archivePath = join(root, "absent.zip");
  if (kind === "directory") await mkdir(archivePath);
  await expect(prepareImport({ archivePath })).rejects.toMatchObject({
    name: "TransferRefused", status: 404, message: `No pod archive at ${archivePath}.`,
  });
});

test.each(["../escape", "pages", "", 42, null])("gateway prepare refuses invalid manifest id %s", async (id) => {
  const root = await mkdtemp(join(tmpdir(), "pe-archive-id-"));
  roots.push(root);
  const archivePath = join(root, "invalid.zip");
  await writeFile(archivePath, writeZip(new Map([["pod.json", Buffer.from(JSON.stringify({ id }))]])));
  await expect(prepareImport({ archivePath })).rejects.toMatchObject({ name: "TransferRefused", status: 422 });
});

test("gateway prepare strips manifest BOM and captures archive bytes only in its commit payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-archive-bom-"));
  roots.push(root);
  const archivePath = join(root, "bom.zip");
  const bytes = writeZip(new Map([["pod.json", Buffer.from('\uFEFF{"id":"bom-pod"}')]]));
  await writeFile(archivePath, bytes);
  const { bound, archive } = await prepareImport({ archivePath });
  expect(bound.effects).toEqual([{ kind: "member", pod: "bom-pod", path: "pod.json" }]);
  expect(bound.consumes).toEqual([{ kind: "file", probe: { path: archivePath }, expected: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  await rm(archivePath);
  expect(Buffer.from(archive.bytesBase64, "base64")).toEqual(bytes);
});
const files = new Map([
  ["pod.json", Buffer.from('{"schemaVersion":2,"id":"portable-test","entrypoints":[]}')],
  ["src/Run.cs", Buffer.from("public static class Run { public static int Value => 42; }")],
  ["assets/image.bin", Buffer.alloc(614400)],
]);
test("source count excludes metadata and assets, but oversized CSharp still refuses", async () => {
  const sources = Array.from({ length: scriptPodSourceBounds.maxFileCount }, (_, i) => ({
    path: `src/F${i}.cs`,
    bytesBase64: "",
  }));
  const metadata = { path: "pod.json", bytesBase64: files.get("pod.json")!.toString("base64") };
  const freeze = (files: { path: string; bytesBase64: string }[]) =>
    freezeScript({ sourcePath: "src/F0.cs", sourceBundle: { files } });
  expect((await freeze([metadata, ...sources]))!.sourceBundle.files).toHaveLength(201);
  await expect(
    freeze([metadata, ...sources, { path: "src/Overflow.cs", bytesBase64: "" }]),
  ).rejects.toThrow(/file count/);
  await expect(
    freeze([metadata, { path: "src/F0.cs", bytesBase64: Buffer.alloc(614400).toString("base64") }]),
  ).rejects.toThrow(/byte bounds/);
});
test("ADV-4 admitted assets cross export/import intact without entering compilation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-adv4-"));
  roots.push(root);
  const podsRoot = join(root, "original");
  const all = new Map(files);
  for (let i = 0; i < 205; i++) all.set(`assets/${i}.bin`, Buffer.alloc(22000));
  for (const [path, bytes] of all) {
    const target = join(podsRoot, "portable-test", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }
  const pod = (await listPackages({ podsRoots: podsRoot })).packages[0]!;
  expect(pod.members).toHaveLength(all.size);
  const capture = await capturePackage(pod);
  expect(capture.sourceBundle.files.map((f) => f.path).sort()).toEqual(["pod.json", "src/Run.cs"]);
  const archivePath = join(root, "portable.zip");
  await exportPod({ pod: pod.id, archivePath }, { podsRoot });
  const imported = await importPod({ archivePath }, { podsRoot: join(root, "imported") });
  for (const [path, bytes] of all)
    expect(await readFile(join(imported.directory, path))).toEqual(bytes);
  // This isolated import has no bound lifecycle to refresh the destination census.
  await listPackages({ podsRoots: join(root, "imported") });
  const frozen = await freezeScript({
    sourcePath: "src/Run.cs",
    sourceBundle: (await capturePackage(imported.id, join(root, "imported"))).sourceBundle,
  });
  expect(frozen!.sourceBundle.files).toEqual(capture.sourceBundle.files);
}, 30_000);
