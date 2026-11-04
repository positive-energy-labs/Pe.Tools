import { Schema } from "effect";
import {
  nativeReadResolveEndpoint,
  resolvedReadDescriptorSchema,
} from "../../../../packages/agent-contracts/src/native-read-endpoint";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { hostFetch } from "#/host/runtime";
import type {
  GeometryReadDoor,
  NativeReadRefusal,
  ResolvedReadDescriptor,
} from "../../../../packages/agent-contracts/src/native-read-door";
import type { Observation } from "../../../../packages/agent-contracts/src/work-journal-door";
import { type GeometryOutcome } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { callHostRpc } from "#/host/client";
import { fetchSceneArtifact } from "#/scene/artifact";
import { decodeScene } from "#/scene/psc1";

const refuse = (message: string): NativeReadRefusal => ({
  kind: "refused",
  failure: { code: "GeometryReadUnavailable", message },
});
/** Subscription owns transport lifetime, never successful-value caching or browser coalescing. */
function observe<A>(run: (signal: AbortSignal) => Promise<A>): Observation<A> {
  return {
    subscribe(value, end) {
      const abort = new AbortController();
      void run(abort.signal).then((answer) => {
        if (!abort.signal.aborted) {
          value(answer);
          end();
        }
      });
      // Best-effort only until phase 5 slice B closes the live-falsified abort hop.
      return () => abort.abort();
    },
  };
}
export function createGeometryReadDoor(): GeometryReadDoor<unknown> {
  const resolved = new WeakMap<ResolvedReadDescriptor, { session: string; openId: string }>();
  return {
    lifetime: "read",
    resolve(request, scope) {
      return observe(async (signal) => {
        try {
          const target = scope.identity.target;
          if (target?.kind !== "document")
            return refuse("Geometry requires an exact document target");
          if (!request.native || request.native.operationKey !== "revit.detail.space-scene")
            return refuse("No geometry wire binding for this operation");
          const native = request.native.input as Record<string, unknown>;
          const mode = request.representation;
          const input: Record<string, unknown> = {
            ...native,
            contextRepresentation: mode,
            ...(mode === "overview" ? {} : { contextPaddingFt: request.reach.reachFt }),
          };
          if (!(Array.isArray(input.elementIds) && input.elementIds.length) && !input.region)
            return refuse("Project geometry requires a narrow subject");
          const response = await hostFetch(nativeReadResolveEndpoint.path, {
            method: nativeReadResolveEndpoint.method,
            signal,
            headers: {
              "content-type": "application/json",
              [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
              [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
            },
            body: JSON.stringify({ operationKey: request.native.operationKey, input }),
          });
          if (!response.ok) return refuse("Host refused native read resolution");
          const descriptor = Schema.decodeUnknownSync(resolvedReadDescriptorSchema)(
            await response.json(),
          );
          resolved.set(descriptor, { session: target.ref.session, openId: target.ref.openId });
          return descriptor;
        } catch (error) {
          return refuse(String(error));
        }
      });
    },
    join(descriptor) {
      return observe(async (signal) => {
        const target = resolved.get(descriptor);
        if (!target) return refuse("Foreign or copied read descriptor");
        try {
          const value = await callHostRpc(
            "revit.detail.space-scene",
            JSON.parse(descriptor.normalizedInput),
            {
              bridgeSessionId: target.session,
              openDocumentId: target.openId,
              signal,
            },
          );
          const { metadata } = decodeScene(await fetchSceneArtifact(value.id, signal));
          const geometryCost = metadata.stamp.geometryCost;
          if (!geometryCost) return refuse("Host geometry cost metadata unavailable");
          const outcome: GeometryOutcome<unknown> = {
            kind: "ready",
            value,
            representation: JSON.parse(descriptor.normalizedInput).contextRepresentation,
            geometryCost,
          };
          return {
            kind: "value" as const,
            value: outcome,
            descriptor,
            cost: {
              elements: value.scene.elements,
              triangles: value.scene.triangles,
              bytes: value.bytes,
              elapsed: value.scene.work.nativeMilliseconds,
            },
          };
        } catch {
          return { kind: "unknown" as const };
        }
      });
    },
  };
}
