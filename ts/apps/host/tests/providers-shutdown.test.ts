import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { productScratchPath } from "@pe/host-contracts/service-identity";
import { createProviders } from "../src/harness/providers.ts";

const prior = process.env.LOCALAPPDATA;
const root = mkdtempSync(join(process.env.PE_TEST_HOME_ROOT ?? tmpdir(), "pe-provider-fence-"));
afterEach(() => {
  process.env.LOCALAPPDATA = prior;
  rmSync(root, { recursive: true, force: true });
});

// A probe child's cwd is the scratch folder; caller-carriage proves a running one is released.
test("a startup probe still waiting for the shell PATH never opens an adapter after shutdown", async () => {
  process.env.LOCALAPPDATA = root;
  let finish!: (path: string) => void;
  const path = new Promise<string>((resolve) => (finish = resolve));
  const providers = createProviders({ shellPath: () => path });
  await providers.close();
  finish("");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(existsSync(productScratchPath())).toBe(false);
});
