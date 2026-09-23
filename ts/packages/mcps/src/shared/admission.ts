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
  scheduleReads,
  semanticActions,
  actionControls,
  type ActionControlKey,
  canonicalRouteInput,
  type ActionReceipt,
  type ScheduleReadKey,
  type ActionBases,
  type ExecutionTarget,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "./host-rpc-caller.ts";
import { readScheduleCapture } from "./schedule-client.ts";
import {
  actionResult,
  readAction,
  submitAction,
  runSemanticAction,
  controlAction,
} from "./takeoff-action-client.ts";

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
  /** Tool surfaces retain the receipt; CLI and scripting callers consume its result. */
  receipt?: boolean;
  beforeAdmission?: (id: string) => Promise<void>;
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
 * What the contract says about a key, and the session a native key was read against. A replay
 * carries its original receipt's destination instead.
 */
export type CapabilityIntent = {
  kind: "operation" | "workflow" | "schedule-read";
  needs: string;
  mutates: boolean;
  session?: string;
  destination?: ExecutionTarget;
  prior?: ActionReceipt;
};

/**
 * What the contract says about a key: its admission kind, the lifetime it needs, and whether it
 * mutates. Catalogs in the order the host itself consults them
 * (`apps/host/src/gateway-actions.ts:25`): the compiled host-local catalog, the compiled semantic
 * action contract (every one of which is a `workflow`), the compiled schedule readings, then the
 * session's generated operation catalog at `GET /ops`. `/ops` lists native keys only for a named
 * session, so the session resolves first. A key none of them carries is a refusal, not a POST.
 *
 * An original `actionId` with no named session is a replay: its receipt is the authority for
 * kind and destination, so no catalog or session is read. The host journal refuses a replay whose
 * key, actor, input, target, or bases differ from the original.
 */
export async function readCapabilityIntent(
  key: string,
  context: AdmissionContext,
): Promise<CapabilityIntent> {
  // The host answers op.cancel itself, outside every gate (apps/host/src/bridge.ts cancelRequest).
  // The session catalog is served on the Revit thread the op being cancelled holds (w8-revit 4c).
  if (key === CANCEL_KEY) return { kind: "operation", needs: "nothing", mutates: false };
  const prior =
    context.actionId && !context.bridgeSessionId
      ? await readAction(context.actionId, context.hostBaseUrl)
      : undefined;
  if (prior)
    return { kind: prior.kind, needs: "", mutates: true, destination: prior.destination, prior };
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local) return { kind: "operation", needs: local.needs, mutates: local.intent !== "Read" };
  if (Object.hasOwn(semanticActions, key))
    return {
      kind: "workflow",
      needs: semanticActions[key as SemanticActionKey].needs,
      mutates: true,
    };
  if (Object.hasOwn(scheduleReads, key))
    return {
      kind: "schedule-read",
      needs: scheduleReads[key as ScheduleReadKey].needs,
      mutates: false,
    };
  const session = await requireSession(key, context);
  const catalog = await caller({ ...context, bridgeSessionId: session }).catalog();
  const definition = catalog.ops.find((row) => row.key === key);
  if (definition)
    return {
      kind: "operation",
      needs: definition.needs,
      mutates: definition.intent !== "Read",
      session,
    };
  throw new Error(
    catalog.bridgeCatalogError
      ? `The operation catalog of session '${session}' is unreachable: ${catalog.bridgeCatalogError}. '${key}' was not checked; retry once the session answers.`
      : `'${key}' is not in the operation catalog of session '${session}'. Run \`pea host operations search\`.`,
  );
}

export const CANCEL_KEY = "op.cancel";

const caller = (context: AdmissionContext) =>
  new HostRpcCaller({
    hostBaseUrl: context.hostBaseUrl,
    bridgeSessionId: context.bridgeSessionId,
    openDocumentId: context.openDocumentId,
    timeoutMs: context.timeoutMs,
  });

/**
 * The named session, or the one this host is connected to. A transport failure throws with its
 * URL; only a host that answers "no session" reads as none.
 */
async function resolveSession(context: AdmissionContext): Promise<string | undefined> {
  if (context.bridgeSessionId) return context.bridgeSessionId;
  const summary = await caller(context)
    .call("bridge.sessions.summary")
    .catch((error: unknown) => {
      throw new Error(
        `The connected session could not be read from ${context.hostBaseUrl}/call: ${error instanceof Error ? error.message : String(error)}. Name it with --bridge-session-id.`,
        { cause: error },
      );
    });
  return summary.sessionId ?? undefined;
}

async function requireSession(key: string, context: AdmissionContext): Promise<string> {
  const session = await resolveSession(context);
  if (session) return session;
  throw new Error(
    `'${key}' runs in a Revit session and none is connected to ${context.hostBaseUrl}. Start or attach one, or name it with --bridge-session-id (\`pea host status\` prints the connected session).`,
  );
}

/**
 * Run any catalogued capability by key. Reads go to `/call` (schedule readings to their host
 * route); mutations are admitted at `/actions` and followed to a terminal receipt, whose result
 * is returned unwrapped. A caller that already read the intent passes it.
 */
export async function runCapability(
  key: string,
  input: Record<string, unknown>,
  context: AdmissionContext,
  intent?: CapabilityIntent,
): Promise<unknown> {
  if (Object.hasOwn(actionControls, key)) {
    if (key === "action.resume" && context.actor === "agent") {
      const original = await controlAction("action.read", input, context.hostBaseUrl);
      if (
        original.kind === "workflow" &&
        Object.hasOwn(semanticActions, original.key) &&
        semanticActions[original.key as SemanticActionKey].actor === "human"
      )
        throw Error("This original action requires human approval to resume");
    }
    return controlAction(key as ActionControlKey, input, context.hostBaseUrl, context.actor);
  }
  intent ??= await readCapabilityIntent(key, context);
  if (intent.kind === "schedule-read")
    return readScheduleCapture(
      key as ScheduleReadKey,
      input,
      context.openDocumentId
        ? { session: await requireSession(key, context), openId: context.openDocumentId }
        : undefined,
      context.hostBaseUrl,
    );
  if (!intent.mutates)
    // A NoRequest op is called with no request; `{}` is a different body.
    return caller({ ...context, bridgeSessionId: intent.session ?? context.bridgeSessionId }).call(
      key as never,
      (Object.keys(input).length ? input : undefined) as never,
    );
  if (!context.actor)
    throw new Error(`'${key}' mutates; name the initiating actor (--actor human|agent).`);
  if (intent.kind === "workflow" && !intent.prior) {
    if (intent.needs !== "nothing")
      admissionDestination(key, intent.needs, {
        bridgeSessionId: await resolveSession(context),
        openDocumentId: context.openDocumentId,
      });
    const action = await runSemanticAction(
      key as SemanticActionKey,
      input,
      context.openDocumentId
        ? { session: await requireSession(key, context), openId: context.openDocumentId }
        : undefined,
      context.bases,
      context.actor,
      context.hostBaseUrl,
      context.actionId,
      context.timeoutMs ?? 30_000,
    );
    return context.receipt ? action : actionResult(action);
  }
  const admission = actionAdmissionSchema.parse({
    id: context.actionId ?? crypto.randomUUID(),
    kind: intent.kind,
    key,
    actor: context.actor,
    destination:
      intent.destination ??
      admissionDestination(key, intent.needs, {
        bridgeSessionId: intent.session ?? (await resolveSession(context)),
        openDocumentId: context.openDocumentId,
      }),
    input,
    bases: context.bases ?? {},
  });
  const prior = intent.prior;
  if (prior) {
    if (
      prior.kind !== admission.kind ||
      prior.key !== key ||
      prior.actor !== context.actor ||
      canonicalRouteInput(prior.request) !== canonicalRouteInput(input) ||
      canonicalRouteInput(prior.bases) !== canonicalRouteInput(admission.bases)
    )
      throw Error("Original operation ID conflicts with the requested intent");
    const session =
      prior.destination.kind === "document"
        ? prior.destination.ref.session
        : prior.destination.kind === "session"
          ? prior.destination.session
          : undefined;
    const openId = prior.destination.kind === "document" ? prior.destination.ref.openId : undefined;
    if (
      (context.bridgeSessionId && context.bridgeSessionId !== session) ||
      (context.openDocumentId && context.openDocumentId !== openId)
    )
      throw Error("Original operation ID conflicts with the requested destination");
  }
  await context.beforeAdmission?.(admission.id);
  const action = await submitAction(admission, context.hostBaseUrl, context.timeoutMs ?? 30_000);
  return context.receipt ? action : actionResult(action);
}
