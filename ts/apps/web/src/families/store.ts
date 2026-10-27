/**
 * Families — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Work doc, the Readings and the two applies live in `families/manifest.ts`.
 * What is left here is the last apply receipt and page memory. Plain values, no atoms.
 */
import { frozenDemo } from "#/host/demo-client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  actionReceiptSchema,
  actionStatusSchema,
  familyCellKey,
  type ActionStatus,
  type AppliedFilter,
  type FamilyCellAddress,
  type FamilyCellState,
  type FamilyCellValue,
  stagedFilter,
  type FamiliesRouteDocument,
  type FamilyExclusions,
  type FamiliesMatrixEnvelope,
  type Reading,
  transitionPatches,
  workKey,
} from "@pe/agent-contracts";
import { z } from "zod";

import type { CellWire } from "#/components/work/band";
import type { TableState } from "@pe/kit/table/model";
import { useHostCall, previousOf, useReading } from "#/readings";
import { useRoute, type EntityPage } from "#/route";
import type { PageMove } from "#/route/manifest";
import { usePodList } from "#/route/pods";
import {
  archivedFamiliesObservation,
  progressiveFamiliesObservation,
  archivedFamiliesObservations,
  createLiveFamiliesHost,
  latestFamiliesObservation,
  type FamiliesDraft,
} from "#/families/host";
import { manifest, type FamiliesPage } from "#/families/manifest";
import { applyResults } from "./apply-outcome";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
};

/** A picker's open level and typed text: a popup gesture, never an address. */
const EMPTY_PICKER: PickerState = { open: null, level: null, query: "" };

const NO_EXCLUDED: FamilyExclusions = {};
const NO_CELLS: Record<string, FamilyCellState> = {};

type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;

/** The option-list shape the pickers read. `feed()` and its `Atom.swr` runtime are deleted. */
export interface OptionList {
  readonly options:
    | readonly { id: string; label: string; categoryName?: string | null; sub?: string }[]
    | null;
  readonly state: "loading" | "ready" | "error";
  readonly lane: "read";
  readonly stale: boolean;
}

const asFeed = (call: {
  data?:
    | readonly string[]
    | readonly { id: string; label: string; categoryName: string | null; sub?: string }[];
  error?: Error;
  isPending: boolean;
}): OptionList => ({
  options: call.data
    ? call.data.map((value) => (typeof value === "string" ? { id: value, label: value } : value))
    : null,
  state: call.error ? "error" : call.isPending ? "loading" : "ready",
  lane: "read",
  stale: false,
});

/* ── Pure projections ──────────────────────────────────────────────────────── */

const latestStatusOf = (statuses: unknown, key: ActionStatus["key"]) =>
  statuses
    ? (actionStatusSchema
        .array()
        .parse(statuses)
        .filter((entry) => entry.key === key && entry.state === "succeeded")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null)
    : null;
const latestApplyStatusOf = (statuses: unknown) => latestStatusOf(statuses, "families.apply");

/** The last succeeded `families.apply` receipt, projected. Never Work: the receipt is the record. */
function applyDataOf(statuses: unknown, receipts: unknown) {
  const row = latestApplyStatusOf(statuses);
  if (!row || !receipts) return null;
  const parsed = actionReceiptSchema
    .array()
    .parse(receipts)
    .find((entry) => entry.id === row.id);
  if (parsed?.state !== "succeeded") return null;
  const results = applyResults(parsed.result);
  const ffReceipts = results.flatMap((result) => result.native.receipts);
  return {
    actionId: parsed.id,
    appliedAt: parsed.startedAt,
    diagnostics: results.flatMap((result) => result.native.diagnostics),
    receipts: ffReceipts,
    artifacts: [
      ...new Set(
        ffReceipts.flatMap((entry) => (entry.artifactDirectory ? [entry.artifactDirectory] : [])),
      ),
    ],
  };
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export function useFamiliesStore(
  options: { target?: string; thread?: string; url?: boolean } = {},
) {
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
    thread: options.thread,
    provided: { pods },
    url: options.url ?? false,
  });
  const [picker, setPickerState] = useState<PickerState>(EMPTY_PICKER);
  // The draft is Page: the verbs read it off `ctx.page`. The table view and History's pick are
  // contract fields (`routeAddress("families")`): a link reopens them and Pea sets them.
  const page = handle.page[0] as FamiliesPage & EntityPage;
  const setPage = handle.page[1] as (
    next: Partial<FamiliesPage & EntityPage>,
    move?: PageMove<FamiliesPage & EntityPage>,
  ) => void;
  const table = useMemo(
    (): TableState => ({ sorts: page.sort, query: page.query, hiddenColumns: page.hidden }),
    [page.sort, page.query, page.hidden],
  );
  const draft = page.draft;
  const draftTouched = useRef(false);
  const archiveListCall = useHostCall(
    archivedFamiliesObservations,
    ["families-archive-list"],
    page.stage === "history",
  );
  const archiveList = archiveListCall.data ?? [];
  const selectedArchiveId = page.past || (archiveList[0]?.id ?? null);
  const archiveCall = useHostCall(
    () => archivedFamiliesObservation(selectedArchiveId!),
    ["families-archive", selectedArchiveId],
    page.stage === "history" && selectedArchiveId !== null,
  );

  const host = useMemo(() => createLiveFamiliesHost(), []);
  const documentTarget =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const target = documentTarget?.session ?? "";
  const documentScope = useMemo(
    () =>
      documentTarget
        ? { bridgeSessionId: documentTarget.session, openDocumentId: documentTarget.openId }
        : undefined,
    [documentTarget?.session, documentTarget?.openId],
  );

  const doc = handle.work.doc as FamiliesRouteDocument | null;
  const retainedCall = useHostCall(
    () => latestFamiliesObservation(handle.work.key),
    ["families-retained", workKey(handle.work.key)],
    documentTarget !== null && page.stage !== "history",
  );
  const retainedReading = retainedCall.data ?? null;
  useEffect(() => {
    if (
      page.stage === "history" ||
      !retainedReading ||
      handle.busy ||
      retainedReading.document.session !== documentTarget?.session ||
      retainedReading.document.openId !== documentTarget.openId ||
      (page.reading &&
        page.reading.document.session === documentTarget.session &&
        page.reading.document.openId === documentTarget.openId)
    )
      return;
    setPage({
      reading: retainedReading,
      ...(!draftTouched.current &&
      !draft.categories.length &&
      draft.families === null &&
      draft.placement === "PlacedOnly"
        ? {
            draft: {
              categories: [...retainedReading.filter.categoryNames],
              families: retainedReading.filter.familyNames.length
                ? [...retainedReading.filter.familyNames]
                : null,
              placement: retainedReading.filter.placementScope,
            },
          }
        : {}),
    });
  }, [
    retainedReading,
    documentTarget?.session,
    documentTarget?.openId,
    page.reading,
    page.stage,
    draft,
    setPage,
    handle.busy,
  ]);
  // Progress moves the compact envelope; immutable family bodies stay on the host.
  const bodyVersion =
    (previousOf(handle.readings.matrix as Reading<unknown>) as FamiliesMatrixEnvelope | undefined)
      ?.bodyVersion ?? null;
  useEffect(() => {
    if (!bodyVersion || bodyVersion === page.reading?.id || page.stage === "history") return;
    let live = true;
    // A failed fetch leaves the matrix on its last body; the envelope still says it moved.
    const current = page.reading;
    // The parts door answers completed readings whole and progress revisions by new records only.
    void progressiveFamiliesObservation(bodyVersion).then(
      (reading) => {
        if (
          !live ||
          reading.document.session !== documentTarget?.session ||
          reading.document.openId !== documentTarget.openId ||
          (current?.progress?.state === "reading" &&
            reading.progress?.runId !== current.progress.runId) ||
          (current?.progress &&
            reading.progress?.runId === current.progress.runId &&
            (reading.progress.completed < current.progress.completed ||
              (current.progress.state !== "reading" && reading.progress.state === "reading"))) ||
          (current && !current.id.startsWith("pending-") && reading.capturedAt < current.capturedAt)
        )
          return;
        setPage({ reading });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [
    bodyVersion,
    page.reading?.id,
    page.stage,
    documentTarget?.session,
    documentTarget?.openId,
    setPage,
  ]);
  // One shared empty list while Work is null: `actions` memoizes on it, and a fresh `[]` per
  // render would rebuild the controller on every pass.
  const excluded = doc?.excluded ?? NO_EXCLUDED;
  const cells = doc?.cells ?? NO_CELLS;
  /*
   * Every cell verb is one transition of the shared cell machine over this one wire: the cell's
   * own controls (`reviewTransitions`) and any aggregate (`runFanOut`) write through it, and bound
   * kinds carry the rendered revision. The workspace adds the matrix's lock facts (`lockOf`).
   */
  const wire = useMemo(
    (): CellWire => ({
      segment: "cells",
      revision: handle.work.revision,
      write: handle.work.write,
    }),
    [handle.work.revision, handle.work.write],
  );
  const applied = doc ? stagedFilter(doc) : null;

  // The confirmed plan is the kernel's sheet: it lives exactly as long as the sheet is open.
  const plan = page.sheet;
  const receipts = handle.readings.receipts as Reading<unknown>;
  const receiptStatuses = previousOf(receipts);
  const applyStatus = useMemo(() => latestApplyStatusOf(receiptStatuses), [receiptStatuses]);
  const applyReceipt = useReading(
    !handle.demo && applyStatus ? { kind: "receipts", id: applyStatus.id } : null,
  );
  const applyData = useMemo(() => {
    return applyDataOf(receiptStatuses, previousOf(applyReceipt));
  }, [receiptStatuses, applyReceipt]);
  /*
   * Keyed on the ref's strings, never the ref: the resolution rebuilds it whenever the inventory
   * reading moves, and a catalog dispatch moves it, so an object key re-read on its own result.
   */
  const categoryCall = useHostCall(
    () => host.categories(documentTarget!),
    ["categories", documentTarget?.session, documentTarget?.openId],
    documentTarget !== null && page.stage !== "history",
  );
  // Listed once per document (ruling 42); the draft's categories and placement filter it here.
  const familyCall = useHostCall(
    () => host.families(documentTarget!),
    ["families", documentTarget?.session, documentTarget?.openId],
    documentTarget !== null && page.stage !== "history",
  );
  const categoryKey = draft.categories.join("|");
  // FOOTGUN: base-ui `Combobox items` must keep identity between renders; a fresh `options`
  // array each render re-runs its store effect and React throws "Maximum update depth exceeded".
  const feeds = useMemo(
    () => ({
      category: asFeed(categoryCall),
      family: asFeed({
        ...familyCall,
        data: draft.categories.length
          ? familyCall.data
              ?.filter(
                (family) =>
                  draft.categories.includes(family.categoryName ?? "") &&
                  (draft.placement === "AllLoaded" ||
                    (draft.placement === "PlacedOnly") === family.placedInstanceCount > 0),
              )
              .map((family) => ({ ...family, sub: `${family.placedInstanceCount} placed` }))
          : undefined,
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the call objects are rebuilt each render; their fields are the identity
    [
      categoryCall.data,
      categoryCall.error,
      categoryCall.isPending,
      familyCall.data,
      familyCall.error,
      familyCall.isPending,
      categoryKey,
      draft.placement,
    ],
  );

  /*
   * What the old Work held back, as the catalog names each id now (null: no longer loaded). Read
   * while the Work is unreadable (the start-fresh confirm shows it) and while the fresh page's
   * offer is open. Human-only on the host; read-only here: nothing carries over without a press.
   */
  const unreadable = handle.work.startFresh !== null;
  const salvage = handle.work.salvage;
  const salvaged = useHostCall(
    async (): Promise<Salvaged> => {
      const got = await salvage!();
      const { familyNames, familyIds, scope } = salvageSchema.parse(got?.value ?? {});
      const names = familyIds.length ? await host.namesById(documentTarget!) : new Map();
      return {
        rows: [
          ...familyNames.map((name) => ({ id: null, name })),
          ...familyIds.map((id) => ({ id, name: names.get(id) ?? null })),
        ],
        scope: (scope as AppliedFilter | undefined) ?? null,
      };
    },
    ["salvage", documentTarget?.session, documentTarget?.openId, unreadable, page.carryOver],
    salvage !== null &&
      documentTarget !== null &&
      page.stage !== "history" &&
      (unreadable || page.carryOver),
  );

  // The offer lasts until pressed, dismissed, or the next plan (journeys' ruling).
  useEffect(() => {
    if (page.sheet && page.carryOver) setPage({ carryOver: false });
  }, [page.sheet, page.carryOver, setPage]);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const actions = useMemo(
    () => ({
      /** Start fresh landed: the fresh page offers what the old Work held back. */
      startedFresh: () => setPage({ carryOver: true }),
      dismissCarryOver: () => setPage({ carryOver: false }),
      /**
       * The person's one press, one human write: the old scope edit again (when it had one), and
       * the old exclusions that still name a family held back again, as theirs (authority's ruling).
       */
      restore: async ({ rows, scope }: Salvaged) => {
        const names = [
          ...new Set(
            rows.flatMap((row) =>
              row.name && !Object.hasOwn(excluded, row.name) ? [row.name] : [],
            ),
          ),
        ];
        const patches = [
          ...(scope ? [{ path: ["scope", "edit"], value: { value: scope } }] : []),
          // not a cell: excluded
          ...names.map((name) => ({ path: ["excluded", name], value: { by: "human" } })),
        ];
        const refusal = patches.length ? await handle.work.write(patches) : null;
        if (!refusal) setPage({ carryOver: false });
        return refusal;
      },
      setDraft: (value: Setter<FamiliesDraft>) => {
        draftTouched.current = true;
        setPage({ draft: next(value, draft) });
      },
      // Typing in the rule line, a header sort and a column toggle are gestures: each rewrites
      // this history entry, never adds one.
      setTable: (value: TableState) =>
        setPage(
          { query: value.query, sort: value.sorts, hidden: value.hiddenColumns ?? [] },
          { history: "replace" },
        ),
      setPicker: (value: Setter<PickerState>) => setPickerState((current) => next(value, current)),
      /**
       * A typed value stages, an emptied one included: empty is a value, so a person can clear a
       * parameter. Equal to the family's current value, it stages nothing. Pea's standing
       * suggestion remains as a counter.
       */
      propose: (address: FamilyCellAddress, value: FamilyCellValue, current: string) => {
        const key = familyCellKey(address);
        return handle.work.write(
          transitionPatches(["cells"], key, cellsRef.current[key] ?? {}, {
            kind: "set",
            rung: { value },
            baseline: { value: { value: current, storageType: value.storageType } },
          }),
        );
      },
      // A person's toggle: include again (whoever held it back), or hold back as the person.
      // Keyed by family NAME (ruling): an element id is reissued on every reload.
      exclude: (familyName: string) =>
        // not a cell: excluded
        handle.work.write([
          Object.hasOwn(excluded, familyName)
            ? { path: ["excluded", familyName] }
            : { path: ["excluded", familyName], value: { by: "human" } },
        ]),
    }),
    // `cells` rides a ref: a edit keystroke must not mint a new `propose`, or every column
    // def and every drawn cell (511 × 435) rebuilds behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle.work, draft, setPage, excluded, target, documentScope],
  );

  return {
    handle,
    manifest,
    target,
    documentTarget,
    documentScope,
    excluded,
    cells,
    applied,
    plan,
    applyData,
    draft,
    demo,
    refreshPods,
    table,
    picker,
    page,
    retainedReading,
    retainedError: retainedCall.error?.message ?? null,
    archive: {
      list: archiveList,
      selectedId: selectedArchiveId,
      reading: archiveCall.data?.id === selectedArchiveId ? archiveCall.data : null,
      loading: archiveListCall.isPending || archiveCall.isPending,
      error: archiveListCall.error?.message ?? archiveCall.error?.message ?? null,
      failure: archiveListCall.error
        ? "Couldn't load past reads."
        : "Couldn't load this saved read.",
      retry: () => {
        if (archiveListCall.error) archiveListCall.refresh();
        else archiveCall.refresh();
      },
      select: (past: string) => setPage({ past }),
    },
    setPage,
    busy: handle.busy,
    failure: handle.failure,
    feeds,
    salvaged,
    actions,
    wire,
  };
}

/** One exclusion the set-aside Work held: by name, or by an id and the name the catalog gives it now. */
export interface SalvagedExclusion {
  id: number | null;
  /** Null: no loaded family has this id now. */
  name: string | null;
}

/** What the set-aside Work offers back: its exclusions and its scope (S-1/S-2). */
export interface Salvaged {
  rows: SalvagedExclusion[];
  scope: AppliedFilter | null;
}

// ponytail: the route's own salvage (FamiliesSalvage); the scope is the host's typed AppliedFilter.
const salvageSchema = z.object({
  familyNames: z.array(z.string()).default([]),
  familyIds: z.array(z.number().int()).default([]),
  scope: z.unknown().optional(),
});

export type FamiliesStore = ReturnType<typeof useFamiliesStore>;
