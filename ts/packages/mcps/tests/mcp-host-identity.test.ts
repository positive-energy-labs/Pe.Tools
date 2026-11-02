import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_VARIABLE, hostProcessIdentity } from "@pe/host-contracts/contracts";
import { resolveLaneAndRoot, verifyMcpHost } from "../src/shared/host-config.ts";

// pea-checkout-mismatch.md: a host-spawned Pea MCP child whose cwd (the harness world root) sits in
// another checkout. The host's URL and context name the runtime; cwd picks it only for the operator.
let foreign: string;
const saved = { ...process.env };
beforeEach(() => {
  foreign = mkdtempSync(join(tmpdir(), "pe-foreign-checkout-"));
  mkdirSync(join(foreign, ".git"));
  writeFileSync(join(foreign, "Pe.Tools.slnx"), "");
  mkdirSync(join(foreign, "home"));
  vi.spyOn(process, "cwd").mockReturnValue(join(foreign, "home"));
  delete process.env[hostProcessIdentity.hostBaseUrlVariable];
  delete process.env[HOST_CONTEXT_VARIABLE];
  delete process.env.PE_TOOLS_SOURCE_ROOT;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
  rmSync(foreign, { recursive: true, force: true });
});

test("a host-spawned child in a foreign cwd resolves its own checkout", () => {
  process.env[hostProcessIdentity.hostBaseUrlVariable] = "http://127.0.0.1:54872";
  process.env[HOST_CONTEXT_VARIABLE] = "minted-context";
  expect(resolveLaneAndRoot()).toMatchObject({ lane: "dev" });
  expect(resolveLaneAndRoot().sourceRoot).not.toBe(foreign);
});

test("the operator CLI in a foreign cwd with no host env still refuses", () => {
  expect(() => resolveLaneAndRoot()).toThrow(/does not match|checkout/i);
  // A URL alone is not the host's identity: the context must ride with it.
  process.env[hostProcessIdentity.hostBaseUrlVariable] = "http://127.0.0.1:54872";
  expect(() => resolveLaneAndRoot()).toThrow(/does not match|checkout/i);
});

test("pea mcp --host refuses lane tokens and paths at parse, before any receipt read", () => {
  for (const token of ["dev", "installed", "C:\some\path"])
    expect(() => verifyMcpHost(token)).toThrow(
      `pea mcp --host takes the host URL only; '${token}' is a lane token or path, which only the operator CLI resolves.`,
    );
});

test("pea mcp names both checkouts when an unverifiable host meets a foreign cwd", () => {
  expect(() => verifyMcpHost("http://127.0.0.1:1")).toThrow(
    new RegExp(
      `pea mcp cannot start: .*The cwd checkout is ${foreign.replaceAll("\\", "\\\\")}; this module's checkout is `,
    ),
  );
});
