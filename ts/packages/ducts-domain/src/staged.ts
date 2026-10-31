/** What the Work has edit for a write, counted from the document alone. */
import type { DuctsApplyInput, DuctsRouteDocument, WorkPath } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";

import { pendingRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

/**
 * The segments `ducts.apply` writes to elements and the store; `loads` stays in Pe, and the rulings
 * (`assumptions` verdicts, `roles`) are written to the store as deltas (`pendingRulings`).
 */
export const WRITTEN = [
  "rules",
  "terminalDrops",
  "componentDrops",
  "flows",
  "esp",
  "equipmentFlows",
  "parameters",
] as const;

export const stagedCells = (doc: DuctsRouteDocument | null) =>
  ([...WRITTEN, "catalogs", "ruleAssignments"] as const).flatMap((segment) =>
    Object.entries(doc?.[segment] ?? {}).flatMap(([key, cell]) =>
      cell?.edit ? [{ segment, key, cell }] : [],
    ),
  );

/** How many changes a write would carry: edit cells, and rulings that differ from the store's. */
export const pendingCount = (doc: DuctsRouteDocument | null, store: DuctSnapshot["store"]) =>
  stagedCells(doc).length + pendingRulings(doc, store).length;

/** Staged ESP cells: the one write that waits for a clean calc. */
export const stagedEsp = (doc: DuctsRouteDocument | null) =>
  Object.values(doc?.esp ?? {}).filter((cell) => cell?.edit).length;

/** Retire only cells whose transmitted native writes succeeded; held and refused cells stay edit. */
export function appliedCellPaths(
  input: DuctsApplyInput,
  response: DuctsApply.Res.Response,
): WorkPath[] {
  if (response.previewOnly) return [];
  const succeeded = response.writes.filter(
    (write) => write.outcome === "written" || write.outcome === "unchanged",
  );
  const has = (kind: string, id: number) =>
    succeeded.some((write) => write.kind === kind && write.id === id);
  const paths: WorkPath[] = [];
  for (const [rows, kind, segment] of [
    [input.terminals, "terminal", "terminalDrops"],
    [input.components, "component", "componentDrops"],
    [input.equipment, "equipment", "esp"],
    [input.terminalFlows, "terminal-flow", "flows"],
    [input.equipmentFlows, "equipment-flow", "equipmentFlows"],
  ] as const)
    for (const row of rows) if (has(kind, row.id)) paths.push([segment, String(row.id)]);
  const rules = new Map<string, number[]>();
  for (const fitting of input.fittings)
    if (fitting.ruleKey)
      rules.set(fitting.ruleKey, [...(rules.get(fitting.ruleKey) ?? []), fitting.id]);
  for (const [key, ids] of rules)
    if (ids.every((id) => has("fitting", id))) paths.push(["rules", key]);
  for (const write of succeeded) {
    if (write.kind === "verdict" && write.key) paths.push(["assumptions", write.key]);
    if (write.kind === "role" && write.id != null) paths.push(["roles", String(write.id)]);
    if (write.kind === "slot" && write.key) paths.push(["parameters", write.key]);
  }
  return paths;
}
