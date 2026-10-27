import { afterEach, expect, test, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
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
  settingsRouteState,
  memberWork,
  type WorkKey,
  type Command,
  familyStagedPatch,
  commands,
  type FamilyCellState,
  parameterLinksReadingSchema,
  parameterLinksRouteState,
  transitionPatches,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { readFamily } from "../src/family-actions.ts";
import { invokeFamily } from "./domain-fixture.ts";
import { documentMarks } from "../src/document-marks.ts";
import { sdkEnvelope, sdkSessions } from "./native-receipt-fixture.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { crossingOf, human, pea } from "./callers.ts";
import { HttpRouter } from "effect/unstable/http";
import { z } from "zod";
import { takeoffsRouteState, type Caller } from "@pe/agent-contracts";
import type { RouteWorkspaceRegistration } from "@pe/runtime";
import { withInvocationContext } from "@pe/runtime/context";
import { makeCallRoute } from "../src/call-route.ts";
import { RevitBridge } from "../src/bridge.ts";
import { createPeRoutes, fileRouteDocumentStore } from "../src/pe-routes.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { RunConsents } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const at = address("C:/Tower.rvt");
const target = { session: "A", openId: "open-A" };
const scope = { binding: "address" as const, route: "families", target: at };
const parameterScope = { ...scope, route: "parameter-links" };
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
  changes: [{ section: "types", key: "Width", kind: "set", before: "1in", after: "2in" }],
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
const matrixFamily = (familyName: string, value: string, familyId = 1) => ({
  familyId,
  familyUniqueId: `unique-${familyName}-${familyId}`,
  familyName,
  categoryName: "Ducts",
  typeNames: ["T"],
  parameters: [
    {
      definition: { identity: { key: "Width", kind: "NameFallback", name: "Width" } },
      kind: "FamilyParameter",
      scope: "Family",
      storageType: "Double",
      formulaState: "None",
      valuesPerType: { T: value },
    },
  ],
  issues: [],
  isPartial: false,
  placedInstanceCount: 1,
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
async function setup(sdk: (args: readonly string[]) => Promise<string> = sdkSessions) {
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
  const sent: {
    key: string;
    input: any;
    id?: string;
  }[] = [];
  let planEntries = [entry(1, "Box", "h1"), entry(2, "Pipe", "h2")];
  let nativeFails = false;
  let nativeUnknown = false;
  let matrixFails = false;
  let matrixValue = "2in";
  let onBridgeEvent: ((event: unknown) => void) | null = null;
  const box = {
    familyId: 1,
    familyName: "Box",
    success: true,
    converged: true,
    residue: [],
    errors: [],
    artifactDirectory: "C:/art/1",
  };
  let applied: {
    receipts: unknown[];
    reason?: string;
  } = { receipts: [box] };
  let duringNative: (() => Promise<void>) | null = null;
  let familyDocument = false;
  const bridge = {
    subscribe: (listener: (event: unknown) => void) => {
      onBridgeEvent = listener;
      return () => {
        onBridgeEvent = null;
      };
    },
    list: Effect.sync(() => [
      {
        sessionId: "A",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
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
        if (id) await markDispatched(id);
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
        if (key === "revit.matrix.loaded-families") {
          if (matrixFails) throw Error("loaded-project matrix unavailable");
          return {
            value: {
              families: input.filter.familyNames.map((name: string) =>
                matrixFamily(name, matrixValue, name === "Box" ? 11 : 2),
              ),
              issues: [],
              page: {
                totalCount: input.filter.familyNames.length,
                returnedCount: input.filter.familyNames.length,
                isTruncated: false,
              },
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
  } as any;
  documentMarks(bridge);
  const work = new RouteWorkspace({
    registrations: [
      { spec: familiesRouteState },
      { spec: familyDraftRouteState },
      { spec: parameterLinksRouteState },
      { spec: settingsRouteState },
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
  const run = { thread: "domain-test", turn: dir };
  let autoAllow = true;
  const asks: string[] = [];
  const runs = new RunConsents((ref, event) => {
    if (event.kind === "permission_request") {
      asks.push(event.requestId);
      if (autoAllow) queueMicrotask(() => runs.decide(ref.thread, event.requestId, "allow_now"));
    }
  });
  runs.open(run);
  bindControl({ runs });
  cleanup.push(async () => {
    runs.close(run, "stopped");
    bindControl({ runs: undefined });
  });
  // biome-ignore lint/suspicious/noExplicitAny: the SDK reader is the shared native-receipt fixture.
  const deps = { workspace: work, sdk, podsRoot } as any;
  const read = (
    key: string,
    input: unknown = {},
    readScope = key.startsWith("parameter-links.") ? parameterScope : scope,
  ) => readFamily({ key, input, scope: readScope, target }, captures, bridge, deps);
  const admit = async (
    key: string,
    input: unknown,
    revision: number,
    id = `${key}${revision}`,
    actor: "human" | "agent" = "human",
    where: WorkKey | null = scope,
    resume = false,
  ) => {
    const row = await invokeFamily(
      {
        id,
        key,
        target:
          commands[key as keyof typeof commands].needs === "nothing"
            ? { kind: "host" }
            : { kind: "document", ref: target },
        input: {
          ...(input as Record<string, unknown>),
          ...(where
            ? {
                work: {
                  key:
                    where === scope
                      ? {
                          ...where,
                          route:
                            (commands[key as keyof typeof commands] as Command).work?.route ??
                            where.route,
                        }
                      : where,
                  revision,
                },
              }
            : {}),
        },
      },
      actor === "agent"
        ? {
            caller: { kind: "pea", context: "domain-test", thread: run.thread, run, root: run },
            basis: null,
          }
        : crossingOf(actor),
      owner,
      captures,
      bridge,
      deps,
      resume,
    );
    return owner.wait(row.id);
  };
  /** A member file in the Global pod, addressed as a plan source. */
  const file = async (name: string, content: string) => {
    await writeFile(join(podsRoot, "Global", "settings", name), content);
    return { ...member(name), sha256: createHash("sha256").update(content).digest("hex") };
  };
  return {
    approval: {
      hold: () => {
        autoAllow = false;
      },
      allow: () => runs.decide(run.thread, asks.at(-1)!, "allow_now"),
      asks,
    },
    podsRoot,
    work,
    file,
    familyDocument: (v: boolean) => {
      familyDocument = v;
    },
    owner,
    captures,
    recover: (id: string) => owner.recover(id),
    sent,
    matrixFails: (value: boolean) => {
      matrixFails = value;
    },
    matrixValue: (value: string) => {
      matrixValue = value;
    },
    changed: async () => {
      onBridgeEvent?.({
        sessionId: target.session,
        kind: "event",
        eventName: "document-changed",
        payloadJson: JSON.stringify({ changedOpenIds: [target.openId] }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
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
async function authorFamilies(work: RouteWorkspace, revision = 0, where = scope) {
  const landed = await work.publish(
    where,
    "families",
    [
      {
        path: ["scope", "edit"],
        value: {
          value: {
            categoryNames: ["Ducts"],
            familyNames: ["Box", "Pipe"],
            placementScope: "AllLoaded",
          },
        },
      },
      { path: ["takenAt"], value: new Date().toISOString() },
    ],
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}
/* ── the boundary itself ─────────────────────────────────────────────────────────────────── */
type Plan = {
  id: string;
  plan: {
    familyId: number;
  }[];
  included: Record<string, string>;
};
const resultOf = <A>(row: unknown) => {
  const settled = row as {
    state: string;
    error?: string;
    result?: A;
  };
  expect(settled.state, JSON.stringify(settled.error)).toBe("succeeded");
  return settled.result!;
};
test("human and Pea share plan and Apply; Pea receives root-run consent", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(
    await admit("families.plan", { source }, revision, "agent-plan", "agent"),
  );
  resultOf(
    await admit(
      "families.apply",
      { plan: plan.id, include: ["1"] },
      revision,
      "agent-apply",
      "agent",
    ),
  );
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
});
test("apply sends the bytes its plan sealed, not the member as saved since", async () => {
  const { work, admit, sent, podsRoot } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  await writeFile(join(podsRoot, "Global", "settings", "p.json"), '{"patch":{"changed":1}}');
  resultOf(await admit("families.apply", { plan: plan.id, include: "all" }, revision));
  expect(sent.find((row) => row.key === "families.apply")!.input.specJson).toBe(composed);
});
test("apply refuses a missing or foreign plan, or a selection with no planned family", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const refusals = [
    await admit("families.apply", { plan: "nope", include: ["1"] }, revision, "a1"),
    await admit("family.apply", { plan: plan.id, include: ["1"] }, 0, "a2"),
    await admit("families.apply", { plan: plan.id, include: ["unplanned"] }, revision, "a3"),
  ];
  expect(
    refusals.map((row) => [
      row.state,
      (
        row as {
          error?: string;
        }
      ).error,
    ]),
  ).toEqual([
    ["failed", "Apply must name a succeeded families.plan action"],
    ["failed", expect.stringMatching(/Target document lifetime or kind differs/)],
    ["failed", expect.stringMatching(/No included family/)],
  ]);
  expect(sent.filter((s) => s.key.endsWith(".apply"))).toHaveLength(0);
});
test("Apply accepts only a plan selection and rejects forged caller hashes or competing source paths", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  const plan = resultOf<Plan>(await env.admit("families.plan", { source }, revision));
  for (const invalid of [
    { plan: plan.id, expectedPlanHashes: { "1": "forged" } },
    { rows: { plan: plan.id } },
    { source, plan: plan.id },
  ])
    await expect(env.admit("families.apply", invalid, revision, "forged")).rejects.toThrow();
  resultOf(
    await env.admit("families.apply", { plan: plan.id, include: ["Box"] }, revision, "selected"),
  );
  expect(
    env.sent
      .filter((row) => row.key === "families.apply")
      .map((row) => row.input.expectedPlanHashes),
  ).toEqual([{ "1": "h1" }]);
});

test("families apply sends exactly the reviewed hashes, and the spec, source bytes and options its plan sealed", async () => {
  const { work, admit, sent } = await setup();
  const revision = await authorFamilies(work);
  const options = { singleTransaction: true };
  const plan = resultOf<Plan>(
    await admit("families.plan", { source, executionOptions: options }, revision),
  );
  resultOf(await admit("families.apply", { plan: plan.id, include: ["1", "2"] }, revision));
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
/* ── consumed-cell retirement (obligation 8) ─────────────────────────────────────────────── */
const cellOf = (parameter: string) =>
  familyCellKey({ familyName: "Box", typeName: "T", parameter });
const W = cellOf("Width");
const H = cellOf("Height");
const D = cellOf("Depth");
const staged = (value: string): FamilyCellState => ({
  suggestion: null,
  edit: { value: { value, storageType: "Double" as const } },
});
const rung = (value: string) => ({ value: { value, storageType: "Double" as const } });
/** Box's staged cells, the member they generate, and its one-family plan at that revision. */
async function stagedPlan(
  env: Awaited<ReturnType<typeof setup>>,
  cells: Record<string, FamilyCellState>,
  content?: string,
) {
  const authored = await authorFamilies(env.work);
  const document = familiesRouteState.schema.parse((await env.work.read(scope, "families"))!.doc);
  await env.captures.saveFamilies({
    work: scope,
    document: target,
    filter: stagedFilter(document)!,
    capturedAt: document.takenAt!,
    result: {
      families: [matrixFamily("Box", "1in"), matrixFamily("Pipe", "1in", 2)],
      issues: [],
      page: { totalCount: 2, returnedCount: 2, isTruncated: false },
    },
  });
  const revision = (
    await env.work.apply(scope, "families", "human", [{ path: ["cells"], value: cells }], authored)
  ).revision!;
  const generated = familyStagedPatch(cells, "Box")!;
  // The reviewed draft travels as bytes; nothing is filed in the pod.
  const draft = {
    path: "staged/Box.json",
    content:
      content ??
      `${JSON.stringify({ $schema: "https://ff/schema.json", ...generated.spec }, null, 2)}\n`,
  };
  const plan = resultOf<Plan>(
    await env.admit("families.plan", { source: draft, familyNames: ["Box"] }, revision),
  );
  return { plan, revision, draft, apply: { plan: plan.id, include: "all" } };
}
const nativePatch = {
  path: "proposed/duct-patch.json",
  content: `${JSON.stringify({
    $schema: "https://ff/schemas/settings/FamilyFoundry/patches.json",
    select: { names: ["Box", "Pipe"] },
    patch: { parameters: { Width: { formula: "NeckOuterW" } } },
  })}\n`,
};
async function nativePatchPlan(env: Awaited<ReturnType<typeof setup>>) {
  const authored = await authorFamilies(env.work);
  const document = familiesRouteState.schema.parse((await env.work.read(scope, "families"))!.doc);
  await env.captures.saveFamilies({
    work: scope,
    document: target,
    filter: stagedFilter(document)!,
    capturedAt: document.takenAt!,
    result: {
      families: [matrixFamily("Box", "1in"), matrixFamily("Pipe", "1in", 2)],
      issues: [],
      page: { totalCount: 2, returnedCount: 2, isTruncated: false },
    },
  });
  const revision = (
    await env.work.apply(
      scope,
      "families",
      "human",
      [{ path: ["patch", "edit"], value: { value: nativePatch } }],
      authored,
    )
  ).revision!;
  const plan = resultOf<Plan>(await env.admit("families.plan", { source: nativePatch }, revision));
  return { plan, revision, apply: { plan: plan.id, include: "all" } };
}
test("native patch proposal is staged by a person and its exact supplied bytes retire after every family succeeds", async () => {
  const env = await setup();
  const proposed = await authorFamilies(env.work);
  const document = familiesRouteState.schema.parse((await env.work.read(scope, "families"))!.doc);
  await env.captures.saveFamilies({
    work: scope,
    document: target,
    filter: stagedFilter(document)!,
    capturedAt: document.takenAt!,
    result: {
      families: [matrixFamily("Box", "1in"), matrixFamily("Pipe", "1in", 2)],
      issues: [],
      page: { totalCount: 2, returnedCount: 2, isTruncated: false },
    },
  });
  const byPea = await env.work.apply(
    scope,
    "families",
    "pea",
    [{ path: ["patch", "suggestion"], value: { value: nativePatch } }],
    proposed,
  );
  expect(byPea.ok).toBe(true);
  const deniedStage = await env.work.apply(
    scope,
    "families",
    "pea",
    [{ path: ["patch", "edit"], value: { value: nativePatch } }],
    byPea.revision!,
  );
  expect(deniedStage.ok).toBe(true);
  const accepted = await env.work.apply(
    scope,
    "families",
    "human",
    transitionPatches([], "patch", { suggestion: { value: nativePatch } }, { kind: "take" }),
    deniedStage.revision!,
  );
  expect(accepted.ok).toBe(true);
  // Plan admission binds the exact reviewed source, including path and unchanged content bytes.
  const wrong = await env.admit(
    "families.plan",
    { source: { ...nativePatch, content: `${nativePatch.content} ` } },
    accepted.revision!,
    "wrong-patch",
  );
  expect(wrong.state).toBe("failed");
  expect(
    String(
      (
        wrong as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/exact native patch source/);
  expect(env.sent.filter((row) => row.key === "families.plan")).toHaveLength(0);
  // A new Pea counterproposal leaves the human's staged bytes authoritative.
  const counter = await env.work.apply(
    scope,
    "families",
    "pea",
    [{ path: ["patch", "suggestion"], value: { value: { ...nativePatch, path: "counter.json" } } }],
    accepted.revision!,
  );
  expect(counter.ok).toBe(true);
  const plan = resultOf<Plan>(
    await env.admit("families.plan", { source: nativePatch }, counter.revision!),
  );
  env.applied({ receipts: [env.box, { ...env.box, familyId: 2, familyName: "Pipe" }] });
  const done = resultOf<{
    retired: {
      retired: string[][];
    };
  }>(await env.admit("families.apply", { plan: plan.id, include: "all" }, counter.revision!));
  expect(done.retired.retired).toContainEqual(["patch"]);
  const final = familiesRouteState.schema.parse((await env.work.read(scope, "families"))!.doc);
  expect(final.patch.edit).toBeNull();
  expect(final.patch.suggestion?.value.path).toBe("counter.json");
  const root = env.sent.find((row) => row.key === "families.apply")!.input.source.root;
  expect(Buffer.from(root.bytesBase64, "base64").toString("utf8")).toBe(nativePatch.content);
});
test.each(["suggestion", "edit"] as const)(
  "a held native patch ignores new %s-only cell membership only when it is not edited",
  async (lane) => {
    const env = await setup();
    const { apply, revision } = await nativePatchPlan(env);
    env.approval.hold();
    const completion = env.admit("families.apply", apply, revision, `patch-${lane}`, "agent");
    await vi.waitFor(async () =>
      expect((await env.owner.list(undefined, `patch-${lane}`))[0]?.state).toBe("waiting"),
    );
    expect(
      await env.work.apply(
        scope,
        "families",
        "pea",
        [{ path: ["cells", D, lane], value: rung("99") }],
        revision,
      ),
    ).toMatchObject({ ok: true });
    env.approval.allow();
    const row = await completion;
    if (lane === "edit") {
      expect(row).toMatchObject({
        state: "failed",
        notDispatched: true,
        refusal: { kind: "stale" },
      });
      expect(env.sent.filter((item) => item.key === "families.apply")).toHaveLength(0);
    } else {
      resultOf(row);
      expect(env.sent.filter((item) => item.key === "families.apply")).toHaveLength(1);
      expect((await cellsNow(env.work))[D]?.suggestion).toMatchObject(rung("99"));
    }
  },
);

test("native patch refuses mixed staged cells and keeps its staged rung after partial success", async () => {
  const env = await setup();
  const { apply, revision } = await nativePatchPlan(env);
  env.applied({
    receipts: [
      env.box,
      {
        ...env.box,
        familyId: 2,
        familyName: "Pipe",
        converged: false,
        residue: entry(2, "Pipe", "partial").changes,
      },
    ],
  });
  const done = resultOf<{
    retired: {
      retired: string[][];
    };
  }>(await env.admit("families.apply", apply, revision));
  expect(done.retired.retired).not.toContainEqual(["patch"]);
  expect(
    familiesRouteState.schema.parse((await env.work.read(scope, "families"))!.doc).patch.edit,
  ).toMatchObject({ value: nativePatch });
  const current = (await env.work.read(scope, "families"))!.revision;
  const mixed = await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W], value: staged("10") }],
    current,
  );
  expect(mixed.ok).toBe(true);
  const refused = await env.admit(
    "families.plan",
    { source: nativePatch },
    mixed.revision!,
    "mixed-patch-plan",
  );
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/not both/);
});
test("native patch apply refuses a changed staged source before native dispatch", async () => {
  const env = await setup();
  const { apply, revision } = await nativePatchPlan(env);
  const changed = await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["patch", "edit"], value: { value: { ...nativePatch, path: "changed.json" } } }],
    revision,
  );
  expect(changed.ok).toBe(true);
  const refused = await env.admit("families.apply", apply, changed.revision!);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/Consumed input changed/);
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(0);
});
test("native patch apply refuses cells staged after its plan", async () => {
  const env = await setup();
  const { apply, revision } = await nativePatchPlan(env);
  const mixed = await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W], value: staged("10") }],
    revision,
  );
  expect(mixed.ok).toBe(true);
  const refused = await env.admit("families.apply", apply, mixed.revision!);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/Consumed input changed/);
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(0);
});
test("per-type cell apply refuses a native patch staged after its plan", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10") });
  const mixed = await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["patch", "edit"], value: { value: nativePatch } }],
    revision,
  );
  expect(mixed.ok).toBe(true);
  const refused = await env.admit("families.apply", apply, mixed.revision!);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/Consumed input changed/);
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(0);
});
const cellsNow = async (work: RouteWorkspace) =>
  familiesRouteState.schema.parse((await work.read(scope, "families"))!.doc).cells;
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
        { path: ["cells", W, "edit"], value: rung("11") },
        { path: ["cells", D], value: staged("5") },
      ],
      now,
    );
    expect(landed.ok).toBe(true);
    const pea = await env.work.apply(
      scope,
      "families",
      "pea",
      [{ path: ["cells", H, "suggestion"], value: rung("25") }],
      landed.revision!,
    );
    expect(pea.ok).toBe(true);
  });
  const done = resultOf<{
    retired: {
      retired: string[][];
    };
  }>(await env.admit("families.apply", apply, revision));
  expect(done.retired.retired).toEqual([["cells", H]]);
  const cells = await cellsNow(env.work);
  expect(cells[W]?.edit).toMatchObject(rung("11"));
  expect(cells[D]?.edit).toMatchObject(rung("5"));
  expect(cells[H]).toMatchObject({ suggestion: rung("25"), edit: null });
});
test("a consumed unchanged cell retires once, with a proposal equal to it; replay neither redispatches nor re-retires", async () => {
  const env = await setup();
  const { apply, revision } = await stagedPlan(env, {
    [W]: { suggestion: rung("10"), edit: { value: { value: "10", storageType: "Double" } } },
  });
  const first = await env.admit("families.apply", apply, revision, "retire-once");
  resultOf(first);
  expect((await cellsNow(env.work))[W]).toEqual({ suggestion: null, edit: null });
  // The person stages the same value again after the retirement.
  const now = (await env.work.read(scope, "families"))!.revision;
  await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W, "edit"], value: rung("10") }],
    now,
  );
  const replay = await env.admit("families.apply", apply, revision, "retire-once");
  expect(replay.id).toBe(first.id);
  expect(env.sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
  expect((await cellsNow(env.work))[W]?.edit).toMatchObject(rung("10"));
  expect(
    (await env.owner.list(undefined, first.id))[0]!.steps.filter(
      (step) => step.key === "work.retire",
    ),
  ).toHaveLength(1);
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
    expect((await cellsNow(env.work))[W]?.edit).toMatchObject(rung("10"));
  }
});
test("/family retires the draft's consumed cells after a proven apply, and keeps a newer edit", async () => {
  const env = await setup();
  env.familyDocument(true);
  const draftKey = { binding: "address" as const, route: "family", target: at };
  const reading = JSON.stringify({ Width: 1, Height: 2 });
  const revision = (
    await env.work.publish(
      draftKey,
      "family",
      [
        { path: ["reading"], value: reading },
        { path: ["takenAt"], value: new Date().toISOString() },
        {
          path: ["cells"],
          value: { "/Width": { edit: { value: 5 } }, "/Height": { edit: { value: 7 } } },
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
    await env.work.publish(
      draftKey,
      "family",
      [{ path: ["cells", "/Height", "edit"], value: { value: 8 } }],
      now,
    );
  });
  resultOf(
    await env.admit(
      "family.apply",
      { plan: plan.id, include: "all" },
      revision,
      "fa",
      "human",
      draftKey,
    ),
  );
  const cells = familyDraftRouteState.schema.parse(
    (await env.work.read(draftKey, "family"))!.doc,
  ).cells;
  expect(cells["/Width"]?.edit).toBeNull();
  expect(cells["/Height"]?.edit).toMatchObject({ value: 8 });
  expect(await readdir(join(env.podsRoot, "Global"), { recursive: true })).toEqual(before);
  const root = env.sent.find((s) => s.key === "family.apply")!.input.source.root;
  expect(root).toMatchObject({ id: "global", path: draft.path, origin: "SuppliedDraft" });
  expect(Buffer.from(root.bytesBase64, "base64").toString("utf8")).toBe(draft.content);
});
/* ── parameter links ─────────────────────────────────────────────────────────────────────── */
/** The person stages a profile on the one cell. */
async function authorDraft(work: RouteWorkspace, draft: unknown, revision = 0) {
  const landed = await work.apply(
    parameterScope,
    "parameter-links",
    "human",
    transitionPatches([], "profile", {}, { kind: "set", rung: { value: draft } }),
    revision,
  );
  expect(landed.ok).toBe(true);
  return landed.revision!;
}
test("a Pea-proposed profile previews labelled and never arms apply; the person's staged one does", async () => {
  const { work, read, admit, sent, captures } = await setup();
  const proposed = { ...link, definitions: [{ ...link.definitions[0], reducer: "max" as const }] };
  const landed = await work.apply(
    parameterScope,
    "parameter-links",
    "pea",
    transitionPatches([], "profile", {}, { kind: "suggest", rung: { value: proposed } }),
    0,
  );
  expect(landed).toMatchObject({ ok: true });
  // The preview evaluates the proposal, says so, and names it as its basis.
  const preview = (await read("parameter-links.read", {
    evaluate: true,
    subject: "suggestion",
  })) as {
    id: string;
  };
  const reading = parameterLinksReadingSchema.parse(
    (await captures.familyReadings(parameterScope))[0]!.reading.value,
  );
  expect(reading).toMatchObject({ evaluated: true, subject: "suggestion" });
  expect(sent.at(-1)!.input).toMatchObject({ profile: proposed, previewOnly: true });
  const refused = await admit("parameter-links.apply", { readingId: preview.id }, landed.revision!);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/Stage a profile/);
  // The person stages their own profile. The proposal preview still cannot arm apply.
  const revision = await authorDraft(work, link, landed.revision!);
  const stillRefused = await admit(
    "parameter-links.apply",
    { readingId: preview.id },
    revision,
    "apply-proposal-preview",
  );
  expect(
    String(
      (
        stillRefused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/proposal preview/);
  expect(sent.filter((s) => s.input?.previewOnly === false)).toHaveLength(0);
  // Only the staged evaluation arms apply, with exactly the staged value.
  const evaluated = (await read("parameter-links.read", { evaluate: true })) as {
    id: string;
  };
  const row = await admit("parameter-links.apply", { readingId: evaluated.id }, revision);
  expect(
    row.state,
    JSON.stringify(
      (
        row as {
          error?: string;
        }
      ).error,
    ),
  ).toBe("succeeded");
  expect(sent.find((s) => s.input?.previewOnly === false)!.input).toMatchObject({
    profile: link,
    reconcile: true,
  });
});
test("a draft edited after the evaluation refuses before any native write", async () => {
  const { work, read, admit, sent } = await setup();
  const evaluated = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: true })) as {
    id: string;
  };
  const edited = await work.apply(
    parameterScope,
    "parameter-links",
    "human",
    transitionPatches(
      [],
      "profile",
      {},
      {
        kind: "set",
        rung: { value: { ...link, definitions: [{ ...link.definitions[0], reducer: "max" }] } },
      },
    ),
    evaluated,
  );
  const before = sent.filter((s) => s.key === "revit.apply.parameter-links").length;
  const refused = await admit("parameter-links.apply", { readingId: capture.id }, edited.revision!);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/changed after the evaluation/);
  expect(sent.filter((s) => s.key === "revit.apply.parameter-links")).toHaveLength(before);
});
test("a stored-profile read can never arm an apply of a draft it did not evaluate", async () => {
  const { work, read, admit, sent } = await setup();
  const revision = await authorDraft(work, link);
  const capture = (await read("parameter-links.read", { evaluate: false })) as {
    id: string;
  };
  const refused = await admit("parameter-links.apply", { readingId: capture.id }, revision);
  expect(refused.state).toBe("failed");
  expect(
    String(
      (
        refused as {
          error?: string;
        }
      ).error,
    ),
  ).toMatch(/stored-profile read/);
  expect(sent.filter((s) => s.key === "revit.apply.parameter-links")).toHaveLength(0);
});
test.each(["suggestion", "edit", "native"] as const)(
  "held Parameter Links Apply consumes its edited profile and exact native reading: %s",
  async (change) => {
    const env = await setup();
    const revision = await authorDraft(env.work, link);
    const capture = (await env.read("parameter-links.read", { evaluate: true })) as { id: string };
    env.approval.hold();
    const completion = env.admit(
      "parameter-links.apply",
      { readingId: capture.id },
      revision,
      "held-profile",
      "agent",
    );
    await vi.waitFor(async () =>
      expect((await env.owner.list(undefined, "held-profile"))[0]?.state).toBe("waiting"),
    );
    if (change === "native") await env.changed();
    else
      expect(
        await env.work.apply(
          parameterScope,
          "parameter-links",
          change === "edit" ? "human" : "pea",
          [
            {
              path: ["profile", change],
              value: {
                value: { ...link, definitions: [{ ...link.definitions[0], reducer: "max" }] },
              },
            },
          ],
          revision,
        ),
      ).toMatchObject({ ok: true });
    env.approval.allow();
    const completed = await completion;
    expect(completed).toMatchObject(
      change === "suggestion" ? { state: "succeeded" } : { state: "failed", notDispatched: true },
    );
    expect(
      env.sent.filter(
        (row) => row.key === "revit.apply.parameter-links" && row.input.previewOnly === false,
      ),
    ).toHaveLength(change === "suggestion" ? 1 : 0);
  },
);
test("a plan whose apply outcome is unknown refuses another apply until it is recovered", async () => {
  const { work, admit, sent, unknown } = await setup();
  const revision = await authorFamilies(work);
  const plan = resultOf<Plan>(await admit("families.plan", { source }, revision));
  const input = { plan: plan.id, include: "all" };
  unknown(true);
  await admit("families.apply", input, revision, "uncertain");
  unknown(false);
  expect(await admit("families.apply", input, revision, "again")).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "claimed" },
  });
  expect(sent.filter((s) => s.key === "families.apply")).toHaveLength(1);
});
test("an interrupted Families apply resumes from its exact durable FF run without native redispatch", async () => {
  let nativeResult: unknown;
  const env = await setup(async (args) =>
    args.includes("result") ? sdkEnvelope(nativeResult) : sdkSessions(args),
  );
  const { apply, revision } = await stagedPlan(env, { [W]: staged("10") });
  env.unknown(true);
  const interrupted = await env.admit("families.apply", apply, revision, "interrupted");
  env.unknown(false);
  expect(interrupted.state).toBe("unknown");
  const step = interrupted.steps.find((row) => row.key === "families.apply")!;
  const prepared = (
    interrupted.prepared as {
      value: {
        process: {
          pid: number;
          processStartUtc: string;
        };
      };
    }
  ).value;
  nativeResult = {
    state: "ok",
    requestId: step.id,
    receipt: {
      requestId: step.id,
      key: step.key,
      pid: prepared.process.pid,
      processStartUtc: prepared.process.processStartUtc,
      verdict: "ok",
      startedUtc: "2026-09-23T09:00:00Z",
      completedUtc: "2026-09-23T09:00:01Z",
      responsePath: "aborted.json",
    },
    response: { error: "WebSocket Aborted" },
  };
  // A transport error under verdict=ok still cannot prove the native apply. The stable executor
  // reads this SDK witness; callers no longer replace the recovery protocol with a callback.
  const unsupported = await env.recover("interrupted");
  expect(unsupported.state).toBe("unknown");
  expect(unsupported.steps.find((row) => row.id === step.id)?.state).toBe("unknown");
  await expect(
    env.admit("families.apply", apply, revision, "interrupted", "human", scope, true),
  ).rejects.toThrow(/Recover every uncertain step/);
  const input = step.input as {
    plan: string;
    specJson: string;
    expectedPlanHashes: Record<string, string>;
    familyNames: Record<string, string>;
    source: {
      root: {
        id: string | null;
        path: string;
        sha256: string;
        origin: string;
        bytesBase64: string;
      };
    };
  };
  const run = join(
    env.podsRoot,
    "default",
    "output",
    "operations",
    "20260923-090000-0123456789abcdef0123456789abcdef",
  );
  await mkdir(run, { recursive: true });
  const runInput = {
    operation: "families.apply",
    plan: { actionId: input.plan },
    expectedPlanHashes: input.expectedPlanHashes,
    familyNames: input.familyNames,
    target: {
      openId: "another-document",
      process: {
        processId: prepared.process.pid,
        processStartUtc: prepared.process.processStartUtc,
      },
    },
    source: {
      origin: input.source.root.origin,
      pod: input.source.root.id,
      path: input.source.root.path,
      sha256: input.source.root.sha256,
    },
    files: [
      {
        role: "supplied-draft",
        address: input.source.root.path,
        sha256: input.source.root.sha256,
        file: "source/00-Box.json",
      },
    ],
  };
  await writeFile(join(run, "input.json"), JSON.stringify(runInput));
  await writeFile(join(run, "effective-input.json"), input.specJson);
  await mkdir(join(run, "source"), { recursive: true });
  await writeFile(
    join(run, "source", "00-Box.json"),
    Buffer.from(input.source.root.bytesBase64, "base64"),
  );
  await writeFile(
    join(run, "receipt.json"),
    JSON.stringify({
      operation: "families.apply",
      outcome: "Succeeded",
      origin: input.source.root.origin,
      planHash: input.expectedPlanHashes["1"],
      outputs: ["input.json", "apply.json"],
    }),
  );
  await writeFile(
    join(run, "apply.json"),
    JSON.stringify({
      Receipts: [
        {
          FamilyId: 1,
          FamilyName: "Box",
          Success: true,
          Converged: true,
          Error: null,
          PlanHash: input.expectedPlanHashes["1"],
          Residue: [],
          Errors: [],
          ArtifactDirectory: "Box",
          LoadedFamilyId: 11,
        },
      ],
      Diagnostics: [],
      Reason: null,
    }),
  );
  const wrongDocument = await env.recover("interrupted");
  expect(wrongDocument.steps.find((row) => row.id === step.id)?.state).toBe("unknown");
  await writeFile(
    join(run, "input.json"),
    JSON.stringify({ ...runInput, target: { ...runInput.target, openId: target.openId } }),
  );
  const recovered = await env.recover("interrupted");
  expect(recovered.state).toBe("unknown");
  expect(recovered.steps.find((row) => row.id === step.id)).toMatchObject({
    state: "succeeded",
    result: { receipts: [{ familyName: "Box", success: true, loadedFamilyId: 11 }] },
  });
  const resumed = resultOf<{
    retired: {
      retired: string[][];
    };
  }>(await env.admit("families.apply", apply, revision, "interrupted", "human", scope, true));
  expect(resumed.retired.retired).toEqual([["cells", W]]);
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(1);
});
/* ── O8-b: a stale review refuses ────────────────────────────────────────────────────────── */
test("a staged cell changed since the plan refuses apply visibly; a Pea proposal alone does not", async () => {
  const env = await setup();
  const { apply } = await stagedPlan(env, { [W]: staged("10"), [H]: staged("20") });
  // Pea proposes on a consumed cell: the review still stands.
  const now = (await env.work.read(scope, "families"))!.revision;
  const pea = await env.work.apply(
    scope,
    "families",
    "pea",
    [{ path: ["cells", H, "suggestion"], value: rung("25") }],
    now,
  );
  expect(pea.ok).toBe(true);
  // The person changes a consumed cell: what they reviewed is no longer what is staged.
  await env.work.apply(
    scope,
    "families",
    "human",
    [{ path: ["cells", W, "edit"], value: rung("11") }],
    pea.revision!,
  );
  const stale = await env.admit(
    "families.apply",
    apply,
    (await env.work.read(scope, "families"))!.revision,
    "stale",
  );
  expect(stale.state).toBe("failed");
  expect(
    (
      stale as {
        error?: string;
      }
    ).error,
  ).toMatch(/Consumed input changed/);
  expect(env.sent.filter((s) => s.key === "families.apply")).toHaveLength(0);
});
/* ── Doors 2 and 9: the minted caller, never a self-asserted actor (ADR 0017 D2) ─────────── */
const doorRegistrations = [
  {
    spec: {
      route: "door",
      title: "Door",
      description: "Caller proof",
      schema: takeoffsRouteState.schema.extend({ count: z.number().int().default(0) }),
    },
  },
] as unknown as RouteWorkspaceRegistration[];
test("door 2: anonymous /actions is context.missing, a body actor is a strict parse error, and an actor header is ignored", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-door2-"));
  const web = HttpRouter.toWebHandler(
    makeCallRoute(
      new ActionJournal(join(root, "journal.json")),
      new TakeoffCaptures(join(root, "c")),
      {
        sdk: sdkSessions,
      },
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, {} as RevitBridge["Service"]))),
    { disableLogger: true },
  );
  // Acquisition is context, not run consent. A forged actor header cannot mint a causal run.
  bindControl({ acquired: () => "acq-1" });
  const admission = {
    id: "door-2",
    key: "family.build",
    target: { kind: "document", ref: { session: "S1", openId: "A" } },
    input: {
      source: { pod: "sample", path: "settings/family.json", sha256: "c".repeat(64) },
    },
  };
  const post = (as: Caller, body: unknown, headers: Record<string, string> = {}) =>
    withInvocationContext({ caller: as }, async () => {
      const response = await web.handler(
        new Request("http://host/actions", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
        Context.empty() as never,
      );
      return { status: response.status, json: (await response.json()) as Record<string, any> };
    });
  try {
    const anonymous = await post({ kind: "anonymous" }, admission);
    expect([anonymous.status, anonymous.json.refusal?.code]).toEqual([403, "context.missing"]);
    expect(anonymous.json.notDispatched).toBe(true);
    const spoofed = await post(human, { ...admission, actor: "human" });
    expect(spoofed.status).toBe(409);
    expect(spoofed.json.error).toMatch(/actor/);
    const header = await post(pea(), admission, { "x-pe-action-actor": "human" });
    expect(header.status).toBe(200);
    expect(header.json).toMatchObject({ caller: { kind: "pea", thread: "thread-1" } });
    expect(String(header.json.error)).not.toContain("human.only");
  } finally {
    bindControl({ acquired: () => null, acquiredSession: () => null });
    await web.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
test("door 9: route Work writes take their author from the caller; the /pe/agent prefix is gone", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-door9-"));
  const app = createPeRoutes({
    registrations: doorRegistrations,
    store: fileRouteDocumentStore(join(root, "work")),
    heads: { observe: () => () => {} },
  });
  const write = (as: Caller, path = "/pe/route-state/door/apply?work=w1", revision = 0) =>
    withInvocationContext({ caller: as }, async () => {
      const response = await app.fetch(
        new Request(`http://host${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pe-action-actor": "human" },
          body: JSON.stringify({
            expectedRevision: revision,
            patches: [{ path: ["count"], value: 1 + revision }],
          }),
        }),
      );
      return { status: response.status, json: (await response.json()) as Record<string, any> };
    });
  try {
    const anonymous = await write({ kind: "anonymous" });
    expect([anonymous.status, anonymous.json.refusal?.code]).toEqual([403, "context.missing"]);
    const page = await write({ kind: "page", page: "page:@pages/todo" });
    expect([page.status, page.json.refusal?.code]).toEqual([403, "page.use-page-door"]);
    expect((await write(pea(), "/pe/agent/route-state/door/apply?work=w1")).status).toBe(404);
    expect((await write(human)).json).toMatchObject({ ok: true, revision: 1 });
    expect((await write(pea(), undefined, 1)).json).toMatchObject({ ok: true, revision: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("one direct Apply plans, seals hashes, applies and reads back under one journal command", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  resultOf(await env.admit("families.apply", { source, include: ["Box"] }, revision, "direct"));
  const writes = env.sent.filter((row) => row.key === "families.apply");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.input.expectedPlanHashes).toEqual({ "1": "h1" });
  expect(env.sent.filter((row) => row.key === "families.plan")).toHaveLength(1);
  expect(await env.owner.list()).toHaveLength(1);
});
test("host composition makes one root plan from edited families and every edited type, with native numeric values", async () => {
  const env = await setup();
  const boxB = familyCellKey({ familyName: "Box", typeName: "B", parameter: "Height" });
  const pipe = familyCellKey({ familyName: "Pipe", typeName: "T", parameter: "Width" });
  const elbow = familyCellKey({ familyName: "Elbow", typeName: "T", parameter: "Width" });
  const { revision } = await stagedPlan(env, {
    [W]: staged("24"),
    [boxB]: staged("30"),
    [pipe]: staged("40"),
    [elbow]: { edit: null, suggestion: rung("99") },
  });
  const root = resultOf<Plan & { results: unknown[] }>(
    await env.admit("families.plan", {}, revision, "root-preview"),
  );
  const sources = env.sent.filter((row) => row.key === "families.plan").slice(-2);
  expect(sources.map((row) => row.input.familyNames)).toEqual([["Box"], ["Pipe"]]);
  expect(JSON.parse(sources[0]!.input.specJson)).toMatchObject({
    patch: { types: { T: { Width: 24 }, B: { Height: 30 } } },
  });
  expect(JSON.parse(sources[1]!.input.specJson)).toMatchObject({
    patch: { types: { T: { Width: 40 } } },
  });
  expect(root).toMatchObject({ id: "root-preview", included: { "1": "h1", "2": "h2" } });
  expect(root.results).toHaveLength(2);
  resultOf(
    await env.admit("families.apply", { plan: root.id, include: ["Box"] }, revision, "root-apply"),
  );
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(1);
  expect(env.sent.find((row) => row.key === "families.apply")!.input.expectedPlanHashes).toEqual({
    "1": "h1",
  });
  expect((await cellsNow(env.work))[pipe]?.edit).toMatchObject(rung("40"));
});
test("saving drafts composes source bytes in the host and remains independent of a native target", async () => {
  const env = await setup();
  const { revision } = await stagedPlan(env, { [W]: staged("24") });
  const result = resultOf<{ saved: number; members: { path: string }[] }>(
    await env.admit("families.save-draft", { pod: "global" }, revision, "save-work"),
  );
  expect(result.saved).toBe(1);
  const text = await readFile(join(env.podsRoot, "Global", result.members[0]!.path), "utf8");
  expect(JSON.parse(text)).toMatchObject({
    select: { names: ["Box"] },
    patch: { types: { T: { Width: 24 } } },
  });
  expect((await env.owner.list(undefined, "save-work"))[0]!.target).toEqual({ kind: "host" });
});
test("an unrelated proposal during a held direct Apply preserves the consumed intent", async () => {
  const env = await setup();
  const { revision } = await stagedPlan(env, { [W]: staged("24") });
  env.approval.hold();
  const completion = env.admit(
    "families.apply",
    { include: "all" },
    revision,
    "held-direct",
    "agent",
  );
  await vi.waitFor(async () =>
    expect((await env.owner.list(undefined, "held-direct"))[0]?.state).toBe("waiting"),
  );
  expect(
    await env.work.apply(
      scope,
      "families",
      "pea",
      [{ path: ["cells", D, "suggestion"], value: rung("99") }],
      revision,
    ),
  ).toMatchObject({ ok: true });
  env.approval.allow();
  resultOf(await completion);
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(1);
  expect((await cellsNow(env.work))[D]?.suggestion).toMatchObject(rung("99"));
});
test("a submitted source freezes before countdown; changed source never becomes a later write", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  env.approval.hold();
  const completion = env.admit(
    "families.apply",
    { source, include: "all" },
    revision,
    "held-source",
    "agent",
  );
  await vi.waitFor(async () =>
    expect((await env.owner.list(undefined, "held-source"))[0]?.state).toBe("waiting"),
  );
  const held = (await env.owner.list(undefined, "held-source"))[0]!;
  expect(held).toMatchObject({
    input: { source },
    prepared: { state: "unprepared" },
    consumes: expect.arrayContaining([
      {
        kind: "member",
        probe: { pod: source.pod, path: source.path },
        expected: source.sha256,
        bytesBase64: Buffer.from(profileBytes).toString("base64"),
      },
    ]),
  });
  await vi.waitFor(() => expect(env.approval.asks).toHaveLength(1));
  const updated = await env.file("p.json", '{"patch":{"families":{"changed":1}}}');
  expect(env.approval.allow()).toBe(true);
  const refused = await completion;
  expect(refused.state).toBe("failed");
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(0);
  resultOf(
    await env.admit(
      "families.apply",
      { source: updated, include: "all" },
      revision,
      "new-source",
      "agent",
    ),
  );
  expect(env.approval.asks).toHaveLength(1);
});
test("a URL specification retains the exact acquired PDF before consent, and cancellation writes no assets", async () => {
  const env = await setup();
  const pdf = Buffer.from("%PDF-1.7\nexact acquired source");
  const url = "https://spec.example/source.pdf";
  const download = vi.fn(async () => new Response(pdf));
  vi.stubGlobal("fetch", download);
  await mkdir(join(env.podsRoot, "Global", "settings", "family"), { recursive: true });
  await writeFile(
    join(env.podsRoot, "Global", "settings", "family", "captured.json"),
    JSON.stringify({ family: { name: "Box" } }),
  );
  env.approval.hold();
  const completion = env.admit(
    "family.attach-spec",
    { member: { pod: "global", path: "settings/family/captured.json" }, source: { url } },
    0,
    "attach-url",
    "agent",
    { ...scope, route: "family" },
  );
  await vi.waitFor(async () =>
    expect((await env.owner.list(undefined, "attach-url"))[0]?.state).toBe("waiting"),
  );
  await env.owner.cancel("attach-url");
  expect(await completion).toMatchObject({ state: "cancelled" });
  const recovered = (
    await new ActionJournal(join(env.podsRoot, "..", "actions.json")).list(undefined, "attach-url")
  )[0]!;
  expect(recovered.consumes).toContainEqual({
    kind: "capture",
    probe: {
      origin: { kind: "url", url },
      bytesBase64: pdf.toString("base64"),
      capturedAt: expect.any(String),
    },
    expected: createHash("sha256").update(pdf).digest("hex"),
  });
  expect(download).toHaveBeenCalledTimes(1);
  expect(await readdir(join(env.podsRoot, "Global", "settings", "family"))).toEqual([
    "captured.json",
  ]);
});
test("edits remain writable during countdown and invalidate the submitted Work revision", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  env.approval.hold();
  const completion = env.admit(
    "families.apply",
    { source, include: "all" },
    revision,
    "held-work",
    "agent",
  );
  await vi.waitFor(async () =>
    expect((await env.owner.list(undefined, "held-work"))[0]?.state).toBe("waiting"),
  );
  expect(
    await env.work.apply(
      scope,
      "families",
      "human",
      [{ path: ["excluded", "Pipe"], value: { by: "pea" } }],
      revision,
    ),
  ).toMatchObject({ ok: true });
  env.approval.allow();
  expect(await completion).toMatchObject({ state: "failed", notDispatched: true });
  expect(env.sent.filter((row) => row.key === "families.apply")).toHaveLength(0);
});
test("direct per-family sources stay one command with exact native hashes for each source", async () => {
  const env = await setup();
  const revision = await authorFamilies(env.work);
  resultOf(
    await env.admit(
      "families.apply",
      {
        sources: [
          { source, familyNames: ["Box"] },
          { source, familyNames: ["Pipe"] },
        ],
        include: "all",
      },
      revision,
      "batch",
    ),
  );
  expect(
    env.sent
      .filter((row) => row.key === "families.apply")
      .map((row) => row.input.expectedPlanHashes),
  ).toEqual([{ "1": "h1" }, { "2": "h2" }]);
  expect(await env.owner.list()).toHaveLength(1);
});
test("member baseline adoption reads host bytes and requires explicit replacement of pending edits", async () => {
  const env = await setup();
  const where: WorkKey = {
    binding: "workspace",
    route: "pods",
    target: null,
    work: memberWork(source),
  };
  resultOf(
    await env.admit(
      "settings.observe",
      { member: member("p.json") },
      0,
      "member-open",
      "human",
      where,
    ),
  );
  const baseline = await env.work.read(where, "pods");
  expect(baseline?.doc).toMatchObject({
    basis: { sha256: source.sha256, rawContent: profileBytes },
  });
  const changed = await env.work.apply(
    where,
    "pods",
    "pea",
    [{ path: ["fields", "/label", "edit"], value: { value: "shared" } }],
    baseline!.revision,
  );
  expect(changed.ok).toBe(true);
  expect(
    await env.admit(
      "settings.observe",
      { member: member("p.json") },
      changed.revision!,
      "member-refuse",
      "human",
      where,
    ),
  ).toMatchObject({ state: "failed", notDispatched: true });
  resultOf(
    await env.admit(
      "settings.observe",
      { member: member("p.json"), sha256: source.sha256, replaceEdits: true },
      changed.revision!,
      "member-replace",
      "human",
      where,
    ),
  );
  expect((await env.work.read(where, "pods"))?.doc).toMatchObject({ fields: {} });
});
test("Family source observation is trusted host evidence, and a forged capture id refuses", async () => {
  const env = await setup();
  env.familyDocument(true);
  const where: WorkKey = { ...scope, route: "family" };
  expect(
    await env.admit(
      "family.observe",
      { readingId: "not-a-capture" },
      0,
      "observe-refuse",
      "human",
      where,
    ),
  ).toMatchObject({ state: "failed", notDispatched: true });
  resultOf(await env.admit("family.observe", { source }, 0, "observe-source", "human", where));
  expect((await env.work.read(where, "family"))?.doc).toMatchObject({
    reading: profileBytes,
    takenAt: null,
  });
  expect(env.sent).toHaveLength(0);
});

test("a workless Family observation returns evidence without publishing Work", async () => {
  const env = await setup();
  env.familyDocument(true);
  const where: WorkKey = { ...scope, route: "family" };
  const before = await env.work.read(where, "family");
  const observed = await env.admit(
    "family.observe",
    { source },
    0,
    "observe-workless",
    "human",
    null,
  );
  expect(resultOf(observed)).toMatchObject({ reading: profileBytes, takenAt: null });
  expect(observed.consumes.some((item) => item.kind === "work")).toBe(false);
  expect(await env.work.read(where, "family")).toEqual(before);
  expect(env.sent).toHaveLength(0);
});

test.each(["direct", "preview"])(
  "a workless source-backed Family %s Apply preserves optional association",
  async (mode) => {
    const env = await setup();
    env.familyDocument(true);
    const where: WorkKey = { ...scope, route: "family" };
    const before = await env.work.read(where, "family");
    const input =
      mode === "preview"
        ? {
            plan: resultOf<Plan>(
              await env.admit("family.plan", { source }, 0, "workless-plan", "human", null),
            ).id,
            include: "all",
          }
        : { source, include: "all" };
    const applied = await env.admit("family.apply", input, 0, "workless-apply", "human", null);
    expect(resultOf(applied)).toMatchObject({ native: { receipts: [{ success: true }] } });
    expect(applied.consumes.some((item) => item.kind === "work")).toBe(false);
    expect(env.sent.filter((item) => item.key === "family.apply")).toHaveLength(1);
    expect(await env.work.read(where, "family")).toEqual(before);
  },
);
