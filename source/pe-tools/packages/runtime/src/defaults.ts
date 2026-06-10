export const defaultPeaAgentModelId = "openai/gpt-5.4"; // MUCH Cheaper that gpt5.5, keep like this for the time being
export const defaultPeaFastModelId = "openai/gpt-5.4-mini";
export const defaultPeaOmModelId = defaultPeaFastModelId;
export const defaultPeaGoalJudgeModelId = defaultPeaAgentModelId;
export const defaultPeaObservationThreshold = 75_000; // Keep as large as possible within reasonable context window limits
export const defaultPeaReflectionThreshold = 15_000; // Any larger and model gets confused and/or starts talking with bad language
export const defaultPeaGoalMaxTurns = 15;
export const defaultThinkingLevel = "medium";

export class HarnessRuntimeDefaults {
  defaultPeaAgentModelId = defaultPeaAgentModelId;
  defaultPeaFastModelId = defaultPeaFastModelId;
  defaultPeaOmModelId = defaultPeaOmModelId;
  defaultPeaGoalJudgeModelId = defaultPeaGoalJudgeModelId;
  defaultPeaObservationThreshold = defaultPeaObservationThreshold;
  defaultPeaReflectionThreshold = defaultPeaReflectionThreshold;
  defaultPeaGoalMaxTurns = defaultPeaGoalMaxTurns;
  defaultThinkingLevel = defaultThinkingLevel;
}
