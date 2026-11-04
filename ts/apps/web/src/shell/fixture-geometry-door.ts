import type {
  GeometryReadDoor,
  ResolvedReadDescriptor,
} from "../../../../packages/agent-contracts/src/native-read-door";
import {
  canonicalEnvironmentInput,
  type GeometryOutcome,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
/** Selected before any native door. Synthetic fixture lifetimes make no host freshness claim. */
export function fixtureGeometryDoor(seed: unknown): GeometryReadDoor<unknown> {
  const descriptors = new WeakMap<object, string>();
  const once = <A>(value: A) => ({
    subscribe(next: (value: A) => void, end: () => void) {
      next(value);
      end();
      return () => {};
    },
  });
  return {
    lifetime: "read",
    resolve(request) {
      const descriptor: ResolvedReadDescriptor = Object.freeze({
        operationKey: request.native?.operationKey ?? "fixture",
        processIncarnation: { pid: 0, startedAt: 0 },
        openDocumentLifetime: { kind: "session-only" as const },
        normalizedInput: canonicalEnvironmentInput(request.native?.input ?? {}),
        freshnessGeneration: null,
        freshnessEvidence: "unavailable",
        representation: request.representation === "overview" ? "overview" : "detail",
      });
      descriptors.set(descriptor, request.native?.readingId ?? "");
      return once(descriptor);
    },
    join(descriptor) {
      const id = descriptors.get(descriptor);
      const readings = (seed as { readings?: Record<string, GeometryOutcome<unknown>> } | undefined)
        ?.readings;
      const value = id && readings?.[id];
      return value
        ? once({ kind: "value" as const, value, descriptor, cost: {} })
        : once({
            kind: "refused" as const,
            failure: { code: "MissingFixture", message: `Missing geometry seed: ${id}` },
          });
    },
  };
}
