import { podsArgs, podsRosterValue, podsValue } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";
import { z } from "zod";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const roster = contract("pods.roster", {
  input: z.object({}),
  data: podsRosterValue,
  uses: [],
  subject: "None",
  // `pods` is keyed by name, but its schema is a decoded Effect schema the path check cannot see into: unkeyed.
});
export const author = contract("pods.author", {
  input: podsArgs,
  data: podsValue,
  uses: [],
  subject: "None",
});
