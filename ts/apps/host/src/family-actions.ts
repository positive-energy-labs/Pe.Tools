import { authorSchema } from "@pe/agent-contracts";
import { currentDocument as current, lifetime } from "./document-lifetime.ts";
import { createHash } from "node:crypto";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, type FileSystem } from "effect";
import type { RunPods } from "@pe/host-internal/pod-runner";
import {
  sameCaller,
  familyActions,
  familyMemberPath,
  familyReads,
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
  mergeParameterProfile,
  CatalogWorkRefused,
  parameterLinksDataSchema,
  type ParameterLinkProfile,
  parameterLinksReadingSchema,
  settingsCandidate,
  settingsRouteState,
  nativeProcessSchema,
  canonicalRouteInput,
  documentRefSchema,
  workKeySchema,
  workKey,
  bindWork,
  addressSchema,
  familiesObservationSchema,
  summarizeFamiliesObservation,
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
  parseContributionKey,
  type FamiliesRouteDocument,
  type WorkPath,
} from "@pe/agent-contracts";
import { commands, tools } from "@pe/mcps/product-actions";
import type {
  PodMemberSaveRequest,
  PodMemberWriteRequest,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";
import type {
  FamiliesApply,
  FamiliesCapture,
  FamiliesPlan,
  RevitCatalogLoadedFamilies,
  RevitMatrixLoadedFamilies,
} from "@pe/host-contracts/generated";
import { documentHomes, invokeBridge as invoke } from "./bridge.ts";
import { type RevitBridge } from "@pe/host-internal/bridge";
import { assertFresh, type DocumentMarks } from "./document-marks.ts";
import type { ActionExecution } from "@pe/host-internal/action-execution";
import {
  command,
  io,
  nativeStep,
  refused,
  StepFailure,
  type CommandContext,
  type CommandExecutor,
} from "@pe/host-internal/command-executor";
import { z } from "zod";
import type { Consumed as Dependency, WorkHandle } from "@pe/agent-contracts";
import { type TakeoffActionDependencies } from "./rhvac-ops.ts";
import type { NativeProcess } from "./native-receipts.ts";
import {
  composedSpec,
  podFolder,
  saveMember,
  writeMember,
  readMember,
  runsDirectory,
  writeRun,
  type PodContext,
} from "./settings.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { LocalOpError } from "./local-error.ts";
import type { FamiliesReader } from "./families-reader.ts";
import { nativeInputSchema } from "./native-input.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/**
 * The run output a command declares and a native run writes: `state\Runs\<pod-id>`, or `_no-pod`
 * for a supplied draft (homes freeze shape 7). Pure: no write, and no pod is copied anywhere. The
 * pod must exist; its home does not matter, because a run never lands in a home.
 */
export const sourceRunDirectory = async (
  pod: string | null | undefined,
  deps: PodDependencies,
  pods: PodContext = { podsRoot: deps.podsRoot },
) => {
  if (pod) await runPods(deps, podFolder(pod, pods));
  return runsDirectory(pod, pods);
};

export type PodDependencies = {
  podsRoot?: string;
  runPods?: RunPods;
};
export type FamilyActionDependencies = TakeoffActionDependencies &
  PodDependencies & {
    marks?: DocumentMarks;
    files?: import("@pe/ducts-host/ducts-files").DuctFiles["Service"];
    pictures?: import("./captures-route.ts").PictureCaptureStore["Service"];
    families?: Pick<FamiliesReader["Service"], "read" | "cancel">;
    /** The demo owner keeps native reads inside its own root; a build has no output path to place. */
    nativePaths?: (
      input: { modelDirectory?: string },
      id: string,
      file: string,
    ) => Promise<{ modelDirectory: string }>;
  };

/** Pod I/O runs against the product Pods root unless an owner (the demo lane) supplies its own. */
export const runPods = <A, E>(
  deps: PodDependencies,
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
  options?: { signal?: AbortSignal },
) =>
  deps.runPods
    ? deps.runPods(effect, options)
    : // effect-edge: island, phase 5
      Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)), options);

/** A conditional member write that refused wrote nothing: a clean refusal, never an unknown effect. */
const writeMemberOnce = (
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

/** The `$schema` a family member carries: the library path, no origin. C# owns the shape (`SettingsSchemaUrl.Path`). */
const familyModelSchema = "/schemas/settings/FamilyFoundry/models.json";
const familyPatchSchema = "/schemas/settings/FamilyFoundry/patches.json";

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
    content: `${JSON.stringify({ $schema: familyModelSchema, ...model }, null, 2)}\n`,
    unmodeled,
  };
};

/** A draft saved as a member says what it is, whatever `$schema` it carried. */
const podContext = async (
  deps: PodDependencies,
  bridge: RevitBridge["Service"],
  target?: DocumentRef,
): Promise<PodContext> => ({
  ...(await documentHomes(bridge, {
    bridgeSessionId: target?.session,
    openDocumentId: target?.openId,
  })),
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

/**
 * A capture run's receipt. A receipt's member fields name what the run consumed; a capture consumed
 * Revit (origin Operation), so they are null. The member it wrote is its product: the run lists it
 * as `written-member.json` beside its other outputs.
 */
const writeCaptureRun = (
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

const retirementSchema = z.strictObject({
  key: workKeySchema,
  route: z.literal("families"),
  cells: z.array(z.string()),
  patch: z.literal(true).optional(),
});
type Retirement = z.infer<typeof retirementSchema>;
/**
 * The consumed Work paths a native apply result confirms. Only a successful receipt confirms intent:
 * a cancelled or refused run retires nothing, so the edits stay staged. Each cell needs its family's receipt.
 */
export const confirmedRetirement = (
  consumed: Retirement,
  patchNames: readonly string[] | null | undefined,
  receipts: readonly { familyName: string; success: boolean; converged: boolean }[],
): WorkPath[] => {
  const succeeded = new Set(receipts.filter((x) => x.success).map((x) => x.familyName)),
    converged = new Set(receipts.filter((x) => x.success && x.converged).map((x) => x.familyName));
  if (!succeeded.size) return [];
  const paths: WorkPath[] = consumed.cells
    .filter((cell) => succeeded.has(familyCellAddress(cell).familyName))
    .map((cell) => ["cells", cell]);
  if (consumed.patch && patchNames?.every((name) => converged.has(name))) paths.push(["patch"]);
  return paths;
};
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
    excluded: z.record(z.string(), z.strictObject({ by: authorSchema })),
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
const composedInput = (key: "families.apply") =>
  z.intersection(nativeInputSchema(key), z.object({ source: sealedSourceSchema }));
const familiesAppliesSchema = batchOf(
  applyLeafSchema.extend({
    input: composedInput("families.apply").refine(
      (input) => typeof input.plan === "string",
      "Apply must retain its exact plan",
    ),
  }),
);
const captureSchema = z.object({
  kind: z.literal("capture"),
  process: nativeProcessSchema,
  input: z.unknown(),
  pod: z.string().nullable(),
  path: z.string().nullable(),
  spec: z.string().nullable(),
  at: z.string(),
});
const preparedFamiliesCaptureSchema = captureSchema.extend({
  input: nativeInputSchema("families.capture"),
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
type PlanCall = { key: string; input: unknown; process: NativeProcess };
type PlanResult = {
  plan: unknown;
  included: Record<string, string>;
  excluded?: unknown[];
  orphaned?: string[];
} & Record<string, unknown>;
type PlanCalls = Generator<PlanCall, PlanResult, unknown>;
type PlanRunner = (ctx: CommandContext, prepared: Plan) => PlanCalls;
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
      content: `${JSON.stringify({ $schema: familyPatchSchema, ...familyStagedPatch(doc.cells, familyName)!.spec }, null, 2)}\n`,
    },
    familyNames: [familyName],
    executionOptions: doc.executionOptions,
  }));
};
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
  const nativeBinding = async (ctx: CommandContext) => {
    const target = targetOf(ctx),
      { process } = await lifetime(bridge, target, "project", deps);
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
        const value = await familySpec(deps, item.source, await podsFor(ctx));
        for (const member of [value.source.root, ...value.source.dependencies])
          if ((!("origin" in member) || member.origin === "SavedMember") && member.id)
            consumes.push({
              kind: "member",
              probe: { pod: member.id, path: member.path },
              expected: member.sha256,
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
  const outputs = async (ctx: CommandContext, sources: readonly Sealed[]) =>
    Promise.all(
      [...new Set(sources.map((x) => x.source.root.id))].map(async (pod) => ({
        kind: "directory" as const,
        path: (await sourceRunDirectory(pod, deps, await podsFor(ctx))).path,
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
      (id) => nativeStep(bridge, targetOf(ctx), key, prepared.input, id),
      { process: prepared.process, ...(check ? { check } : {}) },
    );
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
        written: Object.keys(doc.cells).filter((cell) => doc.cells[cell]!.edit),
      },
    };
  };
  // A plan runs at prepare time (Promise) and as a journaled step (Effect): it yields its native
  // calls and each driver answers them, so one algorithm serves both without a run call.
  const runFamiliesPlan = function* (ctx: CommandContext, prepared: Plan): PlanCalls {
    const catalog = (yield {
      key: "revit.catalog.loaded-families",
      input: familyCatalogRequest(prepared.planned.scope!),
      process: prepared.process,
    }) as RevitCatalogLoadedFamilies.Res.Response;
    const problem = familyCatalogProblem(catalog);
    if (problem) throw refused(problem.message);
    const resolved = [...new Set(catalog.families.map((x) => x.familyName))],
      outside = prepared.planned.familyNames?.filter((name) => !resolved.includes(name)) ?? [];
    if (outside.length)
      throw refused(`Families ${outside.join(", ")} are outside the reviewed scope`);
    const result = (yield {
      key: "families.plan",
      input: {
        specJson: prepared.sealed.specJson,
        ...(prepared.sealed.executionOptions
          ? { executionOptions: prepared.sealed.executionOptions }
          : {}),
        familyNames: prepared.planned.familyNames ?? resolved,
      },
      process: prepared.process,
    }) as FamiliesPlan.Res.Response;
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
      plan: unknown;
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
  const runPreview = (ctx: CommandContext, execution: ActionExecution, run: PlanRunner) =>
    Effect.gen(function* () {
      const results = [];
      for (const item of leaves<Plan>(execution.prepared as Plans)) {
        const calls = run(ctx, item);
        let next = calls.next();
        while (!next.done)
          next = calls.next(
            yield* native(ctx, execution, next.value.key, {
              input: next.value.input,
              process: next.value.process,
            }),
          );
        results.push(next.value);
      }
      return (execution.prepared as Plans).kind === "batch" ? aggregate(ctx, results) : results[0];
    });
  const directPlan = async (ctx: CommandContext, p: Plan, run: PlanRunner) => {
    const calls = run(ctx, p);
    let next = calls.next();
    while (!next.done) {
      const { key, input, process } = next.value;
      await current(bridge, targetOf(ctx), "project", process);
      next = calls.next(
        await invoke(
          bridge,
          targetOf(ctx),
          key,
          input,
          `${ctx.admission.id}:prepare:${digest(canonicalRouteInput(input)).slice(0, 16)}`,
        ),
      );
    }
    return next.value;
  };
  const adopt = (ctx: CommandContext, id: string, key: string) => {
    const plan = ctx.read.receipts(id)[0];
    if (!plan || plan.key !== key || plan.state !== "succeeded" || plan.prepared.state !== "ready")
      throw refused(`Apply must name a succeeded ${key} action`);
    if (canonicalRouteInput(plan.target) !== canonicalRouteInput(ctx.admission.target))
      throw refused("The plan was made for a different document");
    if (!sameCaller(plan.caller, ctx.caller))
      throw refused("Plan belongs to another caller", "preview.caller");
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
            familyNames: Object.fromEntries(
              entries.flatMap((e) =>
                e.familyId != null && Object.hasOwn(hashes, String(e.familyId))
                  ? [[String(e.familyId), e.familyName]]
                  : [],
              ),
            ),
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
          ...(consumed || doc
            ? {
                readbackWork: consumed?.key ?? handleOf(ctx).key,
                readbackTakenAt: consumed ? item.sealed.takenAt : doc?.takenAt,
              }
            : {}),
        },
      ];
    });
  };
  const runApply = (ctx: CommandContext, execution: ActionExecution) =>
    Effect.gen(function* () {
      const results = [];
      for (const prepared of leaves<Apply>(execution.prepared as z.infer<typeof appliesSchema>)) {
        const result = (yield* native(
            ctx,
            execution,
            "families.apply",
            prepared,
            appliedSomething,
          )) as FamiliesApply.Res.Response,
          consumed = prepared.retire;
        let retired: unknown;
        if (consumed)
          retired = yield* execution.retireWork(
            consumed.key,
            consumed.route,
            confirmedRetirement(consumed, prepared.retirePatchNames, result.receipts),
          );
        const readback: Record<string, unknown> = {},
          names = [...new Set(result.receipts.filter((x) => x.success).map((x) => x.familyName))];
        if (names.length)
          yield* io(async () => {
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
                id: (await captures.saveFamiliesReadback(source.id, target, names, at, observed))
                  .id,
              };
            } catch (error) {
              readback.readbackError = `Families applied, but their loaded-project values could not be verified: ${error instanceof Error ? error.message : String(error)}`;
            }
          });
        results.push({
          executionContext: targetOf(ctx),
          native: result,
          ...(retired ? { retired } : {}),
          ...readback,
        });
      }
      return (execution.prepared as { kind: string }).kind === "batch" ? { results } : results[0];
    });
  type Review = {
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
  const reviewFamilies = async (ctx: CommandContext, names?: string[]): Promise<Review> => {
    const doc = ctx.admission.input.work ? await familiesSelection(ctx, names) : null;
    return {
      takenAt: doc?.takenAt ?? null,
      drafts: () => familiesDrafts(reviewed(doc)),
      compile: (source, process) => planFamilies(ctx, reviewed(doc), source, process),
      preview: runFamiliesPlan,
      ...(doc ? { projectDoc: doc } : {}),
    };
  };
  type SourceInput = Pick<
    z.output<(typeof familyActions)["families.apply"]["input"]>,
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
    const bound = await nativeBinding(ctx),
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
    input: z.output<(typeof familyActions)["families.apply"]["input"]>,
    review: Review,
  ) => {
    const bound = await nativeBinding(ctx),
      plan = input.plan ? adopt(ctx, input.plan, "families.plan") : null;
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
        ...(await outputs(ctx, sourceOutputs)),
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
          selectApply(ctx, intent, input.include, bound.process, review.projectDoc),
        );
        if (!items.length) throw refused("No included family has changes to apply");
        return input.sources || (!input.source && !input.plan) || adopted?.kind === "batch"
          ? { kind: "batch", items }
          : items[0];
      },
    };
  };
  const familiesPlan = command(commands["families.plan"], plansSchema, {
    bind: async (ctx) =>
      planBinding(
        ctx,
        ctx.admission.input,
        await reviewFamilies(ctx, ctx.admission.input.familyNames),
      ),
    run: (ctx, execution) => runPreview(ctx, execution, runFamiliesPlan),
  });
  const familiesApply = command(commands["families.apply"], familiesAppliesSchema, {
    seal: (p) => ({ request: p.kind === "batch" ? p.items.map(({ input }) => input) : p.input }),
    bind: async (ctx) =>
      applyBinding(
        ctx,
        ctx.admission.input,
        await reviewFamilies(ctx, ctx.admission.input.familyNames),
      ),
    run: (ctx, execution) => runApply(ctx, execution),
  });

  // A capture names no family before Revit answers, so its member is named by the action that filed it.
  const capturedMember = (ctx: CommandContext, familyId: number) =>
    familyMemberPath(`${digest(ctx.admission.id).slice(0, 24)}-${familyId}`);
  const captureBinding = async (
    ctx: CommandContext,
    input: { pod?: string; path?: string; spec?: string; familyIds?: number[] },
  ) => {
    const bound = await nativeBinding(ctx),
      paths = (input.familyIds ?? [0]).map((id) => input.path ?? capturedMember(ctx, id));
    return {
      consumes: bound.consumes,
      effects: input.pod
        ? [
            ...paths.map((path) => ({ kind: "member" as const, pod: input.pod!, path })),
            {
              kind: "directory" as const,
              path: (await sourceRunDirectory(input.pod, deps, await podsFor(ctx))).path,
            },
          ]
        : [],
      prepare: async () => {
        return {
          kind: "capture" as const,
          process: bound.process,
          input: input.familyIds ? { familyIds: input.familyIds } : {},
          pod: input.pod ?? null,
          path: input.path ?? null,
          spec: input.spec ?? null,
          at: new Date().toISOString(),
        };
      },
    };
  };
  const fileCapture = (
    ctx: CommandContext,
    execution: ActionExecution,
    prepared: z.infer<typeof captureSchema>,
    operation: "families.capture",
    specs: { familyId: number; content: string; unmodeled: unknown[] }[],
  ) =>
    Effect.gen(function* () {
      const members: PodMemberWritten[] = [],
        runs = new Map<number, string>();
      for (const spec of specs) {
        const request = {
          pod: prepared.pod!,
          path: prepared.path ?? capturedMember(ctx, spec.familyId),
          content: spec.content,
        };
        const written = yield* execution.step("file", "pod.member.write", request, () =>
          io(async () => writeMemberOnce(deps, request, await podsFor(ctx))),
        );
        members.push(written);
        runs.set(
          spec.familyId,
          yield* io(async () =>
            writeCaptureRun(deps, await podsFor(ctx), prepared.at, written, operation, {
              "unmodeled.json": `${JSON.stringify(spec.unmodeled, null, 2)}\n`,
            }),
          ),
        );
      }
      return { members, runs };
    });
  const familiesCapture = command(commands["families.capture"], preparedFamiliesCaptureSchema, {
    bind: async (ctx) => {
      if (ctx.admission.input.work)
        await ctx.selectWork(tools.families.work, ctx.admission.input.work, () => ({ cells: [] }));
      return captureBinding(ctx, ctx.admission.input);
    },
    run: (ctx, execution) =>
      Effect.gen(function* () {
        const prepared = execution.prepared,
          captured = (yield* native(
            ctx,
            execution,
            "families.capture",
            prepared,
          )) as FamiliesCapture.Res.Response;
        const { members, runs } = yield* fileCapture(
          ctx,
          execution,
          prepared,
          "families.capture",
          captured.families.flatMap((f) =>
            f.success && f.modelJson
              ? [{ familyId: f.familyId, ...familyMember(f.modelJson) }]
              : [],
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
      }),
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
      const saved = await runPods(deps, readMember(input.member, await podsFor(ctx)));
      if (input.sha256 && input.sha256 !== saved.sha256)
        throw refused("Saved member changed; read it and adopt the current bytes");
      if (!input.replaceEdits && Object.values(doc.fields).some((cell) => cell.edit))
        throw refused(
          "Pending edits retain their original basis; explicitly replace edits to adopt another baseline",
        );
      return {
        consumes: [
          {
            kind: "member",
            probe: input.member,
            expected: saved.sha256,
          },
        ],
        effects: [],
        prepare: async () => ({
          kind: "settings-observation",
          basis: { member: input.member, rawContent: saved.content, sha256: saved.sha256 },
        }),
      };
    },
    run: (ctx, execution) =>
      Effect.gen(function* () {
        const handle = handleOf(ctx);
        yield* execution.publishWork(handle.key, "pods", [
          { path: ["basis"], value: execution.prepared.basis },
          { path: ["fields"], value: {} },
        ]);
        return { envelope: yield* io(() => ctx.work.read(handle.key, "pods")) };
      }),
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
      const destination = ctx.admission.input.destination;
      // Without a basis the candidate is the edits over `{}` and the write has no hash to check, so it
      // would replace the saved member with only the staged keys.
      if (!destination && !doc.basis)
        throw refused("Open the member's saved bytes before saving; this Work has no saved basis");
      const content = settingsCandidate(doc.basis?.rawContent ?? "{}", doc.fields),
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
    run: (ctx, execution) =>
      Effect.gen(function* () {
        const p = execution.prepared,
          written = yield* execution.step(
            "file",
            "expectedSha256" in p.request ? "pod.member.save" : "pod.member.write",
            p.request,
            () => io(async () => writeMemberOnce(deps, p.request, await podsFor(ctx))),
          );
        if (p.destination) return { file: written };
        const handle = handleOf(ctx),
          retired = yield* execution.retireWork(
            handle.key,
            "pods",
            Object.entries(p.document.fields).flatMap(([key, cell]) =>
              cell.edit ? [["fields", key]] : [],
            ),
          );
        const publication = yield* execution.publishWork(handle.key, "pods", [
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
      }),
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
    run: (ctx, execution) =>
      Effect.gen(function* () {
        const members = [];
        for (const member of execution.prepared.members)
          members.push(
            yield* execution.step("file", "pod.member.write", member, () =>
              io(async () => writeMemberOnce(deps, member, await podsFor(ctx))),
            ),
          );
        return { saved: members.length, members };
      }),
  });
  return {
    "settings.observe": settingsObserve,
    "settings.write": settingsWrite,
    "families.read": command(
      familyActions["families.read"],
      z.object({
        work: familyActions["families.read"].input.shape.work,
        readId: z.uuid(),
        filter: appliedScopeSchema,
        document: documentRefSchema,
        title: z.string().optional(),
      }),
      {
        bind: async (ctx) => {
          if (!deps.families) throw refused("Families reader is unavailable");
          const target = targetOf(ctx);
          const { session } = await lifetime(bridge, target, "project", deps);
          const document = session.state?.openDocuments.find((d) => d.openId === target.openId);
          const handle = ctx.admission.input.work;
          const expected = bindWork(
            "families",
            document?.address ? addressSchema.parse(document.address) : null,
            undefined,
            target,
          );
          if (workKey(handle.key) !== workKey(expected))
            throw refused("Families Work belongs to another document");
          const work = await ctx.selectWork(tools.families.work, handle, () => ({
            facts: [["scope"]],
          }));
          const filter = stagedFilter(work);
          if (!filter?.categoryNames.length)
            throw refused("Choose a family category before reading");
          return {
            effects: [],
            prepare: async () => ({
              work: handle,
              readId: ctx.admission.input.readId,
              filter,
              document: target,
              title: document?.title ?? undefined,
            }),
          };
        },
        run: (ctx, execution) =>
          Effect.gen(function* () {
            if (!deps.families) throw refused("Families reader is unavailable");
            const p = execution.prepared;
            const saved = yield* io(() =>
              deps.families!.read({
                bridge,
                captures,
                readId: p.readId,
                work: p.work.key,
                document: p.document,
                documentTitle: p.title,
                filter: p.filter,
              }),
            );
            if (saved.progress && saved.progress.state !== "complete")
              throw refused(saved.progress.message ?? `Families read ${saved.progress.state}`);
            const published = yield* execution.step(
              "publication",
              "families.bind-observation",
              { work: p.work, observation: saved.id },
              () =>
                io(() =>
                  ctx.work.publish(
                    p.work.key,
                    "families",
                    [{ path: ["takenAt"], value: saved.capturedAt }],
                    p.work.revision,
                  ),
                ),
            );
            if (!published.ok)
              throw refused("Families Work changed during the read; read the current scope again");
            return familiesReadResult(saved, published.revision);
          }),
      },
    ),
    "families.cancel-read": command(
      commands["families.cancel-read"],
      z.strictObject({ readId: z.uuid(), document: documentRefSchema }),
      {
        bind: async (ctx) => {
          if (!deps.families) throw refused("Families reader is unavailable");
          const prepared = { readId: ctx.admission.input.readId, document: targetOf(ctx) };
          return { effects: [], prepare: async () => prepared };
        },
        run: (_ctx, { prepared }) =>
          Effect.gen(function* () {
            if (!deps.families) throw refused("Families reader is unavailable");
            yield* io(() => deps.families!.cancel(prepared.readId, prepared.document));
            return { cancelled: true as const };
          }),
      },
    ),
    "families.capture": familiesCapture,
    "families.plan": familiesPlan,
    "families.apply": familiesApply,
    "families.save-draft": saveDraft,
  } satisfies Record<FamilyActionKey, CommandExecutor>;
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

  const scope = workKeySchema.parse(raw.scope);
  const target = documentRefSchema.parse(raw.target);
  const reader = await projectReader(bridge, target, deps);
  if (!deps.workspace) throw refused("Route Work is unavailable");
  // Legacy inspection is outside graph/command replay; the typed reading owns tracked Work input.
  const view = await deps.workspace.readUncaptured(scope, "parameter-links");
  if (!view) throw refused("Author this route's Work before reading it");
  const document = parameterLinksRouteState.schema.parse(view.doc);
  const { evaluate } = familyReads["parameter-links.read"].input.parse(input);
  const stored = await reader.read("revit.detail.parameter-links", { includeEvaluation: false });
  // Evaluate the profile apply would send: staged ids laid over the stored profile, never staged ids alone.
  const profile = evaluate
    ? (() => {
        try {
          return mergeParameterProfile(document, storedProfile(stored)).request.profile;
        } catch (error) {
          throw error instanceof CatalogWorkRefused ? refused(error.message) : error;
        }
      })()
    : null;
  const data = profile
    ? await reader.read("revit.apply.parameter-links.preview", { profile, reconcile: false })
    : stored;
  const reading: FamilyCapture["reading"] = {
    kind: "parameter-links",
    value: parameterLinksReadingSchema.parse({
      ...(data as object),
      basis: canonicalRouteInput(profile ?? storedProfile(stored)),
      workRevision: view.revision,
      evaluated: evaluate,
      // What Revit holds arrives as `profile` on the detail read; `stored` names it for what it is.
      stored: storedProfile(stored),
      // A stored-profile read observes Revit, never the staged profile: it carries no
      // evaluation, so it can never arm an apply of a profile it did not evaluate.
      evaluation: evaluate ? (data as { evaluation?: unknown }).evaluation : null,
    }),
  };
  await reader.fence();
  const provenance: FamilyCapture["provenance"] = { kind: "live", target, process: reader.process };
  return captures.saveFamily(
    { key: scope, capturedAt: reader.capturedAt, provenance, reading },
    reader.fence,
  );
}

const storedProfile = (detail: unknown): ParameterLinkProfile | null =>
  parameterLinksDataSchema.shape.profile.parse((detail as { profile?: unknown }).profile) ?? null;

/**
 * The one project-document Read owner (Parameter Links readings, every catalog Work base): a project document's lifetime, fenced on the process and the
 * document mark, around each native read. The reading above captures through it; the catalog plan reads
 * the stored profile through it and captures nothing.
 */
export async function projectReader(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  deps: FamilyActionDependencies = {},
) {
  const { session: original, process } = await lifetime(bridge, target, "project", deps);
  const marks = deps.marks!;
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
  const read = async (key: string, input: unknown) => {
    await fence();
    const result = await invoke(bridge, target, key, input);
    await fence();
    return result;
  };
  return { process, capturedAt, fence, read };
}

/** What a families.read receipt carries for the observation it bound at a Work revision. */
export const familiesReadResult = (
  saved: z.input<typeof familiesObservationSchema>,
  revision: number,
) =>
  summarizeFamiliesObservation(
    familiesObservationSchema.parse({ ...saved, envelope: { revision } }),
  );
