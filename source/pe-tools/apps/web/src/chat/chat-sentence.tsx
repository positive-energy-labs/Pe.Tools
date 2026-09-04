import type { ReactNode } from "react";

import { ScopeHead, type ScopeSessionOption } from "#/chat/scope-head";
import { useThreadScope } from "#/chat/scope";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";
import { RouteHead } from "#/targeting/head";
import { useWorkbench } from "#/workbench/provider";

export function scopeOptions(sessions: readonly SessionFacts[]): ScopeSessionOption[] {
  return sessions.flatMap((session) =>
    session.sdkSessionId
      ? [
          {
            id: session.sdkSessionId,
            label: session.sdkSessionId,
            document: documentAddress(session),
            documentLabel: session.activeDocumentTitle ?? null,
          },
        ]
      : [],
  );
}

/** The chat head: the thread name, and the ONE Scope surface beneath it. */
export function ChatSentence({
  name,
  aside,
  live,
}: {
  name: string;
  aside?: ReactNode;
  live?: boolean;
}) {
  const { revit, currentThreadId, isRunning } = useWorkbench();
  const fleet = useFleet({ enabled: revit === true });
  const scope = useThreadScope(currentThreadId, live !== false);
  return (
    <RouteHead name={name} aside={aside} instrumentLive={live}>
      <ScopeHead
        scope={scope.scope}
        revision={scope.revision}
        options={scopeOptions(fleet.sessions)}
        busy={isRunning}
        refusal={scope.refusal}
        onSet={(next) => void scope.set(next)}
      />
    </RouteHead>
  );
}
