import { useCallback, useMemo, useState } from "react";
import {
  stagedFilter,
  workKey,
  type ActionReceipt,
  type FamiliesRouteDocument,
  type FamilyCellAddress,
  type FamilyCellValue,
  type FamilyPlanResult,
} from "@pe/agent-contracts";
import type { TableState } from "@pe/kit/table/model";
import type { CellWire } from "#/components/work/band";
import type { GraphMount } from "#/shell/mount";
import { ffPlanRow } from "#/host/familyfoundry";
import { familiesGraph, type FamiliesPage } from "./graph";
import { readingValue, type FamiliesScope } from "./actions";
import type { FamiliesDraft, FamiliesObservation, FamiliesObservationSummary } from "./sources";
import { scopeDraft } from "./sources";
import { applyResults } from "./apply-outcome";

export type FamiliesMount = GraphMount<FamiliesPage, FamiliesRouteDocument>;
export type PickerState = { open: string | null; level: string | null; query: string };
type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;
export interface OptionList {
  readonly options:
    | readonly { id: string; label: string; categoryName?: string | null; sub?: string }[]
    | null;
  readonly state: "loading" | "ready" | "error";
  readonly lane: "read";
  readonly stale: boolean;
}

/** Values for the matrix only. Acquisition, Target, Work, writes, tickets and history belong to owner. */
export function useFamiliesStore(owner: FamiliesMount) {
  const scope: FamiliesScope = {
    ...owner.snapshot(),
    page: owner.view.read().page,
    readings: Object.fromEntries(
      Object.keys(familiesGraph.readings).map((id) => [id, owner.readings.get(id)]),
    ),
  };
  const { page, work, target } = scope;
  const draft = useMemo(
    () => scopeDraft(page.draft, work?.doc ?? null),
    [page.draft, work?.doc.scope.edit?.value],
  );
  const [picker, setPicker] = useState<PickerState>({ open: null, level: null, query: "" });
  const documentTarget = target.kind === "document" ? target.ref : null;
  const documentScope = useMemo(
    () =>
      documentTarget
        ? { bridgeSessionId: documentTarget.session, openDocumentId: documentTarget.openId }
        : undefined,
    [documentTarget?.session, documentTarget?.openId],
  );
  const observation = readingValue<FamiliesObservation>(
    scope,
    page.stage === "history" ? "saved" : "matrix",
  );
  const cells = useMemo(() => work?.doc.cells ?? {}, [work?.doc.cells]);
  const excluded = useMemo(() => work?.doc.excluded ?? {}, [work?.doc.excluded]);
  const table = useMemo<TableState>(
    () => ({ sorts: page.sort, query: page.query, hiddenColumns: page.hidden }),
    [page.sort, page.query, page.hidden],
  );
  const write = useCallback<CellWire["write"]>(
    async (patches, expectedRevision = owner.snapshot().work?.handle.revision ?? -1) => {
      const result = await owner.control("edit", { patches, expectedRevision }).run();
      return "refusal" in result ? result.refusal : null;
    },
    [owner],
  );
  const wire = useMemo<CellWire>(
    () => ({ segment: "cells", revision: work?.handle.revision ?? null, write }),
    [work?.handle.revision, write],
  );
  const run = useCallback(
    async (id: string, input: unknown) => {
      const result = await owner.control(id, input).run();
      return "refusal" in result ? result.refusal : null;
    },
    [owner],
  );
  const actions = useMemo(
    () => ({
      setDraft: (value: Setter<FamiliesDraft>) =>
        owner.view.setPage({
          draft: next(
            value,
            scopeDraft(owner.view.read().page.draft, owner.snapshot().work?.doc ?? null),
          ),
        }),
      setTable: (value: TableState) =>
        owner.view.setPage(
          { query: value.query, sort: value.sorts, hidden: value.hiddenColumns ?? [] },
          { history: "replace" },
        ),
      setPicker: (value: Setter<PickerState>) => setPicker((current) => next(value, current)),
      propose: (address: FamilyCellAddress, value: FamilyCellValue, current: string) =>
        run("propose", { address, value, current }),
      exclude: (name: string) => run("exclude", { name }),
    }),
    [owner, run],
  );
  const receipts = (readingValue<ActionReceipt[]>(scope, "receipts") ?? []).filter((row) =>
    row.consumes.some(
      (input) =>
        input.kind === "work" &&
        work &&
        workKey(input.probe.handle.key) === workKey(work.handle.key),
    ),
  );
  const applied = receipts
    .filter((row) => row.key === "families.apply" && row.state === "succeeded")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const results = applied?.state === "succeeded" ? applyResults(applied.result) : [];
  const ffReceipts = results.flatMap((result) => result.native.receipts);
  const applyData = applied
    ? {
        actionId: applied.id,
        appliedAt: applied.startedAt,
        diagnostics: results.flatMap((result) => result.native.diagnostics),
        receipts: ffReceipts,
        artifacts: [
          ...new Set(
            ffReceipts.flatMap((entry) =>
              entry.artifactDirectory ? [entry.artifactDirectory] : [],
            ),
          ),
        ],
      }
    : null;
  const evidence = owner.reviews.get("apply")?.ticket.evidence as
    | { plan?: FamilyPlanResult }
    | undefined;
  const plan = evidence?.plan ? { entries: [evidence.plan.plan].flat().map(ffPlanRow) } : null;
  const categories = readingValue<string[]>(scope, "categories");
  const catalog = readingValue<
    { familyName: string; categoryName?: string | null; placedInstanceCount: number }[]
  >(scope, "catalog");
  // FOOTGUN: base-ui Combobox items must keep identity between renders (progress must not rebuild options).
  const feeds = useMemo(() => {
    const feed = (id: string, options: OptionList["options"]): OptionList => ({
      options,
      state: scope.readings[id]?.status === "failed" ? "error" : options ? "ready" : "loading",
      lane: "read",
      stale: !scope.readings[id]?.current,
    });
    return {
      category: feed("categories", categories?.map((id) => ({ id, label: id })) ?? null),
      family: feed(
        "catalog",
        catalog
          ?.filter(
            (family) =>
              draft.categories.includes(family.categoryName ?? "") &&
              (draft.placement === "AllLoaded" ||
                (draft.placement === "PlacedOnly") === family.placedInstanceCount > 0),
          )
          .sort(
            (a, b) =>
              Number(!a.placedInstanceCount) - Number(!b.placedInstanceCount) ||
              a.familyName.localeCompare(b.familyName),
          )
          .map((family) => ({
            id: family.familyName,
            label: family.familyName,
            categoryName: family.categoryName,
            sub: `${family.placedInstanceCount} placed`,
          })) ?? null,
      ),
    };
  }, [
    categories,
    catalog,
    draft,
    scope.readings.categories?.status,
    scope.readings.catalog?.status,
    scope.readings.categories?.current,
    scope.readings.catalog?.current,
  ]);
  const archive = readingValue<FamiliesObservationSummary[]>(scope, "archive") ?? [];
  return {
    owner,
    scope,
    work,
    page,
    observation,
    target: documentTarget?.session ?? "",
    documentTarget,
    documentScope,
    cells,
    excluded,
    applied: work ? stagedFilter(work.doc) : null,
    plan,
    applyData,
    draft,
    demo: !!page.demo,
    table,
    picker,
    setPage: owner.view.setPage,
    busy: owner.busy(),
    failure: null,
    feeds,
    connected: documentTarget !== null,
    workUnreadable: scope.unreadable != null,
    retainedError: scope.readings.matrix?.error ?? null,
    archive: {
      list: archive,
      selectedId: page.past || archive[0]?.id || null,
      reading: observation,
      loading:
        scope.readings.saved?.status === "pending" || scope.readings.archive?.status === "pending",
      error: scope.readings.saved?.error ?? scope.readings.archive?.error ?? null,
      select: (past: string) => owner.view.setPage({ past }),
    },
    actions,
    wire,
  };
}
export type FamiliesStore = ReturnType<typeof useFamiliesStore>;
