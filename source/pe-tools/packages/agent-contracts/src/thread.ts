export const threadAccessPolicies = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
} as const;

export function threadAccess(permissions: unknown): ThreadViewState["access"] {
  const categories =
    permissions && typeof permissions === "object" && "categories" in permissions
      ? (permissions as { categories?: Record<string, unknown> }).categories
      : undefined;
  if (!categories) return "ask";
  return (
    (
      Object.entries(threadAccessPolicies) as [ThreadViewState["access"], Record<string, string>][]
    ).find(([, expected]) =>
      Object.entries(expected).every(([category, policy]) => categories[category] === policy),
    )?.[0] ?? "read-only"
  );
}

export type ToolResultSummary =
  | { kind: "array"; items: number }
  | { kind: "object"; keyCount: number; keys: string[] }
  | { kind: "string"; characters: number }
  | { kind: "scalar" };

export interface DeferredToolResultRef {
  messageId: string;
  toolCallId: string;
  byteSize: number;
  summary: ToolResultSummary;
}

export interface ToolResultResponse {
  messageId: string;
  toolCallId: string;
  result: unknown;
}

/** Persisted + session facts that survive a fetch. Live display state rides the SSE stream only. */
export interface ThreadViewState<
  TMessage extends { id: string } = { id: string },
  TModel = unknown,
  TPermissions = unknown,
  TInspect = unknown,
> {
  messages: TMessage[];
  deferredResults?: DeferredToolResultRef[];
  inspect: TInspect;
  models: { currentId?: string; available: TModel[] };
  permissions: TPermissions;
  access: "read-only" | "ask" | "trusted";
  modeId: string;
}
