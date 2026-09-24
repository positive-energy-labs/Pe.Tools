/**
 * The native Family Foundry patch, projected onto the reading it would land on: display-only
 * overlays for the param row, the row header and the minimap. Never written into `cells.*`; accept
 * and deny stay on the patch's one review row. Each rung projects separately so the one reader
 * (`cellFromTrichotomy`) ranks staged over proposal, exactly as on a Work cell.
 */
import { familyCellKey, type FamiliesPatchCell } from "@pe/agent-contracts";

import type { ParamSpec } from "#/family/family-model";
import type { ParamColumn, TypeRow } from "./matrix-columns";

export type OverlayRung = "proposal" | "staged";
/** How the patch reaches this cell: an explicit `types` entry, a uniform `value`, a direct alias, or a formula. */
export type OverlayHow = "type" | "uniform" | "alias" | "formula";
export interface OverlayValue {
  value: string;
  how: OverlayHow;
}
/** A projected cell in the trichotomy's shape, so the one reader and the summary take it as is. */
export type OverlayCell = Partial<Record<OverlayRung, OverlayValue>>;
export interface OverlayParameter {
  /** The families the patch selects that this reading carries. */
  families: string[];
  proposal?: ParamSpec & Record<string, unknown>;
  staged?: ParamSpec & Record<string, unknown>;
  /** The reading has no parameter by this name: the patch creates it. */
  absent: boolean;
}
export interface PatchOverlay {
  cells: Record<string, OverlayCell>;
  parameters: Record<string, OverlayParameter>;
  /** What the projection could not say, per rung; shown, never dropped. */
  unprojected: string[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const show = (value: unknown): string => {
  if (value === null) return "cleared";
  if (typeof value === "string") return value;
  const measured = record(value);
  return "value" in measured && "unit" in measured
    ? `${measured.value as string | number} ${measured.unit as string}`
    : JSON.stringify(value);
};
const UNRESOLVED = new Set(["∅", "ambiguous", "blank"]);

/** A parameter by name within this type's own scope; two same-named resolving columns are ambiguous. */
export function readParameterValue(
  type: Pick<TypeRow, "scopes" | "values">,
  name: string,
  params: readonly Pick<ParamColumn, "key" | "name">[],
) {
  const matching = params.filter(
    (param) =>
      param.name === name && type.scopes[param.key] && type.scopes[param.key] !== "Unresolved",
  );
  if (matching.length !== 1) return matching.length ? "ambiguous" : "∅";
  return type.values[matching[0]!.key]?.trim() || "blank";
}

export function projectPatch(
  patch: FamiliesPatchCell,
  rows: readonly TypeRow[],
  params: readonly Pick<ParamColumn, "key" | "name">[],
): PatchOverlay {
  const overlay: PatchOverlay = { cells: {}, parameters: {}, unprojected: [] };
  const known = new Set(params.map((param) => param.name));
  for (const rung of ["staged", "proposal"] as const) {
    const content = patch[rung]?.value.content;
    if (content === undefined) continue;
    const say = (why: string) => overlay.unprojected.push(`${rung}: ${why}`);
    let source: Record<string, unknown>;
    try {
      source = record(JSON.parse(content));
    } catch {
      say("the patch is not JSON");
      continue;
    }
    const select = record(source.select);
    for (const key of Object.keys(select))
      if (key !== "names") say(`select.${key} is not projected`);
    const names = Array.isArray(select.names)
      ? select.names.filter((n) => typeof n === "string")
      : [];
    if (!names.length) say("select names no family, so no cell is projected");
    if (record(source.run).parametersIfSourceExists !== undefined)
      say("run.parametersIfSourceExists creates conditionally; drawn as if every source exists");
    const types = rows.filter((type) => names.includes(type.familyName));
    const families = [...new Set(types.map((type) => type.familyName))];
    const body = record(source.patch);
    if (Array.isArray(body.parameters))
      say("patch.parameters is an array; Family Foundry keys parameters by name");
    const put = (type: TypeRow, parameter: string, value: OverlayValue) =>
      ((overlay.cells[
        familyCellKey({ familyName: type.familyName, typeName: type.typeName, parameter })
      ] ??= {})[rung] = value);
    for (const [name, raw] of Object.entries(record(body.parameters))) {
      if (raw === null) {
        say(`${name} is deleted; a deletion is not drawn`);
        continue;
      }
      const fields = record(raw) as ParamSpec & Record<string, unknown>;
      (overlay.parameters[name] ??= { families, absent: !known.has(name) })[rung] = fields;
      const formula = typeof fields.formula === "string" ? fields.formula : null;
      for (const type of types) {
        if (fields.value !== undefined)
          put(type, name, { value: show(fields.value), how: "uniform" });
        else if (formula && known.has(formula)) {
          const source = readParameterValue(type, formula, params);
          put(type, name, {
            value: UNRESOLVED.has(source) ? "unresolved" : `≈ ${source}`,
            how: "alias",
          });
        } else if (formula) put(type, name, { value: `= ${formula}`, how: "formula" });
      }
    }
    // An explicit type cell beats the uniform value or formula (FamilyPatch.cs, types precedence).
    const typed = record(body.types);
    for (const type of types)
      for (const [name, value] of Object.entries(record(typed[type.typeName])))
        put(type, name, { value: show(value), how: "type" });
  }
  return overlay;
}
