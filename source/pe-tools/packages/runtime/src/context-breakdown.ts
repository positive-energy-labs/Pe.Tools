/** One named constituent of a context segment — a tool, a prompt section, a skill. */
export interface WorkbenchContextItem {
  name: string;
  /** Provenance line, mono (e.g. "runtime/tools", "mcp · server-x", ".claude/skills"). */
  src?: string;
  /** Approx tokens this item costs in-context. */
  tokens?: number;
  /** Expandable content preview (tool description, prompt section body, skill content). */
  body?: string;
  /** Load state: in-context, catalog-only (loads on demand), or configured-but-off. */
  state?: "in" | "on-demand" | "off";
}

export interface WorkbenchContextSegment {
  id: string;
  label: string;
  tokens: number;
  items?: WorkbenchContextItem[];
}

export interface WorkbenchContextBreakdown {
  contextWindow?: number;
  totalTokens: number;
  segments: WorkbenchContextSegment[];
  updatedAt?: string;
}

export interface ContextBreakdownTool {
  name: string;
  /** AI-SDK tool type ("function" for builtins; MCP/provider tools differ). */
  type?: string;
  id?: string;
  /** Tool description — the expandable body of a tool row. */
  description?: string;
  /** Input JSON schema (the args the model fills in) — inspectable in the tool row. */
  inputSchema?: unknown;
  /** Output schema, when the tool declares one. */
  outputSchema?: unknown;
  approxTokens?: number;
}

export interface ContextBreakdownMessage {
  role: string;
  text: string;
}

export interface ContextBreakdownSkill {
  name: string;
  description?: string;
  /** Full skill markdown — the expandable body of a skill card. */
  body?: string;
  approxTokens?: number;
}

export interface ContextBreakdownAgent {
  name: string;
  /** Agent description — the expandable body of the agent identity card. */
  description?: string;
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
  /** Active observation text (what the agent has remembered) — the Memory card body. */
  observationText?: string;
  /** Loaded skills — listed under the system-prompt segment (not summed; corpus, not in-context). */
  skills?: ContextBreakdownSkill[];
  /** Loaded agents — listed under the system-prompt segment, description as the card body. */
  agents?: ContextBreakdownAgent[];
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
 * window; `free` is whatever the window has left. Each segment carries structured items
 * (individual tools, prompt sections, skill cards) so the World inspector can expand them.
 * Skills/agents are listed under the system-prompt segment (their bytes are already inside
 * it or loaded on demand), so they annotate without double-counting.
 */
export function buildContextBreakdown(
  input: BuildContextBreakdownInput,
): WorkbenchContextBreakdown {
  const systemTokens = estimateTokens(input.systemPromptText);
  const messages = input.messages ?? [];
  const messageTokens = messages.reduce((sum, message) => sum + estimateTokens(message.text), 0);
  const tools = input.tools ?? [];
  const toolTokens = tools.reduce(
    (sum, tool) => sum + (tool.approxTokens ?? estimateTokens(tool.name)),
    0,
  );
  const memoryTokens = Math.max(0, input.memoryTokens ?? 0);

  const segments: WorkbenchContextSegment[] = [];
  if (messageTokens > 0)
    segments.push({
      id: "messages",
      label: "Messages",
      tokens: messageTokens,
      items: messageItems(messages, messageTokens),
    });
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
      items: tools.map((tool) => ({
        name: tool.name,
        src: toolSource(tool),
        tokens: tool.approxTokens ?? estimateTokens(tool.name),
        body: toolBody(tool),
        state: "in" as const,
      })),
    });
  }

  const skills = input.skills ?? [];
  if (skills.length > 0) {
    segments.push({
      id: "skills",
      label: "Skills",
      // Skills load on demand — their markdown is corpus, not summed into the prefix.
      tokens: 0,
      items: skills.map((skill) => ({
        name: skill.name,
        src: ".claude/skills",
        tokens: skill.approxTokens,
        body: skill.body ?? skill.description,
        state: "on-demand" as const,
      })),
    });
  }
  if (memoryTokens > 0)
    segments.push({
      id: "memory",
      label: "Memory",
      tokens: memoryTokens,
      items: [
        {
          name: "Observational memory",
          src: "thread-scoped",
          tokens: memoryTokens,
          state: "in",
          // The actual remembered text when available, else a one-line explainer.
          body:
            input.observationText?.trim() ||
            "What the agent inferred from this thread so far — summarized into context.",
        },
      ],
    });

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

function toolSource(tool: ContextBreakdownTool): string {
  // ponytail: pea's tools are all runtime tools; MCP tools (when a runtime has them)
  // arrive with a distinct type/id namespace — surface it when present, else "runtime/tools".
  if (tool.type && tool.type !== "function") return `mcp · ${tool.type}`;
  if (tool.id && tool.id.includes("__")) return `mcp · ${tool.id.split("__")[1]}`;
  return "runtime/tools";
}

/** Tool row body: description, then the input/output JSON schemas when present. */
function toolBody(tool: ContextBreakdownTool): string | undefined {
  const parts: string[] = [];
  if (tool.description) parts.push(tool.description.trim());
  const input = schemaText(tool.inputSchema);
  if (input) parts.push(`input schema:\n${input}`);
  const output = schemaText(tool.outputSchema);
  if (output) parts.push(`output schema:\n${output}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function schemaText(schema: unknown): string | undefined {
  if (schema == null) return undefined;
  try {
    const json = JSON.stringify(schema, null, 2);
    return json && json !== "{}" ? json : undefined;
  } catch {
    return undefined;
  }
}

function systemPromptItems(input: BuildContextBreakdownInput): WorkbenchContextItem[] | undefined {
  const items: WorkbenchContextItem[] = [
    ...splitSystemPrompt(input.systemPromptText),
    ...(input.agents ?? []).map((agent) => ({
      name: `agent · ${agent.name}`,
      src: "agent instructions",
      body: agent.description,
      state: "in" as const,
    })),
  ];
  return items.length > 0 ? items : undefined;
}

/**
 * Split the resolved system prompt into section cards. Heuristic: break before each
 * markdown H1/H2 and at provider system-message separators (`---`). The leading chunk
 * (before the first header) is the base identity. ponytail: a heuristic over the captured
 * blob — swap for labeled prompt fragments if the assembly ever emits them.
 */
function splitSystemPrompt(text: string | undefined): WorkbenchContextItem[] {
  const trimmed = text?.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/\n(?=#{1,2} )|\n-{3,}\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return [
      {
        name: "Base identity",
        src: "resolved prompt",
        tokens: estimateTokens(trimmed),
        body: trimmed,
        state: "in",
      },
    ];
  }
  return parts.map((part, index) => ({
    name:
      /^#{1,2}\s+(.+)$/m.exec(part)?.[1]?.trim() ??
      (index === 0 ? "Base identity" : firstLine(part)),
    src: "resolved prompt",
    tokens: estimateTokens(part),
    body: part,
    state: "in" as const,
  }));
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim()) ?? "section";
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

/**
 * The conversation tail is the volatile end of the request — it's already rendered in the
 * chat pane, so the World pane only marks it (token weight + the cache truth), never re-lists
 * it. ponytail: a single marker row, not a per-message dump.
 */
function messageItems(messages: ContextBreakdownMessage[], tokens: number): WorkbenchContextItem[] {
  if (messages.length === 0) return [];
  return [
    {
      name: `Conversation tail · ${messages.length} msgs`,
      src: "transcript",
      tokens,
      state: "in",
      body: "The newest turn is always uncached — this tail is reprocessed every send. See the chat pane for the messages themselves.",
    },
  ];
}
