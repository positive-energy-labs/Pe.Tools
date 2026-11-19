import { calcsIn, reaches, runsOf, worstRun, type Calc } from "@pe/ducts-domain/calc-runs";
import { systemsOf, systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { splitOf } from "./loss-split.ts";
import { markOf } from "@pe/ducts-domain/terminal-flows";

/**
 * The system list: one childless row per Revit system (no run tree is built, so 350 systems stay
 * cheap), keyed by its name. Its total is the worst run to one of its terminals on any fan's calc (a
 * path's loss, never a fan pressure), and only when every one of its paths is whole: one unknown path
 * makes the system unpriced, never priced at its worst known run. `fanless` when no calc reaches it.
 */
export function systemList(snapshot: DuctSnapshot, calcs: readonly Calc[] | null): import("@pe/duct-systems-contract/ducts-read").DuctsPricingData["analysis"]["systems"] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const systems = systemsOf(snapshot);
  // The metadata roster has no network groups. Keep those systems navigable before pricing.
  for (const system of snapshot.systems ?? []) {
    if (systems.some((row) => row.name === system.name)) continue;
    const unit = system.baseEquipmentId == null ? null : nodes.get(system.baseEquipmentId);
    const name = markOf(unit) ?? unit?.family;
    systems.push({
      name: system.name,
      classification: system.classification,
      groups: [],
      units: name ? [name] : [],
      terminals: snapshot.nodes.filter(
        (node) => node.kind === "terminal" && node.systemName === system.name,
      ).length,
    });
  }
  return systems.map((system) => {
    // The minibar's breakdown: the system's worst run, as its tree would split it.
    const scope = systemScope(snapshot, system.name);
    const reached = calcs ? calcsIn(calcs, scope.prices) : [];
    const worst = calcs ? worstRun(calcs, scope.terminals) : null;
    // An implausible loss on one of the system's own elements holds its price: needs a fix, never a partial number.
    const blocked = reached.some((calc) =>
      calc.blockers.some((b) => b.kind === "implausible-loss" && scope.prices.has(b.elementId)),
    );
    // Unknown stays unknown: a path of this system with no whole loss may be the worst one, and so
    // may the path to a grille no fan's calc reaches at all (P-074).
    const runs = calcs ? runsOf(calcs) : [];
    const ended = new Set(runs.map((run) => run.terminal));
    const unknown =
      runs.some((run) => run.total == null && reaches(run, scope)) ||
      [...scope.terminals].some((terminal) => !ended.has(terminal));
    const rows = blocked || unknown ? undefined : worst?.rows;
    const first = snapshot.groups.find((g) => g.id === system.groups[0]);
    const lead = worst?.unit;
    const rated =
      lead != null ? nodes.get(lead)?.facts.find((f) => f.key === "externalStatic")?.value : null;
    return {
      key: system.name,
      kind: "system" as const,
      name: system.name,
      classification: system.classification,
      // Identity at a glance: the air (in words, never Revit's enum), what moves it, how much it feeds.
      sub: [
        system.classification?.replace(/Air$/, ""),
        `${system.terminals} terminal${system.terminals === 1 ? "" : "s"}`,
        // "no fan" is a finding: only a walk (the system is in a network group) can make it. A
        // roster-only row has not looked yet, and pending is not failure.
        system.units.join(", ") || (system.groups.length ? "no fan" : "fan not read yet"),
        system.groups.length > 1 ? `${system.groups.length} networks` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      blocked,
      groups: system.groups,
      fanless: !!calcs && system.groups.length > 0 && !reached.length,
      rating: rated ?? null,
      id: first?.rootIds[0] ?? null,
      total: rows && worst ? worst.total : null,
      self: null,
      ft: null,
      selfFt: null,
      rate: null,
      unpriced: null,
      split: rows ? splitOf(snapshot, rows, equipment) : null,
      level: null,
      scale: null,
      critical: null,
      provisional: null,
      terminal: null,
      children: [],
    };
  });
}

