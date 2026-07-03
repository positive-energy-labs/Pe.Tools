import { Effect, Schema } from "effect";
import { hostEffectOperationSchemas } from "@pe/host-contracts/effect/registry";
import type { HostOperationKey } from "@pe/host-contracts/contracts";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import type { RevitBridge } from "./bridge.ts";
import { BridgeError, NoRevitSession } from "./bridge.ts";

type AnyOperationSchema = Schema.Codec<unknown>;

export class InvalidHostRequest {
  readonly _tag = "InvalidHostRequest";
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}
}

export class InvalidHostResponse {
  readonly _tag = "InvalidHostResponse";
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}
}

export type HostDispatchError =
  | BridgeError
  | InvalidHostResponse
  | InvalidHostRequest
  | NoRevitSession;

export const dispatchHostOperation = Effect.fnUntraced(function* <K extends HostOperationKey>(
  key: K,
  payload: unknown,
  bridgeService: RevitBridge["Service"],
  bridgeSessionId?: string,
) {
  const schemas = hostEffectOperationSchemas[key];
  const request = yield* validateRequest(
    key,
    payload,
    "request" in schemas ? schemas.request : undefined,
  );
  const response = yield* bridgeService.invoke(key, request, bridgeSessionId);
  return (yield* validateResponse(key, response, schemas?.response)) as HostOpResponse<K>;
});

const validateRequest = Effect.fnUntraced(function* (
  key: string,
  payload: unknown,
  requestSchema?: AnyOperationSchema,
) {
  if (!requestSchema) return yield* validateNoRequest(key, payload);

  return yield* decodeOperationSchema(
    requestSchema,
    payload ?? {},
    (message) => new InvalidHostRequest(key, message),
  );
});

const validateNoRequest = Effect.fnUntraced(function* (key: string, payload: unknown) {
  if (payload == null) return {};
  if (isEmptyRecord(payload)) return payload;

  return yield* Effect.fail(
    new InvalidHostRequest(key, "operation does not accept a request payload"),
  );
});

const validateResponse = Effect.fnUntraced(function* (
  key: string,
  payload: unknown,
  responseSchema?: AnyOperationSchema,
) {
  return yield* decodeOperationSchema(
    responseSchema,
    payload,
    (message) => new InvalidHostResponse(key, message),
  );
});

const decodeOperationSchema = Effect.fnUntraced(function* <E>(
  schema: AnyOperationSchema | undefined,
  payload: unknown,
  error: (message: string) => E,
) {
  if (!schema) return payload;
  return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError((decodeError) => error(decodeError.message)),
  );
});

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
