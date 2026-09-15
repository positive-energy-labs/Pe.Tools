import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import type { FfPlanEntry, FfReceipt } from "@pe/agent-contracts";

import type { Verdict } from "#/components/master-table/model";
import { callHostRpc } from "#/host/client";
import { FF_PROFILE_MODULE } from "#/host/familyfoundry";
import type { FamiliesStore } from "#/families/store";
import { toHostIssue } from "#/host/issues";
import {
  cellText,
  visibleParameters,
  LoadedFamilyPlacement,
  type FamilySnapshotRecord,
  type LoadedFamiliesMatrixRequest,
} from "#/host/loaded-families-view";
import { useHostCall, HOST_QUERY_KEY, useLoadedFamiliesMatrixQuery } from "#/readings";
import { useTableChips } from "#/components/anatomy";
import { useFamiliesColumns, type ParamColumn, type TypeRow } from "#/families/matrix-columns";
import { familyFlag } from "#/families/plan";
import { FamiliesWorkspaceProvider } from "#/families/workspace-context";
import { FamiliesWorkspaceView } from "#/families/workspace-view";

type FfFamilyPlan = FfPlanEntry;
/** Profile library reads are one document-open each; cap the fan-out and say so when it bites. */
const PROFILE_READ_LIMIT = 40;
/** A parameter is "common" when it appears on this share of the families in scope. */

/** The placement filter's vocabulary, and what each choice MEANS for the audit. */
function useFamiliesWorkspaceModel(
  store: FamiliesStore,
  fixtureFamilies?: readonly FamilySnapshotRecord[],
) {
  const navigate = useNavigate();
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
  const profilePath = store.profilePath;
  const plan = store.plan;
  const excludedIds = new Set(store.excludedIds);
  const pickedIds = store.pickedIds;
  const setPickedIds = store.actions.setPickedIds;
  const applyData = store.applyData;
  const projection = store.projection;
  const showUncommon = store.showUncommon;
  const setShowUncommon = store.actions.setShowUncommon;
  const tableState = store.table;
  const busyState = store.busy;
  const busy = busyState?.key ?? null;
  const categoryFeed = store.feeds.category;
  const familyFeed = store.feeds.family;
  const profileFeed = store.feeds.profile;

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

  // Budget sized to the picked family list so nothing truncates silently, and samples lifted so
  // no type/cell is dropped from the master table.
  const matrixRequest = useMemo<LoadedFamiliesMatrixRequest | undefined>(
    () =>
      applied
        ? {
            filter: applied,
            budget: {
              maxEntries: Math.max(applied.familyNames.length, 10),
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
  const families = useMemo(
    () => fixtureFamilies ?? matrix.data?.families ?? [],
    [fixtureFamilies, matrix.data?.families],
  );

  // ── profile library: the store feeds paths; document.open validates each entry ───────────────
  const allProfilePaths = useMemo(
    () => (profileFeed.options ?? []).map((option) => option.id),
    [profileFeed.options],
  );
  const profilePaths = useMemo(
    () => allProfilePaths.slice(0, PROFILE_READ_LIMIT),
    [allProfilePaths],
  );
  // The profile library is ONE Reading of many documents, not one query per path.
  const profileLibrary = useHostCall(
    () =>
      Promise.all(
        profilePaths.map((relativePath) =>
          callHostRpc(
            "settings.document.open",
            { documentId: { ...FF_PROFILE_MODULE, relativePath } },
            scope,
          ).then(
            (data) => ({ data, error: undefined as unknown }),
            (error: unknown) => ({ data: undefined, error }),
          ),
        ),
      ),
    [...HOST_QUERY_KEY, target, "settings.document.open", profilePaths.join("|")],
    !fixture,
  );
  const profileDocs = profileLibrary.data ?? [];

  const selectedProfileIndex = profilePath ? profilePaths.indexOf(profilePath) : -1;
  const selectedProfileQuery = selectedProfileIndex >= 0 ? profileDocs[selectedProfileIndex] : null;

  /* Esc drops the table's selection — the one piece of route state a stray click can build up.
     It is deliberately ONE step and never touches scope, plan, or exclusions: those are
     commitments, and a commitment should not fall out of the app on a keystroke. */
  useEffect(() => {
    if (pickedIds.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,select,textarea,[contenteditable=true]")) return;
      setPickedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedIds]);

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
    const map = new Map<number, FfFamilyPlan>();
    for (const entry of plan?.entries ?? []) map.set(entry.familyId, entry);
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
            word: "outside profile",
            tone: "mute",
            dim: true,
            note: "in scope, but the bound profile does not claim this family",
          };
        }
        const flag = familyFlag(entry);
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
              note: `${entry.changes.length + entry.runEffects.length} action(s) queued`,
            };
      },
    [plan, planByFamilyId, receiptByFamilyId, excludedIds],
  );

  const { columns, uncommonCount } = useFamiliesColumns({
    familyState,
    params,
    pickedIds,
    setPickedIds,
    showUncommon,
    totalFamilies,
  });

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
            label: `projection · ${pickedIds.size} picked · esc`,
            onClear: () => setPickedIds(new Set()),
          }
        : null,
  });

  // ── verbs ────────────────────────────────────────────────────────────────────────────────────
  const includedPlanned = useMemo(
    () =>
      (plan?.entries ?? []).filter(
        (entry) => !excludedIds.has(entry.familyId) && familyFlag(entry) === null,
      ),
    [plan, excludedIds],
  );

  const runProject = () => void store.actions.project();

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
    navigate,
    target,
    scope,
    draft,
    placement,
    draftCategories,
    pickedFamilies,
    setPlacement,
    setDraftCategories,
    setPickedFamilies,
    applied,
    profilePath,
    plan,
    excludedIds,
    pickedIds,
    setPickedIds,
    applyData,
    projection,
    showUncommon,
    setShowUncommon,
    tableState,
    busy,
    categoryFeed,
    familyFeed,
    profileFeed,
    status,
    connected,
    categories,
    draftFamilyNames,
    matrixRequest,
    matrix,
    families,
    allProfilePaths,
    profilePaths,
    profileDocs,
    selectedProfileIndex,
    selectedProfileQuery,
    rows,
    params,
    totalFamilies,
    planByFamilyId,
    receiptByFamilyId,
    familyState,
    columns,
    uncommonCount,
    chips,
    includedPlanned,
    runProject,
    matrixIssue,
    totalTypes,
    outsideProfile,
  };
}

export type FamiliesWorkspaceModel = ReturnType<typeof useFamiliesWorkspaceModel>;

export function FamiliesWorkspace({
  store,
  fixtureFamilies,
}: {
  store: FamiliesStore;
  fixtureFamilies?: readonly FamilySnapshotRecord[];
}) {
  const model = useFamiliesWorkspaceModel(store, fixtureFamilies);
  return (
    <FamiliesWorkspaceProvider value={model}>
      <FamiliesWorkspaceView />
    </FamiliesWorkspaceProvider>
  );
}
