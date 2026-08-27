import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useSearch } from "@tanstack/react-router";
import { addressSchema, type Address } from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";

export interface RouteDocumentChoice {
  at: Address;
  label: string;
}

let boundDocument: Address | null = null;
const listeners = new Set<() => void>();

function bindDocument(at: Address) {
  boundDocument = at;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  bound: Address | null,
  requested?: Address | null,
): Address | null {
  if (requested !== undefined)
    return requested && choices.some((choice) => choice.at === requested) ? requested : null;
  if (bound && choices.some((choice) => choice.at === bound)) return bound;
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

export function useRouteDocumentAddress() {
  const { sessions } = useFleet();
  const bound = useSyncExternalStore(subscribe, () => boundDocument);
  const requested = useSearch({
    strict: false,
    select: (search) => (search as { doc?: Address | null }).doc,
  });
  return useMemo(
    () => routeDocumentAddress(routeDocumentChoices(sessions), bound, requested),
    [sessions, bound, requested],
  );
}

export function RouteDocumentSurface({ at, children }: { at: Address; children: ReactNode }) {
  const href = useLocation({ select: (location) => location.href });
  return (
    <>
      <a
        href={routeDocumentTabHref(href, at)}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed right-3 top-3 z-50 t-label text-[var(--r-nav)] underline-offset-2 hover:underline"
      >
        open in another tab
      </a>
      {children}
    </>
  );
}

export function RouteDocument({ children }: { children: (at: Address) => ReactNode }) {
  const at = useRouteDocumentAddress();
  return at ? (
    <RouteDocumentSurface at={at}>{children(at)}</RouteDocumentSurface>
  ) : (
    <RouteDocumentEmpty />
  );
}

export function RouteDocumentEmpty() {
  const { sessions } = useFleet();
  const choices = routeDocumentChoices(sessions);
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--r-page)] font-pe">
      {choices.length > 1 ? (
        <RouteDocumentPicker choices={choices} onPick={bindDocument} />
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
      <p className="t-label text-[var(--r-ink-2)]">pick a document</p>
      {choices.map((choice) => (
        <button
          key={choice.at}
          type="button"
          className="rounded-sm border border-[var(--r-line)] px-3 py-2 text-left t-value text-[var(--r-ink)] hover:bg-[var(--r-veil)]"
          onClick={() => onPick(choice.at)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
