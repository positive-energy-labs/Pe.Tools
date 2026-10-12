import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { createPeaMcpServer, WebStandardStreamableHTTPServerTransport } from "@pe/mcps/server";
import { invocationContext, type InvocationContext, type RequestPrincipal } from "@pe/mcps/context";

const version = "2025-11-25";
const principalKey = (principal: RequestPrincipal) => JSON.stringify(principal);
const error = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status });

export function createMcpDoor(hostBaseUrl: () => string, makeServer = createPeaMcpServer) {
  type Session = {
    principal: string;
    thread?: string;
    context: InvocationContext;
    transport: WebStandardStreamableHTTPServerTransport;
    server: Awaited<ReturnType<typeof makeServer>>;
  };
  const sessions = new Map<string, Session>();
  return {
    async fetch(request: Request): Promise<Response> {
      const caller = invocationContext();
      if (!caller?.principal) return error(403, "A verified request identity is required.");
      const protocol = request.headers.get("mcp-protocol-version");
      if (protocol !== null && protocol !== version)
        return error(400, "Unsupported MCP protocol version.");
      const id = request.headers.get("mcp-session-id");
      const thread = request.headers.get("x-pe-thread") ?? undefined;
      let session = id ? sessions.get(id) : undefined;
      if (id && !session) return error(404, "Unknown MCP session.");
      if (
        session &&
        (session.principal !== principalKey(caller.principal) || session.thread !== thread)
      )
        return error(403, "MCP session is bound to a different principal or tool context.");
      if (request.method === "GET")
        return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });
      if (request.method !== "POST" && request.method !== "DELETE")
        return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });
      let body: unknown;
      if (request.method === "POST") {
        try {
          body = await request.json();
        } catch {
          return error(400, "Expected one JSON-RPC message.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return error(400, "Expected one JSON-RPC message.");
      }
      if (!session) {
        if (
          !body ||
          typeof body !== "object" ||
          !("method" in body) ||
          body.method !== "initialize"
        )
          return error(400, "Initialize an MCP session first.");
        if (
          !("params" in body) ||
          !body.params ||
          typeof body.params !== "object" ||
          !("protocolVersion" in body.params) ||
          body.params.protocolVersion !== version
        )
          return error(400, "Unsupported MCP protocol version.");
        const context: InvocationContext = {
          hostBaseUrl: hostBaseUrl(),
          principal: caller.principal,
          headers: caller.headers,
          thread,
          admissions: new Map(),
          running: new Map(),
        };
        const server = await makeServer(context);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            sessions.set(id, session!);
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        session = { principal: principalKey(caller.principal), thread, context, transport, server };
        await server.connect(transport);
      }
      // HTTP disconnect does not cancel admitted work. The SDK owns protocol cancellation;
      // the session retains its admission context until explicit DELETE or host retirement.
      const response = await session.transport.handleRequest(request, { parsedBody: body });
      if (!session.transport.sessionId) await session.server.close();
      return response;
    },
    async close() {
      await Promise.all([...sessions.values()].map((session) => session.server.close()));
      sessions.clear();
    },
  };
}

export const mcpRoute = (base: () => string) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const door = createMcpDoor(base);
      yield* Effect.addFinalizer(() => Effect.promise(() => door.close()));
      yield* router.add(
        "*",
        "/mcp",
        HttpEffect.fromWebHandler((request) => door.fetch(request)),
      );
    }),
  );
