import type { Tool } from "@pe/agent-contracts";
import { fansRouteState } from "./fans.ts";

export const fansTool = {
  name: "fans",
  says: fansRouteState.description,
  work: {
    ...fansRouteState,
    editable: [
      ["writeIntent"],
      ["terminalDrops", "*"],
      ["componentDrops", "*"],
      ["esp", "*"],
      ["ratedEsp", "*"],
      ["equipmentFlows", "*"],
      ["roles", "*"],
      ["flows", "*"],
    ],
  },
  commands: {},
} satisfies Tool;
