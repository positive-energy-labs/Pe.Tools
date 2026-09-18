import { useEffect, useRef, useState } from "react";
import { peReadings, previousOf, useReading } from "#/readings";
import {
  threadHeadSchema,
  putTargetResultSchema,
  type DocumentRequest,
  type Reading,
  type ThreadHead,
} from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const scopeUrl = (threadId: string) =>
  peUrl(resolveWorkbenchConfig(), `/scope/${encodeURIComponent(threadId)}`);

/**
 * The thread's default Target comes from the shared resource stream; the head writes with PUT.
 * The head is the only writer; every tool call runs under the revision frozen at admission.
 */
export function useThreadScope(threadId: string, enabled = true, observed?: Reading<unknown>) {
  const generation = useRef(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const request = { kind: "thread-head" as const, thread: threadId };
  const subscribed = useReading<ThreadHead>(enabled && !observed ? request : null);
  const reading = observed ?? subscribed;
  const parsed = threadHeadSchema.safeParse(previousOf(reading));
  const head = parsed.success ? parsed.data : undefined;

  useEffect(() => {
    generation.current++;
    setRefusal(null);
    return () => void generation.current++;
  }, [threadId, enabled]);

  const current: ThreadHead = head ?? { defaultTarget: null, revision: 0 };
  /** True when the head moved; otherwise `refusal` says why, in the head's own words. */
  const set = async (defaultTarget: DocumentRequest | null): Promise<boolean> => {
    const attempt = ++generation.current;
    setRefusal(null);
    if (!enabled) {
      setRefusal("target changes are unavailable in this view");
      return false;
    }
    if (reading.state !== "ready" || !parsed.success) {
      peReadings.dirty(request);
      setRefusal("the target is not current; wait for it to reload");
      return false;
    }
    try {
      const response = await fetch(scopeUrl(threadId), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultTarget, expectedRevision: parsed.data.revision }),
      });
      const result = putTargetResultSchema.safeParse(await response.json().catch(() => null)).data;
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      if (!result) {
        setRefusal(`target outcome unknown (${response.status}); reading the current target again`);
      } else if (!result.ok && result.why === "stale") {
        setRefusal(`the target changed to r${result.head.revision} under you; pick again.`);
      } else if (!result.ok) {
        setRefusal(
          "pea is mid-turn; the turn keeps the target it was admitted under. Wait or stop it.",
        );
      }
      return result?.ok === true;
    } catch (error) {
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      setRefusal(
        `target outcome unknown; reading the current target again. ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };
  return {
    ...current,
    hydrated: head !== undefined,
    stale: reading.state !== "ready" || !parsed.success,
    set,
    refusal,
  };
}
