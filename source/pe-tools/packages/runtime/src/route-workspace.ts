import { z } from "zod";
import {
  applyPatches,
  commitDoc,
  guardCommand,
  type ExternalOperation,
  type Address,
  type RouteActor,
  type RouteEnvelope,
  type RoutePatch,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";

export type RouteWorkspaceScope = { documentAddress: Address };
export type RouteWorkspaceActor = RouteActor;
export type RouteWorkspacePatch = RoutePatch;

export interface RouteWorkspaceRegistration {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: the schema/handler pairing is checked where registrations are built.
  handlers: RouteStateCommandHandlers<any>;
}

export interface RouteWorkspaceEvent {
  type: "route_workspace";
  scope: RouteWorkspaceScope;
  actor: RouteWorkspaceActor;
  route: string;
  action: "apply" | "command";
  revision: number;
  command?: string;
  patchCount?: number;
  ok: boolean;
  error?: string;
}

export interface RouteDocumentStore {
  getState(input: { documentAddress: string; route: string }): Promise<unknown>;
  setState(input: { documentAddress: string; route: string; value: unknown }): Promise<void>;
}

export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
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

const ENVELOPE_VERSION = 1;
/** Store, order, crash barrier, and publication shell around the pure route-document machine. */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();

  constructor(private readonly options: RouteWorkspaceOptions) {
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
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    const envelope = await this.#serialized(scope, route, () => this.#load(scope, spec));
    return {
      route,
      title: spec.title,
      description: spec.description,
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
    expectedRevision?: number,
  ): Promise<RouteWorkspaceApplyResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);

    return this.#serialized(scope, route, async () => {
      const envelope = await this.#load(scope, registration.spec);
      const landed = applyPatches(registration.spec, envelope, actor, patches, expectedRevision);
      if (!landed.ok) {
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "apply",
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: landed.error,
        });
        return landed;
      }

      await this.#persist(scope, route, landed.envelope);
      await this.#publish({
        type: "route_workspace",
        scope,
        route,
        actor,
        action: "apply",
        revision: landed.envelope.revision,
        patchCount: patches.length,
        ok: true,
      });
      return { ok: true, doc: summarizeDoc(landed.envelope.doc) };
    });
  }

  async command(
    scope: RouteWorkspaceScope,
    route: string,
    actor: RouteWorkspaceActor,
    command: string,
    input: unknown,
  ): Promise<RouteWorkspaceCommandResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec, handlers } = registration;

    return this.#serialized(scope, route, async () => {
      let envelope = await this.#load(scope, spec);
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
      const guarded = guardCommand(spec, envelope, actor, command, input);
      if (!guarded.ok) return fail(guarded.error, guarded.hint);
      const handler = handlers[command];
      if (!handler)
        return fail(
          `command '${command}' has no registered handler`,
          "this is a wiring bug in the route registration.",
        );

      const priorUnknown = envelope.outcomeUnknown;
      if (guarded.command.mutatesExternal) {
        envelope.inFlight = { command, startedAt: new Date().toISOString() };
        await this.#persist(scope, route, envelope);
      }

      let committed: RouteEnvelope<unknown> | null = null;
      try {
        const result = await handler(guarded.input, {
          documentAddress: scope.documentAddress,
          getDoc: () => structuredClone(committed?.doc ?? envelope.doc),
          setDoc: async (candidate) => {
            const landed = commitDoc(spec, envelope, candidate);
            if (!landed.ok) throw new Error(`${landed.error}: ${landed.hint}`);
            committed = landed.envelope;
          },
        });

        if (committed) envelope = committed;
        delete envelope.inFlight;
        if (guarded.command.recoversExternal) delete envelope.outcomeUnknown;
        if (committed || guarded.command.mutatesExternal || guarded.command.recoversExternal)
          await this.#persist(scope, route, envelope);

        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "command",
          command,
          revision: envelope.revision,
          ok: true,
        });
        return { ok: true, result };
      } catch (error) {
        const errorMessage = message(error);
        if (guarded.command.mutatesExternal) {
          envelope.outcomeUnknown = priorUnknown ?? envelope.inFlight;
          delete envelope.inFlight;
          await this.#persist(scope, route, envelope);
        }
        return fail(
          errorMessage,
          guarded.command.mutatesExternal
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

  async #load(
    scope: RouteWorkspaceScope,
    spec: RouteStateSpec<z.ZodType>,
  ): Promise<RouteEnvelope<unknown>> {
    const raw = await this.options.store.getState({
      documentAddress: scope.documentAddress,
      route: spec.route,
    });
    if (raw == null)
      return {
        version: ENVELOPE_VERSION,
        revision: 0,
        doc: spec.schema.parse({}),
      };
    const envelope = parseEnvelope(raw, spec);
    if (envelope.inFlight) {
      envelope.outcomeUnknown ??= envelope.inFlight;
      delete envelope.inFlight;
      await this.options.store.setState({
        documentAddress: scope.documentAddress,
        route: spec.route,
        value: envelope,
      });
    }
    return envelope;
  }

  async #persist(
    scope: RouteWorkspaceScope,
    route: string,
    envelope: RouteEnvelope<unknown>,
  ): Promise<void> {
    await this.options.store.setState({
      documentAddress: scope.documentAddress,
      route,
      value: envelope,
    });
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    for (const listener of this.#listeners) listener(event);
  }

  #serialized<T>(scope: RouteWorkspaceScope, route: string, work: () => Promise<T>): Promise<T> {
    const key = `${scope.documentAddress}\0${route}`;
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

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
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
  return Object.entries(spec.commands).map(([name, command]) => ({
    name,
    description: command.description,
    actor: command.actor,
    mutatesExternal: command.mutatesExternal === true,
    recoversExternal: command.recoversExternal === true,
    input: toJsonSchema(command.input),
  }));
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
