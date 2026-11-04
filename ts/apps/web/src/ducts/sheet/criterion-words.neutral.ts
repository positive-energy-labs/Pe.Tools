import type { DuctsCriteriaValues } from "@pe/agent-contracts";

/** Each design criterion in words: the inputs pane's labels and the review's, one map. */
export const CRITERION_WORDS: Record<keyof DuctsCriteriaValues, string> = {
  velocityLimitFpm: "velocity limit",
  terminalDropInWg: "default terminal drop",
  autoJoinGapIn: "auto-join gap",
  healBoxIn: "heal box",
  splitPolicy: "split policy",
  allowanceInWg: "allowance",
};

/** A criterion's pane label: its words, capitalised. */
export const criterionLabel = (key: keyof DuctsCriteriaValues) =>
  CRITERION_WORDS[key][0]!.toUpperCase() + CRITERION_WORDS[key].slice(1);
