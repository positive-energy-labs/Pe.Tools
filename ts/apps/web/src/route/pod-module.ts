import { z } from "zod";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import type { PodRouteDescriptor } from "@pe/agent-contracts";
import { podArtifactInput, evaluatePodBytes } from "./pod-artifact.ts";
import { verifyRouteArtifact } from "./route-artifact.ts";
/** Authenticated bytes export the same route({...}) module a builtin exports. */
export async function loadPodRoute(
  row: PodRouteDescriptor,
  value: unknown,
  evaluate = evaluatePodBytes,
) {
  const input = podArtifactInput(row, value);
  const verified = await verifyRouteArtifact(
    input,
    [...linkedCatalog().entries.values()],
    evaluate,
  );
  const loaded = z
    .object({
      spec: z
        .object({
          key: z.string(),
          fields: z.record(z.string(), z.unknown()),
          panes: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
      data: z.unknown(),
      host: z.object({ data: z.unknown() }).passthrough(),
      entries: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .parse(verified.module);
  if (loaded.spec.key !== row.workRoute) throw Error("Pod module key differs from inventory");
  const host = captureHostModule(
    loaded.host as unknown as import("@pe/agent-contracts").HostRouteModule,
  );
  if (canonicalRouteJson(host.data) !== canonicalRouteJson(verified.artifact.data))
    throw Error("Typed host declaration differs from artifact");
  return {
    module: loaded as unknown as import("./typed-route.ts").TypedRoute,
    fingerprint: workFingerprintSchema.parse(row.fingerprint),
  };
}
import { workFingerprintSchema, captureHostModule, canonicalRouteJson } from "@pe/agent-contracts";
