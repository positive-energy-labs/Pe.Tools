import { expect, test, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { hostProcessIdentity, sourceHostServiceName } from "@pe/host-contracts/service-identity";
import { checkoutRoot } from "../checkout-paths.ts";
import { devHostProxy, isCheckoutRequest } from "../dev-proxy.ts";

test("same-checkout no-Revit host is distinct; foreign configured owner refuses", () => {
  try {
    const base = sourceHostServiceName(checkoutRoot);
    vi.stubEnv(hostProcessIdentity.serviceNameVariable, `${base}-no-revit`);
    const proxy = new EventEmitter();
    Object.values(devHostProxy("http://127.0.0.1:5180"))[0]!.configure?.(
      proxy as never,
      {} as never,
    );
    const outgoing = { setHeader: vi.fn() };
    proxy.emit("proxyReq", outgoing);
    expect(outgoing.setHeader).toHaveBeenCalledWith("x-pe-runtime-service", `${base}-no-revit`);
    vi.stubEnv(hostProcessIdentity.serviceNameVariable, "host-foreign");
    expect(() => devHostProxy("http://127.0.0.1:5180")).toThrow("checkout");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("every HTTP and websocket proxy request binds this checkout", () => {
  const proxy = new EventEmitter();
  const config = Object.values(devHostProxy("http://127.0.0.1:5180"))[0]!;
  config.configure?.(proxy as never, {} as never);
  const outgoing = { setHeader: vi.fn(), destroy: vi.fn() };
  const request = {
    headers: { host: "127.0.0.1:8123" },
    socket: { localPort: 8123 },
  };
  proxy.emit("proxyReq", outgoing, request);
  proxy.emit("proxyReqWs", outgoing, request, { end: vi.fn() });
  expect(outgoing.setHeader.mock.calls).toEqual([
    ["x-pe-runtime-service", sourceHostServiceName(checkoutRoot)],
    ["x-pe-runtime-service", sourceHostServiceName(checkoutRoot)],
  ]);
  expect(outgoing.destroy).not.toHaveBeenCalled();
});

test("a stale browser page cannot follow a port into another checkout", () => {
  const request = {
    headers: { host: "127.0.0.1:8123", "x-pe-runtime-service": "host-foreign" },
    socket: { localPort: 8123 },
    url: "/call",
  };
  expect(isCheckoutRequest(request)).toBe(false);
  expect(
    isCheckoutRequest({
      ...request,
      headers: { host: "127.0.0.1:8123" },
      url: "/pe/readings?peRuntimeService=host-foreign",
    }),
  ).toBe(false);
});

test("unbound browser API requests refuse before the proxy supplies its owner", async () => {
  const config = Object.values(devHostProxy("http://127.0.0.1:5180"))[0]!;
  const response = { statusCode: 200, end: vi.fn() };
  const req = {
    method: "POST",
    url: "/call",
    headers: { "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" },
  };
  expect(await config.bypass?.(req as never, response as never, config)).toBe(false);
  expect(response.statusCode).toBe(403);
  expect(response.end).toHaveBeenCalled();
});

test("checkout ingress accepts only its bound authority and exact optional Origin", () => {
  const request = (headers: IncomingMessage["headers"]) =>
    ({ headers, socket: { localPort: 8123 } }) as IncomingMessage;
  for (const origin of [undefined, "http://127.0.0.1:8123"])
    expect(isCheckoutRequest(request({ host: "127.0.0.1:8123", origin }))).toBe(true);
  for (const headers of [
    { host: "localhost:8123" },
    { host: "box.tailabc.ts.net" },
    { host: "127.0.0.1:8123", origin: "null" },
    { host: "127.0.0.1:8123", origin: "http://127.0.0.1:8124" },
    { host: "evil.example", "x-forwarded-host": "127.0.0.1:8123" },
  ])
    expect(isCheckoutRequest(request(headers))).toBe(false);
});

test("dev proxy includes MCP and omits the five removed relay routes", () => {
  const [[pattern, proxy]] = Object.entries(devHostProxy("http://127.0.0.1:5180")) as [
    string,
    ReturnType<typeof devHostProxy>[string],
  ][];
  const matches = new RegExp(pattern!);
  for (const path of ["/mcp", "/mcp?x=1", "/call", "/pe/resources", "/api/bridge"])
    expect(matches.test(path), path).toBe(true);
  for (const path of ["/sessions", "/sessions/mint", "/doctor", "/docs", "/docs/recents"])
    expect(matches.test(path), path).toBe(false);
  expect(proxy).toMatchObject({ target: "http://127.0.0.1:5180", changeOrigin: true, ws: true });
});
