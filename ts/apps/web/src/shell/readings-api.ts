import { callOp, callCompose, opResponseSchema, type ComposeInput, type ComposeOutput } from "../host/catalog-client";
import {
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
import type { ReadingContext, UseSource } from "./source-contract";
import { subscriptionSource } from "./readings-use";

const pe = createPeClient(undefined, (url, init) => hostFetch(url, init));
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
        const response = await callOp(context, options.key, request);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1 });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

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
        const response = await callCompose(context, options.key, input);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1 });
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
): Promise<{ data: unknown; version: string }> {
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
      let retained: { version: string; value: T } | undefined;
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
              };
              if (!latest.current) return;
              deliver({
                kind: "complete",
                value: retained.value,
                revision: ++serial,
                sourceVersion: body.version,
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

/** One Value response and an invalidation cursor, fenced by the generic mounted subscription. */
