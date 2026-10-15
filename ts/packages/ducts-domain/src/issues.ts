import type { DuctsSnapshot } from "@pe/host-contracts/generated";

export type IssueKind = DuctsSnapshot.Res.DuctIssueKind;
export type Blocks = "walkable" | "budgetable" | "none";

export const ISSUE_BLOCKS: Record<IssueKind, Blocks> = {
  "open-end": "walkable",
  loop: "walkable",
  "no-root": "walkable",
  "multi-root": "walkable",
  "no-terminal-flow": "walkable",
  "no-fan-static": "budgetable",
  "no-component-drop": "budgetable",
  "default-flex-roughness": "budgetable",
  "no-flow-leg": "budgetable",
  stub: "none",
  "implausible-size": "none",
  "mixed-classification": "none",
  "high-velocity": "none",
};
