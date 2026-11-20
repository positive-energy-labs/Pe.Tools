/** What the rules and inbox panes are handed of the route's Work: the document, its revision, the writer. */
import type { DuctsDesign } from "@pe/duct-systems-contract/ducts";

import type { CellWire } from "@pe/web-kernel/components/work/band";

export interface LossesWork {
  doc: DuctsDesign | null;
  revision: number | null;
  write: CellWire["write"];
}
