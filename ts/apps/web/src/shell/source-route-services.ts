import type {
  KernelServices,
  ResolvedRead,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { ReadingSource } from "./readings";

/** Application adapter for existing domain sources. Acceptance and validation stay in the mount. */
export function sourceRouteServices(sources: Record<string, ReadingSource>): KernelServices {
  const reads = new WeakMap<
    object,
    { controller: AbortController; snapshot: ReadingSnapshot<unknown> }
  >();
  return {
    reads: {
      lifetime: "read",
      acquire<T>(request: ResolvedRead<T>) {
        const state = {
          controller: new AbortController(),
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
        const source = sources[request.key.op];
        if (!state || !source || source.kind !== "use") {
          deliver({
            status: "unavailable",
            current: false,
            reason: `No source for ${request.key.op}`,
          });
          return () => {};
        }
        const release = Promise.resolve(
          source.open(
            {
              target: { kind: "host" },
              workKey: null,
              workRevision: null,
              page: {},
              work: null,
              attempt: {
                target: { kind: "host" },
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
