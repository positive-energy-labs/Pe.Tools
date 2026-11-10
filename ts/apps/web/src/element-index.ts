import { createContext, useContext } from "react";
import { elementKey, elementUniqueId, type SubjectKey } from "@pe/kit/lang/attention";

/**
 * ElementId <-> UniqueId for the elements one pane shows (ADR 0035 rule 2). The attention bus
 * keys on UniqueId; an ElementId stays the renderer's and Revit select call's payload, never
 * identity, and exists only through this index (an id it does not know has no key and lights nothing).
 */
export type ElementIndex = {
  uniqueIdOf(id: number): string | null;
  keyOf(id: number): SubjectKey | null;
  /** The keys of the ids this pane knows; the rest light nothing. */
  keysOf(ids: Iterable<number>): SubjectKey[];
  /** NaN when the key is not an element this pane shows. */
  idOf(key: string): number;
};

export const elementIndex = (
  elements: Iterable<{ elementId?: number | null; id?: number; uniqueId?: string | null }>,
): ElementIndex => {
  const unique = new Map<number, string>();
  const ids = new Map<string, number>();
  for (const e of elements) {
    const id = e.elementId ?? e.id;
    if (id == null || !e.uniqueId) continue;
    unique.set(id, e.uniqueId);
    ids.set(e.uniqueId, id);
  }
  const keyOf = (id: number) => (unique.has(id) ? elementKey(unique.get(id)!) : null);
  return {
    uniqueIdOf: (id) => unique.get(id) ?? null,
    keyOf,
    keysOf: (list) => [...list].flatMap((id) => keyOf(id) ?? []),
    idOf: (key) => {
      const uid = elementUniqueId(key as SubjectKey);
      return (uid && ids.get(uid)) || NaN;
    },
  };
};

export const NO_ELEMENTS = elementIndex([]);
export const ElementIndexContext = createContext<ElementIndex>(NO_ELEMENTS);
export const useElementIndex = () => useContext(ElementIndexContext);
