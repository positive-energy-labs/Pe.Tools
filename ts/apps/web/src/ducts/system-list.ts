import { worstRun } from "@pe/ducts-domain/losses";
import type { Priced } from "@pe/ducts-domain/pricing";
import { systemsOf, systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { TreeNode } from "./proto/b/model";
import { splitOf } from "./loss-split";

/**
 * The system list: one childless row per Revit system (no run tree is built, so 350 systems stay
 * cheap), keyed by its name. Its total is the largest fan over the groups it is in; `fanless` when
 * none of them has an air mover.
 */
export function systemList(
  snapshot: DuctSnapshot,
  priced: Priced | null,
): (TreeNode & {
  fanless: boolean;
  blocked: boolean;
  /** The groups the system is in (its fans are theirs). */
  groups: readonly string[];
  classification: string | null;
  sub: string;
  rating: number | null;
})[] {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  return systemsOf(snapshot).map((system) => {
    const solved = system.groups.flatMap((g) => priced?.next.byGroup[g] ?? []);
    // The minibar's breakdown: the system's worst group's critical run, as its tree would split it.
    // A group with an implausible row has no price: the system reads needs a fix, never a partial number.
    const scope = systemScope(priced?.snapshot ?? snapshot, system.name);
    const blocked = solved.some((s) => s.implausible.some((id) => scope.prices.has(id)));
    const worst = priced && !blocked ? worstRun(priced.next, scope.groups, scope.terminals) : null;
    const rows = worst?.rows;
    const first = snapshot.groups.find((g) => g.id === system.groups[0]);
    const lead = worst?.unit;
    const rated =
      lead != null ? nodes.get(lead)?.facts.find((f) => f.key === "externalStatic")?.value : null;
    return {
      key: system.name,
      kind: "system",
      name: system.name,
      classification: system.classification,
      // Identity at a glance: the air (in words, never Revit's enum), what moves it, how much it feeds.
      sub: [
        system.classification?.replace(/Air$/, ""),
        `${system.terminals} terminal${system.terminals === 1 ? "" : "s"}`,
        system.units.join(", ") || "no fan",
        system.groups.length > 1 ? `${system.groups.length} networks` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      blocked,
      groups: system.groups,
      fanless: !!priced && solved.length > 0 && solved.every((s) => !s.hasAirMover),
      rating: rated ?? null,
      id: first?.rootIds[0] ?? null,
      total: worst?.total ?? null,
      self: null,
      ft: null,
      selfFt: null,
      rate: null,
      unpriced: null,
      split: rows ? splitOf(snapshot, rows, equipment) : null,
      level: null,
      scale: null,
      critical: null,
      provisional: solved.find((s) => s.provisional)?.provisional ?? null,
      terminal: null,
      children: [],
    };
  });
}
