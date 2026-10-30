import { z } from "zod";
import { ductsReadingEnvelopeSchema, type DuctsReadingRequest } from "@pe/agent-contracts";
import { readPeError } from "@pe/host-contracts/pe-api";
import { hostFetch } from "../host/runtime";
import { readDuctsBody } from "../readings";
import type { ReadingContext, UseSource } from "./readings";
import { subscriptionSource } from "./readings-use";

export async function requestJson<T>(
  request: { path: string; body?: unknown },
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await hostFetch(request.path, {
    ...(request.body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body),
        }),
    signal,
  });
  if (!response.ok) throw Error((await readPeError(response)).message);
  return schema.parse(await response.json());
}

/** HTTP resources share the kernel's cancellation and generation fence with subscriptions. */
export function jsonSource<T>(options: {
  request(context: ReadingContext): { path: string; body?: unknown } | null;
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
        if (attempts.has(envelope.revision)) return;
        attempts.add(envelope.revision);
        void readDuctsBody(request, envelope, { signal: context.signal }).then(
          (body) => {
            if (context.signal.aborted || latest !== body.nativeObservation.version) return;
            try {
              deliver({
                kind: "complete",
                value: options.decode(body.data),
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
