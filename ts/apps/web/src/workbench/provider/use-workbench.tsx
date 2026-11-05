import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import { deepEqual } from "@tanstack/react-router";
import type { ChatState } from "@pe/agent-contracts/chat-state";
import { useContext, useMemo, useRef } from "react";
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
  const value = useAtomValue(selected);
  // Inline selectors replace the atom on local renders too. Preserve the projection's identity
  // across those atoms, or an effect consuming it can write a snapshot and render forever.
  const previous = useRef<{ value: A } | undefined>(undefined);
  if (previous.current && deepEqual(previous.current.value, value)) return previous.current.value;
  previous.current = { value };
  return value;
}
