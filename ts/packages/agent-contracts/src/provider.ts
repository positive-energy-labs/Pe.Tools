import { z } from "zod";

// Provider discovery is independent of caller, target and transcript contracts.
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
