import {
  ductsNetworkArgs,
  ductsNetworkReadResponse,
  ductsPricingReadResponse,
  ductsRosterArgs,
  ductsRosterReadResponse,
  type ExecutionTarget,
} from "@pe/agent-contracts";

const axes = {
  subject: "Document",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
/** The browser contracts of `host.ts`'s reads: the shell parses `input` and `output` at runtime. */
export const reads = {
  roster: {
    key: "ducts.roster.value",
    endpoint: "reads.value",
    request: (args: object, target?: ExecutionTarget) => ({ read: "ducts.roster", args: { ...args, target: target?.kind === "document" ? target.ref : target } }),
    input: ductsRosterArgs.omit({ target: true }),
    output: ductsRosterReadResponse,
    axes,
  },
  network: {
    key: "ducts.network.value",
    endpoint: "reads.value",
    request: (args: object, target?: ExecutionTarget) => ({ read: "ducts.network", args: { ...args, target: target?.kind === "document" ? target.ref : target } }),
    input: ductsNetworkArgs.omit({ target: true }),
    output: ductsNetworkReadResponse,
    axes,
  },
  pricing: {
    key: "ducts.pricing.value",
    endpoint: "reads.value",
    request: (args: object, target?: ExecutionTarget) => ({ read: "ducts.pricing", args: { ...args, target: target?.kind === "document" ? target.ref : target } }),
    input: ductsNetworkArgs.omit({ target: true }),
    output: ductsPricingReadResponse,
    axes,
  },
} as const;
