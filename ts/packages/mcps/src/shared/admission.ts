/** Catalog selection is an adapter; immutable request retention and execution belong to shared owners. */
import {
  commands,
  scheduleReads,
  actionControls,
  commandTarget,
  familyReads,
  instancesReading,
  workKeySchema,
  type ActionControlKey,
  type ScheduleReadKey,
  type FamilyReadKey,
  type ExecutionTarget,
  type SemanticActionKey,
  type SdkSessionSelection,
  type ActionNeed,
} from "@pe/agent-contracts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "./host-rpc-caller.ts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { readScheduleCapture } from "./schedule-client.ts";
import {
  actionResult,
  submitAction,
  controlAction,
  recoverAction,
  readFamilyCapture,
} from "./takeoff-action-client.ts";
import { contextFetch as fetch } from "@pe/runtime/context";

export interface AdmissionContext {
  hostBaseUrl: string;
  bridgeSessionId?: string;
  session?: SdkSessionSelection;
  openDocumentId?: string;
  actionId?: string;
  timeoutMs?: number;
  receipt?: boolean;
  beforeAdmission?: (id: string) => Promise<void>;
  /** Adapter target selection is lazy: an original-id retry never re-resolves current state. */
  resolveTarget?: (intent: CapabilityIntent) => Promise<HostSessionScope>;
}
export type CapabilityIntent = {
  door: "command" | "call" | "schedule-read" | "family-read" | "instances-read";
  needs: string;
  mutates: boolean;
  session?: string;
};
export const CANCEL_KEY = "op.cancel";
const caller = (context: AdmissionContext) => new HostRpcCaller(context);

export async function readCapabilityIntent(
  key: string,
  context: AdmissionContext,
  definition?: { intent: HostOperationDefinition["intent"]; needs: ActionNeed },
): Promise<CapabilityIntent> {
  if (Object.hasOwn(commands, key)) {
    const command = commands[key as SemanticActionKey];
    return { door: "command", needs: command.needs, mutates: command.effect === "command" };
  }
  if (Object.hasOwn(actionControls, key)) {
    const control = actionControls[key as ActionControlKey];
    return { door: "command", needs: control.needs, mutates: control.effect === "command" };
  }
  if (Object.hasOwn(familyReads, key))
    return { door: "family-read", needs: familyReads[key as FamilyReadKey].needs, mutates: false };
  if (key === "instances.read") return { door: "instances-read", needs: "nothing", mutates: false };
  if (Object.hasOwn(scheduleReads, key))
    return {
      door: "schedule-read",
      needs: scheduleReads[key as ScheduleReadKey].needs,
      mutates: false,
    };
  if (key === CANCEL_KEY) return { door: "call", needs: "nothing", mutates: false };
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local)
    return {
      door: local.intent === "Read" ? "call" : "command",
      needs: local.needs,
      mutates: local.intent !== "Read",
    };
  const catalog = definition ? undefined : await caller(context).catalog();
  const selected = definition ?? catalog?.ops.find((row) => row.key === key);
  if (!selected?.needs)
    throw Error(
      catalog?.bridgeCatalogError ?? `Operation '${key}' is unavailable in the selected catalog`,
    );
  return {
    door: selected.intent === "Read" && key !== "scripting.execute" ? "call" : "command",
    needs:
      selected.needs === "nothing" && !isTsOnlyOperationKey(key) ? "session" : selected.needs,
    mutates: selected.intent !== "Read" || key === "scripting.execute",
    session: catalog?.bridgeSessionId,
  };
}

function targetFor(key: string, needs: string, context: AdmissionContext): ExecutionTarget {
  if (isTsOnlyOperationKey(key)) return { kind: "host" };
  if (!context.bridgeSessionId) throw Error(`'${key}' requires an exact Revit session`);
  if (needs === "nothing" || needs === "session")
    return { kind: "session", session: context.bridgeSessionId };
  if (!context.openDocumentId)
    throw Error(`'${key}' requires an exact open document; there is no active-document fallback`);
  return {
    kind: "document",
    ref: { session: context.bridgeSessionId, openId: context.openDocumentId },
  };
}

export async function runCapability(
  key: string,
  input: Record<string, unknown>,
  context: AdmissionContext,
  intent?: CapabilityIntent,
): Promise<unknown> {
  if (Object.hasOwn(actionControls, key))
    return controlAction(key as ActionControlKey, input, context.hostBaseUrl);
  if (context.actionId && (!intent || intent.door === "command")) {
    const target =
      context.bridgeSessionId && context.openDocumentId
        ? {
            kind: "document" as const,
            ref: { session: context.bridgeSessionId, openId: context.openDocumentId },
          }
        : undefined;
    const recovered = await recoverAction(
      context.actionId,
      key,
      input,
      target,
      context.hostBaseUrl,
      context.timeoutMs ?? 30_000,
    );
    if (recovered) return context.receipt ? recovered : actionResult(recovered);
  }
  intent ??= await readCapabilityIntent(key, context);
  if (context.resolveTarget) context = { ...context, ...(await context.resolveTarget(intent)) };
  const document =
    context.bridgeSessionId && context.openDocumentId
      ? { session: context.bridgeSessionId, openId: context.openDocumentId }
      : undefined;
  if (intent.door === "schedule-read")
    return readScheduleCapture(key as ScheduleReadKey, input, document, context.hostBaseUrl);
  if (intent.door === "family-read") {
    const { scope, ...value } = input;
    return readFamilyCapture(
      key as FamilyReadKey,
      value,
      workKeySchema.parse(scope),
      document,
      context.hostBaseUrl,
    );
  }
  if (intent.door === "instances-read") {
    const query = new URLSearchParams(
      Object.entries(instancesReading.input.parse(input))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ]),
    );
    const response = await fetch(`${context.hostBaseUrl}/instances/readings?${query}`, {
      signal: AbortSignal.timeout(context.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  }
  if (intent.door === "call") {
    const host = caller({ ...context, bridgeSessionId: context.bridgeSessionId ?? intent.session });
    return context.receipt
      ? host.callOperation(key, input)
      : host.call(key as never, (Object.keys(input).length ? input : undefined) as never);
  }
  const id = context.actionId ?? crypto.randomUUID();
  await context.beforeAdmission?.(id);
  let action: Awaited<ReturnType<typeof submitAction>>;
  if (Object.hasOwn(commands, key)) {
    action = await submitAction(
      { id, key, target: commandTarget(key, input, document), input },
      context.hostBaseUrl,
      context.timeoutMs ?? 30_000,
    );
  } else {
    const session =
      intent.session ??
      context.bridgeSessionId ??
      (isTsOnlyOperationKey(key) ? undefined : (await caller(context).catalog()).bridgeSessionId);
    action = await submitAction(
      {
        id,
        key,
        target: targetFor(key, intent.needs, { ...context, bridgeSessionId: session }),
        input,
      },
      context.hostBaseUrl,
      context.timeoutMs ?? 30_000,
    );
  }
  return context.receipt ? action : actionResult(action);
}
