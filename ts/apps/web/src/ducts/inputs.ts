import { groupTree, type GroupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

type FanOut = { grilles: number; systems: number };

// Captured topology and rule maps are immutable; a refresh or new pricing supplies new identities.
const fanOutCache = new WeakMap<
  DuctSnapshot,
  { groupOf: Map<number, string>; rules: WeakMap<ReadonlyMap<number, string>, Map<string, FanOut>> }
>();

/**
 * What editing a rule's table would move, before the edit is made: the instances the rule prices (from
 * the priced rows, `ruleOf`), the systems they sit in, and every terminal downstream of any one of
 * them, since each of those grilles' paths carries the fitting.
 */
export function ruleFanOut(
  snapshot: DuctSnapshot,
  ruleOf: ReadonlyMap<number, string>,
  ruleKey: string,
  /** Group trees already built, shared across rules so a pane of rules builds each once. */
  trees: Map<string, GroupTree> = new Map(),
): FanOut {
  let cache = fanOutCache.get(snapshot);
  if (!cache) {
    const groupOf = new Map<number, string>();
    for (const n of snapshot.nodes) if (n.groupId) groupOf.set(n.id, n.groupId);
    for (const s of snapshot.segments) if (s.groupId) groupOf.set(s.id, s.groupId);
    cache = { groupOf, rules: new WeakMap() };
    fanOutCache.set(snapshot, cache);
  }
  let fanOuts = cache.rules.get(ruleOf);
  if (!fanOuts) cache.rules.set(ruleOf, (fanOuts = new Map()));
  const cached = fanOuts.get(ruleKey);
  if (cached) return cached;
  const { groupOf } = cache;
  const instances = [...ruleOf].filter(([, key]) => key === ruleKey).map(([id]) => id);
  const systems = new Set<string>();
  const grilles = new Set<number>();
  for (const id of instances) {
    const group = groupOf.get(id);
    if (!group) continue;
    systems.add(group);
    const tree = trees.get(group) ?? trees.set(group, groupTree(snapshot, group)).get(group)!;
    const stack = [id];
    const seen = new Set<number>();
    while (stack.length) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      if (tree.parts.get(at)?.node?.kind === "terminal") grilles.add(at);
      stack.push(...(tree.children.get(at) ?? []));
    }
  }
  const fanOut = { grilles: grilles.size, systems: systems.size };
  fanOuts.set(ruleKey, fanOut);
  return fanOut;
}

/** The fan-out as the chip says it. */
export const clearWords = ({ grilles, systems }: { grilles: number; systems: number }) =>
  `moves ${grilles} grille${grilles === 1 ? "" : "s"} in ${systems} system${systems === 1 ? "" : "s"}`;
