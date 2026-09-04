import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emptyScope,
  scopeRevisionSchema,
  type Scope,
  type ScopeRevision,
} from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const scopeUrl = (threadId: string) =>
  peUrl(resolveWorkbenchConfig(), `/scope/${encodeURIComponent(threadId)}`);

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
    queryFn: async (): Promise<ScopeRevision> => {
      const response = await fetch(scopeUrl(threadId));
      if (!response.ok) throw new Error(`scope read ${response.status}`);
      return scopeRevisionSchema.parse(await response.json());
    },
  });
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const events = new EventSource(`${scopeUrl(threadId)}?watch`);
    events.onmessage = (event) => {
      const next = scopeRevisionSchema.safeParse(JSON.parse(String(event.data)));
      if (next.success) queryClient.setQueryData(key, next.data);
    };
    return () => events.close();
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
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
    };
    if (!response.ok) {
      setRefusal(body.hint ?? body.error ?? `scope set ${response.status}`);
      return;
    }
    const next = scopeRevisionSchema.safeParse(body);
    if (next.success) queryClient.setQueryData(key, next.data);
  };
  return { ...current, hydrated: query.data !== undefined, set, refusal };
}
