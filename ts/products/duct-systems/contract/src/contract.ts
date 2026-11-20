import { fanRoster, networkCalcs } from "@pe/fans-contract/fans-host-reads";
import {
  ductsNetworkArgs,
  ductsOverviewData,
  ductsNetworkData,
  ductsPricingData,
  ductsRosterArgs,
  ductsRosterData,
} from "./ducts-read.ts";
import { contract } from "@pe/agent-contracts/handle";
import { fanScopeSchema } from "@pe/ducts-contract/fan-scope.neutral";
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
export const overview = contract("ducts.overview", {
  input: ductsRosterArgs,
  data: ductsOverviewData,
  uses: [roster],
  keyedBy: roster.keyedBy,
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
  uses: [network, roster, fanRoster, networkCalcs, "ducts.tables"],
});
