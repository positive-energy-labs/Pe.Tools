import { schedulesViewArgs, schedulesViewData, valueRead } from "@pe/agent-contracts";

/** The browser contract of `host.ts`'s `schedules.view`: the shell parses `input` and `output` at runtime. */
export const reads = {
  view: valueRead("schedules.view", schedulesViewArgs.omit({ target: true }), schedulesViewData),
};
