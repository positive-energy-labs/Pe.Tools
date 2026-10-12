import { randomUUID } from "node:crypto";
import { withInvocationContext, type InvocationContext } from "./shared/invocation-context.ts";
/** Pea's tool registration shared by stdio and HTTP transports. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { peaProductTools } from "./pea/index.ts";
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

export async function createPeaMcpServer(context: InvocationContext): Promise<McpServer> {
  // Revit orientation only when the host answers with a connected session, read once at startup.
  const catalog = await withInvocationContext(context, () => readCatalog());
  const revit = !("isError" in catalog) && catalog.sessions.length > 0;
  const server = new McpServer(
    { name: "pea", version: "0.0.0" },
    { instructions: peaAgentInstructionsFor({ revit }) },
  );
  const calls = new Map<string | number, string>();
  for (const tool of Object.values(peaProductTools))
    server.registerTool(
      tool.id,
      { description: tool.description, inputSchema: tool.inputSchema as never },
      (async (input: unknown, extra: unknown) => {
        try {
          await context.beforeTool?.(tool.id);
          const requestId = (extra as { requestId: string | number }).requestId;
          let id = calls.get(requestId);
          if (!id) {
            id = randomUUID();
            calls.set(requestId, id);
          }
          return toContent(
            tool,
            await withInvocationContext(context, () =>
              tool.execute(input as never, {
                agent: { toolCallId: id },
                mcp: { extra },
              }),
            ),
          );
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
  return server;
}

export { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
