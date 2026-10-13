/**
 * What the thread list says about the Revits on this machine (ADR 0016): a thread head on a
 * person's open document is the one write grant, and a thread head on a document in Pea's own
 * Revit is the job Pea works on there. Both are read from the host's thread stream; the
 * `Machine` reading never carries them.
 *
 * The grant's clock (60 minutes after the person's last message) has no host source yet: a
 * summary's `updatedAt` moves on Pea's events too, so it is not that clock. `since` is null on
 * the live lane and the cable draws no countdown until the host records it.
 */
import { useEffect, useState } from "react";
import type { HarnessThreadSummary, MachineSession } from "@pe/agent-contracts";

import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";

import { whoseOf } from "./model";

export const GRANT_MINUTES = 60;

export interface Grant {
  readonly thread: HarnessThreadSummary;
  readonly session: MachineSession;
  readonly openId: string;
  /** When the person last wrote in the thread; null until the host records it. */
  readonly since: string | null;
}

export interface PeaJob {
  readonly thread: HarnessThreadSummary;
  readonly session: MachineSession;
  readonly openId: string | null;
}

/** The thread list, live from the host's stream; null until it answers, and off in a fixture. */
export function useThreadSummaries(
  enabled: boolean,
  fixture: readonly HarnessThreadSummary[] | null = null,
): readonly HarnessThreadSummary[] | null {
  const [threads, setThreads] = useState<readonly HarnessThreadSummary[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const client = harnessClient(resolveWorkbenchConfig().origin);
    return client.summaries(setThreads, () => {});
  }, [enabled]);
  return enabled ? threads : fixture;
}

const headRef = (thread: HarnessThreadSummary) =>
  thread.head.defaultTarget?.kind === "open" ? thread.head.defaultTarget.ref : null;

const holds = (session: MachineSession, ref: { session: string; openId: string }) =>
  session.attachment?.session === ref.session &&
  (session.documents ?? []).some((document) => document.openId === ref.openId);

/** The grants: one per thread head on a document in a person's Revit. */
export function grantsOf(
  threads: readonly HarnessThreadSummary[] | null,
  sessions: readonly MachineSession[],
  since: (thread: HarnessThreadSummary) => string | null = () => null,
): Grant[] {
  return (threads ?? []).flatMap((thread) => {
    const ref = headRef(thread);
    if (!ref) return [];
    const session = sessions.find((each) => whoseOf(each) === "you" && holds(each, ref));
    return session ? [{ thread, session, openId: ref.openId, since: since(thread) }] : [];
  });
}

/** Pea's jobs: the threads whose head sits in one of Pea's own Revits. */
export function jobsOf(
  threads: readonly HarnessThreadSummary[] | null,
  sessions: readonly MachineSession[],
): PeaJob[] {
  return (threads ?? []).flatMap((thread) => {
    const ref = headRef(thread);
    if (!ref) return [];
    const session = sessions.find(
      (each) => whoseOf(each) === "pea" && each.attachment?.session === ref.session,
    );
    return session ? [{ thread, session, openId: holds(session, ref) ? ref.openId : null }] : [];
  });
}

/** Minutes of the grant left at `now`; null when the clock has no source. */
export function grantLeft(grant: Grant, now: number): number | null {
  if (!grant.since) return null;
  const minutes = GRANT_MINUTES - (now - Date.parse(grant.since)) / 60_000;
  return Math.max(0, Math.ceil(minutes));
}
