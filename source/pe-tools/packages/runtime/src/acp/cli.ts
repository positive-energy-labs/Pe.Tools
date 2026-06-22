/** Gunshi arg definitions for running the runtime as an ACP (stdio) agent. */
export const argsAcp = {
  acp: {
    type: "boolean",
    description: "Run the runtime as an ACP agent over stdio.",
    default: false,
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the ACP-backed runtime.",
  },
} as const;
