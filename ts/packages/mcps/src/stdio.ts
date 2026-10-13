import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPeaMcpServer } from "./server.ts";

/** `pea mcp`: its harness thread rides the `PE_CONTEXT` token the host minted at spawn. */
export async function startPeaMcp(hostBaseUrl?: string) {
  const server = await createPeaMcpServer({
    hostBaseUrl,
    admissions: new Map(),
    running: new Map(),
  });
  await server.connect(new StdioServerTransport());
  return server;
}
