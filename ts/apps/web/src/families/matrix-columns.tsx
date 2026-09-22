import { useMemo } from "react";
import {
  familyCellAddress,
  familyCellKey,
  familyCellValueSchema,
  showCellValue,
  type FamilyCellState,
} from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { ReadCell } from "#/components/master-table/cells";
import { useCellNavigation } from "#/components/master-table/cell-navigation";
import {
  cellFromTrichotomy,
  StateCell,
  type CellRefusal,
  type CellTransition,
  type DisplayUnit,
} from "#/components/lang/cell";
import type { MeasuredAnswer } from "#/host/measured-parse";
import { CellListSelect } from "#/components/lang/list-popup";
import type { Column, Verdict } from "#/components/master-table/model";
import type { FamilyParameterSnapshot } from "#/host/loaded-families-view";
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
  /** A Yes/No parameter: a closed choice, never free text. */
  yesNo?: boolean;
  /**
   * That the parameter measures something, and the unit the PROJECT renders it in (the matrix reads
   * the project, so the project's units are what these cells show and stage).
   */
  displayUnit?: DisplayUnit | null;
}

/** Revit's Yes/No spec (`autodesk.spec:spec.bool-1.0.0`), read off the definition's data type. */
export const isYesNo = (dataTypeId: string | null | undefined) =>
  dataTypeId?.startsWith("autodesk.spec:spec.bool") === true;

const YES_NO = ["Yes", "No"] as const;

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

/**
 * The families lock facts: a cell a patch cannot write (unresolved, project-bound, formula-driven)
 * is locked, and its reason is the one the matrix already says. Unknown addresses are not locked.
 */
export const familiesLockOf =
  (rows: readonly TypeRow[], params: readonly ParamColumn[]) =>
  (key: string): string | null => {
    const { familyName, typeName, parameter } = familyCellAddress(key);
    const row = rows.find((r) => r.familyName === familyName && r.typeName === typeName);
    const param = params.find((p) => p.name === parameter);
    if (!row || !param || patchable(row, param.key)) return null;
    return cellReason(row, param.key, param.isInstance);
  };

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
  showUncommon,
  totalFamilies,
  cells,
  propose,
  wire,
  parse,
}: {
  familyState: (row: { familyName: string }) => Verdict;
  params: ParamColumn[];
  showUncommon: boolean;
  totalFamilies: number;
  cells: Record<string, FamilyCellState>;
  propose: FamiliesStore["actions"]["propose"];
  /** The families cell wire, with the matrix's lock facts. */
  wire: CellWire;
  /** One read-only host parse for a measured cell; a re-read of the matrix cancels it. */
  parse?: (unit: DisplayUnit | null | undefined, text: string) => Promise<MeasuredAnswer>;
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
        verdict: (row) => familyState(row),
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
          // Identity by NAME (ruling, msg-authority-family-identity): a cell keys on the family's
          // name, never its element id, which Revit reissues on every reload.
          const address = {
            familyName: row.familyName,
            typeName: row.typeName,
            parameter: col.name,
          };
          const cell = cellAt(cells, address);
          // Every drawn trichotomy cell carries exactly the contract's transitions. A Pea proposal
          // on a cell a patch cannot write draws locked, where the contract leaves deny only.
          const transitions = cell
            ? reviewTransitions(wire, familyCellKey(address), cell)
            : undefined;
          if (patchable(row, col.key) && col.yesNo) {
            // A Yes/No parameter is a closed choice (F-J3-5b): the in-cell list, never free text.
            // Its face is the cell's own state; accept/deny of a proposal live in the band.
            const rung = cell?.staged ?? cell?.proposal;
            const shown = rung ? showFamilyCell(rung.value) : value;
            return (
              <CellListSelect<string>
                aria-label={`${col.name} (Yes/No)`}
                value={shown}
                display={
                  <StateCell
                    {...cellFromTrichotomy(
                      cell ?? { proposal: null, staged: null },
                      { value: shown, note: reason, scale: "row" },
                      showFamilyCell,
                    )}
                  />
                }
                title={`${col.name} is Yes/No: pick Yes or No`}
                items={[...YES_NO]}
                keyOf={(choice) => choice}
                labelOf={(choice) => choice}
                row={(choice) => ({ label: choice })}
                select="single"
                selected={[shown]}
                empty="no choices"
                onPick={(choice) => void propose(address, { value: choice }, value)}
              />
            );
          }
          if (patchable(row, col.key)) {
            return (
              <ProposalCell
                current={value}
                reason={reason}
                cell={cell}
                transitions={transitions}
                // A refused write puts the cell back and says why on it (25 item 3).
                measured={
                  col.displayUnit && parse
                    ? {
                        displayUnit: col.displayUnit,
                        parse: (text) => parse(col.displayUnit, text),
                      }
                    : undefined
                }
                onCommit={(next) =>
                  propose(address, { value: next }, value).then((refusal) => refusal ?? null)
                }
              />
            );
          }
          if (cell?.proposal != null || cell?.staged != null)
            return (
              <ProposalCell
                current={value}
                reason={reason}
                cell={cell}
                transitions={transitions}
                lock={reason}
              />
            );
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
  }, [params, totalFamilies, showUncommon, familyState, cells, propose, wire]);

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
  transitions,
  lock,
  onCommit,
  measured,
}: {
  current: string;
  reason: string;
  cell: FamilyCellState | undefined;
  /** The cell's own verbs: exactly `availableTransitions`, over the families wire. */
  transitions?: readonly CellTransition[];
  /** Why a patch cannot write this cell; present, the cell draws locked and takes no typing. */
  lock?: string;
  /** Resolves to the write's refusal, if any: the kit then restores the drawn value and says it. */
  onCommit?: (text: string) => Promise<CellRefusal | null>;
  /**
   * The measured kind, minus its staging door: a family value is WRITTEN in the unit grammar
   * ("300 CFM"), so this cell formats what Revit answered into that literal and writes it through
   * the same `onCommit` as typed text. No second value shape reaches the store.
   */
  measured?: { displayUnit: DisplayUnit; parse: (text: string) => Promise<MeasuredAnswer> };
}) {
  const move = useCellNavigation();
  const proposal = cell?.proposal;
  const staged = cell?.staged;
  const shown = staged?.value.value ?? proposal?.value.value ?? current;
  const note = proposal
    ? `Pea proposed ${current || "(blank)"} → ${proposal.value.value}${
        staged?.value.value === proposal.value.value
          ? "; staged — plan will include it"
          : staged
            ? `; you staged ${staged.value.value}, so Pea's value is a counter-proposal`
            : "; open — accept (a) or deny (d) it on this cell"
      }. Nothing has reached Revit.`
    : staged
      ? `You staged ${current || "(blank)"} → ${staged.value.value}. Nothing has reached Revit.`
      : reason;
  return (
    <span data-proposal={proposal ? "pea" : undefined} data-staged={staged ? "" : undefined}>
      <StateCell
        {...cellFromTrichotomy(
          cell ?? { proposal: null, staged: null },
          { value: shown, note, scale: "row" },
          showFamilyCell,
        )}
        cap={lock ? "locked" : "editable"}
        capReason={lock}
        transitions={transitions}
        placeholder={proposal || staged ? current : undefined}
        measured={
          measured && onCommit && !lock
            ? { ...measured, stage: (staged) => onCommit(showCellValue(staged)) }
            : undefined
        }
        onCommit={lock || !onCommit ? undefined : onCommit}
        onNavigate={(direction) => move?.(direction) ?? false}
      />
    </span>
  );
}
