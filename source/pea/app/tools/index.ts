import {
  liveLoopContext,
  liveRrdSync,
  liveRrdRestart,
  scriptExecuteWithSync,
  talkToPea,
  test,
} from "./dev/tools.js";

export const repoDevTools = {
  [liveLoopContext.id]: liveLoopContext,
  [liveRrdSync.id]: liveRrdSync,
  [liveRrdRestart.id]: liveRrdRestart,
  [talkToPea.id]: talkToPea,
  [scriptExecuteWithSync.id]: scriptExecuteWithSync,
  [test.id]: test,
};
