import { useMemo } from "react";
import { ReadCell } from "#/components/master-table/cells";
import type { Column, Verdict } from "#/components/master-table/model";
import type { FamilyParameterSnapshot } from "#/host/loaded-families-view";
import { Press } from "#/components/lang/press";
import type { FamiliesStore } from "#/families/store";

const COMMON_SHARE = 0.3;

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

export function useFamiliesColumns({
  familyState,
  params,
  pickedIds,
  setPickedIds,
  showUncommon,
  totalFamilies,
}: {
  familyState: (familyId: number) => Verdict;
  params: ParamColumn[];
  pickedIds: Set<number>;
  setPickedIds: FamiliesStore["actions"]["setPickedIds"];
  showUncommon: boolean;
  totalFamilies: number;
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
            tone="quiet"
            size="value"
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

  return { columns, uncommonCount };
}
