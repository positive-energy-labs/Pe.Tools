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
  familiesIncluded,
  memberWork,
  parameterLinksRouteState,
  parameterLinksBasis,
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
  type PodMemberSource,
  type SettingsRouteDocument,
  type FamilyCapture,
} from "@pe/agent-contracts";
import type {
  PodMemberSaveRequest,
  PodMemberWriteRequest,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";
import type {
  FamiliesCapture,
  FamiliesPlan,
  FamilyCapture as NativeFamilyCapture,
  FamilyPlan,
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

/** The composed member as authored; the C# family edge reads its `$schema`. */
const familySpec = async (deps: PodDependencies, source: PodMemberSource, pods: PodContext) =>
  (await runPods(deps, composedSpec(source, pods))).spec;

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
export const writeCaptureRun = (
  deps: PodDependencies,
  pods: PodContext,
  at: string,
  written: PodMemberWritten,
  operation: string,
  outputs: Readonly<Record<string, string>> = {},
) =>
  runPods(
    deps,
    writeRun(
      written.pod,
      `${at.replace(/[:.]/g, "-")}-${digest(written.path).slice(0, 8)}`,
      {
        ...outputs,
        "receipt.json": `${JSON.stringify(
          {
            podId: written.pod,
            memberPath: written.path,
            memberSha256: written.sha256,
            operation,
            planHash: null,
            outcome: "Succeeded",
            outputs: Object.keys(outputs),
            reason: null,
          },
          null,
          2,
        )}
`,
      },
      pods,
    ),
  );

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
       * A plan request reads, returns, and mutates nothing; apply confirms it. A `scope` of null
       * is one family document, which plans exactly one family.
       */
      planned?: { scope: readonly string[] | null; excludedIds: readonly number[] };
    }
  | {
      kind: "capture";
      process: NativeProcess;
      nativeKey: string;
      input: unknown;
      pod: string;
      path: string | null;
      at: string;
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
        const input = admission.input as { pod: string; path?: string; familyIds?: number[] };
        await runPods(deps, podFolder(input.pod, pods));
        return {
          kind: "capture",
          process,
          nativeKey: key,
          input: key === "families.capture" ? { familyIds: input.familyIds } : {},
          pod: input.pod,
          path: input.path ?? null,
          at: new Date().toISOString(),
        };
      }
      if (key === "family.plan" || key === "family.apply") {
        const { source } = familyActions["family.plan"].input.parse(admission.input);
        const specJson = await familySpec(deps, source, pods);
        return key === "family.apply"
          ? {
              kind: "native",
              process,
              nativeKey: "family.apply",
              input: {
                specJson,
                expectedPlanHashes: familyActions[key].input.parse(admission.input)
                  .expectedPlanHashes,
                source,
              },
            }
          : {
              kind: "native",
              process,
              nativeKey: "family.plan",
              input: { specJson },
              planned: { scope: null, excludedIds: [] },
            };
      }
      if (key === "families.plan") {
        const input = familyActions[key].input.parse(admission.input);
        // The scope is authored Work; the plan is a result and never lands there.
        const base = admission.bases.work;
        const view = base && work ? await work.read(base.key, familiesRouteState.route) : null;
        if (!view || view.revision !== base!.revision)
          throw refused("Current reviewed Families Work is required");
        const { scope } = familiesRouteState.schema.parse(view.doc);
        if (!scope) throw refused("Author a scope before planning");
        return {
          kind: "native",
          process,
          nativeKey: "families.plan",
          input: {
            specJson: await familySpec(deps, input.source, pods),
            ...(input.executionOptions ? { executionOptions: input.executionOptions } : {}),
          },
          planned: { scope: scope.familyNames, excludedIds: input.excludedIds },
        };
      }
      if (key === "families.apply") {
        const input = familyActions[key].input.parse(admission.input);
        if (!Object.keys(input.expectedPlanHashes).length)
          throw refused("No included family has changes to apply");
        // The saved bytes must still be the ones planned; the engine gates each family's hash.
        return {
          kind: "native",
          process,
          nativeKey: "families.apply",
          input: { ...input, specJson: await familySpec(deps, input.source, pods) },
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
        if (!document.draft) throw refused("Author a draft profile before applying");
        const capture = await captures.family(input.readingId);
        if (
          capture.reading.kind !== "parameter-links" ||
          capture.provenance.kind !== "live" ||
          canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(target)
        )
          throw refused("The reviewed evaluation is not live evidence for the selected lifetime");
        const evaluated = parameterLinksReadingSchema.parse(capture.reading.value);
        if (!evaluated.evaluated || !evaluated.evaluation)
          throw refused("The reviewed reading is a stored-profile read, not a draft evaluation");
        if (evaluated.basis !== parameterLinksBasis(document))
          throw refused("The draft changed after the evaluation; preview again");
        return {
          kind: "native",
          process,
          nativeKey: "revit.apply.parameter-links",
          input: { profile: document.draft, previewOnly: false, reconcile: true },
        };
      }
      const input = familyActions["family.build"].input.parse(admission.input);
      const spec = await familySpec(deps, input.source, pods);
      const file = win32.join(
        await runPods(deps, podFolder(input.source.pod, pods)),
        input.source.path,
      );
      return {
        kind: "native",
        process,
        nativeKey: "family.build",
        input: {
          specJson: spec,
          source: input.source,
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
          return invoke(bridge, target!, nativeKey, input, id);
        });
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
                  path:
                    prepared.path ??
                    capturePath(
                      "family",
                      (captured as NativeFamilyCapture.Res.Response).familyName,
                      at,
                    ),
                },
              ];
        const members: PodMemberWritten[] = [];
        // Each captured member gets its own run, so `/pods` lists it against that member like any
        // other run; the run holds the unmodeled facts the member cannot carry.
        const runs = new Map<number, string>();
        for (const { familyId, content, unmodeled, path } of specs) {
          const request = { pod: prepared.pod, path, content };
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
        const result = await native(prepared.nativeKey, prepared.input, prepared.process);
        if (prepared.planned) {
          const { scope, excludedIds } = prepared.planned;
          const planned = result as FamilyPlan.Res.Response | FamiliesPlan.Res.Response;
          if (scope) {
            if (planned.diagnostics.length)
              throw refused(planned.diagnostics.map(diagnosticLine).join(" · "));
            // The engine plans every loaded family; authored family names are the only scope
            // narrowing this contract can honestly claim. Placement scope is not a native filter.
            const plan = planned.families.filter((entry) => scope.includes(entry.familyName));
            return {
              executionContext: target,
              plan,
              included: familiesIncluded({ entries: plan }, excludedIds),
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
            executionContext: target,
            plan,
            included: { [String(plan!.familyId)]: plan!.planHash },
          };
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
    const { evaluate } = familyReads["parameter-links.read"].input.parse(input);
    if (evaluate && !document.draft) throw refused("Author a draft profile before evaluating it");
    const data = evaluate
      ? await native("revit.apply.parameter-links", {
          profile: document.draft,
          previewOnly: true,
          reconcile: false,
        })
      : await native("revit.detail.parameter-links", { includeEvaluation: false });
    reading = {
      kind: "parameter-links",
      value: parameterLinksReadingSchema.parse({
        ...(data as object),
        basis: parameterLinksBasis(document),
        workRevision: view.revision,
        evaluated: evaluate,
        // What Revit holds arrives as `profile`; `stored` names it for what it is.
        stored: (data as { profile?: unknown }).profile ?? null,
        // A stored-profile read observes Revit, never the authored draft: it carries no
        // evaluation, so it can never arm an apply of a draft it did not evaluate.
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
