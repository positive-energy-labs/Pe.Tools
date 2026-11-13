import { executionTargetSchema, roomsArgs, roomsData } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const workspace = contract("rooms.workspace", {
  input: roomsArgs.extend({ target: executionTargetSchema }),
  data: roomsData,
  uses: ["rooms.snapshot", "rooms.roster", "rooms.trace", "revit.context.view-image"],
  keyedBy: { "snapshot.regions": { kind: "UniqueId" } },
});
