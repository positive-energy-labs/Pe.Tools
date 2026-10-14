import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { createPeaMcpServer, WebStandardStreamableHTTPServerTransport } from "@pe/mcps/server";
import { invocationContext, type InvocationContext } from "@pe/mcps/context";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { callerOf, mintContext, retireContext } from "./control.ts";
import { hostReceiptExport, type ReceiptExport } from "./receipt-export.ts";
import { instrumentHostMcp } from "./mcp-analytics.ts";

const version = "2025-11-25";
const principalKey = (context: InvocationContext) =>
  JSON.stringify([context.principal, context.caller ?? { kind: "anonymous" }]);
const error = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status });

export function createMcpDoor(
  hostBaseUrl: () => string,
  makeServer = createPeaMcpServer,
  telemetry?: ReceiptExport,
) {
  type Session = {
    principal: string;
    context: InvocationContext;
    transport: WebStandardStreamableHTTPServerTransport;
    server: Awaited<ReturnType<typeof makeServer>>;
    mintedToken?: string;
    analytics: ReturnType<typeof instrumentHostMcp>;
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
      let session = id ? sessions.get(id) : undefined;
      if (id && !session) return error(404, "Unknown MCP session.");
      if (session && session.principal !== principalKey(caller))
        return error(403, "MCP session is bound to a different principal or caller context.");
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
        // Only the verified bearer context can bind a thread. A thread-id header carries no authority.
        const inherited =
          caller.caller?.kind === "pea" ? request.headers.get(HOST_CONTEXT_HEADER) : null;
        const info = (body.params as { clientInfo?: { name?: unknown } }).clientInfo;
        const mintedToken = inherited
          ? undefined
          : mintContext({
              kind: "external-mcp",
              label: typeof info?.name === "string" ? info.name : "MCP client",
            });
        const headers: Record<string, string> = {
          ...caller.headers,
          [HOST_CONTEXT_HEADER]: inherited ?? mintedToken!,
        };
        // This is a host-to-host context, not a browser bearer. Terminal human tokens have no MCP audience.
        delete headers.origin;
        const identity = callerOf(caller.principal, headers);
        if ("refusal" in identity) {
          if (mintedToken) retireContext(mintedToken);
          return error(403, identity.refusal.detail);
        }
        const context: InvocationContext = {
          hostBaseUrl: hostBaseUrl(),
          principal: caller.principal,
          caller: identity.caller,
          headers,
          admissions: new Map(),
          running: new Map(),
        };
        let server: Awaited<ReturnType<typeof makeServer>>;
        try {
          server = await makeServer(context);
        } catch (cause) {
          if (mintedToken) retireContext(mintedToken);
          throw cause;
        }
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            sessions.set(id, session!);
          },
          onsessionclosed: (id) => {
            if (mintedToken) retireContext(mintedToken);
            sessions.delete(id);
          },
        });
        session = {
          principal: principalKey(caller),
          context,
          transport,
          server,
          mintedToken,
          analytics: telemetry
            ? instrumentHostMcp(server, telemetry, context)
            : { run: (work) => work() },
        };
        try {
          await server.connect(transport);
        } catch (cause) {
          if (mintedToken) retireContext(mintedToken);
          await server.close();
          throw cause;
        }
      }
      // HTTP disconnect does not cancel admitted work. The SDK owns protocol cancellation;
      // the session retains its admission context until explicit DELETE or host retirement.
      const response = await session.analytics.run(() =>
        session!.transport.handleRequest(request, { parsedBody: body }),
      );
      if (!session.transport.sessionId) {
        if (session.mintedToken) retireContext(session.mintedToken);
        await session.server.close();
      }
      return response;
    },
    async close() {
      await Promise.all(
        [...sessions.values()].map(async (session) => {
          if (session.mintedToken) retireContext(session.mintedToken);
          await session.server.close();
        }),
      );
      sessions.clear();
    },
  };
}

export const mcpRoute = (base: () => string, telemetry?: ReceiptExport) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const door = createMcpDoor(base, undefined, telemetry ?? hostReceiptExport());
      yield* Effect.addFinalizer(() => Effect.promise(() => door.close()));
      yield* router.add(
        "*",
        "/mcp",
        HttpEffect.fromWebHandler((request) => door.fetch(request)),
      );
    }),
  );
