import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { capturePackage, listPackages } from "../src/packages.ts";
import { packagePodWorkTimeoutMs } from "../src/pod-capture.ts";
import * as productPaths from "@pe/host-contracts/product-paths";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
vi.mock("@pe/host-contracts/product-paths", async (original) => ({
  ...(await original<typeof import("@pe/host-contracts/product-paths")>()),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => filesystem.rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await filesystem.mkdtemp(join(tmpdir(), "pe-capture-deadline-"));
  roots.push(root);
  const local = join(root, "local", "Pods");
  const foreign = join(root, "foreign", "Pods");
  const directory = join(local, "renamed-folder");
  await filesystem.mkdir(directory, { recursive: true });
  await filesystem.mkdir(foreign, { recursive: true });
  await filesystem.writeFile(
    join(directory, "pod.json"),
    '{"id":"local","entrypoints":[{"sourcePath":"Run.csx"}]}',
  );
  await filesystem.writeFile(join(directory, "Run.csx"), "Result(1);");
  await listPackages({ podsRoots: [local, foreign] });
  return { local, foreign, directory };
}

// Mutant: restore capturePackage(string) -> readPackage(id, podsRoots), rescanning every home.
test("capture uses the completed identity census and fresh local bytes without reading a slow foreign home", async () => {
  const { local, foreign, directory } = await fixture();
  await filesystem.writeFile(join(directory, "Run.csx"), "Result(2);");
  const actual = filesystem.readdir;
  const spy = vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (String(args[0]) === foreign) return await new Promise<never>(() => {});
    return actual(...args);
  });
  const started = performance.now();
  const captured = await capturePackage("local", [local, foreign]);
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(spy.mock.calls.map(([path]) => String(path))).toEqual([directory]);
  expect(
    Buffer.from(
      captured.sourceBundle.files.find((file) => file.path === "Run.csx")!.bytesBase64,
      "base64",
    ).toString(),
  ).toBe("Result(2);");
});

test("default capture never probes homes, including when passed admitted bytes", async () => {
  const { local, foreign } = await fixture();
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(local, ".."));
  const probe = vi.spyOn(productPaths, "resolveHomes").mockResolvedValue(new Map([["", [
    { tier: "user", root: join(local, "..") }, { tier: "firm", root: join(foreign, "..") },
  ]]]));
  const listing = await listPackages();
  probe.mockImplementation(() => {
    throw Error("slow synchronous Drive probe");
  });
  expect((await capturePackage("local")).id).toBe("local");
  expect((await capturePackage(listing.packages[0]!)).id).toBe("local");
  expect(probe).toHaveBeenCalledTimes(1);
});

test("a stalled selected folder refuses at its Pod bound and stops walking when IO returns", async () => {
  const { local, foreign, directory } = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actual = filesystem.readdir;
  const spy = vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return actual(...args);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const capture = capturePackage("local", [local, foreign]);
  const refused = expect(capture).rejects.toMatchObject({
    code: "pod.discovery.exceeded",
    message: expect.stringContaining(`Pod work exceeded ${packagePodWorkTimeoutMs} ms reading '${directory}'`),
  });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(packagePodWorkTimeoutMs);
  await refused;
  const reads = vi.spyOn(filesystem, "open");
  release.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(reads).not.toHaveBeenCalled();
});

test("cold capture refuses without a scan, and a changed manifest cannot reuse an indexed id", async () => {
  const { local, foreign, directory } = await fixture();
  const spy = vi.spyOn(filesystem, "readdir");
  await expect(capturePackage("local", join(local, "uncensused"))).rejects.toThrow(
    "before Pod discovery finishes",
  );
  expect(spy).not.toHaveBeenCalled();
  await filesystem.writeFile(join(directory, "pod.json"), '{"id":"other"}');
  await expect(capturePackage("local", [local, foreign])).rejects.toThrow("Pod identity changed");
});

test("the completed census refuses duplicate ids and replaces old claims after rediscovery", async () => {
  const { local, foreign } = await fixture();
  await filesystem.mkdir(join(foreign, "twin"));
  await filesystem.writeFile(join(foreign, "twin", "pod.json"), '{"id":"local"}');
  await listPackages({ podsRoots: [local, foreign] });
  await expect(capturePackage("local", [local, foreign])).rejects.toThrow("is claimed by");
  await filesystem.rm(join(foreign, "twin"), { recursive: true });
  await listPackages({ podsRoots: [local, foreign] });
  expect((await capturePackage("local", [local, foreign])).id).toBe("local");
});
