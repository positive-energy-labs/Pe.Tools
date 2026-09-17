/**
 * The one admission builder. `/call` refuses every `Mutate` operation, so a Pea command that
 * mutates has exactly one road: build the exact `/actions` admission the host requires and
 * follow it to its receipt.
 *
 * Nothing here guesses. The catalogs say whether a key is an operation or a workflow, whether it
 * mutates, and what lifetime it needs; the destination falls out of `needs`. A key no catalog
 * carries is a refusal, not a POST.
 */
import {
  actionAdmissionSchema,
  semanticActions,
  type ActionBases,
  type ExecutionTarget,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
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

/**
 * What the contract says about a key: its admission kind, the lifetime it needs, and whether it
 * mutates. Three catalogs, in the order the host itself consults them
 * (`apps/host/src/gateway-actions.ts:25`): the compiled host-local catalog, the compiled semantic
 * action contract (every one of which is a `workflow`), then the connected session's generated
 * operation catalog at `GET /ops`. A key none of them carries is a refusal, not a POST.
 */
export async function readCapabilityIntent(
  key: string,
  context: AdmissionContext,
): Promise<{ kind: "operation" | "workflow"; needs: string; mutates: boolean }> {
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local) return { kind: "operation", needs: local.needs, mutates: local.intent !== "Read" };
  if (Object.hasOwn(semanticActions, key))
    return {
      kind: "workflow",
      needs: semanticActions[key as SemanticActionKey].needs,
      mutates: true,
    };
  const definition = await caller(context).getOperation(key);
  if (!definition)
    throw new Error(
      `'${key}' is not in the operation catalog this host serves (or the catalog is unreachable). Run \`pea host operations search\`.`,
    );
  return {
    kind: "operation",
    needs: definition.needs,
    mutates: definition.intent !== "Read",
  };
}

const caller = (context: AdmissionContext) =>
  new HostRpcCaller({
    hostBaseUrl: context.hostBaseUrl,
    bridgeSessionId: context.bridgeSessionId,
    openDocumentId: context.openDocumentId,
    timeoutMs: context.timeoutMs,
  });

/** The named session, or the one this host is connected to. Only asked when a key needs one. */
async function resolveSession(context: AdmissionContext): Promise<string | undefined> {
  if (context.bridgeSessionId) return context.bridgeSessionId;
  const summary = await caller(context)
    .call("bridge.sessions.summary")
    .catch(() => undefined);
  return summary?.sessionId ?? undefined;
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
  const intent = await readCapabilityIntent(key, context);
  if (!intent.mutates)
    // A NoRequest op is called with no request; `{}` is a different body.
    return caller(context).call(
      key as never,
      (Object.keys(input).length ? input : undefined) as never,
    );
  if (!context.actor)
    throw new Error(`'${key}' mutates; name the initiating actor (--actor human|agent).`);
  const admission = actionAdmissionSchema.parse({
    id: context.actionId ?? crypto.randomUUID(),
    kind: intent.kind,
    key,
    actor: context.actor,
    destination: admissionDestination(key, intent.needs, {
      bridgeSessionId: await resolveSession(context),
      openDocumentId: context.openDocumentId,
    }),
    input,
    bases: context.bases ?? {},
  });
  return actionResult(
    await submitAction(admission, context.hostBaseUrl, context.timeoutMs ?? 30_000),
  );
}
