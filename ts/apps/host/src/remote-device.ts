import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  deviceSessionSchema,
  type DeviceSession,
  type DeviceTransport,
  type Pairing,
} from "@pe/host-contracts/pe-api";
import { Refused } from "./control.ts";
import { hostOwnership } from "./host-ownership.ts";

const persistedSchema = z.strictObject({
  environmentId: z.uuid(),
  sessions: z.array(deviceSessionSchema.extend({ digest: z.string() })),
});
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
export const DEVICE_COOKIE = `pe-device-${hostOwnership.serviceName}`;
const denied = (code: "device.unpaired" | "device.revoked" | "device.pairing", reason: string) =>
  new Refused({
    code,
    door: "device",
    reason,
    remedy: "Ask a human at the host to pair this device in Sharing settings.",
  });

/** One host identity and one credential per device, independent of the connection address. */
export function createDevices(path?: string, now = () => Date.now()) {
  let state =
    path && existsSync(path)
      ? persistedSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : { environmentId: randomUUID(), sessions: [] as Array<DeviceSession & { digest: string }> };
  let pending: (Pairing & { digest: string }) | undefined;
  const save = (next: typeof state) => {
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + ".tmp", JSON.stringify(next), { mode: 0o600 });
      renameSync(path + ".tmp", path);
    }
    state = next;
  };
  if (path && !existsSync(path)) save(state);
  const active = (id: string) => {
    const session = state.sessions.find((row) => row.id === id);
    if (!session)
      throw denied("device.unpaired", "This device is not paired with this environment.");
    if (session.revokedAt || Date.parse(session.expiresAt) <= now())
      throw denied("device.revoked", "This device session was revoked or expired.");
    return session;
  };
  const publicSession = ({ digest: _secret, ...session }: (typeof state.sessions)[number]) =>
    session;
  return {
    active,
    list: () => ({
      environmentId: state.environmentId,
      sessions: state.sessions.map(publicSession),
    }),
    pair(audience: "browser" | "mcp"): Pairing {
      const code = randomBytes(16).toString("hex").match(/.{4}/g)!.join("-");
      const pairing = {
        environmentId: state.environmentId,
        code,
        audience,
        expiresAt: new Date(now() + 5 * 60_000).toISOString(),
      };
      pending = { ...pairing, code: "", digest: digest(code) };
      return pairing;
    },
    claim(code: string, label: string, transport: DeviceTransport, login?: string) {
      if (
        !pending ||
        pending.digest !== digest(code.trim()) ||
        Date.parse(pending.expiresAt) <= now()
      )
        throw denied("device.pairing", "Pairing code is invalid, used, replaced, or expired.");
      const token = randomBytes(32).toString("base64url");
      const session = deviceSessionSchema.parse({
        id: randomUUID(),
        label,
        audience: pending.audience,
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + 30 * 24 * 60 * 60_000).toISOString(),
        revokedAt: null,
        lastSeenAt: null,
        transports: [transport],
        login,
        thread: null,
      });
      save({ ...state, sessions: [...state.sessions, { ...session, digest: digest(token) }] });
      pending = undefined;
      return { environmentId: state.environmentId, session, token };
    },
    authenticate(token: string, transport: DeviceTransport, login?: string) {
      const found = state.sessions.find((row) => row.digest === digest(token));
      if (!found)
        throw denied("device.unpaired", "The device credential is unknown to this environment.");
      const session = active(found.id);
      if (login && session.login && login !== session.login)
        throw denied("device.unpaired", "This device credential belongs to another tailnet login.");
      const updated = {
        ...session,
        lastSeenAt: new Date(now()).toISOString(),
        transports: [...new Set([...session.transports, transport])],
      };
      // Persist transport changes, throttle last-seen writes to once per minute.
      if (
        !session.transports.includes(transport) ||
        !session.lastSeenAt ||
        now() - Date.parse(session.lastSeenAt) >= 60_000
      )
        save({
          ...state,
          sessions: state.sessions.map((row) => (row.id === session.id ? updated : row)),
        });
      return publicSession(updated);
    },
    revoke(id: string) {
      const session = state.sessions.find((row) => row.id === id);
      if (!session) throw denied("device.unpaired", "Unknown device session.");
      save({
        ...state,
        sessions: state.sessions.map((row) =>
          row.id === id ? { ...row, revokedAt: new Date(now()).toISOString(), thread: null } : row,
        ),
      });
    },
    bind(id: string, thread: string | null) {
      const session = active(id);
      if (session.audience !== "mcp")
        throw denied("device.pairing", "Only an MCP device binds a thread grant.");
      save({
        ...state,
        sessions: state.sessions.map((row) => (row.id === id ? { ...row, thread } : row)),
      });
    },
  };
}
export type Devices = ReturnType<typeof createDevices>;

export function deviceCredential(headers: Readonly<Record<string, string | undefined>>) {
  const bearer = headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  const cookie = headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1);
  return bearer
    ? { token: bearer, audience: "mcp" as const }
    : cookie
      ? { token: cookie, audience: "browser" as const }
      : undefined;
}
