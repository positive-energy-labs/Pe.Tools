import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { FfPlanEntry, FfReceipt } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/verb-lane";
import { Verb } from "#/components/lang/verb";
import { ReadCell } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, Verdict } from "#/components/master-table/model";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { callHostRpc } from "#/host/client";
import { FF_PROFILE_MODULE, diagnosticLine } from "#/host/familyfoundry";
import { FamiliesHead } from "#/families/head";
import type { FamiliesStore } from "#/families/store";
import { HostIssuePanel, toHostIssue } from "#/host/issues";
import {
  cellText,
  visibleParameters,
  LoadedFamilyPlacementScope,
  type FamilyParameterSnapshot,
  type LoadedFamiliesMatrixRequest,
} from "#/host/loaded-families-view";
import { HOST_QUERY_KEY, useHostStatusQuery, useLoadedFamiliesMatrixQuery } from "#/host/queries";
import { cn } from "#/lib/utils";
import { Press } from "#/components/lang/press";

type FfFamilyPlan = FfPlanEntry;
type FfReconciliationPlan = FfPlanEntry["plan"];
/** Profile library reads are one document-open each; cap the fan-out and say so when it bites. */
const PROFILE_READ_LIMIT = 40;
/** A parameter is "common" when it appears on this share of the families in scope. */
const COMMON_SHARE = 0.3;

/** The placement filter's vocabulary, and what each choice MEANS for the audit. */
const PLACEMENT_LABELS: Record<LoadedFamilyPlacementScope, string> = {
  [LoadedFamilyPlacementScope.AllLoaded]: "all loaded",
  [LoadedFamilyPlacementScope.PlacedOnly]: "placed only",
  [LoadedFamilyPlacementScope.UnplacedOnly]: "unplaced only",
};
const PLACEMENT_NOTES: Record<LoadedFamilyPlacementScope, string> = {
  [LoadedFamilyPlacementScope.AllLoaded]:
    "Every family loaded into the project, placed or not — this also catches library families sitting unused in the file.",
  [LoadedFamilyPlacementScope.PlacedOnly]:
    "Only families with at least one placed instance — what the project actually uses. Narrower scope, cheaper matrix.",
  [LoadedFamilyPlacementScope.UnplacedOnly]:
    "Only families with no placed instance — the loaded-but-unused tail, usually the purge conversation.",
};

// ── scope model ─────────────────────────────────────────────────────────────────────────────────

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

// ── the seam ────────────────────────────────────────────────────────────────────────────────────

/** Marks a surface whose LIVE behavior is unproven. Dashed = SEAM, and nothing else. */
function Seam({ op }: { op: string }) {
  return (
    <FactChip
      dashed
      title={`${op} is a typed bridge op that has never met a live Revit session. It will run — nothing here is a mock — but its live behaviour remains unproven until the step-3 live proof closes this chip.`}
    >
      unproven · {op}
    </FactChip>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="t-label t-upper text-ink-2">{children}</span>;
}

/**
 * A multi-select over plain names, chips inside the control — the scope row's two pickers.
 *
 * It replaces a flex-wrap of toggle buttons: with 40 categories (or 300 families) the button
 * sprawl pushed the commit verb off the row entirely. Chips scroll inside a two-row box instead,
 * so the row's HEIGHT is bounded no matter how wide the scope gets.
 */
function NamePicker({
  options,
  values,
  onChange,
  placeholder,
  ariaLabel,
  title,
  disabled,
}: {
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  ariaLabel: string;
  title: string;
  disabled?: boolean;
}) {
  const anchor = useComboboxAnchor();
  /* The whole-set default is a SUMMARY, not a chip flood: 300 auto-picked families as 300
     chips is bounded but unreadable. One quiet count stands in until the set is narrowed —
     deselection happens in the popup either way, so nothing is lost but the noise. */
  const collapsed = values.length > 8 && values.length === options.length;
  return (
    <Combobox
      items={options}
      multiple
      value={values}
      disabled={disabled}
      onValueChange={(next: string[]) => onChange(next)}
      itemToStringLabel={(name: string) => name}
    >
      {/* ponytail: explicit anchor on the chips row — the chips input must not be the positioner
          anchor, or the popup roams as chips wrap (same law as control-chips.tsx). */}
      <ComboboxChips
        ref={anchor}
        title={title}
        className="face-mono max-h-[3.25rem] min-h-7 min-w-0 flex-1 overflow-y-auto rounded-sm border-line-2 bg-transparent py-0.5 t-label"
      >
        {collapsed ? (
          <span
            className="px-1 t-label text-ink-2"
            title="Every resolved name is in the draft. Open the list to deselect — chips appear once the set is narrowed."
          >
            all {values.length}
          </span>
        ) : (
          values.map((name) => (
            <ComboboxChip key={name} className="face-mono rounded-sm t-label">
              {name}
            </ComboboxChip>
          ))
        )}
        <ComboboxChipsInput
          aria-label={ariaLabel}
          placeholder={values.length === 0 ? placeholder : "add…"}
          className="face-mono t-label placeholder:text-ink-2"
        />
        <ComboboxTrigger />
      </ComboboxChips>
      <ComboboxContent anchor={anchor} className="rounded-sm">
        {/* RULED not-an-empty-state (fit reviews, 2026-08-16): a combobox no-match slot is
            "you typed a string that matched nothing" — plain muted text, no story/exit. */}
        <ComboboxEmpty className="face-mono t-label text-ink-mute">no matches</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name} className="face-mono pr-7 t-label">
              <span className="truncate">{name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ── route ───────────────────────────────────────────────────────────────────────────────────────

export function FamiliesWorkspace({ store }: { store: FamiliesStore }) {
  const navigate = useNavigate();
  const target = useAtomValue(store.atoms.target);
  const scope = useMemo(() => (target ? { bridgeSessionId: target } : undefined), [target]);
  const draft = useAtomValue(store.atoms.draft);
  const { placement, categories: draftCategories, families: pickedFamilies } = draft;
  const setPlacement = (next: LoadedFamilyPlacementScope) =>
    store.actions.setDraft((previous) => ({ ...previous, placement: next }));
  const setDraftCategories = (next: string[]) =>
    store.actions.setDraft((previous) => ({ ...previous, categories: next }));
  const setPickedFamilies = (next: string[]) =>
    store.actions.setDraft((previous) => ({ ...previous, families: next }));
  const applied = useAtomValue(store.atoms.applied);
  const profilePath = useAtomValue(store.atoms.profilePath);
  const plan = useAtomValue(store.atoms.plan);
  const excludedIds = new Set(useAtomValue(store.atoms.excludedIds));
  const pickedIds = useAtomValue(store.atoms.pickedIds);
  const setPickedIds = store.actions.setPickedIds;
  const applyData = useAtomValue(store.atoms.applyData);
  const projection = useAtomValue(store.atoms.projection);
  const showUncommon = useAtomValue(store.atoms.showUncommon);
  const setShowUncommon = store.actions.setShowUncommon;
  const tableState = useAtomValue(store.atoms.table);
  const busyState = useAtomValue(store.atoms.busy);
  const busy = busyState?.id ?? null;
  const categoryFeed = useAtomValue(store.feeds.category);
  const familyFeed = useAtomValue(store.feeds.family);
  const profileFeed = useAtomValue(store.feeds.profile);

  const status = useHostStatusQuery(scope);
  const connected = status.data?.bridgeIsConnected ?? false;

  // ── scope: the cheap catalog feeds both pickers; the matrix waits for Apply ───────────────────
  const categories = categoryFeed.options?.map((option) => option.id) ?? [];
  const draftFamilyNames = familyFeed.options?.map((option) => option.id) ?? [];

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
    enabled: connected && matrixRequest !== undefined,
  });
  const families = useMemo(() => matrix.data?.families ?? [], [matrix.data?.families]);

  // ── profile library: the store feeds paths; document.open validates each entry ───────────────
  const allProfilePaths = useMemo(
    () => (profileFeed.options ?? []).map((option) => option.id),
    [profileFeed.options],
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
                word: "applied",
                tone: "done",
                note: `${done.parametersChanged} parameter(s) changed · +${done.diffSummary.added} −${done.diffSummary.removed} ~${done.diffSummary.modified}`,
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

    /* The identity cluster carries NO group: a band reading "family" over columns already named
       family / type / category says nothing, and a header band that says nothing is noise above
       every scroll. The parameter clusters keep theirs — "built-in" vs "common" is real news. */
    const identity: Column<TypeRow>[] = [
      {
        key: "pick",
        label: "pick",
        title:
          "Picked families feed the projection verb, which reads them back out of the model as profile JSON. Picking changes nothing in Revit — Esc clears the whole set.",
        /* Wide enough for its own facet trigger — a facet column narrower than its picker clips
           the word "any" and reads as a rendering bug. */
        width: "w-16",
        facet: (row) => (pickedIds.has(row.familyId) ? "picked" : ""),
        all: "any",
        cell: (row) => (
          <Press
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
            className="face-mono t-value h-7 w-full px-1.5 text-left text-ink-2 hover:text-ink"
          >
            {pickedIds.has(row.familyId) ? "▪" : "□"}
          </Press>
        ),
      },
      {
        key: "family",
        label: "family",
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
      /* The plan verdict sits AFTER the identity columns, not among the parameter clusters: the
         plan is a lens over these rows, not a parameter of the family.

         It rides the table's `verdict:` clause: a
         pipeline verdict about the ROW, whose word the route owns and whose tone union is the
         meaning band by construction. */
      {
        key: "plan-state",
        label: "plan",
        title:
          "What the compiled plan says about this family. The plan is a LENS: it tints rows and fills the decision queue, but it never hides a family or narrows the scope you asked for.",
        verdict: (row) => familyState(row.familyId),
      },
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
              /* A project binding and a formula are FACTS about where a value lives, not
                 alarms — they get quiet ink and spend no meaning role. Formula-driven was
                 `--cat-lichen`, a TAXONOMY colour carrying a value fact; the language has no
                 "derived" role to move it to, so it drops to the ink ladder
                 and separates from a project binding by italic rather than by hue. */
              className={cn(
                unresolved && "text-ink-mute/50",
                scopeOf === "ProjectBindingOnly" && "text-ink-mute italic",
                row.formulas[col.key] === "Present" && "text-ink-2",
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
  const includedPlanned = useMemo(
    () =>
      (plan?.entries ?? []).filter(
        (entry) => !excludedIds.has(entry.familyId) && familyFlag(entry) === null,
      ),
    [plan, excludedIds],
  );

  const runProject = () => void store.actions.project();

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
    <main className="flex h-screen flex-col bg-page text-ink">
      <FamiliesHead store={store} />
      {selectedProfileQuery?.error && (
        <div className="border-b border-line px-4 py-1.5">
          <OutcomeLine
            kind="error"
            label="profile read failed"
            says={(selectedProfileQuery.error as Error).message}
          />
        </div>
      )}

      {/* ── scope: placement → draft categories → picked families, explicit apply ────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-1.5">
        <SectionLabel>
          <span title="Which families the table loads at all. Scope is a DRAFT until you apply it — the matrix op is the expensive one, so it never fires on a click.">
            scope
          </span>
        </SectionLabel>
        <Select
          items={PLACEMENT_LABELS}
          value={placement}
          onValueChange={(value: LoadedFamilyPlacementScope | null) => value && setPlacement(value)}
        >
          <SelectTrigger
            aria-label="placement filter"
            title="Whether to include families that are loaded but never placed. It filters BOTH pickers beside it, so narrowing here changes which families the draft resolves to."
            className="face-mono h-6 w-32 shrink-0 rounded-sm border-line-2 px-1.5 t-label"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-sm">
            {(Object.keys(PLACEMENT_LABELS) as LoadedFamilyPlacementScope[]).map((value) => (
              <SelectItem
                key={value}
                value={value}
                title={PLACEMENT_NOTES[value]}
                className="face-mono t-label"
              >
                {PLACEMENT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!connected ? (
          /* A disconnected bridge is not the model disagreeing — it is the machine being
             unavailable, which the outcome lane calls `error` (caution, never alarm). */
          <OutcomeLine
            className="min-w-0 flex-1"
            kind="error"
            label="bridge disconnected"
            says="nothing can be read — open Revit with the host connected, then bind that world in the sentence above"
          />
        ) : categoryFeed.state === "loading" ? (
          <OutcomeLine className="min-w-0 flex-1" kind="busy" label="reading categories" />
        ) : categories.length === 0 ? (
          <EmptyState
            story="scope"
            exit="load a family in Revit, or bind a different world in the sentence above"
            className="min-w-0 flex-1"
          >
            no loaded families in this project — the catalog read succeeded and reported nothing
          </EmptyState>
        ) : (
          <>
            <NamePicker
              options={categories}
              values={draftCategories}
              onChange={(next) => setDraftCategories([...next].sort((a, b) => a.localeCompare(b)))}
              placeholder="add categories…"
              ariaLabel="draft categories"
              title="Which Revit categories the draft asks for. Picking one only edits the DRAFT — nothing loads until you apply the scope, because the matrix op is the expensive one."
            />
            <NamePicker
              options={draftFamilyNames}
              values={pickedFamilies}
              onChange={setPickedFamilies}
              disabled={draftFamilyNames.length === 0}
              placeholder={
                draftCategories.length === 0
                  ? "pick categories first"
                  : familyFeed.state === "loading" || familyFeed.stale
                    ? "resolving families…"
                    : "no families resolved"
              }
              ariaLabel="draft families"
              title="Every family the draft categories resolve to, all picked by default. Dropping one narrows exactly what apply asks the matrix op for — it does not filter a loaded table, it loads less."
            />
          </>
        )}
        {/* RULED 2026-08-16 (fit reviews): the third EmptyState that sat here — "no categories
            picked yet" — is deleted; the two visibly-empty pickers beside it announce
            themselves. */}
        {draftCategories.length === 0 ? null : (draftFamilyNames.length === 0 &&
            familyFeed.state === "loading") ||
          familyFeed.stale ? (
          <OutcomeLine className="shrink-0" kind="busy" label="resolving families" />
        ) : (
          <FactChip title="How many families the draft currently commits to. The matrix budget is sized to exactly this number, so nothing is silently truncated.">
            {pickedFamilies.length === draftFamilyNames.length
              ? `${draftFamilyNames.length} families in draft`
              : `${pickedFamilies.length} of ${draftFamilyNames.length} families in draft`}
          </FactChip>
        )}
      </div>

      <div className="border-b border-line empty:border-0">
        <VerbLane atoms={store.atoms} className="px-4 py-1.5" />
      </div>
      {matrixIssue && (
        <div className="px-4 py-2">
          <HostIssuePanel issue={matrixIssue} compact />
        </div>
      )}
      {/* ── decision queue: the plan as a lens over the scope ────────────────────────────── */}
      {plan && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="One row per family the plan touched, plus the families in scope it did not claim. This is the last place to change your mind: apply runs exactly the rows still ticked here.">
                decision queue
              </span>
            </SectionLabel>
            <FactChip title="Included = ticked here AND carrying at least one lowered action. Unclaimed families are shown for honesty — the profile said nothing about them, so apply will not touch them.">
              {includedPlanned.length} of {plan.entries.length} planned families included
              {outsideProfile.length > 0
                ? ` · ${outsideProfile.length} in scope but unclaimed`
                : ""}
            </FactChip>
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {plan.entries.map((entry) => {
                const flag = familyFlag(entry);
                const excluded = excludedIds.has(entry.familyId);
                return (
                  <tr key={entry.familyId} className="border-b border-line">
                    <td className="w-8 py-0.5">
                      <Press
                        type="button"
                        disabled={flag !== null}
                        title={
                          flag
                            ? `${flag}. There is nothing to include, so this row cannot be ticked.`
                            : excluded
                              ? `${entry.familyName} is held back — apply will skip it. Click to put its ${entry.plan.loweredActions.length} action(s) back in.`
                              : `${entry.familyName} is in: apply will run its ${entry.plan.loweredActions.length} action(s) against the model. Click to hold it back without re-planning.`
                        }
                        onClick={() => void store.actions.exclude(entry.familyId)}
                        className="face-mono t-value text-ink-2 hover:text-ink disabled:cursor-not-allowed"
                      >
                        {flag !== null ? "✕" : excluded ? "□" : "▪"}
                      </Press>
                    </td>
                    <td className="face-mono py-0.5 t-label">{entry.familyName}</td>
                    <td
                      className="face-mono w-24 py-0.5 t-label text-ink-2"
                      title="Lowered actions: the concrete parameter edits the plan compiled for this family. Zero means the family already matches the profile."
                    >
                      {entry.plan.loweredActions.length} action
                      {entry.plan.loweredActions.length === 1 ? "" : "s"}
                    </td>
                    <td
                      className="face-mono truncate py-0.5 t-caption text-ink-2"
                      title="Which layers of the profile decided this family's parameter facets, counted. It is a rollup of what the op reported, with no interpretation added — use it to see which part of the profile is doing the work."
                    >
                      {provenanceSummary(entry.plan)}
                    </td>
                    {/* A family the plan compiled nothing for is a verdict with nothing behind
                        it, not a warning about the model: quiet ink, off the meaning band. */}
                    <td
                      className="face-mono w-64 truncate py-0.5 t-caption text-ink-mute"
                      title={flag ?? ""}
                    >
                      {flag ?? ""}
                    </td>
                  </tr>
                );
              })}
              {outsideProfile.map((family) => (
                <tr key={`outside-${family.familyId}`} className="border-b border-line opacity-60">
                  <td className="w-8 py-0.5 text-center">
                    <span className="face-mono t-value text-ink-2">✕</span>
                  </td>
                  <td className="face-mono py-0.5 t-label">{family.familyName}</td>
                  <td className="face-mono w-24 py-0.5 t-label text-ink-2">—</td>
                  <td className="face-mono py-0.5 t-caption text-ink-2" colSpan={2}>
                    in scope, but the bound profile does not claim this family
                  </td>
                </tr>
              ))}
              {plan.entries.length === 0 && outsideProfile.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      story="scope"
                      exit="widen the categories above, or bind a profile that covers this project"
                      className="py-1"
                    >
                      no family in this scope is claimed by the bound profile — the plan compiled
                      cleanly and matched nothing
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── receipts ─────────────────────────────────────────────────────────────────────── */}
      {applyData && (
        <div className="max-h-48 shrink-0 overflow-auto border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="What apply actually did, per family, as the op reported it. Receipts are the fleet lane's trust layer — the counts here are the evidence, not the plan's promise.">
                receipts
              </span>
            </SectionLabel>
            <Seam op="host.shell.open link" />
            {applyData.planHash && (
              <FactChip
                tone={plan?.planHash && applyData.planHash !== plan.planHash ? "alarm" : "meta"}
                title={`The hash the project compiled to at apply time (${applyData.planHash}). If it differs from the plan hash in the sentence row, apply refused rather than running a stale plan.`}
              >
                recompiled {applyData.planHash.slice(0, 12)}
              </FactChip>
            )}
          </div>
          <table className="mt-1 w-full border-collapse">
            <tbody>
              {applyData.receipts.map((entry) => (
                <tr key={entry.familyId} className="border-b border-line">
                  <td className="face-mono w-56 truncate py-0.5 t-label">
                    {entry.familyName ?? `element ${entry.familyId}`}
                  </td>
                  <td className="w-20 py-0.5">
                    <FactChip
                      tone={entry.success ? "done" : "alarm"}
                      title={
                        entry.success
                          ? `The op reported this family written: ${entry.parametersChanged} parameter(s) changed. This is the receipt, not the plan's promise.`
                          : (entry.error ??
                            "The op reported this family as failed and gave no reason. Re-plan and read the decision queue before retrying.")
                      }
                    >
                      {entry.success ? "applied" : "failed"}
                    </FactChip>
                  </td>
                  <td
                    className="face-mono w-40 py-0.5 t-caption text-ink-2"
                    title={`${entry.parametersChanged} parameter(s) written, breaking down as ${entry.diffSummary.added} added, ${entry.diffSummary.removed} removed, ${entry.diffSummary.modified} modified against the family's prior state.`}
                  >
                    {entry.parametersChanged} changed · +{entry.diffSummary.added} −
                    {entry.diffSummary.removed} ~{entry.diffSummary.modified}
                  </td>
                  <td
                    className="face-mono truncate py-0.5 t-caption text-ink-2"
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
                      /* Leaving the app entirely — nav:out, which is the direction browsers
                         already taught. It writes nothing, so it is not blue-filled. */
                      <Verb
                        label="artifacts"
                        tone="nav"
                        direction="out"
                        onClick={() =>
                          void store.actions.openPath(entry.artifactDirectoryPath ?? "")
                        }
                        reason={`Open the artifact bundle for this family in your OS file browser (${entry.artifactDirectoryPath}). The bundle stays on disk — this route never copies it.`}
                      />
                    )}
                  </td>
                </tr>
              ))}
              {applyData.receipts.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      story="scope"
                      exit="re-plan and read the decision queue before retrying"
                      className="py-1"
                    >
                      no receipts — apply ran and reported nothing
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── projection: a lazily-rendered document, copyable ─────────────────────────────── */}
      {projection && (
        <details className="shrink-0 border-b border-line px-4 py-2" open>
          <summary className="cursor-pointer">
            <SectionLabel>
              <span title="Each picked family read back out of the model as profile JSON. Nothing is written anywhere — copy it into a profile document if you want to keep it.">
                projected profiles
              </span>
            </SectionLabel>
            <FactChip
              className="ml-2"
              title="How many picked families the projection read back out of the model."
            >
              {projection.projections.length} famil
              {projection.projections.length === 1 ? "y" : "ies"}
            </FactChip>
          </summary>
          {projection.projections.length === 0 && projection.diagnostics.length === 0 && (
            <EmptyState
              story="scope"
              exit="re-pick families in the table's pick column and run it again"
              className="mt-1"
            >
              nothing projected — the picked set read back empty
            </EmptyState>
          )}
          {/* Projection is read-only and blocks nothing, which is exactly what the outcome
              lane's `advisory` means — "a dry run blocks nothing". */}
          {projection.diagnostics.map((diagnostic) => (
            <OutcomeLine
              key={`${diagnostic.code}:${diagnostic.path}`}
              className="mt-1"
              kind="advisory"
              label={diagnosticLine(diagnostic)}
              says={diagnostic.suggestion ?? undefined}
            />
          ))}
          {projection.projections.map((entry) => (
            <div key={entry.familyId} className="mt-2">
              <div className="flex items-center gap-2">
                <span className="face-mono t-label">{entry.familyName ?? entry.familyId}</span>
                {entry.profileJson && (
                  <Verb
                    label="copy"
                    onClick={() => void navigator.clipboard.writeText(entry.profileJson ?? "")}
                    reason="Copy this family's projected profile JSON to the clipboard. There is no profile editor here by design — profiles are files, so paste it into one."
                  />
                )}
                {!entry.success && (
                  <OutcomeLine
                    kind="error"
                    label="projection failed"
                    says={entry.error ?? "no reason reported"}
                  />
                )}
              </div>
              {entry.profileJson && (
                <pre className="face-mono mt-1 max-h-40 overflow-auto rounded-sm border border-line p-2 t-caption text-ink-2">
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
        tableState={tableState}
        onTableStateChange={store.actions.setTable}
        chips={chips}
        summary={
          <span className="flex items-center gap-2">
            <span title="Every family, type, and parameter the applied scope resolved to. Uncommon parameter columns may be hidden — the chip beside this says how many.">
              {totalFamilies} families · {totalTypes} types · {params.length} parameters
            </span>
            <Verb
              label="project → profile"
              onClick={() => runProject()}
              busy={busy === "project"}
              disabled={pickedIds.size === 0}
              reason={
                pickedIds.size === 0
                  ? "Nothing picked. Tick families in the pick column — projection runs the audit backwards, so it needs a source to read."
                  : `Run the audit backwards: read ${pickedIds.size} picked famil${pickedIds.size === 1 ? "y" : "ies"} out of the model as profile JSON, so an existing family can seed a profile instead of being reconciled against one. Read-only.`
              }
            />
          </span>
        }
        empty={
          // §4's two kinds of empty: the first three are the route's story (nothing in scope);
          // the last fires only when rows exist and the table's own narrowing hid them.
          !connected ? (
            <EmptyState
              story="scope"
              exit="connect the host in Revit, then bind that world in the sentence above"
            >
              nothing to audit — the bridge is disconnected
            </EmptyState>
          ) : applied === null ? (
            <EmptyState
              story="scope"
              exit="pick categories in the scope row above, then press “apply scope”"
            >
              no scope applied yet — the matrix op is expensive, so it waits to be asked
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState
              story="scope"
              exit="add a category, re-add families in the families picker, or relax the placement filter, then re-apply the scope"
            >
              the applied scope resolved to no families
            </EmptyState>
          ) : (
            <EmptyState story="filter" exit="clear a column filter or the search">
              the narrowing hid all {totalTypes} types in scope
            </EmptyState>
          )
        }
        /* Fleet → one family. The URL is the whole handoff: /family opens the requested
           family in the bound session's family editor and lands in its live lane. No
           cross-route store, nothing to keep in sync. */
        onRowClick={() => void navigate({ to: "/family", search: {} })}
      />
    </main>
  );
}
