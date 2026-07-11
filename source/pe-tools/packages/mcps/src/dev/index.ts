import { createRuntimeToolProfile, mergeRuntimeToolCatalogs } from "@pe/runtime";
import { peaProductTools } from "../pea/index.ts";
import { peaProductToolCatalog, peCodeToolCatalog } from "../tool-metadata.ts";
import { PeCodeCliCommands, type PeCodeCliCommandOptions } from "./PeCodeCliCommands.ts";
import {
  liveLoopContext,
  scriptExecuteWithSync,
  talkToPea,
  talkToPecoZellijTool,
} from "./tools.ts";

export { peCodeToolCatalog } from "../tool-metadata.ts";
export { PeCodeCliCommands } from "./PeCodeCliCommands.ts";
export {
  liveLoopContext,
  scriptExecuteWithSync,
  talkToPea,
  talkToPecoZellijTool,
} from "./tools.ts";

export const peCodeTools = {
  [liveLoopContext.id]: liveLoopContext,
  [scriptExecuteWithSync.id]: scriptExecuteWithSync,
  [talkToPea.id]: talkToPea,
  [talkToPecoZellijTool.id]: talkToPecoZellijTool,
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
