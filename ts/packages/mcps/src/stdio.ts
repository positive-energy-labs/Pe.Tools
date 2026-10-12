import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPeaMcpServer } from "./server.ts";

/** `pea mcp` binds its harness thread once at the process boundary. */
export async function startPeaMcp(hostBaseUrl?: string) {
  const server = await createPeaMcpServer({
    hostBaseUrl,
    thread: process.env.PE_THREAD,
    admissions: new Map(),
    running: new Map(),
  });
  await server.connect(new StdioServerTransport());
  return server;
}
