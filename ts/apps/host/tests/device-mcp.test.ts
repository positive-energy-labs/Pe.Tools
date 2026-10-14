import { expect, test } from "vite-plus/test";
import { createDevices } from "../src/remote-device.ts";
import { admitCrossing, bindControl, grantExpiry, live } from "../src/control.ts";
import { emptyThreadHead, type Caller } from "@pe/agent-contracts";

test("access-086: paired MCP uses only its human-bound thread grant; revocation fences queued steps", () => {
  const devices = createDevices();
  const device = devices.claim(devices.pair("mcp").code, "External app", "lan").session;
  const lifetime = { session: "S", openId: "D" };
  const head = {
    ...emptyThreadHead,
    revision: 4,
    grant: {
      lifetime,
      grantedAt: new Date().toISOString(),
      grantedVia: "local" as const,
      expiresAt: grantExpiry(Date.now()),
      revoked: null,
    },
  };
  bindControl({ heads: () => head, deviceThread: (id: string) => devices.active(id).thread });
  const caller = {
    kind: "external-mcp",
    context: "external",
    label: "External app",
    device: device.id,
  } as Caller;
  const destination = { kind: "document" as const, ref: lifetime };
  expect(() => admitCrossing(caller, destination, "test")).toThrow();
  devices.bind(device.id, "human-thread");
  const basis = admitCrossing(caller, destination, "test");
  expect(basis).toMatchObject({ kind: "grant", thread: "human-thread", device: device.id });
  expect(live(basis)).toBeNull();
  expect(() =>
    admitCrossing(caller, { kind: "document", ref: { ...lifetime, openId: "other" } }, "test"),
  ).toThrow("grant.other-lifetime");
  devices.revoke(device.id);
  expect(() => admitCrossing(caller, destination, "test")).toThrow("device.revoked");
  expect(live(basis)?.refusal.code).toBe("device.revoked");
});
