import * as contracts from "@pe/agent-contracts";
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
      client: z.enum(["web", "pea", "shared", "host"]),
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

/** The neutral export loader shares the original digest-verified executable import owner. */
export function loadPodHostEntry(value:unknown,expected:string) {
  return admitPodArtifact(value,expected,true);
}
export function admitPodArtifact(value:unknown,expected:string,hostOnly:true):Promise<import("@pe/agent-contracts").HostRouteModule>;
export function admitPodArtifact(value:unknown,expected:string):Promise<AdmittedRoute|HostAdmittedRoute>;
export async function admitPodArtifact(value:unknown,expected:string,hostOnly=false):Promise<AdmittedRoute|HostAdmittedRoute|import("@pe/agent-contracts").HostRouteModule> {
  const evidence=await verifyPodArtifact(value,expected);
  const host=evidence.executables.some(entry=>entry.client === "host");
  if(hostOnly&&!host) throw Error("Expected one closed host.js artifact");
  const client=host?"host":"web",name=host?"host.js":"route.js";
  const entries=evidence.executables.filter(entry=>entry.client===client);
  if(entries.length!==1||entries[0]!.entry!==name||entries[0]!.members.length!==1||entries[0]!.members[0]!.path!==name||
    !host&&evidence.contracts.some(item=>item.id.startsWith("shared:"))) throw Error(`Expected one closed ${name} artifact`);
  const loaded=await import(`data:text/javascript;base64,${Buffer.from(entries[0]!.members[0]!.bytes).toString("base64")}`);
  if(host) {
    const {captureHostModule}=contracts;
    const module=captureHostModule(z.object({module:z.unknown()}).parse(loaded).module as contracts.HostRouteModule);
    if(canonicalRouteJson(module.data)!==canonicalRouteJson(evidence.artifact.data)) throw Error("Host declaration differs from artifact");
    if(hostOnly) return module;
    const port=await createRouteAdmission({...evidence,host:true,loadedBindings:module,
      expectedFingerprint:evidence.wire.fingerprint,catalog:[...linkedCatalog().entries.values()]});
    const result=port.admitHost(module);
    if(!result.ok) throw Error(JSON.stringify(result.diagnostics));
    return result.route;
  }
  const {module}=z.object({module:z.object({data:z.unknown(),entries:z.record(z.string(),z.object({axes:z.unknown()}).passthrough())}).passthrough()}).parse(loaded);
  if("spec" in module) throw Error("Typed Pods require a separate host entry");
  const catalog=requireLinkedCatalog(linkedCatalog().extend(Object.entries(module.entries).map(([key,entry])=>
    commandLink(key,entry as unknown as Command,entry.axes as CatalogAxes,""))));
  const port=await createRouteAdmission({...evidence,loadedBindings:module,expectedFingerprint:evidence.wire.fingerprint,catalog:[...catalog.entries.values()]});
  const result=port.admitUnknown({...module,artifact:evidence.artifact});
  if(!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
