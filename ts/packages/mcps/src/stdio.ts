/** Pea's tools over stdio, served by `pea mcp` for a harness thread or the user's own app. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configurePeaProductToolContext, peaProductTools } from "./pea/index.ts";
import { readCatalog } from "./pea/capability-tools.ts";
import { peaAgentInstructionsFor } from "./pea/instructions.ts";
import type { McpTool } from "./shared/tool.ts";

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

export async function startPeaMcp(hostBaseUrl?: string): Promise<McpServer> {
  configurePeaProductToolContext({ hostBaseUrl });
  // Revit orientation only when the host answers with a connected session, read once at startup.
  const catalog = await readCatalog();
  const revit = !("isError" in catalog) && catalog.sessions.length > 0;
  const server = new McpServer(
    { name: "pea", version: "0.0.0" },
    { instructions: peaAgentInstructionsFor({ revit }) },
  );
  for (const tool of Object.values(peaProductTools))
    server.registerTool(
      tool.id,
      { description: tool.description, inputSchema: tool.inputSchema as never },
      (async (input: unknown, extra: unknown) => {
        try {
          return toContent(tool, await tool.execute(input as never, { mcp: { extra } }));
        } catch (error) {
          return {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      }) as never,
    );
  await server.connect(new StdioServerTransport());
  return server;
}
