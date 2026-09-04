import type { ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { address, emptyScope, type Scope } from "@pe/agent-contracts";

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
  const fixture = useSearch({
    strict: false,
    select: (search) => (search as { scope?: FixtureScope }).scope,
  });
  const shown = live === false ? fixtureScope(fixture) : null;
  return (
    <RouteHead name={name} aside={aside} instrumentLive={live}>
      <ScopeHead
        scope={shown?.scope ?? scope.scope}
        revision={shown?.revision ?? scope.revision}
        options={shown?.options ?? scopeOptions(fleet.sessions)}
        busy={isRunning}
        refusal={scope.refusal}
        onSet={(next) => void scope.set(next)}
      />
    </RouteHead>
  );
}

type FixtureScope = "set" | "dangling" | "absent";
/** `/chat?source=fixture&scope=set|dangling|absent` draws the three head states without a host. */
function fixtureScope(kind: FixtureScope | undefined): {
  scope: Scope;
  revision: number;
  options: ScopeSessionOption[];
} {
  const document = address("C:\\Fixtures\\project-a Residence.rvt");
  const option: ScopeSessionOption = {
    id: "pe.app-25",
    label: "pe.app-25",
    document,
    documentLabel: "project-a Residence.rvt",
  };
  if (kind === "set")
    return { scope: { session: option.id, document }, revision: 3, options: [option] };
  if (kind === "dangling")
    return { scope: { session: "gone-24", document }, revision: 2, options: [option] };
  return { scope: emptyScope, revision: 0, options: [option] };
}
