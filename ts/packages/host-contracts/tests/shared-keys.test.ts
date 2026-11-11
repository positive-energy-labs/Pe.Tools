import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { keyRefusalText, resolveKey } from "../src/shared-keys.ts";

afterEach(() => vi.unstubAllEnvs());
const sharedWith = (text: string) => {
  const shared = mkdtempSync(join(tmpdir(), "pe-shared-keys-"));
  writeFileSync(join(shared, "keys.json"), text);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
};

test("user over shared over refusal, decoded as a flat map at the boundary", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(resolveKey("", "posthog")).toEqual({ refused: "no-shared-root" });
  expect(resolveKey(" mine ", "posthog")).toEqual({ value: "mine", from: "user" });
  sharedWith(JSON.stringify({ posthog: "phc_shared" }));
  expect(resolveKey(null, "posthog")).toEqual({ value: "phc_shared", from: "shared" });
  expect(resolveKey("mine", "posthog")).toEqual({ value: "mine", from: "user" });
  expect(resolveKey(null, "other")).toEqual({ refused: "no-shared-key" });
  expect(resolveKey(null, "toString")).toEqual({ refused: "no-shared-key" });
});

test("a malformed keys.json refuses without its bytes in the reason", () => {
  sharedWith(`{"posthog": {"nested": "phc_leaky"}`);
  const key = resolveKey(null, "posthog");
  expect(key).toEqual({ refused: "keys-unreadable" });
  expect(keyRefusalText("keys-unreadable", "posthog")).not.toContain("phc_leaky");
});
