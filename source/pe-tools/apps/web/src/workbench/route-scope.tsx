import type { ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { addressSchema, type Address } from "@pe/agent-contracts";

import { useThreadScope } from "#/chat/scope";
import { EmptyState } from "#/components/lang/empty";
import { pageScope, type Scope } from "#/state/route-store";

/** The Scope query every standalone page carries: `?doc=<Address>&target=<session id>`. */
export function routeScopeSearch(search: Record<string, unknown>): {
  doc?: Address;
  target?: string;
} {
  const doc = addressSchema.safeParse(search.doc).data;
  const target = typeof search.target === "string" ? search.target.trim() : "";
  return { ...(doc ? { doc } : {}), ...(target ? { target } : {}) };
}

/**
 * A standalone page's Scope, read from the two places a Scope is ever written: the page's own
 * `?doc=&target=` query, or — when the page was opened from a chat thread — that thread's Head.
 * There is no third source: a page never picks a document off the fleet for itself (ADR 0010).
 */
export function useRouteScope(): Scope | null {
  const search = useSearch({ strict: false }) as {
    doc?: unknown;
    target?: unknown;
    thread?: unknown;
  };
  const thread = typeof search.thread === "string" ? search.thread.trim() : "";
  const threadScope = useThreadScope(thread, thread !== "");
  const document = addressSchema.safeParse(search.doc).data;
  if (document) return pageScope(document, typeof search.target === "string" ? search.target : "");
  return threadScope.scope.kind === "document" ? { scope: threadScope.scope } : null;
}

/**
 * A page that acts on one document. No picker lives here: the chat head's ScopeLine and the
 * /instances route are where a document is chosen, and a page reached without one says so.
 */
export function RouteScope({ children }: { children: (scope: Scope) => ReactNode }) {
  const scope = useRouteScope();
  if (!scope)
    return (
      <main className="grid min-h-screen place-items-center">
        <EmptyState story="scope" exit="pick a document in chat, or open one from /instances">
          no document named
        </EmptyState>
      </main>
    );
  return <>{children(scope)}</>;
}
