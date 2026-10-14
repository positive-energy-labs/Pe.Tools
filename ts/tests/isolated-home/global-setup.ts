// Vitest global setup for every package whose code resolves the product home. It runs once, in the
// main process, before any worker starts, so every worker and every child process a test spawns
// inherits a per-run temp home instead of the owner's real Documents\Pe.Tools. The marker it sets
// arms the tripwire in host-contracts `insideTestRoot`: a test that still reaches outside the temp
// directory fails at the resolution. A test that needs its own home sets its own override.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function isolateProductHome() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "pe-test-home-"));
  process.env.PE_TEST_HOME_ROOT = root;
  process.env.PE_TOOLS_PRODUCT_HOME = join(root, "product");
  process.env.LOCALAPPDATA = join(root, "local");
  // Best effort: a directory a lingering handle pins is the OS temp cleaner's, not a test failure.
  return () => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
}
