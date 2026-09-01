import type { ReactNode } from "react";
import { useLocation, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { addressSchema, type Address } from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";

export interface RouteDocumentChoice {
  at: Address;
  label: string;
  active?: boolean;
}

export type RouteDocumentScope =
  | { readonly kind: "ready"; readonly choice: RouteDocumentChoice }
  | { readonly kind: "activate"; readonly choice: RouteDocumentChoice }
  | { readonly kind: "acquire" };

export function routeDocumentChoices(sessions: readonly SessionFacts[]): RouteDocumentChoice[] {
  const choices = new Map<Address, RouteDocumentChoice>();
  for (const session of sessions) {
    const at = documentAddress(session);
    if (at && !choices.has(at)) {
      choices.set(at, {
        at,
        label: `${session.sdkSessionId ?? session.sessionId} · ${session.activeDocumentTitle ?? at}`,
        active: true,
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

export function routeDocumentScope(
  choices: readonly RouteDocumentChoice[],
  requested?: Address | null,
): RouteDocumentScope {
  if (requested !== undefined) {
    const choice = requested ? choices.find((candidate) => candidate.at === requested) : undefined;
    if (!choice) return { kind: "acquire" };
    return choice.active === false ? { kind: "activate", choice } : { kind: "ready", choice };
  }
  const active = choices.filter((choice) => choice.active !== false);
  return active.length === 1 ? { kind: "ready", choice: active[0]! } : { kind: "acquire" };
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

function useRouteDocumentState(
  suppliedSessions?: readonly SessionFacts[],
  suppliedChoices?: readonly RouteDocumentChoice[],
) {
  const fallback = useFleet(suppliedSessions === undefined ? undefined : { enabled: false });
  const sessions = suppliedSessions ?? fallback.sessions;
  const requested = useSearch({
    strict: false,
    select: (search) => (search as { doc?: Address | null }).doc,
  });
  const choices = suppliedChoices ?? routeDocumentChoices(sessions);
  return { scope: routeDocumentScope(choices, requested), sessions };
}

export function useRouteDocumentAddress() {
  const scope = useRouteDocumentState().scope;
  return scope.kind === "ready" ? scope.choice.at : null;
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
  empty,
  sessions: suppliedSessions,
  choices,
  onActivate,
}: {
  children: (at: Address) => ReactNode;
  empty?: (sessions: readonly SessionFacts[]) => ReactNode;
  sessions?: readonly SessionFacts[];
  choices?: readonly RouteDocumentChoice[];
  onActivate?: (choice: RouteDocumentChoice) => Promise<void>;
}) {
  const { scope, sessions } = useRouteDocumentState(suppliedSessions, choices);
  return scope.kind === "ready" ? (
    <RouteDocumentSurface at={scope.choice.at}>{children(scope.choice.at)}</RouteDocumentSurface>
  ) : scope.kind === "activate" && onActivate ? (
    <RouteDocumentActivation choice={scope.choice} onActivate={onActivate} />
  ) : empty ? (
    empty(sessions)
  ) : (
    <RouteDocumentEmpty sessions={sessions} />
  );
}

function RouteDocumentActivation({
  choice,
  onActivate,
}: {
  choice: RouteDocumentChoice;
  onActivate: (choice: RouteDocumentChoice) => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const attempted = useRef<Address | null>(null);
  useEffect(() => {
    if (attempted.current === choice.at) return;
    attempted.current = choice.at;
    let current = true;
    void onActivate(choice).catch((error) => {
      if (current) setFailure(error instanceof Error ? error.message : "document activation failed");
    });
    return () => {
      current = false;
    };
  }, [choice.at, onActivate]);
  return (
    <main className="grid min-h-screen place-items-center">
      <EmptyState story="scope" exit={failure ?? `activating ${choice.label}`}>
        {failure ? "document activation failed" : "activating document"}
      </EmptyState>
    </main>
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
