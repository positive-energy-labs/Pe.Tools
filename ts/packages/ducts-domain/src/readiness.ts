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

import { ISSUE_BLOCKS } from "./issues.ts";
import { withStoredRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

type DuctIssue = DuctSnapshot["issues"][number];
type Readiness = "blocked" | "walkable" | "budgetable";

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

interface ById {
  issues: Map<string, DuctIssue>;
  nodes: Map<number, DuctSnapshot["nodes"][number]>;
  segments: Map<number, DuctSnapshot["segments"][number]>;
}

const byIds = new WeakMap<DuctSnapshot, ById>();

/** The snapshot's issues, nodes and segments by id; built once per snapshot, shared by every view. */
export function snapshotById(snapshot: DuctSnapshot): ById {
  let index = byIds.get(snapshot);
  if (!index) {
    index = {
      issues: new Map(snapshot.issues.map((issue) => [issue.id, issue])),
      nodes: new Map(snapshot.nodes.map((node) => [node.id, node])),
      segments: new Map(snapshot.segments.map((segment) => [segment.id, segment])),
    };
    byIds.set(snapshot, index);
  }
  return index;
}

export function readiness(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
): Record<string, GroupReadiness> {
  const doc = withStoredRulings(work, snapshot.store);
  const { issues, nodes, segments } = snapshotById(snapshot);
  const verdict = (issue: DuctIssue) => {
    const value = staged(doc, issue.id);
    return value?.kind === "verdict" ? value.verdict : null;
  };
  const override = (
    kind: Parameters<typeof ductOverrideKey>[0],
    subject: string | number | null | undefined,
  ) => subject != null && staged(doc, ductOverrideKey(kind, subject)) !== undefined;

  /** Whether a staged assumption answers the issue. What an issue blocks is `ISSUE_KINDS`'. */
  const resolved = (issue: DuctIssue) => {
    const element = issue.elementId ?? null;
    switch (issue.kind) {
      case "open-end":
        return verdict(issue) === "capped" || verdict(issue) === "ignore";
      case "multi-root":
        // All but one root staged passive leaves a single air mover.
        return (
          (snapshot.groups.find((g) => g.id === issue.groupId)?.rootIds ?? []).filter(
            (id) => doc?.roles[String(id)]?.staged?.value.role !== "passive",
          ).length <= 1
        );
      case "no-terminal-flow":
        return verdict(issue) === "ignore";
      case "no-fan-static":
        return override("fan-static", element);
      case "no-component-drop":
        return override("component-drop", element === null ? null : nodes.get(element)?.family);
      case "default-flex-roughness":
        return (
          verdict(issue) === "ignore" ||
          override("flex-roughness", element === null ? null : segments.get(element)?.type)
        );
      default:
        return false;
    }
  };
  const open = (blocks: "walkable" | "budgetable") => (issue: DuctIssue) =>
    ISSUE_BLOCKS[issue.kind] === blocks && !resolved(issue);

  return Object.fromEntries(
    snapshot.groups.map((group) => {
      const own = group.issueIds.flatMap((id) => issues.get(id) ?? []);
      const walk = own.filter(open("walkable")).map((issue) => issue.id);
      const budget = own.filter(open("budgetable")).map((issue) => issue.id);
      const level: Readiness = walk.length ? "blocked" : budget.length ? "walkable" : "budgetable";
      return [group.id, { level, walk, budget }];
    }),
  );
}
