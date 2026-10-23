import { hostProcessIdentity, sourceHostServiceName } from "@pe/host-contracts/service-identity";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { expect, test, vi } from "vite-plus/test";
import { checkoutRoot } from "../checkout-paths.ts";
import {
  checkoutIngress,
  checkoutServiceName,
  devHostProxy,
  isCheckoutRequest,
  readHostRequest,
} from "../dev-proxy.ts";

test("borrowed host mode changes only web identity and permits Ducts reads, never writes", () => {
  try {
    vi.stubEnv("PE_WEB_READ_HOST_CHECKOUT", checkoutRoot);
    vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:12345");
    expect(checkoutServiceName()).toBe(sourceHostServiceName(checkoutRoot));
    expect(readHostRequest("GET", "/pe/resources?keys=[]")).toBe(true);
    expect(readHostRequest("POST", "/call", { key: "ducts.snapshot", request: {} })).toBe(true);
    expect(readHostRequest("POST", "/call", { key: "ducts.tables", request: {} })).toBe(true);
    for (const [method, path, body] of [
      ["POST", "/call", { key: "ducts.apply" }],
      ["POST", "/pe/route-state/ducts/apply", {}],
      ["POST", "/host/shutdown", {}],
      ["GET", "/pe/route-state/ducts/salvage", undefined],
      ["GET", "/api/bridge", undefined],
    ] as const)
      expect(readHostRequest(method, path, body)).toBe(false);
    vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "https://remote.example");
    expect(checkoutServiceName).toThrow("127.0.0.1");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("borrowed frontend forwards reads with host origin and refuses mutations before dispatch", async () => {
  const { createServer: createVite } = await import("vite-plus");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "pe-borrowed-proxy-"));
  const forwarded: { url?: string; origin?: string; referer?: string; body: string }[] = [];
  const backend = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    forwarded.push({
      url: req.url,
      origin: req.headers.origin,
      referer: req.headers.referer,
      body,
    });
    res.end("read");
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const target = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  vi.stubEnv("PE_WEB_READ_HOST_CHECKOUT", checkoutRoot);
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", target);
  const vite = await createVite({
    configFile: false,
    root,
    plugins: [checkoutIngress()],
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent",
  });
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`;
    const headers = {
      origin,
      referer: `${origin}/ducts`,
      "content-type": "application/json",
      "x-pe-runtime-service": checkoutServiceName(),
    };
    const send = (key: string) =>
      fetch(`${origin}/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, request: {} }),
      });
    expect((await send("ducts.snapshot")).status).toBe(200);
    expect(forwarded).toEqual([
      {
        url: "/call",
        origin: target,
        referer: `${target}/ducts`,
        body: JSON.stringify({ key: "ducts.snapshot", request: {} }),
      },
    ]);
    for (const key of ["ducts.apply", "script.execute", "revit.context.show-elements"])
      expect((await send(key)).status).toBe(403);
    for (const path of ["/admin/shutdown", "/pe/route-state/ducts/apply", "/api/bridge"])
      expect((await fetch(`${origin}${path}`, { method: "POST", headers })).status).toBe(403);
    expect(forwarded).toHaveLength(1);
  } finally {
    await vite.close();
    backend.close();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

test("access-053/036: dev SPA navigation forwards the host's minted cookie; Page iframes never mint", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { "set-cookie": "pe-browser-owner=host-minted; HttpOnly" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv(hostProcessIdentity.hostBaseUrlVariable, "http://127.0.0.1:5180");
  const use = vi.fn();
  const plugin = checkoutIngress();
  if (typeof plugin.configureServer !== "function") throw Error("missing ingress");
  await plugin.configureServer.call({} as never, { middlewares: { use } } as never);
  const middleware = use.mock.calls[0]![0];
  const response = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  const request = {
    method: "GET",
    url: "/pea",
    socket: { localPort: 8123 },
    headers: {
      host: "127.0.0.1:8123",
      accept: "text/html",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  };
  try {
    await middleware(request, response, next);
    expect(response.setHeader).toHaveBeenCalledWith(
      "set-cookie",
      "pe-browser-owner=host-minted; HttpOnly",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    fetch.mockClear();
    await middleware(
      {
        ...request,
        url: "/pages/probe/",
        headers: { ...request.headers, "sec-fetch-dest": "iframe" },
      },
      response,
      next,
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

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

/**
 * F2 (acceptance 2026-10-13): through the checkout frontend a Page navigation and its `<script>`
 * and `<link>` loads carry no runtime marker (a browser cannot add a header to them), so the guard
 * refused them. The host writes its own marker into the pe.js it serves and every request pe.js
 * makes carries it, so Page documents and static assets pass; every API door keeps the guard.
 */
test("the real proxy forwards Page documents and assets and still refuses unmarked API requests", async () => {
  const { createServer: createVite } = await import("vite-plus");
  const { createServer, request } = await import("node:http");
  const { once } = await import("node:events");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const forwarded: string[] = [];
  const backend = createServer((req, res) => {
    forwarded.push(`${req.method} ${req.url}`);
    res.end("host");
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const backendPort = (backend.address() as { port: number }).port;
  const root = mkdtempSync(join(tmpdir(), "pe-dev-proxy-"));
  const vite = await createVite({
    configFile: false,
    root,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: devHostProxy(`http://127.0.0.1:${backendPort}`),
    },
  });
  try {
    await vite.listen();
    const port = (vite.httpServer!.address() as { port: number }).port;
    const send = (method: string, path: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            method,
            path,
            headers: { "sec-fetch-site": "same-origin", ...headers },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
    const navigate = {
      accept: "text/html",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    expect(await send("GET", "/pages/probe/", navigate)).toBe(200);
    expect(await send("GET", "/pages", navigate)).toBe(200);
    expect(
      await send("GET", "/pages/pe.js", {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
      }),
    ).toBe(200);
    expect(
      await send("GET", "/pages/pe.css", {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "style",
      }),
    ).toBe(200);
    expect(
      await send("GET", "/pages/probe/chart.png", {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "image",
      }),
    ).toBe(200);
    // API doors, including the Page's own, keep the guard when unmarked.
    const api = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
    expect(await send("POST", "/pages/probe/act", api)).toBe(403);
    expect(await send("GET", "/pages/probe/state", api)).toBe(403);
    expect(await send("POST", "/actions", api)).toBe(403);
    expect(await send("GET", "/call", navigate)).toBe(403);
    expect(forwarded).toEqual([
      "GET /pages/probe/",
      "GET /pages",
      "GET /pages/pe.js",
      "GET /pages/pe.css",
      "GET /pages/probe/chart.png",
    ]);
  } finally {
    await vite.close();
    backend.close();
    rmSync(root, { recursive: true, force: true });
  }
});
