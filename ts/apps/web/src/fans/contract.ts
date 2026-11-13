import { fansReadArgs, fansSheetData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/**
 * The one declaration of each read this route serves: the pane and the host body both take it from
 * here. `uses` names the catalog Reads the body reaches, through its host-only recipes too.
 */
export const sheet = contract("fans.sheet", {
  input: fansReadArgs,
  data: fansSheetData,
  uses: ["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables", "revit.catalog.field-options"],
  keyedBy: {
    rows: { kind: "UniqueId", sub: "port" },
    "fans.rows": { kind: "UniqueId", sub: "port" },
  },
});
