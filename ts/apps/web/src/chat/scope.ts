import { hostFetch } from "#/host/runtime";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { peReadings, previousOf, useReading } from "#/readings";
import {
  threadHeadSchema,
  putTargetResultSchema,
  refusalSchema,
  type DocumentRequest,
  type HeadGrant,
  type Reading,
  type Refusal,
  type ThreadHead,
  emptyThreadHead,
} from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const hostClockSchema = z.object({ hostNow: z.iso.datetime() });

const scopeUrl = (threadId: string) =>
  peUrl(resolveWorkbenchConfig(), `/scope/${encodeURIComponent(threadId)}`);

/** What the head's grant says right now, counted on the host's clock. */
export type GrantView =
  | { readonly state: "rw"; readonly minutes: number }
  | { readonly state: "expired" }
  | { readonly state: "revoked" };

/** A host door's refusal in the person's words: the door, the reason, then the remedy. */
export const refusalSentence = ({ reason, remedy }: Refusal) =>
  remedy && !reason.includes(remedy) ? `${reason} ${remedy}` : reason;

/** `hostNowMs` is the host's clock at this instant, never the browser's. */
export function grantViewOf(grant: HeadGrant | null, hostNowMs: number): GrantView | null {
  if (!grant) return null;
  if (grant.revoked) return { state: "revoked" };
  const left = Date.parse(grant.expiresAt) - hostNowMs;
  return left <= 0 ? { state: "expired" } : { state: "rw", minutes: Math.ceil(left / 60_000) };
}

/**
 * The thread's default Target comes from the shared resource stream; the head writes with PUT.
 * The head is the only writer of its target, and the host stamps the rw grant on a human's PUT
 * and retires it when the target moves. The browser only reads the grant.
 */
export function useThreadScope(threadId: string, enabled = true, observed?: Reading<unknown>) {
  const generation = useRef(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const request = { kind: "thread-head" as const, thread: threadId };
  const subscribed = useReading<ThreadHead>(enabled && !observed ? request : null);
  const reading = observed ?? subscribed;
  const raw = previousOf(reading);
  const parsed = threadHeadSchema.safeParse(raw);
  const head = parsed.success ? parsed.data : undefined;
  // A head served without the host's clock (a frozen seed) has no countdown to show.
  const hostNow = hostClockSchema.safeParse(raw).data?.hostNow;
  // The host's clock at this reading, and the browser's monotonic clock when it arrived. Elapsed
  // time since then is the only thing the browser adds; its wall clock is never consulted.
  const clock = useMemo(
    () => (hostNow ? { hostMs: Date.parse(hostNow), at: performance.now() } : null),
    [raw],
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (!head?.grant) return;
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [head?.grant?.expiresAt, head?.grant?.revoked?.at]);

  useEffect(() => {
    generation.current++;
    setRefusal(null);
    return () => void generation.current++;
  }, [threadId, enabled]);

  const current: ThreadHead = head ?? emptyThreadHead;
  const grantView =
    head && clock ? grantViewOf(head.grant, clock.hostMs + (performance.now() - clock.at)) : null;
  /** True when the head moved; otherwise `refusal` says why, in the head's own words. */
  const set = async (
    defaultTarget: DocumentRequest | null,
    displayLabel?: string,
  ): Promise<boolean> => {
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
      const response = await hostFetch(scopeUrl(threadId), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultTarget,
          expectedRevision: parsed.data.revision,
          displayLabel,
        }),
      });
      const body = await response.json().catch(() => null);
      const result = putTargetResultSchema.safeParse(body).data;
      const refused = refusalSchema.safeParse(body?.refusal).data;
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      if (refused) {
        setRefusal(refusalSentence(refused));
      } else if (!result) {
        setRefusal(`target outcome unknown (${response.status}); reading the current target again`);
      } else if (!result.ok) {
        setRefusal(`the target changed to r${result.head.revision} under you; pick again.`);
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
    grantView,
    set,
    refusal,
  };
}
