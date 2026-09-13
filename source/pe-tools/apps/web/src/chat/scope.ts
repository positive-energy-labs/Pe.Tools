import { useEffect, useRef, useState } from "react";
import { peReadings } from "#/readings";
import {
  threadHeadSchema,
  putTargetResultSchema,
  type DocumentRequest,
  type ThreadHead,
} from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const scopeUrl = (threadId: string) =>
  peUrl(resolveWorkbenchConfig(), `/target/${encodeURIComponent(threadId)}`);

/**
 * The thread's default Target comes from the shared resource stream; the head writes with PUT.
 * The head is the only writer; every tool call runs under the revision frozen at admission.
 */
export function useThreadScope(threadId: string, enabled = true) {
  const [head, setHead] = useState<ThreadHead | undefined>(undefined);
  const lifetime = useRef(0);
  const [stale, setStale] = useState(true);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    lifetime.current++;
    if (!enabled) return;
    setStale(true);
    const release = peReadings.subscribe({ kind: "thread-head", thread: threadId }, (update) => {
      if (update.kind === "snapshot") {
        const next = threadHeadSchema.safeParse(update.value);
        if (next.success) {
          setHead(next.data);
          setStale(update.stale === true);
        }
      } else if (update.kind === "stale" || update.kind === "failure") setStale(true);
    });
    return () => {
      lifetime.current++;
      release();
    };
  }, [threadId, enabled]);

  const current: ThreadHead = head ?? { defaultTarget: null, revision: 0 };
  const set = async (defaultTarget: DocumentRequest | null) => {
    const generation = lifetime.current;
    setRefusal(null);
    const response = await fetch(scopeUrl(threadId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTarget, expectedRevision: current.revision }),
    });
    const result = putTargetResultSchema.safeParse(await response.json().catch(() => null)).data;
    if (generation !== lifetime.current) return;
    if (!result) {
      setRefusal(`target set ${response.status}`);
      return;
    }
    if (result.ok) {
      return;
    }
    if (result.why === "stale") {
      // Someone wrote first: show what is current, and let the user decide again.
      setRefusal(`the target changed to r${result.head.revision} under you; pick again.`);
      return;
    }
    setRefusal("pea is mid-turn; the turn keeps the target it was admitted under. Wait or stop it.");
  };
  return { ...current, hydrated: head !== undefined, stale, set, refusal };
}
