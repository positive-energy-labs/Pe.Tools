import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { notices } from "@pe/host-contracts/kinds";
import { stateTree } from "@pe/host-contracts/service-identity";
import { analyticsConfig, readOrCreateInstallId } from "../src/analytics.ts";

const names = ["LOCALAPPDATA", "PE_TOOLS_PRODUCT_HOME", "PE_TOOLS_SHARED_ROOT"] as const;
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
let dir: string;
/** Under the override the machine-local root, and so the installed manifest, moves with it. */
let root: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pe-key-policy-"));
  process.env.LOCALAPPDATA = dir;
  process.env.PE_TOOLS_PRODUCT_HOME = join(dir, "docs", "Pe.Tools");
  delete process.env.PE_TOOLS_SHARED_ROOT;
  root = join(dir, "docs", "Pe.Tools", ".local-state");
  mkdirSync(root, { recursive: true });
});
afterEach(() => {
  for (const name of names)
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  rmSync(dir, { recursive: true, force: true });
});

test("lane selection: dev never uses the installed key, and no person's file opts it in", () => {
  writeFileSync(
    join(root, "product.payloads.json"),
    JSON.stringify({ telemetry: { posthog: { apiKey: "installed-key" } } }),
  );
  expect(analyticsConfig("dev")).toBeNull();
  expect(analyticsConfig("installed")).toEqual({
    apiKey: "installed-key",
    host: "https://us.i.posthog.com",
  });
  // The user home's preferences.json is not read: a key there changes nothing.
  writeFileSync(
    join(dir, "docs", "Pe.Tools", "preferences.json"),
    JSON.stringify({ posthog: { apiKey: "explicit-dev-key", host: "https://eu.i.posthog.com/" } }),
  );
  expect(analyticsConfig("dev")).toBeNull();
  // The dev key is the firm's, by role.
  const firm = join(dir, "firm");
  mkdirSync(firm);
  writeFileSync(join(firm, "pe-home.json"), `{"tier":"firm"}`);
  writeFileSync(join(firm, "keys.json"), JSON.stringify({ "posthog.api-key": "firm-dev-key" }));
  process.env.PE_TOOLS_SHARED_ROOT = firm;
  expect(analyticsConfig("dev")).toEqual({ apiKey: "firm-dev-key", host: "https://us.i.posthog.com",
  });
  expect(analyticsConfig("installed")?.apiKey).toBe("installed-key");
});

// Mutant: return null when the stored file does not decode (the old behaviour) and the invalid
// rows go red: a null id is what stopped the host.
test.each([
  ["not JSON", "{"],
  ["no id", "{}"],
  ["an id that is not a UUID", `{"installId":"nope"}`],
])("an invalid install.json (%s) is replaced with a new id and one notice", (_name, bytes) => {
  const path = join(root, "state", "install.json");
  const first = readOrCreateInstallId();
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(readOrCreateInstallId()).toBe(first);
  expect(existsSync(join(root, "state", "stored-notices.jsonl"))).toBe(false);
  writeFileSync(path, bytes);
  const replaced = readOrCreateInstallId();
  expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  expect(replaced).not.toBe(first);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ installId: replaced });
  expect(readOrCreateInstallId()).toBe(replaced);
  expect(notices(stateTree(root))).toMatchObject([
    { class: "discard", place: "Install identity", path },
  ]);
});
