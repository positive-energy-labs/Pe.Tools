import { resolveSdkSession } from "./sdk-session.ts";
import { createHash } from "node:crypto";
import { join, resolve, win32 } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  actionAdmissionSchema,
  familyActions,
  familyReads,
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
  sameValue,
  editedEntries,
  transitionPatches,
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
  type Rung,
  type Footprint,
  type WorkKey,
  familyCatalogProblem,
  familyCatalogRequest,
  stagedFilter,
  refusalText,
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
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { ActionIncomplete, type ActionJournal, type Crossing } from "./action-journal.ts";
import { requireEligibleCaller } from "./gateway-actions.ts";
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

const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

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
    if (error instanceof LocalOpError && error.statusCode === 409) throw refused(error.message);
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
  return { specJson: spec, source: { root: source, dependencies } };
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

/** The document each workflow runs against: a family, any document (build), or a project. */
const documentKind = (key: FamilyActionKey): boolean | "project" =>
  key === "family.capture" || key === "family.plan" || key === "family.apply"
    ? true
    : key === "family.build"
      ? false
      : "project";

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
async function invoke(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  key: string,
  input: unknown,
  requestId?: string,
) {
  const result = await Effect.runPromise(
    Effect.result(bridge.invoke(key, input, target.session, target.openId, requestId)),
  );
  if (result._tag === "Failure") throw result.failure;
  return result.success.value;
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

/** The staged cells a plan provably consumed, at the Work revision the plan was bound to. */
type Consumed = {
  key: WorkKey;
  route: "family" | "families";
  cells: Record<string, Rung>;
  /** The single native patch rung, separate from canonical per-type cell addresses. */
  patch?: Rung;
};
type Sealed = {
  specJson: string;
  source: { root: { bytesBase64: string } };
  executionOptions?: unknown;
  /** Null: no Work basis, or a member the staged cells do not generate. It retires nothing. */
  consumed: Consumed | null;
  /** When the Reading the consumed rungs rest on was taken; sealed only beside a consumed. */
  takenAt?: string | null;
};

/** A member's JSON as authored, ignoring the `$schema` URL its writer stamps. */
const unstamped = (json: string) => {
  const { $schema: _, ...rest } = JSON.parse(json.replace(/^\uFEFF/, "")) as { $schema?: unknown };
  return canonicalRouteInput(rest);
};
const rootText = (source: Sealed["source"]) =>
  Buffer.from(source.root.bytesBase64, "base64").toString("utf8");
const consumedOf = (
  key: WorkKey,
  route: Consumed["route"],
  cells: Record<string, { edit?: Rung | null }>,
  keys: string[],
): Consumed => ({
  key,
  route,
  cells: Object.fromEntries(keys.map((cell) => [cell, cells[cell]!.edit!])),
});

const workRoute = (consumed: Consumed) =>
  consumed.route === "family" ? familyDraftRouteState.route : familiesRouteState.route;

type Prepared =
  | {
      kind: "settings-observation";
      basis: { member: PodMember; rawContent: string; sha256: string };
    }
  | { kind: "observation"; reading: string; takenAt: string | null }
  | { kind: "batch"; items: Prepared[] }
  | {
      kind: "settings";
      document: SettingsRouteDocument;
      request: PodMemberWriteRequest | PodMemberSaveRequest;
    }
  | {
      kind: "native";
      process: NativeProcess;
      nativeKey: string;
      input: unknown;
      /**
       * A plan request reads, returns, and mutates nothing; apply confirms it. A `scope` resolves to
       * family NAMES before the native plan, which resolves each name to its current id; null is one
       * family document, which plans exactly one family.
       */
      planned?: {
        scope: AppliedFilter | null;
        excluded: FamilyExclusions;
        /** A subset of the scope the caller names (one generated member's family); absent = all. */
        familyNames?: readonly string[];
        /** The Work's cell keys holding a proposal or staged value, checked for orphans at plan. */
        written: readonly string[];
      };
      /** A plan seals everything its apply consumes; apply never re-reads the member or Work. */
      sealed?: Sealed;
      /** An apply retires these staged cells after proven native success, if still unchanged. */
      retire?: Consumed | null;
      /** Full patch retires only when every actionable, unheld planned family succeeded. */
      retirePatchNames?: readonly string[] | null;
      /** A Families Work reading to update after apply, if this route supplied one. */
      readbackWork?: WorkKey;
      readbackTakenAt?: string | null;
    }
  | {
      kind: "capture";
      process: NativeProcess;
      nativeKey: string;
      input: unknown;
      /** Null: a live read that files nothing. */
      pod: string | null;
      path: string | null;
      /** The draft's text to file instead of what Revit said. */
      spec: string | null;
      at: string;
    };

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

export async function admitFamilyAction(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (!Object.hasOwn(familyActions, admission.key)) throw refused("Unknown family/file action");
  const key = admission.key as FamilyActionKey;
  if (resume && key === "families.apply") {
    const original = (await owner.list(undefined, admission.id))[0];
    const native = original?.steps.find((step) => step.kind === "native" && step.key === key);
    if (native?.state === "succeeded" && !isFamiliesApplyResponse(native.result))
      throw refused("Recover the interrupted Families apply from its native run before resuming");
  }
  const definition = familyActions[key];
  requireEligibleCaller({ key }, crossing.caller, "/actions");
  admission.input = definition.input.parse(admission.input);
  if (
    (key === "settings.write" || key === "settings.observe") !==
    (admission.destination.kind === "host")
  )
    throw refused("Wrong action destination");
  if (
    key !== "settings.write" &&
    key !== "settings.observe" &&
    admission.destination.kind !== "document"
  )
    throw refused("An exact execution DocumentRef is required");
  const target = admission.destination.kind === "document" ? admission.destination.ref : undefined;
  if (!resume && (await owner.list(undefined, admission.id)).length)
    return owner.admit(
      { ...admission, ...crossing },
      async () => null,
      async () => null,
    );
  const work = deps.workspace ?? actionWorkspace();
  const pods = podContext(deps, bridge, target);
  const base = admission.bases.work;
  const submittedRoute =
    key === "parameter-links.apply"
      ? "parameter-links"
      : key.startsWith("settings.")
        ? "pods"
        : key.startsWith("families.")
          ? "families"
          : "family";
  const frozenWork = base && work ? await work.view(base.key, submittedRoute) : null;
  if (!resume && base && (!frozenWork || frozenWork.revision !== base.revision))
    return owner.admit(
      { ...admission, ...crossing, footprint: [] },
      async () => {
        throw refused("Work changed before submission; read it and submit a new command");
      },
      async () => null,
    );
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
  collectSources(admission.input);
  const sources = new Map<string, Awaited<ReturnType<typeof familySpec>>>();
  for (const source of resume ? [] : sourceInputs)
    sources.set(canonicalRouteInput(source), await familySpec(deps, source, pods));
  const submittedSpec = (source: PodMemberSource | PodDraftSource) => {
    const frozen = sources.get(canonicalRouteInput(source));
    if (!frozen) throw refused("Source was not part of the submitted command");
    return structuredClone(frozen);
  };
  const observedMember =
    key === "settings.observe"
      ? await runPods(
          deps,
          readMember(familyActions[key].input.parse(admission.input).member, pods),
        )
      : null;
  const captureInput = admission.input as {
    pod?: string;
    path?: string;
    familyIds?: number[];
    member?: PodMember;
    outputPath?: string;
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
          ...(target && key !== "family.capture" && key !== "families.capture"
            ? [{ kind: "document" as const, ref: target }]
            : []),
          ...(captureInput.member ? [{ kind: "member" as const, ...captureInput.member }] : []),
          ...(captureInput.pod
            ? Object.values(capturePaths).map((path) => ({
                kind: "member" as const,
                pod: captureInput.pod!,
                path,
              }))
            : []),
          ...(captureInput.outputPath
            ? [{ kind: "file" as const, path: captureInput.outputPath }]
            : []),
        ];
  const validateWork = async (consumed?: Consumed | null) => {
    if (!consumed || !work) return;
    const latest = await work.read(consumed.key, workRoute(consumed));
    const document = latest?.doc as
      | { cells?: Record<string, { edit?: Rung | null }>; patch?: { edit?: Rung | null } }
      | undefined;
    if (
      Object.entries(consumed.cells).some(
        ([key, rung]) => !sameValue(document?.cells?.[key]?.edit, rung),
      ) ||
      (consumed.patch && !sameValue(document?.patch?.edit, consumed.patch))
    )
      throw refused("Consumed edits changed before native dispatch; submit a new command");
  };
  let validateEffect: () => Promise<void> = async () => {};
  const validate = async () => {
    await crossing.validate?.();
    await validateEffect();
  };
  type NativePrepared = Extract<Prepared, { kind: "native" }>;
  type NativeCall = (nativeKey: string, input: unknown, process: NativeProcess) => Promise<unknown>;
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
        throw refused(planned.diagnostics.map(diagnosticLine).join(" · "));
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
        [...planned.diagnostics, ...(plan?.refusals ?? [])].map(diagnosticLine).join(" · ") ||
          "Expected one family plan",
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
  ): Promise<Prepared> => {
    if (base && work && (await work.view(base.key, submittedRoute))?.revision !== base.revision)
      throw refused("Submitted Work changed while waiting; submit a new command");
    if (key === "settings.observe") {
      const input = familyActions[key].input.parse(commandInput);
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
      if (!base || !work) throw refused("Family Work address and expected revision are required");
      const input = familyActions[key].input.parse(commandInput);
      if ("source" in input)
        return {
          kind: "observation",
          reading: rootText(submittedSpec(input.source).source),
          takenAt: null,
        };
      const [capture] = await owner.list(undefined, input.readingId);
      if (
        !capture ||
        capture.key !== "family.capture" ||
        capture.state !== "succeeded" ||
        canonicalRouteInput(capture.destination) !== canonicalRouteInput(admission.destination)
      )
        throw refused("Baseline must name a succeeded capture for this exact family lifetime");
      const value = capture.result as { spec?: string; capturedAt?: string };
      if (!value.spec || !value.capturedAt) throw refused("Capture has no live draft baseline");
      return { kind: "observation", reading: value.spec, takenAt: value.capturedAt };
    }
    if (key === "settings.write") {
      const input = familyActions["settings.write"].input.parse(commandInput);
      const base = admission.bases.work;
      if (!base || !work || base.key.work !== memberWork(input.member))
        throw refused("Reviewed member Work is required");
      const view = await work.read(base.key, settingsRouteState.route);
      if (!view || view.revision !== base.revision)
        throw refused("Member Work changed after review");
      const document = settingsRouteState.schema.parse(view.doc);
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
    const { process } = await lifetime(bridge, target!, documentKind(key), deps);
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
      const { specJson, source } = submittedSpec(
        familyActions[key].input.parse(commandInput).source,
      );
      // With a reviewed draft, the plan consumes its staged cells only if the captured bytes ARE that draft.
      const base = admission.bases.work;
      let consumed: Consumed | null = null;
      let takenAt: string | null = null;
      if (base) {
        const view = work ? await work.read(base.key, familyDraftRouteState.route) : null;
        if (!view || view.revision !== base.revision)
          throw refused("Current reviewed Family Work is required");
        const draft = familyDraftRouteState.schema.parse(view.doc);
        takenAt = draft.takenAt;
        const staged = editedEntries(draft.cells).map(([cell]) => cell);
        if (
          draft.reading !== null &&
          staged.length &&
          unstamped(settingsCandidate(draft.reading, draft.cells)) === unstamped(rootText(source))
        )
          consumed = consumedOf(base.key, "family", draft.cells, staged);
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
      const authored = familyActions[key].input.parse(commandInput);
      const rows = authored.rows;
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
            destination: typeof admission.destination;
            preparation: { state: string; value?: unknown };
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
                        String(entry.familyId) === id && rows.include.includes(entry.familyName),
                    ),
                ),
              );
        input = { plan: `${admission.id}:prepared`, expectedPlanHashes: selected };
        plan = {
          key: planKey,
          state: "succeeded",
          destination: admission.destination,
          preparation: { state: "ready", value: preparedPlan },
          result,
        };
      } else {
        input = rows;
        [plan] = await owner.list(undefined, input.plan);
      }
      if (!Object.keys(input.expectedPlanHashes).length)
        throw refused("No included family has changes to apply");
      const sealed =
        plan?.preparation.state === "ready"
          ? (plan.preparation.value as { sealed?: Sealed }).sealed
          : undefined;
      if (!plan || plan.key !== planKey || plan.state !== "succeeded" || !sealed)
        throw refused(`Apply must name a succeeded ${planKey} action`);
      if (canonicalRouteInput(plan.destination) !== canonicalRouteInput(admission.destination))
        throw refused("The plan was made for a different document");
      // A plan applies once. The journal is the record: an earlier apply of this plan that
      // reached Revit (succeeded, or incomplete after native success) spends it. An unknown
      // outcome never gets here: the journal refuses new work on the document until it is
      // recovered from its receipt.
      const spent = (await owner.list()).find(
        (row) =>
          row.id !== admission.id &&
          row.key === key &&
          (row.request as { plan?: unknown }).plan === input.plan &&
          (row.state === "succeeded" ||
            row.state === "incomplete" ||
            (row.state === "failed" && row.notDispatched !== true)),
      );
      if (spent) throw refused(`This plan already applied (action ${spent.id}); plan again`);
      // What the person reviewed must still be what is staged at every consumed address.
      // Proposals may move freely; a staged change means the review no longer describes Work.
      const consumed = sealed.consumed;
      if (consumed) {
        const view = work ? await work.read(consumed.key, workRoute(consumed)) : null;
        const document = view?.doc as
          | {
              cells?: Record<string, { edit?: Rung | null }>;
              patch?: { edit?: Rung | null };
            }
          | undefined;
        const now = document?.cells;
        if (
          Object.entries(consumed.cells).some(
            ([cell, rung]) => !sameValue(now?.[cell]?.edit, rung),
          ) ||
          (consumed.patch && !sameValue(document?.patch?.edit, consumed.patch))
        )
          throw refused(
            consumed.patch
              ? "The staged native patch changed since this plan; plan again"
              : "The staged cells changed since this plan; plan again",
          );
        if (
          consumed.route === "families" &&
          ((consumed.patch && Object.values(now ?? {}).some((cell) => cell.edit != null)) ||
            (Object.keys(consumed.cells).length > 0 && document?.patch?.edit != null))
        )
          throw refused("Stage either a native Family Foundry patch or per-type cells, not both");
        if (consumed.route === "family")
          assertFresh(documentMarks(bridge), target!, sealed.takenAt ?? null);
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
        key === "families.apply" && !sealed.consumed && admission.bases.work && work
          ? await work.read(admission.bases.work.key, familiesRouteState.route)
          : null;
      const readbackDocument =
        readbackBase && readbackBase.revision === admission.bases.work?.revision
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
              readbackWork: sealed.consumed?.key ?? admission.bases.work!.key,
              readbackTakenAt: sealed.consumed ? sealed.takenAt : readbackDocument?.takenAt,
            }
          : {}),
      };
    }
    if (key === "families.plan") {
      const input = familyActions[key].input.parse(commandInput);
      // The scope is authored Work; the plan is a result and never lands there.
      const base = admission.bases.work;
      const view = base && work ? await work.read(base.key, familiesRouteState.route) : null;
      if (!view || view.revision !== base!.revision)
        throw refused("Current reviewed Families Work is required");
      const doc = familiesRouteState.schema.parse(view.doc);
      const scope = stagedFilter(doc);
      if (!scope) throw refused("Stage a scope before planning");
      const hasCells = editedEntries(doc.cells).length > 0;
      if (doc.patch.edit && hasCells)
        throw refused("Stage either a native Family Foundry patch or per-type cells, not both");
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
          ? consumedOf(base!.key, "families", doc.cells, generated.keys)
          : null;
      const consumed: Consumed | null = doc.patch.edit
        ? { key: base!.key, route: "families", cells: {}, patch: doc.patch.edit }
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
      const base = admission.bases.work;
      if (!base || !work) throw refused("Reviewed Work is required");
      const view = await work.read(base.key, "parameter-links");
      if (!view || view.revision !== base.revision)
        throw refused("Work changed after review; review the current basis again");
      const input = familyActions["parameter-links.apply"].input.parse(commandInput);
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
      const capture = await captures.family(input.readingId);
      if (
        capture.reading.kind !== "parameter-links" ||
        capture.provenance.kind !== "live" ||
        canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(target)
      )
        throw refused("The reviewed evaluation is not live evidence for the selected lifetime");
      const evaluated = parameterLinksReadingSchema.parse(capture.reading.value);
      if (!evaluated.evaluated || !evaluated.evaluation)
        throw refused("The reviewed reading is a stored-profile read, not a staged evaluation");
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
    const input = familyActions["family.build"].input.parse(commandInput);
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
    if (prepared.kind === "settings-observation") {
      if (!base || !work) throw refused("Member Work is unavailable");
      const result = await work.publish(
        base.key,
        "pods",
        [
          { path: ["basis"], value: prepared.basis },
          { path: ["fields"], value: {} },
        ],
        base.revision,
      );
      if (!result.ok) throw refused(refusalText(result));
      return { envelope: await work.read(base.key, "pods") };
    }
    if (prepared.kind === "observation") {
      if (!base || !work) throw refused("Family Work is unavailable");
      const result = await work.publish(
        base.key,
        "family",
        [
          { path: ["reading"], value: prepared.reading },
          { path: ["takenAt"], value: prepared.takenAt },
        ],
        base.revision,
      );
      if (!result.ok) throw refused(refusalText(result));
      return { envelope: await work.read(base.key, "family") };
    }
    if (prepared.kind === "batch") {
      const results = [];
      for (const item of prepared.items) results.push(await executePrepared(execution, item));
      return { results };
    }
    const native = async (nativeKey: string, input: unknown, process: NativeProcess) => {
      const recorded = execution.recorded("native", nativeKey);
      if (prepared.kind === "native" && !prepared.planned) {
        validateEffect = async () => {
          await validateWork(prepared.retire);
          if (base && work && key === "parameter-links.apply") {
            const latest = await work.read(base.key, submittedRoute);
            if (
              canonicalRouteInput((latest?.doc as { profile?: unknown })?.profile) !==
              canonicalRouteInput((frozenWork?.doc as { profile?: unknown })?.profile)
            )
              throw refused("Submitted profile changed before native dispatch");
          }
          for (const source of sourceInputs)
            if ("sha256" in source) await familySpec(deps, source, pods);
        };
      }
      const result = await execution.step("native", nativeKey, input, async (id) => {
        await current(bridge, target!, documentKind(key), nativeProcessSchema.parse(process));
        const result = await invoke(bridge, target!, nativeKey, input, id);
        validateEffect = async () => {};
        if (nativeKey === "family.apply" || nativeKey === "families.apply")
          appliedSomething(result);
        return result;
      });
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
            throw Error("The reviewed Families reading is no longer the latest saved reading");
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
        const retiring: Consumed = {
          ...consumed,
          cells: Object.fromEntries(
            Object.entries(consumed.cells).filter(
              ([cell]) =>
                consumed.route === "family" || succeeded.has(familyCellAddress(cell).familyName),
            ),
          ),
          ...(consumed.patch && !patchConverged ? { patch: undefined } : {}),
        };
        const retired = await execution.step("publication", "work.retire", retiring, () =>
          retire(work, retiring),
        );
        await execution.publish(retired);
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
    const writer = "expectedSha256" in prepared.request ? "pod.member.save" : "pod.member.write";
    validateEffect = async () => {
      if (base && work && (await work.view(base.key, submittedRoute))?.revision !== base.revision)
        throw refused("Member Work changed before write; submit a new command");
    };
    const written = (await execution.step("file", writer, prepared.request, async () => {
      if (base && work && (await work.view(base.key, submittedRoute))?.revision !== base.revision)
        throw refused("Member Work changed before write; submit a new command");
      return writeMemberOnce(deps, prepared.request, pods);
    })) as PodMemberWritten;
    validateEffect = async () => {};
    const writtenBase = admission.bases.work!;
    if (!work) throw new ActionIncomplete("Member write succeeded; Work unavailable", written);
    const fields = structuredClone(prepared.document.fields);
    for (const field of Object.values(fields)) delete field.edit;
    const member: PodMember = { pod: written.pod, path: written.path };
    const publication = await work.publish(
      writtenBase.key,
      settingsRouteState.route,
      [
        {
          path: ["basis"],
          value: { member, rawContent: prepared.request.content, sha256: written.sha256 },
        },
        { path: ["fields"], value: fields },
      ],
      writtenBase.revision,
    );
    await execution.publish(publication);
    if (!publication.ok)
      throw new ActionIncomplete(
        "Member write succeeded; original Work revision publication refused. Later edits retained.",
        { file: written, publication },
      );
    return { file: written, publication };
  };
  return owner.admit(
    {
      ...admission,
      ...crossing,
      footprint,
      validate,
      frozen: {
        work: frozenWork,
        sources: Object.fromEntries(sources),
        capturePaths,
        observedMember,
      },
    },
    () => prepare(),
    (execution) => executePrepared(execution, execution.prepared as Prepared),
    resume,
  );
}

/**
 * Retire the consumed cells: each rung clears only while it still equals what the plan consumed,
 * so edits and proposals made after review survive. It re-reads and retries on a concurrent write
 * and never touches native work. Journaled as one step, so a replay never runs it twice.
 */
async function retire(work: ReturnType<typeof actionWorkspace> | undefined, consumed: Consumed) {
  if (!work) throw new ActionIncomplete("Applied; Work was unavailable to retire staged cells", {});
  const route = workRoute(consumed);
  // ponytail: three attempts; a Work that moves three times in one retirement is reported, not chased.
  for (let attempt = 0; attempt < 3; attempt++) {
    const view = await work.read(consumed.key, route);
    if (!view) return { retired: [] as string[] };
    const document = view.doc as {
      cells: Record<string, { suggestion?: Rung | null; edit?: Rung | null }>;
      patch?: { suggestion?: Rung | null; edit?: Rung | null };
    };
    const cells = document.cells;
    const patches = Object.entries(consumed.cells).flatMap(([cell, rung]) =>
      cells[cell]
        ? transitionPatches(["cells"], cell, cells[cell]!, { kind: "retire", consumed: rung })
        : [],
    );
    if (consumed.patch && document.patch)
      patches.push(
        ...transitionPatches([], "patch", document.patch, {
          kind: "retire",
          consumed: consumed.patch,
        }),
      );
    const retired = [
      ...new Set(
        patches.map((patch) => (patch.path[0] === "patch" ? "patch" : String(patch.path[1]))),
      ),
    ];
    if (!patches.length) return { retired, revision: view.revision };
    const landed = await work.publish(consumed.key, route, patches, view.revision);
    if (landed.ok) return { retired, revision: landed.revision };
    if (landed.code !== "stale_revision")
      throw new ActionIncomplete(
        `Applied; retiring staged cells was refused: ${refusalText(landed)}`,
        landed,
      );
  }
  throw new ActionIncomplete("Applied; Work kept moving, so staged cells were not retired", {});
}

export const recoverFamilyAction = async (
  id: string,
  owner: ActionJournal,
  deps: FamilyActionDependencies,
) => {
  const original = (await owner.list(undefined, id))[0];
  const familiesApply = original?.key === "families.apply";
  return owner.recover(
    id,
    async (step, prepared) => {
      const process = nativeProcessSchema.parse((prepared as { process: unknown }).process);
      if (!familiesApply || step.key !== "families.apply")
        return readNativeReceipt(step, process, deps.sdk);
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
        const input = (prepared as { input?: { source?: { root?: { id?: string | null } } } })
          .input;
        const pods = { podsRoot: deps.podsRoot };
        const root = input?.source?.root?.id
          ? join(
              await runPods(deps, podFolder(input.source.root.id, pods)),
              productPathNames.outputDirectoryName,
            )
          : join(
              deps.podsRoot ?? productPodsRootPath(),
              scriptingWorkspaceIdentity.defaultWorkspaceKey,
              productPathNames.outputDirectoryName,
              "operations",
            );
        const target = original?.destination;
        const run =
          target?.kind === "document"
            ? await familiesApplyRun(root, step, prepared, target.ref.openId)
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
    },
    familiesApply
      ? (step) =>
          step.key === "families.apply" &&
          step.state === "succeeded" &&
          !isFamiliesApplyResponse(step.result)
      : undefined,
  );
};

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
  const original = await current(bridge, target, "project");
  const fence = async () => {
    const next = await current(bridge, target, "project");
    if (
      next.processId !== original.processId ||
      next.processStartUtcUnixMs !== original.processStartUtcUnixMs
    )
      throw refused("Reading process changed");
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
  const provenance: FamilyCapture["provenance"] = { kind: "live", target };
  return captures.saveFamily(
    { key: scope, capturedAt: new Date().toISOString(), provenance, reading },
    fence,
  );
}
