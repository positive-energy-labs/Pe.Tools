import { useContext } from "react";
import type { WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
