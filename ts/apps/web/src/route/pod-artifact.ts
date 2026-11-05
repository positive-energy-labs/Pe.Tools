import { z } from "zod";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import type { PodRouteDescriptor } from "@pe/agent-contracts";
import { loadRouteArtifact, type RouteArtifactBytes } from "./route-artifact.ts";
import { podRoutePath } from "./pod-address.ts";

const octets = z.array(z.number().int().min(0).max(255));
const envelope = z.object({
  fingerprint: z.string(),
  artifact: z.object({
    fingerprint: z.string(),
    artifact: z.object({
      version: z.literal(1),
      data: z.unknown(),
      contracts: z.array(z.unknown()),
      executables: z.array(z.unknown()),
    }),
    contracts: z.array(z.object({ id: z.string(), bytes: octets })),
    executables: z.array(
      z.object({
        client: z.enum(["web", "pea", "shared"]),
        entry: z.string(),
        resolved: z.boolean(),
        members: z.array(z.object({ path: z.string(), bytes: octets })),
      }),
    ),
  }),
});

/** Inventory is authority. The response stamps are consistency metadata only; the
 * existing loader recomputes every contract/member digest before evaluating bytes. */
export async function admitPodArtifact(
  row: PodRouteDescriptor,
  value: unknown,
  evaluate = evaluatePodBytes,
) {
  if (!row.trusted) throw Error("Trust this Pod fingerprint before loading.");
  const wire = envelope.parse(value);
  const identity = z.object({ key: z.string(), address: z.string() }).parse(wire.artifact.artifact.data);
  if (identity.key !== row.workRoute || identity.address !== podRoutePath(row.key))
    throw Error("Pod route identity differs from inventory");
  if (
    wire.fingerprint !== row.fingerprint ||
    `pod-bytes:${wire.artifact.fingerprint}` !== row.fingerprint
  )
    throw Error("Pod artifact fingerprint differs from inventory");
  const input: RouteArtifactBytes = {
    ...wire.artifact,
    artifact: wire.artifact.artifact as RouteArtifactBytes["artifact"],
    fingerprint: row.fingerprint.slice("pod-bytes:".length),
    contracts: wire.artifact.contracts.map((item) => ({
      ...item,
      bytes: Uint8Array.from(item.bytes),
    })),
    executables: wire.artifact.executables.map((item) => ({
      ...item,
      members: item.members.map((member) => ({ ...member, bytes: Uint8Array.from(member.bytes) })),
    })),
  };
  // loadRouteArtifact owns createRouteAdmission -> admitUnknown. Never mint a second handle.
  const result = await loadRouteArtifact(input, [...linkedCatalog().entries.values()], evaluate);
  if (!result.ok) throw Error(result.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; "));
  return result.route;
}

export async function evaluatePodBytes(bytes: Uint8Array): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
