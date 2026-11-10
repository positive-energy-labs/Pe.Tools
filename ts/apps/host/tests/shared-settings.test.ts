import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { FIRM_SEED, firmFilePath, readFirm } from "../src/ducts-inputs.ts";

afterEach(() => vi.unstubAllEnvs());

test("no shared root: the firm read refuses with a typed reason, never the seed", async () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(firmFilePath()).toBeNull();
  expect(await readFirm()).toEqual({ refused: "no-shared-root" });
});

test("a shared firm file is read from <shared>/Firm/ducts.json", async () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  mkdirSync(join(shared, "Firm"));
  writeFileSync(join(shared, "Firm", "ducts.json"), JSON.stringify({ ...FIRM_SEED, version: "firm-7" }));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  const reading = await readFirm();
  expect(reading).toMatchObject({ present: true, path: join(shared, "Firm", "ducts.json") });
  expect("firm" in reading && reading.firm.version).toBe("firm-7");
});

