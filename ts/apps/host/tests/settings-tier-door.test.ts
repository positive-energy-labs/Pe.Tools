import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { readStoredNotices, sha256Hex } from "@pe/host-contracts/store";
import { storedBlobsPath, storedNoticesPath } from "../src/notice-feed.ts";
import { bootHost } from "./real-server.ts";

vi.mock("../src/pe-revit-launch.ts", async original => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

// Mutant: remove settings.tiers.write's effect adapter. The HTTP receipt fails before writing.
test("settings.tiers.write crosses /actions, keeps prior firm bytes and posts one notice", async () => {
  const firm = mkdtempSync(join(tmpdir(), "pe-tier-door-"));
  writeFileSync(join(firm, "pe-home.json"), JSON.stringify({ tier: "firm" }));
  mkdirSync(join(firm, "Settings"));
  const path = join(firm, "Settings", "ducts.json");
  const prior = Buffer.from('{"criteria":{"allowanceInWg":{"return":0.2}}}\n');
  writeFileSync(path, prior);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  const host = await bootHost();
  try {
    const headers = { "content-type": "application/json", "x-pe-context": host.terminal };
    const id = randomUUID();
    const posted = await fetch(`${host.base}/actions`, {
      method: "POST", headers,
      body: JSON.stringify({ id, key: "settings.tiers.write", target: { kind: "host" },
        input: { owner: "ducts", tier: "firm", path: ["criteria", "allowanceInWg", "return"], value: 0.35, expectedSha256: sha256Hex(prior) } }),
    });
    expect(posted.status, await posted.clone().text()).toBeLessThan(400);
    const settled = await fetch(`${host.base}/actions?id=${id}&wait=10000`, { headers });
    const [receipt] = await settled.json();
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded", result: { path, priorSha256: sha256Hex(prior) } });
    const bytes = readFileSync(path);
    expect(sha256Hex(bytes)).not.toBe(sha256Hex(prior));
    expect(JSON.parse(bytes.toString())).toMatchObject({ criteria: { allowanceInWg: { return: 0.35 } } });
    expect(receipt.result.sha256).toBe(sha256Hex(bytes));
    expect(readFileSync(join(storedBlobsPath(), "sha256", sha256Hex(prior)))).toEqual(prior);
    expect(readStoredNotices(storedNoticesPath()).filter(notice => notice.path === path)).toMatchObject([
      { class: "keep", sha256: sha256Hex(bytes), reason: expect.stringContaining(sha256Hex(prior)) },
    ]);
  } finally {
    await host.close();
    vi.unstubAllEnvs();
    rmSync(firm, { recursive: true, force: true });
  }
}, 30000);
