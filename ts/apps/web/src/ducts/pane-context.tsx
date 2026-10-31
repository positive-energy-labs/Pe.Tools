import { createContext, useContext, type ReactNode } from "react";
import type { CellTransition } from "@pe/kit/lang/cell";
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { MountBody, GraphMount } from "#/shell/mount";
import type { DuctsPage } from "./graph";

export const PaneBody = createContext<MountBody<DuctsPage, DuctsRouteDocument> | null>(null);
export const DuctsOwner = createContext<GraphMount<DuctsPage, DuctsRouteDocument> | null>(null);
export function PaneCommands({ row }: { row?: unknown }) {
  return useContext(PaneBody)?.verbs(row) ?? null;
}
export const commands = (row?: unknown): ReactNode => <PaneCommands row={row} />;

/** StateCell's small lifecycle controls invoke the same kernel declarations as a row placement. */
export function useCellTransitions(segment: string, key: string): readonly CellTransition[] {
  const owner = useContext(DuctsOwner);
  if (!owner) return [];
  return (
    [
      ["take", "take"],
      ["reject", "unsuggest"],
      ["reopen", "clear"],
    ] as const
  ).flatMap(([verb, kind]) => {
    const control = owner.control(`cell:${segment}.${verb}`, { segment, key });
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
}
