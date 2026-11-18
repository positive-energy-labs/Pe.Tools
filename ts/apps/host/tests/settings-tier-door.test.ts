import { notices as storedNotices } from "@pe/host-contracts/kinds";
import { stateMachine } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { sha256Hex } from "@pe/host-contracts/kinds";
import { noticeRows } from "../src/notice-feed.ts";
import { bootHost } from "./real-server.ts";
import { BRIDGE_CONTRACT_VERSION, BRIDGE_PATH, HOST_RUNTIME_SERVICE_QUERY, type BridgeFrame } from "@pe/host-contracts/contracts";
import { ownedSession } from "./callers.ts";
import { hostOwnership, hostState } from "../src/host-ownership.ts";
import { homeWritesKind } from "../src/tiered-settings.ts";
import { bindWork, workTimelineSchema } from "@pe/agent-contracts";

vi.mock("../src/pe-revit-launch.ts", async original => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

// Mutants: remove the effect adapter, or drop its project pointer. The HTTP receipt fails before writing.
test.each(["firm", "project"] as const)("settings.tiers.write crosses /actions, keeps prior %s bytes and posts one notice", async (tier) => {
  const drive = mkdtempSync(join(tmpdir(), "pe-tier-door-"));
  const firm = join(drive, "04 PE Software Files", "Pe.Tools");
  mkdirSync(firm, { recursive: true });
  writeFileSync(join(firm, "pe-home.json"), JSON.stringify({ tier: "firm" }));
  const pointer = "Projects/target";
  const home = tier === "firm" ? firm : join(drive, pointer, "Pe.Tools");
  mkdirSync(join(home, "Settings"), { recursive: true });
  writeFileSync(join(home, "pe-home.json"), JSON.stringify({ tier }));
  const path = join(home, "Settings", "ducts.json");
  const prior = Buffer.from('{"criteria":{"allowanceInWg":{"return":0.2}}}\n');
  writeFileSync(path, prior);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  const host = await bootHost();
  let socket: WebSocket | undefined;
  try {
    const isolatedRoot = process.env.PE_TEST_HOME_ROOT;
    if (!isolatedRoot) throw Error("Expected isolated test state");
    expect(relative(isolatedRoot, homeWritesKind.in(hostState()).path)).not.toMatch(/^\.\.(?:[\\/]|$)/);
    let target: unknown = { kind: "host" };
    let documentRef: { session: string; openId: string } | undefined;
    if (tier === "project") {
      socket = new WebSocket(`${host.base.replace("http:", "ws:")}${BRIDGE_PATH}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`);
      await new Promise<void>((resolve, reject) => {
        socket!.addEventListener("open", () => resolve(), { once: true });
        socket!.addEventListener("error", reject, { once: true });
      });
      const ack = new Promise<BridgeFrame>(resolve => socket!.addEventListener("message", event => resolve(JSON.parse(String(event.data))), { once: true }));
      socket.send(JSON.stringify({ kind: "Registration", registration: {
        contractVersion: BRIDGE_CONTRACT_VERSION, processId: 42, processStartUtcUnixMs: 1000, ...ownedSession,
        state: {
          activeDocumentIsFamilyDocument: false, activeDocumentIsModelInCloud: false,
          activeDocumentIsWorkshared: false, activeDocumentObservedAtUnixMs: 1,
          hasActiveDocument: false, revitVersion: "fixture", runtimeFramework: "test", runtimeAssemblies: [],
          openDocuments: [{ openId: "target-open", title: "Target", address: null, isActive: false, isFamilyDocument: false, projectHome: pointer }],
        },
      } }));
      const registered = await ack;
      expect(registered.registrationAck?.accepted).toBe(true);
      documentRef = { session: registered.registrationAck!.sessionId!, openId: "target-open" };
      target = { kind: "document", ref: documentRef };
    }
    const headers = { "content-type": "application/json", "x-pe-context": host.terminal };
    const id = randomUUID();
    const posted = await fetch(`${host.base}/actions`, {
      method: "POST", headers,
      body: JSON.stringify({ id, key: "settings.tiers.write", target,
        input: { owner: "ducts", tier, path: ["criteria", "allowanceInWg", "return"], value: 0.35, expectedSha256: sha256Hex(prior) } }),
    });
    expect(posted.status, await posted.clone().text()).toBeLessThan(400);
    const settled = await fetch(`${host.base}/actions?id=${id}&wait=10000`, { headers });
    const [receipt] = await settled.json();
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded", result: { path, priorSha256: sha256Hex(prior) } });
    // Mutant H9-refusal: return LocalOpError for a known CAS refusal.
    const refusedId = randomUUID();
    const beforeRefusal = readFileSync(path);
    await fetch(`${host.base}/actions`, {
      method: "POST", headers,
      body: JSON.stringify({ id: refusedId, key: "settings.tiers.write", target,
        input: { owner: "ducts", tier, path: ["criteria", "allowanceInWg", "return"], value: 0.9, expectedSha256: sha256Hex(prior) } }),
    });
    const [refused] = await (await fetch(`${host.base}/actions?id=${refusedId}&wait=10000`, { headers })).json();
    expect(readFileSync(path)).toEqual(beforeRefusal);
    expect(refused).toMatchObject({ state: "failed", notDispatched: true, refusal: { kind: "stale" }, outcome: { state: "stale", reason: expect.stringContaining("changed since it was read") } });
    expect(refused.outcome.recovery).not.toBe("retry");
    const invalidId = randomUUID();
    await fetch(`${host.base}/actions`, {
      method: "POST", headers,
      body: JSON.stringify({ id: invalidId, key: "settings.tiers.write", target,
        input: { owner: "ducts", tier, path: ["undeclared"], value: 1, expectedSha256: sha256Hex(beforeRefusal) } }),
    });
    const [invalid] = await (await fetch(`${host.base}/actions?id=${invalidId}&wait=10000`, { headers })).json();
    expect(invalid).toMatchObject({ state: "failed", status: 422, notDispatched: true, refusal: { kind: "invalid" }, outcome: { state: "refused" } });
    expect(invalid.outcome.recovery).toBeUndefined();
    expect(readFileSync(path)).toEqual(beforeRefusal);
    const rows = noticeRows({ threads: [], works: [], machine: null, stored: [], receipts: [{ revision: 1, action: refused }] }, Date.now());
    expect(rows).toMatchObject([{ group: "failed", verb: "stale", says: expect.stringContaining("changed since it was read") }]);
    expect(rows.some(row => row.group === "waits")).toBe(false);
    const bytes = readFileSync(path);
    expect(sha256Hex(bytes)).not.toBe(sha256Hex(prior));
    expect(JSON.parse(bytes.toString())).toMatchObject({ criteria: { allowanceInWg: { return: 0.35 } } });
    expect(receipt.result.sha256).toBe(sha256Hex(bytes));
    expect(readFileSync(join(hostState().blobs, "sha256", sha256Hex(prior)))).toEqual(prior);
    // Mutant H9-notice: omit the action receipt id from the saved-setting notice.
    expect(storedNotices(stateMachine(storedParent(hostState().notices))).find(notice => notice.path === path)?.reason).toContain(receipt.id);
    expect(storedNotices(stateMachine(storedParent(hostState().notices))).filter(notice => notice.path === path)).toMatchObject([
      { class: "keep", sha256: sha256Hex(bytes), reason: expect.stringContaining(sha256Hex(prior)) },
    ]);
    const works = [bindWork("duct-systems", null, documentRef ? undefined : "tier-proof", documentRef)];
    const timeline = async () => {
      const response = await fetch(`${host.base}/pe/reads/value`, { method: "POST", headers,
        body: JSON.stringify({ read: "work.timeline", args: { works }, subscription: randomUUID(), generation: 0 }) });
      const wire = await response.json();
      expect(wire, JSON.stringify(wire)).toMatchObject({ state: "current" });
      return workTimelineSchema.parse(wire.value.data);
    };
    const query = documentRef ? `open=${encodeURIComponent(`${documentRef.session}/${documentRef.openId}`)}` : "work=tier-proof";
    const undo = async (expected: unknown) => (await fetch(`${host.base}/pe/route-state/duct-systems/history?${query}`, {
      method: "POST", headers, body: JSON.stringify({ direction: "undo", works, expected }),
    })).json();
    // Mutant ST7a-no-restore: acknowledge the undo without restoring prior bytes.
    const shown = (await timeline()).undo;
    expect(shown, JSON.stringify(await timeline())).toMatchObject({ home: path, sha256: sha256Hex(bytes) });
    expect(await undo(shown)).toMatchObject({ ok: true });
    expect(readFileSync(path)).toEqual(prior);
    const secondId = randomUUID();
    await fetch(`${host.base}/actions`, { method: "POST", headers,
      body: JSON.stringify({ id: secondId, key: "settings.tiers.write", target,
        input: { owner: "ducts", tier, path: ["criteria", "allowanceInWg", "return"], value: 0.45, expectedSha256: sha256Hex(prior) } }) });
    const [second] = await (await fetch(`${host.base}/actions?id=${secondId}&wait=10000`, { headers })).json();
    expect(second).toMatchObject({ state: "succeeded" });
    const next = (await timeline()).undo;
    expect(next).not.toBeNull();
    // Mutant ST7a-no-cas: remove the freshness check and restore over an external edit.
    const external = Buffer.from('{"external":true}');
    writeFileSync(path, external);
    expect(await undo(next)).toMatchObject({ ok: false, error: expect.stringContaining("changed since the save") });
    expect(readFileSync(path)).toEqual(external);
  } finally {
    if (socket) {
      const closed = new Promise<void>(resolve => socket!.addEventListener("close", () => resolve(), { once: true }));
      socket.close();
      await closed;
    }
    await host.close();
    vi.unstubAllEnvs();
    rmSync(drive, { recursive: true, force: true });
  }
}, 30000);
