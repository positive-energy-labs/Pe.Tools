import { afterEach, expect, test, vi } from "vite-plus/test";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { buildCapabilities } from "@pe/mcps";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import type { InvocationContext } from "@pe/mcps/context";
import { createPeaMcpServer } from "@pe/mcps/server";
import { createMcpDoor, mcpRoute } from "../src/mcp-route.ts";
import { requestIdentityLayer, type IdentityOptions } from "../src/request-identity.ts";
import { withInvocationContext } from "@pe/mcps/context";
import { createServer } from "node:http";
import { once } from "node:events";
import { callerOf, mintContext, retireContext } from "../src/control.ts";

const base = "http://127.0.0.1:5180";
const version = "2025-11-25";
const remote = (login: string) => ({ host: "box.tailabc.ts.net", "tailscale-user-login": login });
const local = { host: "127.0.0.1:5180" };
const options: IdentityOptions = {
  port: () => 5180,
  frontendOrigin: () => undefined,
  share: {
    observe: () => {},
    read: async () => ({
      desired: "on",
      state: "on",
      url: "https://box.tailabc.ts.net",
      refusal: null,
      callers: [],
      allowRemoteAdministration: true,
      refused: [],
    }),
  },
};
const operations: HostOperationDefinition[] = [
  { key: "pod.list", intent: "Read", needs: "nothing" },
  { key: "pod.member.write", intent: "Mutate", needs: "nothing" },
];
const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dispose.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
});

async function fixture() {
  let beforePost: () => Promise<void> = async () => {};
  const posts: Record<string, unknown>[] = [];
  const seen: Array<{ path: string; login: string | null }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  const handle = async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const login = new Headers(init?.headers).get("tailscale-user-login");
    seen.push({ path: url.pathname, login });
    if (url.pathname === "/pe/access") return Response.json({ guarded: true });
    // An external MCP client holds no thread in wave 1: its own scope is absent.
    if (url.pathname === "/pe/scope/self")
      return Response.json({ error: "no thread" }, { status: 404 });
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date(0).toISOString(),
        sources: {},
        sessions: [],
        capabilities: buildCapabilities({ ops: operations, routes: [], pods: null, skills: [] }),
      });
    if (url.pathname === "/ops") return Response.json({ operations });
    if (url.pathname === "/call") return Response.json({ login });
    if (url.pathname === "/actions") {
      if (init?.method !== "POST")
        return Response.json(
          rows.has(url.searchParams.get("id")!) ? [rows.get(url.searchParams.get("id")!)] : [],
        );
      const body = JSON.parse(await new Response(init.body).text());
      if (rows.has(body.id)) return Response.json(rows.get(body.id));
      posts.push(body);
      await beforePost();
      const { input: request, ...admission } = body;
      const row = {
        ...admission,
        caller: { kind: "anonymous" },
        basis: null,
        request,
        state: "succeeded",
        result: { login },
        steps: [],
        preparation: { state: "unprepared" },
        recovery: [],
        publication: { state: "unrequested" },
        startedAt: new Date(0).toISOString(),
      };
      rows.set(body.id, row);
      return Response.json(row);
    }
    throw Error(`Unexpected fixture request ${url}`);
  };
  const backend = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handle(new URL(req.url!, base), {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    })().catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  if (!address || typeof address === "string") throw Error("fixture has no TCP port");
  const hostBase = `http://127.0.0.1:${address.port}`;
  dispose.push(async () => {
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      requestIdentityLayer(options),
      mcpRoute(() => hostBase),
    ),
    { disableLogger: true },
  );
  dispose.push(app.dispose);
  const send = (
    body: unknown,
    headers: Record<string, string> = local,
    method = "POST",
    signal?: AbortSignal,
  ) =>
    app.handler(
      new Request(`${base}/mcp`, {
        method,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...headers,
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal,
      }),
    );
  const init = async (headers: Record<string, string> = local) => {
    const response = await send(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: "wave4", version: "1" },
        },
      },
      headers,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("result.protocolVersion", version);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    const session = {
      ...headers,
      "mcp-session-id": response.headers.get("mcp-session-id")!,
      "mcp-protocol-version": version,
    };
    expect(
      (await send({ jsonrpc: "2.0", method: "notifications/initialized" }, session)).status,
    ).toBe(202);
    return session;
  };
  const call = (
    name: string,
    args: object,
    headers: Record<string, string>,
    id = 3,
    signal?: AbortSignal,
  ) =>
    send(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
      headers,
      "POST",
      signal,
    );
  return {
    hostBase,
    send,
    init,
    call,
    posts,
    seen,
    rows,
    holdPost: (wait: () => Promise<void>) => {
      beforePost = wait;
    },
  };
}

test("SDK HTTP initialization, tool discovery, notifications, versions, Origin, principal binding and DELETE", async () => {
  const f = await fixture();
  const one = await f.init(remote("one"));
  expect(
    await (await f.send({ jsonrpc: "2.0", id: 2, method: "tools/list" }, one)).json(),
  ).toHaveProperty(
    "result.tools",
    expect.arrayContaining([expect.objectContaining({ name: "pe_do" })]),
  );
  expect((await f.send({ jsonrpc: "2.0", id: 8, result: {} }, one)).status).toBe(202);
  expect((await f.send([], one)).status).toBe(400);
  expect((await f.send({}, { ...one, "mcp-protocol-version": "2099-01-01" })).status).toBe(400);
  expect((await f.send({}, { ...one, origin: "https://evil.example" })).status).toBe(403);
  expect((await f.send({}, { ...one, ...remote("two") })).status).toBe(403);
  expect((await f.send({}, { ...one, "mcp-session-id": "absent" })).status).toBe(404);
  expect((await f.send({}, one, "GET")).status).toBe(405);
  expect((await f.send({}, one, "DELETE")).status).toBe(200);
  expect((await f.send({}, one, "DELETE")).status).toBe(404);
  expect(
    (
      await f.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "bad" },
      })
    ).status,
  ).toBe(400);
  expect((await f.send({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(400);
});

test("MCP tool operations do not consult the harness agent approval preference", async () => {
  const f = await fixture();
  for (const caller of [local, remote("one")]) {
    const session = await f.init(caller);
    const result = await (await f.call("pe_do", { key: "op:pod.member.write" }, session)).json();
    expect(result.result.isError, JSON.stringify(result)).not.toBe(true);
    expect(JSON.parse(result.result.content[0].text)).toMatchObject({ ok: true });
    const read = await (await f.call("pe_read", { key: "op:pod.list" }, session, 4)).json();
    expect(read.result.isError, JSON.stringify(read)).not.toBe(true);
    expect(JSON.parse(read.result.content[0].text)).toMatchObject({ ok: true });
  }
  expect(f.posts).toHaveLength(2);
  expect(f.posts[0]).toMatchObject({ key: "pod.member.write" });
  expect(f.posts[0]).not.toHaveProperty("actor");
  expect(f.seen.some((request) => request.path === "/pe/access")).toBe(false);
});

test("concurrent principals retain separate headers and admission identities", async () => {
  const f = await fixture();
  const [one, two] = await Promise.all([f.init(remote("one")), f.init(remote("two"))]);
  const replies = await Promise.all(
    [one, two].map(async (session) =>
      (await f.call("pe_do", { key: "op:pod.member.write" }, session)).json(),
    ),
  );
  for (const reply of replies) expect(reply.result.isError, JSON.stringify(reply)).not.toBe(true);
  expect(replies.map((reply) => JSON.parse(reply.result.content[0].text).revision)).toEqual([0, 0]);
  expect(f.posts).toHaveLength(2);
  expect(new Set(f.posts.map((row) => row.id)).size).toBe(2);
  const byLogin = (a: { login: string | null }, b: { login: string | null }) =>
    String(a.login).localeCompare(String(b.login));
  // A client with no caller context has no thread to read: no scope request is made.
  expect(f.seen.filter((row) => row.path.startsWith("/pe/scope/"))).toEqual([]);
  expect(
    [...f.rows.values()].map((row) => row.result as { login: string | null }).sort(byLogin),
  ).toEqual([{ login: "one" }, { login: "two" }]);
});

test("transport disconnect does not cancel an admitted action; replay reads the retained receipt", async () => {
  const f = await fixture();
  const session = await f.init(remote("one"));
  let release!: () => void;
  f.holdPost(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  void f
    .call("pe_do", { key: "op:pod.member.write" }, session, 9, controller.signal)
    .catch(() => undefined);
  await expect.poll(() => f.posts.length).toBe(1);
  const id = String(f.posts[0]!.id);
  controller.abort();
  release();
  await expect.poll(() => f.rows.get(id)?.state).toBe("succeeded");
  const replay = await (await f.call("pe_do", { key: "op:pod.member.write" }, session, 9)).json();
  expect(JSON.parse(replay.result.content[0].text)).toMatchObject({ ok: true });
  expect(f.posts).toHaveLength(1);
  expect(f.seen.some((row) => row.path === "/actions/cancel")).toBe(false);
});

test("session construction binds host and maps independently of ambient invocation context", async () => {
  const f = await fixture();
  const contexts: InvocationContext[] = [];
  const door = createMcpDoor(
    () => f.hostBase,
    async (context) => {
      contexts.push(context);
      return createPeaMcpServer(context);
    },
  );
  dispose.push(() => door.close());
  await Promise.all(
    ["one", "two"].map((login) =>
      withInvocationContext(
        {
          principal: { kind: "tailnet", login, authority: "box.tailabc.ts.net" },
          headers: remote(login),
        },
        () =>
          door.fetch(
            new Request(`${base}/mcp`, {
              method: "POST",
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: version,
                  capabilities: {},
                  clientInfo: { name: "fixture", version: "1" },
                },
              }),
            }),
          ),
      ),
    ),
  );
  expect(
    contexts.map((context) =>
      context.principal?.kind === "tailnet" ? context.principal.login : null,
    ),
  ).toEqual(["one", "two"]);
  expect(contexts[0]!.admissions).not.toBe(contexts[1]!.admissions);
  expect(contexts[0]!.running).not.toBe(contexts[1]!.running);
  expect(contexts.every((context) => context.hostBaseUrl === f.hostBase)).toBe(true);
  for (const context of contexts) {
    expect(callerOf(context.principal!, context.headers!)).toMatchObject({
      caller: { kind: "external-mcp", label: "fixture" },
    });
  }
  const tokens = contexts.map((context) => context.headers!["x-pe-context"]!);
  expect(new Set(tokens).size).toBe(2);
  await door.close();
  for (const token of tokens)
    expect(callerOf({ kind: "local" }, { "x-pe-context": token })).toMatchObject({
      refusal: { code: "context.unknown" },
    });
});

test("initialize ignores x-pe-thread and retains only a verified caller context", async () => {
  const contexts: InvocationContext[] = [];
  const door = createMcpDoor(
    () => base,
    async (context) => {
      contexts.push(context);
      return createPeaMcpServer(context);
    },
  );
  dispose.push(() => door.close());
  const token = mintContext({ kind: "pea", thread: "own-thread" });
  try {
    for (const headers of [
      { "x-pe-thread": "foreign-thread" },
      { "x-pe-context": token, "x-pe-thread": "foreign-thread" },
    ]) {
      const identity = callerOf({ kind: "local" }, headers);
      if ("refusal" in identity) throw Error(identity.refusal.detail);
      const response = await withInvocationContext(
        { principal: { kind: "local" }, caller: identity.caller, headers: {} },
        () =>
          door.fetch(
            new Request(`${base}/mcp`, {
              method: "POST",
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
                ...headers,
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: version,
                  capabilities: {},
                  clientInfo: { name: "external", version: "1" },
                },
              }),
            }),
          ),
      );
      expect(response.status).toBe(200);
    }
    expect(contexts[0]!.caller).toMatchObject({ kind: "external-mcp" });
    expect(contexts[1]!.caller).toMatchObject({ kind: "pea", thread: "own-thread" });
    expect(contexts[1]!.headers!["x-pe-context"]).toBe(token);
    expect(contexts.every((context) => !("x-pe-thread" in context.headers!))).toBe(true);
  } finally {
    retireContext(token);
  }
});
