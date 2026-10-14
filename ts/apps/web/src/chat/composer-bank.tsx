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
}: {
  currentThreadId: string;
  deletedThreadIds: ReadonlySet<string>;
  prompt?: string;
  handle: ChatHandle;
  /** The provider and document pickers, open or at rest (`ComposerPickers`). */
  pickers: (open: boolean) => ReactNode;
  /** The run's state beside them (`ComposerState`). */
  state: ReactNode;
  /** The box's top section: live asks and staged Work (`ComposerWork`). */
  work: ReactNode;
}) {
  const [visited, setVisited] = useState(() => new Set([currentThreadId]));
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
              initialDraft={initialDraft}
            />
          </Activity>
        );
      })}
    </div>
  );
}
