import { z } from "zod";

/**
 * Zod schemas for the agent-controller wire, validated at the SSE / REST boundary.
 *
 * `@mastra/client-js` owns the transport (subscribe/fetch) and types the *snapshot* shapes well
 * (thread, model, mode, session state — imported directly in `adapter.ts`). But its event union is
 * deliberately browser-lossy: it types `om_status` as `{ status: string }`, `om_observation_end` as
 * `{}`, etc., and collapses everything else into `OtherAgentControllerEvent`. The Pe reducer needs
 * the richer payloads (OM windows/tokens, signal message parts). Since `subscribe` hands us the raw
 * `JSON.parse`'d object untouched, we validate it here and recover those fields with precise types.
 *
 * These schemas mirror the exact shapes the reducer consumes. Unknown event types fail `safeParse`
 * and are dropped at the boundary — the same no-op the reducer's `default` branch produced before.
 */

// --- Message content + messages ---------------------------------------------------------------

const textContent = z.object({ type: z.literal("text"), text: z.string() });
const thinkingContent = z.object({ type: z.literal("thinking"), thinking: z.string() });
const toolCallContent = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});
const toolResultContent = z.object({
  type: z.literal("tool_result"),
  id: z.string(),
  name: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional().default(false),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
});
// Image/file content. Provider shapes vary (AI SDK `image`, mastra `file`), so accept the source
// under any of image/data/url and the mime under mimeType/mediaType — loose, normalized downstream.
const imageContent = z
  .object({
    type: z.enum(["image", "file"]),
    image: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    mediaType: z.string().optional(),
    filename: z.string().optional(),
  })
  .loose();
const signalContent = z.object({
  type: z.enum([
    "system_reminder",
    "state_signal",
    "reactive_signal",
    "notification_summary",
    "notification",
  ]),
  stateId: z.string().optional(),
  message: z.string(),
});

/** Only the content kinds the reducer projects. No bare `{ type: string }` member — that would
 * poison discriminated narrowing in the reducer's switch. Unknown parts are dropped by
 * `wireContentArray` below instead. */
const wireMessageContentSchema = z.union([
  textContent,
  thinkingContent,
  toolCallContent,
  toolResultContent,
  imageContent,
  signalContent,
]);

/** Parse a content array, silently dropping parts the reducer doesn't model (keeps a message with
 * an image/file part from failing to load). */
const wireContentArray = z.array(z.unknown()).transform((parts) =>
  parts.flatMap((part) => {
    const result = wireMessageContentSchema.safeParse(part);
    return result.success ? [result.data] : [];
  }),
);

export const wireMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: wireContentArray,
  createdAt: z.union([z.string(), z.date()]).optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type WireMessageContent = z.infer<typeof wireMessageContentSchema>;
export type WireMessage = z.infer<typeof wireMessageSchema>;

// --- Events the reducer / provider consume ----------------------------------------------------

const omStatusWindows = z.object({
  active: z.object({
    messages: z.object({ tokens: z.number(), threshold: z.number() }),
    observations: z.object({ tokens: z.number(), threshold: z.number() }),
  }),
  buffered: z.object({
    observations: z.object({ status: z.string(), observationTokens: z.number() }),
    reflection: z.object({ status: z.string(), observationTokens: z.number() }),
  }),
});

const wireTaskItem = z.object({
  id: z.string(),
  content: z.string(),
  status: z.string().optional(),
});
export type WireTaskItem = z.infer<typeof wireTaskItem>;

export const wireEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_start") }),
  z.object({
    type: z.literal("agent_end"),
    reason: z.enum(["complete", "aborted", "error", "suspended"]).optional(),
  }),
  z.object({ type: z.literal("message_start"), message: wireMessageSchema }),
  z.object({ type: z.literal("message_update"), message: wireMessageSchema }),
  z.object({ type: z.literal("message_end"), message: wireMessageSchema }),
  z.object({
    type: z.literal("tool_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({ type: z.literal("tool_input_start"), toolCallId: z.string(), toolName: z.string() }),
  z.object({
    type: z.literal("tool_input_delta"),
    toolCallId: z.string(),
    argsTextDelta: z.string(),
    toolName: z.string().optional(),
  }),
  z.object({ type: z.literal("tool_input_end"), toolCallId: z.string() }),
  z.object({ type: z.literal("tool_update"), toolCallId: z.string(), partialResult: z.unknown() }),
  z.object({
    type: z.literal("shell_output"),
    toolCallId: z.string(),
    output: z.string(),
    stream: z.enum(["stdout", "stderr"]).optional(),
  }),
  z.object({
    type: z.literal("tool_end"),
    toolCallId: z.string(),
    result: z.unknown(),
    isError: z.boolean().optional().default(false),
    providerMetadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("tool_approval_required"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_suspended"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
    suspendPayload: z.unknown(),
    resumeSchema: z.string().optional(),
  }),
  z.object({ type: z.literal("task_updated"), tasks: z.array(wireTaskItem) }),
  z.object({ type: z.literal("om_status"), windows: omStatusWindows }),
  z.object({
    type: z.literal("om_observation_end"),
    cycleId: z.string(),
    durationMs: z.number(),
    tokensObserved: z.number(),
    observationTokens: z.number(),
  }),
  z.object({
    type: z.literal("om_reflection_end"),
    cycleId: z.string(),
    durationMs: z.number(),
    compressedTokens: z.number(),
  }),
  z.object({
    type: z.literal("state_changed"),
    state: z.record(z.string(), z.unknown()),
    changedKeys: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("mode_changed"),
    modeId: z.string(),
    previousModeId: z.string().optional(),
  }),
  z.object({
    type: z.literal("model_changed"),
    modelId: z.string(),
    scope: z.string().optional(),
    modeId: z.string().optional(),
  }),
  z.object({
    type: z.literal("thread_changed"),
    threadId: z.string(),
    previousThreadId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("thread_created"),
    thread: z.object({ id: z.string(), title: z.string().optional() }),
  }),
  z.object({ type: z.literal("thread_deleted"), threadId: z.string() }),
  z.object({ type: z.literal("error"), error: z.unknown(), errorType: z.string().optional() }),
]);

export type WireEvent = z.infer<typeof wireEventSchema>;

/** Parse a raw SSE event; returns `undefined` for unmodeled event types (dropped at the boundary). */
export function parseWireEvent(raw: unknown): WireEvent | undefined {
  const result = wireEventSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

/** Parse a thread's messages snapshot; invalid messages are dropped rather than failing the load. */
export function parseWireMessages(raw: unknown): WireMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const result = wireMessageSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}
