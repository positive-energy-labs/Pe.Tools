import { Effect, Schema } from "effect";
import { boundedPayload, capture } from "@pe/runtime";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { RevitBridge, BridgeError, NoRevitSession, type BridgeSessionView } from "./bridge.ts";
import { apsAuthLogin, apsAuthLogout, apsAuthStatus, apsAuthToken } from "./aps-auth.ts";
import {
  collectRecentDocuments,
  discoverSettingsTree,
  getBridgeSessionSummary,
  getHostStatus,
  getSettingsWorkspaces,
  listBridgeSessions,
  openSettingsDocument,
  openSettingsDocumentWithModule,
  saveSettingsDocument,
  tailLogs,
  validateSettingsDocument,
} from "./local-ops.ts";
import { LocalOpError, localOpHttpStatus } from "./local-error.ts";
import {
  rhvacAssemblies,
  rhvacOpen,
  rhvacSave,
  rhvacTakeoff,
  rhvacTakeoffResolutions,
} from "./rhvac-ops.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import type { HostErrorKind } from "@pe/host-contracts/contracts";

/**
 * The entire browser/CLI-facing wire: POST /call { key, request? } → JSON.
 * TS-only ops dispatch locally; every other key passes through to the bridge
 * untouched — the Revit side owns validation, so runtime-registered ops need
 * zero host changes. Errors are problem-JSON with a real HTTP status.
 */
// ponytail: dev-only escape — PE_TOOLS_CALL_FORWARD=<base-url> makes this host a pure
// /call proxy (e.g. to the installed host that owns the Revit bridge) while still serving
// the checkout's web UI with HMR. Delete when sandbox-lane sessions can dial a dev host.
const CALL_FORWARD_BASE = process.env.PE_TOOLS_CALL_FORWARD?.trim().replace(/\/$/, "");

export const callRoute = HttpRouter.add("POST", "/call", (req) => {
  // Set once dispatch begins so the catch below can attribute failures to the op.
  let op: { key: string; request: unknown; tsOnly: boolean; startedAt: number } | undefined;
  return Effect.gen(function* () {
    const body = yield* req.json.pipe(Effect.mapError(() => invalidBody("unreadable JSON body")));
    if (CALL_FORWARD_BASE) {
      const sessionHeader = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim();
      const forwarded = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${CALL_FORWARD_BASE}/call`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(sessionHeader ? { [HOST_RPC_BRIDGE_SESSION_HEADER]: sessionHeader } : {}),
            },
            body: JSON.stringify(body),
          });
          return { status: response.status, json: (await response.json()) as unknown };
        },
        catch: (cause) =>
          new BridgeError(`call forward to ${CALL_FORWARD_BASE} failed: ${String(cause)}`, 503),
      });
      // Merge this checkout's TS-only catalog entries into a forwarded catalog so the ops
      // page lists both surfaces (the forward target may run an older TS-only set).
      if (isRecord(body) && body.key === "host.ops.catalog" && forwarded.status === 200) {
        const catalog = forwarded.json as { operations?: { key?: string }[] };
        if (Array.isArray(catalog.operations)) {
          const seen = new Set(catalog.operations.map((op) => op.key));
          catalog.operations.push(
            ...tsOnlyOperationCatalog.filter((entry) => !seen.has(entry.key)),
          );
        }
      }
      return Response.jsonUnsafe(forwarded.json ?? null, { status: forwarded.status });
    }
    if (!isRecord(body) || typeof body.key !== "string")
      return yield* Effect.fail(invalidBody("body must be { key: string, request?: object }"));
    // The /call envelope is exactly { key, request? }. Reject any other top-level key so
    // silently-ignored fields can't mis-target: a `bridgeSessionId` in the body once routed a
    // call to the user's live Revit — session targeting travels ONLY in the header.
    const unknownKey = Object.keys(body).find((k) => k !== "key" && k !== "request");
    if (unknownKey) return yield* Effect.fail(invalidBody(unknownBodyKeyMessage(unknownKey)));
    const key = body.key;
    const request = "request" in body ? body.request : undefined;
    const bridgeSessionId = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim() || undefined;

    const bridge = yield* RevitBridge;
    // Endpoint-level backstop for the data-loss path: an untargeted Revit op with several sessions
    // connected must never fall through to one of them. bridge.invoke also hard-fails here, but its
    // hint speaks the MCP `target=` selector; at the raw wire the fix is the header, so name it.
    if (!isTsOnlyOperationKey(key) && !bridgeSessionId) {
      const sessions = yield* bridge.list;
      if (sessions.length > 1) return yield* Effect.fail(ambiguousBridgeTarget(sessions));
    }
    op = { key, request, tsOnly: isTsOnlyOperationKey(key), startedAt: Date.now() };
    const result = isTsOnlyOperationKey(key)
      ? yield* dispatchTsOnlyOperation(key, request, bridgeSessionId, bridge)
      : yield* bridge.invoke(key, request ?? {}, bridgeSessionId);
    captureHostOp(op, { ok: true });
    return Response.jsonUnsafe(result ?? null);
  }).pipe(
    Effect.catch((error) => {
      if (op) captureHostOp(op, { ok: false, problem: toProblem(error) });
      return Effect.succeed(
        Response.jsonUnsafe(toProblem(error), {
          status: toProblem(error).status,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }),
  );
});

/** The host_op event: input, outcome, duration. Outputs are deliberately NOT captured —
 * they doubled event volume for no diagnostic value (the op key + input reproduce them);
 * failures carry the problem message instead. */
function captureHostOp(
  op: { key: string; request: unknown; tsOnly: boolean; startedAt: number },
  outcome: { ok: true } | { ok: false; problem: { kind: string; message: string } },
): void {
  const input = boundedPayload(op.request ?? null);
  capture("host_op", {
    op: op.key,
    ts_only: op.tsOnly,
    ok: outcome.ok,
    error_kind: outcome.ok ? undefined : outcome.problem.kind,
    error_message: outcome.ok ? undefined : outcome.problem.message,
    duration_ms: Date.now() - op.startedAt,
    input: input.json,
    input_truncated: input.truncated,
    input_bytes: input.bytes,
  });
}

export class InvalidHostRequest {
  readonly _tag = "InvalidHostRequest";
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}
}

function invalidBody(message: string) {
  return new InvalidHostRequest("host.call", message);
}

function unknownBodyKeyMessage(key: string): string {
  const base = `unknown top-level body key '${key}'; the /call envelope is exactly { key, request? }`;
  return key === "bridgeSessionId"
    ? `${base}. Session targeting is not a body field — pass it in the '${HOST_RPC_BRIDGE_SESSION_HEADER}' header.`
    : `${base}.`;
}

/** Untargeted Revit op with multiple sessions connected — refuse rather than route to one. */
function ambiguousBridgeTarget(sessions: readonly BridgeSessionView[]): BridgeError {
  const ids = sessions.map((s) => s.sessionId ?? "(unknown)").join(", ");
  return new BridgeError(
    `Multiple Revit sessions are connected (${ids}); untargeted Revit operations are ambiguous and refused. Set the '${HOST_RPC_BRIDGE_SESSION_HEADER}' header to target one.`,
    409,
  );
}

export const dispatchTsOnlyOperation = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
  bridgeSessionId: string | undefined,
  bridge: RevitBridge["Service"],
) {
  switch (key) {
    case "host.status":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getHostStatus);
    case "host.topology": {
      // The operator's map: host identity + all sessions in one snapshot (ADR 0003).
      const host = yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getHostStatus);
      const sessions = yield* listBridgeSessions(bridge.list);
      return {
        observedAtUtc: new Date().toISOString(),
        host,
        sessions: sessions.sessions,
      };
    }
    case "bridge.sessions.summary":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getBridgeSessionSummary);
    case "bridge.sessions.list":
      return yield* listBridgeSessions(bridge.list);
    case "logs.tail":
      return yield* tailLogs(yield* decodeRequest(key, request));
    case "settings.workspaces": {
      const bridgeView = yield* bridge.snapshot(bridgeSessionId);
      return yield* getSettingsWorkspaces({
        bridge: bridgeView,
        invokeBridge: (operationKey, payload) =>
          bridge.invoke(operationKey, payload, bridgeSessionId),
      });
    }
    case "settings.tree":
      return yield* discoverSettingsTree(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.open":
      return yield* openSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.open-with-module": {
      const decoded = yield* decodeRequest(key, request);
      return yield* openSettingsDocumentWithModule(decoded.request, decoded.module, {
        schemaJson: decoded.schemaJson,
      });
    }
    case "settings.document.validate":
      return yield* validateSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.save":
      return yield* saveSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "revit.catalog.recent-documents":
      return yield* collectRecentDocuments(yield* decodeRequest(key, request));
    case "rhvac.open":
      return yield* rhvacOpen(yield* decodeRequest(key, request));
    case "rhvac.assemblies":
      return yield* rhvacAssemblies(yield* decodeRequest(key, request));
    case "rhvac.save":
      return yield* rhvacSave(yield* decodeRequest(key, request));
    case "rhvac.takeoff":
      return yield* rhvacTakeoff(yield* decodeRequest(key, request));
    case "rhvac.takeoff-resolutions":
      return yield* rhvacTakeoffResolutions(yield* decodeRequest(key, request));
    case "aps.auth.status":
      return yield* apsAuthStatus(yield* decodeRequest(key, request));
    case "aps.auth.login":
      return yield* apsAuthLogin(yield* decodeRequest(key, request));
    case "aps.auth.logout":
      return yield* apsAuthLogout();
    case "aps.auth.token":
      return yield* apsAuthToken(yield* decodeRequest(key, request));
  }
});

type RequestSchemaOf<K extends TsOnlyOperationKey> = (typeof tsOnlyOperationSchemas)[K] extends {
  readonly request: infer S extends Schema.Codec<any>;
}
  ? S
  : never;

const decodeRequest = Effect.fnUntraced(function* <K extends TsOnlyOperationKey>(
  key: K,
  request: unknown,
) {
  const schemas = tsOnlyOperationSchemas[key] as { request?: Schema.Codec<unknown> };
  if (!schemas.request) return {} as never;
  return (yield* Schema.decodeUnknownEffect(schemas.request, { onExcessProperty: "error" })(
    request ?? {},
  ).pipe(
    Effect.mapError((error) => new InvalidHostRequest(key, error.message)),
  )) as Schema.Schema.Type<RequestSchemaOf<K>>;
});

type CallError = BridgeError | Error | InvalidHostRequest | LocalOpError | NoRevitSession;

function toProblem(error: CallError): {
  kind: HostErrorKind;
  message: string;
  status: number;
} {
  if (error instanceof Error) return { kind: "HostFailure", message: error.message, status: 500 };
  switch (error._tag) {
    case "InvalidHostRequest":
      return { kind: "InvalidRequest", message: error.message, status: 400 };
    case "NoRevitSession":
      return { kind: "Disconnected", message: error.message, status: 503 };
    case "BridgeError":
      return {
        kind:
          error.statusCode === 423
            ? "BridgeBusy"
            : error.statusCode === 503
              ? "Disconnected"
              : "HostFailure",
        message: error.message,
        status: error.statusCode,
      };
    case "LocalOpError":
      return { kind: "HostFailure", message: error.message, status: localOpHttpStatus(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
