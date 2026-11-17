import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { sha256Hex } from "@pe/host-contracts/kinds";
import * as tiers from "../src/tiered-settings.ts";
import { callRouteOver, captureStore, detachedBridge, journalAt, sessionView, testHostInputs } from "./effect-test.ts";
import { contextHeaders } from "./callers.ts";
import { serveRoutes } from "./real-server.ts";
import { bindWork } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { hostTimeline } from "../src/reads/work-timeline.ts";
import { approvedPea, human, pea } from "./callers.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { createPeRoutes } from "../src/pe-routes.ts";
import { hostState } from "../src/host-ownership.ts";
import { readLines } from "@pe/host-contracts/kinds";

function homeHistory() {
  const root = mkdtempSync(join(tmpdir(), "pe-tier-history-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  const firm = join(root, "firm");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  mkdirSync(join(firm, "Settings"), { recursive: true });
  writeFileSync(join(firm, "pe-home.json"), JSON.stringify({ tier: "firm" }));
  const path = join(firm, "Settings", "ducts.json");
  writeFileSync(path, '{"designFriction":0.07}');
  const owner = journalAt(join(root, "actions.json"), Date.now);
  const registrations = [{ spec: { route: "duct-systems", title: "Ducts", description: "Proof", schema: z.object({}) } }];
  const workspace = new RouteWorkspace({ registrations, store: { getState: async () => null, setState: async () => {} } });
  const timeline = hostTimeline(workspace, owner);
  const routes = createPeRoutes({ workspace, registrations, journal: owner });
  const works = [bindWork("duct-systems", null, "home-history")];
  return {
    path,
    read: () => timeline.read(works, "human"),
    save(value: number) {
      const wrote = tiers.writeSettingTier({ owner: "ducts", tier: "firm", path: ["designFriction"], value, expectedSha256: sha256Hex(readFileSync(path)) }, { caller: human });
      if (!wrote.ok) throw Error(wrote.message);
      const row = tiers.homeWriteSource.rows({ owner: "ducts", homes: [firm] }).findLast(row => row.path === path && row.sha256 === wrote.sha256);
      if (!row) throw Error("Expected the saved home row");
      return { home: path, sha256: wrote.sha256, label: row.place };
    },
    async step(expected: unknown, caller = human, direction = "undo") {
      const response = await withInvocationContext({ caller }, () => routes.fetch(new Request("http://host/pe/route-state/duct-systems/history?work=home-history", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction, works, expected }),
      })));
      return response.json();
    },
    async close() { await owner.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("home-write step doors refuse Pea naming a human save, preserving the file", async () => {
  const f = homeHistory();
  try {
    const ref = f.save(0.08), caller = pea("foreign-home");
    const before = readFileSync(f.path);
    expect(await f.step(ref, caller)).toMatchObject({ ok: false });
    expect(readFileSync(f.path)).toEqual(before);
    // ST7b-no-author: the source door must guard even when called without the outer selector.
    expect(() => tiers.homeWriteSource.step(ref, caller)).toThrow("Only the save's author");
    expect(readFileSync(f.path)).toEqual(before);
  } finally { await f.close(); }
});

test("home undo consumes the newest write, exposes the older write and explains redo", async () => {
  const f = homeHistory();
  try {
    const older = f.save(0.08), latest = f.save(0.09);
    expect(await f.step(latest)).toMatchObject({ ok: true });
    const log = readLines(tiers.homeWritesKind.in(hostState()));
    expect(log.kind).toBe("ok");
    // ST7b-no-consumption-record: successful undo keeps its durable provenance.
    expect(log.kind === "ok" && log.values.some(row => row.kind === "home-undo" && row.path === f.path && row.sha256 === latest.sha256)).toBe(true);
    expect((await f.read()).undo).toMatchObject(older);
    expect((await f.read()).redo).toBeNull();
    expect((await f.read()).refusal.redo).toContain("redo is not supported");
    // ST7b-silent-redo: the command door carries the same explanation.
    expect(await f.step(latest, human, "redo")).toMatchObject({ ok: false, error: expect.stringContaining("redo is not supported") });
    // Model death after restoration but before the completion append by removing only that row.
    if (log.kind !== "ok") throw Error("Expected the home-write log");
    writeFileSync(tiers.homeWritesKind.in(hostState()).path, log.values.filter(row => !(row.kind === "home-undo" && row.path === f.path && row.sha256 === latest.sha256)).map(row => JSON.stringify(row)).join("\n") + "\n");
    expect((await f.read()).undo).toMatchObject(older);
    expect(await f.step(older)).toMatchObject({ ok: true });
    expect((await f.read()).undo).toBeNull();
  } finally { await f.close(); }
});

test("home Timeline refuses undo when the prior blob is missing", async () => {
  const f = homeHistory();
  try {
    const prior = readFileSync(f.path);
    const ref = f.save(0.08);
    expect((await f.read()).rows).toContainEqual(expect.objectContaining({ path: f.path, undoable: true }));
    rmSync(join(hostState().blobs, "sha256", sha256Hex(prior)));
    // ST7b-ignore-missing-blob: deleting the rested check must make this flag lie.
    expect((await f.read()).rows).toContainEqual(expect.objectContaining({ path: f.path, undoable: false }));
    expect((await f.read()).refusal.undo).toContain("prior bytes are unavailable");
    expect(sha256Hex(readFileSync(f.path))).toBe(ref.sha256);
  } finally { await f.close(); }
});

test("Pea's first home write records its caller and refuses undo with a reason, keeping the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-tier-first-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  const firm = join(root, "firm");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  mkdirSync(firm, { recursive: true });
  writeFileSync(join(firm, "pe-home.json"), JSON.stringify({ tier: "firm" }));
  const owner = journalAt(join(root, "actions.json"), Date.now);
  const server = await serveRoutes(callRouteOver(owner, captureStore(join(root, "captures"))).pipe(Layer.provide(testHostInputs)), detachedBridge());
  const caller = approvedPea("tier-first");
  if (caller.kind !== "pea") throw Error("Expected a Pea fixture caller");
  try {
    const headers = { "content-type": "application/json", ...contextHeaders({ kind: "pea", thread: caller.thread, run: caller.run, root: caller.root }) };
    const id = randomUUID();
    const posted = await fetch(`${server.base}/actions`, { method: "POST", headers, body: JSON.stringify({ id, key: "settings.tiers.write", target: { kind: "host" },
      input: { owner: "ducts", tier: "firm", path: ["designFriction"], value: 0.08, expectedSha256: null } }) });
    expect(posted.status, await posted.clone().text()).toBeLessThan(300);
    const [receipt] = await (await fetch(`${server.base}/actions?id=${id}&wait=10000`, { headers })).json();
    expect(receipt).toMatchObject({ state: "succeeded", result: { priorSha256: null } });
    const wrote = z.object({ path: z.string(), sha256: z.string() }).parse(receipt.result);
    const before = readFileSync(wrote.path);
    const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
    const timeline = hostTimeline(workspace, owner);
    const works = [bindWork("duct-systems", null, "first-write")];
    const shown = await timeline.read(works, "pea");
    // Mutant ST7a-human-stamp: replace the saved Caller with a human.
    expect(shown.rows).toContainEqual(expect.objectContaining({ kind: "home-write", path: wrote.path, by: expect.objectContaining({ kind: "pea", thread: caller.thread }), undoable: false }));
    // Mutant ST7a-first-write: offer undo when no prior bytes exist.
    expect(shown.undo).toBeNull();
    expect(shown.refusal.undo).toContain("file was new");
    expect(await timeline.step({ direction: "undo", works, expected: { home: wrote.path, sha256: wrote.sha256, label: "first" } }, caller, "pea")).toMatchObject({ ok: false, error: expect.stringContaining("file was new") });
    expect(readFileSync(wrote.path)).toEqual(before);
  } finally {
    await server.close();
    await owner.close();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

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
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ refusal: { kind: "stale" }, outcome: { state: "stale", reason: expect.stringContaining("changed") } });
    expect(receipt.outcome.recovery).not.toBe("retry");
    for (const path of paths) expect(readFileSync(path)).toEqual(prior);
  } finally {
    gate.mockRestore();
    await server.close();
    await owner.close();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
