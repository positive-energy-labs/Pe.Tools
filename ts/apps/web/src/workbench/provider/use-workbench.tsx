import { useContext } from "react";
import type { WorkbenchContextValue } from "./thread-summary";
import { TranscriptContext, WorkbenchContext } from "./thread-summary";

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function useTranscript() {
  const chat = useContext(TranscriptContext);
  if (!chat) throw new Error("useTranscript must be used inside WorkbenchProvider.");
  return chat;
}
