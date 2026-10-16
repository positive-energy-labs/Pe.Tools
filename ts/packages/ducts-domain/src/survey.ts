/**
 * What the route runs before any tree or loss (pressure-drop ledger, 2026-10-16): the snapshot
 * tolerated (`proximity.ts`), every terminal's design flow resolved (`terminal-flows.ts`), and
 * the findings of both beside the snapshot's own issues, each naming who clears it. Cached per
 * snapshot for the last Work, so `price` and `assessDucts` share one survey; the tolerated
 * snapshot is cached per ignore set, so a staged number re-solves only `next`.
 */
import { stagedDucts, type DuctFinding, type DuctsRouteDocument } from "@pe/agent-contracts";

import { tolerate } from "./proximity.ts";
import { terminalFlows, type FlowFinding, type TerminalFlow } from "./terminal-flows.ts";
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

export interface Survey {
  snapshot: DuctSnapshot;
  flows: Map<number, TerminalFlow>;
  findings: DuctFinding[];
}

const PERSON = new Set(["open-end", "no-root", "multi-root", "no-terminal-flow"]);

const flowFinding = (f: FlowFinding): DuctFinding => {
  switch (f.kind) {
    case "tag-without-mark":
      return {
        id: `flow:tag:${f.tag}`,
        kind: f.kind,
        elementIds: [],
        note: `load preview "${f.system}" is tagged ${f.tag}; no equipment carries that Mark`,
        assumed: null,
        clearer: "person",
      };
    case "mark-without-system":
      return {
        id: `flow:mark:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `equipment ${f.equipment} is marked ${f.mark}; the load preview has no system tagged ${f.mark}`,
        assumed: null,
        clearer: "person",
      };
    case "no-terminals":
      return {
        id: `flow:no-terminals:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `${f.mark} (${f.equipment}) roots no tree with a terminal; its load has nowhere to go`,
        assumed: null,
        clearer: "person",
      };
    case "no-mark":
      return {
        id: `flow:no-mark:${f.equipment}`,
        kind: f.kind,
        elementIds: [f.equipment],
        note: `${f.label} (${f.equipment}) feeds terminals but carries no Mark; no load preview system can match it`,
        assumed: null,
        clearer: "person",
      };
    case "no-flow":
      return {
        id: `flow:no-flow:${f.terminal}`,
        kind: f.kind,
        elementIds: [f.terminal],
        note: `terminal ${f.terminal} has no design flow: no override, no load preview share, no positive Revit flow`,
        assumed: null,
        clearer: "pea",
      };
  }
};

const ignoreKey = (work: DuctsRouteDocument | null) =>
  Object.entries(work?.assumptions ?? {})
    .filter(([key, cell]) => {
      const v = cell.staged?.value;
      return key.startsWith("proximity:") && v?.kind === "verdict" && v.verdict === "ignore";
    })
    .map(([key]) => key)
    .sort()
    .join("|");

const tolerated = new WeakMap<DuctSnapshot, Map<string, ReturnType<typeof tolerate>>>();
const last = new WeakMap<DuctSnapshot, { work: DuctsRouteDocument | null; survey: Survey }>();

export function survey(snapshot: DuctSnapshot, work: DuctsRouteDocument | null): Survey {
  const hit = last.get(snapshot);
  if (hit && hit.work === work) return hit.survey;
  const byIgnore = tolerated.get(snapshot) ?? tolerated.set(snapshot, new Map()).get(snapshot)!;
  const key = ignoreKey(work);
  const t = byIgnore.get(key) ?? byIgnore.set(key, tolerate(snapshot, work)).get(key)!;
  const trees = t.snapshot.groups.map((g) => groupTree(t.snapshot, g.id));
  const staged = stagedDucts(work);
  const flows = terminalFlows(t.snapshot, staged.loads.preview, staged.flows, trees);
  const findings: DuctFinding[] = [
    ...t.findings.map((f) => ({
      ...f,
      assumed: f.kind === "loop-by-inference" ? null : f.note,
      clearer: f.kind === "loop-by-inference" ? ("person" as const) : ("pea" as const),
    })),
    ...flows.findings.map(flowFinding),
    ...t.snapshot.issues.map((i) => ({
      id: i.id,
      kind: i.kind,
      elementIds: i.elementId == null ? [] : [i.elementId],
      // Fan static is the route's output, not an input a person owes.
      note:
        i.kind === "no-fan-static"
          ? `${i.note}; computed by the route when the path prices`
          : i.note,
      assumed: null,
      clearer: PERSON.has(i.kind) ? ("person" as const) : ("route" as const),
    })),
  ];
  const result = { snapshot: t.snapshot, flows: flows.flows, findings };
  last.set(snapshot, { work, survey: result });
  return result;
}
