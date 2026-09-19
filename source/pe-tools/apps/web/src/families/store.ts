/**
 * Families — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Work doc, the Readings and the two applies live in `families/manifest.ts`.
 * What is left here is what only Families knows: what the last capture saw, what the last apply
 * receipt said, and which picker is open. Plain values, no atoms.
 */
import { frozenDemo } from "#/host/demo-client";
import { useMemo, useState } from "react";
import {
  actionReceiptSchema,
  actionStatusSchema,
  diagnosticSchema,
  familyCellKey,
  familiesCaptureEvidenceSchema,
  ffReceiptSchema,
  podMemberSourceSchema,
  type ActionStatus,
  type FamilyCellAddress,
  type FamilyCellState,
  type FamilyCellValue,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type FamilyExclusions,
  type Reading,
  transitionPatches,
} from "@pe/agent-contracts";
import { z } from "zod";

import type { CellWire } from "#/components/lang/band";
import type { TableState } from "#/components/master-table/model";
import { callHostRpc } from "#/host/client";
import { useHostCall, previousOf, useReading } from "#/readings";
import { useRoute, type EntityPage, type EntitySearch } from "#/route";
import { usePodList } from "#/route/pods";
import { createLiveFamiliesHost, type FamiliesDraft } from "#/families/host";
import { manifest, type FamiliesPage } from "#/families/manifest";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
};

export interface FamiliesPageMemory {
  readonly showUncommon: boolean;
  readonly table: TableState;
  readonly picker: PickerState;
}

const EMPTY_MEMORY: FamiliesPageMemory = {
  showUncommon: false,
  table: { filters: {}, sorts: [], query: "" },
  picker: { open: null, level: null, query: "" },
};

const NO_EXCLUDED: FamilyExclusions = {};
const NO_CELLS: Record<string, FamilyCellState> = {};

type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;

/** The option-list shape the pickers read. `feed()` and its `Atom.swr` runtime are deleted. */
export interface OptionList {
  readonly options: readonly { id: string; label: string }[] | null;
  readonly state: "loading" | "ready" | "error";
  readonly lane: "read";
  readonly stale: boolean;
}

const asFeed = (call: {
  data?: readonly string[];
  error?: Error;
  isPending: boolean;
}): OptionList => ({
  options: call.data ? call.data.map((id) => ({ id, label: id })) : null,
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

/**
 * What the last capture saw, from its original receipt: the members it filed and, per family,
 * coverage, unmodeled facts and failures. Null when the receipt is not a finished capture.
 */
export function captureEvidenceOf(receipts: unknown, id: string) {
  const row = (receipts as { id: string; result?: unknown }[] | undefined)?.find(
    (entry) => entry.id === id,
  );
  const result = z
    .object({ members: z.array(podMemberSourceSchema), evidence: familiesCaptureEvidenceSchema })
    .safeParse(row?.result);
  return result.success ? result.data : null;
}

/** The last succeeded `families.apply` receipt, projected. Never Work: the receipt is the record. */
export function applyDataOf(statuses: unknown, receipts: unknown) {
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
  options: { target?: string; thread?: string; entry?: EntitySearch } = {},
) {
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
    thread: options.thread,
    provided: { pods },
    page: options.entry as never,
  });
  const [memory, setMemory] = useState<FamiliesPageMemory>(EMPTY_MEMORY);
  // The draft and the selection are Page: the verbs read them off `ctx.page`.
  const page = handle.page[0] as FamiliesPage & EntityPage;
  const setPage = handle.page[1] as (next: Partial<FamiliesPage & EntityPage>) => void;
  const pickedIds = useMemo(() => new Set(page.selection.map(Number)), [page.selection]);
  const draft = page.draft;

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
  const applied = (doc?.scope ?? null) as AppliedFilter | null;

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
  const captureStatus = useMemo(
    () => latestStatusOf(receiptStatuses, "families.capture"),
    [receiptStatuses],
  );
  const captureReceipt = useReading(
    !handle.demo && captureStatus ? { kind: "receipts", id: captureStatus.id } : null,
  );
  const captured = useMemo(
    () => (captureStatus ? captureEvidenceOf(previousOf(captureReceipt), captureStatus.id) : null),
    [captureStatus, captureReceipt],
  );

  /*
   * Keyed on the ref's strings, never the ref: the resolution rebuilds it whenever the inventory
   * reading moves, and a catalog dispatch moves it, so an object key re-read on its own result.
   */
  const categoryCall = useHostCall(
    () => host.categories(documentTarget!),
    ["categories", documentTarget?.session, documentTarget?.openId],
    documentTarget !== null,
  );
  const familyCall = useHostCall(
    () => (draft.categories.length ? host.families(documentTarget!, draft) : Promise.resolve([])),
    [
      "families",
      documentTarget?.session,
      documentTarget?.openId,
      draft.placement,
      draft.categories.join("|"),
    ],
    documentTarget !== null,
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

  const actions = useMemo(
    () => ({
      setDraft: (value: Setter<FamiliesDraft>) => setPage({ draft: next(value, draft) }),
      setPickedIds: (value: Setter<Set<number>>) =>
        setPage({ selection: [...next(value, pickedIds)].map(String) }),
      setShowUncommon: (value: Setter<boolean>) =>
        setMemory((current) => ({ ...current, showUncommon: next(value, current.showUncommon) })),
      setTable: (value: Setter<TableState>) =>
        setMemory((current) => ({ ...current, table: next(value, current.table) })),
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
          transitionPatches(["cells"], key, cells[key] ?? {}, {
            kind: "stage",
            rung: { value: { familyName: value.familyName, value: value.value } },
            baseline: { value: { familyName: value.familyName, value: current } },
          }),
        );
      },
      // A person's toggle: include again (whoever held it back), or hold back as the person.
      exclude: (id: number) =>
        // not a cell: excluded
        handle.work.write([
          Object.hasOwn(excluded, String(id))
            ? { path: ["excluded", String(id)] }
            : { path: ["excluded", String(id)], value: { by: "person" } },
        ]),
      openFamily: (familyId: number) => {
        if (!documentScope)
          return Promise.reject(Error("Select an exact available project document"));
        return callHostRpc("family.open", { familyId }, documentScope);
      },
      openPath: (path: string) =>
        callHostRpc("host.shell.open", { path }, { bridgeSessionId: target || undefined }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle.work, cells, draft, setPage, pickedIds, excluded, target, documentScope],
  );

  return {
    handle,
    manifest,
    target,
    documentScope,
    excluded,
    cells,
    applied,
    plan,
    applyData,
    captured,
    draft,
    pickedIds,
    demo,
    refreshPods,
    showUncommon: memory.showUncommon,
    table: memory.table,
    picker: memory.picker,
    page,
    setPage,
    busy: handle.busy,
    failure: handle.failure,
    feeds,
    actions,
    wire,
  };
}

export type FamiliesStore = ReturnType<typeof useFamiliesStore>;
