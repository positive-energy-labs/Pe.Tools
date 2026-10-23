import { lossGroups, type LossGroup } from "@pe/ducts-domain/loss-breakdown";
import type { Row } from "@pe/ducts-domain/losses";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** One end of a run's loss: its in-wg and the elements that pay it (the set a hover lights). */
export interface SplitPart {
  dp: number;
  ids: number[];
  /** Rows in this part with no drop (a grille with no catalog link): the part is unknown, never 0. */
  unpriced: number;
}
/**
 * A whole run's loss in three: the unit end (passive devices in series with the fan: a coil, a
 * dehu), the ducts and fittings between, and the terminal's drop. The fan is not a part: it is the
 * whole, the largest run's total.
 */
export interface Split {
  /** The exact run behind this bar; rule columns must not borrow another path's lookup. */
  rows: readonly Row[];
  unit: SplitPart;
  duct: SplitPart;
  terminal: SplitPart;
  /** The same loss per element group (duct type, fitting family type, ...), in bar order. */
  groups: LossGroup[];
}

/** Whether a breakdown group is also split by size. A choice, off: 12" and 8" of one duct type share a group. */
export const BREAKDOWN_BY_SIZE = false;

/** A path's rows dealt to the three parts by what each row prices, and to groups by what each row is. */
export function splitOf(
  snapshot: DuctSnapshot,
  rows: readonly Row[],
  equipment: ReadonlySet<number>,
): Split {
  const part = (): SplitPart => ({ dp: 0, ids: [], unpriced: 0 });
  const split: Split = {
    rows,
    unit: part(),
    duct: part(),
    terminal: part(),
    groups: lossGroups(snapshot, rows, { bySize: BREAKDOWN_BY_SIZE }),
  };
  for (const row of rows) {
    const to =
      row.kind === "terminal" ? split.terminal : equipment.has(row.id) ? split.unit : split.duct;
    if (row.dp == null || row.error) to.unpriced++;
    to.dp += row.dp ?? 0;
    if (!to.ids.includes(row.id)) to.ids.push(row.id);
  }
  return split;
}
