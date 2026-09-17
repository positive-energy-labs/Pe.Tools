/**
 * The route layer's pod port: the host-local `pod.*` ops. Reads come from `host/pods.ts` and the
 * pod list is a Reading; writes are mutations, so they are admitted to the host action journal.
 */
import { useCallback, useEffect, useState } from "react";
import { actionAdmissionSchema, type Reading } from "@pe/agent-contracts";
import type {
  MemberIssue,
  PodMemberComposeResponse,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";

import { callHostDynamic } from "#/host/client";
import { composeMember, listPods, readMember } from "#/host/pods";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { MemberRef, PodRow } from "./manifest";

export type Diagnostic = MemberIssue;
export type Composed = PodMemberComposeResponse;

/** A host-local mutation: admitted under an id, its receipt is the truth of what happened. */
async function admitHost(key: "pod.member.write" | "pod.member.save", input: object) {
  const action = await submitAction(
    actionAdmissionSchema.parse({
      id: crypto.randomUUID(),
      kind: "operation",
      key,
      actor: "human",
      destination: { kind: "host" },
      input,
      bases: {},
    }),
    "",
    30_000,
  );
  if (action.state !== "succeeded")
    throw Error(
      "error" in action && action.error ? String(action.error) : `${key} ${action.state}`,
    );
  return (action as unknown as { result: PodMemberWritten }).result;
}

export const podHost = {
  list: (): Promise<PodRow[]> => listPods(),
  /** Every run filed in the pod, newest first; `path` narrows to one member's runs. */
  runs: async (pod: string, path?: string): Promise<readonly Run[]> => [
    ...((await callHostDynamic("pod.runs", { pod, ...(path ? { path } : {}) })) as PodRuns).runs,
  ],
  read: readMember,
  /** Create a new member; refuses an existing path. */
  write: (ref: MemberRef, content: string) => admitHost("pod.member.write", { ...ref, content }),
  /** Overwrite the member only if it still holds the bytes the editor read. */
  save: (ref: MemberRef, content: string, expectedSha256: string) =>
    admitHost("pod.member.save", { ...ref, content, expectedSha256 }),
  compose: composeMember,
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

/** A run folder's receipt, as the engines write it (dogma law 10). */
export interface Receipt {
  podId: string;
  memberPath: string;
  memberSha256: string;
  operation: string;
  planHash?: string | null;
  outcome: string;
  outputs?: readonly string[];
  reason?: string | null;
}

/**
 * SHIM: `pod.runs` as `reports/w6-engine.md` names it, until w6-engine's host op reaches
 * `host-ops.generated.ts`. At graft, delete these two types and the `callHostDynamic` above:
 * `podHost.runs` becomes `callHostRpc("pod.runs", { pod, path })` and answers the same shape.
 */
export interface Run {
  runId: string;
  /** Pod-relative; `pod.member.read` reads it, and siblings by `output/<runId>/<name>`. */
  receiptPath: string;
  /** null exactly when the run folder holds no readable receipt; `error` says why. */
  receipt: Receipt | null;
  error: string | null;
}
interface PodRuns {
  runs: readonly Run[];
}

export const RECEIPT_PATH = /^output\/([^/]+)\/receipt\.json$/;
