import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyScope,
  headSchema,
  putScopeResultSchema,
  type Head,
  type Scope,
} from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const scopeUrl = (threadId: string) =>
  peUrl(resolveWorkbenchConfig(), `/scope/${encodeURIComponent(threadId)}`);

/**
 * One `?watch` stream per thread, shared by every `useThreadScope` caller. The head, each route
 * card, and the dock all read the Scope; a stream per caller once opened six long-lived
 * connections to the host, which is Chrome's per-origin limit, and every later POST queued forever.
 */
const watchers = new Map<string, { source: EventSource; listeners: Set<(next: Head) => void> }>();
function watchScope(threadId: string, listener: (next: Head) => void): () => void {
  let entry = watchers.get(threadId);
  if (!entry) {
    const source = new EventSource(`${scopeUrl(threadId)}?watch`);
    const listeners = new Set<(next: Head) => void>();
    source.onmessage = (event) => {
      const next = headSchema.safeParse(JSON.parse(String(event.data)));
      if (next.success) for (const notify of listeners) notify(next.data);
    };
    entry = { source, listeners };
    watchers.set(threadId, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.source.close();
      watchers.delete(threadId);
    }
  };
}

/**
 * The thread's Scope as the host holds it: one GET (with `?watch` for the stream) and one PUT.
 * The head is the only writer; every tool call runs under the revision frozen at admission.
 */
export function useThreadScope(threadId: string, enabled = true) {
  const queryClient = useQueryClient();
  const key = ["pe", "scope", threadId];
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async (): Promise<Head> => {
      const response = await fetch(scopeUrl(threadId));
      if (!response.ok) throw new Error(`scope read ${response.status}`);
      return headSchema.parse(await response.json());
    },
  });
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return watchScope(threadId, (next) => queryClient.setQueryData(key, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, enabled, queryClient]);

  const current = query.data ?? { scope: emptyScope, revision: 0 };
  const set = async (scope: Scope) => {
    setRefusal(null);
    const response = await fetch(scopeUrl(threadId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, expectedRevision: current.revision }),
    });
    const result = putScopeResultSchema.safeParse(await response.json().catch(() => null)).data;
    if (!result) {
      setRefusal(`scope set ${response.status}`);
      return;
    }
    if (result.ok) {
      queryClient.setQueryData(key, result.head);
      return;
    }
    if (result.why === "stale") {
      // Someone wrote first: show what is current, and let the user decide again.
      queryClient.setQueryData(key, result.head);
      setRefusal(`the Scope changed to r${result.head.revision} under you; pick again.`);
      return;
    }
    setRefusal("pea is mid-turn; the turn keeps the Scope it was admitted under. Wait or stop it.");
  };
  return { ...current, hydrated: query.data !== undefined, set, refusal };
}
