import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { address, addressSchema, emptyScope, type Address, type Scope } from "@pe/agent-contracts";

import {
  ScopeHead,
  scopeDocuments,
  type ScopeDocumentOption,
  type ScopeSessionOption,
} from "#/chat/scope-head";
import { useThreadScope } from "#/chat/scope";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";
import { RouteHead } from "#/targeting/head";
import { useWorkbench } from "#/workbench/provider";

export function scopeSessions(sessions: readonly SessionFacts[]): ScopeSessionOption[] {
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

type Recent = { document: Address; label: string };

/** The SDK's recent documents, the same lists /instances reads: one /doctor, then one per year. */
function useRecentDocuments(enabled: boolean) {
  return useQuery({
    queryKey: ["pe", "recents"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Recent[]> => {
      const doctor = (await (await fetch("/doctor")).json()) as {
        result?: { revitYears?: string[] };
      };
      const years = doctor.result?.revitYears ?? [];
      const buckets = await Promise.all(
        years.map(async (year) => {
          const body = (await (
            await fetch(`/docs/recents?year=${encodeURIComponent(year)}`)
          ).json()) as { result?: { recents?: { path?: string; title?: string }[] } };
          return body.result?.recents ?? [];
        }),
      );
      return buckets.flat().flatMap((recent) => {
        const parsed = addressSchema.safeParse(recent.path);
        return parsed.success
          ? [{ document: parsed.data, label: recent.title ?? parsed.data }]
          : [];
      });
    },
  });
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
  const recents = useRecentDocuments(revit === true && live !== false);
  const scope = useThreadScope(currentThreadId, live !== false);
  // ponytail: the fixture switch reads the URL directly so the head renders without a router.
  const shown =
    live === false
      ? fixtureScope(
          (new URLSearchParams(window.location.search).get("scope") ?? undefined) as
            | FixtureScope
            | undefined,
        )
      : null;
  const sessions = shown?.sessions ?? scopeSessions(fleet.sessions);
  const documents = shown?.documents ?? scopeDocuments(sessions, recents.data ?? []);
  return (
    <RouteHead name={name} aside={aside} instrumentLive={live}>
      <ScopeHead
        scope={shown?.scope ?? scope.scope}
        revision={shown?.revision ?? scope.revision}
        sessions={sessions}
        documents={documents}
        busy={isRunning}
        refusal={scope.refusal}
        onSet={(next) => void scope.set(next)}
      />
    </RouteHead>
  );
}

type FixtureScope = "resolved" | "unheld" | "ambiguous" | "gone" | "nothing";
/** `/chat?source=fixture&scope=<kind>` draws each head resolution without a host. */
function fixtureScope(kind: FixtureScope | undefined): {
  scope: Scope;
  revision: number;
  sessions: ScopeSessionOption[];
  documents: ScopeDocumentOption[];
} {
  const document = address("C:\\Fixtures\\project-a Residence.rvt");
  const family = address("C:\\Fixtures\\Door-Single.rfa");
  const one: ScopeSessionOption = {
    id: "pe.app-25",
    label: "pe.app-25",
    document,
    documentLabel: "project-a Residence.rvt",
  };
  const two: ScopeSessionOption = {
    id: "pe.app-26",
    label: "pe.app-26",
    document: kind === "ambiguous" ? document : family,
    documentLabel: kind === "ambiguous" ? "project-a Residence.rvt" : "Door-Single.rfa",
  };
  const idle: ScopeSessionOption = {
    id: "pe.idle",
    label: "pe.idle",
    document: null,
    documentLabel: null,
  };
  const sessions = [one, two, idle];
  const recent = address("C:\\Fixtures\\Recent Tower.rvt");
  const documents = scopeDocuments(sessions, [{ document: recent, label: "Recent Tower.rvt" }]);
  switch (kind) {
    case "resolved":
      return { scope: { kind: "document", document }, revision: 3, sessions, documents };
    case "unheld":
      return { scope: { kind: "document", document: recent }, revision: 2, sessions, documents };
    case "ambiguous":
      return { scope: { kind: "document", document }, revision: 4, sessions, documents };
    case "gone":
      return { scope: { kind: "session", session: "gone-24" }, revision: 5, sessions, documents };
    case "nothing":
    case undefined:
      return { scope: emptyScope, revision: 0, sessions, documents };
  }
}
