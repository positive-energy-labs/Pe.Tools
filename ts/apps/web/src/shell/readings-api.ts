import { generatedJsonSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";
import {
  BODY_RECEIPT_HEADER,
  DUCTS_BODY_VERSION_HEADER,
  ductsReadingEnvelopeSchema,
  type DuctsReadingEnvelope,
  type DuctsReadingRequest,
} from "@pe/agent-contracts";
import { createPeClient, type PeRouteId } from "@pe/agent-contracts/pe-api";
import { readPeError } from "@pe/host-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  HostCallError,
  type OpKey,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
import { hostFetch } from "../host/runtime";
import type { ReadingContext, UseSource } from "./readings";
import { subscriptionSource } from "./readings-use";

type BodyReceiptContext = { onBodyReceipt?(receipt: string | null): void };

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
  context: BodyReceiptContext,
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
  context.onBodyReceipt?.(response.headers.get(BODY_RECEIPT_HEADER));
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
  context: BodyReceiptContext & {
    target?: ReadingContext["target"];
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
    context,
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
      if (request === null)
        return deliver({ kind: "complete", value: options.absent, revision: 0 });
      try {
        let receipt: string | null = null;
        const response = await callOp({ ...context, onBodyReceipt: value => { receipt = value; } }, options.key, request);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1, bodyReceipts: receipt ? [receipt] : undefined });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

const pe = createPeClient(undefined, (url, init) => hostFetch(url, init));
type ComposeInput<K extends PeRouteId> = Parameters<typeof pe.call<K>>[1];
type ComposeOutput<K extends PeRouteId> = Awaited<ReturnType<typeof pe.call<K>>>;

/** One host composition, named by its catalog route key and decoded by that route's own schema. */
export const callCompose = async <K extends PeRouteId>(
  context: { signal: AbortSignal; headers?: Readonly<Record<string, string>> } & BodyReceiptContext,
  key: K,
  input: ComposeInput<K>,
): Promise<ComposeOutput<K>> => {
  let receipt: string | null = null;
  const client = createPeClient(undefined, async (url, init) => {
    const response = await hostFetch(url, init);
    receipt = response.headers.get(BODY_RECEIPT_HEADER);
    return response;
  });
  const value = await client.call(key, input, { signal: context.signal, headers: context.headers });
  context.onBodyReceipt?.(receipt);
  return value as ComposeOutput<K>;
};

/** A reading kind `compose`: a catalog route key (ducts roster, sheet, ...), its input, its schema. */
export function composeSource<K extends PeRouteId, T = ComposeOutput<K>>(options: {
  key: K;
  input(context: ReadingContext): ComposeInput<K> | null;
  absent: T;
  map?(response: ComposeOutput<K>): T;
  dirties?: readonly string[];
}): UseSource<T> {
  return {
    kind: "use",
    dirties: options.dirties,
    async open(context, deliver) {
      const input = options.input(context);
      if (input === null) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      try {
        let receipt: string | null = null;
        const response = await callCompose({ ...context, onBodyReceipt: value => { receipt = value; } }, options.key, input);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1, bodyReceipts: receipt ? [receipt] : undefined });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

/**
 * Materialize an admitted immutable body; the envelope and native response headers own freshness.
 * ponytail: no browser body cache (the old DuctsBodies LRU); `ductsBodySource` retains its last
 * body per attempt and the host's body cache answers repeat reads. Add one back if /ducts re-reads hurt.
 */
async function readDuctsBody(
  request: DuctsReadingRequest,
  envelope: DuctsReadingEnvelope,
  signal: AbortSignal,
): Promise<{ data: unknown; version: string; bodyReceipts?: readonly string[] }> {
  const { version, session, target } = envelope;
  const headers: Record<string, string> = {
    [HOST_RPC_BRIDGE_SESSION_HEADER]: session,
    [HOST_RPC_ORIGIN_HEADER]: `web:${typeof window === "undefined" ? "/ducts" : window.location.pathname}`,
  };
  if (target) headers[HOST_RPC_DOCUMENT_HEADER] = target.openId;
  if (version) headers[DUCTS_BODY_VERSION_HEADER] = version;
  const response = await pe.response(
    "operation.call",
    {
      body:
        request.kind === "ducts-snapshot"
          ? {
              key:
                request.selector?.kind === "roster"
                  ? "ducts.snapshot.roster"
                  : "ducts.snapshot.walk",
              request: {
                ...(request.slots ? { slots: request.slots } : {}),
                ...(request.labelParameter ? { labelParameter: request.labelParameter } : {}),
                // The host keys the shared body on the selector too: without it a
                // scoped read reached Revit as the whole-document read.
                ...(request.selector ? { selector: request.selector } : {}),
              },
            }
          : { key: "ducts.tables", request: { ids: request.ids } },
    },
    { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) },
  );
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
  const bodyVersion = response.headers.get(DUCTS_BODY_VERSION_HEADER);
  if (
    response.headers.get("x-pe-resolved-session") !== session ||
    (target &&
      decodeURIComponent(response.headers.get("x-pe-resolved-open-id") ?? "") !== target.openId) ||
    !response.headers.get("x-pe-native-request-id") ||
    !bodyVersion ||
    (version && bodyVersion !== version)
  )
    throw Error("Ducts response did not confirm the requested observation");
  return {
    data: (
      await opResponseSchema(
        request.kind === "ducts-snapshot"
          ? request.selector?.kind === "roster"
            ? "ducts.snapshot.roster"
            : "ducts.snapshot.walk"
          : "ducts.tables",
      )
    ).parse(await response.json()),
    version: bodyVersion,
    bodyReceipts: response.headers.get(BODY_RECEIPT_HEADER) ? [response.headers.get(BODY_RECEIPT_HEADER)!] : undefined,
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
      let latest = { revision: "", current: false };
      let serial = 0;
      let retained: { version: string; value: T; bodyReceipts?: readonly string[] } | undefined;
      const attempts = new Set<string>();
      return subscriptionSource({
        request: () => request,
        decode: (value) => ductsReadingEnvelopeSchema.parse(value),
      }).open(context, (publication) => {
        if (publication.kind === "failure" || publication.kind === "stale" || publication.kind === "pending") {
          latest.current = false;
          return deliver(publication.kind === "failure" ? { kind: "failure", error: publication.error } : { kind: publication.kind });
        }
        if (publication.kind !== "complete") return;
        const envelope = publication.value;
        latest = { revision: envelope.revision, current: envelope.state === "ready" && publication.fresh !== false };
        if (envelope.state === "failed" || envelope.state === "closed")
          return deliver({
            kind: "failure",
            error: envelope.error ?? `Ducts reading ${envelope.state}`,
          });
        if (!latest.current)
          return deliver({ kind: "stale" });
        if (retained?.version === envelope.revision)
          return deliver({
            kind: "complete",
            value: retained.value,
            revision: ++serial,
            sourceVersion: retained.version,
            bodyReceipts: retained.bodyReceipts,
          });
        if (attempts.has(envelope.revision)) return;
        attempts.add(envelope.revision);
        void readDuctsBody(request, envelope, context.signal).then(
          (body) => {
            if (context.signal.aborted || latest.revision !== body.version) return;
            try {
              retained = {
                version: body.version,
                value: options.decode(body.data),
                bodyReceipts: body.bodyReceipts,
              };
              if (!latest.current) return;
              deliver({
                kind: "complete",
                value: retained.value,
                revision: ++serial,
                sourceVersion: body.version,
                bodyReceipts: retained.bodyReceipts,
              });
            } catch (error) {
              deliver({ kind: "failure", error });
            }
          },
          (error: unknown) => {
            if (!context.signal.aborted && latest.revision === envelope.revision && latest.current)
              deliver({ kind: "failure", error });
          },
        );
      });
    },
  };
}
