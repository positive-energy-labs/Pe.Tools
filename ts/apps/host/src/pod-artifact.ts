import {canonicalRouteJson, type HostAdmittedRoute} from "@pe/agent-contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { commandLink, linkedCatalog, requireLinkedCatalog, type CatalogAxes } from "@pe/agent-contracts/pe-api";
import type { Command } from "@pe/agent-contracts";
import {
  createRouteAdmission,
  routeFingerprint,
  type AdmittedRoute,
} from "../../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";

const bytes = z.array(z.number().int().min(0).max(255));
/** JSON transports octets, never the lossy object serialization of a Uint8Array. */
export const podArtifactSchema = z.strictObject({
  artifact: z.object({
    version: z.literal(1),
    data: z.unknown(),
    contracts: z.array(z.unknown()),
    executables: z.array(z.unknown()),
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contracts: z.array(z.strictObject({ id: z.string(), bytes })),
  executables: z.array(
    z.strictObject({
      client: z.enum(["web", "pea", "shared"]),
      entry: z.string(),
      resolved: z.boolean(),
      members: z.array(z.strictObject({ path: z.string(), bytes })),
    }),
  ),
});
export type PodArtifact = z.infer<typeof podArtifactSchema>;
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Verify the whole closure before any package code executes. Member SHA is not route identity. */
export async function verifyPodArtifact(value: unknown, expected: string) {
  const wire = podArtifactSchema.parse(value);
  const contracts = wire.contracts.map((item) => ({ ...item, bytes: Uint8Array.from(item.bytes) }));
  const executables = wire.executables.map((item) => ({
    ...item,
    members: item.members.map((member) => ({ ...member, bytes: Uint8Array.from(member.bytes) })),
  }));
  const artifact = wire.artifact as RouteFingerprintInput;
  const actual = {
    version: 1 as const,
    data: artifact.data,
    contracts: contracts.map((item) => ({ id: item.id, sha256: sha(item.bytes) })),
    executables: executables.map((item) => ({
      client: item.client,
      entry: item.entry,
      members: item.members.map((member) => ({ path: member.path, sha256: sha(member.bytes) })),
    })),
  };
  if (
    executables.some((item) => !item.resolved) ||
    (await routeFingerprint(artifact)) !== wire.fingerprint ||
    (await routeFingerprint(actual)) !== wire.fingerprint ||
    expected !== `pod-bytes:${wire.fingerprint}`
  )
    throw Error("Pod artifact bytes or fingerprint differ");
  return { wire, artifact, contracts, executables };
}

export async function admitPodArtifact(value: unknown, expected: string): Promise<AdmittedRoute | HostAdmittedRoute> {
  const evidence = await verifyPodArtifact(value, expected);
  const web = evidence.executables.filter((item) => item.client === "web");
  if (
    web.length !== 1 ||
    web[0]!.entry !== "route.js" ||
    web[0]!.members.length !== 1 ||
    web[0]!.members[0]!.path !== "route.js" ||
    evidence.contracts.some((item) => item.id.startsWith("shared:"))
  )
    throw Error("Host requires one closed route.js artifact without shared runtime imports");
  const loaded = await import(
    `data:text/javascript;base64,${Buffer.from(web[0]!.members[0]!.bytes).toString("base64")}`
  );
  const { module } = z
    .object({
      module: z
        .object({
          data: z.unknown(),
          entries: z.record(z.string(), z.object({ axes: z.unknown() }).passthrough()),
        })
        .passthrough(),
    })
    .parse(loaded);
  const catalog = requireLinkedCatalog(linkedCatalog().extend(
    Object.entries(module.entries).map(([key, entry]) =>
      commandLink(key, entry as unknown as Command, entry.axes as CatalogAxes, "")),
  ));
  if ("spec" in module) {
    const typed=z.object({host:z.unknown()}).parse(module);
    const {captureHostModule}=await import("@pe/agent-contracts");
    const host=captureHostModule(typed.host as import("@pe/agent-contracts").HostRouteModule);
    if (canonicalRouteJson(host.data) !== canonicalRouteJson(evidence.artifact.data))
      throw Error("Typed host declaration differs from artifact");
    const port=await createRouteAdmission({...evidence,host:true,loadedBindings:host,
      expectedFingerprint:evidence.wire.fingerprint,catalog:[...catalog.entries.values()]});
    const result=port.admitHost(host);
    if(!result.ok) throw Error(JSON.stringify(result.diagnostics));
    return result.route;
  }
  const port = await createRouteAdmission({
    ...evidence,
    loadedBindings: module,
    expectedFingerprint: evidence.wire.fingerprint,
    catalog: [...catalog.entries.values()],
  });
  const result = port.admitUnknown({ ...module, artifact: evidence.artifact });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
