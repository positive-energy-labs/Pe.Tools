import { createRuntimeToolProfile, mergeRuntimeToolCatalogs } from "@pe/runtime";
import { peaProductTools } from "../pea/index.ts";
import { peaProductToolCatalog, peCodeToolCatalog } from "../tool-metadata.ts";
import { PeCodeCliCommands, type PeCodeCliCommandOptions } from "./PeCodeCliCommands.ts";
import {
  liveLoopContext,
  liveRrdRestart,
  liveRrdSync,
  scriptExecuteWithSync,
  talkToPea,
  talkToPecoZellijTool,
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
  talkToPecoZellijTool,
  test,
} from "./tools.ts";

export const peCodeTools = {
  [liveLoopContext.id]: liveLoopContext,
  [liveRrdRestart.id]: liveRrdRestart,
  [liveRrdSync.id]: liveRrdSync,
  [scriptExecuteWithSync.id]: scriptExecuteWithSync,
  [talkToPea.id]: talkToPea,
  // [talkToPecoPsmuxTool.id]: talkToPecoPsmuxTool,
  [talkToPecoZellijTool.id]: talkToPecoZellijTool,
  [test.id]: test,
};

export const peCodeRuntimeToolProfile = createRuntimeToolProfile({
  id: "peco",
  tools: {
    ...peaProductTools,
    ...peCodeTools,
  },
  catalog: mergeRuntimeToolCatalogs(peaProductToolCatalog, peCodeToolCatalog),
  commands: {
    createSubCommands: (options?: PeCodeCliCommandOptions) =>
      new PeCodeCliCommands(options).commands(),
  },
});
