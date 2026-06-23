import type { WorkbenchContextBreakdown, WorkbenchContextSegment } from "@pe/agent-contracts";

export type { WorkbenchContextBreakdown, WorkbenchContextSegment } from "@pe/agent-contracts";

export interface ContextBreakdownTool {
  name: string;
  approxTokens?: number;
}

export interface ContextBreakdownMessage {
  role: string;
  text: string;
}

export interface ContextBreakdownSkill {
  name: string;
  approxTokens?: number;
}

export interface BuildContextBreakdownInput {
  /** Model context window in tokens; drives the free-space bar. */
  contextWindow?: number;
  /** Resolved system prompt bytes (the system messages at the provider boundary). */
  systemPromptText?: string;
  /** Tool / MCP definitions handed to the provider. */
  tools?: ContextBreakdownTool[];
  /** Conversation messages (already filtered to non-system roles). */
  messages?: ContextBreakdownMessage[];
  /** Observational-memory tokens already in context, if known. */
  memoryTokens?: number;
  /** Loaded skills — listed under the system-prompt segment (not summed; corpus, not in-context). */
  skills?: ContextBreakdownSkill[];
  /** Loaded agent instruction names — listed under the system-prompt segment. */
  agents?: string[];
  updatedAt?: string;
}

/**
 * ponytail: char/4 token estimate. Good enough for relative proportions in the UI;
 * swap for a provider tokenizer if exact counts ever matter.
 */
export function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Build the context-window token breakdown the workbench renders. The three measured
 * segments (system prompt, messages, tools) plus memory form the real partition of the
 * window; `free` is whatever the window has left. Skills/agents are listed as items under
 * the system-prompt segment (their bytes are already inside it or loaded on demand), so
 * they annotate without double-counting.
 */
export function buildContextBreakdown(
  input: BuildContextBreakdownInput,
): WorkbenchContextBreakdown {
  const systemTokens = estimateTokens(input.systemPromptText);
  const messageTokens = (input.messages ?? []).reduce(
    (sum, message) => sum + estimateTokens(message.text),
    0,
  );
  const tools = input.tools ?? [];
  const toolTokens = tools.reduce(
    (sum, tool) => sum + (tool.approxTokens ?? estimateTokens(tool.name)),
    0,
  );
  const memoryTokens = Math.max(0, input.memoryTokens ?? 0);

  const segments: WorkbenchContextSegment[] = [];
  if (messageTokens > 0)
    segments.push({ id: "messages", label: "Messages", tokens: messageTokens });
  if (systemTokens > 0 || input.systemPromptText !== undefined) {
    segments.push({
      id: "system-prompt",
      label: "System prompt",
      tokens: systemTokens,
      items: systemPromptItems(input),
    });
  }
  if (tools.length > 0) {
    segments.push({
      id: "tools",
      label: "Tools & MCP",
      tokens: toolTokens,
      // ponytail: one Tools segment, not a system/MCP split — tool names here carry no
      // reliable namespace to classify by. Split when an MCP-source signal is available.
      items: tools.map((tool) => formatItem(tool.name, tool.approxTokens)),
    });
  }
  if (memoryTokens > 0) segments.push({ id: "memory", label: "Memory", tokens: memoryTokens });

  const totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0);

  if (input.contextWindow && input.contextWindow > totalTokens) {
    segments.push({
      id: "free",
      label: "Free space",
      tokens: input.contextWindow - totalTokens,
    });
  }

  return {
    contextWindow: input.contextWindow,
    totalTokens,
    segments,
    updatedAt: input.updatedAt,
  };
}

function systemPromptItems(input: BuildContextBreakdownInput): string[] | undefined {
  const items = [
    ...(input.agents ?? []).map((name) => `agent · ${name}`),
    ...(input.skills ?? []).map((skill) => formatItem(`skill · ${skill.name}`, skill.approxTokens)),
  ];
  return items.length > 0 ? items : undefined;
}

function formatItem(name: string, tokens: number | undefined): string {
  return tokens ? `${name} · ~${tokens.toLocaleString()} tok` : name;
}
