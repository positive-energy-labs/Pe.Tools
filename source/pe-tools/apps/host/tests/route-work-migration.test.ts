import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  familiesRouteState,
  parameterLinksRouteState,
  workKey,
  type WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.unstubAllEnvs();
});

const scope: WorkKey = { route: "families", target: address("C:/Tower.rvt") };
const profile = {
  formatVersion: 1,
  definitions: [
    {
      id: "d1",
      sourceCategoryId: -2001000,
      sourceParameter: { name: "MCA" },
      sourceScope: "instanceThenType" as const,
      relationship: "sameElement" as const,
      targetParameter: { name: "Load" },
      reducer: "first" as const,
    },
  ],
  assignments: [],
};
/** The Families envelope as it was persisted before observations moved to their own owner. */
const legacyFamilies = {
  version: 1,
  revision: 7,
  doc: {
    bindings: { profile: { id: "desk", label: "Desk" } },
    profilePath: "desk.json",
    plan: {
      reading: { at: "C:/Tower.rvt", version: "v1", observedAt: "2026-08-25T00:00:00Z" },
      entries: [
        {
          familyId: 1,
          familyName: "Box",
          planHash: "h1",
          changes: [],
          runEffects: [],
          refusals: [],
          warnings: [],
        },
      ],
    },
    excludedIds: [104],
    apply: { diagnostics: [], appliedAt: "2026-08-25T01:00:00Z", receipts: [], artifacts: [] },
  },
};
const legacyParameterLinks = {
  version: 1,
  revision: 3,
  doc: {
    profile,
    draftProfile: { ...profile, assignments: [{ id: "a1", definitionId: "d1", enabled: true }] },
    evaluation: {
      writes: [],
      issues: [],
      sourceElementCount: 1,
      targetElementCount: 1,
      changedWriteCount: 1,
    },
    status: {
      hasStoredProfile: true,
      updaterRegistered: true,
      activeDefinitionCount: 1,
      activeAssignmentCount: 1,
    },
    profileChanged: true,
    appliedWriteCount: 4,
  },
};

async function setup(seed: Record<string, unknown> = {}) {
  vi.stubEnv("PE_LANE", "dev");
  const dir = await mkdtemp(join(tmpdir(), "pe-route-migration-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const rows = new Map<string, unknown>(Object.entries(seed));
  const captures = new TakeoffCaptures(join(dir, "captures"));
  const migrate = (route: "families" | "parameter-links") => (raw: unknown, at: WorkKey) =>
    captures.migrateRouteWork(raw, at, route);
  const work = new RouteWorkspace({
    registrations: [
      { spec: familiesRouteState, handlers: {}, migrate: migrate("families") },
      { spec: parameterLinksRouteState, handlers: {}, migrate: migrate("parameter-links") },
    ],
    store: {
      getState: async ({ targetKey, route }) => rows.get(targetKey + route),
      setState: async ({ targetKey, route, value }) => {
        rows.set(targetKey + route, structuredClone(value));
      },
    },
  });
  return { work, captures, rows };
}
const key = (route: string) => workKey(scope) + route;

test("unseeded Work migrates to nothing and stays absent", async () => {
  const { work, captures, rows } = await setup();
  expect(await work.read(scope, "families")).toBeNull();
  expect(rows.size).toBe(0);
  expect(await captures.familyReadings(scope)).toEqual([]);
});

test("a saved Families envelope keeps its authored input and archives the rest", async () => {
  const { work, captures } = await setup({ [key("families")]: legacyFamilies });
  const view = (await work.read(scope, "families"))!;
  const doc = familiesRouteState.schema.parse(view.doc);
  // The human's profile and exclusions are exactly as they were saved.
  expect(doc.profilePath).toBe("desk.json");
  expect(doc.excludedIds).toEqual([104]);
  expect(view.revision).toBe(7);
  // Nothing observational survives in Work.
  expect(JSON.stringify(view.doc)).not.toContain("planHash");
  expect(JSON.stringify(view.doc)).not.toContain("bindings");
  // ...and nothing observational was destroyed either: it is archived as evidence.
  const archived = await captures.familyReadings(scope);
  expect(archived).toHaveLength(1);
  expect(archived[0]!.provenance.kind).toBe("legacy-unknown");
  expect(JSON.stringify(archived[0]!.reading.value)).toContain("planHash");
  expect(JSON.stringify(archived[0]!.reading.value)).toContain("bindings");
});

test("a saved Parameter Links envelope keeps the draft the human was editing", async () => {
  const { work, captures } = await setup({ [key("parameter-links")]: legacyParameterLinks });
  const doc = parameterLinksRouteState.schema.parse(
    (await work.read(scope, "parameter-links"))!.doc,
  );
  expect(doc.draft?.assignments).toEqual([
    { id: "a1", definitionId: "d1", enabled: true, sourceElementUniqueIds: [] },
  ]);
  expect(JSON.stringify(doc)).not.toContain("appliedWriteCount");
  expect(JSON.stringify((await captures.familyReadings(scope))[0]!.reading.value)).toContain(
    "appliedWriteCount",
  );
});

test("a stored profile with no draft becomes the draft, because it was what the editor showed", async () => {
  const { work } = await setup({
    [key("parameter-links")]: {
      version: 1,
      revision: 1,
      doc: { profile, draftProfile: null, profileChanged: false, appliedWriteCount: 0 },
    },
  });
  const doc = parameterLinksRouteState.schema.parse(
    (await work.read(scope, "parameter-links"))!.doc,
  );
  expect(doc.draft).toEqual(profile);
});

test("an uncertain legacy operation is preserved as evidence and never resolved by migrating", async () => {
  const { work, captures } = await setup({
    [key("families")]: {
      ...legacyFamilies,
      outcomeUnknown: { command: "apply", startedAt: "2026-08-25T01:00:00Z" },
    },
  });
  const view = (await work.read(scope, "families"))!;
  expect(view.status).toBe("outcomeUnknown");
  expect(view.outcomeUnknown).toMatchObject({ command: "apply" });
  // The uncertainty is archived too, and the reading is evidence, not a resolution.
  expect(JSON.stringify((await captures.familyReadings(scope))[0]!.reading.value)).toContain(
    "outcomeUnknown",
  );
});

test("a malformed legacy document cannot silently discard the human's input", async () => {
  const { work, captures } = await setup({
    [key("families")]: {
      version: 1,
      revision: 2,
      // `plan` is unparseable and `excludedIds` has the wrong type: the schema would reject both.
      doc: { profilePath: "desk.json", excludedIds: "104", plan: "corrupt" },
    },
  });
  // The read refuses rather than handing back a document with the human's fields dropped.
  await expect(work.read(scope, "families")).rejects.toThrow(/invalid persisted document/);
  // The legacy bytes were archived first, so nothing is lost and a human can recover them.
  const archived = await captures.familyReadings(scope);
  expect(archived).toHaveLength(1);
  expect(JSON.stringify(archived[0]!.reading.value)).toContain("corrupt");
});

test("an already-authored document is left byte-identical and archives nothing", async () => {
  const authored = {
    version: 1,
    revision: 4,
    doc: {
      profilePath: "desk.json",
      scope: { categoryNames: ["Ducts"], familyNames: ["Box"], placementScope: "AllLoaded" },
      excludedIds: [],
    },
  };
  const { work, captures, rows } = await setup({ [key("families")]: authored });
  const view = (await work.read(scope, "families"))!;
  expect(view.revision).toBe(4);
  expect(rows.get(key("families"))).toEqual(authored);
  expect(await captures.familyReadings(scope)).toEqual([]);
});

test("migrating twice archives once: the second pass has nothing left to retire", async () => {
  const { work, captures } = await setup({ [key("families")]: legacyFamilies });
  await work.read(scope, "families");
  await work.read(scope, "families");
  expect(await captures.familyReadings(scope)).toHaveLength(1);
});
