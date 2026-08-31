import type { ReactNode } from "react";
import { useLocation, useRouter, useSearch } from "@tanstack/react-router";
import { addressSchema, type Address } from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";

export interface RouteDocumentChoice {
  at: Address;
  label: string;
}

export function routeDocumentChoices(sessions: readonly SessionFacts[]): RouteDocumentChoice[] {
  const choices = new Map<Address, RouteDocumentChoice>();
  for (const session of sessions) {
    const at = documentAddress(session);
    if (at && !choices.has(at)) {
      choices.set(at, {
        at,
        label: `${session.sdkSessionId ?? session.sessionId} · ${session.activeDocumentTitle ?? at}`,
      });
    }
  }
  return [...choices.values()];
}

export function routeDocumentAddress(
  choices: readonly RouteDocumentChoice[],
  requested?: Address | null,
): Address | null {
  if (requested !== undefined)
    return requested && choices.some((choice) => choice.at === requested) ? requested : null;
  return choices.length === 1 ? choices[0]!.at : null;
}

export function routeDocumentSearch(search: Record<string, unknown>): { doc?: Address | null } {
  if (search.doc === undefined) return {};
  return { doc: addressSchema.safeParse(search.doc).data ?? null };
}

export function routeDocumentTabHref(href: string, at: Address) {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("doc", at);
  return `${url.pathname}${url.search}${url.hash}`;
}

function useRouteDocumentState(suppliedSessions?: readonly SessionFacts[]) {
  const fallback = useFleet(suppliedSessions === undefined ? undefined : { enabled: false });
  const sessions = suppliedSessions ?? fallback.sessions;
  const requested = useSearch({
    strict: false,
    select: (search) => (search as { doc?: Address | null }).doc,
  });
  return { at: routeDocumentAddress(routeDocumentChoices(sessions), requested), sessions };
}

export function useRouteDocumentAddress() {
  return useRouteDocumentState().at;
}

export function RouteDocumentSurface({ at, children }: { at: Address; children: ReactNode }) {
  const href = useLocation({ select: (location) => location.href });
  return (
    <>
      <a
        href={routeDocumentTabHref(href, at)}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed right-3 top-3 z-raised"
      >
        open in another tab
      </a>
      {children}
    </>
  );
}

export function RouteDocument({
  children,
  sessions: suppliedSessions,
}: {
  children: (at: Address) => ReactNode;
  sessions?: readonly SessionFacts[];
}) {
  const { at, sessions } = useRouteDocumentState(suppliedSessions);
  return at ? (
    <RouteDocumentSurface at={at}>{children(at)}</RouteDocumentSurface>
  ) : (
    <RouteDocumentEmpty sessions={sessions} />
  );
}

export function RouteDocumentEmpty({ sessions }: { sessions: readonly SessionFacts[] }) {
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const choices = routeDocumentChoices(sessions);
  return (
    <main className="grid min-h-screen place-items-center">
      {choices.length > 1 ? (
        <RouteDocumentPicker
          choices={choices}
          onPick={(at) => void router.navigate({ href: routeDocumentTabHref(href, at) })}
        />
      ) : (
        <EmptyState story="scope" exit="open a Revit document, then return here">
          pick a document
        </EmptyState>
      )}
    </main>
  );
}

export function RouteDocumentPicker({
  choices,
  onPick,
}: {
  choices: readonly RouteDocumentChoice[];
  onPick: (at: Address) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="">pick a document</p>
      {choices.map((choice) => (
        <Press key={choice.at} type="button" tone="quiet" onClick={() => onPick(choice.at)}>
          <PressContent geometry="row">{choice.label}</PressContent>
        </Press>
      ))}
    </div>
  );
}
