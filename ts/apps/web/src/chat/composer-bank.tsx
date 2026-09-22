import { Activity, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThreadComposer } from "./composer";
import type { ChatHandle } from "./composer-head";
import type { ChatDraft } from "#/workbench/prompt";

/** Visited composers retain React-local drafts until their thread is explicitly deleted. */
export function ComposerBank({
  currentThreadId,
  deletedThreadIds,
  prompt,
  handle,
  topBar,
}: {
  currentThreadId: string;
  deletedThreadIds: ReadonlySet<string>;
  prompt?: string;
  handle: ChatHandle;
  topBar: ReactNode;
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
          threadId === currentThreadId && prompt ? { text: prompt, attachments: [] } : undefined;
        return (
          <Activity key={threadId} mode={threadId === currentThreadId ? "visible" : "hidden"}>
            <ThreadComposer handle={handle} topBar={topBar} initialDraft={initialDraft} />
          </Activity>
        );
      })}
    </div>
  );
}
