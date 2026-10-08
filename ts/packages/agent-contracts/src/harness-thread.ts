import { z } from "zod";

/**
 * The harness-thread wire (ADR 0015: the harness drives; Pea is tools and UI).
 *
 * One thread is one ACP session on one harness child (claude-agent-acp or codex-acp), spawned by
 * the host with the Pea MCP server bound to the thread head (`PE_THREAD`). The host keeps the
 * durable record: an append-only log of `HarnessEvent`s per thread. The web renders that log and
 * the live tail of it over SSE; it never talks to a harness directly.
 *
 * Trust: the host binds loopback and these routes carry no token. Every mutating route requires
 * `content-type: application/json`, so a cross-origin simple request cannot reach it.
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
 *   POST   /pe/threads/:id/prompt {text}       -> { turnId }   (202 queued when a turn is running)
 *   POST   /pe/threads/:id/cancel
 *   POST   /pe/threads/:id/permission {requestId, optionId}
 *   POST   /pe/threads/:id/question {requestId, action, content?}   (answers an ACP elicitation form)
 *   POST   /pe/threads/:id/fork {providerId?, title?} -> HarnessThreadSummary
 *            (copies the log; same provider forks the ACP session, another re-feeds the transcript)
 *   POST   /pe/threads/:id/model {modelId}
 *   POST   /pe/threads/:id/trait {id, value}    (ACP `session/set_config_option`)
 *   GET    /pe/threads/:id/stream  (SSE; each `data:` is one HarnessEvent, from `?after=<seq>`)
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

/** The first step that stands between the provider and a turn; `unknown` when the probe could not tell. */
export const readinessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready") }),
  z.object({
    state: z.literal("refused"),
    step: z.enum(["installed", "signed-in", "endpoint"]),
    message: z.string(),
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

/** Guarded starts a session in the harness's own auto mode; unguarded in its full-access mode. */
export const accessSchema = z.object({ guarded: z.boolean() });
export type Access = z.infer<typeof accessSchema>;

/** One ACP `session/update` notification body, kept verbatim. The web switches on `sessionUpdate`. */
export const acpSessionUpdateSchema = z.object({ sessionUpdate: z.string() }).passthrough();

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

/** Append-only per-thread record. `seq` is 1-based and dense per thread. */
export const harnessEventSchema = z.discriminatedUnion("kind", [
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("prompt"),
    turnId: z.string(),
    text: z.string(),
  }),
  /** `turnId` is null for updates the harness sends outside a turn (commands, mode, session info). */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("update"),
    turnId: z.string().nullable(),
    update: acpSessionUpdateSchema,
  }),
  /** A prompt accepted while a turn runs; it becomes a `prompt` event when it starts. */
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("queued"),
    turnId: z.string(),
    text: z.string(),
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
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("turn_end"),
    turnId: z.string(),
    stopReason: z.string(),
  }),
  z.object({
    seq: z.number(),
    at: z.string(),
    kind: z.literal("error"),
    turnId: z.string().nullable(),
    message: z.string(),
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

export const harnessThreadSummarySchema = z.object({
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
});
export type HarnessThreadSummary = z.infer<typeof harnessThreadSummarySchema>;

export const harnessThreadBodySchema = harnessThreadSummarySchema.extend({
  models: z.array(harnessModelSchema),
  traits: z.array(traitOptionSchema),
  /** Derivable from `events` (a `prompt` with no `turn_end`/`error`; a `queued` with no `prompt`);
   * carried so a one-shot reader need not fold the log. Open asks are the unresolved
   * `permission_request` events. */
  running: z.boolean(),
  queued: z.array(z.object({ turnId: z.string(), text: z.string() })),
  session: z.enum(["started", "resumed", "forked", "detached", "closed"]),
  events: z.array(harnessEventSchema),
});
export type HarnessThreadBody = z.infer<typeof harnessThreadBodySchema>;

export const promptRequestSchema = z.object({ text: z.string().min(1) });
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
