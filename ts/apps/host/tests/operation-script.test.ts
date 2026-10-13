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
