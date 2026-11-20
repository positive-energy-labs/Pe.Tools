import { setThreadTargets } from "#/workbench/provider/harness-client";
import { useEffect, useRef, useState } from "react";
import { peReadings } from "#/host/resource-stream";
import { previousOf, useReading } from "#/host/resource-state";
import {
  threadHeadSchema,
  putTargetResultSchema,
  refusalSchema,
  type DocumentRequest,
  type Reading,
  type Refusal,
  type ThreadHead,
  emptyThreadHead,
  targetKey,
} from "@pe/agent-contracts";

/** A host door's refusal in the person's words: the door, the reason, then the remedy. */
const refusalSentence = ({ reason, remedy }: Refusal) =>
  remedy && !reason.includes(remedy) ? `${reason} ${remedy}` : reason;

/** One entry of a target-set PUT: the request and its display snapshot. */
export type TargetEntry = { request: DocumentRequest; label?: string };

/**
 * The thread's targets come from the shared resource stream; the composer writes the whole set
 * with PUT (ADR 0021). The host is the only writer of admissions: it records one when a human adds
 * a user document and ends it when a human removes the document. The browser only reads them.
 */
export function useThreadScope(threadId: string, enabled = true, observed?: Reading<unknown>) {
  const generation = useRef(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const request = { kind: "thread-head" as const, thread: threadId };
  const subscribed = useReading<ThreadHead>(enabled && threadId && !observed ? request : null);
  const reading = observed ?? subscribed;
  const raw = previousOf(reading);
  const parsed = threadHeadSchema.safeParse(raw);
  const head = parsed.success ? parsed.data : undefined;
  useEffect(() => {
    generation.current++;
    setRefusal(null);
    return () => void generation.current++;
  }, [threadId, enabled]);

  const current: ThreadHead = head ?? emptyThreadHead;
  /** True when the set moved; otherwise `refusal` says why, in the host's own words. */
  const set = async (targets: readonly TargetEntry[]): Promise<boolean> => {
    const attempt = ++generation.current;
    setRefusal(null);
    if (!enabled || !threadId) {
      setRefusal("target changes are unavailable in this view");
      return false;
    }
    if (reading.state !== "ready" || !parsed.success) {
      peReadings.dirty(request);
      setRefusal("the targets are not current; wait for them to reload");
      return false;
    }
    try {
      const response = await setThreadTargets(threadId, {
        targets: targets.map(({ request: target, label }) => ({
          request: target,
          ...(label ? { label } : {}),
        })),
        expectedRevision: parsed.data.revision,
      });
      const wire = await response.json().catch((error) => {
        console.error("scope: asynchronous operation failed", error);
        return null;
      });
      const body = response.ok ? wire : wire?.error?.details;
      const result = putTargetResultSchema.safeParse(body).data;
      const refused = refusalSchema.safeParse(body?.refusal).data;
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      if (refused) {
        setRefusal(refusalSentence(refused));
      } else if (!response.ok && body?.refusal?.detail) {
        setRefusal(String(body.refusal.detail));
      } else if (!result) {
        setRefusal(
          `target outcome unknown (${response.status}); reading the current targets again`,
        );
      } else if (!result.ok) {
        setRefusal(`the targets changed to r${result.head.revision} under you; pick again.`);
      }
      return result?.ok === true;
    } catch (error) {
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      setRefusal(
        `target outcome unknown; reading the current targets again. ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };
  /** Add the document when absent, remove it when present; every other target stays. */
  const toggle = (target: DocumentRequest, label?: string): Promise<boolean> => {
    const key = targetKey(target);
    const held = current.targets.filter((entry) => targetKey(entry.request) !== key);
    return set(
      held.length === current.targets.length
        ? [...current.targets, { request: target, ...(label ? { label } : {}) }]
        : held,
    );
  };
  return {
    ...current,
    hydrated: head !== undefined,
    stale: reading.state !== "ready" || !parsed.success,
    set,
    toggle,
    refusal,
  };
}
