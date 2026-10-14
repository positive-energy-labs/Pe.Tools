import { z } from "zod";
import { callerSchema } from "./caller.ts";
import { mentionSchema } from "./mention.ts";
import { threadHeadReadingSchema } from "./target.ts";

/**
 * The harness-thread wire (ADR 0015: the harness drives; Pea is tools and UI).
 *
 * One thread is one ACP session on one harness child (claude-agent-acp or codex-acp), spawned by
 * the host with the Pea MCP server bound to its thread by a `PE_CONTEXT` token. The host keeps the
 * durable record: an append-only log of `HarnessEvent`s per thread. The web renders that log and
 * the live tail of it over SSE; it never talks to a harness directly.
 *
 * Trust: admission requires a host-minted caller for writes and a human for consent.
 * Browser human sessions use HttpOnly cookies; terminal and harness children carry scoped bearers.
 *
 * A provider is one harness with one auth source: the harness's own login (`subscription`, one per
 * harness, id = harness id) or a user-added `endpoint` (URL plus key, id `<harness>-<slug>`). The key
 * stays in the host's providers file; the wire carries its last four characters.
 *
 * Routes (host, same origin as `/pe/*`):
 *   GET    /pe/providers                       -> Provider[]   (last probe; `unknown` until the first)
 *   POST   /pe/providers      {harness, name, auth:{kind:"endpoint", baseUrl, apiKey}} -> Provider
 *            (probed before save; a refusal is 400 `{step, message}`)
 *   DELETE /pe/providers/:id                   (a subscription provider refuses, 409)
 *   POST   /pe/providers/:id/probe             -> Provider
 *   POST   /pe/providers/:id/open-login        -> {opened: true}   (a console on this machine runs the
 *            harness's login, or its installer when the step is `installed`; re-probes when it closes)
 *   GET    /pe/access                          -> Access
 *   PUT    /pe/access         {guarded}        -> Access   (the ACP mode a new session starts in)
 *   GET    /pe/threads                         -> HarnessThreadSummary[]
 *   POST   /pe/threads        {providerId, title?} -> HarnessThreadSummary
 *   GET    /pe/threads/:id                     -> HarnessThreadBody
 *   PUT    /pe/threads/:id    {title}          -> HarnessThreadSummary
 *   DELETE /pe/threads/:id
 *   POST   /pe/threads/:id/prompt {id, text, attachments?, mentions?, delivery?} -> TurnState
 *            (`id` is client-minted and becomes the turn's id: a retry with the same id and content
 *            answers the turn's state and never sends twice; other content under it is 409.
 *            `steer`, the default, interrupts a running turn: it ends cancelled, then this one starts;
 *            409 when it does not stop. `queue` waits for the running turn and any steer to end, then
 *            delivers in order. 400 on an unreadable attachment kind; a mention is never refused)
 *   POST   /pe/threads/:id/queue {turnId, action: steer|cancel} -> TurnState   (a queued prompt only)
 *   GET    /pe/threads/:id/wait?turn=<id>&timeoutMs=<n> -> TurnState   (answers once the turn
 *            settles, or as it stands after `timeoutMs`, at most {@link TURN_WAIT_MAX_MS})
 *   POST   /pe/threads/:id/cancel
 *   POST   /pe/threads/:id/permission {requestId, optionId}
 *   POST   /pe/threads/:id/question {requestId, action, content?}   (answers an ACP elicitation form)
 *   POST   /pe/threads/:id/fork {providerId?, title?} -> HarnessThreadSummary
 *            (copies the log; same provider forks the ACP session, another re-feeds the transcript)
 *   POST   /pe/threads/:id/model {modelId}
 *   POST   /pe/threads/:id/trait {id, value}    (ACP `session/set_config_option`)
 *   A thread's events are followed as the `thread` Reading (`reading.ts`) over the host log,
 *   from the summary's `cursor`; the list is the `threads` Reading.
 */

export const harnessIds = ["claude", "codex"] as const;
export const harnessIdSchema = z.enum(harnessIds);
export type HarnessId = z.infer<typeof harnessIdSchema>;

export const harnessModelSchema = z.object({ modelId: z.string(), name: z.string() });
export type HarnessModel = z.infer<typeof harnessModelSchema>;

/** A provider's auth source as the wire sees it: never the key itself. */
export const authSourceViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription") }),
  z.object({ kind: z.literal("endpoint"), baseUrl: z.string(), keyLast4: z.string() }),
]);
export type AuthSourceView = z.infer<typeof authSourceViewSchema>;

export const endpointFailureSchema = z.object({
  kind: z.enum(["billing", "auth", "unreachable", "model", "other"]),
  message: z.string(),
  raw: z.string(),
});
export type EndpointFailure = z.infer<typeof endpointFailureSchema>;

const readinessStepSchema = z.enum(["installed", "signed-in", "endpoint"]);
/** One sanitized refusal record, shared by the host log and the provider's copyable details. */
const providerRefusalSchema = z.object({
  step: readinessStepSchema,
  message: z.string(),
  failure: endpointFailureSchema.optional(),
  candidates: z.array(
    z.object({ path: z.string(), reason: z.string(), win32Error: z.number().nullable() }),
  ),
  resolvedExecutable: z
    .object({ path: z.string(), realPath: z.string(), size: z.number(), modifiedAt: z.string() })
    .nullable(),
  lookup: z
    .object({ command: z.string(), status: z.number().nullable(), reason: z.string() })
    .nullable(),
  console: z
    .object({
      exitCode: z.number().nullable(),
      commandExitCode: z.number().nullable(),
      logPath: z.string(),
      outputTail: z.string().max(8192),
    })
    .nullable(),
});
export type ProviderRefusal = z.infer<typeof providerRefusalSchema>;

/** The first step that stands between the provider and a turn; `unknown` when the probe could not tell. */
export const readinessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready") }),
  z.object({
    state: z.literal("refused"),
    step: readinessStepSchema,
    message: z.string(),
    failure: endpointFailureSchema.optional(),
    detail: providerRefusalSchema.optional(),
  }),
  z.object({ state: z.literal("unknown"), message: z.string() }),
]);
export type Readiness = z.infer<typeof readinessSchema>;

/** An ACP session config option beyond model, mode and collaboration mode (effort, fast mode). */
export const traitOptionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal("select"),
    options: z.array(z.object({ id: z.string(), name: z.string() })),
    current: z.string().nullable(),
  }),
  z.object({ id: z.string(), name: z.string(), kind: z.literal("boolean"), current: z.boolean() }),
]);
export type TraitOption = z.infer<typeof traitOptionSchema>;

export const providerSchema = z.object({
  id: z.string(),
  harness: harnessIdSchema,
  name: z.string(),
  auth: authSourceViewSchema,
  readiness: readinessSchema,
  /** Subscription choices come from ACP; endpoint choices are advertised text models, with a tested default first. Other listed models are validated when selected. */
  models: z.array(harnessModelSchema),
  traits: z.array(traitOptionSchema),
  /** When the cached readiness, models and traits were read; null before the first probe. */
  probedAt: z.string().nullable(),
});
export type Provider = z.infer<typeof providerSchema>;

export const addProviderRequestSchema = z.object({
  harness: harnessIdSchema,
  name: z.string().trim().min(1),
  auth: z.object({
    kind: z.literal("endpoint"),
    baseUrl: z.string(),
    apiKey: z.string(),
    modelId: z.string().trim().min(1).optional(),
  }),
});
export type AddProviderRequest = z.infer<typeof addProviderRequestSchema>;

/** Harness approval policy only. Guarded starts auto mode; unguarded starts full access. Neither grants Revit rw. */
export const accessSchema = z.object({ guarded: z.boolean(), readError: z.string().optional() });
export type Access = z.infer<typeof accessSchema>;

/**
 * One ACP `session/update` notification body, kept verbatim. The web switches on `sessionUpdate`.
 * An update or permission ask over {@link HARNESS_EVENT_MAX_BYTES} is kept bounded: its long
 * strings cut, or only its identity when that is not enough, with `truncated` naming the bytes the
 * harness sent. The harness itself read the whole value; only the record is bounded.
 */
export const HARNESS_EVENT_MAX_BYTES = 64 * 1024;
export const acpSessionUpdateSchema = z.object({ sessionUpdate: z.string() }).passthrough();

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

/** One file the user attached to a prompt, as the composer read it: `text` for a text file, base64
 * `data` for any other. The host makes each an ACP content block (`attachmentKind` says which). */
export const promptAttachmentSchema = z
  .object({
    name: z.string().min(1),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
    data: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((a) => (a.data === undefined) !== (a.text === undefined), "carries data or text");
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;

/** ACP `agentCapabilities.promptCapabilities` as the host read it at the session's `initialize`. */
export const promptCapabilitiesSchema = z.object({
  image: z.boolean(),
  embeddedContext: z.boolean(),
});
export type PromptCapabilities = z.infer<typeof promptCapabilitiesSchema>;

/** The image types both harnesses' models read; any other image crosses as a file. */
const MODEL_IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** `image` an ACP image block, `text` an embedded text resource, `file` a link to the saved bytes. */
export const attachmentKind = (a: PromptAttachment): "image" | "text" | "file" =>
  a.text !== undefined ? "text" : MODEL_IMAGES.includes(a.mimeType) ? "image" : "file";

/** The one attachment rule, host and composer alike: which kinds this harness refuses, in a
 * sentence; null when every one crosses or the capabilities are not known yet. A file link needs
 * no capability (ACP baseline). */
export function attachmentRefusal(
  attachments: readonly PromptAttachment[],
  caps: PromptCapabilities | null,
  harness: string,
): string | null {
  if (!caps) return null;
  const refused = attachments.filter(
    (a) =>
      (attachmentKind(a) === "image" && !caps.image) ||
      (attachmentKind(a) === "text" && !caps.embeddedContext),
  );
  if (!refused.length) return null;
  const kinds = new Set(
    refused.map((a) => (attachmentKind(a) === "image" ? "images" : "text files")),
  );
  return `${harness} cannot read attached ${[...kinds].join(" or ")}: remove ${refused.map((a) => a.name).join(", ")} to send`;
}

/** Append-only per-thread record. `seq` is 1-based and dense per thread. */
export const harnessEventSchema = z.discriminatedUnion("kind", [
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("prompt"),
    turnId: z.string(),
    text: z.string(),
    attachments: z.array(promptAttachmentSchema).optional(),
    mentions: z.array(mentionSchema).optional(),
  }),
  /** `turnId` is null for updates the harness sends outside a turn (commands, mode, session info). */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("update"),
    turnId: z.string().nullable(),
    update: acpSessionUpdateSchema,
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("permission_request"),
    turnId: z.string().nullable(),
    requestId: z.string(),
    toolCall: z.object({ toolCallId: z.string(), title: z.string().optional() }).passthrough(),
    options: z.array(permissionOptionSchema),
  }),
  /** One member per `by`: a user answer carries `optionId`; `cancel` (the turn was cancelled with
   * the ask open) and `expired` (the host restarted with it open) carry none. Nested so the outer
   * union keeps one `permission_resolved` discriminator. */
  z.discriminatedUnion("by", [
    z.object({
      seq: z.number(),
      at: z.string(),
      kind: z.literal("permission_resolved"),
      turnId: z.string().nullable(),
      requestId: z.string(),
      by: z.literal("user"),
      optionId: z.string(),
    }),
    z.object({
      seq: z.number(),
      at: z.string(),
      kind: z.literal("permission_resolved"),
      turnId: z.string().nullable(),
      requestId: z.string(),
      by: z.enum(["cancel", "expired"]),
    }),
  ]),
  /** An ACP `elicitation/create` in `form` mode: the harness asks the user (Claude's AskUserQuestion,
   * an MCP elicitation). `requestedSchema` is the ACP form schema verbatim; the web renders it. A
   * non-form mode is declined by the host and never logged. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("question_request"),
    turnId: z.string().nullable(),
    requestId: z.string(),
    message: z.string(),
    requestedSchema: z.record(z.string(), z.unknown()),
  }),
  z.discriminatedUnion("by", [
    z.object({
      seq: z.number(),
      at: z.string(),
      kind: z.literal("question_resolved"),
      turnId: z.string().nullable(),
      requestId: z.string(),
      by: z.literal("user"),
      action: z.enum(["accept", "decline"]),
      content: z.record(z.string(), z.unknown()).optional(),
    }),
    z.object({
      seq: z.number(),
      at: z.string(),
      kind: z.literal("question_resolved"),
      turnId: z.string().nullable(),
      requestId: z.string(),
      by: z.enum(["cancel", "expired"]),
    }),
  ]),
  /** A `queue` prompt admitted while a turn runs. Its `prompt` follows, same `turnId`, on delivery. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("prompt_queued"),
    turnId: z.string(),
    text: z.string(),
    attachments: z.array(promptAttachmentSchema).optional(),
    mentions: z.array(mentionSchema).optional(),
  }),
  /** A queued prompt that will never be delivered: the user dropped it, or the host restarted. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("prompt_dropped"),
    turnId: z.string(),
    by: z.enum(["user", "expired"]),
  }),
  /** The host spawned or resumed the harness child for this turn's prompt: nothing else is logged
   * until it answers (seconds when a reaped child is respawned). Absent when a live child took it. */
  z.object({ seq: z.number(), at: z.string(), kind: z.literal("starting"), turnId: z.string() }),
  /** Who asked the running turn to stop, and through which door (the cancel route, or the prompt
   * that interrupts it). Written before the harness is told, so it precedes the `turn_end`. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("cancel_requested"),
    turnId: z.string(),
    by: callerSchema,
    door: z.string(),
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("turn_end"),
    turnId: z.string(),
    stopReason: z.string(),
    /** The harness's `PromptResponse.usage`, verbatim; absent when it sent none, and an unsent
     * optional count stays absent, never zero. The context window is the separate `usage_update`. */
    usage: z
      .object({
        totalTokens: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        thoughtTokens: z.number().optional(),
        cachedReadTokens: z.number().optional(),
        cachedWriteTokens: z.number().optional(),
      })
      .optional(),
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("error"),
    turnId: z.string().nullable(),
    message: z.string(),
    failure: endpointFailureSchema.optional(),
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("model_changed"),
    modelId: z.string(),
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("trait_changed"),
    traitId: z.string(),
    value: z.union([z.string(), z.boolean()]),
  }),
  /** The host's own clock: a turn running with no session update for `sinceMs`, once per 60 s. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("waiting"),
    turnId: z.string(),
    sinceMs: z.number(),
  }),
  /** From ACP `session_info_update.title`, or a user rename. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("title_changed"),
    title: z.string(),
  }),
  /** The harness child was started: `started` a new session, `resumed` ACP `session/resume` of the
   * stored one, `forked` ACP `session/fork` of the source thread's, `detached` a new session over an
   * existing log (resume or fork failed, or the fork crossed harnesses), with the transcript re-fed. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("session"),
    state: z.enum(["started", "resumed", "forked", "detached"]),
    acpSessionId: z.string().nullable(),
  }),
]);
export type HarnessEvent = z.infer<typeof harnessEventSchema>;

/** Product thread lifecycle. ACP child lifetime is private execution state. */
export const threadLifecycleSchema = z.object({
  revision: z.number().int().nonnegative(),
  autoSettle: z.enum(["manual", "1d", "7d"]),
  settledAt: z.iso.datetime().nullable(),
  reopenedAt: z.iso.datetime().nullable(),
  order: z.number().finite().nullable(),
  pinned: z.boolean(),
  status: z.enum(["active", "settled", "archived"]),
  snoozedUntil: z.iso.datetime().nullable(),
  snoozedSeq: z.number().int().nonnegative(),
  readSeq: z.number().int().nonnegative(),
  explicitUnread: z.boolean(),
});
export type ThreadLifecycle = z.infer<typeof threadLifecycleSchema>;
export const emptyThreadLifecycle = (): ThreadLifecycle => ({
  revision: 0,
  autoSettle: "manual",
  settledAt: null,
  reopenedAt: null,
  order: null,
  pinned: false,
  status: "active",
  snoozedUntil: null,
  snoozedSeq: 0,
  readSeq: 0,
  explicitUnread: false,
});
export const updateThreadRequestSchema = z
  .strictObject({
    expectedRevision: z.number().int().nonnegative().optional(),
    autoSettle: z.enum(["manual", "1d", "7d"]).optional(),
    order: z.number().finite().nullable().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    pinned: z.boolean().optional(),
    status: z.enum(["active", "settled", "archived"]).optional(),
    snoozedUntil: z.iso.datetime().nullable().optional(),
    readSeq: z.number().int().nonnegative().optional(),
    explicitUnread: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Choose a thread change");
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

export const harnessThreadSummarySchema = z.object({
  origin: z
    .strictObject({ kind: z.literal("scheduled"), taskId: z.string().min(1), runId: z.uuid() })
    .optional(),
  id: z.string(),
  harness: harnessIdSchema,
  providerId: z.string(),
  providerName: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  modelId: z.string().nullable(),
  /** Last event seq; a client continues its stream from here without reading the whole log. */
  lastSeq: z.number(),
  /** The host log id this record was read at: follow the `thread` Reading from it. */
  cursor: z.number().int().nonnegative(),
  head: threadHeadReadingSchema,
  lifecycle: threadLifecycleSchema,
  activity: z.object({
    state: z.enum(["idle", "running", "waiting", "failed"]),
    pending: z.number().int().nonnegative(),
    lastSeq: z.number().int().nonnegative(),
    message: z.string().nullable(),
  }),
});
export type HarnessThreadSummary = z.infer<typeof harnessThreadSummarySchema>;

export const harnessThreadBodySchema = harnessThreadSummarySchema.extend({
  models: z.array(harnessModelSchema),
  traits: z.array(traitOptionSchema),
  /** Derivable from `events` (a `prompt` with no `turn_end`/`error`); carried so a one-shot reader
   * need not fold the log. Open asks are the unresolved `permission_request` events. */
  running: z.boolean(),
  session: z.enum(["started", "resumed", "forked", "detached", "closed"]),
  /** From the last session's `initialize`; null until a harness child has started once. */
  promptCapabilities: promptCapabilitiesSchema.nullable(),
  events: z.array(harnessEventSchema),
});
export type HarnessThreadBody = z.infer<typeof harnessThreadBodySchema>;

/** A refused attachment kind is 400 `{error}` with `attachmentRefusal`'s sentence. Each mention
 * reaches the harness as one embedded `pe://<key>` resource after the text, or a text line when the
 * harness reads no embedded context. */
export const promptRequestSchema = z
  .object({
    id: z.uuid(),
    delivery: z.enum(["steer", "queue"]).default("steer"),
    text: z.string(),
    attachments: z.array(promptAttachmentSchema).optional(),
    mentions: z.array(mentionSchema).optional(),
  })
  .refine(
    (p) => p.text.trim() || p.attachments?.length || p.mentions?.length,
    "Enter a prompt, attachment or mention",
  );
/** Where one turn stands: `queued` and `running` are live; the rest are settled. */
export const turnStateSchema = z.object({
  turnId: z.string(),
  state: z.enum(["queued", "running", "ended", "failed", "dropped"]),
  stopReason: z.string().optional(),
  message: z.string().optional(),
});
export type TurnState = z.infer<typeof turnStateSchema>;
export const TURN_WAIT_MAX_MS = 5 * 60_000;
export const queueRequestSchema = z.object({
  turnId: z.string(),
  action: z.enum(["steer", "cancel"]),
});
export const permissionResponseSchema = z.object({ requestId: z.string(), optionId: z.string() });
/** `accept` carries the form's answers keyed by property; `decline` is "skip", the harness goes on. */
export const questionResponseSchema = z.object({
  requestId: z.string(),
  action: z.enum(["accept", "decline"]),
  content: z.record(z.string(), z.unknown()).optional(),
});
export const forkThreadRequestSchema = z.object({
  providerId: z.string().optional(),
  title: z.string().optional(),
});
export const createThreadRequestSchema = z.object({
  providerId: z.string(),
  title: z.string().optional(),
});
export const traitRequestSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.boolean()]),
});
