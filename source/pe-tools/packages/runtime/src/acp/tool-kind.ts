import type { ToolKind } from "@agentclientprotocol/sdk";
import {
  runtimeToolTitle,
  type RuntimeToolKind,
  type RuntimeToolMetadata,
} from "../tool-metadata.ts";

const executeTools = new Set([
  "execute_command",
  "get_process_output",
  "kill_process",
  "script_execute",
  "test",
]);

// Fallback only for unknown external/MCP/client tools. Pe-owned tools should provide metadata.
const readTools = new Set([
  "view",
  "file_stat",
  "pe_status",
  "pe_logs",
  "live_loop_context",
  "host_operation_search",
  "host_operation_call",
  "revit_api_docs_search",
  "revit_api_docs_fetch",
  "recall",
  "notification_inbox",
]);

// Fallback only for unknown external/MCP/client tools. Pe-owned tools should provide metadata.
const searchTools = new Set(["search_content", "find_files", "web_search", "skill_search"]);
// Fallback only for unknown external/MCP/client tools. Pe-owned tools should provide metadata.
const fetchTools = new Set(["web_extract", "skill_read"]);
// Fallback only for unknown external/MCP/client tools. Pe-owned tools should provide metadata.
const editTools = new Set([
  "write_file",
  "string_replace_lsp",
  "ast_smart_edit",
  "mkdir",
  "script_bootstrap",
  "script_pod_import",
  "script_pod_export",
  "request_access",
  "live_rrd_sync",
  "live_rrd_restart",
]);

const deleteTools = new Set(["delete_file"]);

export function toAcpToolKind(toolName: string, tool?: RuntimeToolMetadata): ToolKind {
  if (tool?.kind) return runtimeToolKindToAcp(tool.kind);
  if (executeTools.has(toolName)) return "execute";
  if (editTools.has(toolName)) return "edit";
  if (deleteTools.has(toolName)) return "delete";
  if (searchTools.has(toolName)) return "search";
  if (fetchTools.has(toolName)) return "fetch";
  if (readTools.has(toolName)) return "read";
  if (
    toolName === "task_write" ||
    toolName === "task_update" ||
    toolName === "task_complete" ||
    toolName === "task_check"
  )
    return "think";
  return "other";
}

export function toAcpToolTitle(toolName: string, tool?: RuntimeToolMetadata): string {
  return runtimeToolTitle(toolName, tool);
}

function runtimeToolKindToAcp(kind: RuntimeToolKind): ToolKind {
  switch (kind) {
    case "read":
    case "search":
    case "fetch":
    case "edit":
    case "delete":
    case "execute":
    case "think":
    case "other":
      return kind;
  }
}
