/**
 * Families — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the Target resolution, busy, refusals and the host caller all live in
 * `useRoute` now; the Work doc, the Readings and the two applies live in `families/manifest.ts`.
 * What is left here is what only Families knows: which plan reading still describes the authored
 * basis, what the last apply receipt said, and which picker is open. Plain values, no atoms.
 */
import { useCallback, useMemo, useState } from "react";
import {
  actionReceiptSchema,
  actionStatusSchema,
  diagnosticSchema,
  familiesBasis,
  ffReceiptSchema,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type Reading,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import { callHostRpc } from "#/host/client";
import type { FfProjectData } from "#/host/familyfoundry";
import { useHostCall, previousOf, useReading } from "#/readings";
import { useRoute } from "#/route";
import { createLiveFamiliesHost, type FamiliesDraft } from "#/families/host";
import { latestPlanOf, manifest, type FamiliesPage } from "#/families/manifest";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
};

export interface FamiliesPageMemory {
  readonly pickedIds: ReadonlySet<number>;
  readonly projection: FfProjectData | null;
  readonly showUncommon: boolean;
  readonly table: MasterTableState;
  readonly picker: PickerState;
}

const EMPTY_MEMORY: FamiliesPageMemory = {
  pickedIds: new Set<number>(),
  projection: null,
  showUncommon: false,
  table: { filters: {}, sorts: [], query: "" },
  picker: { open: null, level: null, query: "" },
};

const NO_EXCLUDED: readonly number[] = [];

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

const latestApplyStatusOf = (statuses: unknown) =>
  statuses
    ? (actionStatusSchema
        .array()
        .parse(statuses)
        .filter((entry) => entry.key === "families.apply" && entry.state === "succeeded")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null)
    : null;

/** The last succeeded `families.apply` receipt, projected. Never Work: the receipt is the record. */
export function applyDataOf(statuses: unknown, receipts: unknown) {
  const row = latestApplyStatusOf(statuses);
  if (!row || !receipts) return null;
  const parsed = actionReceiptSchema
    .array()
    .parse(receipts)
    .find((entry) => entry.id === row.id);
  const step = parsed?.steps.find(
    (entry) => entry.key === "familyfoundry.apply" && entry.state === "succeeded",
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

export function useFamiliesStore(options: { target?: string; thread?: string } = {}) {
  const routeManifest = useMemo(
    () => ({
      ...manifest,
      readings: {
        ...manifest.readings,
        ...(options.thread
          ? { head: { kind: "thread-head" as const, thread: options.thread } }
          : {}),
      },
    }),
    [options.thread],
  );
  const handle = useRoute(routeManifest, {
    target: options.target ? (options.target as never) : null,
  });
  const [memory, setMemory] = useState<FamiliesPageMemory>(EMPTY_MEMORY);
  // The draft is Page: the `scope` verb reads it as `ctx.page.draft`, so it lives on the handle.
  const page = handle.page[0] as FamiliesPage;
  const setPage = handle.page[1] as (next: Partial<FamiliesPage>) => void;
  const draft = page.draft;
  const patch = useCallback(
    (value: Partial<FamiliesPageMemory>) => setMemory((current) => ({ ...current, ...value })),
    [],
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
  const profilePath = doc?.profilePath ?? null;
  // One shared empty list while Work is null: `actions` memoizes on it, and a fresh `[]` per
  // render would rebuild the controller on every pass.
  const excludedIds = doc?.excludedIds ?? NO_EXCLUDED;
  const applied = (doc?.scope ?? null) as AppliedFilter | null;

  const familyReadings = handle.readings.families as Reading<unknown>;
  const latestPlan = useMemo(() => latestPlanOf(previousOf(familyReadings)), [familyReadings]);
  const plan = useMemo(
    () =>
      latestPlan && doc && latestPlan.value.basis === familiesBasis(doc) ? latestPlan.value : null,
    [latestPlan, doc],
  );
  const receipts = handle.readings.receipts as Reading<unknown>;
  const receiptStatuses = previousOf(receipts);
  const applyStatus = useMemo(() => latestApplyStatusOf(receiptStatuses), [receiptStatuses]);
  const applyReceipt = useReading(
    !handle.demo && applyStatus ? { kind: "receipts", id: applyStatus.id } : null,
  );
  const applyData = useMemo(() => {
    return applyDataOf(receiptStatuses, previousOf(applyReceipt));
  }, [receiptStatuses, applyReceipt]);

  const categoryCall = useHostCall(
    () => host.categories(documentTarget!),
    ["categories", documentTarget],
    documentTarget !== null,
  );
  const familyCall = useHostCall(
    () => (draft.categories.length ? host.families(documentTarget!, draft) : Promise.resolve([])),
    ["families", documentTarget, draft.placement, draft.categories.join("|")],
    documentTarget !== null,
  );
  const profileCall = useHostCall(() => host.profiles(), ["profiles"]);
  // FOOTGUN: base-ui `Combobox items` must keep identity between renders; a fresh `options`
  // array each render re-runs its store effect and React throws "Maximum update depth exceeded".
  const feeds = useMemo(
    () => ({
      category: asFeed(categoryCall),
      family: asFeed(familyCall),
      profile: asFeed(profileCall),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the call objects are rebuilt each render; their fields are the identity
    [
      categoryCall.data,
      categoryCall.error,
      categoryCall.isPending,
      familyCall.data,
      familyCall.error,
      familyCall.isPending,
      profileCall.data,
      profileCall.error,
      profileCall.isPending,
    ],
  );

  const actions = useMemo(
    () => ({
      setDraft: (value: Setter<FamiliesDraft>) => setPage({ draft: next(value, draft) }),
      setPickedIds: (value: Setter<Set<number>>) =>
        setMemory((current) => ({
          ...current,
          pickedIds: next(value, current.pickedIds as Set<number>),
        })),
      setProjection: (value: Setter<FfProjectData | null>) =>
        setMemory((current) => ({ ...current, projection: next(value, current.projection) })),
      setShowUncommon: (value: Setter<boolean>) =>
        setMemory((current) => ({ ...current, showUncommon: next(value, current.showUncommon) })),
      setTable: (value: Setter<MasterTableState>) =>
        setMemory((current) => ({ ...current, table: next(value, current.table) })),
      setPicker: (value: Setter<PickerState>) =>
        setMemory((current) => ({ ...current, picker: next(value, current.picker) })),
      setProfile: (profile: string) =>
        handle.work.write([
          { path: ["profilePath"], value: profile },
          { path: ["excludedIds"], value: [] },
        ]),
      exclude: (id: number) => {
        const set = new Set(excludedIds);
        if (!set.delete(id)) set.add(id);
        return handle.work.write([{ path: ["excludedIds"], value: [...set] }]);
      },
      project: async () => {
        if (!documentScope) throw Error("Select an exact available project document");
        const ids = [...memory.pickedIds];
        if (!ids.length) return;
        const result = await callHostRpc(
          "familyfoundry.project",
          { familyIds: ids },
          documentScope,
        );
        patch({ projection: result });
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
    [handle.work, draft, setPage, memory.pickedIds, excludedIds, target, documentScope, patch],
  );

  return {
    handle,
    manifest: routeManifest,
    target,
    documentScope,
    profilePath,
    excludedIds,
    applied,
    plan,
    latestPlan,
    applyData,
    draft,
    pickedIds: memory.pickedIds as Set<number>,
    projection: memory.projection,
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
