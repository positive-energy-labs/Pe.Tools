/**
 * Families — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Work doc, the Readings and the two applies live in `families/manifest.ts`.
 * What is left here is what only Families knows: what the last capture saw, what the last apply
 * receipt said, and which picker is open. Plain values, no atoms.
 */
import { frozenDemo } from "#/host/demo-client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  actionReceiptSchema,
  actionStatusSchema,
  diagnosticSchema,
  familiesCaptureEvidenceSchema,
  ffReceiptSchema,
  podMemberSourceSchema,
  type ActionStatus,
  type FamilyCellEdit,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type Reading,
} from "@pe/agent-contracts";
import { z } from "zod";

import type { MasterTableState } from "#/components/master-table/model";
import { callHostRpc } from "#/host/client";
import { useHostCall, previousOf, useReading } from "#/readings";
import { useRoute, type EntityPage, type EntitySearch } from "#/route";
import { usePodList } from "#/route/pods";
import { createLiveFamiliesHost, type FamiliesDraft } from "#/families/host";
import { drop, put } from "#/families/staged";
import { manifest, type FamiliesPage } from "#/families/manifest";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
};

export interface FamiliesPageMemory {
  readonly showUncommon: boolean;
  readonly table: MasterTableState;
  readonly picker: PickerState;
}

const EMPTY_MEMORY: FamiliesPageMemory = {
  showUncommon: false,
  table: { filters: {}, sorts: [], query: "" },
  picker: { open: null, level: null, query: "" },
};

const NO_EXCLUDED: readonly number[] = [];
const NO_EDITS: readonly FamilyCellEdit[] = [];

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
  const routeManifest = useMemo(
    () =>
      ({
        ...manifest,
        readings: {
          ...manifest.readings,
          ...(options.thread
            ? { head: { kind: "thread-head" as const, thread: options.thread } }
            : {}),
        },
      }) as typeof manifest,
    [options.thread],
  );
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(routeManifest, {
    target: options.target ? (options.target as never) : null,
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
  const excludedIds = doc?.excludedIds ?? NO_EXCLUDED;
  const edits = doc?.edits ?? NO_EDITS;
  const accepted = doc?.accepted ?? NO_EDITS;
  /*
   * Two cells typed back to back are two Work writes, and the second must build on the first even
   * though the Work reading has not come back yet — otherwise the later write erases the earlier
   * cell. `asked` is what we last wrote; it yields to Work the moment Work agrees, so Work stays
   * the only authority and this is a queue, never a second copy of the document.
   */
  type Cells = { edits: readonly FamilyCellEdit[]; accepted: readonly FamilyCellEdit[] };
  const observed = useRef<Cells>({ edits, accepted });
  observed.current = { edits, accepted };
  const asked = useRef<Cells | null>(null);
  if (asked.current && JSON.stringify(asked.current) === JSON.stringify(observed.current))
    asked.current = null;
  const writeCells = useCallback(
    (change: (cells: Cells) => Cells) => {
      const nextCells = change(asked.current ?? observed.current);
      asked.current = nextCells;
      return handle.work.write([
        { path: ["edits"], value: [...nextCells.edits] },
        { path: ["accepted"], value: [...nextCells.accepted] },
      ]);
    },
    [handle.work],
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
      setTable: (value: Setter<MasterTableState>) =>
        setMemory((current) => ({ ...current, table: next(value, current.table) })),
      setPicker: (value: Setter<PickerState>) =>
        setMemory((current) => ({ ...current, picker: next(value, current.picker) })),
      /**
       * A typed value is a proposal, the same shape Pea writes, told apart by `by`. It replaces
       * whatever stood on the cell, and any accept there, since that accept was for another value.
       * An empty commit, or the value Revit already holds, denies the cell instead.
       */
      propose: (edit: FamilyCellEdit, current: string) =>
        writeCells((cells) => ({
          edits:
            edit.value === "" || edit.value === current
              ? drop(cells.edits, edit)
              : put(cells.edits, edit),
          accepted: drop(cells.accepted, edit),
        })),
      /** Accept the proposals standing on these cells, value and author as proposed. */
      accept: (proposals: readonly FamilyCellEdit[]) =>
        writeCells((cells) => ({
          edits: cells.edits,
          accepted: proposals.reduce(put, cells.accepted),
        })),
      /** Deny: the proposal and any accept on these cells are gone; the cell shows Revit again. */
      deny: (cellsToDeny: readonly Pick<FamilyCellEdit, "familyId" | "typeName" | "parameter">[]) =>
        writeCells((cells) => ({
          edits: cellsToDeny.reduce(drop, cells.edits),
          accepted: cellsToDeny.reduce(drop, cells.accepted),
        })),
      exclude: (id: number) => {
        const set = new Set(excludedIds);
        if (!set.delete(id)) set.add(id);
        return handle.work.write([{ path: ["excludedIds"], value: [...set] }]);
      },
      openFamily: (familyId: number) => {
        if (!documentScope)
          return Promise.reject(Error("Select an exact available project document"));
        return callHostRpc("family.editor.open", { familyId }, documentScope);
      },
      openPath: (path: string) =>
        callHostRpc("host.shell.open", { path }, { bridgeSessionId: target || undefined }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle.work, draft, setPage, pickedIds, excludedIds, writeCells, target, documentScope],
  );

  return {
    handle,
    manifest: routeManifest,
    target,
    documentScope,
    excludedIds,
    edits,
    accepted,
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
  };
}

export type FamiliesStore = ReturnType<typeof useFamiliesStore>;
