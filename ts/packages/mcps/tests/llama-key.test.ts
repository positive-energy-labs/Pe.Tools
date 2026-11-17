import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { requireLlamaCloudKey } from "../src/shared/llama-key.ts";

afterEach(() => vi.unstubAllEnvs());

test("LlamaParse uses the person's own key, then the firm keys.json, and refuses without quoting either", () => {
  const shared = mkdtempSync(join(tmpdir(), "pe-llama-firm-"));
  writeFileSync(join(shared, "pe-home.json"), `{"tier":"firm"}`);
  writeFileSync(join(shared, "keys.json"), JSON.stringify({ "llamaparse.api-key": "llx-firm" }));
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
  expect(requireLlamaCloudKey({})).toBe("llx-firm");
  expect(requireLlamaCloudKey({ LLAMA_CLOUD_API_KEY: "llx-mine" })).toBe("llx-mine");
  writeFileSync(join(shared, "keys.json"), "{}");
  expect(() => requireLlamaCloudKey({})).toThrow(/llamaparse\.api-key.*LLAMA_CLOUD_API_KEY/s);
});
