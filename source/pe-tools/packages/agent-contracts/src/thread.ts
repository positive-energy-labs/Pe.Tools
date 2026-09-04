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

export interface ThreadViewState<
  TMessage extends { id: string } = { id: string },
  TDisplay = unknown,
  TModel = unknown,
  TPermissions = unknown,
  TInspect = unknown,
> {
  display: TDisplay;
  messages: TMessage[];
  inspect: TInspect;
  models: { currentId?: string; available: TModel[] };
  permissions: TPermissions;
  access: "read-only" | "ask" | "trusted";
  modeId: string;
}
