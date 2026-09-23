import type { QueryGrammar, QueryToken } from "#/components/master-table/model";
import { tokenAt } from "#/components/master-table/view";
import type { ParamColumn, TypeRow } from "#/families/matrix-columns";
import type { FamilySnapshotRecord } from "#/host/loaded-families-view";

export const DEFAULT_FAMILIES_RULES = "blank live";
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
    name: family.familyName,
    category: family.categoryName ?? "",
    types: family.typeNames.length,
    placed: family.placedInstanceCount ?? 0,
    params: pivotRows.filter((row) => row.typesByFamily[family.familyName]?.length).length,
  }));
  return { pivotRows, pivotFamilies };
}

type Rule = {
  word: string;
  label: string;
  row?: (row: PivotRow, families: readonly PivotFamily[]) => boolean;
  family?: (family: PivotFamily, rows: readonly PivotRow[]) => boolean;
};

/** One catalogue supplies completion, chips, and pivot filtering. */
const RULES: readonly Rule[] = [
  { word: "blank", label: "hide parameters blank in shown types", row: (row) => row.filled > 0 },
  {
    word: "half",
    label: "keep parameters ≥ 50% of types filled",
    row: (row) => row.present > 0 && row.filled >= row.present / 2,
  },
  { word: "shared", label: "keep parameters on ≥ 3 families", row: (row) => row.families >= 3 },
  { word: "own", label: "keep parameters on 1 family only", row: (row) => row.families === 1 },
  {
    word: "noproject",
    label: "hide project-bound parameters",
    row: (row) => row.kind !== "project" && row.kind !== "ProjectSharedParameter",
  },
  {
    word: "live",
    label: "hide parameters absent from shown families",
    row: (row, families) => families.some((family) => row.typesByFamily[family.name]?.length),
  },
  { word: "placed", label: "keep placed families", family: (family) => family.placed > 0 },
  {
    word: "valued",
    label: "hide families blank in shown parameters",
    family: (family, rows) => rows.some((row) => (row.filledByFamily[family.name] ?? 0) > 0),
  },
];

/** A bare word the rule catalogue does not name is free text: the frame's substring search. */
const free = (raw: string) => /^[^!:<>=]+$/.test(raw);

const numeric = /^(fams|filled)(>=|<=|>|<|=)(\d+)(%?)$/;
const decoded = (word: string) => {
  try {
    return decodeURIComponent(word);
  } catch {
    return word;
  }
};
const compare = (actual: number, op: string, want: number) =>
  op === ">="
    ? actual >= want
    : op === "<="
      ? actual <= want
      : op === ">"
        ? actual > want
        : op === "<"
          ? actual < want
          : actual === want;

function parseRules(text: string, families: readonly PivotFamily[]) {
  const rules: Rule[] = [];
  const numbers: { raw: string; label: string; test: (row: PivotRow) => boolean }[] = [];
  const hidden = new Set<string>();
  const unknown: string[] = [];
  let family = "";
  let parameter = "";
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const token = raw.toLowerCase();
    const rule = RULES.find((entry) => entry.word === token);
    const match = numeric.exec(token);
    if (rule) rules.push(rule);
    else if (match) {
      const [, field, op, n, pct] = match;
      const want = Number(n);
      numbers.push({
        raw,
        label: numberLabel(field!, op!, n!, pct!),
        test: (row) =>
          compare(
            field === "fams"
              ? row.families
              : pct
                ? row.present
                  ? (100 * row.filled) / row.present
                  : 0
                : row.filled,
            op,
            want,
          ),
      });
    } else if (token.startsWith("f:")) family = decoded(raw.slice(2));
    else if (token.startsWith("p:")) parameter = decoded(raw.slice(2));
    else if (raw.startsWith("!") && raw.length > 1) {
      const hit = families.find(
        (entry) => entry.name.toLowerCase() === decoded(raw.slice(1)).toLowerCase(),
      );
      if (hit) hidden.add(hit.name);
      else unknown.push(raw);
    } else if (!free(raw)) unknown.push(raw);
  }
  return { rules, numbers, hidden, family, parameter, unknown };
}

export function applyRules(
  text: string,
  rows: readonly PivotRow[],
  families: readonly PivotFamily[],
) {
  const parsed = parseRules(text, families);
  let shownFamilies = families.filter(
    (family) =>
      !parsed.hidden.has(family.name) &&
      family.name.toLowerCase().includes(parsed.family.toLowerCase()),
  );
  const namedRows = rows.filter((row) =>
    row.name.toLowerCase().includes(parsed.parameter.toLowerCase()),
  );
  let shownRows: PivotRow[] = [];
  // Family rules only narrow; recalculate each row from the remaining families until they settle.
  while (true) {
    const nextRows = namedRows
      .map((row) => {
        let present = 0;
        let filled = 0;
        let familyCount = 0;
        for (const family of shownFamilies) {
          const types = row.typesByFamily[family.name];
          if (!types?.length) continue;
          familyCount++;
          present += types.length;
          filled += types.filter((type) => filledValue(type.values[row.key])).length;
        }
        return { ...row, families: familyCount, present, filled };
      })
      .filter(
        (row) =>
          parsed.rules.every((rule) => !rule.row || rule.row(row, shownFamilies)) &&
          parsed.numbers.every((number) => number.test(row)),
      );
    const nextFamilies = shownFamilies.filter((family) =>
      parsed.rules.every((rule) => !rule.family || rule.family(family, nextRows)),
    );
    shownRows = nextRows;
    if (nextFamilies.length === shownFamilies.length) break;
    shownFamilies = nextFamilies;
  }
  return { ...parsed, shownRows, shownFamilies };
}

function suggestionsFor(
  lower: string,
  families: readonly PivotFamily[],
  rows: readonly PivotRow[],
) {
  const family = (prefix: string, needle: string) =>
    families
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((entry) => ({
        insert: `${prefix}${encodeURIComponent(entry.name)}`,
        label: entry.name,
        hint: `${entry.types} types · ${entry.params} params`,
      }));
  if (lower.startsWith("f:")) return family("f:", decoded(lower.slice(2)));
  if (lower.startsWith("!")) return family("!", decoded(lower.slice(1)));
  if (lower.startsWith("p:")) {
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        if (!row.name.toLowerCase().includes(decoded(lower.slice(2))) || seen.has(row.name))
          return false;
        seen.add(row.name);
        return true;
      })
      .slice(0, 8)
      .map((row) => ({
        insert: `p:${encodeURIComponent(row.name)}`,
        label: row.name,
        hint: `${row.families} fams · ${row.filled}/${row.present} filled`,
      }));
  }
  return [
    ...RULES.map((rule) => ({ insert: rule.word, label: rule.word, hint: rule.label })),
    {
      insert: "fams>=3",
      label: "fams>=N",
      hint: "parameters on N or more families (also <= > < =)",
    },
    { insert: "filled>=50%", label: "filled>=N%", hint: "parameters with N% or more types filled" },
    { insert: "f:", label: "f:", hint: "families whose name contains…" },
    { insert: "p:", label: "p:", hint: "parameters whose name contains…" },
    { insert: "!", label: "!Family", hint: "hide one family" },
  ].filter((entry) => entry.insert.startsWith(lower));
}

function numberLabel(field: string, op: string, n: string, pct: string) {
  return field === "fams"
    ? `parameters on ${op} ${n} families`
    : `parameters ${op} ${n}${pct} ${pct ? "of types" : "types"} filled`;
}

/** The families query grammar: one catalogue supplies tokens, chips, and suggestions. */
export function familiesGrammar(
  rows: readonly PivotRow[],
  families: readonly PivotFamily[],
): QueryGrammar {
  const kindOf = (raw: string): QueryToken["kind"] => {
    const { unknown } = parseRules(raw, families);
    if (unknown.length) return "unknown";
    return free(raw) && !RULES.some((rule) => rule.word === raw.toLowerCase()) ? "free" : "rule";
  };
  return {
    tokens: (text) =>
      text
        .split(/\s+/)
        .filter(Boolean)
        .map((raw) => ({ text: raw, kind: kindOf(raw) })),
    suggest: (text, caret) =>
      suggestionsFor(tokenAt(text, caret).text.toLowerCase(), families, rows),
    chip: ({ text, kind }) => {
      const lower = text.toLowerCase();
      const match = numeric.exec(lower);
      const label =
        kind === "unknown"
          ? `unknown: ${text}`
          : kind === "free"
            ? `search: ${text}`
            : (RULES.find((rule) => rule.word === lower)?.label ??
              (match
                ? numberLabel(match[1]!, match[2]!, match[3]!, match[4]!)
                : text.startsWith("!")
                  ? `hide ${decoded(text.slice(1))}`
                  : lower.startsWith("f:")
                    ? `families containing ${decoded(text.slice(2))}`
                    : `parameters containing ${decoded(text.slice(2))}`));
      return { label };
    },
  };
}
