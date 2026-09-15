import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  familiesBasis,
  familiesPlanReadingSchema,
  familiesRouteState,
  parameterLinksBasis,
  parameterLinksReadingSchema,
  parameterLinksRouteState,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { admitFamilyAction, readFamily } from "../src/family-actions.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.unstubAllEnvs();
});

const at = address("C:/Tower.rvt");
const other = address("C:/Annex.rvt");
const target = { session: "A", openId: "open-A" };
const scope = { route: "families", target: at };
const otherScope = { route: "families", target: other };
const profileBytes = JSON.stringify({ patch: { families: {} } });

const entry = (familyId: number, familyName: string, planHash: string) => ({
  familyId,
  familyName,
  planHash,
  changes: [{ section: "types", key: "Width", kind: "set" }],
  runEffects: [],
  refusals: [],
  warnings: [],
});
const link = {
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
const linkData = {
  profile: link,
  evaluation: {
    writes: [],
    issues: [],
    sourceElementCount: 2,
    targetElementCount: 2,
    changedWriteCount: 2,
  },
  status: {
    hasStoredProfile: true,
    updaterRegistered: true,
    activeDefinitionCount: 1,
    activeAssignmentCount: 0,
  },
  profileChanged: true,
  appliedWriteCount: 2,
};

async function setup() {
  vi.stubEnv("PE_LANE", "dev");
  const dir = await mkdtemp(join(tmpdir(), "pe-route-apply-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const rows = new Map<string, unknown>();
  // biome-ignore lint/suspicious/noExplicitAny: fixture bridge payloads mirror untyped host frames.
  const sent: { key: string; input: any; id?: string }[] = [];
  let planEntries = [entry(1, "Box", "h1"), entry(2, "Pipe", "h2")];
  let nativeFails = false;
  let nativeUnknown = false;
  let duringNative: (() => Promise<void>) | null = null;
  const bridge = {
    list: Effect.sync(() => [
      {
        sessionId: "A",
        connected: true,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: { openDocuments: [{ openId: "open-A", address: at, isFamilyDocument: false }] },
      },
    ]),
    invoke: (key: string, input: unknown, _s: string, _o: string, id?: string) =>
      Effect.promise(async () => {
        sent.push({ key, input, id });
        if (key === "settings.document.open")
          return {
            value: {
              rawContent: profileBytes,
              composedContent: profileBytes,
              validation: { isValid: true, issues: [] },
              metadata: { versionToken: { value: "v1" }, documentId: { stableId: "p.json" } },
            },
          };
        if (key === "familyfoundry.plan")
          return { value: { diagnostics: [], families: planEntries } };
        if (nativeUnknown) throw Object.assign(Error("bridge timeout"), { statusCode: 504 });
        if (nativeFails) throw Object.assign(Error("native refused"), { statusCode: 409 });
        if (key === "familyfoundry.apply") {
          await duringNative?.();
          return {
            value: {
              diagnostics: [],
              receipts: [
                {
                  familyId: 1,
                  familyName: "Box",
                  success: true,
                  converged: true,
                  residue: [],
                  errors: [],
                  artifactDirectory: "C:/art/1",
                },
              ],
            },
          };
        }
        await duringNative?.();
        return { value: linkData };
      }),
    // biome-ignore lint/suspicious/noExplicitAny: the fixture implements only what the host calls.
  } as any;
  const work = new RouteWorkspace({
    registrations: [
      { spec: familiesRouteState, handlers: {} },
      { spec: parameterLinksRouteState, handlers: {} },
    ],
    store: {
      getState: async ({ targetKey, route }) => rows.get(targetKey + route),
      setState: async ({ targetKey, route, value }) => {
        rows.set(targetKey + route, structuredClone(value));
      },
    },
  });
  const captures = new TakeoffCaptures(join(dir, "captures"));
  const owner = new ActionJournal(join(dir, "actions.json"));
  // biome-ignore lint/suspicious/noExplicitAny: the SDK reader is the shared native-receipt fixture.
  const deps = { workspace: work, sdk: sdkSessions } as any;
  const read = (key: string, input: unknown = {}, readScope = scope) =>
    readFamily({ key, input, scope: readScope, target }, captures, bridge, deps);
  const admit = async (
    key: string,
    input: unknown,
    revision: number,
    id = `${key}${revision}`,
    actor: "human" | "agent" = "human",
  ) => {
    const row = await admitFamilyAction(
      {
        id,
        kind: "workflow",
        key,
        actor,
        destination: { kind: "document", ref: target },
        input,
        bases: { work: { key: scope, revision } },
      },
      owner,
      captures,
      bridge,
      deps,
    );
    return owner.wait(row.id);
  };
  return {
    work,
    owner,
    captures,
    sent,
    read,
    admit,
    entries: (next: typeof planEntries) => {
      planEntries = next;
    },
    fail: (v: boolean) => {
      nativeFails = v;
    },
    unknown: (v: boolean) => {
      nativeUnknown = v;
    },
    during: (f: () => Promise<void>) => {
      duringNative = f;
    },
  };
}

test("family.build refuses an agent before dispatch", async () => {
  const { admit, sent } = await setup();
  await expect(admit("family.build", {}, 0, "agent-build", "agent")).rejects.toThrow(
    "requires human approval",
  );
  expect(sent).toEqual([]);
});

async function authorFamilies(work: RouteWorkspace, revision = 0, where = scope) {
  const landed = await work.apply(
    where,
    "families",
    "human",
    [
      { path: ["profilePath"], value: "p.json" },
      {
        path: ["scope"],
        value: {
          categoryNames: ["Ducts"],
          familyNames: ["Box", "Pipe"],
          placementScope: "AllLoaded",
        },
      },
    ],
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}

/* ── the boundary itself ─────────────────────────────────────────────────────────────────── */

test("neither route document can hold an observation or a receipt", async () => {
  const { work, read, admit } = await setup();
  const revision = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  const doc = (await work.read(scope, "families"))!;
  // A native plan was read and stored, and the Work document did not move at all.
  expect(doc.revision).toBe(revision);
  expect(Object.keys(doc.doc as object).sort()).toEqual(["excludedIds", "profilePath", "scope"]);
  expect(JSON.stringify(doc.doc)).not.toContain("planHash");

  const applied = await admit(
    "families.apply",
    { planId: capture.id, expectedPlanHashes: { "1": "h1", "2": "h2" } },
    revision,
  );
  expect(applied.state, JSON.stringify((applied as { error?: string }).error)).toBe("succeeded");
  const after = (await work.read(scope, "families"))!;
  expect(after.revision).toBe(revision);
  expect(JSON.stringify(after.doc)).not.toContain("artifactDirectory");
  // The receipt lives with the operation owner, which is the only place it lives.
  expect(JSON.stringify(applied)).toContain("artifactDirectory");
});

test("an agent patch cannot reach anything but authored input", async () => {
  const { work } = await setup();
  const revision = await authorFamilies(work);
  const refused = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["observed"], value: { plan: null } }],
    revision,
  );
  expect(refused.ok).toBe(false);
  const stored = await work.apply(
    scope,
    "parameter-links",
    "agent",
    [{ path: ["stored"], value: link }],
    0,
  );
  expect(stored.ok).toBe(false);
});

/* ── families ────────────────────────────────────────────────────────────────────────────── */

test("a planned scope and its reading both survive reload, from their own owners", async () => {
  const { work, read, captures } = await setup();
  await authorFamilies(work);
  await read("families.plan");
  // A fresh read of each owner is all a reloaded tab gets.
  const reloaded = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  const readings = await captures.familyReadings(scope);
  const plan = familiesPlanReadingSchema.parse(readings[0]!.reading.value);
  expect(reloaded.scope?.familyNames).toEqual(["Box", "Pipe"]);
  expect(plan.entries).toHaveLength(2);
  expect(plan.basis).toBe(familiesBasis(reloaded));
});

test("editing the profile makes the reading stale by basis, and never deletes it", async () => {
  const { work, read, captures, admit, sent } = await setup();
  const planned = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  const edited = await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["profilePath"], value: "other.json" }],
    planned,
  );
  expect(edited.ok).toBe(true);
  // The reading is still there; only its basis no longer matches.
  const readings = await captures.familyReadings(scope);
  expect(readings).toHaveLength(1);
  const doc = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  expect(familiesPlanReadingSchema.parse(readings[0]!.reading.value).basis).not.toBe(
    familiesBasis(doc),
  );
  const before = sent.filter((row) => row.key === "familyfoundry.apply").length;
  const refused = await admit(
    "families.apply",
    { planId: capture.id, expectedPlanHashes: { "1": "h1" } },
    edited.revision!,
  );
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/changed after the plan/);
  expect(sent.filter((row) => row.key === "familyfoundry.apply")).toHaveLength(before);
});

test("families apply refuses a reviewed Work revision that is no longer current", async () => {
  const { work, read, admit, sent } = await setup();
  const planned = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  await work.apply(scope, "families", "human", [{ path: ["excludedIds"], value: [2] }], planned);
  const refused = await admit(
    "families.apply",
    { planId: capture.id, expectedPlanHashes: {} },
    planned,
  );
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/Work changed after review/);
  expect(sent.filter((s) => s.key === "familyfoundry.apply")).toHaveLength(0);
});

test("families apply sends exactly the reviewed hashes and the reviewed profile bytes", async () => {
  const { work, read, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  const row = await admit(
    "families.apply",
    { planId: capture.id, expectedPlanHashes: { "1": "h1", "2": "h2" } },
    revision,
  );
  expect(row.state, JSON.stringify((row as { error?: string }).error)).toBe("succeeded");
  const native = sent.find((s) => s.key === "familyfoundry.apply")!;
  expect(native.input.expectedPlanHashes).toEqual({ "1": "h1", "2": "h2" });
  expect(native.input.patchJson).toBe(profileBytes);
});

test("an exclusion written while the native call runs survives, because Work is never rewritten", async () => {
  const { work, read, admit, during } = await setup();
  const revision = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  during(async () => {
    const landed = await work.apply(
      scope,
      "families",
      "human",
      [{ path: ["excludedIds"], value: [2] }],
      revision,
    );
    expect(landed.ok).toBe(true);
  });
  const row = await admit(
    "families.apply",
    { planId: capture.id, expectedPlanHashes: { "1": "h1", "2": "h2" } },
    revision,
  );
  expect(row.state, JSON.stringify((row as { error?: string }).error)).toBe("succeeded");
  const after = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  expect(after.excludedIds).toEqual([2]);
});

test("the same action id joins the original attempt instead of minting a second native call", async () => {
  const { work, read, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  const input = { planId: capture.id, expectedPlanHashes: { "1": "h1", "2": "h2" } };
  const first = await admit("families.apply", input, revision, "once");
  const replay = await admit("families.apply", input, revision, "once");
  expect(replay.id).toBe(first.id);
  expect(sent.filter((s) => s.key === "familyfoundry.apply")).toHaveLength(1);
});

test("an unknown native outcome never re-mints the effect under the same id", async () => {
  const { work, read, admit, sent, unknown } = await setup();
  const revision = await authorFamilies(work);
  const capture = (await read("families.plan")) as { id: string };
  const input = { planId: capture.id, expectedPlanHashes: { "1": "h1", "2": "h2" } };
  unknown(true);
  await admit("families.apply", input, revision, "uncertain");
  unknown(false);
  const again = await admit("families.apply", input, revision, "uncertain");
  expect(sent.filter((s) => s.key === "familyfoundry.apply")).toHaveLength(1);
  expect(JSON.stringify(again)).toContain("unknown");
});

test("two documents keep independent authored scopes and independent readings", async () => {
  const { work, read, captures } = await setup();
  await authorFamilies(work);
  await read("families.plan");
  await work.apply(
    otherScope,
    "families",
    "human",
    [
      { path: ["profilePath"], value: "annex.json" },
      {
        path: ["scope"],
        value: { categoryNames: [], familyNames: ["Grille"], placementScope: "PlacedOnly" },
      },
    ],
    0,
  );
  const here = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  const there = familiesRouteState.schema.parse((await work.read(otherScope, "families"))!.doc);
  expect(here.scope?.familyNames).toEqual(["Box", "Pipe"]);
  expect(there.scope?.familyNames).toEqual(["Grille"]);
  expect(await captures.familyReadings(otherScope)).toEqual([]);
});

test("the plan reading narrows to the authored family names and refuses without a scope", async () => {
  const { work, read, entries } = await setup();
  entries([entry(1, "Box", "h1"), entry(9, "Grille", "h9")]);
  const seeded = await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["profilePath"], value: "p.json" }],
    0,
  );
  await expect(read("families.plan")).rejects.toThrow(/profile and a scope/);
  await authorFamilies(work, seeded.revision!);
  const capture = (await read("families.plan")) as { reading: { value: unknown } };
  expect(familiesPlanReadingSchema.parse(capture.reading.value).entries).toHaveLength(1);
});

/* ── parameter links ─────────────────────────────────────────────────────────────────────── */

async function authorDraft(work: RouteWorkspace, draft: unknown, revision = 0) {
  const landed = await work.apply(
    scope,
    "parameter-links",
    "human",
    [{ path: ["draft"], value: draft }],
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}

test("the approval count and the apply basis are the same evaluated version after a reload", async () => {
  const { work, read, admit, sent, captures } = await setup();
  const revision = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: true })) as { id: string };
  // A reloaded tab holds no preview flag; the reading and the document alone answer it.
  const reading = parameterLinksReadingSchema.parse(
    (await captures.familyReadings(scope))[0]!.reading.value,
  );
  const doc = parameterLinksRouteState.schema.parse(
    (await work.read(scope, "parameter-links"))!.doc,
  );
  expect(reading.basis).toBe(parameterLinksBasis(doc));
  expect(reading.evaluation?.changedWriteCount).toBe(2);
  const row = await admit("parameter-links.apply", { readingId: capture.id }, revision);
  expect(row.state, JSON.stringify((row as { error?: string }).error)).toBe("succeeded");
  expect(
    sent.find((s) => s.key === "revit.apply.parameter-links" && s.input.previewOnly === false)!
      .input,
  ).toMatchObject({ profile: link, previewOnly: false, reconcile: true });
});

test("a draft edited after the evaluation refuses before any native write", async () => {
  const { work, read, admit, sent } = await setup();
  const evaluated = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: true })) as { id: string };
  const edited = await work.apply(
    scope,
    "parameter-links",
    "human",
    [
      {
        path: ["draft"],
        value: { ...link, definitions: [{ ...link.definitions[0], reducer: "max" }] },
      },
    ],
    evaluated,
  );
  const before = sent.filter((s) => s.key === "revit.apply.parameter-links").length;
  const refused = await admit("parameter-links.apply", { readingId: capture.id }, edited.revision!);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/changed after the evaluation/);
  expect(sent.filter((s) => s.key === "revit.apply.parameter-links")).toHaveLength(before);
});

test("a stored-profile read can never arm an apply of a draft it did not evaluate", async () => {
  const { work, read, admit, sent } = await setup();
  const revision = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: false })) as { id: string };
  const refused = await admit("parameter-links.apply", { readingId: capture.id }, revision);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/stored-profile read/);
  expect(sent.filter((s) => s.key === "revit.apply.parameter-links")).toHaveLength(0);
});

test("a native failure leaves the authored draft exactly as the human left it", async () => {
  const { work, read, admit, fail } = await setup();
  const revision = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: true })) as { id: string };
  fail(true);
  const row = await admit("parameter-links.apply", { readingId: capture.id }, revision);
  expect(row.state).not.toBe("succeeded");
  const after = parameterLinksRouteState.schema.parse(
    (await work.read(scope, "parameter-links"))!.doc,
  );
  expect(after.draft).toEqual(link);
});

test("the evaluation is the host readback, stamped to the exact draft it evaluated", async () => {
  const { work, read, captures } = await setup();
  await authorDraft(work, link);
  await read("parameter-links.read", { evaluate: true });
  const reading = parameterLinksReadingSchema.parse(
    (await captures.familyReadings(scope))[0]!.reading.value,
  );
  expect(reading.evaluated).toBe(true);
  expect(reading.appliedWriteCount).toBe(2);
  expect(reading.stored).toEqual(link);
  expect(reading.basis).toBe(parameterLinksBasis({ draft: link }));
});

test("neither route advertises a command a server would have to refuse", () => {
  expect(familiesRouteState.commands).toEqual({});
  expect(parameterLinksRouteState.commands).toEqual({});
});
