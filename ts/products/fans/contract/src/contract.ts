import { fansReadArgs, fansCalcData } from "./fans-read.ts";
import { contract } from "@pe/agent-contracts/handle";
import { CALC_READ } from "./fan-calc.ts";

/**
 * The one declaration of each read this route serves: the pane and the host body both take it from
 * here. `uses` names the catalog Reads the body reaches, through its host-only recipes too.
 */
export const calc = contract(CALC_READ, {
  input: fansReadArgs,
  data: fansCalcData,
  uses: [
    "ducts.snapshot.roster",
    "ducts.snapshot.walk",
    "ducts.tables",
    "revit.catalog.field-options",
  ],
  keyedBy: {
    rows: { kind: "UniqueId", sub: "port" },
    "fans.rows": { kind: "UniqueId", sub: "port" },
  },
});
