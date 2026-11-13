import { familiesViewArgs, familiesViewData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const view = contract("families.view", {
  input: familiesViewArgs,
  data: familiesViewData,
  uses: ["revit.catalog.loaded-families"],
  keyedBy: { pivotFamilies: { kind: "UniqueId" } },
});
