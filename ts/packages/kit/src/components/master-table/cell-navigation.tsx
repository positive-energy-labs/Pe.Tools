import { createContext, useContext, type ReactNode } from "react";

export type CellMove = "up" | "down" | "left" | "right";
export type MoveCell = (direction: CellMove) => boolean;

const CellNavigationContext = createContext<MoveCell | null>(null);

export function CellNavigationProvider({
  move,
  children,
}: {
  move: MoveCell;
  children: ReactNode;
}) {
  return <CellNavigationContext.Provider value={move}>{children}</CellNavigationContext.Provider>;
}

export function useCellNavigation(): MoveCell | null {
  return useContext(CellNavigationContext);
}
