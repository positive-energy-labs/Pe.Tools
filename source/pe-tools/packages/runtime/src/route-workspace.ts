import { z } from "zod";
import { BIND_COMMAND } from "@pe/agent-contracts";
import type {
  RouteStateCommandHandler,
  RouteStateCommandHandlers,
  RouteStateSpec,
} from "@pe/agent-contracts";
import type { RuntimeThreadStateStore } from "./storage/thread-state.ts";

export type RouteWorkspaceScope = { kind: "thread"; threadId: string } | { kind: "workspace" };
export type RouteWorkspaceActor = "agent" | "human";
export type RouteWorkspacePatch = { path: (string | number)[]; value?: unknown };

export interface RouteWorkspaceRegistration {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: the schema/handler pairing is checked where registrations are built.
  handlers: RouteStateCommandHandlers<any>;
}

export interface RouteWorkspaceThreadEvent {
  type: "route_workspace";
  threadId: string;
  route: string;
  action: "apply" | "command";
  revision: number;
  command?: string;
  patchCount?: number;
  ok: boolean;
  error?: string;
}

export interface RouteWorkspaceEvent extends Omit<RouteWorkspaceThreadEvent, "threadId"> {
  scope: RouteWorkspaceScope;
  actor: RouteWorkspaceActor;
}

export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RuntimeThreadStateStore;
  resourceId: string;
  authorizeThread(threadId: string): boolean | Promise<boolean>;
  appendThreadEvent?(event: RouteWorkspaceThreadEvent): void | Promise<void>;
}

export interface RouteWorkspaceApplyResult {
  ok: boolean;
  doc?: unknown;
  error?: string;
  hint?: string;
}

export interface RouteWorkspaceCommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  hint?: string;
}

interface ExternalOperation {
  command: string;
  startedAt: string;
}

interface PersistedRouteEnvelope {
  version: 1;
  revision: number;
  doc: unknown;
  inFlight?: ExternalOperation;
  outcomeUnknown?: ExternalOperation;
}

const ENVELOPE_VERSION = 1;
const STATE_TYPE_PREFIX = "route-workspace:";
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Durable collaborative route state. Storage, validation, ordering, recovery, and
 * publication stay behind this interface so transports remain thin adapters.
 */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();

  constructor(private readonly options: RouteWorkspaceOptions) {
    if (!options.resourceId) throw new Error("route workspace requires a resourceId");
    for (const registration of options.registrations) {
      const route = registration.spec.route;
      if (this.#registry.has(route)) throw new Error(`duplicate route '${route}'`);
      this.#registry.set(route, registration);
    }
  }

  list() {
    return [...this.#registry.values()].map(({ spec }) => ({
      route: spec.route,
      title: spec.title,
      description: spec.description,
    }));
  }

  async read(scope: RouteWorkspaceScope, route: string) {
    await this.#authorize(scope);
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    const { envelope } = await this.#serialized(scope, route, () => this.#load(scope, spec));
    return {
      route,
      title: spec.title,
      description: spec.description,
      key: spec.key,
      doc: structuredClone(envelope.doc),
      revision: envelope.revision,
      status: envelope.outcomeUnknown ? "outcomeUnknown" : "ready",
      outcomeUnknown: envelope.outcomeUnknown,
      schema: toJsonSchema(spec.schema),
      agentWriteMask: spec.agentWriteMask,
      commands: describeCommands(spec),
    };
  }

  async apply(
    scope: RouteWorkspaceScope,
    route: string,
    actor: RouteWorkspaceActor,
    patches: RouteWorkspacePatch[],
  ): Promise<RouteWorkspaceApplyResult> {
    await this.#authorize(scope);
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec } = registration;

    if (actor === "agent") {
      for (const patch of patches) {
        if (!isMaskAllowed(spec.agentWriteMask, patch.path)) {
          return {
            ok: false,
            error: `patch path ${formatPath(patch.path)} is not agent-writable`,
            hint: `the agent write mask allows only ${spec.agentWriteMask
              .map(formatPath)
              .join(", ")} (and their subtrees); everything else is human-only.`,
          };
        }
      }
    }

    return this.#serialized(scope, route, async () => {
      const { envelope } = await this.#load(scope, spec);
      const draft = structuredClone(envelope.doc) as Record<string, unknown>;
      try {
        for (const patch of patches) applyPatch(draft, patch);
      } catch (error) {
        const result = {
          ok: false,
          error: message(error),
          hint: "patch paths must address plain document keys.",
        } as const;
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "apply",
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: result.error,
        });
        return result;
      }

      const parsed = spec.schema.safeParse(draft);
      if (!parsed.success) {
        const result = {
          ok: false,
          error: "the patched document is invalid",
          hint: formatZodError(parsed.error),
        } as const;
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "apply",
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: result.error,
        });
        return result;
      }

      envelope.doc = parsed.data;
      envelope.revision++;
      await this.#persist(scope, route, envelope);
      const event: RouteWorkspaceEvent = {
        type: "route_workspace",
        scope,
        route,
        actor,
        action: "apply",
        revision: envelope.revision,
        patchCount: patches.length,
        ok: true,
      };
      await this.#publish(event);
      return { ok: true, doc: summarizeDoc(parsed.data) };
    });
  }

  async command(
    scope: RouteWorkspaceScope,
    route: string,
    actor: RouteWorkspaceActor,
    command: string,
    input: unknown,
  ): Promise<RouteWorkspaceCommandResult> {
    await this.#authorize(scope);
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec, handlers } = registration;

    return this.#serialized(scope, route, async () => {
      const { envelope } = await this.#load(scope, spec);
      const fail = async (error: string, hint: string): Promise<RouteWorkspaceCommandResult> => {
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "command",
          command,
          revision: envelope.revision,
          ok: false,
          error,
        });
        return { ok: false, error, hint };
      };
      const commandSpec = spec.commands[command];
      if (!commandSpec)
        return fail(
          `unknown command '${command}'`,
          `available commands: ${Object.keys(spec.commands).join(", ") || "(none)"}.`,
        );
      if (commandSpec.actor === "human" && actor !== "human")
        return fail(
          `command '${command}' is human-only`,
          "a human must run this command from the browser UI.",
        );
      const parsedInput = commandSpec.input.safeParse(input ?? {});
      if (!parsedInput.success)
        return fail(`invalid input for command '${command}'`, formatZodError(parsedInput.error));
      const handler = handlers[command] ?? (command === BIND_COMMAND ? bindHandler : undefined);
      if (!handler)
        return fail(
          `command '${command}' has no registered handler`,
          "this is a wiring bug in the route registration.",
        );
      if (envelope.outcomeUnknown && commandSpec.mutatesExternal && !commandSpec.recoversExternal) {
        return fail(
          `command '${command}' is blocked because a prior external outcome is unknown`,
          "run a recovery command successfully before another external mutation.",
        );
      }

      const priorUnknown = envelope.outcomeUnknown;
      if (commandSpec.mutatesExternal) {
        // Crash barrier: this durable marker must land before the handler can touch Revit/host.
        envelope.inFlight = { command, startedAt: new Date().toISOString() };
        await this.#persist(scope, route, envelope);
      }

      let nextDoc = structuredClone(envelope.doc);
      let docChanged = false;
      try {
        const result = await handler(parsedInput.data, {
          getDoc: () => structuredClone(nextDoc),
          setDoc: async (candidate) => {
            nextDoc = spec.schema.parse(candidate);
            docChanged = true;
          },
        });

        if (docChanged) {
          envelope.doc = nextDoc;
          envelope.revision++;
        }
        delete envelope.inFlight;
        if (commandSpec.recoversExternal) delete envelope.outcomeUnknown;
        if (docChanged || commandSpec.mutatesExternal || commandSpec.recoversExternal)
          await this.#persist(scope, route, envelope);

        const event: RouteWorkspaceEvent = {
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "command",
          command,
          revision: envelope.revision,
          ok: true,
        };
        await this.#publish(event);
        return { ok: true, result };
      } catch (error) {
        const errorMessage = message(error);
        if (commandSpec.mutatesExternal) {
          envelope.outcomeUnknown = priorUnknown ?? envelope.inFlight;
          delete envelope.inFlight;
          await this.#persist(scope, route, envelope);
        }
        return fail(
          errorMessage,
          commandSpec.mutatesExternal
            ? "the external outcome is unknown; recover before another external mutation."
            : "the command handler threw.",
        );
      }
    });
  }

  subscribe(listener: (event: RouteWorkspaceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #authorize(scope: RouteWorkspaceScope): Promise<void> {
    if (scope.kind === "thread" && !(await this.options.authorizeThread(scope.threadId)))
      throw new Error(`thread '${scope.threadId}' is not authorized`);
  }

  async #load(scope: RouteWorkspaceScope, spec: RouteStateSpec<z.ZodType>) {
    const threadId = this.#storageThreadId(scope);
    const type = stateType(spec.route);
    const raw = await this.options.store.getState({ threadId, type });
    if (raw == null) {
      return {
        persisted: false,
        envelope: {
          version: ENVELOPE_VERSION,
          revision: 0,
          doc: spec.schema.parse({}),
        } satisfies PersistedRouteEnvelope,
      };
    }
    const envelope = parseEnvelope(raw, spec);
    if (envelope.inFlight) {
      // A new module cannot prove whether the prior process crossed its external side effect.
      envelope.outcomeUnknown ??= envelope.inFlight;
      delete envelope.inFlight;
      await this.options.store.setState({ threadId, type, value: envelope });
    }
    return { persisted: true, envelope };
  }

  async #persist(
    scope: RouteWorkspaceScope,
    route: string,
    envelope: PersistedRouteEnvelope,
  ): Promise<void> {
    await this.options.store.setState({
      threadId: this.#storageThreadId(scope),
      type: stateType(route),
      value: envelope,
    });
  }

  #storageThreadId(scope: RouteWorkspaceScope): string {
    // Native thread state requires a threadId; workspace state gets one stable resource-owned key.
    return scope.kind === "thread"
      ? scope.threadId
      : `${STATE_TYPE_PREFIX}workspace:${this.options.resourceId}`;
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    if (event.actor === "human" && event.scope.kind === "thread") {
      await this.options.appendThreadEvent?.({
        type: event.type,
        threadId: event.scope.threadId,
        route: event.route,
        action: event.action,
        revision: event.revision,
        command: event.command,
        patchCount: event.patchCount,
        ok: event.ok,
        error: event.error,
      });
    }
    for (const listener of this.#listeners) listener(event);
  }

  #serialized<T>(scope: RouteWorkspaceScope, route: string, work: () => Promise<T>): Promise<T> {
    // Keep the whole read/validate/effect/persist/publication sequence ordered per document.
    const key = `${this.#storageThreadId(scope)}\0${route}`;
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    return run.finally(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
  }
}

function stateType(route: string): string {
  return `${STATE_TYPE_PREFIX}${route}`;
}

/** Substrate-owned binding command; route registrations deliberately omit it. */
const bindHandler: RouteStateCommandHandler = async (input, context) => {
  const { target } = input as { target: string | null };
  const doc = context.getDoc() as Record<string, unknown>;
  doc.binding = { target, boundAt: target == null ? null : new Date().toISOString() };
  await context.setDoc(doc);
  return { target };
};

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): PersistedRouteEnvelope {
  if (!isRecord(raw) || raw.version !== ENVELOPE_VERSION || !Number.isInteger(raw.revision))
    throw new Error(`invalid persisted envelope for route '${spec.route}'`);
  const doc = spec.schema.safeParse(raw.doc);
  if (!doc.success) throw new Error(`invalid persisted document for route '${spec.route}'`);
  return {
    version: ENVELOPE_VERSION,
    revision: raw.revision as number,
    doc: doc.data,
    inFlight: parseExternalOperation(raw.inFlight),
    outcomeUnknown: parseExternalOperation(raw.outcomeUnknown),
  };
}

function parseExternalOperation(value: unknown): ExternalOperation | undefined {
  if (!isRecord(value) || typeof value.command !== "string" || typeof value.startedAt !== "string")
    return undefined;
  return { command: value.command, startedAt: value.startedAt };
}

function describeCommands(spec: RouteStateSpec<z.ZodType>) {
  return Object.entries(spec.commands).map(([name, raw]) => {
    const command = raw;
    return {
      name,
      description: command.description,
      actor: command.actor,
      mutatesExternal: command.mutatesExternal === true,
      recoversExternal: command.recoversExternal === true,
      input: toJsonSchema(command.input),
    };
  });
}

function isMaskAllowed(mask: string[][], path: (string | number)[]): boolean {
  return mask.some(
    (pattern) =>
      path.length >= pattern.length &&
      pattern.every((segment, index) => segment === "*" || segment === String(path[index])),
  );
}

function applyPatch(root: Record<string, unknown>, patch: RouteWorkspacePatch): void {
  if (patch.path.length === 0) return;
  if (patch.path.some((segment) => FORBIDDEN_SEGMENTS.has(String(segment))))
    throw new Error(`patch path ${formatPath(patch.path)} contains a forbidden segment`);
  let node = root;
  for (let index = 0; index < patch.path.length - 1; index++) {
    const segment = String(patch.path[index]);
    const next = node[segment];
    if (next == null) node[segment] = {};
    else if (!isRecord(next))
      throw new Error(`patch path ${formatPath(patch.path)} is not an object`);
    node = node[segment] as Record<string, unknown>;
  }
  const last = String(patch.path.at(-1));
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

function summarizeDoc(doc: unknown): unknown {
  if (!isRecord(doc)) return doc;
  return Object.fromEntries(
    Object.entries(doc).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? { count: value.length }
        : isRecord(value)
          ? { keys: Object.keys(value).length }
          : value,
    ]),
  );
}

function unknownRoute(route: string): { ok: false; error: string; hint: string } {
  return {
    ok: false,
    error: `unknown route '${route}'`,
    hint: "list the registered routes before addressing one.",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
