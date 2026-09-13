/**
 * Family — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Readings and the four verbs live in `family/manifest.ts`. What is left here
 * is what only Family knows: how the settings Work and the family Readings become one lane, and
 * which page selections the sheet holds while it is open. Plain values — no atoms, no `Scope`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  actionReceiptSchema,
  actionStatusSchema,
  familyCaptureSchema,
  familyProjectionSchema,
  here,
  settingsFieldDirectives,
  settingsFieldSegments,
  settingsRouteState,
  settingsWorkSnapshot,
  type ActionListFilter,
  type FamilyCapture,
  type FamilyDocument,
  type Reading,
  type RouteStatePatch,
  type SettingsDocumentId,
  type SettingsRouteDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import {
  BUILD_OUTCOME_UNKNOWN,
  buildRefusals,
  readBuildReceipt,
  type BuildFacts,
  type BuildRefusal,
} from "#/family/build";
import { FAMILY_MODULE, createLiveFamilyHost, type EvidenceSlice, type FieldState } from "#/family/host";
import { saveSettingsAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { familyLane } from "#/family/lane";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "#/family/model";
import { draftToPatches } from "#/family/project";
import { manifest } from "#/family/manifest";
import { documentAddress, previousOf, useHostCall, useInventory, inventoryOf } from "#/readings";
import { appAtomRegistry, docAtom, docWriter, useRoute } from "#/route";

type Setter<A> = A | ((previous: A) => A);
const next = <A,>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;

export type Inspect = { kind: "part"; slug: string } | { kind: "param"; name: string } | null;
export type Binding = { slug: string; property: string } | null;
export type ArmedBuild = { token: string | null; reason: string } | null;
export type PickerState = { open: string | null; level: string | null; query: string };

const emptyTable = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

/* ── Page memory ───────────────────────────────────────────────────────────── */

export interface FamilyPageMemory {
  readonly stage: "author" | "evidence";
  readonly inputBuffer: Draft | null;
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
  readonly armedBuild: ArmedBuild;
  readonly sharedEdit: { pointer: string; directives: string[] } | null;
  readonly receipt: { verb: string; text: string; at: number } | null;
}

export interface FamilyPageSeed {
  readonly inputBuffer?: Draft | null;
  readonly armed?: boolean;
}

const initialMemory = (seed?: FamilyPageSeed): FamilyPageMemory => ({
  stage: "author",
  inputBuffer: seed?.inputBuffer ?? null,
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
  armedBuild: seed?.armed ? { token: null, reason: "Demo build uses simulated native output" } : null,
  sharedEdit: null,
  receipt: null,
});

/* ── Pure projections ──────────────────────────────────────────────────────── */

/**
 * The family Readings, folded newest-last into one document. A live capture from another open
 * document is skipped: evidence belongs to the lifetime that produced it.
 */
export function projectReadings(
  rows: readonly FamilyCapture[],
  target?: { session: string; openId: string },
): FamilyDocument {
  const result: FamilyDocument = { bindings: {} };
  for (const capture of [...rows].reverse()) {
    if (
      capture.provenance.kind === "live" &&
      (!target ||
        capture.provenance.target.session !== target.session ||
        capture.provenance.target.openId !== target.openId)
    )
      continue;
    if (capture.reading.kind === "legacy") {
      const envelope = capture.reading.value as { doc?: FamilyDocument };
      // Parsed citation IDs survive migration. Legacy native evidence is in the archive only.
      if (envelope.doc?.doc) result.doc = envelope.doc.doc;
    } else if (capture.reading.kind === "spec")
      result.doc = familyProjectionSchema.shape.doc.parse(capture.reading.value);
    else if (capture.reading.kind === "capture" && capture.provenance.kind === "live") {
      result.evidence = familyProjectionSchema.shape.evidence.parse(capture.reading.value);
      result.plan = null;
    } else if (capture.reading.kind === "plan" && capture.provenance.kind === "live")
      result.plan = { ...capture.reading.value, captureId: capture.id };
  }
  return result;
}

/** The last succeeded `family.apply` receipt, folded onto the projection. */
export function applyOnto(
  projection: FamilyDocument,
  rows: readonly FamilyCapture[],
  statuses: unknown,
  receipts: unknown,
  target: { session: string; openId: string },
): FamilyDocument {
  if (!statuses || !receipts) return projection;
  const status = actionStatusSchema
    .array()
    .parse(statuses)
    .filter(
      (row) =>
        row.key === "family.apply" && rows.some((capture) => capture.id === row.request.planId),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!status) return projection;
  const row = actionReceiptSchema
    .array()
    .parse(receipts)
    .find((entry) => entry.id === status.id);
  if (!row) return projection;
  if (
    row.destination.kind !== "document" ||
    row.destination.ref.session !== target.session ||
    row.destination.ref.openId !== target.openId
  )
    return projection;
  const step = row.steps.find(
    (entry) => entry.key === "familyfoundry.apply" && entry.state === "succeeded",
  );
  if (step?.state === "succeeded") {
    projection.apply = familyProjectionSchema.shape.apply.parse(step.result);
    if (projection.plan?.captureId === row.request.planId) projection.plan = null;
  }
  return projection;
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export function useFamilyStore(options: {
  target?: string;
  /** The settings file Work this page edits; `?mode=file` names it, the route resolves it. */
  fileKey: WorkKey;
  selectFile?: (documentId: SettingsDocumentId) => Promise<void>;
  initialDocumentId?: SettingsDocumentId;
  pageSeed?: FamilyPageSeed;
}) {
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
  });
  const [memory, setMemory] = useState<FamilyPageMemory>(() => initialMemory(options.pageSeed));
  const patch = useCallback(
    (value: Partial<FamilyPageMemory>) => setMemory((current) => ({ ...current, ...value })),
    [],
  );

  const target =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const targetLabel = target?.session ?? "";

  /* ── Settings Work: the authored family JSON this page edits ─────────────── */
  const fileKey = options.fileKey;
  const settingsSlice = useMemo(() => docAtom(settingsRouteState, fileKey), [fileKey]);
  const settingsReading = useAtomValue(settingsSlice);
  const settingsSlot = previousOf(settingsReading) ?? { doc: null, revision: null };
  const settingsDoc = (settingsSlot.doc ?? null) as SettingsRouteDocument | null;
  const writer = useMemo(
    () => docWriter(settingsRouteState, fileKey, appAtomRegistry, settingsSlice),
    [fileKey, settingsSlice],
  );

  /* ── Family Readings ────────────────────────────────────────────────────── */
  const familyReading = handle.readings.family as Reading<unknown>;
  const readings: FamilyCapture[] = useMemo(() => {
    const raw = previousOf(familyReading);
    return raw ? familyCaptureSchema.array().parse(raw) : [];
  }, [familyReading]);
  const receiptsRaw = previousOf(handle.readings.receipts as Reading<unknown>);
  const familyDoc = useMemo(() => {
    const projection = projectReadings(readings, target ?? undefined);
    return target ? applyOnto(projection, readings, receiptsRaw, receiptsRaw, target) : projection;
  }, [readings, target, receiptsRaw]);

  const inventory = useInventory();
  const sessions = useMemo(
    () => inventoryOf(previousOf(inventory)?.sessions ?? []),
    [inventory],
  );

  /* ── Derived lane ───────────────────────────────────────────────────────── */
  const snapshot = useMemo(
    () => (settingsDoc ? settingsWorkSnapshot(settingsDoc) : null),
    [settingsDoc],
  );
  const fields = (settingsDoc?.fields ?? {}) as Record<string, FieldState>;
  const review = {
    revision: settingsSlot.revision,
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
    if (memory.inputBuffer) return memory.inputBuffer;
    const projected = settingsDoc ? settingsWorkSnapshot(settingsDoc, true) : null;
    return initialDraft(familyLane(projected, evidence).world);
  }, [memory.inputBuffer, settingsDoc, evidence]);
  const reconciliation = { plan: familyDoc.plan, apply: familyDoc.apply };
  const profile = settingsDoc?.basis?.documentId?.relativePath ?? "";

  const actionScope = useMemo((): ActionListFilter | null => {
    const workspaceId = (fileKey as { workspaceId?: unknown }).workspaceId;
    if (typeof workspaceId !== "string") return null;
    return target
      ? { kind: "family", workspaceId, target }
      : { kind: "family-file", workspaceId };
  }, [fileKey, target]);

  /* ── Build ──────────────────────────────────────────────────────────────── */
  const buildFacts: BuildFacts = {
    relativePath: lane.document?.relativePath ?? null,
    versionToken: lane.document?.versionToken ?? null,
    validation: lane.document ? (snapshot?.validation ?? null) : null,
    unsavedCount: lane.document
      ? draftToPatches(lane.document.model, draft, initialDraft(lane.world)).length
      : 0,
    stagedCount: Object.values(fields).filter((field) => field.staged != null).length,
    boundTarget: targetLabel,
    armedToken: memory.armedBuild?.token ?? null,
  };
  const buildRefusal = () => {
    const refusals = buildRefusals(buildFacts);
    return refusals.length
      ? refusals.map((refusal) => refusal.says).join(" · ")
      : memory.armedBuild == null
        ? "arm build .rfa in the sheet pane first"
        : null;
  };
  const buildOutcome: BuildRefusal | null =
    handle.failure && handle.busy === null && memory.receipt?.verb !== "build"
      ? null
      : memory.receipt?.verb === "build" && memory.receipt.text === BUILD_OUTCOME_UNKNOWN
        ? { code: "unknown", says: BUILD_OUTCOME_UNKNOWN }
        : null;

  /* ── The profile picker's option list ───────────────────────────────────── */
  const host = useMemo(() => createLiveFamilyHost(), []);
  const profileCall = useHostCall(() => host.profile(targetLabel), ["family-profiles", targetLabel]);
  const feeds = {
    profile: {
      options: profileCall.data ? profileCall.data.map((id) => ({ id, label: id })) : null,
      state: profileCall.error ? ("error" as const) : profileCall.isPending ? ("loading" as const) : ("ready" as const),
      lane: "read" as const,
      stale: false,
    },
  };

  /* ── Staged authored input: coalesced into one settings apply ───────────── */
  const pending = useRef(new Map<string, RouteStatePatch>());
  const pendingRevision = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    if (!pending.current.size) return;
    const patches = [...pending.current.values()];
    pending.current.clear();
    await writer.apply(patches, pendingRevision.current);
    pendingRevision.current = undefined;
    setMemory((current) => ({ ...current, inputBuffer: null }));
  }, [writer]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  /** The one-shot open of the document the route arrived pointing at. */
  const opened = useRef(false);
  useEffect(() => {
    if (!options.initialDocumentId || opened.current || settingsDoc?.basis) return;
    opened.current = true;
    void writer.command("open", { documentId: options.initialDocumentId });
  }, [options.initialDocumentId, settingsDoc?.basis, writer]);

  const actions = useMemo(
    () => ({
      /** Authored edits are staged into the settings Work; a pointer field refuses locally. */
      setDraft(value: Setter<Draft>): string | void {
        const previous = draft;
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
        if (pendingRevision.current === undefined)
          pendingRevision.current = settingsSlot.revision ?? undefined;
        for (const entry of draftToPatches(lane.document.model, nextDraft, previous))
          pending.current.set(JSON.stringify(entry.path), entry);
        for (const id of nextDraft.cleared.filter((id) => !previous.cleared.includes(id)))
          pending.current.set(JSON.stringify(["fields", id, "proposal"]), {
            path: ["fields", id, "proposal"],
          });
        patch({ inputBuffer: nextDraft });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 150);
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
      setStage: (stage: "author" | "evidence") => patch({ stage }),
      armBuild: () =>
        patch({ armedBuild: { token: lane.document?.versionToken ?? null, reason: "" } }),
      cancelBuild: () => patch({ armedBuild: null, receipt: null }),
      setBuildReason: (reason: string) =>
        setMemory((c) => ({ ...c, armedBuild: c.armedBuild ? { ...c.armedBuild, reason } : null })),
      say: (text: string) => patch({ receipt: { verb: "page", text, at: Date.now() } }),
      flush,
      openShared: (documentId: SettingsDocumentId) => writer.command("open", { documentId }),
      /** Opening a different authored file is a file-Work navigation, never a doc write. */
      async open(relativePath: string) {
        await flush();
        const documentId = { ...FAMILY_MODULE, relativePath };
        if (options.selectFile) return options.selectFile(documentId);
        await writer.command("open", { documentId });
      },
      refresh: () => writer.command("refresh"),
      adopt: (documentId: SettingsDocumentId, versionToken: string) =>
        writer.command("adopt", { documentId, versionToken }),
      async save(reviewed = review) {
        if (pending.current.size || memory.inputBuffer) {
          await flush();
          throw Error("Input staged. Review the updated shared candidate before saving.");
        }
        if (reviewed?.revision == null || !reviewed.versionToken)
          return "Review an adopted file before saving.";
        if (!settingsDoc) return "Review an adopted file before saving.";
        await saveSettingsAction(fileKey, settingsDoc, reviewed.revision);
        return "saved shared settings work";
      },
      plan: () =>
        handle.actions.plan.run({
          documentId: { ...FAMILY_MODULE, relativePath: lane.document?.relativePath ?? "" },
        }),
      apply: () =>
        handle.actions.apply.run({
          planId: reconciliation.plan?.captureId,
          expectedPlanHash: reconciliation.plan?.entry.planHash ?? "",
        }),
      capture: () => handle.actions.capture.run({}),
      async build() {
        const refusal = buildRefusal();
        if (refusal) {
          patch({ receipt: { verb: "build", text: refusal, at: Date.now() } });
          return refusal;
        }
        const result = await handle.actions.build.run({
          documentId: { ...FAMILY_MODULE, relativePath: lane.document?.relativePath ?? "" },
        });
        const receipt = readBuildReceipt(result);
        if (receipt == null) {
          patch({ receipt: { verb: "build", text: BUILD_OUTCOME_UNKNOWN, at: Date.now() } });
          return BUILD_OUTCOME_UNKNOWN;
        }
        patch({ armedBuild: null });
        return `built ${receipt.rfaPath}`;
      },
      /** Rebinding the target is a `?target` navigation; the route owns it, not the store. */
      bind: (_target: string) => Promise.resolve(null),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle.actions, draft, lane, snapshot, settingsSlot.revision, writer, flush, patch, memory.inputBuffer],
  );
  return {
    handle,
    manifest,
    scope: fileKey,
    // Work + Readings, projected
    ready: familyDoc,
    readings,
    profile,
    target: targetLabel,
    actionScope,
    evidence,
    reconciliation,
    routeStage: memory.stage,
    lane,
    snapshot,
    review,
    fields,
    saved,
    draft,
    buildFacts,
    buildOutcome,
    buildRefusal,
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
    armedBuild: memory.armedBuild,
    sharedEdit: memory.sharedEdit,
    receipt: memory.receipt,
    busy: handle.busy,
    failure: handle.failure,
    feeds,
    actions,
  };
}

export type FamilyStore = ReturnType<typeof useFamilyStore>;
