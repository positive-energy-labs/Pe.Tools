import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { freezeScript } from "../src/operation-script.ts";
import { productUserContentRootPath } from "../src/product-paths.ts";

vi.mock("../src/product-paths.ts", () => ({ productUserContentRootPath: vi.fn() }));

it("captures Pod pages and their state alongside the other members, excluding nonmembers", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-pod-capture-"));
  vi.mocked(productUserContentRootPath).mockReturnValue(home);
  const members = {
    "pod.json": '{"id":"tour"}',
    "PeScripts.csproj": "<Project />",
    "README.md": "Guide",
    "skills/inspect/SKILL.md": "Inspect",
    "skills/inspect/references/support.txt": "Support",
    "src/main.csx": "return 1;",
    "settings/default.json": "{}",
    "assets/icon.svg": "<svg />",
    "pages/tour/index.html": "<title>Tour</title>",
    "pages/tour/.state/events.jsonl": '{"seq":1}',
  };
  try {
    for (const [path, content] of Object.entries({ ...members, "bin/ignored.txt": "ignored" })) {
      const file = join(home, "Pods", "tour", path);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, content);
    }
    const captured = await freezeScript({ sourcePath: "src/main.csx", workspaceKey: "tour" });
    expect(
      Object.fromEntries(
        captured!.sourceBundle.files.map(({ path, bytesBase64 }) => [
          path,
          Buffer.from(bytesBase64, "base64").toString("utf8"),
        ]),
      ),
    ).toEqual(members);
  } finally {
    vi.mocked(productUserContentRootPath).mockReset();
    await rm(home, { recursive: true, force: true });
  }
});

it("freezes a supplied snapshot without reading disk and rejects ambiguous or authority bytes", async () => {
  const files = [{ path: "src/Run.cs", bytesBase64: Buffer.from("original").toString("base64") }];
  const frozen = await freezeScript({ sourcePath: "src/Run.cs", sourceBundle: { files } });
  files[0]!.bytesBase64 = "";
  expect(Buffer.from(frozen!.sourceBundle.files[0]!.bytesBase64, "base64").toString()).toBe(
    "original",
  );
  for (const paths of [
    ["src/A.cs", "src/a.cs"],
    ["src/A.cs", "Src/B.cs"],
    ["src", "src/A.cs"],
    ["pages/tour/.state/binding.json"],
    ["src/../A.cs"],
  ]) {
    await expect(
      freezeScript({
        sourcePath: "src/A.cs",
        sourceBundle: { files: paths.map((path) => ({ path, bytesBase64: "" })) },
      }),
    ).rejects.toThrow();
  }
});

it("accepts the full four MiB binary budget even when its base64 wire form exceeds five MiB", async () => {
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `assets/${index}.bin`,
    bytesBase64: Buffer.alloc(512 * 1024).toString("base64"),
  }));
  expect(
    (await freezeScript({ sourcePath: "src/Run.cs", sourceBundle: { files } }))!.sourceBundle.files,
  ).toHaveLength(8);
  await expect(
    freezeScript({
      sourcePath: "src/Run.cs",
      sourceBundle: { files: [...files, { path: "assets/overflow", bytesBase64: "YQ==" }] },
    }),
  ).rejects.toThrow(/byte bounds/);
});
