import "./device-test-home.ts";
import { expect, test } from "vite-plus/test";
import {
  readRequestIdentity,
  requestIdentityLayer,
  type IdentityOptions,
} from "../src/request-identity.ts";
import { remoteListener } from "../src/remote-ingress.ts";
import { deviceRoutes } from "../src/device-routes.ts";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { Effect, Layer, Deferred } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { createDevices, DEVICE_COOKIE } from "../src/remote-device.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";

const options: IdentityOptions = {
  port: () => 5180,
  frontendOrigin: () => undefined,
  share: {
    observe: () => {},
    read: async () => ({
      desired: "on",
      state: "on",
      url: "https://box.tailabc.ts.net",
      allowRemoteAdministration: false,
      refusal: null,
      callers: [],
      refused: [],
    }),
  },
};
const remote = { host: "box.tailabc.ts.net", "tailscale-user-login": "person@example.com" };

test("pairing uses eight unambiguous characters and expires at two minutes", () => {
  let now = Date.now();
  const devices = createDevices(undefined, () => now);
  const pairing = devices.pair("browser");
  expect(Date.parse(pairing.expiresAt) - now).toBe(120_000);
  expect(pairing.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  now += 120_000;
  expect(() => devices.claim(pairing.code, "Laptop", "lan")).toThrow("device.pairing");
});

test("five wrong attempts exhaust a code across transports, including the correct sixth attempt", () => {
  const devices = createDevices();
  const pairing = devices.pair("browser");
  for (let index = 0; index < 5; index++)
    expect(() => devices.claim("WRONG", "Laptop", index % 2 ? "ssh" : "lan")).toThrow(
      "device.pairing",
    );
  expect(() => devices.claim(pairing.code, "Laptop", "tailnet")).toThrow("attempt");
  const renewed = devices.pair("browser");
  expect(devices.claim(renewed.code.toLowerCase(), "Laptop", "lan").session.label).toBe("Laptop");
});

test("a dedicated SSH ingress cannot claim local human authority by changing Host", async () => {
  expect(
    await readRequestIdentity(
      { host: "127.0.0.1:5180", accept: "text/html", "sec-fetch-mode": "navigate" },
      "/",
      options,
      "GET",
      false,
      "127.0.0.1",
      true,
    ),
  ).toMatchObject({ refusal: { code: "identity.host" } });
});

test("remote listener marks real loopback tunnel requests before the identity middleware", async () => {
  const server = createServer();
  const requests = new WeakSet<object>();
  const remoteServer = remoteListener(server, requests);
  const devices = createDevices();
  const device = devices.claim(devices.pair("browser").code, "Tunnel browser", "ssh");
  const port = () => (server.address() as { port: number }).port;
  const latch = Effect.runSync(Deferred.make<void>());
  const listening = once(server, "listening");
  const done = Effect.runPromise(
    Effect.raceFirst(
      Layer.launch(
        HttpRouter.serve(
          Layer.mergeAll(
            requestIdentityLayer({
              ...options,
              port,
              devices,
              remoteRequests: requests,
              remoteIngress: [{ origin: "http://ssh.test:65180", transport: "ssh" }],
            }),
            deviceRoutes(devices),
            HttpRouter.add("GET", "/pe/threads", () =>
              Effect.succeed(HttpServerResponse.jsonUnsafe({ admitted: true })),
            ),
          ),
          { disableLogger: true },
        ).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 }))),
      ),
      Deferred.await(latch),
    ),
  );
  await listening;
  const address = (await remoteServer.start("127.0.0.1", 0)) as { port: number };
  const read = (host: string, cookie?: string) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${address.port}/pe/threads`,
        { headers: { host, ...(cookie ? { cookie } : {}) } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
  try {
    const invalidPair = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${address.port}/pe/pair`,
        {
          method: "POST",
          headers: { host: "ssh.test:65180", "content-type": "application/json" },
        },
        (res) => {
          let body = "";
          res.on("data", (data) => {
            body += data;
          });
          res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ code: "invalid", label: "Unpaired" }));
    });
    expect(invalidPair.status).toBe(403);
    expect(invalidPair.body).toMatchObject({ error: { code: "device.pairing" } });
    expect(await read(`127.0.0.1:${port()}`)).toBe(403);
    expect(await read("ssh.test:65180")).toBe(403);
    expect(await read("ssh.test:65180", `${DEVICE_COOKIE}=${device.token}`)).toBe(200);
    devices.revoke(device.session.id);
    expect(await read("ssh.test:65180", `${DEVICE_COOKIE}=${device.token}`)).toBe(403);
  } finally {
    await remoteServer.close();
    server.closeAllConnections();
    Effect.runSync(Deferred.succeed(latch, undefined));
    await done;
  }
});

test("access-084: an unpaired remote device cannot read host state", async () => {
  expect(await readRequestIdentity(remote, "/pe/threads", options)).toMatchObject({
    refusal: { code: "device.unpaired" },
  });
});

test("access-084: remote navigation never bootstraps a human browser context", async () => {
  const result = await readRequestIdentity(
    { ...remote, accept: "text/html", "sec-fetch-mode": "navigate" },
    "/",
    options,
  );
  expect(result).not.toHaveProperty("setCookie");
});

test("access-084: one device persists across LAN, tailnet and SSH; revoke refuses its next request", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-k-device-"));
  try {
    const path = join(root, "devices.json");
    let devices = createDevices(path);
    const pairing = devices.pair("browser");
    const claimed = devices.claim(
      pairing.code,
      "Office laptop",
      "tailnet",
      remote["tailscale-user-login"],
    );
    expect(() => devices.claim(pairing.code, "Replay", "tailnet")).toThrow("device.pairing");
    expect(readFileSync(path, "utf8")).not.toContain(claimed.token);
    devices = createDevices(path);
    expect(devices.list().environmentId).toBe(pairing.environmentId);
    const settings = {
      ...options,
      devices,
      remoteIngress: [
        { origin: "http://office.lan:5180", transport: "lan" as const },
        { origin: "http://localhost:65180", transport: "ssh" as const },
      ],
    };
    for (const host of [remote.host, "office.lan:5180", "localhost:65180"]) {
      const result = await readRequestIdentity(
        {
          ...(host === remote.host ? remote : { host }),
          cookie: `${DEVICE_COOKIE}=${claimed.token}`,
        },
        "/pe/threads",
        settings,
      );
      expect(result).toMatchObject({
        device: claimed.session.id,
        caller: { kind: "human", device: claimed.session.id },
      });
    }
    expect(devices.list().sessions).toHaveLength(1);
    expect(devices.list().sessions[0]?.transports).toEqual(["tailnet", "lan", "ssh"]);
    devices.revoke(claimed.session.id);
    expect(
      await readRequestIdentity(
        { ...remote, cookie: `${DEVICE_COOKIE}=${claimed.token}` },
        "/pe/threads",
        settings,
      ),
    ).toMatchObject({ refusal: { code: "device.revoked" } });
    expect(() => createDevices(path).authenticate(claimed.token, "ssh")).toThrow("device.revoked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("access-005/006: paired remote browser cannot grant rw or reach local pairing administration", async () => {
  const devices = createDevices();
  const claimed = devices.claim(devices.pair("browser").code, "Laptop", "tailnet");
  const headers = {
    ...remote,
    cookie: `${DEVICE_COOKIE}=${claimed.token}`,
    [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
  };
  expect(
    await readRequestIdentity(headers, "/pe/scope/thread", { ...options, devices }, "PUT"),
  ).toMatchObject({ refusal: { code: "identity.remote-administration" } });
  expect(
    await readRequestIdentity(headers, "/pe/share/pair", { ...options, devices }, "POST"),
  ).toHaveProperty("refusal");
});

test("access-029/030: shared content navigation never grants host control", async () => {
  expect(
    await readRequestIdentity(
      { ...remote, accept: "text/html", "sec-fetch-mode": "navigate" },
      "/pages/example/",
      options,
    ),
  ).toMatchObject({ caller: { kind: "anonymous" } });
  expect(await readRequestIdentity(remote, "/pages/example/act", options, "POST")).toMatchObject({
    refusal: { code: "device.unpaired" },
  });
});

test("pairing expires, and credentials cannot cross browser/MCP audiences or tailnet users", async () => {
  let now = Date.now();
  const devices = createDevices(undefined, () => now);
  const expired = devices.pair("browser");
  now += 5 * 60_000;
  expect(() => devices.claim(expired.code, "Laptop", "lan")).toThrow("device.pairing");
  const claimed = devices.claim(devices.pair("browser").code, "Laptop", "tailnet", "owner");
  expect(() => devices.authenticate(claimed.token, "tailnet", "stranger")).toThrow(
    "device.unpaired",
  );
  expect(
    await readRequestIdentity(
      { ...remote, "tailscale-user-login": "owner", authorization: `Bearer ${claimed.token}` },
      "/mcp",
      { ...options, devices },
      "POST",
    ),
  ).toMatchObject({ refusal: { code: "device.unpaired" } });
});
