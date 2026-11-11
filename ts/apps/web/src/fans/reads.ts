import { fansReadArgs, fansReadResponse, type ExecutionTarget } from "@pe/agent-contracts";

/** The browser contract of `host.ts`'s `fans.sheet`: the shell parses `input` and `output` at runtime. */
export const reads = {
  sheet: {
    key: "fans.sheet" as const,
    endpoint: "reads.value" as const,
    request: (args: object, target?: ExecutionTarget) => ({ read: "fans.sheet", args: { ...args, target: target?.kind === "document" ? target.ref : target } }),
    input: fansReadArgs.omit({ target: true }),
    output: fansReadResponse,
    axes: { subject: "Document", touches: ["Metadata"], effect: "Read", cost: "Cheap", cardinality: "One" } as const,
  },
} as const;
