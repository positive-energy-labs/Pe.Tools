import { settleWork } from "../shell/work-door-observation";
import { createContext, useContext, type ReactNode } from "react";
import type { CellTransition } from "@pe/kit/lang/cell";
import { type DuctsSheetEdits, type RouteStatePatch } from "@pe/agent-contracts";
import type {
  ReadingSnapshot,
  WorkHistoryPort,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { SceneMeshes } from "#/scene/types";
import type { ProtoProps } from "./proto/props";
import type { SheetReading } from "./neutral.ts";
import type { FanPort } from "./sheet/model";
import type { EditMeta, inputHistoryMetaSchema } from "./sheet/input-history";
import type { z } from "zod";
export const DuctsOwner = createContext<{
  props: ProtoProps;
  cells: import("./pane-view").DuctsViewContext["cells"];
  fanRoster: readonly FanPort[];
  meshes?: SceneMeshes;
  sheetRead: ReadingSnapshot<SheetReading | null>;
  fanRead: ReadingSnapshot<import("@pe/agent-contracts").DuctsRosterResponse | null>;
  history?: WorkHistoryPort<z.output<typeof inputHistoryMetaSchema>>;
  write(
    patches: RouteStatePatch[],
    history?: EditMeta,
  ): Promise<{ code: string; message: string } | null>;
  sheetEdit(
    edits: DuctsSheetEdits,
    history: EditMeta,
    basis: string | null,
  ): Promise<{ code: string; message: string } | null>;
  commands?: (row?: unknown) => ReactNode;
} | null>(null);
export function PaneCommands({ row }: { row?: unknown }) {
  return useContext(DuctsOwner)?.commands?.(row) ?? null;
}
export const commands = (row?: unknown): ReactNode => <PaneCommands row={row} />;
export function useCellTransitions(segment: keyof typeof import("./neutral").ductsData.cells, key: string): readonly CellTransition[] {
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
