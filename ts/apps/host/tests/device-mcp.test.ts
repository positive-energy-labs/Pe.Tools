import "./device-test-home.ts";
import { expect, test } from "vite-plus/test";
import { createDevices } from "../src/remote-device.ts";
import { admitCrossing, bindControl, grantExpiry, live } from "../src/control.ts";
import { emptyThreadHead, type Caller } from "@pe/agent-contracts";
import { Context } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { deviceRoutes } from "../src/device-routes.ts";
import { deviceListingSchema } from "@pe/host-contracts/pe-api";

test("access-086: paired MCP uses only its human-bound thread grant; revocation fences queued steps", async () => {
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
  const web = HttpRouter.toWebHandler(deviceRoutes(devices), { disableLogger: true });
  const listedRw = async () =>
    deviceListingSchema.parse(
      await (
        await web.handler(new Request("http://host/pe/share/devices"), Context.empty() as never)
      ).json(),
    ).sessions[0]!.rw;
  try {
    expect(await listedRw()).toBe(false);
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
    expect(await listedRw()).toBe(true);
    const expires = head.grant.expiresAt;
    head.grant.expiresAt = new Date(0).toISOString();
    expect(await listedRw()).toBe(false);
    head.grant.expiresAt = expires;
    expect(() =>
      admitCrossing(caller, { kind: "document", ref: { ...lifetime, openId: "other" } }, "test"),
    ).toThrow("grant.other-lifetime");
    devices.revoke(device.id);
    expect(() => admitCrossing(caller, destination, "test")).toThrow("device.revoked");
    expect(live(basis)?.refusal.code).toBe("device.revoked");
    expect(await listedRw()).toBe(false);
  } finally {
    await web.dispose();
  }
});
