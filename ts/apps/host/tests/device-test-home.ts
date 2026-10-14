import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vite-plus/test";

// Import first: no product module may resolve the owner's paths in these fixtures.
const root = mkdtempSync(join(tmpdir(), "pe-device-test-"));
const previous = [process.env.PE_TOOLS_PRODUCT_HOME, process.env.LOCALAPPDATA];
process.env.PE_TOOLS_PRODUCT_HOME = join(root, "home");
process.env.LOCALAPPDATA = join(root, "local");
afterAll(() => {
  for (const [index, key] of ["PE_TOOLS_PRODUCT_HOME", "LOCALAPPDATA"].entries()) {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }
  rmSync(root, { recursive: true, force: true });
});
