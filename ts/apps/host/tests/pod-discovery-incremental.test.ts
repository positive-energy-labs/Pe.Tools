import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages } from "../src/packages.ts";
import { rememberCaptureRoots, stopPackageDiscovery } from "../src/pod-capture.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { createContributionContent, createPeRoutes } from "../src/pe-routes.ts";
import { freezeScript } from "../src/operation-script.ts";

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
    await expect(capturePackage("probe", pods)).rejects.toMatchObject({
      code: "pod.discovery.exceeded",
    });
    opened.mockRestore();
    expect(await (await request()).text()).toContain("edited behind the census");
    await fs.rm(join(pods, "probe", "pod.json"));
    expect((await request()).status).toBe(404);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.each([
  "invalid-manifest",
  "invalid-entrypoint",
  "persistent-io",
  "new-io",
  "partial-walk",
  "metadata-io",
])("a %s Pod never blocks another Pod's fresh Page", async (kind) => {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-scoped-discovery-"));
  try {
    const pods = join(root, "Pods");
    const page = (id: string) => join(pods, id, "pages", "hello", "index.html");
    const make = async (id: string) => {
      await fs.mkdir(join(page(id), ".."), { recursive: true });
      await fs.writeFile(join(pods, id, "pod.json"), JSON.stringify({ id }));
      await fs.writeFile(page(id), `<title>${id}</title>`);
    };
    await make("healthy");
    if (kind !== "new-io") await make("broken");
    const handler = createPagesHandler(
      [],
      pods,
      undefined,
      undefined,
      stateFixture(join(root, "state")),
    );
    const request = (id: string) => handler(new Request(`http://host/pages/${id}--hello/`));
    expect((await request("healthy")).status).toBe(200);
    if (kind === "new-io") await make("broken");
    if (kind === "invalid-manifest") await fs.writeFile(join(pods, "broken", "pod.json"), "{");
    if (kind === "invalid-entrypoint")
      await fs.writeFile(
        join(pods, "broken", "pod.json"),
        '{"id":"broken","entrypoints":[{"sourcePath":42}]}',
      );
    if (kind === "partial-walk") {
      await fs.writeFile(page("broken"), "<title>changed</title>");
      const original = fs.readdir;
      vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
        if (
          String(args[0]) === join(page("broken"), "..") &&
          typeof args[1] === "object" &&
          args[1]?.withFileTypes
        )
          return [];
        return original(...args);
      });
    }
    if (kind.endsWith("io")) {
      await fs.writeFile(page("broken"), "<title>changed</title>");
      const original = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        if (String(args[0]) === page("broken"))
          throw Object.assign(Error("Locked"), { code: "EBUSY" });
        return original(...args);
      });
    }
    if (kind === "metadata-io") {
      const original = fs.lstat;
      vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
        if (String(args[0]) === page("broken"))
          throw Object.assign(Error("Placeholder unavailable"), { code: "EACCES" });
        return original(...args);
      });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await fs.writeFile(page("healthy"), `<title>fresh ${attempt}</title>`);
      const response = await request("healthy");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`fresh ${attempt}`);
      if (kind === "persistent-io" || kind === "partial-walk" || kind === "metadata-io")
        expect((await request("broken")).status).toBe(503);
    }
    const listing = await listPackages({ podsRoots: pods });
    if (kind === "invalid-manifest" || kind === "new-io")
      expect(listing.unreadable).toEqual([expect.objectContaining({ folder: "broken" })]);
    if (kind === "invalid-entrypoint")
      expect(listing.packages.find((p) => p.id === "broken")?.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "InvalidEntrypoint" })]),
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a script key of an unavailable Pod answers typed try-again at the shared byte door", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "pe-key-unavailable-"));
  const pods = join(root, "Pods"),
    folder = join(pods, "probe");
  let content: ReturnType<typeof createContributionContent> | undefined;
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      join(folder, "pod.json"),
      '{"id":"probe","entrypoints":[{"sourcePath":"Run.csx"}]}',
    );
    await fs.writeFile(join(folder, "Run.csx"), 'Result("old bytes must not run");');
    content = createContributionContent({
      homeRoot: root,
      worldRoot: stateFixture(join(root, "state", "Agent")),
      packages: () => listPackages({ podsRoots: pods }),
    });
    await content.read();
    const sealed = await capturePackage("probe", pods);
    await fs.writeFile(join(folder, "Run.csx"), 'Result("edited bytes");');
    const original = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === join(folder, "Run.csx"))
        throw Object.assign(Error("Locked"), { code: "EBUSY" });
      return original(...args);
    });
    await content.lifecycle.refresh();
    await content.read();
    const app = createPeRoutes({
      registrations: [],
      store: { getState: async () => null, setState: async () => {} },
      heads: { observe: () => () => {} },
      contributionRead: content.member,
    });
    const response = await app.fetch(
      new Request("http://host/pe/contributions?key=script%3A%40probe%2FRun.csx"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "pod.discovery.exceeded" });
    await expect(capturePackage("probe", pods)).rejects.toMatchObject({
      code: "pod.discovery.exceeded",
    });
    rememberCaptureRoots(pods);
    await expect(
      freezeScript({ sourcePath: "Run.csx", sourceBundle: sealed.sourceBundle }),
    ).rejects.toMatchObject({ status: 503, refusal: { code: "pod.discovery.exceeded" } });
  } finally {
    await content?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
