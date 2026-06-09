import type { ToolKind } from "@agentclientprotocol/sdk";

const executeTools = new Set([
  "execute_command",
  "get_process_output",
  "kill_process",
  "script_execute",
  "test",
]);

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

const searchTools = new Set(["search_content", "find_files", "web_search", "skill_search"]);

const fetchTools = new Set(["web_extract", "skill_read"]);

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

export function toAcpToolKind(toolName: string): ToolKind {
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

export function toAcpToolTitle(toolName: string): string {
  return (
    toolName
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Tool Call"
  );
}
