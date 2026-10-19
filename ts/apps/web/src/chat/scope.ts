import { peClient } from "#/host/pe-client";
import { useEffect, useRef, useState } from "react";
import { peReadings, previousOf, useReading } from "#/readings";
import {
  threadHeadSchema,
  putTargetResultSchema,
  refusalSchema,
  type DocumentRequest,
  threadHeadReadingSchema,
  type GrantView,
  type Reading,
  type Refusal,
  type ThreadHead,
  emptyThreadHead,
  machineInventory,
  resolveCallTarget,
  type Machine,
} from "@pe/agent-contracts";

export type { GrantView };

/**
 * A new thread's visible default target: the one user document when exactly one connected Revit has
 * exactly one open, and it is not Pea's. The human's send with the chip showing it is the selection
 * (ADR 0017 rule 5); any other machine leaves the draft unbound.
 */
export function soleUserDocument(machine: Machine | null): DocumentRequest | null {
  const revits = machine
    ? [
        ...(machine.revit.sessions ?? []).flatMap((s) => (s.attachment ? [s.attachment] : [])),
        ...machine.revit.unclassifiedAttachments,
      ]
    : [];
  const only = revits.length === 1 && revits[0]!.documents?.length === 1 ? revits[0]! : null;
  const document = only?.documents?.[0];
  if (!document || document.access.kind === "pea") return null;
  const request = {
    kind: "open",
    ref: { session: only!.session, openId: document.openId },
  } as const;
  return resolveCallTarget({ needs: "document" }, request, machineInventory(machine!)).kind ===
    "resolved"
    ? request
    : null;
}

/** A host door's refusal in the person's words: the door, the reason, then the remedy. */
const refusalSentence = ({ reason, remedy }: Refusal) =>
  remedy && !reason.includes(remedy) ? `${reason} ${remedy}` : reason;

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
  useEffect(() => {
    generation.current++;
    setRefusal(null);
    return () => void generation.current++;
  }, [threadId, enabled]);

  const current: ThreadHead = head ?? emptyThreadHead;
  const grantView =
    reading.state === "ready"
      ? (threadHeadReadingSchema.safeParse(raw).data?.grantView ?? null)
      : null;
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
      const response = await peClient.response("scope.set", {
        params: { id: threadId },
        body: {
          defaultTarget,
          expectedRevision: parsed.data.revision,
          displayLabel,
        },
      });
      const wire = await response.json().catch(() => null);
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
  const revoke = async (): Promise<boolean> => {
    const attempt = ++generation.current;
    setRefusal(null);
    if (!enabled || reading.state !== "ready" || !parsed.success) {
      setRefusal("rw is not current; wait for the head to reload");
      return false;
    }
    try {
      const response = await peClient.response("scope.revoke", { params: { id: threadId } });
      const wire = await response.json().catch(() => null);
      const body = response.ok ? wire : wire?.error?.details;
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      const refused = refusalSchema.safeParse(body?.refusal).data;
      if (refused) setRefusal(refusalSentence(refused));
      else if (!response.ok && body?.refusal?.detail) setRefusal(String(body.refusal.detail));
      else if (!response.ok || !threadHeadReadingSchema.safeParse(body).success)
        setRefusal("revoke outcome unknown; reading the current head again");
      return response.ok && threadHeadReadingSchema.safeParse(body).success;
    } catch {
      if (attempt !== generation.current) return false;
      peReadings.dirty(request);
      setRefusal("revoke outcome unknown; reading the current head again");
      return false;
    }
  };
  return {
    ...current,
    hydrated: head !== undefined,
    stale: reading.state !== "ready" || !parsed.success,
    grantView,
    set,
    revoke,
    refusal,
  };
}
