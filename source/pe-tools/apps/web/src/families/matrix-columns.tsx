import { useMemo } from "react";
import { familyCellValueSchema, type FamilyCellState } from "@pe/agent-contracts";
import { ReadCell } from "#/components/master-table/cells";
import { useCellNavigation } from "#/components/master-table/cell-navigation";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import type { Column, Verdict } from "#/components/master-table/model";
import type { FamilyParameterSnapshot } from "#/host/loaded-families-view";
import { Press } from "#/components/lang/press";
import type { FamiliesStore } from "#/families/store";
import { cellAt } from "#/families/staged";
import { cn } from "#/lib/utils";

const COMMON_SHARE = 0.3;
const showFamilyCell = (value: unknown) => familyCellValueSchema.parse(value).value;

export interface TypeRow {
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

export interface ParamColumn {
  key: string;
  name: string;
  kind: FamilyParameterSnapshot["kind"];
  isInstance: boolean;
  isBuiltIn: boolean;
  isProjectOnly: boolean;
  familyCount: number;
}

type Cluster = "built-in" | "common" | "uncommon" | "project-only";

/** Built-ins, then parameters shared by at least 30% of the scoped families, then the tail. */
function clusterOf(col: ParamColumn, totalFamilies: number): Cluster {
  if (col.isProjectOnly) return "project-only";
  if (col.isBuiltIn) return "built-in";
  return col.familyCount >= Math.max(1, totalFamilies * COMMON_SHARE) ? "common" : "uncommon";
}

const CLUSTER_ORDER: Record<Cluster, number> = {
  "built-in": 0,
  common: 1,
  uncommon: 2,
  "project-only": 3,
};

/**
 * Whether a patch can express a change to this cell — the one thing that decides if it is editable.
 * A patch writes `types.<typeName>.<parameter>` on the family document, so an unresolved parameter
 * (not on this family), a project binding (the value lives on instances, not in the family) and a
 * formula-driven parameter (the family computes it) are all outside what a patch can say.
 */
export function patchable(row: TypeRow, key: string): boolean {
  const scope = row.scopes[key];
  return (
    Boolean(scope) &&
    scope !== "Unresolved" &&
    scope !== "ProjectBindingOnly" &&
    row.formulas[key] !== "Present"
  );
}

/** What a cell's value MEANS — the title text, so a read-only cell still explains itself. */
function cellReason(row: TypeRow, key: string, instance: boolean): string {
  const scope = row.scopes[key];
  if (!scope || scope === "Unresolved")
    return "This parameter does not exist on this family, so there is nothing to read and nothing a profile could change here.";
  if (scope === "ProjectBindingOnly")
    return "Bound at the PROJECT, not owned by the family. The value lives on placed instances; editing the family will not move it.";
  if (row.formulas[key] === "Present")
    return "Driven by a formula inside the family — the number shown is what the formula resolved to for this type, not an authored value.";
  const what = instance
    ? `the INSTANCE DEFAULT this type hands every instance placed from it`
    : `this type's authored value`;
  return `Type "${row.typeName}" of ${row.familyName}: ${what}${
    row.values[key] ? ` — currently ${row.values[key]}` : " — currently blank"
  }. Type to stage your value; Pea's proposal waits for stage or deny in the proposals band. Plan generates the spec from staged values only.`;
}

// ── plan lens ───────────────────────────────────────────────────────────────────────────────────

/**
 * Which layers of the profile decided the parameter facets, counted. The op reports provenance per
 * facet (identity / dataType / propertiesGroup / isInstance / tooltip); this is the honest rollup —
 * counts of reported sources, no interpretation of what a source "means".
 */

export function useFamiliesColumns({
  familyState,
  params,
  pickedIds,
  setPickedIds,
  showUncommon,
  totalFamilies,
  cells,
  propose,
}: {
  familyState: (familyId: number) => Verdict;
  params: ParamColumn[];
  pickedIds: Set<number>;
  setPickedIds: FamiliesStore["actions"]["setPickedIds"];
  showUncommon: boolean;
  totalFamilies: number;
  cells: Record<string, FamilyCellState>;
  propose: FamiliesStore["actions"]["propose"];
}) {
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
          "Picked families are what capture files into the pod, one spec member each. Picking changes nothing in Revit — Esc clears the whole set.",
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
                ? `Drop ${row.familyName} from the capture set — the plan and the apply lane are untouched either way.`
                : `Add ${row.familyName} to the capture set, so capture files it into the pod as a spec member.`
            }
            onClick={() =>
              setPickedIds((prev) => {
                const next = new Set(prev);
                if (next.has(row.familyId)) next.delete(row.familyId);
                else next.add(row.familyId);
                return next;
              })
            }
            tone="quiet"
            size="value"
            state={pickedIds.has(row.familyId) ? "selected" : "rest"}
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
        width: "w-48",
        cell: (row) => (
          <ReadCell
            value={row.familyName}
            reason={`${row.familyName} — ${row.typeCount} type(s), element id ${row.familyId}. Click the row to open this one family in /family, using this route's source.`}
          />
        ),
      },
      {
        key: "type",
        label: "type",
        sort: (row) => row.typeName,
        search: (row) => row.typeName,
        width: "w-32",
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
        width: "w-28",
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
        width: "w-24",
        cell: (row) => {
          const scopeOf = row.scopes[col.key];
          const value = row.values[col.key] ?? "";
          const unresolved = !scopeOf || scopeOf === "Unresolved";
          const reason = cellReason(row, col.key, col.isInstance);
          if (patchable(row, col.key)) {
            const address = { familyId: row.familyId, typeName: row.typeName, parameter: col.name };
            return (
              <ProposalCell
                current={value}
                reason={reason}
                cell={cellAt(cells, address)}
                onCommit={(next) =>
                  void propose(address, { familyName: row.familyName, value: next }, value)
                }
              />
            );
          }
          return (
            <ReadCell
              value={unresolved ? "" : value || "—"}
              reason={reason}
              /* A project binding and a formula are FACTS about where a value lives, not
                 alarms — they get quiet ink and spend no meaning role. Formula-driven was
                 `--cat-lichen`, a TAXONOMY colour carrying a value fact; the language has no
                 "derived" role to move it to, so it drops to the ink ladder
                 and separates from a project binding by italic rather than by hue. */
              className={cn(
                scopeOf === "ProjectBindingOnly" && "italic text-ink-mute",
                row.formulas[col.key] === "Present" && "text-ink-2",
              )}
              data-tone={value === "Positive Energy" ? "pea" : undefined}
            />
          );
        },
      };
    });

    return [...identity, ...parameterColumns];
  }, [params, totalFamilies, showUncommon, pickedIds, familyState, cells, propose]);

  const uncommonCount = useMemo(
    () => params.filter((col) => clusterOf(col, totalFamilies) === "uncommon").length,
    [params, totalFamilies],
  );

  return { columns, uncommonCount };
}

/**
 * One editable parameter cell in the house proposal language: the proposal on the cell is the
 * trichotomy's `proposal` (Pea's or a person's, told apart by `by`) and the person's accept is
 * its `staged`, read through the one reader `cellFromTrichotomy`. At row scale the prior value and
 * the author ride the title; accept and deny sit in the proposals band beside the table.
 */
export function ProposalCell({
  current,
  reason,
  cell,
  onCommit,
}: {
  current: string;
  reason: string;
  cell: FamilyCellState | undefined;
  onCommit: (text: string) => void;
}) {
  const move = useCellNavigation();
  const proposal = cell?.proposal;
  const staged = cell?.staged;
  const shown = staged?.value.value ?? proposal?.value.value ?? current;
  const author = (by: "pea" | "human") => (by === "pea" ? "Pea" : "you");
  const note = proposal
    ? `${author(proposal.by)} proposed ${current || "(blank)"} → ${proposal.value.value}${
        staged?.value.value === proposal.value.value
          ? "; staged — plan will include it"
          : staged
            ? `; you staged ${staged.value.value}, so Pea's value is a counter-proposal`
            : "; open — accept or deny it in the proposals band"
      }. Nothing has reached Revit.`
    : staged
      ? `You staged ${current || "(blank)"} → ${staged.value.value}. Nothing has reached Revit.`
      : reason;
  return (
    <span data-proposal={proposal?.by} data-staged={staged ? "" : undefined}>
      <StateCell
        {...cellFromTrichotomy(
          cell ?? { proposal: null, staged: null },
          { value: shown, note, scale: "row" },
          showFamilyCell,
        )}
        placeholder={proposal || staged ? current : undefined}
        onCommit={(text) => onCommit(text)}
        onNavigate={(direction) => move?.(direction) ?? false}
      />
    </span>
  );
}
