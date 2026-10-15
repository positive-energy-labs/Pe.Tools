import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPeaMcpServer } from "./server.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { resolveHostBaseUrl } from "./shared/host-config.ts";
import { contextFetch } from "@pe/runtime/context";

/** Harness stdio carries PE_CONTEXT; external stdio initializes at the host's one MCP door. */
export async function startPeaMcp(hostBaseUrl?: string) {
  if (!process.env[HOST_CONTEXT_VARIABLE]?.trim()) return startExternalMcp(hostBaseUrl);
  const server = await createPeaMcpServer({
    hostBaseUrl,
    admissions: new Map(),
    running: new Map(),
  });
  await server.connect(new StdioServerTransport());
  return server;
}

async function startExternalMcp(hostBaseUrl?: string) {
  const client = new Client({ name: "pea-stdio", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${(hostBaseUrl ?? resolveHostBaseUrl()).replace(/\/$/, "")}/mcp`),
    { fetch: contextFetch },
  );
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close();
    throw error;
  }
  const server = new Server(
    { name: "pea", version: "0.0.0" },
    { capabilities: { tools: {} }, instructions: client.getInstructions() },
  );
  const close = async () => {
    try {
      await transport.terminateSession();
    } finally {
      await client.close();
      await server.close();
    }
  };
  process.stdin.once("end", () => {
    void close();
  });
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  const initialize = stdio.onmessage!;
  // Each SDK side negotiates initialize; later messages retain ids, notifications and cancellation.
  // Replays reach the host again, so a detached result is never cached as the final receipt.
  transport.onmessage = (message) => {
    void stdio.send(message);
  };
  stdio.onmessage = (message) => {
    if (
      "method" in message &&
      ["initialize", "notifications/initialized"].includes(message.method)
    ) {
      initialize(message);
      return;
    }
    void transport.send(message).catch((error) => {
      if ("method" in message && "id" in message)
        void stdio.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        });
    });
  };
  return { close };
}
