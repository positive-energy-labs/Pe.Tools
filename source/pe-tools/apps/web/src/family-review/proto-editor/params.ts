/**
 * PROTOTYPE (round 3) — the parameter surface's data, cross-type.
 *
 * THE RULED GAP: sentences won for editing, and lost on the one job family-route precedents kept
 * converging on a table for — editing and AUDITING a parameter ACROSS TYPES. One parameter is a
 * sentence; nineteen parameters × three types is a grid, because the question is "which of these
 * did Tall actually move" and that question is a column read.
 *
 * THE TRICHOTOMY IS THE POINT, NOT THE NUMBER. Every cell says where its value CAME FROM, because
 * "24in" typed by hand and "24in" inherited from the base are different facts and a surface that
 * renders them alike is the confident-wrong-number failure SURFACE-PHILOSOPHY §0 is about. A
 * formula-driven parameter cannot be overridden at all (`setOverride` refuses), so those cells
 * carry the refusal rather than an empty box that silently swallows a keystroke.
 */
import {
  paramAssociations,
  resolveParam,
  type FamilyModel,
  type ValueSource,
} from "#/family/family-model";

export interface ParamCell {
  text: string;
  source: ValueSource;
  /** null = writable. A string = why this cell refuses, shown on the cell, not only on hover. */
  lock: string | null;
  /** Where a write would land — also the cross-pane highlight address. */
  pointer: string;
}

export interface ParamRow {
  name: string;
  section: "familyParameters" | "sharedParameters";
  dataType: string;
  /** The family-level value, or the formula that computes it. */
  base: ParamCell;
  /** One cell per type, in the document's type order. */
  byType: Record<string, ParamCell>;
  /** Authored constructs that read this parameter — the reverse index, as a sort key. */
  reads: number;
  pointer: string;
}

export function paramRows(model: FamilyModel): ParamRow[] {
  const sections = [
    ["familyParameters", model.familyParameters] as const,
    ["sharedParameters", model.sharedParameters ?? {}] as const,
  ];
  return sections.flatMap(([section, specs]) =>
    Object.entries(specs).map(([name, spec]) => {
      const associations = paramAssociations(model, name);
      const formulaDriven = spec.formula != null;
      const base: ParamCell = formulaDriven
        ? {
            text: `= ${spec.formula ?? ""}`,
            source: "formula",
            lock: null,
            pointer: `/${section}/${name}/formula`,
          }
        : {
            text: spec.value ?? "—",
            source: spec.value == null ? "missing" : "value",
            lock: null,
            pointer: `/${section}/${name}/value`,
          };
      const byType: Record<string, ParamCell> = {};
      for (const typeName of Object.keys(model.types)) {
        const override = model.types[typeName]?.[name];
        const resolved = resolveParam(model, typeName, name);
        byType[typeName] = {
          text: override ?? resolved.text,
          source: override != null ? "override" : resolved.source,
          lock: formulaDriven ? "a formula computes this — a type cannot override it" : null,
          pointer: `/types/${typeName}/${name}`,
        };
      }
      return {
        name,
        section,
        dataType: spec.dataType,
        base,
        byType,
        reads:
          associations.dimensions.length + associations.arrays.length + associations.nested.length,
        pointer: `/${section}/${name}`,
      };
    }),
  );
}

export type SortKey = "name" | "dataType" | "base" | "reads";

export interface ParamView {
  query: string;
  /** Only rows some type actually overrides — the audit read. */
  overriddenOnly: boolean;
  sort: SortKey;
  descending: boolean;
}

export const DEFAULT_VIEW: ParamView = {
  query: "",
  overriddenOnly: false,
  sort: "name",
  descending: false,
};

/** Sort and filter, as one pure pass — the table's second power. */
export function viewRows(rows: ParamRow[], view: ParamView): ParamRow[] {
  const query = view.query.trim().toLowerCase();
  const kept = rows.filter((row) => {
    if (
      view.overriddenOnly &&
      !Object.values(row.byType).some((cell) => cell.source === "override")
    )
      return false;
    if (query === "") return true;
    return (
      row.name.toLowerCase().includes(query) ||
      row.dataType.toLowerCase().includes(query) ||
      row.base.text.toLowerCase().includes(query)
    );
  });
  const key = (row: ParamRow) =>
    view.sort === "reads"
      ? row.reads
      : view.sort === "name"
        ? row.name
        : view.sort === "dataType"
          ? row.dataType
          : row.base.text;
  const sorted = [...kept].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  });
  return view.descending ? sorted.reverse() : sorted;
}
