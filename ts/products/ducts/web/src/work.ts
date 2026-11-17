/** What the rules and inbox panes are handed of the route's Work: the document, its revision, the writer. */
import type { DuctsDesign } from "@pe/agent-contracts";

import type { CellWire } from "../../../../apps/web/src/components/work/band.tsx";

export interface LossesWork {
  doc: DuctsDesign | null;
  revision: number | null;
  write: CellWire["write"];
}
