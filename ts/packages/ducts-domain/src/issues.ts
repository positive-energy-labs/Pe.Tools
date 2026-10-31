import type { DuctsSnapshot } from "@pe/host-contracts/generated";

export type IssueKind = DuctsSnapshot.Res.DuctIssueKind;
export type Blocks = "walkable" | "budgetable" | "none";

export const ISSUE_BLOCKS: Record<IssueKind, Blocks> = {
  "open-end": "walkable",
  loop: "walkable",
  "no-terminal-flow": "walkable",
  "no-component-drop": "budgetable",
  "default-flex-roughness": "budgetable",
  stub: "none",
  "implausible-size": "none",
  // Always rides on its connector's `open-end` (DuctHealth.cs), which already blocks the walk.
  "near-miss": "none",
  // The route splices it in series (proximity.ts tolerate, sheet/walk.ts graphOf); its drop is a
  // `no-component-drop` of its own when unstated.
  inline: "none",
  "air-type-change": "none",
  "high-velocity": "none",
};
