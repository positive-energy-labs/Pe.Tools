import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { invocationContext, withInvocationContext, contextFetch } from "@pe/runtime/context";
import {
  readRequestIdentity as rawReadRequestIdentity,
  requestIdentityLayer,
  type IdentityOptions,
} from "../src/request-identity.ts";
import type { MachineShare } from "@pe/agent-contracts";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  HOST_CONTEXT_HEADER,
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { hostOwnership } from "../src/host-ownership.ts";
import { createDevices, DEVICE_COOKIE } from "../src/remote-device.ts";
import { mintBrowserContext, mintContext, retireContext } from "../src/control.ts";

// Existing browser fixtures acquire a host-minted session before entering the API.
const readRequestIdentity: typeof rawReadRequestIdentity = (headers, ...rest) => {
  const principal = headers["tailscale-user-login"]
    ? { kind: "tailnet" as const, login: headers["tailscale-user-login"], authority: headers.host! }
    : { kind: "local" as const };
  return rawReadRequestIdentity(
    headers.origin && principal.kind === "local"
      ? { ...headers, cookie: mintBrowserContext(principal).split(";")[0] }
      : headers,
    ...rest,
  );
};

const share: MachineShare = {
  allowRemoteAdministration: true,
  desired: "on",
  state: "on",
  url: "https://box.tailabc.ts.net",
  refusal: null,
  callers: [],
  refused: [],
};
const devices = createDevices();
const paired = devices.claim(
  devices.pair("browser").code,
  "Test browser",
  "tailnet",
  "operator@example.com",
);
const options: IdentityOptions = {
  devices,
  port: () => 5180,
  frontendOrigin: () => "http://127.0.0.1:8123",
  share: { read: async () => share, observe: () => {} },
};
const local = { host: "127.0.0.1:5180", [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName };
const remote = {
  cookie: `${DEVICE_COOKIE}=${paired.token}`,
  host: "box.tailabc.ts.net",
  "tailscale-user-login": "operator@example.com",
  [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
};
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

test.each(["/call", "/pe/readings", "/api/bridge", "/host/status"])(
  "stale browser cannot enter %s without its original runtime owner",
  async (path) => {
    const browser = {
      host: local.host,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
    expect(await readRequestIdentity(browser, path, options)).toMatchObject({
      refusal: { code: "runtime.owner-missing" },
    });
    expect(
      await readRequestIdentity(
        browser,
        `${path}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`,
        options,
      ),
    ).toHaveProperty("principal");
    expect(
      await readRequestIdentity(
        { ...browser, [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName },
        `${path}?${HOST_RUNTIME_SERVICE_QUERY}=host`,
        options,
      ),
    ).toMatchObject({ refusal: { code: "runtime.owner-mismatch" } });
    expect(
      await readRequestIdentity(
        browser,
        `${path}?${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}&${HOST_RUNTIME_SERVICE_QUERY}=foreign`,
        options,
      ),
    ).toMatchObject({ refusal: { code: "runtime.owner-mismatch" } });
  },
);

test("Node HTTP forwarding preserves the verified authority and identity on the wire", async () => {
  const receiver = createServer((req, res) => {
    void readRequestIdentity(req.headers as Record<string, string>, req.url!, options).then(
      (identity) => {
        if (req.url === "/events") {
          res.setHeader("content-type", "text/event-stream");
          res.write(`data: ${JSON.stringify(identity)}\n\n`);
          return;
        }
        if (req.url === "/empty") {
          res.writeHead(204);
          res.end();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(identity));
      },
    );
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  try {
    const address = receiver.address();
    if (!address || typeof address === "string") throw Error("fixture has no TCP port");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { ...remote, origin: "https://box.tailabc.ts.net" };
    const response = await withInvocationContext({ hostBaseUrl: base, headers }, () =>
      contextFetch(`${base}/call`),
    );
    expect(await response.json()).toMatchObject({
      principal: { kind: "tailnet", login: remote["tailscale-user-login"] },
      headers: { origin: headers.origin },
    });
    await withInvocationContext({ hostBaseUrl: base, headers }, async () => {
      expect((await contextFetch(`${base}/empty`)).status).toBe(204);
      const events = await contextFetch(`${base}/events`);
      const reader = events.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"tailnet"');
      await reader.cancel();
      await expect(contextFetch(`${base}/call`, { signal: AbortSignal.abort() })).rejects.toThrow();
    });
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("canonical authority and Origin matrix; proxy headers alone never authenticate loopback", async () => {
  for (const headers of [
    local,
    { ...local, origin: "http://127.0.0.1:5180" },
    { ...local, origin: "http://127.0.0.1:8123" },
    remote,
    { ...remote, origin: "https://box.tailabc.ts.net" },
    { ...remote, host: "BOX.tailabc.ts.net:443" },
  ])
    expect(await readRequestIdentity(headers, "/mcp", options)).toHaveProperty("principal");
  for (const headers of [
    { ...local, "tailscale-user-login": "forged" },
    { ...local, "tailscale-user-name": "forged" },
    { ...local, origin: "null" },
    { ...local, origin: "https://evil.example" },
    { ...local, origin: "http://127.0.0.1:8124" },
    { host: "localhost:5180" },
    { host: "127.1:5180" },
    { host: "127.0.0.1:80" },
    { host: "evil.example", "x-forwarded-host": local.host },
    { host: "box.tailabc.ts.net", "x-pe-origin": "trusted" },
    { ...remote, host: "other.tailabc.ts.net" },
    { ...remote, host: "box.tailabc.ts.net@evil.example" },
    { ...remote, host: "box.tailabc.ts.net/" },
    { ...remote, origin: "null" },
    { ...remote, origin: "http://127.0.0.1:5180" },
    { ...remote, "tailscale-user-login": " " },
  ])
    expect(
      await readRequestIdentity(headers, "/mcp", options),
      JSON.stringify(headers),
    ).toHaveProperty("refusal");
  for (const state of ["unknown", "off", "refused"] as const)
    expect(
      await readRequestIdentity(remote, "/mcp", {
        ...options,
        share: { ...options.share, read: async () => ({ ...share, state }) },
      }),
    ).toHaveProperty("refusal");
});

test("the global reader gates routes, static fallback, unmatched paths and upgrade requests before dispatch", async () => {
  const paths = [
    "/call",
    "/actions",
    "/actions/cancel",
    "/pe/resources",
    "/pe/access",
    "/host/status",
    "/host/update",
    "/schemas/settings/a",
    "/captures/x",
    "/pages/a",
    "/demo/a",
    "/index.html",
    "/open",
    "/mcp",
    "/api/bridge",
    "/admin/shutdown",
    "/admin/window",
    "/pe/share",
  ] as const;
  let reached = 0;
  const routes = paths.map((path) =>
    HttpRouter.add(
      "*",
      path,
      Effect.sync(() => {
        reached++;
        return HttpServerResponse.jsonUnsafe({ principal: invocationContext()?.principal });
      }),
    ),
  );
  const app = HttpRouter.toWebHandler(Layer.mergeAll(requestIdentityLayer(options), ...routes), {
    disableLogger: true,
  });
  disposals.push(app.dispose);
  for (const path of [...paths, "/not-mounted"]) {
    for (const headers of [
      { ...local, origin: "https://evil.example" },
      { ...remote, "tailscale-user-login": "" },
    ]) {
      const before = reached;
      const response = await app.handler(
        new Request(`http://127.0.0.1:5180${path}`, {
          headers: {
            ...headers,
            ...(path === "/api/bridge" ? { upgrade: "websocket", connection: "upgrade" } : {}),
          },
        }),
      );
      expect(response.status, path).toBe(403);
      expect(reached).toBe(before);
    }
  }
  for (const path of paths) {
    const response = await app.handler(
      new Request(`http://127.0.0.1:5180${path}`, { headers: local }),
    );
    expect(await response.json()).toMatchObject({ principal: { kind: "local" } });
    const tailnet = await app.handler(
      new Request(`http://127.0.0.1:5180${path}`, { headers: remote }),
    );
    expect(tailnet.status).toBe(
      ["/api/bridge", "/admin/shutdown", "/admin/window", "/pe/share"].includes(path) ? 403 : 200,
    );
    if (tailnet.ok)
      expect(await tailnet.json()).toHaveProperty(
        "principal.login",
        remote["tailscale-user-login"],
      );
  }
});

test("invocation identity never leaks to other origins", async () => {
  const original = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = async (_input, init) => {
    seen.push(new Headers(init?.headers));
    return Response.json({});
  };
  try {
    const admitted = await readRequestIdentity(
      { ...remote, origin: "https://box.tailabc.ts.net" },
      "/call",
      options,
    );
    if (!("principal" in admitted)) throw Error("fixture refused");
    await withInvocationContext({ ...admitted, hostBaseUrl: "http://127.0.0.1:5180" }, async () => {
      await contextFetch("https://docs.example/read");
    });
    expect([...seen[0]!]).toEqual([]);
  } finally {
    globalThis.fetch = original;
  }
});

test("remote administration Off denies only machine-control mutations, including normalized spellings", async () => {
  const disabled: IdentityOptions = {
    ...options,
    share: { ...options.share, read: async () => ({ ...share, allowRemoteAdministration: false }) },
  };
  for (const [method, path] of [
    ["POST", "/pe/providers"],
    ["DELETE", "/pe/providers/x"],
    ["POST", "/pe/providers/x/probe"],
    ["POST", "/pe/providers/x/open-login"],
    ["PUT", "/pe/access"],
    ["PUT", peRouteUrl("plugin.update", { params: { id: "pod:sample" } })],
    ["POST", "/host/update"],
    ["POST", "/pe/%70roviders"],
    ["POST", "/pe//providers"],
    ["POST", "/pe/providers/"],
    ["POST", "/x/../pe/providers?unused=true"],
  ]) {
    // Administration is a person's act (ADR 0017 D2): the caller carries the owner's context.
    const person = { [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }) };
    expect(
      await readRequestIdentity({ ...remote, ...person }, path!, disabled, method),
      `${method} ${path}`,
    ).toHaveProperty("refusal.code", "identity.remote-administration");
    expect(
      await readRequestIdentity({ ...local, ...person }, path!, disabled, method),
    ).toHaveProperty("principal.kind", "local");
    expect(
      await readRequestIdentity({ ...remote, ...person }, path!, options, method),
    ).toHaveProperty("principal.kind", "tailnet");
    expect(await readRequestIdentity(local, path!, options, method)).toHaveProperty(
      "refusal.code",
      "context.missing",
    );
  }
  for (const [method, path] of [
    ["GET", "/pe/providers"],
    ["GET", "/pe/access"],
    ["GET", peRouteUrl("plugins.list", {})],
    ["GET", peRouteUrl("thread.export", { params: { id: "thread" } })],
    ["GET", "/host/update"],
    ["POST", "/call"],
    ["POST", "/actions"],
    ["POST", "/mcp"],
  ])
    expect(
      await readRequestIdentity(
        {
          ...remote,
          [HOST_CONTEXT_HEADER]: mintContext({ kind: "pea", thread: "remote-product" }),
        },
        path!,
        disabled,
        method,
      ),
    ).toHaveProperty("principal.kind", "tailnet");
});

test("identity mints the caller: minted browser cookie is human, an actor header is nobody, a browser context is refused", async () => {
  const browser = { ...local, origin: "http://127.0.0.1:5180", "sec-fetch-site": "same-origin" };
  expect(
    await readRequestIdentity(
      { ...browser, referer: "http://127.0.0.1:5180/open" },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ caller: { kind: "human", via: "local" } });
  expect(
    await readRequestIdentity(
      { ...local, "x-pe-action-actor": "human" },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ refusal: { code: "context.missing" } });
  expect(
    await readRequestIdentity(
      { ...browser, referer: "http://127.0.0.1:5180/pages/todo/" },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ caller: { kind: "page", page: "page:@pages/todo" } });
  expect(
    await readRequestIdentity(
      { ...browser, referer: "http://127.0.0.1:5180/open", "x-pe-context": "anything" },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ refusal: { code: "context.unknown" } });
  expect(
    await readRequestIdentity(
      { ...local, "x-pe-context": "never-minted" },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ refusal: { code: "context.unknown" } });
  expect(
    await readRequestIdentity(
      {
        ...remote,
        origin: "https://box.tailabc.ts.net",
        referer: "https://box.tailabc.ts.net/chat",
      },
      "/actions",
      options,
      "POST",
    ),
  ).toMatchObject({ caller: { kind: "human", via: "tailnet", login: "operator@example.com" } });
});

test("admitted browser context round trips through nested requests without unrelated cookies", async () => {
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const headers = {
    ...local,
    origin: "http://127.0.0.1:5180",
    referer: "http://127.0.0.1:5180/ducts",
    cookie: `${cookie}; unrelated=secret`,
  };
  const first = await rawReadRequestIdentity(headers, "/pe/ducts/analysis", options, "POST");
  if (!("principal" in first)) throw Error(first.refusal.code);
  expect(first.caller).toMatchObject({ kind: "human", via: "local" });
  const next = await rawReadRequestIdentity(
    { ...local, ...first.headers },
    "/call",
    options,
    "POST",
  );
  expect(next).toMatchObject({ caller: { kind: "human", via: "local" } });
  expect(first.headers.cookie).toBe(cookie);
  expect(first.headers).not.toHaveProperty(HOST_CONTEXT_HEADER);
});

test("remote browser nested requests retain their admitted transport and only selected credentials", async () => {
  for (const transport of ["tailnet", "ssh"] as const) {
    const principal =
      transport === "tailnet"
        ? { kind: "tailnet" as const, login: "operator@example.com", authority: remote.host }
        : { kind: "remote" as const, transport: "ssh" as const, authority: "ssh.test:65180" };
    const pairedBrowser = devices.claim(
      devices.pair("browser").code,
      `Nested ${transport}`,
      transport,
      transport === "tailnet" ? "operator@example.com" : undefined,
    );
    const cookie = mintBrowserContext(principal).split(";")[0]!;
    const origin = `https://${principal.authority}`;
    const scoped = {
      ...options,
      remoteIngress: [{ origin: "https://ssh.test:65180", transport: "ssh" as const }],
    };
    const headers = {
      ...local,
      host: principal.authority,
      origin,
      referer: `${origin}/ducts`,
      ...(transport === "tailnet" ? { "tailscale-user-login": "operator@example.com" } : {}),
      cookie: `${cookie}; ${DEVICE_COOKIE}=${pairedBrowser.token}; unrelated=secret`,
    };
    const first = await rawReadRequestIdentity(headers, "/pe/ducts/analysis", scoped, "POST");
    if (!("principal" in first)) throw Error(first.refusal.code);
    expect(first.principal).toEqual(principal);
    expect(first.caller).toMatchObject({
      kind: "human",
      via: transport,
      device: pairedBrowser.session.id,
    });
    expect(first.headers.cookie).toBe(`${cookie}; ${DEVICE_COOKIE}=${pairedBrowser.token}`);
    expect(first.headers.host).toBe(principal.authority);
    const second = await rawReadRequestIdentity(
      { ...local, ...first.headers },
      "/call",
      scoped,
      "POST",
    );
    expect(second).toMatchObject({ principal, caller: first.caller });
    expect(
      await rawReadRequestIdentity(
        { ...local, ...first.headers, host: "foreign.test:65180" },
        "/call",
        scoped,
        "POST",
      ),
    ).toHaveProperty("refusal");
    const pageHeaders = { ...headers, referer: `${origin}/pages/tour/` };
    const page = await rawReadRequestIdentity(pageHeaders, "/call", scoped, "POST");
    if (!("principal" in page)) throw Error(page.refusal.code);
    expect(page.caller).toEqual({ kind: "page", page: "page:@pages/tour" });
    expect(page.headers.cookie).toBe(`${DEVICE_COOKIE}=${pairedBrowser.token}`);
    expect(
      await rawReadRequestIdentity({ ...local, ...page.headers }, "/call", scoped, "POST"),
    ).toMatchObject({ principal, caller: page.caller });
    devices.revoke(pairedBrowser.session.id);
    expect(
      await rawReadRequestIdentity({ ...local, ...first.headers }, "/call", scoped, "POST"),
    ).toMatchObject({ refusal: { code: "device.revoked" } });
  }
});

test("browser forwarding does not accept invalid cookies, context tokens, or forwarded transport claims", async () => {
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const browser = {
    ...local,
    origin: "http://127.0.0.1:5180",
    referer: "http://127.0.0.1:5180/ducts",
    cookie,
  };
  const name = cookie.split("=")[0]!;
  const bad = await rawReadRequestIdentity(
    { ...browser, cookie: `${name}=invalid; unrelated=secret` },
    "/call",
    options,
    "POST",
  );
  expect(bad).toMatchObject({ caller: { kind: "anonymous" } });
  if ("principal" in bad) expect(bad.headers).not.toHaveProperty("cookie");
  const token = mintContext({ kind: "pea", thread: "malicious-browser-token" });
  try {
    expect(
      await rawReadRequestIdentity(
        { ...browser, [HOST_CONTEXT_HEADER]: token },
        "/call",
        options,
        "POST",
      ),
    ).toMatchObject({ refusal: { code: "context.unknown" } });
  } finally {
    retireContext(token);
  }
  const forged = await rawReadRequestIdentity(
    {
      ...browser,
      "x-forwarded-host": remote.host,
      "x-forwarded-proto": "https",
      forwarded: `host=${remote.host}`,
    },
    "/call",
    options,
    "POST",
  );
  expect(forged).toMatchObject({
    principal: { kind: "local" },
    caller: { kind: "human", via: "local" },
  });
  if ("principal" in forged) {
    expect(forged.headers).not.toHaveProperty("x-forwarded-host");
    expect(forged.headers).not.toHaveProperty("forwarded");
    expect(forged.headers).not.toHaveProperty("host");
  }
});

test("a browser context from an earlier host lifetime or foreign transport grants no caller", async () => {
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const browser = {
    ...local,
    origin: "http://127.0.0.1:5180",
    referer: "http://127.0.0.1:5180/ducts",
    cookie,
  };
  const { callerOf } = await import("../src/control.ts");
  expect(
    callerOf({ kind: "remote", transport: "ssh", authority: "ssh.test:65180" }, browser),
  ).toEqual({ caller: { kind: "anonymous" } });
  vi.resetModules();
  const restarted = await import("../src/control.ts");
  expect(restarted.callerOf({ kind: "local" }, browser)).toEqual({ caller: { kind: "anonymous" } });
  expect(restarted.browserContextHeaders({ kind: "local" }, browser)).not.toHaveProperty("cookie");
});
