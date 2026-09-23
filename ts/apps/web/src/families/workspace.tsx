import { useMemo } from "react";
import { familyCellValueSchema, type FamilyCellState } from "@pe/agent-contracts";

import { runFanOut, type CellWire } from "#/components/lang/band";
import type { FamiliesStore } from "#/families/store";
import { useMeasuredParse } from "#/host/measured-parse";
import {
  cellText,
  visibleParameters,
  LoadedFamilyPlacement,
  type FamilySnapshotRecord,
} from "#/host/loaded-families-view";
import { useTableChips } from "#/components/anatomy";
import {
  familiesLockOf,
  isYesNo,
  useLiveCells,
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

const NO_CELLS: Record<string, FamilyCellState> = {};
const NO_EXCLUDED = new Set<string>();

/** The placement filter's vocabulary, and what each choice MEANS for the audit. */
function useFamiliesWorkspaceModel(
  store: FamiliesStore,
  fixtureFamilies?: readonly FamilySnapshotRecord[],
) {
  const target = store.target;
  const archived = store.page.stage === "archived";
  const scope = store.documentScope;
  const draft = store.draft;
  const { placement, categories: draftCategories, families: pickedFamilies } = draft;
  const setPlacement = (next: LoadedFamilyPlacement) =>
    store.actions.setDraft((previous) => ({ ...previous, placement: next }));
  const setDraftCategories = (next: string[]) =>
    store.actions.setDraft((previous) => ({ ...previous, categories: next, families: null }));
  const setPickedFamilies = (next: string[] | null) =>
    store.actions.setDraft((previous) => ({ ...previous, families: next }));
  const visibleReading = archived
    ? store.archive.reading
    : ([store.page.reading, store.retainedReading].find(
        (reading) =>
          reading &&
          scope &&
          reading.document.session === scope.bridgeSessionId &&
          reading.document.openId === scope.openDocumentId,
      ) ?? null);
  const applied = archived
    ? (visibleReading?.filter ?? null)
    : fixtureFamilies
      ? store.applied
      : (visibleReading?.filter ?? null);
  const cells = archived ? NO_CELLS : store.cells;
  const staged = useMemo(
    () => familyCellEntries(cells).filter((entry) => entry.cell.staged != null),
    [cells],
  );
  const plan = archived ? null : store.plan;
  const applyData = archived ? null : store.applyData;
  const tableState = store.table;
  const busyState = store.busy;
  const busy = busyState?.key ?? null;
  const categoryFeed = store.feeds.category;
  const familyFeed = store.feeds.family;

  const fixture = !archived && fixtureFamilies !== undefined;
  // The resolved target came from this inventory subject. Requiring its current observation keeps
  // retained stale inventory from counting as a connected bridge.
  const connected =
    archived ||
    fixture ||
    (scope !== undefined && store.handle.readings.inventory.state === "ready");

  // Cheap catalog feeds the chooser. The matrix waits for the explicit read action.
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

  const readAgain = () => void store.handle.actions.read.run();
  const families = useMemo(
    () =>
      (archived
        ? visibleReading?.result.families
        : (fixtureFamilies ?? visibleReading?.result.families)) ?? [],
    [archived, fixtureFamilies, visibleReading?.result.families],
  );
  // Work holds exclusions by family name; so does every verdict and plan row read here.
  const excludedNames = useMemo(
    () => (archived ? NO_EXCLUDED : new Set(Object.keys(store.excluded))),
    [archived, store.excluded],
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
        const storageTypes: TypeRow["storageTypes"] = {};
        const displayUnits: NonNullable<TypeRow["displayUnits"]> = {};
        const yesNos: NonNullable<TypeRow["yesNos"]> = {};
        for (const param of visible) {
          const key = param.definition.identity.key;
          values[key] = cellText(param.valuesPerType[typeName]);
          scopes[key] = param.scope;
          formulas[key] = param.formulaState;
          storageTypes[key] = familyCellValueSchema.shape.storageType.safeParse(
            param.storageType,
          ).data;
          displayUnits[key] = param.displayUnit ?? null;
          yesNos[key] = isYesNo(param.definition.dataTypeId);
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
          storageTypes,
          displayUnits,
          yesNos,
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
  const live = useLiveCells(cells, wire);

  const stagedFamilies = useMemo(
    () => new Set(staged.map((entry) => entry.familyName)).size,
    [staged],
  );

  const chips = useTableChips({
    categories:
      !archived && applied && applied.categoryNames.length > 0
        ? {
            label: `categories · ${applied.categoryNames.length}`,
            onClear: () => setDraftCategories([]),
          }
        : null,
    placement:
      !archived && placement !== LoadedFamilyPlacement.AllLoaded
        ? {
            label: `placement · ${placement}`,
            onClear: () => setPlacement(LoadedFamilyPlacement.AllLoaded),
          }
        : null,
    // Staged cells are what plan will generate: countable here, removable in one press.
    staged:
      !archived && staged.length > 0
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

  const matrixIssue =
    archived && store.archive.error
      ? { title: "Couldn't load archived reading", message: store.archive.error }
      : store.handle.outcome?.key === "read" && store.handle.outcome.refusal
        ? { title: "Couldn't read families", message: store.handle.outcome.refusal.message }
        : undefined;
  /** The matrix read is in flight: an empty table is "reading", never "resolved to none". */
  const matrixReading = archived ? store.archive.loading : !fixture && busy === "read";
  const totalTypes = rows.length;

  // Families in scope the plan does not claim — surfaced as excluded-with-reason, never hidden.
  const outsideProfile = useMemo(
    () => (plan ? families.filter((family) => !planByName.has(family.familyName)) : []),
    [plan, families, planByName],
  );

  return {
    store,
    archived,
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
    lastReading: visibleReading,
    retainedError: archived ? store.archive.error : store.retainedError,
    applyData,
    tableState,
    busy,
    categoryFeed,
    familyFeed,
    connected,
    categories,
    draftFamilyNames,
    families,
    rows,
    params,
    totalFamilies,
    familyState,
    wire,
    live,
    parse,
    chips,
    includedPlanned,
    matrixIssue,
    matrixReading,
    changed: !archived && store.handle.work.changed && !fixture,
    readAgain,
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
