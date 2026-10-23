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
import { NoRevitSession, RevitBridge } from "./bridge.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
// A selected bridge supplies its current catalog. Without one, C#-generated metadata keeps the
// vocabulary discoverable; bridgeCatalogError reports availability, never permission to execute.
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
          if (
            !scope.session &&
            !scope.bridgeSessionId &&
            !scope.openDocumentId &&
            !sessionParam &&
            (yield* bridge.list).length === 0
          )
            return yield* Effect.fail(new NoRevitSession());
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
      const nativeOps =
        result._tag === "Success" &&
        Array.isArray((result.success.value as { operations?: unknown }).operations)
          ? (result.success.value as { operations: { key?: unknown }[] }).operations
          : result._tag === "Failure"
            ? hostOpCatalog
            : [];
      const bridgeOps = nativeOps.filter((op) => !isTsOnlyOperationKey(String(op.key)));
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
