/**
 * Stdio MCP server entrypoint for the pea product surface.
 *
 * Run: node src/server.ts pea
 *   pea - product surface: status/logs, host ops, scripting, capture, route state
 *
 * The pe_read/pe_do route rows are thin HTTP clients to the host's
 * host RouteWorkspace endpoints, so they work over stdio (unlike the old in-pea
 * family_sheet_* tools) - no exclusion needed.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { peaProductTools } from "./pea/index.ts";
import { readCatalog } from "./pea/capability-tools.ts";
import { peaAgentInstructionsFor } from "./pea/instructions.ts";
import type { McpTool } from "./shared/tool.ts";

const serverTools: Record<string, Record<string, McpTool>> = {
  pea: peaProductTools,
};

const serverName = process.argv[2] ?? "";
const tools = serverTools[serverName];
if (!tools) {
  console.error(`Usage: node src/server.ts <${Object.keys(serverTools).join("|")}>`);
  process.exit(1);
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** A tool result as MCP content: model output parts when the tool shapes them, else JSON text. */
function toContent(tool: McpTool, result: unknown): { content: Content[]; isError?: boolean } {
  const modelOutput = tool.toModelOutput?.(result) as
    | {
        type: "content";
        value: Array<{ type: string; text?: string; data?: string; mediaType?: string }>;
      }
    | undefined;
  if (modelOutput?.type === "content")
    return {
      content: modelOutput.value.map((part) =>
        part.type === "media"
          ? { type: "image", data: part.data ?? "", mimeType: part.mediaType ?? "image/png" }
          : { type: "text", text: part.text ?? "" },
      ),
    };
  const record = result as { isError?: unknown; text?: unknown; content?: unknown } | null;
  if (record?.isError === true) {
    const message = record.text ?? record.content;
    return {
      isError: true,
      content: [
        { type: "text", text: typeof message === "string" ? message : JSON.stringify(result) },
      ],
    };
  }
  return {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
  };
}

// Revit orientation only when the host answers with a connected session, read once at startup.
const catalog = await readCatalog();
const revit = !("isError" in catalog) && catalog.sessions.length > 0;

const server = new McpServer(
  { name: serverName, version: "0.0.0" },
  { instructions: peaAgentInstructionsFor({ revit }) },
);
for (const tool of Object.values(tools))
  server.registerTool(
    tool.id,
    { description: tool.description, inputSchema: tool.inputSchema as never },
    (async (input: unknown, extra: unknown) => {
      try {
        return toContent(tool, await tool.execute(input as never, { mcp: { extra } }));
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }) as never,
  );
await server.connect(new StdioServerTransport());
