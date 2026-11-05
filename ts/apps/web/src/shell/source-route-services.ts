import {
  commands,
  refusalSchema,
  writePreviewSchema,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { callOp } from "./readings-api";
import { createGeometryReadDoor } from "./geometry-read-door";
import type {
  KernelServices,
  ResolvedRead,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { AcceptanceToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { ReadingSource, UseSource } from "./readings";
import { demandContext, openSourceReading } from "./readings-use";
import { contentHash } from "./readings";
import { z } from "zod";
import type { Effect } from "@pe/agent-contracts";
import { hostFetch } from "../host/runtime";
import { Schema } from "effect";
import {
  nativeReadResolveEndpoint,
  resolvedReadDescriptorSchema,
} from "../../../../packages/agent-contracts/src/native-read-endpoint";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";

export interface SourceReadingEvidence {
  dependencies(request: ResolvedRead<unknown>, token: AcceptanceToken): readonly Effect[];
  observe(
    request: ResolvedRead<unknown>,
    token: AcceptanceToken,
    deliver: (
      event: { kind: "generation"; value: string | null } | { kind: "log"; value: unknown },
    ) => void,
  ): () => void;
}
export const readingEvidencePort: unique symbol = Symbol("source reading evidence");
export const sourceReadingEvidence = (services: KernelServices) =>
  (services as KernelServices & { [readingEvidencePort]?: SourceReadingEvidence })[
    readingEvidencePort
  ];

/** Application adapter for existing domain sources. Acceptance and validation stay in the mount. */
export function sourceRouteServices(
  sources: Record<string, ReadingSource>,
  composition: Pick<KernelServices, "target" | "geometry"> = {},
): KernelServices {
  const queries = new Set(
    hostOpCatalog.filter((entry) => entry.effect === "Read").map((entry) => entry.key),
  );
  const reads = new WeakMap<
    object,
    {
      controller: AbortController;
      snapshot: ReadingSnapshot<unknown>;
      target: import("@pe/agent-contracts").ExecutionTarget;
    }
  >();
  const observers = new WeakMap<object, (value: unknown) => void>();
  const contextFor = (request: ResolvedRead<unknown>, token: AcceptanceToken) =>
    demandContext(
      token.scope.identity.target ?? { kind: "host" },
      Number(request.key.freshnessGeneration),
      JSON.parse(request.key.sortedKeyInput),
      new AbortController().signal,
    );
  const services: KernelServices = {
    geometry: composition.geometry ?? createGeometryReadDoor(),
    target: composition.target,
    reads: {
      lifetime: "read",
      acquire<T>(request: ResolvedRead<T>, token: AcceptanceToken) {
        const state = {
          controller: new AbortController(),
          target: token.scope.identity.target ?? { kind: "host" as const },
          snapshot: {
            status: "pending",
            current: false,
            reason: "Reading pending",
          } as ReadingSnapshot<T>,
        };
        reads.set(request, state);
        return {
          lifetime: "read",
          key: request.key,
          read: () => state.snapshot,
          release: () => state.controller.abort(),
        };
      },
    },
    readings: {
      lifetime: "subscription",
      subscribe<T>(
        request: ResolvedRead<T>,
        _token: unknown,
        deliver: (value: ReadingSnapshot<T>) => void,
      ) {
        const state = reads.get(request);
        // Semantic previews belong to the host journal, never the native /call door.
        const command = Object.hasOwn(commands, request.key.op)
          ? commands[request.key.op as SemanticActionKey]
          : undefined;
        if (
          state &&
          command &&
          "writeBoundary" in command &&
          command.writeBoundary.phase === "preview"
        ) {
          const publish = (snapshot: ReadingSnapshot<T>) => {
            if (state.controller.signal.aborted) return;
            state.snapshot = snapshot;
            deliver(snapshot);
          };
          void (async () => {
            let receipt: import("@pe/agent-contracts").ActionReceipt | undefined;
            try {
              const input = command.input.parse(JSON.parse(request.key.sortedKeyInput));
              const row = await submitAction({
                id: crypto.randomUUID(),
                key: request.key.op,
                target: state.target,
                input,
              });
              if (row.state === "detached")
                throw Error(`Preview receipt ${row.id} requires recovery`);
              receipt = row;
              if (row.state !== "succeeded") {
                publish({
                  status: "failed",
                  current: false,
                  reason: "error" in row ? row.error : `Preview ${row.state}`,
                  receipt: row,
                  refusal: row.refusal,
                });
                return;
              }
              const value = request.output.parse(writePreviewSchema.parse(row.result));
              publish({
                status: "ready",
                current: true,
                value:
                  value as import("../../../../packages/agent-contracts/src/route-kernel-data").Immutable<T>,
                hash: z.string().parse(contentHash(value)),
                receipt: row,
              });
            } catch (error) {
              const refusal = refusalSchema.safeParse((error as { refusal?: unknown })?.refusal);
              publish({
                status: "failed",
                current: false,
                reason: String(error),
                receipt,
                ...(refusal.success ? { refusal: refusal.data } : {}),
              });
            }
          })();
          return () => state.controller.abort();
        }
        // Native catalog queries share the same scoped read door.
        const source =
          sources[request.key.op] ??
          (queries.has(request.key.op as never)
            ? {
                kind: "use" as const,
                async open(
                  context: Parameters<UseSource["open"]>[0],
                  deliver: Parameters<UseSource["open"]>[1],
                ) {
                  try {
                    const result = await callOp(
                      context,
                      request.key.op as import("@pe/host-contracts/operation-types").OpKey,
                      context.args as never,
                    );
                    if (!context.signal.aborted)
                      deliver({ kind: "complete", value: result, revision: 0 });
                  } catch (error) {
                    if (!context.signal.aborted) deliver({ kind: "failure", error });
                  }
                },
              }
            : undefined);
        if (!state || !source || source.kind === "derive") {
          deliver({
            status: "unavailable",
            current: false,
            reason: `No source for ${request.key.op}`,
          });
          return () => {};
        }
        if (typeof request.key.freshnessGeneration !== "number")
          throw Error("Ordinary source requires its attempt generation");
        const close = openSourceReading(
          source,
          demandContext(
            state.target,
            request.key.freshnessGeneration,
            JSON.parse(request.key.sortedKeyInput),
            state.controller.signal,
          ),
          (snapshot) => deliver((state.snapshot = snapshot as ReadingSnapshot<T>)),
          { observe: (value) => observers.get(request)?.(value) },
        );
        return () => {
          state.controller.abort();
          close();
        };
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  return Object.assign(services, {
    [readingEvidencePort]: {
      dependencies(request, token) {
        const context = contextFor(request, token);
        const source = sources[request.key.op];
        return (
          source?.effects?.(context) ??
          (context.target.kind === "document"
            ? [{ kind: "document", ref: context.target.ref }]
            : context.target.kind === "session"
              ? [{ kind: "session", session: context.target.session }]
              : [])
        );
      },
      observe(request, token, deliver) {
        observers.set(request, (value) => deliver({ kind: "log", value }));
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const target = token.scope.identity.target;
        const check = async () => {
          try {
            const response = await hostFetch(nativeReadResolveEndpoint.path, {
              method: nativeReadResolveEndpoint.method,
              signal: abort.signal,
              headers: {
                "content-type": "application/json",
                ...(target?.kind === "document"
                  ? {
                      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
                      [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
                    }
                  : {}),
              },
              body: JSON.stringify({
                operationKey: request.key.op,
                input: JSON.parse(request.key.sortedKeyInput),
              }),
            });
            if (response.ok) {
              const descriptor = Schema.decodeUnknownSync(resolvedReadDescriptorSchema)(
                await response.json(),
              );
              if (!abort.signal.aborted)
                deliver({ kind: "generation", value: descriptor.freshnessGeneration });
            }
          } catch {
            /* Unavailable freshness is not evidence of a model change. */
          }
          if (!abort.signal.aborted) timer = setTimeout(check, 5000);
        };
        if (queries.has(request.key.op as never) && target?.kind === "document") void check();
        return () => {
          abort.abort();
          clearTimeout(timer);
          observers.delete(request);
        };
      },
    } satisfies SourceReadingEvidence,
  });
}
