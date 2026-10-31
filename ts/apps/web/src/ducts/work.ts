/** What the rules and inbox panes are handed of the route's Work: the document, its revision, the writer. */
import type { DuctsRouteDocument } from "@pe/agent-contracts";

import type { CellWire } from "#/components/work/band";

export interface LossesWork {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: CellWire["write"];
}
