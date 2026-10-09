import type { SdkReceiptReader } from "./native-receipts.ts";
import { readSessionScope, sdkSession } from "./sdk-session.ts";
import { Effect } from "effect";
import {
  HttpRouter,
  type HttpServerRequest,
  HttpServerResponse as Response,
} from "effect/unstable/http";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
} from "@pe/host-contracts/operation-types";
import { RevitBridge } from "./bridge.ts";
// Runtime operation catalog for browsers/typegen: proxies host.ops.catalog to the
// connected Revit session (the standard selector header targets one; ?session is the raw query form)
// op keys + request/response JSON Schemas as plain JSON. The host-local (TS-only) ops
// are appended so discovery (host_operation_search, pea `operations`, the web ops page)
// sees both surfaces from one catalog; host-typegen skips them by their origin marker.
// A disconnected bridge still lists the local ops (they need no Revit session) with a
// bridgeCatalogError explains unavailable native metadata while host operations remain usable.
// works with the host up and Revit closed. (host-typegen treats a bridge-op-less catalog
// as "no session" and does not regenerate off the local ops alone.)
/** A browser navigation (Accept: text/html) to an API path belongs to the SPA, not the JSON. */
export type SpaFallback = (
  req: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<Response.HttpServerResponse, unknown, never>;
export const isNavigation = (req: HttpServerRequest.HttpServerRequest) =>
  (req.headers.accept ?? "").includes("text/html");

export const opsCatalogRoute = (spa: SpaFallback, sdk?: SdkReceiptReader) =>
  HttpRouter.add("GET", "/ops", (req) =>
    Effect.gen(function* () {
      if (isNavigation(req)) return yield* spa(req);
      const bridge = yield* RevitBridge;
      const sessionParam =
        new URL(req.url, "http://localhost").searchParams.get("session") ?? undefined;
      const sessionHeader = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim() || undefined;
      if (sessionParam && sessionHeader && sessionParam !== sessionHeader)
        return Response.jsonUnsafe(
          { error: "Conflicting bridge session selectors in header and query." },
          { status: 400 },
        );
      const result = yield* Effect.result(
        Effect.gen(function* () {
          const scope = yield* Effect.try(() => readSessionScope(req.headers));
          const session = yield* sdkSession(
            bridge,
            { ...scope, bridgeSessionId: sessionHeader ?? sessionParam },
            sdk,
          );
          const result = yield* bridge.invoke("host.ops.catalog", {}, session.sessionId, null);
          return { ...result, sessionId: session.sessionId };
        }),
      );
      // A host-local op is canonical; its bridge namesake (pod.member.compose) is listed once.
      const bridgeOps =
        result._tag === "Success" &&
        Array.isArray((result.success.value as { operations?: unknown }).operations)
          ? (result.success.value as { operations: { key?: unknown }[] }).operations.filter(
              (op) => !isTsOnlyOperationKey(String(op.key)),
            )
          : [];
      const body: {
        operations: unknown[];
        constants?: unknown;
        bridgeSessionId?: string;
        bridgeCatalogError?: string;
        sdk?: unknown;
      } = {
        operations: [...bridgeOps, ...tsOnlyOperationCatalog],
        bridgeSessionId: result._tag === "Success" ? result.success.sessionId : undefined,
      };
      if (result._tag === "Success")
        body.constants = (result.success.value as { constants?: unknown }).constants;
      if (result._tag === "Failure") {
        body.bridgeCatalogError = String(result.failure.message ?? result.failure);
        if ("evidence" in result.failure) body.sdk = result.failure.evidence.result;
      }
      return Response.jsonUnsafe(body);
    }),
  );
