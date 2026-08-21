/**
 * Activity vocabulary — the sentence grammar's verb map.
 *
 * One pure function from a tool call to a human verb phrase. Op keys and tool
 * names are wire identity and never renamed; this module is the ONLY place
 * they are translated into user-facing language. Tense is not stored: callers
 * render "pea is <gerund>" from a live status and "failed <gerund>" from a
 * failed one — a single gerund string is the whole grammar.
 */
import type { WorkbenchToolCall } from "./contracts.ts";

export type SentenceVerb =
  | "working"
  | "looking"
  | "reading docs"
  | "searching"
  | "suggesting"
  | "editing"
  | "navigating"
  | "scripting"
  | "tending worlds"
  | "asking";

export interface Activity {
  verb: SentenceVerb;
  /** Verb phrase in gerund form, e.g. "opening", "editing", "looking at". */
  gerund: string;
  /** Short noun the gerund acts on (doc name, op tail, route) when derivable. */
  target?: string;
}

/** Read-verb families of the host op catalog (second key segment / first for host-local). */
const READ_OP_FAMILIES = new Set([
  "catalog",
  "detail",
  "context",
  "matrix",
  "resolve",
  "sessions",
  "status",
  "tail",
  "tree",
  "workspaces",
  "schema",
  "ops",
]);

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function str(args: Record<string, unknown> | null, field: string): string | undefined {
  const value = args?.[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Derive the activity for a host op key — reuses the catalog's own verb ladder. */
export function deriveOpActivity(key: string): Activity {
  const tail = key.split(".").slice(1).join(".") || key;
  if (key === "revit.apply.document.open" || key === "family.editor.open")
    return { verb: "navigating", gerund: "opening", target: tail };
  if (key.startsWith("scripting.")) return { verb: "scripting", gerund: "scripting", target: tail };
  const family = key.split(".")[1] ?? key.split(".")[0];
  if (READ_OP_FAMILIES.has(family) || key.endsWith(".open") || key.endsWith(".validate"))
    return { verb: "looking", gerund: "looking at", target: tail };
  // remaining families mutate: revit.apply.*, family.editor.apply, settings.document.save, aps.auth.*
  return { verb: "editing", gerund: "editing", target: tail };
}

/**
 * Lay-user tool titles — the alias extension point. Add a row here to rename a tool on
 * every chip/trace surface at once; unlisted tools fall back to title-cased wire names.
 */
export const TOOL_TITLES: Record<string, string> = {
  pe_status: "Status check",
  pe_logs: "Read logs",
  host_operation_search: "Find a capability",
  host_operation_call: "Revit operation",
  request_access: "Ask for access",
  read_image: "Look at an image",
  capture_view: "Capture a view",
  revit_api_docs_search: "Search the Revit docs",
  revit_api_docs_fetch: "Read the Revit docs",
  script_bootstrap: "Draft a script",
  script_execute: "Run a script",
  route_state_read: "Read the workspace",
  route_state_apply: "Suggest workspace changes",
  route_command: "Workspace command",
};

/** Human title for a tool call. Alias first, else Title Cased wire name. */
export function toolTitle(toolName: string): string {
  return (
    TOOL_TITLES[toolName] ??
    toolName
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/** Short action label for a route-plugin tool card ("Read", "Draft update", "Apply"). */
export function actionLabel(toolName: string, args: unknown, running: boolean): string {
  const parsed = parseArgs(args);
  const command = str(parsed, "command");
  const action =
    toolName === "route_state_read"
      ? "Read"
      : toolName === "route_state_apply"
        ? "Draft update"
        : command === "refresh"
          ? "Refresh"
          : command === "preview"
            ? "Preview"
            : command === "apply"
              ? "Apply"
              : (command ?? "Command");
  return running ? `${action} in progress` : action;
}

/** Total map from a tool call to its activity. Unknown tools fall back to "working". */
export function deriveActivity(call: WorkbenchToolCall): Activity {
  const args = parseArgs(call.rawInput);
  switch (call.title) {
    case "pe_status":
    case "pe_logs":
    case "route_state_read":
      return { verb: "looking", gerund: "looking around" };
    case "capture_view":
    case "read_image":
      return { verb: "looking", gerund: "looking at", target: str(args, "viewName") ?? "a view" };
    case "host_operation_search":
      return {
        verb: "searching",
        gerund: "searching for a capability",
        target: str(args, "query"),
      };
    case "revit_api_docs_search":
    case "revit_api_docs_fetch":
      return { verb: "reading docs", gerund: "reading the Revit API docs" };
    case "script_bootstrap":
    case "script_execute":
      return { verb: "scripting", gerund: "scripting" };
    case "request_access":
      return { verb: "asking", gerund: "asking for access" };
    case "route_state_apply":
      return { verb: "suggesting", gerund: "suggesting", target: str(args, "route") };
    case "route_command": {
      const command = str(args, "command");
      const route = str(args, "route");
      if (command === "open") return { verb: "navigating", gerund: "opening", target: route };
      if (command === "apply" || command === "push" || command === "save")
        return { verb: "editing", gerund: "editing", target: route };
      return { verb: "looking", gerund: "looking at", target: route };
    }
    case "host_operation_call": {
      const key = str(args, "key");
      return key ? deriveOpActivity(key) : { verb: "working", gerund: "working" };
    }
    default:
      return { verb: "working", gerund: "working", target: call.target };
  }
}
