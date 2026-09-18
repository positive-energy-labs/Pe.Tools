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

/**
 * The one ask lifetime: an ask (permission gate or tool suspension) lives as long as the turn
 * awaiting it. Navigation and reload are not here: the ask is thread state, replayed on reattach.
 * Ruled (meta): a new turn (send, steer, followUp or signal) started while an ask is parked
 * expires it; an abort-cancelled gate is expired, never denied.
 */
export const askExpiryTriggers = ["turn-end", "cancel", "host-restart", "new-turn"] as const;
export type AskExpiry = (typeof askExpiryTriggers)[number];

/** A run's end reason, or a new turn → the trigger that expires parked asks; null keeps them. */
export function askExpiryOf(
  reason: "complete" | "error" | "aborted" | "suspended" | "new-turn" | undefined,
): AskExpiry | null {
  if (reason === "suspended") return null;
  if (reason === "new-turn") return reason;
  return reason === "aborted" ? "cancel" : "turn-end";
}

export const askLifetime = `expires on ${askExpiryTriggers.map((trigger) => trigger.replace("-", " ")).join(" / ")}; survives navigation and reload`;

/** A stored ask call that no live turn awaits any more: a transcript record, never answerable. */
export interface ExpiredAsk {
  messageId: string;
  toolCallId: string;
  toolName: string;
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
  expiredAsks?: ExpiredAsk[];
  inspect: TInspect;
  models: { currentId?: string; available: TModel[] };
  permissions: TPermissions;
  access: "read-only" | "ask" | "trusted";
  modeId: string;
}
