import { familiesViewArgs, familiesViewData, valueRead } from "@pe/agent-contracts";

/** The browser contract of `host.ts`'s `families.view`: the shell parses `input` and `output` at runtime. */
export const reads = {
  view: valueRead("families.view", familiesViewArgs.omit({ target: true }), familiesViewData),
};
