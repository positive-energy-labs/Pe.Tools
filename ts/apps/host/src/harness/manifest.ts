/**
 * The harness manifest: the one declaration of what a Pea harness child may see, projected into
 * both launches (agent LEDGER, 2026-11-10 "one manifest"). A child sees exactly this and nothing
 * from the user's own account: no claude.ai connectors (Gmail, Drive, Docs), no cron or worktree
 * tools, no attribution reminder, no Codex apps/plugins/memories. Pea's own MCP is the only
 * declared server; it stays local and direct because it carries Revit authority over loopback.
 * No remote MCP gateway is declared: an outside service's send tools need a door that returns
 * "held" first (ADR 0038 consequences).
 *
 * Capability is not gated by default: the tool list cuts only account-leaked and irrelevant tools.
 */

/** Built-in Claude tools a Pea child keeps. Everything else is not offered to the model at all. */
const CLAUDE_TOOLS = [
  "Bash",
  "PowerShell",
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "NotebookEdit",
  "Skill",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "Agent",
  "Task",
  "TaskOutput",
  "TaskStop",
  "TodoWrite",
  "Monitor",
  "SendMessage",
  // The question card (ACP form elicitation) and plan mode are Pea surfaces.
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  // Pea's own MCP is the only declared server; its resources are read through these.
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  "ReadMcpResourceDirTool",
] as const;

export const harnessManifest = {
  /** MCP server names a child may have: Pea's own, and nothing else. */
  mcpServers: ["pea"],
  claude: {
    tools: CLAUDE_TOOLS,
    /** Inline `settings`: highest-precedence tier short of managed policy; user settings cannot undo it. */
    settings: {
      disableClaudeAiConnectors: true,
      // An empty string hides the attribution reminder (SDK `Settings.attribution`).
      attribution: { commit: "", pr: "", sessionUrl: false },
      // Pea is not a git workflow: no git instructions or `gitStatus` snapshot of the world root.
      includeGitInstructions: false,
    },
    /** The same switches by environment, for a CLI that ignores one door. */
    env: {
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_CODE_DISABLE_CRON: "1",
    },
  },
  codex: {
    /** `[features]` keys written false in the world root's project config. */
    features: ["apps", "plugins", "browser_use", "computer_use", "memories", "tool_suggest"],
  },
} as const;

export type HarnessManifest = typeof harnessManifest;

/** `_meta` for Claude `session/new|resume|fork`: the manifest as adapter options. */
export function claudeSessionMeta(manifest: HarnessManifest = harnessManifest) {
  return {
    claudeCode: {
      options: {
        // The product home's .claude/skills are Pea's skills; the user's own settings stay out.
        settingSources: ["project", "local"],
        strictMcpConfig: true,
        tools: [...manifest.claude.tools],
        settings: manifest.claude.settings,
        env: manifest.claude.env,
      },
      // The SDK `system/init` frame (tools, mcp_servers) is the child's effective context.
      emitRawSDKMessages: [{ type: "system", subtype: "init" }],
    },
  };
}

/** The Claude session's own report of what it has, as the SDK `system/init` frame carries it. */
export type ClaudeInit = {
  tools?: readonly string[];
  mcp_servers?: readonly { name: string; status?: string }[];
};

/** The server segment of `mcp__<server>__<tool>`. */
const toolServer = (tool: string) => /^mcp__(.+?)__/.exec(tool)?.[1];

/**
 * What the child has that the manifest does not declare, or null when it matches. The check is
 * the refusal: a mismatch means a Claude Code update or a user setting opened a door the launch
 * options did not close.
 */
export function undeclaredContext(
  init: ClaudeInit,
  manifest: HarnessManifest = harnessManifest,
): string | null {
  const servers: readonly string[] = manifest.mcpServers;
  const tools: readonly string[] = manifest.claude.tools;
  const extraServers = (init.mcp_servers ?? [])
    .map((s) => s.name)
    .filter((n) => !servers.includes(n));
  const extraTools = (init.tools ?? []).filter((tool) => {
    const server = toolServer(tool);
    return server === undefined ? !tools.includes(tool) : !servers.includes(server);
  });
  if (!extraServers.length && !extraTools.length) return null;
  return [
    "Pea refused to start this harness: its context is not what the host declared.",
    extraServers.length ? `Undeclared MCP servers: ${extraServers.join(", ")}.` : "",
    extraTools.length ? `Undeclared tools: ${extraTools.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The `_claude/sdkMessage` ext notification's init frame, or null for any other message. */
export function claudeInit(method: string, params: Record<string, unknown>): ClaudeInit | null {
  const message = params.message as { type?: string; subtype?: string } | undefined;
  return method === "_claude/sdkMessage" && message?.type === "system" && message.subtype === "init"
    ? (message as ClaudeInit)
    : null;
}
