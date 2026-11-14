import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { listPackages } from "../src/packages.ts";
import { stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
afterEach(() => {
  vi.restoreAllMocks();
  stopPackageDiscovery();
});

// Mutant: omit the previous census when scanning, recapturing every Pod on any edit.
test("one new Page rereads only its Pod, with global duplicate identity recomputed", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-incremental-"));
  try {
    for (const id of ["edited", "unchanged"]) {
      await fs.mkdir(join(root, id));
      await fs.writeFile(join(root, id, "pod.json"), JSON.stringify({ id }));
      await fs.writeFile(join(root, id, "data.json"), "{}");
    }
    await listPackages({ podsRoots: root });
    const opened = vi.spyOn(fs, "open");
    await fs.mkdir(join(root, "edited", "pages", "inventory"), { recursive: true });
    await fs.writeFile(
      join(root, "edited", "pages", "inventory", "index.html"),
      "<title>new</title>",
    );
    const listing = await listPackages({ podsRoots: root });
    expect(listing.packages.find((p) => p.id === "edited")?.members).toHaveLength(3);
    expect(opened.mock.calls.map(([path]) => String(path))).not.toContain(
      join(root, "unchanged", "pod.json"),
    );
    expect(opened.mock.calls).toHaveLength(3);
    // Duplicate refusal must not poison the unchanged Pod's cached contributions/diagnostics.
    await fs.writeFile(join(root, "edited", "pod.json"), '{"id":"unchanged"}');
    expect(
      (await listPackages({ podsRoots: root })).packages.every((p) =>
        p.diagnostics.some((d) => d.code === "DuplicatePodId"),
      ),
    ).toBe(true);
    await fs.writeFile(join(root, "edited", "pod.json"), '{"id":"edited"}');
    const recovered = (await listPackages({ podsRoots: root })).packages.find(
      (p) => p.id === "unchanged",
    )!;
    expect(recovered.diagnostics.some((d) => d.code === "DuplicatePodId")).toBe(false);
    expect(recovered.contributions).toHaveLength(1);
    for (const debris of ["bin", "obj"]) {
      await fs.mkdir(join(root, "edited", "nested", debris), { recursive: true });
      await fs.writeFile(join(root, "edited", "nested", debris, "build.txt"), "old");
    }
    await listPackages({ podsRoots: root });
    opened.mockClear();
    const directories = vi.spyOn(fs, "readdir");
    for (const debris of ["bin", "obj"])
      await fs.writeFile(join(root, "edited", "nested", debris, "build.txt"), "new bytes");
    await listPackages({ podsRoots: root });
    expect(opened).not.toHaveBeenCalled();
    expect(directories.mock.calls.some(([path]) => /[\\/](bin|obj)$/.test(String(path)))).toBe(
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Mutant: publish captureDirectory's partial members after a transient member read failure.
test("an admitted Page whose changed Pod fails mid-read answers try-again, never not-found", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-incomplete-"));
  try {
    const pods = join(root, "Pods"),
      page = join(pods, "probe", "pages", "hello", "index.html");
    await fs.mkdir(join(page, ".."), { recursive: true });
    await fs.writeFile(join(pods, "probe", "pod.json"), '{"id":"probe"}');
    await fs.writeFile(page, "<title>old</title>");
    const handler = createPagesHandler(
      [],
      pods,
      undefined,
      undefined,
      stateFixture(join(root, "state")),
    );
    const request = () => handler(new Request("http://host/pages/probe--hello/"));
    expect((await request()).status).toBe(200);
    await fs.writeFile(page, "<title>edited behind the census</title>");
    const original = fs.open;
    const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === page)
        throw Object.assign(Error("Drive file busy"), { code: "EBUSY" });
      return original(...args);
    });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("pod.discovery.exceeded");
    opened.mockRestore();
    expect(await (await request()).text()).toContain("edited behind the census");
    await fs.rm(join(pods, "probe", "pod.json"));
    expect((await request()).status).toBe(404);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
