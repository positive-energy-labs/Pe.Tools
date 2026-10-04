/**
 * Stdio MCP server entrypoint for the pea product surface.
 *
 * Run: node src/server.ts pea
 *   pea — product surface: status/logs, host ops, scripting, capture, route state
 *
 * The pe_read/pe_do route rows are thin HTTP clients to the host's
 * host RouteWorkspace endpoints, so they work over stdio (unlike the old in-pea
 * family_sheet_* tools) — no exclusion needed.
 */
import { MCPServer } from "@mastra/mcp";
import { peaProductTools } from "./pea/index.ts";
import { readCatalog } from "./pea/capability-tools.ts";
import { peaAgentInstructionsFor } from "./pea/instructions.ts";

const serverTools: Record<string, ConstructorParameters<typeof MCPServer>[0]["tools"]> = {
  pea: peaProductTools,
};

const serverName = process.argv[2] ?? "";
const tools = serverTools[serverName];
if (!tools) {
  console.error(`Usage: node src/server.ts <${Object.keys(serverTools).join("|")}>`);
  process.exit(1);
}

// Revit orientation only when the host answers with a connected session, read once at startup.
const catalog = await readCatalog();
const revit = !("isError" in catalog) && catalog.sessions.length > 0;

await new MCPServer({
  name: serverName,
  version: "0.0.0",
  description: "Pe product MCP: Revit host status/logs, host operations, scripting, view capture.",
  instructions: peaAgentInstructionsFor({ revit }),
  tools,
}).startStdio();
