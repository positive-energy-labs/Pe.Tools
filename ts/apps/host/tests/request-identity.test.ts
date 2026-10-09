import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { invocationContext, withInvocationContext, contextFetch } from "@pe/mcps/context";
import {
  readRequestIdentity,
  requestIdentityLayer,
  type IdentityOptions,
} from "../src/request-identity.ts";
import type { MachineShare } from "@pe/agent-contracts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { createServer } from "node:http";
import { once } from "node:events";

const share: MachineShare = {
  desired: "on",
  state: "on",
  url: "https://box.tailabc.ts.net",
  refusal: null,
  callers: [],
  refused: [],
};
const options: IdentityOptions = {
  port: () => 5180,
  frontendOrigin: () => "http://127.0.0.1:8123",
  share: { read: async () => share, observe: () => {} },
};
const local = { host: "127.0.0.1:5180" };
const remote = { host: "box.tailabc.ts.net", "tailscale-user-login": "operator@example.com" };
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

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
    "/events",
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

test("resource refreshes retain each subscriber's principal after the request context returns", async () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    "http://127.0.0.1:5180",
    async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("host")).toBe(remote.host);
      seen.push(headers.get("tailscale-user-login")!);
      return Response.json({});
    },
  );
  const releases = ["one", "two"].map((login) =>
    withInvocationContext(
      {
        principal: { kind: "tailnet", login, authority: remote.host },
        headers: { ...remote, "tailscale-user-login": login },
      },
      () => observe({ kind: "host-status" }, () => {}),
    ),
  );
  try {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toEqual(["one", "two", "one", "two"]);
  } finally {
    releases.forEach((release) => release());
    vi.useRealTimers();
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
