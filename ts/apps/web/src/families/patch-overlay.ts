import type { ParamSpec } from "@pe/agent-contracts";

type OverlayRung = "edit";
/** How the patch reaches this cell: an explicit `types` entry, a uniform `value`, a direct alias, or a formula. */
type OverlayHow = "type" | "uniform" | "alias" | "formula";
interface OverlayValue {
  value: string;
  how: OverlayHow;
}
/** A projected cell in the shared cell's shape, so the one reader and the summary take it as is. */
export type OverlayCell = Partial<Record<OverlayRung, OverlayValue>>;
export interface OverlayParameter {
  /** The families the patch selects that this reading carries. */
  families: string[];
  edit?: ParamSpec & Record<string, unknown>;
  /** The reading has no parameter by this name: the patch creates it. */
  absent: boolean;
}
export interface PatchOverlay {
  cells: Record<string, OverlayCell>;
  parameters: Record<string, OverlayParameter>;
  /** What the projection could not say, per rung; shown, never dropped. */
  unprojected: string[];
}
