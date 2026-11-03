import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import { deepEqual } from "@tanstack/react-router";
import type { ChatState } from "@pe/agent-contracts/chat-state";
import { useContext, useMemo } from "react";
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

export function useTranscriptAtom() {
  const atom = useContext(TranscriptContext);
  if (!atom) throw new Error("useTranscript must be used inside WorkbenchProvider.");
  return atom;
}

/** Only a changed projection notifies its consumer, even though the log refolds each chunk. */
export function useTranscript<A>(select: (chat: ChatState) => A): A {
  const source = useTranscriptAtom();
  const selected = useMemo(
    () => Atom.map(source, select).pipe(Atom.withEquality(deepEqual), Atom.autoDispose),
    [source, select],
  );
  return useAtomValue(selected);
}
