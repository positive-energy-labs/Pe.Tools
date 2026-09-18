import { useEffect, useMemo, useRef } from "react";
import { FAMILY_CATALOG_LIMIT, type FfReceipt } from "@pe/agent-contracts";

import { runFanOut, type CellWire } from "#/components/lang/band";
import type { Verdict } from "#/components/master-table/model";
import type { FamiliesStore } from "#/families/store";
import { toHostIssue } from "#/host/issues";
import {
  cellText,
  visibleParameters,
  LoadedFamilyPlacement,
  type FamilySnapshotRecord,
  type LoadedFamiliesMatrixRequest,
} from "#/host/loaded-families-view";
import { useLoadedFamiliesMatrixQuery } from "#/readings";
import { useTableChips } from "#/components/anatomy";
import {
  familiesLockOf,
  useFamiliesColumns,
  type ParamColumn,
  type TypeRow,
} from "#/families/matrix-columns";
import type { PlanEntry } from "#/route";
import { FamiliesWorkspaceProvider } from "#/families/workspace-context";
import { FamiliesWorkspaceView } from "#/families/workspace-view";
import { DEMO_FAMILIES } from "#/families/seeds";
import { familyCellEntries } from "#/families/staged";

/**
 * Revit reloads every applied family under a new element id (w8-revit trip 12) and the receipt
 * names only the old one, so once an apply settles, whatever its outcome, the audit re-resolves
 * its scope: rows, picks and the next plan read the new ids. The sheet's hashes closed with it.
 */
export function useAfterApply(busy: string | null, reresolve: () => void) {
  const applying = useRef(false);
  const latest = useRef(reresolve);
  latest.current = reresolve;
  useEffect(() => {
    if (busy === "apply") applying.current = true;
    else if (applying.current) {
      applying.current = false;
      latest.current();
    }
  }, [busy]);
}

/** The placement filter's vocabulary, and what each choice MEANS for the audit. */
function useFamiliesWorkspaceModel(
  store: FamiliesStore,
  fixtureFamilies?: readonly FamilySnapshotRecord[],
) {
  const target = store.target;
  const scope = store.documentScope;
  const draft = store.draft;
  const { placement, categories: draftCategories, families: pickedFamilies } = draft;
  const setPlacement = (next: LoadedFamilyPlacement) =>
    store.actions.setDraft((previous) => ({ ...previous, placement: next }));
  const setDraftCategories = (next: string[]) =>
    store.actions.setDraft((previous) => ({ ...previous, categories: next }));
  const setPickedFamilies = (next: string[]) =>
    store.actions.setDraft((previous) => ({ ...previous, families: next }));
  const applied = store.applied;
  const cells = store.cells;
  const staged = useMemo(
    () => familyCellEntries(cells).filter((entry) => entry.cell.staged != null),
    [cells],
  );
  const plan = store.plan;
  const excludedIds = new Set(store.excludedIds);
  const pickedIds = store.pickedIds;
  const setPickedIds = store.actions.setPickedIds;
  const applyData = store.applyData;
  const showUncommon = store.showUncommon;
  const setShowUncommon = store.actions.setShowUncommon;
  const tableState = store.table;
  const busyState = store.busy;
  const busy = busyState?.key ?? null;
  const categoryFeed = store.feeds.category;
  const familyFeed = store.feeds.family;

  const fixture = fixtureFamilies !== undefined;
  // The resolved target came from this inventory subject. Requiring its current observation keeps
  // retained stale inventory from counting as a connected bridge.
  const connected =
    fixture || (scope !== undefined && store.handle.readings.inventory.state === "ready");

  // ── scope: the cheap catalog feeds both pickers; the matrix waits for Apply ───────────────────
  const categories = useMemo(
    () => categoryFeed.options?.map((option) => option.id) ?? [],
    [categoryFeed.options],
  );
  const draftFamilyNames = useMemo(
    () =>
      fixture
        ? fixtureFamilies.map((family) => family.familyName)
        : (familyFeed.options?.map((option) => option.id) ?? []),
    [fixture, fixtureFamilies, familyFeed.options],
  );

  // The plan's budget, so the band counts the families the plan will plan; samples lifted so no
  // type/cell is dropped from the master table.
  const matrixRequest = useMemo<LoadedFamiliesMatrixRequest | undefined>(
    () =>
      applied
        ? {
            filter: applied,
            budget: {
              maxEntries: FAMILY_CATALOG_LIMIT,
              maxSamplesPerEntry: 1000,
            },
            includeTempPlacement: true,
          }
        : undefined,
    [applied],
  );
  const matrix = useLoadedFamiliesMatrixQuery(matrixRequest, {
    ...scope,
    enabled: !fixture && connected && scope !== undefined && matrixRequest !== undefined,
  });
  useAfterApply(busy, () => {
    setPickedIds(new Set());
    matrix.refresh();
  });
  const families = useMemo(
    () => fixtureFamilies ?? matrix.data?.families ?? [],
    [fixtureFamilies, matrix.data?.families],
  );

  // ── table model ──────────────────────────────────────────────────────────────────────────────
  const { rows, params } = useMemo(() => {
    const params = new Map<string, ParamColumn & { seen: Set<string> }>();
    const rows: TypeRow[] = [];
    for (const family of families) {
      const visible = visibleParameters(family);
      for (const param of visible) {
        const key = param.definition.identity.key;
        let entry = params.get(key);
        if (!entry) {
          entry = {
            key,
            name: param.definition.identity.name,
            kind: param.kind,
            isInstance: param.definition.isInstance ?? false,
            isBuiltIn: param.definition.identity.kind === "BuiltInParameter",
            isProjectOnly: param.kind === "ProjectParameter",
            familyCount: 0,
            seen: new Set<string>(),
          };
          params.set(key, entry);
        }
        if (!entry.seen.has(family.familyUniqueId)) {
          entry.seen.add(family.familyUniqueId);
          entry.familyCount += 1;
        }
      }
      for (const typeName of family.typeNames) {
        const values: TypeRow["values"] = {};
        const scopes: TypeRow["scopes"] = {};
        const formulas: TypeRow["formulas"] = {};
        for (const param of visible) {
          const key = param.definition.identity.key;
          values[key] = cellText(param.valuesPerType[typeName]);
          scopes[key] = param.scope;
          formulas[key] = param.formulaState;
        }
        rows.push({
          key: `${family.familyUniqueId}::${typeName}`,
          familyId: family.familyId,
          familyName: family.familyName,
          categoryName: family.categoryName ?? "",
          typeName,
          typeCount: family.typeNames.length,
          values,
          scopes,
          formulas,
        });
      }
    }
    return { rows, params: [...params.values()].map(({ seen: _seen, ...rest }) => rest) };
  }, [families]);
  const totalFamilies = families.length;

  const planByFamilyId = useMemo(() => {
    const map = new Map<number, PlanEntry>();
    for (const entry of plan?.entries ?? []) map.set(Number(entry.id), entry);
    return map;
  }, [plan]);
  const receiptByFamilyId = useMemo(() => {
    const map = new Map<number, FfReceipt>();
    for (const entry of applyData?.receipts ?? []) map.set(entry.familyId, entry);
    return map;
  }, [applyData]);

  const familyState = useMemo(
    () =>
      (familyId: number): Verdict => {
        const done = receiptByFamilyId.get(familyId);
        if (done) {
          return done.success
            ? {
                word: done.converged ? "converged" : "residue",
                tone: done.converged ? "done" : "alarm",
                note: `${done.residue.length} change(s) remaining; ${done.errors.length} error(s)`,
              }
            : {
                // A refused write is the one thing on this row asking for a person: the ONE alarm.
                word: "failed",
                tone: "alarm",
                note: done.error ?? "apply failed with no reported reason",
              };
        }
        const entry = planByFamilyId.get(familyId);
        if (!plan) {
          return {
            word: "unplanned",
            tone: "mute",
            dim: true,
            note: "no plan compiled yet — the table is scope, not judgment",
          };
        }
        if (!entry) {
          return {
            word: "outside spec",
            tone: "mute",
            dim: true,
            note: "in scope, but the planned spec does not claim this family",
          };
        }
        const flag = entry.flag;
        // Not a warning about the model and not a refusal — a verdict with nothing behind it.
        if (flag) return { word: "no actions", tone: "mute", note: flag };
        return excludedIds.has(familyId)
          ? {
              word: "excluded",
              tone: "mute",
              dim: true,
              note: "excluded from apply in the decision queue",
            }
          : {
              /* Queued actions are UNSAVED work: nothing has left the page, and caution is the
                 language's staged rank. Deliberately NOT the commit blue — that is the verb's,
                 and a state dot wearing it would spend the one filled blue on a readout. */
              word: "included",
              tone: "caution",
              note: `${entry.actions} action(s) queued`,
            };
      },
    [plan, planByFamilyId, receiptByFamilyId, excludedIds],
  );

  // The one families cell wire: the store's write, plus the lock facts only the matrix knows.
  const wire = useMemo(
    (): CellWire => ({ ...store.wire, lockOf: familiesLockOf(rows, params) }),
    [store.wire, rows, params],
  );
  const { columns, uncommonCount } = useFamiliesColumns({
    familyState,
    params,
    showUncommon,
    totalFamilies,
    cells,
    propose: store.actions.propose,
    wire,
  });

  const stagedFamilies = useMemo(
    () => new Set(staged.map((entry) => entry.familyId)).size,
    [staged],
  );

  const chips = useTableChips({
    categories:
      applied && applied.categoryNames.length > 0
        ? {
            label: `categories · ${applied.categoryNames.length}`,
            onClear: () => setDraftCategories([]),
          }
        : null,
    placement:
      placement !== LoadedFamilyPlacement.AllLoaded
        ? {
            label: `placement · ${placement}`,
            onClear: () => setPlacement(LoadedFamilyPlacement.AllLoaded),
          }
        : null,
    uncommon:
      !showUncommon && uncommonCount > 0
        ? { label: `uncommon · ${uncommonCount} hidden`, onClear: () => setShowUncommon(true) }
        : null,
    picked:
      pickedIds.size > 0
        ? {
            label: `capture · ${pickedIds.size} picked · esc`,
            onClear: () => setPickedIds(new Set()),
          }
        : null,
    // Staged cells are what plan will generate: countable here, removable in one press.
    staged:
      staged.length > 0
        ? {
            label: `staged · ${staged.length} cell${staged.length === 1 ? "" : "s"} · ${stagedFamilies} famil${stagedFamilies === 1 ? "y" : "ies"}`,
            onClear: () =>
              void runFanOut(
                wire,
                cells,
                staged.map((entry) => entry.key),
                "unstage",
              ),
          }
        : null,
  });

  // ── verbs ────────────────────────────────────────────────────────────────────────────────────
  const includedPlanned = useMemo(
    () =>
      (plan?.entries ?? []).filter(
        (entry) => !excludedIds.has(Number(entry.id)) && entry.flag === null,
      ),
    [plan, excludedIds],
  );

  const matrixIssue = matrix.error
    ? toHostIssue(matrix.error, "Couldn't load the matrix")
    : undefined;
  const totalTypes = rows.length;

  // Families in scope the plan does not claim — surfaced as excluded-with-reason, never hidden.
  const outsideProfile = useMemo(
    () => (plan ? families.filter((family) => !planByFamilyId.has(family.familyId)) : []),
    [plan, families, planByFamilyId],
  );

  return {
    store,
    fixture,
    target,
    scope,
    draft,
    cells,
    placement,
    draftCategories,
    pickedFamilies,
    setPlacement,
    setDraftCategories,
    setPickedFamilies,
    applied,
    plan,
    excludedIds,
    pickedIds,
    setPickedIds,
    applyData,
    showUncommon,
    setShowUncommon,
    tableState,
    busy,
    categoryFeed,
    familyFeed,
    connected,
    categories,
    draftFamilyNames,
    matrixRequest,
    matrix,
    families,
    rows,
    params,
    totalFamilies,
    planByFamilyId,
    receiptByFamilyId,
    familyState,
    columns,
    uncommonCount,
    wire,
    chips,
    includedPlanned,
    matrixIssue,
    totalTypes,
    outsideProfile,
  };
}

export type FamiliesWorkspaceModel = ReturnType<typeof useFamiliesWorkspaceModel>;

export function FamiliesWorkspace({ store, url }: { store: FamiliesStore; url?: boolean }) {
  const model = useFamiliesWorkspaceModel(store, store.demo ? DEMO_FAMILIES : undefined);
  return (
    <FamiliesWorkspaceProvider value={model}>
      <FamiliesWorkspaceView url={url} />
    </FamiliesWorkspaceProvider>
  );
}
