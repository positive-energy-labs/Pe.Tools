/**
 * The profiler tree E2 reads: system -> fan calc -> runs (that calc's paths) -> legs -> elements,
 * built by `buildSheetTree` (`sheet-model.ts`) from the fan calcs alone. With no calc every number
 * is null (never a stand-in figure).
 */
import type { Provisional } from "@pe/ducts-domain/calc-runs";

import type { Split } from "../../loss-split";

type TreeKind = "system" | "run" | "leg" | "element";

export interface TreeNode {
  key: string;
  kind: TreeKind;
  name: string;
  /** The element id a select/hover sends: system → root element, run → terminal, leg → first id. */
  id: number | null;
  /** Cumulative loss from the fan to the far end of this node, in-wg; null unpriced. */
  total: number | null;
  /** This node's own loss, in-wg; null unpriced. */
  self: number | null;
  /** Effective length from the fan to the far end of this node, ft (`equivalent-length.ts`); null unpriced. */
  ft: number | null;
  /** This node's own effective length, ft: its straight length plus its fittings and terminal as equivalent feet. */
  selfFt: number | null;
  /** A duct element's own actual friction rate, in-wg per 100 ft on this path; null on any other node. */
  rate: number | null;
  /** Why `self` is null on a priced path: the word the row shows (`no drop`, `unpriced`) and the reason. */
  unpriced: { word: string; why: string } | null;
  /** A run's loss in three parts (the system row carries its critical run's); null elsewhere or unpriced. */
  split: Split | null;
  /** Bar scale: the required ESP of the fan calc the node is on; null while that calc is incomplete. */
  scale: number | null;
  critical: "pe" | "longest" | null;
  provisional: Provisional;
  /** A run's level (where its grille is), else null. */
  level: string | null;
  /** The run's terminal this node lies on (for the loss rows in the edit popover). */
  terminal: number | null;
  /** One plain line under the row ("Rule a fan to price this system"); absent or null says nothing. */
  message?: string | null;
  children: TreeNode[];
}
