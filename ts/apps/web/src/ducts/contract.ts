import {
  ductsNetworkArgs,
  ductsNetworkData,
  ductsPricingData,
  ductsRosterArgs,
  ductsRosterData,
} from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import { fanScopeSchema } from "./fan-scope.neutral";
const scopedNetworkArgs = ductsNetworkArgs.extend({ fan: fanScopeSchema.nullable().optional() });

/**
 * The one declaration of each read this route serves: the pane and the host body both take it from
 * here. `uses` names the catalog Reads a body reaches, through its host-only recipes too.
 */
export const roster = contract("ducts.roster", {
  input: ductsRosterArgs,
  data: ductsRosterData,
  uses: ["ducts.snapshot.roster"],
  keyedBy: { rows: { kind: "system-name" } },
});
export const network = contract("ducts.network", {
  input: scopedNetworkArgs,
  data: ductsNetworkData,
  uses: [roster, "ducts.snapshot.walk"],
  keyedBy: {
    nodes: { kind: "UniqueId" },
    segments: { kind: "UniqueId" },
    groups: { kind: "group" },
    systems: { kind: "system-name" },
  },
});
export const pricing = contract("ducts.pricing", {
  input: scopedNetworkArgs,
  data: ductsPricingData,
  // The fan roster and its ESP options are host-only recipes with no contract; this names their natives.
  uses: [network, roster, "ducts.tables", "ducts.snapshot.roster", "revit.catalog.field-options"],
});
