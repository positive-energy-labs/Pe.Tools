import { createContext, useContext, type ReactNode } from "react";
import type { CellTransition } from "@pe/kit/lang/cell";
import { transitionPatches, type DuctsSheetEdits, type RouteStatePatch } from "@pe/agent-contracts";
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
export function useCellTransitions(segment: string, key: string): readonly CellTransition[] {
  const owner = useContext(DuctsOwner);
  const cell = (owner?.props.work.doc as Record<string, unknown> | null)?.[segment] as
    | Record<string, import("@pe/agent-contracts").CellLike>
    | undefined;
  if (!owner || !cell?.[key]) return [];
  return (["take", "unsuggest", "clear"] as const).map((kind) => ({
    kind,
    reason:
      kind === "take"
        ? "Take Pea's suggestion"
        : kind === "unsuggest"
          ? "Reject Pea's suggestion"
          : "Reopen this input",
    run: () => owner.write(transitionPatches([segment], key, cell[key]!, { kind })),
  }));
}
