import { afterEach, expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePackage, listPackages } from "../src/packages.ts";
import { exportPod, importPod } from "../src/pod-transfer.ts";
import { freezeScript } from "../src/operation-script.ts";
import { scriptPodSourceBounds } from "@pe/host-contracts/generated";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
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
  const pod = (await listPackages(podsRoot)).packages[0]!;
  expect(pod.members).toHaveLength(all.size);
  const capture = await capturePackage(pod);
  expect(capture.sourceBundle.files.map((f) => f.path).sort()).toEqual(["pod.json", "src/Run.cs"]);
  const archivePath = join(root, "portable.zip");
  await exportPod({ pod: pod.id, archivePath }, { podsRoot });
  const imported = await importPod({ archivePath }, { podsRoot: join(root, "imported") });
  for (const [path, bytes] of all)
    expect(await readFile(join(imported.directory, path))).toEqual(bytes);
  const frozen = await freezeScript({
    sourcePath: "src/Run.cs",
    sourceBundle: (await capturePackage(imported.id, join(root, "imported"))).sourceBundle,
  });
  expect(frozen!.sourceBundle.files).toEqual(capture.sourceBundle.files);
}, 30_000);
