/** What the rules and inbox panes are handed of the route's Work: the document, its revision, the last preview, the writer. */
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";

import type { CellWire } from "#/components/work/band";

export interface LossesWork {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  /** The last preview's answer: a write it refused says why at its cell. */
  preview?: DuctsApply.Res.Response | null;
  write: CellWire["write"];
}
