/**
 * How far each duct group can be solved under a person's assumptions. Derived on every render
 * and never stored: the facts and issues come from `ducts.snapshot`, the assumptions from Work.
 * - walkable: one root, no loop, every open end capped or ignored, every terminal with a flow
 *   (or ignored). A pass-1 walk from the root reaches every terminal.
 * - budgetable: walkable, and every root's fan static and every accessory's pressure drop is
 *   known (stated in Revit or overridden). Flex on the rigid default roughness needs an override
 *   or an ignore.
 */
import { ductOverrideKey, type DuctAssumption, type DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctsSnapshot } from "@pe/host-contracts/generated";

export type DuctSnapshot = DuctsSnapshot.Res.Response;
export type DuctIssue = DuctSnapshot["issues"][number];
export type Readiness = "blocked" | "walkable" | "budgetable";

export interface GroupReadiness {
  level: Readiness;
  /** Issue ids that keep the group below walkable. */
  walk: string[];
  /** Issue ids that keep a walkable group below budgetable. */
  budget: string[];
}

/** The staged value at a key; proposals never count until a person stages them. */
const staged = (doc: DuctsRouteDocument | null, key: string): DuctAssumption | undefined =>
  doc?.assumptions[key]?.staged?.value;

export function readiness(
  snapshot: DuctSnapshot,
  doc: DuctsRouteDocument | null,
): Record<string, GroupReadiness> {
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const segments = new Map(snapshot.segments.map((segment) => [segment.id, segment]));
  const verdict = (issue: DuctIssue) => {
    const value = staged(doc, issue.id);
    return value?.kind === "verdict" ? value.verdict : null;
  };
  const override = (
    kind: Parameters<typeof ductOverrideKey>[0],
    subject: string | number | null | undefined,
  ) => subject != null && staged(doc, ductOverrideKey(kind, subject)) !== undefined;

  const walkBlocks = (issue: DuctIssue) => {
    switch (issue.kind) {
      case "no-root":
      case "multi-root":
      case "loop":
        return true;
      case "open-end":
        return verdict(issue) !== "capped" && verdict(issue) !== "ignore";
      case "no-terminal-flow":
        return verdict(issue) !== "ignore";
      default:
        return false;
    }
  };
  const budgetBlocks = (issue: DuctIssue) => {
    const element = issue.elementId ?? null;
    switch (issue.kind) {
      case "no-fan-static":
        return !override("fan-static", element);
      case "no-component-drop":
        return !override("component-drop", element === null ? null : nodes.get(element)?.family);
      case "default-flex-roughness":
        return (
          verdict(issue) !== "ignore" &&
          !override("flex-roughness", element === null ? null : segments.get(element)?.type)
        );
      default:
        return false;
    }
  };

  return Object.fromEntries(
    snapshot.groups.map((group) => {
      const own = group.issueIds.flatMap((id) => issues.get(id) ?? []);
      const walk = own.filter(walkBlocks).map((issue) => issue.id);
      const budget = own.filter(budgetBlocks).map((issue) => issue.id);
      const level: Readiness = walk.length ? "blocked" : budget.length ? "walkable" : "budgetable";
      return [group.id, { level, walk, budget }];
    }),
  );
}
