import "./device-test-home.ts";
import { expect, test } from "vite-plus/test";
import { createDevices } from "../src/remote-device.ts";
import { admitCrossing, bindControl, live } from "../src/control.ts";
import type { Caller, ThreadHead } from "@pe/agent-contracts";
import { Context } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { deviceRoutes } from "../src/device-routes.ts";
import { deviceListingSchema } from "@pe/host-contracts/pe-api";

test("access-086: paired MCP writes only its bound thread's human-added targets; revocation fences queued steps", async () => {
  const devices = createDevices();
  const device = devices.claim(devices.pair("mcp").code, "External app", "lan").session;
  const lifetime = { session: "S", openId: "D" };
  const head: ThreadHead = {
    targets: [
      {
        request: { kind: "open", ref: lifetime },
        admission: { revision: 4, at: new Date().toISOString(), via: "local" },
      },
    ],
    revision: 4,
  };
  // Full access is Pea's switch, never an external device's.
  bindControl({
    heads: () => head,
    deviceThread: (id: string) => devices.active(id).thread,
    fullAccess: () => true,
  });
  const web = HttpRouter.toWebHandler(deviceRoutes(devices), { disableLogger: true });
  const listedRw = async () =>
    deviceListingSchema.parse(
      await (
        await web.handler(new Request("http://host/pe/share/devices"), Context.empty() as never)
      ).json(),
    ).sessions[0]!.writes;
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
    expect(() =>
      admitCrossing(caller, { kind: "document", ref: { ...lifetime, openId: "other" } }, "test"),
    ).toThrow("grant.required");
    devices.revoke(device.id);
    expect(() => admitCrossing(caller, destination, "test")).toThrow("device.revoked");
    expect(live(basis)?.refusal.code).toBe("device.revoked");
    expect(await listedRw()).toBe(false);
  } finally {
    await web.dispose();
  }
});
