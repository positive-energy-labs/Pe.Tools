import { resolveSdkSession } from "./sdk-session.ts";
import { createHash } from "node:crypto";
import { join, resolve, win32 } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  commands,
  familyReads,
  familyCaptureSchema,
  familyLiveReadSchema,
  familiesCaptureEvidenceSchema,
  familiesExcluded,
  type FfPlanEntry,
  type ActionReceipt,
  familiesIncluded,
  familyCellAddress,
  familyStagedPatch,
  memberWork,
  editedEntries,
  parameterLinksRouteState,
  parameterLinksBasis,
  stagedParameterProfile,
  parameterLinksReadingSchema,
  settingsCandidate,
  settingsRouteState,
  nativeProcessSchema,
  canonicalRouteInput,
  documentRefSchema,
  workKeySchema,
  workKey,
  bindWork,
  address,
  type FamilyActionKey,
  type FamilyReadKey,
  type DocumentRef,
  type PodDraftSource,
  type PodMemberSource,
  type FamilyCapture,
  appliedScopeSchema,
  familyExecutionOptionsSchema,
  familyCatalogProblem,
  familyCatalogRequest,
  stagedFilter,
  tools,
  parseContributionKey,
  type FamiliesRouteDocument,
  type FamilyDraft,
  type ExecutionTarget,
  type WorkPath,
} from "@pe/agent-contracts";
import type {
  PodMemberSaveRequest,
  PodMemberWriteRequest,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";
import type {
  FamiliesApply,
  FamiliesCapture,
  FamiliesPlan,
  FamilyCapture as NativeFamilyCapture,
  FamilyPlan,
  RevitCatalogLoadedFamilies,
  RevitMatrixLoadedFamilies,
} from "@pe/host-contracts/generated";
import {
  hostProcessIdentity,
  productPathNames,
  scriptingWorkspaceIdentity,
} from "@pe/host-contracts/contracts";
import { CANCEL_OPERATION_KEY, invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import type { ActionExecution } from "./action-journal.ts";
import {
  command,
  refused,
  StepFailure,
  type CommandContext,
  type CommandExecutor,
} from "./command-executor.ts";
import { z } from "zod";
import type { Consumed as Dependency, WorkHandle } from "@pe/agent-contracts";
import { type TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, readNativeReceipt, type NativeProcess } from "./native-receipts.ts";
import {
  composedSpec,
  podFolder,
  saveMember,
  writeMember,
  readMember,
  writeRun,
  type PodContext,
} from "./settings.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { LocalOpError } from "./local-error.ts";
import { productPodsRootPath } from "./product-paths.ts";
import { familiesApplyRun, isFamiliesApplyResponse } from "./family-run-recovery.ts";
import { familySpecExecutor } from "./family-spec.ts";
import { nativeInputSchema } from "./native-input.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// PodRuns.StartComposedRun writes to this source Pod's output, or operations for a supplied draft.
export const sourceRunOutput = async (pod: string | null | undefined, deps: PodDependencies) =>
  pod
    ? join(
        await runPods(deps, podFolder(pod, { podsRoot: deps.podsRoot })),
        productPathNames.outputDirectoryName,
      )
    : join(
        deps.podsRoot ?? productPodsRootPath(),
        scriptingWorkspaceIdentity.defaultWorkspaceKey,
        productPathNames.outputDirectoryName,
        "operations",
      );

/** Pod I/O runs against the product Pods root unless an owner (the demo lane) supplies its own. */
export type PodDependencies = {
  podsRoot?: string;
  runPods?: <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Promise<A>;
};
export type FamilyActionDependencies = TakeoffActionDependencies &
  PodDependencies & {
    /** The demo owner keeps native reads inside its own root; a build has no output path to place. */
    nativePaths?: (
      input: { modelDirectory?: string },
      id: string,
      file: string,
    ) => Promise<{ modelDirectory: string }>;
  };

/** A conditional member write that refused wrote nothing: a clean refusal, never an unknown effect. */
export const writeMemberOnce = (
  deps: PodDependencies,
  request: PodMemberWriteRequest | PodMemberSaveRequest,
  pods: PodContext,
): Promise<PodMemberWritten> =>
  runPods(
    deps,
    "expectedSha256" in request ? saveMember(request, pods) : writeMember(request, pods),
  ).catch((error: unknown) => {
    if (error instanceof LocalOpError && error.statusCode === 409)
      throw new StepFailure(error.message, 409, "refused");
    throw error;
  });

/**
 * The `$schema` a family model member carries; C# owns the URL shape. The origin is the host that
 * is running, never the preferred port: another checkout's host must not serve our members' schema.
 */
const familyModelSchema = () =>
  `${process.env[hostProcessIdentity.hostBaseUrlVariable] || hostProcessIdentity.defaultHostBaseUrl}/schemas/settings/FamilyFoundry/models.json`;

/**
 * The composed member as authored, and the exact root and dependency bytes that one composition read.
 * A native run keeps those bytes; the C# family edge reads the spec's `$schema`.
 */
const familySpec = async (
  deps: PodDependencies,
  member: PodMemberSource | PodDraftSource,
  pods: PodContext,
) => {
  const { spec, source, dependencies } = await runPods(deps, composedSpec(member, pods));
  return {
    specJson: spec,
    source: { root: { ...source }, dependencies: dependencies.map((item) => ({ ...item })) },
  };
};

/**
 * A captured family model becomes a member that says what it is. `unmodeled` is what the engine
 * saw and cannot execute; it is evidence, so it leaves the member and lands in the capture's run
 * (user verdict 2026-09-17). A member that kept it would fail its own plan.
 */
const familyMember = (modelJson: string) => {
  const { unmodeled = [], ...model } = JSON.parse(modelJson) as { unmodeled?: unknown[] };
  return {
    content: `${JSON.stringify({ $schema: familyModelSchema(), ...model }, null, 2)}\n`,
    unmodeled,
  };
};

/** A draft saved as a member says what it is, whatever `$schema` it carried. */
const draftContent = (spec: string) => {
  const { $schema: _, ...model } = JSON.parse(spec.replace(/^\uFEFF/, "")) as object & {
    $schema?: string;
  };
  return `${JSON.stringify({ $schema: familyModelSchema(), ...model }, null, 2)}
`;
};

export const runPods = <A, E>(
  deps: PodDependencies,
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
) =>
  deps.runPods
    ? deps.runPods(effect)
    : Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

/** Pod context whose composition runs in the exact admitted session and document lifetime. */
export const podContext = (
  deps: PodDependencies,
  bridge: RevitBridge["Service"],
  target?: DocumentRef,
): PodContext => ({
  podsRoot: deps.podsRoot,
  ...(target
    ? {
        invokeBridge: (key: string, payload: unknown) =>
          Effect.tryPromise({ try: () => invoke(bridge, target, key, payload), catch: (e) => e }),
      }
    : {}),
});

const diagnosticLine = (d: { code: string; path: string; message: string }) =>
  `${d.code} · ${d.path} — ${d.message}`;

/** Every capture writes a run beside the member it filed: `output/<runId>/receipt.json` plus its outputs. */
/**
 * A capture run's receipt. A receipt's member fields name what the run consumed; a capture consumed
 * Revit (origin Operation), so they are null. The member it wrote is its product: the run lists it
 * as `written-member.json` beside its other outputs.
 */
export const writeCaptureRun = (
  deps: PodDependencies,
  pods: PodContext,
  at: string,
  written: PodMemberWritten,
  operation: string,
  outputs: Readonly<Record<string, string>> = {},
) => {
  const files = {
    ...outputs,
    "written-member.json": `${JSON.stringify({ path: written.path, sha256: written.sha256 }, null, 2)}\n`,
  };
  return runPods(
    deps,
    writeRun(
      written.pod,
      `${at.replace(/[:.]/g, "-")}-${digest(written.path).slice(0, 8)}`,
      {
        ...files,
        "receipt.json": `${JSON.stringify(
          {
            podId: written.pod,
            memberPath: null,
            memberSha256: null,
            origin: "Operation",
            operation,
            planHash: null,
            outcome: "Succeeded",
            outputs: Object.keys(files),
            reason: null,
          },
          null,
          2,
        )}\n`,
      },
      pods,
    ),
  );
};

async function current(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  family: boolean | "project",
  process?: NativeProcess,
) {
  const session = (await Effect.runPromise(bridge.list)).find(
    (s) => s.sessionId === target.session,
  );
  const doc = session?.state?.openDocuments.find((d) => d.openId === target.openId);
  if (
    !session ||
    !doc ||
    (family === true && !doc.isFamilyDocument) ||
    (family === "project" && doc.isFamilyDocument) ||
    (process &&
      (session.processId !== process.pid ||
        session.processStartUtcUnixMs !== Date.parse(process.processStartUtc)))
  )
    throw refused("The exact admitted document lifetime/process is no longer available");
  return session;
}
export async function lifetime(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  family: boolean | "project",
  deps: TakeoffActionDependencies,
) {
  const session = await resolveSdkSession(
    bridge,
    { bridgeSessionId: target.session, openDocumentId: target.openId },
    deps.sdk,
  );
  await current(bridge, target, family);
  if (!session.processId || session.processStartUtcUnixMs == null)
    throw refused("Original process identity unavailable");
  const process = await readOriginalProcess(
    session.processId,
    session.processStartUtcUnixMs,
    deps.sdk,
  );
  return { session: await current(bridge, target, family, process), process };
}

const retirementSchema = z.strictObject({
  key: workKeySchema,
  route: z.enum(["family", "families"]),
  cells: z.array(z.string()),
  patch: z.literal(true).optional(),
});
type Retirement = z.infer<typeof retirementSchema>;
const sourceMemberSchema = z
  .strictObject({
    id: z.string(),
    path: z.string(),
    sha256: z.string(),
    bytesBase64: z.string(),
  })
  .refine(
    (value) =>
      createHash("sha256").update(Buffer.from(value.bytesBase64, "base64")).digest("hex") ===
      value.sha256,
    "Source bytes must match their hash",
  );
const sealedSourceSchema = z.strictObject({
  root: z
    .strictObject({
      ...sourceMemberSchema.shape,
      id: z.string().nullable(),
      origin: z.enum(["SavedMember", "SuppliedDraft"]),
    })
    .refine(
      (value) =>
        createHash("sha256").update(Buffer.from(value.bytesBase64, "base64")).digest("hex") ===
        value.sha256,
      "Source bytes must match their hash",
    ),
  dependencies: z.array(sourceMemberSchema),
});
const sealedSchema = z.strictObject({
  specJson: z.string(),
  source: sealedSourceSchema,
  consumed: retirementSchema.nullable(),
  takenAt: z.string().nullable().optional(),
  executionOptions: familyExecutionOptionsSchema.optional(),
});
const rootText = (source: { root: { bytesBase64: string } }) =>
  Buffer.from(source.root.bytesBase64, "base64").toString("utf8");
const unstamped = (json: string) => {
  const { $schema: _, ...rest } = JSON.parse(json.replace(/^\uFEFF/, ""));
  return canonicalRouteInput(rest);
};
// Stable entries choose native operations; old dispatch metadata is not execution authority.
const nativeSchema = z.object({
  kind: z.literal("native"),
  process: nativeProcessSchema,
  input: z.unknown(),
});
const planLeafSchema = z.object({
  kind: z.literal("native"),
  process: nativeProcessSchema,
  planned: z.strictObject({
    scope: appliedScopeSchema.nullable(),
    excluded: z.record(z.string(), z.strictObject({ by: z.enum(["human", "pea", "unknown"]) })),
    familyNames: z.array(z.string()).optional(),
    written: z.array(z.string()),
  }),
  sealed: sealedSchema,
});
const applyLeafSchema = nativeSchema.extend({
  retire: retirementSchema.nullable().optional(),
  retirePatchNames: z.array(z.string()).nullable().optional(),
  readbackWork: workKeySchema.optional(),
  readbackTakenAt: z.string().nullable().optional(),
});
const batchOf = <S extends z.ZodType>(leaf: S) =>
  z.union([leaf, z.strictObject({ kind: z.literal("batch"), items: z.array(leaf) })]);
const plansSchema = batchOf(planLeafSchema),
  appliesSchema = batchOf(applyLeafSchema);
const composedInput = <K extends "family.apply" | "families.apply" | "family.build">(key: K) =>
  z.intersection(nativeInputSchema(key), z.object({ source: sealedSourceSchema }));
const familyAppliesSchema = batchOf(
  applyLeafSchema.extend({
    input: composedInput("family.apply").refine(
      (input) => typeof input.plan === "string",
      "Apply must retain its exact plan",
    ),
  }),
);
const familiesAppliesSchema = batchOf(
  applyLeafSchema.extend({
    input: composedInput("families.apply").refine(
      (input) => typeof input.plan === "string",
      "Apply must retain its exact plan",
    ),
  }),
);
const buildSchema = nativeSchema.extend({
  input: composedInput("family.build").refine(
    (input) => typeof input.modelDirectory === "string",
    "Build must retain its model directory",
  ),
});
const parameterApplySchema = nativeSchema.extend({
  input: nativeInputSchema("revit.apply.parameter-links").refine(
    (input) => input.profile != null && input.previewOnly === false && input.reconcile === true,
    "Apply must write and reconcile",
  ),
});
const captureSchema = z.object({
  kind: z.literal("capture"),
  process: nativeProcessSchema,
  input: z.unknown(),
  pod: z.string().nullable(),
  path: z.string().nullable(),
  spec: z.string().nullable(),
  at: z.string(),
});
const preparedFamilyCaptureSchema = captureSchema.extend({
  input: nativeInputSchema("family.capture"),
});
const preparedFamiliesCaptureSchema = captureSchema.extend({
  input: nativeInputSchema("families.capture"),
});
const observationSchema = z.strictObject({
  kind: z.literal("observation"),
  reading: z.string(),
  takenAt: z.string().nullable(),
});
const settingsBasisSchema = z.strictObject({
  member: z.strictObject({ pod: z.string(), path: z.string() }),
  rawContent: z.string(),
  sha256: z.string(),
});
const settingsObservationSchema = z.strictObject({
  kind: z.literal("settings-observation"),
  basis: settingsBasisSchema,
});
const settingsWriteSchema = z.strictObject({
  kind: z.literal("settings"),
  document: settingsRouteState.schema,
  request: z.strictObject({
    pod: z.string(),
    path: z.string(),
    content: z.string(),
    expectedSha256: z.string().optional(),
  }),
  destination: z.boolean().optional(),
});
const draftsSchema = z.strictObject({
  kind: z.literal("drafts"),
  members: z.array(z.strictObject({ pod: z.string(), path: z.string(), content: z.string() })),
});
type Plan = z.infer<typeof planLeafSchema>;
type Apply = z.infer<typeof applyLeafSchema>;
type Plans = z.infer<typeof plansSchema>;
type Source = PodMemberSource | PodDraftSource;
type DraftSource = {
  source: Source;
  familyNames?: string[];
  executionOptions?: z.infer<typeof familyExecutionOptionsSchema>;
};
type Sealed = Awaited<ReturnType<typeof familySpec>>;
type Composed = Omit<DraftSource, "source"> & Sealed & { locator: Source };
type Preview = Pick<ActionReceipt, "prepared"> & { result?: unknown };
const leaves = <T>(prepared: T | { kind: "batch"; items: T[] }): T[] =>
  prepared && typeof prepared === "object" && "kind" in prepared && prepared.kind === "batch"
    ? (prepared as { items: T[] }).items
    : [prepared as T];
const handleOf = (ctx: CommandContext) => {
  const handle = (ctx.admission.input as { work?: WorkHandle }).work;
  if (!handle) throw refused("Reviewed Work is required");
  return handle;
};
const familyDrafts = (doc: FamilyDraft): DraftSource[] => {
  if (!doc.reading) throw refused("Read this family before planning");
  return [
    { source: { path: "edit/family.json", content: settingsCandidate(doc.reading, doc.cells) } },
  ];
};
const familiesDrafts = (doc: FamiliesRouteDocument): DraftSource[] => {
  const names = [
    ...new Set(editedEntries(doc.cells).map(([cell]) => familyCellAddress(cell).familyName)),
  ].sort();
  if (doc.patch.edit && names.length)
    throw refused("Stage either a native Family Foundry patch or per-type cells, not both");
  if (doc.patch.edit)
    return [{ source: doc.patch.edit.value, executionOptions: doc.executionOptions }];
  if (!names.length) throw refused("No staged family edits");
  return names.map((familyName) => ({
    source: {
      ...(doc.pod ? { pod: doc.pod } : {}),
      path: `edit/${familyName.replace(/[^\w.-]+/g, "-")}.json`,
      content: `${JSON.stringify({ $schema: familyModelSchema().replace("/models.json", "/patches.json"), ...familyStagedPatch(doc.cells, familyName)!.spec }, null, 2)}\n`,
    },
    familyNames: [familyName],
    executionOptions: doc.executionOptions,
  }));
};
const familySelection = (ctx: CommandContext) =>
  ctx.selectWork(tools.family.work, handleOf(ctx), () => ({ facts: [["reading"], ["takenAt"]] }));
const familiesSelection = (ctx: CommandContext, names?: readonly string[]) =>
  ctx.selectWork(tools.families.work, handleOf(ctx), (doc, cells) => ({
    cells: cells
      .filter(
        ({ path, cell }) =>
          path[0] === "cells" &&
          cell.edit &&
          (!names || names.includes(familyCellAddress(String(path[1])).familyName)),
      )
      .map(({ path }) => path),
    edits: doc.patch.edit ? [["cells", "*"]] : [],
    facts: [["takenAt"], ["scope", "edit"], ["excluded"], ["executionOptions"], ["patch", "edit"]],
  }));
const appliedSomething = (result: unknown) => {
  const applied = result as FamiliesApply.Res.Response;
  if (
    !applied.receipts.some((receipt) => receipt.success) &&
    !applied.diagnostics.some((d) => d.code === "Cancelled")
  )
    throw refused(applied.reason ?? "No family was applied", "family.apply.empty");
};

/** Stable entries share domain transforms; only bind owns invocation-local facts. */
export function familyExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
) {
  const podsFor = (ctx: CommandContext) =>
    podContext(
      deps,
      bridge,
      ctx.admission.target.kind === "document" ? ctx.admission.target.ref : undefined,
    );
  const targetOf = (ctx: CommandContext) => {
    if (ctx.admission.target.kind !== "document")
      throw refused("Select an exact document lifetime");
    return ctx.admission.target.ref;
  };
  const nativeBinding = async (ctx: CommandContext, family: boolean | "project") => {
    const target = targetOf(ctx),
      { process } = await lifetime(bridge, target, family, deps);
    return {
      target,
      process,
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
      ],
    };
  };
  const compose = async (ctx: CommandContext, sources: readonly DraftSource[]) => {
    const consumes: Dependency[] = [];
    const sealed = await Promise.all(
      sources.map(async (item) => {
        const value = await familySpec(deps, item.source, podsFor(ctx));
        for (const member of [value.source.root, ...value.source.dependencies])
          if ((!("origin" in member) || member.origin === "SavedMember") && member.id)
            consumes.push({
              kind: "member",
              probe: { pod: member.id, path: member.path },
              expected: member.sha256,
              bytesBase64: member.bytesBase64,
            });
        return {
          familyNames: item.familyNames,
          executionOptions: item.executionOptions,
          locator: item.source,
          ...value,
        };
      }),
    );
    return { sealed, consumes };
  };
  const mark = (target: DocumentRef, takenAt: string | null | undefined): Dependency[] =>
    takenAt ? [{ kind: "document-mark", probe: { ref: target, takenAt }, expected: true }] : [];
  const outputs = async (sources: readonly Sealed[]) =>
    Promise.all(
      [...new Set(sources.map((x) => x.source.root.id))].map(async (pod) => ({
        kind: "directory" as const,
        path: await sourceRunOutput(pod, deps),
      })),
    );
  const native = (
    ctx: CommandContext,
    execution: ActionExecution,
    key: string,
    prepared: { input: unknown; process: NativeProcess },
    check?: (result: unknown) => void,
  ) =>
    execution.step(
      "native",
      key,
      prepared.input,
      (id) => invoke(bridge, targetOf(ctx), key, prepared.input, id),
      { process: prepared.process, ...(check ? { check } : {}) },
    );
  const planFamily = (
    ctx: CommandContext,
    doc: FamilyDraft | null,
    source: Sealed,
    process: NativeProcess,
  ): Plan => {
    const cells = doc ? editedEntries(doc.cells).map(([cell]) => cell) : [];
    const consumed =
      doc?.reading &&
      cells.length &&
      unstamped(settingsCandidate(doc.reading, doc.cells)) === unstamped(rootText(source.source))
        ? { key: handleOf(ctx).key, route: "family" as const, cells }
        : null;
    return {
      kind: "native",
      process,
      planned: { scope: null, excluded: {}, written: [] },
      sealed: {
        specJson: source.specJson,
        source: source.source,
        consumed,
        ...(consumed ? { takenAt: doc!.takenAt } : {}),
      },
    };
  };
  const planFamilies = async (
    ctx: CommandContext,
    doc: FamiliesRouteDocument,
    source: Composed,
    process: NativeProcess,
  ): Promise<Plan> => {
    const scope = stagedFilter(doc);
    if (!scope) throw refused("Stage a scope before planning");
    if (doc.patch.edit && editedEntries(doc.cells).length)
      throw refused("Stage either a native Family Foundry patch or per-type cells, not both");
    if (
      doc.patch.edit &&
      canonicalRouteInput(source.locator) !== canonicalRouteInput(doc.patch.edit.value)
    )
      throw refused("Plan the exact native patch source staged in Families Work");
    const generated =
      source.familyNames?.length === 1
        ? familyStagedPatch(doc.cells, source.familyNames[0]!)
        : null;
    const consumed: Retirement | null = doc.patch.edit
      ? { key: handleOf(ctx).key, route: "families", cells: [], patch: true }
      : generated && canonicalRouteInput(generated.spec) === unstamped(rootText(source.source))
        ? { key: handleOf(ctx).key, route: "families", cells: generated.keys }
        : null;
    if (consumed) {
      const observed = await captures.latestFamilies(handleOf(ctx).key),
        target = targetOf(ctx);
      if (
        !observed ||
        observed.capturedAt !== doc.takenAt ||
        canonicalRouteInput(observed.document) !== canonicalRouteInput(target)
      )
        throw refused("Read these staged families in this exact document before planning");
    }
    return {
      kind: "native",
      process,
      sealed: {
        specJson: source.specJson,
        source: source.source,
        consumed,
        ...(source.executionOptions ? { executionOptions: source.executionOptions } : {}),
        ...(consumed ? { takenAt: doc.takenAt } : {}),
      },
      planned: {
        scope,
        excluded: doc.excluded,
        ...(source.familyNames ? { familyNames: source.familyNames } : {}),
        written: Object.keys(doc.cells).filter(
          (cell) => doc.cells[cell]!.edit || doc.cells[cell]!.suggestion,
        ),
      },
    };
  };
  const runFamilyPlan = async (
    ctx: CommandContext,
    prepared: Plan,
    call: (key: string, input: unknown, process: NativeProcess) => Promise<unknown>,
  ) => {
    const result = (await call(
        "family.plan",
        { specJson: prepared.sealed.specJson },
        prepared.process,
      )) as FamilyPlan.Res.Response,
      plan = result.families[0];
    if (result.diagnostics.length || result.families.length !== 1 || plan!.refusals.length)
      throw refused(
        [...result.diagnostics, ...(plan?.refusals ?? [])].map(diagnosticLine).join(" · ") ||
          "Expected one family plan",
      );
    return {
      id: ctx.admission.id,
      executionContext: targetOf(ctx),
      plan: plan!,
      included: { [String(plan!.familyId)]: plan!.planHash },
    };
  };
  const runFamiliesPlan = async (
    ctx: CommandContext,
    prepared: Plan,
    call: (key: string, input: unknown, process: NativeProcess) => Promise<unknown>,
  ) => {
    const catalog = (await call(
      "revit.catalog.loaded-families",
      familyCatalogRequest(prepared.planned.scope!),
      prepared.process,
    )) as RevitCatalogLoadedFamilies.Res.Response;
    const problem = familyCatalogProblem(catalog);
    if (problem) throw refused(problem.message);
    const resolved = [...new Set(catalog.families.map((x) => x.familyName))],
      outside = prepared.planned.familyNames?.filter((name) => !resolved.includes(name)) ?? [];
    if (outside.length)
      throw refused(`Families ${outside.join(", ")} are outside the reviewed scope`);
    const result = (await call(
      "families.plan",
      {
        specJson: prepared.sealed.specJson,
        ...(prepared.sealed.executionOptions
          ? { executionOptions: prepared.sealed.executionOptions }
          : {}),
        familyNames: prepared.planned.familyNames ?? resolved,
      },
      prepared.process,
    )) as FamiliesPlan.Res.Response;
    if (result.diagnostics.length)
      throw refused(result.diagnostics.map(diagnosticLine).join(" · "));
    const loaded = new Set(
      catalog.families.flatMap((f) =>
        f.types.map((t) => JSON.stringify([f.familyName, t.typeName])),
      ),
    );
    return {
      id: ctx.admission.id,
      executionContext: targetOf(ctx),
      plan: result.families,
      included: familiesIncluded({ entries: result.families }, prepared.planned.excluded),
      excluded: familiesExcluded({ entries: result.families }, prepared.planned.excluded),
      orphaned: prepared.planned.written.filter((cell) => {
        const at = familyCellAddress(cell);
        return !loaded.has(JSON.stringify([at.familyName, at.typeName]));
      }),
    };
  };
  const aggregate = (
    ctx: CommandContext,
    results: {
      plan: FfPlanEntry | FfPlanEntry[];
      included: Record<string, string>;
      excluded?: unknown[];
      orphaned?: string[];
    }[],
  ) => ({
    id: ctx.admission.id,
    executionContext: targetOf(ctx),
    results,
    plan: results.flatMap((x) => x.plan),
    included: Object.assign({}, ...results.map((x) => x.included)),
    excluded: results.flatMap((x) => x.excluded ?? []),
    orphaned: results.flatMap((x) => x.orphaned ?? []),
  });
  const runPreview = async (
    ctx: CommandContext,
    execution: ActionExecution,
    run: (
      ctx: CommandContext,
      p: Plan,
      call: (key: string, input: unknown, process: NativeProcess) => Promise<unknown>,
    ) => Promise<any>,
  ) => {
    const results = [];
    for (const item of leaves<Plan>(execution.prepared as Plans))
      results.push(
        await run(ctx, item, (key, input, process) =>
          native(ctx, execution, key, { input, process }),
        ),
      );
    return (execution.prepared as Plans).kind === "batch" ? aggregate(ctx, results) : results[0];
  };
  const directPlan = (
    ctx: CommandContext,
    p: Plan,
    run: typeof runFamilyPlan | typeof runFamiliesPlan,
  ) =>
    run(ctx, p, async (key, input, process) => {
      await current(bridge, targetOf(ctx), p.planned.scope ? "project" : true, process);
      return invoke(
        bridge,
        targetOf(ctx),
        key,
        input,
        `${ctx.admission.id}:prepare:${digest(canonicalRouteInput(input)).slice(0, 16)}`,
      );
    });
  const adopt = (ctx: CommandContext, id: string, key: string) => {
    const plan = ctx.read.receipts(id)[0];
    if (!plan || plan.key !== key || plan.state !== "succeeded" || plan.prepared.state !== "ready")
      throw refused(`Apply must name a succeeded ${key} action`);
    if (canonicalRouteInput(plan.target) !== canonicalRouteInput(ctx.admission.target))
      throw refused("The plan was made for a different document");
    return plan;
  };
  const planFacts = (ctx: CommandContext, plan: ActionReceipt): Dependency[] => {
    const base = (ctx.admission.input as { work?: WorkHandle }).work;
    return [
      { kind: "receipt", probe: { id: plan.id, key: plan.key }, expected: true },
      ...plan.consumes
        .filter((x) => ["work", "incarnation", "document-mark"].includes(x.kind))
        .map((item) => {
          if (item.kind !== "work") return item;
          if (!base) return item;
          if (canonicalRouteInput(item.probe.handle.key) !== canonicalRouteInput(base.key))
            throw refused("The plan belongs to different Work");
          return { ...item, probe: { ...item.probe, handle: base } };
        }),
    ];
  };
  const selectApply = (
    ctx: CommandContext,
    plan: Preview,
    include: "all" | string[],
    process: NativeProcess,
    project: boolean,
    doc?: FamiliesRouteDocument,
  ): Apply[] => {
    const prepared = plansSchema.parse(
      plan.prepared.state === "ready" ? plan.prepared.value : null,
    );
    const results =
      prepared.kind === "batch" ? (plan.result as { results: unknown[] }).results : [plan.result];
    return leaves<Plan>(prepared).flatMap((item, index) => {
      const result = results[index] as {
          plan: FfPlanEntry | FfPlanEntry[];
          included: Record<string, string>;
        },
        entries = [result.plan].flat();
      const hashes = Object.fromEntries(
        Object.entries(result.included).filter(
          ([id]) =>
            include === "all" ||
            include.includes(id) ||
            entries.some((e) => String(e.familyId) === id && include.includes(e.familyName)),
        ),
      );
      if (!Object.keys(hashes).length) return [];
      const consumed = item.sealed.consumed;
      if (
        project &&
        doc &&
        ((consumed?.patch && editedEntries(doc.cells).length) ||
          (consumed?.cells.length && doc.patch.edit))
      )
        throw refused("Stage either a native Family Foundry patch or per-type cells, not both");
      const patchTargets = consumed?.patch
        ? entries.filter((e) => e.changes.length + e.runEffects.length)
        : null;
      return [
        {
          kind: "native",
          process,
          input: {
            plan: (ctx.admission.input as { plan?: string }).plan ?? `${ctx.admission.id}:prepared`,
            specJson: item.sealed.specJson,
            source: item.sealed.source,
            expectedPlanHashes: hashes,
            ...(project
              ? {
                  familyNames: Object.fromEntries(
                    entries.flatMap((e) =>
                      e.familyId != null && Object.hasOwn(hashes, String(e.familyId))
                        ? [[String(e.familyId), e.familyName]]
                        : [],
                    ),
                  ),
                }
              : {}),
            ...(item.sealed.executionOptions
              ? { executionOptions: item.sealed.executionOptions }
              : {}),
          },
          retire: consumed,
          ...(patchTargets
            ? {
                retirePatchNames:
                  entries.every((e) => !e.refusals.length) &&
                  patchTargets.every(
                    (e) => e.familyId != null && Object.hasOwn(hashes, String(e.familyId)),
                  )
                    ? patchTargets.map((e) => e.familyName)
                    : null,
              }
            : {}),
          ...(project && (consumed || doc)
            ? {
                readbackWork: consumed?.key ?? handleOf(ctx).key,
                readbackTakenAt: consumed ? item.sealed.takenAt : doc?.takenAt,
              }
            : {}),
        },
      ];
    });
  };
  const runApply = async (ctx: CommandContext, execution: ActionExecution, project: boolean) => {
    const results = [];
    for (const prepared of leaves<Apply>(execution.prepared as z.infer<typeof appliesSchema>)) {
      const result = (await native(
          ctx,
          execution,
          project ? "families.apply" : "family.apply",
          prepared,
          appliedSomething,
        )) as FamiliesApply.Res.Response,
        consumed = prepared.retire;
      let retired: unknown;
      if (consumed) {
        const succeeded = new Set(
            result.receipts.filter((x) => x.success).map((x) => x.familyName),
          ),
          converged = new Set(
            result.receipts.filter((x) => x.success && x.converged).map((x) => x.familyName),
          );
        const paths: WorkPath[] = consumed.cells
          .filter(
            (cell) =>
              consumed.route === "family" || succeeded.has(familyCellAddress(cell).familyName),
          )
          .map((cell) => ["cells", cell]);
        if (consumed.patch && prepared.retirePatchNames?.every((name) => converged.has(name)))
          paths.push(["patch"]);
        retired = await execution.retireWork(consumed.key, consumed.route, paths);
      }
      const readback: Record<string, unknown> = {},
        names = [...new Set(result.receipts.filter((x) => x.success).map((x) => x.familyName))];
      if (project && names.length)
        try {
          if (!prepared.readbackWork)
            throw Error("No reviewed Families reading is available for this apply");
          const source = await captures.latestFamilies(prepared.readbackWork),
            target = targetOf(ctx);
          if (
            !source ||
            source.capturedAt !== prepared.readbackTakenAt ||
            canonicalRouteInput(source.document) !== canonicalRouteInput(target)
          )
            throw Error("The reviewed Families reading is no longer the latest saved reading");
          await current(bridge, target, "project", prepared.process);
          const at = new Date().toISOString(),
            observed = (await invoke(bridge, target, "revit.matrix.loaded-families", {
              filter: {
                categoryNames: source.filter.categoryNames,
                familyNames: names,
                placementScope: "AllLoaded",
              },
              budget: { maxEntries: names.length, maxSamplesPerEntry: 1000 },
              includeTempPlacement: true,
            })) as RevitMatrixLoadedFamilies.Res.Response;
          readback.readback = {
            id: (await captures.saveFamiliesReadback(source.id, target, names, at, observed)).id,
          };
        } catch (error) {
          readback.readbackError = `Families applied, but their loaded-project values could not be verified: ${error instanceof Error ? error.message : String(error)}`;
        }
      results.push({
        executionContext: targetOf(ctx),
        native: result,
        ...(retired ? { retired } : {}),
        ...readback,
      });
    }
    return (execution.prepared as { kind: string }).kind === "batch" ? { results } : results[0];
  };
  const recover = async (
    step: import("@pe/agent-contracts").ActionStep,
    _prepared: unknown,
    target: ExecutionTarget,
  ) => {
    if (step.kind !== "native") return { step, evidence: { reason: "No native step" } };
    const process = step.process;
    if (!process) throw refused("Original native step process is unavailable");
    const prepared = { input: step.input, process };
    if (step.key !== "families.apply") return readNativeReceipt(step, process, deps.sdk);
    if (step.state === "succeeded" && isFamiliesApplyResponse(step.result))
      return { step, evidence: { recordedNativeOutcome: true } };
    const sdk = await readNativeReceipt(step, process, deps.sdk).catch((error: unknown) => ({
      step,
      evidence: { error: String(error) },
    }));
    if (sdk.step.state === "succeeded" && isFamiliesApplyResponse(sdk.step.result)) return sdk;
    const unknown = {
      ...step,
      state: "unknown" as const,
      error:
        "The SDK response does not prove the Families apply outcome; inspect its exact native run",
      status: 503,
    };
    if (sdk.step.state === "failed" || sdk.step.state === "cancelled")
      return { step: unknown, evidence: { sdk: sdk.evidence, conflict: sdk.step } };
    try {
      const source = (prepared.input as { source: { root: { id: string | null } } }).source;
      const run =
        target.kind === "document"
          ? await familiesApplyRun(
              await sourceRunOutput(source.root.id, deps),
              step,
              { ...prepared, process },
              target.ref.openId,
            )
          : null;
      return run
        ? {
            step: { ...step, state: "succeeded" as const, result: run.result },
            evidence: { sdk: sdk.evidence, nativeRun: run.evidence },
          }
        : { step: unknown, evidence: { sdk: sdk.evidence, nativeRun: "missing or ambiguous" } };
    } catch (error) {
      return { step: unknown, evidence: { sdk: sdk.evidence, nativeRun: String(error) } };
    }
  };
  type PlanRunner = typeof runFamilyPlan | typeof runFamiliesPlan;
  type Review = {
    family: true | "project";
    takenAt: string | null;
    drafts(): DraftSource[];
    compile(source: Composed, process: NativeProcess): Plan | Promise<Plan>;
    preview: PlanRunner;
    projectDoc?: FamiliesRouteDocument;
  };
  const reviewed = <T>(doc: T | null): T => {
    if (!doc) throw refused("Reviewed Work is required");
    return doc;
  };
  const reviewFamily = async (ctx: CommandContext): Promise<Review> => {
    const doc = ctx.admission.input.work ? await familySelection(ctx) : null;
    return {
      family: true,
      takenAt: doc?.takenAt ?? null,
      drafts: () => familyDrafts(reviewed(doc)),
      compile: (source, process) => planFamily(ctx, doc, source, process),
      preview: runFamilyPlan,
    };
  };
  const reviewFamilies = async (ctx: CommandContext, names?: string[]): Promise<Review> => {
    const doc = ctx.admission.input.work ? await familiesSelection(ctx, names) : null;
    return {
      family: "project",
      takenAt: doc?.takenAt ?? null,
      drafts: () => familiesDrafts(reviewed(doc)),
      compile: (source, process) => planFamilies(ctx, reviewed(doc), source, process),
      preview: runFamiliesPlan,
      ...(doc ? { projectDoc: doc } : {}),
    };
  };
  type SourceInput = Pick<
    z.output<(typeof commands)["families.apply"]["input"]>,
    "source" | "sources" | "familyNames" | "executionOptions"
  >;
  const sourcesFor = (input: SourceInput, review: Review) =>
    input.sources ??
    (input.source
      ? [
          {
            source: input.source,
            familyNames: input.familyNames,
            executionOptions: input.executionOptions,
          },
        ]
      : review.drafts());
  const planBinding = async (ctx: CommandContext, input: SourceInput, review: Review) => {
    const bound = await nativeBinding(ctx, review.family),
      submitted = await compose(ctx, sourcesFor(input, review));
    return {
      consumes: [...bound.consumes, ...submitted.consumes, ...mark(bound.target, review.takenAt)],
      effects: [],
      prepare: async () => {
        const items = await Promise.all(
          submitted.sealed.map((source) => review.compile(source, bound.process)),
        );
        return input.source ? items[0] : { kind: "batch", items };
      },
    };
  };
  /** Direct Apply and preview adoption share one source, reservation and sealed-native algorithm. */
  const applyBinding = async (
    ctx: CommandContext,
    input: z.output<(typeof commands)["families.apply"]["input"]>,
    review: Review,
    previewKey: "family.plan" | "families.plan",
  ) => {
    const bound = await nativeBinding(ctx, review.family),
      plan = input.plan ? adopt(ctx, input.plan, previewKey) : null;
    const submitted = plan
      ? { sealed: [], consumes: [] }
      : await compose(ctx, sourcesFor(input, review));
    const adopted = plan
      ? plansSchema.parse(plan.prepared.state === "ready" ? plan.prepared.value : null)
      : null;
    const sourceOutputs = adopted
      ? leaves<Plan>(adopted).map((item) => item.sealed)
      : submitted.sealed;
    return {
      consumes: [
        ...bound.consumes,
        ...submitted.consumes,
        ...mark(bound.target, review.takenAt),
        ...(plan ? planFacts(ctx, plan) : []),
      ],
      claims: plan ? [{ kind: "receipt" as const, id: plan.id }] : [],
      effects: [
        { kind: "document" as const, ref: bound.target },
        ...(await outputs(sourceOutputs)),
      ],
      prepare: async () => {
        const intents = plan
          ? [plan]
          : await Promise.all(
              submitted.sealed.map(async (source) => {
                const prepared = await review.compile(source, bound.process);
                return {
                  prepared: { state: "ready" as const, value: prepared },
                  result: await directPlan(ctx, prepared, review.preview),
                };
              }),
            );
        const items = intents.flatMap((intent) =>
          selectApply(
            ctx,
            intent,
            input.include,
            bound.process,
            review.family === "project",
            review.projectDoc,
          ),
        );
        if (!items.length) throw refused("No included family has changes to apply");
        return input.sources || (!input.source && !input.plan) || adopted?.kind === "batch"
          ? { kind: "batch", items }
          : items[0];
      },
    };
  };
  const familyPlan = command(commands["family.plan"], plansSchema, {
    bind: async (ctx) => planBinding(ctx, ctx.admission.input, await reviewFamily(ctx)),
    run: (ctx, execution) => runPreview(ctx, execution, runFamilyPlan),
    recover,
  });
  const familiesPlan = command(commands["families.plan"], plansSchema, {
    bind: async (ctx) =>
      planBinding(
        ctx,
        ctx.admission.input,
        await reviewFamilies(ctx, ctx.admission.input.familyNames),
      ),
    run: (ctx, execution) => runPreview(ctx, execution, runFamiliesPlan),
    recover,
  });
  const familyApply = command(commands["family.apply"], familyAppliesSchema, {
    bind: async (ctx) =>
      applyBinding(ctx, ctx.admission.input, await reviewFamily(ctx), "family.plan"),
    run: (ctx, execution) => runApply(ctx, execution, false),
    recover,
  });
  const familiesApply = command(commands["families.apply"], familiesAppliesSchema, {
    bind: async (ctx) =>
      applyBinding(
        ctx,
        ctx.admission.input,
        await reviewFamilies(ctx, ctx.admission.input.familyNames),
        "families.plan",
      ),
    run: (ctx, execution) => runApply(ctx, execution, true),
    recover,
  });

  const captureBinding = async (
    ctx: CommandContext,
    family: true | "project",
    input: { pod?: string; path?: string; spec?: string; familyIds?: number[] },
  ) => {
    const bound = await nativeBinding(ctx, family),
      paths = (input.familyIds ?? [0]).map(
        (id) => input.path ?? `captures/${digest(ctx.admission.id).slice(0, 24)}-${id}.json`,
      );
    return {
      consumes: bound.consumes,
      effects: input.pod
        ? [
            ...paths.map((path) => ({ kind: "member" as const, pod: input.pod!, path })),
            { kind: "directory" as const, path: await sourceRunOutput(input.pod, deps) },
          ]
        : [],
      prepare: async () => ({
        kind: "capture",
        process: bound.process,
        input: input.familyIds ? { familyIds: input.familyIds } : {},
        pod: input.pod ?? null,
        path: input.path ?? null,
        spec: input.spec ?? null,
        at: new Date().toISOString(),
      }),
    };
  };
  const fileCapture = async (
    ctx: CommandContext,
    execution: ActionExecution,
    prepared: z.infer<typeof captureSchema>,
    operation: "family.capture" | "families.capture",
    specs: { familyId: number; content: string; unmodeled: unknown[] }[],
  ) => {
    const members: PodMemberWritten[] = [],
      runs = new Map<number, string>();
    for (const spec of specs) {
      const request = {
        pod: prepared.pod!,
        path:
          prepared.path ??
          `captures/${digest(ctx.admission.id).slice(0, 24)}-${spec.familyId}.json`,
        content: spec.content,
      };
      const written = await execution.step("file", "pod.member.write", request, () =>
        writeMemberOnce(deps, request, podsFor(ctx)),
      );
      members.push(written);
      runs.set(
        spec.familyId,
        await writeCaptureRun(deps, podsFor(ctx), prepared.at, written, operation, {
          "unmodeled.json": `${JSON.stringify(spec.unmodeled, null, 2)}\n`,
        }),
      );
    }
    return { members, runs };
  };
  const familyCapture = command(commands["family.capture"], preparedFamilyCaptureSchema, {
    bind: async (ctx) => {
      if (ctx.admission.input.work)
        await ctx.selectWork(tools.family.work, ctx.admission.input.work, () => ({ cells: [] }));
      return captureBinding(ctx, true, ctx.admission.input);
    },
    run: async (ctx, execution) => {
      const prepared = execution.prepared,
        captured = (await native(
          ctx,
          execution,
          "family.capture",
          prepared,
        )) as NativeFamilyCapture.Res.Response;
      const spec = {
        familyId: 0,
        ...familyMember(captured.modelJson),
        ...(prepared.spec ? { content: draftContent(prepared.spec) } : {}),
      };
      if (!prepared.pod)
        return {
          id: ctx.admission.id,
          executionContext: targetOf(ctx),
          spec: spec.content,
          capturedAt: prepared.at,
          evidence: { ...captured, origin: "capture", rfaPath: null, run: null },
        };
      const { members, runs } = await fileCapture(ctx, execution, prepared, "family.capture", [
        spec,
      ]);
      return {
        executionContext: targetOf(ctx),
        member: members[0],
        evidence: { ...captured, origin: "capture", rfaPath: null, run: runs.get(0) ?? null },
      };
    },
    recover,
  });
  const familiesCapture = command(commands["families.capture"], preparedFamiliesCaptureSchema, {
    bind: async (ctx) => {
      if (ctx.admission.input.work)
        await ctx.selectWork(tools.families.work, ctx.admission.input.work, () => ({ cells: [] }));
      return captureBinding(ctx, "project", ctx.admission.input);
    },
    run: async (ctx, execution) => {
      const prepared = execution.prepared,
        captured = (await native(
          ctx,
          execution,
          "families.capture",
          prepared,
        )) as FamiliesCapture.Res.Response;
      const { members, runs } = await fileCapture(
        ctx,
        execution,
        prepared,
        "families.capture",
        captured.families.flatMap((f) =>
          f.success && f.modelJson ? [{ familyId: f.familyId, ...familyMember(f.modelJson) }] : [],
        ),
      );
      return {
        executionContext: targetOf(ctx),
        members,
        evidence: familiesCaptureEvidenceSchema.parse({
          diagnostics: captured.diagnostics,
          families: captured.families.map(({ modelJson: _, ...f }) => ({
            ...f,
            run: runs.get(f.familyId) ?? null,
          })),
        }),
      };
    },
    recover,
  });
  const familyObserve = command(commands["family.observe"], observationSchema, {
    bind: async (ctx) => {
      const input = ctx.admission.input;
      if (input.work)
        await ctx.selectWork(tools.family.work, input.work, () => ({
          cells: [],
          facts: [["reading"], ["takenAt"]],
        }));
      const bound = await nativeBinding(ctx, true),
        sources = await compose(ctx, input.source ? [{ source: input.source }] : []),
        capture = input.readingId ? ctx.read.receipts(input.readingId)[0] : null;
      if (
        capture &&
        (capture.key !== "family.capture" ||
          capture.state !== "succeeded" ||
          canonicalRouteInput(capture.target) !== canonicalRouteInput(ctx.admission.target))
      )
        throw refused("Baseline must name a succeeded capture for this exact family lifetime");
      const result = capture?.result as { spec?: string; capturedAt?: string } | undefined,
        reading = input.source ? rootText(sources.sealed[0]!.source) : result?.spec;
      if (!reading || (!input.source && !result?.capturedAt))
        throw refused("Capture has no live draft baseline");
      return {
        consumes: [
          ...bound.consumes,
          ...sources.consumes,
          ...(capture
            ? [
                {
                  kind: "receipt" as const,
                  probe: { id: capture.id, key: "family.capture" },
                  expected: true as const,
                },
              ]
            : []),
        ],
        effects: [],
        prepare: async () => ({
          kind: "observation",
          reading,
          takenAt: input.source ? null : result!.capturedAt,
        }),
      };
    },
    run: async (ctx, execution) => {
      const prepared = execution.prepared;
      if (!ctx.admission.input.work) return prepared;
      await execution.publishWork(ctx.admission.input.work.key, "family", [
        { path: ["reading"], value: prepared.reading },
        { path: ["takenAt"], value: prepared.takenAt },
      ]);
      return { envelope: await ctx.work.read(ctx.admission.input.work.key, "family") };
    },
  });
  const settingsObserve = command(commands["settings.observe"], settingsObservationSchema, {
    bind: async (ctx) => {
      const input = ctx.admission.input,
        handle = handleOf(ctx),
        doc = await ctx.selectWork(tools.pods.work, handle, () => ({
          cells: [],
          facts: [["basis"], ["fields"]],
        }));
      if (handle.key.work !== memberWork(input.member))
        throw refused("Exact member Work and expected revision are required");
      const saved = await runPods(deps, readMember(input.member, podsFor(ctx)));
      if (input.sha256 && input.sha256 !== saved.sha256)
        throw refused("Saved member changed; read it and adopt the current bytes");
      if (
        !input.replaceEdits &&
        Object.values(doc.fields).some((cell) => cell.edit || cell.suggestion)
      )
        throw refused(
          "Pending edits retain their original basis; explicitly replace edits to adopt another baseline",
        );
      return {
        consumes: [
          {
            kind: "member",
            probe: input.member,
            expected: saved.sha256,
            bytesBase64: Buffer.from(saved.content).toString("base64"),
          },
        ],
        effects: [],
        prepare: async () => ({
          kind: "settings-observation",
          basis: { member: input.member, rawContent: saved.content, sha256: saved.sha256 },
        }),
      };
    },
    run: async (ctx, execution) => {
      const handle = handleOf(ctx);
      await execution.publishWork(handle.key, "pods", [
        { path: ["basis"], value: execution.prepared.basis },
        { path: ["fields"], value: {} },
      ]);
      return { envelope: await ctx.work.read(handle.key, "pods") };
    },
  });
  const settingsWrite = command(commands["settings.write"], settingsWriteSchema, {
    bind: async (ctx) => {
      const handle = handleOf(ctx),
        doc = await ctx.selectWork(tools.pods.work, handle, (doc) => ({
          facts: [["basis"], ...(!doc.basis ? [["fields"] as const] : [])],
        })),
        reference = parseContributionKey(handle.key.work ?? "");
      if (reference?.kind !== "member") throw refused("Reviewed member Work is required");
      const member = { pod: reference.packageId, path: reference.path };
      if (doc.basis && canonicalRouteInput(doc.basis.member) !== canonicalRouteInput(member))
        throw refused("The original member basis changed");
      const destination = ctx.admission.input.destination,
        content = settingsCandidate(doc.basis?.rawContent ?? "{}", doc.fields),
        request = {
          ...(destination ?? member),
          content,
          ...(!destination && doc.basis ? { expectedSha256: doc.basis.sha256 } : {}),
        };
      return {
        effects: [{ kind: "member", pod: request.pod, path: request.path }],
        prepare: async () => ({
          kind: "settings",
          document: doc,
          request,
          ...(destination ? { destination: true } : {}),
        }),
      };
    },
    run: async (ctx, execution) => {
      const p = execution.prepared,
        written = await execution.step(
          "file",
          "expectedSha256" in p.request ? "pod.member.save" : "pod.member.write",
          p.request,
          () => writeMemberOnce(deps, p.request, podsFor(ctx)),
        );
      if (p.destination) return { file: written };
      const handle = handleOf(ctx),
        retired = await execution.retireWork(
          handle.key,
          "pods",
          Object.entries(p.document.fields).flatMap(([key, cell]) =>
            cell.edit ? [["fields", key]] : [],
          ),
        );
      const publication = await execution.publishWork(handle.key, "pods", [
        {
          path: ["basis"],
          value: {
            member: { pod: written.pod, path: written.path },
            rawContent: p.request.content,
            sha256: written.sha256,
          },
        },
      ]);
      return { file: written, publication, retired };
    },
  });
  const saveDraft = command(commands["families.save-draft"], draftsSchema, {
    bind: async (ctx) => {
      const doc = await familiesSelection(ctx),
        members = familiesDrafts(doc).map(({ source }) => ({
          pod: ctx.admission.input.pod,
          path: source.path,
          content: "content" in source ? source.content : "",
        }));
      return {
        effects: members.map(({ pod, path }) => ({ kind: "member", pod, path })),
        prepare: async () => ({ kind: "drafts", members }),
      };
    },
    run: async (ctx, execution) => {
      const members = [];
      for (const member of execution.prepared.members)
        members.push(
          await execution.step("file", "pod.member.write", member, () =>
            writeMemberOnce(deps, member, podsFor(ctx)),
          ),
        );
      return { saved: members.length, members };
    },
  });
  const parameterApply = command(commands["parameter-links.apply"], parameterApplySchema, {
    bind: async (ctx) => {
      const handle = handleOf(ctx),
        doc = await ctx.selectWork(tools["parameter-links"].work, handle, () => ({ facts: [] })),
        profile = stagedParameterProfile(doc);
      if (!profile) throw refused("Stage a profile before applying");
      const bound = await nativeBinding(ctx, "project"),
        consumes: Dependency[] = [...bound.consumes];
      if (ctx.admission.input.readingId) {
        const artifact = await captures.savedFamilyText(ctx.admission.input.readingId),
          capture = familyCaptureSchema.parse(JSON.parse(artifact.text));
        if (
          capture.provenance.kind !== "live" ||
          !capture.provenance.process ||
          canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(bound.target) ||
          capture.reading.kind !== "parameter-links"
        )
          throw refused("The reviewed evaluation is not live evidence for the selected lifetime");
        const reading = parameterLinksReadingSchema.parse(capture.reading.value);
        if (!reading.evaluated || !reading.evaluation)
          throw refused("The reviewed reading is a stored-profile read, not a staged evaluation");
        if (reading.subject === "suggestion")
          throw refused(
            "The reviewed reading is a proposal preview; stage the profile and preview again",
          );
        if (reading.basis !== parameterLinksBasis(doc))
          throw refused("The staged profile changed after the evaluation; preview again");
        consumes.push(
          {
            kind: "file",
            probe: { path: artifact.path },
            expected: digest(artifact.text),
            bytesBase64: Buffer.from(artifact.text).toString("base64"),
          },
          {
            kind: "incarnation",
            probe: { target: ctx.admission.target, process: capture.provenance.process },
            expected: true,
          },
          ...mark(capture.provenance.target, capture.capturedAt),
        );
      }
      return {
        consumes,
        effects: [{ kind: "document", ref: bound.target }],
        prepare: async () => {
          if (!ctx.admission.input.readingId) {
            const result = (await invoke(
              bridge,
              bound.target,
              "revit.apply.parameter-links",
              { profile, previewOnly: true, reconcile: false },
              `${ctx.admission.id}:evaluate`,
            )) as { evaluation?: { issues?: { severity?: string }[] } };
            if (
              !result.evaluation ||
              result.evaluation.issues?.some((x) => x.severity?.toLowerCase() === "error")
            )
              throw refused("Parameter link evaluation refused the submitted edits");
          }
          return {
            kind: "native",
            process: bound.process,
            input: { profile, previewOnly: false, reconcile: true },
          };
        },
      };
    },
    run: (ctx, execution) =>
      native(ctx, execution, "revit.apply.parameter-links", execution.prepared),
    recover,
  });
  const build = command(commands["family.build"], buildSchema, {
    bind: async (ctx) => {
      if (ctx.admission.input.work) await familySelection(ctx);
      const bound = await nativeBinding(ctx, false),
        input = ctx.admission.input,
        sources = await compose(ctx, [{ source: input.source }]),
        sealed = sources.sealed[0]!,
        file = win32.join(
          await runPods(deps, podFolder(input.source.pod, podsFor(ctx))),
          input.source.path,
        );
      return {
        consumes: [...bound.consumes, ...sources.consumes],
        effects: [{ kind: "document", ref: bound.target }, ...(await outputs([sealed]))],
        prepare: async () => ({
          kind: "native",
          process: bound.process,
          input: {
            specJson: sealed.specJson,
            source: sealed.source,
            ...(deps.nativePaths
              ? await deps.nativePaths(input, ctx.admission.id, file)
              : { modelDirectory: resolve(input.modelDirectory ?? win32.dirname(file)) }),
          },
        }),
      };
    },
    run: async (ctx, execution) => {
      const result = await native(ctx, execution, "family.build", execution.prepared);
      return {
        executionContext: targetOf(ctx),
        native: result,
        outputPath: (result as { outputPath?: string }).outputPath,
      };
    },
    recover,
  });
  return {
    "settings.observe": settingsObserve,
    "settings.write": settingsWrite,
    "family.observe": familyObserve,
    "family.capture": familyCapture,
    "families.capture": familiesCapture,
    "family.plan": familyPlan,
    "families.plan": familiesPlan,
    "family.apply": familyApply,
    "families.apply": familiesApply,
    "families.save-draft": saveDraft,
    "parameter-links.apply": parameterApply,
    "family.build": build,
    "family.attach-spec": familySpecExecutor(deps),
  } satisfies Record<FamilyActionKey, CommandExecutor>;
}

const liveFamilyReads = new WeakMap<
  RevitBridge["Service"],
  Map<string, { owner: string; cancelled: boolean; active: boolean }>
>();

async function readLiveFamily(
  key: "family.read" | "family.cancel-read",
  input: unknown,
  scope: unknown,
  target: unknown,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
) {
  const { readId } = familyReads[key].input.parse(input);
  const work = workKeySchema.parse(scope);
  const document = documentRefSchema.parse(target);
  if (work.route !== "family") throw refused("Family read requires Family Work");
  const owner = canonicalRouteInput({ work, document });
  let reads = liveFamilyReads.get(bridge);
  if (!reads) liveFamilyReads.set(bridge, (reads = new Map()));
  if (key === "family.cancel-read") {
    const running = reads.get(readId);
    if (!running || running.owner !== owner) throw refused("No matching running Family read");
    running.cancelled = true;
    if (running.active) await invoke(bridge, document, CANCEL_OPERATION_KEY, { requestId: readId });
    return { cancelled: true as const };
  }
  if (reads.has(readId)) throw refused("Family read is already running");
  const running = { owner, cancelled: false, active: false };
  reads.set(readId, running);
  try {
    if (!deps.workspace) throw refused("Route Work is unavailable");
    const { expectedRevision } = familyReads["family.read"].input.parse(input);
    const { session, process } = await lifetime(bridge, document, true, deps);
    const opened = session.state!.openDocuments.find((doc) => doc.openId === document.openId)!;
    const bound = bindWork(
      "family",
      opened.address ? address(opened.address) : null,
      undefined,
      document,
    );
    const from =
      work.binding === "address" ? work.from : work.binding === "open" ? work.open : null;
    if (
      workKey(work) !== workKey(bound) ||
      (from && canonicalRouteInput(from) !== canonicalRouteInput(document))
    )
      throw refused("Family Work belongs to a different document");
    const marks = documentMarks(bridge);
    const takenAt = new Date().toISOString();
    const fence = async () => {
      if (running.cancelled) throw refused("Family read cancelled");
      await current(bridge, document, true, process);
      assertFresh(marks, document, takenAt);
    };
    await fence();
    running.active = true;
    const captured = await invoke<NativeFamilyCapture.Res.Response>(
      bridge,
      document,
      "family.capture",
      {},
      readId,
    );
    running.active = false;
    await fence();
    const result = familyLiveReadSchema.parse({
      reading: familyMember(captured.modelJson).content,
      takenAt,
      executionContext: document,
      process,
    });
    // Baselines are host observations; the edit door deliberately refuses these paths.
    const written = await deps.workspace.publish(
      work,
      "family",
      [
        { path: ["reading"], value: result.reading },
        { path: ["takenAt"], value: result.takenAt },
      ],
      expectedRevision,
    );
    if (!written.ok) throw refused("error" in written ? written.error : written.agentHint);
    return result;
  } finally {
    reads.delete(readId);
  }
}

export async function readFamily(
  raw: { key: string; input?: unknown; target?: unknown; scope: unknown },
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
) {
  if (!Object.hasOwn(familyReads, raw.key)) throw refused("Unknown Family reading");
  const key = raw.key as FamilyReadKey;
  const input = familyReads[key].input.parse(raw.input ?? {});
  if (key === "family.saved") return captures.family(familyReads[key].input.parse(input).id);
  if (key === "family.read" || key === "family.cancel-read")
    return readLiveFamily(key, input, raw.scope, raw.target, bridge, deps);
  const scope = workKeySchema.parse(raw.scope);
  const target = documentRefSchema.parse(raw.target);
  // Parameter Links reads a project document, not a family document.
  const { session: original, process } = await lifetime(bridge, target, "project", deps);
  const marks = documentMarks(bridge);
  const capturedAt = new Date().toISOString();
  const fence = async () => {
    const next = await current(bridge, target, "project");
    if (
      next.processId !== original.processId ||
      next.processStartUtcUnixMs !== original.processStartUtcUnixMs
    )
      throw refused("Reading process changed");
    assertFresh(marks, target, capturedAt);
  };
  const native = async (key: string, input: unknown) => {
    await fence();
    const result = await invoke(bridge, target, key, input);
    await fence();
    return result;
  };
  if (!deps.workspace) throw refused("Route Work is unavailable");
  const view = await deps.workspace.read(scope, "parameter-links");
  if (!view) throw refused("Author this route's Work before reading it");
  const document = parameterLinksRouteState.schema.parse(view.doc);
  const { evaluate, subject } = familyReads["parameter-links.read"].input.parse(input);
  // The staged profile, or a labelled preview of Pea's proposal; nothing else is evaluated.
  const profile =
    subject === "suggestion"
      ? (document.profile.suggestion?.value ?? null)
      : stagedParameterProfile(document);
  if (evaluate && !profile)
    throw refused(
      subject === "suggestion"
        ? "Pea has proposed no profile"
        : "Stage a profile before evaluating it",
    );
  const data = evaluate
    ? await native("revit.apply.parameter-links", {
        profile,
        previewOnly: true,
        reconcile: false,
      })
    : await native("revit.detail.parameter-links", { includeEvaluation: false });
  const reading: FamilyCapture["reading"] = {
    kind: "parameter-links",
    value: parameterLinksReadingSchema.parse({
      ...(data as object),
      basis: parameterLinksBasis(document, subject),
      workRevision: view.revision,
      evaluated: evaluate,
      subject,
      // What Revit holds arrives as `profile`; `stored` names it for what it is.
      stored: (data as { profile?: unknown }).profile ?? null,
      // A stored-profile read observes Revit, never the staged profile: it carries no
      // evaluation, so it can never arm an apply of a profile it did not evaluate.
      evaluation: evaluate ? (data as { evaluation?: unknown }).evaluation : null,
    }),
  };
  await fence();
  const provenance: FamilyCapture["provenance"] = { kind: "live", target, process };
  return captures.saveFamily({ key: scope, capturedAt, provenance, reading }, fence);
}
