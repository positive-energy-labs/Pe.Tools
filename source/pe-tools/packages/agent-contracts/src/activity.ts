/**
 * Activity vocabulary — the sentence grammar's verb map.
 *
 * One pure function from a tool call to a human verb phrase. Op keys and tool
 * names are wire identity and never renamed; this module is the ONLY place
 * they are translated into user-facing language. Tense is not stored: callers
 * render "pea is <gerund>" from a live status and "failed <gerund>" from a
 * failed one — a single gerund string is the whole grammar.
 */

import { parseRouteKey } from "./capability.ts";

export type SentenceAction =
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
  verb: SentenceAction;
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
  if (key === "family.editor.open") return { verb: "navigating", gerund: "opening", target: tail };
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
  pe_find: "Find a capability",
  pe_read: "Read",
  pe_do: "Do",
  target_set: "Propose the default Target",
  request_access: "Ask for access",
  read_image: "Look at an image",
  capture_view: "Capture a view",
  revit_api_docs_search: "Search the Revit docs",
  revit_api_docs_fetch: "Read the Revit docs",
};

/** `pe_read`/`pe_do` args → the route and member of a `route:` key, when the call targets a route. */
export function routeCallOf(
  toolName: string,
  args: unknown,
): { route: string; member?: string } | null {
  if (toolName !== "pe_do" && toolName !== "pe_read") return null;
  const key = str(parseArgs(args), "key");
  return key ? parseRouteKey(key) : null;
}

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
  const command = routeCallOf(toolName, args)?.member ?? str(parseArgs(args), "command");
  const action =
    command === undefined
      ? "Read"
      : command === "propose"
        ? "Draft update"
        : command.charAt(0).toUpperCase() + command.slice(1);
  return running ? `${action} in progress` : action;
}
