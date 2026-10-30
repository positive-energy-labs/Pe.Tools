import { createContext, useContext } from "react";
import type { CellTransition } from "@pe/kit/lang/cell";
import type { ScheduleGridDocument } from "@pe/agent-contracts";
import type { GraphMount } from "#/shell/mount";
import type { SchedulesPage } from "./graph";

export type SchedulesMount = GraphMount<SchedulesPage, ScheduleGridDocument>;
export const SchedulesOwner = createContext<SchedulesMount | null>(null);

/** The grid's lifecycle controls are placements of the graph's kernel-owned cell verbs. */
export function useScheduleTransitions() {
  const owner = useContext(SchedulesOwner);
  return (key: string): CellTransition[] | undefined => {
    if (!owner) return undefined;
    const revision = owner.snapshot().work?.handle.revision ?? -1;
    if (owner.control("edit", { patches: [], expectedRevision: revision }).refusal) return [];
    return (
      [
        ["take", "take"],
        ["reject", "unsuggest"],
        ["reopen", "clear"],
      ] as const
    ).flatMap(([verb, kind]) => {
      const control = owner.control(`cell:cells.${verb}`, { segment: "cells", key });
      return control.refusal
        ? []
        : [
            {
              kind,
              reason: control.label,
              run: async () => {
                const result = await control.run();
                return "refusal" in result ? result.refusal : null;
              },
            },
          ];
    });
  };
}
