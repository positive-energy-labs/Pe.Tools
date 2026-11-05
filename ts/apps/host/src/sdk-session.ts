import { BridgeError as DispatchBridgeError } from "@pe/host-internal/dispatch";
import type { DoorFailure, ResolvedSdkSession } from "@pe/host-internal/request-contracts";
import { RequestIdentity } from "./request-services.ts";
import { sdkSessionSelectionSchema } from "@pe/agent-contracts";
import { Context, Effect, Layer } from "effect";
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
import { BridgeError, NoRevitSession, RevitBridge } from "./bridge.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { runPeRevitCli } from "./session-route.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { hostOwnership } from "./host-ownership.ts";
import { hostServiceName, runtimeOwnerRejection } from "@pe/host-contracts/service-identity";

/** Transitional: phase 5 I deletes readSdk with its remaining consumers. Do not add imports. */
export const readSdk: SdkReceiptReader = (args) =>
  // effect-edge: island, phase 5
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout("30 seconds")),
  );
const refusal = (message: string, result?: unknown) =>
  new BridgeError(message, 409, { notDispatched: true, result });
const refuse = (message: string, result?: unknown) => Effect.fail(refusal(message, result));
type ResolutionCache = Map<string, { resolved: Resolved; sessionId: string }>;
type SdkDriver = (args: readonly string[]) => Effect.Effect<string, unknown>;
export const SdkDriver = Context.Service<SdkDriver>("SdkDriver");
export const SdkCacheLimits = Context.Reference<{ entries: number; bytes: number }>(
  "SdkCacheLimits",
  {
    defaultValue: () => ({ entries: 64, bytes: 1024 * 1024 }),
  },
);

export function readSessionScope(headers: Record<string, string | undefined>): HostSessionScope {
  const raw = headers[HOST_RPC_SDK_SESSION_HEADER];
  return {
    session: raw === undefined ? undefined : sdkSessionSelectionSchema.parse(JSON.parse(raw)),
    bridgeSessionId: headers[HOST_RPC_BRIDGE_SESSION_HEADER],
    openDocumentId: headers[HOST_RPC_DOCUMENT_HEADER],
  };
}

/** The SDK runs its ladder. An exact product reference constrains it to the held process. */
const resolveSdkCore = Effect.fn("SdkSession.sdk")(function* (
  bridge: Pick<RevitBridge["Service"], "list">,
  scope: HostSessionScope,
  read: SdkDriver,
  cache: ResolutionCache,
) {
  const selection =
    scope.session === undefined ? undefined : sdkSessionSelectionSchema.parse(scope.session);
  if (scope.openDocumentId && !scope.bridgeSessionId)
    return yield* refuse("A product document lifetime requires its exact bridge attachment");
  const attachments = scope.bridgeSessionId
    ? (yield* bridge.list).filter((s) => s.sessionId === scope.bridgeSessionId)
    : [];
  if (scope.bridgeSessionId && attachments.length !== 1)
    return yield* refuse("The exact bridge attachment is no longer available");
  const held = attachments[0];
  if (held && (!held.connected || !held.processId || !held.processStartUtcUnixMs))
    return yield* refuse("The exact bridge attachment is no longer available");
  // ponytail: one owned attachment → its pid; the SDK's unscoped ladder (cwd-project) costs ~40 s against a 30 s budget. Owed: SDK ladder speed.
  const owned = held
    ? []
    : (yield* bridge.list).filter(
        (s) => s.connected && s.processId && !runtimeOwnerRejection(hostOwnership, s),
      );
  const only = held ?? (owned.length === 1 ? owned[0] : undefined);
  const argv = docListArgv(selection ?? (only ? { pid: only.processId } : {}));
  const key = JSON.stringify(argv);
  const cached = cache.get(key);
  const sockets = yield* bridge.list;
  let resolved = cached?.resolved;
  if (cached) {
    const start = Date.parse(cached.resolved.processStartUtc!);
    const matches = sockets.filter(
      (socket) =>
        socket.connected &&
        socket.sessionId === cached.sessionId &&
        socket.processId === cached.resolved.pid &&
        socket.processStartUtcUnixMs === start,
    );
    try {
      if (matches.length !== 1) throw new Error("bridge disconnected");
      process.kill(cached.resolved.pid!, 0);
    } catch {
      cache.delete(key);
      resolved = undefined;
    }
  }
  const envelope = resolved
    ? undefined
    : parsePeRevitEnvelope<DocListResult, Resolved | null>(
        yield* read(argv).pipe(
          Effect.mapError((error) => refusal(`pe-revit did not answer: ${String(error)}`)),
        ),
        argv,
        peRevitLauncher(),
      );
  if (envelope && (envelope.exitCode !== 0 || envelope.result?.state !== "ok"))
    return yield* refuse(
      envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
        `pe-revit ${envelope.result?.state}`,
      envelope,
    );
  resolved ??= envelope?.resolved ?? undefined;
  const resolvedLane =
    resolved?.payload === "checkout"
      ? "dev"
      : resolved?.payload === "installed"
        ? "installed"
        : null;
  const rejection = runtimeOwnerRejection(hostOwnership, {
    lane: resolvedLane,
    sourceRoot: resolved?.sourceRoot,
    installedRoot: resolved?.installedRoot,
    serviceName:
      resolvedLane && (resolvedLane === "installed" || resolved?.sourceRoot)
        ? hostServiceName(resolvedLane, resolved?.sourceRoot ?? null)
        : null,
  });
  if (rejection) {
    cache.delete(key);
    return yield* refuse(rejection, envelope);
  }
  const start = resolved?.processStartUtc ? Date.parse(resolved.processStartUtc) : NaN;
  if (
    !resolved ||
    !Number.isInteger(resolved.pid) ||
    resolved.pid! <= 0 ||
    !Number.isFinite(start) ||
    start <= 0
  )
    return yield* refuse("SDK resolution did not provide a valid process incarnation", envelope);
  const matches = (yield* bridge.list).filter(
    (socket) =>
      socket.connected &&
      socket.sessionId &&
      socket.processId === resolved.pid &&
      socket.processStartUtcUnixMs === start,
  );
  if (matches.length !== 1) {
    cache.delete(key);
    return yield* refuse("The SDK resolved process has no unique bridge attachment", envelope);
  }
  const socket = matches[0]!;
  const socketRejection = runtimeOwnerRejection(hostOwnership, socket);
  if (socketRejection) {
    cache.delete(key);
    return yield* refuse(socketRejection, envelope);
  }
  if (
    held &&
    (socket.sessionId !== held.sessionId ||
      socket.processId !== held.processId ||
      socket.processStartUtcUnixMs !== held.processStartUtcUnixMs)
  )
    return yield* refuse("The exact bridge attachment no longer matches the SDK process", envelope);
  if (
    scope.openDocumentId &&
    !socket.state?.openDocuments.some((doc) => doc.openId === scope.openDocumentId)
  )
    return yield* refuse("The exact product document lifetime is no longer open", envelope);
  cache.set(key, { resolved, sessionId: socket.sessionId! });
  return {
    ...socket,
    sessionId: socket.sessionId!,
    processId: resolved.pid!,
    processStartUtcUnixMs: start,
    resolved,
  };
});

/** I removes these legacy callable faces with their L/R consumers. Converted reads use the scoped service below. */
const resolveSdk = (
  bridge: Pick<RevitBridge["Service"], "list">,
  scope: HostSessionScope = {},
  read: SdkReceiptReader = readSdk,
) =>
  resolveSdkCore(
    bridge,
    scope,
    (args) => Effect.tryPromise({ try: () => read(args), catch: (error) => error }),
    new Map(),
  );
export type SdkSession = Effect.Success<ReturnType<typeof resolveSdkCore>>;
export const sdkSession = resolveSdk;

/** Transitional: phase 5 I deletes resolveSdkSession with its remaining consumers. Do not add imports. */
export const resolveSdkSession = (...args: Parameters<typeof resolveSdk>) =>
  // effect-edge: island, phase 5
  Effect.runPromise(resolveSdk(...args));

/** Which attachment a caller means: its bridge id, its SDK session id, or either. */
export type AttachmentTarget = { session: string } | { sdkSession: string } | { id: string };

/**
 * The one lookup of an attached Revit. A bridge id names its attachment as it is; an SDK session
 * id, or an id that may be either, names one connected attachment, never two.
 */
export const resolveAttachment = Effect.fn("SdkSession.resolve")(function* (
  bridge: Pick<RevitBridge["Service"], "list">,
  target: AttachmentTarget,
) {
  const sessions = yield* bridge.list;
  const matches = sessions.filter((s) =>
    "session" in target
      ? s.sessionId === target.session
      : s.connected &&
        ("sdkSession" in target
          ? s.sdkSessionId === target.sdkSession
          : s.sessionId === target.id || s.sdkSessionId === target.id),
  );
  const match = matches[0];
  if (matches.length !== 1 || !match?.sessionId)
    return yield* new NoRevitSession({
      asked:
        "session" in target
          ? `bridge session ${target.session}`
          : "sdkSession" in target
            ? `SDK session ${target.sdkSession}`
            : `session ${target.id}${matches.length > 1 ? " (ambiguous)" : ""}`,
      attached: sessions.flatMap((s) => (s.sessionId ? [s.sessionId] : [])),
    });
  return { ...match, sessionId: match.sessionId };
});

/** The attachment lookup on its service face. */
type ResolvedSession = SdkSession & ResolvedSdkSession;
const SdkSessionService = Context.Service<
  import("@pe/host-internal/request-contracts").SdkSession,
  {
    readonly resolve: (
      scope: Readonly<HostSessionScope>,
    ) => Effect.Effect<
      ResolvedSession,
      DoorFailure,
      import("@pe/host-internal/request-contracts").RequestIdentity
    >;
    readonly resolveAttachment: (
      target: AttachmentTarget,
    ) => Effect.Effect<
      ResolvedSession,
      DoorFailure,
      import("@pe/host-internal/request-contracts").RequestIdentity
    >;
  }
>("SdkSession");
const SdkSessionLayer = Layer.effect(
  SdkSessionService,
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const driver = yield* SdkDriver;
    const limits = yield* SdkCacheLimits;
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
      return yield* Effect.die(new Error("SDK cache bounds must be positive safe integers"));
    const cache: ResolutionCache = new Map();
    let generation = 0;
    const clear = () => {
      generation++;
      cache.clear();
    };
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bridge.subscribe((event) => {
          if (event.kind !== "event") clear();
        }),
      ),
      (release) => Effect.sync(release),
    );
    yield* Effect.addFinalizer(() => Effect.sync(clear));
    const resolve = Effect.fn("SdkSession.resolve")(
      function* (scope: Readonly<HostSessionScope>) {
        yield* RequestIdentity;
        // A bridge frame mid-resolution makes the evidence stale, not wrong. Admission dispatches
        // nothing, so re-admit once from scratch: every bridge, SDK, incarnation, ownership and
        // document check reruns. A second change during that pass still refuses.
        let observed = generation;
        let resolved = yield* resolveSdkCore(bridge, scope, driver, cache);
        if (generation !== observed) {
          cache.clear(); // the first pass may have cached its stale answer after the frame cleared it
          observed = generation;
          resolved = yield* resolveSdkCore(bridge, scope, driver, cache);
        }
        if (generation !== observed) {
          cache.clear();
          return yield* refuse("SDK attachment changed during resolution; retry admission");
        }
        while (
          cache.size &&
          (cache.size > limits.entries ||
            Buffer.byteLength(JSON.stringify([...cache])) > limits.bytes)
        )
          cache.delete(cache.keys().next().value!);
        return {
          ...resolved,
          processIncarnation: {
            pid: resolved.processId,
            startedAt: resolved.processStartUtcUnixMs,
          },
          openDocumentLifetime: scope.openDocumentId
            ? { openId: scope.openDocumentId }
            : { kind: "session-only" as const },
        };
      },
      Effect.mapError(
        (error) => new DispatchBridgeError(error.message, error.statusCode, error.evidence),
      ),
    );
    return {
      resolve,
      resolveAttachment: Effect.fn("SdkSession.resolveAttachment")(function* (
        target: AttachmentTarget,
      ) {
        const attachment = yield* resolveAttachment(bridge, target).pipe(
          Effect.mapError(
            (error) => new DispatchBridgeError(error.message, 409, { notDispatched: true }),
          ),
        );
        return yield* resolve({ bridgeSessionId: attachment.sessionId });
      }),
    };
  }),
);
/** Required Effect service. Static attachment helpers remain only for later slice consumers. */
export const SdkSession = Object.assign(SdkSessionService, {
  resolve: resolveAttachment,
  sdk: resolveSdk,
  layer: SdkSessionLayer,
});

export const SdkDriverLive = Layer.succeed(SdkDriver, (args) =>
  runPeRevitCli(args).pipe(Effect.timeout("30 seconds")),
);
