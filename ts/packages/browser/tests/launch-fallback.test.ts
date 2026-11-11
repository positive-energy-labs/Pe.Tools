import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";

// A hardened Windows machine can refuse process creation through WMI, which is how a session keeper leaves its launcher's job.
vi.mock("../src/platform.ts", async (original) => ({
  ...(await original<typeof import("../src/platform.ts")>()),
  createOutsideJob: async () => {
    throw new Error("WMI process creation is blocked");
  },
}));
const { openBrowser } = await import("../src/browser.ts");

test.skipIf(process.platform !== "win32")(
  "a session launch still starts when Windows refuses the outside-job start",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pe-launch-fallback-"));
    const session = await openBrowser({ home: join(root, "home"), lifetime: "session" });
    try {
      expect((await session.targets()).length).toBeGreaterThan(0);
    } finally {
      await session.close();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
  60_000,
);
