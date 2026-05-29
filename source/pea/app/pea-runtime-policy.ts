export interface PeaRuntimePolicy {
  configDir: ".pea";
  mcpEnabled: boolean;
  promptCachingRequired: boolean;
  openAiResponsesHistoryCompatEnabled: boolean;
}

export const peaRuntimePolicy: PeaRuntimePolicy = {
  configDir: ".pea",
  mcpEnabled: false,
  promptCachingRequired: true,
  openAiResponsesHistoryCompatEnabled: true,
};
