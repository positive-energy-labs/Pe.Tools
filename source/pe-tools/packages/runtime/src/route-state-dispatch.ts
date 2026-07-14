/**
 * Route-state dispatcher — the server-side core the /pe/route-state endpoints drive.
 *
 * A route registers a {@link RouteStateSpec} + command handlers once (at pea-runtime
 * composition). The endpoints then:
 *   - list registered routes and their commands,
 *   - describe one route (its live document, JSON Schema, agent write mask, commands),
 *   - apply segment-array patches (mask-checked for the agent actor, schema-validated),
 *   - run a named command (human-only commands reject the agent actor).
 *
 * State lives on the AgentController session (per-session map). Writes go through the
 * session's serialized read-modify-write transaction so the browser and pea can't
 * clobber each other. The registry is session-agnostic; the session handle is passed
 * in per request (single-session host today, but nothing here assumes it).
 */
import { z } from "zod";
import { BIND_COMMAND } from "@pe/agent-contracts";
import type {
  RouteStateCommandContext,
  RouteStateCommandHandler,
  RouteStateCommandHandlers,
  RouteStateSpec,
} from "@pe/agent-contracts";

/** The session-state read/write handle the endpoints bind (AgentController `session.state`). */
export interface RouteStateSession {
  getState(): Record<string, unknown>;
  update<TResult>(
    updater: (state: Record<string, unknown>) => {
      updates?: Record<string, unknown>;
      result: TResult;
    },
  ): Promise<TResult>;
}

export type RouteStatePatch = { path: (string | number)[]; value?: unknown };

export type RouteStateActor = "agent" | "human";

export interface RouteStateApplyResult {
  ok: boolean;
  doc?: unknown;
  error?: string;
  hint?: string;
}

export interface RouteStateCommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  hint?: string;
}

interface RegisteredRoute {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: erased per-route doc type; the dispatcher
  // always passes the schema-parsed doc, which is exactly what the handlers declared.
  handlers: RouteStateCommandHandlers<any>;
}

const registry = new Map<string, RegisteredRoute>();

export function registerRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  handlers: RouteStateCommandHandlers<z.infer<TSchema>>,
): void {
  registry.set(spec.route, { spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers });
}

/** GET /pe/route-state — one entry per registered route (with its commands). */
export function listRouteStates(session: RouteStateSession) {
  const state = session.getState();
  return [...registry.values()].map(({ spec }) => ({
    route: spec.route,
    key: spec.key,
    live: state[spec.key] != null,
    commands: describeCommands(spec),
  }));
}

/** GET /pe/route-state/:route — the live document + how to write it. Null when unknown. */
export function describeRouteState(session: RouteStateSession, route: string) {
  const registered = registry.get(route);
  if (!registered) return null;
  const { spec } = registered;
  return {
    doc: currentDoc(session, spec),
    schema: toJsonSchema(spec.schema),
    agentWriteMask: spec.agentWriteMask,
    commands: describeCommands(spec),
  };
}

/** POST /pe/route-state/:route/apply — mask-check (agent), patch, validate, write atomically. */
export async function applyRouteStatePatches(
  session: RouteStateSession,
  route: string,
  actor: RouteStateActor,
  patches: RouteStatePatch[],
): Promise<RouteStateApplyResult> {
  const registered = registry.get(route);
  if (!registered) return unknownRoute(route);
  const { spec } = registered;

  // All-or-nothing mask gate for the agent: one denied path rejects the whole batch,
  // before any write, naming the offending path and what the mask does allow.
  if (actor === "agent") {
    for (const patch of patches) {
      if (!isMaskAllowed(spec.agentWriteMask, patch.path)) {
        return {
          ok: false,
          error: `patch path ${formatPath(patch.path)} is not agent-writable`,
          hint: `the agent write mask allows only ${spec.agentWriteMask
            .map(formatPath)
            .join(
              ", ",
            )} (and their subtrees); everything else is human-only — propose within the mask or ask the engineer to make this edit.`,
        };
      }
    }
  }

  return session.update(
    (state): { updates?: Record<string, unknown>; result: RouteStateApplyResult } => {
      const raw = state[spec.key];
      const draft: Record<string, unknown> =
        raw == null
          ? (spec.schema.parse({}) as Record<string, unknown>)
          : (structuredClone(raw) as Record<string, unknown>);
      try {
        for (const patch of patches) applyPatch(draft, patch);
      } catch (error) {
        return {
          result: {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            hint: "patch paths must address plain document keys.",
          },
        };
      }

      const parsed = spec.schema.safeParse(draft);
      if (!parsed.success) {
        return {
          result: {
            ok: false,
            error: "the patched document is invalid",
            hint: formatZodError(parsed.error),
          },
        };
      }
      return {
        updates: { [spec.key]: parsed.data },
        result: { ok: true, doc: summarizeDoc(parsed.data) },
      };
    },
  );
}

/** POST /pe/route-state/:route/command — validate input, gate human-only, run the handler. */
export async function runRouteStateCommand(
  session: RouteStateSession,
  route: string,
  actor: RouteStateActor,
  command: string,
  input: unknown,
): Promise<RouteStateCommandResult> {
  const registered = registry.get(route);
  if (!registered) return unknownRoute(route);
  const { spec, handlers } = registered;

  const commandSpec = spec.commands[command];
  if (!commandSpec) {
    return {
      ok: false,
      error: `unknown command '${command}'`,
      hint: `available commands: ${Object.keys(spec.commands).join(", ") || "(none)"}.`,
    };
  }
  if (commandSpec.actor === "human" && actor !== "human") {
    return {
      ok: false,
      error: `command '${command}' is human-only`,
      hint: "you propose and mark; a human runs this from the browser UI.",
    };
  }
  const parsedInput = commandSpec.input.safeParse(input ?? {});
  if (!parsedInput.success) {
    return {
      ok: false,
      error: `invalid input for command '${command}'`,
      hint: formatZodError(parsedInput.error),
    };
  }
  const handler = handlers[command] ?? (command === BIND_COMMAND ? bindHandler : undefined);
  if (!handler) {
    return {
      ok: false,
      error: `command '${command}' has no registered handler`,
      hint: "this is a wiring bug in the route registration — report it.",
    };
  }

  try {
    const result = await handler(parsedInput.data, makeCommandContext(session, spec));
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: "the command handler threw; check host/Revit connectivity (pe_status) then retry.",
    };
  }
}

/* ── internals ─────────────────────────────────────────────────────────────── */

/** The substrate-owned `bind` command — routes never supply a handler for it. */
const bindHandler: RouteStateCommandHandler = async (input, ctx) => {
  const { target } = input as { target: string | null };
  const doc = ctx.getDoc() as Record<string, unknown>;
  doc.binding = { target, boundAt: target == null ? null : new Date().toISOString() };
  await ctx.setDoc(doc);
  return { target };
};

function makeCommandContext(
  session: RouteStateSession,
  spec: RouteStateSpec<z.ZodType>,
): RouteStateCommandContext {
  return {
    getDoc: () => currentDoc(session, spec),
    setDoc: async (next) => {
      const parsed = spec.schema.parse(next); // handlers build valid documents; throw otherwise
      await session.update(() => ({ updates: { [spec.key]: parsed }, result: undefined }));
    },
  };
}

function currentDoc(session: RouteStateSession, spec: RouteStateSpec<z.ZodType>): unknown {
  const raw = session.getState()[spec.key];
  if (raw == null) return spec.schema.parse({});
  const parsed = spec.schema.safeParse(raw);
  return parsed.success ? parsed.data : spec.schema.parse({});
}

function describeCommands(spec: RouteStateSpec<z.ZodType>) {
  return Object.entries(spec.commands).map(([name, command]) => ({
    name,
    description: command.description,
    actor: command.actor,
    input: toJsonSchema(command.input),
  }));
}

/** `"*"` matches one segment; a pattern authorizes its subtree (patch may be deeper). */
function isMaskAllowed(mask: string[][], path: (string | number)[]): boolean {
  return mask.some(
    (pattern) =>
      path.length >= pattern.length &&
      pattern.every((segment, i) => segment === "*" || segment === String(path[i])),
  );
}

/** Segments that would walk the prototype chain instead of the document. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** Apply one segment-array patch in place; a patch with no `value` key deletes. */
function applyPatch(root: Record<string, unknown>, patch: RouteStatePatch): void {
  if (patch.path.length === 0) return;
  if (patch.path.some((segment) => FORBIDDEN_SEGMENTS.has(String(segment))))
    throw new Error(`patch path ${formatPath(patch.path)} contains a forbidden segment`);
  let node: Record<string, unknown> = root;
  for (let i = 0; i < patch.path.length - 1; i++) {
    const segment = patch.path[i] as string;
    const next = node[segment];
    if (next == null || typeof next !== "object") node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  const last = patch.path[patch.path.length - 1] as string;
  if ("value" in patch) node[last] = patch.value;
  else delete node[last];
}

function formatPath(path: (string | number)[]): string {
  return `[${path.map((segment) => JSON.stringify(segment)).join(", ")}]`;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}

function toJsonSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return { type: "object", description: "schema unavailable" };
  }
}

/** Compact, size-bounded write receipt (the full document comes from describeRouteState). */
function summarizeDoc(doc: unknown): unknown {
  if (doc == null || typeof doc !== "object") return doc;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (Array.isArray(value)) summary[key] = { count: value.length };
    else if (value && typeof value === "object") summary[key] = { keys: Object.keys(value).length };
    else summary[key] = value;
  }
  return summary;
}

function unknownRoute(route: string): { ok: false; error: string; hint: string } {
  return {
    ok: false,
    error: `unknown route '${route}'`,
    hint: "GET /pe/route-state lists the registered routes.",
  };
}
