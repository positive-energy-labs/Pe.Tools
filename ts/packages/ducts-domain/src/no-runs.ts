/** Branches in a system's pricing scope that carry no positive-flow fan-to-terminal run. */
import type { LossResult } from "./losses.ts";
import type { SystemScope } from "./system-scope.ts";
import { terminalCfm } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

export interface NoRunReason {
  kind:
    | "open"
    | "capped"
    | "flowless-terminal"
    | "foreign-terminal"
    | "classification-stop"
    | "no-fan-path";
  at: number;
  text: string;
}
export interface NoRunBranch {
  elements: number[];
  reasons: NoRunReason[];
}

/**
 * Uses the solve's actual paths, including smaller fans' stretches. A missing pressure lookup
 * does not erase a run; a flowless or foreign terminal and a classification stop do.
 * The snapshot and flows must be the survey used by this solve, so edit flow is respected.
 */
export function noRunBranches(
  snapshot: DuctSnapshot,
  solved: Pick<LossResult, "paths" | "byGroup" | "crossClass">,
  scope: SystemScope,
  flows: ReadonlyMap<number, { cfm: number | null }>,
): Map<number, NoRunBranch> {
  const elements = new Map([...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]));
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const flow = (id: number) =>
    (flows.has(id) ? flows.get(id)!.cfm : terminalCfm(nodes.get(id))) ?? 0;
  const stops = new Set(solved.crossClass.map((c) => `${c.id}:${c.from}`));
  const valid = (terminal: number, path: readonly number[]) =>
    scope.terminals.has(terminal) &&
    flow(terminal) > 0 &&
    !path.some(
      (id, i) => i > 0 && (stops.has(`${path[i - 1]}:${id}`) || stops.has(`${id}:${path[i - 1]}`)),
    );
  const inRun = new Set<number>();
  for (const [terminal, run] of Object.entries(solved.paths))
    if (valid(Number(terminal), run.path)) for (const id of run.path) inRun.add(id);
  for (const group of Object.values(solved.byGroup))
    for (const fan of group.fans)
      if (fan.critical != null && valid(fan.critical, fan.path))
        for (const id of fan.path) inRun.add(id);

  const remaining = new Set(
    [...scope.prices].filter((id) => {
      const e = elements.get(id);
      return e && !scope.units.has(id) && !inRun.has(id);
    }),
  );
  const adjacent = new Map<number, Set<number>>();
  const attach = (a: number, b: number) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    adjacent.get(a)!.add(b);
  };
  for (const e of elements.values())
    for (const c of e.connectors)
      if (c.connectedTo) {
        attach(e.id, c.connectedTo.elementId);
        attach(c.connectedTo.elementId, e.id);
      }
  const out = new Map<number, NoRunBranch>();
  for (const start of remaining) {
    if (out.has(start)) continue;
    const branch: NoRunBranch = { elements: [], reasons: [] };
    const queue = [start];
    out.set(start, branch);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      branch.elements.push(id);
      for (const to of adjacent.get(id) ?? [])
        if (remaining.has(to) && !out.has(to)) {
          out.set(to, branch);
          queue.push(to);
        }
    }
    branch.elements.sort((a, b) => a - b);
    const inspect = new Set(branch.elements);
    // A foreign terminal can be just outside the pricing scope at the end of this branch.
    for (const id of branch.elements)
      for (const to of adjacent.get(id) ?? [])
        if (elements.get(to)?.kind === "terminal") inspect.add(to);
    for (const id of inspect) {
      const e = elements.get(id)!;
      if (e.kind === "terminal") {
        if (!scope.terminals.has(id))
          branch.reasons.push({
            kind: "foreign-terminal",
            at: id,
            text: `Ends at terminal ${id} on ${e.systemName || "no system"}`,
          });
        else if (flow(id) <= 0)
          branch.reasons.push({
            kind: "flowless-terminal",
            at: id,
            text: `Ends at terminal ${id} with no design flow`,
          });
      } else if (e.kind === "cap")
        branch.reasons.push({ kind: "capped", at: id, text: `Ends capped at ${id}` });
      else
        for (const c of e.connectors)
          if (!c.connectedTo && c.kind !== "curve")
            branch.reasons.push({ kind: "open", at: id, text: `Ends open at ${id}:${c.index}` });
    }
    for (const c of solved.crossClass)
      if (branch.elements.includes(c.id) || branch.elements.includes(c.from))
        branch.reasons.push({
          kind: "classification-stop",
          at: c.id,
          text: `Flow stops at ${c.from} → ${c.id}: ${c.fromClassification} meets ${c.classification}`,
        });
    if (!branch.reasons.length)
      branch.reasons.push({
        kind: "no-fan-path",
        at: start,
        text: "No fan-to-terminal run reaches this branch",
      });
  }
  return out;
}
