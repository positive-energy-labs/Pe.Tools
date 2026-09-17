/**
 * The web's one reach into the pod folder: the host-local `pod.*` ops. The host owns member I/O so
 * the web works offline; these calls hand it an address (`{ pod, path }`) and get bytes or
 * diagnostics back. Writes are mutations, so they are admitted to the host action journal.
 */
import { useCallback, useEffect, useState } from "react";
import { actionAdmissionSchema, type Reading } from "@pe/agent-contracts";
import type {
  MemberIssue,
  PodMemberComposeResponse,
  PodMemberWritten,
} from "@pe/host-contracts/operation-types";

import { callHostRpc } from "#/host/client";
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
  list: async (): Promise<PodRow[]> => [...(await callHostRpc("pod.list")).pods],
  read: (ref: MemberRef) => callHostRpc("pod.member.read", ref),
  /** Create a new member; refuses an existing path. */
  write: (ref: MemberRef, content: string) => admitHost("pod.member.write", { ...ref, content }),
  /** Overwrite the member only if it still holds the bytes the editor read. */
  save: (ref: MemberRef, content: string, expectedSha256: string) =>
    admitHost("pod.member.save", { ...ref, content, expectedSha256 }),
  compose: (ref: MemberRef, content?: string) =>
    callHostRpc("pod.member.compose", { ...ref, ...(content === undefined ? {} : { content }) }),
};

/** `pod.list` as a Reading, for an entity route to hand `useRoute` as its `pods`. */
export function usePodList(enabled = true): [Reading<unknown>, () => void] {
  const [reading, setReading] = useState<Reading<unknown>>({ state: "absent" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setReading((prev) =>
      prev.state === "ready"
        ? { state: "stale", previous: prev.observation, reason: "dirtied" }
        : prev,
    );
    podHost.list().then(
      (pods) => live && setReading({ state: "ready", observation: pods }),
      (error: unknown) =>
        live &&
        setReading({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
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

export const RECEIPT_PATH = /^output\/([^/]+)\/receipt\.json$/;
