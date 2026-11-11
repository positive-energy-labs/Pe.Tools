import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { keyRefusalText, resolveKey } from "../src/shared-keys.ts";

afterEach(() => vi.unstubAllEnvs());
const sharedWith = (text: string) => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-keys-"));
  writeFileSync(join(shared, "pe-home.json"), `{"tier":"firm"}`);
  writeFileSync(join(shared, "keys.json"), text);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
};

test("the person's own key, then the firm keys.json by role, then a refusal, decoded as a flat map at the boundary", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(resolveKey("", "openai.api-key")).toEqual({ refused: "no-shared-root" });
  expect(resolveKey(" mine ", "openai.api-key")).toEqual({ value: "mine", from: "user" });
  sharedWith(JSON.stringify({ "openai.api-key": "phc_shared" }));
  expect(resolveKey(null, "openai.api-key")).toEqual({ value: "phc_shared", from: "shared" });
  expect(resolveKey("mine", "openai.api-key")).toEqual({ value: "mine", from: "user" });
  expect(resolveKey(null, "anthropic.api-key")).toEqual({ refused: "no-shared-key" });
  expect(resolveKey(null, "toString" as never)).toEqual({ refused: "no-shared-key" });
});

test("a malformed keys.json refuses without its bytes in the reason", () => {
  sharedWith(`{"openai.api-key": {"nested": "phc_leaky"}`);
  const key = resolveKey(null, "openai.api-key");
  expect(key).toEqual({ refused: "keys-unreadable" });
  expect(keyRefusalText("keys-unreadable", "openai.api-key")).not.toContain("phc_leaky");
});
