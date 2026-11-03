import {
  submitAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { createGeometryReadDoor } from "./geometry-read-door";
import type {
  KernelServices,
  ResolvedRead,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { AcceptanceToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { ReadingSource, UseSource } from "./readings";

/** Application adapter for existing domain sources. Acceptance and validation stay in the mount. */
export function sourceRouteServices(
  sources: Record<string, ReadingSource>,
  composition: Pick<KernelServices, "target" | "geometry"> = {},
): KernelServices {
  const reads = new WeakMap<
    object,
    {
      controller: AbortController;
      snapshot: ReadingSnapshot<unknown>;
      target: import("@pe/agent-contracts").ExecutionTarget;
    }
  >();
  return {
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
        // Native previews are catalog queries, shared by every admitted ModelWrite route.
        const source =
          sources[request.key.op] ??
          (request.key.op.endsWith(".preview")
            ? {
                kind: "use" as const,
                async open(
                  context: Parameters<UseSource["open"]>[0],
                  deliver: Parameters<UseSource["open"]>[1],
                ) {
                  try {
                    const receipt = await submitAction({
                      id: crypto.randomUUID(),
                      key: request.key.op,
                      target: state!.target,
                      input: JSON.parse(request.key.sortedKeyInput),
                    });
                    const result = actionResult(receipt);
                    if (!context.signal.aborted)
                      deliver({ kind: "complete", value: result, revision: 0 });
                  } catch (error) {
                    if (!context.signal.aborted) deliver({ kind: "failure", error });
                  }
                },
              }
            : undefined);
        if (!state || !source || source.kind !== "use") {
          deliver({
            status: "unavailable",
            current: false,
            reason: `No source for ${request.key.op}`,
          });
          return () => {};
        }
        if (typeof request.key.freshnessGeneration !== "number")
          throw Error("Ordinary source requires its attempt generation");
        const release = Promise.resolve(
          source.open(
            {
              target: state.target,
              workKey: null,
              workRevision: null,
              page: {},
              work: null,
              attempt: {
                target: state.target,
                workKey: null,
                generation: request.key.freshnessGeneration,
              },
              trigger: { kind: "demand" },
              args: JSON.parse(request.key.sortedKeyInput),
              inputs: {},
              signal: state.controller.signal,
            },
            (frame) => {
              if (state.controller.signal.aborted) return;
              if (frame.kind === "complete")
                deliver({
                  status: "ready",
                  current: true,
                  value:
                    frame.value as import("../../../../packages/agent-contracts/src/route-kernel-data").Immutable<T>,
                  hash: JSON.stringify(frame.value),
                });
              if (frame.kind === "failure")
                deliver({ status: "failed", current: false, reason: String(frame.error) });
            },
          ),
        );
        return () => {
          state.controller.abort();
          void release.then((close) => close?.());
        };
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
}
