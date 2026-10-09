import { sdkSessionSelectionSchema } from "@pe/agent-contracts";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  docListArgv,
  type DocListResult,
  type Resolved,
} from "@pe/host-contracts/pe-revit-contract";
import {
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { runPeRevitCli } from "./session-route.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";

const readSdk: SdkReceiptReader = (args) =>
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout("30 seconds")),
  );
const refuse = (message: string, result?: unknown) =>
  new BridgeError(message, 409, { notDispatched: true, result });

export function readSessionScope(headers: Record<string, string | undefined>): HostSessionScope {
  const raw = headers[HOST_RPC_SDK_SESSION_HEADER];
  return {
    session: raw === undefined ? undefined : sdkSessionSelectionSchema.parse(JSON.parse(raw)),
    bridgeSessionId: headers[HOST_RPC_BRIDGE_SESSION_HEADER],
    openDocumentId: headers[HOST_RPC_DOCUMENT_HEADER],
  };
}

/** The SDK runs its ladder. An exact product reference constrains it to the held process. */
export async function resolveSdkSession(
  bridge: Pick<RevitBridge["Service"], "list">,
  scope: HostSessionScope = {},
  read: SdkReceiptReader = readSdk,
) {
  const selection =
    scope.session === undefined ? undefined : sdkSessionSelectionSchema.parse(scope.session);
  if (scope.openDocumentId && !scope.bridgeSessionId)
    throw refuse("A product document lifetime requires its exact bridge attachment");
  const attachments = scope.bridgeSessionId
    ? (await Effect.runPromise(bridge.list)).filter((s) => s.sessionId === scope.bridgeSessionId)
    : [];
  if (scope.bridgeSessionId && attachments.length !== 1)
    throw refuse("The exact bridge attachment is no longer available");
  const held = attachments[0];
  if (held && (!held.connected || !held.processId || !held.processStartUtcUnixMs))
    throw refuse("The exact bridge attachment is no longer available");
  const argv = docListArgv(selection ?? (held ? { pid: held.processId } : {}));
  const envelope = parsePeRevitEnvelope<DocListResult, Resolved | null>(
    await read(argv),
    argv,
    peRevitLauncher(),
  );
  if (envelope.exitCode !== 0 || envelope.result?.state !== "ok")
    throw refuse(
      envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
        `pe-revit ${envelope.result?.state}`,
      envelope,
    );
  const resolved = envelope.resolved;
  const start = resolved?.processStartUtc ? Date.parse(resolved.processStartUtc) : NaN;
  if (
    !resolved ||
    !Number.isInteger(resolved.pid) ||
    resolved.pid! <= 0 ||
    !Number.isFinite(start) ||
    start <= 0
  )
    throw refuse("SDK resolution did not provide a valid process incarnation", envelope);
  const matches = (await Effect.runPromise(bridge.list)).filter(
    (socket) =>
      socket.connected &&
      socket.sessionId &&
      socket.processId === resolved.pid &&
      socket.processStartUtcUnixMs === start,
  );
  if (matches.length !== 1)
    throw refuse("The SDK resolved process has no unique bridge attachment", envelope);
  const socket = matches[0]!;
  if (
    held &&
    (socket.sessionId !== held.sessionId ||
      socket.processId !== held.processId ||
      socket.processStartUtcUnixMs !== held.processStartUtcUnixMs)
  )
    throw refuse("The exact bridge attachment no longer matches the SDK process", envelope);
  if (
    scope.openDocumentId &&
    !socket.state?.openDocuments.some((doc) => doc.openId === scope.openDocumentId)
  )
    throw refuse("The exact product document lifetime is no longer open", envelope);
  return {
    ...socket,
    sessionId: socket.sessionId!,
    processId: resolved.pid!,
    processStartUtcUnixMs: start,
    resolved,
  };
}

export type SdkSession = Awaited<ReturnType<typeof resolveSdkSession>>;

export const sdkSession = (
  bridge: Pick<RevitBridge["Service"], "list">,
  scope: HostSessionScope = {},
  read?: SdkReceiptReader,
) =>
  Effect.tryPromise({
    try: () => resolveSdkSession(bridge, scope, read),
    catch: (error) => (error instanceof BridgeError ? error : refuse(String(error))),
  });
