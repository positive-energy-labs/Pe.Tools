/**
 * Navigate the read snapshot without reading it again: an element id, a unit's tag or label
 * (`DuctNode.label`, its mark, e.g. FC-17) or a system name resolves to the page's
 * `{ system, selected }`. The snapshot read keys on `epoch`; this never touches it.
 */
import { markOf } from "@pe/ducts-domain/terminal-flows";
import { NO_SYSTEM, systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

type Snapshot = Pick<DuctSnapshot, "groups" | "nodes" | "segments"> &
  Partial<Pick<DuctSnapshot, "systems">>;

export type Navigation =
  | { system: string; selected: string; says: string }
  | { system: null; says: string };

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

/**
 * The page a query names, and in words where it went; unknown input says so. `named` is the names
 * the screen itself shows (its grille labels), matched like a label.
 */
export function navigate(
  snapshot: Snapshot,
  query: string,
  named: ReadonlyMap<number, string> = new Map(),
): Navigation {
  const q = query.trim();
  const miss = { system: null, says: `${q || "nothing"}: not in this snapshot` } as const;
  if (!q) return miss;
  const system = systemsOf(snapshot).find((s) => same(s.name, q));
  if (system) return { system: system.name, selected: "", says: system.name };
  const element = /^\d+$/.test(q)
    ? [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === Number(q))
    : snapshot.nodes.find((n) =>
        [n.label, markOf(n), named.get(n.id)].some((name) => name && same(name, q)),
      );
  if (!element) return miss;
  // Its own system, else the systems of the network it is in: the first, and the rest said.
  const systems = element.systemName
    ? [element.systemName]
    : (snapshot.groups.find((g) => g.id === element.groupId)?.systemNames ?? []);
  const into = systems[0] ?? NO_SYSTEM;
  const rest = systems.slice(1);
  return {
    system: into,
    selected: String(element.id),
    says: `${element.id} in ${into}${rest.length ? ` (also in ${rest.join(", ")})` : ""}`,
  };
}
