export type CellSegment =
  | "flows"
  | "terminalDrops"
  | "equipmentFlows"
  | "esp"
  | "roles"
  | "componentDrops";
export interface CellRef {
  segment: CellSegment;
  id: number;
}

export interface StageIssue {
  key: string;
  ids: readonly number[];
  findings: readonly string[];
  damage: string | null;
  priority?: number;
}
/** Prefer an element's own input over a system-wide parameter picker on the same mesh. */
export function issueAt(
  issues: readonly StageIssue[],
  ids: readonly number[],
  preferred?: string | null,
) {
  const candidates = issues.filter((issue) => issue.ids.some((id) => ids.includes(id)));
  return (
    candidates.find((issue) => issue.key === preferred) ??
    candidates.sort(
      (a, b) =>
        Number(!!b.damage) - Number(!!a.damage) ||
        a.ids.length - b.ids.length ||
        Number(a.key === "airflow" || a.key === "unit-airflow") -
          Number(b.key === "airflow" || b.key === "unit-airflow"),
    )[0]
  );
}
