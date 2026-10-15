import { lstat, mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import hostPackage from "../package.json" with { type: "json" };
import {
  captureDirectory,
  capturePackage,
  kindOfMember,
  listPackages,
  readPackage,
} from "../src/packages.ts";

let root: string;
const authored: Record<string, string | Uint8Array> = {
  "pod.json": JSON.stringify({ id: "mixed", entrypoints: [{ sourcePath: "src/Run.cs" }] }),
  "PeScripts.csproj": "<Project />",
  "README.md": "Guide",
  "AGENTS.md": "Instructions",
  "src/Run.cs": "class Run {}",
  "src/support.txt": "not C#",
  "skills/inspect/SKILL.md": "Inspect",
  "skills/inspect/references/data.bin": new Uint8Array([0, 255, 1]),
  "pages/tour/index.html": "<title>Tour</title>",
  "pages/tour/.state/events.jsonl": "{}",
  "pages/tour/.state/snapshot.json": "{}",
  "settings/checks.json": '{"$schema":"https://pe/schema"}',
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
// Windows holds fresh files open for a moment (scanners, a timed-out writer still finishing): retry.
afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test("one snapshot lists and captures every authored byte, excluding authority and debris", async () => {
  for (const path of [
    "output/run/input.json",
    "obj/a",
    "bin/a",
    "imported.json",
    "pages/tour/.state/binding.json",
    "pages/tour/.state/grants.json",
    "node_modules/a",
    ".env",
  ])
    await put("Original", path, "secret");
  const pod = await readPackage("mixed", root);
  expect(pod.members.map((member) => member.path).sort()).toEqual(Object.keys(authored).sort());
  await put("Original", "README.md", "changed after read");
  const capture = await capturePackage(pod);
  expect(capture.memberBundle.files.map((file) => file.path)).toEqual(
    pod.members.map((member) => member.path),
  );
  for (const file of capture.memberBundle.files)
    expect(Buffer.from(file.bytesBase64, "base64")).toEqual(Buffer.from(authored[file.path]!));
  expect(pod.contributions.map((row) => row.key)).toContain("script:@mixed/src/Run.cs");
  expect(pod.contributions.map((row) => row.key)).toContain("member:@mixed/settings/checks.json");
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
  expect(listing.packages.every((pod) => pod.contributions.length === 0)).toBe(true);
  await expect(capturePackage(listing.packages[0]!)).rejects.toThrow(/claimed/);
});

test("unsafe members report their path and refuse capture without hiding healthy siblings", async () => {
  await put("Original", "assets/large.bin", "");
  const oversized = await open(join(root, "Original", "assets/large.bin"), "r+");
  await oversized.truncate(64 * 1024 * 1024 + 1);
  await oversized.close();
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toContainEqual(
    expect.objectContaining({ path: "assets/large.bin", severity: "error" }),
  );
  expect(pod.members.some((member) => member.path === "README.md")).toBe(true);
  await expect(capturePackage(pod)).rejects.toThrow(/assets\/large.bin/);
});

test("directory links cannot admit files outside the package", async () => {
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside", "secret"), "secret");
  await symlink(join(root, "outside"), join(root, "Original", "linked"), "junction");
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toContainEqual(
    expect.objectContaining({ path: "linked", severity: "error" }),
  );
  await expect(capturePackage(pod)).rejects.toThrow(/links/);
});

test("canonical skill directories use the same bounded admission without a Pod manifest", async () => {
  await put("Skills", "inspect/SKILL.md", "Inspect");
  await put("Skills", "inspect/references/guide.md", "Guide");
  await put("Skills", "inspect/node_modules/ignored", "Ignored");
  const captured = await captureDirectory(join(root, "Skills"));
  expect(captured.diagnostics).toEqual([]);
  expect(captured.members.map((member) => member.path)).toEqual([
    "inspect/references/guide.md",
    "inspect/SKILL.md",
  ]);
});

test("file and directory budgets refuse capture instead of quietly truncating authored inputs", async () => {
  await mkdir(join(root, "Original", "support"));
  for (let offset = 0; offset < 4096; offset += 64)
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        writeFile(join(root, "Original", "support", `${offset + index}.txt`), ""),
      ),
    );
  await expect(capturePackage("mixed", root)).rejects.toThrow(/file count/);
  await mkdir(join(root, "Directories"));
  for (let offset = 0; offset < 4096; offset += 64)
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        mkdir(join(root, "Directories", `${offset + index}`)),
      ),
    );
  expect((await captureDirectory(join(root, "Directories"))).diagnostics).toContainEqual(
    expect.objectContaining({ message: "Pod directory limit exceeded" }),
  );
}, 30_000);

test("membership admits family assets and settings beyond executable source bundle bounds", async () => {
  const family = Buffer.alloc(540672, 1);
  await put("Original", "families/example.rfa", family);
  for (let index = 0; index < 241; index++)
    await put("Original", `settings/${index}.json`, JSON.stringify({ value: "x".repeat(90_000) }));
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toEqual([]);
  expect(
    Buffer.from(pod.members.find((member) => member.path === "families/example.rfa")!.bytes),
  ).toEqual(family);
  expect((await capturePackage(pod)).members).toHaveLength(Object.keys(authored).length + 242);
  // 21 MB across 241 real files: genuinely long on Windows, like the budget test above.
}, 30_000);

test.skipIf(process.platform !== "win32")(
  "an Offline attribute alone does not make a regular file unsafe",
  async () => {
    const path = join(root, "Original", "README.md");
    execFileSync(hostPackage.config.windowsBinaries.attrib, ["+O", path]);
    expect((await lstat(path)).isFile()).toBe(true);
    expect(
      execFileSync(hostPackage.config.windowsBinaries.attrib, [path], { encoding: "utf8" }).split(
        path,
      )[0],
    ).toContain("O");
    const pod = await readPackage("mixed", root);
    expect(pod.diagnostics).toEqual([]);
    expect(
      Buffer.from(pod.members.find((member) => member.path === "README.md")!.bytes).toString(),
    ).toBe("Guide");
  },
);

test("member diagnostics preserve sibling bytes while source validation remains native", async () => {
  await put(
    "Original",
    "pod.json",
    JSON.stringify({ id: "mixed", entrypoints: [{ sourcePath: "src/Missing.cs" }] }),
  );
  await put("Original", "settings/broken.json", "not JSON");
  const pod = await readPackage("mixed", root);
  expect(pod.diagnostics).toContainEqual(
    expect.objectContaining({ code: "MissingEntrypoint", path: "src/Missing.cs" }),
  );
  expect(pod.diagnostics).toContainEqual(
    expect.objectContaining({ code: "JsonParseError", path: "settings/broken.json" }),
  );
  expect((await capturePackage(pod)).memberBundle.files.map((file) => file.path)).toContain(
    "settings/checks.json",
  );
});
