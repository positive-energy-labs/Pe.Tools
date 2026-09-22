import { useEffect, useMemo, useRef } from "react";
import { FAMILY_CATALOG_LIMIT } from "@pe/agent-contracts";

import { runFanOut, type CellWire } from "#/components/lang/band";
import type { FamiliesStore } from "#/families/store";
import { toHostIssue } from "#/host/issues";
import { useMeasuredParse } from "#/host/measured-parse";
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
  isYesNo,
  useFamiliesColumns,
  type ParamColumn,
  type TypeRow,
} from "#/families/matrix-columns";
import type { PlanEntry } from "#/route";
import { FamiliesWorkspaceProvider } from "#/families/workspace-context";
import { FamiliesWorkspaceView } from "#/families/workspace-view";
import { DEMO_FAMILIES } from "#/families/seeds";
import { familyCellEntries } from "#/families/staged";
import { familyVerdicts } from "#/families/verdict";
import { typeRowKey } from "#/families/picks";

/**
 * Revit reloads every applied family under a new element id (w8-revit trip 12), so once an apply
 * settles, whatever its outcome, the audit re-reads its scope. Rows, picks, receipts and the next
 * plan key by family name, so they carry across; the sheet's hashes closed with it.
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
  const picked = store.picked;
  const setPicked = store.actions.setPicked;
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
    // Not gated on the inventory's freshness: Revit busy with this very read lets the inventory
    // go stale, and a gate on it aborted the read it was waiting for, forever (F-J1-4, hold 3).
    // The resolved scope survives that gap; a bridge truly gone ends through the read's own wait.
    enabled: !fixture && scope !== undefined && matrixRequest !== undefined,
  });
  useAfterApply(busy, () => matrix.refresh());
  const families = useMemo(
    () => fixtureFamilies ?? matrix.data?.families ?? [],
    [fixtureFamilies, matrix.data?.families],
  );
  // Capture's contract takes ids: mirror this reading's name → id for it (see FamiliesPage.loaded).
  const setLoaded = store.actions.setLoaded;
  useEffect(() => {
    setLoaded(Object.fromEntries(families.map((family) => [family.familyName, family.familyId])));
  }, [families, setLoaded]);
  // Work holds exclusions by family name; so does every verdict and plan row read here.
  const excludedNames = useMemo(() => new Set(Object.keys(store.excluded)), [store.excluded]);

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
            yesNo: isYesNo(param.definition.dataTypeId),
            displayUnit: param.displayUnit ?? null,
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
          key: typeRowKey(family, typeName),
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

  const planByName = useMemo(
    () => new Set((plan?.entries ?? []).map((entry: PlanEntry) => entry.id)),
    [plan],
  );
  const familyState = useMemo(
    () => familyVerdicts(plan, applyData?.receipts ?? [], excludedNames),
    [plan, applyData, excludedNames],
  );

  // The one families cell wire: the store's write, plus the lock facts only the matrix knows.
  const wire = useMemo(
    (): CellWire => ({ ...store.wire, lockOf: familiesLockOf(rows, params) }),
    [store.wire, rows, params],
  );
  // A measured cell's one call, owned by this matrix Reading: a re-read aborts what is in flight.
  const parse = useMeasuredParse(families, store.documentScope);
  const { columns, uncommonCount } = useFamiliesColumns({
    familyState,
    params,
    showUncommon,
    totalFamilies,
    cells,
    propose: store.actions.propose,
    wire,
    parse,
  });

  const stagedFamilies = useMemo(
    () => new Set(staged.map((entry) => entry.familyName)).size,
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
      picked.size > 0
        ? {
            label: `capture · ${picked.size} picked · esc`,
            onClear: () => setPicked(new Set()),
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
      (plan?.entries ?? []).filter((entry) => !excludedNames.has(entry.id) && entry.flag === null),
    [plan, excludedNames],
  );

  const matrixIssue = matrix.error
    ? toHostIssue(matrix.error, "Couldn't load the matrix")
    : undefined;
  /** The matrix read is in flight: an empty table is "reading", never "resolved to none". */
  const matrixReading = !fixture && matrix.pending;
  const totalTypes = rows.length;

  // Families in scope the plan does not claim — surfaced as excluded-with-reason, never hidden.
  const outsideProfile = useMemo(
    () => (plan ? families.filter((family) => !planByName.has(family.familyName)) : []),
    [plan, families, planByName],
  );

  return {
    store,
    /** The saved Work cannot be read: its refusal and start fresh are the only instruction, so
     * every Work-bearing control is inert and no empty-Work instruction is drawn (F-J6-1). */
    workUnreadable: store.handle.work.refusal != null,
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
    picked,
    setPicked,
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
    familyState,
    columns,
    uncommonCount,
    wire,
    chips,
    includedPlanned,
    matrixIssue,
    matrixReading,
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
