import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { familyTypesRouteState } from "@pe/agent-contracts";
import { applyRouteStatePatches, registerRouteState } from "../src/route-state-dispatch.ts";
import type { RouteStateSession } from "../src/route-state-dispatch.ts";
import { createRouteStateStore, makeDurableRouteStateSession } from "../src/route-state-store.ts";

registerRouteState(familyTypesRouteState, {
  parse_spec: async () => ({ stub: true }),
  refresh_snapshot: async () => ({ stub: true }),
  push: async () => ({ stub: true }),
});

const RESOURCE_ID = "pea:d29ya3NwYWNl";

/** A fresh in-memory session — mimics the AgentController state reset on host restart. */
function fakeSession(): RouteStateSession {
  let state: Record<string, unknown> = {};
  return {
    getState: () => state,
    update: async (updater) => {
      const { updates, result } = updater(state);
      if (updates) state = { ...state, ...updates };
      return result;
    },
  };
}

test("route-state doc survives a simulated host restart (write → new store/session → rehydrate)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pe-route-state-"));
  try {
    // ── boot 1: stage a human edit through the durable session ──
    const store1 = createRouteStateStore(RESOURCE_ID, dir);
    const session1 = await makeDurableRouteStateSession(fakeSession(), store1);
    const write = await applyRouteStatePatches(session1, "family-types", "human", [
      { path: ["binding", "target"], value: "sandbox:abc" },
    ]);
    expect(write.ok).toBe(true);

    // ── restart: brand-new store + brand-new (empty) session over the SAME directory ──
    const store2 = createRouteStateStore(RESOURCE_ID, dir);
    const rawSession = fakeSession();
    expect(rawSession.getState()[familyTypesRouteState.key]).toBeUndefined();

    const session2 = await makeDurableRouteStateSession(rawSession, store2);
    const rehydrated = session2.getState()[familyTypesRouteState.key] as {
      binding?: { target?: string };
    };
    expect(rehydrated?.binding?.target).toBe("sandbox:abc");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-route session state is never persisted or rehydrated", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pe-route-state-"));
  try {
    const store = createRouteStateStore(RESOURCE_ID, dir);
    const session = await makeDurableRouteStateSession(fakeSession(), store);
    await session.update(() => ({
      updates: {
        currentModelId: "gpt",
        [familyTypesRouteState.key]: { binding: { target: null } },
      },
      result: undefined,
    }));

    expect(store.read().currentModelId).toBeUndefined();
    expect(store.read()[familyTypesRouteState.key]).toBeDefined();

    // A fresh session rehydrates only the route slice.
    const reborn = fakeSession();
    await makeDurableRouteStateSession(reborn, createRouteStateStore(RESOURCE_ID, dir));
    expect(reborn.getState().currentModelId).toBeUndefined();
    expect(reborn.getState()[familyTypesRouteState.key]).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
