/**
 * Family — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals, the pod and spec selection, and
 * capture/apply live in the route kernel (`route/family/manifest.ts` over `entityRoute`). What is
 * left here is what only Family knows: how the draft (the live reading and its proposals), the
 * capture evidence and the saved member a build needs become one lane, and which selections the
 * sheet holds while it is open.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  actionReceiptSchema,
  familyCaptureSchema,
  familyProjectionSchema,
  memberWork,
  settingsFieldDirectives,
  settingsFieldSegments,
  settingsCandidate,
  transitionPatches,
  type FamilyCapture,
  type FamilyDocument,
  type FamilyDraft,
  type PodMember,
  type Reading,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import type { CellWire } from "#/components/lang/band";
import type { MasterTableState } from "#/components/master-table/model";
import { projectBuildReceipt, type BuildFacts, type BuildRefusal } from "#/family/build";
import type { EvidenceSlice, FamilySnapshot, FieldState } from "#/family/host";
import { familySource } from "#/family/source";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "#/family/model";
import { draftToPatches } from "#/family/project";
import { familyEditBuffer } from "./edit-buffer";
import {
  captureEvidence,
  familyManifest,
  latestApplyStatus,
  latestBuildStatus,
  latestCaptureStatus,
  projectReadings,
  type FamilyAuthoringFacts,
  type FamilyPage,
} from "#/route/family/manifest";
import { previousOf, useReading } from "#/readings";
import { useRoute, type EntityPage } from "#/route";
import { openMember } from "#/route/spec-editor";

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

const absentFacts: FamilyAuthoringFacts = {
  relativePath: null,
  versionToken: null,
  validation: null,
  unsavedCount: 0,
  stagedCount: 0,
  current: false,
};

/* ── Pure projections ──────────────────────────────────────────────────────── */

/** The last succeeded `family.apply` receipt, folded onto the projection. */
export function applyOnto(
  projection: Omit<FamilyDocument, "plan">,
  statuses: unknown,
  receipts: unknown,
  target: { session: string; openId: string },
): Omit<FamilyDocument, "plan"> {
  if (!statuses || !receipts) return projection;
  const status = latestApplyStatus(statuses, target);
  if (!status) return projection;
  const row = actionReceiptSchema
    .array()
    .parse(receipts)
    .find((entry) => entry.id === status.id);
  const step = row?.steps.find(
    (entry) => entry.key === "family.apply" && entry.state === "succeeded",
  );
  if (step?.state === "succeeded")
    projection.apply = familyProjectionSchema.shape.apply.parse(step.result);
  return projection;
}

/** The saved member, as the Settings Work reads it: bytes first, then what the host made of them. */
function useMemberObservation(member: PodMember | null, enabled: boolean) {
  const [reading, setReading] = useState<Reading<SettingsSnapshot>>({ state: "absent" });
  const key = member ? memberWork(member) : null;
  useEffect(() => {
    if (!enabled || !member) return setReading({ state: "absent" });
    let live = true;
    setReading((previous) =>
      previous.state === "ready"
        ? { state: "stale", previous: previous.observation, reason: "dirtied" }
        : { state: "absent" },
    );
    openMember(member).then(
      (observation) => live && setReading({ state: "ready", observation }),
      (cause: unknown) =>
        live &&
        setReading({
          state: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    );
    return () => {
      live = false;
    };
    // `key` is the member's identity; the object is rebuilt every render.
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return reading;
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export function useFamilyStore(options: {
  target?: string | null;
  thread?: string;
  /** The owner's live `pod.list`; the demo lane seeds its own. */
  pods: Reading<unknown>;
  /** Where the route arrived pointing (a deep link from `/pods` or a chat pane). */
  initial?: Partial<EntityPage>;
}) {
  const demo = useMemo(
    () => new URLSearchParams(globalThis.location?.search ?? "").has("demo"),
    [],
  );
  // The build refusals read the member's authored state, which is only known after the member's
  // Work mounts below; the manifest takes the facts one render later.
  const [facts, setFacts] = useState<FamilyAuthoringFacts>(absentFacts);
  const routeManifest = useMemo(() => familyManifest(facts), [facts]);

  // The member the draft was opened from or saved as; only build reads its saved bytes.
  const [pageForMember, setPageForMember] = useState<PodMember | null>(null);
  const observed = useMemberObservation(pageForMember, !demo);
  const provided = useMemo(
    () => (demo ? { pods: options.pods } : { pods: options.pods, profile: observed }),
    [demo, options.pods, observed],
  );
  const handle = useRoute(routeManifest, {
    target: options.target ?? null,
    thread: options.thread,
    page: options.initial as Partial<FamilyPage & EntityPage> | undefined,
    provided,
  });
  const [page, setPage] = handle.page as unknown as readonly [
    FamilyPage & EntityPage,
    (next: Partial<FamilyPage & EntityPage>) => void,
  ];
  const member = useMemo(
    () => (page.pod && page.path ? { pod: page.pod, path: page.path } : null),
    [page.pod, page.path],
  );
  useEffect(() => setPageForMember(member), [member]);

  const profileObservation = previousOf(handle.readings.profile as Reading<SettingsSnapshot>);
  // The draft: the live reading and the proposals on it, as the route's Work.
  const draftDoc = handle.work.doc as FamilyDraft | null;
  const draftRevision = handle.work.revision;
  /** The person's input stays buffered until Work accepts its original-revision write. */
  const edits = useMemo(
    () =>
      familyEditBuffer(handle.work.key, async (patches, revision) => {
        if (!draftDoc) throw Error("Read the family first.");
        return handle.work.write(
          patches.map((patch) => ({ ...patch, path: ["cells", ...patch.path.slice(1)] })),
          revision,
        );
      }),
    [handle.work, draftDoc],
  );
  const editState = useSyncExternalStore(edits.subscribe, edits.getSnapshot, edits.getSnapshot);
  useEffect(() => {
    if (draftRevision != null) edits.observe(draftRevision);
  }, [edits, draftRevision]);
  const flush = edits.flush;
  const fields = (draftDoc?.cells ?? {}) as Record<string, FieldState>;
  const draftSnapshot = useCallback(
    (staged: boolean): FamilySnapshot | null => {
      if (draftDoc?.reading == null) return null;
      try {
        const rawContent = staged
          ? settingsCandidate(draftDoc.reading, draftDoc.cells)
          : draftDoc.reading;
        return {
          ...(member ? { member } : {}),
          sha256: null,
          rawContent,
          composedContent: rawContent,
          validation: { isValid: true, issues: [] },
        };
      } catch (error) {
        return {
          ...(member ? { member } : {}),
          sha256: null,
          rawContent: draftDoc.reading,
          composedContent: null,
          validation: {
            isValid: false,
            issues: [
              {
                message: error instanceof Error ? error.message : String(error),
                severity: "error",
                path: "$",
              },
            ],
          },
        };
      }
    },
    [draftDoc, member],
  );
  const snapshot = useMemo(() => draftSnapshot(false), [draftSnapshot]);
  const authored = useMemo(
    (): unknown => (snapshot?.rawContent ? JSON.parse(snapshot.rawContent.replace(/^﻿/, "")) : null),
    [snapshot],
  );
  /** Every Family cell's accept, deny and unstage: one wire over the draft Work's `cells`. */
  const wire = useMemo(
    (): CellWire => ({
      segment: "cells",
      revision: draftRevision,
      // Buffered typing lands first; a bound verb rendered before it then refuses as stale.
      write: async (patches, revision) => {
        await flush();
        return handle.work.write(patches, revision);
      },
      lockOf: familyLockOf(authored),
    }),
    [handle.work, draftRevision, flush, authored],
  );
  const authoredLane = useMemo(() => familySource(snapshot, null, fields), [snapshot, fields]);
  const authoredDraft = useMemo(
    () => initialDraft(familySource(draftSnapshot(true), null).world),
    [draftSnapshot],
  );
  const authoringFacts = useMemo(
    (): FamilyAuthoringFacts => ({
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
      current: handle.work.current,
    }),
    [authoredLane, authoredDraft, fields, snapshot?.validation, handle.work.current],
  );
  useEffect(() => {
    setFacts((previous) =>
      JSON.stringify(previous) === JSON.stringify(authoringFacts) ? previous : authoringFacts,
    );
  }, [authoringFacts]);

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
  const receiptOf = (id: string | undefined) =>
    !handle.demo && id ? ({ kind: "receipts", id } as const) : null;
  const applyStatus = useMemo(
    () => (target ? latestApplyStatus(statuses, target) : null),
    [statuses, target],
  );
  const applyReceipt = previousOf(useReading<unknown>(receiptOf(applyStatus?.id)));
  const captureStatus = useMemo(
    () => (target ? latestCaptureStatus(statuses, target) : null),
    [statuses, target],
  );
  const captureReceipt = previousOf(useReading<unknown>(receiptOf(captureStatus?.id)));
  const familyDoc = useMemo(() => {
    const projection = projectReadings(readings, target ?? undefined);
    return target ? applyOnto(projection, statuses, applyReceipt, target) : projection;
  }, [readings, target, statuses, applyReceipt]);
  const buildStatus = useMemo(
    () =>
      target && profileObservation?.sha256
        ? latestBuildStatus(statuses, target, {
            target,
            source: { ...profileObservation.member, sha256: profileObservation.sha256 },
            reason: "",
          })
        : null,
    [profileObservation, statuses, target],
  );
  const buildReceiptReading = useReading<unknown>(receiptOf(buildStatus?.id));
  const buildReceipt = useMemo(
    () =>
      buildStatus ? projectBuildReceipt(previousOf(buildReceiptReading), buildStatus.id) : null,
    [buildReceiptReading, buildStatus],
  );

  /* ── Derived lane ───────────────────────────────────────────────────────── */
  const review = { revision: draftRevision };
  /**
   * What the latest capture from this document saw — coverage and unmodeled facts — shown beside
   * the member it filed. Another member's capture is not this member's evidence.
   */
  const captured = useMemo(
    () => (captureStatus ? captureEvidence(captureReceipt, captureStatus.id) : null),
    [captureReceipt, captureStatus],
  );
  const evidence = useMemo((): EvidenceSlice | null => {
    if (!captured || !member) return null;
    if (captured.member.pod !== member.pod || captured.member.path !== member.path) return null;
    // captureStatus is already this exact document lifetime; a family may have no path.
    return captured.evidence;
  }, [captured, member]);
  const lane = useMemo(
    () => familySource(snapshot, evidence, fields, familyDoc.doc),
    [snapshot, evidence, fields, familyDoc.doc],
  );
  const saved = useMemo(() => savedFrom(initialDraft(lane.world)), [lane]);
  const draft = useMemo(
    () => editState.draft ?? initialDraft(familySource(draftSnapshot(true), evidence).world),
    [editState.draft, draftSnapshot, evidence],
  );
  const profile = member?.path ?? "";

  /* ── Build ──────────────────────────────────────────────────────────────── */
  const buildFacts: BuildFacts = {
    relativePath: authoringFacts.relativePath,
    versionToken: authoringFacts.versionToken,
    validation: authoringFacts.validation,
    unsavedCount: authoringFacts.unsavedCount,
    stagedCount: authoringFacts.stagedCount,
    boundTarget: targetLabel,
    armedToken: page.buildReview?.source.sha256 ?? null,
  };
  const armedBuild: ArmedBuild = page.buildReview
    ? { token: page.buildReview.source.sha256, reason: page.buildReview.reason }
    : null;
  const buildOutcome: BuildRefusal | null =
    handle.outcome?.key === "build" && handle.outcome.refusal
      ? {
          code: handle.outcome.refusal.code === "unknown" ? "unknown" : "host",
          says: handle.outcome.refusal.message,
        }
      : null;

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
        if (!lane.document) return "Read the family before editing fields.";
        const patches = draftToPatches(lane.document.model, nextDraft, previous);
        // A cleared proposal is a deny: the edit buffer binds it to the revision it was seen at.
        for (const id of nextDraft.cleared.filter((id) => !previous.cleared.includes(id)))
          patches.push(...transitionPatches(["fields"], id, fields[id] ?? {}, { kind: "deny" }));
        if (draftRevision == null) return "Wait for the draft to finish loading.";
        if (patches.length) setPage({ buildReview: null });
        edits.stage(nextDraft, patches, draftRevision);
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
      armBuild: () => handle.actions["prepare-build"].run({ reason: "" }),
      cancelBuild: () => handle.actions["cancel-build"].run(),
      setBuildReason: (reason: string) =>
        setPage({
          buildReview: page.buildReview ? { ...page.buildReview, reason } : null,
        }),
      say: (text: string) => patch({ receipt: { verb: "page", text, at: Date.now() } }),
      flush,
      /** Re-read the open family into the draft; the proposals stay on it. */
      read: () => handle.actions.read.run(),
      /** Opening a saved member puts its bytes in the draft as the reading; the page names it. */
      async open(next: PodMember) {
        await flush();
        const { rawContent } = await openMember(next);
        await handle.work.write([{ path: ["reading"], value: rawContent }]);
        setPage({ pod: next.pod, path: next.path, buildReview: null });
      },
      /** Capture files a new member (the kernel lands the page on it) and returns its evidence. */
      capture: () => handle.actions.capture.run(),
      async build() {
        const result = await handle.actions.build.run();
        return result?.message ?? null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      handle.actions,
      handle.work,
      draft,
      lane,
      snapshot,
      draftRevision,
      edits,
      editState.draft,
      flush,
      patch,
      page.buildReview,
    ],
  );
  return {
    handle,
    manifest: routeManifest,
    demo,
    member,
    // Work + Readings, projected
    ready: familyDoc,
    readings,
    profile,
    target: targetLabel,
    evidence,
    captured,
    reconciliation: { apply: familyDoc.apply },
    lane,
    snapshot,
    review,
    fields,
    wire,
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
    busy: handle.busy,
    failure: editState.failure ?? handle.failure,
    editFailure: editState.failure,
    actions,
  };
}

export type FamilyStore = ReturnType<typeof useFamilyStore>;

/** A field inside a shared-source pointer is locked: the profile holds the pointer, not the value. */
export const familyLockOf =
  (authored: unknown) =>
  (key: string): string | null =>
    authored != null && settingsFieldDirectives(authored, settingsFieldSegments(key))
      ? `${key} points to a shared source — edit that source instead`
      : null;
