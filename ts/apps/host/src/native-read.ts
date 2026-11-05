/**
 * HostNativeRead's live admission, lifted from call-route's `/pe/reads/resolve` and
 * `prepareNativeRead`. Generated operation metadata is the only authority: a live `host.ops.catalog`
 * answer never admits an operation, including itself.
 */
import { Effect, Layer } from "effect";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativePrincipals } from "@pe/agent-contracts";
import { HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import { prepareRead } from "../../../packages/host-internal/src/read-admission.ts";
import { admitAnonymousCall } from "./control.ts";
import { gatewayTarget, requireEligibleCaller } from "./gateway-actions.ts";
import { isDoorFailure } from "./http-problems.ts";
import { InvalidRead, NativeReads } from "./native-reads.ts";
import { ReadFreshness, readSchemas, RequestIdentity } from "./request-services.ts";
import { SdkSession } from "./sdk-session.ts";

const refusal = (message: string, problem: string, status = 409) =>
  new InvalidRead({ message, status, problem });

export const HostNativeReadLive = Layer.effect(
  HostNativeRead,
  Effect.gen(function* () {
    const sessions = yield* SdkSession;
    const freshness = yield* ReadFreshness;
    const reads = yield* NativeReads;
    // Admission is per call: a shared flight never lends one caller another's permission.
    const admit = Effect.fn("HostNativeRead.admit")(function* (request: NativeReadInput) {
      const { caller } = yield* RequestIdentity;
      const definition = hostOpCatalog.find((entry) => entry.key === request.key);
      if (
        definition?.intent !== "Read" ||
        (definition.effect !== "Read" && definition.effect !== "TransactRead")
      )
        return yield* refusal("Only declared native Reads can be admitted", "read.intent");
      const admitted = <A>(check: () => A) =>
        Effect.try({
          try: check,
          catch: (error) =>
            isDoorFailure(error) ? error : refusal(String(error), "read.admission"),
        });
      yield* admitted(() => {
        admitAnonymousCall(caller, request.key);
        requireEligibleCaller(
          { ...definition, principal: nativePrincipals(definition.actor) },
          caller,
          "native-read",
        );
      });
      const session = yield* sessions.resolve(request.scope);
      // The explicit document, else the session's one active document; gatewayTarget refuses the rest.
      const active = session.state?.openDocuments.filter((document) => document.isActive) ?? [];
      const openId =
        request.scope.openDocumentId ?? (active.length === 1 ? active[0]!.openId : undefined);
      const target = yield* admitted(() =>
        gatewayTarget(request.key, definition.needs, session, openId),
      );
      const schemas = yield* readSchemas(request.key);
      const prepared = yield* prepareRead(
        {
          operationKey: request.key,
          operation: { key: request.key, intent: "Read" },
          processIncarnation: { pid: session.processId, startedAt: session.processStartUtcUnixMs },
          openDocumentLifetime:
            target.kind === "document" ? { openId: target.ref.openId } : { kind: "session-only" },
          freshnessGeneration: freshness.current(),
          representation:
            typeof request.input === "object" &&
            request.input !== null &&
            "contextRepresentation" in request.input &&
            request.input.contextRepresentation !== undefined &&
            request.input.contextRepresentation !== "overview"
              ? "detail"
              : "overview",
          responseSchemaVersion: schemas.version,
        },
        request.input,
        schemas.request,
        schemas.response,
      ).pipe(
        Effect.mapError(() =>
          refusal("Native input violates its operation Schema", "read.input", 400),
        ),
      );
      return { prepared, session: session.sessionId };
    });
    return {
      resolve: (request) =>
        admit(request).pipe(
          Effect.map(({ prepared }) => {
            const { operation: _, responseSchemaVersion: __, ...descriptor } = prepared.descriptor;
            return descriptor;
          }),
        ),
      read: (request) =>
        admit(request).pipe(
          Effect.flatMap(({ prepared, session }) => reads.join(prepared, session)),
        ),
    };
  }),
);
