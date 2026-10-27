import { Activity, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThreadComposer } from "./composer";
import type { ChatHandle } from "./composer-head";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "#/workbench/prompt";

/** Visited composers retain React-local drafts until their thread is explicitly deleted. */
export function ComposerBank({
  currentThreadId,
  deletedThreadIds,
  prompt,
  handle,
  pickers,
  state,
  work,
  refusal,
}: {
  currentThreadId: string;
  deletedThreadIds: ReadonlySet<string>;
  prompt?: string;
  handle: ChatHandle;
  /** The provider and document pickers (`ComposerPickers`). */
  pickers: ReactNode;
  /** The run's state beside them (`ComposerState`). */
  state: ReactNode;
  /** The box's top section: live asks and edit Work (`ComposerWork`). */
  work: ReactNode;
  refusal?: string | null;
}) {
  const [visited, setVisited] = useState(() => new Set([currentThreadId]));
  // N1: focus moves on page arrival and on the person's own moves (New thread), not on a switch.
  const [arrival] = useState(currentThreadId);
  useEffect(() => {
    setVisited((previous) => {
      const next = new Set(
        [...previous, currentThreadId].filter((id) => !deletedThreadIds.has(id)),
      );
      return next.size === previous.size && [...next].every((id) => previous.has(id))
        ? previous
        : next;
    });
  }, [currentThreadId, deletedThreadIds]);
  const composerIds = useMemo(
    () => [...new Set([...visited, currentThreadId])],
    [visited, currentThreadId],
  );
  return (
    <div className="pointer-events-auto">
      {composerIds.map((threadId) => {
        const initialDraft: ChatDraft | undefined =
          threadId === currentThreadId && prompt
            ? { ...EMPTY_CHAT_DRAFT, text: prompt }
            : undefined;
        return (
          <Activity key={threadId} mode={threadId === currentThreadId ? "visible" : "hidden"}>
            <ThreadComposer
              handle={handle}
              pickers={pickers}
              state={state}
              work={work}
              refusal={refusal}
              initialDraft={initialDraft}
              autoFocus={threadId === arrival}
            />
          </Activity>
        );
      })}
    </div>
  );
}
