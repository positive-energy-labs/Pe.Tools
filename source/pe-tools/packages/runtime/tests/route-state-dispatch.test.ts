import { expect, test } from "vite-plus/test";
import { familyTypesRouteState, parameterLinksRouteState } from "@pe/agent-contracts";
import {
  applyRouteStatePatches,
  registerRouteState,
  runRouteStateCommand,
  type RouteStateSession,
} from "../src/route-state-dispatch.ts";

// The real seam: the family-types spec (schema + mask + human-only push) with stub
// command handlers, driven against a fake in-memory session (serialized like the real
// AgentController state transaction).
registerRouteState(familyTypesRouteState, {
  parse_spec: async () => ({ stub: true }),
  refresh_snapshot: async () => ({ stub: true }),
  push: async () => ({ stub: true }),
});
registerRouteState(parameterLinksRouteState, {
  refresh: async () => ({ stub: true }),
  preview: async () => ({ stub: true }),
  apply: async () => ({ stub: true }),
});

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

const KEY = familyTypesRouteState.key;
const CELL = "Width::Type A";

test("agent patch outside the write mask is rejected with a hint, no write", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "family-types", "agent", [
    { path: ["cells", CELL, "staged"], value: "10" },
  ]);
  expect(result.ok).toBe(false);
  expect(result.hint).toContain("human-only");
  expect(session.getState()[KEY]).toBeUndefined();
});

test("allowed agent proposal patch applies and lands in state", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "family-types", "agent", [
    { path: ["cells", CELL, "proposal"], value: { value: "10", confidence: "high" } },
  ]);
  expect(result.ok).toBe(true);
  const doc = session.getState()[KEY] as {
    cells: Record<string, { proposal?: { value: string } }>;
  };
  expect(doc.cells[CELL].proposal?.value).toBe("10");
});

test("human actor bypasses the mask and can stage", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "family-types", "human", [
    { path: ["cells", CELL, "staged"], value: { value: "10" } },
  ]);
  expect(result.ok).toBe(true);
  const doc = session.getState()[KEY] as {
    cells: Record<string, { staged?: { value: string } }>;
  };
  expect(doc.cells[CELL].staged).toEqual({ value: "10" });
});

test("human-only command rejects the agent actor with a hint", async () => {
  const session = fakeSession();
  const result = await runRouteStateCommand(session, "family-types", "agent", "push", {});
  expect(result.ok).toBe(false);
  expect(result.hint).toContain("human");
  // A human is allowed through to the (stub) handler.
  const humanResult = await runRouteStateCommand(session, "family-types", "human", "push", {});
  expect(humanResult.ok).toBe(true);
});

test("post-patch schema refinement rejects an unmarked low-confidence proposal", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "family-types", "agent", [
    { path: ["cells", CELL, "proposal"], value: { value: "10", confidence: "low" } },
  ]);
  expect(result.ok).toBe(false);
  expect(result.hint).toContain("low-confidence proposals must set review to attention");
  expect(session.getState()[KEY]).toBeUndefined();

  // Marking it for attention in the same batch satisfies the invariant.
  const ok = await applyRouteStatePatches(session, "family-types", "agent", [
    { path: ["cells", CELL, "proposal"], value: { value: "10", confidence: "low" } },
    { path: ["cells", CELL, "review"], value: "attention" },
  ]);
  expect(ok.ok).toBe(true);
});

const PARAMETER_LINK_PROFILE = {
  formatVersion: 1,
  definitions: [
    {
      id: "mocp-to-rating",
      sourceCategoryId: -2001140,
      sourceParameter: { name: "MOCP" },
      relationship: "electricalEquipmentCircuits",
      targetParameter: { name: "Rating" },
      reducer: "max",
    },
  ],
  assignments: [{ id: "all-equipment", definitionId: "mocp-to-rating" }],
};

test("parameter-links lets the agent replace only draftProfile", async () => {
  const session = fakeSession();
  const allowed = await applyRouteStatePatches(session, "parameter-links", "agent", [
    { path: ["draftProfile"], value: PARAMETER_LINK_PROFILE },
  ]);
  expect(allowed.ok).toBe(true);
  expect(
    (
      session.getState()[parameterLinksRouteState.key] as {
        draftProfile: { definitions: unknown[] };
      }
    ).draftProfile.definitions,
  ).toHaveLength(1);

  const denied = await applyRouteStatePatches(session, "parameter-links", "agent", [
    { path: ["profile"], value: PARAMETER_LINK_PROFILE },
  ]);
  expect(denied.ok).toBe(false);
  expect(denied.hint).toContain("draftProfile");
});

test("parameter-links rejects an invalid draft contract", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "parameter-links", "agent", [
    {
      path: ["draftProfile"],
      value: {
        ...PARAMETER_LINK_PROFILE,
        definitions: [{ ...PARAMETER_LINK_PROFILE.definitions[0], relationship: "nearby" }],
      },
    },
  ]);
  expect(result.ok).toBe(false);
  expect(result.hint).toContain("draftProfile.definitions.0.relationship");
  expect(session.getState()[parameterLinksRouteState.key]).toBeUndefined();
});

test("parameter-links rejects an empty profile", async () => {
  const session = fakeSession();
  const result = await applyRouteStatePatches(session, "parameter-links", "agent", [
    {
      path: ["draftProfile"],
      value: { formatVersion: 1, definitions: [], assignments: [] },
    },
  ]);
  expect(result.ok).toBe(false);
  expect(result.hint).toContain("draftProfile.definitions");
  expect(session.getState()[parameterLinksRouteState.key]).toBeUndefined();
});

test("parameter-links apply is human-only", async () => {
  const session = fakeSession();
  const input = { profile: PARAMETER_LINK_PROFILE };
  const agent = await runRouteStateCommand(session, "parameter-links", "agent", "apply", input);
  expect(agent.ok).toBe(false);
  expect(agent.hint).toContain("human");
  expect((await runRouteStateCommand(session, "parameter-links", "human", "apply", input)).ok).toBe(
    true,
  );
});
