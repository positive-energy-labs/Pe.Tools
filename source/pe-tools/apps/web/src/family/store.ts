/**
 * Family — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Readings and the four verbs live in `family/manifest.ts`. What is left here
 * is what only Family knows: how the settings Work and the family Readings become one lane, and
 * which page selections the sheet holds while it is open. Plain values — no atoms, no `Scope`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  actionReceiptSchema,
  familyCaptureSchema,
  familyProjectionSchema,
  here,
  settingsFieldDirectives,
  settingsFieldSegments,
  settingsWorkSnapshot,
  type FamilyCapture,
  type FamilyDocument,
  type Reading,
  type SettingsDocumentId,
  type SettingsRouteDocument,
  type SettingsSnapshot,
  type WorkKey,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import { projectBuildReceipt, type BuildFacts, type BuildRefusal } from "#/family/build";
import {
  FAMILY_MODULE,
  createLiveFamilyHost,
  type EvidenceSlice,
  type FieldState,
} from "#/family/host";
import { familyLane } from "#/family/lane";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "#/family/model";
import { familyEditBuffer } from "./edit-buffer";
import { draftToPatches } from "#/family/project";
import {
  familyManifest,
  latestApplyStatus,
  latestBuildStatus,
  projectReadings,
  type FamilyPage,
} from "#/family/manifest";
import { documentAddress, previousOf, useHostCall, inventoryOf, useReading } from "#/readings";
import { useRoute } from "#/route";
import { settingsManifest } from "#/settings/manifest";

type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;

export type Inspect = { kind: "part"; slug: string } | { kind: "param"; name: string } | null;
export type Binding = { slug: string; property: string } | null;
export type ArmedBuild = { token: string | null; reason: string } | null;
export type PickerState = { open: string | null; level: string | null; query: string };

const emptyTable = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

/* ── Page memory ───────────────────────────────────────────────────────────── */

export interface FamilyPageMemory {
  readonly overlay: Overlay;
  readonly table: MasterTableState;
  readonly drill: MasterTableState;
  readonly docMode: "text" | "sheet";
  readonly docZoom: number;
  readonly drillType: string | null;
  readonly stageType: string;
  readonly focus: Focus;
  readonly focusedProposal: string | null;
  readonly pinnedParam: string | null;
  readonly anatomyCollapsed: boolean;
  readonly inspect: Inspect;
  readonly binding: Binding;
  readonly picker: PickerState;
  readonly sharedEdit: { pointer: string; directives: string[] } | null;
  readonly receipt: { verb: string; text: string; at: number } | null;
}

const initialMemory = (): FamilyPageMemory => ({
  overlay: "draft",
  table: emptyTable(),
  drill: emptyTable(),
  docMode: "text",
  docZoom: 1,
  drillType: null,
  stageType: "Standard",
  focus: null,
  focusedProposal: null,
  pinnedParam: null,
  anatomyCollapsed: false,
  inspect: null,
  binding: null,
  picker: { open: null, level: null, query: "" },
  sharedEdit: null,
  receipt: null,
});

/* ── Pure projections ──────────────────────────────────────────────────────── */

/** The last succeeded `family.apply` receipt, folded onto the projection. */
export function applyOnto(
  projection: FamilyDocument,
  rows: readonly FamilyCapture[],
  statuses: unknown,
  receipts: unknown,
  target: { session: string; openId: string },
): FamilyDocument {
  if (!statuses || !receipts) return projection;
  const status = latestApplyStatus(rows, statuses, target);
  if (!status) return projection;
  const row = actionReceiptSchema
    .array()
    .parse(receipts)
    .find((entry) => entry.id === status.id);
  if (!row) return projection;
  const step = row.steps.find(
    (entry) => entry.key === "familyfoundry.apply" && entry.state === "succeeded",
  );
  if (step?.state === "succeeded") {
    projection.apply = familyProjectionSchema.shape.apply.parse(step.result);
  }
  return projection;
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export function useFamilyStore(options: {
  target?: string;
  thread?: string;
  /** The settings file Work this page edits; `?mode=file` names it, the route resolves it. */
  fileKey: WorkKey;
  /** Current saved-file observation supplied by FileWorkspace; absent only in a seed. */
  profile?: Reading<SettingsSnapshot>;
  refreshProfile?: () => Promise<void>;
  selectFile?: (documentId: SettingsDocumentId) => Promise<void>;
  initialDocumentId?: SettingsDocumentId;
}) {
  const workspaceId = options.fileKey.work;
  if (!workspaceId) throw Error("Family requires an authored file workspace");
  const fileKey = options.fileKey;
  const settingsRoute = useMemo(() => settingsManifest({ scope: fileKey }), [fileKey]);
  const settingsHandle = useRoute(settingsRoute, { work: workspaceId });
  const settingsDoc = settingsHandle.work.doc as SettingsRouteDocument | null;
  const settingsRevision = settingsHandle.work.revision;
  const edits = useMemo(
    () => familyEditBuffer(fileKey, settingsHandle.work.write),
    [fileKey, settingsHandle.work.write],
  );
  const editState = useSyncExternalStore(edits.subscribe, edits.getSnapshot, edits.getSnapshot);
  useEffect(() => {
    if (settingsRevision != null) edits.observe(settingsRevision);
  }, [edits, settingsRevision]);
  const snapshot = useMemo(
    () => (settingsDoc ? settingsWorkSnapshot(settingsDoc) : null),
    [settingsDoc],
  );
  const fields = (settingsDoc?.fields ?? {}) as Record<string, FieldState>;
  const authoredLane = useMemo(
    () => familyLane(snapshot, null, fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, settingsDoc?.fields],
  );
  const authoredDraft = editState.draft ?? initialDraft(authoredLane.world);
  const authoringFacts = useMemo(
    () => ({
      relativePath: authoredLane.document?.relativePath ?? null,
      versionToken: authoredLane.document?.versionToken ?? null,
      validation: authoredLane.document ? (snapshot?.validation ?? null) : null,
      unsavedCount: authoredLane.document
        ? draftToPatches(
            authoredLane.document.model,
            authoredDraft,
            initialDraft(authoredLane.world),
          ).length
        : 0,
      stagedCount: Object.values(fields).filter((field) => field.staged != null).length,
      current: settingsRevision !== null && editState.failure === null,
    }),
    [
      authoredLane,
      authoredDraft,
      fields,
      snapshot?.validation,
      settingsRevision,
      editState.failure,
    ],
  );
  const routeManifest = useMemo(() => {
    const declared = familyManifest(authoringFacts);
    return {
      ...declared,
      readings: {
        ...declared.readings,
        ...(options.thread
          ? { head: { kind: "thread-head" as const, thread: options.thread } }
          : {}),
      },
    };
  }, [authoringFacts, options.thread]);
  const profileObservation = options.profile ? previousOf(options.profile) : undefined;
  const provided = useMemo(
    () => (options.profile ? { profile: options.profile } : undefined),
    [options.profile],
  );
  const handle = useRoute(routeManifest, {
    target: options.target ?? null,
    work: workspaceId,
    page: profileObservation ? { file: profileObservation.documentId.relativePath } : undefined,
    provided,
  });
  const [page, setPage] = handle.page as readonly [FamilyPage, (next: Partial<FamilyPage>) => void];
  const [memory, setMemory] = useState<FamilyPageMemory>(initialMemory);
  const patch = useCallback(
    (value: Partial<FamilyPageMemory>) => setMemory((current) => ({ ...current, ...value })),
    [],
  );

  const target =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const targetLabel = target?.session ?? "";

  /* ── Family Readings ────────────────────────────────────────────────────── */
  const familyReading = handle.readings.family as Reading<unknown>;
  const readings: FamilyCapture[] = useMemo(() => {
    const raw = previousOf(familyReading);
    return raw ? familyCaptureSchema.array().parse(raw) : [];
  }, [familyReading]);
  const statuses = previousOf(handle.readings.receipts as Reading<unknown>);
  const applyStatus = useMemo(
    () => (target ? latestApplyStatus(readings, statuses, target) : null),
    [readings, statuses, target],
  );
  const applyReceipt = useReading<unknown>(
    !handle.demo && applyStatus ? { kind: "receipts", id: applyStatus.id } : null,
  );
  const receipt = previousOf(applyReceipt);
  const familyDoc = useMemo(() => {
    const projection = projectReadings(readings, target ?? undefined, statuses);
    return target ? applyOnto(projection, readings, statuses, receipt, target) : projection;
  }, [readings, target, statuses, receipt]);
  const buildStatus = useMemo(
    () =>
      target && profileObservation?.workspaceId && profileObservation.versionToken
        ? latestBuildStatus(statuses, target, {
            target,
            documentId: profileObservation.documentId,
            workspaceId: profileObservation.workspaceId,
            fileVersion: profileObservation.versionToken,
            reason: "",
          })
        : null,
    [profileObservation, statuses, target],
  );
  const buildReceiptReading = useReading<unknown>(
    !handle.demo && buildStatus ? { kind: "receipts", id: buildStatus.id } : null,
  );
  const buildReceipt = useMemo(
    () =>
      buildStatus ? projectBuildReceipt(previousOf(buildReceiptReading), buildStatus.id) : null,
    [buildReceiptReading, buildStatus],
  );

  const inventory = handle.readings.inventory as Reading<{
    sessions: Parameters<typeof inventoryOf>[0];
  }>;
  const sessions = useMemo(() => inventoryOf(previousOf(inventory)?.sessions ?? []), [inventory]);

  /* ── Derived lane ───────────────────────────────────────────────────────── */
  const review = {
    revision: settingsRevision,
    versionToken: settingsDoc?.basis?.versionToken ?? null,
  };
  const evidence = useMemo((): EvidenceSlice | null => {
    const value = familyDoc.evidence;
    if (!value) return null;
    const session = sessions.find((entry) => entry.sessionId === target?.session);
    const address = session ? documentAddress(session) : null;
    return address ? ((here(value, address) as EvidenceSlice | null) ?? null) : null;
  }, [familyDoc.evidence, sessions, target?.session]);
  const lane = useMemo(
    () => familyLane(snapshot, evidence, fields, familyDoc.doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, evidence, settingsDoc?.fields, familyDoc.doc],
  );
  const saved = useMemo(() => savedFrom(initialDraft(lane.world)), [lane]);
  const draft = useMemo(() => {
    if (editState.draft) return editState.draft;
    const projected = settingsDoc ? settingsWorkSnapshot(settingsDoc, true) : null;
    return initialDraft(familyLane(projected, evidence).world);
  }, [editState.draft, settingsDoc, evidence]);
  const reconciliation = { plan: familyDoc.plan, apply: familyDoc.apply };
  const profile = settingsDoc?.basis?.documentId?.relativePath ?? "";
  /** The verbs read the authored file from the page; an opened settings file names it (a seed
   * names its own, so a demo lane with no settings Work keeps the seeded file). */
  const openedFile = lane.document?.relativePath ?? null;
  useEffect(() => {
    if (openedFile && page.file !== openedFile) setPage({ file: openedFile });
  }, [page.file, openedFile, setPage]);

  /* ── Build ──────────────────────────────────────────────────────────────── */
  const buildFacts: BuildFacts = {
    relativePath: authoringFacts.relativePath,
    versionToken: authoringFacts.versionToken,
    validation: authoringFacts.validation,
    unsavedCount: authoringFacts.unsavedCount,
    stagedCount: authoringFacts.stagedCount,
    boundTarget: targetLabel,
    armedToken: page.buildReview?.fileVersion ?? null,
  };
  const armedBuild: ArmedBuild = page.buildReview
    ? { token: page.buildReview.fileVersion, reason: page.buildReview.reason }
    : null;
  const buildOutcome: BuildRefusal | null =
    handle.outcome?.key === "build" && handle.outcome.refusal
      ? {
          code: handle.outcome.refusal.code === "unknown" ? "unknown" : "host",
          says: handle.outcome.refusal.message,
        }
      : null;

  /* ── The profile picker's option list ───────────────────────────────────── */
  const host = useMemo(() => createLiveFamilyHost(), []);
  const profileCall = useHostCall(
    () => host.profile(targetLabel),
    ["family-profiles", targetLabel],
  );
  const feeds = {
    profile: {
      options: profileCall.data ? profileCall.data.map((id) => ({ id, label: id })) : null,
      state: profileCall.error
        ? ("error" as const)
        : profileCall.isPending
          ? ("loading" as const)
          : ("ready" as const),
      lane: "read" as const,
      stale: false,
    },
  };

  /* ── Staged authored input: coalesced into one settings apply ───────────── */
  const flush = edits.flush;

  /** The one-shot open of the document the route arrived pointing at. */
  const opened = useRef(false);
  useEffect(() => {
    if (!options.initialDocumentId || opened.current || settingsDoc?.basis) return;
    opened.current = true;
    void settingsHandle.actions.open.run({ documentId: options.initialDocumentId });
  }, [options.initialDocumentId, settingsDoc?.basis, settingsHandle.actions.open]);

  const actions = useMemo(
    () => ({
      /** Authored edits are staged into the settings Work; a pointer field refuses locally. */
      setDraft(value: Setter<Draft>): string | void {
        const previous = edits.getSnapshot().draft ?? draft;
        const nextDraft = next(value, previous);
        const raw = snapshot?.rawContent;
        if (lane.document && raw) {
          const authored: unknown = JSON.parse(raw.replace(/^﻿/, ""));
          for (const entry of draftToPatches(lane.document.model, nextDraft, previous)) {
            const pointer = String(entry.path[1]);
            const directives = settingsFieldDirectives(authored, settingsFieldSegments(pointer));
            if (directives) {
              const text = `Edit the shared source for ${pointer}. The profile contains a pointer; no local edit was staged.`;
              patch({
                sharedEdit: { pointer, directives },
                receipt: { verb: "page", text, at: Date.now() },
              });
              return text;
            }
          }
        }
        if (!lane.document) return "Open a valid authored file before editing fields.";
        if (settingsRevision == null) return "Wait for the authored file to finish loading.";
        const patches = draftToPatches(lane.document.model, nextDraft, previous);
        for (const id of nextDraft.cleared.filter((id) => !previous.cleared.includes(id)))
          patches.push({ path: ["fields", id, "proposal"] });
        if (patches.length) setPage({ buildReview: null });
        edits.stage(nextDraft, patches, settingsRevision);
      },
      setOverlay: (value: Setter<Overlay>) =>
        setMemory((c) => ({ ...c, overlay: next(value, c.overlay) })),
      setTable: (value: Setter<MasterTableState>) =>
        setMemory((c) => ({ ...c, table: next(value, c.table) })),
      setDrill: (value: Setter<MasterTableState>) =>
        setMemory((c) => ({ ...c, drill: next(value, c.drill) })),
      setDocMode: (value: Setter<"text" | "sheet">) =>
        setMemory((c) => ({ ...c, docMode: next(value, c.docMode) })),
      setDocZoom: (value: Setter<number>) =>
        setMemory((c) => ({ ...c, docZoom: next(value, c.docZoom) })),
      setDrillType: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, drillType: next(value, c.drillType) })),
      setStageType: (value: Setter<string>) =>
        setMemory((c) => ({ ...c, stageType: next(value, c.stageType) })),
      setFocus: (value: Setter<Focus>) => setMemory((c) => ({ ...c, focus: next(value, c.focus) })),
      setFocusedProposal: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, focusedProposal: next(value, c.focusedProposal) })),
      setPinnedParam: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, pinnedParam: next(value, c.pinnedParam) })),
      setAnatomyCollapsed: (value: Setter<boolean>) =>
        setMemory((c) => ({ ...c, anatomyCollapsed: next(value, c.anatomyCollapsed) })),
      setInspect: (value: Setter<Inspect>) =>
        setMemory((c) => ({ ...c, inspect: next(value, c.inspect) })),
      setBinding: (value: Setter<Binding>) =>
        setMemory((c) => ({ ...c, binding: next(value, c.binding) })),
      setPicker: (value: Setter<PickerState>) =>
        setMemory((c) => ({ ...c, picker: next(value, c.picker) })),
      setStage: (stage: FamilyPage["stage"]) => setPage({ stage }),
      armBuild: () => handle.actions["prepare-build"].run({ reason: "" }),
      cancelBuild: () => handle.actions["cancel-build"].run(),
      setBuildReason: (reason: string) =>
        setPage({
          buildReview: page.buildReview ? { ...page.buildReview, reason } : null,
        }),
      say: (text: string) => patch({ receipt: { verb: "page", text, at: Date.now() } }),
      flush,
      openShared: async (documentId: SettingsDocumentId) => {
        await flush();
        return settingsHandle.actions.open.run({ documentId });
      },
      /** Opening a different authored file is a file-Work navigation, never a doc write. */
      async open(relativePath: string) {
        await flush();
        setPage({ buildReview: null });
        const documentId = { ...FAMILY_MODULE, relativePath };
        if (options.selectFile) return options.selectFile(documentId);
        await settingsHandle.actions.open.run({ documentId });
      },
      refresh: () => settingsHandle.actions.refresh.run(),
      adopt: (_documentId: SettingsDocumentId, versionToken: string) =>
        settingsHandle.actions.adopt.run({ versionToken }),
      async save(reviewed = review) {
        if (edits.getSnapshot().draft) {
          await flush();
          throw Error("Input staged. Review the updated shared candidate before saving.");
        }
        if (reviewed?.revision == null || !reviewed.versionToken)
          return "Review an adopted file before saving.";
        if (!settingsDoc) return "Review an adopted file before saving.";
        const refusal = await settingsHandle.actions.save.run();
        if (refusal) return refusal.message;
        await options.refreshProfile?.();
        return "saved shared settings work";
      },
      capture: () => handle.actions.capture.run({}),
      async build() {
        const result = await handle.actions.build.run();
        return result?.message ?? null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      handle.actions,
      draft,
      lane,
      snapshot,
      settingsRevision,
      settingsHandle.actions,
      flush,
      patch,
      edits,
      editState.draft,
      page.buildReview,
      options.refreshProfile,
      options.selectFile,
    ],
  );
  return {
    handle,
    manifest: routeManifest,
    scope: fileKey,
    // Work + Readings, projected
    ready: familyDoc,
    readings,
    profile,
    target: targetLabel,
    evidence,
    reconciliation,
    routeStage: page.stage,
    lane,
    snapshot,
    review,
    fields,
    saved,
    draft,
    buildFacts,
    buildOutcome,
    buildReceipt,
    // Page memory, flattened
    overlay: memory.overlay,
    table: memory.table,
    drill: memory.drill,
    docMode: memory.docMode,
    docZoom: memory.docZoom,
    drillType: memory.drillType,
    stageType: memory.stageType,
    focus: memory.focus,
    focusedProposal: memory.focusedProposal,
    pinnedParam: memory.pinnedParam,
    anatomyCollapsed: memory.anatomyCollapsed,
    inspect: memory.inspect,
    binding: memory.binding,
    picker: memory.picker,
    armedBuild,
    sharedEdit: memory.sharedEdit,
    receipt: memory.receipt,
    busy: settingsHandle.busy ?? handle.busy,
    failure: editState.failure ?? settingsHandle.failure ?? handle.failure,
    editFailure: editState.failure,
    feeds,
    actions,
  };
}

export type FamilyStore = ReturnType<typeof useFamilyStore>;
