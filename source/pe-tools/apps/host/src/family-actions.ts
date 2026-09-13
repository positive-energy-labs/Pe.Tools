import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  actionAdmissionSchema,
  familyActions,
  familyReads,
  familyPlanReadingSchema,
  familiesRouteState,
  familiesBasis,
  familiesIncluded,
  familiesPlanReadingSchema,
  parameterLinksRouteState,
  parameterLinksBasis,
  parameterLinksReadingSchema,
  sameAddress,
  settingsCandidate,
  settingsBasisSchema,
  settingsRouteState,
  nativeProcessSchema,
  canonicalRouteInput,
  addressSchema,
  documentRefSchema,
  workKeySchema,
  type FamilyActionKey,
  type FamilyReadKey,
  type DocumentRef,
  type SettingsRouteDocument,
  type FamilyCapture,
} from "@pe/agent-contracts";
import type {
  OpenSettingsDocumentRequest,
  SaveSettingsDocumentRequest,
  SettingsDocumentSnapshot,
  SaveSettingsDocumentResult,
} from "@pe/host-contracts/operation-types";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { ActionIncomplete, type ActionJournal } from "./action-journal.ts";
import { actionWorkspace, type TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, readNativeReceipt, type NativeProcess } from "./native-receipts.ts";
import { openSettingsDocument, saveSettingsDocument, settingsDocumentAddress } from "./settings.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { executionContent } from "../../../packages/mcps/src/pea/settings-commands.ts";

const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type FamilyActionDependencies = TakeoffActionDependencies & {
  settingsAddress?: (
    id: import("@pe/host-contracts/operation-types").SettingsDocumentId,
  ) => Promise<{ path: string; workspaceId: string }>;
  nativePaths?: (
    input: { outputPath?: string; modelDirectory?: string },
    id: string,
    file: string,
  ) => Promise<{ outputPath: string; modelDirectory: string }>;
  openSettings?: (request: OpenSettingsDocumentRequest) => Promise<SettingsDocumentSnapshot>;
  saveSettings?: (request: SaveSettingsDocumentRequest) => Promise<SaveSettingsDocumentResult>;
};
const addressFile = (
  deps: FamilyActionDependencies,
  id: import("@pe/host-contracts/operation-types").SettingsDocumentId,
) =>
  deps.settingsAddress
    ? deps.settingsAddress(id)
    : Effect.runPromise(settingsDocumentAddress(id).pipe(Effect.provide(NodeServices.layer)));
const openFile = (deps: FamilyActionDependencies, request: OpenSettingsDocumentRequest) =>
  deps.openSettings
    ? deps.openSettings(request)
    : Effect.runPromise(openSettingsDocument(request, {}).pipe(Effect.provide(NodeServices.layer)));
const writeFile = (deps: FamilyActionDependencies, request: SaveSettingsDocumentRequest) =>
  deps.saveSettings
    ? deps.saveSettings(request)
    : Effect.runPromise(saveSettingsDocument(request, {}).pipe(Effect.provide(NodeServices.layer)));
async function current(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  family: boolean,
  process?: NativeProcess,
) {
  const session = (await Effect.runPromise(bridge.list)).find(
    (s) => s.sessionId === target.session,
  );
  const doc = session?.state?.openDocuments.find((d) => d.openId === target.openId);
  if (
    !session ||
    !doc ||
    (family && !doc.isFamilyDocument) ||
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
const basisOf = (snapshot: SettingsDocumentSnapshot) =>
  settingsBasisSchema.parse({
    documentId: snapshot.metadata.documentId,
    path: snapshot.metadata.documentId.stableId,
    rawContent: snapshot.rawContent,
    versionToken: snapshot.metadata.versionToken?.value,
  });
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
  if (key === "settings.write") {
    const input = familyActions[key].input.parse(admission.input);
    const canonical = await addressFile(deps, input.documentId);
    if (
      canonical.path.toLowerCase() !== input.path.toLowerCase() ||
      canonical.workspaceId !== input.workspaceId
    )
      throw refused("The file address belongs to another Work");
    // The receipt must echo the submitted intent exactly; Work identity is the exactly
    // compared workspaceId, and every path comparison below is already case-insensitive.
    admission.input = input;
  }
  const target = admission.destination.kind === "document" ? admission.destination.ref : undefined;
  const work = deps.workspace ?? actionWorkspace();
  return owner.admit(
    admission,
    async () => {
      if (key === "settings.write") {
        const input = familyActions["settings.write"].input.parse(admission.input);
        const address = await addressFile(deps, input.documentId);
        if (
          address.path.toLowerCase() !== input.path.toLowerCase() ||
          address.workspaceId !== input.workspaceId
        )
          throw refused("The file address belongs to another Work");
        const base = admission.bases.work;
        if (
          !base ||
          !work ||
          base.key.work !== input.workspaceId
        )
          throw refused("Reviewed Settings Work is required");
        const view = await work.read(base.key, "settings");
        if (!view || view.revision !== base.revision)
          throw refused("Settings Work changed after review");
        const document = settingsRouteState.schema.parse(view.doc);
        if (
          input.write.kind === "save" &&
          (!document.basis ||
            document.basis.path.toLowerCase() !== address.path.toLowerCase() ||
            document.basis.versionToken !== input.write.versionToken)
        )
          throw refused("The original file basis changed");
        if (
          input.write.kind === "create" &&
          (document.basis || Object.keys(document.fields).length)
        )
          throw refused("Create requires empty reviewed Work");
        return {
          kind: "settings",
          document,
          request: {
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            mode: "file",
            rawContent:
              input.write.kind === "create"
                ? input.write.rawContent
                : settingsCandidate(document.basis!.rawContent, document.fields),
            expected:
              input.write.kind === "create"
                ? { kind: "missing" }
                : { kind: "present", version: input.write.versionToken },
          },
          path: address.path,
        };
      }
      const session = await current(bridge, target!, key === "family.apply");
      const oldAddress = addressSchema.safeParse(
        session.state?.openDocuments.find((d) => d.openId === target!.openId)?.address,
      ).data;
      if (work && oldAddress) {
        const legacy = await work.read({ route: "family", target: oldAddress }, "family");
        if (legacy?.outcomeUnknown)
          throw refused(
            "An archived legacy Family mutation remains uncertain; a new capture cannot resolve it",
          );
      }
      if (!session.processId || session.processStartUtcUnixMs == null)
        throw refused("Original process identity unavailable");
      const process = await readOriginalProcess(
        session.processId,
        session.processStartUtcUnixMs,
        deps.sdk,
      );
      await current(bridge, target!, key === "family.apply", process);
      if (key === "families.apply" || key === "parameter-links.apply") {
        const base = admission.bases.work;
        if (!base || !work) throw refused("Reviewed Work is required");
        const route = key === "families.apply" ? "families" : "parameter-links";
        const view = await work.read(base.key, route);
        if (!view || view.revision !== base.revision)
          throw refused("Work changed after review; review the current basis again");
        const at = addressSchema.safeParse(
          session.state?.openDocuments.find((d) => d.openId === target!.openId)?.address,
        ).data;
        if (!at) throw refused("The admitted document has no resolvable address");
        if (key === "families.apply") {
          const input = familyActions[key].input.parse(admission.input);
          const document = familiesRouteState.schema.parse(view.doc);
          const capture = await captures.family(input.planId);
          if (
            capture.reading.kind !== "families-plan" ||
            capture.provenance.kind !== "live" ||
            canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(target)
          )
            throw refused("The reviewed plan is not live evidence for the selected lifetime");
          const plan = familiesPlanReadingSchema.parse(capture.reading.value);
          // Staleness is a basis mismatch, never a cleared field: the reading still exists.
          if (plan.basis !== familiesBasis(document))
            throw refused("The authored profile or scope changed after the plan; plan again");
          if (!sameAddress(plan.reading.at, at))
            throw refused("The plan was read against another document");
          const included = familiesIncluded(plan, document.excludedIds);
          if (canonicalRouteInput(included) !== canonicalRouteInput(input.expectedPlanHashes))
            throw refused("The reviewed family plans or exclusions changed");
          if (!Object.keys(included).length)
            throw refused("No included family has changes to apply");
          const opened = (await invoke(bridge, target!, "settings.document.open", {
            documentId: {
              moduleKey: "FamilyFoundry",
              rootKey: "patches",
              relativePath: document.profilePath!,
            },
            includeComposedContent: true,
          })) as SettingsDocumentSnapshot;
          const patchJson = executionContent(opened);
          if (digest(patchJson) !== plan.composedDigest)
            throw refused("The reviewed profile bytes changed after the plan; plan again");
          return {
            kind: "native",
            process,
            nativeKey: "familyfoundry.apply",
            input: {
              patchJson,
              expectedPlanHashes: included,
              ...(plan.executionOptions ? { executionOptions: plan.executionOptions } : {}),
            },
          };
        }
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
      if (key === "family.apply") {
        const input = familyActions["family.apply"].input.parse(admission.input);
        const capture = await captures.family(input.planId);
        if (
          capture.provenance.kind !== "live" ||
          canonicalRouteInput(capture.provenance.target) !== canonicalRouteInput(target) ||
          capture.reading.kind !== "plan"
        )
          throw refused("Plan is not live evidence for the selected lifetime");
        const plan = familyPlanReadingSchema.parse(capture.reading.value);
        if (
          canonicalRouteInput(plan.target) !== canonicalRouteInput(target) ||
          plan.entry.planHash !== input.expectedPlanHash ||
          plan.entry.refusals.length
        )
          throw refused("Review the original valid native plan hash");
        const opened = await openFile(deps, {
          documentId: plan.documentId,
          workspaceId: plan.workspaceId,
          mode: "file",
          includeComposedContent: true,
        });
        if (
          opened.metadata.versionToken?.value !== plan.fileVersion ||
          digest(executionContent(opened)) !== plan.composedDigest
        )
          throw refused("The original file/composed plan basis changed");
        return {
          kind: "native",
          process,
          nativeKey: "familyfoundry.apply",
          input: {
            patchJson: plan.patchJson,
            expectedPlanHashes: { [plan.entry.familyId]: input.expectedPlanHash },
            ...(plan.executionOptions ? { executionOptions: plan.executionOptions } : {}),
          },
        };
      }
      const input = familyActions["family.build"].input.parse(admission.input);
      const opened = await openFile(deps, {
        documentId: input.documentId,
        workspaceId: input.workspaceId,
        mode: "file",
        includeComposedContent: true,
      });
      if (opened.metadata.versionToken?.value !== input.fileVersion)
        throw refused("The original saved file token changed");
      const path = opened.metadata.documentId.stableId;
      if (!path) throw refused("Canonical file path unavailable");
      return {
        kind: "native",
        process,
        nativeKey: "revit.apply.family-model",
        fileVersion: input.fileVersion,
        composedDigest: digest(executionContent(opened)),
        input: {
          modelJson: executionContent(opened),
          ...(deps.nativePaths
            ? await deps.nativePaths(input, admission.id, path)
            : {
                outputPath: resolve(
                  input.outputPath ?? `.artifacts/tmp/family/${digest(admission.id)}.rfa`,
                ),
                modelDirectory: resolve(input.modelDirectory ?? dirname(path)),
              }),
        },
      };
    },
    async (execution) => {
      const prepared = execution.prepared as
        | {
            kind: "settings";
            document: SettingsRouteDocument;
            request: SaveSettingsDocumentRequest;
          }
        | { kind: "native"; process: NativeProcess; nativeKey: string; input: unknown };
      if (prepared.kind === "native") {
        const result = await execution.step(
          "native",
          prepared.nativeKey,
          prepared.input,
          async (id) => {
            await current(
              bridge,
              target!,
              key === "family.apply",
              nativeProcessSchema.parse(prepared.process),
            );
            return invoke(bridge, target!, prepared.nativeKey, prepared.input, id);
          },
        );
        return {
          executionContext: target,
          native: result,
          ...(key === "family.build"
            ? { outputPath: (prepared.input as { outputPath: string }).outputPath }
            : {}),
        };
      }
      const result = await execution.step(
        "file",
        "settings.document.save",
        prepared.request,
        async () => {
          const result = await writeFile(deps, prepared.request);
          if (result.kind === "conflict")
            throw refused(
              "Original file token/create precondition conflicted; no file write occurred",
            );
          return result;
        },
      );
      if (result.kind !== "written") throw refused("Expected original written file outcome");
      const base = admission.bases.work!;
      if (!work) throw new ActionIncomplete("File succeeded; Work unavailable", result);
      const fields = structuredClone(prepared.document.fields);
      for (const field of Object.values(fields)) delete field.staged;
      const publication = await work.apply(
        base.key,
        "settings",
        admission.actor,
        [
          { path: ["basis"], value: basisOf(result.snapshot) },
          { path: ["fields"], value: fields },
        ],
        base.revision,
      );
      await execution.publish(publication);
      if (!publication.ok)
        throw new ActionIncomplete(
          "File succeeded; original Work revision publication refused. Later edits retained.",
          { file: result, publication },
        );
      return { file: result, publication };
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
    // The Families and Parameter Links routes read a project document, not a family document.
    const familyDocument = key !== "families.plan" && key !== "parameter-links.read";
    const original = await current(bridge, target, familyDocument);
    const fence = async () => {
      const next = await current(bridge, target, familyDocument);
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
    if (key === "families.plan" || key === "parameter-links.read") {
      if (!deps.workspace) throw refused("Route Work is unavailable");
      const view = await deps.workspace.read(
        scope,
        key === "families.plan" ? "families" : "parameter-links",
      );
      if (!view) throw refused("Author this route's Work before reading it");
      if (key === "families.plan") {
        const document = familiesRouteState.schema.parse(view.doc);
        if (!document.profilePath || !document.scope)
          throw refused("Author a profile and a scope before planning");
        const opened = (await native("settings.document.open", {
          documentId: {
            moduleKey: "FamilyFoundry",
            rootKey: "patches",
            relativePath: document.profilePath,
          },
          includeComposedContent: true,
        })) as SettingsDocumentSnapshot;
        const patchJson = executionContent(opened);
        const result = (await native("familyfoundry.plan", {
          patchJson,
          ...(document.executionOptions ? { executionOptions: document.executionOptions } : {}),
        })) as { diagnostics: { code: string; path: string; message: string }[]; families: [] };
        if (result.diagnostics.length)
          throw refused(
            result.diagnostics.map((d) => `${d.code} · ${d.path} — ${d.message}`).join(" · "),
          );
        // The engine plans every loaded family; authored family names are the only scope
        // narrowing this contract can honestly claim. Placement scope is not a native filter.
        const allowed = new Set(document.scope.familyNames);
        reading = {
          kind: "families-plan",
          value: familiesPlanReadingSchema.parse({
            basis: familiesBasis(document),
            workRevision: view.revision,
            reading: {
              at: addressSchema.parse(
                original.state?.openDocuments.find((d) => d.openId === target.openId)?.address,
              ),
              version: opened.metadata.versionToken?.value ?? null,
              observedAt: new Date().toISOString(),
            },
            fileVersion: opened.metadata.versionToken?.value ?? null,
            composedDigest: digest(patchJson),
            entries: (result.families as { familyName: string }[]).filter((entry) =>
              allowed.has(entry.familyName),
            ),
            executionOptions: document.executionOptions,
          }),
        };
      } else {
        const document = parameterLinksRouteState.schema.parse(view.doc);
        const { evaluate } = familyReads["parameter-links.read"].input.parse(input);
        if (evaluate && !document.draft)
          throw refused("Author a draft profile before evaluating it");
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
      }
    } else if (key === "family.capture") {
      reading = {
        kind: "capture",
        value: {
          ...((await native("revit.detail.family-model", {})) as object),
          origin: "capture",
          rfaPath: null,
        },
      };
    } else {
      const request = familyReads["family.plan"].input.parse(input);
      // The Work key names its workspace `work`; the reading input still says `workspaceId`.
      if (scope.work !== request.workspaceId)
        throw refused("Plan reading belongs to another file Work");
      const opened = await openFile(deps, {
        documentId: request.documentId,
        workspaceId: request.workspaceId,
        mode: "file",
        includeComposedContent: true,
      });
      if (opened.metadata.versionToken?.value !== request.fileVersion)
        throw refused("The reviewed file token changed");
      const composed = executionContent(opened);
      const patchJson = JSON.stringify({ patch: JSON.parse(composed) });
      const result = (await native("familyfoundry.plan", {
        patchJson,
        ...(request.executionOptions ? { executionOptions: request.executionOptions } : {}),
      })) as { diagnostics: { message: string }[]; families: unknown[] };
      if (result.diagnostics.length || result.families.length !== 1)
        throw refused(
          result.diagnostics.map((d) => d.message).join("; ") || "Expected one family plan",
        );
      reading = {
        kind: "plan",
        value: familyPlanReadingSchema.parse({
          target,
          documentId: request.documentId,
          workspaceId: request.workspaceId,
          path: opened.metadata.documentId.stableId,
          fileVersion: request.fileVersion,
          composedDigest: digest(composed),
          patchJson,
          entry: result.families[0],
          executionOptions: request.executionOptions,
        }),
      };
    }
    await fence();
    provenance = { kind: "live", target };
  }
  return captures.saveFamily(
    { key: scope, capturedAt: new Date().toISOString(), provenance, reading },
    liveFence,
  );
}
