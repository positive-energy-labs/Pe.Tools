/**
 * A run's priced rows grouped by what pays them: one group per duct type, fitting family type,
 * terminal type and unit type. The three parts (unit end, ducts & fittings, grille) are the coarse
 * split the strip has always drawn; a group sits inside exactly one part. Size is a choice, off by
 * default: 12" and 8" of the same duct type are one group unless `bySize`.
 */
import type { Row } from "@pe/ducts-domain/calc-runs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { familyTypeName as typeLabel } from "@pe/agent-contracts/subject-ref";

export type LossPart = "unit" | "duct" | "terminal";

export interface LossGroup {
  /** Stable within one breakdown: part, element kind, label (and size when asked). */
  key: string;
  part: LossPart;
  /** What the group's elements are: a duct, a fitting, a unit or a terminal. */
  element: "duct" | "fitting" | "unit" | "terminal";
  /** The type as a person names it ("Round Duct", "Elbow - Radius: Standard"), plus the size when grouped by it. */
  label: string;
  dp: number;
  ids: number[];
  /** Rows with no drop: the group is unknown at that share, never zero. */
  unpriced: number;
}

/** Family and type as one name; a Revit-internal family (`Damper_Volume_Round`) yields to its type. */

/**
 * The groups of one run's rows, in bar order: unit end, then ducts and fittings, then grille; within a
 * part the largest drop first. Pure over (snapshot, rows); the parts' dp sum to the rows' dp.
 */
export function lossGroups(
  snapshot: DuctSnapshot,
  rows: readonly Row[],
  { bySize = false }: { bySize?: boolean } = {},
): LossGroup[] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const segments = new Map(snapshot.segments.map((s) => [s.id, s]));
  const groups = new Map<string, LossGroup>();
  for (const row of rows) {
    const node = nodes.get(row.id);
    const segment = segments.get(row.id);
    const part: LossPart =
      row.kind === "terminal" ? "terminal" : node?.kind === "equipment" ? "unit" : "duct";
    const element: LossGroup["element"] =
      part === "terminal" ? "terminal" : part === "unit" ? "unit" : segment ? "duct" : "fitting";
    const base = segment
      ? segment.type?.trim() || segment.kind
      : node
        ? typeLabel(node) || node.kind
        : row.kind.startsWith("tap")
          ? "tap fitting"
          : "element not in snapshot";
    const size = bySize ? (segment?.size ?? node?.connectors[0]?.size ?? "") : "";
    const label = size ? `${base} ${size}` : base;
    const key = `${part}|${element}|${label}`;
    let group = groups.get(key);
    if (!group)
      groups.set(key, (group = { key, part, element, label, dp: 0, ids: [], unpriced: 0 }));
    if (row.dp == null || row.error) group.unpriced++;
    group.dp += row.dp ?? 0;
    if (!group.ids.includes(row.id)) group.ids.push(row.id);
  }
  const order: Record<LossPart, number> = { unit: 0, duct: 1, terminal: 2 };
  return [...groups.values()].sort((a, b) => order[a.part] - order[b.part] || b.dp - a.dp);
}
