/**
 * The route layer's pod port: the host-local `pod.*` ops. Reads come from `host/pods.ts` and the
 * pod list is a Reading; writes are mutations, so they are admitted to the host action journal.
 */
import { useCallback, useEffect, useState } from "react";
import { actionAdmissionSchema, type Reading } from "@pe/agent-contracts";
import type {
  PodMemberComposeResponse,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";

import { composeMember, listPods, listRuns, readMember } from "#/host/pods";
import {
  submitAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { PodMember as MemberRef } from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
export type PodRow = PodList["pods"][number];
export type Composed = PodMemberComposeResponse;

/** A host-local mutation: admitted under an id, its receipt is the truth of what happened. */
async function admitHost(key: "pod.member.write" | "pod.member.save", input: object) {
  return actionResult(
    await submitAction(
      actionAdmissionSchema.parse({
        id: crypto.randomUUID(),
        key,
        target: { kind: "host" },
        input,
      }),
      "",
      30_000,
    ),
  ) as PodMemberWritten;
}

export const podHost = {
  list: (): Promise<PodRow[]> => listPods(),
  read: readMember,
  /** Create a new member; refuses an existing path. */
  write: (ref: MemberRef, content: string) => admitHost("pod.member.write", { ...ref, content }),
  /** Overwrite the member only if it still holds the bytes the editor read. */
  save: (ref: MemberRef, content: string, expectedSha256: string) =>
    admitHost("pod.member.save", { ...ref, content, expectedSha256 }),
  compose: composeMember,
  /** Every run filed in the pod, newest first; `path` narrows to one member's runs. */
  runs: listRuns,
};

/** `pod.list` as a Reading, for an entity route to hand `useRoute` as its `pods`. */
export function usePodList(enabled = true): [Reading<unknown>, () => void] {
  const [reading, setReading] = useState<Reading<unknown>>({ state: "absent" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A re-read keeps what it last saw, through the read and through a failure: a route asking
    // "is this member saved?" gets the same answer mid-refresh that it got before it.
    const kept = (prev: Reading<unknown>) =>
      prev.state === "ready"
        ? prev.observation
        : prev.state === "absent"
          ? undefined
          : prev.previous;
    setReading((prev) =>
      prev.state === "ready"
        ? { state: "stale", previous: prev.observation, reason: "dirtied" }
        : prev,
    );
    podHost.list().then(
      (pods) => live && setReading({ state: "ready", observation: pods }),
      (error: unknown) =>
        live &&
        setReading((prev) => ({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
          previous: kept(prev),
        })),
    );
    return () => {
      live = false;
    };
  }, [enabled, tick]);
  return [reading, useCallback(() => setTick((n) => n + 1), [])];
}

/** One run as `pod.runs` reports it, straight off the generated contract. */
export type Run = Awaited<ReturnType<typeof podHost.runs>>[number];
