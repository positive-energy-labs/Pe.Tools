import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { DoorFailure, DoorFailureMapper } from "@pe/host-internal/request-contracts";

const response = (failure: DoorFailure) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        kind: failure._tag,
        message: failure.message,
        problem: failure.problem,
        status: failure.status,
        evidence: failure.evidence,
        nativeOutcome: failure.nativeOutcome,
        ...(failure._tag === "Refused" ? { refusal: failure.refusal } : {}),
      },
      {
        status: failure.status,
        headers: {
          "content-type": "application/problem+json",
          ...(failure._tag === "ReadRetiring" || failure._tag === "ReadBusy"
            ? { "retry-after": "1" }
            : {}),
          ...(failure._tag === "Refused" ? { "x-pe-refusal": failure.refusal.code } : {}),
        },
      },
    ),
  );

/** Closed F union: adding a failure requires a mapper entry, never message classification. */
const handlers = {
  InvalidRequest: response,
  Refused: response,
  NoRevitSession: response,
  BridgeError: response,
  Cancelled: response,
  ReadBusy: response,
  ReadRetiring: response,
  CommandRejected: response,
  StepFailure: response,
  LocalOpError: response,
  ConsentPersistFailed: response,
  ConsentNotifyFailed: response,
  StoreClosed: response,
} satisfies DoorFailureMapper<ReturnType<typeof response>>;

export function isDoorFailure(error: unknown): error is DoorFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    Object.hasOwn(handlers, error._tag) &&
    "status" in error &&
    typeof error.status === "number" &&
    "problem" in error &&
    typeof error.problem === "string"
  );
}

export const httpProblems = HttpRouter.middleware<{ handles: DoorFailure }>()((handler) =>
  handler.pipe(Effect.catchTags(handlers)),
).layer;
