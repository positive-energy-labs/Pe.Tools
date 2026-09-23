import type {
  AgentControllerAvailableModel,
  KnownAgentControllerEvent,
  MastraDBMessage,
  MastraMessagePart,
  PermissionRules,
} from "@mastra/client-js";
import { threadAccessPolicies, type ExpiredAsk, type ThreadViewState } from "@pe/agent-contracts";
import { stringify } from "../components/lang/code-format.ts";
import type { PeInspect } from "../host/inspect.ts";

export type ChatDisplay = Omit<
  Partial<Extract<KnownAgentControllerEvent, { type: "display_state_changed" }>["displayState"]>,
  "omProgress"
> & { omProgress?: OmProgress };

interface OmProgress {
  status?: string;
  pendingTokens?: number;
  threshold?: number;
  observationTokens?: number;
  reflectionThreshold?: number;
  buffered?: {
    observations?: { status?: string };
    reflection?: { status?: string; observationTokens?: number };
  };
}

/** The fetched thread body plus the live display frame from the stream. */
export type ChatState = ThreadViewState<
  MastraDBMessage,
  AgentControllerAvailableModel,
  PermissionRules | undefined,
  PeInspect
> & { display: ChatDisplay };
/** `/pe/thread` is the durable body only; display state arrives solely over the stream. */
export type ThreadBody = Omit<ChatState, "display">;
export type AccessLevel = ChatState["access"];

/**
 * A user turn is a persisted user row or a live user signal. The persisted row says `type: "user"`
 * with text parts; the live `message_start` carries a `data-user-message` signal part.
 */
export function isUserTurn(message: MastraDBMessage): boolean {
  if (message.role === "user") return true;
  if (message.role !== "signal") return false;
  const signal = readRecord(readRecord(message.content.metadata)?.signal);
  return message.type === "user" || signal?.type === "user";
}

export function emptyChatState(): ChatState {
  return {
    display: {},
    messages: [],
    inspect: {},
    models: { available: [] },
    permissions: undefined,
    access: "ask",
    modeId: "",
  };
}

/** `result` is whatever the call has produced so far: partial while running, raw on failure. */
type ToolOutcome = { result?: unknown } & (
  | { status: "in_progress" }
  | { status: "completed" }
  | { status: "failed"; error: string }
  /** An ask whose turn is gone (turn end, cancel, host restart): a record, never answerable. */
  | { status: "expired" }
  /** A non-ask call a person's cancel stopped mid-run (the runtime's record): not a failure. */
  | { status: "cancelled" }
);

export type ToolCall = {
  id: string;
  title: string;
  args: unknown;
  target?: string;
  parentMessageId?: string;
  /** Images the call produced so far, from its result or, while it runs, its progress. */
  images: string[];
} & ToolOutcome;

/**
 * The thread's user turns and assistant rows, with the message the run is streaming merged in by
 * id. Every chat projection reads this list, so the transcript and the trace lane agree.
 */
function threadRows(state: ChatState): MastraDBMessage[] {
  const stored = state.messages.filter(
    (message) => isUserTurn(message) || message.role === "assistant",
  );
  const wire = state.display.isRunning ? state.display.currentMessage : undefined;
  if (!wire) return stored;
  const current: MastraDBMessage = { ...wire, createdAt: new Date(wire.createdAt) };
  return stored.some((message) => message.id === current.id)
    ? stored.map((message) => (message.id === current.id ? current : message))
    : [...stored, current];
}

/** The one tool-call merge: stored invocations first (first sighting wins), then live-only tools,
 * which belong to the last assistant row. */
export function selectToolCalls(state: ChatState): ToolCall[] {
  const rows = threadRows(state);
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  const expired = new Set(selectExpiredAsks(state).map((ask) => ask.toolCallId));
  const cancelled = new Set((state.cancelledCalls ?? []).map((call) => call.toolCallId));
  // A call the live frame holds an approval for is waiting on a person, not interrupted.
  const waiting = new Set(selectApprovals(state.display).map((approval) => approval.toolCallId));
  for (const [messageAt, message] of rows.entries()) {
    for (const part of message.content.parts) {
      if (part.type !== "tool-invocation") continue;
      const call = part.toolInvocation;
      if (seen.has(call.toolCallId)) continue;
      seen.add(call.toolCallId);
      const active = state.display.activeTools?.[call.toolCallId];
      const terminal =
        call.state === "result" || call.state === "output-error" || call.state === "output-denied";
      const interrupted =
        !terminal &&
        !active &&
        !waiting.has(call.toolCallId) &&
        (messageAt < rows.length - 1 || state.display.isRunning !== true);
      const args = call.rawInput ?? call.args;
      const result = call.result ?? active?.result;
      // Mastra keeps a call its input validation refused as a `result` holding the error; a tool
      // that threw is a `result` of `{ isError: true, content }`.
      const rejected = readRecord(result)?.error === true || readRecord(result)?.isError === true;
      // A live approval wins: Mastra's `agent_end` (reason "suspended") marks every still-running
      // active tool `status: "error"`, the suspended ask among them (F-J1-9). It is waiting.
      const failed =
        !waiting.has(call.toolCallId) &&
        (call.isError === true ||
          (terminal && call.state !== "result") ||
          // A stored terminal state wins: a turn that ended in error marks its live calls `error`,
          // and the run can still store their results afterwards (F-H6-8).
          (!terminal && active?.status === "error") ||
          rejected ||
          interrupted);
      const completed = terminal || active?.status === "completed";
      const images = toolImages(result ?? progressOutput(active?.partialResult));
      const outcome: ToolOutcome = expired.has(call.toolCallId)
        ? { status: "expired", result }
        : cancelled.has(call.toolCallId)
          ? { status: "cancelled", result }
          : failed
            ? {
                status: "failed",
                error:
                  call.errorText ||
                  readString(readRecord(result)?.message) ||
                  readString(readRecord(result)?.content) ||
                  text(result) ||
                  "Tool call ended without a terminal result.",
                result,
              }
            : { status: completed ? "completed" : "in_progress", result };
      calls.push({
        id: call.toolCallId,
        title: call.toolName,
        args,
        target: toolTarget(args),
        parentMessageId: message.id,
        images,
        ...outcome,
      });
    }
  }
  const lastAssistantId = rows.filter((m) => m.role === "assistant").at(-1)?.id;
  for (const [id, tool] of Object.entries(state.display.activeTools ?? {})) {
    if (seen.has(id)) continue;
    const result = tool.result ?? tool.shellOutput ?? tool.partialResult;
    const outcome: ToolOutcome =
      (tool.status === "error" || tool.isError) && !waiting.has(id)
        ? { status: "failed", error: text(tool.result) || "Tool call failed.", result }
        : { status: tool.status === "completed" ? "completed" : "in_progress", result };
    calls.push({
      id,
      title: tool.name,
      args: tool.args,
      target: toolTarget(tool.args),
      parentMessageId: lastAssistantId,
      images: toolImages(tool.result ?? progressOutput(tool.partialResult)),
      ...outcome,
    });
  }
  return calls;
}

/**
 * The one rule for "is this tool output entry an image", fitted to what the image tools really
 * return (`capture_view`, `read_image` in packages/mcps: `{ text, mediaType, byteSize, data }`):
 * - a record needs an `image/*` media type AND either base64 `data` (or a `data:image/` URL in it)
 *   or an `image`/`url` field holding a `data:image/` or http(s) URL;
 * - a bare string must be a `data:image/…;base64,` URL.
 * Anything else is not an image: a docs search row's `url: "local:P:…"` was wrapped as base64.
 * `field` names where the bytes sit, for the display projection below.
 */
function toolImage(part: unknown): { url: string; mime: string; field?: string } | undefined {
  if (typeof part === "string") {
    const mime = DATA_IMAGE.exec(part)?.[1];
    return mime ? { url: part, mime } : undefined;
  }
  const record = readRecord(part);
  const mime = readString(record?.mediaType) ?? readString(record?.mimeType);
  if (!record || !mime?.startsWith("image/")) return undefined;
  const data = readString(record.data);
  if (data !== undefined) {
    if (DATA_IMAGE.test(data)) return { url: data, mime, field: "data" };
    return looksBase64(data)
      ? { url: `data:${mime};base64,${data}`, mime, field: "data" }
      : undefined;
  }
  for (const field of ["image", "url"]) {
    const url = readString(record[field]);
    if (url && (DATA_IMAGE.test(url) || /^https?:\/\//i.test(url))) return { url, mime, field };
  }
  return undefined;
}

const DATA_IMAGE = /^data:(image\/[\w.+-]+);base64,/;

// ponytail: checks the first 64 chars and the length, not every byte; a multi-MB capture is
// re-read on every streamed frame. Tighten only if a non-image base64 look-alike shows up.
const looksBase64 = (value: string) =>
  value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(0, 64));

const outputEntries = (output: unknown): unknown[] => (Array.isArray(output) ? output : [output]);

/** Which images a tool call produced. The transcript strip and the trace lane both read this. */
export function toolImages(output: unknown): string[] {
  return outputEntries(output).flatMap((part) => toolImage(part)?.url ?? []);
}

/**
 * A running call's progress, as Mastra stores it: `tool_update` stringifies a non-string
 * payload onto `activeTools[id].partialResult`. Parse it back so its images count.
 */
function progressOutput(partial: unknown): unknown {
  if (typeof partial !== "string") return partial;
  try {
    return JSON.parse(partial) as unknown;
  } catch {
    return partial;
  }
}

/**
 * The tool output as the `out` block shows it: each inline image payload becomes a short
 * placeholder, so the block never spells base64. Display only; the output itself is untouched.
 */
export function toolOutputForDisplay(output: unknown): unknown {
  let count = 0;
  const swap = (part: unknown): unknown => {
    const image = toolImage(part);
    if (!image?.url.startsWith("data:")) return part;
    count += 1;
    const base64 = image.url.slice(image.url.indexOf(",") + 1);
    const bytes = Math.floor((base64.length * 3) / 4) - (base64.match(/=+$/)?.[0].length ?? 0);
    const label = `<image ${count}: ${image.mime}, ${formatBytes(bytes)}>`;
    return image.field ? { ...readRecord(part), [image.field]: label } : label;
  };
  return Array.isArray(output) ? output.map(swap) : swap(output);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; image: string; name?: string }
  | { type: "file"; name: string; mimeType: string }
  | { type: "tool-call"; call: ToolCall; approval?: Approval };

/** One row of the chat transcript. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  createdAt?: Date;
  /** The assistant row the run is producing now; its last part is the one still moving. */
  running: boolean;
}

/**
 * The list the chat draws, in the same render as the lens. While the run has not started an
 * assistant row yet, a running placeholder stands in so the caret shows at once.
 */
export function selectMessages(state: ChatState): ChatMessage[] {
  const rows = threadRows(state);
  const calls = selectToolCalls(state);
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const approvals = selectApprovals(state.display);
  const streamingId = state.display.isRunning ? state.display.currentMessage?.id : undefined;
  const toolPart = (call: ToolCall): ChatPart => ({
    type: "tool-call",
    call,
    approval: approvals.find((approval) => approval.toolCallId === call.id),
  });
  const emitted = new Set<string>();
  const messages = rows.map((message): ChatMessage => {
    const user = isUserTurn(message);
    const parts: ChatPart[] = [];
    for (const part of message.content.parts) {
      if (part.type === "text") {
        const text = textPart(part.text, user);
        if (text) parts.push(text);
      } else if (part.type === "reasoning") {
        if (part.reasoning.trim()) parts.push({ type: "reasoning", text: part.reasoning });
      } else if (part.type === "file") {
        const file = filePart(part.data, part.mimeType, readString(readRecord(part)?.filename));
        if (file) parts.push(file);
      } else if (part.type === "tool-invocation") {
        const call = callsById.get(part.toolInvocation.toolCallId);
        if (!call || emitted.has(call.id)) continue;
        emitted.add(call.id);
        parts.push(toolPart(call));
      } else if (part.type === "data-signal" || part.type === "data-user-message") {
        const data = readRecord(part.data);
        if (user) parts.push(...signalParts(data?.contents));
        else if (data?.tagName === "route-workspace") {
          const said = signalText(data.contents);
          if (said.trim()) parts.push({ type: "text", text: said });
        }
      }
    }
    if (!user)
      for (const call of calls)
        if (call.parentMessageId === message.id && !emitted.has(call.id)) {
          emitted.add(call.id);
          parts.push(toolPart(call));
        }
    return {
      id: message.id,
      role: user ? "user" : "assistant",
      parts,
      ...createdAt(message),
      running: !user && message.id === streamingId,
    };
  });
  if (selectRunStatus(state) !== "idle" && messages.at(-1)?.role !== "assistant")
    messages.push({ id: "pea-pending", role: "assistant", parts: [], running: true });
  // The one renderable rule: speech, an image, a call, or the row still being produced.
  return messages.filter(
    (message) => message.running || message.parts.some((part) => part.type !== "reasoning"),
  );
}

/** Mastra inlines a text attachment into the user turn as `[File: name]` and a fence. */
const INLINED_FILE = /^\[File: (.+)\]\n(`{3,})\n[\s\S]*\n\2$/;

function textPart(text: string, user: boolean): ChatPart | undefined {
  if (!text.trim()) return undefined;
  const inlined = user ? INLINED_FILE.exec(text) : null;
  return inlined
    ? { type: "file", name: inlined[1]!, mimeType: "text/plain" }
    : { type: "text", text };
}

function filePart(
  data: string | undefined,
  mimeType: string | undefined,
  name: string | undefined,
): ChatPart | undefined {
  if (mimeType && !mimeType.startsWith("image/"))
    return { type: "file", name: name ?? "file", mimeType };
  const image = imageSource(data, data, mimeType);
  return image ? { type: "image", image, ...(name ? { name } : {}) } : undefined;
}

/** A live user signal's `contents`: its text, then the files Mastra attached to the turn. */
function signalParts(contents: unknown): ChatPart[] {
  if (!Array.isArray(contents)) {
    const text = typeof contents === "string" ? textPart(contents, true) : undefined;
    return text ? [text] : [];
  }
  return contents.flatMap((entry) => {
    const record = readRecord(entry);
    const part =
      record?.type === "file"
        ? filePart(
            readString(record.data),
            readString(record.mediaType),
            readString(record.filename),
          )
        : textPart(readString(record?.text) ?? "", true);
    return part ? [part] : [];
  });
}

function signalText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => readString(readRecord(part)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function createdAt(message: MastraDBMessage): { createdAt?: Date } {
  const at = message.createdAt;
  if (!at) return {};
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? {} : { createdAt: date };
}

/** A permission gate answers yes/no; a suspension answers with a resume payload. */
export type Approval = { toolCallId: string; toolName: string } & (
  | { kind: "permission" }
  | { kind: "suspension"; payload: unknown }
);

/** A parked `ask_user`: Pea is waiting on the person, not working. A new turn expires it. */
export const isParkedAsk = (
  approval: Approval,
): approval is Extract<Approval, { kind: "suspension" }> =>
  approval.kind === "suspension" && approval.toolName === "ask_user";

export function selectApprovals(display: ChatDisplay): Approval[] {
  const approvals: Approval[] = [];
  const pending = display.pendingApproval;
  if (pending)
    approvals.push({
      kind: "permission",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
    });
  for (const suspension of Object.values(display.pendingSuspensions ?? {})) {
    approvals.push({
      kind: "suspension",
      toolCallId: suspension.toolCallId,
      toolName: suspension.toolName,
      payload: suspension.suspendPayload,
    });
  }
  return approvals;
}

/** The runtime derives expiry; an ask the live frame still holds wins over a stale body. */
function selectExpiredAsks(state: ChatState): ExpiredAsk[] {
  const live = new Set(selectApprovals(state.display).map((approval) => approval.toolCallId));
  return (state.expiredAsks ?? []).filter((ask) => !live.has(ask.toolCallId));
}

export type RunStatus = "idle" | "running" | "waiting";

export function selectRunStatus(state: ChatState): RunStatus {
  if (selectApprovals(state.display).length > 0) return "waiting";
  return state.display.isRunning ? "running" : "idle";
}

export function selectSkillCommands(inspect: PeInspect): { name: string; description: string }[] {
  return (inspect.skills ?? []).flatMap((skill) => {
    const record = readRecord(skill);
    const name = readString(record?.name);
    return name ? [{ name, description: readString(record?.description) ?? "skill" }] : [];
  });
}

export interface AccessLevelInfo {
  id: AccessLevel;
  name: string;
  description: string;
}

export const ACCESS_LEVELS: AccessLevelInfo[] = [
  { id: "read-only", name: "Read-only", description: "Block workspace changes." },
  { id: "ask", name: "Ask", description: "Ask before tools that change state." },
  { id: "trusted", name: "Trusted", description: "Run trusted workspace tools directly." },
];

export const PERMISSION_LEVELS = threadAccessPolicies;

export const APPROVAL_OPTIONS = [
  { id: "allow_once", kind: "allow-once", label: "Approve" },
  { id: "reject_once", kind: "reject-once", label: "Deny" },
];

export interface ContextItem {
  name: string;
  src?: string;
  tokens?: number;
  body?: string;
  state?: "in" | "on-demand" | "off";
}

export interface ContextSegment {
  id: string;
  label: string;
  tokens: number;
  items?: ContextItem[];
}

interface MemoryWindows {
  messageTokens: number;
  observationThreshold: number;
  observationTokens: number;
  reflectionThreshold: number;
  reflectionFloor?: number;
  observing?: boolean;
  reflecting?: boolean;
}

export interface ContextBreakdown {
  contextWindow?: number;
  totalTokens: number;
  segments: ContextSegment[];
  memoryWindows?: MemoryWindows;
}

export function selectBreakdown(state: ChatState): ContextBreakdown | undefined {
  const inspect = state.inspect;
  const systemPromptText = inspect.systemPrompt?.content;
  const tools = breakdownTools(inspect.toolList);
  const skills = breakdownSkills(inspect.skills);
  if (
    systemPromptText === undefined &&
    tools.length === 0 &&
    skills.length === 0 &&
    inspect.contextWindow === undefined
  )
    return undefined;

  const segments: ContextSegment[] = [];
  const chat = state.messages.filter((m) => isUserTurn(m) || m.role === "assistant");
  const messageTokens = chat.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
  if (messageTokens > 0)
    segments.push({
      id: "messages",
      label: "Messages",
      tokens: messageTokens,
      items: [
        {
          name: `Conversation tail · ${chat.length} msgs`,
          src: "transcript",
          tokens: messageTokens,
          state: "in",
          body: "The newest turn is always uncached — this tail is reprocessed every send.",
        },
      ],
    });
  if (systemPromptText !== undefined)
    segments.push({
      id: "system-prompt",
      label: "System prompt",
      tokens: estimateTokens(systemPromptText),
      items: systemPromptItems(systemPromptText, inspect.agents),
    });
  if (tools.length > 0)
    segments.push({
      id: "tools",
      label: "Tools & MCP",
      tokens: tools.reduce((sum, tool) => sum + (tool.tokens ?? 0), 0),
      items: tools.map((tool) => ({ ...tool, state: "in" as const })),
    });
  if (skills.length > 0) segments.push({ id: "skills", label: "Skills", tokens: 0, items: skills });

  const totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (inspect.contextWindow && inspect.contextWindow > totalTokens)
    segments.push({ id: "free", label: "Free space", tokens: inspect.contextWindow - totalTokens });

  return {
    contextWindow: inspect.contextWindow,
    totalTokens,
    segments,
    memoryWindows: memoryWindows(state.display.omProgress),
  };
}

function memoryWindows(om: OmProgress | undefined): MemoryWindows | undefined {
  if (!om) return undefined;
  const floor = om.buffered?.reflection?.observationTokens ?? 0;
  return {
    messageTokens: om.pendingTokens ?? 0,
    observationThreshold: om.threshold ?? 0,
    observationTokens: om.observationTokens ?? 0,
    reflectionThreshold: om.reflectionThreshold ?? 0,
    ...(floor > 0 ? { reflectionFloor: floor } : {}),
    observing: om.buffered?.observations?.status === "running" || om.status === "observing",
    reflecting: om.buffered?.reflection?.status === "running" || om.status === "reflecting",
  };
}

function systemPromptItems(text: string, agents: unknown[] | undefined): ContextItem[] {
  const trimmed = text.trim();
  const items: ContextItem[] = trimmed
    ? [
        {
          name: "Base identity",
          src: "resolved prompt",
          tokens: estimateTokens(trimmed),
          body: trimmed,
          state: "in",
        },
      ]
    : [];
  for (const agent of agents ?? []) {
    const record = readRecord(agent);
    const name = typeof agent === "string" ? agent : readString(record?.name);
    if (!name) continue;
    items.push({
      name: `agent · ${name}`,
      src: "agent instructions",
      body: readString(record?.description),
      state: "in",
    });
  }
  return items;
}

function breakdownTools(toolList: PeInspect["toolList"]): ContextItem[] {
  return (toolList?.tools ?? []).flatMap((tool): ContextItem[] => {
    const record = readRecord(tool);
    const name = readString(record?.name);
    if (!name) return [];
    const approx = record?.approxTokens;
    return [
      {
        name,
        src: "runtime/tools",
        tokens: typeof approx === "number" ? approx : estimateTokens(name),
        body: readString(record?.description),
      },
    ];
  });
}

function breakdownSkills(skills: unknown[] | undefined): ContextItem[] {
  return (skills ?? []).flatMap((skill): ContextItem[] => {
    const record = readRecord(skill);
    const name = readString(record?.name);
    if (!name) return [];
    const approx = record?.approxTokens;
    return [
      {
        name,
        src: ".claude/skills",
        tokens: typeof approx === "number" ? approx : undefined,
        body:
          readString(record?.body) ??
          readString(record?.content) ??
          readString(record?.description),
        state: "on-demand",
      },
    ];
  });
}

function estimateTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

function messageText(message: MastraDBMessage): string {
  return message.content.parts
    .map((part) => partText(part))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function partText(part: MastraMessagePart): string {
  if (part.type === "text") return part.text;
  if (part.type === "reasoning") return part.reasoning;
  return "";
}

export function toolTarget(args: unknown): string | undefined {
  const record = readRecord(args);
  // pe_read / pe_do: the capability key is what the user reads on the card.
  if (typeof record?.key === "string") return record.key;
  const candidate = record?.path ?? record?.file ?? record?.query ?? record?.command;
  if (typeof candidate === "string") return candidate;
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
}

/** Display text for a value that may already BE text. Not `stringify`: an error message
 * must not reach the user wrapped in quotes. */
function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : stringify(value);
}

export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function imageSource(
  direct: string | undefined,
  data: string | undefined,
  mime: string | undefined,
): string | undefined {
  if (direct && /^(data:|https?:|blob:)/.test(direct)) return direct;
  const raw = data ?? (direct && !direct.includes("/") ? direct : undefined);
  if (raw) return `data:${mime ?? "image/png"};base64,${raw}`;
  return direct;
}
