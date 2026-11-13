import { settingsArgs, settingsValue } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const machine = contract("settings.machine", {
  input: settingsArgs,
  data: settingsValue,
  uses: [],
  subject: "None",
});
