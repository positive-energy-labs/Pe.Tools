import { expect, test } from "vite-plus/test";
import type { IncomingMessage } from "node:http";
import { devHostProxy, isCheckoutRequest } from "../dev-proxy.ts";

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
