import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vite-plus/test";
import { stateTree } from "@pe/host-contracts/service-identity";
import { decodeKeeperConfig, decodeGuardianConfig } from "../src/keeper-config.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pe-worker-decode-"));
  roots.push(root);
  const id = randomUUID();
  const home = stateTree(root).directory("browser");
  return {
    root,
    id,
    home,
    config: JSON.parse(JSON.stringify({ id, token: "token", home, lifetime: "caller" })),
  };
}
test("keeper config decodes and remints its machine scope before any I/O", () => {
  const { config, home } = fixture();
  const decoded = decodeKeeperConfig(config);
  expect(decoded.home).toEqual(home);
  expect(() =>
    decodeKeeperConfig({
      ...config,
      home: { ...config.home, path: join(home.path, "..", "..", "outside") },
    }),
  ).toThrow(/scope/);
  expect(() =>
    decodeKeeperConfig({
      ...config,
      home: {
        ...config.home,
        machine: { ...config.home.machine, blobs: join(home.path, "forged") },
      },
    }),
  ).toThrow(/scope/);
  expect(() => decodeKeeperConfig({ ...config, id: "../escape" })).toThrow();
});
test("guardian config refuses a receipt outside its decoded storage scope", () => {
  const { root, home, id } = fixture();
  const storage = stateTree(root).directory("browser", id);
  const value = JSON.parse(
    JSON.stringify({
      storage,
      endpoint: "ws://localhost:1",
      receipt: join(storage.path, "session.json"),
      lock: { path: "lock", marker: "marker" },
      timeoutMs: 1000,
    }),
  );
  expect(decodeGuardianConfig(value).storage).toEqual(storage);
  expect(() =>
    decodeGuardianConfig({
      ...value,
      storage: { ...value.storage, path: join(home.path, "..", "..", "foreign") },
    }),
  ).toThrow(/scope/);
  expect(() =>
    decodeGuardianConfig({ ...value, receipt: join(home.path, "foreign.json") }),
  ).toThrow(/receipt/);
});
