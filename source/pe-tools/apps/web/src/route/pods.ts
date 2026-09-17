/**
 * The web's one reach into the pod folder: the `pod.*` ops. The host is the only reader of the
 * folder; these calls hand it an address (`{ pod, path }`) and get bytes or diagnostics back.
 */
import { useCallback, useEffect, useState } from "react";
import type { Reading } from "@pe/agent-contracts";

import { callHostDynamic } from "#/host/client";
import type { MemberRef, PodRow } from "./manifest";

export interface Diagnostic {
  message: string;
  path?: string;
  severity?: string;
}

export interface Composed {
  composed: unknown;
  diagnostics: readonly Diagnostic[];
  dependencies: readonly { id: string; path: string; sha256: string }[];
}

// ponytail: `callHostDynamic` until `pod.*` lands in host-ops.generated.ts; then `callHostRpc`.
export const podHost = {
  list: async () => ((await callHostDynamic("pod.list")) as { pods: PodRow[] }).pods,
  read: (ref: MemberRef) =>
    callHostDynamic("pod.member.read", ref) as Promise<{ content: string; sha256: string }>,
  write: (ref: MemberRef, content: string) =>
    callHostDynamic("pod.member.write", { ...ref, content }) as Promise<{ sha256: string }>,
  compose: (ref: MemberRef, content: string) =>
    callHostDynamic("pod.member.compose", { ...ref, content }) as Promise<Composed>,
  schema: async (schemaUrl: string) => {
    const schema = await callHostDynamic("settings.schema", { schemaUrl });
    return typeof schema === "string" ? schema : JSON.stringify(schema);
  },
  validate: async (schemaUrl: string, content: unknown) =>
    (
      (await callHostDynamic("settings.validate", { schemaUrl, content })) as {
        diagnostics: Diagnostic[];
      }
    ).diagnostics,
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

/** A run folder's receipt (dogma law 10). */
export interface Receipt {
  pod: string;
  member: string;
  sha256: string;
  op: string;
  planHash?: string | null;
  outcome: string;
  outputs?: readonly string[];
  at?: string;
}

export const RECEIPT_PATH = /^output\/([^/]+)\/receipt\.json$/;
