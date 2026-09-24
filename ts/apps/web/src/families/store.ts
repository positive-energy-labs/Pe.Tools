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
  diagnosticSchema,
  familyCellKey,
  ffReceiptSchema,
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

import type { CellWire } from "#/components/lang/band";
import type { TableState } from "#/components/master-table/model";
import { useHostCall, previousOf, useReading } from "#/readings";
import { useRoute, type EntityPage, type EntitySearch } from "#/route";
import { usePodList } from "#/route/pods";
import {
  archivedFamiliesObservation,
  archivedFamiliesObservations,
  createLiveFamiliesHost,
  latestFamiliesObservation,
  type FamiliesDraft,
} from "#/families/host";
import { manifest, type FamiliesPage } from "#/families/manifest";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
};

export interface FamiliesPageMemory {
  readonly table: TableState;
  readonly picker: PickerState;
}

const EMPTY_MEMORY: FamiliesPageMemory = {
  table: { sorts: [], query: "" },
  picker: { open: null, level: null, query: "" },
};

const NO_EXCLUDED: FamilyExclusions = {};
const NO_CELLS: Record<string, FamilyCellState> = {};

type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;

/** The option-list shape the pickers read. `feed()` and its `Atom.swr` runtime are deleted. */
export interface OptionList {
  readonly options: readonly { id: string; label: string; categoryName?: string | null }[] | null;
  readonly state: "loading" | "ready" | "error";
  readonly lane: "read";
  readonly stale: boolean;
}

const asFeed = (call: {
  data?: readonly string[] | readonly { id: string; label: string; categoryName: string | null }[];
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
  const step = parsed?.steps.find(
    (entry) => entry.key === "families.apply" && entry.state === "succeeded",
  );
  if (!parsed || !step || step.state !== "succeeded") return null;
  const native = step.result as { diagnostics?: unknown[]; receipts?: unknown[] };
  const ffReceipts = ffReceiptSchema.array().parse(native.receipts ?? []);
  return {
    actionId: parsed.id,
    appliedAt: parsed.startedAt,
    diagnostics: diagnosticSchema.array().parse(native.diagnostics ?? []),
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
  options: { target?: string; thread?: string; entry?: EntitySearch; query?: string } = {},
) {
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
    thread: options.thread,
    provided: { pods },
    page: {
      ...options.entry,
      ...(options.query === undefined ? {} : { query: options.query }),
    } as never,
  });
  const [memory, setMemory] = useState<FamiliesPageMemory>(EMPTY_MEMORY);
  // The draft and the selection are Page: the verbs read them off `ctx.page`.
  const page = handle.page[0] as FamiliesPage & EntityPage;
  const setPage = handle.page[1] as (next: Partial<FamiliesPage & EntityPage>) => void;
  const tableRef = useRef(memory.table);
  tableRef.current = memory.table;
  const queryRef = useRef(page.query);
  queryRef.current = page.query;
  const table = useMemo(() => ({ ...memory.table, query: page.query }), [memory.table, page.query]);
  useEffect(() => {
    if (options.query !== undefined && options.query !== page.query)
      setPage({ query: options.query });
    // URL changes seed the Page; local rule edits own subsequent renders until the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.query]);
  const draft = page.draft;
  const draftTouched = useRef(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const archiveListCall = useHostCall(
    archivedFamiliesObservations,
    ["families-archive-list"],
    page.stage === "archived",
  );
  const archiveList = archiveListCall.data ?? [];
  const selectedArchiveId = archiveId ?? archiveList[0]?.id ?? null;
  const archiveCall = useHostCall(
    () => archivedFamiliesObservation(selectedArchiveId!),
    ["families-archive", selectedArchiveId],
    page.stage === "archived" && selectedArchiveId !== null,
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
    documentTarget !== null && page.stage !== "archived",
  );
  const retainedReading = retainedCall.data ?? null;
  useEffect(() => {
    if (
      page.stage === "archived" ||
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
      draft.placement === "AllLoaded"
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
  // The matrix Reading is an envelope (MAP ruling 3): when its body id moves past the reading on
  // screen (another reader, a readback), fetch that body once over RPC. The body never streams.
  const bodyVersion =
    (previousOf(handle.readings.matrix as Reading<unknown>) as FamiliesMatrixEnvelope | undefined)
      ?.bodyVersion ?? null;
  useEffect(() => {
    if (!bodyVersion || bodyVersion === page.reading?.id || page.stage === "archived") return;
    let live = true;
    // A failed fetch leaves the matrix on its last body; the envelope still says it moved.
    void archivedFamiliesObservation(bodyVersion).then(
      (reading) => live && setPage({ reading }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [bodyVersion, page.reading?.id, page.stage, setPage]);
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
    documentTarget !== null && page.stage !== "archived",
  );
  const familyCall = useHostCall(
    () => host.families(documentTarget!, draft),
    [
      "families",
      documentTarget?.session,
      documentTarget?.openId,
      draft.placement,
      draft.categories.join("|"),
    ],
    documentTarget !== null && page.stage !== "archived" && draft.categories.length > 0,
  );
  // FOOTGUN: base-ui `Combobox items` must keep identity between renders; a fresh `options`
  // array each render re-runs its store effect and React throws "Maximum update depth exceeded".
  const feeds = useMemo(
    () => ({
      category: asFeed(categoryCall),
      family: asFeed(familyCall),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the call objects are rebuilt each render; their fields are the identity
    [
      categoryCall.data,
      categoryCall.error,
      categoryCall.isPending,
      familyCall.data,
      familyCall.error,
      familyCall.isPending,
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
      page.stage !== "archived" &&
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
       * The person's one press, one human write: the old scope staged again (when it had one), and
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
          ...(scope ? [{ path: ["scope", "staged"], value: { value: scope } }] : []),
          // not a cell: excluded
          ...names.map((name) => ({ path: ["excluded", name], value: { by: "person" } })),
        ];
        const refusal = patches.length ? await handle.work.write(patches) : null;
        if (!refusal) setPage({ carryOver: false });
        return refusal;
      },
      setDraft: (value: Setter<FamiliesDraft>) => {
        draftTouched.current = true;
        setPage({ draft: next(value, draft) });
      },
      setTable: (value: Setter<TableState>) => {
        const updated = next(value, { ...tableRef.current, query: queryRef.current });
        if (updated.query !== queryRef.current) setPage({ query: updated.query });
        setMemory((current) => ({ ...current, table: updated }));
      },
      setPicker: (value: Setter<PickerState>) =>
        setMemory((current) => ({ ...current, picker: next(value, current.picker) })),
      /**
       * A typed value stages, an emptied one included: empty is a value, so a person can clear a
       * parameter. Equal to the family's current value, it stages nothing. Pea's standing
       * proposal remains as a counter.
       */
      propose: (address: FamilyCellAddress, value: FamilyCellValue, current: string) => {
        const key = familyCellKey(address);
        return handle.work.write(
          transitionPatches(["cells"], key, cellsRef.current[key] ?? {}, {
            kind: "stage",
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
            : { path: ["excluded", familyName], value: { by: "person" } },
        ]),
    }),
    // `cells` rides a ref: a staged keystroke must not mint a new `propose`, or every column
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
    picker: memory.picker,
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
      select: setArchiveId,
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
