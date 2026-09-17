/**
 * The one admission builder. `/call` refuses every `Mutate` operation, so a Pea command that
 * mutates has exactly one road: build the exact `/actions` admission the host requires and
 * follow it to its receipt.
 *
 * Nothing here guesses. The one capability catalog says whether a key is an operation or a
 * workflow (`op:` vs `workflow:`), whether it mutates, and what lifetime it needs; the
 * destination falls out of `needs`. A key the catalog does not carry is a refusal, not a POST.
 */
import {
  actionAdmissionSchema,
  capabilityCatalogSchema,
  type ActionBases,
  type Capability,
  type ExecutionTarget,
} from "@pe/agent-contracts";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "./host-rpc-caller.ts";
import { actionResult, submitAction } from "./takeoff-action-client.ts";

export interface AdmissionContext {
  hostBaseUrl: string;
  /** Explicit session selector; omitted means "the session the catalog answered from". */
  bridgeSessionId?: string;
  openDocumentId?: string;
  /** Required for mutation; never inferred from the transport. */
  actor?: "human" | "agent";
  /** Reuse an original action id to replay its receipt instead of starting a new attempt. */
  actionId?: string;
  timeoutMs?: number;
  bases?: ActionBases;
}

/**
 * The destination the host will independently compute from `needs`. It must match exactly, so
 * a missing session or document is an error here rather than a refusal three hops later.
 */
export function admissionDestination(
  key: string,
  needs: string,
  scope: { bridgeSessionId?: string; openDocumentId?: string },
): ExecutionTarget {
  // Mirrors the host's `gatewayTarget`: host-local keys run on the host, and a native op that
  // needs no lifetime still runs in a session. The capability catalog already says "session"
  // for the latter; `/ops` says "nothing", so the key decides, not the word.
  if (isTsOnlyOperationKey(key)) return { kind: "host" };
  if (!scope.bridgeSessionId)
    throw new Error(`'${key}' runs in a Revit session; none is connected or named.`);
  if (needs === "nothing" || needs === "session")
    return { kind: "session", session: scope.bridgeSessionId };
  if (!scope.openDocumentId)
    throw new Error(
      `'${key}' needs an exact open ${needs}; pass its openId (there is no active-document fallback).`,
    );
  return {
    kind: "document",
    ref: { session: scope.bridgeSessionId, openId: scope.openDocumentId },
  };
}

/** The catalog row for a bare op/workflow key, plus the session the catalog answered from. */
export async function readCapabilityRow(
  key: string,
  context: AdmissionContext,
): Promise<{ row: Capability; bridgeSessionId?: string }> {
  const base = context.hostBaseUrl.replace(/\/$/, "");
  const query = context.bridgeSessionId
    ? `?${new URLSearchParams({ session: context.bridgeSessionId }).toString()}`
    : "";
  const response = await fetch(`${base}/pe/capabilities${query}`).catch((error: unknown) => {
    throw new Error(`GET ${base}/pe/capabilities failed: ${String(error)}`);
  });
  if (!response.ok) throw new Error(`GET ${base}/pe/capabilities failed with ${response.status}.`);
  const catalog = capabilityCatalogSchema.parse(await response.json());
  const row = catalog.capabilities.find(
    (candidate) => candidate.key === `op:${key}` || candidate.key === `workflow:${key}`,
  );
  if (!row)
    throw new Error(
      `'${key}' is not in the capability catalog this host serves (${catalog.capabilities.length} rows). Run \`pea host operations search\`.`,
    );
  return { row, bridgeSessionId: context.bridgeSessionId ?? catalog.bridgeSessionId };
}

/**
 * Run any catalogued capability by key. Reads go to `/call`; mutations are admitted at
 * `/actions` and followed to a terminal receipt, whose result is returned unwrapped.
 */
export async function runCapability(
  key: string,
  input: Record<string, unknown>,
  context: AdmissionContext,
): Promise<unknown> {
  const { row, bridgeSessionId } = await readCapabilityRow(key, context);
  if (!row.mutates)
    return new HostRpcCaller({
      hostBaseUrl: context.hostBaseUrl,
      bridgeSessionId,
      openDocumentId: context.openDocumentId,
      timeoutMs: context.timeoutMs,
      // A NoRequest op is called with no request; `{}` is a different body.
    }).call(key as never, (Object.keys(input).length ? input : undefined) as never);
  if (!context.actor)
    throw new Error(`'${key}' mutates; name the initiating actor (--actor human|agent).`);
  const admission = actionAdmissionSchema.parse({
    id: context.actionId ?? crypto.randomUUID(),
    // `op:` and `workflow:` are the catalog's own words for the two admission kinds.
    kind: row.key.startsWith("workflow:") ? "workflow" : "operation",
    key,
    actor: context.actor,
    destination: admissionDestination(key, row.needs, {
      bridgeSessionId,
      openDocumentId: context.openDocumentId,
    }),
    input,
    bases: context.bases ?? {},
  });
  return actionResult(
    await submitAction(admission, context.hostBaseUrl, context.timeoutMs ?? 30_000),
  );
}
