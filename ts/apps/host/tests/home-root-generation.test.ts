import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as realSetTimeout } from "node:timers";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { listPackages } from "../src/packages.ts";
import {
  packageDiscoveryTimeoutMs,
  packagePodWorkTimeoutMs,
  requireIndexedPackageAvailable,
  stopPackageDiscovery,
} from "../src/pod-capture.ts";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
const cleanup: string[] = [];
afterEach(async () => {
  stopPackageDiscovery();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
test.each([false, true])(
  "an older bound keeps a pending home unavailable, but never defeats newer recovery=%s",
  async (recovered) => {
    const root = await fs.mkdtemp(join(tmpdir(), "pe-home-generation-"));
    cleanup.push(root);
    const homes: [string, string] = [join(root, "A"), join(root, "B")];
    for (const home of homes) {
      await fs.mkdir(join(home, "pod"), { recursive: true });
      await fs.writeFile(
        join(home, "pod", "pod.json"),
        JSON.stringify({ id: home === homes[0] ? "a" : "b" }),
      );
    }
    await listPackages({ podsRoots: homes });
    const release = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    const original = fs.readdir;
    let held = false;
    vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
      if (String(args[0]) === homes[1] && (!recovered || !held)) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return original(...args);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = listPackages({ podsRoots: homes, wait: "background" }).catch(() => undefined);
    await entered.promise;
    await new Promise((resolve) => realSetTimeout(resolve, 50));
    await vi.advanceTimersByTimeAsync(1_000);
    const second = listPackages({ podsRoots: homes, packageId: "a", wait: "background" }).catch(
      () => undefined,
    );
    try {
      await new Promise((resolve) => realSetTimeout(resolve, 50));
      await vi.advanceTimersByTimeAsync(
        packageDiscoveryTimeoutMs - packagePodWorkTimeoutMs - 1_000,
      );
      if (recovered) expect(() => requireIndexedPackageAvailable("b", homes)).not.toThrow();
      else expect(() => requireIndexedPackageAvailable("b", homes)).toThrow(/Home work exceeded/);
    } finally {
      stopPackageDiscovery();
      release.resolve();
      await Promise.all([first, second]);
    }
  },
);
