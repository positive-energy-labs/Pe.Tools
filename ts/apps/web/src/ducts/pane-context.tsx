import { settleWork } from "../shell/work-door-observation";
import { createContext, useContext, type ReactNode } from "react";
import type { CellTransition } from "@pe/kit/lang/cell";
import type { SceneMeshes } from "#/scene/types";
import type { FanPort } from "./sheet/model";
export const DuctsOwner = createContext<{
  selected: string;
  select(selected: string): void;
  cells: import("../../../../packages/agent-contracts/src/route-kernel-bodies").PaneContext<
    typeof import("./neutral").ductsData,
    typeof import("./neutral").schemas,
    typeof import("./neutral").entries,
    keyof typeof import("./neutral").ductsData.panes
  >["cells"];
  fanRoster: readonly FanPort[];
  meshes?: SceneMeshes;
  commands?: (row?: unknown) => ReactNode;
} | null>(null);
export function PaneCommands({ row }: { row?: unknown }) {
  return useContext(DuctsOwner)?.commands?.(row) ?? null;
}
export const commands = (row?: unknown): ReactNode => <PaneCommands row={row} />;
export function useCellTransitions(
  segment: keyof typeof import("./neutral").ductsData.cells,
  key: string,
): readonly CellTransition[] {
  const owner = useContext(DuctsOwner);
  if (!owner) return [];
  return (["take", "unsuggest", "clear"] as const).map((kind) => ({
    kind,
    run: async () => {
      const result = await settleWork(owner.cells[kind](segment, key));
      return result.kind === "refused" ? { code: "refused", message: result.refusal.error } : null;
    },
  }));
}
