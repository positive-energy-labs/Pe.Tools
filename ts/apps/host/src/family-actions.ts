import { resolveSdkSession } from "./sdk-session.ts";
import { createHash } from "node:crypto";
import { join, resolve, win32 } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  familyActions,
  commands,
  familyReads,
  familyCaptureSchema,
  familiesCaptureEvidenceSchema,
  familiesRouteState,
  familiesExcluded,
  type FfPlanEntry,
  familiesIncluded,
  type FamilyExclusions,
  familyCellAddress,
  familyDraftRouteState,
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
  type FamilyActionKey,
  type FamilyReadKey,
  type DocumentRef,
  type PodMember,
  type PodDraftSource,
  type PodMemberSource,
  type SettingsRouteDocument,
  type FamilyCapture,
  type AppliedFilter,
  type Footprint,
  type WorkKey,
  appliedScopeSchema,
  familyExecutionOptionsSchema,
  familyCatalogProblem,
  familyCatalogRequest,
  stagedFilter,
} from "@pe/agent-contracts";
import type {
  PodMemberSaveRequest,
  PodMemberWriteRequest,
  PodMemberWritten,
  PodMemberRead,
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
import { BridgeError, invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { ActionIncomplete, CommandRejected } from "./action-journal.ts";
import { z } from "zod";
import type { CommandContext, CommandFactory } from "./command-executor.ts";
import type { Consumed as Dependency, WorkHandle } from "@pe/agent-contracts";
import { actionWorkspace, type TakeoffActionDependencies } from "./takeoff-actions.ts";
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

const familyInput = <K extends FamilyActionKey>(
  _key: K,
  input: unknown,
): z.infer<(typeof familyActions)[K]["input"]> =>
  input as z.infer<(typeof familyActions)[K]["input"]>;
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
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
      throw new CommandRejected({
        kind: "domain",
        code: "member.conflict",
        message: error.message,
      });
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

const documentKind = (key: FamilyActionKey): boolean | "project" =>
  commands[key].needs === "family-document"
    ? true
    : commands[key].needs === "project-document"
      ? "project"
      : false;

const diagnosticLine = (d: { code: string; path: string; message: string }) =>
  `${d.code} Â· ${d.path} â€” ${d.message}`;

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

type Sealed = z.infer<typeof sealedSchema>;

/** A member's JSON as authored, ignoring the `$schema` URL its writer stamps. */
const unstamped = (json: string) => {
  const { $schema: _, ...rest } = JSON.parse(json.replace(/^\uFEFF/, "")) as { $schema?: unknown };
  return canonicalRouteInput(rest);
};
const rootText = (source: { root: { bytesBase64: string } }) =>
  Buffer.from(source.root.bytesBase64, "base64").toString("utf8");
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
const preparedFamilyLeafSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("drafts"),
    members: z.array(z.strictObject({ pod: z.string(), path: z.string(), content: z.string() })),
  }),
  z.strictObject({
    kind: z.literal("settings-observation"),
    basis: z.strictObject({
      member: z.strictObject({ pod: z.string(), path: z.string() }),
      rawContent: z.string(),
      sha256: z.string(),
    }),
  }),
  z.strictObject({
    kind: z.literal("observation"),
    reading: z.string(),
    takenAt: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("settings"),
    document: settingsRouteState.schema,
    request: z.strictObject({
      pod: z.string(),
      path: z.string(),
      content: z.string(),
      expectedSha256: z.string().optional(),
    }),
  }),
  z
    .strictObject({
      kind: z.literal("native"),
      process: nativeProcessSchema,
      nativeKey: z.string(),
      input: z.unknown(),
      planned: z
        .strictObject({
          scope: appliedScopeSchema.nullable(),
          excluded: z.record(
            z.string(),
            z.strictObject({ by: z.enum(["human", "pea", "unknown"]) }),
          ),
          familyNames: z.array(z.string()).optional(),
          written: z.array(z.string()),
        })
        .optional(),
      sealed: sealedSchema.optional(),
      retire: retirementSchema.nullable().optional(),
      retirePatchNames: z.array(z.string()).nullable().optional(),
      readbackWork: workKeySchema.optional(),
      readbackTakenAt: z.string().nullable().optional(),
    })
    .superRefine((value, ctx) => {
      if (["family.apply", "families.apply", "family.build"].includes(value.nativeKey)) {
        const input = z
          .object({ specJson: z.string(), source: sealedSourceSchema })
          .safeParse(value.input);
        if (!input.success)
          ctx.addIssue({
            code: "custom",
            message: "Prepared native input must retain the exact typed source bytes",
            path: ["input"],
          });
      }
    }),
  z.strictObject({
    kind: z.literal("capture"),
    process: nativeProcessSchema,
    nativeKey: z.string(),
    input: z.unknown(),
    pod: z.string().nullable(),
    path: z.string().nullable(),
    spec: z.string().nullable(),
    at: z.string(),
  }),
]);
type Prepared = z.infer<typeof preparedFamilyLeafSchema> | { kind: "batch"; items: Prepared[] };
const preparedFamilySchema: z.ZodType<Prepared> = z.lazy(() =>
  z.union([
    preparedFamilyLeafSchema,
    z.strictObject({ kind: z.literal("batch"), items: z.array(preparedFamilySchema) }),
  ]),
);

/**
 * An apply where no family succeeded changed nothing (each failure rolls back whole), so it settles `failed` with the
 * receipt's one-sentence reason; one success is a run that changed Revit and settles `succeeded` with per-family receipts.
 * The native response proves dispatch, so the failed receipt retains it as authoritative evidence.
 */
const appliedSomething = (result: unknown) => {
  const applied = result as FamiliesApply.Res.Response;
  if (applied.receipts.some((receipt) => receipt.success)) return;
  if (applied.diagnostics.some((diagnostic) => diagnostic.code === "Cancelled")) return;
  throw new BridgeError(applied.reason ?? "No family was applied", 422, {
    dispatched: true,
    result,
  });
};

export function familyExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
) {
  return Object.fromEntries(
    Object.keys(familyActions).map((name) => [
      name,
      async (ctx: CommandContext) => {
        const { admission } = ctx;
        const key = name as FamilyActionKey;
        if (key === "family.attach-spec") return familySpecExecutor(ctx, deps);
        const definition = commands[key];
        const work = deps.workspace ?? ctx.work ?? actionWorkspace();
        const target = admission.target.kind === "document" ? admission.target.ref : undefined;
        const pods = podContext(deps, bridge, target);
        const base = admission.input.work as WorkHandle | undefined;
        const submittedRoute = definition.work?.route ?? base?.key.route;
        let frozenWork: { doc: unknown; revision: number } | null = null;
        const generatedSources = () => {
          if (!frozenWork) throw refused("Reviewed Work is required");
          if (submittedRoute === "family") {
            const draft = familyDraftRouteState.schema.parse(frozenWork.doc);
            if (!draft.reading) throw refused("Read this family before planning");
            return [
              {
                source: {
                  path: "edit/family.json",
                  content: settingsCandidate(draft.reading, draft.cells),
                },
              },
            ];
          }
          const doc = familiesRouteState.schema.parse(frozenWork.doc);
          const names = [
            ...new Set(
              editedEntries(doc.cells).map(([cell]) => familyCellAddress(cell).familyName),
            ),
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
        const direct =
          [
            "family.apply",
            "family.plan",
            "families.apply",
            "families.plan",
            "families.save-draft",
          ].includes(key) &&
          !("rows" in admission.input) &&
          !("source" in admission.input) &&
          !("plan" in admission.input);
        let directSources: ReturnType<typeof generatedSources> = [];
        const sourceInputs: (PodMemberSource | PodDraftSource)[] = [];
        const collectSources = (value: unknown): void => {
          if (Array.isArray(value)) return value.forEach(collectSources);
          if (value === null || typeof value !== "object") return;
          for (const [key, child] of Object.entries(value)) {
            if (key === "source" && child && typeof child === "object")
              sourceInputs.push(child as PodMemberSource | PodDraftSource);
            else collectSources(child);
          }
        };
        const sources = new Map<string, Awaited<ReturnType<typeof familySpec>>>();
        const submittedSpec = (source: PodMemberSource | PodDraftSource) => {
          const frozen = sources.get(canonicalRouteInput(source));
          if (!frozen) throw refused("Source was not part of the submitted command");
          return structuredClone(frozen);
        };
        let observedMember: PodMemberRead | null = null;
        let evaluatedCapture: FamilyCapture | null = null;
        const captureInput = admission.input as {
          pod?: string;
          path?: string;
          familyIds?: number[];
          member?: PodMember;
        };
        const capturePaths = Object.fromEntries(
          (captureInput.familyIds ?? [0]).map((id) => [
            String(id),
            captureInput.path ?? `captures/${digest(admission.id).slice(0, 24)}-${id}.json`,
          ]),
        );
        const footprint: Footprint =
          definition.effect === "query" || key === "settings.observe"
            ? []
            : [
                ...(target &&
                key !== "family.capture" &&
                key !== "families.capture" &&
                key !== "families.save-draft"
                  ? [{ kind: "document" as const, ref: target }]
                  : []),
                ...(captureInput.member
                  ? [{ kind: "member" as const, ...captureInput.member }]
                  : []),
                ...(captureInput.pod && (key === "family.capture" || key === "families.capture")
                  ? Object.values(capturePaths).map((path) => ({
                      kind: "member" as const,
                      pod: captureInput.pod!,
                      path,
                    }))
                  : []),
              ];
        const consumes: Dependency[] = [];
        let process: NativeProcess | undefined;
        const planId =
          typeof admission.input.plan === "string"
            ? admission.input.plan
            : typeof (admission.input.rows as { plan?: unknown } | undefined)?.plan === "string"
              ? (admission.input.rows as { plan: string }).plan
              : undefined;
        const bind = async () => {
          frozenWork = base ? await ctx.read.work(base, submittedRoute!) : null;
          directSources = direct ? generatedSources() : [];
          collectSources(admission.input);
          directSources.forEach(collectSources);
          for (const source of sourceInputs)
            sources.set(canonicalRouteInput(source), await familySpec(deps, source, pods));
          observedMember =
            key === "settings.observe"
              ? await runPods(deps, readMember(familyInput(key, admission.input).member, pods))
              : null;
          if (key === "families.save-draft")
            footprint.push(
              ...directSources.map(({ source }) => ({
                kind: "member" as const,
                pod: String(admission.input.pod),
                path: source.path,
              })),
            );
          if (base && frozenWork) {
            const doc = frozenWork.doc as Record<string, any>;
            const paths: (string | number)[][] =
              submittedRoute === "pods"
                ? [
                    ["basis"],
                    ...Object.entries(doc.fields ?? {})
                      .filter(([, cell]) => (cell as any).edit)
                      .map(([cell]) => ["fields", cell, "edit"]),
                  ]
                : submittedRoute === "parameter-links"
                  ? [["profile", "edit"]]
                  : [
                      ["reading"],
                      ["takenAt"],
                      ["scope", "edit"],
                      ["excluded"],
                      ["executionOptions"],
                      ["patch", "edit"],
                      ...(doc.patch?.edit
                        ? [["cells"]]
                        : Object.entries(doc.cells ?? {})
                            .filter(([, cell]) => (cell as any).edit)
                            .map(([cell]) => ["cells", cell, "edit"])),
                    ];
            consumes.push({ kind: "work", handle: base, paths, snapshot: frozenWork.doc });
          }
          for (const source of sources.values()) {
            for (const item of [source.source.root, ...(source.source.dependencies ?? [])])
              if ((!("origin" in item) || item.origin === "SavedMember") && item.id)
                consumes.push({
                  kind: "member",
                  pod: item.id,
                  path: item.path,
                  sha256: item.sha256,
                  bytesBase64: item.bytesBase64,
                });
          }
          if (observedMember && captureInput.member)
            consumes.push({
              kind: "member",
              ...captureInput.member,
              sha256: observedMember.sha256,
              bytesBase64: observedMember.bytesBase64,
            });
          process = target
            ? (await lifetime(bridge, target, documentKind(key), deps)).process
            : undefined;
          if (target && process)
            consumes.push({ kind: "incarnation", target: admission.target, process });
          if (key === "parameter-links.apply" && typeof admission.input.readingId === "string") {
            const artifact = await captures.savedFamilyText(admission.input.readingId);
            evaluatedCapture = familyCaptureSchema.parse(JSON.parse(artifact.text));
            if (evaluatedCapture.provenance.kind !== "live" || !evaluatedCapture.provenance.process)
              throw refused("This historical reading has no exact native process; evaluate again");
            consumes.push(
              {
                kind: "file",
                path: artifact.path,
                sha256: digest(artifact.text),
                bytesBase64: Buffer.from(artifact.text).toString("base64"),
              },
              {
                kind: "incarnation",
                target: admission.target,
                process: evaluatedCapture.provenance.process,
              },
              {
                kind: "document-mark",
                ref: evaluatedCapture.provenance.target,
                takenAt: evaluatedCapture.capturedAt,
              },
            );
          }
          const takenAt = (frozenWork?.doc as { takenAt?: string | null } | undefined)?.takenAt;
          if (
            target &&
            takenAt &&
            [
              "family.plan",
              "family.apply",
              "families.plan",
              "families.apply",
              "parameter-links.apply",
            ].includes(key)
          )
            consumes.push({ kind: "document-mark", ref: target, takenAt });
          if (planId)
            consumes.push({
              kind: "receipt",
              id: planId,
              key: key === "family.apply" ? "family.plan" : "families.plan",
            });
          if (planId) {
            const [plan] = ctx.read.receipts(planId);
            for (const dependency of plan?.consumes ?? [])
              if (["work", "incarnation", "document-mark"].includes(dependency.kind))
                consumes.push(
                  dependency.kind === "work" && base ? { ...dependency, handle: base } : dependency,
                );
          }
          if (["family.apply", "families.apply", "family.build"].includes(key)) {
            const roots = new Set([...sources.values()].map((source) => source.source.root.id));
            const plans = planId ? ctx.read.receipts(planId) : [];
            const collectRoots = (prepared: Prepared): void => {
              if (prepared.kind === "batch") prepared.items.forEach(collectRoots);
              else if (prepared.kind === "native" && prepared.sealed)
                roots.add(prepared.sealed.source.root.id);
            };
            for (const plan of plans)
              if (plan.prepared.state === "ready")
                collectRoots(preparedFamilySchema.parse(plan.prepared.value));
            for (const pod of roots)
              footprint.push({ kind: "directory", path: await sourceRunOutput(pod, deps) });
          } else if ((key === "family.capture" || key === "families.capture") && captureInput.pod)
            footprint.push({
              kind: "directory",
              path: await sourceRunOutput(captureInput.pod, deps),
            });
          return {
            consumes,
            effects: footprint,
            claims: planId ? [{ kind: "receipt" as const, id: planId }] : [],
          };
        };
        type NativePrepared = Extract<Prepared, { kind: "native" }>;
        type NativeCall = (
          nativeKey: string,
          input: unknown,
          process: NativeProcess,
        ) => Promise<unknown>;
        const runPlan = async (prepared: NativePrepared, native: NativeCall) => {
          // The scope resolves to names only; name -> current id is the library's, at plan.
          const resolveScope = async (scope: AppliedFilter, process: NativeProcess) => {
            const catalog = (await native(
              "revit.catalog.loaded-families",
              familyCatalogRequest(scope),
              process,
            )) as RevitCatalogLoadedFamilies.Res.Response;
            const problem = familyCatalogProblem(catalog);
            if (problem) throw refused(problem.message);
            return catalog.families;
          };
          const scope = prepared.planned?.scope;
          // The target resolves to family names once, here; the engine plans exactly those names.
          const catalog = scope ? await resolveScope(scope, prepared.process) : undefined;
          // Deduped: a same-name pair reaches the library once and refuses there as ambiguous.
          const resolved = catalog && [...new Set(catalog.map((family) => family.familyName))];
          // A caller naming families narrows the scope; it never widens it.
          const outside =
            prepared.planned?.familyNames?.filter((name) => !resolved?.includes(name)) ?? [];
          if (outside.length)
            throw refused(`Families ${outside.join(", ")} are outside the reviewed scope`);
          const familyNames = prepared.planned?.familyNames ?? resolved;
          const result = await native(
            prepared.nativeKey,
            familyNames ? { ...(prepared.input as object), familyNames } : prepared.input,
            prepared.process,
          );

          const { excluded } = prepared.planned!;
          if (scope) {
            const planned = result as FamiliesPlan.Res.Response;
            if (planned.diagnostics.length)
              throw refused(planned.diagnostics.map(diagnosticLine).join(" Â· "));
            // A cell whose family or type no longer resolves never re-attaches: plan names it.
            const loaded = new Set(
              catalog!.flatMap((family) =>
                family.types.map((type) => JSON.stringify([family.familyName, type.typeName])),
              ),
            );
            return {
              id: admission.id,
              executionContext: target,
              plan: planned.families,
              included: familiesIncluded({ entries: planned.families }, excluded),
              excluded: familiesExcluded({ entries: planned.families }, excluded),
              orphaned: prepared.planned!.written.filter((cell) => {
                const { familyName, typeName } = familyCellAddress(cell);
                return !loaded.has(JSON.stringify([familyName, typeName]));
              }),
            };
          }
          const planned = result as FamilyPlan.Res.Response;
          // One family document plans exactly one family, or it refuses.
          const plan = planned.families[0];
          if (planned.diagnostics.length || planned.families.length !== 1 || plan!.refusals.length)
            throw refused(
              [...planned.diagnostics, ...(plan?.refusals ?? [])]
                .map(diagnosticLine)
                .join(" Â· ") || "Expected one family plan",
            );
          return {
            id: admission.id,
            executionContext: target,
            plan,
            included: { [String(plan!.familyId)]: plan!.planHash },
          };
        };
        const prepare = async (
          key: FamilyActionKey = admission.key as FamilyActionKey,
          commandInput = admission.input,
          adoptedPlan?: {
            key: string;
            state: string;
            target: typeof admission.target;
            prepared: { state: string; value?: unknown };
            result?: unknown;
          },
        ): Promise<Prepared> => {
          if (key === "families.save-draft")
            return {
              kind: "drafts",
              members: directSources.map(({ source }) => ({
                pod: String(commandInput.pod),
                path: source.path,
                content: "content" in source ? source.content : "",
              })),
            };
          if ((key === "family.plan" || key === "families.plan") && !("source" in commandInput)) {
            const items = [];
            for (const source of directSources) items.push(await prepare(key, source));
            return { kind: "batch", items };
          }
          if (key === "settings.observe") {
            const input = familyInput(key, commandInput);
            if (!base || !work || base.key.work !== memberWork(input.member) || !observedMember)
              throw refused("Exact member Work and expected revision are required");
            if (input.sha256 && input.sha256 !== observedMember.sha256)
              throw refused("Saved member changed; read it and adopt the current bytes");
            const document = settingsRouteState.schema.parse(frozenWork?.doc);
            if (
              !input.replaceEdits &&
              Object.values(document.fields).some((cell) => cell.edit || cell.suggestion)
            )
              throw refused(
                "Pending edits retain their original basis; explicitly replace edits to adopt another baseline",
              );
            return {
              kind: "settings-observation",
              basis: {
                member: input.member,
                rawContent: observedMember.content,
                sha256: observedMember.sha256,
              },
            };
          }
          if (key === "family.observe") {
            if (!base || !work)
              throw refused("Family Work address and expected revision are required");
            const input = familyInput(key, commandInput);
            if ("source" in input)
              return {
                kind: "observation",
                reading: rootText(submittedSpec(input.source).source),
                takenAt: null,
              };
            const [capture] = ctx.read.receipts(input.readingId);
            if (
              !capture ||
              capture.key !== "family.capture" ||
              capture.state !== "succeeded" ||
              canonicalRouteInput(capture.target) !== canonicalRouteInput(admission.target)
            )
              throw refused(
                "Baseline must name a succeeded capture for this exact family lifetime",
              );
            const value = capture.result as { spec?: string; capturedAt?: string };
            if (!value.spec || !value.capturedAt)
              throw refused("Capture has no live draft baseline");
            return { kind: "observation", reading: value.spec, takenAt: value.capturedAt };
          }
          if (key === "settings.write") {
            const input = familyInput("settings.write", commandInput);
            if (!base || !work || base.key.work !== memberWork(input.member))
              throw refused("Reviewed member Work is required");
            const view = frozenWork;
            const document = settingsRouteState.schema.parse(view?.doc);
            if (input.write.kind === "create") {
              if (document.basis || Object.keys(document.fields).length)
                throw refused("Create requires empty reviewed Work");
              return {
                kind: "settings",
                document,
                request: { ...input.member, content: input.write.rawContent },
              };
            }
            if (
              !document.basis ||
              canonicalRouteInput(document.basis.member) !== canonicalRouteInput(input.member) ||
              document.basis.sha256 !== input.write.sha256
            )
              throw refused("The original member basis changed");
            return {
              kind: "settings",
              document,
              request: {
                ...input.member,
                content: settingsCandidate(document.basis.rawContent, document.fields),
                expectedSha256: input.write.sha256,
              },
            };
          }
          if (!process) throw refused("Native process is unavailable");
          if (key === "family.capture" || key === "families.capture") {
            const input = commandInput as {
              pod?: string;
              path?: string;
              spec?: string;
              familyIds?: number[];
            };
            if (input.pod) await runPods(deps, podFolder(input.pod, pods));
            return {
              kind: "capture",
              process,
              nativeKey: key,
              input: key === "families.capture" ? { familyIds: input.familyIds } : {},
              pod: input.pod ?? null,
              path: input.path ?? null,
              spec: input.spec ?? null,
              at: new Date().toISOString(),
            };
          }
          if (key === "family.plan") {
            const input = familyInput(key, commandInput);
            if (!input.source) throw refused("Family plan source was not composed");
            const { specJson, source } = submittedSpec(input.source);
            // With a reviewed draft, the plan consumes its staged cells only if the captured bytes ARE that draft.
            let consumed: Retirement | null = null;
            let takenAt: string | null = null;
            if (base) {
              const view = frozenWork;
              if (!view) throw refused("Reviewed Family Work is required");
              const draft = familyDraftRouteState.schema.parse(view.doc);
              takenAt = draft.takenAt;
              const staged = editedEntries(draft.cells).map(([cell]) => cell);
              if (
                draft.reading !== null &&
                staged.length &&
                unstamped(settingsCandidate(draft.reading, draft.cells)) ===
                  unstamped(rootText(source))
              )
                consumed = { key: base.key, route: "family", cells: staged };
            }
            return {
              kind: "native",
              process,
              nativeKey: "family.plan",
              input: { specJson },
              planned: { scope: null, excluded: {}, written: [] },
              sealed: { specJson, source, consumed, ...(consumed && { takenAt }) },
            };
          }
          if (key === "family.apply" || key === "families.apply") {
            const authored = familyInput(key, commandInput);
            let rows = authored.rows;
            if (!rows) {
              if (authored.plan) {
                const [plan] = ctx.read.receipts(authored.plan);
                if (plan?.state !== "succeeded")
                  throw refused("Apply requires its succeeded preview");
                const result = plan.result as {
                  included: Record<string, string>;
                  plan: FfPlanEntry[];
                };
                rows = {
                  plan: authored.plan,
                  expectedPlanHashes: Object.fromEntries(
                    Object.entries(result.included).filter(
                      ([id]) =>
                        authored.include === "all" ||
                        authored.include.includes(id) ||
                        result.plan.some(
                          (entry) =>
                            String(entry.familyId) === id &&
                            authored.include.includes(entry.familyName),
                        ),
                    ),
                  ),
                };
              } else rows = { sources: directSources, include: authored.include };
            }
            if ("sources" in rows) {
              return {
                kind: "batch",
                items: await Promise.all(
                  rows.sources.map((source) =>
                    prepare(key, {
                      rows: { ...source, include: rows.include },
                      familyNames: authored.familyNames,
                      executionOptions: authored.executionOptions,
                    }),
                  ),
                ),
              };
            }
            const planKey = key === "family.apply" ? "family.plan" : "families.plan";
            let plan:
              | {
                  key: string;
                  state: string;
                  target: typeof admission.target;
                  prepared: { state: string; value?: unknown };
                  result?: unknown;
                }
              | undefined;
            let input: { plan: string; expectedPlanHashes: Record<string, string> };
            if ("source" in rows) {
              const preparedPlan = await prepare(planKey, {
                source: rows.source,
                familyNames: rows.familyNames ?? authored.familyNames,
                executionOptions: rows.executionOptions ?? authored.executionOptions,
              });
              if (preparedPlan.kind !== "native" || !preparedPlan.planned)
                throw refused("Planning did not produce a native plan");
              const result = await runPlan(preparedPlan, async (op, input, process) => {
                await current(bridge, target!, documentKind(planKey), process);
                return invoke(
                  bridge,
                  target!,
                  op,
                  input,
                  `${admission.id}:prepare:${digest(canonicalRouteInput(input)).slice(0, 16)}`,
                );
              });
              const included = result.included;
              const entries = [result.plan].flat() as FfPlanEntry[];
              const selected =
                rows.include === "all"
                  ? included
                  : Object.fromEntries(
                      Object.entries(included).filter(
                        ([id]) =>
                          rows.include.includes(id) ||
                          entries.some(
                            (entry) =>
                              String(entry.familyId) === id &&
                              rows.include.includes(entry.familyName),
                          ),
                      ),
                    );
              input = { plan: `${admission.id}:prepared`, expectedPlanHashes: selected };
              plan = {
                key: planKey,
                state: "succeeded",
                target: admission.target,
                prepared: { state: "ready", value: preparedPlan },
                result,
              };
            } else {
              input = rows;
              [plan] = adoptedPlan ? [adoptedPlan] : ctx.read.receipts(input.plan);
            }
            if (!Object.keys(input.expectedPlanHashes).length)
              throw refused("No included family has changes to apply");
            const planPrepared =
              plan?.prepared.state === "ready"
                ? preparedFamilySchema.parse(plan.prepared.value)
                : null;
            if (planPrepared?.kind === "batch") {
              const results = (plan!.result as { results: unknown[] }).results;
              const items = [];
              for (const [index, item] of planPrepared.items.entries()) {
                const result = results[index] as { included: Record<string, string> };
                const subset = Object.fromEntries(
                  Object.entries(input.expectedPlanHashes).filter(([id]) =>
                    Object.hasOwn(result.included, id),
                  ),
                );
                if (!Object.keys(subset).length) continue;
                items.push(
                  await prepare(
                    key,
                    { rows: { plan: input.plan, expectedPlanHashes: subset } },
                    { ...plan!, prepared: { state: "ready", value: item }, result },
                  ),
                );
              }
              if (!items.length) throw refused("No included family has changes to apply");
              return { kind: "batch", items };
            }
            const sealed =
              plan?.prepared.state === "ready"
                ? (planPrepared as { sealed?: Sealed }).sealed
                : undefined;
            if (!plan || plan.key !== planKey || plan.state !== "succeeded" || !sealed)
              throw refused(`Apply must name a succeeded ${planKey} action`);
            if (canonicalRouteInput(plan.target) !== canonicalRouteInput(admission.target))
              throw refused("The plan was made for a different document");
            const consumed = sealed.consumed;
            if (consumed?.route === "families") {
              const document = frozenWork?.doc as
                | { cells?: Record<string, { edit?: unknown }>; patch?: { edit?: unknown } }
                | undefined;
              if (
                (consumed.patch &&
                  Object.values(document?.cells ?? {}).some((cell) => cell.edit != null)) ||
                (consumed.cells.length && document?.patch?.edit != null)
              )
                throw refused(
                  "Stage either a native Family Foundry patch or per-type cells, not both",
                );
            }
            const included = (plan.result as { included: Record<string, string> }).included;
            const stray = Object.keys(input.expectedPlanHashes).filter(
              (id) => included[id] !== input.expectedPlanHashes[id],
            );
            if (stray.length)
              throw refused(`Families ${stray.join(", ")} are not in the reviewed plan as sent`);
            const patchEntries =
              key === "families.apply" && sealed.consumed?.patch
                ? (plan.result as { plan: FfPlanEntry[] }).plan
                : null;
            const patchTargets = patchEntries?.flatMap((entry) =>
              entry.changes.length + entry.runEffects.length ? [entry] : [],
            );
            const retirePatchNames = patchEntries
              ? patchEntries.every((entry) => entry.refusals.length === 0) &&
                patchTargets!.every(
                  (entry) =>
                    entry.familyId != null &&
                    Object.hasOwn(input.expectedPlanHashes, String(entry.familyId)),
                )
                ? patchTargets!.map((entry) => entry.familyName)
                : null
              : undefined;
            const readbackBase =
              key === "families.apply" && !sealed.consumed && base && work ? frozenWork : null;
            const readbackDocument = readbackBase
              ? familiesRouteState.schema.parse(readbackBase.doc)
              : null;
            return {
              kind: "native",
              process,
              nativeKey: key,
              input: {
                plan: input.plan,
                specJson: sealed.specJson,
                expectedPlanHashes: input.expectedPlanHashes,
                // The library re-resolves each planned name and refuses one reloaded since the plan.
                ...(key === "families.apply"
                  ? {
                      familyNames: Object.fromEntries(
                        (plan.result as { plan: FfPlanEntry[] }).plan.flatMap((entry) =>
                          entry.familyId != null &&
                          Object.hasOwn(input.expectedPlanHashes, entry.familyId)
                            ? [[String(entry.familyId), entry.familyName]]
                            : [],
                        ),
                      ),
                    }
                  : {}),
                source: sealed.source,
                ...(sealed.executionOptions ? { executionOptions: sealed.executionOptions } : {}),
              },
              retire: sealed.consumed,
              retirePatchNames,
              ...(key === "families.apply" && (sealed.consumed || readbackDocument)
                ? {
                    readbackWork: sealed.consumed?.key ?? base!.key,
                    readbackTakenAt: sealed.consumed ? sealed.takenAt : readbackDocument?.takenAt,
                  }
                : {}),
            };
          }
          if (key === "families.plan") {
            const input = familyInput(key, commandInput);
            if (!input.source) throw refused("Families plan source was not composed");
            // The scope is authored Work; the plan is a result and never lands there.
            const view = frozenWork;
            if (!view) throw refused("Reviewed Families Work is required");
            const doc = familiesRouteState.schema.parse(view.doc);
            const scope = stagedFilter(doc);
            if (!scope) throw refused("Stage a scope before planning");
            const hasCells = editedEntries(doc.cells).length > 0;
            if (doc.patch.edit && hasCells)
              throw refused(
                "Stage either a native Family Foundry patch or per-type cells, not both",
              );
            if (
              doc.patch.edit &&
              canonicalRouteInput(input.source) !== canonicalRouteInput(doc.patch.edit.value)
            )
              throw refused("Plan the exact native patch source staged in Families Work");
            const { specJson, source } = submittedSpec(input.source);
            // A generated draft plans one family; it consumes that family's staged cells only if the
            // captured bytes are exactly what those cells generate.
            const generated =
              input.familyNames?.length === 1
                ? familyStagedPatch(doc.cells, input.familyNames[0]!)
                : null;
            const consumedCells =
              generated && canonicalRouteInput(generated.spec) === unstamped(rootText(source))
                ? { key: base!.key, route: "families" as const, cells: generated.keys }
                : null;
            const consumed: Retirement | null = doc.patch.edit
              ? { key: base!.key, route: "families", cells: [], patch: true }
              : consumedCells;
            if (consumed) {
              const observed = await captures.latestFamilies(base!.key);
              if (
                !observed ||
                observed.capturedAt !== doc.takenAt ||
                observed.document.session !== target!.session ||
                observed.document.openId !== target!.openId
              )
                throw refused("Read these staged families in this exact document before planning");
            }
            return {
              kind: "native",
              process,
              nativeKey: "families.plan",
              input: {
                specJson,
                ...(input.executionOptions ? { executionOptions: input.executionOptions } : {}),
              },
              sealed: {
                specJson,
                source,
                ...(input.executionOptions ? { executionOptions: input.executionOptions } : {}),
                consumed,
                ...(consumed && { takenAt: doc.takenAt }),
              },
              planned: {
                scope,
                excluded: doc.excluded,
                ...(input.familyNames ? { familyNames: input.familyNames } : {}),
                written: Object.keys(doc.cells).filter(
                  (cell) => doc.cells[cell]!.suggestion != null || doc.cells[cell]!.edit != null,
                ),
              },
            };
          }
          if (key === "parameter-links.apply") {
            if (!base || !work) throw refused("Reviewed Work is required");
            const view = frozenWork;
            if (!view) throw refused("Reviewed Work is required");
            const input = familyInput("parameter-links.apply", commandInput);
            const document = parameterLinksRouteState.schema.parse(view.doc);
            // Apply reconciles the person's staged profile only; a Pea proposal never arms it.
            const staged = stagedParameterProfile(document);
            if (!staged) throw refused("Stage a profile before applying");
            if (!input.readingId) {
              const data = await invoke(
                bridge,
                target!,
                "revit.apply.parameter-links",
                { profile: staged, previewOnly: true, reconcile: false },
                `${admission.id}:evaluate`,
              );
              const evaluation = (data as { evaluation?: { issues?: { severity?: string }[] } })
                .evaluation;
              if (
                !evaluation ||
                evaluation.issues?.some((issue) => issue.severity?.toLowerCase() === "error")
              )
                throw refused("Parameter link evaluation refused the submitted edits");
              return {
                kind: "native",
                process,
                nativeKey: "revit.apply.parameter-links",
                input: { profile: staged, previewOnly: false, reconcile: true },
              };
            }
            const capture = evaluatedCapture!;
            if (
              capture.reading.kind !== "parameter-links" ||
              capture.provenance.kind !== "live" ||
              canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(target)
            )
              throw refused(
                "The reviewed evaluation is not live evidence for the selected lifetime",
              );
            const evaluated = parameterLinksReadingSchema.parse(capture.reading.value);
            if (!evaluated.evaluated || !evaluated.evaluation)
              throw refused(
                "The reviewed reading is a stored-profile read, not a staged evaluation",
              );
            if (evaluated.subject === "suggestion")
              throw refused(
                "The reviewed reading is a proposal preview; stage the profile and preview again",
              );
            if (evaluated.basis !== parameterLinksBasis(document))
              throw refused("The staged profile changed after the evaluation; preview again");
            return {
              kind: "native",
              process,
              nativeKey: "revit.apply.parameter-links",
              input: { profile: staged, previewOnly: false, reconcile: true },
            };
          }
          const input = familyInput("family.build", commandInput);
          const { specJson, source } = submittedSpec(input.source);
          const file = win32.join(
            await runPods(deps, podFolder(input.source.pod, pods)),
            input.source.path,
          );
          return {
            kind: "native",
            process,
            nativeKey: "family.build",
            input: {
              specJson,
              source,
              // No output path: family.build lands the .rfa in its own run folder in the source pod.
              ...(deps.nativePaths
                ? await deps.nativePaths(input, admission.id, file)
                : { modelDirectory: resolve(input.modelDirectory ?? win32.dirname(file)) }),
            },
          };
        };
        const executePrepared = async (
          execution: import("./action-journal.ts").ActionExecution,
          prepared: Prepared,
        ): Promise<unknown> => {
          if (prepared.kind === "drafts") {
            const members = [];
            for (const member of prepared.members)
              members.push(
                await execution.step("file", "pod.member.write", member, () =>
                  writeMemberOnce(deps, member, pods),
                ),
              );
            return { saved: members.length, members };
          }
          if (prepared.kind === "settings-observation") {
            if (!base || !work) throw refused("Member Work is unavailable");
            await execution.publishWork(base.key, "pods", [
              { path: ["basis"], value: prepared.basis },
              { path: ["fields"], value: {} },
            ]);
            return { envelope: await work.read(base.key, "pods") };
          }
          if (prepared.kind === "observation") {
            if (!base || !work) throw refused("Family Work is unavailable");
            await execution.publishWork(base.key, "family", [
              { path: ["reading"], value: prepared.reading },
              { path: ["takenAt"], value: prepared.takenAt },
            ]);
            return { envelope: await work.read(base.key, "family") };
          }
          if (prepared.kind === "batch") {
            const results = [];
            for (const item of prepared.items) results.push(await executePrepared(execution, item));
            if (key === "family.plan" || key === "families.plan") {
              const plans = results as {
                plan: FfPlanEntry | FfPlanEntry[];
                included: Record<string, string>;
                excluded?: unknown[];
                orphaned?: string[];
              }[];
              return {
                id: admission.id,
                executionContext: target,
                results,
                plan: plans.flatMap((result) => result.plan),
                included: Object.assign({}, ...plans.map((result) => result.included)),
                excluded: plans.flatMap((result) => result.excluded ?? []),
                orphaned: plans.flatMap((result) => result.orphaned ?? []),
              };
            }
            return { results };
          }
          const native = async (nativeKey: string, input: unknown, process: NativeProcess) => {
            const recorded = execution.recorded("native", nativeKey);
            const result = await execution.step(
              "native",
              nativeKey,
              input,
              async (id) => {
                const result = await invoke(bridge, target!, nativeKey, input, id);
                if (nativeKey === "family.apply" || nativeKey === "families.apply")
                  appliedSomething(result);
                return result;
              },
              process,
              () =>
                nativeKey === "family.apply" ||
                nativeKey === "families.apply" ||
                nativeKey === "revit.apply.parameter-links"
                  ? [{ kind: "document-mark", ref: target!, takenAt: new Date().toISOString() }]
                  : [],
            );
            if (
              recorded?.state === "succeeded" &&
              (nativeKey === "family.apply" || nativeKey === "families.apply")
            )
              appliedSomething(result);
            return result;
          };
          if (prepared.kind === "capture") {
            const captured = await native(prepared.nativeKey, prepared.input, prepared.process);
            const at = new Date(prepared.at);
            const specs =
              prepared.nativeKey === "families.capture"
                ? (captured as FamiliesCapture.Res.Response).families.flatMap((f) =>
                    f.success && f.modelJson
                      ? [
                          {
                            familyId: f.familyId,
                            ...familyMember(f.modelJson),
                            path: capturePaths[String(f.familyId)]!,
                          },
                        ]
                      : [],
                  )
                : [
                    {
                      familyId: 0,
                      ...familyMember((captured as NativeFamilyCapture.Res.Response).modelJson),
                      // Saving a draft files the draft's text; the run still holds what Revit said.
                      ...(prepared.spec ? { content: draftContent(prepared.spec) } : {}),
                      path: capturePaths["0"]!,
                    },
                  ];
            // No pod: the live read the audit drafts from. Nothing is filed.
            if (!prepared.pod)
              return {
                id: admission.id,
                executionContext: target,
                spec: specs[0]!.content,
                // Host clock, stamped before the native read: the Work's `takenAt` rests on it.
                capturedAt: prepared.at,
                evidence: { ...(captured as object), origin: "capture", rfaPath: null, run: null },
              };
            const pod = prepared.pod;
            const members: PodMemberWritten[] = [];
            // Each captured member gets its own run, so `/pods` lists it against that member like any
            // other run; the run holds the unmodeled facts the member cannot carry.
            const runs = new Map<number, string>();
            for (const { familyId, content, unmodeled, path } of specs) {
              const request = { pod, path, content };
              const written = (await execution.step("file", "pod.member.write", request, () =>
                writeMemberOnce(deps, request, pods),
              )) as PodMemberWritten;
              members.push(written);
              runs.set(
                familyId,
                await writeCaptureRun(deps, pods, prepared.at, written, prepared.nativeKey, {
                  "unmodeled.json": `${JSON.stringify(unmodeled, null, 2)}
`,
                }),
              );
            }
            // The captured members plus what the capture saw: coverage and the unmodeled ledger, which
            // is a file in the run the panel can still read after a reload.
            if (prepared.nativeKey === "families.capture") {
              const { families, diagnostics } = captured as FamiliesCapture.Res.Response;
              return {
                executionContext: target,
                members,
                evidence: familiesCaptureEvidenceSchema.parse({
                  diagnostics,
                  families: families.map(({ modelJson: _, ...family }) => ({
                    ...family,
                    run: runs.get(family.familyId) ?? null,
                  })),
                }),
              };
            }
            return {
              executionContext: target,
              member: members[0],
              evidence: {
                ...(captured as object),
                origin: "capture",
                rfaPath: null,
                run: runs.get(0) ?? null,
              },
            };
          }
          if (prepared.kind === "native") {
            if (prepared.planned) return runPlan(prepared, native);
            const result = await native(prepared.nativeKey, prepared.input, prepared.process);
            const consumed = prepared.retire;
            const readback = async () => {
              if (key !== "families.apply") return {};
              const names = [
                ...new Set(
                  (result as FamiliesApply.Res.Response).receipts.flatMap((receipt) =>
                    receipt.success ? [receipt.familyName] : [],
                  ),
                ),
              ];
              if (!names.length) return {};
              try {
                if (!prepared.readbackWork)
                  throw Error("No reviewed Families reading is available for this apply");
                const source = await captures.latestFamilies(prepared.readbackWork);
                if (
                  !source ||
                  source.capturedAt !== prepared.readbackTakenAt ||
                  source.document.session !== target!.session ||
                  source.document.openId !== target!.openId
                )
                  throw Error(
                    "The reviewed Families reading is no longer the latest saved reading",
                  );
                await current(bridge, target!, "project", prepared.process);
                const at = new Date().toISOString();
                const observed = (await invoke(bridge, target!, "revit.matrix.loaded-families", {
                  filter: {
                    categoryNames: source.filter.categoryNames,
                    familyNames: names,
                    placementScope: "AllLoaded",
                  },
                  budget: { maxEntries: names.length, maxSamplesPerEntry: 1000 },
                  includeTempPlacement: true,
                })) as RevitMatrixLoadedFamilies.Res.Response;
                const saved = await captures.saveFamiliesReadback(
                  source.id,
                  target!,
                  names,
                  at,
                  observed,
                );
                return { readback: { id: saved.id } };
              } catch (error) {
                // The native apply receipt and consumed-cell retirement remain successful evidence.
                return {
                  readbackError: `Families applied, but their loaded-project values could not be verified: ${error instanceof Error ? error.message : String(error)}`,
                };
              }
            };
            if (consumed) {
              // By name: the apply reloaded the family, so its element id is already a new one.
              const succeeded = new Set(
                (result as FamiliesApply.Res.Response).receipts.flatMap((receipt) =>
                  receipt.success ? [receipt.familyName] : [],
                ),
              );
              const converged = new Set(
                (result as FamiliesApply.Res.Response).receipts.flatMap((receipt) =>
                  receipt.success && receipt.converged ? [receipt.familyName] : [],
                ),
              );
              const patchConverged =
                prepared.retirePatchNames?.every((name) => converged.has(name)) ?? false;
              // A family document applies its one family; Families retires per proven family only.
              const paths = consumed.cells
                .filter(
                  (cell) =>
                    consumed.route === "family" ||
                    succeeded.has(familyCellAddress(cell).familyName),
                )
                .map((cell) => ["cells", cell]);
              if (consumed.patch && patchConverged) paths.push(["patch"]);
              const retired = await execution.retireWork(consumed.key, consumed.route, paths);
              return { executionContext: target, native: result, retired, ...(await readback()) };
            }
            return {
              executionContext: target,
              native: result,
              ...(await readback()),
              ...(key === "family.build"
                ? { outputPath: (result as { outputPath?: string }).outputPath }
                : {}),
            };
          }
          const writer =
            "expectedSha256" in prepared.request ? "pod.member.save" : "pod.member.write";
          const written = (await execution.step(
            "file",
            writer,
            prepared.request,
            () => writeMemberOnce(deps, prepared.request, pods),
            undefined,
            (written) => [
              { kind: "member", pod: written.pod, path: written.path, sha256: written.sha256 },
            ],
          )) as PodMemberWritten;
          const writtenBase = base!;
          if (!work)
            throw new ActionIncomplete("Member write succeeded; Work unavailable", written);
          const member: PodMember = { pod: written.pod, path: written.path };
          const retired = await execution.retireWork(
            writtenBase.key,
            settingsRouteState.route,
            Object.entries(prepared.document.fields).flatMap(([key, cell]) =>
              cell.edit ? [["fields", key]] : [],
            ),
          );
          const publication = await execution.publishWork(
            writtenBase.key,
            settingsRouteState.route,
            [
              {
                path: ["basis"],
                value: { member, rawContent: prepared.request.content, sha256: written.sha256 },
              },
            ],
          );
          return { file: written, publication, retired };
        };
        return {
          definition,
          prepared: preparedFamilySchema,
          bind,
          prepare: () => prepare(),
          run: (_ctx: CommandContext, execution: import("./action-journal.ts").ActionExecution) =>
            executePrepared(execution, execution.prepared as Prepared),
          recover: (step: import("@pe/agent-contracts").ActionStep, prepared: unknown) =>
            recoverFamilyStep(step, prepared, admission.target, deps),
        };
      },
    ]),
  ) as Record<string, CommandFactory>;
}

async function recoverFamilyStep(
  step: import("@pe/agent-contracts").ActionStep,
  raw: unknown,
  target: import("@pe/agent-contracts").ExecutionTarget,
  deps: FamilyActionDependencies,
) {
  const whole = raw as Prepared;
  const prepared =
    whole.kind === "batch"
      ? whole.items.find(
          (item) =>
            item.kind === "native" &&
            canonicalRouteInput(item.input) === canonicalRouteInput(step.input),
        )
      : whole;
  if (!prepared || !("process" in prepared))
    throw refused("No prepared native source matches this step");
  const process = prepared.process;
  if (step.key !== "families.apply") return readNativeReceipt(step, process, deps.sdk);
  if (step.state === "succeeded" && isFamiliesApplyResponse(step.result))
    return { step, evidence: { recordedNativeOutcome: true } };
  const sdk = await readNativeReceipt(step, process, deps.sdk).catch((error: unknown) => ({
    step,
    evidence: { error: String(error) },
  }));
  if (sdk.step.state === "succeeded" && isFamiliesApplyResponse(sdk.step.result)) return sdk;
  const unknown = {
    id: step.id,
    key: step.key,
    kind: step.kind,
    input: step.input,
    state: "unknown" as const,
    error:
      "The SDK response does not prove the Families apply outcome; inspect its exact native run",
    status: 503,
  };
  if (sdk.step.state === "failed" || sdk.step.state === "cancelled")
    return { step: unknown, evidence: { sdk: sdk.evidence, conflict: sdk.step } };
  try {
    const input = (prepared as { input?: { source?: { root?: { id?: string | null } } } }).input;
    const root = await sourceRunOutput(input?.source?.root?.id, deps);
    const selected = target;
    const run =
      selected.kind === "document"
        ? await familiesApplyRun(root, step, prepared, selected.ref.openId)
        : null;
    return run
      ? {
          step: {
            id: step.id,
            key: step.key,
            kind: step.kind,
            input: step.input,
            state: "succeeded" as const,
            result: run.result,
          },
          evidence: { sdk: sdk.evidence, nativeRun: run.evidence },
        }
      : { step: unknown, evidence: { sdk: sdk.evidence, nativeRun: "missing or ambiguous" } };
  } catch (error) {
    return { step: unknown, evidence: { sdk: sdk.evidence, nativeRun: String(error) } };
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
