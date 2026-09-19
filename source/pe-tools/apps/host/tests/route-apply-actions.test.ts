import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  familiesRouteState,
  familyCellKey,
  stagedFilter,
  familyDraftRouteState,
  familyStagedPatch,
  type FamilyCellState,
  parameterLinksBasis,
  parameterLinksReadingSchema,
  parameterLinksRouteState,
  transitionPatches,
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
const member = (name: string) => ({ pod: "global", path: `settings/${name}` });
const source = {
  ...member("p.json"),
  sha256: createHash("sha256").update(profileBytes).digest("hex"),
};
const composed = `${JSON.stringify(JSON.parse(profileBytes), null, 2)}
`;

const entry = (familyId: number, familyName: string, planHash: string) => ({
  familyId,
  familyName,
  planHash,
  changes: [{ section: "types", key: "Width", kind: "set" }],
  runEffects: [],
  refusals: [],
  warnings: [],
});
/** The document's loaded families; the fake catalog filters them the way the native filter does. */
const types = [{ typeName: "T" }];
const loaded = [
  { familyId: 1, familyName: "Box", categoryName: "Ducts", types },
  { familyId: 2, familyName: "Pipe", categoryName: "Ducts", types },
  { familyId: 3, familyName: "Elbow", categoryName: "Ducts", types },
  { familyId: 9, familyName: "Grille", categoryName: "Air Terminals", types },
];
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
  const podsRoot = join(dir, "Pods");
  await mkdir(join(podsRoot, "Global", "settings"), { recursive: true });
  await writeFile(join(podsRoot, "Global", "pod.json"), JSON.stringify({ id: "global" }));
  for (const name of ["p.json", "other.json", "annex.json"])
    await writeFile(join(podsRoot, "Global", "settings", name), profileBytes);
  const rows = new Map<string, unknown>();
  // biome-ignore lint/suspicious/noExplicitAny: fixture bridge payloads mirror untyped host frames.
  const sent: { key: string; input: any; id?: string }[] = [];
  let planEntries = [entry(1, "Box", "h1"), entry(2, "Pipe", "h2")];
  let nativeFails = false;
  let nativeUnknown = false;
  const box = {
    familyId: 1,
    familyName: "Box",
    success: true,
    converged: true,
    residue: [],
    errors: [],
    artifactDirectory: "C:/art/1",
  };
  let applied: { receipts: unknown[]; reason?: string } = { receipts: [box] };
  let duringNative: (() => Promise<void>) | null = null;
  let familyDocument = false;
  const bridge = {
    list: Effect.sync(() => [
      {
        sessionId: "A",
        connected: true,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [{ openId: "open-A", address: at, isFamilyDocument: familyDocument }],
        },
      },
    ]),
    // biome-ignore lint/suspicious/noExplicitAny: fixture bridge payloads mirror untyped host frames.
    invoke: (key: string, input: any, _s: string, _o: string, id?: string) =>
      Effect.promise(async () => {
        sent.push({ key, input, id });
        if (key === "families.capture")
          return {
            value: {
              diagnostics: [],
              families: [
                { familyId: 1, familyName: "Box", success: true, modelJson: '{"box":1}' },
                { familyId: 2, familyName: "Pipe Fitting", success: true, modelJson: '{"pipe":1}' },
                { familyId: 3, familyName: "Locked", success: false, error: "cannot open" },
              ],
            },
          };
        if (key === "revit.catalog.loaded-families") {
          const { categoryNames, familyNames } = input.filter;
          const families = loaded.filter(
            (f) =>
              (!categoryNames.length || categoryNames.includes(f.categoryName)) &&
              (!familyNames.length || familyNames.includes(f.familyName)),
          );
          // As the C# collector: types only for a Rows/Full view, at most maxSamplesPerEntry (10).
          const full = ["Rows", "Full"].includes(input.projection?.view);
          return {
            value: {
              summary: { truncated: false },
              families: families.map((f) => ({
                ...f,
                typeCount: f.types.length,
                types: full ? f.types.slice(0, input.budget?.maxSamplesPerEntry ?? 10) : [],
              })),
              issues: [],
            },
          };
        }
        // The engine resolves exactly the names it is passed to their current ids.
        if (key === "families.plan")
          return {
            value: {
              diagnostics: [],
              families: planEntries.filter((e) => input.familyNames.includes(e.familyName)),
            },
          };
        if (key === "family.plan")
          return { value: { diagnostics: [], families: [planEntries[0]] } };
        if (nativeUnknown) throw Object.assign(Error("bridge timeout"), { statusCode: 504 });
        if (nativeFails) throw Object.assign(Error("native refused"), { statusCode: 409 });
        if (key === "families.apply" || key === "family.apply") {
          await duringNative?.();
          return { value: { diagnostics: [], ...applied } };
        }
        await duringNative?.();
        return { value: linkData };
      }),
    // biome-ignore lint/suspicious/noExplicitAny: the fixture implements only what the host calls.
  } as any;
  const work = new RouteWorkspace({
    registrations: [
      { spec: familiesRouteState, handlers: {} },
      { spec: familyDraftRouteState, handlers: {} },
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
  const deps = { workspace: work, sdk: sdkSessions, podsRoot } as any;
  const read = (key: string, input: unknown = {}, readScope = scope) =>
    readFamily({ key, input, scope: readScope, target }, captures, bridge, deps);
  const admit = async (
    key: string,
    input: unknown,
    revision: number,
    id = `${key}${revision}`,
    actor: "human" | "agent" = "human",
    where: { route: string; target: string } | null = scope,
  ) => {
    const row = await admitFamilyAction(
      {
        id,
        kind: "workflow",
        key,
        actor,
        destination: { kind: "document", ref: target },
        input,
        bases: where ? { work: { key: where, revision } } : {},
      },
      owner,
      captures,
      bridge,
      deps,
    );
    return owner.wait(row.id);
  };
  /** A member file in the Global pod, addressed as a plan source. */
  const file = async (name: string, content: string) => {
    await writeFile(join(podsRoot, "Global", "settings", name), content);
    return { ...member(name), sha256: createHash("sha256").update(content).digest("hex") };
  };
  return {
    podsRoot,
    work,
    file,
    familyDocument: (v: boolean) => {
      familyDocument = v;
    },
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
    applied: (next: typeof applied) => {
      applied = next;
    },
    box,
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
      {
        path: ["scope", "staged"],
        value: {
          value: {
            categoryNames: ["Ducts"],
            familyNames: ["Box", "Pipe"],
            placementScope: "AllLoaded",
          },
        },
      },
    ],
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}

/* ── the boundary itself ─────────────────────────────────────────────────────────────────── */

type Plan = { id: string; plan: { familyId: number }[]; included: Record<string, string> };
const resultOf = <A>(row: unknown) => {
  const settled = row as { state: string; error?: string; result?: A };
  expect(settled.state, JSON.stringify(settled.error)).toBe("succeeded");
  return settled.result!;
};

test("neither route document can hold an observation or a receipt", async () => {
  const { work, admit, captures } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const doc = (await work.read(scope, "families"))!;
  // A native plan was returned, and neither the Work document nor a reading moved.
  expect(plan.plan).toHaveLength(2);
  expect(doc.revision).toBe(revision);
  expect(Object.keys(doc.doc as object).sort()).toEqual(["cells", "excluded", "scope"]);
  expect(JSON.stringify(doc.doc)).not.toContain("planHash");
  expect(await captures.familyReadings(scope)).toEqual([]);

  const applied = await admit(
    "families.apply",
    { plan: plan.id, expectedPlanHashes: plan.included },
    revision,
  );
  resultOf(applied);
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

test("pea proposes a families cell like a person does, and cannot accept it", async () => {
  const { work } = await setup();
  const revision = await authorFamilies(work);
  const cell = familyCellKey({ familyName: "Box", typeName: "T1", parameter: "PE_G___Model" });
  const value = { value: "FXMQ20" };
  const proposed = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", cell, "proposal"], value: { value } }],
    revision,
  );
  expect(proposed.ok).toBe(true);
  const accepted = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", cell, "staged"], value: { value } }],
    proposed.revision!,
  );
  expect(accepted.ok).toBe(false);
});

/* ── families ────────────────────────────────────────────────────────────────────────────── */

test("plan sends the scope's resolved names, names what apply would send, and refuses without a scope", async () => {
  const { work, admit, entries, sent } = await setup();
  entries([entry(1, "Box", "h1"), entry(2, "Pipe", "h2"), entry(9, "Grille", "h9")]);
  const bare = await work.apply(scope, "families", "human", [{ path: ["excluded"], value: {} }], 0);
  const refused = await admit("families.plan", { source }, bare.revision!);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/Stage a scope/);
  const revision = await authorFamilies(work, bare.revision!);
  const held = await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["excluded", "Pipe"], value: { by: "person" } }],
    revision,
  );
  const plan = resultOf<Plan>(await admit("families.plan", { source }, held.revision!));
  expect(sent.find((s) => s.key === "families.plan")!.input.familyNames).toEqual(["Box", "Pipe"]);
  expect(plan.plan.map((row) => row.familyId)).toEqual([1, 2]);
  expect(plan.included).toEqual({ "1": "h1" });
});

test("F-J1-10: plan reads the person's staged scope, never Pea's proposed one", async () => {
  const { work, admit, entries, sent } = await setup();
  entries([entry(1, "Box", "h1"), entry(2, "Pipe", "h2"), entry(3, "Elbow", "h3")]);
  const authored = await authorFamilies(work);
  const elbow = { categoryNames: ["Ducts"], familyNames: ["Elbow"], placementScope: "AllLoaded" };
  const proposed = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["scope", "proposal"], value: { value: elbow } }],
    authored,
  );
  expect(proposed).toMatchObject({ ok: true });
  // Pea can never write the person's scope itself.
  for (const path of [["scope"], ["scope", "staged"]])
    expect(
      await work.apply(scope, "families", "agent", [{ path, value: null }], proposed.revision!),
    ).toMatchObject({ ok: false });
  resultOf<Plan>(await admit("families.plan", { source }, proposed.revision!));
  expect(sent.find((s) => s.key === "families.plan")!.input.familyNames).toEqual(["Box", "Pipe"]);
});

test("plan reads exclusions from the reviewed Work and seals each one with who made it", async () => {
  const { work, admit, entries } = await setup();
  entries([entry(1, "Box", "h1"), entry(2, "Pipe", "h2")]);
  const authored = await authorFamilies(work);
  const revision = (
    await work.apply(
      scope,
      "families",
      "agent",
      [{ path: ["excluded", "Pipe"], value: { by: "pea" } }],
      authored,
    )
  ).revision!;
  const plan = resultOf<Plan & { excluded: unknown }>(
    await admit("families.plan", { source }, revision),
  );
  expect(plan.included).toEqual({ "1": "h1" });
  expect(plan.excluded).toEqual([{ familyName: "Pipe", by: "pea" }]);
});

test("a category-only scope plans exactly its three families and never a fourth", async () => {
  const { work, admit, entries, sent } = await setup();
  entries([
    entry(1, "Box", "h1"),
    entry(2, "Pipe", "h2"),
    entry(3, "Elbow", "h3"),
    entry(9, "Grille", "h9"),
  ]);
  const revision = (
    await work.apply(
      scope,
      "families",
      "human",
      [
        {
          path: ["scope", "staged"],
          value: {
            value: { categoryNames: ["Ducts"], familyNames: [], placementScope: "AllLoaded" },
          },
        },
      ],
      0,
    )
  ).revision!;
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  expect(sent.find((s) => s.key === "families.plan")!.input.familyNames).toEqual([
    "Box",
    "Pipe",
    "Elbow",
  ]);
  expect(plan.plan.map((row) => row.familyId)).toEqual([1, 2, 3]);
  expect(Object.keys(plan.included)).toEqual(["1", "2", "3"]);
});

test("a generated member's plan names its one family and the host plans exactly that name", async () => {
  const { work, admit, entries, sent } = await setup();
  entries([entry(1, "Box", "h1"), entry(2, "Pipe", "h2"), entry(3, "Elbow", "h3")]);
  const ducts = { categoryNames: ["Ducts"], familyNames: [], placementScope: "AllLoaded" };
  const revision = (
    await work.apply(
      scope,
      "families",
      "human",
      [{ path: ["scope", "staged"], value: { value: ducts } }],
      0,
    )
  ).revision!;
  const plan = resultOf<Plan>(
    await admit("families.plan", { source, familyNames: ["Pipe"] }, revision),
  );
  expect(sent.find((s) => s.key === "families.plan")!.input.familyNames).toEqual(["Pipe"]);
  expect(plan.plan.map((row) => row.familyId)).toEqual([2]);
  // A named family outside the scope refuses rather than widening it.
  const outside = await admit(
    "families.plan",
    { source, familyNames: ["Grille"] },
    revision,
    "outside",
  );
  expect(String((outside as { error?: string }).error)).toMatch(/outside the reviewed scope/);
  expect(sent.filter((s) => s.key === "families.plan")).toHaveLength(1);
});

test("a scope that resolves no loaded family refuses before the native plan", async () => {
  const { work, admit, sent } = await setup();
  const revision = (
    await work.apply(
      scope,
      "families",
      "human",
      [
        {
          path: ["scope", "staged"],
          value: {
            value: { categoryNames: ["Walls"], familyNames: [], placementScope: "AllLoaded" },
          },
        },
      ],
      0,
    )
  ).revision!;
  const refused = await admit("families.plan", { source }, revision);
  expect(String((refused as { error?: string }).error)).toMatch(
    /scope resolved to no loaded families: /,
  );
  expect(sent.filter((s) => s.key === "families.plan")).toHaveLength(0);
});

test("an agent may plan, and only a human may apply", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(
    await admit("families.plan", { source }, revision, "agent-plan", "agent"),
  );
  await expect(
    admit(
      "families.apply",
      { plan: plan.id, expectedPlanHashes: { "1": "h1" } },
      revision,
      "a",
      "agent",
    ),
  ).rejects.toThrow("requires human approval");
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(0);
});

test("apply sends the bytes its plan sealed, not the member as saved since", async () => {
  const { work, admit, sent, podsRoot } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  await writeFile(join(podsRoot, "Global", "settings", "p.json"), '{"patch":{"changed":1}}');
  resultOf(
    await admit("families.apply", { plan: plan.id, expectedPlanHashes: plan.included }, revision),
  );
  expect(sent.find((row) => row.key === "families.apply")!.input.specJson).toBe(composed);
});

test("apply refuses a plan it cannot name, another document's, or a hash the plan never made", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const refusals = [
    await admit("families.apply", { plan: "nope", expectedPlanHashes: { "1": "h1" } }, 0, "a1"),
    await admit("family.apply", { plan: plan.id, expectedPlanHashes: { "1": "h1" } }, 0, "a2"),
    await admit("families.apply", { plan: plan.id, expectedPlanHashes: { "1": "h9" } }, 0, "a3"),
  ];
  expect(refusals.map((row) => [row.state, (row as { error?: string }).error])).toEqual([
    ["failed", expect.stringMatching(/succeeded families.plan/)],
    ["failed", expect.stringMatching(/no longer available|succeeded family.plan/)],
    ["failed", expect.stringMatching(/not in the reviewed plan/)],
  ]);
  expect(sent.filter((s) => s.key.endsWith(".apply"))).toHaveLength(0);
});

test("families plan refuses a reviewed Work revision that is no longer current", async () => {
  const { work, admit, sent } = await setup();
  const planned = await authorFamilies(work);
  await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["excluded", "Pipe"], value: { by: "person" } }],
    planned,
  );
  const refused = await admit("families.plan", { source }, planned);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/Current reviewed Families Work/);
  expect(sent.filter((s) => s.key === "families.plan")).toHaveLength(0);
});

test("families apply refuses an empty include set before dispatch", async () => {
  const { admit, sent } = await setup();
  const refused = await admit("families.apply", { plan: "p", expectedPlanHashes: {} }, 0);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/No included family/);
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(0);
});

test("families apply sends exactly the reviewed hashes, and the spec, source bytes and options its plan sealed", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const options = { singleTransaction: true };
  const plan = resultOf<Plan>(
    await admit("families.plan", { source, executionOptions: options }, revision),
  );
  resultOf(
    await admit(
      "families.apply",
      { plan: plan.id, expectedPlanHashes: { "1": "h1", "2": "h2" } },
      revision,
    ),
  );
  const native = sent.find((s) => s.key === "families.apply")!;
  expect(native.input.expectedPlanHashes).toEqual({ "1": "h1", "2": "h2" });
  expect(native.input.specJson).toBe(composed);
  // The one read's exact root bytes; this member has no dependencies.
  expect(native.input.source).toEqual({
    root: {
      id: source.pod,
      path: source.path,
      sha256: source.sha256,
      bytesBase64: Buffer.from(profileBytes, "utf8").toString("base64"),
      origin: "SavedMember",
    },
    dependencies: [],
  });
  expect(native.input.executionOptions).toEqual(options);
  // The native run names the plan it applies (execution reads it once C# declares the field).
  expect(native.input.plan).toBe(plan.id);
});

test("an exclusion written while the native call runs survives, because Work is never rewritten", async () => {
  const { work, admit, during } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  during(async () => {
    const landed = await work.apply(
      scope,
      "families",
      "human",
      [{ path: ["excluded", "Pipe"], value: { by: "person" } }],
      revision,
    );
    expect(landed.ok).toBe(true);
  });
  resultOf(
    await admit("families.apply", { plan: plan.id, expectedPlanHashes: plan.included }, revision),
  );
  const after = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  expect(after.excluded).toEqual({ Pipe: { by: "person" } });
});

test("the same action id joins the original attempt instead of minting a second native call", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const input = { plan: plan.id, expectedPlanHashes: { "1": "h1", "2": "h2" } };
  const first = await admit("families.apply", input, 0, "once");
  const replay = await admit("families.apply", input, 0, "once");
  expect(replay.id).toBe(first.id);
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
});

test("an unknown native outcome never re-mints the effect under the same id", async () => {
  const { work, admit, sent, unknown } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const input = { plan: plan.id, expectedPlanHashes: { "1": "h1", "2": "h2" } };
  unknown(true);
  await admit("families.apply", input, 0, "uncertain");
  unknown(false);
  const again = await admit("families.apply", input, 0, "uncertain");
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
  expect(JSON.stringify(again)).toContain("unknown");
});

/* ── consumed-cell retirement (obligation 8) ─────────────────────────────────────────────── */

const cellOf = (parameter: string) =>
  familyCellKey({ familyName: "Box", typeName: "T", parameter });
const W = cellOf("Width");
const H = cellOf("Height");
const D = cellOf("Depth");
const staged = (value: string): FamilyCellState => ({
  proposal: null,
  staged: { value: { value } },
});
const rung = (value: string) => ({ value: { value } });

/** Box's staged cells, the member they generate, and its one-family plan at that revision. */
async function stagedPlan(
  env: Awaited<ReturnType<typeof setup>>,
  cells: Record<string, FamilyCellState>,
  content?: string,
) {
  const authored = await authorFamilies(env.work);
  const revision = (
    await env.work.apply(scope, "families", "human", [{ path: ["cells"], value: cells }], authored)
  ).revision!;
  const generated = familyStagedPatch(cells, "Box")!;
  // The reviewed draft travels as bytes; nothing is filed in the pod.
  const draft = {
    pod: "global",
    path: "staged/Box.json",
    content:
      content ??
      `${JSON.stringify({ $schema: "https://ff/schema.json", ...generated.spec }, null, 2)}\n`,
  };
  const plan = resultOf<Plan>(
    await env.admit("families.plan", { source: draft, familyNames: ["Box"] }, revision),
  );
  return { plan, revision, draft, apply: { plan: plan.id, expectedPlanHashes: plan.included } };
}
const cellsNow = async (work: RouteWorkspace) =>
  familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc).cells;

test("a staged plan files nothing in the pod; apply carries the exact draft bytes as a SuppliedDraft", async () => {
  const env = await setup();
  const before = await readdir(join(env.podsRoot, "Global"), { recursive: true });
  const { apply, revision, draft } = await stagedPlan(env, { [W]: staged("10") });
  resultOf(await env.admit("families.apply", apply, revision));
  expect(await readdir(join(env.podsRoot, "Global"), { recursive: true })).toEqual(before);
  const root = env.sent.find((s) => s.key === "families.apply")!.input.source.root;
  expect(root).toMatchObject({ id: "global", path: draft.path, origin: "SuppliedDraft" });
  expect(Buffer.from(root.bytesBase64, "base64").toString("utf8")).toBe(draft.content);
  expect(root.sha256).toBe(createHash("sha256").update(draft.content).digest("hex"));
  expect((await cellsNow(env.work))[W]?.staged).toBeNull();
});

test("a source that is both a saved member and a draft refuses; neither arm wins by stripping", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  const mixed = { ...source, content: '{"patch":{"types":{}}}' };
  await expect(env.admit("families.plan", { source: mixed }, revision)).rejects.toThrow();
  expect(env.sent.filter((s) => s.key === "families.plan")).toHaveLength(0);
});

test("a user who keeps editing during apply loses nothing; unchanged consumed cells retire", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10"), [H]: staged("20") });
  env.during(async () => {
    const now = (await env.work.read(scope, "families"))!.revision;
    const landed = await env.work.apply(
      scope,
      "families",
      "human",
      [
        { path: ["cells", W, "staged"], value: rung("11") },
        { path: ["cells", D], value: staged("5") },
      ],
      now,
    );
    expect(landed.ok).toBe(true);
    const pea = await env.work.apply(
      scope,
      "families",
      "agent",
      [{ path: ["cells", H, "proposal"], value: rung("25") }],
      landed.revision!,
    );
    expect(pea.ok).toBe(true);
  });
  const done = resultOf<{ retired: { retired: string[] } }>(
    await env.admit("families.apply", apply, revision),
  );
  expect(done.retired.retired).toEqual([H]);
  const cells = await cellsNow(env.work);
  expect(cells[W]?.staged).toEqual(rung("11"));
  expect(cells[D]?.staged).toEqual(rung("5"));
  expect(cells[H]).toEqual({ proposal: rung("25"), staged: null });
});

test("a consumed unchanged cell retires once, with a proposal equal to it; replay neither redispatches nor re-retires", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, {
    [W]: { proposal: rung("10"), staged: { value: { value: "10" } } },
  });
  const first = await env.admit("families.apply", apply, revision, "retire-once");
  resultOf(first);
  expect((await cellsNow(env.work))[W]).toEqual({ proposal: null, staged: null });
  // The person stages the same value again after the retirement.
  const now = (await env.work.read(scope, "families"))!.revision;
  await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W, "staged"], value: rung("10") }],
    now,
  );
  const replay = await env.admit("families.apply", apply, revision, "retire-once");
  expect(replay.id).toBe(first.id);
  expect(env.sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
  expect((await cellsNow(env.work))[W]?.staged).toEqual(rung("10"));
  expect(
    (await env.owner.list(undefined, first.id))[0]!.steps.filter(
      (step) => step.key === "work.retire",
    ),
  ).toHaveLength(1);
});

// LoadFamily replaces the Family element on every load after an edit: the name is the stable key.
test("a leftover staged cell still addresses its family after an apply reloads it under a new id", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10") });
  env.during(async () => {
    const now = (await env.work.read(scope, "families"))!.revision;
    const left = await env.work.apply(
      scope,
      "families",
      "human",
      [{ path: ["cells", D], value: staged("5") }],
      now,
    );
    expect(left.ok).toBe(true);
  });
  env.applied({ receipts: [{ ...env.box, loadedFamilyId: 11 }] });
  resultOf(await env.admit("families.apply", apply, revision));
  env.during(async () => {});
  // Box is element 11 now; the leftover cell names Box, so it plans and retires against 11.
  env.entries([entry(11, "Box", "h11"), entry(2, "Pipe", "h2")]);
  const leftover = { [D]: staged("5") };
  const now = (await env.work.read(scope, "families"))!.revision;
  const after = await cellsNow(env.work);
  expect(after[W]?.staged).toBeNull();
  expect(after[D]).toEqual(leftover[D]);
  const generated = familyStagedPatch(leftover, "Box")!;
  const draft = {
    pod: "global",
    path: "staged/Box.json",
    content: `${JSON.stringify({ $schema: "https://ff/schema.json", ...generated.spec }, null, 2)}
`,
  };
  const plan = resultOf<Plan>(
    await env.admit("families.plan", { source: draft, familyNames: ["Box"] }, now, "again"),
  );
  expect(plan.included).toEqual({ "11": "h11" });
  expect((plan as Plan & { orphaned: string[] }).orphaned).toEqual([]);
  env.applied({ receipts: [{ ...env.box, familyId: 11, loadedFamilyId: 12 }] });
  const done = resultOf<{ retired: { retired: string[] } }>(
    await env.admit(
      "families.apply",
      { plan: plan.id, expectedPlanHashes: plan.included },
      now,
      "again-apply",
    ),
  );
  expect(done.retired.retired).toEqual([D]);
  // The library re-resolves the planned name at apply; the host sends the pair it sealed.
  expect(env.sent.findLast((s) => s.key === "families.apply")!.input.familyNames).toEqual({
    "11": "Box",
  });
});

test("a cell whose family or type no longer resolves is named orphaned by plan, never re-attached", async () => {
  const { work, admit } = await setup();
  const authored = await authorFamilies(work);
  const gone = familyCellKey({ familyName: "Box Old", typeName: "T", parameter: "Width" });
  const renamedType = familyCellKey({ familyName: "Box", typeName: "Gone", parameter: "Width" });
  const live = familyCellKey({ familyName: "Box", typeName: "T", parameter: "Width" });
  const revision = (
    await work.apply(
      scope,
      "families",
      "human",
      [
        {
          path: ["cells"],
          value: {
            [gone]: { proposal: rung("1"), staged: null },
            [renamedType]: staged("2"),
            [live]: staged("3"),
          },
        },
      ],
      authored,
    )
  ).revision!;
  const plan = resultOf<Plan & { orphaned: string[] }>(
    await admit("families.plan", { source }, revision),
  );
  expect(plan.orphaned).toEqual([gone, renamedType]);
});

test("an exclusion still excludes its family after a reload gives it a new id", async () => {
  const { work, admit, entries } = await setup();
  const authored = await authorFamilies(work);
  const held = await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["excluded", "Pipe"], value: { by: "person" } }],
    authored,
  );
  // Pipe was reloaded by another route since the exclusion was written: element 2 is now 22.
  entries([entry(1, "Box", "h1"), entry(22, "Pipe", "h22")]);
  const plan = resultOf<Plan & { excluded: unknown }>(
    await admit("families.plan", { source }, held.revision!),
  );
  expect(plan.included).toEqual({ "1": "h1" });
  expect(plan.excluded).toEqual([{ familyName: "Pipe", by: "person" }]);
});

test("a failed or unknown native apply leaves every staged cell staged", async () => {
  for (const outcome of ["failed", "unknown"] as const) {
    const env = await setup();
    const { apply, revision } = await stagedPlan(env, { [W]: staged("10") });
    if (outcome === "failed")
      env.applied({ receipts: [{ ...env.box, success: false }], reason: "no" });
    else env.unknown(true);
    const row = await env.admit("families.apply", apply, revision);
    expect(row.state).not.toBe("succeeded");
    expect((await cellsNow(env.work))[W]?.staged).toEqual(rung("10"));
  }
});

test("a plan whose member the staged cells do not generate, or with no Work basis, retires nothing", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(
    env,
    { [W]: staged("10") },
    '{"patch":{"types":{}}}',
  );
  resultOf(await env.admit("families.apply", apply, revision));
  expect((await cellsNow(env.work))[W]?.staged).toEqual(rung("10"));
});

test("/family retires the draft's consumed cells after a proven apply, and keeps a newer edit", async () => {
  const env = await setup();
  env.familyDocument(true);
  const draftKey = { route: "family", target: at };
  const reading = JSON.stringify({ Width: 1, Height: 2 });
  const revision = (
    await env.work.apply(
      draftKey,
      "family",
      "human",
      [
        { path: ["reading"], value: reading },
        {
          path: ["cells"],
          value: { "/Width": { staged: { value: 5 } }, "/Height": { staged: { value: 7 } } },
        },
      ],
      0,
    )
  ).revision!;
  // The reviewed draft travels as bytes; nothing is filed in the pod.
  const before = await readdir(join(env.podsRoot, "Global"), { recursive: true });
  const draft = {
    pod: "global",
    path: "staged/Box.json",
    content: `${JSON.stringify({ $schema: "https://ff/model.json", Width: 5, Height: 7 }, null, 2)}\n`,
  };
  const plan = resultOf<Plan>(
    await env.admit("family.plan", { source: draft }, revision, "fp", "human", draftKey),
  );
  env.during(async () => {
    const now = (await env.work.read(draftKey, "family"))!.revision;
    await env.work.apply(
      draftKey,
      "family",
      "human",
      [{ path: ["cells", "/Height", "staged"], value: { value: 8 } }],
      now,
    );
  });
  resultOf(
    await env.admit(
      "family.apply",
      { plan: plan.id, expectedPlanHashes: plan.included },
      revision,
      "fa",
      "human",
      draftKey,
    ),
  );
  const cells = familyDraftRouteState.schema.parse(
    (await env.work.read(draftKey, "family"))!.doc,
  ).cells;
  expect(cells["/Width"]?.staged).toBeNull();
  expect(cells["/Height"]?.staged).toEqual({ value: 8 });
  expect(await readdir(join(env.podsRoot, "Global"), { recursive: true })).toEqual(before);
  const root = env.sent.find((s) => s.key === "family.apply")!.input.source.root;
  expect(root).toMatchObject({ id: "global", path: draft.path, origin: "SuppliedDraft" });
  expect(Buffer.from(root.bytesBase64, "base64").toString("utf8")).toBe(draft.content);
});

test("two documents keep independent authored scopes", async () => {
  const { work } = await setup();
  await authorFamilies(work);
  await work.apply(
    otherScope,
    "families",
    "human",
    [
      {
        path: ["scope", "staged"],
        value: {
          value: { categoryNames: [], familyNames: ["Grille"], placementScope: "PlacedOnly" },
        },
      },
    ],
    0,
  );
  const here = familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc);
  const there = familiesRouteState.schema.parse((await work.read(otherScope, "families"))!.doc);
  expect(stagedFilter(here)?.familyNames).toEqual(["Box", "Pipe"]);
  expect(stagedFilter(there)?.familyNames).toEqual(["Grille"]);
});

/* ── parameter links ─────────────────────────────────────────────────────────────────────── */

/** The person stages a profile on the one cell. */
async function authorDraft(work: RouteWorkspace, draft: unknown, revision = 0) {
  const landed = await work.apply(
    scope,
    "parameter-links",
    "human",
    transitionPatches([], "profile", {}, { kind: "stage", rung: { value: draft } }),
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}

test("a Pea-proposed profile previews labelled and never arms apply; the person's staged one does", async () => {
  const { work, read, admit, sent, captures } = await setup();
  const proposed = { ...link, definitions: [{ ...link.definitions[0], reducer: "max" as const }] };
  const landed = await work.apply(
    scope,
    "parameter-links",
    "agent",
    transitionPatches([], "profile", {}, { kind: "propose", rung: { value: proposed } }),
    0,
  );
  expect(landed).toMatchObject({ ok: true });
  // The preview evaluates the proposal, says so, and names it as its basis.
  const preview = (await read("parameter-links.read", { evaluate: true, subject: "proposal" })) as {
    id: string;
  };
  const reading = parameterLinksReadingSchema.parse(
    (await captures.familyReadings(scope))[0]!.reading.value,
  );
  expect(reading).toMatchObject({ evaluated: true, subject: "proposal" });
  expect(sent.at(-1)!.input).toMatchObject({ profile: proposed, previewOnly: true });
  const refused = await admit("parameter-links.apply", { readingId: preview.id }, landed.revision!);
  expect(refused.state).toBe("failed");
  expect(String((refused as { error?: string }).error)).toMatch(/Stage a profile/);

  // The person stages their own profile. The proposal preview still cannot arm apply.
  const revision = await authorDraft(work, link, landed.revision!);
  const stillRefused = await admit(
    "parameter-links.apply",
    { readingId: preview.id },
    revision,
    "apply-proposal-preview",
  );
  expect(String((stillRefused as { error?: string }).error)).toMatch(/proposal preview/);
  expect(sent.filter((s) => s.input?.previewOnly === false)).toHaveLength(0);

  // Only the staged evaluation arms apply, with exactly the staged value.
  const evaluated = (await read("parameter-links.read", { evaluate: true })) as { id: string };
  const row = await admit("parameter-links.apply", { readingId: evaluated.id }, revision);
  expect(row.state, JSON.stringify((row as { error?: string }).error)).toBe("succeeded");
  expect(sent.find((s) => s.input?.previewOnly === false)!.input).toMatchObject({
    profile: link,
    reconcile: true,
  });
});

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
    transitionPatches(
      [],
      "profile",
      {},
      {
        kind: "stage",
        rung: { value: { ...link, definitions: [{ ...link.definitions[0], reducer: "max" }] } },
      },
    ),
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
  expect(after.profile.staged).toEqual({ value: link });
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
  expect(reading.basis).toBe(parameterLinksBasis({ profile: { staged: { value: link } } }));
});

test("neither route advertises a command a server would have to refuse", () => {
  expect(familiesRouteState.commands).toEqual({});
  expect(parameterLinksRouteState.commands).toEqual({});
});

test("families.capture writes one new member per family into the route's pod", async () => {
  const { admit, podsRoot } = await setup();
  const row = await admit(
    "families.capture",
    { pod: "global", familyIds: [1, 2] },
    0,
    "capture",
    "agent",
  );
  expect(row.state, JSON.stringify(row)).toBe("succeeded");
  const members = (row as { result: { members: { pod: string; path: string; sha256: string }[] } })
    .result.members;
  expect(members.map((m) => m.path)).toEqual([
    expect.stringMatching(/^settings\/families\/Box-.*\.json$/),
    expect.stringMatching(/^settings\/families\/Pipe-Fitting-.*\.json$/),
  ]);
  // A captured model says what it is; a family that failed to open writes nothing.
  // What the capture saw rides beside the members, per family, failures included.
  const evidence = (row as { result: { evidence: { families: Record<string, unknown>[] } } }).result
    .evidence;
  expect(evidence.families.map((f) => [f.familyId, f.success, f.error ?? null])).toEqual([
    [1, true, null],
    [2, true, null],
    [3, false, "cannot open"],
  ]);
  expect(JSON.stringify(evidence)).not.toContain("modelJson");
  expect(JSON.parse(await readFile(join(podsRoot, "Global", members[1]!.path), "utf8"))).toEqual({
    $schema: "http://127.0.0.1:5180/schemas/settings/FamilyFoundry/models.json",
    pipe: 1,
  });
});

test("an apply where no family succeeded settles failed with the receipt's reason; one success settles succeeded", async () => {
  const { work, admit, applied, box } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const failedBox = { ...box, success: false, error: "trace", errors: ["trace"] };
  const failedPipe = { ...failedBox, familyId: 2, familyName: "Pipe" };
  const reason =
    "2 of 2 families failed; the first, Box: Requested value 'FireProtectionDry' was not found.";
  applied({ receipts: [failedBox, failedPipe], reason });
  const none = await admit(
    "families.apply",
    { plan: plan.id, expectedPlanHashes: plan.included },
    revision,
    "none",
  );
  expect(none.state).toBe("failed");
  expect((none as { error?: string }).error).toBe(reason);
  // The per-family receipts stay on the settled row as evidence.
  expect(JSON.stringify(none)).toContain("Pipe");

  applied({ receipts: [box, failedPipe], reason: "1 of 2 families failed; the first, Pipe: x." });
  const partial = await admit(
    "families.apply",
    { plan: plan.id, expectedPlanHashes: plan.included },
    revision,
    "partial",
  );
  const result = resultOf<{ native: { receipts: { success: boolean }[] } }>(partial);
  expect(result.native.receipts.map((r) => r.success)).toEqual([true, false]);
});

/* ── O8-a: a plan applies once ───────────────────────────────────────────────────────────── */

test("a plan that already applied refuses a second apply: plan again, and nothing is dispatched", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const input = { plan: plan.id, expectedPlanHashes: plan.included };
  resultOf(await admit("families.apply", input, revision, "first"));
  const second = await admit("families.apply", input, revision, "second");
  expect(second.state).toBe("failed");
  expect((second as { error?: string }).error).toMatch(/already applied .*; plan again/);
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
});

test("a plan whose apply outcome is unknown refuses another apply until it is recovered", async () => {
  const { work, admit, sent, unknown } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const input = { plan: plan.id, expectedPlanHashes: plan.included };
  unknown(true);
  await admit("families.apply", input, revision, "uncertain");
  unknown(false);
  await expect(admit("families.apply", input, revision, "again")).rejects.toThrow(/recover/);
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
});

/* ── O8-b: a stale review refuses ────────────────────────────────────────────────────────── */

test("a staged cell changed since the plan refuses apply visibly; a Pea proposal alone does not", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10"), [H]: staged("20") });
  // Pea proposes on a consumed cell: the review still stands.
  const now = (await env.work.read(scope, "families"))!.revision;
  const pea = await env.work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", H, "proposal"], value: rung("25") }],
    now,
  );
  expect(pea.ok).toBe(true);
  // The person changes a consumed cell: what they reviewed is no longer what is staged.
  await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W, "staged"], value: rung("11") }],
    pea.revision!,
  );
  const stale = await env.admit("families.apply", apply, revision, "stale");
  expect(stale.state).toBe("failed");
  expect((stale as { error?: string }).error).toBe(
    "The staged cells changed since this plan; plan again",
  );
  expect(env.sent.filter((s) => s.key === "families.apply")).toHaveLength(0);
});

test("a Pea proposal on a consumed cell does not stale the plan", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10") });
  const now = (await env.work.read(scope, "families"))!.revision;
  await env.work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", W, "proposal"], value: rung("12") }],
    now,
  );
  resultOf(await env.admit("families.apply", apply, revision));
});
