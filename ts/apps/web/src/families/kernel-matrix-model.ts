import { familyCellValueSchema } from "@pe/agent-contracts";
import {
  cellText,
  visibleParameters,
  type FamilySnapshotRecord,
} from "#/host/loaded-families-view";
import { isYesNo, type ParamColumn, type TypeRow } from "./matrix-columns";
import { typeRowKey } from "./picks";
export function matrixModel(families: readonly FamilySnapshotRecord[]) {
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
}

export const filledValue = (value: string | undefined) =>
  value !== undefined && value.trim() !== "";

export interface PivotRow {
  key: string;
  name: string;
  kind: string;
  families: number;
  filled: number;
  present: number;
  filledByFamily: Record<string, number>;
  /** The family's types that carry this parameter, in snapshot order. */
  typesByFamily: Record<string, TypeRow[]>;
}

export interface PivotFamily {
  familyId: number;
  familyUniqueId: string;
  name: string;
  category: string;
  types: number;
  placed: number;
  params: number;
}

export function buildPivot(
  rows: readonly TypeRow[],
  params: readonly ParamColumn[],
  families: readonly FamilySnapshotRecord[],
) {
  const byFamilyRows = new Map<string, TypeRow[]>();
  for (const row of rows) {
    const own = byFamilyRows.get(row.familyName) ?? [];
    own.push(row);
    byFamilyRows.set(row.familyName, own);
  }
  const pivotRows: PivotRow[] = params.map((param) => {
    const filledByFamily: Record<string, number> = {};
    const typesByFamily: Record<string, TypeRow[]> = {};
    let filled = 0;
    let present = 0;
    for (const family of families) {
      const carrying = (byFamilyRows.get(family.familyName) ?? []).filter(
        (row) => row.scopes[param.key] && row.scopes[param.key] !== "Unresolved",
      );
      if (!carrying.length) continue;
      typesByFamily[family.familyName] = carrying;
      const values = carrying.map((row) => row.values[param.key] ?? "");
      present += values.length;
      const nonBlank = values.filter(filledValue).length;
      filled += nonBlank;
      filledByFamily[family.familyName] = nonBlank;
    }
    return {
      key: param.key,
      name: param.name,
      kind: param.isBuiltIn ? "built-in" : param.isProjectOnly ? "project" : param.kind,
      families: param.familyCount,
      filled,
      present,
      filledByFamily,
      typesByFamily,
    };
  });
  const pivotFamilies: PivotFamily[] = families.map((family) => ({
    familyId: family.familyId,
    familyUniqueId: family.familyUniqueId,
    name: family.familyName,
    category: family.categoryName ?? "",
    types: family.typeNames.length,
    placed: family.placedInstanceCount ?? 0,
    params: pivotRows.filter((row) => row.typesByFamily[family.familyName]?.length).length,
  }));
  return { pivotRows, pivotFamilies };
}
