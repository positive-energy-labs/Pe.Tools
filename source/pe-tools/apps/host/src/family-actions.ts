import { createHash } from "node:crypto";
import { resolve, win32 } from "node:path";
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
  stagedEntries,
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
  type WorkKey,
  familyCatalogProblem,
  familyCatalogRequest,
  stagedScope,
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
} from "@pe/host-contracts/generated";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { ActionIncomplete, type ActionJournal } from "./action-journal.ts";
import { actionWorkspace, type TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, readNativeReceipt, type NativeProcess } from "./native-receipts.ts";
import {
  composedSpec,
  podFolder,
  saveMember,
  writeMember,
  writeRun,
  type PodContext,
} from "./settings.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { LocalOpError } from "./local-error.ts";

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
  const { $schema: _, ...model } = JSON.parse(spec.replace(/^﻿/, "")) as object & {
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

/** A new member path in the route's pod; frozen at preparation so a resume writes the same one. */
export const capturePath = (entity: string, name: string, at = new Date()) =>
  `settings/${entity}/${name.replace(/[^\w.-]+/g, "-")}-${at.toISOString().replace(/[:.]/g, "-")}.json`;

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

export async function current(
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
export async function invoke(
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
  const session = await current(bridge, target, family);
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
type Consumed = { key: WorkKey; route: "family" | "families"; cells: Record<string, Rung> };
type Sealed = {
  specJson: string;
  source: { root: { bytesBase64: string } };
  executionOptions?: unknown;
  /** Null: no Work basis, or a member the staged cells do not generate. It retires nothing. */
  consumed: Consumed | null;
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
  cells: Record<string, { staged?: Rung | null }>,
  keys: string[],
): Consumed => ({
  key,
  route,
  cells: Object.fromEntries(keys.map((cell) => [cell, cells[cell]!.staged!])),
});

const workRoute = (consumed: Consumed) =>
  consumed.route === "family" ? familyDraftRouteState.route : familiesRouteState.route;

type Prepared =
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
 * `notDispatched` is the journal's only settled-failure shape; here it means "no effect", not "never sent".
 */
const appliedSomething = (result: unknown) => {
  const applied = result as FamiliesApply.Res.Response;
  if (applied.receipts.some((receipt) => receipt.success)) return;
  if (applied.diagnostics.some((diagnostic) => diagnostic.code === "Cancelled")) return;
  throw new BridgeError(applied.reason ?? "No family was applied", 422, {
    notDispatched: true,
    result,
  });
};

export async function admitFamilyAction(
  raw: unknown,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (!Object.hasOwn(familyActions, admission.key)) throw refused("Unknown family/file action");
  const key = admission.key as FamilyActionKey;
  const definition = familyActions[key];
  if (definition.actor === "human" && admission.actor !== "human")
    throw refused("This action requires human approval");
  admission.input = definition.input.parse(admission.input);
  if ((key === "settings.write") !== (admission.destination.kind === "host"))
    throw refused("Wrong action destination");
  if (key !== "settings.write" && admission.destination.kind !== "document")
    throw refused("An exact execution DocumentRef is required");
  const target = admission.destination.kind === "document" ? admission.destination.ref : undefined;
  const work = deps.workspace ?? actionWorkspace();
  const pods = podContext(deps, bridge, target);
  return owner.admit(
    admission,
    async (): Promise<Prepared> => {
      if (key === "settings.write") {
        const input = familyActions["settings.write"].input.parse(admission.input);
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
        const input = admission.input as {
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
        const { specJson, source } = await familySpec(
          deps,
          familyActions[key].input.parse(admission.input).source,
          pods,
        );
        // With a reviewed draft, the plan consumes its staged cells only if the captured bytes ARE that draft.
        const base = admission.bases.work;
        let consumed: Consumed | null = null;
        if (base) {
          const view = work ? await work.read(base.key, familyDraftRouteState.route) : null;
          if (!view || view.revision !== base.revision)
            throw refused("Current reviewed Family Work is required");
          const draft = familyDraftRouteState.schema.parse(view.doc);
          const staged = stagedEntries(draft.cells).map(([cell]) => cell);
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
          sealed: { specJson, source, consumed },
        };
      }
      if (key === "family.apply" || key === "families.apply") {
        const input = familyActions[key].input.parse(admission.input);
        if (!Object.keys(input.expectedPlanHashes).length)
          throw refused("No included family has changes to apply");
        // The succeeded plan's sealed preparation is the input: never a live member or Work read.
        const planKey = key === "family.apply" ? "family.plan" : "families.plan";
        const [plan] = await owner.list(undefined, input.plan);
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
            (row.state === "succeeded" || row.state === "incomplete"),
        );
        if (spent) throw refused(`This plan already applied (action ${spent.id}); plan again`);
        // What the person reviewed must still be what is staged at every consumed address.
        // Proposals may move freely; a staged change means the review no longer describes Work.
        const consumed = sealed.consumed;
        if (consumed) {
          const view = work ? await work.read(consumed.key, workRoute(consumed)) : null;
          const now = (
            view?.doc as { cells?: Record<string, { staged?: Rung | null }> } | undefined
          )?.cells;
          if (
            Object.entries(consumed.cells).some(
              ([cell, rung]) => !sameValue(now?.[cell]?.staged, rung),
            )
          )
            throw refused("The staged cells changed since this plan; plan again");
        }
        const included = (plan.result as { included: Record<string, string> }).included;
        const stray = Object.keys(input.expectedPlanHashes).filter(
          (id) => included[id] !== input.expectedPlanHashes[id],
        );
        if (stray.length)
          throw refused(`Families ${stray.join(", ")} are not in the reviewed plan as sent`);
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
        };
      }
      if (key === "families.plan") {
        const input = familyActions[key].input.parse(admission.input);
        // The scope is authored Work; the plan is a result and never lands there.
        const base = admission.bases.work;
        const view = base && work ? await work.read(base.key, familiesRouteState.route) : null;
        if (!view || view.revision !== base!.revision)
          throw refused("Current reviewed Families Work is required");
        const doc = familiesRouteState.schema.parse(view.doc);
        const scope = stagedScope(doc);
        if (!scope) throw refused("Stage a scope before planning");
        const { specJson, source } = await familySpec(deps, input.source, pods);
        // A generated draft plans one family; it consumes that family's staged cells only if the
        // captured bytes are exactly what those cells generate.
        const generated =
          input.familyNames?.length === 1
            ? familyStagedPatch(doc.cells, input.familyNames[0]!)
            : null;
        const consumed =
          generated && canonicalRouteInput(generated.spec) === unstamped(rootText(source))
            ? consumedOf(base!.key, "families", doc.cells, generated.keys)
            : null;
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
          },
          planned: {
            scope,
            excluded: doc.excluded,
            ...(input.familyNames ? { familyNames: input.familyNames } : {}),
            written: Object.keys(doc.cells).filter(
              (cell) => doc.cells[cell]!.proposal != null || doc.cells[cell]!.staged != null,
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
        const input = familyActions["parameter-links.apply"].input.parse(admission.input);
        const document = parameterLinksRouteState.schema.parse(view.doc);
        // Apply reconciles the person's staged profile only; a Pea proposal never arms it.
        const staged = stagedParameterProfile(document);
        if (!staged) throw refused("Stage a profile before applying");
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
        if (evaluated.subject === "proposal")
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
      const input = familyActions["family.build"].input.parse(admission.input);
      const { specJson, source } = await familySpec(deps, input.source, pods);
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
    },
    async (execution) => {
      const prepared = execution.prepared as Prepared;
      const native = (nativeKey: string, input: unknown, process: NativeProcess) =>
        execution.step("native", nativeKey, input, async (id) => {
          await current(bridge, target!, documentKind(key), nativeProcessSchema.parse(process));
          const result = await invoke(bridge, target!, nativeKey, input, id);
          if (nativeKey === "family.apply" || nativeKey === "families.apply")
            appliedSomething(result);
          return result;
        });
      // The scope resolves to names only; name -> current id is the library's, at plan.
      const resolveScope = async (scope: AppliedFilter, process: NativeProcess) => {
        const catalog = (await native(
          "revit.catalog.loaded-families",
          familyCatalogRequest(scope),
          process,
        )) as RevitCatalogLoadedFamilies.Res.Response;
        const problem = familyCatalogProblem(catalog);
        if (problem) throw refused(problem);
        return catalog.families;
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
                        path: capturePath("families", f.familyName ?? `family-${f.familyId}`, at),
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
                  path:
                    prepared.path ??
                    capturePath(
                      "family",
                      (captured as NativeFamilyCapture.Res.Response).familyName,
                      at,
                    ),
                },
              ];
        // No pod: the live read the audit drafts from. Nothing is filed.
        if (!prepared.pod)
          return {
            executionContext: target,
            spec: specs[0]!.content,
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
        if (prepared.planned) {
          const { excluded } = prepared.planned;
          const planned = result as FamilyPlan.Res.Response | FamiliesPlan.Res.Response;
          if (scope) {
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
              orphaned: prepared.planned.written.filter((cell) => {
                const { familyName, typeName } = familyCellAddress(cell);
                return !loaded.has(JSON.stringify([familyName, typeName]));
              }),
            };
          }
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
        }
        const consumed = prepared.retire;
        if (consumed) {
          // By name: the apply reloaded the family, so its element id is already a new one.
          const succeeded = new Set(
            (result as FamiliesApply.Res.Response).receipts.flatMap((receipt) =>
              receipt.success ? [receipt.familyName] : [],
            ),
          );
          // A family document applies its one family; Families retires per proven family only.
          const retiring: Consumed = {
            ...consumed,
            cells: Object.fromEntries(
              Object.entries(consumed.cells).filter(
                ([cell]) =>
                  consumed.route === "family" || succeeded.has(familyCellAddress(cell).familyName),
              ),
            ),
          };
          const retired = await execution.step("publication", "work.retire", retiring, () =>
            retire(work, retiring, admission.actor),
          );
          await execution.publish(retired);
          return { executionContext: target, native: result, retired };
        }
        return {
          executionContext: target,
          native: result,
          ...(key === "family.build"
            ? { outputPath: (result as { outputPath?: string }).outputPath }
            : {}),
        };
      }
      const writer = "expectedSha256" in prepared.request ? "pod.member.save" : "pod.member.write";
      const written = (await execution.step("file", writer, prepared.request, () =>
        writeMemberOnce(deps, prepared.request, pods),
      )) as PodMemberWritten;
      const base = admission.bases.work!;
      if (!work) throw new ActionIncomplete("Member write succeeded; Work unavailable", written);
      const fields = structuredClone(prepared.document.fields);
      for (const field of Object.values(fields)) delete field.staged;
      const member: PodMember = { pod: written.pod, path: written.path };
      const publication = await work.apply(
        base.key,
        settingsRouteState.route,
        admission.actor,
        [
          {
            path: ["basis"],
            value: { member, rawContent: prepared.request.content, sha256: written.sha256 },
          },
          { path: ["fields"], value: fields },
        ],
        base.revision,
      );
      await execution.publish(publication);
      if (!publication.ok)
        throw new ActionIncomplete(
          "Member write succeeded; original Work revision publication refused. Later edits retained.",
          { file: written, publication },
        );
      return { file: written, publication };
    },
    resume,
  );
}

/**
 * Retire the consumed cells: each rung clears only while it still equals what the plan consumed,
 * so edits and proposals made after review survive. It re-reads and retries on a concurrent write
 * and never touches native work. Journaled as one step, so a replay never runs it twice.
 */
async function retire(
  work: ReturnType<typeof actionWorkspace> | undefined,
  consumed: Consumed,
  actor: "human" | "agent",
) {
  if (!work) throw new ActionIncomplete("Applied; Work was unavailable to retire staged cells", {});
  const route = workRoute(consumed);
  // ponytail: three attempts; a Work that moves three times in one retirement is reported, not chased.
  for (let attempt = 0; attempt < 3; attempt++) {
    const view = await work.read(consumed.key, route);
    if (!view) return { retired: [] as string[] };
    const cells = (
      view.doc as { cells: Record<string, { proposal?: Rung | null; staged?: Rung | null }> }
    ).cells;
    const patches = Object.entries(consumed.cells).flatMap(([cell, rung]) =>
      cells[cell]
        ? transitionPatches(["cells"], cell, cells[cell]!, { kind: "retire", consumed: rung })
        : [],
    );
    const retired = [...new Set(patches.map((patch) => String(patch.path[1])))];
    if (!patches.length) return { retired, revision: view.revision };
    const landed = await work.apply(consumed.key, route, actor, patches, view.revision);
    if (landed.ok) return { retired, revision: landed.revision };
    if (landed.code !== "stale_revision")
      throw new ActionIncomplete(
        `Applied; retiring staged cells was refused: ${landed.error}`,
        landed,
      );
  }
  throw new ActionIncomplete("Applied; Work kept moving, so staged cells were not retired", {});
}

export const recoverFamilyAction = (
  id: string,
  owner: ActionJournal,
  deps: FamilyActionDependencies,
) =>
  owner.recover(id, (step, prepared) =>
    readNativeReceipt(
      step,
      nativeProcessSchema.parse((prepared as { process: unknown }).process),
      deps.sdk,
    ),
  );

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
  let reading: FamilyCapture["reading"];
  let liveFence: (() => Promise<void>) | undefined;
  let provenance: FamilyCapture["provenance"] = { kind: "file" };
  if (key === "family.parse-spec") {
    const { url } = familyReads[key].input.parse(input);
    const form = new FormData();
    form.append("url", url);
    const response = await fetch(
      `${process.env.PE_WEB_URL ?? "http://localhost:3000"}/api/pdf-audit/parse`,
      { method: "POST", body: form },
    );
    const parsed = (await response.json()) as {
      error?: string;
      jobId?: string;
      fileName?: string;
      blocks?: unknown[];
      images?: unknown[];
    };
    if (!response.ok || parsed.error) throw Error(parsed.error ?? "Spec parsing failed");
    reading = {
      kind: "spec",
      value: {
        parseId: parsed.jobId ?? null,
        fileName: parsed.fileName ?? "document.pdf",
        blocks: parsed.blocks ?? [],
        images: parsed.images ?? [],
      },
    };
  } else {
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
    liveFence = fence;
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
      subject === "proposal"
        ? (document.profile.proposal?.value ?? null)
        : stagedParameterProfile(document);
    if (evaluate && !profile)
      throw refused(
        subject === "proposal"
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
    reading = {
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
    provenance = { kind: "live", target };
  }
  return captures.saveFamily(
    { key: scope, capturedAt: new Date().toISOString(), provenance, reading },
    liveFence,
  );
}
