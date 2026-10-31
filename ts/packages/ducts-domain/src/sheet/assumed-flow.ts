import type { FanPort } from "../roster.ts";
import type { SheetSnapshot } from "./build.ts";
import {
  foreignOwners,
  graphOf,
  isSegment,
  terminateMerges,
  walkFrom,
  type Graph,
  type WalkOptions,
} from "./walk.ts";

export interface AssumedFlow {
  cfm: number;
  source: string;
}
const cache = new WeakMap<SheetSnapshot, Map<string, Map<string, AssumedFlow>>>();

const designed = (unit: Graph["all"][number]) =>
  !isSegment(unit) && unit.facts.some((f) => f.key === "fanFlow" && f.value != null && f.value > 0);

/**
 * No equipment crossing: each roster fan is surveyed at its own paired ports, each side bounded
 * by the sheet's own walk rules (R-A owners, merges cut by `terminateMerges`, roster-fan stops), so
 * a fan is credited only with the terminals its own walk reaches, never every terminal on a
 * shared connected network (Chadds FC-23, RV-25 and RV-7 each read 1355 cfm before, 2026-10-28).
 * An ERV is credited only with terminals on its own discharge side; with none it is unknown
 * (0, with a line), never another fan's sum and never its Revit connector flow.
 */
export function assumedFanFlows(
  snapshot: SheetSnapshot,
  roster: readonly FanPort[],
  /** A terminal's resolved design flow (`inputs.terminals`). */
  terminalCfm: (elementId: number) => number | null,
  /** A digest of the resolved terminal flows, so one snapshot caches per inputs variant. */
  cfmKey: string,
  options: Omit<WalkOptions, "roster" | "owners">,
): Map<string, AssumedFlow> {
  const key = JSON.stringify([
    cfmKey,
    roster.map((p) => [p.unitId, p.portIndex, p.inletPortIndex, p.kind]),
    options,
  ]);
  let variants = cache.get(snapshot);
  if (!variants) {
    variants = new Map();
    cache.set(snapshot, variants);
  }
  const saved = variants.get(key);
  if (saved) return saved;
  const g = graphOf(snapshot);
  const owners = new Map<number, ReturnType<typeof foreignOwners>>();
  const direct = new Map<string, Map<number, number>>();
  const receiving = new Map<string, Set<string>>();
  const bySide = new Map<
    string,
    {
      unitId: number;
      ref: string;
      erv: boolean;
      terminals: Map<number, number>;
      receiving: Set<string>;
    }
  >();
  const result = new Map<string, AssumedFlow>();
  const unknownErv = (ref: string) => ({
    cfm: 0,
    source: `unknown (0 assumed): ERV ${ref}'s discharge reaches no terminal it supplies; type the unit design flow`,
  });
  for (const fan of roster) {
    const unit = g.byId.get(fan.unitId);
    if (!unit) continue;
    if (!owners.has(unit.id)) owners.set(unit.id, foreignOwners(g, roster, unit));
    const erv = fan.kind === "erv";
    const ref = `${fan.unitId}:${fan.portIndex}`;
    const sides = [fan.portIndex, fan.inletPortIndex].filter((p): p is number => p != null);
    const terminalSides: Map<number, number>[] = [];
    const others = new Set<string>();
    for (const connector of new Set(sides)) {
      const w = walkFrom(g, unit, connector, { ...options, roster, owners: owners.get(unit.id) });
      // R-SIB needs no pass here: the walk already stops at every roster fan, so a sibling end
      // never credits a terminal, and the borrow below keeps its own intake-direction gate.
      terminateMerges(w);
      const terminals = new Map<number, number>();
      const sideReceiving = new Set<string>();
      for (const e of w.ends) {
        const n = g.byId.get(e.end.elementId);
        if (e.end.kind === "terminal" && n && !isSegment(n)) {
          const flow = terminalCfm(n.id);
          if (flow != null && flow > 0) terminals.set(n.id, flow);
        }
        // Borrow only where this unit's discharge lands on another unit's intake (MUAS into an ERV inlet).
        // Other units on a shared trunk are co-sources or co-sinks, not receivers: Chadds' ERVs RV-11 and
        // RV-23 share an exhaust riser and an OA trunk with five more, and borrowed 3164 cfm each.
        // Port direction is family metadata (Q1: a tie-break only); it gates an assumed value, never a total.
        const reached = e.end.connector == null ? undefined : g.byId.get(e.end.elementId);
        const reachedDir =
          reached && !isSegment(reached)
            ? reached.connectors.find((c) => c.index === e.end.connector)?.direction
            : undefined;
        const ownDir = unit.connectors.find((c) => c.index === connector)?.direction;
        if (
          !erv &&
          e.end.kind === "roster-fan-port" &&
          e.end.fan &&
          e.end.fan.unitId !== fan.unitId &&
          ownDir === "out" &&
          reachedDir === "in"
        ) {
          others.add(`${e.end.fan.unitId}:${e.end.fan.portIndex}`);
          sideReceiving.add(`${e.end.fan.unitId}:${e.end.fan.portIndex}`);
        }
      }
      // An ERV supplies only what its own discharge reaches; its intake side credits nothing.
      if (!erv || connector === fan.portIndex) terminalSides.push(terminals);
      bySide.set(`port:${fan.unitId}:${connector}`, {
        unitId: fan.unitId,
        ref,
        erv,
        terminals: erv ? new Map() : terminals,
        receiving: sideReceiving,
      });
    }
    // The two sides carry the same fan flow; never sum supply and return demand twice.
    const sum = (m: Map<number, number>) => [...m.values()].reduce((a, v) => a + v, 0);
    const served = terminalSides.sort((a, b) => sum(b) - sum(a))[0] ?? new Map<number, number>();
    direct.set(ref, served);
    receiving.set(ref, others);
  }
  for (const fan of roster) {
    const ref = `${fan.unitId}:${fan.portIndex}`;
    const unit = g.byId.get(fan.unitId);
    if (!unit || designed(unit)) continue;
    const terminals = new Map(direct.get(ref));
    // Side-stream fans may serve terminals through a named receiving fan. One hop only;
    // terminals are deduplicated, and the fan-port stop rule remains intact in every walk.
    if (!terminals.size)
      for (const other of receiving.get(ref) ?? [])
        for (const [id, flow] of direct.get(other) ?? []) terminals.set(id, flow);
    const cfm = [...terminals.values()].reduce((a, v) => a + v, 0);
    const connectorFlow = unit.connectors
      .filter((c) => c.index === fan.portIndex || c.index === fan.inletPortIndex)
      .reduce((max, c) => Math.max(max, c.flowCfm ?? 0), 0);
    if (cfm > 0)
      result.set(ref, {
        cfm,
        source: `derived from served terminals (assumed); ${terminals.size} covered terminals${direct.get(ref)?.size ? "" : "; via receiving fan"}`,
      });
    else if (fan.kind === "erv") result.set(ref, unknownErv(ref));
    else if (connectorFlow > 0)
      result.set(ref, {
        cfm: connectorFlow,
        source: "unit connector flowCfm (assumed); served terminal sum unavailable",
      });
  }
  for (const [key, side] of bySide) {
    const unit = g.byId.get(side.unitId)!;
    if (designed(unit)) continue;
    // A side with no terminals carries its paired side's flow: one stream passes through the fan.
    // Only a fan with no terminals on either side (MUAS feeding ERVs) borrows the receiving fans' flow;
    // borrowing per side pushed a big ERV's 3164 cfm through RV-11's 4 in discharge (569 implausible).
    const paired = side.terminals.size
      ? side.terminals
      : (direct.get(side.ref) ?? new Map<number, number>());
    const terminals = new Map(paired);
    if (!terminals.size)
      for (const other of side.receiving)
        for (const [id, flow] of direct.get(other) ?? []) terminals.set(id, flow);
    const cfm = [...terminals.values()].reduce((a, v) => a + v, 0);
    const connectorFlow = unit.connectors.reduce((max, c) => Math.max(max, c.flowCfm ?? 0), 0);
    if (cfm > 0)
      result.set(key, {
        cfm,
        source: `derived from served terminals (assumed); side ${key}, ${terminals.size} covered terminals${side.terminals.size ? "" : paired.size ? "; via paired side" : "; via receiving fan"}`,
      });
    else if (side.erv) result.set(key, unknownErv(side.ref));
    else if (connectorFlow > 0)
      result.set(key, {
        cfm: connectorFlow,
        source: "unit connector flowCfm (assumed); served terminal sum unavailable",
      });
  }
  // A snapshot is immutable for a read; bound alternative inputs/ruling combinations.
  if (variants.size >= 8) variants.delete(variants.keys().next().value!);
  variants.set(key, result);
  return result;
}
