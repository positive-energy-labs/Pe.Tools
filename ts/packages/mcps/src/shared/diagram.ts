import { createTool } from "./tool.ts";
import { DIAGRAM_TOOL_ID, diagramSpecSchema } from "@pe/agent-contracts";

/**
 * DRAW: the chat renders the call's own args under the call (`toMermaid` in agent-contracts), so
 * the tool only validates. An invalid spec never reaches `execute`: Mastra's input validation
 * returns every issue as `path: message` to the model (agent ledger, 2026-09-16).
 */
export const diagram = createTool({
  id: DIAGRAM_TOOL_ID,
  description:
    "DRAW a diagram for the user in the chat: a duct or pipe system, a flow of steps, a hierarchy, a dependency graph. Give nodes (id, label, optional shape), directed edges between node ids (optional label such as an airflow, optional style), and optional groups that box related nodes. The chat draws it under this call. An invalid spec fails with every problem listed by path; fix them all and call again. Returns only counts, never an image.",
  inputSchema: diagramSpecSchema,
  execute: async (spec) => ({
    ok: true as const,
    nodes: spec.nodes.length,
    edges: spec.edges.length,
    groups: spec.groups?.length ?? 0,
  }),
});
