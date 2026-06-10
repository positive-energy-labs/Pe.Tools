import {
  liveLoopContext,
  liveRrdRestart,
  liveRrdSync,
  scriptExecuteWithSync,
  talkToPea,
  test,
} from "./tools.ts";

export { peCodeToolCatalog } from "../tool-metadata.ts";
export { PeCodeCliCommands } from "./PeCodeCliCommands.ts";
export {
  liveLoopContext,
  liveRrdRestart,
  liveRrdSync,
  scriptExecuteWithSync,
  talkToPea,
  test,
} from "./tools.ts";

export const peCodeTools = {
  [liveLoopContext.id]: liveLoopContext,
  [liveRrdRestart.id]: liveRrdRestart,
  [liveRrdSync.id]: liveRrdSync,
  [scriptExecuteWithSync.id]: scriptExecuteWithSync,
  [talkToPea.id]: talkToPea,
  [test.id]: test,
};
