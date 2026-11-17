/** Branches in a system's pricing scope that carry no positive-flow fan-to-terminal run. */
import type { CalcRun } from "./calc-runs.ts";
import type { SystemScope } from "./system-scope.ts";
import { terminalCfm } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";
import { elementLabeler } from "./element-label.ts";

import type { NoRunBranch } from "./no-run-types.ts";
export type { NoRunBranch, NoRunReason } from "./no-run-types.ts";

/**
 * Uses the fan calcs' actual paths, every fan's. An unpriced leg does not erase a run; a flowless
 * or foreign terminal does. The flows must be the survey's, so edit flow is respected.
 */
export function noRunBranches(
  snapshot: DuctSnapshot,
  runs: readonly CalcRun[],
  scope: SystemScope,
  flows: ReadonlyMap<number, { cfm: number | null }> | Readonly<Record<number,{cfm:number|null}>>,
): Map<number, NoRunBranch> {
  const elements = new Map([...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]));
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const name = elementLabeler(snapshot);
  const flow = (id: number) =>
    (flows instanceof Map ? (flows.has(id)?flows.get(id)!.cfm:terminalCfm(nodes.get(id))) : Object.hasOwn(flows,id)?(flows as Readonly<Record<number,{cfm:number|null}>>)[id]!.cfm:terminalCfm(nodes.get(id))) ?? 0;
  const inRun = new Set<number>();
  for (const run of runs)
    if (run.terminal != null && scope.terminals.has(run.terminal) && flow(run.terminal) > 0)
      for (const id of run.path) inRun.add(id);

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
            text: `Ends at ${name(id)} on ${e.systemName || "no system"}`,
          });
        else if (flow(id) <= 0)
          branch.reasons.push({
            kind: "flowless-terminal",
            at: id,
            text: `Ends at ${name(id)} with no design flow`,
          });
      } else if (e.kind === "cap")
        branch.reasons.push({ kind: "capped", at: id, text: `Ends capped at ${name(id)}` });
      else
        for (const c of e.connectors)
          if (!c.connectedTo && c.kind !== "curve")
            branch.reasons.push({ kind: "open", at: id, text: `Ends open at ${name(id)}`, connector: c.index });
    }
    if (!branch.reasons.length)
      branch.reasons.push({
        kind: "no-fan-path",
        at: start,
        text: "No fan-to-terminal run reaches this branch",
      });
  }
  return out;
}
