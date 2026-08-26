import type { PermissionRules, ToolCategory } from "@mastra/core/agent-controller";

export type RuntimeAccessLevel = "read-only" | "ask" | "trusted";

const categories: ToolCategory[] = ["read", "edit", "execute", "mcp", "other"];
const policies: Record<RuntimeAccessLevel, Record<ToolCategory, "allow" | "ask" | "deny">> = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
};

export function permissionRulesForAccessLevel(level: RuntimeAccessLevel): PermissionRules {
  return { categories: { ...policies[level] }, tools: {} };
}

export function accessLevelFromPermissionRules(
  rules: PermissionRules,
  yolo: boolean,
): RuntimeAccessLevel | undefined {
  if (yolo || Object.keys(rules.categories).length !== categories.length) return undefined;
  return (Object.keys(policies) as RuntimeAccessLevel[]).find((level) =>
    categories.every((category) => rules.categories[category] === policies[level][category]),
  );
}
