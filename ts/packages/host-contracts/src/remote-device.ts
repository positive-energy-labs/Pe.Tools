import { z } from "zod";

export const deviceTransportSchema = z.enum(["lan", "tailnet", "ssh"]);
export const remoteIngressSchema = z.strictObject({
  origin: z.url(),
  transport: z.enum(["lan", "ssh"]),
});
export const deviceSessionSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().min(1).max(80),
  audience: z.enum(["browser", "mcp"]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  transports: z.array(deviceTransportSchema),
  login: z.string().optional(),
  thread: z.string().nullable(),
});
export const deviceListingSchema = z.strictObject({
  environmentId: z.uuid(),
  sessions: z.array(deviceSessionSchema),
});
export const pairingSchema = z.strictObject({
  environmentId: z.uuid(),
  code: z.string(),
  expiresAt: z.iso.datetime(),
  audience: z.enum(["browser", "mcp"]),
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type DeviceListing = z.infer<typeof deviceListingSchema>;
export type Pairing = z.infer<typeof pairingSchema>;
export type DeviceTransport = z.infer<typeof deviceTransportSchema>;
