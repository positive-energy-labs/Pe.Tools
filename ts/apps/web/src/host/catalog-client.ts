import { generatedJsonSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";
import { createPeClient, type PeRouteId } from "@pe/agent-contracts/pe-api";
import type { ExecutionTarget } from "@pe/agent-contracts";
import { readPeError } from "@pe/host-contracts/pe-api";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER, HOST_RPC_ORIGIN_HEADER,
  HostCallError, type OpKey, type OpRequestOf, type OpResponseOf } from "@pe/host-contracts/operation-types";
import { hostFetch } from "./runtime";

/** A reading's host request; `headers` carry the exact document a route-scoped read needs. */
interface JsonRequest {
  path: string;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
}

async function requestJson<T>(
  request: JsonRequest,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await hostFetch(request.path, {
    ...(request.body === undefined
      ? request.headers && { headers: { ...request.headers } }
      : {
          method: "POST",
          headers: { "content-type": "application/json", ...request.headers },
          body: JSON.stringify(request.body),
        }),
    signal,
  });
  if (!response.ok) {
    const failure = await readPeError(response);
    throw new HostCallError(
      failure.message,
      response.status,
      failure.details && typeof failure.details === "object"
        ? (failure.details as Record<string, unknown>)
        : undefined,
    );
  }
  const value = schema.parse(await response.json());
  return value;
}

const decoders = new Map<string, Promise<z.ZodType>>();
/**
 * The catalog entry's own response schema, decoded once per key (ADR 0028: a reading names a
 * catalog key and its schema). ponytail: lazy-loads the whole generated catalog (~1.2 MB) as one
 * chunk and converts draft-04 JSON Schema at runtime; have typegen emit per-op zod if that hurts.
 */
export function opResponseSchema(key: string): Promise<z.ZodType> {
  let decoder = decoders.get(key);
  if (!decoder) {
    decoder = Promise.all([
      import("@pe/host-contracts/catalog"),
      import("@pe/host-contracts/operation-types"),
      import("@pe/host-contracts/decoders"),
    ]).then(([{ hostOpCatalog }, { tsOnlyOperationSchemas }, { effectDecoder }]) => {
      if (Object.hasOwn(tsOnlyOperationSchemas, key))
        return effectDecoder(
          tsOnlyOperationSchemas[key as keyof typeof tsOnlyOperationSchemas].response,
        );
      const entry = hostOpCatalog.find((candidate) => candidate.key === key);
      if (!entry) throw Error(`${key} is not in the op catalog`);
      return generatedJsonSchema(JSON.parse(entry.responseSchemaJson));
    });
    decoders.set(key, decoder);
    decoder.catch(() => decoders.delete(key));
  }
  return decoder;
}

/** One catalog op over `/call`, scoped to the attempt's document, decoded by its catalog schema. */
export async function callOp<K extends OpKey>(
  context: {
    target?: ExecutionTarget;
    signal: AbortSignal;
    headers?: Readonly<Record<string, string>>;
  },
  key: K,
  request: OpRequestOf<K>,
): Promise<OpResponseOf<K>> {
  const headers: Record<string, string> | undefined =
    context.target?.kind === "document"
      ? {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: context.target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: context.target.ref.openId,
          [HOST_RPC_ORIGIN_HEADER]: `web:${typeof window === "undefined" ? "/" : window.location.pathname}`,
        }
      : context.target?.kind === "session"
        ? { [HOST_RPC_BRIDGE_SESSION_HEADER]: context.target.session }
        : undefined;
  const value = await requestJson(
    { path: "/call", body: { key, request }, headers: { ...headers, ...context.headers } },
    z.unknown(),
    context.signal,
  );
  return (await opResponseSchema(key)).parse(value) as OpResponseOf<K>;
}

const pe = createPeClient(undefined, (url, init) => hostFetch(url, init));
export type ComposeInput<K extends PeRouteId> = Parameters<typeof pe.call<K>>[1];
export type ComposeOutput<K extends PeRouteId> = Awaited<ReturnType<typeof pe.call<K>>>;

/** One host composition, named by its catalog route key and decoded by that route's own schema. */
export const callCompose = async <K extends PeRouteId>(
  context: { signal: AbortSignal; headers?: Readonly<Record<string, string>> },
  key: K,
  input: ComposeInput<K>,
  headers?: Readonly<Record<string, string>>,
): Promise<ComposeOutput<K>> => {
  const value = await pe.call(key, input, { signal: context.signal, headers: { ...context.headers, ...headers } });
  return value as ComposeOutput<K>;
};
