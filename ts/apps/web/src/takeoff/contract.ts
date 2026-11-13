import { executionTargetSchema } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import {
  adoptionArgs,
  adoptionData,
  viewCatalogueArgs,
  viewCatalogueData,
} from "@pe/agent-contracts/takeoff-read";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const views = contract("takeoffs.views", {
  input: viewCatalogueArgs.extend({ target: executionTargetSchema }),
  data: viewCatalogueData,
  uses: ["revit.catalog.project-index"],
});
export const adoption = contract("takeoffs.adoption", {
  input: adoptionArgs.extend({ target: executionTargetSchema }),
  data: adoptionData,
  uses: [views, "takeoffs.snapshot", "takeoffs.candidates"],
});
