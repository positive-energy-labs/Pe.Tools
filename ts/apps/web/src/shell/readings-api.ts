import { z } from "zod";
import { ductsReadingEnvelopeSchema, type DuctsReadingRequest } from "@pe/agent-contracts";
import { readPeError } from "@pe/host-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  type OpKey,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
import { hostFetch } from "../host/runtime";
import { readDuctsBody } from "../readings";
import type { ReadingContext, UseSource } from "./readings";
import { subscriptionSource } from "./readings-use";

/** A reading's host request; `headers` carry the exact document a route-scoped read needs. */
export interface JsonRequest {
  path: string;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
}

export async function requestJson<T>(
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
  if (!response.ok) throw Error((await readPeError(response)).message);
  return schema.parse(await response.json());
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
    decoder = import("../../../../packages/host-contracts/src/generated/host-catalog.generated").then(
      ({ hostOpCatalog }) => {
        const entry = hostOpCatalog.find((candidate) => candidate.key === key);
        if (!entry) throw Error(`${key} is not in the generated op catalog`);
        return z.fromJSONSchema(JSON.parse(entry.responseSchemaJson)) as z.ZodType;
      },
    );
    decoders.set(key, decoder);
    decoder.catch(() => decoders.delete(key));
  }
  return decoder;
}

/** One catalog op over `/call`, scoped to the attempt's document, decoded by its catalog schema. */
export async function callOp<K extends OpKey>(
  context: Pick<ReadingContext, "target" | "signal">,
  key: K,
  request: OpRequestOf<K>,
): Promise<OpResponseOf<K>> {
  const headers =
    context.target.kind === "document"
      ? {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: context.target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: context.target.ref.openId,
          [HOST_RPC_ORIGIN_HEADER]: `web:${window.location.pathname}`,
        }
      : undefined;
  const value = await requestJson(
    { path: "/call", body: { key, request }, headers },
    z.unknown(),
    context.signal,
  );
  return (await opResponseSchema(key)).parse(value) as OpResponseOf<K>;
}

/** A reading kind `op`: one catalog key, its request from the attempt, its schema decode. */
export function opSource<K extends OpKey, T = OpResponseOf<K>>(options: {
  key: K;
  request(context: ReadingContext): OpRequestOf<K> | null;
  absent: T;
  map?(response: OpResponseOf<K>): T;
  dirties?: readonly string[];
}): UseSource<T> {
  return {
    kind: "use",
    dirties: options.dirties,
    async open(context, deliver) {
      const request = options.request(context);
      if (request === null) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      try {
        const response = await callOp(context, options.key, request);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1 });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

/** HTTP resources share the kernel's cancellation and generation fence with subscriptions. */
export function jsonSource<T>(options: {
  request(context: ReadingContext): JsonRequest | null;
  schema: z.ZodType<T>;
  absent: T;
}): UseSource<T> {
  return {
    kind: "use",
    async open(context, deliver) {
      const request = options.request(context);
      if (!request) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      try {
        deliver({
          kind: "complete",
          value: await requestJson(request, options.schema, context.signal),
          revision: 1,
        });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

/** An envelope is permission to fetch a body, never the snapshot itself. */
export function ductsBodySource<T>(options: {
  request(context: ReadingContext): DuctsReadingRequest | null;
  decode(value: unknown): T;
  absent: T;
}): UseSource<T> {
  return {
    kind: "use",
    dirties: ["snapshot"],
    async open(context, deliver) {
      const request = options.request(context);
      if (!request) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      let latest = "";
      let serial = 0;
      let retained: { version: string; value: T } | undefined;
      const attempts = new Set<string>();
      return subscriptionSource({
        request: () => request,
        decode: (value) => ductsReadingEnvelopeSchema.parse(value),
      }).open(context, (publication) => {
        if (publication.kind === "failure")
          return deliver({ kind: "failure", error: publication.error });
        if (publication.kind === "stale" || publication.kind === "pending")
          return deliver({ kind: publication.kind });
        if (publication.kind !== "complete") return;
        const envelope = publication.value;
        latest = envelope.revision;
        if (envelope.state === "failed" || envelope.state === "closed")
          return deliver({
            kind: "failure",
            error: envelope.error ?? `Ducts reading ${envelope.state}`,
          });
        if (envelope.state === "loading" || publication.fresh === false)
          return deliver({ kind: "stale" });
        if (retained?.version === envelope.revision)
          return deliver({
            kind: "complete",
            value: retained.value,
            revision: ++serial,
            sourceVersion: retained.version,
          });
        if (attempts.has(envelope.revision)) return;
        attempts.add(envelope.revision);
        void readDuctsBody(request, envelope, { signal: context.signal }).then(
          (body) => {
            if (context.signal.aborted || latest !== body.nativeObservation.version) return;
            try {
              retained = {
                version: body.nativeObservation.version,
                value: options.decode(body.data),
              };
              deliver({
                kind: "complete",
                value: retained.value,
                revision: ++serial,
                sourceVersion: body.nativeObservation.version,
              });
            } catch (error) {
              deliver({ kind: "failure", error });
            }
          },
          (error: unknown) => {
            if (!context.signal.aborted && latest === envelope.revision)
              deliver({ kind: "failure", error });
          },
        );
      });
    },
  };
}
