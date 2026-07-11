/**
 * Stdio MCP server entrypoints, one per product boundary.
 *
 * Run: node src/server.ts <pea|peco>
 *   pea  — product surface: status/logs, host ops, scripting, capture
 *   peco — dev surface: everything in pea plus Peco runtime context and harness tools
 *
 * family_sheet_* tools are excluded here: they require the in-pea AgentController
 * session and always fail with NO_CONTROLLER over stdio.
 */
import { MCPServer } from "@mastra/mcp";
import { peCodeTools } from "./dev/index.ts";
import { peaProductTools } from "./pea/index.ts";

const stdioProductTools = Object.fromEntries(
  Object.entries(peaProductTools).filter(([id]) => !id.startsWith("family_sheet_")),
);

const serverTools: Record<string, ConstructorParameters<typeof MCPServer>[0]["tools"]> = {
  pea: stdioProductTools,
  peco: { ...stdioProductTools, ...peCodeTools },
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
