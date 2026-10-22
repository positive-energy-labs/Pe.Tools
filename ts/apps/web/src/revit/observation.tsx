import { createContext, useContext, type ReactNode } from "react";
import type { RevitElementReference } from "@pe/kit/lang/row";
import { revitScope, type ElementTarget, type RevitObservationScope } from "./element-target";

export type NativeObservation = {
  scope: RevitObservationScope | null;
  /** When supplied, only references actually present in this displayed read may be targeted. */
  references?: readonly RevitElementReference[];
};

const Observation = createContext<NativeObservation>({ scope: null });
export const useNativeObservation = () => useContext(Observation);

export function NativeObservationScope({
  value,
  children,
}: {
  value: NativeObservation;
  children: ReactNode;
}) {
  return (
    <Observation value={value}>
      <div className="contents" {...revitScope(value.scope)}>
        {children}
      </div>
    </Observation>
  );
}

/** A missing captured member refuses; authored numbers cannot invent a native reference. */
export function observedElements(
  observation: NativeObservation,
  ids: readonly number[],
): ElementTarget {
  return observation.references
    ? {
        scope: observation.scope,
        ids: [],
        refs: ids.map(
          (id) =>
            observation.references!.find((ref) => ref.elementId === id) ?? { elementId: null },
        ),
      }
    : { scope: observation.scope, ids };
}
