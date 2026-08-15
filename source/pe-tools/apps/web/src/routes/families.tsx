/**
 * /families — FFMigrator's web home: the fleet lane.
 *
 * THE LAW: the table always answers "everything currently in scope"; the plan is a LENS over it,
 * never a replacement. A compiled plan tints rows and opens a decision queue above the table — it
 * never hides a family, never becomes the only thing on screen, and never silently narrows scope.
 *
 * The three lanes, in order of commitment:
 *   scope  — categories + placement, draft until Apply (the matrix op is the expensive one, so its
 *            budget is sized to the resolved family list and never fired on keystroke).
 *   plan   — profile in, per-family reconciliation + planHash out. Read-only; a lens.
 *   apply  — explicit familyIds + expectedPlanHash, gated behind a human-readable reason, receipts
 *            out. Drift is refused by the op, echoed here as an error with re-plan guidance.
 * The projection lane runs sideways: families picked in the table, dense profile JSON back.
 *
 * All Family Foundry calls go through `#/host/familyfoundry`, fully typed against the checked-in
 * generated clients. The remaining unproven surface is LIVE behavior (SHIMS: step-3 live proof).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ReadCell, stateColumn, type StateMeta } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Sentence, type SlotOption } from "#/components/sentence";
import { callHostRpc } from "#/host/client";
import {
  FF_PROFILE_MODULE,
  diagnosticLine,
  familyFoundryApply,
  familyFoundryPlan,
  familyFoundryProject,
  openHostPath,
  type FfApplyData,
  type FfFamilyPlan,
  type FfPlanData,
  type FfProjectData,
  type FfReconciliationPlan,
} from "#/host/familyfoundry";
import { HostIssuePanel, toHostIssue } from "#/host/issues";
import {
  cellText,
  visibleParameters,
  LoadedFamilyPlacementScope,
  type FamilyParameterSnapshot,
  type FamilySnapshotRecord,
  type LoadedFamiliesMatrixRequest,
} from "#/host/loaded-families-view";
import {
  HOST_QUERY_KEY,
  useBridgeSessionSummaryQuery,
  useHostStatusQuery,
  useLoadedFamiliesCatalogQuery,
  useLoadedFamiliesMatrixQuery,
  useTreeQuery,
} from "#/host/queries";
import { useVerb } from "#/lib/use-verb";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/families")({ component: FamiliesRoute });

/** Profile library reads are one document-open each; cap the fan-out and say so when it bites. */
const PROFILE_READ_LIMIT = 40;
/** A parameter is "common" when it appears on this share of the families in scope. */
const COMMON_SHARE = 0.3;

// ── scope model ─────────────────────────────────────────────────────────────────────────────────

interface AppliedScope {
  categoryNames: string[];
  familyNames: string[];
  placementScope: LoadedFamilyPlacementScope;
}

/** One table row: a family TYPE. Families repeat down the family column, as a spreadsheet should. */
interface TypeRow {
  key: string;
  familyId: number;
  familyName: string;
  categoryName: string;
  typeName: string;
  typeCount: number;
  values: Record<string, string>;
  scopes: Record<string, FamilyParameterSnapshot["scope"]>;
  formulas: Record<string, FamilyParameterSnapshot["formulaState"]>;
}

interface ParamColumn {
  key: string;
  name: string;
  kind: FamilyParameterSnapshot["kind"];
  isInstance: boolean;
  isBuiltIn: boolean;
  isProjectOnly: boolean;
  familyCount: number;
}

type Cluster = "built-in" | "common" | "uncommon" | "project-only";

/** family-matrix's clustering semantics, kept verbatim: built-ins, then common, then the tail. */
function clusterOf(col: ParamColumn, totalFamilies: number): Cluster {
  if (col.isProjectOnly) return "project-only";
  if (col.isBuiltIn) return "built-in";
  return col.familyCount >= Math.max(2, totalFamilies * COMMON_SHARE) ? "common" : "uncommon";
}

const CLUSTER_ORDER: Record<Cluster, number> = {
  "built-in": 0,
  common: 1,
  uncommon: 2,
  "project-only": 3,
};

function flatten(families: readonly FamilySnapshotRecord[]): {
  rows: TypeRow[];
  params: ParamColumn[];
} {
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

  return {
    rows,
    params: [...params.values()].map(({ seen: _seen, ...rest }) => rest),
  };
}

/** What a cell's value MEANS — the title text, so a read-only cell still explains itself. */
function cellReason(row: TypeRow, key: string): string {
  const scope = row.scopes[key];
  if (!scope || scope === "Unresolved")
    return "This parameter does not exist on this family, so there is nothing to read and nothing a profile could change here.";
  if (scope === "ProjectBindingOnly")
    return "Bound at the PROJECT, not owned by the family. The value lives on placed instances; editing the family will not move it.";
  if (row.formulas[key] === "Present")
    return "Driven by a formula inside the family — the number shown is what the formula resolved to for this type, not an authored value.";
  return row.values[key]
    ? `Authored value for this type: ${row.values[key]}. Read-only here — /families audits the fleet; edit one family in /family.`
    : "The parameter exists on this family but this type carries no value for it.";
}

// ── plan lens ───────────────────────────────────────────────────────────────────────────────────

/**
 * Which layers of the profile decided the parameter facets, counted. The op reports provenance per
 * facet (identity / dataType / propertiesGroup / isInstance / tooltip); this is the honest rollup —
 * counts of reported sources, no interpretation of what a source "means".
 */
function provenanceSummary(plan: FfReconciliationPlan): string {
  const counts = new Map<string, number>();
  for (const param of plan.parameters) {
    const facets = [
      param.provenance.identity,
      param.provenance.dataType,
      param.provenance.propertiesGroup,
      param.provenance.isInstance,
      param.provenance.tooltip,
    ];
    for (const facet of facets) {
      if (facet) counts.set(facet, (counts.get(facet) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return "no provenance reported";
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([source, count]) => `${source} ×${count}`)
    .join(" · ");
}

/**
 * A planned family the apply lane must refuse. The op reports diagnostics at PROFILE level, not per
 * family, so the only honest per-family flag is an empty action set: the plan compiled, and it has
 * nothing to do here.
 */
function familyFlag(entry: FfFamilyPlan): string | null {
  return entry.plan.loweredActions.length === 0
    ? "plan compiled with no actions for this family — nothing to apply"
    : null;
}

// ── seam chip ───────────────────────────────────────────────────────────────────────────────────

/** Marks a surface whose LIVE behavior is unproven. Dashed = "typed, but not yet exercised". */
function Seam({ op }: { op: string }) {
  return (
    <span
      title={`${op} is a typed bridge op that has never met a live Revit session. It will run — nothing here is a mock — but its live behaviour is unproven, and docs/features/family/SHIMS.md names the step-3 proof that closes this chip.`}
      className="tele rounded-[2px] border border-dashed border-[var(--line-2)] px-1 text-[10px] text-muted-foreground"
    >
      unproven · {op}
    </span>
  );
}

function Verb({
  label,
  onClick,
  disabled,
  reason,
  busy,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string | null;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={reason ?? label}
      className={cn(
        "tele h-6 rounded-[2px] border px-2",
        disabled || busy
          ? "cursor-not-allowed border-[var(--line-soft)] text-muted-foreground"
          : "border-[var(--line-2)] text-foreground hover:border-[var(--pe-blue)]",
      )}
    >
      {busy ? `${label}…` : label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="section-label">{children}</span>;
}

// ── route ───────────────────────────────────────────────────────────────────────────────────────

function FamiliesRoute() {
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  const scope = useMemo(() => (target ? { bridgeSessionId: target } : undefined), [target]);

  const [placement, setPlacement] = useState<LoadedFamilyPlacementScope>(
    LoadedFamilyPlacementScope.AllLoaded,
  );
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [applied, setApplied] = useState<AppliedScope | null>(null);

  const [profilePath, setProfilePath] = useState<string | null>(null);
  const [plan, setPlan] = useState<FfPlanData | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [applyData, setApplyData] = useState<FfApplyData | null>(null);
  const [projection, setProjection] = useState<FfProjectData | null>(null);
  const [showUncommon, setShowUncommon] = useState(false);
  const { busy, error, setError, receipt, run } = useVerb();

  const status = useHostStatusQuery(scope);
  const session = useBridgeSessionSummaryQuery(scope);
  const connected = status.data?.bridgeIsConnected ?? false;
  const activeDocument = session.data?.activeDocument?.title ?? null;

  // ── scope: the cheap catalog feeds both pickers; the matrix waits for Apply ───────────────────
  const categoryCatalog = useLoadedFamiliesCatalogQuery(
    {
      filter: { placementScope: LoadedFamilyPlacementScope.AllLoaded },
      budget: { maxEntries: 5000 },
    },
    { ...scope, enabled: connected },
  );
  const categories = useMemo(() => {
    const names = (categoryCatalog.data?.families ?? [])
      .map((family) => family.categoryName)
      .filter((name): name is string => Boolean(name?.trim()));
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [categoryCatalog.data?.families]);

  const draftCatalog = useLoadedFamiliesCatalogQuery(
    {
      filter: { categoryNames: draftCategories, placementScope: placement },
      budget: { maxEntries: 5000 },
    },
    { ...scope, enabled: connected && draftCategories.length > 0 },
  );
  const draftFamilyNames = useMemo(
    () =>
      (draftCatalog.data?.families ?? [])
        .map((family) => family.familyName)
        .filter((name) => name.trim().length > 0)
        .sort((a, b) => a.localeCompare(b)),
    [draftCatalog.data?.families],
  );

  // Budget sized to the resolved family list so nothing truncates silently, and samples lifted so
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
    enabled: connected && matrixRequest !== undefined,
  });
  const families = useMemo(() => matrix.data?.families ?? [], [matrix.data?.families]);

  const scopeDrifted =
    applied !== null &&
    (JSON.stringify(applied.categoryNames) !== JSON.stringify(draftCategories) ||
      applied.placementScope !== placement);

  // ── profile library: settings.tree enumerates it, document.open validates each entry ──────────
  const profileTree = useTreeQuery(
    {
      ...FF_PROFILE_MODULE,
      subDirectory: "",
      recursive: true,
      includeFragments: false,
      includeSchemas: false,
    },
    { ...scope, enabled: connected },
  );
  const allProfilePaths = useMemo(
    () =>
      (profileTree.data?.files ?? [])
        .filter((file) => file.relativePath.toLowerCase().endsWith(".json"))
        .map((file) => file.relativePath)
        .sort((a, b) => a.localeCompare(b)),
    [profileTree.data?.files],
  );
  const profilePaths = useMemo(
    () => allProfilePaths.slice(0, PROFILE_READ_LIMIT),
    [allProfilePaths],
  );
  const profileDocs = useQueries({
    queries: profilePaths.map((relativePath) => ({
      queryKey: [...HOST_QUERY_KEY, target, "settings.document.open", relativePath],
      queryFn: () =>
        callHostRpc(
          "settings.document.open",
          { documentId: { ...FF_PROFILE_MODULE, relativePath } },
          scope,
        ),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const profileOptions = useMemo<SlotOption[]>(() => {
    const options: SlotOption[] = profilePaths.map((relativePath, index) => {
      const query = profileDocs[index];
      const issues = query?.data?.validation.issues ?? [];
      const disabledReason = query?.error
        ? `could not read: ${(query.error as Error).message}`
        : issues.length > 0
          ? issues
              .slice(0, 2)
              .map((issue) => `${issue.code} · ${issue.path}: ${issue.message}`)
              .join(" · ")
          : undefined;
      return {
        id: relativePath,
        label: relativePath,
        sub: query?.isPending ? "reading…" : undefined,
        disabledReason,
      };
    });
    // The cap must never bite silently (docblock law): name the hidden remainder.
    if (allProfilePaths.length > PROFILE_READ_LIMIT) {
      options.push({
        id: "__truncated__",
        label: `…${allProfilePaths.length - PROFILE_READ_LIMIT} more profiles not shown`,
        disabledReason: `only the first ${PROFILE_READ_LIMIT} (by name) are read — prune or rename the library to surface others`,
      });
    }
    return options;
  }, [profilePaths, profileDocs, allProfilePaths.length]);
  const profileJson = useMemo(() => {
    const index = profilePath ? profilePaths.indexOf(profilePath) : -1;
    return index >= 0 ? (profileDocs[index]?.data?.rawContent ?? null) : null;
  }, [profilePath, profilePaths, profileDocs]);

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

  // A re-bound profile invalidates every downstream commitment.
  useEffect(() => {
    setPlan(null);
    setApplyData(null);
    setExcludedIds(new Set());
  }, [profilePath]);

  // ── table model ──────────────────────────────────────────────────────────────────────────────
  const { rows, params } = useMemo(() => flatten(families), [families]);
  const totalFamilies = families.length;

  const planByFamilyId = useMemo(() => {
    const map = new Map<number, FfFamilyPlan>();
    for (const entry of plan?.families ?? []) map.set(entry.familyId, entry);
    return map;
  }, [plan]);
  const receiptByFamilyId = useMemo(() => {
    const map = new Map<number, FfApplyData["receipts"][number]>();
    for (const entry of applyData?.receipts ?? []) map.set(entry.familyId, entry);
    return map;
  }, [applyData]);

  const familyState = useMemo(
    () =>
      (familyId: number): StateMeta => {
        const done = receiptByFamilyId.get(familyId);
        if (done) {
          return done.success
            ? {
                label: "applied",
                tone: "var(--cat-green)",
                note: `${done.parametersChanged} parameter(s) changed · +${done.diffSummary.added} −${done.diffSummary.removed} ~${done.diffSummary.modified}`,
              }
            : {
                label: "failed",
                tone: "var(--cat-clay)",
                alarm: true,
                note: done.error ?? "apply failed with no reported reason",
              };
        }
        const entry = planByFamilyId.get(familyId);
        if (!plan) {
          return {
            label: "unplanned",
            tone: "var(--muted-foreground)",
            dim: true,
            note: "no plan compiled yet — the table is scope, not judgment",
          };
        }
        if (!entry) {
          return {
            label: "outside profile",
            tone: "var(--muted-foreground)",
            dim: true,
            note: "in scope, but the bound profile does not claim this family",
          };
        }
        const flag = familyFlag(entry);
        if (flag) return { label: "no actions", tone: "var(--cat-kiln)", note: flag };
        return excludedIds.has(familyId)
          ? {
              label: "excluded",
              tone: "var(--muted-foreground)",
              dim: true,
              note: "excluded from apply in the decision queue",
            }
          : {
              label: "included",
              tone: "var(--pe-blue)",
              note: `${entry.plan.loweredActions.length} action(s) queued`,
            };
      },
    [plan, planByFamilyId, receiptByFamilyId, excludedIds],
  );

  const columns = useMemo<Column<TypeRow>[]>(() => {
    const ordered = [...params].sort((a, b) => {
      const clusterDiff =
        CLUSTER_ORDER[clusterOf(a, totalFamilies)] - CLUSTER_ORDER[clusterOf(b, totalFamilies)];
      if (clusterDiff !== 0) return clusterDiff;
      if (clusterOf(a, totalFamilies) === "common" && a.familyCount !== b.familyCount) {
        return b.familyCount - a.familyCount;
      }
      return a.name.localeCompare(b.name);
    });
    const shown = showUncommon
      ? ordered
      : ordered.filter((col) => clusterOf(col, totalFamilies) !== "uncommon");

    const identity: Column<TypeRow>[] = [
      {
        key: "pick",
        label: "pick",
        group: "family",
        title:
          "Picked families feed the projection verb, which reads them back out of the model as profile JSON. Picking changes nothing in Revit — Esc clears the whole set.",
        /* Wide enough for its own filter select — a facet column narrower than its dropdown
           clips the word "any" and reads as a rendering bug. */
        width: "w-16",
        facet: (row) => (pickedIds.has(row.familyId) ? "picked" : ""),
        all: "any",
        cell: (row) => (
          <button
            type="button"
            title={
              pickedIds.has(row.familyId)
                ? `Drop ${row.familyName} from the projection set — the plan and the apply lane are untouched either way.`
                : `Add ${row.familyName} to the projection set, so "project → profile" reads its parameters back out as profile JSON.`
            }
            onClick={() =>
              setPickedIds((prev) => {
                const next = new Set(prev);
                if (next.has(row.familyId)) next.delete(row.familyId);
                else next.add(row.familyId);
                return next;
              })
            }
            className="tele h-7 w-full px-1.5 text-left text-muted-foreground hover:text-foreground"
          >
            {pickedIds.has(row.familyId) ? "▪" : "□"}
          </button>
        ),
      },
      {
        key: "family",
        label: "family",
        group: "family",
        sort: (row) => row.familyName,
        search: (row) => row.familyName,
        width: "w-56",
        cell: (row) => (
          <ReadCell
            value={row.familyName}
            reason={`${row.familyName} — ${row.typeCount} type(s), element id ${row.familyId}. Click the row to open this one family in /family, in the bound session's family editor.`}
          />
        ),
      },
      {
        key: "type",
        label: "type",
        group: "family",
        sort: (row) => row.typeName,
        search: (row) => row.typeName,
        width: "w-40",
        title:
          "One row per family TYPE, so the family name repeats down the column exactly as a spreadsheet would.",
        cell: (row) => (
          <ReadCell
            value={row.typeName}
            reason={`Type "${row.typeName}" of ${row.familyName}. Every value in this row is that type's, not the family's.`}
          />
        ),
      },
      {
        key: "category",
        label: "category",
        group: "family",
        sort: (row) => row.categoryName,
        facet: (row) => row.categoryName,
        all: "any category",
        width: "w-36",
        title:
          "The family's Revit category. Categories are also how the scope above is drafted, so filtering here narrows what you already loaded rather than loading more.",
        cell: (row) => (
          <ReadCell
            value={row.categoryName}
            reason={`Revit category ${row.categoryName || "(none reported)"} — assigned by the family template, not editable from here.`}
          />
        ),
      },
      /* The plan verdict sits AFTER the identity cluster, not inside it: the plan is a lens over
         these rows, not part of what a family is. Keeping it here also keeps the "family" cluster
         contiguous, which is what the clustered header row needs to span correctly. */
      stateColumn<TypeRow>({
        key: "plan-state",
        label: "plan",
        title:
          "What the compiled plan says about this family. The plan is a LENS: it tints rows and fills the decision queue, but it never hides a family or narrows the scope you asked for.",
        of: (row) => familyState(row.familyId),
      }),
    ];

    const parameterColumns: Column<TypeRow>[] = shown.map((col) => {
      const cluster = clusterOf(col, totalFamilies);
      return {
        key: col.key,
        label: col.name,
        group: cluster,
        title: `${col.name} — a ${col.kind} bound per ${col.isInstance ? "instance" : "type"}, present on ${col.familyCount} of ${totalFamilies} families in scope. That share is what put it in the "${cluster}" cluster; uncommon ones are hidden until you clear their chip.`,
        sort: (row) => row.values[col.key] ?? "",
        width: "w-28",
        cell: (row) => {
          const scopeOf = row.scopes[col.key];
          const value = row.values[col.key] ?? "";
          const unresolved = !scopeOf || scopeOf === "Unresolved";
          return (
            <ReadCell
              value={unresolved ? "" : value || "—"}
              reason={cellReason(row, col.key)}
              /* Colour budget: clay alarms, green is done. A project binding and a formula are
                 FACTS about where a value lives, not alarms — they get quiet ink. */
              className={cn(
                unresolved && "text-muted-foreground/30",
                scopeOf === "ProjectBindingOnly" && "text-muted-foreground italic",
                row.formulas[col.key] === "Present" && "text-cat-lichen",
              )}
            />
          );
        },
      };
    });

    return [...identity, ...parameterColumns];
  }, [params, totalFamilies, showUncommon, pickedIds, familyState]);

  const uncommonCount = useMemo(
    () => params.filter((col) => clusterOf(col, totalFamilies) === "uncommon").length,
    [params, totalFamilies],
  );

  const chips = useMemo(() => {
    const list: { label: string; onClear: () => void }[] = [];
    if (applied && applied.categoryNames.length > 0) {
      list.push({
        label: `categories: ${applied.categoryNames.length}`,
        onClear: () => {
          setDraftCategories([]);
          setApplied(null);
        },
      });
    }
    if (placement !== LoadedFamilyPlacementScope.AllLoaded) {
      list.push({
        label: `placement: ${placement}`,
        onClear: () => setPlacement(LoadedFamilyPlacementScope.AllLoaded),
      });
    }
    if (!showUncommon && uncommonCount > 0) {
      list.push({
        label: `${uncommonCount} uncommon params hidden`,
        onClear: () => setShowUncommon(true),
      });
    }
    if (pickedIds.size > 0) {
      list.push({
        label: `${pickedIds.size} picked for projection · esc clears`,
        onClear: () => setPickedIds(new Set()),
      });
    }
    return list;
  }, [applied, placement, showUncommon, uncommonCount, pickedIds]);

  // ── verbs ────────────────────────────────────────────────────────────────────────────────────
  const applyScope = () => {
    if (draftCategories.length === 0) return;
    setApplied({
      categoryNames: [...draftCategories],
      familyNames: [...draftFamilyNames],
      placementScope: placement,
    });
    setApplyData(null);
  };

  const runPlan = () =>
    run("plan", async () => {
      if (!profileJson) return;
      const data = await familyFoundryPlan({ profileJson }, scope);
      setPlan(data);
      setApplyData(null);
      setExcludedIds(new Set());
      if (data.families.length === 0 && data.diagnostics.length === 0) {
        setError("The profile compiled, but it claims no loaded family in this project.");
      }
    });

  const includedPlanned = useMemo(
    () =>
      (plan?.families ?? []).filter(
        (entry) => !excludedIds.has(entry.familyId) && familyFlag(entry) === null,
      ),
    [plan, excludedIds],
  );

  const applyBlockedReason = ((): string | null => {
    if (!profileJson) return "bind a profile in the sentence first";
    if (!plan || !plan.planHash) return "no plan yet — compile one first";
    if (plan.diagnostics.length > 0) {
      return `the plan reported ${plan.diagnostics.length} diagnostic(s) — the profile must compile clean before apply`;
    }
    if (includedPlanned.length === 0) {
      return "no family is both included and has actions to run";
    }
    return null;
  })();

  const runApply = () =>
    run("apply", async () => {
      if (!profileJson || !plan?.planHash || applyBlockedReason) return;
      const data = await familyFoundryApply(
        {
          profileJson,
          familyIds: includedPlanned.map((entry) => entry.familyId),
          expectedPlanHash: plan.planHash,
        },
        scope,
      );
      setApplyData(data);
      if (data.refused) {
        setError(
          data.planHash && data.planHash !== plan.planHash
            ? `plan drift — the project recompiled to ${data.planHash.slice(0, 12)}…, not ${plan.planHash.slice(0, 12)}…. Re-plan and review the decision queue before applying.`
            : `apply refused — ${data.diagnostics.map(diagnosticLine).join(" · ") || "no reason reported"}`,
        );
        return;
      }
      const ok = data.receipts.filter((entry) => entry.success).length;
      void matrix.refetch();
      return `applied profile to ${ok} families`;
    });

  const runProject = () =>
    run("project", async () => {
      if (pickedIds.size === 0) return;
      setProjection(await familyFoundryProject({ familyIds: [...pickedIds] }, scope));
    });

  const matrixIssue = matrix.isError
    ? toHostIssue(matrix.error, "Couldn't load the matrix")
    : undefined;
  const totalTypes = rows.length;

  // Families in scope the plan does not claim — surfaced as excluded-with-reason, never hidden.
  const outsideProfile = useMemo(
    () => (plan ? families.filter((family) => !planByFamilyId.has(family.familyId)) : []),
    [plan, families, planByFamilyId],
  );

  return (
    <main className="flex h-screen flex-col bg-[var(--paper)] text-[var(--foreground)]">
      {/* ── the sentence: targeting nouns only ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          FAMILIES
        </span>
        <Sentence
          prefix="auditing"
          slots={[
            {
              key: "document",
              text: activeDocument,
              placeholder: connected ? "no project open" : "bridge disconnected",
              options: null,
              title:
                "The project this audit reads. It is session truth, not a choice — /families follows whatever document is active in the bound world, so open a different project in Revit to move it.",
            },
            {
              key: "profile",
              joiner: "against",
              text: profilePath,
              placeholder: "pick a profile",
              options: profileOptions,
              onPick: (id) => setProfilePath(id),
              title:
                "The desired-state profile every family is reconciled against. Binding one is what makes plan possible; re-binding throws away the compiled plan and any receipts, because they described the old profile.",
              empty:
                'No profiles readable in this world — the library lives under the CmdFFDesiredMigrator settings module, rootKey "profiles". Bind a world first if the sentence still says disconnected.',
            },
          ]}
          target={target}
          onBind={(selector) => setTarget(selector ?? "")}
          busy={busy != null}
          receipt={receipt}
        />
        <Verb
          label="plan"
          onClick={() => void runPlan()}
          busy={busy === "plan"}
          disabled={!profileJson}
          reason={
            profileJson
              ? "Compile the bound profile against this project: one reconciliation per family, plus a plan hash. Read-only — nothing in Revit changes until you apply."
              : "Bind a profile in the sentence first — there is nothing to compile against."
          }
        />
        <Verb
          label={`apply to ${includedPlanned.length} families`}
          onClick={() => void runApply()}
          busy={busy === "apply"}
          disabled={applyBlockedReason !== null}
          reason={
            applyBlockedReason ??
            `Mutate Revit: run the lowered actions on the ${includedPlanned.length} included famil${includedPlanned.length === 1 ? "y" : "ies"}, sending the plan hash along. If the project has changed underneath, the op refuses rather than applying a stale plan.`
          }
        />
        <Verb
          label="project → profile"
          onClick={() => void runProject()}
          busy={busy === "project"}
          disabled={pickedIds.size === 0}
          reason={
            pickedIds.size === 0
              ? "Nothing picked. Tick families in the table's pick column — projection runs the audit backwards, so it needs a source to read."
              : `Run the audit backwards: read ${pickedIds.size} picked famil${pickedIds.size === 1 ? "y" : "ies"} out of the model as profile JSON, so an existing family can seed a profile instead of being reconciled against one. Read-only.`
          }
        />
        <Seam op="familyfoundry.plan · apply · project" />
        {plan?.planHash && (
          <span
            className="tele text-[10px] text-muted-foreground"
            title={`Fingerprint of the compiled plan (${plan.planHash}). Apply sends it back, and the op refuses if the project no longer compiles to the same hash — so an edit made in Revit since you planned can never be applied over blindly. If apply reports drift, re-plan and re-read the decision queue.`}
          >
            plan {plan.planHash.slice(0, 12)}
          </span>
        )}
      </div>

      {/* ── scope: draft categories, explicit apply ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-1.5">
        <SectionLabel>
          <span title="Which families the table loads at all. Scope is a DRAFT until you apply it — the matrix op is the expensive one, so it never fires on a click.">
            scope
          </span>
        </SectionLabel>
        <select
          value={placement}
          onChange={(event) => setPlacement(event.target.value as LoadedFamilyPlacementScope)}
          title="Whether to include families that are loaded but never placed. 'Placed only' audits what the project actually uses; 'all loaded' also catches library families sitting unused in the project."
          className="tele h-6 rounded-[2px] border border-[var(--line-2)] bg-transparent px-1"
        >
          <option value={LoadedFamilyPlacementScope.AllLoaded}>all loaded</option>
          <option value={LoadedFamilyPlacementScope.PlacedOnly}>placed only</option>
          <option value={LoadedFamilyPlacementScope.UnplacedOnly}>unplaced only</option>
        </select>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {categories.map((name) => {
            const on = draftCategories.includes(name);
            return (
              <button
                key={name}
                type="button"
                title={
                  on
                    ? `${name} is in the draft scope. Click to drop it, then apply the scope again to reload the table.`
                    : `Add ${name} to the draft scope. Nothing loads until you apply the scope — this only changes what will be asked for.`
                }
                onClick={() =>
                  setDraftCategories((prev) =>
                    prev.includes(name)
                      ? prev.filter((value) => value !== name)
                      : [...prev, name].sort((a, b) => a.localeCompare(b)),
                  )
                }
                className={cn(
                  "tele rounded-[2px] border px-1.5 text-[11px]",
                  on
                    ? "border-[var(--pe-blue)] bg-[var(--pe-blue)]/[0.08] text-foreground"
                    : "border-[var(--line-soft)] text-muted-foreground hover:border-[var(--line-2)]",
                )}
              >
                {name}
              </button>
            );
          })}
          {connected && categoryCatalog.isPending && (
            <span className="tele text-[11px] text-muted-foreground">reading categories…</span>
          )}
          {connected && categories.length === 0 && !categoryCatalog.isPending && (
            <span className="tele text-[11px] text-muted-foreground">
              No loaded families in this project — load a family in Revit, or bind a different world
              in the sentence above.
            </span>
          )}
          {!connected && (
            <span className="tele text-[11px] text-cat-clay">
              Bridge disconnected — nothing can be read. Open Revit with the host connected, then
              bind that world in the sentence above.
            </span>
          )}
        </div>
        <span
          className="tele text-[10px] text-muted-foreground"
          title="How many families the draft scope currently resolves to. The matrix budget is sized to exactly this number, so nothing is silently truncated."
        >
          {draftCategories.length === 0
            ? "no categories picked yet"
            : `${draftFamilyNames.length} families in draft`}
        </span>
        <Verb
          label={
            applied === null ? "apply scope" : scopeDrifted ? "re-apply scope" : "scope applied"
          }
          onClick={applyScope}
          disabled={draftCategories.length === 0 || (applied !== null && !scopeDrifted)}
          busy={matrix.isFetching}
          reason={
            draftCategories.length === 0
              ? "Pick at least one category first. The matrix op is the expensive one, so it never runs on a keystroke — the draft above is free, this button is the commitment."
              : applied !== null && !scopeDrifted
                ? "The table already holds exactly this scope. Change a category or the placement filter above to make this button live again."
                : "Load types × parameters for every family in the draft scope. This replaces what the table currently holds and clears any receipts, which described the old scope."
          }
        />
      </div>

      {error && (
        <div className="border-b border-[var(--line)] px-4 py-1.5">
          <p className="tele text-[11px] text-cat-clay">{error}</p>
        </div>
      )}
      {matrixIssue && (
        <div className="px-4 py-2">
          <HostIssuePanel issue={matrixIssue} compact />
        </div>
      )}
      {plan && plan.diagnostics.length > 0 && (
        <div className="border-b border-[var(--line)] px-4 py-1.5">
          <SectionLabel>
            <span title="Diagnostics are reported at PROFILE level, not per family, and a single one blocks the whole apply lane. Fix the profile document, then re-plan.">
              plan diagnostics
            </span>
          </SectionLabel>
          <ul className="mt-1 space-y-0.5">
            {plan.diagnostics.map((diagnostic) => (
              <li
                key={`${diagnostic.code}:${diagnostic.path}`}
                className="tele text-[11px] text-cat-clay"
              >
                {diagnosticLine(diagnostic)}
                {diagnostic.suggestion ? (
                  <span className="text-muted-foreground"> — {diagnostic.suggestion}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── decision queue: the plan as a lens over the scope ────────────────────────────── */}
      {plan && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-[var(--line)] px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="One row per family the plan touched, plus the families in scope it did not claim. This is the last place to change your mind: apply runs exactly the rows still ticked here.">
                decision queue
              </span>
            </SectionLabel>
            <span
              className="tele text-[10px] text-muted-foreground"
              title="Included = ticked here AND carrying at least one lowered action. Unclaimed families are shown for honesty — the profile said nothing about them, so apply will not touch them."
            >
              {includedPlanned.length} of {plan.families.length} planned families included
              {outsideProfile.length > 0
                ? ` · ${outsideProfile.length} in scope but unclaimed`
                : ""}
            </span>
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {plan.families.map((entry) => {
                const flag = familyFlag(entry);
                const excluded = excludedIds.has(entry.familyId);
                return (
                  <tr key={entry.familyId} className="border-b border-[var(--line-soft)]">
                    <td className="w-8 py-0.5">
                      <button
                        type="button"
                        disabled={flag !== null}
                        title={
                          flag
                            ? `${flag}. There is nothing to include, so this row cannot be ticked.`
                            : excluded
                              ? `${entry.familyName} is held back — apply will skip it. Click to put its ${entry.plan.loweredActions.length} action(s) back in.`
                              : `${entry.familyName} is in: apply will run its ${entry.plan.loweredActions.length} action(s) against the model. Click to hold it back without re-planning.`
                        }
                        onClick={() =>
                          setExcludedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.familyId)) next.delete(entry.familyId);
                            else next.add(entry.familyId);
                            return next;
                          })
                        }
                        className="tele text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                      >
                        {flag !== null ? "✕" : excluded ? "□" : "▪"}
                      </button>
                    </td>
                    <td className="tele py-0.5 text-[11px]">{entry.familyName}</td>
                    <td
                      className="tele w-24 py-0.5 text-[11px] text-muted-foreground"
                      title="Lowered actions: the concrete parameter edits the plan compiled for this family. Zero means the family already matches the profile."
                    >
                      {entry.plan.loweredActions.length} action
                      {entry.plan.loweredActions.length === 1 ? "" : "s"}
                    </td>
                    <td
                      className="tele truncate py-0.5 text-[10px] text-muted-foreground"
                      title="Which layers of the profile decided this family's parameter facets, counted. It is a rollup of what the op reported, with no interpretation added — use it to see which part of the profile is doing the work."
                    >
                      {provenanceSummary(entry.plan)}
                    </td>
                    <td
                      className="tele w-64 truncate py-0.5 text-[10px] text-cat-kiln"
                      title={flag ?? ""}
                    >
                      {flag ?? ""}
                    </td>
                  </tr>
                );
              })}
              {outsideProfile.map((family) => (
                <tr
                  key={`outside-${family.familyId}`}
                  className="border-b border-[var(--line-soft)] opacity-60"
                >
                  <td className="w-8 py-0.5 text-center">
                    <span className="tele text-muted-foreground">✕</span>
                  </td>
                  <td className="tele py-0.5 text-[11px]">{family.familyName}</td>
                  <td className="tele w-24 py-0.5 text-[11px] text-muted-foreground">—</td>
                  <td className="tele py-0.5 text-[10px] text-muted-foreground" colSpan={2}>
                    in scope, but the bound profile does not claim this family
                  </td>
                </tr>
              ))}
              {plan.families.length === 0 && outsideProfile.length === 0 && (
                <tr>
                  <td className="tele py-1 text-[11px] text-muted-foreground" colSpan={5}>
                    The profile compiled, but it claims no family in the current scope — widen the
                    categories above, or bind a profile that covers this project.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── receipts ─────────────────────────────────────────────────────────────────────── */}
      {applyData && (
        <div className="max-h-48 shrink-0 overflow-auto border-b border-[var(--line)] px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="What apply actually did, per family, as the op reported it. Receipts are the fleet lane's trust layer — the counts here are the evidence, not the plan's promise.">
                receipts
              </span>
            </SectionLabel>
            <Seam op="host.shell.open link" />
            {applyData.planHash && (
              <span
                className="tele text-[10px] text-muted-foreground"
                title={`The hash the project compiled to at apply time (${applyData.planHash}). If it differs from the plan hash in the sentence row, apply refused rather than running a stale plan.`}
              >
                recompiled {applyData.planHash.slice(0, 12)}
              </span>
            )}
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {applyData.receipts.map((entry) => (
                <tr key={entry.familyId} className="border-b border-[var(--line-soft)]">
                  <td className="tele w-56 truncate py-0.5 text-[11px]">
                    {entry.familyName ?? `element ${entry.familyId}`}
                  </td>
                  <td
                    className={cn(
                      "tele w-20 py-0.5 text-[10px]",
                      entry.success ? "text-cat-green" : "text-cat-clay",
                    )}
                  >
                    {entry.success ? "applied" : "failed"}
                  </td>
                  <td
                    className="tele w-40 py-0.5 text-[10px] text-muted-foreground"
                    title={`${entry.parametersChanged} parameter(s) written, breaking down as ${entry.diffSummary.added} added, ${entry.diffSummary.removed} removed, ${entry.diffSummary.modified} modified against the family's prior state.`}
                  >
                    {entry.parametersChanged} changed · +{entry.diffSummary.added} −
                    {entry.diffSummary.removed} ~{entry.diffSummary.modified}
                  </td>
                  <td
                    className="tele truncate py-0.5 text-[10px] text-muted-foreground"
                    title={
                      entry.operationsRun.length > 0
                        ? `Migrator operations that ran on this family, in order: ${entry.operationsRun.join(", ")}.`
                        : (entry.error ?? "No operations ran and no reason was reported.")
                    }
                  >
                    {entry.operationsRun.join(" · ") || (entry.error ?? "")}
                  </td>
                  <td className="w-24 py-0.5 text-right">
                    {entry.artifactDirectoryPath && (
                      <button
                        type="button"
                        onClick={() => void openHostPath(entry.artifactDirectoryPath ?? "", scope)}
                        title={`Open the artifact bundle for this family in your OS file browser (${entry.artifactDirectoryPath}). The bundle stays on disk — this route never copies it.`}
                        className="tele text-[10px] text-[var(--pe-blue)] underline-offset-2 hover:underline"
                      >
                        artifacts
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {applyData.receipts.length === 0 && (
                <tr>
                  <td className="tele py-1 text-[11px] text-muted-foreground">
                    {applyData.refused
                      ? "Apply was refused before it touched anything, so there is nothing to receipt — the reason is in the error line above."
                      : "Apply returned no receipts. Re-plan and check the decision queue before trying again."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── projection: a lazily-rendered document, copyable ─────────────────────────────── */}
      {projection && (
        <details className="shrink-0 border-b border-[var(--line)] px-4 py-2" open>
          <summary className="cursor-pointer">
            <SectionLabel>
              <span title="Each picked family read back out of the model as profile JSON. Nothing is written anywhere — copy it into a profile document if you want to keep it.">
                projected profiles
              </span>
            </SectionLabel>
            <span className="tele ml-2 text-[10px] text-muted-foreground">
              {projection.projections.length} famil
              {projection.projections.length === 1 ? "y" : "ies"}
            </span>
          </summary>
          {projection.projections.length === 0 && projection.diagnostics.length === 0 && (
            <p className="tele mt-1 text-[11px] text-muted-foreground">
              The projection ran but returned nothing — re-pick families in the table's pick column
              and run it again.
            </p>
          )}
          {/* Projection is read-only and blocks nothing, so its diagnostics are quiet kiln,
              not clay — clay is reserved for what stops you. */}
          {projection.diagnostics.map((diagnostic) => (
            <p
              key={`${diagnostic.code}:${diagnostic.path}`}
              className="tele mt-1 text-[10px] text-cat-kiln"
            >
              {diagnosticLine(diagnostic)}
            </p>
          ))}
          {projection.projections.map((entry) => (
            <div key={entry.familyId} className="mt-2">
              <div className="flex items-center gap-2">
                <span className="tele text-[11px]">{entry.familyName ?? entry.familyId}</span>
                {entry.profileJson && (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(entry.profileJson ?? "")}
                    title="Copy this family's projected profile JSON to the clipboard. There is no profile editor here by design — profiles are files, so paste it into one."
                    className="tele rounded-[2px] border border-[var(--line-2)] px-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    copy
                  </button>
                )}
                {!entry.success && (
                  <span className="tele text-[10px] text-cat-clay">{entry.error ?? "failed"}</span>
                )}
              </div>
              {entry.profileJson && (
                <pre className="tele mt-1 max-h-40 overflow-auto rounded-[2px] border border-[var(--line-soft)] p-2 text-[10px] text-muted-foreground">
                  {entry.profileJson}
                </pre>
              )}
            </div>
          ))}
        </details>
      )}

      {/* ── THE table: everything currently in scope ─────────────────────────────────────── */}
      <MasterTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        scopeLabel="families in scope"
        searchPlaceholder="family or type"
        chips={chips}
        summary={
          <span title="Every family, type, and parameter the applied scope resolved to. Uncommon parameter columns may be hidden — the chip beside this says how many.">
            {totalFamilies} families · {totalTypes} types · {params.length} parameters
          </span>
        }
        empty={
          !connected
            ? "Nothing to audit — the bridge is disconnected. Connect the host in Revit, then bind that world in the sentence above."
            : applied === null
              ? "No scope applied yet. Pick one or more categories in the scope row above, then press “apply scope” — the matrix op is expensive, so it waits to be asked."
              : "The applied scope resolved to no families. Add a category above, or relax the placement filter from “placed only” back to “all loaded”, then re-apply the scope."
        }
        /* Fleet → one family. The URL is the whole handoff: /family opens the requested
           family in the bound session's family editor and lands in its live lane. No
           cross-route store, nothing to keep in sync. */
        onRowClick={(row) =>
          void navigate({ to: "/family", search: { family: String(row.familyId) } })
        }
      />
    </main>
  );
}
