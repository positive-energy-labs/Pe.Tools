import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, stateFixture, stateMachine } from "../../../tests/isolated-home/storage.ts";
import { ledgerFixture } from "./storage.ts";
import { pictureCaptures } from "./effect-test.ts";
import { importShippedPods } from "../src/installed-pods.ts";
import { exportPod } from "../src/pod-transfer.ts";
import { bindPackageScanLogger, capturePackage, listPackages } from "../src/packages.ts";
import { createContributionContent } from "../src/pe-routes.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import {
  bindPackageLifecycle,
  createPackageLifecycle,
  requirePackageEnabled,
} from "../src/package-lifecycle.ts";
import { shippedPodUpdateRefusals } from "../src/shipped-pod-status.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  bindPackageScanLogger(() => {});
  bindPackageLifecycle(undefined);
  shippedPodUpdateRefusals.clear();
});

test.each(["edited", "missing-record"])(
  "a kept example (%s) stays in the catalog with executable bytes and one update notice",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "pe-kept-pod-"));
    const source = join(root, "examples");
    const folder = join(source, "example");
    await mkdir(join(folder, "pages", "tour"), { recursive: true });
    await mkdir(join(folder, "src"));
    await writeFile(
      join(folder, "pod.json"),
      JSON.stringify({
        id: "example",
        name: "Example",
        version: "1",
        entrypoints: [{ sourcePath: "src/Run.cs" }],
      }),
    );
    await writeFile(join(folder, "pages", "tour", "index.html"), "<title>Example</title>");
    await writeFile(join(folder, "src", "Run.cs"), 'Result("original");');
    const shippedRoot = join(root, "shipped");
    const archivePath = join(shippedRoot, "example.zip");
    const captures = pictureCaptures(join(root, "captures"));
    const podsRoot = join(root, "home", "Pods");
    const ledger = ledgerFixture(join(root, "shipped-pods.json"));
    const boot = () => importShippedPods({ shippedRoot, podsRoot, ledger, captures });
    await exportPod({ pod: "example", archivePath }, { podsRoot: source, captures });
    if (kind === "edited") await boot();
    else {
      await mkdir(join(podsRoot, "example", "src"), { recursive: true });
      await mkdir(join(podsRoot, "example", "pages", "tour"), { recursive: true });
      for (const path of ["pod.json", "src/Run.cs", "pages/tour/index.html"])
        await writeFile(join(podsRoot, "example", path), await readFile(join(folder, path)));
    }
    const mine = 'Result("my edit");';
    await writeFile(join(podsRoot, "example", "src", "Run.cs"), mine);
    await writeFile(join(folder, "src", "Run.cs"), 'Result("new example");');
    await rm(archivePath);
    await exportPod({ pod: "example", archivePath }, { podsRoot: source, captures });
    await boot();
    await boot();
    const content = createContributionContent({
      worldRoot: stateFixture(join(root, "agent")),
      homeRoot: join(root, "home"),
      decisionsMachine: stateMachine(root),
      packages: () => listPackages(podsRoot),
    });
    try {
      const catalog = await content.read();
      const pod = catalog.packages.find((p) => p.id === "example")!;
      expect(pod.contributions.map((c) => c.key)).toEqual(
        expect.arrayContaining(["script:@example/src/Run.cs", "page:@example/pages/tour"]),
      );
      const executable = content.member("script:@example/src/Run.cs");
      expect(executable).toMatchObject({
        content: mine,
        sourceBundle: { files: expect.any(Array) },
      });
      expect(pod.diagnostics).toEqual([
        expect.objectContaining({
          code: "ShippedExampleUpdateKept",
          severity: "warning",
          message: expect.stringContaining("import the current example into a separate workspace"),
        }),
      ]);
      const captured = await capturePackage("example", podsRoot);
      expect(
        Buffer.from(
          captured.sourceBundle.files.find((f) => f.path === "src/Run.cs")!.bytesBase64,
          "base64",
        ).toString(),
      ).toBe(mine);
      expect(await readFile(join(podsRoot, "example", "src", "Run.cs"), "utf8")).toBe(mine);
    } finally {
      await content.close();
    }
  },
);

test("folder scans log their folder, start and completed duration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-log-"));
  const lines: string[] = [];
  bindPackageScanLogger((line) => lines.push(line));
  expect(await listPackages(root)).toEqual({ packages: [], unreadable: [] });
  expect(lines).toEqual([
    `Pod folder scan start folder=${JSON.stringify(root)}`,
    expect.stringMatching(/Pod folder scan end folder=.+ durationMs=\d+ outcome=completed/),
  ]);
});

test("a stalled folder listing is refused at five seconds, logged, and cannot list the next home later", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-scan-bound-"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const lines: string[] = [];
  bindPackageScanLogger((line) => lines.push(line));
  const actual = filesystem.readdir;
  const spy = vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scan = listPackages([root, join(root, "next-home")]);
  const refused = expect(scan).rejects.toThrow("Pod discovery exceeded 5000 ms");
  await entered.promise;
  await vi.advanceTimersByTimeAsync(5_000);
  await refused;
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("outcome=timed-out");
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  expect(spy).toHaveBeenCalledTimes(1);
});

test("the five-second lifecycle discovery bound includes its initial census", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-ready-bound-"));
  const release = Promise.withResolvers<{ packages: []; unreadable: [] }>();
  const lifecycle = createPackageLifecycle({
    machine: stateMachine(root),
    packages: () => release.promise,
  });
  bindPackageLifecycle(lifecycle);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const opening = expect(requirePackageEnabled("late")).rejects.toThrow("inactive");
    await vi.advanceTimersByTimeAsync(5_000);
    await opening;
  } finally {
    await lifecycle.close();
    release.resolve({ packages: [], unreadable: [] });
    await lifecycle.ready;
  }
});

test("a first Page request can spend 9999 ms in its two discovery waits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-first-page-bound-"));
  const home = join(root, "home");
  const pods = join(home, "Pods");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  await mkdir(join(pods, "late", "pages", "tour"), { recursive: true });
  await writeFile(join(pods, "late", "pod.json"), '{"id":"late","entrypoints":[]}');
  await writeFile(join(pods, "late", "pages", "tour", "index.html"), "<title>Late</title>");
  const releaseCensus = Promise.withResolvers<{ packages: []; unreadable: [] }>();
  const lifecycle = createPackageLifecycle({ machine: stateMachine(root), packages: () => releaseCensus.promise });
  bindPackageLifecycle(lifecycle);
  const ready = lifecycle.ready;
  const policyEntered = Promise.withResolvers<void>();
  vi.spyOn(lifecycle, "ready", "get").mockImplementation(() => {
    policyEntered.resolve();
    return ready;
  });
  const entered = Promise.withResolvers<void>();
  const releaseListing = Promise.withResolvers<void>();
  const actual = filesystem.readdir;
  vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await releaseListing.promise;
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const started = Date.now();
  let answered = false;
  const handler = createPagesHandler([], pods, undefined, undefined, stateFixture(join(root, "page-state")));
  const opening = handler(new Request("http://host/pages/late--tour/")).finally(() => { answered = true; });
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(4_999);
    releaseListing.resolve();
    await policyEntered.promise;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await opening)?.status).toBe(404);
    expect(Date.now() - started).toBe(9_999);
  } finally {
    releaseListing.resolve();
    await lifecycle.close();
    releaseCensus.resolve({ packages: [], unreadable: [] });
    await ready;
    await opening;
  }
});
