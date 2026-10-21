/**
 * proto: encoding — the one encoding a group is drawn, listed and keyed in. The canvas, the tree
 * and the legend all read this object, so a number, its unit and its max element agree in all
 * three. It changes only with the key or the data: picking a key recolours and never refits.
 */
import { useMemo } from "react";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { snapshotById } from "@pe/ducts-domain/readiness";

import { elementNamer } from "../../claims";
import { encodingFor, type Encoding } from "../../encoding";
import { indexOf, sceneOf } from "../../scene";
import { flowDirections } from "./flow";

export interface GroupEncoding {
  encoding: Encoding;
  /** The one name the legend and the tree give an element: its label, else family : type, else its kind. */
  nameOf: (id: number) => string | null;
  /** Elements per bin over the whole group (the legend's counts): segments, and nodes where the encoding inks them. */
  counts: ReadonlyMap<string, number>;
}

export function useGroupEncoding(
  snapshot: DuctSnapshot | null,
  priced: Priced | null,
  /** The system's groups (stable per snapshot and system, `systemScope`). */
  groups: readonly string[],
  key: string,
): GroupEncoding {
  const facts = useMemo(
    () =>
      snapshot ? sceneOf(indexOf(snapshot, priced), groups, () => true) : { segments: [], nodes: [] },
    [snapshot, priced, groups],
  );
  const directions = useMemo(
    () =>
      snapshot && key === "flow"
        ? new Map(groups.flatMap((g) => [...flowDirections(snapshot, g)]))
        : undefined,
    [snapshot, groups, key],
  );
  const nameOf = useMemo(() => {
    if (!snapshot) return () => null;
    const { nodes } = snapshotById(snapshot);
    const fallback = elementNamer(snapshot, null);
    return (id: number) => {
      const node = nodes.get(id);
      const typed = node ? [node.family, node.type].filter(Boolean).join(" : ") : "";
      return node?.label || typed || fallback(id);
    };
  }, [snapshot]);
  return useMemo(() => {
    const encoding = encodingFor(key, facts, directions);
    const counts = new Map<string, number>();
    for (const f of [...facts.segments, ...(encoding.nodes ? facts.nodes : [])]) {
      const bin = encoding.bin(f);
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
    return { encoding, counts, nameOf };
  }, [key, facts, directions, nameOf]);
}
