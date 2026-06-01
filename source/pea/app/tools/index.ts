import {
  liveLoopContext,
  liveRrdSync,
  liveRrdRestart,
  liveHostRefreshSourceRun,
  scriptExecuteWithSync,
  talkToPea,
  test,
} from "./dev/tools.js";

export const repoDevTools = {
  [liveLoopContext.id]: liveLoopContext,
  [liveRrdSync.id]: liveRrdSync,
  [liveRrdRestart.id]: liveRrdRestart,
  [liveHostRefreshSourceRun.id]: liveHostRefreshSourceRun,
  [talkToPea.id]: talkToPea,
  [scriptExecuteWithSync.id]: scriptExecuteWithSync,
  [test.id]: test,
};
