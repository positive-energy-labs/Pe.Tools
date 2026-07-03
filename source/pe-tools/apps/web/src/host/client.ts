import { FetchHttpClient } from "effect/unstable/http";
import { Effect } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import {
  type AnyOperationKey,
  type HostOpRequest,
  type HostOpResponse,
  type HostSessionScope,
  toHostCallError,
} from "@pe/host-contracts/operation-types";
import { callHostRpcMember } from "@pe/host-contracts/rpc";

const HOST_RPC_URL = "/pe-host/rpc";

const callHostRpcEffect = Effect.fnUntraced(function* (
  key: AnyOperationKey,
  request: unknown,
  options?: HostSessionScope,
) {
  return yield* callHostRpcMember(key, request, options).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url: HOST_RPC_URL })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error) => toHostCallError(key, error) ?? error),
    Effect.scoped,
  );
});

export function callHostRpc<K extends AnyOperationKey>(
  key: K,
  request?: HostOpRequest<K>,
  options?: HostSessionScope,
): Promise<HostOpResponse<K>> {
  return Effect.runPromise(
    callHostRpcEffect(key, request, options).pipe(
      Effect.map((response) => response as HostOpResponse<K>),
    ),
  );
}
