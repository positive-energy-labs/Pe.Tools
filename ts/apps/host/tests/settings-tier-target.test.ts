import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { sha256Hex } from "@pe/host-contracts/store";
import * as tiers from "../src/tiered-settings.ts";
import { callRouteOver, captureStore, detachedBridge, journalAt, sessionView, testHostInputs } from "./effect-test.ts";
import { contextHeaders } from "./callers.ts";
import { serveRoutes } from "./real-server.ts";

// Mutant H9-target: drop the prepared tier path check; identical hashes allow a write to the wrong home.
test("/actions refuses a tier write when the fixture document pointer changes after binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-tier-target-"));
  const firm = join(root, "04 PE Software Files", "Pe.Tools");
  mkdirSync(firm, { recursive: true });
  writeFileSync(join(firm, "pe-home.json"), JSON.stringify({ tier: "firm" }));
  const prior = Buffer.from('{"criteria":{"allowanceInWg":{"return":0.2}}}');
  const paths = ["before", "after"].map(name => {
    const home = join(root, "Projects", name, "Pe.Tools");
    mkdirSync(join(home, "Settings"), { recursive: true });
    writeFileSync(join(home, "pe-home.json"), JSON.stringify({ tier: "project" }));
    const path = join(home, "Settings", "ducts.json");
    writeFileSync(path, prior);
    return path;
  });
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "user"));
  const document = { openId: "doc", projectHome: "Projects/before" };
  const bridge = detachedBridge({ list: Effect.sync(() => [sessionView({
    connected: true, sessionId: "fixture", state: { openDocuments: [document] },
  })]) });
  const owner = journalAt(join(root, "actions.json"), Date.now);
  const original = tiers.readSettingTiers;
  let changed = false;
  const gate = vi.spyOn(tiers, "readSettingTiers").mockImplementation((...args) => {
    const result = original(...args);
    // The bind captured the first path. Change the model before execution can resolve it again.
    if (!changed) {
      document.projectHome = "Projects/after";
      changed = true;
    }
    return result;
  });
  const server = await serveRoutes(callRouteOver(owner, captureStore(join(root, "captures"))).pipe(Layer.provide(testHostInputs)), bridge);
  try {
    const id = randomUUID();
    const headers = { "content-type": "application/json", ...contextHeaders() };
    const posted = await fetch(`${server.base}/actions`, { method: "POST", headers, body: JSON.stringify({
      id, key: "settings.tiers.write", target: { kind: "document", ref: { session: "fixture", openId: "doc" } },
      input: { owner: "ducts", tier: "project", path: ["criteria", "allowanceInWg", "return"], value: 0.35, expectedSha256: sha256Hex(prior) },
    }) });
    expect(posted.status, await posted.clone().text()).toBeLessThan(300);
    const [receipt] = await (await fetch(`${server.base}/actions?id=${id}&wait=10000`, { headers })).json();
    expect(changed).toBe(true);
    expect(receipt.prepared).toMatchObject({ state: "ready", value: { settingPath: paths[0] } });
    expect(receipt.effects).toContainEqual({ kind: "file", path: paths[0] });
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ outcome: { state: "refused", reason: expect.stringContaining("changed") } });
    for (const path of paths) expect(readFileSync(path)).toEqual(prior);
  } finally {
    gate.mockRestore();
    await server.close();
    await owner.close();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
