import { z } from "zod";
import { sdkSchema } from "@pe/host-contracts/decoders";
import { DOCUMENT_IDENTITY_AUTHORITY } from "@pe/host-contracts/contracts";
import type { NativeNotice } from "@pe/host-contracts/native-adapter";
import type { DiscoveryMachine } from "./discovery-machine.ts";
import { providerSchema } from "./provider.ts";
import { addressSchema, documentRefSchema, type TargetInventory } from "./target.ts";

/** Last confirmed data lives in the field; a failed attempt changes only this evidence. */
export const machineLegSchema = z
  .object({
    observedAtUtc: z.string().nullable(),
    attemptedAtUtc: z.string().nullable(),
    error: z.string().nullable(),
  })
  .readonly();
const processSchema = sdkSchema("ProcessIdentity").pick({ pid: true, processStartUtc: true });
export const machinePeerSchema = z
  .object({
    serviceName: z.string(),
    instanceId: z.string(),
    version: z.string(),
    sourceRoot: z.string().nullable(),
    process: processSchema,
    url: z.string(),
    reachable: z.boolean(),
  })
  .readonly();
export const machineHostSchema = z
  .object({
    /** Host/Revit ownership only; never a code-freshness claim. */
    runtimeMatch: z.enum(["verified", "disconnected", "unknown", "refused"]).optional(),
    runtimeRefusal: z.string().nullable().optional(),
    installedRoot: z.string().nullable().optional(),
    serviceName: z.string(),
    instanceId: z.string(),
    version: z.string(),
    payload: z.enum(["installed", "checkout"]),
    process: processSchema,
    port: z.number(),
    /** The service record cannot distinguish login, icon and command launches. */
    startedBy: z.enum(["login", "icon", "command"]).nullable(),
    autostart: z.enum(["on", "off", "disabled-in-windows"]).nullable(),
    /** Enforced Windows RedirectionGuard also prevents harness children traversing user junctions. */
    redirectionTrust: z.enum(["enforced", "audit", "off"]).nullable(),
    sourceRoot: z.string().nullable(),
    uptimeSeconds: z.number(),
    canonicalUrl: z.string(),
    peers: z.array(machinePeerSchema).readonly(),
  })
  .readonly();

/** Host-owned access evidence (ADR 0017/0021), never a substitute for run consent. */
export const machineAccessSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("pea"), acquisition: z.string() }),
    z.object({ kind: z.literal("read") }),
    z.object({ kind: z.literal("target"), thread: z.string(), label: z.string() }),
  ])
  .readonly();
/** Defer the shared ref schema while target discovery loads the Machine contract. */
export const machineAttachmentDocumentSchema = z
  .intersection(
    z.lazy(() => documentRefSchema),
    z.object({
      title: z.string(),
      address: z.string().nullable(),
      isFamilyDocument: z.boolean(),
      isActive: z.boolean(),
      access: machineAccessSchema,
    }),
  )
  .readonly();
/** Product socket evidence, not SDK custody. */
export const machineAttachmentSchema = z
  .object({
    session: z.string(),
    pid: z.number(),
    processStartUtcUnixMs: z.number().nullable(),
    /** Null means the payload has not attested SDK openId identity, so it cannot write. */
    documentIdentity: z.literal(DOCUMENT_IDENTITY_AUTHORITY).nullable(),
    documents: z.array(machineAttachmentDocumentSchema).readonly().nullable(),
  })
  .readonly();
export const machineSessionSchema = z
  .object({
    /** Acquisition provenance, never write authority. */
    whose: z.enum(["you", "pea"]),
    row: sdkSchema("SessionObservation"),
    attachment: machineAttachmentSchema.nullable(),
    /** Observed SDK documents have no persistence metadata. */
    documents: z
      .array(
        z.union([
          sdkSchema("DocumentInfo"),
          sdkSchema("SessionDocument").extend({ persistence: z.null() }),
        ]),
      )
      .readonly()
      .nullable(),
    documentsLeg: machineLegSchema,
    /** Null is unread, never an empty holdings census. */
    holdings: z.array(sdkSchema("DocumentHoldings")).readonly().nullable(),
    holdingsLeg: machineLegSchema,
  })
  .readonly();
export const machineUpdateSchema = z
  .object({
    plan: sdkSchema("UpdatePlan").nullable(),
    receipt: sdkSchema("UpdateReceipt").nullable(),
    requestId: z.string().nullable(),
    admittedPlanId: z.string().nullable(),
    planLeg: machineLegSchema,
    receiptLeg: machineLegSchema,
    automatic: z.boolean(),
  })
  .readonly();
/** Desired sharing intent never proves an active mapping. */
export const machineShareSchema = z
  .object({
    allowRemoteAdministration: z.boolean(),
    desired: z.enum(["off", "on"]),
    state: z.enum(["off", "on", "refused", "unknown", "needs-tailscale"]),
    url: z.string().nullable(),
    refusal: z.object({ code: z.string(), detail: z.string() }).readonly().nullable(),
    callers: z
      .array(
        z
          .object({ login: z.string(), lastAtUtc: z.string(), door: z.enum(["web", "pe", "mcp"]) })
          .readonly(),
      )
      .readonly(),
    refused: z
      .array(z.object({ atUtc: z.string(), code: z.string(), from: z.string() }).readonly())
      .readonly(),
  })
  .readonly();
export const machineProviderSchema = providerSchema;
export const machineSchema = z
  .object({
    observedAtUtc: z.string(),
    host: machineHostSchema.nullable(),
    revit: z
      .object({
        years: z.array(z.number()).readonly().nullable(),
        sessions: z.array(machineSessionSchema).readonly().nullable(),
        unclassifiedAttachments: z.array(machineAttachmentSchema).readonly(),
      })
      .readonly(),
    update: machineUpdateSchema,
    share: machineShareSchema.nullable(),
    providers: z.array(machineProviderSchema).readonly().nullable(),
    legs: z.record(z.string(), machineLegSchema).readonly(),
  })
  .readonly();

export type MachineLeg = z.infer<typeof machineLegSchema>;
export type MachinePeer = z.infer<typeof machinePeerSchema>;
export type MachineHost = z.infer<typeof machineHostSchema>;
export type MachineAccess = z.infer<typeof machineAccessSchema>;
export type MachineAttachmentDocument = z.infer<typeof machineAttachmentDocumentSchema>;
export type MachineAttachment = z.infer<typeof machineAttachmentSchema>;
export type MachineSession = z.infer<typeof machineSessionSchema>;
export type MachineUpdate = z.infer<typeof machineUpdateSchema>;
export type MachineShare = z.infer<typeof machineShareSchema>;
export type MachineProvider = z.infer<typeof machineProviderSchema>;
export type Machine = z.infer<typeof machineSchema>;
/** A tray projection of one receipt revision; the native adapter owns its wire contract. */
export type MachineNotice = NativeNotice;

/** Resolver view of the host's evidence; an unread or failed leg never proves absence. */
export function machineInventory(machine: Machine | DiscoveryMachine | undefined): TargetInventory {
  if (!machine || machine.revit.sessions === null) return { kind: "checking" };
  for (const key of ["sessions", "attachments"]) {
    const leg = machine.legs[key];
    if (leg?.error) return { kind: "failed", message: leg.error };
    if (!leg?.observedAtUtc) return { kind: "checking" };
  }
  const attachments = [
    ...machine.revit.sessions.flatMap((s) => (s.attachment ? [s.attachment] : [])),
    ...machine.revit.unclassifiedAttachments,
  ];
  return {
    kind: "ready",
    sessions: Object.fromEntries(
      attachments.map((attachment) => {
        const execution = machine.revit.sessions!.find(
          (s) => s.attachment?.session === attachment.session,
        )?.row.execution;
        return [
          attachment.session,
          attachment.documents === null
            ? { kind: "checking" }
            : execution?.allowed !== true
              ? {
                  kind: "failed",
                  message: execution?.detail ?? "Runtime ownership is not verified",
                }
              : {
                  kind: "ready",
                  values: attachment.documents.map((doc) => ({
                    openId: doc.openId,
                    address: addressSchema.safeParse(doc.address).data ?? null,
                    kind: doc.isFamilyDocument ? "family" : "project",
                  })),
                },
        ];
      }),
    ),
  };
}
