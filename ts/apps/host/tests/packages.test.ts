import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { capturePackage, kindOfMember, listPackages, readPackage } from "../src/packages.ts";

let root: string;
const authored: Record<string, string | Uint8Array> = {
  "pod.json": JSON.stringify({ id: "mixed", entrypoints: [{ sourcePath: "src/Run.cs" }] }),
  "PeScripts.csproj": "<Project />", "README.md": "Guide", "AGENTS.md": "Instructions",
  "src/Run.cs": "class Run {}", "src/support.txt": "not C#",
  "skills/inspect/SKILL.md": "Inspect", "skills/inspect/references/data.bin": new Uint8Array([0, 255, 1]),
  "pages/tour/index.html": "<title>Tour</title>", "pages/tour/.state/events.jsonl": "{}",
  "pages/tour/.state/snapshot.json": "{}", "settings/checks.json": '{"$schema":"https://pe/schema"}',
};
async function put(folder: string, path: string, content: string | Uint8Array) {
  const target = join(root, folder, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-membership-"));
  for (const [path, content] of Object.entries(authored)) await put("Original", path, content);
});
afterEach(() => rm(root, { recursive: true, force: true }));

test("one snapshot lists and captures every authored byte, excluding authority and debris", async () => {
  for (const path of ["output/run/input.json", "obj/a", "bin/a", "imported.json", "pages/tour/.state/binding.json", "pages/tour/.state/grants.json", "node_modules/a", ".env"]) await put("Original", path, "secret");
  const pod = await readPackage("mixed", root);
  expect(pod.members.map(member => member.path).sort()).toEqual(Object.keys(authored).sort());
  await put("Original", "README.md", "changed after read");
  const capture = await capturePackage(pod);
  expect(capture.sourceBundle.files.map(file => file.path)).toEqual(pod.members.map(member => member.path));
  for (const file of capture.sourceBundle.files) expect(Buffer.from(file.bytesBase64, "base64")).toEqual(Buffer.from(authored[file.path]!));
  expect(pod.contributions.map(row => row.key)).toContain("script:@mixed/src/Run.cs");
  expect(pod.contributions.map(row => row.key)).toContain("member:@mixed/settings/checks.json");
  expect(kindOfMember("src/support.txt", pod.entrypoints)).toBeUndefined();
  expect(kindOfMember("pages/tour/index.html")).toBe("page");
  expect(kindOfMember("skills/inspect/SKILL.md")).toBe("skill");
});

test("folder rename preserves keys; duplicate manifest identities refuse resolution and capture", async () => {
  const before = await readPackage("mixed", root);
  await rename(join(root, "Original"), join(root, "Renamed"));
  expect((await readPackage("mixed", root)).contributions).toEqual(before.contributions);
  await put("Twin", "pod.json", '{"id":"mixed"}');
  await expect(readPackage("mixed", root)).rejects.toThrow(/Renamed, Twin/);
  const listing = await listPackages(root);
  expect(listing.packages.every(pod => pod.contributions.length === 0)).toBe(true);
  await expect(capturePackage(listing.packages[0]!)).rejects.toThrow(/claimed/);
});

test("unsafe members report their path and refuse capture without hiding healthy siblings", async () => {
  await put("Original", "assets/large.bin", new Uint8Array(512 * 1024 + 1));
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toContainEqual(expect.objectContaining({ path: "assets/large.bin", severity: "error" }));
  expect(pod.members.some(member => member.path === "README.md")).toBe(true);
  await expect(capturePackage(pod)).rejects.toThrow(/assets\/large.bin/);
});

test("directory links cannot admit files outside the package", async () => {
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside", "secret"), "secret");
  await symlink(join(root, "outside"), join(root, "Original", "linked"), "junction");
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toContainEqual(expect.objectContaining({ path: "linked", severity: "error" }));
  await expect(capturePackage(pod)).rejects.toThrow(/links/);
});
