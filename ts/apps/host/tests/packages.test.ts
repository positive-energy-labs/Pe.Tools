import { podCaptureResponseSchema } from "@pe/host-contracts/operation-types";
import { Schema } from "effect";
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  capturePackage,
  isPackageMember,
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

// Mutant, run red once (2026-11-11): drop ".state" from the debris set in packages.ts.
test("a Page's .state folder in a Pod is stale debris, never a member", () => {
  // The sentinel: the filter does admit the authored file beside it.
  expect(isPackageMember("Pages/x/index.html")).toBe(true);
  for (const path of [
    "Pages/x/.state/a.json",
    "pages/x/.state/events.jsonl",
    "pages/x/.state/snapshot.json",
    "pages/x/.state/binding.json",
    "pages/x/.state/exports/abc.html",
  ])
    expect(isPackageMember(path), path).toBe(false);
});

test("C3 admits a tour's model declaration and rejects empty or malformed probes", async () => {
  const model = { title: "Chadds", probes: [{ elementId: 42, uniqueId: "stable" }] };
  await put("Original", "pod.json", JSON.stringify({ id: "mixed", for: model }));
  expect((await listPackages({ podsRoots: root })).packages[0]?.for).toEqual(model);
  for (const invalid of [
    null,
    {},
    { ...model, probes: [] },
    { ...model, probes: [{ elementId: 0, uniqueId: "x" }] },
    { ...model, probes: [{ elementId: 1, uniqueId: "" }] },
  ]) {
    await put("Original", "pod.json", JSON.stringify({ id: "mixed", for: invalid }));
    expect((await listPackages({ podsRoots: root })).packages).toHaveLength(0);
  }
});

test("one snapshot lists and captures every authored byte, excluding authority and debris", async () => {
  for (const path of [
    "output/run/input.json",
    "obj/a",
    "bin/a",
    // Page state is machine state (homes freeze shape 7): a pod carries none of it.
    "pages/tour/.state/events.jsonl",
    "pages/tour/.state/snapshot.json",
    "pages/tour/.state/binding.json",
    "pages/tour/.state/grants.json",
    "node_modules/a",
    ".env",
  ])
    await put("Original", path, "secret");
  const pod = await readPackage("mixed", { podsRoots: root });
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

// Contract C1. Mutants, each run red once: restore the `src/` test in `readPackageDirectory`'s entrypoint
// parse (no row for the check beside the Page); drop `mode` from the contribution row; accept any
// string as a mode (no InvalidEntrypoint for "Write").
test("an entrypoint is any script of the Pod, keeps its declared mode, and gets a script row where it lives", async () => {
  await put("Original", "pages/tour/checks/census.csx", "Result(1);");
  await put("Original", "heals/Fix.cs", "Result(2);");
  await put(
    "Original",
    "pod.json",
    JSON.stringify({
      id: "mixed",
      entrypoints: [
        { sourcePath: "pages/tour/checks/census.csx", mode: "ReadOnly" },
        { sourcePath: "heals/Fix.cs" },
        { sourcePath: "src/Run.cs", mode: "Write" },
        { sourcePath: "settings/checks.json" },
      ],
    }),
  );
  const pod = await readPackage("mixed", { podsRoots: root });
  expect(pod.contributions.filter((row) => row.kind === "script")).toEqual([
    expect.objectContaining({ key: "script:@mixed/heals/Fix.cs" }),
    expect.objectContaining({
      key: "script:@mixed/pages/tour/checks/census.csx",
      mode: "ReadOnly",
    }),
  ]);
  expect(
    pod.contributions.find((row) => row.key === "script:@mixed/heals/Fix.cs"),
  ).not.toHaveProperty("mode");
  expect(pod.diagnostics.filter((issue) => issue.code === "InvalidEntrypoint")).toHaveLength(2);
  expect(kindOfMember("pages/tour/checks/census.csx", pod.entrypoints)).toBe("script");
  // `pod.capture` and `pod.list` carry the declared mode on the wire. Mutant, run red once: drop
  // `mode` from `podEntrypointSchema` (the decode strips it).
  const wire = Schema.decodeUnknownSync(podCaptureResponseSchema)(await capturePackage(pod));
  expect(wire.entrypoints).toEqual([
    expect.objectContaining({ sourcePath: "pages/tour/checks/census.csx", mode: "ReadOnly" }),
    expect.objectContaining({ sourcePath: "heals/Fix.cs", mode: null }),
  ]);
  // Every script of the Pod is a compiler input, so the entrypoint compiles beside the others.
  expect((await capturePackage(pod)).sourceBundle.files.map((file) => file.path).sort()).toEqual([
    "PeScripts.csproj",
    "heals/Fix.cs",
    "pages/tour/checks/census.csx",
    "pod.json",
    "src/Run.cs",
  ]);
});

test("folder rename preserves keys; duplicate manifest identities refuse resolution and capture", async () => {
  const before = await readPackage("mixed", { podsRoots: root });
  await rename(join(root, "Original"), join(root, "Renamed"));
  expect((await readPackage("mixed", { podsRoots: root })).contributions).toEqual(
    before.contributions,
  );
  await put("Twin", "pod.json", '{"id":"mixed"}');
  await expect(readPackage("mixed", { podsRoots: root })).rejects.toThrow(
    `is claimed by ${join(root, "Renamed")} and ${join(root, "Twin")}`,
  );
  const listing = await listPackages({ podsRoots: root });
  expect(listing.packages.every((pod) => pod.contributions.length === 0)).toBe(true);
  await expect(capturePackage(listing.packages[0]!)).rejects.toThrow(/claimed/);
});

test("unsafe members report their path and refuse capture without hiding healthy siblings", async () => {
  await put("Original", "assets/large.bin", "");
  const oversized = await open(join(root, "Original", "assets/large.bin"), "r+");
  await oversized.truncate(64 * 1024 * 1024 + 1);
  await oversized.close();
  const pod = await readPackage("mixed", { podsRoots: root });
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
  const pod = await readPackage("mixed", { podsRoots: root });
  expect(pod.diagnostics).toContainEqual(
    expect.objectContaining({ path: "linked", severity: "error" }),
  );
  await expect(capturePackage(pod)).rejects.toThrow(/links/);
});
