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
  familyCaptureSchema,
  familiesPlanReadingSchema,
  ffReceiptSchema,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type Reading,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import { callHostRpc } from "#/host/client";
import type { FfProjectData } from "#/host/familyfoundry";
import { useHostCall, previousOf } from "#/readings";
import { useRoute } from "#/route";
import { createLiveFamiliesHost, type FamiliesDraft } from "#/families/host";
import { familyFlag } from "#/families/plan";
import { manifest, type FamiliesPage } from "#/families/manifest";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export type PickerState = {
  open: string | null;
  level: string | null;
  query: string;
  stage: string;
};

export interface FamiliesPageMemory {
  readonly draft: FamiliesDraft;
  readonly pickedIds: ReadonlySet<number>;
  readonly projection: FfProjectData | null;
  readonly showUncommon: boolean;
  readonly table: MasterTableState;
  readonly picker: PickerState;
}

const EMPTY_MEMORY: FamiliesPageMemory = {
  draft: { placement: "AllLoaded", categories: [], families: [] },
  pickedIds: new Set<number>(),
  projection: null,
  showUncommon: false,
  table: { filters: {}, sorts: [], query: "" },
  picker: { open: null, level: null, query: "", stage: "scope" },
};

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

/** The newest `families-plan` capture in the family-readings stream, with its capture id. */
export function latestPlanOf(rows: unknown) {
  if (!rows) return null;
  const row = familyCaptureSchema
    .array()
    .parse(rows)
    .find((capture) => capture.reading.kind === "families-plan");
  return row && row.reading.kind === "families-plan"
    ? { id: row.id, value: familiesPlanReadingSchema.parse(row.reading.value) }
    : null;
}

/** The last succeeded `families.apply` receipt, projected. Never Work: the receipt is the record. */
export function applyDataOf(statuses: unknown, receipts: unknown) {
  if (!statuses || !receipts) return null;
  const row = actionStatusSchema
    .array()
    .parse(statuses)
    .filter((entry) => entry.key === "families.apply" && entry.state === "succeeded")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!row) return null;
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

/** Why Apply is refused, or null. A saved plan is stale purely because its basis moved. */
export function applyRefusalOf(
  doc: FamiliesRouteDocument | null,
  saved: { value: { basis: string } } | null,
  plan: { entries: readonly { familyId: number }[] } | null,
  excludedIds: readonly number[],
): string | null {
  if (saved && doc && saved.value.basis !== familiesBasis(doc))
    return "The profile or scope changed after this plan. Plan again.";
  if (!plan) return "plan first";
  return plan.entries.some(
    (entry) => !excludedIds.includes(entry.familyId) && !familyFlag(entry as never),
  )
    ? null
    : "No included family has changes to apply.";
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export function useFamiliesStore(options: { target?: string } = {}) {
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
  });
  const [memory, setMemory] = useState<FamiliesPageMemory>(EMPTY_MEMORY);
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
  const excludedIds = doc?.excludedIds ?? [];
  const applied = (doc?.scope ?? null) as AppliedFilter | null;

  const familyReadings = handle.readings.families as Reading<unknown>;
  const latestPlan = useMemo(() => latestPlanOf(previousOf(familyReadings)), [familyReadings]);
  const plan = useMemo(
    () =>
      latestPlan && doc && latestPlan.value.basis === familiesBasis(doc) ? latestPlan.value : null,
    [latestPlan, doc],
  );
  const receipts = handle.readings.receipts as Reading<unknown>;
  const applyData = useMemo(() => {
    const rows = previousOf(receipts);
    return applyDataOf(rows, rows);
  }, [receipts]);
  const applyRefusal = applyRefusalOf(doc, latestPlan, plan, excludedIds);

  const categoryCall = useHostCall(
    () => host.categories(documentTarget!),
    ["categories", documentTarget],
    documentTarget !== null,
  );
  const familyCall = useHostCall(
    () =>
      memory.draft.categories.length
        ? host.families(documentTarget!, memory.draft)
        : Promise.resolve([]),
    ["families", documentTarget, memory.draft.placement, memory.draft.categories.join("|")],
    documentTarget !== null,
  );
  const profileCall = useHostCall(() => host.profiles(), ["profiles"]);
  const feeds = {
    category: asFeed(categoryCall),
    family: asFeed(familyCall),
    profile: asFeed(profileCall),
  };

  const actions = useMemo(
    () => ({
      refreshReads: () => {
        categoryCall.refresh();
        familyCall.refresh();
        profileCall.refresh();
      },
      setDraft: (value: Setter<FamiliesDraft>) =>
        setMemory((current) => ({ ...current, draft: next(value, current.draft) })),
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
      /** The authored scope is Work; a prior reading stays where it is and goes stale by basis. */
      applyScope: () =>
        handle.work.write([
          {
            path: ["scope"],
            value: {
              categoryNames: [...memory.draft.categories],
              familyNames: [...memory.draft.families],
              placementScope: memory.draft.placement,
            },
          },
        ]),
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
      plan: () => handle.actions.plan.run(),
      applyFoundry: () => handle.actions.apply.run(),
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
    [
      handle.actions,
      handle.work,
      memory.draft,
      memory.pickedIds,
      excludedIds,
      target,
      documentScope,
      patch,
    ],
  );

  return {
    handle,
    manifest,
    target,
    documentScope,
    profilePath,
    excludedIds,
    applied,
    plan,
    latestPlan,
    applyData,
    applyRefusal,
    draft: memory.draft,
    pickedIds: memory.pickedIds as Set<number>,
    projection: memory.projection,
    showUncommon: memory.showUncommon,
    table: memory.table,
    picker: memory.picker,
    page: handle.page[0] as FamiliesPage,
    busy: handle.busy,
    failure: handle.failure,
    feeds,
    actions,
  };
}

export type FamiliesStore = ReturnType<typeof useFamiliesStore>;
