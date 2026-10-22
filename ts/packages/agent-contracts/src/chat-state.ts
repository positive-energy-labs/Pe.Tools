import {
  attachmentKind,
  emptyThreadLifecycle,
  type HarnessEvent,
  type HarnessThreadBody,
  type Mention,
  type PromptAttachment,
  type ReadingFrame,
  emptyThreadHead,
} from "./index.ts";
import { stringify } from "./code-format.ts";

/** The thread body with every event the stream has appended since it was fetched. */
export type ChatState = HarnessThreadBody;
export type ThreadBody = HarnessThreadBody;

export function emptyChatState(): ChatState {
  return {
    id: "",
    harness: "claude",
    providerId: "",
    providerName: "",
    title: "",
    createdAt: "",
    updatedAt: "",
    modelId: null,
    models: [],
    traits: [],
    running: false,
    lastSeq: 0,
    cursor: 0,
    session: "closed",
    promptCapabilities: null,
    events: [],
    head: { ...emptyThreadHead, hostNow: "1970-01-01T00:00:00.000Z", grantView: null },
    lifecycle: emptyThreadLifecycle(),
    tabs: [],
    activity: { state: "idle", pending: 0, lastSeq: 0, message: null },
  };
}

export type ThreadFollow =
  | { kind: "apply"; event: HarnessEvent }
  | { kind: "skip" }
  | { kind: "reread" };
/**
 * The one rule every client follows the host log by: a `thread` Reading frame (`reading.ts`)
 * against the last `seq` its state holds. An event applies once, in `seq` order; a repeat is
 * skipped. A gap frame, or a hole in `seq`, says re-read the body and follow from its `cursor`.
 */
export function followThread(lastSeq: number, frame: ReadingFrame): ThreadFollow {
  if (frame.kind === "gap") return { kind: "reread" };
  if (frame.kind !== "event") return { kind: "skip" };
  const event = frame.value as HarnessEvent;
  if (event.seq <= lastSeq) return { kind: "skip" };
  return event.seq === lastSeq + 1 ? { kind: "apply", event } : { kind: "reread" };
}

/** `result` is whatever the call has produced so far: partial while running, raw on failure. */
type ToolOutcome = { result?: unknown } & (
  | { status: "in_progress" }
  | { status: "completed" }
  | { status: "failed"; error: string }
  /** Its permission ask expired unanswered: a record, never answerable. */
  | { status: "expired" }
  /** A cancel stopped it mid-run: not a failure. */
  | { status: "cancelled" }
  /** The user answered its permission ask with a reject option. */
  | { status: "denied" }
);

export type ToolCall = {
  id: string;
  title: string;
  args: unknown;
  target?: string;
  /** The harness's own caption of the act (ACP `title`), latest wins; `title` stays the tool id. */
  caption?: string;
  parentMessageId?: string;
  /** Images the call produced so far. */
  images: string[];
} & ToolOutcome;

/** One open ACP permission request, answered by `optionId`. */
export interface Approval {
  requestId: string;
  toolCallId: string;
  toolName: string;
  options: Extract<HarnessEvent, { kind: "permission_request" }>["options"];
}

/** One open ACP form question (`question_request`): answered with content keyed by property, or
 * declined. The schema is the ACP elicitation form verbatim; the question card renders it. */
export interface Question {
  requestId: string;
  message: string;
  requestedSchema: Record<string, unknown>;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; image: string; name?: string }
  | { type: "file"; name: string; mimeType: string; size: number; data?: string }
  | { type: "tool-call"; call: ToolCall; approval?: Approval };

/** A sent attachment as the user's bubble draws it: what crossed as an image is a thumbnail. */
const sentPart = (a: PromptAttachment): ChatPart =>
  attachmentKind(a) === "image"
    ? { type: "image", image: `data:${a.mimeType};base64,${a.data}`, name: a.name }
    : { type: "file", name: a.name, mimeType: a.mimeType, size: a.size, data: a.data };

/** One row of the chat transcript. `system` is a quiet line the host wrote, never a speaker. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ChatPart[];
  createdAt?: Date;
  /** A user turn's `@` mentions, as the prompt event recorded what Pea received. */
  mentions?: Mention[];
  /** A user turn's document, as its prompt event named it (the label), when one was bound. */
  target?: string;
  /** The assistant row the run is producing now; its last part is the one still moving. */
  running: boolean;
  failure?: Extract<HarnessEvent, { kind: "error" }>["failure"];
}

/** An ACP `ToolCall` / `ToolCallUpdate` body, as the host kept it verbatim. */
interface AcpToolCall {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown[] | null;
}

/** `mcp__pea__pe_do` (claude) or `mcp.pea.pe_do` (codex) → `pe_do`: records key on the Pea tool id. */
const toolId = (name: string) => name.replace(/^mcp__.+?__/, "").replace(/^mcp\.[^.]+\./, "");

/** Codex wraps an MCP call's input as `{server, tool, arguments}`; the call is `tool(arguments)`. */
function mcpInput(raw: unknown): { tool?: string; args: unknown } {
  const record = readRecord(raw);
  return record && typeof record.server === "string" && typeof record.tool === "string"
    ? { tool: record.tool, args: record.arguments }
    : { args: raw };
}

/**
 * A tool result as its value: an MCP `CallToolResult` (`{content: [...]}`, or codex's
 * `{result: {content: [...]}}`) or a list of text blocks becomes the text, and text that is JSON
 * becomes the JSON. Anything with an image stays as it is.
 */
function toolValue(result: unknown): unknown {
  const record = readRecord(result);
  const content = record?.content ?? readRecord(record?.result)?.content;
  const blocks = Array.isArray(content) ? content : result;
  if (Array.isArray(blocks) && blocks.length > 0) {
    const texts = blocks.map((block) => {
      const record = readRecord(block);
      return record?.type === "text" ? readString(record.text) : undefined;
    });
    if (texts.every((item) => item !== undefined)) result = texts.join("\n");
    else return blocks;
  }
  if (typeof result !== "string" || !/^\s*[[{]/.test(result)) return result;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

/** ACP tool content: text blocks become strings, image blocks stay records `toolImage` reads. */
function contentValue(content: unknown[] | null | undefined): unknown {
  if (!content?.length) return undefined;
  const values = content.map((item) => {
    const block = readRecord(readRecord(item)?.content);
    return block?.type === "text" ? block.text : (block ?? item);
  });
  return values.length === 1 ? values[0] : values;
}

function chunkText(update: Record<string, unknown>): string {
  const content = readRecord(update.content);
  return content?.type === "text" ? (readString(content.text) ?? "") : "";
}

/**
 * The one fold of the event log into transcript rows. `prompt` opens a user row; chunks, tool
 * calls and their updates land on the turn's assistant row; `turn_end`, `error` and `session`
 * close it; a `permission_request` with no later `permission_resolved` is that call's approval.
 */
function fold(state: ChatState): Fold {
  const cached = folds.get(state);
  if (cached) return cached;
  const rows: ChatMessage[] = [];
  const calls = new Map<string, ToolCall>();
  const approvals = new Map<string, Approval>();
  const questions = new Map<string, Question>();
  let open: ChatMessage | undefined;
  let turn = false;
  let failure: string | undefined;
  let title = state.title;

  const assistant = (event: HarnessEvent) => {
    if (open) return open;
    open = { id: `pea-${event.seq}`, role: "assistant", parts: [], running: true, ...at(event) };
    rows.push(open);
    return open;
  };
  /** A call the turn left unsettled ended with it: cancelled by a cancel, failed otherwise. */
  const close = (cancelled: boolean) => {
    for (const call of calls.values())
      if (call.status === "in_progress")
        Object.assign(
          call,
          cancelled
            ? { status: "cancelled" }
            : { status: "failed", error: "Tool call ended without a terminal result." },
        );
    if (open) open.running = false;
    open = undefined;
    turn = false;
    approvals.clear();
    questions.clear();
  };
  const line = (event: HarnessEvent, said: string) =>
    rows.push({
      id: `${event.kind}-${event.seq}`,
      role: "system",
      parts: [{ type: "text", text: said }],
      ...(event.kind === "error" && event.failure ? { failure: event.failure } : {}),
      running: false,
      ...at(event),
    });
  const applyCall = (event: HarnessEvent, body: AcpToolCall) => {
    let call = calls.get(body.toolCallId);
    if (!call) {
      const row = assistant(event);
      call = {
        id: body.toolCallId,
        title: "tool",
        args: undefined,
        images: [],
        status: "in_progress",
        parentMessageId: row.id,
      };
      calls.set(call.id, call);
      row.parts.push({ type: "tool-call", call });
    }
    // `name` is the tool's identity and arrives once; `title` is the harness's caption of the act,
    // and every update may rewrite it (a whole command line, a question). A caption never
    // replaces the identity — it was, and the transcript echoed the command as the tool's name.
    if (body.name) call.title = toolId(body.name);
    else if (body.title && call.title === "tool") call.title = toolId(body.title);
    if (body.title) call.caption = body.title;
    if (body.rawInput !== undefined) {
      const input = mcpInput(body.rawInput);
      if (input.tool) call.title = input.tool;
      call.args = input.args;
      call.target = toolTarget(input.args);
    }
    const raw = body.rawOutput ?? contentValue(body.content);
    const result = raw === undefined ? undefined : toolValue(raw);
    if (result !== undefined) {
      call.result = result;
      call.images = toolImages(result);
    }
    // A denied call stays denied: the harness reports the refusal as a failed call.
    if (call.status === "denied") return;
    if (body.status === "completed") call.status = "completed";
    if (body.status === "failed")
      Object.assign(call, { status: "failed", error: text(result) || "Tool call failed." });
  };

  for (const event of state.events) {
    switch (event.kind) {
      case "prompt":
        close(false);
        failure = undefined;
        turn = true;
        rows.push({
          id: `you-${event.seq}`,
          role: "user",
          parts: [{ type: "text", text: event.text }, ...(event.attachments ?? []).map(sentPart)],
          ...(event.mentions?.length ? { mentions: event.mentions } : {}),
          ...(event.target?.label ? { target: event.target.label } : {}),
          running: false,
          ...at(event),
        });
        break;
      case "update": {
        const update = event.update as Record<string, unknown>;
        const kind = update.sessionUpdate;
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
          const said = chunkText(update);
          if (!said) break;
          const type = kind === "agent_message_chunk" ? "text" : "reasoning";
          const row = assistant(event);
          const tail = row.parts.at(-1);
          if (tail?.type === type) tail.text += said;
          else row.parts.push({ type, text: said });
        } else if (kind === "tool_call" || kind === "tool_call_update") {
          applyCall(event, update as unknown as AcpToolCall);
        }
        break;
      }
      case "permission_request": {
        const toolCallId = event.toolCall.toolCallId;
        applyCall(event, event.toolCall as AcpToolCall);
        approvals.set(event.requestId, {
          requestId: event.requestId,
          toolCallId,
          toolName: calls.get(toolCallId)?.title ?? "tool",
          options: event.options,
        });
        break;
      }
      case "permission_resolved": {
        const ask = approvals.get(event.requestId);
        approvals.delete(event.requestId);
        const call = ask && calls.get(ask.toolCallId);
        if (call?.status !== "in_progress") break;
        if (event.by !== "user")
          Object.assign(call, { status: event.by === "expired" ? "expired" : "cancelled" });
        else if (ask!.options.find((o) => o.optionId === event.optionId)?.kind.startsWith("reject"))
          Object.assign(call, { status: "denied" });
        break;
      }
      case "question_request":
        questions.set(event.requestId, {
          requestId: event.requestId,
          message: event.message,
          requestedSchema: event.requestedSchema,
        });
        break;
      case "question_resolved":
        questions.delete(event.requestId);
        if (event.by !== "user")
          line(
            event,
            event.by === "expired" ? "question expired unanswered" : "question cancelled",
          );
        else if (event.action === "decline") line(event, "question skipped");
        break;
      case "turn_end":
        close(event.stopReason === "cancelled");
        // The user row the cancel orphaned needs its reason in the transcript.
        if (event.stopReason === "cancelled") line(event, "cancelled");
        break;
      case "error":
        // A host restart already wrote its record under the turn; it is not a failure to banner.
        if (event.message !== HOST_RESTARTED) failure = event.message;
        close(false);
        line(event, event.message);
        break;
      // A session event never ends a turn: the host spawns or resumes the child on a turn's first
      // prompt, so `session` follows that `prompt`, and an interrupted turn gets its own `error`.
      case "session":
        if (event.state === "detached")
          line(event, "new harness session; Pea re-fed the transcript from its record");
        if (event.state === "resumed") line(event, "session resumed");
        if (event.state === "forked")
          line(event, "forked; the harness session continues from here");
        break;
      case "title_changed":
        title = event.title;
        break;
    }
  }
  for (const approval of approvals.values()) {
    const part = rows
      .flatMap((row) => row.parts)
      .find((item) => item.type === "tool-call" && item.call.id === approval.toolCallId);
    if (part?.type === "tool-call") part.approval = approval;
  }
  const result = {
    rows,
    calls: [...calls.values()],
    approvals: [...approvals.values()],
    questions: [...questions.values()],
    turn,
    failure,
    title,
  };
  folds.set(state, result);
  return result;
}

interface Fold {
  rows: ChatMessage[];
  calls: ToolCall[];
  approvals: Approval[];
  questions: Question[];
  /** A prompt's turn has not ended. */
  turn: boolean;
  failure?: string;
  /** The newest `title_changed`, else the body's title. */
  title: string;
}

/** The host's error for a turn its own restart cut off (apps/host src/harness/threads.ts). */
export const HOST_RESTARTED = "host restarted during this turn";

/** Every selector reads one fold per state object. */
const folds = new WeakMap<ChatState, Fold>();

/** The list the chat draws. While a turn has no assistant row yet, a running placeholder stands in. */
export function selectMessages(state: ChatState): ChatMessage[] {
  const rows = [...fold(state).rows];
  if (selectRunStatus(state) !== "idle" && rows.at(-1)?.role !== "assistant")
    rows.push({ id: "pea-pending", role: "assistant", parts: [], running: true });
  return rows.filter(
    (message) => message.running || message.parts.some((part) => part.type !== "reasoning"),
  );
}

export function selectTitle(state: ChatState): string {
  return fold(state).title;
}

export function selectToolCalls(state: ChatState): ToolCall[] {
  return fold(state).calls;
}

/** Live asks only: a resolved or expired request is a transcript record, never a head row. */
export function selectApprovals(state: ChatState): Approval[] {
  return fold(state).approvals;
}

/** Open form questions, same lifetime as approvals. */
export function selectQuestions(state: ChatState): Question[] {
  return fold(state).questions;
}

/** The last turn's error, until the next prompt. */
export function selectTurnFailure(state: ChatState): string | undefined {
  return fold(state).failure;
}

export type RunStatus = "idle" | "running" | "waiting";

export function selectRunStatus(state: ChatState): RunStatus {
  const { approvals, questions, turn } = fold(state);
  if (approvals.length > 0 || questions.length > 0) return "waiting";
  return turn ? "running" : "idle";
}

/** The host's turn marker: seconds the running turn has heard nothing, until the next event. */
export function selectWaitingSeconds(state: ChatState): number | undefined {
  const last = state.events.at(-1);
  return last?.kind === "waiting" && fold(state).turn ? Math.round(last.sinceMs / 1000) : undefined;
}

/** The host is spawning or resuming the harness child for the running turn and has heard nothing since. */
export function selectStarting(state: ChatState): boolean {
  return state.events.at(-1)?.kind === "starting" && fold(state).turn;
}

/** The newest `session/update` of one kind, or undefined. */
function latest(state: ChatState, kind: string): Record<string, unknown> | undefined {
  for (let i = state.events.length - 1; i >= 0; i -= 1) {
    const event = state.events[i]!;
    if (event.kind === "update" && event.update.sessionUpdate === kind)
      return event.update as Record<string, unknown>;
  }
  return undefined;
}

/** The harness's plan (`plan` update): the whole list each time, newest wins. */
export function selectPlan(
  state: ChatState,
): { id: string; content: string; status: "pending" | "in_progress" | "completed" }[] {
  const entries = latest(state, "plan")?.entries;
  return (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const record = readRecord(entry);
    const status = record?.status;
    return {
      id: String(index),
      content: readString(record?.content) ?? "",
      status: status === "completed" || status === "in_progress" ? status : "pending",
    };
  });
}

/** The harness's slash commands (`available_commands_update`). */
export function selectSkillCommands(state: ChatState): { name: string; description: string }[] {
  const commands = latest(state, "available_commands_update")?.availableCommands;
  return (Array.isArray(commands) ? commands : []).flatMap((command) => {
    const record = readRecord(command);
    const name = readString(record?.name);
    return name ? [{ name, description: readString(record?.description) ?? "command" }] : [];
  });
}

/** A prompt that opens with `/name` ran a skill: the command and the rest of the line. A path (`/usr/bin`) is not one. */
export function skillInvocation(prompt: string): { name: string; args: string } | undefined {
  const match = /^\/([A-Za-z][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  return match ? { name: match[1]!, args: (match[2] ?? "").trim() } : undefined;
}

/**
 * The one rule for "is this tool output entry an image", fitted to what the image tools really
 * return (`capture_view`, `read_image` in packages/mcps: `{ text, mediaType, byteSize, data }`,
 * and ACP image blocks `{ type: "image", mimeType, data }`):
 * - a record needs an `image/*` media type AND either base64 `data` (or a `data:image/` URL in it)
 *   or an `image`/`url` field holding a `data:image/` or http(s) URL;
 * - a bare string must be a `data:image/…;base64,` URL.
 * `field` names where the bytes sit, for the display projection below.
 */
function toolImage(part: unknown): { url: string; mime: string; field?: string } | undefined {
  if (typeof part === "string") {
    const mime = DATA_IMAGE.exec(part)?.[1];
    return mime && looksBase64(part.slice(part.indexOf(",") + 1)) ? { url: part, mime } : undefined;
  }
  const record = readRecord(part);
  const source = readRecord(record?.source);
  const mime =
    readString(record?.mediaType) ?? readString(record?.mimeType) ?? readString(source?.media_type);
  if (!record || !mime?.startsWith("image/")) return undefined;
  const data = readString(record.data) ?? readString(source?.data);
  if (data !== undefined) {
    if (DATA_IMAGE.test(data))
      return looksBase64(data.slice(data.indexOf(",") + 1))
        ? { url: data, mime, field: source ? "source" : "data" }
        : undefined;
    return looksBase64(data)
      ? { url: `data:${mime};base64,${data}`, mime, field: source ? "source" : "data" }
      : undefined;
  }
  for (const field of ["image", "url"]) {
    const url = readString(record[field]);
    if (url && (DATA_IMAGE.test(url) || /^https?:\/\//i.test(url))) return { url, mime, field };
  }
  return undefined;
}

const DATA_IMAGE = /^data:(image\/[\w.+-]+);base64,/;

// A durable-event truncation marker must never become a broken image URL.
const looksBase64 = (value: string) =>
  value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

const outputEntries = (output: unknown): unknown[] => (Array.isArray(output) ? output : [output]);

/** Which images a tool call produced. The transcript strip reads this. */
function toolImages(output: unknown): string[] {
  const entries = outputEntries(output);
  const published = entries.flatMap((part) => {
    const block = readRecord(part);
    const metadata = readRecord(
      typeof part === "string"
        ? toolValue(part)
        : block?.type === "text"
          ? toolValue(block.text)
          : part,
    );
    if (metadata?.kind !== "page" || metadata.ok !== true) return [];
    return toolImage(metadata.capture)?.url ?? [];
  });
  // The retained PNG survives bounded ACP data and reload; it is the Page's image identity.
  return [
    ...new Set(
      published.length ? published : entries.flatMap((part) => toolImage(part)?.url ?? []),
    ),
  ];
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

export interface ContextBreakdown {
  contextWindow?: number;
  totalTokens: number;
  segments: ContextSegment[];
}

/** The harness's own context count (`usage_update {used, size}`); nothing before the first one. */
export function selectBreakdown(state: ChatState): ContextBreakdown | undefined {
  const usage = latest(state, "usage_update");
  const used = usage?.used;
  const size = usage?.size;
  if (typeof used !== "number" || typeof size !== "number") return undefined;
  const segments: ContextSegment[] = [{ id: "messages", label: "Used", tokens: used }];
  if (size > used) segments.push({ id: "free", label: "Free space", tokens: size - used });
  return { contextWindow: size, totalTokens: used, segments };
}

/**
 * The most specific statement of what a call did: the harness's caption when it says more than
 * the target (a whole command line around the path, a question with no target), else the target.
 * A one-word caption ("Terminal", "grep", the tool's own id) is a label, never a statement.
 * `emitted`: the text is machine-written (it carries the call's own argument), so it reads in
 * mono; a caption with no argument in it is the harness talking (a question), so it reads as prose.
 */
export function toolDetail(call: ToolCall): { text: string; emitted: boolean } | undefined {
  const caption = call.caption && /\s/.test(call.caption.trim()) ? call.caption : undefined;
  if (caption && (!call.target || caption.includes(call.target)))
    return { text: caption, emitted: call.target !== undefined };
  return call.target ? { text: call.target, emitted: true } : undefined;
}

function toolTarget(args: unknown): string | undefined {
  const record = readRecord(args);
  // pe_read / pe_do: the capability key is what the user reads on the card.
  if (typeof record?.key === "string") return record.key;
  // The harness's `Skill` tool names the skill it runs.
  const candidate =
    record?.skill ??
    record?.path ??
    record?.file_path ??
    record?.file ??
    record?.query ??
    record?.command;
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

function at(event: HarnessEvent): { createdAt?: Date } {
  const date = new Date(event.at);
  return Number.isNaN(date.getTime()) ? {} : { createdAt: date };
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
