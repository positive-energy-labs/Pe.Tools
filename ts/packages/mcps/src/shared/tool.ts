import type { z } from "zod";

/** MCP-bound tool: id + description + zod input + execute. The server maps results to MCP content. */
export type McpTool<S extends z.ZodType = z.ZodType> = {
  id: string;
  description: string;
  inputSchema: S;
  execute: (input: z.infer<S>, context: unknown) => Promise<unknown>;
  /** Optional model-facing rewrite of a result (text + media parts become MCP content blocks). */
  toModelOutput?: (output: unknown) => unknown;
};

export const createTool = <S extends z.ZodType>(tool: McpTool<S>): McpTool<S> => tool;
