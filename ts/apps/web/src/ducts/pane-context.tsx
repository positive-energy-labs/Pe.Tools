import { createContext, useContext, type ReactNode } from "react";
import type { SceneMeshes } from "#/scene/types";
import type { FanPort } from "./sheet/model";
export const DuctsOwner = createContext<{
  selected: string;
  select(selected: string): void;
  cells: import("./route.ts").DuctsDrawContext["cells"];
  fanRoster: readonly FanPort[];
  meshes?: SceneMeshes;
  commands?: (row?: unknown) => ReactNode;
} | null>(null);
export function PaneCommands({ row }: { row?: unknown }) {
  return useContext(DuctsOwner)?.commands?.(row) ?? null;
}
export const commands = (row?: unknown): ReactNode => <PaneCommands row={row} />;
