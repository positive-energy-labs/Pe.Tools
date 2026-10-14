import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { validatePageHtml, writeArtifact } from "../src/page-artifacts.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pe-artifacts-"));
  roots.push(root);
  return root;
}

test("immutable concurrent writers keep exact consumed bytes and refuse a conflicting artifact", async () => {
  const root = await fixture(),
    path = join(root, "exports", "same.html");
  const bytes = Buffer.from("original");
  const pending = writeArtifact(root, path, bytes);
  bytes.fill(0);
  await Promise.all([pending, writeArtifact(root, path, "original")]);
  expect(await readFile(path, "utf8")).toBe("original");
  await expect(writeArtifact(root, path, "different")).rejects.toThrow("collision");
  expect(await readdir(join(root, "exports"))).toEqual(["same.html"]);
});

test("redirected export directories and existing artifact links cannot cross the root", async () => {
  const root = await fixture(),
    outside = await fixture();
  await symlink(outside, join(root, "exports"), "junction");
  await expect(writeArtifact(root, join(root, "exports", "file.html"), "secret")).rejects.toThrow(
    "outside",
  );
  expect(await readdir(outside)).toEqual([]);
  await writeFile(join(outside, "file.html"), "original");
  // Windows junctions require no symlink privilege and exercise the existing-path refusal.
  await symlink(outside, join(root, "file.html"), "junction");
  await expect(writeArtifact(root, join(root, "file.html"), "original")).rejects.toThrow("outside");
  expect(await readFile(join(outside, "file.html"), "utf8")).toBe("original");
});

test("replacement retains adjacent state; publication validation stays strict while transport admits valid fragments", async () => {
  const root = await fixture();
  await mkdir(join(root, "page", ".state"), { recursive: true });
  await writeFile(join(root, "page", ".state", "binding.json"), "retained");
  await writeArtifact(root, join(root, "page", "index.html"), "exact authored bytes", true, true);
  expect(await readFile(join(root, "page", "index.html"), "utf8")).toBe("exact authored bytes");
  expect(await readFile(join(root, "page", ".state", "binding.json"), "utf8")).toBe("retained");
  expect(() => validatePageHtml("<title>fragment</title>")).toThrow("HTML");
  expect(() =>
    validatePageHtml(
      '<title>fragment</title><script type="module">export const value=1;</script>',
      true,
    ),
  ).not.toThrow();
  expect(() => validatePageHtml("<button onclick='const = ;'>bad</button>", true)).toThrow(
    "handler JavaScript",
  );
});
