/**
 * Stdio MCP server entrypoints, one per product boundary.
 *
 * Run: node src/server.ts <pea|peco>
 *   pea  — product surface: status/logs, host ops, scripting, capture, route state
 *   peco — dev surface: everything in pea plus Peco runtime context and harness tools
 *
 * The route_state_* / route_command tools are thin HTTP clients to the host's
 * /pe/route-state dispatcher, so they work over stdio (unlike the old in-pea
 * family_sheet_* tools) — no exclusion needed.
 */
import { MCPServer } from "@mastra/mcp";
import { peCodeTools } from "./dev/index.ts";
import { peaProductTools } from "./pea/index.ts";

const serverTools: Record<string, ConstructorParameters<typeof MCPServer>[0]["tools"]> = {
  pea: peaProductTools,
  peco: { ...peaProductTools, ...peCodeTools },
};

const serverName = process.argv[2] ?? "";
const tools = serverTools[serverName];
if (!tools) {
  console.error(`Usage: node src/server.ts <${Object.keys(serverTools).join("|")}>`);
  process.exit(1);
}

await new MCPServer({
  name: serverName,
  version: "0.0.0",
  description:
    serverName === "peco"
      ? "Pe dev MCP: pea product tools plus Peco runtime context and dev harness tools."
      : "Pe product MCP: Revit host status/logs, host operations, scripting, view capture.",
  tools,
}).startStdio();
